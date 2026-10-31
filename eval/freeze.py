"""The investigator, frozen before the held-out test.

Fingerprints every file that decides what the investigator sees, does or
answers (prompt, tools, loop, validator, physics, the rules baselines and the
scoring), so the test run can show none of them changed after the freeze.
Model plumbing (endpoints, the Glimmer client) is left out: where a model is
served may change, what it is asked and how it is scored may not.

  .venv/bin/python -m eval.freeze --write   # once, at the freeze
  .venv/bin/python -m eval.freeze           # check: exits 1 if anything changed
"""

from __future__ import annotations

import hashlib
import json
import sys

from store.cases import ROOT

FILES = [
    "agent/prompts.py", "agent/tools.py", "agent/loop.py", "agent/validate.py", "agent/bundle_pass.py",
    "core/checks.py", "core/physics.py", "sim/baseline.py",
    "eval/c1_rules.py", "eval/c2_extract.py", "eval/metrics.py",
]
RECORD = ROOT / "eval" / "frozen" / "investigator.json"


def fingerprints() -> dict[str, str]:
    return {f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest() for f in FILES}


def changed() -> list[str]:
    """Files that differ from the frozen record (all of them if there is no record)."""
    if not RECORD.exists():
        return FILES
    frozen = json.loads(RECORD.read_text())["files"]
    now = fingerprints()
    return [f for f in FILES if frozen.get(f) != now[f]]


def main() -> None:
    if "--write" in sys.argv:
        RECORD.write_text(json.dumps({
            "note": "Investigator frozen before the held-out test. Nothing in these files changes after this.",
            "frozen_on": sys.argv[sys.argv.index("--write") + 1] if len(sys.argv) > sys.argv.index("--write") + 1 else None,
            "files": fingerprints(),
        }, indent=2))
        print(f"wrote {RECORD.relative_to(ROOT)}")
        return
    diff = changed()
    print("unchanged since the freeze" if not diff else f"changed since the freeze: {', '.join(diff)}")
    sys.exit(1 if diff else 0)


if __name__ == "__main__":
    main()
