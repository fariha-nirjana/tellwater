"""The round 3 grounding check catches each way a right answer can be ungrounded.

Each test breaks one thing in a real guided run that passes, and expects that exact failure.
The runs and cases are local (gitignored), so these skip on a fresh clone."""

import copy
import json
from pathlib import Path

import pandas as pd
import pytest

from eval.guidance import _span, grounded

RUNS = Path("eval/runs/train_reason/C4c-guided")
CASES = Path("data/generated/train_reason")
INSUFFICIENT = "factory-a-0d64ed56"  # dilution, ETP inflow (S2) missing
MAINTENANCE = "factory-a-0863b14b"  # maintenance, ETP power (S3) missing: supports
GAP_READ = "factory-a-11cc90b5"  # dilution, S2 missing; it read the S2 gap and cites that read


def _load(case):
    path = RUNS / f"{case}.json"
    if not path.exists() or not (CASES / case).exists():
        pytest.skip("local round 3 runs not present")
    return json.loads(path.read_text(encoding="utf-8")), CASES / case


def _fails(run, folder, words):
    ok, why = grounded(run, folder)
    assert not ok and any(words in w for w in why), why


def test_the_untouched_runs_pass():
    for case in (INSUFFICIENT, MAINTENANCE):
        run, folder = _load(case)
        assert grounded(run, folder) == (True, [])


def test_no_overview():
    run, folder = _load(INSUFFICIENT)
    run = copy.deepcopy(run)
    run["trace"]["steps"] = [s for s in run["trace"]["steps"] if s["tool"] != "get_case_overview"]
    _fails(run, folder, "never read the case overview")


def test_overview_without_the_gap():
    run, folder = _load(INSUFFICIENT)
    run = copy.deepcopy(run)
    overview = next(s for s in run["trace"]["steps"] if s["tool"] == "get_case_overview")
    overview["result"]["signals"]["S2"]["gaps"] = []
    _fails(run, folder, "does not show the S2 gap")


def _request(run):
    fin = run["final"]
    return fin if fin.get("kind") == "evidence_request" else fin["evidence_request"]


def test_request_without_the_missing_record():
    run, folder = _load(INSUFFICIENT)
    run = copy.deepcopy(run)
    _request(run)["items"] = ["A photo of the outfall"]
    _fails(run, folder, "does not name S2")


def test_request_for_a_record_that_is_there_by_name_only():
    run, folder = _load(INSUFFICIENT)
    run = copy.deepcopy(run)
    _request(run)["items"].append("The ETP power meter readings for the same stretch")
    _fails(run, folder, "also asks for S3")


def test_gap_read_used_to_settle_an_explanation():
    run, folder = _load(GAP_READ)
    assert grounded(run, folder) == (True, [])
    run = copy.deepcopy(run)
    gap_read = next(s["result"]["evidence_id"] for s in run["trace"]["steps"]
                    if s["tool"] == "get_signal_window" and s["args"].get("signal") == "S2"
                    and s["result"].get("coverage") == 0.0)
    fin = run["final"]
    fin["explanations"][0]["status"] = "contradicted"
    fin["explanations"][0].setdefault("contradicting", []).append(gap_read)
    _fails(run, folder, "mostly inside the S2 gap")


def test_supports_without_citing_the_outfall_flow():
    run, folder = _load(MAINTENANCE)
    run = copy.deepcopy(run)
    fin = run["final"]
    keep = lambda eid: "S4a" not in eid and "water_balance" not in eid  # noqa: E731
    fin["key_evidence"] = [k for k in fin.get("key_evidence") or [] if keep(k["id"])]
    for e in fin["explanations"]:
        e["supporting"] = [x for x in e.get("supporting") or [] if keep(x)]
        e["contradicting"] = [x for x in e.get("contradicting") or [] if keep(x)]
    _fails(run, folder, "cited records do not cover")


def test_supports_without_reading_the_catch_up():
    run, folder = _load(MAINTENANCE)
    run = copy.deepcopy(run)
    stop = next(e for e in json.loads((folder / "hidden" / "scenario.json").read_text(encoding="utf-8"))["events"]
                if e["type"] == "maintenance")
    end = pd.Timestamp(stop["end"])
    for s in run["trace"]["steps"]:  # every read of the tank or outfall flow stops at the end of the stop
        eid = (s.get("result") or {}).get("evidence_id") or ""
        span = _span(eid)
        if span and span[1] > end and ("T1" in eid or "S4a" in eid or "water_balance" in eid):
            s["result"]["evidence_id"] = eid.split("@")[0] + f"@{span[0]:%m%d-%H%M}..{end:%m%d-%H%M}"
    _fails(run, folder, "do not cover the stop and catch-up")


def test_wrong_answer():
    run, folder = _load(MAINTENANCE)
    run = copy.deepcopy(run)
    run["status"] = "insufficient"
    _fails(run, folder, "answered insufficient")


def test_repeating_the_note():
    run, folder = _load(MAINTENANCE)
    run = copy.deepcopy(run)
    run["final"]["limitations"] = ["The missing power record does not decide this case."]
    _fails(run, folder, "repeats the note's wording")
