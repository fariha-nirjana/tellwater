"""Distil the investigator into Muse Glimmer 30B: LoRA SFT on the Fireworks
Serverless Training API (free for Glimmer until 30 Nov 2026), using the
Fireworks cookbook's muse_glimmer renderer for exact tokens, tool calls and images.

    .venv/bin/python -m eval.distill_train --run-id glimmer-v1

Trains on every assistant turn of data/distill/train.jsonl (built by
eval.distill_data; never the test set). Writes per-step loss to
data/distill/<run-id>/metrics.jsonl and the sampler checkpoint path to
data/distill/<run-id>/checkpoint.json for evaluation.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from datetime import datetime, timezone

from agent.models import load_env
from store.cases import ROOT

BASE_MODEL = "accounts/fireworks/models/muse-glimmer-30b"
TOKENIZER_MODEL = "meta-models/Muse-Glimmer-30B"
RENDERER = "muse_glimmer"
PROMOTION_END = datetime(2026, 12, 1, 8, 0, tzinfo=timezone.utc)  # end of 30 Nov, Pacific


def render_all(path, max_seq_len: int):
    from training.renderer import TrainOnWhat
    from training.renderer.tokenizer import get_tokenizer
    from training.utils.supervised import build_renderer, render_messages_to_datums

    tokenizer = get_tokenizer(TOKENIZER_MODEL)
    renderer = build_renderer(tokenizer, TOKENIZER_MODEL, RENDERER)
    datums, total, trained = [], 0, 0
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        for r in render_messages_to_datums(row["messages"], renderer=renderer, tools=row["tools"],
                                           train_on_what=TrainOnWhat.ALL_ASSISTANT_MESSAGES, max_seq_len=max_seq_len):
            datums.append(r.datum)
            total += len(r.token_ids)
            trained += sum(1 for w in r.token_weights if w > 0)
    return datums, total, trained


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", required=True)
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--lora-rank", type=int, default=16)
    p.add_argument("--learning-rate", type=float, default=1e-4)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--max-seq-len", type=int, default=32768)
    p.add_argument("--dry-run", action="store_true", help="Render and count tokens only.")
    a = p.parse_args()

    if datetime.now(timezone.utc) >= PROMOTION_END:
        raise SystemExit("The free Muse Glimmer SFT promotion has ended; price the run before training.")
    load_env()
    out = ROOT / "data" / "distill" / a.run_id
    out.mkdir(parents=True, exist_ok=True)

    datums, total, trained = render_all(ROOT / "data" / "distill" / "train.jsonl", a.max_seq_len)
    print(f"{len(datums)} training sequences, {total / 1e6:.2f}M tokens per epoch, {trained / 1e6:.2f}M trained", flush=True)
    if a.dry_run:
        return

    from fireworks.training import sdk
    from fireworks.training.sdk import FiretitanServiceClient
    from training.utils.serverless import enable_serverless_supervised_409_retry, serverless_base_url

    service = FiretitanServiceClient(api_key=os.environ["FIREWORKS_API_KEY"],
                                     base_url=serverless_base_url("https://api.fireworks.ai"))
    enable_serverless_supervised_409_retry(service)
    client = service.create_lora_training_client(base_model=BASE_MODEL, rank=a.lora_rank, alpha=2 * a.lora_rank,
                                                 train_mlp=True, train_attn=True, train_unembed=True)
    print(f"session {getattr(service, 'training_session_id', None)}", flush=True)
    adam = sdk.AdamParams(learning_rate=a.learning_rate, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.0, grad_clip_norm=1.0)
    rng, step, log = random.Random(0), 0, (out / "metrics.jsonl").open("a", encoding="utf-8")
    started = time.time()
    for epoch in range(a.epochs):
        order = list(range(len(datums)))
        rng.shuffle(order)
        for i in range(0, len(order), a.batch_size):
            fb = client.forward_backward([datums[j] for j in order[i : i + a.batch_size]], "cross_entropy").result()
            opt = client.optim_step(adam, emit_grad_norm_metrics=True).result()
            step += 1
            m = dict(getattr(fb, "metrics", None) or {})
            tokens = m.get("response_tokens") or m.get("num_loss_tokens") or 1.0
            row = {"step": step, "epoch": epoch + 1, "loss": round(m.get("loss:sum", 0.0) / max(float(tokens), 1.0), 4),
                   **{k: v for k, v in (getattr(opt, "metrics", None) or {}).items() if "grad" in k},
                   "minutes": round((time.time() - started) / 60, 1)}
            log.write(json.dumps(row) + "\n"); log.flush()
            print(json.dumps(row), flush=True)
        path = client.save_weights_for_sampler(f"{a.run_id}-epoch{epoch + 1}").result().path
        (out / "checkpoint.json").write_text(json.dumps({"sampler_path": path, "epoch": epoch + 1, "steps": step,
                                                          "base_model": BASE_MODEL, "renderer": RENDERER,
                                                          "tokenizer": TOKENIZER_MODEL, "lora_rank": a.lora_rank}, indent=1), encoding="utf-8")
        print(f"saved epoch {epoch + 1}: {path}", flush=True)


if __name__ == "__main__":
    main()
