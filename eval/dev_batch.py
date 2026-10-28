"""Run the investigator on a small spread of dev cases and print a table.

    .venv/bin/python -m eval.dev_batch [--open] [--workers 4]
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor

from agent.loop import investigate
from agent.models import ModelClient, ModelEndpoint
from eval.run_case import DEV, RUNS
from sim.baseline import power_model
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import build_scenario
from store.cases import load_bundle, save_case

SPREAD = [
    ("replay", 4, {"photo": True, "lab": False}),
    ("maintenance", 11, {}),
    ("bypass", 12, {"missing": ("S4a", "S4b")}),
    ("dilution", 13, {}),
    ("sensor_fault", 14, {}),
    ("normal", 15, {}),
    ("aerators_down", 16, {"photo": False, "lab": True}),
    ("shutdown", 17, {}),
    # factory statements that try to instruct the auditing system
    ("shutdown", 20, {"adversarial": True}),
    ("aerators_down", 21, {"adversarial": True}),
]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--open", action="store_true")
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()
    cfg = load_factory()
    pm = power_model()
    endpoint = ModelEndpoint.muse_spark_open() if a.open else ModelEndpoint.muse_spark()

    def run(spec):
        kind, seed, kw = spec
        case = generate(build_scenario(kind, seed, cfg, **kw), cfg)
        lab = label(case, cfg)
        folder = save_case(case, lab, DEV)
        trace = investigate(load_bundle(folder), ModelClient(endpoint), pm)
        RUNS.mkdir(parents=True, exist_ok=True)
        (RUNS / f"{case.scenario.id}-{endpoint.name}.json").write_text(trace.to_json())
        return case.scenario.id, kind, lab, trace

    with ThreadPoolExecutor(a.workers) as pool:
        results = list(pool.map(run, SPREAD))
    print(f"{"case":20} {"kind":15} {"oracle":16} {"agent":16} ok  valid checks  secs   cost")
    for cid, kind, lab, t in results:
        ok = "yes" if t.status == lab.justified else "NO"
        print(f"{cid:20} {kind:15} {lab.justified:16} {str(t.status):16} {ok:3} {str(t.valid):5} {t.checks_used:>6} {t.seconds:>5} {t.cost_usd}"
              + (f"  ERROR {t.error}" if t.error else ""))
    total = sum(t.cost_usd or 0 for *_, t in results)
    print(f"agreement {sum(t.status == l.justified for _, _, l, t in results)}/{len(results)}, total cost ${total:.3f}")


if __name__ == "__main__":
    main()
