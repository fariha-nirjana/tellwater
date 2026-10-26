"""Scenario definitions: what happens at the factory, and which evidence survives.

A scenario holds the underlying events (ground truth) and the evidence
conditions (gaps, unavailable signals). The generator turns it into signals;
the oracle turns it into the assessment the available evidence justifies.
"""

from __future__ import annotations

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
class Scenario:
    id: str
    seed: int
    start: pd.Timestamp
    days: int
    events: list[Event] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    tank_level_available: bool = True

    @property
    def kind(self) -> EventType:
        return self.events[0].type if self.events else EventType.NORMAL


def _at(day_start: pd.Timestamp, hours: float) -> pd.Timestamp:
    """A time on the case's event day, rounded to a 5 minute step."""
    return (day_start + pd.Timedelta(hours=hours)).round("5min")


def build_scenario(
    kind: EventType | str,
    seed: int,
    cfg: FactoryConfig,
    *,
    start: str | pd.Timestamp = "2026-10-12 06:00",
    days: int = 3,
    missing: tuple[str, ...] = (),
    tank_level_available: bool = True,
    case_id: str | None = None,
) -> Scenario:
    """Build a scenario with randomised timing. The event falls on day 2.

    `missing` lists signals that recorded nothing around the event (from two
    hours before it starts until six hours after it ends, or across the
    whole of day 2 for a normal case).
    """
    kind = EventType(kind)
    rng = np.random.default_rng(seed)
    start = pd.Timestamp(start, tz=cfg.timezone) if not isinstance(start, pd.Timestamp) else start
    day2 = start + pd.Timedelta(days=1)

    events: list[Event] = []
    if kind is EventType.SHUTDOWN:
        t0 = _at(day2, rng.uniform(5, 9))
        events.append(Event(kind, t0, t0 + pd.Timedelta(hours=rng.uniform(8, 12)).round("5min")))
    elif kind is EventType.BYPASS:
        t0 = _at(day2, rng.uniform(4, 10))
        events.append(
            Event(
                kind,
                t0,
                t0 + pd.Timedelta(hours=rng.uniform(6, 10)).round("5min"),
                {"bypass_fraction": float(rng.uniform(0.5, 0.8))},
            )
        )
    elif kind is EventType.MAINTENANCE:
        t0 = _at(day2, rng.uniform(4, 9))
        events.append(
            Event(kind, t0, t0 + pd.Timedelta(hours=rng.uniform(2, 4)).round("5min"), {"documented": True})
        )
    elif kind is EventType.LOW_PRODUCTION:
        events.append(
            Event(kind, day2, day2 + pd.Timedelta(days=1), {"production_multiplier": float(rng.uniform(0.35, 0.5))})
        )

    gaps: list[Gap] = []
    if missing:
        if events:
            g0 = events[0].start - pd.Timedelta(hours=2)
            g1 = events[0].end + pd.Timedelta(hours=6)
        else:
            g0, g1 = day2, day2 + pd.Timedelta(days=1)
        gaps = [Gap(s, g0, g1) for s in missing]

    return Scenario(
        id=case_id or f"{cfg.id}-{kind.value}-{seed}",
        seed=seed,
        start=start,
        days=days,
        events=events,
        gaps=gaps,
        tank_level_available=tank_level_available,
    )
