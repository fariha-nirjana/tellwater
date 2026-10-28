"""Run one condition over a case set and score it.

    .venv/bin/python -m eval.run_set dev C1
    .venv/bin/python -m eval.run_set dev C4 --workers 6
    .venv/bin/python -m eval.run_set dev C5 --workers 6

Conditions:
  C1  rules on structured signals
  C2  C1 plus a fixed document extraction (Muse Spark reads each document once)
  C3  Muse Spark with the complete evidence bundle, no tools
  C4  investigator with tools, Muse Spark (Meta Model API)
  C5  investigator with tools, Muse Spark Open (Fireworks; --host baseten for Baseten)

Results go to eval/runs/<set>/<condition>/: one trace per case, plus
summary.json. Runs already present are reused, so an interrupted run can
resume; pass --fresh to start over.
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from agent import bundle_pass
from agent.loop import investigate
from agent.loop import PRICES
from agent.models import ModelClient, ModelEndpoint
from eval import c1_rules, c2_extract
from eval.caseset import GENERATED
from eval.metrics import request_text, score
from sim.baseline import power_model
from store.cases import ROOT, load_bundle, load_label

RUNS = ROOT / "eval" / "runs"


def _case_dirs(name: str) -> list[Path]:
    return sorted(p for p in (GENERATED / name).iterdir() if (p / "case.json").exists())


def _hidden(folder: Path) -> dict:
    scenario = json.loads((folder / "hidden" / "scenario.json").read_text())
    docs = json.loads((folder / "hidden" / "documents_full.json").read_text())
    injected = any(d["type"] == "operator_statement" and "AUDIT SYSTEM" in d["content"].get("text", "") for d in docs)
    return {"kind": scenario["kind"], "injection": injected}


def run_c1(folder: Path) -> dict:
    from sim.config import load_factory

    bundle = load_bundle(folder)
    pm = power_model(bundle.factory_config)
    import pandas as pd

    from sim.generator import Batch

    b = bundle.target_batch
    batch = Batch(b["id"], pd.Timestamp(b["start"]), pd.Timestamp(b["end"]), b["shade"], b["planned_wastewater_m3"])

    class _Case:  # c1_rules reads only the recorded signals
        signals = bundle.signals

    r = c1_rules.assess(_Case, batch, load_factory(bundle.factory_config), pm)
    return {"status": r["status"], "final": None, "detail": r}


def run_c2(folder: Path, endpoint: ModelEndpoint) -> dict:
    bundle = load_bundle(folder)
    c1 = run_c1(folder)
    extracted = c2_extract.extract(bundle, ModelClient(endpoint))
    r = c2_extract.assess(bundle, c1["detail"], extracted, power_model(bundle.factory_config))
    u = extracted["usage"]
    price = PRICES[endpoint.model]
    cost = round((u["prompt_tokens"] * price[0] + u["completion_tokens"] * price[2]) / 1e6, 4)
    return {"status": r["status"], "final": None, "detail": {"c1": c1["detail"], **r}, "extracted": extracted, "cost": cost}


def run_agent(folder: Path, endpoint: ModelEndpoint, condition: str = "C4") -> dict:
    run = bundle_pass.assess if condition == "C3" else investigate
    trace = run(load_bundle(folder), ModelClient(endpoint))
    return {"status": trace.status, "final": trace.final, "trace": json.loads(trace.to_json()),
            "cost": trace.cost_usd, "seconds": trace.seconds, "checks": trace.checks_used, "valid": trace.valid,
            "error": trace.error}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("set")
    p.add_argument("condition", choices=["C1", "C2", "C3", "C4", "C5"])
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--limit", type=int)
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--host", choices=["fireworks", "baseten"], default="fireworks", help="C5 only")
    a = p.parse_args()

    out_dir = RUNS / a.set / a.condition
    out_dir.mkdir(parents=True, exist_ok=True)
    folders = _case_dirs(a.set)[: a.limit]
    endpoint = None
    if a.condition in ("C2", "C3", "C4"):
        endpoint = ModelEndpoint.muse_spark()
    elif a.condition == "C5":
        endpoint = ModelEndpoint.muse_spark_open_fireworks() if a.host == "fireworks" else ModelEndpoint.muse_spark_open()

    def one(folder: Path) -> dict:
        path = out_dir / f"{folder.name}.json"
        if path.exists() and not a.fresh:
            return json.loads(path.read_text())
        if a.condition == "C1":
            result = run_c1(folder)
        elif a.condition == "C2":
            result = run_c2(folder, endpoint)
        else:
            result = run_agent(folder, endpoint, a.condition)
        result["case_id"] = folder.name
        path.write_text(json.dumps(result, indent=2, default=str))
        return result

    results = []
    with ThreadPoolExecutor(a.workers) as pool:
        futures = {pool.submit(one, f): f for f in folders}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            results.append(r)
            print(f"[{i}/{len(folders)}] {r['case_id']} -> {r['status']}", flush=True)

    rows = []
    for r in results:
        folder = GENERATED / a.set / r["case_id"]
        lab = load_label(folder)
        rows.append({"case_id": r["case_id"], "justified": lab["justified"], "predicted": r["status"],
                     "wanted": (lab.get("evidence_request") or {}).get("items"), "request": request_text(r.get("final")),
                     "cost": r.get("cost"), "seconds": r.get("seconds"), "checks": r.get("checks"), "valid": r.get("valid"),
                     **_hidden(folder)})
    summary = score(rows)
    summary["condition"] = a.condition
    (out_dir / "summary.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps({k: v for k, v in summary.items() if k != "confusion"}, indent=1))
    print("confusion (justified -> predicted):", json.dumps(summary["confusion"]))


if __name__ == "__main__":
    main()
