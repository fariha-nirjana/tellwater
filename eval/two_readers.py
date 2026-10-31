"""Two readers: Muse Spark (C4) and the distilled Muse Glimmer (C6) investigate
the same case with the same frozen investigator. Where they reach different
answers, neither answer is used: the case goes to a person.

The rule (eval/frozen/two_reader_rule.md) was written and committed before
any held-out test case was run, and is not changed after seeing results.

  .venv/bin/python -m eval.two_readers test        # after C4 and C6 have run
"""

from __future__ import annotations

import json
import sys

from eval.metrics import score
from eval.run_set import RUNS

FIRST, SECOND = "C4", "C6"
ROUTED = "review_required"  # what a disagreement becomes: a person decides


def combine(first: dict, second: dict) -> dict:
    """One case's combined answer from the two readers' summary rows."""
    a, b = first["predicted"], second["predicted"]
    agree = a is not None and a == b
    return {**first, "predicted": a if agree else ROUTED, "readers": [a, b], "routed": not agree,
            "cost": (first.get("cost") or 0) + (second.get("cost") or 0)}


def run(name: str) -> dict:
    rows = {}
    for cond in (FIRST, SECOND):
        rows[cond] = {r["case_id"]: r for r in json.loads((RUNS / name / cond / "summary.json").read_text())["rows"]}
    ids = sorted(set(rows[FIRST]) & set(rows[SECOND]))
    combined = [combine(rows[FIRST][i], rows[SECOND][i]) for i in ids]
    agreed = [r for r in combined if not r["routed"]]
    out = {
        "rule": f"{FIRST} and {SECOND} agree -> their answer; they differ (or either has no result) -> {ROUTED}, a person decides",
        "cases": len(combined),
        "readers_agree": len(agreed),
        "routed_to_a_person": len(combined) - len(agreed),
        "right_when_they_agree": f"{sum(r['predicted'] == r['justified'] for r in agreed)}/{len(agreed)}",
        "combined": score(combined),
        "first_alone": score([rows[FIRST][i] for i in ids]),
        "routed": [{"case_id": r["case_id"], "justified": r["justified"], "readers": r["readers"]} for r in combined if r["routed"]],
    }
    (RUNS / name / "two_readers.json").write_text(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    result = run(sys.argv[1] if len(sys.argv) > 1 else "test")
    print(json.dumps({k: v for k, v in result.items() if k not in ("combined", "first_alone")}, indent=2))
