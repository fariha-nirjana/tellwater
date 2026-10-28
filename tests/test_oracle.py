import pytest

from eval import c1_rules
from sim.baseline import power_model
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import COMBOS, label
from sim.scenarios import build_scenario

CFG = load_factory()


def labelled(kind, seed, missing=(), tank=True, **kw):
    c = generate(build_scenario(kind, seed, CFG, missing=missing, tank_level_available=tank, **kw), CFG)
    return c, label(c, CFG)


@pytest.mark.parametrize(
    "kind, missing, tank, docs, underlying, justified, requested",
    [
        ("normal", (), True, {}, "normal", "supports", None),
        ("normal", ("S3",), True, {}, "normal", "insufficient", ["S3"]),
        ("low_production", (), True, {}, "low_production", "supports", None),
        ("shutdown", (), True, {}, "shutdown", "contradicts", None),
        # outfall blind, no tank log, no lab sample: the shutdown happened but cannot be shown
        ("shutdown", ("S4a", "S4b"), False, {"lab": False}, "shutdown", "insufficient", ["S4a"]),
        # outfall blind, but the tank balance and power still show water leaving another way
        ("bypass", ("S4a", "S4b"), True, {"lab": False}, "bypass", "contradicts", None),
        # ETP inflow and outfall flow lost, but power and pH still tell it
        ("shutdown", ("S2", "S4a"), True, {}, "shutdown", "contradicts", None),
        ("bypass", (), True, {}, "bypass", "contradicts", None),
        ("bypass", ("S4a", "S4b"), False, {"lab": False}, "bypass", "insufficient", ["S4a"]),
        # outfall blind and no tank log, but a lab sample caught raw effluent
        ("bypass", ("S4a", "S4b"), False, {"lab": True}, "bypass", "contradicts", None),
        ("maintenance", (), True, {}, "maintenance", "supports", None),
        # without tank level, nothing shows the stored water was treated later
        ("maintenance", (), False, {}, "maintenance", "insufficient", ["T1"]),
        # power below load is confirmed by a meter photo the feed cannot fake
        ("aerators_down", (), True, {"photo": True, "lab": False}, "aerators_down", "contradicts", None),
        # power below load alone could be a power meter fault
        ("aerators_down", (), True, {"photo": False, "lab": False}, "aerators_down", "review_required", ["photo:S3"]),
        # the replayed feed hides the cut; the photo shows the real reading
        ("replay", (), True, {"photo": True, "lab": False}, "replay", "contradicts", None),
        # without a photo, the replay itself is evidence of tampering
        ("replay", (), True, {"photo": False, "lab": False}, "replay", "review_required", ["photo:S3"]),
        # dilution tampers with the measurement point; treatment not shown to fail
        ("dilution", (), True, {}, "dilution", "review_required", None),
        ("dilution", ("S4b", "S4c"), True, {}, "dilution", "insufficient", ["S4c"]),
    ],
)
def test_oracle_labels(kind, missing, tank, docs, underlying, justified, requested):
    for seed in (1, 2, 3):
        _, lab = labelled(kind, seed, missing, tank, **docs)
        assert lab.underlying == underlying
        assert lab.justified == justified
        assert (lab.evidence_request["items"] if lab.evidence_request else None) == requested


def test_findings_always_rest_on_two_separate_items():
    assert all(len(set(combo)) >= 2 for combos in COMBOS.values() for combo in combos)


def test_lab_sample_over_the_limit_confirms_an_aeration_cut():
    for seed in (1, 2, 3):
        c, lab = labelled("aerators_down", seed, photo=False, lab=True)
        report = next(d for d in c.documents if d.type == "lab_report")
        assert report.content["bod_mg_l"] > CFG.discharge_limits.bod_mg_l
        assert lab.justified == "contradicts"


def test_faulty_signals_are_set_aside_not_trusted():
    from sim.oracle import usable_signals

    c, _ = labelled("sensor_fault", 7)
    fault = c.scenario.events[0]
    sel = (c.signals.index >= fault.start) & (c.signals.index < fault.end)
    assert c.signals.loc[sel, fault.params["signal"]].notna().all()
    assert usable_signals(c).loc[sel, fault.params["signal"]].isna().all()


def test_rules_baseline_cannot_clear_documented_maintenance():
    """The gap the investigator should close: rules see power off and stop."""
    c, lab = labelled("maintenance", 4)
    batch = next(b for b in c.batches if b.id == lab.batch_id)
    assert lab.justified == "supports"
    assert c1_rules.assess(c, batch, CFG, power_model())["status"] == "review_required"


def test_rules_baseline_misses_a_replayed_power_feed():
    c, lab = labelled("replay", 5, photo=True, lab=False)
    batch = next(b for b in c.batches if b.id == lab.batch_id)
    assert lab.justified == "contradicts"
    assert c1_rules.assess(c, batch, CFG, power_model())["status"] == "supports"


def test_drifting_meter_that_breaches_a_limit_needs_review():
    for seed in range(200, 400):
        sc = build_scenario("sensor_fault", seed, CFG)
        p = sc.events[0].params
        if p["signal"] == "S4b" and p["mode"] == "drift" and p["drift"] < 0:
            break
    c = generate(sc, CFG)
    lab = label(c, CFG)
    assert lab.justified == "review_required"
    assert lab.evidence_request["items"] == ["calibration:S4b"]


def test_tank_balance_finds_water_that_left_another_way():
    from core.physics import water_balance

    c, _ = labelled("bypass", 2, missing=("S4a", "S4b"))
    ev = c.scenario.main_event
    tank = water_balance(c.signals, ev.start, ev.end, CFG)["tank"]
    true_bypassed = c.truth.loc[(c.truth.index >= ev.start) & (c.truth.index < ev.end), "bypass"].sum() * CFG.dt_h
    assert not tank["within_tolerance"]
    assert tank["unaccounted_m3"] == pytest.approx(true_bypassed, rel=0.25)
