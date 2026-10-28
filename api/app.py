"""HTTP API behind the Tellwater interface.

    .venv/bin/uvicorn api.app:app --reload

Serves the demo cases (signals, documents, the saved investigation), runs a
live investigation as a stream of steps, takes a factory's response to an
evidence request, records reviewer decisions, and serves the evaluation
results. Everything the interface shows comes from here.
"""

from __future__ import annotations

import io
import json
import queue
import threading
from datetime import datetime
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from agent.loop import investigate
from agent.models import ModelClient, ModelEndpoint
from agent.tools import SIGNAL_INFO, CaseTools
from api.demo import DEMO, DEMO_ROOT
from sim.baseline import power_model
from store.cases import ROOT, Bundle, load_bundle

app = FastAPI(title="Tellwater")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE = DEMO_ROOT / "state.json"  # reviewer decisions and factory submissions, shared across devices
_lock = threading.Lock()


# ---- storage


def _folder(key: str) -> Path:
    if key not in DEMO:
        raise HTTPException(404, f"no demo case {key!r}")
    return DEMO_ROOT / key / "case"


def _state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"reviews": {}, "submissions": {}}


def _save_state(s: dict) -> None:
    with _lock:
        STATE.write_text(json.dumps(s, indent=1))


def _trace(key: str, which: str = "saved") -> dict | None:
    path = DEMO_ROOT / key / ("trace.json" if which == "saved" else f"trace-{which}.json")
    return json.loads(path.read_text()) if path.exists() else None


def _bundle(key: str) -> Bundle:
    """The case as the investigator sees it, plus any record the factory has submitted."""
    bundle = load_bundle(_folder(key))
    sub = _state()["submissions"].get(key)
    if sub:
        uploaded = pd.read_json(io.StringIO(json.dumps(sub["series"])), typ="series")
        uploaded.index = pd.to_datetime(uploaded.index).tz_convert(bundle.cfg.timezone)
        col = bundle.signals[sub["signal"]].copy()
        col.loc[uploaded.index.intersection(col.index)] = uploaded
        bundle.signals = bundle.signals.assign(**{sub["signal"]: col})
        bundle.documents = [*bundle.documents, {
            "id": f"doc:submission-{sub['signal']}", "type": "factory_submission", "author": "Factory",
            "is_claim": True, "covers": sub["covers"], "received_at": sub["at"], "image": None,
            "content": {"text": f"{SIGNAL_INFO[sub['signal']][0]} log submitted by the factory in response to the "
                                f"evidence request. Its readings are now in the {sub['signal']} record. Note: {sub['note'] or 'none'}"}}]
    return bundle


def _lines(folder: Path) -> dict[str, list[dict]]:
    """Where each logbook line sits on its photo (0 to 1000 grid), for highlighting. Layout only, no labels."""
    full = json.loads((folder / "hidden" / "documents_full.json").read_text())
    return {d["id"]: d["meta"]["lines"] for d in full if d["type"] == "logbook" and d.get("meta", {}).get("lines")}


# ---- cases


@app.get("/api/cases")
def cases() -> list[dict]:
    out = []
    for key in DEMO:
        bundle, trace = load_bundle(_folder(key)), _trace(key)
        final = (trace or {}).get("final") or {}
        out.append({"key": key, "case_id": bundle.case_id, "batch": bundle.target_batch["id"],
                    "status": (trace or {}).get("status"), "summary": final.get("summary") or final.get("reason")})
    return out


@app.get("/api/cases/{key}")
def case(key: str) -> dict:
    bundle = _bundle(key)
    tools = CaseTools(bundle, power_model(bundle.factory_config))
    overview = tools.tool_get_case_overview()
    lines = _lines(_folder(key))
    docs = []
    for d in bundle.documents:
        docs.append({"id": d["id"], "type": d["type"], "author": d["author"], "is_claim": d["is_claim"],
                     "covers": d["covers"], "received_at": d["received_at"],
                     "image": f"/api/cases/{key}/documents/{d['id']}/image" if d.get("image") else None,
                     "content": d.get("content"), "lines": lines.get(d["id"])})
    return {"key": key, "overview": overview, "documents": docs, "signals": SIGNAL_INFO,
            "submission": _state()["submissions"].get(key), "review": _state()["reviews"].get(key)}


@app.get("/api/cases/{key}/signals")
def signals(key: str, start: str | None = None, end: str | None = None, step: int = 5) -> dict:
    """Readings at `step`-minute resolution; null where the record has no reading."""
    bundle = _bundle(key)
    s = bundle.signals
    if start:
        s = s[s.index >= pd.Timestamp(start).tz_localize(bundle.cfg.timezone)]
    if end:
        s = s[s.index <= pd.Timestamp(end).tz_localize(bundle.cfg.timezone)]
    if step > 5:
        s = s.resample(f"{step}min").mean()
    return {"times": [t.strftime("%Y-%m-%dT%H:%M") for t in s.index],
            "series": {c: [None if pd.isna(v) else round(float(v), 3) for v in s[c]] for c in s.columns}}


@app.get("/api/cases/{key}/documents/{doc_id}/image")
def document_image(key: str, doc_id: str) -> FileResponse:
    folder = _folder(key)
    d = next((d for d in load_bundle(folder).documents if d["id"] == doc_id), None)
    if not d or not d.get("image"):
        raise HTTPException(404, "no image for that document")
    return FileResponse(folder / d["image"], media_type="image/jpeg")


@app.get("/api/cases/{key}/trace")
def trace(key: str, which: str = "saved") -> dict:
    """The saved investigation ('saved'), or the one run after the factory's submission ('after')."""
    _folder(key)
    t = _trace(key, which)
    if t is None:
        raise HTTPException(404, "no investigation saved yet")
    return t


# ---- live investigation


@app.post("/api/cases/{key}/investigate")
def investigate_live(key: str) -> StreamingResponse:
    """Run Muse Spark on the case now. Streams each step as a server-sent event, then the final trace."""
    bundle = _bundle(key)
    events: queue.Queue = queue.Queue()

    def work():
        try:
            t = investigate(bundle, ModelClient(ModelEndpoint.muse_spark()), on_step=lambda st: events.put(("step", st)))
            result = json.loads(t.to_json())
            which = "after" if _state()["submissions"].get(key) else "live"
            (DEMO_ROOT / key / f"trace-{which}.json").write_text(json.dumps(result, indent=1, default=str))
            events.put(("final", result))
        except Exception as exc:  # reported to the interface, never swallowed
            events.put(("error", {"error": f"{type(exc).__name__}: {exc}"}))
        events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        while (item := events.get()) is not None:
            kind, data = item
            yield f"event: {kind}\ndata: {json.dumps(data, default=str)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---- factory response to an evidence request


@app.post("/api/cases/{key}/evidence")
async def submit_evidence(key: str, signal: str = Form("T1"), note: str = Form(""), sample: bool = Form(False),
                          file: UploadFile | None = File(None)) -> dict:
    """A CSV of time,value for one signal. `sample` uses the demo's predefined record instead of an upload."""
    folder = _folder(key)
    if signal not in SIGNAL_INFO:
        raise HTTPException(400, f"unknown signal {signal!r}")
    bundle = load_bundle(folder)
    if sample:
        # the demo record: what the tank level really did, from the simulator's ground truth
        truth = pd.read_csv(folder / "hidden" / "truth.csv.gz", index_col=0, parse_dates=True)[signal]
        truth.index = pd.to_datetime(truth.index).tz_convert(bundle.cfg.timezone)
        every = bundle.cfg.sensors.tank_level_resolution_minutes if signal == "T1" else bundle.cfg.timestep_minutes
        ov = CaseTools(bundle, power_model(bundle.factory_config)).tool_get_case_overview()["treatment_interval"]
        lo = pd.Timestamp(ov["start"]).tz_localize(bundle.cfg.timezone)
        hi = pd.Timestamp(ov["end"]).tz_localize(bundle.cfg.timezone)
        series = truth[(truth.index >= lo) & (truth.index <= hi) & (truth.index.minute % every == 0)].round(3)
        name = "sample tank level log"
    else:
        if file is None:
            raise HTTPException(400, "attach a CSV file or choose the sample record")
        df = pd.read_csv(io.BytesIO(await file.read()))
        if df.shape[1] < 2:
            raise HTTPException(400, "the CSV needs two columns: time and value")
        series = pd.Series(df.iloc[:, 1].astype(float).values,
                           index=pd.to_datetime(df.iloc[:, 0]).dt.tz_localize(bundle.cfg.timezone))
        name = file.filename
    s = _state()
    s["submissions"][key] = {"signal": signal, "file": name, "note": note, "at": datetime.now().isoformat(timespec="minutes"),
                             "covers": [series.index.min().isoformat(), series.index.max().isoformat()],
                             "series": {t.isoformat(): float(v) for t, v in series.items()}}
    _save_state(s)
    return {"recorded": True, "signal": signal, "readings": len(series), "covers": s["submissions"][key]["covers"]}


@app.delete("/api/cases/{key}/evidence")
def clear_evidence(key: str) -> dict:
    s = _state()
    s["submissions"].pop(key, None)
    _save_state(s)
    return {"cleared": True}


# ---- reviewer decision and passport


class Review(BaseModel):
    action: str  # approve | change | return
    status: str | None = None  # the status the reviewer sets, when changing it
    reason: str
    reviewer: str = "Reviewer"


@app.post("/api/cases/{key}/review")
def review(key: str, r: Review) -> dict:
    _folder(key)
    if r.action not in ("approve", "change", "return") or not r.reason.strip():
        raise HTTPException(400, "choose approve, change or return, and give a reason")
    s = _state()
    entry = {**r.model_dump(), "at": datetime.now().isoformat(timespec="minutes")}
    s["reviews"].setdefault(key, []).append(entry)
    _save_state(s)
    return entry


@app.get("/api/passport/{key}")
def passport(key: str) -> dict:
    """The batch-level summary a QR code opens. Reflects the latest investigation and review."""
    bundle = load_bundle(_folder(key))
    t = _trace(key, "after") or _trace(key) or {}
    final = t.get("final") or {}
    reviews = _state()["reviews"].get(key, [])
    last = reviews[-1] if reviews else None
    status = last["status"] if last and last["action"] == "change" and last.get("status") else t.get("status")
    return {"batch": bundle.target_batch, "status": status, "assessed_status": t.get("status"),
            "summary": final.get("summary"), "scope_line": final.get("scope_line"),
            "limitations": final.get("limitations", []), "key_evidence": final.get("key_evidence", []),
            "review": last, "disclosure": "Prototype. Simulated records. A batch-level assessment, not a certificate."}


# ---- evaluation results


@app.get("/api/results")
def results() -> dict:
    """Evaluation summaries per case set and condition, snapshotted by `python -m api.demo`."""
    path = DEMO_ROOT / "results.json"
    return json.loads(path.read_text()) if path.exists() else {}
