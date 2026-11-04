"""Put the demo back at its starting point: B decided by a reviewer, C's evidence request unanswered,
D held with its two readings undecided, no live runs, no factory replies.

    .venv/bin/python deploy/reset_demo.py --hosted                       # the Modal demo
    .venv/bin/python deploy/reset_demo.py --local <runtime dir> --base http://localhost:8000

Kept: cached passport translations and letters (keyed by their exact text, so they stay valid) and the
day's usage counts. For --local, start the API with TW_RUNTIME_DIR=<runtime dir> so nothing it writes
lands in data/demo, where a live run of C would overwrite the shipped run.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOSTED = "https://fariha-nirjana--tellwater-web.us-east.modal.run"
VOLUME = "tellwater-runtime"
CASES = ["A", "B", "C", "D", "E"]
# what a visit can write per case: live runs, runs after a factory submission, their second readings
PER_CASE = ["trace-live.json", "trace-after.json", "second_reader-live.json", "second_reader-after.json"]

B_REVIEW = {
    "action": "approve",
    "reviewer": "Buyer's reviewer (demo)",
    "reason": ("Approved. The logbook records the aerator service from 11:40 to 13:20, but power stayed below "
               "the band the inflow needs until 16:45; the meter photo matches the feed, and the outfall sample "
               "at 16:10 shows BOD 60.9 mg/L against a limit of 30. The records do not support the claim that "
               "this batch's wastewater was treated."),
}


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"{}")


def stop_hosted_containers() -> None:
    """A running container saves its view of the volume every 30 s, which could put old state back."""
    out = subprocess.run([sys.executable, "-m", "modal", "container", "list", "--json"],
                         capture_output=True, text=True, check=True).stdout
    for c in json.loads(out or "[]"):
        if "tellwater" in json.dumps(c) and "glimmer" not in json.dumps(c).lower():
            cid = c.get("Container ID") or c.get("container_id") or c.get("id")
            print(f"stopping container {cid}")
            subprocess.run([sys.executable, "-m", "modal", "container", "stop", cid], check=True)
    time.sleep(3)


def clear_hosted() -> None:
    import modal

    vol = modal.Volume.from_name(VOLUME)
    present = {e.path.lstrip("/") for e in vol.listdir("/", recursive=True)}
    for path in ["state.json"] + [f"{k}/{name}" for k in CASES for name in PER_CASE]:
        if path in present:
            vol.remove_file(path)
            print(f"removed {path}")


def clear_local(runtime: Path) -> None:
    if runtime.resolve() == (Path(__file__).resolve().parents[1] / "data" / "demo").resolve():
        sys.exit("refusing: that is data/demo, where the shipped runs live; use a separate TW_RUNTIME_DIR")
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "state.json").unlink(missing_ok=True)
    for k in CASES:
        shutil.rmtree(runtime / k, ignore_errors=True)
    print(f"cleared {runtime}")


def check(base: str) -> None:
    """Fails loudly unless the demo is exactly at its starting point."""
    cases = {x["key"]: x for x in call(base, "GET", "/api/cases")}
    signed = call(base, "GET", "/api/passport/B/verify")
    want = {"B": "contradicts", "C": "insufficient", "D": "pending_review"}
    for k, status in want.items():
        print(f"{k}: {cases[k]['status']}" + (" (held: two readers disagree)" if cases[k]["held"] else ""))
    print("B signed record:", json.dumps(signed)[:160])
    wrong = [k for k, s in want.items() if cases[k]["status"] != s]
    if wrong or not cases["D"]["held"]:
        sys.exit(f"NOT at the starting point: {wrong or 'D not held'}")
    print("demo is at its starting point")


def main() -> None:
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--hosted", action="store_true")
    g.add_argument("--local", type=Path, metavar="RUNTIME_DIR")
    p.add_argument("--base", default=None, help="the API's address (default: the hosted demo)")
    a = p.parse_args()
    base = (a.base or HOSTED).rstrip("/")
    if a.hosted:
        stop_hosted_containers()
        clear_hosted()
    else:
        if not a.base:
            sys.exit("--local needs --base, the address of the API started with that TW_RUNTIME_DIR")
        clear_local(a.local)
    entry = call(base, "POST", "/api/cases/B/review", B_REVIEW)
    print(f"B decided at {entry['at']}")
    check(base)


if __name__ == "__main__":
    main()
