"""Training data for distilling the investigator into Muse Glimmer.

    .venv/bin/python -m eval.distill_data

Takes Muse Spark (C4) investigations that reached the justified assessment
and passed validation first time, and writes them as chat JSONL with tools:
the system prompt, each tool call (arguments as objects, with its `why`), each
tool result, and the document images the investigator looked at, attached as
a user message after the results, the way the loop sends them.

Sources: the development set, the replay tuning set and the scale sets.
Never the held-out test set: the distilled model is evaluated there.
"""

from __future__ import annotations

import json
from pathlib import Path

from agent.loop import _image
from agent.models import image_part
from agent.prompts import START, SYSTEM
from agent.tools import TOOL_SPECS
from eval.caseset import GENERATED
from store.cases import ROOT, load_label

SOURCES = ["dev", "tune_replay", "scale_3", "scale_14", "scale_45"]
OUT = ROOT / "data" / "distill"


def conversation(trace: dict, folder: Path) -> list[dict]:
    """The investigation as chat messages, one tool call per assistant turn."""
    messages: list[dict] = [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": START.format(case_id=trace["case_id"])}]
    for i, step in enumerate(trace["steps"]):
        args = dict(step["args"])
        if step.get("why"):
            args["why"] = step["why"]
        call_id = f"call_{i}"
        messages.append({"role": "assistant", "content": "", "tool_calls": [
            {"id": call_id, "type": "function", "function": {"name": step["tool"], "arguments": args}}]})
        messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(step["result"], default=str)})
        if step["tool"] == "read_document" and step["result"].get("image"):
            messages.append({"role": "user", "content": [
                {"type": "text", "text": f"Image for {step['result']['evidence_id']}:"},
                image_part(_image(folder / step["result"]["image"]))]})
    # the final call is what the model should end on; its "recorded" reply is not needed
    while messages[-1]["role"] != "assistant":
        messages.pop()
    return messages


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows, skipped = [], {"wrong": 0, "fixed": 0, "error": 0}
    for set_name in SOURCES:
        assert not set_name.startswith("test"), "never train on the held-out test set"
        for path in sorted((ROOT / "eval" / "runs" / set_name / "C4").glob("factory-*.json")):
            run = json.loads(path.read_text())
            folder = GENERATED / set_name / run["case_id"]
            trace = run["trace"]
            if run.get("error") or not trace.get("final"):
                skipped["error"] += 1
                continue
            if run["status"] != load_label(folder)["justified"]:
                skipped["wrong"] += 1
                continue
            if len(trace.get("validation", [])) != 1 or trace["validation"][0]["issues"]:
                skipped["fixed"] += 1
                continue
            rows.append({"messages": conversation(trace, folder), "tools": TOOL_SPECS,
                         "meta": {"set": set_name, "case_id": run["case_id"], "status": run["status"]}})
    with (OUT / "train.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps({"messages": r["messages"], "tools": r["tools"]}) + "\n")
    (OUT / "manifest.json").write_text(json.dumps({"rows": [r["meta"] for r in rows], "skipped": skipped}, indent=1))
    chars = sum(len(json.dumps(r["messages"])) for r in rows)
    images = sum(1 for r in rows for m in r["messages"] if m["role"] == "user" and isinstance(m["content"], list))
    print(f"{len(rows)} conversations, skipped {skipped}; {images} images; about {chars / 1e6:.1f}M characters")


if __name__ == "__main__":
    build()
