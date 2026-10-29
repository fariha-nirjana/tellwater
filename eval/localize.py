"""How well can the model find a line on a logbook photo?

    .venv/bin/python -m eval.localize --model spark
    .venv/bin/python -m eval.localize --model open

The renderer knows where every handwritten line landed on each phone photo
(0 to 1000 grid, after the tilt and perspective warp). The model reads the page
and boxes each line; we score the boxes against those positions and the
reading against the text. This is what click-to-highlight would rely on with
real photos, where no renderer knows the answer.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from agent.loop import _image
from agent.models import ModelClient, ModelEndpoint, image_part
from eval.caseset import GENERATED
from store.cases import ROOT

PROMPT = ("This is a phone photo of a handwritten effluent treatment plant logbook page. "
          "For every handwritten entry line, give its time, its text exactly as written, whether it is crossed out, "
          "and its bounding box as [x_min, y_min, x_max, y_max] on a 0 to 1000 grid of the image "
          "(0,0 top left; 1000,1000 bottom right). The box should cover the time and the text. "
          'Reply with only JSON: {"lines": [{"time": "HH:MM", "text": "...", "crossed_out": false, "box": [x_min, y_min, x_max, y_max]}]}')


def iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def pages(set_name: str) -> list[tuple[Path, dict]]:
    out = []
    for folder in sorted((GENERATED / set_name).iterdir()):
        full = folder / "hidden" / "documents_full.json"
        if not full.exists():
            continue
        for d in json.loads(full.read_text()):
            if d["type"] == "logbook" and d.get("meta", {}).get("lines"):
                out.append((folder / d["image"], d))
    return out


def score_page(truth: list[dict], pred: list[dict]) -> list[dict]:
    rows = []
    for t in truth:
        tb = [t["box"][k] for k in ("x_min", "y_min", "x_max", "y_max")]
        cands = [p for p in pred if isinstance(p.get("box"), list) and len(p["box"]) == 4]
        best = max(cands, key=lambda p: iou(tb, p["box"]), default=None)
        same_time = [p for p in cands if str(p.get("time", "")).strip() == t["time"]]
        mine = same_time[0] if same_time else None
        b = mine["box"] if mine else None
        cy = (b[1] + b[3]) / 2 if b else None
        rows.append({
            "time": t["time"], "found": mine is not None,
            "iou": round(iou(tb, b), 3) if b else 0.0,
            # the right line: the box for this entry sits on this entry's line and nearer it than any other line
            "right_line": bool(b and tb[1] - 5 <= cy <= tb[3] + 5 and best is mine),
            "text_exact": bool(mine and norm(mine.get("text", "")) == norm(t["text"])),
            "crossed_out_right": bool(mine and bool(mine.get("crossed_out")) == bool(t.get("crossed_out"))),
        })
    return rows


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", choices=["spark", "open"], default="spark")
    p.add_argument("--set", default="dev")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--pad-square", action="store_true", help="Pad the photo to a square before sending; map boxes back.")
    a = p.parse_args()
    endpoint = ModelEndpoint.muse_spark() if a.model == "spark" else ModelEndpoint.muse_spark_open_fireworks()
    client = ModelClient(endpoint)
    out_dir = ROOT / "eval" / "runs" / "localize" / a.model
    out_dir.mkdir(parents=True, exist_ok=True)

    def one(item):
        path, doc = item
        t0 = time.time()
        img = _image(path)
        w, h = img.size
        if a.pad_square:
            side = max(w, h)
            square = Image.new("RGB", (side, side), (128, 128, 128))
            square.paste(img.convert("RGB"), ((side - w) // 2, (side - h) // 2))
            img = square
        r = client.chat([{"role": "user", "content": [{"type": "text", "text": PROMPT}, image_part(img)]}])
        text = r.message.content or ""
        m = re.search(r"\{.*\}", text, re.S)
        try:
            pred = json.loads(m.group())["lines"] if m else []
        except (json.JSONDecodeError, KeyError):
            pred = []
        if a.pad_square:  # from the square's grid back to the photo's
            side = max(w, h)
            for q in pred:
                b = q.get("box")
                if isinstance(b, list) and len(b) == 4:
                    q["box"] = [(b[0] * side / 1000 - (side - w) / 2) * 1000 / w, (b[1] * side / 1000 - (side - h) / 2) * 1000 / h,
                                (b[2] * side / 1000 - (side - w) / 2) * 1000 / w, (b[3] * side / 1000 - (side - h) / 2) * 1000 / h]
        rows = score_page(doc["meta"]["lines"], pred)
        return {"image": str(path.relative_to(ROOT)), "lines": rows, "predicted": pred, "seconds": round(time.time() - t0, 1),
                "prompt_tokens": r.usage.get("prompt_tokens"), "completion_tokens": r.usage.get("completion_tokens")}

    with ThreadPoolExecutor(a.workers) as pool:
        results = list(pool.map(one, pages(a.set)))
    lines = [l for r in results for l in r["lines"]]
    n = len(lines)
    summary = {
        "model": endpoint.model, "pages": len(results), "lines": n,
        "found": round(sum(l["found"] for l in lines) / n, 3),
        "right_line": round(sum(l["right_line"] for l in lines) / n, 3),
        "iou_mean": round(sum(l["iou"] for l in lines) / n, 3),
        "iou_at_0.5": round(sum(l["iou"] >= 0.5 for l in lines) / n, 3),
        "text_exact": round(sum(l["text_exact"] for l in lines) / n, 3),
        "crossed_out_right": round(sum(l["crossed_out_right"] for l in lines) / n, 3),
        "seconds_per_page": round(sum(r["seconds"] for r in results) / len(results), 1),
        "prompt_tokens": sum(r["prompt_tokens"] or 0 for r in results), "completion_tokens": sum(r["completion_tokens"] or 0 for r in results),
    }
    summary["pad_square"] = a.pad_square
    (out_dir / f"{a.set}{'-square' if a.pad_square else ''}.json").write_text(json.dumps({"summary": summary, "pages": results}, indent=1))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
