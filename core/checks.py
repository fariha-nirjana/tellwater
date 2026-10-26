"""Deterministic checks that flag suspicious windows. They report what the
numbers show and never decide a cause."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from core.physics import PowerModel
from sim.config import FactoryConfig
from sim.scenarios import CORE_SIGNALS


@dataclass
class Alert:
    check: str
    start: pd.Timestamp
    end: pd.Timestamp
    signals: tuple[str, ...]
    summary: str
    metrics: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.check}:{self.start:%m%d-%H%M}"


def _runs(mask: pd.Series, min_steps: int) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Contiguous stretches where mask holds for at least min_steps readings."""
    mask = mask.fillna(False).astype(bool)
    if not mask.any():
        return []
    step = mask.index[1] - mask.index[0]
    group = (mask != mask.shift()).cumsum()
    runs = []
    for _, block in mask[mask].groupby(group[mask]):
        if len(block) >= min_steps:
            runs.append((block.index[0], block.index[-1] + step))
    return runs


def outfall_exceeds_treated(signals: pd.DataFrame, cfg: FactoryConfig) -> list[Alert]:
    w = cfg.water
    treated = signals["S2"] * (1 - w.sludge_water_fraction) * (1 - w.reuse_fraction)
    excess = (signals["S4a"] - treated).rolling("1h").mean()
    mask = excess > (0.15 * treated.rolling("1h").mean()).clip(lower=6.0)
    alerts = []
    for start, end in _runs(mask, 12):
        sel = (signals.index >= start) & (signals.index < end)
        volume = float((signals["S4a"] - treated)[sel].sum() * cfg.dt_h)
        alerts.append(Alert("outfall_exceeds_treated", start, end, ("S2", "S4a"),
                            "Outfall flow exceeds treated flow from the ETP",
                            {"excess_m3": round(volume, 1)}))
    return alerts


def outfall_ph_out_of_range(signals: pd.DataFrame, cfg: FactoryConfig) -> list[Alert]:
    lim = cfg.discharge_limits
    ph = signals["S4b"]
    alerts = []
    for start, end in _runs((ph > lim.ph_max) | (ph < lim.ph_min), 6):
        sel = (ph.index >= start) & (ph.index < end)
        alerts.append(Alert("outfall_ph_out_of_range", start, end, ("S4b",),
                            "Outfall pH outside the discharge range",
                            {"max_ph": round(float(ph[sel].max()), 2), "min_ph": round(float(ph[sel].min()), 2)}))
    return alerts


def etp_power_off(signals: pd.DataFrame, cfg: FactoryConfig) -> list[Alert]:
    return [Alert("etp_power_off", s, e, ("S3",), "ETP power at standby level")
            for s, e in _runs(signals["S3"] < 2 * cfg.power.standby_kw, 6)]


def power_below_load(signals: pd.DataFrame, cfg: FactoryConfig, model: PowerModel) -> list[Alert]:
    expected = model.expected(signals["S2"], cfg.dt_h)
    band = model.band_sd * model.residual_sd_kw
    mask = (signals["S3"] < expected - band) & (signals["S2"] > 2.0)
    alerts = []
    for start, end in _runs(mask, 12):
        sel = (signals.index >= start) & (signals.index < end)
        alerts.append(Alert("power_below_load", start, end, ("S2", "S3"),
                            "ETP power below the band expected for its inflow",
                            {"observed_mean_kw": round(float(signals["S3"][sel].mean()), 1),
                             "expected_mean_kw": round(float(expected[sel].mean()), 1)}))
    return alerts


def tank_high(signals: pd.DataFrame, cfg: FactoryConfig) -> list[Alert]:
    level = signals["T1"].dropna()
    if level.empty:
        return []
    return [Alert("tank_high", s, e, ("T1",), "Equalization tank at or near full")
            for s, e in _runs(level >= 0.95, 2)]


def signal_gaps(signals: pd.DataFrame, cfg: FactoryConfig) -> list[Alert]:
    alerts = []
    for sig in CORE_SIGNALS:
        for start, end in _runs(signals[sig].isna(), 6):
            alerts.append(Alert("signal_gap", start, end, (sig,), f"No readings from {sig}"))
    level = signals["T1"]
    grid = level[level.index.minute % cfg.sensors.tank_level_resolution_minutes == 0]
    for start, end in _runs(grid.isna(), 2):
        alerts.append(Alert("signal_gap", start, end, ("T1",), "No readings from T1"))
    return alerts


def run_checks(signals: pd.DataFrame, cfg: FactoryConfig, model: PowerModel) -> list[Alert]:
    alerts = (
        outfall_exceeds_treated(signals, cfg)
        + outfall_ph_out_of_range(signals, cfg)
        + etp_power_off(signals, cfg)
        + power_below_load(signals, cfg, model)
        + tank_high(signals, cfg)
        + signal_gaps(signals, cfg)
    )
    return sorted(alerts, key=lambda a: a.start)
