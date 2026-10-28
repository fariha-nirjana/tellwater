"""Physical calculations over recorded signals. Code does the arithmetic here;
nothing in this module interprets what a result means.

Two water balances, kept separate on purpose:

- ETP balance: treated flow reaching the outfall should equal ETP inflow less
  sludge water and reuse. The treatment train holds constant volume, so this
  holds at the same timestamp. Extra outfall flow means water reached the
  outfall without passing through treatment (bypass, overflow, dilution).
- Factory boundary balance: intake = outfall + process losses + sludge water
  + change in equalization tank storage. Reuse is a loop inside the boundary
  and cancels out. A remainder means an unmetered route in or out.

Treatment timing is a different question from flow balance: a batch's
wastewater reaches the outfall over a range of residence times, so its
treatment interval is the production window shifted by that range.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from sim.config import FactoryConfig

SIGNAL_RESOLUTION_MIN = {"T1": 15}
MIN_COVERAGE = 0.8  # below this, a quantity over the window is not computed

# assumed: combined meter and model uncertainty for the balances
ETP_BALANCE_TOLERANCE = 0.08
BOUNDARY_BALANCE_TOLERANCE = 0.08
TANK_BALANCE_TOLERANCE = 0.10  # assumed: production losses vary more than meters
# assumed: without tank level, storage could have moved this share of tank volume
UNKNOWN_STORAGE_SHARE = 0.6


def window(signals: pd.DataFrame, start, end) -> pd.DataFrame:
    return signals.loc[(signals.index >= start) & (signals.index < end)]


def coverage(signals: pd.DataFrame, signal: str, start, end) -> float:
    """Share of expected readings in [start, end) that were recorded."""
    w = window(signals, start, end)
    if w.empty:
        return 0.0
    res = SIGNAL_RESOLUTION_MIN.get(signal)
    if res:
        w = w[w.index.minute % res == 0]
    return float(w[signal].notna().mean()) if len(w) else 0.0


def treatment_interval(batch_start: pd.Timestamp, batch_end: pd.Timestamp, cfg: FactoryConfig):
    """When a batch's wastewater could have been passing through treatment."""
    return (
        batch_start + pd.Timedelta(hours=cfg.etp.residence_min_h),
        batch_end + pd.Timedelta(hours=cfg.etp.residence_max_h),
    )


def _volume(w: pd.DataFrame, signal: str, dt_h: float) -> float:
    """m3 over the window, filling unrecorded steps with the window mean."""
    return float(w[signal].mean() * len(w) * dt_h)


def water_balance(signals: pd.DataFrame, start, end, cfg: FactoryConfig) -> dict:
    w = window(signals, start, end)
    dt = cfg.dt_h
    hours = len(w) * dt
    cov = {s: round(coverage(signals, s, start, end), 3) for s in ("S1", "S2", "S4a", "T1")}
    ok = {s: cov[s] >= MIN_COVERAGE for s in cov}
    sludge, reuse_share, loss = cfg.water.sludge_water_fraction, cfg.water.reuse_fraction, cfg.water.process_loss_fraction
    result: dict = {"start": str(start), "end": str(end), "hours": round(hours, 2), "coverage": cov}

    if ok["S2"] and ok["S4a"]:
        inflow = _volume(w, "S2", dt)
        treated_to_outfall = inflow * (1 - sludge) * (1 - reuse_share)
        outfall = _volume(w, "S4a", dt)
        residual = outfall - treated_to_outfall
        tolerance = ETP_BALANCE_TOLERANCE * max(treated_to_outfall, outfall, 1.0)
        result["etp"] = {
            "etp_inflow_m3": round(inflow, 1),
            "treated_to_outfall_m3": round(treated_to_outfall, 1),
            "outfall_m3": round(outfall, 1),
            "residual_m3": round(residual, 1),
            "tolerance_m3": round(tolerance, 1),
            "within_tolerance": bool(abs(residual) <= tolerance),
        }
    else:
        result["etp"] = None

    if ok["S1"] and ok["S2"] and ok["S4a"]:
        intake = _volume(w, "S1", dt)
        inflow = _volume(w, "S2", dt)
        outfall = _volume(w, "S4a", dt)
        reuse = inflow * (1 - sludge) * reuse_share
        losses = loss * (intake + reuse)
        sludge_water = sludge * inflow
        tolerance = BOUNDARY_BALANCE_TOLERANCE * max(intake, 1.0)
        storage = None
        if ok["T1"]:
            level = w["T1"].dropna()
            storage = float((level.iloc[-1] - level.iloc[0]) * cfg.etp.equalization.volume_m3)
            residual = intake - outfall - losses - sludge_water - storage
        else:
            residual = intake - outfall - losses - sludge_water
            tolerance += UNKNOWN_STORAGE_SHARE * cfg.etp.equalization.volume_m3
        result["boundary"] = {
            "intake_m3": round(intake, 1),
            "outfall_m3": round(outfall, 1),
            "process_losses_m3": round(losses, 1),
            "sludge_water_m3": round(sludge_water, 1),
            "storage_change_m3": None if storage is None else round(storage, 1),
            "residual_m3": round(residual, 1),
            "tolerance_m3": round(tolerance, 1),
            "within_tolerance": bool(abs(residual) <= tolerance),
        }
    else:
        result["boundary"] = None

    # Equalization tank: what intake says reached the tank vs what the ETP took and the tank kept.
    # Water missing from this balance left the tank by a route other than the ETP inflow meter.
    if ok["S1"] and ok["S2"] and ok["T1"]:
        intake = _volume(w, "S1", dt)
        inflow = _volume(w, "S2", dt)
        reuse = inflow * (1 - sludge) * reuse_share
        arriving = (intake + reuse) * (1 - loss)
        level = w["T1"].dropna()
        storage = float((level.iloc[-1] - level.iloc[0]) * cfg.etp.equalization.volume_m3)
        residual = arriving - inflow - storage
        tolerance = TANK_BALANCE_TOLERANCE * max(arriving, 1.0)
        result["tank"] = {
            "wastewater_arriving_m3": round(arriving, 1),
            "etp_inflow_m3": round(inflow, 1),
            "storage_change_m3": round(storage, 1),
            "unaccounted_m3": round(residual, 1),
            "tolerance_m3": round(tolerance, 1),
            "within_tolerance": bool(abs(residual) <= tolerance),
        }
    else:
        result["tank"] = None
    return result


@dataclass
class PowerModel:
    """Expected ETP power from recent inflow, fitted on normal operation."""

    intercept_kw: float
    kw_per_m3_h: float
    residual_sd_kw: float
    response_h: float
    standby_kw: float
    band_sd: float = 2.5

    def smoothed_inflow(self, s2: pd.Series, dt_h: float) -> pd.Series:
        alpha = dt_h / (self.response_h + dt_h)
        return s2.ewm(alpha=alpha, adjust=False, ignore_na=True).mean()

    def expected(self, s2: pd.Series, dt_h: float) -> pd.Series:
        q = self.smoothed_inflow(s2, dt_h)
        running = self.intercept_kw + self.kw_per_m3_h * q
        return running.where(s2 > 2.0, self.standby_kw)


def fit_power_model(signals: pd.DataFrame, cfg: FactoryConfig) -> PowerModel:
    """Least squares fit of power against smoothed inflow on a normal baseline."""
    response = cfg.power.aeration_response_h
    probe = PowerModel(0, 0, 0, response, cfg.power.standby_kw)
    d = pd.DataFrame({"q": probe.smoothed_inflow(signals["S2"], cfg.dt_h), "kw": signals["S3"]}).dropna()
    d = d[d.q > 2.0]
    slope, intercept = np.polyfit(d.q, d.kw, 1)
    resid = d.kw - (intercept + slope * d.q)
    return PowerModel(float(intercept), float(slope), float(resid.std()), response, cfg.power.standby_kw)


def power_vs_load(signals: pd.DataFrame, start, end, model: PowerModel, cfg: FactoryConfig) -> dict | None:
    """Observed ETP power against the band expected from ETP inflow."""
    if coverage(signals, "S2", start, end) < MIN_COVERAGE or coverage(signals, "S3", start, end) < MIN_COVERAGE:
        return None
    # warm the smoothing up on the hours before the window
    warm = window(signals, pd.Timestamp(start) - pd.Timedelta(hours=4 * model.response_h), end)
    expected = window(model.expected(warm["S2"], cfg.dt_h).to_frame("kw"), start, end)["kw"]
    observed = window(signals, start, end)["S3"]
    half_band = model.band_sd * model.residual_sd_kw
    below = (observed < expected - half_band) & observed.notna()
    above = (observed > expected + half_band) & observed.notna()
    return {
        "start": str(start),
        "end": str(end),
        "observed_mean_kw": round(float(observed.mean()), 1),
        "expected_mean_kw": round(float(expected.mean()), 1),
        "band_half_width_kw": round(half_band, 1),
        "share_below_band": round(float(below.mean()), 3),
        "share_above_band": round(float(above.mean()), 3),
    }
