"""Applies the round 2 rule (eval/frozen/glimmer_round2_rule.md) to the saved C6 runs.

    .venv/bin/python -m eval.glimmer_round2            # after epoch 1: the halfway check
    .venv/bin/python -m eval.glimmer_round2 --final    # after epoch 2: the bar and the choice

Reads eval/runs/check_reason/<folder>/summary.json (and check/ for the bar), written by
eval.run_set ... C6 --modal --adapter <adapter>. A run that failed validation counts as wrong.
"""

from __future__ import annotations

import argparse
import json

from agent.glimmer import runs_folder
from eval.run_set import RUNS, _case_dirs

INCUMBENT = "glimmer-gaps/epoch2"
CANDIDATES = ["glimmer-reason/epoch1", "glimmer-reason/epoch2"]


EXPECTED = {"check_reason": 16, "check": 8, "check_r3": 28}


def counts(set_name: str, adapter: str) -> dict:
    path = RUNS / set_name / runs_folder(adapter) / "summary.json"
    if not path.exists():
        raise SystemExit(f"{set_name}/{runs_folder(adapter)}: no runs yet")
    rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
    # the rule is applied only to complete results: every case of the set, once
    ids = [r["case_id"] for r in rows]
    if len(ids) != EXPECTED[set_name] or set(ids) != {f.name for f in _case_dirs(set_name)}:
        raise SystemExit(f"{set_name}/{runs_folder(adapter)}: {len(set(ids))} of {EXPECTED[set_name]} cases; run the rest first")
    right = lambda r: bool(r.get("valid")) and r["predicted"] == r["justified"]  # noqa: E731
    supports = [r for r in rows if r["justified"] == "supports"]
    return {"cases": len(rows), "right": sum(map(right, rows)),
            "overclaims": sum(r["predicted"] == "supports" and r["justified"] != "supports" for r in rows),
            "of_not_supports": len(rows) - len(supports),
            "unneeded_asks": sum(r["predicted"] == "insufficient" for r in supports),
            "supports_right": sum(map(right, supports)), "of_supports": len(supports),
            "invalid": sum(not r.get("valid") for r in rows)}


def beats(a: dict, b: dict) -> bool:
    return a["right"] > b["right"] or (a["right"] == b["right"] and a["overclaims"] < b["overclaims"])


def clears_bar(on_reason: dict, on_check: dict) -> bool:
    return on_reason["overclaims"] <= 1 and on_reason["supports_right"] >= 5 and on_check["right"] >= 7


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--final", action="store_true")
    a = p.parse_args()
    base = counts("check_reason", INCUMBENT)
    report = {INCUMBENT: base}
    if not a.final:
        e1 = report[CANDIDATES[0]] = counts("check_reason", CANDIDATES[0])
        report["halfway"] = ("continue: epoch 1 beats " + INCUMBENT) if beats(e1, base) else \
            f"stop: epoch 1 does not beat {INCUMBENT}; it stays published (training stopped under the rule)"
    else:
        passing = []
        for c in CANDIDATES:
            on_reason, on_check = counts("check_reason", c), counts("check", c)
            ok = clears_bar(on_reason, on_check) and beats(on_reason, base)
            report[c] = {"check_reason": on_reason, "check": on_check, "clears_bar_and_beats_incumbent": ok}
            if ok:
                passing.append((c, on_reason))
        if not passing:
            report["published"] = INCUMBENT
        elif len(passing) == 2 and beats(passing[0][1], passing[1][1]):
            report["published"] = passing[0][0]
        else:
            report["published"] = passing[-1][0]  # epoch2 unless only epoch1 passed or epoch1 beats it
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
