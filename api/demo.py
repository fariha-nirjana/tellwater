"""The five demo cases the interface opens with, copied into data/demo/ so
the app runs from a fresh clone without regenerating anything.

    .venv/bin/python -m api.demo            (case copies, saved investigations and the results snapshot)
    .venv/bin/python -m api.demo results    (the results snapshot only)
    .venv/bin/python -m api.demo real       (cases with a handwritten page, before their run and the build)

A  maintenance, cleared: the tank log shows the water was held
B  aeration cut: the photo confirms low power, the lab shows treatment failed
C  maintenance with the tank log missing: the investigator asks for it
D  a second supplier (factory B): raw alkaline water reached the outfall, a bypass
E  factory B again: extra outfall water with falling conductivity, possible dilution; a person decides

A to C are development cases; D and E are from the factory B check set (results page, "a second factory").
Nothing here comes from the held-out test set.

Case B's logbook page is a real handwritten page (data/handwritten/page6.jpg,
copied by hand from the simulated page, same entries). Its case is made with
`python -m api.demo real` into data/generated/demo_real/ and investigated
there (`python -m eval.run_set demo_real C4`) before the build copies it.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys

from store.cases import ROOT

DEMO_ROOT = ROOT / "data" / "demo"
DEMO = {
    "A": ("dev", "factory-a-54b2c9cb"),
    "B": ("demo_real", "factory-a-460f93ca"),
    "C": ("dev", "factory-a-6e86676d"),
    "D": ("check_b", "factory-b-e257c871"),
    "E": ("check_b", "factory-b-50fe9672"),
}
# Demo cases whose simulated logbook page is replaced by the same page written by hand and photographed:
# key -> (source set, page photo in data/handwritten/, logbook document). Line boxes: <page>-lines.json beside it.
REAL_PAGES = {"B": ("dev", "page6", "doc:logbook-1013")}
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
        run = json.loads((ROOT / "eval" / "runs" / set_name / "C4" / f"{case_id}.json").read_text(encoding="utf-8"))
        (dst / "trace.json").write_text(json.dumps(run["trace"], indent=1, default=str), encoding="utf-8")
        print(f"{key}: {case_id} -> {run['status']}")
    for key, (set_name, case_id) in BANGLA.items():
        dst = DEMO_ROOT / key / "bangla"
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(ROOT / "data" / "generated" / set_name / case_id, dst / "case")
        run = json.loads((ROOT / "eval" / "runs" / set_name / "C4" / f"{case_id}.json").read_text(encoding="utf-8"))
        (dst / "trace.json").write_text(json.dumps(run["trace"], indent=1, default=str), encoding="utf-8")
        print(f"{key} (Bangla logbook): {case_id} -> {run['status']}")
    snapshot_results()


def real_pages() -> None:
    """Copy each case with a handwritten page into data/generated/demo_real/, the photo in place of the rendered page."""
    pages = ROOT / "data" / "handwritten"
    for key, (source, page, doc_id) in REAL_PAGES.items():
        case_id = DEMO[key][1]
        dst = ROOT / "data" / "generated" / "demo_real" / case_id
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(ROOT / "data" / "generated" / source / case_id, dst)
        lines = json.loads((pages / f"{page}-lines.json").read_text(encoding="utf-8"))
        for name in ("documents.json", "hidden/documents_full.json"):
            docs = json.loads((dst / name).read_text(encoding="utf-8"))
            for d in docs:
                if d["id"] == doc_id:
                    shutil.copy(pages / f"{page}.jpg", dst / d["image"])
                    d["sha256"] = hashlib.sha256((dst / d["image"]).read_bytes()).hexdigest()
                    if "meta" in d:
                        d["meta"]["lines"] = lines
            (dst / name).write_text(json.dumps(docs, indent=2), encoding="utf-8")
        print(f"{key}: {case_id} with the handwritten {page} -> data/generated/demo_real/")


def snapshot_results() -> None:
    # evaluation summaries, so the results page works without the (gitignored) run folders
    from agent.glimmer import PUBLISHED_RUNS

    results: dict = {}
    for summary in sorted((ROOT / "eval" / "runs").glob("*/*/summary.json")):
        set_name, condition = summary.parent.parent.name, summary.parent.name
        # current conditions only (C1..C6): archived iterations are named C4_v1, C4-v1, C4-stopfix
        # C6b is base Muse Glimmer, for what the fine-tune added (eval/frozen/base_glimmer_rule.md)
        if (re.fullmatch(r"C\d", condition) and condition != "C6") or condition == "C6b":
            results.setdefault(set_name, {})[condition] = json.loads(summary.read_text(encoding="utf-8"))["summary"]
        elif condition == PUBLISHED_RUNS:  # C6 is the published Muse Glimmer adapter, not the first Fireworks one
            results.setdefault(set_name, {})["C6"] = json.loads(summary.read_text(encoding="utf-8"))["summary"]
    # Muse Spark and Muse Glimmer as two readers (eval.two_readers): the combined score, without the per-case list
    for f in sorted((ROOT / "eval" / "runs").glob("*/two_readers.json")):
        two = json.loads(f.read_text(encoding="utf-8"))
        results.setdefault(f.parent.name, {})["two_readers"] = {**two["combined"], "readers_agree": two["readers_agree"],
                                                                 "routed_to_a_person": two["routed_to_a_person"],
                                                                 "mean_seconds": None, "mean_cost": None}  # those are C4's alone
    # line-finding on logbook photos (eval.localize): raw and square-padded, per model
    for f in sorted((ROOT / "eval" / "runs" / "localize").glob("*/*.json")):
        results.setdefault("localize", {})[f"{f.parent.name}/{f.stem}"] = json.loads(f.read_text(encoding="utf-8"))["summary"]
    (DEMO_ROOT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    {"results": snapshot_results, "real": real_pages}.get(sys.argv[1] if sys.argv[1:] else "", build)()
