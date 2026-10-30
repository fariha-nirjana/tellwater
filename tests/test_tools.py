import json

import pandas as pd
import pytest

from agent.tools import TOOL_SPECS, CaseTools
from sim.baseline import power_model
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import EventType, build_scenario
from store.cases import load_bundle, save_case

CFG = load_factory()


def saved(tmp_path, kind, seed=4, **kw):
    c = generate(build_scenario(kind, seed, CFG, **kw), CFG)
    folder = save_case(c, label(c, CFG), tmp_path)
    return c, CaseTools(load_bundle(folder), power_model())


def iso(t):
    return t.isoformat()


def test_bundle_holds_no_hidden_truth(tmp_path):
    c, tools = saved(tmp_path, "replay", photo=True)
    overview = json.dumps(tools.call("get_case_overview", {}))
    assert "truthful" not in overview and "underlying" not in overview
    for d in tools.bundle.documents:
        if d["type"] in ("logbook", "meter_photo", "maintenance_record"):
            assert "content" not in d  # must be read from the image


def test_replayed_power_feed_is_caught_two_ways(tmp_path):
    c, tools = saved(tmp_path, "replay", photo=True)
    ev = c.scenario.event(EventType.REPLAY)
    cmp = tools.call("compare_similar_windows", {"signal": "S3", "start": iso(ev.start), "end": iso(ev.end)})
    assert any(x["identical_reading_for_reading"] and x["days_offset"] == -1 for x in cmp["comparisons"])

    photo = next(d for d in c.documents if d.type == "meter_photo" and d.content["signal"] == "S3")
    t = pd.Timestamp(photo.meta["taken_at"])
    check = tools.call("check_reading_against_feed", {"signal": "S3", "timestamp": iso(t), "value": photo.content["value"]})
    assert check["consistent"] is False
    assert check["evidence_id"] in tools.registry


def test_honest_meter_photo_agrees_with_the_feed(tmp_path):
    c, tools = saved(tmp_path, "aerators_down", photo=True)
    photo = next(d for d in c.documents if d.type == "meter_photo" and d.content["signal"] == "S3")
    t = pd.Timestamp(photo.meta["taken_at"])
    check = tools.call("check_reading_against_feed", {"signal": "S3", "timestamp": iso(t), "value": photo.content["value"]})
    assert check["consistent"] is True


def test_power_vs_load_and_water_balance_separate_the_events(tmp_path):
    c, tools = saved(tmp_path, "aerators_down")
    ev = c.scenario.main_event
    pv = tools.call("check_power_vs_load", {"start": iso(ev.start), "end": iso(ev.end)})
    assert pv["share_below_band"] > 0.5
    c, tools = saved(tmp_path, "bypass")
    ev = c.scenario.main_event
    wb = tools.call("compute_water_balance", {"start": iso(ev.start), "end": iso(ev.end)})
    assert wb["etp"]["within_tolerance"] is False and wb["boundary"]["within_tolerance"] is True


def test_stuck_meter_is_flagged(tmp_path):
    for seed in range(40, 80):
        sc = build_scenario("sensor_fault", seed, CFG)
        if sc.events[0].params["mode"] == "stuck":
            break
    c = generate(sc, CFG)
    tools = CaseTools(load_bundle(save_case(c, label(c, CFG), tmp_path)), power_model())
    ev = c.scenario.events[0]
    r = tools.call("get_signal_window", {"signal": ev.params["signal"], "start": iso(ev.start), "end": iso(ev.end)})
    assert any("flat" in f for f in r["flags"])


def test_gaps_are_reported_not_hidden(tmp_path):
    c, tools = saved(tmp_path, "bypass", missing=("S4a",))
    ov = tools.call("get_case_overview", {})
    assert ov["signals"]["S4a"]["gaps"]
    assert ov["signals"]["S4a"]["coverage_of_treatment_interval"] < 1


def test_budget_and_errors_come_back_as_results(tmp_path):
    _, tools = saved(tmp_path, "normal")
    tools.budget = 2
    assert "error" in tools.call("get_signal_window", {"signal": "S9", "start": "2026-10-13T06:00", "end": "2026-10-13T08:00"})
    tools.call("get_case_overview", {})  # free: every investigation starts here
    tools.call("get_lab_results", {})
    assert "budget" in tools.call("get_lab_results", {})["error"]
    # a model once sent its explanations as a JSON string; that must come back as an error, not end the run
    assert "list of objects" in tools.call("update_hypotheses", {"explanations": '[{"id": "a"}, {"id": "b"}]'})["error"]
    assert tools.call("request_evidence", {"items": ["T1"], "interval_start": "2026-10-13T06:00",
                                           "interval_end": "2026-10-13T12:00", "reason": "x"}) == {"recorded": True}
    assert tools.final["kind"] == "evidence_request"


def test_every_tool_has_a_spec_and_an_implementation():
    names = {s["function"]["name"] for s in TOOL_SPECS}
    assert all(hasattr(CaseTools, f"tool_{n}") for n in names)
    assert len(names) == len(TOOL_SPECS)


def test_photo_reading_is_compared_with_what_inflow_requires(tmp_path):
    c, tools = saved(tmp_path, "replay", photo=True)
    photo = next(d for d in c.documents if d.type == "meter_photo" and d.content["signal"] == "S3")
    t = pd.Timestamp(photo.meta["taken_at"])
    r = tools.call("check_reading_against_feed", {"signal": "S3", "timestamp": iso(t), "value": photo.content["value"]})
    assert r["reading_vs_expected_band"] == "below"


def test_replay_found_even_when_the_window_starts_early(tmp_path):
    c, tools = saved(tmp_path, "replay", photo=True)
    ev = c.scenario.event(EventType.REPLAY)
    early = ev.start - pd.Timedelta(hours=1)
    cmp = tools.call("compare_similar_windows", {"signal": "S3", "start": iso(early), "end": iso(ev.end)})
    prev = next(x for x in cmp["comparisons"] if x["days_offset"] == -1)
    assert prev["identical_reading_for_reading"]
    assert prev["longest_identical_stretch_minutes"] >= (ev.end - ev.start) / pd.Timedelta(minutes=1) - 10


@pytest.mark.parametrize("kind", [k.value for k in EventType])
def test_nothing_the_agent_sees_names_the_scenario(tmp_path, kind):
    """Label leakage audit: IDs, file names and metadata must not hint at the event."""
    c = generate(build_scenario(kind, 6, CFG, photo=True, lab=True, adversarial=True), CFG)
    folder = save_case(c, label(c, CFG), tmp_path)
    visible = [(folder / "case.json").read_text(), (folder / "batches.json").read_text()]
    visible += [json.dumps({k: d[k] for k in ("id", "image", "author")}) for d in json.loads((folder / "documents.json").read_text())]
    visible += [p.name for p in (folder / "docs").iterdir()]
    words = {"replay", "bypass", "dilution", "aerator", "shutdown", "fault", "low_production", "low_load", "probe", "injection"}
    leaks = [w for w in words if any(w in v.lower() for v in visible)]
    assert not leaks, f"{kind}: {leaks}"
    assert "hidden" not in json.dumps(load_bundle(folder).documents)
