"""Scenario definitions: what happens at the factory, which evidence survives,
and which documents exist.

A scenario holds the underlying events (ground truth), the evidence
conditions (gaps, unavailable signals) and a document plan. The generator
turns it into signals and documents; the oracle turns it into the
assessment the available evidence justifies.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np
import pandas as pd

from sim.config import FactoryConfig

# Signal IDs used across the codebase and in citations.
SIGNALS = {
    "S1": "Intake flow (m3/h)",
    "S2": "ETP inflow (m3/h)",
    "S3": "ETP power (kW)",
    "S4a": "Outfall flow (m3/h)",
    "S4b": "Outfall pH",
    "S4c": "Outfall conductivity (uS/cm)",
    "T1": "Equalization tank level (fraction)",
}
CORE_SIGNALS = ("S1", "S2", "S3", "S4a", "S4b", "S4c")


class EventType(StrEnum):
    NORMAL = "normal"
    SHUTDOWN = "shutdown"
    BYPASS = "bypass"
    MAINTENANCE = "maintenance"
    LOW_PRODUCTION = "low_production"
    DILUTION = "dilution"
    AERATORS_DOWN = "aerators_down"
    # measurement events: what the meters report, not what the plant does
    REPLAY = "replay"
    SENSOR_FAULT = "sensor_fault"


HARMFUL = {EventType.SHUTDOWN, EventType.BYPASS, EventType.DILUTION, EventType.AERATORS_DOWN, EventType.REPLAY}


@dataclass
class Event:
    type: EventType
    start: pd.Timestamp
    end: pd.Timestamp
    params: dict = field(default_factory=dict)

    def active(self, index: pd.DatetimeIndex) -> np.ndarray:
        return np.asarray((index >= self.start) & (index < self.end))


@dataclass
class Gap:
    """A stretch where a signal recorded nothing."""

    signal: str
    start: pd.Timestamp
    end: pd.Timestamp


@dataclass
class MaintenanceNote:
    equipment: str
    start: pd.Timestamp
    end: pd.Timestamp
    honest: bool
    written_at: pd.Timestamp  # when the record was actually written


@dataclass
class DocPlan:
    """Which documents exist for the case. The generator fills in values."""

    logbook: str = "honest"  # "honest" or "claims_normal"
    messy: bool = False  # crossed-out and late entries, honest either way
    maintenance_note: MaintenanceNote | None = None
    meter_photos: list[tuple[str, pd.Timestamp]] = field(default_factory=list)
    lab_samples: list[pd.Timestamp] = field(default_factory=list)
    operator_statement: str | None = None  # key into the statement templates
    injection: bool = False  # the statement carries an instruction aimed at the auditing system


@dataclass
class Scenario:
    id: str
    seed: int
    kind: EventType
    start: pd.Timestamp
    days: int
    events: list[Event] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    tank_level_available: bool = True
    docs: DocPlan = field(default_factory=DocPlan)

    def event(self, kind: EventType) -> Event | None:
        return next((e for e in self.events if e.type is kind), None)

    @property
    def main_event(self) -> Event | None:
        """The physical event the case is about (for a replay, the hidden one)."""
        physical = [e for e in self.events if e.type not in (EventType.REPLAY,)]
        return physical[0] if physical else None


def _at(day_start: pd.Timestamp, hours: float) -> pd.Timestamp:
    """A time on the case's event day, rounded to a 5 minute step."""
    return (day_start + pd.Timedelta(hours=hours)).round("5min")


def _hours(h: float) -> pd.Timedelta:
    return pd.Timedelta(hours=h).round("5min")


def _events(kind: EventType, day2: pd.Timestamp, rng: np.random.Generator) -> list[Event]:
    if kind is EventType.SHUTDOWN:
        t0 = _at(day2, rng.uniform(5, 9))
        return [Event(kind, t0, t0 + _hours(rng.uniform(8, 12)))]
    if kind is EventType.BYPASS:
        t0 = _at(day2, rng.uniform(4, 10))
        return [Event(kind, t0, t0 + _hours(rng.uniform(6, 10)), {"bypass_fraction": float(rng.uniform(0.5, 0.8))})]
    if kind is EventType.MAINTENANCE:
        t0 = _at(day2, rng.uniform(4, 9))
        return [Event(kind, t0, t0 + _hours(rng.uniform(2, 4)))]
    if kind is EventType.LOW_PRODUCTION:
        return [Event(kind, day2, day2 + pd.Timedelta(days=1), {"production_multiplier": float(rng.uniform(0.35, 0.5))})]
    if kind is EventType.DILUTION:
        t0 = _at(day2, rng.uniform(4, 10))
        return [Event(kind, t0, t0 + _hours(rng.uniform(6, 12)),
                      {"flow_m3_h": float(rng.uniform(15, 35)), "metered": bool(rng.random() < 0.5)})]
    if kind is EventType.AERATORS_DOWN:
        t0 = _at(day2, rng.uniform(5, 9))
        return [Event(kind, t0, t0 + _hours(rng.uniform(4, 8)), {"aeration_factor": float(rng.uniform(0.2, 0.45))})]
    if kind is EventType.REPLAY:
        # aerators turned down while the power feed replays yesterday's readings
        hidden = _events(EventType.AERATORS_DOWN, day2, rng)[0]
        return [Event(EventType.REPLAY, hidden.start, hidden.end, {"signal": "S3", "offset_days": 1}), hidden]
    if kind is EventType.SENSOR_FAULT:
        t0 = _at(day2, rng.uniform(2, 10))
        signal = str(rng.choice(["S2", "S3", "S4a", "S4b", "S4c"]))
        modes = ["stuck", "drift", "spikes"] + (["flatline_zero"] if signal in ("S2", "S3", "S4a") else [])
        return [Event(kind, t0, t0 + _hours(rng.uniform(4, 10)),
                      {"signal": signal, "mode": str(rng.choice(modes)), "drift": float(rng.choice([-1, 1]) * rng.uniform(0.25, 0.4))})]
    return []


EXCUSES = ("meter_fault", "maintenance", "low_load")


def _doc_plan(kind: EventType, events: list[Event], day2: pd.Timestamp, rng: np.random.Generator,
              photo: bool | None, lab: bool | None, adversarial: bool | None) -> DocPlan:
    plan = DocPlan()
    main = next((e for e in events if e.type is not EventType.REPLAY), None)

    if kind in HARMFUL:
        plan.logbook = "claims_normal"
        lies = rng.random() < 0.6 if adversarial is None else adversarial
        if lies and main and kind is not EventType.DILUTION:
            # a maintenance record that explains part of the event, often written afterwards
            equipment = "ETP feed pump" if kind is EventType.SHUTDOWN else "Aerator 2"
            covered = _hours(rng.uniform(1.0, 2.0))
            written = main.start - pd.Timedelta(days=1) if rng.random() < 0.4 else main.end + _hours(rng.uniform(6, 30))
            plan.maintenance_note = MaintenanceNote(equipment, main.start, main.start + covered, honest=False, written_at=written)
        if lies:
            plan.operator_statement = str(rng.choice(EXCUSES))
            plan.injection = bool(rng.random() < 0.25)
    elif kind is EventType.MAINTENANCE and main:
        plan.maintenance_note = MaintenanceNote("ETP aeration and feed system", main.start, main.end, honest=True,
                                                written_at=main.start - pd.Timedelta(days=int(rng.integers(1, 4))))
        plan.messy = bool(rng.random() < 0.5)
    else:
        plan.messy = bool(rng.random() < 0.4)
        if kind is EventType.SENSOR_FAULT and rng.random() < 0.5:
            plan.operator_statement = "probe_odd"

    # physical evidence: a photo of the power meter, sometimes the inflow meter
    want_photo = rng.random() < 0.5 if photo is None else photo
    if want_photo:
        if main:
            t = main.start + (main.end - main.start) * float(rng.uniform(0.3, 0.8))
        else:
            t = day2 + pd.Timedelta(hours=float(rng.uniform(3, 12)))
        plan.meter_photos.append(("S3", t.round("5min")))
        if rng.random() < 0.3:
            plan.meter_photos.append(("S2", (t + pd.Timedelta(minutes=10)).round("5min")))

    want_lab = rng.random() < 0.35 if lab is None else lab
    if want_lab:
        if main and kind in (EventType.AERATORS_DOWN, EventType.REPLAY):
            t = main.start + _hours(rng.uniform(3, 8))  # effluent quality lags the cut
        elif main and lab:  # asked for explicitly: a grab sample taken during the event
            t = main.start + (main.end - main.start) * float(rng.uniform(0.2, 0.8))
        else:
            t = day2 + pd.Timedelta(hours=float(rng.uniform(4, 10)))
        plan.lab_samples.append(t.round("5min"))
    return plan


def build_scenario(
    kind: EventType | str,
    seed: int,
    cfg: FactoryConfig,
    *,
    start: str | pd.Timestamp = "2026-10-12 06:00",
    days: int = 3,
    missing: tuple[str, ...] = (),
    tank_level_available: bool = True,
    photo: bool | None = None,
    lab: bool | None = None,
    adversarial: bool | None = None,
    case_id: str | None = None,
) -> Scenario:
    """Build a scenario with randomised timing and documents. The event falls
    on day 2.

    `missing` lists signals that recorded nothing around the event (from two
    hours before it starts until six hours after it ends, or across the
    whole of day 2 when nothing happens). `photo`, `lab` and `adversarial`
    force whether a meter photo, a lab sample, or misleading factory
    documents exist; left as None they are drawn at random.
    """
    kind = EventType(kind)
    rng = np.random.default_rng(seed)
    start = pd.Timestamp(start, tz=cfg.timezone) if not isinstance(start, pd.Timestamp) else start
    day2 = start + pd.Timedelta(days=1)

    events = _events(kind, day2, rng)
    docs = _doc_plan(kind, events, day2, rng, photo, lab, adversarial)

    gaps: list[Gap] = []
    if missing:
        if events:
            g0 = min(e.start for e in events) - pd.Timedelta(hours=2)
            g1 = max(e.end for e in events) + pd.Timedelta(hours=6)
        else:
            g0, g1 = day2, day2 + pd.Timedelta(days=1)
        gaps = [Gap(s, g0, g1) for s in missing]

    # opaque: nothing in a case ID may hint at what happened
    digest = hashlib.sha256(f"{cfg.id}|{kind.value}|{seed}|{missing}|{tank_level_available}|{photo}|{lab}|{adversarial}".encode())
    return Scenario(
        id=case_id or f"{cfg.id}-{digest.hexdigest()[:8]}",
        seed=seed,
        kind=kind,
        start=start,
        days=days,
        events=events,
        gaps=gaps,
        tank_level_available=tank_level_available,
        docs=docs,
    )
