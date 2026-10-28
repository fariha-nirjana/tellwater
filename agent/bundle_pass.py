"""Condition C3: the model gets the complete evidence bundle at once, no tools.

Code runs, up front, every check an investigator could reach for over the
windows that matter (the treatment interval and each alert window), adds
the full-resolution signal table and every document image, and hands it
all over in one message. The model can only finish: submit_assessment or
request_evidence. Same prompt facts, rules and validator as C4.
"""

from __future__ import annotations

import json

import pandas as pd

from agent.loop import Trace, _image, investigate
from agent.models import ModelClient, image_part
from agent.prompts import SYSTEM
from agent.tools import SIGNAL_INFO, TOOL_SPECS, CaseTools
from core.physics import PowerModel
from store.cases import Bundle

FINISHING = {"submit_assessment", "request_evidence"}
SPECS = [s for s in TOOL_SPECS if s["function"]["name"] in FINISHING]
REPLAY_SIGNALS = ("S2", "S3", "S4a", "S4b")

HOW = """## How to work
You have no investigation tools. Everything available is below, already computed: the case overview, every signal at full resolution, signal summaries, water balances and power-vs-load checks over the treatment interval and each alert window, replay comparisons, lab results, the production plan, and every document (images attached).
- Weigh at least two competing explanations (e.g. normal operation, planned maintenance, shutdown, bypass, aeration cut, dilution, meter fault, low production) and report the final state of each.
- To compare a reading in a photo with the feed, look up the feed at that time in the full-resolution table and quote both values exactly as they appear.
- Cite evidence by the IDs given below. The full-resolution table can be cited by its ID.

"""


def system_prompt() -> str:
    head, rest = SYSTEM.split("## How to work", 1)
    _, finishing = rest.split("## Finishing", 1)
    head = head.replace("When you read a value off a photo, compare it to the feed with check_reading_against_feed.",
                        "When you read a value off a photo, compare it to the feed value in the full-resolution table.")
    return head + HOW + "## Finishing" + finishing


def build(bundle: Bundle, power_model: PowerModel) -> tuple[CaseTools, list[dict], list[dict]]:
    """Run the fixed checks. Returns the tools (registry filled), the opening messages and the steps."""
    tools = CaseTools(bundle, power_model, budget=10_000)
    steps: list[dict] = []

    def run(name: str, **args) -> dict:
        result = tools.call(name, args)
        steps.append({"n": len(steps) + 1, "tool": name, "args": args, "why": "C3 fixed bundle", "result": result, "t": 0.0})
        return result

    overview = run("get_case_overview")
    ti = overview["treatment_interval"]
    windows = [(ti["start"], ti["end"])]
    for eid, item in tools.registry.items():
        if item["kind"] == "alert" and (item["start"], item["end"]) not in windows:
            windows.append((item["start"], item["end"]))

    data_start, data_end = overview["case_data_range"]["start"], overview["case_data_range"]["end"]
    for sig in SIGNAL_INFO:
        for s, e in windows:
            run("get_signal_window", signal=sig, start=s, end=e)
    for s, e in windows:
        run("compute_water_balance", start=s, end=e)
        run("check_power_vs_load", start=s, end=e)
    for sig in REPLAY_SIGNALS:
        run("compare_similar_windows", signal=sig, start=ti["start"], end=ti["end"])
    run("get_lab_results")
    run("get_production", start=data_start, end=data_end)
    docs = [run("read_document", doc_id=d["id"]) for d in bundle.documents]

    table_id = "data:signals@full"
    tools._register(table_id, "signal_table", {"start": data_start, "end": data_end})
    table = bundle.signals.copy()
    table.index = table.index.strftime("%m-%d %H:%M")
    csv = table.round({"S4b": 2, "T1": 3}).round(1).to_csv(na_rep="")
    steps.append({"n": len(steps) + 1, "tool": "signal_table", "args": {}, "why": "C3 fixed bundle",
                  "result": {"evidence_id": table_id, "rows": len(table)}, "t": 0.0})

    parts: list[dict] = [{"type": "text", "text": f"Investigate case {bundle.case_id}. The complete evidence bundle follows.\n\n"
                          + "\n\n".join(f"### {s['tool']} {json.dumps(s['args'])}\n{json.dumps(s['result'], default=str)}"
                                        for s in steps if s["tool"] != "signal_table")
                          + f"\n\n### Full-resolution signals ({table_id}), {bundle.cfg.timestep_minutes}-minute readings, "
                            f"empty = no reading\n{csv}"}]
    for d in docs:
        if d.get("image"):
            parts += [{"type": "text", "text": f"Image for {d['evidence_id']}:"}, image_part(_image(bundle.folder / d["image"]))]
    messages = [{"role": "system", "content": system_prompt()}, {"role": "user", "content": parts}]
    # the validator accepts numbers from the table too
    tools.calls.append({"name": "signal_table", "args": {}, "why": None,
                        "result": [v for v in bundle.signals.round(3).to_numpy().ravel().tolist() if v == v]})
    return tools, messages, steps


def assess(bundle: Bundle, client: ModelClient, power_model: PowerModel | None = None) -> Trace:
    if power_model is None:
        from sim.baseline import power_model as baseline_model

        power_model = baseline_model(bundle.factory_config)
    tools, messages, steps = build(bundle, power_model)
    trace = investigate(bundle, client, power_model, tools=tools, messages=messages, specs=SPECS, steps=steps, max_turns=6)
    trace.checks_used = 0  # nothing was chosen; the bundle is fixed
    return trace
