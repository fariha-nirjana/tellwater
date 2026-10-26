import pytest

from eval import c1_rules
from sim.baseline import power_model
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import build_scenario

CFG = load_factory()


def labelled(kind, seed, missing=(), tank=True):
    c = generate(build_scenario(kind, seed, CFG, missing=missing, tank_level_available=tank), CFG)
    return c, label(c, CFG)


@pytest.mark.parametrize(
    "kind, missing, tank, underlying, justified, requested",
    [
        ("normal", (), True, "normal", "supports", None),
        ("normal", ("S3",), True, "normal", "insufficient", ["S3"]),
        ("low_production", (), True, "low_production", "supports", None),
        ("shutdown", (), True, "shutdown", "contradicts", None),
        # outfall blind: the shutdown happened but cannot be shown
        ("shutdown", ("S4a", "S4b"), True, "shutdown", "insufficient", ["S4a"]),
        # ETP inflow and outfall flow lost, but power and pH still tell it
        ("shutdown", ("S2", "S4a"), True, "shutdown", "contradicts", None),
        ("bypass", (), True, "bypass", "contradicts", None),
        ("bypass", ("S4a", "S4b"), True, "bypass", "insufficient", ["S4a"]),
        ("maintenance", (), True, "maintenance", "supports", None),
        # without tank level, nothing shows the stored water was treated later
        ("maintenance", (), False, "maintenance", "insufficient", ["T1"]),
    ],
)
def test_oracle_labels(kind, missing, tank, underlying, justified, requested):
    for seed in (1, 2, 3):
        _, lab = labelled(kind, seed, missing, tank)
        assert lab.underlying == underlying
        assert lab.justified == justified
        assert (lab.evidence_request["signals"] if lab.evidence_request else None) == requested


def test_findings_always_rest_on_two_separate_signals():
    from sim.oracle import COMBOS

    assert all(len(set(combo)) >= 2 for combos in COMBOS.values() for combo in combos)


def test_rules_baseline_cannot_clear_documented_maintenance():
    """The gap the investigator should close: rules see power off and stop."""
    c, lab = labelled("maintenance", 4)
    batch = next(b for b in c.batches if b.id == lab.batch_id)
    assert lab.justified == "supports"
    assert c1_rules.assess(c, batch, CFG, power_model())["status"] == "review_required"
