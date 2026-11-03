"""Training data for distilling the investigator into Muse Glimmer.

    .venv/bin/python -m eval.distill_data

Takes Muse Spark (C4) investigations that reached the justified assessment
and passed validation first time, and writes them as chat JSONL with tools:
the system prompt, each tool call (arguments as objects, with its `why`), each
tool result, and the document images the investigator looked at, attached as
a user message after the results, the way the loop sends them.

Sources: the development set, the replay tuning set and the scale sets.
Never the held-out test set: the distilled model is evaluated there.

    .venv/bin/python -m eval.distill_data --extend train_gaps --out train_gaps

writes data/distill/<out>.jsonl: the existing train.jsonl line for line (so the
first 127 investigations stay exactly as glimmer-v1 and v2 saw them, prompt
wording included), then the qualifying investigations from the extra sets.

    .venv/bin/python -m eval.distill_data --reasoning --out train_reason

writes data/distill/train_reason.jsonl for round 2 (build_reasoning): every
investigation with reasoning before each step, all with the final prompt wording.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from agent.loop import _image
from agent.models import image_part
from agent.prompts import START, SYSTEM
from agent.tools import TOOL_SPECS
from eval.caseset import GENERATED
from store.cases import ROOT, load_label

SOURCES = ["dev", "tune_replay", "scale_3", "scale_14", "scale_45"]
OUT = ROOT / "data" / "distill"


BUDGET_SPENT = re.compile(r"tool budget of \d+ checks is spent")


def spent(step: dict) -> bool:
    """A call made after the check budget ran out: its whole result is the budget message."""
    r = step.get("result")
    return isinstance(r, dict) and set(r) == {"error"} and bool(BUDGET_SPENT.match(str(r["error"])))


def conversation(trace: dict, folder: Path, turns: list[dict] | None = None, reasoning: bool = False,
                 drop_spent: bool = False) -> list[dict]:
    """The investigation as chat messages. Without `turns`, one tool call per assistant turn; with `turns`
    (the teacher's {"call_ids", "summary"} per model turn), the calls each turn made together, their
    results, then that turn's images in one user message, the way the loop sends them. With `reasoning`,
    each assistant turn carries reasoning_content: the teacher's summary, or its calls' `why` where it
    gave none (the round 1 investigations have no summaries). With `drop_spent` (round 3), calls made after
    the check budget ran out are left out with their results (they returned nothing), and a turn left
    with no calls is left out; the trace itself is unchanged."""
    messages: list[dict] = [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": START.format(case_id=trace["case_id"])}]
    steps = trace["steps"]
    made = [t for t in turns if t["call_ids"]] if turns else [{"call_ids": [None], "summary": ""}] * len(steps)
    if sum(len(t["call_ids"]) for t in made) != len(steps):
        raise ValueError("turns don't match the steps")
    i = 0
    for turn in made:
        group = steps[i: i + len(turn["call_ids"])]
        i += len(group)
        kept = [(n, step) for n, step in enumerate(group, i - len(group)) if not (drop_spent and spent(step))]
        if not kept:
            continue
        calls, results, images = [], [], []
        for n, step in kept:
            args = dict(step["args"])
            if step.get("why"):
                args["why"] = step["why"]
            call_id = f"call_{n}"
            calls.append({"id": call_id, "type": "function", "function": {"name": step["tool"], "arguments": args}})
            results.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(step["result"], default=str)})
            if step["tool"] == "read_document" and step["result"].get("image"):
                images += [{"type": "text", "text": f"Image for {step['result']['evidence_id']}:"},
                           image_part(_image(folder / step["result"]["image"]))]
        assistant = {"role": "assistant", "content": "", "tool_calls": calls}
        if reasoning:
            text = (turn["summary"] or "").strip() or "\n".join(s["why"] for _, s in kept if s.get("why"))
            if text:
                assistant["reasoning_content"] = text
        messages += [assistant, *results]
        if images:
            messages.append({"role": "user", "content": images})
    # the final call is what the model should end on; its "recorded" reply is not needed
    while messages[-1]["role"] != "assistant":
        messages.pop()
    return messages


def collect(sources: list[str], runs: str = "C4", reasoning: bool = False) -> tuple[list[dict], dict]:
    rows, skipped = [], {"wrong": 0, "fixed": 0, "error": 0}
    for set_name in sources:
        assert not set_name.startswith("test"), "never train on the held-out test set"
        for path in sorted((ROOT / "eval" / "runs" / set_name / runs).glob("factory-*.json")):
            run = json.loads(path.read_text(encoding="utf-8"))
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
            try:
                messages = conversation(trace, folder, run.get("summaries"), reasoning)
            except ValueError:
                skipped["error"] += 1
                continue
            rows.append({"messages": messages, "tools": TOOL_SPECS,
                         "meta": {"set": set_name, "case_id": run["case_id"], "status": run["status"]}})
    return rows, skipped


def extend(extra: list[str], out: str) -> None:
    rows, skipped = collect(extra)
    base = (OUT / "train.jsonl").read_text(encoding="utf-8").splitlines()
    with (OUT / f"{out}.jsonl").open("w", encoding="utf-8") as f:
        for line in base:
            f.write(line + "\n")
        for r in rows:
            f.write(json.dumps({"messages": r["messages"], "tools": r["tools"]}) + "\n")
    old = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    (OUT / f"manifest_{out}.json").write_text(json.dumps(
        {"rows": old["rows"] + [r["meta"] for r in rows], "skipped": {"base": old["skipped"], "extra": skipped}}, indent=1), encoding="utf-8")
    added = {}
    for r in rows:
        added[r["meta"]["status"]] = added.get(r["meta"]["status"], 0) + 1
    print(f"{len(base)} base + {len(rows)} added {added}, skipped {skipped} -> {OUT / out}.jsonl")


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows, skipped = collect(SOURCES)
    with (OUT / "train.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({"messages": r["messages"], "tools": r["tools"]}) + "\n")
    (OUT / "manifest.json").write_text(json.dumps({"rows": [r["meta"] for r in rows], "skipped": skipped}, indent=1), encoding="utf-8")
    chars = sum(len(json.dumps(r["messages"])) for r in rows)
    images = sum(1 for r in rows for m in r["messages"] if m["role"] == "user" and isinstance(m["content"], list))
    print(f"{len(rows)} conversations, skipped {skipped}; {images} images; about {chars / 1e6:.1f}M characters")


def build_reasoning(out: str) -> None:
    """Round 2: every investigation reasons before it acts. The round 1 investigations (SOURCES and train_gaps)
    are rebuilt from their traces with the final prompt wording and their `why` as reasoning; the teacher's
    train_reason investigations keep its summaries and the calls each turn made together."""
    parts = {"round1": collect(SOURCES + ["train_gaps"], reasoning=True),
             "train_reason": collect(["train_reason"], runs="C4c-reasoning", reasoning=True)}
    rows = [r for got, _ in parts.values() for r in got]
    with (OUT / f"{out}.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({"messages": r["messages"], "tools": r["tools"]}) + "\n")
    (OUT / f"manifest_{out}.json").write_text(json.dumps(
        {"rows": [r["meta"] for r in rows], "skipped": {k: s for k, (_, s) in parts.items()}}, indent=1), encoding="utf-8")
    for k, (got, s) in parts.items():
        statuses: dict[str, int] = {}
        for r in got:
            statuses[r["meta"]["status"]] = statuses.get(r["meta"]["status"], 0) + 1
        print(f"{k}: {len(got)} {statuses}, skipped {s}")
    print(f"{len(rows)} conversations -> {OUT / out}.jsonl")


ROUND3_CAP = 10  # the smallest targeted pool that passed (8), raised to the floor of 10 (plan sections 8, 12)
ROUND3_ORDER = {"round1": 0, "guided": 1, "unguided": 2}


def _usable(run: dict, folder: Path) -> bool:
    v = run["trace"].get("validation") or []
    return (not run.get("error") and run["status"] == load_label(folder)["justified"]
            and len(v) == 1 and not v[0]["issues"])


def _group(folder: Path) -> tuple[str, str, str, str]:
    sc = json.loads((folder / "hidden" / "scenario.json").read_text(encoding="utf-8"))
    gaps = "+".join(sorted({g["signal"] for g in sc["gaps"]})) or "-"
    return sc["kind"], gaps, "tank" if sc["tank_level_available"] else "no tank log", load_label(folder)["justified"]


def build_round3(out: str) -> None:
    """Round 3 (eval/frozen/glimmer_round3_rule.md): glimmer-gaps' format (one call per turn, no reasoning field),
    calls after the check budget removed, and a set balanced by group (kind, gap, tank log, answer). Candidates:
    round 1's runs, the guided teacher's runs and round 2's unguided runs, each usable (right, valid first time);
    in the five target kinds, from any source, only runs that pass eval.guidance.grounded. Each group keeps at most
    ROUND3_CAP: round 1 first, then guided, then unguided, by case ID. Writes data/distill/<out>.jsonl and a manifest
    with every selected source and case, the removals, the code fingerprints and the dataset hash."""
    import hashlib

    from eval.guidance import grounded, target

    candidates: dict[tuple, list] = {}
    dropped: dict[str, int] = {}
    sources = [("round1", s, "C4") for s in SOURCES + ["train_gaps"]] + \
              [("guided", "train_reason", "C4c-guided"), ("unguided", "train_reason", "C4c-reasoning")]
    for origin, set_name, runs in sources:
        assert not set_name.startswith("test"), "never train on the held-out test set"
        for path in sorted((ROOT / "eval" / "runs" / set_name / runs).glob("factory-*.json")):
            run = json.loads(path.read_text(encoding="utf-8"))
            folder = GENERATED / set_name / path.stem
            if target(folder):
                ok, why = grounded(run, folder)
            else:
                ok, why = _usable(run, folder), ["not usable"]
            if not ok:
                dropped[f"{origin}/{why[0].split(':')[0][:60]}"] = dropped.get(f"{origin}/{why[0].split(':')[0][:60]}", 0) + 1
                continue
            candidates.setdefault(_group(folder), []).append((origin, set_name, runs, path.stem))
    picked = {g: sorted(c, key=lambda x: (ROUND3_ORDER[x[0]], x[1], x[3]))[:ROUND3_CAP] for g, c in candidates.items()}
    rows, meta = [], []
    for g in sorted(picked):
        for origin, set_name, runs, case in picked[g]:
            run = json.loads((ROOT / "eval" / "runs" / set_name / runs / f"{case}.json").read_text(encoding="utf-8"))
            folder = GENERATED / set_name / case
            removed = sum(spent(s) for s in run["trace"]["steps"])
            rows.append({"messages": conversation(run["trace"], folder, drop_spent=True), "tools": TOOL_SPECS})
            meta.append({"origin": origin, "set": set_name, "runs": runs, "case_id": case, "group": list(g),
                         "status": run["status"], "budget_calls_removed": removed})
    lines = [json.dumps(r) for r in rows]
    (OUT / f"{out}.jsonl").write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    fp = lambda f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest()  # noqa: E731
    manifest = {"rows": meta, "dropped_candidates": dropped,
                "groups": {" | ".join(g): len(v) for g, v in sorted(picked.items())},
                "fingerprints": {f: fp(f) for f in ("eval/guidance.py", "eval/distill_data.py", "agent/prompts.py", "agent/tools.py")},
                "sha256": hashlib.sha256("".join(line + "\n" for line in lines).encode()).hexdigest()}
    (OUT / f"manifest_{out}.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    count = lambda key: {k: sum(1 for m in meta if m[key] == k) for k in sorted({m[key] for m in meta})}  # noqa: E731
    print(f"{len(rows)} conversations -> {OUT / out}.jsonl; by answer {count('status')}; by source {count('origin')}; "
          f"budget calls removed {sum(m['budget_calls_removed'] for m in meta)}; sha256 {manifest['sha256'][:16]}")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--extend", nargs="+", help="extra case sets to append to the existing train.jsonl")
    p.add_argument("--out", default="train_gaps")
    p.add_argument("--reasoning", action="store_true", help="round 2: rebuild everything with reasoning before each step")
    p.add_argument("--round3", action="store_true", help="round 3: the balanced, grounded set (build_round3)")
    a = p.parse_args()
    if a.round3:
        build_round3(a.out)
    elif a.reasoning:
        build_reasoning(a.out)
    elif a.extend:
        assert not any(x.startswith("test") for x in a.extend), "never train on the held-out test set"
        extend(a.extend, a.out)
    else:
        build()
