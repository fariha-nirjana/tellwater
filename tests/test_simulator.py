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


def window_of(c, kind):
    from sim.scenarios import EventType

    ev = c.scenario.event(EventType(kind))
    return (c.truth.index >= ev.start) & (c.truth.index < ev.end)


def test_aeration_cut_lowers_power_and_raises_effluent_bod_with_a_lag():
    c = case("aerators_down")
    sel = window_of(c, "aerators_down")
    before = c.truth.iloc[: CFG.steps_per_day]
    assert c.truth.loc[sel, "S3"].mean() < 0.8 * before["S3"].mean()
    assert c.truth["effluent_bod"].max() > 3 * CFG.discharge_limits.bod_mg_l
    assert c.truth.loc[sel, "S2"].mean() == pytest.approx(before["S2"].mean(), rel=0.25)


def test_replayed_feed_copies_the_previous_day_while_the_photo_shows_reality():
    c = case("replay", photo=True)
    sel = window_of(c, "replay")
    shifted = c.signals["S3"].shift(CFG.steps_per_day)
    assert np.allclose(c.signals.loc[sel, "S3"], shifted[sel])
    photo = next(d for d in c.documents if d.type == "meter_photo" and d.content["signal"] == "S3")
    t = pd.Timestamp(photo.meta["taken_at"])
    assert photo.content["value"] == pytest.approx(c.truth.loc[t, "S3"], rel=0.05)
    assert abs(photo.content["value"] - c.signals.loc[t, "S3"]) > 10


def test_dilution_drops_conductivity_but_not_ph():
    c = case("dilution")
    sel = window_of(c, "dilution")
    day1 = c.truth.iloc[: CFG.steps_per_day]
    assert c.truth.loc[sel, "S4c"].mean() < 0.9 * day1["S4c"].mean()
    assert c.truth.loc[sel, "S4b"].max() < CFG.discharge_limits.ph_max
    assert c.truth["untreated"].sum() == 0


def test_factory_claims_are_marked_and_misleading_ones_flagged():
    honest = case("maintenance")
    liar = case("aerators_down", adversarial=True)
    assert all(d.truthful for d in honest.documents)
    claims = [d for d in liar.documents if d.is_claim]
    assert claims and not any(d.truthful for d in claims)
    assert all(d.truthful for d in liar.documents if not d.is_claim)
