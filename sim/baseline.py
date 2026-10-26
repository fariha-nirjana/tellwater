"""A factory's normal-operation baseline: the learning period a real site
would record before verification starts."""

from __future__ import annotations

from functools import lru_cache

from core.physics import PowerModel, fit_power_model
from sim.config import load_factory
from sim.generator import generate
from sim.scenarios import EventType, build_scenario

BASELINE_DAYS = 14
BASELINE_SEED = 1_000_003


@lru_cache(maxsize=8)
def power_model(factory: str = "factory") -> PowerModel:
    cfg = load_factory(factory)
    scenario = build_scenario(
        EventType.NORMAL, BASELINE_SEED, cfg, start="2026-09-01 06:00", days=BASELINE_DAYS,
        case_id=f"{cfg.id}-baseline",
    )
    return fit_power_model(generate(scenario, cfg).signals, cfg)
