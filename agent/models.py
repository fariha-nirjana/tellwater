"""One client interface for every model condition: Muse Spark on Meta Model
API, and Muse Spark Open on a partner endpoint, both OpenAI-compatible."""

from __future__ import annotations

import base64
import io
import os
import time
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI

ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path = ROOT / ".env") -> None:
    """Read KEY=value lines from .env into the environment, without overriding."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


@dataclass
class ModelEndpoint:
    name: str
    base_url: str
    api_key: str
    model: str

    @classmethod
    def muse_spark(cls) -> "ModelEndpoint":
        load_env()
        key = os.environ.get("MODEL_API_KEY")
        if not key:
            raise RuntimeError("MODEL_API_KEY is not set; copy .env.example to .env and add it")
        return cls(
            "muse-spark",
            os.environ.get("MODEL_API_BASE_URL", "https://api.meta.ai/v1"),
            key,
            os.environ.get("MUSE_SPARK_MODEL", "muse-spark-1.3"),
        )


@dataclass
class Reply:
    message: object  # the assistant message object from the SDK
    usage: dict
    latency_s: float


class ModelClient:
    def __init__(self, endpoint: ModelEndpoint):
        self.endpoint = endpoint
        self._client = OpenAI(base_url=endpoint.base_url, api_key=endpoint.api_key)

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **kw) -> Reply:
        start = time.perf_counter()
        resp = self._client.chat.completions.create(
            model=self.endpoint.model, messages=messages, **({"tools": tools} if tools else {}), **kw
        )
        usage = resp.usage.model_dump() if resp.usage else {}
        return Reply(resp.choices[0].message, usage, round(time.perf_counter() - start, 2))


def image_part(image, fmt: str = "JPEG") -> dict:
    """A chat content part for a PIL image or image file path, sent inline as base64."""
    if isinstance(image, (str, Path)):
        data = Path(image).read_bytes()
        mime = "image/png" if str(image).lower().endswith(".png") else "image/jpeg"
    else:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format=fmt, quality=90)
        data, mime = buf.getvalue(), f"image/{fmt.lower()}"
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}}
