"""The justified assessment for a case: what the evidence available to an
investigator supports, which may be weaker than what actually happened.

The oracle knows the ground truth (from the simulator) and which evidence
exists. For each kind of underlying situation it holds evidence
combinations, each enough to establish a finding. If any combination is
available over the relevant window, the finding is established; if none is,
the justified answer is "insufficient", with a request for whatever would
complete the nearest combination.

Evidence items are signals ("S2"), physical documents ("photo:S3" for a
photo of the power meter, "lab" for a lab sample showing effluent over the
BOD limit) and detectable tampering ("replay:S3"). A signal counts only
where it recorded readings and was not faulty or replayed: an investigator
is expected to recognise a stuck, drifting, spiking or replayed feed and
set it aside. Factory-written documents never count: they are claims.

Every combination pairs at least two separate items, so no single meter can
establish a finding on its own: one odd reading is also what a sensor
fault looks like.

Rules, in priority order:

1. Untreated discharge (shutdown, bypass) reached the outfall during the
   batch's treatment interval -> "contradicts", established by:
   - S2 + S4a: outfall flow exceeds what the ETP treated
   - S3 + S4b: ETP power down while outfall pH shows raw wastewater
   - S2 + S4b: ETP inflow down while outfall pH shows raw wastewater
   - S3 + S4a (shutdown only): ETP at standby while the outfall kept flowing
   - T1 + S4b (shutdown only): tank full while outfall pH shows raw wastewater
   - S2 + lab, S3 + lab: a lab sample of untreated effluent while the ETP
     took less flow or ran down
   - S1 + S2 + S3 + T1: the tank balance shows water leaving by another
     route, and power confirms the ETP really took less (a low-reading
     inflow meter alone would look the same)
2. Aeration cut (aerators turned down, possibly hidden by a replayed feed):
   - "contradicts" with S2 + S3 + photo:S3, S2 + S3 + lab, S2 + photo:S3,
     S2 + lab, S3 + lab: low power or poor effluent confirmed by a physical
     record the feed cannot fake
   - "review_required" with S2 + S3 (power below load, but a power meter
     fault would look the same) or S2 + replay:S3 (the power feed is a copy
     of an earlier day: tampering, cause unconfirmed)
3. Dilution (groundwater pumped to the outfall) -> "review_required": the
   outfall measurement point was tampered with, but treatment itself is not
   shown to have failed. Established by S2 + S4a + S4c (excess outfall flow
   with a conductivity drop) or S2 + S4a + S4b (excess flow at treated pH,
   so not raw wastewater).
4. ETP stopped with no discharge (planned maintenance) -> "supports" (the
   stored wastewater was treated once the ETP restarted), established by
   T1 + S4a over the downtime and the catch-up after it.
5. Otherwise (normal, low production, a sensor fault) -> "supports", with
   S2 + S3 + S4a, S2 + S3 + S4b, or S3 + S4a + S4b. A stuck, flat or
   spiking meter is recognisable and set aside. A meter that drifts is not
   recognisable on its own: if its drift makes a check fail (pH outside the
   discharge range, an ETP balance outside tolerance, power below load),
   nothing can show whether the excursion was real, so the justified status
   is "review_required", requesting a calibration record or a grab sample.
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
LAB_LAG_H = 12  # effluent quality lags the aeration cut through the basin

STATUSES = ("supports", "contradicts", "insufficient", "review_required")

COMBOS: dict[str, list[tuple[str, ...]]] = {
    "shutdown": [("S2", "S4a"), ("S3", "S4b"), ("S2", "S4b"), ("S3", "S4a"), ("T1", "S4b"),
                 ("S2", "lab"), ("S3", "lab"), ("S1", "S2", "S3", "T1")],
    "bypass": [("S2", "S4a"), ("S3", "S4b"), ("S2", "S4b"), ("S2", "lab"), ("S3", "lab"), ("S1", "S2", "S3", "T1")],
    "aeration": [("S2", "S3", "photo:S3"), ("S2", "S3", "lab"), ("S2", "photo:S3"), ("S2", "lab"), ("S3", "lab")],
    "aeration_review": [("S2", "S3"), ("S2", "replay:S3")],
    "dilution": [("S2", "S4a", "S4c"), ("S2", "S4a", "S4b")],
    "maintenance": [("T1", "S4a")],
    "normal": [("S2", "S3", "S4a"), ("S2", "S3", "S4b"), ("S3", "S4a", "S4b")],
}

EVIDENCE_NAMES = {
    "S1": "intake flow record",
    "S2": "ETP inflow record",
    "S3": "ETP power record",
    "S4a": "outfall flow record",
    "S4b": "outfall pH record",
    "S4c": "outfall conductivity record",
    "T1": "equalization tank level log",
    "photo:S3": "photo of the ETP power meter",
    "photo:S2": "photo of the ETP inflow meter",
    "lab": "lab test of the outfall effluent",
    "replay:S3": "ETP power record",
}
METER_NAMES = {"S1": "intake flow", "S2": "ETP inflow", "S3": "ETP power", "S4a": "outfall flow", "S4b": "outfall pH",
               "S4c": "outfall conductivity"}


def _evidence_name(item: str) -> str:
    if item.startswith("calibration:"):
        sig = item.split(":")[1]
        return f"calibration record for the {METER_NAMES[sig]} meter, or a grab sample"
    return EVIDENCE_NAMES[item]


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


def _span(mask: pd.Series) -> tuple[pd.Timestamp, pd.Timestamp] | None:
    """First and last timestamps (end exclusive) where the mask holds."""
    hits = mask[mask]
    if hits.empty:
        return None
    step = mask.index[1] - mask.index[0]
    return hits.index[0], hits.index[-1] + step


def _overlap(a: tuple, b: tuple) -> tuple | None:
    start, end = max(a[0], b[0]), min(a[1], b[1])
    return (start, end) if start < end else None


def usable_signals(case: Case) -> pd.DataFrame:
    """Recorded signals with faulty and replayed stretches removed."""
    s = case.signals.copy()
    for ev in case.scenario.events:
        if ev.type in (EventType.SENSOR_FAULT, EventType.REPLAY):
            s.loc[(s.index >= ev.start) & (s.index < ev.end), ev.params["signal"]] = float("nan")
    return s


def pick_batch(case: Case, cfg: FactoryConfig) -> Batch:
    """The batch whose treatment interval overlaps the event most, or a day 2
    morning batch when nothing happened."""
    events = case.scenario.events
    if not events:
        day2 = case.scenario.start + pd.Timedelta(days=1)
        return next(b for b in case.batches if b.start >= day2)
    ev = (min(e.start for e in events), max(e.end for e in events))

    def score(b: Batch) -> pd.Timedelta:
        o = _overlap(treatment_interval(b.start, b.end, cfg), ev)
        return (o[1] - o[0]) if o else pd.Timedelta(0)

    candidates = [b for b in case.batches if treatment_interval(b.start, b.end, cfg)[1] <= case.signals.index[-1]]
    return max(candidates or case.batches, key=lambda b: (score(b), b.start))


class _Evidence:
    """Which evidence items are available over a window."""

    def __init__(self, case: Case, cfg: FactoryConfig):
        self.case, self.cfg = case, cfg
        self.usable = usable_signals(case)

    def available(self, item: str, win: tuple) -> bool:
        if item.startswith("photo:"):
            sig = item.split(":")[1]
            return any(d.type == "meter_photo" and d.content["signal"] == sig and win[0] <= d.covers[0] < win[1]
                       for d in self.case.documents)
        if item == "lab":
            limit = self.cfg.discharge_limits.bod_mg_l
            end = win[1] + pd.Timedelta(hours=LAB_LAG_H)
            return any(d.type == "lab_report" and d.content["bod_mg_l"] > limit and win[0] <= d.covers[0] < end
                       for d in self.case.documents)
        if item.startswith("replay:"):
            sig = item.split(":")[1]
            replay = self.case.scenario.event(EventType.REPLAY)
            return bool(replay and replay.params["signal"] == sig and _overlap((replay.start, replay.end), win)
                        and coverage(self.case.signals, sig, *win) >= MIN_COVERAGE)
        return coverage(self.usable, item, *win) >= MIN_COVERAGE

    def assess(self, combos: list[tuple[str, ...]], win: tuple):
        """The first combination fully available, else the items missing from the nearest one."""
        best: tuple[str, ...] | None = None
        for combo in combos:
            missing = tuple(i for i in combo if not self.available(i, win))
            if not missing:
                return combo, ()
            if best is None or len(missing) < len(best):
                best = missing
        return None, best or ()


def label(case: Case, cfg: FactoryConfig, batch: Batch | None = None) -> Label:
    batch = batch or pick_batch(case, cfg)
    ti = treatment_interval(batch.start, batch.end, cfg)
    truth = case.truth.loc[(case.truth.index >= ti[0]) & (case.truth.index < ti[1])]
    sc = case.scenario
    ev = _Evidence(case, cfg)

    harm = _span(truth["untreated"] > UNTREATED_THRESHOLD_M3_H)
    aeration = _span(truth["aeration_factor"] < 1.0)
    diluted = _span(truth["dilution"] > UNTREATED_THRESHOLD_M3_H)
    off = _span(~truth["etp_on"].astype(bool))
    fault = sc.event(EventType.SENSOR_FAULT)
    fault_in_ti = bool(fault and _overlap((fault.start, fault.end), ti))

    review_combos: list[tuple[str, ...]] = []
    if harm:
        underlying = sc.kind.value
        combos, win, positive = COMBOS.get(sc.kind.value, COMBOS["bypass"]), harm, "contradicts"
    elif aeration:
        underlying = sc.kind.value
        combos, win, positive = COMBOS["aeration"], aeration, "contradicts"
        review_combos = COMBOS["aeration_review"]
    elif diluted:
        underlying = sc.kind.value
        combos, win, positive = COMBOS["dilution"], diluted, "review_required"
    elif off:
        underlying = sc.kind.value if sc.kind is EventType.MAINTENANCE else "etp_stopped"
        combos = COMBOS["maintenance"]
        win = (off[0], min(off[1] + pd.Timedelta(hours=MAINTENANCE_CATCH_UP_H), ti[1]))
        positive = "supports"
    else:
        underlying = sc.kind.value if sc.kind is EventType.LOW_PRODUCTION or fault_in_ti else "normal"
        combos, win, positive = COMBOS["normal"], ti, "supports"

    drift = _drift_breach(case, cfg, fault) if (fault_in_ti and not (harm or aeration or diluted or off)) else None
    if drift:
        return Label(sc.id, batch.id, (str(ti[0]), str(ti[1])), underlying, "review_required",
                     (str(fault.start), str(fault.end)), ("drift", drift),
                     {"type": _evidence_name(f"calibration:{drift}"), "items": [f"calibration:{drift}"],
                      "interval": (str(fault.start), str(fault.end))})

    established, missing = ev.assess(combos, win)
    justified = positive if established else "insufficient"
    if not established and review_combos:
        established, _ = ev.assess(review_combos, win)
        if established:
            justified = "review_required"

    request = None
    if justified in ("insufficient", "review_required") and missing:
        names = list(dict.fromkeys(_evidence_name(i) for i in missing))
        request = {"type": " and ".join(names), "items": list(missing), "interval": (str(win[0]), str(win[1]))}
    return Label(
        case_id=sc.id,
        batch_id=batch.id,
        treatment_interval=(str(ti[0]), str(ti[1])),
        underlying=underlying,
        justified=justified,
        window=(str(win[0]), str(win[1])),
        established_by=established,
        evidence_request=request,
    )


def _drift_breach(case: Case, cfg: FactoryConfig, fault) -> str | None:
    """The drifting signal, if its drift makes one of the standard checks fail."""
    if fault is None or fault.params["mode"] != "drift":
        return None
    sig, w = fault.params["signal"], (fault.start, fault.end)
    lim = cfg.discharge_limits
    if sig == "S4b":
        ph = case.signals.loc[(case.signals.index >= w[0]) & (case.signals.index < w[1]), "S4b"]
        return sig if ((ph < lim.ph_min) | (ph > lim.ph_max)).any() else None
    if sig in ("S2", "S4a"):
        from core.physics import water_balance

        etp = water_balance(case.signals, *w, cfg)["etp"]
        return sig if etp and not etp["within_tolerance"] else None
    if sig == "S3":
        from core.physics import power_vs_load
        from sim.baseline import power_model
        from sim.config import config_name

        r = power_vs_load(case.signals, *w, power_model(config_name(cfg.id)), cfg)
        return sig if r and (r["share_below_band"] > 0.3 or r["share_above_band"] > 0.3) else None
    return None
