"""Round 3 of Muse Glimmer's training data (the rule: eval/frozen/glimmer_round3_rule.md).

For five case kinds where Muse Spark misjudges which missing record matters, the teacher
gets a note built from the simulator's label: which records settle the case. The note is
sent to the teacher only (eval.spark_reasoning --guided); it is never in the trace, and
the training data is rebuilt from the trace's steps, so Muse Glimmer never sees it.

A guided run is kept only if its answer is grounded in what it read: `grounded` checks
the cited evidence by the signals and time it covers against the oracle's own rule
(sim/oracle.py COMBOS, any sufficient combination), not by literal evidence IDs.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from core.physics import MIN_COVERAGE
from sim.oracle import COMBOS, EVIDENCE_NAMES

# (scenario kind, the signal missing in the case, justified answer): the kinds the teacher misjudges
TARGETS = {
    ("dilution", "S2", "insufficient"): "dilution, ETP inflow missing",
    ("maintenance", "S4a", "insufficient"): "maintenance, outfall flow missing",
    ("maintenance", "S3", "supports"): "maintenance, ETP power missing",
    ("maintenance", "S2", "supports"): "maintenance, ETP inflow missing",
    ("normal", "S2", "supports"): "normal, ETP inflow missing",
}
FAMILY = {"dilution": "dilution", "maintenance": "maintenance", "normal": "normal"}
# the note's distinctive wording; a run that repeats it is dropped
ECHOES = ("people who built", "guide this investigation", "does not decide", "enough to settle",
          "cannot settle the claim for that stretch without it")
TZ = "+06:00"


def target(folder: Path) -> tuple[str, str, str] | None:
    """The case's target kind, or None."""
    sc = json.loads((folder / "hidden" / "scenario.json").read_text(encoding="utf-8"))
    lab = json.loads((folder / "hidden" / "label.json").read_text(encoding="utf-8"))
    gaps = sorted({g["signal"] for g in sc["gaps"]})
    if len(gaps) != 1 or not sc["tank_level_available"]:
        return None
    key = (sc["kind"], gaps[0], lab["justified"])
    return key if key in TARGETS else None


def _when(ts: str) -> str:
    return pd.Timestamp(ts).strftime("%d %b %H:%M")


def note(folder: Path) -> str:
    """The note for the teacher: which records settle this case."""
    key = target(folder)
    assert key, f"{folder.name} is not a round 3 target"
    lab = json.loads((folder / "hidden" / "label.json").read_text(encoding="utf-8"))
    _, gap, justified = key
    name = EVIDENCE_NAMES[gap]
    if justified == "insufficient":
        w = lab["evidence_request"]["interval"]
        return (f"Note for this case from the people who built it, to guide this investigation only: the {name} is missing "
                f"from {_when(w[0])} to {_when(w[1])}, and the other records cannot settle the claim for that stretch "
                f"without it. Investigate as usual, cite only what you read, and where the records cannot settle it, ask "
                f"for that record.")
    names = [EVIDENCE_NAMES[i] for i in lab["established_by"]]
    settle = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]
    w = lab["window"]
    return (f"Note for this case from the people who built it, to guide this investigation only: the missing {name} does "
            f"not decide this case; the {settle} from {_when(w[0])} to {_when(w[1])} are enough to settle it. Investigate "
            f"as usual, cite only what you read, and conclude from what those records show.")


# ---- grounding

def _span(eid: str) -> tuple[pd.Timestamp, pd.Timestamp] | None:
    m = re.search(r"@(\d{4})-(\d{4})(?:\.\.(\d{4})-(\d{4}))?$", eid)
    if not m:
        return None
    t = lambda d, h: pd.Timestamp(f"2026-{d[:2]}-{d[2:]} {h[:2]}:{h[2:]}{TZ}")  # noqa: E731
    start = t(m[1], m[2])
    return (start, t(m[3], m[4]) if m[3] else start)


def _items(eid: str, results: dict) -> set[str]:
    """The oracle's evidence items an evidence ID stands for."""
    if eid.startswith("sig:"):
        return {eid[4:].split("@")[0]}
    if eid.startswith("calc:power_vs_load"):
        return {"S2", "S3"}
    if eid.startswith("calc:water_balance"):
        r = results.get(eid) or {}
        parts = {"etp": {"S2", "S4a"}, "boundary": {"S1", "S2", "S4a"}, "tank": {"S1", "S2", "T1"}}
        return set().union(*(parts[p] for p in parts if r.get(p)))
    if eid.startswith("calc:compare:"):
        return {"replay:" + eid.split(":")[2].split("@")[0]}
    if eid.startswith("calc:reading_vs_feed:"):
        return {"photo:" + eid.split(":")[2].split("@")[0]}
    if eid.startswith("doc:lab"):
        return {"lab"}
    return set()


def _cited(final: dict) -> set[str]:
    ids = {k["id"] for k in final.get("key_evidence") or [] if isinstance(k, dict) and k.get("id")}
    for e in final.get("explanations") or []:
        ids |= set(e.get("supporting") or []) | set(e.get("contradicting") or [])
    return ids


def _covered(spans: list, win: tuple) -> float:
    """Share of the window covered by the union of the spans."""
    total = (win[1] - win[0]).total_seconds()
    cut = sorted((max(s, win[0]), min(e, win[1])) for s, e in spans if min(e, win[1]) > max(s, win[0]))
    covered, end = 0.0, win[0]
    for s, e in cut:
        s = max(s, end)
        if e > s:
            covered += (e - s).total_seconds()
            end = e
    return covered / total if total else 0.0


def _request_items(final: dict) -> list[str]:
    er = final if final.get("kind") == "evidence_request" else final.get("evidence_request")
    return [str(i) for i in (er or {}).get("items") or []]


def _names(item: str) -> list[str]:
    names = {"S1": ["intake flow"], "S2": ["ETP inflow"], "S3": ["ETP power"], "S4a": ["outfall flow"],
             "S4b": ["outfall pH"], "S4c": ["outfall conductivity"], "T1": ["tank level"]}
    return [item, *names.get(item, [])]


def grounded(run: dict, folder: Path, min_coverage: float = MIN_COVERAGE) -> tuple[bool, list[str]]:
    """Whether a run's answer is right and follows from what it read. Returns (ok, reasons it failed)."""
    lab = json.loads((folder / "hidden" / "label.json").read_text(encoding="utf-8"))
    sc = json.loads((folder / "hidden" / "scenario.json").read_text(encoding="utf-8"))
    trace, final = run["trace"], run.get("final") or {}
    why: list[str] = []
    if run.get("error"):
        why.append(f"error: {run['error']}")
    if run["status"] != lab["justified"]:
        why.append(f"answered {run['status']}, justified {lab['justified']}")
    v = trace.get("validation") or []
    if not (len(v) == 1 and not v[0]["issues"]):
        why.append("citations not valid first time")
    if why:
        return False, why
    # on top of reading every run: its own words must not repeat the note's
    said = (json.dumps(final) + " " + " ".join(s.get("why") or "" for s in trace["steps"])).lower()
    for phrase in ECHOES:
        if phrase in said:
            why.append(f"repeats the note's wording ({phrase!r})")
    results = {s["result"].get("evidence_id"): s["result"] for s in trace["steps"]
               if isinstance(s.get("result"), dict) and s["result"].get("evidence_id")}
    cited = _cited(final)
    win = (pd.Timestamp(lab["window"][0]), pd.Timestamp(lab["window"][1]))
    gapped = {g["signal"] for g in sc["gaps"]}
    # every target case: it read the overview, and the overview showed it the gap
    overview = next((s["result"] for s in trace["steps"] if s["tool"] == "get_case_overview"
                     and isinstance(s.get("result"), dict) and "signals" in s["result"]), None)
    if overview is None:
        why.append("it never read the case overview")
    else:
        for item in sorted(gapped):
            entry = overview["signals"].get(item)
            if not entry or not entry.get("gaps"):
                why.append(f"the overview it read does not show the {item} gap")
    if lab["justified"] == "insufficient":
        asked = " ".join(_request_items(final))
        for item in lab["evidence_request"]["items"]:
            if not any(n.lower() in asked.lower() for n in _names(item)):
                why.append(f"its request does not name {item} ({EVIDENCE_NAMES.get(item, item)})")
            # citing a read of the gap to show the record is absent is confirming it; using that read to settle
            # an explanation (supported or contradicted) treats an absent record as evidence
            gaps = [(pd.Timestamp(g["start"]), pd.Timestamp(g["end"])) for g in sc["gaps"] if g["signal"] == item]
            settling = {x for e in final.get("explanations") or [] if e.get("status") in ("supported", "contradicted")
                        for x in (e.get("supporting") or []) + (e.get("contradicting") or [])}
            for eid in sorted(settling):
                span = _span(eid)
                if item in _items(eid, results) and span and span[1] > span[0] and gaps \
                        and max(_covered([g], span) for g in gaps) > 0.5:
                    why.append(f"settles an explanation with {eid}, mostly inside the {item} gap")
        for other in ("S1", "S2", "S3", "S4a", "S4b", "S4c", "T1"):
            if other not in gapped and (re.search(rf"\b{other}\b", asked)
                                        or any(n.lower() in asked.lower() for n in _names(other)[1:])):
                why.append(f"its request also asks for {other} ({EVIDENCE_NAMES[other]}), which is there")
    else:
        def spans_of(ids) -> dict[str, list]:
            out: dict[str, list] = {}
            for eid in ids:
                span = _span(eid)
                if span:
                    for item in _items(eid, results):
                        out.setdefault(item, []).append(span)
            return out

        def covers(spans: dict, item: str, w: tuple) -> bool:
            if ":" in item:  # photo, replay, lab: cited at all
                return bool(spans.get(item))
            return _covered(spans.get(item, []), w) >= min_coverage

        family = FAMILY.get(sc["kind"], sc["kind"])
        cited_spans, read_spans = spans_of(cited), spans_of(results)
        cite_win = win
        if family == "maintenance":
            # the citations must cover the stop, where holding is decided; the successful reads must also cover the
            # oracle's whole window (the stop and 6 h of catch-up), so a batch-level "supports" saw the release too
            stop = next(e for e in sc["events"] if e["type"] == "maintenance")
            cite_win = (pd.Timestamp(stop["start"]), pd.Timestamp(stop["end"]))
        combos = COMBOS[family]
        if not any(all(covers(cited_spans, i, cite_win) for i in c) for c in combos):
            have = {i: round(_covered(cited_spans.get(i, []), cite_win), 2) for i in sorted({i for c in combos for i in c})}
            why.append(f"cited records do not cover a sufficient set for {family}: coverage {have}")
        if family == "maintenance" and not any(all(covers(read_spans, i, win) for i in c) for c in combos):
            have = {i: round(_covered(read_spans.get(i, []), win), 2) for i in sorted({i for c in combos for i in c})}
            why.append(f"its reads do not cover the stop and catch-up: coverage {have}")
    return not why, why
