"""Muse Spark investigations that keep a summary of its reasoning, for training Muse Glimmer.

    .venv/bin/python -m eval.spark_reasoning <set> [--cases a,b] [--workers 6]

The investigator is unchanged (agent.loop.investigate, frozen); only the client
differs. The chat endpoint never returns Muse Spark's reasoning, but the Responses
endpoint returns a summary of it (reasoning.summary), so this client speaks the
Responses API, answers the loop exactly like ModelClient, and keeps each turn's
summary against the tool calls it led to. Muse Glimmer is a reasoning model, and
Meta's post-training guide says to train on the reasoning, not only the actions.

With --teacher contributor, the same Responses client calls muse-spark-1.3-contributor
(about a twelfth of the price; Meta may train on what is sent, and every case here is
simulated). With --teacher open, the teacher is Muse Spark Open on Fireworks instead, whose
chat endpoint returns the full reasoning (reasoning_content), not a summary.

Writes eval/runs/<set>/C4-reasoning/ (or C5-reasoning/)<case>.json: the usual run
record plus "summaries", one {"call_ids", "summary"} per model turn. Never the test set.
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from openai import OpenAI

from agent.models import ModelEndpoint, Reply
from eval.run_set import RUNS, _case_dirs, run_agent_with


@dataclass
class _Fn:
    name: str
    arguments: str


@dataclass
class _Call:
    id: str
    function: _Fn
    type: str = "function"


@dataclass
class _Message:
    content: str
    tool_calls: list = field(default_factory=list)


def _input(messages: list[dict]) -> list[dict]:
    """Chat messages as Responses input items."""
    items: list[dict] = []
    for m in messages:
        role = m["role"]
        if role == "tool":
            items.append({"type": "function_call_output", "call_id": m["tool_call_id"], "output": m["content"]})
            continue
        content = m.get("content") or ""
        if isinstance(content, list):
            parts = []
            for p in content:
                if p.get("type") == "text":
                    parts.append({"type": "input_text", "text": p["text"]})
                elif p.get("type") == "image_url":
                    parts.append({"type": "input_image", "image_url": p["image_url"]["url"]})
            content = parts
        if content:
            items.append({"role": role, "content": content})
        for c in m.get("tool_calls") or []:
            items.append({"type": "function_call", "call_id": c["id"], "name": c["function"]["name"],
                          "arguments": c["function"]["arguments"]})
    return items


class ReasoningClient:
    """Muse Spark through the Responses API, with a reasoning summary kept per turn."""

    def __init__(self, endpoint: ModelEndpoint, summary: str = "detailed"):
        self.endpoint = endpoint
        self.summary = summary
        self.log: list[dict] = []
        self._client = OpenAI(base_url=endpoint.base_url, api_key=endpoint.api_key, timeout=240, max_retries=2)

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **_) -> Reply:
        start = time.perf_counter()
        specs = [{"type": "function", "name": t["function"]["name"], "description": t["function"].get("description", ""),
                  "parameters": t["function"]["parameters"]} for t in tools or []]
        resp = self._client.responses.create(model=self.endpoint.model, input=_input(messages),
                                             reasoning={"summary": self.summary}, **({"tools": specs} if specs else {}))
        summary, text, calls = [], [], []
        for item in resp.output:
            kind = getattr(item, "type", None)
            if kind == "reasoning":
                summary += [s.text for s in (getattr(item, "summary", None) or []) if getattr(s, "text", None)]
            elif kind == "function_call":
                calls.append(_Call(item.call_id, _Fn(item.name, item.arguments or "{}")))
            elif kind == "message":
                text += [c.text for c in item.content if getattr(c, "text", None)]
        self.log.append({"call_ids": [c.id for c in calls], "summary": "\n\n".join(summary)})
        u = resp.usage
        usage = {"prompt_tokens": u.input_tokens, "completion_tokens": u.output_tokens,
                 "completion_tokens_details": {"reasoning_tokens": getattr(u.output_tokens_details, "reasoning_tokens", 0)},
                 "prompt_tokens_details": {"cached_tokens": getattr(u.input_tokens_details, "cached_tokens", 0)}} if u else {}
        return Reply(_Message("".join(text), calls), usage, round(time.perf_counter() - start, 2))


class GuidedClient(ReasoningClient):
    """The teacher with a note about which records settle the case (eval.guidance), sent after the
    opening message on every call. Only the request carries it: the loop's messages and the trace
    never do, so the training data rebuilt from the trace can't contain it."""

    def __init__(self, endpoint: ModelEndpoint, note: str):
        super().__init__(endpoint)
        self.note = note

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **kw) -> Reply:
        return super().chat(messages[:2] + [{"role": "user", "content": self.note}] + messages[2:], tools, **kw)


class OpenReasoningClient:
    """Muse Spark Open on an OpenAI-compatible chat endpoint that returns reasoning_content."""

    def __init__(self, endpoint: ModelEndpoint, max_tokens: int = 16384):
        self.endpoint, self.max_tokens = endpoint, max_tokens
        self.log: list[dict] = []
        self._client = OpenAI(base_url=endpoint.base_url, api_key=endpoint.api_key, timeout=300, max_retries=2)

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **_) -> Reply:
        start = time.perf_counter()
        resp = self._client.chat.completions.create(model=self.endpoint.model, messages=messages, max_tokens=self.max_tokens,
                                                    **({"tools": tools} if tools else {}))
        msg = resp.choices[0].message
        reasoning = getattr(msg, "reasoning_content", None) or (msg.model_extra or {}).get("reasoning_content") or ""
        self.log.append({"call_ids": [c.id for c in msg.tool_calls or []], "summary": reasoning})
        usage = resp.usage.model_dump() if resp.usage else {}
        return Reply(msg, usage, round(time.perf_counter() - start, 2))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("set")
    p.add_argument("--cases", help="comma-separated case IDs (default: the whole set)")
    p.add_argument("--limit", type=int, help="only the first N cases of the set (runs already saved are reused, so a larger --limit adds a batch)")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--teacher", choices=["spark", "contributor", "open"], default="spark")
    p.add_argument("--guided", action="store_true", help="round 3: the teacher gets eval.guidance's note (training sets only)")
    a = p.parse_args()
    assert not a.set.startswith("test"), "never the held-out test set"
    assert not a.guided or a.set.startswith("train"), "guided runs are training data only"
    out = RUNS / a.set / {"spark": "C4-reasoning", "contributor": "C4c-reasoning", "open": "C5-reasoning"}[a.teacher]
    if a.guided:
        out = out.with_name(out.name.replace("-reasoning", "-guided"))
    out.mkdir(parents=True, exist_ok=True)
    folders = [f for f in _case_dirs(a.set) if not a.cases or f.name in a.cases.split(",")][: a.limit]
    endpoint = ModelEndpoint.muse_spark_open_fireworks() if a.teacher == "open" else ModelEndpoint.muse_spark()
    if a.teacher == "contributor":
        endpoint.model = "muse-spark-1.3-contributor"

    def one(folder):
        path = out / f"{folder.name}.json"
        if path.exists() and not a.fresh:
            return json.loads(path.read_text(encoding="utf-8"))
        if a.guided:
            from eval.guidance import note
            client = GuidedClient(endpoint, note(folder))
        else:
            client = OpenReasoningClient(endpoint) if a.teacher == "open" else ReasoningClient(endpoint)
        result = run_agent_with(folder, client)
        result["case_id"], result["summaries"] = folder.name, client.log
        if a.guided:
            result["guidance_note"] = client.note  # for the record; the training data is built from the trace only
        path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        return result

    with ThreadPoolExecutor(a.workers) as pool:
        futures = [pool.submit(one, f) for f in folders]
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            n = sum(1 for s in r["summaries"] if s["summary"])
            print(f"[{i}/{len(folders)}] {r['case_id']} -> {r['status']} valid={r['valid']} "
                  f"turns with a summary {n}/{len(r['summaries'])} cost={r.get('cost')} error={r.get('error')}", flush=True)


if __name__ == "__main__":
    main()
