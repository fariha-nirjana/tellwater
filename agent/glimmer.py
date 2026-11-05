"""A chat client for Muse Glimmer, so the investigation loop can run the distilled model unchanged.

It renders the conversation (tools, tool calls, images) with the Fireworks cookbook's
muse_glimmer renderer, samples, and parses the reply back into tool calls. Sampling
runs on the vLLM server in deploy/glimmer.py (modal=True, the adapter trained there
and published), or on the Fireworks Serverless Training API's sampler for the first
adapter, which was trained on Fireworks and cannot be downloaded.
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
# The adapter that is published and reported as C6 (trained on Modal, deploy/glimmer.py). Its runs are in
# eval/runs/<set>/C6-<run>; the results page and the two-reader report read them from there.
PUBLISHED = "glimmer-gaps/epoch2"  # kept: rounds 2 and 3 failed their pre-written checks (eval/frozen/glimmer_round2_rule.md, glimmer_round3_rule.md)


def runs_folder(adapter: str) -> str:
    """Where an adapter's C6 runs are saved: C6-<run> for a run's last epoch (epoch2), C6-<run>-<epoch> for any other,
    so two epochs of one run never share results."""
    run, _, epoch = adapter.partition("/")
    return f"C6-{run}" + ("" if epoch in ("", "epoch2") else f"-{epoch}")


PUBLISHED_RUNS = runs_folder(PUBLISHED)
TOKENIZER_MODEL = "meta-models/Muse-Glimmer-30B"
# Round 2 adapters were trained to reason before each step, with their earlier reasoning kept in the
# conversation (eval.distill_data build_reasoning; the template's own form). The loop keeps only each turn's
# content and tool calls, so the client puts its reasoning back. Earlier adapters were trained and measured without.
REASONING_ADAPTERS = ("glimmer-reason",)


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
    """`model_path` is a sampler checkpoint from eval.distill_train; None samples the base model.
    With `modal=True` it samples the Sampler in deploy/glimmer.py instead, and `model_path` is an
    adapter saved there (such as "glimmer-modal/epoch2")."""

    def __init__(self, model_path: str | None = None, max_tokens: int = 4096, modal: bool = False):
        load_env()
        from fireworks.training import sdk
        from training.renderer.tokenizer import get_tokenizer
        from training.utils.supervised import build_renderer

        self._sdk = sdk
        self.tokenizer = get_tokenizer(TOKENIZER_MODEL)
        self.renderer = build_renderer(self.tokenizer, TOKENIZER_MODEL, "muse_glimmer")
        self.model_path, self.max_tokens, self.modal = model_path, max_tokens, modal
        self.keep_reasoning = bool(model_path) and model_path.startswith(REASONING_ADAPTERS)
        self._reasoning: dict[str, str] = {}  # first call id of a turn -> that turn's reasoning
        if modal:
            import modal as modal_sdk

            self.sampler = modal_sdk.Cls.from_name("tellwater-glimmer", "Sampler")()
            self.endpoint = GlimmerEndpoint("muse-glimmer" + ("-distilled" if model_path else ""), "muse-glimmer-30b-modal")
            return
        from fireworks.training.sdk import FiretitanServiceClient
        from training.utils.serverless import serverless_base_url

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
                if self.keep_reasoning and m["tool_calls"][0]["id"] in self._reasoning:
                    m["reasoning_content"] = self._reasoning[m["tool_calls"][0]["id"]]
            msgs.append(m)
        prompt = self.renderer.build_generation_prompt(build_tool_prefixed_messages(msgs, renderer=self.renderer, tools=tools))
        tokens, images = self._project_images(prompt)
        if self.modal:
            blobs = [base64.b64decode(url.split(",", 1)[1]) for url in images]
            for attempt in range(4):  # a dropped connection to Modal is retried; a sampler that failed to start is not
                try:
                    out = self.sampler.sample.remote(tokens, blobs, self.max_tokens, self.renderer.get_stop_sequences(),
                                                     self.model_path)["tokens"]
                    break
                except RuntimeError:
                    raise
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(5 * (attempt + 1))
        else:
            res = self.sampler.sample(prompt=self._sdk.ModelInput.from_ints(tokens), num_samples=1,
                                      sampling_params=self.params, images=images or None)
            res = res.result() if hasattr(res, "result") else res
            out = [int(t) for t in res.sequences[0].tokens]
        parsed, _ = self.renderer.parse_response(out)
        content = parsed.get("content")
        reasoning = ""
        if isinstance(content, list):  # keep the reasoning apart from the visible text
            parts = [p for p in content if isinstance(p, dict)]
            reasoning = "".join(p.get("thinking", "") for p in parts if p.get("type") == "thinking")
            content = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        # the parser numbers calls within a turn ("read_document:0"), so ids repeat across turns; ids are never
        # rendered, so unique ones change no token and let a turn's reasoning be found again
        calls = [_Call(id=f"call_{uuid.uuid4().hex[:12]}", function=_Fn(c.function.name, c.function.arguments))
                 for c in parsed.get("tool_calls") or []]
        if self.keep_reasoning and calls and reasoning:
            self._reasoning[calls[0].id] = reasoning
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
