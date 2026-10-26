import numpy as np
import pandas as pd
import pytest

from core.physics import coverage, treatment_interval, water_balance
from sim.config import load_factory
from sim.generator import generate
from sim.scenarios import build_scenario

CFG = load_factory()


def case(kind, seed=5, **kw):
    return generate(build_scenario(kind, seed, CFG, **kw), CFG)


def event_window(c, after_h=2):
    ev = c.scenario.events[0]
    return ev.start, ev.end + pd.Timedelta(hours=after_h)


def test_same_seed_same_case():
    a, b = case("bypass"), case("bypass")
    pd.testing.assert_frame_equal(a.signals, b.signals)


def test_shift_profile_averages_to_daily_volume():
    hours = range(24)
    assert np.mean([CFG.production.shift_multiplier(h) for h in hours]) == pytest.approx(1.0)


def test_normal_operation_balances_close():
    c = case("normal")
    start = c.scenario.start + pd.Timedelta(days=1)
    wb = water_balance(c.signals, start, start + pd.Timedelta(hours=24), CFG)
    assert wb["etp"]["within_tolerance"]
    assert wb["boundary"]["within_tolerance"]
    assert c.truth["untreated"].sum() == 0


def test_true_boundary_balance_is_exact():
    """On noise-free values the boundary balance closes to rounding error,
    including when the ETP is off and the tank overflows."""
    c = case("shutdown")
    t = c.truth
    dt = CFG.dt_h
    demand = t["wastewater"] / (1 - CFG.water.process_loss_fraction)
    losses = demand - t["wastewater"]
    sludge = t["S2"] * CFG.water.sludge_water_fraction
    storage = (t["T1"].iloc[-1] - CFG.etp.equalization.setpoint_fraction) * CFG.etp.equalization.volume_m3
    residual = (t["S1"] - t["S4a"] - losses - sludge).sum() * dt - storage
    assert abs(residual) < 1.0


def test_shutdown_overflows_untreated_with_raw_ph():
    c = case("shutdown")
    assert c.truth["overflow"].sum() > 0
    assert c.truth["T1"].max() == pytest.approx(1.0)
    assert c.truth["S4b"].max() > CFG.discharge_limits.ph_max


def test_etp_balance_measures_bypassed_volume():
    c = case("bypass")
    start, end = event_window(c)
    wb = water_balance(c.signals, start, end, CFG)
    true_untreated = c.truth["untreated"].sum() * CFG.dt_h
    assert not wb["etp"]["within_tolerance"]
    assert wb["etp"]["residual_m3"] == pytest.approx(true_untreated, rel=0.1)


def test_maintenance_is_absorbed_by_the_tank():
    c = case("maintenance")
    assert c.truth["untreated"].sum() == 0
    assert c.truth["T1"].max() < 1.0
    assert c.truth["S3"].min() == pytest.approx(CFG.power.standby_kw)


def test_low_production_lowers_flow_and_power_proportionately():
    c = case("low_production")
    day1 = c.truth.iloc[: CFG.steps_per_day]
    day2 = c.truth.iloc[CFG.steps_per_day : 2 * CFG.steps_per_day]
    assert day2["wastewater"].mean() < 0.6 * day1["wastewater"].mean()
    assert day2["S3"].mean() < day1["S3"].mean()
    assert c.truth["untreated"].sum() == 0


def test_gaps_and_tank_resolution_count_toward_coverage():
    c = case("bypass", missing=("S4a",))
    start, end = event_window(c)
    assert coverage(c.signals, "S4a", start, end) == 0.0
    assert coverage(c.signals, "T1", start, end) == 1.0
    no_tank = case("bypass", tank_level_available=False)
    assert coverage(no_tank.signals, "T1", start, end) == 0.0


def test_treatment_interval_is_production_window_shifted_by_residence():
    s = pd.Timestamp("2026-10-13 06:00", tz=CFG.timezone)
    e = s + pd.Timedelta(hours=4)
    ti = treatment_interval(s, e, CFG)
    assert ti == (s + pd.Timedelta(hours=CFG.etp.residence_min_h), e + pd.Timedelta(hours=CFG.etp.residence_max_h))
