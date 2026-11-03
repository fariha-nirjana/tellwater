"""Generate one dev case and run the investigator on it, printing each step.

    .venv/bin/python -m eval.run_case replay 4 --photo --open
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from agent.loop import investigate
from agent.models import ModelClient, ModelEndpoint
from sim.baseline import power_model
from sim.config import load_factory
from sim.generator import generate
from sim.oracle import label
from sim.scenarios import build_scenario
from store.cases import ROOT, load_bundle, save_case

DEV = ROOT / "data" / "generated" / "dev"
RUNS = ROOT / "eval" / "runs"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("kind")
    p.add_argument("seed", type=int)
    p.add_argument("--photo", action="store_true", default=None)
    p.add_argument("--no-photo", dest="photo", action="store_false")
    p.add_argument("--lab", action="store_true", default=None)
    p.add_argument("--no-lab", dest="lab", action="store_false")
    p.add_argument("--missing", default="")
    p.add_argument("--no-tank", action="store_true")
    p.add_argument("--open", action="store_true", help="use Muse Spark Open on Baseten")
    a = p.parse_args()

    cfg = load_factory()
    sc = build_scenario(a.kind, a.seed, cfg, photo=a.photo, lab=a.lab,
                        missing=tuple(s for s in a.missing.split(",") if s), tank_level_available=not a.no_tank)
    case = generate(sc, cfg)
    lab = label(case, cfg)
    folder = save_case(case, lab, DEV)
    print(f"case {sc.id}: oracle says {lab.justified} (underlying {lab.underlying})")

    endpoint = ModelEndpoint.muse_spark_open() if a.open else ModelEndpoint.muse_spark()

    def show(step):
        r = step["result"]
        brief = r.get("error") or {k: r[k] for k in list(r)[:4] if k not in ("series", "signals", "documents")}
        print(f"  {step['n']:>2}. {step['tool']}  {json.dumps(step['args'], default=str)[:110]}")
        if step["why"]:
            print(f"      why: {step['why']}")
        print(f"      -> {json.dumps(brief, default=str)[:220]}")

    trace = investigate(load_bundle(folder), ModelClient(endpoint), power_model(), on_step=show)
    RUNS.mkdir(parents=True, exist_ok=True)
    out = RUNS / f"{sc.id}-{endpoint.name}.json"
    out.write_text(trace.to_json(), encoding="utf-8")
    print(f"\nstatus: {trace.status}   oracle: {lab.justified}   valid: {trace.valid}   error: {trace.error}")
    print(f"checks {trace.checks_used}, turns {trace.turns}, {trace.seconds}s, tokens {trace.prompt_tokens}+{trace.completion_tokens}, cost {trace.cost_usd}")
    if trace.final:
        print("summary:", trace.final.get("summary") or trace.final)
    print("validation:", trace.validation)
    print("trace saved to", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
