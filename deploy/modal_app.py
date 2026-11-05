"""The public demo on Modal: the interface, the API and the garment QR links on one origin.

    cd web && npx vite build && cd ..
    .venv/bin/modal deploy deploy/modal_app.py

Needs a Modal secret named "tellwater" with MODEL_API_KEY (Meta Model API) and
PASSPORT_SIGNING_KEY (base64 of the raw Ed25519 key). What the demo writes while
it runs (reviews, factory submissions, live runs, usage counts) lives on the
"tellwater-runtime" volume, so it survives restarts and redeploys. One container
serves everyone, so the demo's caps (api/limits.py) are counted in one place.
"""

from __future__ import annotations

import threading
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
APP = "/root/app"
RUNTIME = "/runtime"
SKIP_RUNTIME = ["state.json", "usage.json", "*/trace-live.json"]  # local runtime files never ship

image = (
    modal.Image.debian_slim(python_version="3.14")
    .pip_install("numpy>=2.5", "pandas>=3.1", "pydantic>=2.9,<2.13", "pyyaml>=6.0", "openai>=3.0", "pillow>=13.0",
                 "fastapi>=0.162", "uvicorn>=0.54", "python-multipart>=0.0.20", "cryptography>=44", "httpx>=0.28")
    .env({"TW_RUNTIME_DIR": RUNTIME, "TW_TRUST_PROXY": "1", "PYTHONPATH": APP,
          # judging (Nov 5-9): live calls bill to a card, so the daily totals keep the worst case near $2 a day
          "TW_RUNS_PER_VISITOR": "3", "TW_RUNS_PER_DAY": "6",
          "TW_QUESTIONS_PER_VISITOR": "15", "TW_QUESTIONS_PER_DAY": "40",
          "TW_VOICE_PER_VISITOR": "5", "TW_VOICE_PER_DAY": "20"})
)
for package in ("agent", "api", "core", "passport", "review", "sim", "store", "config", "assets"):
    image = image.add_local_dir(ROOT / package, f"{APP}/{package}", ignore=["__pycache__", "*.pyc"])
image = image.add_local_dir(ROOT / "data" / "demo", f"{APP}/data/demo", ignore=SKIP_RUNTIME)
image = image.add_local_dir(ROOT / "web" / "dist", f"{APP}/web/dist")

app = modal.App("tellwater")
volume = modal.Volume.from_name("tellwater-runtime", create_if_missing=True)


@app.function(image=image, secrets=[modal.Secret.from_name("tellwater")], volumes={RUNTIME: volume},
              max_containers=1, scaledown_window=600, timeout=900)
@modal.concurrent(max_inputs=40)
@modal.asgi_app()
def web():
    from api.app import app as api

    def keep():  # save what the demo has written every half minute, as well as when the container stops
        while True:
            threading.Event().wait(30)
            try:
                volume.commit()
            except Exception:  # a failed save is retried on the next round
                pass

    threading.Thread(target=keep, daemon=True).start()
    return api
