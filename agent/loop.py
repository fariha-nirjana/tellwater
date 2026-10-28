"""The investigation loop: the model chooses tools, code runs them, the
validator checks the result.

Images from read_document go back to the model as a user message right
after the tool results, because tool messages carry text only.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from openai import APIConnectionError, APIError, APITimeoutError, RateLimitError
from PIL import Image

from agent.models import ModelClient, image_part
from agent.prompts import FIX, NUDGE, START, SYSTEM
from agent.tools import TOOL_SPECS, CaseTools
from agent.validate import validate
from core.physics import PowerModel
from store.cases import Bundle

# USD per million tokens (input, output); None when billed another way
PRICES = {
    "muse-spark-1.3": (1.25, 4.25),
    "muse-spark-1.3-contributor": (0.10, 0.20),
}
MAX_IMAGE_SIDE = 1600
MAX_NUDGES = 3
MAX_FIXES = 1


@dataclass
class Trace:
    case_id: str
    model: str
    steps: list = field(default_factory=list)
    ledger: list = field(default_factory=list)
    final: dict | None = None
    status: str | None = None  # the status the run ended on
    validation: list = field(default_factory=list)
    valid: bool = False
    turns: int = 0
    checks_used: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float | None = None
    seconds: float = 0.0
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, default=str)


def _image(path: Path) -> Image.Image:
    img = Image.open(path)
    scale = MAX_IMAGE_SIDE / max(img.size)
    return img.resize((int(img.size[0] * scale), int(img.size[1] * scale))) if scale < 1 else img


def _chat(client: ModelClient, messages: list, retries: int = 4):
    for attempt in range(retries):
        try:
            return client.chat(messages, tools=TOOL_SPECS)
        except (APIConnectionError, APITimeoutError, RateLimitError) as exc:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)
        except APIError as exc:
            if getattr(exc, "status_code", None) and exc.status_code < 500 or attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)


def investigate(bundle: Bundle, client: ModelClient, power_model: PowerModel, *, budget: int = 12,
                max_turns: int = 40, on_step: Callable[[dict], None] | None = None) -> Trace:
    tools = CaseTools(bundle, power_model, budget=budget)
    trace = Trace(bundle.case_id, client.endpoint.model)
    messages: list[dict] = [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": START.format(case_id=bundle.case_id)}]
    nudges = fixes = 0
    started = time.perf_counter()
    try:
        for _ in range(max_turns):
            reply = _chat(client, messages)
            trace.turns += 1
            u = reply.usage
            trace.prompt_tokens += u.get("prompt_tokens") or 0
            trace.completion_tokens += u.get("completion_tokens") or 0
            trace.reasoning_tokens += (u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
            msg = reply.message

            if not msg.tool_calls:
                nudges += 1
                if nudges > MAX_NUDGES:
                    trace.error = "the model stopped calling tools without finishing"
                    break
                messages.append({"role": "assistant", "content": msg.content or ""})
                messages.append({"role": "user", "content": NUDGE})
                continue

            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [{"id": tc.id, "type": "function",
                                             "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                                            for tc in msg.tool_calls]})
            images = []
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                    result = tools.call(tc.function.name, args)
                except json.JSONDecodeError:
                    args, result = {}, {"error": "arguments were not valid JSON"}
                step = {"n": len(trace.steps) + 1, "tool": tc.function.name, "args": tools.calls[-1]["args"] if tools.calls else args,
                        "why": tools.calls[-1]["why"] if tools.calls else None, "result": result,
                        "t": round(time.perf_counter() - started, 2)}
                trace.steps.append(step)
                if on_step:
                    on_step(step)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)})
                if tc.function.name == "read_document" and result.get("image"):
                    images.append((result["evidence_id"], bundle.folder / result["image"]))
            if images:
                content = []
                for doc_id, path in images:
                    content += [{"type": "text", "text": f"Image for {doc_id}:"}, image_part(_image(path))]
                messages.append({"role": "user", "content": content})

            if tools.final is not None:
                issues = validate(tools.final, tools.registry, [c["result"] for c in tools.calls])
                if issues and fixes < MAX_FIXES and tools.final["kind"] == "assessment":
                    fixes += 1
                    trace.validation.append({"attempt": fixes, "issues": issues})
                    tools.final = None
                    messages.append({"role": "user", "content": FIX.format(issues="\n".join(f"- {i}" for i in issues))})
                    continue
                trace.validation.append({"attempt": fixes + 1, "issues": issues})
                trace.valid = not issues
                break
        else:
            trace.error = f"no finish within {max_turns} turns"
    except Exception as exc:  # recorded, never silently dropped
        trace.error = f"{type(exc).__name__}: {exc}"

    trace.final = tools.final
    trace.ledger = tools.ledger
    trace.checks_used = tools.checks_used
    if tools.final:
        trace.status = "insufficient" if tools.final["kind"] == "evidence_request" else tools.final["status"]
    trace.seconds = round(time.perf_counter() - started, 1)
    price = PRICES.get(client.endpoint.model)
    if price:
        trace.cost_usd = round((trace.prompt_tokens * price[0] + trace.completion_tokens * price[1]) / 1e6, 4)
    return trace
