"""Export the Glimmer training sequences for training off Fireworks (deploy/glimmer.py on Modal).

    .venv/bin/python -m eval.distill_export

Renders data/distill/train.jsonl exactly as eval.distill_train did for glimmer-v1
(the cookbook's muse_glimmer renderer, every assistant turn, 32,768 tokens max), in
the same order, so the same seed gives the same batches. Each sequence is kept as
token segments and images (with the number of positions Fireworks gave each image),
plus the per-position weights and targets. Writes data/distill/rendered.pkl.
"""

from __future__ import annotations

import argparse
import hashlib
import pickle

import numpy as np

from eval.distill_train import render_all
from store.cases import ROOT


def export(max_seq_len: int = 32768, train: str = "train") -> dict:
    datums, total, trained = render_all(ROOT / "data" / "distill" / f"{train}.jsonl", max_seq_len)
    images: dict[str, bytes] = {}
    rows = []
    for d in datums:
        segments = []
        for chunk in d.model_input.chunks:
            if hasattr(chunk, "tokens"):
                segments.append(("text", np.asarray(chunk.tokens, dtype=np.int32)))
            else:
                sha = hashlib.sha256(chunk.data).hexdigest()
                images[sha] = chunk.data
                segments.append(("image", sha, int(chunk.expected_tokens)))
        weights = np.asarray(d.loss_fn_inputs["weights"].data, dtype=np.float32)
        targets = np.asarray(d.loss_fn_inputs["target_tokens"].data, dtype=np.int32)
        length = sum(len(s[1]) if s[0] == "text" else s[2] for s in segments)
        assert length == len(weights) == len(targets), (length, len(weights), len(targets))
        rows.append({"segments": segments, "weights": weights, "targets": targets})
    return {"rows": rows, "images": images, "positions": total, "trained": trained, "max_seq_len": max_seq_len}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--max-seq-len", type=int, default=32768)
    p.add_argument("--train", default="train", help="data/distill/<train>.jsonl; writes rendered.pkl or rendered_<train>.pkl")
    a = p.parse_args()
    out = export(a.max_seq_len, a.train)
    path = ROOT / "data" / "distill" / ("rendered.pkl" if a.train == "train" else f"rendered_{a.train}.pkl")
    path.write_bytes(pickle.dumps(out, protocol=5))
    print(f"{len(out['rows'])} sequences, {out['positions'] / 1e6:.2f}M positions, {out['trained'] / 1e6:.2f}M trained, "
          f"{len(out['images'])} distinct images -> {path} ({path.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
