"""The three demo cases the interface opens with, copied into data/demo/ so
the app runs from a fresh clone without regenerating anything.

    .venv/bin/python -m api.demo

A  maintenance, cleared: the tank log shows the water was held
B  aeration cut: the photo confirms low power, the lab shows treatment failed
C  maintenance with the tank log missing: the investigator asks for it

All three are development cases; nothing here comes from the held-out test set.
"""

from __future__ import annotations

import json
import shutil

from store.cases import ROOT

DEMO_ROOT = ROOT / "data" / "demo"
DEMO = {
    "A": ("dev", "factory-a-54b2c9cb"),
    "B": ("dev", "factory-a-460f93ca"),
    "C": ("dev", "factory-a-6e86676d"),
}


def build() -> None:
    for key, (set_name, case_id) in DEMO.items():
        src = ROOT / "data" / "generated" / set_name / case_id
        dst = DEMO_ROOT / key
        # replace only the case copy; saved investigations (trace-after.json) stay
        if (dst / "case").exists():
            shutil.rmtree(dst / "case")
        shutil.copytree(src, dst / "case")
        run = json.loads((ROOT / "eval" / "runs" / set_name / "C4" / f"{case_id}.json").read_text())
        (dst / "trace.json").write_text(json.dumps(run["trace"], indent=1, default=str))
        print(f"{key}: {case_id} -> {run['status']}")
    # evaluation summaries, so the results page works without the (gitignored) run folders
    results: dict = {}
    for summary in sorted((ROOT / "eval" / "runs").glob("*/*/summary.json")):
        set_name, condition = summary.parent.parent.name, summary.parent.name
        if "_v" not in condition:  # skip archived earlier iterations
            results.setdefault(set_name, {})[condition] = json.loads(summary.read_text())["summary"]
    # line-finding on logbook photos (eval.localize): raw and square-padded, per model
    for f in sorted((ROOT / "eval" / "runs" / "localize").glob("*/*.json")):
        results.setdefault("localize", {})[f"{f.parent.name}/{f.stem}"] = json.loads(f.read_text())["summary"]
    (DEMO_ROOT / "results.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    build()
