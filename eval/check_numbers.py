"""Recompute the README's trust numbers and the video's spoken numbers from the committed results,
and check that the README still says them.

    .venv/bin/python -m eval.check_numbers

Sources, all in the repository:
- eval/runs/test/<approach>/summary.json: each approach's 120 per-case rows (justified answer, answer
  given, kind of case) from the held-out test. Scoring them again must give data/demo/results.json.
- data/demo/results.json: the held-out test, one score per approach, with its confusion matrix
  (justified answer -> answer given). The trust numbers are worked out from that matrix here, not read
  from a summary: "right" is the justified answer, "asked" is insufficient evidence or review required
  given in place of another answer, and every other answer is a harmful mistake (it cleared a case it
  shouldn't have, or accused without the evidence).
- data/demo/B, C, D: the saved demo investigations the video shows.
- eval/frozen/test_manifest.json: the frozen test set.

Exits with 1 if any number disagrees, so it can run as a test.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
RESULTS = ROOT / "data" / "demo" / "results.json"
DEMO = ROOT / "data" / "demo"
MANIFEST = ROOT / "eval" / "frozen" / "test_manifest.json"
RUNS = ROOT / "eval" / "runs" / "test"

CAUTIOUS = ("insufficient", "review_required")
VERDICTS = ("supports", "contradicts")
# The held-out table's columns, left to right
COLUMNS = ["C1", "C2", "C3", "C4", "C5", "C6", "two_readers"]


@dataclass
class Trust:
    right: int
    cautious: int
    harmful: int
    cleared: int  # gave "supports" where the justified answer was something else
    accused: int  # gave "contradicts" where the justified answer was something else
    verdicts: int  # supports or contradicts given
    trusted: int  # of those, the justified answer

    @property
    def right_or_asked(self) -> int:
        return self.right + self.cautious

    @property
    def trusted_line(self) -> str:
        return f"{round(100 * self.trusted / self.verdicts)}% ({self.trusted} of {self.verdicts})"


def trust(confusion: dict[str, dict[str, int]]) -> Trust:
    t = Trust(0, 0, 0, 0, 0, 0, 0)
    for justified, row in confusion.items():
        for given, k in row.items():
            if given == justified:
                t.right += k
            elif given in CAUTIOUS:
                t.cautious += k
            else:
                t.harmful += k
                t.cleared += k if given == "supports" else 0
                t.accused += k if given == "contradicts" else 0
            if given in VERDICTS:
                t.verdicts += k
                t.trusted += k if given == justified else 0
    return t


class Report:
    def __init__(self) -> None:
        self.failed = 0
        self.skipped = 0

    def check(self, what: str, expected: object, found: object) -> None:
        ok = str(expected) == str(found)
        self.failed += not ok
        print(f"  {'ok      ' if ok else 'MISMATCH'}  {what}: {expected}" + ("" if ok else f"  (README/source says: {found})"))

    def says(self, what: str, phrase: str, text: str) -> None:
        """The README must contain this sentence fragment, with the recomputed numbers in it."""
        ok = phrase in text
        self.failed += not ok
        print(f"  {'ok      ' if ok else 'MISMATCH'}  {what}" + ("" if ok else f"\n            expected the README to say: {phrase!r}"))

    def skip(self, what: str, why: str) -> None:
        self.skipped += 1
        print(f"  skipped   {what}: {why}")


def table(text: str, header_start: str) -> dict[str, list[str]]:
    """A Markdown table from the README, by the start of its header row: {row label: cells}."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(header_start))
    rows = {}
    for line in lines[start + 2:]:
        if not line.startswith("|"):
            break
        cells = [c.strip().replace("**", "") for c in line.strip("|").split("|")]
        rows[cells[0]] = cells[1:]
    return rows


def readme_numbers(r: Report, text: str, test: dict) -> None:
    t = {k: trust(test[k]["confusion"]) for k in COLUMNS}
    spark, glimmer, both, rules = t["C4"], t["C6"], t["two_readers"], t["C1"]

    print("\nAt a glance: the trust table")
    rows = table(text, "| On 120 unseen cases")
    for label, key in [("Muse Spark", "C4"), ("Muse Glimmer, fine-tuned by me", "C6"),
                       ("Both reading, a person settling disagreements", "two_readers"), ("Rules alone", "C1")]:
        r.check(f"{label}: right or asked", t[key].right_or_asked, rows[label][0])
        r.check(f"{label}: harmful", t[key].harmful, rows[label][1])
        r.check(f"{label}: verdicts you can trust", t[key].trusted_line, rows[label][2])

    print("\nAt a glance: the chart's description")
    alt = re.search(r'trust\.svg" alt="([^"]+)"', text).group(1)
    for label, key in [("Muse Spark investigating", "C4"), ("Muse Glimmer", "C6"), ("Both reading", "two_readers"),
                       ("Muse Spark everything at once", "C3"), ("Muse Spark Open", "C5"),
                       ("Rules plus document reading", "C2"), ("Rules alone", "C1")]:
        m = re.search(re.escape(label) + r": (\d+)(?: right or asked)?(?:,| and) (\d+)", alt)
        r.check(f"chart, {label}", f"{t[key].right_or_asked} and {t[key].harmful}", f"{m.group(1)} and {m.group(2)}" if m else "missing")

    print("\nAt a glance: the text")
    r.says("Muse Spark, right or asked and harmful",
           f"It was right, or asked, {spark.right_or_asked} times. It made {spark.harmful} harmful mistakes: "
           f"it cleared {spark.cleared} cases too readily and made {spark.accused} accusations", text)
    r.says("rules alone", f"Rules alone made {rules.harmful}, and {rules.accused} of those were accusations", text)
    c4 = test["C4"]
    if c4["injection_followed"] == 0:
        r.says("planted instructions", f"hid {c4['injection_cases']} planted instructions, and none were followed", text)
    else:
        r.check("planted instructions followed", 0, c4["injection_followed"])

    print("\nThe held-out test table")
    # the 60-case development table starts the same way; the held-out one has the Muse Glimmer column
    rows = table(text, "| | Rules on the meters | Rules + document reading | Muse Spark, everything at once "
                       "| **Muse Spark investigating** | Muse Spark Open investigating | Muse Glimmer investigating")
    measures = {
        "Right answer": lambda k: f"{test[k]['agreement']} / {test[k]['cases']}",
        "Accused without evidence": lambda k: test[k]["unsupported_accusations"],
        "Passed a real problem as fine": lambda k: test[k]["missed_problems"],
        "Held up a clean run": lambda k: test[k]["false_escalations"],
        "Right, or asked for a record or a person": lambda k: t[k].right_or_asked,
        "Harmful mistakes (cleared wrongly + accused wrongly)": lambda k: t[k].harmful,
    }
    for label, value in measures.items():
        found = rows[label]
        r.check(label, " · ".join(str(value(k)) for k in COLUMNS), " · ".join(found))
    r.check("Sent to a person because the readers disagreed", test["two_readers"]["routed_to_a_person"],
            rows["Sent to a person because the readers disagreed"][-1])

    print("\nThe held-out test: the text")
    conf = c4["confusion"]
    false_claims = sum(conf["contradicts"].values())
    r.says("runs where the claim is false",
           f"Of the {false_claims} runs where the evidence shows the claim is false, the investigator called out "
           f"{conf['contradicts'].get('contradicts', 0)}", text)
    r.says("misses and caution", f"Of its {c4['cases'] - spark.right} misses, {spark.cautious} were caution", text)
    r.says("right or asked, and verdicts you can trust",
           f"So it was right, or asked, on {spark.right_or_asked} of {c4['cases']}, and {spark.trusted} of its "
           f"{spark.verdicts} verdicts were ones you can trust", text)
    r.says("everything at once against investigating",
           f"right, or asked, on {t['C3'].right_or_asked} against {spark.right_or_asked}, with {t['C3'].harmful} "
           f"harmful mistakes against {spark.harmful}", text)
    r.says("evidence requests", f"{c4['request_hits']} of {c4['requests_scored']} requests named the right one", text)
    r.says("cost and time", f"About ${c4['mean_cost']:.2f} and {round(c4['mean_seconds'], -1):.0f} seconds", text)
    tr = test["two_readers"]
    r.says("two readers", f"{tr['routed_to_a_person']} of {tr['cases']} cases went to a person and "
           f"{tr['false_escalations']} clean runs were held up", text)

    print("\nMuse Glimmer and Muse Spark Open")
    c6 = test["C6"]
    r.says("Muse Glimmer on the held-out test",
           f"right, or asked, on {glimmer.right_or_asked} of {c6['cases']}, with {glimmer.harmful} harmful mistakes: "
           f"it cleared {glimmer.cleared} cases too readily and made {glimmer.accused} accusations", text)
    r.says("Muse Glimmer, verdicts you can trust", f"{glimmer.trusted} of its {glimmer.verdicts} verdicts were ones you can trust", text)
    r.says("Muse Glimmer, seconds a case", f"about {round(c6['mean_seconds'])} seconds a case", text)
    r.says("Muse Spark Open", f"right or asked on {t['C5'].right_or_asked} of 120, with {t['C5'].harmful} harmful mistakes", text)

    print("\nNumbers from the per-case rows (eval/runs/test)")
    summary = RUNS / "C4" / "summary.json"
    if summary.exists():
        rows_c4 = json.loads(summary.read_text(encoding="utf-8"))["rows"]
        for factory, name in (("factory-a", "A"), ("factory-b", "B")):
            fr = [x for x in rows_c4 if x["case_id"].startswith(factory)]
            conf_f: dict[str, dict[str, int]] = {}
            for x in fr:
                conf_f.setdefault(x["justified"], {}).setdefault(x["predicted"], 0)
                conf_f[x["justified"]][x["predicted"]] += 1
            ft = trust(conf_f)
            r.says(f"factory {name}", f"{ft.right_or_asked} of {len(fr)}, with {ft.harmful}", text)
    else:
        r.skip("factory A and factory B split", "eval/runs/test/C4/summary.json is not in the repository")
    two = RUNS / "two_readers.json"
    if two.exists():
        right, agreed = json.loads(two.read_text(encoding="utf-8"))["right_when_they_agree"].split("/")
        r.says("right when the readers agree", f"they were right {right} times out of {agreed}", text)
    else:
        r.skip("right when the readers agree", "eval/runs/test/two_readers.json is not in the repository")


def results_from_rows(r: Report, test: dict) -> None:
    """results.json's held-out scores, recomputed from the 120 per-case rows of each approach."""
    from eval.metrics import score

    print("\nThe held-out scores in results.json, recomputed from the per-case rows")
    folders = {"C1": "C1", "C2": "C2", "C3": "C3", "C4": "C4", "C5": "C5", "C6": "C6-glimmer-gaps"}
    for key, folder in folders.items():
        path = RUNS / folder / "summary.json"
        if not path.exists():
            r.skip(key, f"{path.relative_to(ROOT)} is not in the repository")
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
        scored = score(rows)
        r.check(f"{key}: {len(rows)} cases, confusion and counts", "same as results.json",
                "same as results.json" if all(scored[k] == test[key][k] for k in SCORED) else
                ", ".join(k for k in SCORED if scored[k] != test[key][k]) + " differ")
    two = RUNS / "two_readers.json"
    if two.exists():
        combined = json.loads(two.read_text(encoding="utf-8"))
        same = all(combined["combined"][k] == test["two_readers"][k] for k in SCORED) and all(
            combined[k] == test["two_readers"][k] for k in ("readers_agree", "routed_to_a_person"))
        r.check("two readers: confusion, counts and cases routed to a person", "same as results.json",
                "same as results.json" if same else "differ")
    else:
        r.skip("two readers", "eval/runs/test/two_readers.json is not in the repository")


# The scoring fields compared between the per-case rows and results.json (not cost or time)
SCORED = ("cases", "agreement", "missed_problems", "false_escalations", "unsupported_accusations",
          "appropriate_abstentions", "unnecessary_abstentions", "no_result", "request_hits", "requests_scored",
          "injection_cases", "injection_followed", "confusion")


def video_numbers(r: Report, test: dict) -> None:
    """Every number spoken in the video, from the saved demo cases and the held-out test (docs/video-numbers.md)."""
    print("\nThe video's spoken numbers")
    b = json.loads((DEMO / "B" / "trace.json").read_text(encoding="utf-8"))
    text = json.dumps(b)

    m = re.search(r'"id": "doc:maintenance-[^"]+", "type": "maintenance_record", "covers": \["\S+ (\d\d):(\d\d)[^"]*", "\S+ (\d\d):(\d\d)', text)
    minutes = (int(m.group(3)) * 60 + int(m.group(4))) - (int(m.group(1)) * 60 + int(m.group(2)))
    r.check("B: the logbook's service is under two hours (minutes)", f"{minutes} < 120", f"{minutes} < 120" if minutes < 120 else f"{minutes}")

    m = re.search(r'"evidence_id": "calc:water_balance@[^"]+", "start": "[^"]+", "end": "[^"]+", "hours": ([\d.]+)', text)
    hours = float(m.group(1))
    r.check("B: low power lasts about five hours", "about 5", f"about {round(hours)}")

    m = re.search(r'"bod_mg_l": ([\d.]+)[^}]*"bod_limit_mg_l": ([\d.]+)', text)
    bod, limit = float(m.group(1)), float(m.group(2))
    r.check("B: the lab's BOD is twice the stated limit", "2× (60.9 against 30)", f"{round(bod / limit)}× ({bod} against {limit:g})")

    c_before = json.loads((DEMO / "C" / "trace.json").read_text(encoding="utf-8"))["final"]["status"]
    c_after = json.loads((DEMO / "C" / "trace-after.json").read_text(encoding="utf-8"))["final"]["status"]
    r.check("C: asks for the tank log, then supports the claim with it", "insufficient -> supports", f"{c_before} -> {c_after}")

    d_spark = json.loads((DEMO / "D" / "trace.json").read_text(encoding="utf-8"))["final"]["status"]
    d_glim = json.loads((DEMO / "D" / "second_reader.json").read_text(encoding="utf-8"))
    r.check("D: Spark contradicts, Glimmer says not enough evidence, so the readers disagree",
            "contradicts / insufficient / disagree", f"{d_spark} / {d_glim['status']} / {'agree' if d_glim['agrees'] else 'disagree'}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    factories = sorted({row["case_id"].rsplit("-", 1)[0] for row in manifest["rows"]})
    r.check("120 unseen simulated cases, from two factories", "120 cases, 2 factories", f"{manifest['cases']} cases, {len(factories)} factories")

    spark, both = trust(test["C4"]["confusion"]), trust(test["two_readers"]["confusion"])
    r.check("Spark made eight harmful mistakes", 8, spark.harmful)
    r.check("two readers reduced that to four", 4, both.harmful)
    r.check("while sending 25 cases to a person", 25, test["two_readers"]["routed_to_a_person"])


def main() -> int:
    test = json.loads(RESULTS.read_text(encoding="utf-8"))["test"]
    r = Report()
    print("Recomputed from the per-case rows, data/demo/results.json and the saved demo cases; checked against README.md")
    results_from_rows(r, test)
    readme_numbers(r, README.read_text(encoding="utf-8"), test)
    video_numbers(r, test)
    print(f"\n{'All numbers match.' if not r.failed else f'{r.failed} number(s) disagree.'}"
          + (f" {r.skipped} skipped (their source files are not in the repository)." if r.skipped else ""))
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main())
