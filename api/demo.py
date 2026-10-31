"""The three demo cases the interface opens with, copied into data/demo/ so
the app runs from a fresh clone without regenerating anything.

    .venv/bin/python -m api.demo            (case copies, saved investigations and the results snapshot)
    .venv/bin/python -m api.demo results    (the results snapshot only)

A  maintenance, cleared: the tank log shows the water was held
B  aeration cut: the photo confirms low power, the lab shows treatment failed
C  maintenance with the tank log missing: the investigator asks for it
D  a second supplier (factory B): raw alkaline water reached the outfall, a bypass
E  factory B again: extra outfall water with falling conductivity, possible dilution; a person decides

A to C are development cases; D and E are from the factory B check set (results page, "a second factory").
Nothing here comes from the held-out test set.
"""

from __future__ import annotations

import json
import re
import shutil
import sys

from store.cases import ROOT

DEMO_ROOT = ROOT / "data" / "demo"
DEMO = {
    "A": ("dev", "factory-a-54b2c9cb"),
    "B": ("dev", "factory-a-460f93ca"),
    "C": ("dev", "factory-a-6e86676d"),
    "D": ("check_b", "factory-b-e257c871"),
    "E": ("check_b", "factory-b-50fe9672"),
}
# Cases also shown with their logbook pages in Bangla (eval.caseset's bangla set: same records, same answer),
# with the investigation Muse Spark ran on the Bangla pages.
BANGLA = {"C": ("bangla", "factory-a-6e86676d")}
# What each demo batch became. A batch is one dye run: one fabric in one colour, cut into several garments,
# all of which carry the batch's assessment. The simulated plant is a knit dyehouse, so knit fabrics only.
# What a shopper reads on the label (demo values for cotton knits).
COMPOSITION = {"Cotton piqué": "100% cotton piqué", "Cotton jersey": "100% cotton jersey", "Cotton fleece": "100% cotton, brushed fleece"}
CARE = ["Machine wash at 30°C", "Do not bleach", "Tumble dry low", "Iron on medium", "Do not dry clean"]
CATALOG = {
    "A": ("Cotton piqué", [("polo", "Men's polo shirt"), ("polo-w", "Women's polo shirt")]),
    "B": ("Cotton jersey", [("tee", "Crew-neck T-shirt"), ("longsleeve", "Long-sleeve T-shirt"), ("kids-tee", "Kids' T-shirt")]),
    "C": ("Cotton fleece", [("hoodie", "Hoodie"), ("sweatshirt", "Sweatshirt"), ("joggers", "Joggers")]),
    "D": ("Cotton jersey", [("tee", "Crew-neck T-shirt"), ("longsleeve", "Long-sleeve T-shirt")]),
    "E": ("Cotton piqué", [("polo", "Men's polo shirt"), ("polo-w", "Women's polo shirt")]),
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
    for key, (set_name, case_id) in BANGLA.items():
        dst = DEMO_ROOT / key / "bangla"
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(ROOT / "data" / "generated" / set_name / case_id, dst / "case")
        run = json.loads((ROOT / "eval" / "runs" / set_name / "C4" / f"{case_id}.json").read_text())
        (dst / "trace.json").write_text(json.dumps(run["trace"], indent=1, default=str))
        print(f"{key} (Bangla logbook): {case_id} -> {run['status']}")
    snapshot_results()


def snapshot_results() -> None:
    # evaluation summaries, so the results page works without the (gitignored) run folders
    results: dict = {}
    for summary in sorted((ROOT / "eval" / "runs").glob("*/*/summary.json")):
        set_name, condition = summary.parent.parent.name, summary.parent.name
        # current conditions only (C1..C6): archived iterations are named C4_v1, C4-v1, C4-stopfix
        if re.fullmatch(r"C\d", condition):
            results.setdefault(set_name, {})[condition] = json.loads(summary.read_text())["summary"]
    # line-finding on logbook photos (eval.localize): raw and square-padded, per model
    for f in sorted((ROOT / "eval" / "runs" / "localize").glob("*/*.json")):
        results.setdefault("localize", {})[f"{f.parent.name}/{f.stem}"] = json.loads(f.read_text())["summary"]
    (DEMO_ROOT / "results.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    snapshot_results() if sys.argv[1:] == ["results"] else build()
