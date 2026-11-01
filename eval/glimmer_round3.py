"""Applies the round 3 rule (eval/frozen/glimmer_round3_rule.md) to the saved C6 runs.

    .venv/bin/python -m eval.glimmer_round3            # after epoch 1: the halfway check
    .venv/bin/python -m eval.glimmer_round3 --final    # after epoch 2: the bar and the choice

Same counts as round 2 (eval.glimmer_round2.counts: complete results only, invalid = wrong),
on check_r3 (28 cases) with check (8) as the regression check.
"""

from __future__ import annotations

import argparse
import json

from eval.glimmer_round2 import beats, counts

INCUMBENT = "glimmer-gaps/epoch2"
CANDIDATES = ["glimmer-r3/epoch1", "glimmer-r3/epoch2"]
SET = "check_r3"
MAX_OVERCLAIMS = 1  # of the 17 cases whose justified answer is not "supports"
MIN_SUPPORTS_RIGHT = 8  # of the 11 "supports" cases
MIN_CHECK_RIGHT = 7  # of the 8 original check cases (regression)


def clears_bar(on_set: dict, on_check: dict, incumbent: dict) -> bool:
    return (on_set["overclaims"] <= MAX_OVERCLAIMS and on_set["overclaims"] <= incumbent["overclaims"]
            and on_set["supports_right"] >= MIN_SUPPORTS_RIGHT and on_check["right"] >= MIN_CHECK_RIGHT)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--final", action="store_true")
    a = p.parse_args()
    base = counts(SET, INCUMBENT)
    report = {INCUMBENT: base}
    if not a.final:
        e1 = report[CANDIDATES[0]] = counts(SET, CANDIDATES[0])
        report["halfway"] = ("continue: epoch 1 beats " + INCUMBENT) if beats(e1, base) else \
            f"stop: epoch 1 does not beat {INCUMBENT}; it stays published (training stopped under the rule)"
    else:
        passing = []
        for c in CANDIDATES:
            on_set, on_check = counts(SET, c), counts("check", c)
            ok = clears_bar(on_set, on_check, base) and beats(on_set, base)
            report[c] = {SET: on_set, "check": on_check, "clears_bar_and_beats_incumbent": ok}
            if ok:
                passing.append((c, on_set))
        if not passing:
            report["published"] = INCUMBENT
        elif len(passing) == 2 and beats(passing[0][1], passing[1][1]):
            report["published"] = passing[0][0]
        else:
            report["published"] = passing[-1][0]  # epoch2 unless only epoch1 passed or epoch1 beats it
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
