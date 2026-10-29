"""A chat client for Muse Glimmer through the Fireworks Serverless Training API's
sampler, so the investigation loop can run the distilled model unchanged.

There is no chat endpoint for a trained Glimmer adapter without a paid
deployment, but a saved sampler checkpoint can be sampled per token. This
renders the conversation (tools, tool calls, images) with the cookbook's
muse_glimmer renderer, samples, and parses the reply back into tool calls.
"""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field

from agent.models import Reply, load_env

BASE_MODEL = "accounts/fireworks/models/muse-glimmer-30b"
TOKENIZER_MODEL = "meta-models/Muse-Glimmer-30B"


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


@dataclass
class GlimmerEndpoint:
    name: str
    model: str  # what the trace records; prices key off it


class GlimmerClient:
    """`model_path` is a sampler checkpoint from eval.distill_train; None samples the base model."""

    def __init__(self, model_path: str | None = None, max_tokens: int = 4096):
        load_env()
        from fireworks.training import sdk
        from fireworks.training.sdk import FiretitanServiceClient
        from training.renderer.tokenizer import get_tokenizer
        from training.utils.serverless import serverless_base_url
        from training.utils.supervised import build_renderer

        self._sdk = sdk
        self.tokenizer = get_tokenizer(TOKENIZER_MODEL)
        self.renderer = build_renderer(self.tokenizer, TOKENIZER_MODEL, "muse_glimmer")
        service = FiretitanServiceClient(api_key=os.environ["FIREWORKS_API_KEY"], base_url=serverless_base_url("https://api.fireworks.ai"))
        self.sampler = (service.create_sampling_client(model_path=model_path, tokenizer=self.tokenizer) if model_path
                        else service.create_sampling_client(base_model=BASE_MODEL, tokenizer=self.tokenizer))
        self.params = sdk.SamplingParams(max_tokens=max_tokens, temperature=0.0, stop=self.renderer.get_stop_sequences())
        self.endpoint = GlimmerEndpoint("muse-glimmer" + ("-distilled" if model_path else ""), "muse-glimmer-30b-sampler")

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **_) -> Reply:
        from training.utils.supervised import build_tool_prefixed_messages

        start = time.perf_counter()
        # the renderer wants tool-call arguments as objects, not JSON strings
        msgs = []
        for m in messages:
            m = dict(m)
            if m.get("tool_calls"):
                m["tool_calls"] = [{**c, "function": {**c["function"], "arguments": _obj(c["function"]["arguments"])}} for c in m["tool_calls"]]
            msgs.append(m)
        prompt = self.renderer.build_generation_prompt(build_tool_prefixed_messages(msgs, renderer=self.renderer, tools=tools))
        tokens, images = self._project_images(prompt)
        res = self.sampler.sample(prompt=self._sdk.ModelInput.from_ints(tokens), num_samples=1, sampling_params=self.params,
                                  images=images or None)
        res = res.result() if hasattr(res, "result") else res
        out = [int(t) for t in res.sequences[0].tokens]
        parsed, _ = self.renderer.parse_response(out)
        content = parsed.get("content")
        if isinstance(content, list):  # drop reasoning parts; keep the visible text
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
        calls = [_Call(id=c.id or f"call_{uuid.uuid4().hex[:8]}", function=_Fn(c.function.name, c.function.arguments))
                 for c in parsed.get("tool_calls") or []]
        usage = {"prompt_tokens": len(tokens), "completion_tokens": len(out), "images": len(images)}
        return Reply(_Message(content or "", calls), usage, round(time.perf_counter() - start, 2))


    def _project_images(self, prompt) -> tuple[list[int], list[str]]:
        """The sampler takes the template's symbolic form: one <|patch|> per image, with the image sent
        alongside as a data URL. The renderer's <|image_start|>, image chunk, <|image_end|> becomes that."""
        enc = lambda s: self.tokenizer.encode(s, add_special_tokens=False)  # noqa: E731
        start, end, patch = enc("<|image_start|>"), enc("<|image_end|>"), enc("<|patch|>")
        tokens: list[int] = []
        images: list[str] = []
        drop_end = False
        for chunk in prompt.chunks:
            if isinstance(chunk, self._sdk.types.EncodedTextChunk):
                ids = list(chunk.tokens)
                if drop_end and ids[: len(end)] == end:
                    ids = ids[len(end):]
                drop_end = False
                tokens.extend(ids)
            else:  # an image
                if tokens[-len(start):] == start:
                    del tokens[-len(start):]
                tokens.extend(patch)
                images.append(f"data:image/{chunk.format};base64,{base64.b64encode(chunk.data).decode()}")
                drop_end = True
        return tokens, images


def _obj(arguments):
    if isinstance(arguments, str):
        try:
            return json.loads(arguments) if arguments else {}
        except json.JSONDecodeError:
            return {"_raw": arguments}
    return arguments
