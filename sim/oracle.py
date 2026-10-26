"""The justified assessment for a case: what the evidence available to an
investigator supports, which may be weaker than what actually happened.

The oracle knows the ground truth (from the simulator) and which signals
were recorded. For each kind of underlying situation it holds a list of
evidence combinations, each of which would be enough to establish it. If
any combination was recorded over the relevant window, the situation is
established; if none was, the justified answer is "insufficient", with a
request for whatever would complete the nearest combination.

Every combination pairs at least two separate signals, so no single meter
can establish a finding on its own: one odd reading is also what a sensor
fault looks like.

Rules, case by case:

Untreated discharge (shutdown, bypass) reached the outfall during the
batch's treatment interval -> "contradicts", established by:
  - S2 + S4a: outfall flow exceeds what the ETP treated
  - S3 + S4b: ETP power down while outfall pH shows raw wastewater
  - S2 + S4b: ETP inflow down while outfall pH shows raw wastewater
  - S3 + S4a (shutdown only): ETP at standby while the outfall kept flowing
  - T1 + S4b (shutdown only): tank full while outfall pH shows raw wastewater

Planned maintenance with no discharge -> "supports" (the stored wastewater
was treated once the ETP restarted), established by:
  - T1 + S4a: tank level absorbed the flow and the outfall carried nothing
    untreated, over the downtime and the catch-up after it

Normal operation or low production -> "supports", established by:
  - S2 + S3 + S4a: ETP took the flow, ran, and the outfall matches treated flow
  - S2 + S3 + S4b: ETP took the flow, ran, and outfall pH was treated-range
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from core.physics import MIN_COVERAGE, coverage, treatment_interval
from sim.config import FactoryConfig
from sim.generator import Batch, Case
from sim.scenarios import EventType

UNTREATED_THRESHOLD_M3_H = 1.0
MAINTENANCE_CATCH_UP_H = 6

STATUSES = ("supports", "contradicts", "insufficient", "review_required")

COMBOS: dict[str, list[tuple[str, ...]]] = {
    "shutdown": [("S2", "S4a"), ("S3", "S4b"), ("S2", "S4b"), ("S3", "S4a"), ("T1", "S4b")],
    "bypass": [("S2", "S4a"), ("S3", "S4b"), ("S2", "S4b")],
    "maintenance": [("T1", "S4a")],
    "normal": [("S2", "S3", "S4a"), ("S2", "S3", "S4b")],
}

EVIDENCE_NAMES = {
    "S1": "intake flow record",
    "S2": "ETP inflow record",
    "S3": "ETP power record",
    "S4a": "outfall flow record",
    "S4b": "outfall pH record",
    "S4c": "outfall conductivity record",
    "T1": "equalization tank level log",
}


@dataclass
class Label:
    case_id: str
    batch_id: str
    treatment_interval: tuple[str, str]
    underlying: str
    justified: str
    window: tuple[str, str]
    established_by: tuple[str, ...] | None
    evidence_request: dict | None


def _runs_of(mask: pd.Series) -> tuple[pd.Timestamp, pd.Timestamp] | None:
    """First and last timestamps (end exclusive) where the mask holds."""
    hits = mask[mask]
    if hits.empty:
        return None
    step = mask.index[1] - mask.index[0]
    return hits.index[0], hits.index[-1] + step


def _overlap(a: tuple, b: tuple) -> tuple | None:
    start, end = max(a[0], b[0]), min(a[1], b[1])
    return (start, end) if start < end else None


def pick_batch(case: Case, cfg: FactoryConfig) -> Batch:
    """The batch whose treatment interval overlaps the event most, or a day 2
    morning batch when nothing happened."""
    events = case.scenario.events
    if not events:
        day2 = case.scenario.start + pd.Timedelta(days=1)
        return next(b for b in case.batches if b.start >= day2)
    ev = (events[0].start, events[0].end)

    def score(b: Batch) -> pd.Timedelta:
        o = _overlap(treatment_interval(b.start, b.end, cfg), ev)
        return (o[1] - o[0]) if o else pd.Timedelta(0)

    candidates = [b for b in case.batches if treatment_interval(b.start, b.end, cfg)[1] <= case.signals.index[-1]]
    return max(candidates or case.batches, key=score)


def _assess(case: Case, combos: list[tuple[str, ...]], win: tuple) -> tuple[tuple[str, ...] | None, tuple[str, ...]]:
    """The first combination fully recorded over the window, else the
    signals missing from the nearest one."""
    best_missing: tuple[str, ...] | None = None
    for combo in combos:
        missing = tuple(s for s in combo if coverage(case.signals, s, *win) < MIN_COVERAGE)
        if not missing:
            return combo, ()
        if best_missing is None or len(missing) < len(best_missing):
            best_missing = missing
    return None, best_missing or ()


def label(case: Case, cfg: FactoryConfig, batch: Batch | None = None) -> Label:
    batch = batch or pick_batch(case, cfg)
    ti = treatment_interval(batch.start, batch.end, cfg)
    truth = case.truth.loc[(case.truth.index >= ti[0]) & (case.truth.index < ti[1])]
    kind = case.scenario.kind

    harm = _runs_of(truth["untreated"] > UNTREATED_THRESHOLD_M3_H)
    off = _runs_of(~truth["etp_on"].astype(bool))

    if harm:
        underlying = kind.value
        combos = COMBOS.get(kind.value, COMBOS["bypass"])
        win, positive = harm, "contradicts"
    elif off:
        underlying = kind.value if kind is EventType.MAINTENANCE else "etp_stopped"
        combos = COMBOS["maintenance"]
        win = (off[0], min(off[1] + pd.Timedelta(hours=MAINTENANCE_CATCH_UP_H), ti[1]))
        positive = "supports"
    else:
        underlying = kind.value if kind is EventType.LOW_PRODUCTION else "normal"
        combos = COMBOS["normal"]
        win, positive = ti, "supports"

    established, missing = _assess(case, combos, win)
    request = None
    if not established:
        request = {
            "type": " and ".join(EVIDENCE_NAMES[s] for s in missing),
            "signals": list(missing),
            "interval": (str(win[0]), str(win[1])),
        }
    return Label(
        case_id=case.scenario.id,
        batch_id=batch.id,
        treatment_interval=(str(ti[0]), str(ti[1])),
        underlying=underlying,
        justified=positive if established else "insufficient",
        window=(str(win[0]), str(win[1])),
        established_by=established,
        evidence_request=request,
    )
