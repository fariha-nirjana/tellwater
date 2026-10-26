"""Condition C1: conventional monitoring rules on structured signals only.

Over a batch's treatment interval:
  1. a discharge alert (outfall exceeds treated flow, outfall pH out of range)
     -> "contradicts"
  2. any of S2, S3, S4a, S4b under 80% coverage -> "insufficient"
  3. an operating alert (power off, power below load, tank near full)
     -> "review_required"
  4. otherwise -> "supports"

No documents, no reasoning about which explanation fits. This is the
baseline the investigator has to beat.
"""

from __future__ import annotations

from core.checks import Alert, run_checks
from core.physics import MIN_COVERAGE, PowerModel, coverage, treatment_interval
from sim.config import FactoryConfig
from sim.generator import Batch, Case

DISCHARGE = {"outfall_exceeds_treated", "outfall_ph_out_of_range"}
OPERATING = {"etp_power_off", "power_below_load", "tank_high"}
REQUIRED = ("S2", "S3", "S4a", "S4b")


def assess(case: Case, batch: Batch, cfg: FactoryConfig, model: PowerModel) -> dict:
    start, end = treatment_interval(batch.start, batch.end, cfg)
    alerts: list[Alert] = [a for a in run_checks(case.signals, cfg, model) if a.start < end and a.end > start]
    checks = {a.check for a in alerts}
    low_coverage = [s for s in REQUIRED if coverage(case.signals, s, start, end) < MIN_COVERAGE]

    if checks & DISCHARGE:
        status = "contradicts"
    elif low_coverage:
        status = "insufficient"
    elif checks & OPERATING:
        status = "review_required"
    else:
        status = "supports"
    return {"status": status, "alerts": [a.id for a in alerts], "low_coverage": low_coverage}
