"""API smoke test: a text call, an image read with localization, and a tool
call. Run with: .venv/bin/python -m agent.smoke [--open]"""

from __future__ import annotations

import json
import sys

from PIL import Image, ImageDraw, ImageFont

from agent.models import ModelClient, ModelEndpoint, image_part

LOG_LINES = [
    "ETP LOG BOOK   Date: 13/10/2026",
    "ETP run: 06:00 to 18:00   Status: normal",
    "Aerator 2 serviced 13:00 to 14:30",
    "Lime dosed: 40 kg   Operator: R. Karim",
]


def _test_page() -> Image.Image:
    img = Image.new("RGB", (1000, 420), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
    except OSError:
        font = ImageFont.load_default(size=34)
    for i, line in enumerate(LOG_LINES):
        y = 50 + i * 85
        draw.line([(30, y + 50), (970, y + 50)], fill=(170, 190, 220), width=2)
        draw.text((40, y), line, fill=(20, 30, 90), font=font)
    return img


def main() -> None:
    endpoint = ModelEndpoint.muse_spark_open() if "--open" in sys.argv else ModelEndpoint.muse_spark()
    client = ModelClient(endpoint)
    print(f"model: {client.endpoint.model} at {client.endpoint.base_url}\n")

    r = client.chat([{"role": "user", "content": "Reply with exactly: OK"}])
    print(f"1. text   {r.latency_s}s  {r.usage}\n   -> {r.message.content!r}\n")

    prompt = (
        "This is a photographed ETP logbook page. Return JSON only: "
        '{"lines": [str], "aerator_line_bbox": {"x_min": int, "y_min": int, "x_max": int, "y_max": int}} '
        "where the box uses the 0 to 1000 normalized grid and covers the line about the aerator."
    )
    r = client.chat([{"role": "user", "content": [{"type": "text", "text": prompt}, image_part(_test_page())]}])
    print(f"2. image  {r.latency_s}s  {r.usage}\n   -> {r.message.content}\n")

    tools = [{
        "type": "function",
        "function": {
            "name": "get_signal_window",
            "description": "Summary statistics for one factory signal over a time window.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal": {"type": "string", "enum": ["S1", "S2", "S3", "S4a", "S4b", "S4c", "T1"]},
                    "start": {"type": "string", "description": "ISO 8601 start time"},
                    "end": {"type": "string", "description": "ISO 8601 end time"},
                },
                "required": ["signal", "start", "end"],
            },
        },
    }]
    question = ("The logbook says aerator 2 was serviced 13:00 to 14:30 on 13 Oct 2026 (Asia/Dhaka). "
                "Check ETP power (S3) for that window.")
    r = client.chat([{"role": "user", "content": question}], tools=tools)
    calls = [(c.function.name, json.loads(c.function.arguments)) for c in (r.message.tool_calls or [])]
    print(f"3. tools  {r.latency_s}s  {r.usage}\n   -> {calls or r.message.content!r}")


if __name__ == "__main__":
    main()
