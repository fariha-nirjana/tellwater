"""Honest cases built around the real handwritten logbook pages, to see whether
a misread page can make the investigator accuse an honest factory.

For each of the four pages in data/handwritten/ there is one simulated case
whose meters agree with what the page says: the event day is the page's date,
an ETP stop (pages 2 and 4) runs exactly over the page's stop, and the outfall
pH at each shift start rounds to the page's reading (a seed is searched for
that). Two copies of each case are written, identical except for the logbook
page:

  hw_typed   the page's entries rendered by the simulator (the usual fonts)
  hw_photo   Anika's phone photo of the real handwritten page

Both are honest, so the justified answer is "supports". Any accusation, or any
difference between the two copies, comes from reading the page.

With a typed maintenance record beside it, the stop times never rest on the
handwriting. The `_norecord` sets leave the record out for the two stop pages,
so the handwritten page is the only document that states the stop.

  .venv/bin/python -m eval.handwriting_cases
  .venv/bin/python -m eval.run_set hw_typed C4
  .venv/bin/python -m eval.run_set hw_photo C4
  (and hw_typed_norecord, hw_photo_norecord)
"""

from __future__ import annotations

import hashlib
import json
import shutil

import pandas as pd

from eval.caseset import GENERATED
from sim.bangla import localize_logbook
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import DocPlan, Event, EventType, MaintenanceNote, build_scenario
from store.cases import ROOT, save_case

PAGES = ROOT / "data" / "handwritten"
SEED0 = 90_000


def _e(time, text, struck=False, written=None):
    return {"time": time, "text": text, "crossed_out": struck, "late": bool(written), **({"written": written} if written else {})}


# What is on each page (data/handwritten/answer-key.md), in the simulator's English
# wording; the Bangla pages are localized with the approved wording.
PAGE = {
    "page1": {"date": "2026-10-14", "operator": "R. Karim", "bn": False, "ph": (7.3, 7.4, 7.2), "stop": None, "wo": None,
              "entries": [_e("06:00", "Shift A start. ETP running normal. Outfall pH 7.3"),
                          _e("06:25", "Lime dosed 30 kg", struck=True), _e("06:30", "Lime dosed 35 kg"),
                          _e("09:45", "Sludge removed from clarifier"),
                          _e("14:00", "Shift B start. ETP running normal. Outfall pH 7.4"), _e("14:25", "Lime dosed 40 kg"),
                          _e("22:00", "Shift C start. ETP running normal. Outfall pH 7.2"), _e("22:20", "Lime dosed 30 kg")]},
    "page2": {"date": "2026-10-15", "operator": "S. Akter", "bn": False, "ph": (7.5, 7.6, 7.3), "stop": ("11:40", "14:20"),
              "wo": "WO-1015-07",
              "entries": [_e("06:00", "Shift A start. ETP running normal. Outfall pH 7.5"), _e("06:25", "Lime dosed 35 kg"),
                          _e("11:40", "ETP stopped for planned maintenance (WO-1015-07). Tank taking inflow"),
                          _e("14:00", "Shift B start. ETP stopped. Outfall pH 7.6"),
                          _e("14:20", "ETP restarted. Running normal"),
                          _e("15:10", "Aerator 2 serviced. Other units running", written="17:45"),
                          _e("16:30", "Aerator back in service"),
                          _e("22:00", "Shift C start. ETP running normal. Outfall pH 7.3")]},
    "page3": {"date": "2026-10-16", "operator": "M. Hossain", "bn": True, "ph": (7.4, 7.3, 7.2), "stop": None, "wo": None,
              "entries": [_e("06:00", "Shift A start. ETP running normal. Outfall pH 7.4"),
                          _e("06:25", "Lime dosed 35 kg", struck=True), _e("06:30", "Lime dosed 35 kg"),
                          _e("09:45", "Sludge removed from clarifier"),
                          _e("14:00", "Shift B start. ETP running normal. Outfall pH 7.3"), _e("14:25", "Lime dosed 40 kg"),
                          _e("22:00", "Shift C start. ETP running normal. Outfall pH 7.2")]},
    "page4": {"date": "2026-10-17", "operator": "N. Islam", "bn": True, "ph": (7.5, 7.3, 7.4), "stop": ("12:30", "15:40"),
              "wo": "WO-1017-12",
              "entries": [_e("06:00", "Shift A start. ETP running normal. Outfall pH 7.5"), _e("06:25", "Lime dosed 30 kg"),
                          _e("12:30", "ETP stopped for planned maintenance (WO-1017-12). Tank taking inflow"),
                          _e("14:00", "Shift B start. ETP stopped. Outfall pH 7.3"),
                          _e("15:40", "ETP restarted. Running normal"),
                          _e("16:10", "ETP feed pump serviced. Other units running", written="18:05"),
                          _e("17:30", "ETP feed pump back in service"),
                          _e("22:00", "Shift C start. ETP running normal. Outfall pH 7.4")]},
}
# Page 2 says "Aerator back in service" (no "2"); the approved Bangla rules need the
# equipment name, but page 2 is English, so it stays as written.


def _case(page: str, seed: int, cfg, record: bool = True):
    p = PAGE[page]
    day = pd.Timestamp(p["date"], tz=cfg.timezone)
    sc = build_scenario(EventType.NORMAL if not p["stop"] else EventType.MAINTENANCE, seed, cfg,
                        start=day - pd.Timedelta(hours=18), tank_level_available=True, photo=False, lab=False,
                        case_id=f"hw-{hashlib.sha256(f'{page}|{seed}'.encode()).hexdigest()[:8]}")
    sc.docs = DocPlan()
    if p["stop"]:
        t0, t1 = (day + pd.Timedelta(f"{t}:00") for t in p["stop"])
        sc.events = [Event(EventType.MAINTENANCE, t0, t1)]
        if record:
            sc.docs.maintenance_note = MaintenanceNote("ETP aeration and feed system", t0, t1, honest=True,
                                                       written_at=t0 - pd.Timedelta(days=2))
    case = generate(sc, cfg)
    return case, day


def _matches(case, day, page) -> bool:
    ph = case.truth["S4b"]
    for hour, want in zip((6, 14, 22), PAGE[page]["ph"]):
        t = day + pd.Timedelta(hours=hour)
        if round(float(ph.iloc[ph.index.get_indexer([t], method="nearest")[0]]), 1) != want:
            return False
    return True


def build(page: str, cfg, suffix: str = "", tries: int = 4000) -> dict:
    p = PAGE[page]
    for seed in range(SEED0 + 1000 * int(page[-1]), SEED0 + 1000 * int(page[-1]) + tries):
        case, day = _case(page, seed, cfg, record=not suffix)
        if not _matches(case, day, page):
            continue
        lab = label(case, cfg)
        if lab.justified != "supports":
            continue
        log = next(d for d in case.documents if d.type == "logbook")
        log.content = {"date": f"{day:%d/%m/%Y}", "operator": p["operator"], "entries": [dict(e) for e in p["entries"]]}
        log.author = p["operator"]
        if p["bn"]:
            localize_logbook(log)
        for d in case.documents:
            if d.type == "maintenance_record" and p["wo"]:
                d.content["work_order"] = p["wo"]
        typed = save_case(case, lab, GENERATED / f"hw_typed{suffix}", factory_name="factory")
        photo = GENERATED / f"hw_photo{suffix}" / typed.name
        if photo.exists():
            shutil.rmtree(photo)
        shutil.copytree(typed, photo)
        _swap_photo(photo, log.id, PAGES / f"{page}.jpg")
        return {"page": page, "case_id": typed.name, "seed": seed, "justified": lab.justified}
    raise RuntimeError(f"no seed in {tries} matched {page}'s pH readings")


def _swap_photo(folder, doc_id, src) -> None:
    """Replace the rendered logbook page with the real photo, keeping every other file identical."""
    for name in ("documents.json", "hidden/documents_full.json"):
        path = folder / name
        docs = json.loads(path.read_text(encoding="utf-8"))
        for d in docs:
            if d["id"] == doc_id:
                shutil.copy(src, folder / d["image"])
                d["sha256"] = hashlib.sha256((folder / d["image"]).read_bytes()).hexdigest()
                d.get("meta", {}).pop("lines", None)  # the line boxes belong to the rendered page
        path.write_text(json.dumps(docs, indent=2), encoding="utf-8")


def main() -> None:
    cfg = load_factory("factory")
    for suffix, pages in (("", list(PAGE)), ("_norecord", [p for p in PAGE if PAGE[p]["stop"]])):
        for out in (f"hw_typed{suffix}", f"hw_photo{suffix}"):
            if (GENERATED / out).exists():
                shutil.rmtree(GENERATED / out)
        rows = [build(page, cfg, suffix) for page in pages]
        for out in (f"hw_typed{suffix}", f"hw_photo{suffix}"):
            (GENERATED / out / "specs.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
        for r in rows:
            print(suffix or "with record", r)


if __name__ == "__main__":
    main()
