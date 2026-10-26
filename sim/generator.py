"""Turn a scenario into physically consistent signals.

The model, per 5 minute step:

- Production generates wastewater P (shift pattern, batch shade, noise).
- Process water demand is P / (1 - losses). Reused treated water covers part
  of it; groundwater intake (S1) covers the rest. Reuse is a loop inside the
  factory boundary, so it lowers intake rather than counting as water in.
- Wastewater collects in the equalization tank. The ETP inflow pump (S2)
  works the level back toward its setpoint, capped at pump capacity. When the
  tank is full, it overflows untreated to the outfall drain.
- The aeration basin and clarifier hold constant volume, so treated flow
  equals inflow minus sludge water at once, while dissolved salt and organic
  load move through them with a lag (mixed-tank mass balances).
- A share of treated water is reused; the rest reaches the outfall (S4a),
  together with any bypassed or overflowing untreated water.
- Outfall pH (S4b) mixes hydroxide from each stream; conductivity (S4c) mixes
  linearly. Biological treatment removes little salt, so conductivity tracks
  the source water, not treatment.
- ETP power (S3) is base load plus pumping plus aeration, which follows the
  organic load entering the basin with a response lag.

Measured signals add sensor noise and the scenario's gaps.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from sim.config import FactoryConfig
from sim.scenarios import EventType, Scenario

TREATED_BOD_MG_L = 18.0  # assumed effluent BOD of a working biological ETP
STAGNANT_FLOW_M3_H = 0.5  # below this the outfall probe sits in standing water


@dataclass
class Batch:
    id: str
    start: pd.Timestamp
    end: pd.Timestamp
    shade: str
    planned_wastewater_m3: float


@dataclass
class Case:
    scenario: Scenario
    factory_id: str
    truth: pd.DataFrame  # true physical values plus hidden state
    signals: pd.DataFrame  # what the meters recorded
    batches: list[Batch]


def _shift_multipliers(index: pd.DatetimeIndex, cfg: FactoryConfig) -> np.ndarray:
    return np.array([cfg.production.shift_multiplier(h) for h in index.hour])


def _ar1(rng: np.random.Generator, n: int, sd: float, phi: float = 0.9) -> np.ndarray:
    """Autocorrelated noise with stationary standard deviation `sd`."""
    out = np.empty(n)
    out[0] = rng.normal(0, sd)
    innovation = sd * np.sqrt(1 - phi**2)
    for i in range(1, n):
        out[i] = phi * out[i - 1] + rng.normal(0, innovation)
    return out


def _batches(scenario: Scenario, index: pd.DatetimeIndex, cfg: FactoryConfig, rng: np.random.Generator):
    """Consecutive production batches, and the shade active at each step."""
    shades = list(cfg.production.shades)
    probs = np.array([cfg.production.shades[s].probability for s in shades])
    probs = probs / probs.sum()
    length = pd.Timedelta(hours=cfg.production.batch_hours)
    steps = int(length / pd.Timedelta(minutes=cfg.timestep_minutes))

    batches: list[Batch] = []
    shade_at = np.empty(len(index), dtype=object)
    raw_ph_at = np.empty(len(index))
    for k, i0 in enumerate(range(0, len(index), steps)):
        shade = str(rng.choice(shades, p=probs))
        i1 = min(i0 + steps, len(index))
        shade_at[i0:i1] = shade
        raw_ph_at[i0:i1] = rng.normal(cfg.production.raw_ph.mean, cfg.production.raw_ph.sd)
        batches.append(Batch(f"{scenario.id}-B{k:02d}", index[i0], index[i0] + length, shade, 0.0))
    return batches, shade_at, raw_ph_at


def generate(scenario: Scenario, cfg: FactoryConfig) -> Case:
    rng = np.random.default_rng(scenario.seed)
    n = scenario.days * cfg.steps_per_day
    index = pd.date_range(scenario.start, periods=n, freq=f"{cfg.timestep_minutes}min")
    dt = cfg.dt_h
    prod, water, etp, power = cfg.production, cfg.water, cfg.etp, cfg.power

    # --- event masks
    etp_off = np.zeros(n, dtype=bool)
    bypass_fraction = np.zeros(n)
    production_multiplier = np.ones(n)
    for ev in scenario.events:
        mask = ev.active(index)
        if ev.type in (EventType.SHUTDOWN, EventType.MAINTENANCE):
            etp_off |= mask
        elif ev.type is EventType.BYPASS:
            bypass_fraction[mask] = ev.params["bypass_fraction"]
        elif ev.type is EventType.LOW_PRODUCTION:
            production_multiplier[mask] = ev.params["production_multiplier"]

    # --- production and raw wastewater quality
    batches, shade_at, raw_ph = _batches(scenario, index, cfg, rng)
    volume_factor = np.array([prod.shades[s].volume_factor for s in shade_at])
    raw_bod = np.array([prod.shades[s].bod_mg_l for s in shade_at]) * (1 + rng.normal(0, 0.05, n))
    raw_cond = np.array([prod.shades[s].conductivity_us_cm for s in shade_at]) * (1 + rng.normal(0, 0.03, n))
    raw_oh = 10.0 ** (raw_ph + rng.normal(0, 0.05, n) - 14)
    wastewater = (
        prod.mean_rate_m3_h
        * _shift_multipliers(index, cfg)
        * volume_factor
        * production_multiplier
        * (1 + _ar1(rng, n, prod.noise_rel))
    ).clip(min=0)
    treated_ph = etp.treated_ph.mean + _ar1(rng, n, etp.treated_ph.sd, phi=0.98)

    step_m3 = wastewater * dt
    for b in batches:
        sel = (index >= b.start) & (index < b.end)
        b.planned_wastewater_m3 = round(float(step_m3[sel].sum()), 1)

    # --- state
    eq_volume = etp.equalization.volume_m3
    v_set = etp.equalization.setpoint_fraction * eq_volume
    v = v_set
    medium = prod.shades.get("medium") or next(iter(prod.shades.values()))
    eq_cond, eq_bod, eq_oh = medium.conductivity_us_cm, medium.bod_mg_l, 10.0 ** (prod.raw_ph.mean - 14)
    basin_cond = clar_cond = eq_cond
    aeration_load = prod.mean_rate_m3_h * eq_bod / 1000
    last_ph, last_cond = etp.treated_ph.mean, eq_cond * (1 - etp.conductivity_removal_fraction)

    cols = {
        k: np.zeros(n)
        for k in (
            "wastewater", "S1", "S2", "S3", "S4a", "S4b", "S4c", "T1",
            "bypass", "overflow", "untreated", "reuse", "eq_bod", "effluent_bod",
        )
    }
    cols["etp_on"] = ~etp_off

    for i in range(n):
        p = wastewater[i]
        if etp_off[i]:
            s2 = bypass = 0.0
        else:
            desired = np.clip(prod.mean_rate_m3_h + (v - v_set) / etp.equalization.control_time_constant_h,
                              0, etp.pump_max_m3_h)
            s2 = desired * (1 - bypass_fraction[i])
            bypass = desired * bypass_fraction[i]
        available = v / dt + p  # cannot pump more than the tank holds
        if s2 + bypass > available:
            scale = available / (s2 + bypass)
            s2, bypass = s2 * scale, bypass * scale

        v_new = v + (p - s2 - bypass) * dt
        overflow = 0.0
        if v_new > eq_volume:
            overflow = (v_new - eq_volume) / dt
            v_new = eq_volume

        # equalization tank: mixed-tank mass balance for salt, organics, hydroxide
        out = s2 + bypass + overflow
        if v_new > 1e-6:
            eq_cond = (eq_cond * v + raw_cond[i] * p * dt - eq_cond * out * dt) / v_new
            eq_bod = (eq_bod * v + raw_bod[i] * p * dt - eq_bod * out * dt) / v_new
            eq_oh = (eq_oh * v + raw_oh[i] * p * dt - eq_oh * out * dt) / v_new
        v = v_new

        # aeration basin and clarifier: constant volume, so flow passes at once
        basin_cond += s2 * dt / etp.aeration_basin_volume_m3 * (eq_cond - basin_cond)
        clar_cond += s2 * dt / etp.clarifier_volume_m3 * (basin_cond - clar_cond)
        treated = s2 * (1 - water.sludge_water_fraction)
        reuse = water.reuse_fraction * treated
        treated_out = treated - reuse
        untreated = bypass + overflow
        s4a = treated_out + untreated

        if s4a > STAGNANT_FLOW_M3_H:
            oh_treated = 10.0 ** (treated_ph[i] - 14)
            oh_mix = (treated_out * oh_treated + untreated * eq_oh) / s4a
            last_ph = 14 + np.log10(oh_mix)
            cond_treated = clar_cond * (1 - etp.conductivity_removal_fraction)
            last_cond = (treated_out * cond_treated + untreated * eq_cond) / s4a
            effluent_bod = (treated_out * TREATED_BOD_MG_L + untreated * eq_bod) / s4a
        else:
            effluent_bod = np.nan

        load_in = s2 * eq_bod / 1000  # kg BOD per hour entering the basin
        aeration_load += dt / power.aeration_response_h * (load_in - aeration_load)
        if etp_off[i]:
            kw = power.standby_kw
        else:
            kw = power.base_kw + power.pump_kw_per_m3_h * s2 + power.aeration_kw_per_kg_bod_h * aeration_load

        row = cols
        row["wastewater"][i] = p
        row["S1"][i] = p / (1 - water.process_loss_fraction) - reuse
        row["S2"][i] = s2
        row["S3"][i] = kw
        row["S4a"][i] = s4a
        row["S4b"][i] = last_ph
        row["S4c"][i] = last_cond
        row["T1"][i] = v / eq_volume
        row["bypass"][i] = bypass
        row["overflow"][i] = overflow
        row["untreated"][i] = untreated
        row["reuse"][i] = reuse
        row["eq_bod"][i] = eq_bod
        row["effluent_bod"][i] = effluent_bod

    truth = pd.DataFrame(cols, index=index)
    truth["shade"] = shade_at
    signals = _measure(truth, scenario, cfg, rng)
    return Case(scenario, cfg.id, truth, signals, batches)


def _measure(truth: pd.DataFrame, scenario: Scenario, cfg: FactoryConfig, rng: np.random.Generator) -> pd.DataFrame:
    s = cfg.sensors
    n = len(truth)
    m = pd.DataFrame(index=truth.index)
    for sig in ("S1", "S2", "S4a"):
        m[sig] = (truth[sig] * (1 + rng.normal(0, s.flow_noise_rel, n))).clip(lower=0)
    m["S3"] = (truth["S3"] * (1 + rng.normal(0, s.power_noise_rel, n))).clip(lower=0)
    m["S4b"] = truth["S4b"] + rng.normal(0, s.ph_noise_abs, n)
    m["S4c"] = truth["S4c"] * (1 + rng.normal(0, s.conductivity_noise_rel, n))

    level = (truth["T1"] + rng.normal(0, s.tank_level_noise_abs, n)).clip(0, 1)
    on_grid = (truth.index.minute % s.tank_level_resolution_minutes) == 0
    m["T1"] = level.where(on_grid & scenario.tank_level_available)

    for gap in scenario.gaps:
        m.loc[(m.index >= gap.start) & (m.index < gap.end), gap.signal] = np.nan
    return m
