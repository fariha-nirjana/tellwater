"""Build the dev and held-out test case sets, and freeze the test set.

    .venv/bin/python -m eval.caseset dev
    .venv/bin/python -m eval.caseset test --freeze

The test set uses different seeds, different operating patterns and a
second factory (factory B) that nothing was tuned on. Freezing writes the
case IDs, the generation specs and a SHA-256 of every generated file to
eval/frozen/, to be committed before any test case is run. Regenerating
must reproduce the same hash.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import EventType, build_scenario
from store.cases import ROOT, save_case

GENERATED = ROOT / "data" / "generated"
FROZEN = ROOT / "eval" / "frozen"

KIND_WEIGHTS = {
    EventType.NORMAL: 0.14, EventType.LOW_PRODUCTION: 0.08, EventType.MAINTENANCE: 0.14,
    EventType.SHUTDOWN: 0.10, EventType.BYPASS: 0.10, EventType.DILUTION: 0.10,
    EventType.AERATORS_DOWN: 0.12, EventType.REPLAY: 0.08, EventType.SENSOR_FAULT: 0.14,
}
DROPPABLE = ["S4a", "S4b", "S2", "S3", "S4c", "S1"]
DROP_WEIGHTS = np.array([0.25, 0.25, 0.15, 0.15, 0.1, 0.1])

SETS = {
    "dev": [("factory", 10_000, 60)],
    "test": [("factory", 50_000, 60), ("factory_b", 60_000, 60)],
}
# Scale experiment: the same 20 scenarios with 3, 14 and 45 days of recorded data
# (the extra days are normal operation before the case window, one logbook page each).
SCALE_HISTORY = {"scale_3": 0, "scale_14": 11, "scale_45": 42}
for _name in SCALE_HISTORY:
    SETS[_name] = [("factory", 20_000, 20)]
# Tuning sets with fixed kinds, for weaknesses the dev mix covers thinly. Never the test set.
FIXED_KINDS = {"tune_replay": ["replay"] * 10 + ["normal"] * 4 + ["maintenance"] * 3 + ["sensor_fault"] * 3}
SETS["tune_replay"] = [("factory", 30_000, 20)]
# Fresh cases for spot-checking the distilled model: never trained on, never the test set.
SETS["check"] = [("factory", 40_000, 8)]
# Fresh factory B cases for a sanity check before the frozen test (half of which is factory B). Never the test set.
SETS["check_b"] = [("factory_b", 70_000, 10)]


def specs(factory: str, seed0: int, n: int, fixed: list[str] | None = None) -> list[dict]:
    rng = np.random.default_rng(seed0)
    kinds = list(KIND_WEIGHTS)
    weights = np.array([KIND_WEIGHTS[k] for k in kinds])
    out = []
    for i in range(n):
        kind = kinds[int(rng.choice(len(kinds), p=weights / weights.sum()))]
        if fixed:
            kind = EventType(fixed[i])
        missing: tuple[str, ...] = ()
        if rng.random() < 0.35:
            k = 1 if rng.random() < 0.7 else 2
            missing = tuple(rng.choice(DROPPABLE, size=k, replace=False, p=DROP_WEIGHTS / DROP_WEIGHTS.sum()).tolist())
        tank = not (rng.random() < (0.35 if kind is EventType.MAINTENANCE else 0.25))
        out.append({"factory": factory, "kind": kind.value, "seed": seed0 + i, "missing": list(missing), "tank_level_available": tank})
    return out


def _hash_folder(folder: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        h.update(path.relative_to(folder).as_posix().encode())
        h.update(path.read_bytes())
    return h.hexdigest()


def build(name: str) -> list[dict]:
    root = GENERATED / name
    rows = []
    for factory, seed0, n in SETS[name]:
        cfg = load_factory(factory)
        for spec in specs(factory, seed0, n, FIXED_KINDS.get(name)):
            sc = build_scenario(spec["kind"], spec["seed"], cfg, missing=tuple(spec["missing"]),
                                tank_level_available=spec["tank_level_available"], history_days=SCALE_HISTORY.get(name, 0))
            case = generate(sc, cfg)
            folder = save_case(case, label(case, cfg), root, factory_name=factory)
            rows.append({"case_id": sc.id, **spec, "sha256": _hash_folder(folder)})
    return rows


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("name", choices=list(SETS))
    p.add_argument("--freeze", action="store_true")
    a = p.parse_args()
    rows = build(a.name)
    statuses = Counter(json.loads((GENERATED / a.name / r["case_id"] / "hidden" / "label.json").read_text())["justified"]
                       for r in rows)
    print(f"{a.name}: {len(rows)} cases; kinds {dict(Counter(r['kind'] for r in rows))}")
    print(f"justified statuses {dict(statuses)}")
    if a.freeze:
        FROZEN.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256("".join(r["sha256"] for r in rows).encode()).hexdigest()
        manifest = {"set": a.name, "cases": len(rows), "sha256_of_all_cases": digest,
                    "note": "Frozen before any test case was run. Regenerating must reproduce every hash.",
                    "rows": [{k: r[k] for k in ("case_id", "factory", "seed", "sha256")} for r in rows]}
        (FROZEN / f"{a.name}_manifest.json").write_text(json.dumps(manifest, indent=2))
        # the generation specs name the scenario kind, so they live with the hidden data
        (GENERATED / a.name / "specs.json").write_text(json.dumps(rows, indent=2))
        print(f"frozen: {digest}")


if __name__ == "__main__":
    main()
