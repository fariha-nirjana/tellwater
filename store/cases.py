"""Evidence store: saving cases to disk and loading the investigator's view.

Layout of a saved case:

    <root>/<case_id>/
        case.json            case id, factory, target batch, time range
        signals.csv.gz       what the meters recorded
        batches.json         the production plan
        documents.json       document metadata, with content hashes
        docs/*.jpg           document images as received
        hidden/              ground truth, labels, full document content

The investigator's view (`Bundle`) is built only from the files outside
`hidden/`. Factory-written documents and meter photos expose no
transcription: their content has to be read from the image.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd

from sim.config import FactoryConfig, load_factory
from sim.generator import Case
from sim.oracle import Label
from sim.render import render_case_documents

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "data" / "generated" / "cases"

# document content that arrives as data rather than as an image to read
STRUCTURED = {"lab_report", "operator_statement"}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_case(case: Case, label: Label, root: Path = CASES, factory_name: str | None = None) -> Path:
    from sim.config import config_name

    factory_name = factory_name or config_name(case.factory_id)
    folder = root / case.scenario.id
    docs_dir = folder / "docs"
    hidden = folder / "hidden"
    hidden.mkdir(parents=True, exist_ok=True)
    render_case_documents(case, docs_dir)

    case.signals.to_csv(folder / "signals.csv.gz", index_label="time", compression={"method": "gzip", "mtime": 0})
    (folder / "case.json").write_text(json.dumps({
        "case_id": case.scenario.id,
        "factory_id": case.factory_id,
        "factory_config": factory_name,
        "target_batch": label.batch_id,
        "start": str(case.signals.index[0]),
        "end": str(case.signals.index[-1]),
    }, indent=2), encoding="utf-8")
    (folder / "batches.json").write_text(json.dumps([
        {"id": b.id, "start": str(b.start), "end": str(b.end), "shade": b.shade,
         "planned_wastewater_m3": b.planned_wastewater_m3} for b in case.batches
    ], indent=2), encoding="utf-8")

    public, full = [], []
    for d in case.documents:
        entry = {"id": d.id, "type": d.type, "covers": [str(d.covers[0]), str(d.covers[1])],
                 "received_at": str(d.received_at), "author": d.author, "is_claim": d.is_claim,
                 "image": f"docs/{d.image}" if d.image else None,
                 "sha256": _sha256(docs_dir / d.image) if d.image else None}
        if d.type in STRUCTURED:
            entry["content"] = d.content
        public.append(entry)
        full.append({**entry, "content": d.content, "truthful": d.truthful,
                     "meta": json.loads(json.dumps(d.meta, default=str))})
    (folder / "documents.json").write_text(json.dumps(public, indent=2), encoding="utf-8")

    case.truth.to_csv(hidden / "truth.csv.gz", index_label="time", compression={"method": "gzip", "mtime": 0})
    (hidden / "label.json").write_text(json.dumps(asdict(label), indent=2, default=str), encoding="utf-8")
    (hidden / "documents_full.json").write_text(json.dumps(full, indent=2, default=str), encoding="utf-8")
    sc = case.scenario
    (hidden / "scenario.json").write_text(json.dumps({
        "id": sc.id, "seed": sc.seed, "kind": sc.kind.value, "tank_level_available": sc.tank_level_available,
        "events": [{"type": e.type.value, "start": str(e.start), "end": str(e.end), "params": e.params} for e in sc.events],
        "gaps": [{"signal": g.signal, "start": str(g.start), "end": str(g.end)} for g in sc.gaps],
    }, indent=2, default=str), encoding="utf-8")
    return folder


@dataclass
class Bundle:
    """Everything the investigator is allowed to see for one case."""

    case_id: str
    folder: Path
    factory_config: str
    cfg: FactoryConfig
    signals: pd.DataFrame
    batches: list[dict]
    documents: list[dict]
    target_batch: dict
    start: pd.Timestamp
    end: pd.Timestamp

    def document(self, doc_id: str) -> dict | None:
        return next((d for d in self.documents if d["id"] == doc_id), None)


def load_bundle(folder: Path) -> Bundle:
    meta = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    cfg = load_factory(meta["factory_config"])
    signals = pd.read_csv(folder / "signals.csv.gz", index_col="time")
    signals.index = pd.to_datetime(signals.index).tz_convert(cfg.timezone)
    batches = json.loads((folder / "batches.json").read_text(encoding="utf-8"))
    return Bundle(
        case_id=meta["case_id"],
        folder=folder,
        factory_config=meta["factory_config"],
        cfg=cfg,
        signals=signals,
        batches=batches,
        documents=json.loads((folder / "documents.json").read_text(encoding="utf-8")),
        target_batch=next(b for b in batches if b["id"] == meta["target_batch"]),
        start=pd.Timestamp(meta["start"]).tz_convert(cfg.timezone),
        end=pd.Timestamp(meta["end"]).tz_convert(cfg.timezone),
    )


def load_label(folder: Path) -> dict:
    """Evaluation only. Never called from agent code."""
    return json.loads((folder / "hidden" / "label.json").read_text(encoding="utf-8"))
