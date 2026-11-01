"""Muse Glimmer on Modal: retrain the investigator adapter, and serve it for the C6 runs.

Fireworks trained glimmer-v1 but does not let its weights be downloaded, and the
weights have to be published. This trains the same adapter from the same data on
one H200, from the open base weights, so the published adapter is the tested one.

    .venv/bin/python -m eval.distill_export                                         # once: data/distill/rendered.pkl
    .venv/bin/modal run deploy/glimmer.py::prepare                                  # base weights + data to volumes, image check (CPU)
    .venv/bin/modal run deploy/glimmer.py::train --run-id glimmer-modal --smoke    # 2 steps on the longest sequences
    .venv/bin/modal deploy deploy/glimmer.py && .venv/bin/python deploy/glimmer.py glimmer-modal rendered.pkl  # the full run, server-side
    .venv/bin/modal run deploy/glimmer.py::fetch --run-id glimmer-modal            # metrics + adapter -> data/distill/<run-id>/
    .venv/bin/modal deploy deploy/glimmer.py                                        # the sampler that C6 calls
    .venv/bin/modal run deploy/glimmer.py::adapter_check --run-id glimmer-modal    # served adapter scores the training targets

Training follows eval.distill_train (glimmer-v1): LoRA rank 16, alpha 32, on the
language model's q/k/v/o and gate/up/down projections; Adam lr 1e-4, betas
0.9/0.999, eps 1e-8, no weight decay, gradients clipped to norm 1; batches of 8
sequences, 2 epochs, the same seed and order; loss summed over trained tokens.
One difference: glimmer-v1 also had a LoRA on the output layer, which vLLM cannot
serve as an adapter, so this one does not.

Extended training data (eval.distill_data --extend, then eval.distill_export --train
<name>) goes up and trains the same way with rendered_<name>.pkl in place of
rendered.pkl. The deployed app is what the sampler and the server-side training run:
redeploy after any change to this file.

Round 2 (glimmer-reason): eval.distill_data --reasoning --out train_reason, then
eval.distill_export --train train_reason, prepare --data-file rendered_train_reason.pkl,
and the full run with learning rate 2e-4. Its data is about twice as long as round 1's,
so a run may take 8-9 hours; the limit is 12.
"""

from __future__ import annotations

import json
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
BASE = "meta-models/Muse-Glimmer-30B"
REVISION = "cec94fcfd6512f2cfe708138c32533b346ea4f69"  # pinned: the weights trained on are the weights served
WEIGHTS, RUNS = "/weights", "/runs"
BASE_DIR = f"{WEIGHTS}/base"
TARGETS = r".*language_model\.layers\.\d+\.(self_attn\.(q_proj|k_proj|v_proj|o_proj)|mlp\.(gate_proj|up_proj|down_proj))"

image = (
    modal.Image.debian_slim(python_version="3.14")
    .pip_install("vllm==0.32.0", "transformers==5.19.0", "peft==0.21.2", "huggingface_hub[hf_xet]", "pillow")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "0", "TOKENIZERS_PARALLELISM": "false",
          "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
          "VLLM_USE_FLASHINFER_SAMPLER": "0"})  # FlashInfer's sampler compiles at startup and the image has no nvcc
)
app = modal.App("tellwater-glimmer")
weights = modal.Volume.from_name("glimmer-weights", create_if_missing=True)
runs = modal.Volume.from_name("glimmer-runs", create_if_missing=True)


# ---------- preparation (CPU) ----------

@app.function(image=image, volumes={WEIGHTS: weights}, timeout=3600, cpu=4)
def download() -> str:
    from huggingface_hub import snapshot_download

    snapshot_download(BASE, revision=REVISION, local_dir=BASE_DIR)
    weights.commit()
    return BASE_DIR


@app.function(image=image, volumes={WEIGHTS: weights, RUNS: runs}, timeout=1800, cpu=8, memory=16384)
def check_images(data_file: str = "rendered.pkl") -> dict:
    """Every image must get exactly the number of positions Fireworks gave it, or the targets misalign."""
    from transformers import AutoConfig

    data = _load_data(data_file)
    processor = _processor()
    # training fills images with <|patch|>; vLLM fills them with the config's image token: the same id
    assert processor.image_token_id == AutoConfig.from_pretrained(BASE_DIR).image_token_id
    counts, bad = {}, []
    for i, row in enumerate(data["rows"]):
        for seg in row["segments"]:
            if seg[0] == "image":
                if seg[1] not in counts:
                    counts[seg[1]] = _image_inputs(processor, [data["images"][seg[1]]])[2][0]
                if counts[seg[1]] != seg[2]:
                    bad.append({"row": i, "image": seg[1][:12], "fireworks": seg[2], "processor": counts[seg[1]]})
    return {"images": len(counts), "mismatches": bad[:20], "mismatch_count": len(bad)}


@app.local_entrypoint()
def prepare(data_file: str = "rendered.pkl", download_base: bool = True):
    with runs.batch_upload(force=True) as up:
        up.put_file(str(ROOT / "data" / "distill" / data_file), f"/{data_file}")
    print("data uploaded")
    if download_base:
        print("base weights:", download.remote())
    print(json.dumps(check_images.remote(data_file), indent=1))


# ---------- training (one H200) ----------

def _load_data(data: str = "rendered.pkl") -> dict:
    import pickle

    return pickle.loads(Path(f"{RUNS}/{data}").read_bytes())


def _processor():
    from transformers import AutoProcessor

    return AutoProcessor.from_pretrained(BASE_DIR)


def _image_inputs(processor, blobs: list[bytes]):
    """Pixel values, grids, and the number of <|patch|> positions per image (as vLLM expands them)."""
    import io

    from PIL import Image

    images = [Image.open(io.BytesIO(b)).convert("RGB") for b in blobs]
    out = processor.image_processor(images=images, return_tensors="pt")
    merge = processor.image_processor.merge_size
    return out["pixel_values"], out["image_grid_thw"], [int(g.prod()) // merge**2 for g in out["image_grid_thw"]]


def _sequence(row: dict, images: dict, processor, patch_id: int):
    import torch

    ids, blobs = [], []
    for seg in row["segments"]:
        if seg[0] == "text":
            ids.extend(seg[1].tolist())
        else:
            ids.extend([patch_id] * seg[2])
            blobs.append(images[seg[1]])
    extra = {}
    if blobs:
        pixels, grids, counts = _image_inputs(processor, blobs)
        assert counts == [s[2] for s in row["segments"] if s[0] == "image"], counts
        extra = {"pixel_values": pixels.cuda(), "image_grid_thw": grids.cuda()}
    assert len(ids) == len(row["weights"])
    return torch.tensor([ids], device="cuda"), extra


@app.function(image=image, gpu="H200", volumes={WEIGHTS: weights, RUNS: runs}, timeout=12 * 3600, memory=65536)
def train_remote(run_id: str, epochs: int = 2, lora_rank: int = 16, learning_rate: float = 1e-4,
                 batch_size: int = 8, smoke: bool = False, data_file: str = "rendered.pkl") -> dict:
    import random
    import time

    import torch
    import torch.nn.functional as F
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForImageTextToText

    torch.manual_seed(0)
    data = _load_data(data_file)
    rows, images = data["rows"], data["images"]
    processor = _processor()
    patch_id = processor.image_token_id
    model = AutoModelForImageTextToText.from_pretrained(BASE_DIR, dtype=torch.bfloat16, device_map="cuda",
                                                        attn_implementation="sdpa")
    model.config.use_cache = False
    model.train()  # from_pretrained returns eval mode, and layers only checkpoint while training (dropout is 0 anyway)
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model = get_peft_model(model, LoraConfig(r=lora_rank, lora_alpha=2 * lora_rank, lora_dropout=0.0,
                                             target_modules=TARGETS, bias="none"))
    lora_modules = sum(1 for n, _ in model.named_modules() if n.endswith(".lora_A"))
    trainable = [p for p in model.parameters() if p.requires_grad]
    print(f"{lora_modules} LoRA modules, {sum(p.numel() for p in trainable) / 1e6:.1f}M trainable", flush=True)
    assert lora_modules == 7 * model.config.text_config.num_hidden_layers, lora_modules
    inner = model.base_model.model  # the ForConditionalGeneration, with the LoRA layers in place
    text = inner.config.text_config
    adam = torch.optim.Adam(trainable, lr=learning_rate, betas=(0.9, 0.999), eps=1e-8, weight_decay=0.0)

    def loss_sum(row) -> tuple[torch.Tensor, float]:
        ids, extra = _sequence(row, images, processor, patch_id)
        hidden = inner.model(input_ids=ids, use_cache=False, **extra).last_hidden_state[0]
        weights_ = torch.from_numpy(row["weights"]).cuda()
        keep = weights_ > 0
        logits = inner.lm_head(hidden[keep]).float() * text.output_multiplier
        logits = torch.tanh(logits / text.final_logit_softcapping) * text.final_logit_softcapping
        targets = torch.from_numpy(row["targets"]).long().cuda()[keep]
        nll = F.cross_entropy(logits, targets, reduction="none")
        return (nll * weights_[keep]).sum(), float(weights_[keep].sum())

    out = Path(f"{RUNS}/{run_id}")
    out.mkdir(parents=True, exist_ok=True)
    log = (out / ("smoke.jsonl" if smoke else "metrics.jsonl")).open("w")
    rng, step, started = random.Random(0), 0, time.time()
    for epoch in range(epochs):
        order = list(range(len(rows)))
        rng.shuffle(order)
        if smoke:  # the longest sequences, to find the memory ceiling
            order = sorted(range(len(rows)), key=lambda i: -len(rows[i]["weights"]))[: 2 * batch_size]
        for i in range(0, len(order), batch_size):
            t0, total, tokens = time.time(), 0.0, 0.0
            adam.zero_grad(set_to_none=True)
            for j in order[i : i + batch_size]:
                loss, n = loss_sum(rows[j])
                loss.backward()
                total, tokens = total + float(loss.detach()), tokens + n
            norm = float(torch.nn.utils.clip_grad_norm_(trainable, 1.0))
            adam.step()
            step += 1
            row = {"step": step, "epoch": epoch + 1, "loss": round(total / max(tokens, 1.0), 4), "grad_norm": round(norm, 1),
                   "seconds": round(time.time() - t0, 1), "minutes": round((time.time() - started) / 60, 1),
                   "max_memory_gb": round(torch.cuda.max_memory_allocated() / 2**30, 1)}
            log.write(json.dumps(row) + "\n"); log.flush()
            print(json.dumps(row), flush=True)
            if step % 5 == 0:
                runs.commit()
        if smoke:
            break
        model.save_pretrained(str(out / f"epoch{epoch + 1}"))
        (out / f"epoch{epoch + 1}" / "training.json").write_text(json.dumps(
            {"base_model": BASE, "revision": REVISION, "epoch": epoch + 1, "steps": step, "lora_rank": lora_rank,
             "lora_alpha": 2 * lora_rank, "learning_rate": learning_rate, "batch_size": batch_size,
             "sequences": len(rows), "max_seq_len": data["max_seq_len"], "data": data_file}, indent=1))
        runs.commit()
        print(f"saved epoch {epoch + 1}", flush=True)
    runs.commit()
    return {"steps": step, "minutes": round((time.time() - started) / 60, 1)}


@app.local_entrypoint()
def train(run_id: str, epochs: int = 2, smoke: bool = False, data_file: str = "rendered.pkl", learning_rate: float = 1e-4):
    print(train_remote.remote(run_id, epochs=epochs, smoke=smoke, data_file=data_file, learning_rate=learning_rate))


@app.local_entrypoint()
def fetch(run_id: str):
    """Metrics and every saved epoch's adapter to data/distill/<run-id>/."""
    dest = ROOT / "data" / "distill" / run_id
    for entry in runs.listdir(f"/{run_id}", recursive=True):
        if entry.type == modal.volume.FileEntryType.FILE:
            path = dest / Path(entry.path).relative_to(run_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as f:
                for chunk in runs.read_file(entry.path):
                    f.write(chunk)
            print(path)


# ---------- serving (vLLM, one H200) ----------

def _engine():
    from vllm import AsyncEngineArgs, AsyncLLMEngine

    return AsyncLLMEngine.from_engine_args(AsyncEngineArgs(
        model=BASE_DIR, max_model_len=65536, enable_lora=True, max_lora_rank=16, max_loras=2,
        gpu_memory_utilization=0.9, limit_mm_per_prompt={"image": 16, "video": 0}, seed=0))


class _Adapters:
    def __init__(self):
        self.ids: dict[str, int] = {}

    def __call__(self, adapter: str | None):
        from vllm.lora.request import LoRARequest

        if not adapter:
            return None
        self.ids.setdefault(adapter, len(self.ids) + 1)
        return LoRARequest(adapter, self.ids[adapter], f"{RUNS}/{adapter}")


async def _target_nll(engine, lora, rows: list[int], adapter: str | None) -> dict:
    """Mean loss on the trained positions of some training sequences, scored by the served model: should
    match the end of training with the adapter, and the start of training without it."""
    import io
    import uuid

    from PIL import Image
    from vllm import SamplingParams

    data = _load_data()
    tok = _processor().tokenizer
    patch, start, end = (tok.convert_tokens_to_ids(t) for t in ("<|patch|>", "<|image_start|>", "<|image_end|>"))
    total = tokens = 0.0
    for i in rows:
        row = data["rows"][i]
        ids, blobs, drop_end = [], [], False
        for seg in row["segments"]:
            if seg[0] == "text":
                part = seg[1].tolist()
                if drop_end and part[:1] == [end]:
                    part = part[1:]
                ids.extend(part)
                drop_end = False
            else:  # vLLM expands one <|patch|> to <|image_start|>, the image's positions, <|image_end|>
                if ids[-1:] == [start]:
                    ids.pop()
                ids.append(patch)
                blobs.append(data["images"][seg[1]])
                drop_end = True
        # the targets are the inputs shifted by one, so the last target closes the sequence
        ids.append(int(row["targets"][-1]))
        prompt = {"prompt_token_ids": ids}
        if blobs:
            prompt["multi_modal_data"] = {"image": [Image.open(io.BytesIO(b)).convert("RGB") for b in blobs]}
        final = None
        async for out in engine.generate(prompt, SamplingParams(max_tokens=1, prompt_logprobs=0), uuid.uuid4().hex,
                                         lora_request=lora(adapter)):
            final = out
        # expanded prompt: logprob of each next token; position k of the prompt scores token k
        scored = final.prompt_logprobs[1:]
        expanded = final.prompt_token_ids
        weights_ = row["weights"]
        assert len(expanded) - 1 == len(weights_), (len(expanded), len(weights_))
        for k, w in enumerate(weights_):
            if w > 0:
                total, tokens = total - w * scored[k][expanded[k + 1]].logprob, tokens + w
    result = {"adapter": adapter, "rows": rows, "loss": round(float(total / tokens), 4), "tokens": float(tokens)}
    print(json.dumps(result), flush=True)
    return result


@app.function(image=image, gpu="H200", volumes={WEIGHTS: weights, RUNS: runs}, timeout=1800, retries=0)
async def adapter_check_remote(rows: list[int], adapters: list[str | None]) -> list[dict]:
    """One container, one attempt: a failure to start stops here instead of being restarted."""
    engine, lora = _engine(), _Adapters()
    return [await _target_nll(engine, lora, rows, a) for a in adapters]


@app.local_entrypoint()
def adapter_check(run_id: str, epoch: int = 2, rows: str = "0,1,2,3"):
    picked = [int(r) for r in rows.split(",")]
    for r in adapter_check_remote.remote(picked, [None, f"{run_id}/epoch{epoch}"]):
        print(json.dumps(r))


@app.cls(image=image, gpu="H200", volumes={WEIGHTS: weights, RUNS: runs}, timeout=3600, scaledown_window=300,
         max_containers=1)
@modal.concurrent(max_inputs=32)
class Sampler:
    """Samples Muse Glimmer from token ids plus images (each image one <|patch|>, as the Fireworks sampler took
    them), with or without an adapter saved under /runs. agent/glimmer.py renders and parses."""

    @modal.enter()
    def start(self):
        # Modal restarts a container whose startup raises, without end; keep the error and fail each call
        # instead, so the container idles out after scaledown_window
        self.error = None
        try:
            self.engine = _engine()
        except Exception as exc:  # noqa: BLE001
            self.error = f"{type(exc).__name__}: {exc}"
        self.lora = _Adapters()

    @modal.method()
    async def sample(self, tokens: list[int], images: list[bytes], max_tokens: int = 4096,
                     stop_token_ids: list[int] | None = None, adapter: str | None = None) -> dict:
        import io
        import uuid

        from PIL import Image
        from vllm import SamplingParams

        if self.error:
            raise RuntimeError(f"the sampler failed to start: {self.error}")
        prompt = {"prompt_token_ids": tokens}
        if images:
            prompt["multi_modal_data"] = {"image": [Image.open(io.BytesIO(b)).convert("RGB") for b in images]}
        params = SamplingParams(temperature=0.0, max_tokens=max_tokens, stop_token_ids=stop_token_ids or [],
                                skip_special_tokens=False)
        final = None
        async for out in self.engine.generate(prompt, params, uuid.uuid4().hex, lora_request=self.lora(adapter)):
            final = out
        o = final.outputs[0]
        return {"tokens": list(o.token_ids), "prompt_tokens": len(final.prompt_token_ids), "finish": o.finish_reason}


if __name__ == "__main__":
    # Start training on the deployed app, so nothing on this machine can cancel it (a `modal run --detach`
    # was cancelled mid-run on Nov 1). Redeploy first.
    #   .venv/bin/python deploy/glimmer.py <run-id> <data-file> [<learning-rate>]
    import sys

    lr = float(sys.argv[3]) if len(sys.argv) > 3 else 1e-4
    call = modal.Function.from_name("tellwater-glimmer", "train_remote").spawn(sys.argv[1], data_file=sys.argv[2], learning_rate=lr)
    print(f"spawned {call.object_id}")
