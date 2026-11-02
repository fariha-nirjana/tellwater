"""Daily caps on the calls that spend model credit, for the public demo.

Live investigations and guide questions call Muse Spark. Each visitor has a
daily allowance, all visitors together have a daily total, and only a few
live runs may be in flight at once. Past a cap the interface falls back to
the saved investigation and says so. Visitors are counted by a hash of their
IP address with a salt that changes every day, never the address itself.
Counts reset at midnight UTC.

Settings (environment):
  TW_LIVE=0                  turn live runs, the guide and voice transcription off
  TW_RUNS_PER_VISITOR=3      TW_RUNS_PER_DAY=15        live investigations (about $0.19 list each)
  TW_QUESTIONS_PER_VISITOR=20 TW_QUESTIONS_PER_DAY=150 guide questions (about $0.01 list each)
  TW_VOICE_PER_VISITOR=10    TW_VOICE_PER_DAY=60      voice notes (up to 2 minutes each)
  TW_MAX_LIVE_RUNS=2         live runs in flight at once
  TW_TRUST_PROXY=1           behind a host's proxy: count by the address it appends to X-Forwarded-For
  TW_RUNTIME_DIR             where the counts are kept (default data/demo)
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Request

from store.cases import ROOT

USAGE = Path(os.environ.get("TW_RUNTIME_DIR", ROOT / "data" / "demo")) / "usage.json"  # gitignored
DEFAULTS = {"runs": (3, 15), "questions": (20, 150), "voice": (10, 60)}
NOUN = {"runs": "live investigations", "questions": "guide questions", "voice": "voice transcriptions"}
_lock = threading.Lock()
_in_flight = 0


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def caps(kind: str) -> tuple[int, int]:
    per_visitor, per_day = DEFAULTS[kind]
    k = kind.upper()
    return _env_int(f"TW_{k}_PER_VISITOR", per_visitor), _env_int(f"TW_{k}_PER_DAY", per_day)


def live_enabled() -> bool:
    return os.environ.get("TW_LIVE", "1") != "0"


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _load() -> dict:
    try:
        u = json.loads(USAGE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        u = {}
    if u.get("day") != _today():  # a new day: fresh counts and a fresh salt
        u = {"day": _today(), "salt": secrets.token_hex(16)}
    for kind in DEFAULTS:
        u.setdefault(kind, {"total": 0, "visitors": {}})
    return u


def visitor(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    if os.environ.get("TW_TRUST_PROXY") == "1":
        # the last entry is the one the host's proxy added; earlier ones come from the visitor and can be made up
        ip = request.headers.get("x-forwarded-for", ip).split(",")[-1].strip()
    return ip


def _left(u: dict, kind: str, who: str) -> int:
    per_visitor, per_day = caps(kind)
    vid = hashlib.sha256((u["salt"] + who).encode()).hexdigest()[:16]
    return max(0, min(per_visitor - u[kind]["visitors"].get(vid, 0), per_day - u[kind]["total"]))


def remaining(kind: str, who: str) -> dict:
    with _lock:
        u = _load()
        return {"left": _left(u, kind, who) if live_enabled() else 0, "per_visitor": caps(kind)[0], "live": live_enabled()}


def take(kind: str, who: str) -> str | None:
    """Use one of the visitor's allowance. Returns None if allowed, otherwise the reason to show."""
    if not live_enabled():
        if kind == "voice":
            return "Voice transcription is switched off in this demo. You can still type your reply."
        return f"Live {NOUN[kind]} are switched off in this demo. The saved investigation shows the same evidence."
    with _lock:
        u = _load()
        if _left(u, kind, who) <= 0:
            per_visitor, per_day = caps(kind)
            whose = "your" if u[kind]["total"] < per_day else "today's"
            if kind == "voice":
                return (f"That's {whose} voice transcriptions for today ({per_visitor} per visitor). "
                        "They reset at midnight UTC. You can still type your reply.")
            return (f"That's {whose} {NOUN[kind]} for today ({per_visitor} per visitor). They reset at midnight UTC; "
                    "the saved investigation of the same evidence is shown instead.")
        vid = hashlib.sha256((u["salt"] + who).encode()).hexdigest()[:16]
        u[kind]["total"] += 1
        u[kind]["visitors"][vid] = u[kind]["visitors"].get(vid, 0) + 1
        USAGE.parent.mkdir(parents=True, exist_ok=True)
        USAGE.write_text(json.dumps(u))
    return None


def start_run() -> bool:
    """Claim one of the in-flight live-run slots; False if all are busy."""
    global _in_flight
    with _lock:
        if _in_flight >= _env_int("TW_MAX_LIVE_RUNS", 2):
            return False
        _in_flight += 1
        return True


def end_run() -> None:
    global _in_flight
    with _lock:
        _in_flight = max(0, _in_flight - 1)
