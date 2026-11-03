"""The README's "can you trust it?" chart, drawn from the held-out test results (data/demo/results.json).

Each bar is one approach on the 120 test cases, split into right, cautious (it asked for a record or a person
instead of answering) and harmful (it cleared a case it shouldn't have, or accused without the evidence).
Run: python -m eval.trust_chart  ->  docs/readme/trust.svg
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROWS = [("C4", "Muse Spark, investigating"), ("C6", "Muse Glimmer, fine-tuned"), ("two_readers", "Both reading, a person settling disagreements"),
        ("C3", "Muse Spark, everything at once"), ("C5", "Muse Spark Open"), ("C2", "Rules + document reading"), ("C1", "Rules alone")]


def split(conf: dict) -> tuple[int, int, int]:
    right = cautious = harmful = 0
    for justified, row in conf.items():
        for given, k in row.items():
            if given == justified:
                right += k
            elif given in ("insufficient", "review_required"):
                cautious += k
            else:
                harmful += k
    return right, cautious, harmful


def main() -> None:
    test = json.loads((ROOT / "data" / "demo" / "results.json").read_text(encoding="utf-8"))["test"]
    W, left, bar_w, top, row_h = 1280, 430, 540, 120, 58
    H = top + row_h * len(ROWS) + 70
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
           f'aria-label="On 120 unseen simulated cases: how often each approach was right, cautious or harmful">',
           '<title>Can you trust it? 120 unseen simulated cases</title>',
           f'<rect width="{W}" height="{H}" rx="18" fill="#f7f7f2"/>',
           '<g font-family="\'DM Sans\', \'Segoe UI\', Helvetica, Arial, sans-serif" fill="#171735">',
           '<text x="40" y="58" font-size="30" font-weight="700">Can you trust it?</text>',
           '<text x="40" y="90" font-size="17" fill="#66657a">120 unseen simulated cases, system frozen before the test</text>']
    # legend
    for i, (label, colour) in enumerate([("right", "#4945ff"), ("asked for a record or a person", "#c9c7ff"), ("harmful mistake", "#ff705b")]):
        x = 700 + [0, 110, 400][i]
        out.append(f'<rect x="{x}" y="74" width="16" height="16" rx="3" fill="{colour}"/><text x="{x + 24}" y="88" font-size="15">{label}</text>')
    for i, (key, name) in enumerate(ROWS):
        right, cautious, harmful = split(test[key]["confusion"])
        total = right + cautious + harmful
        y = top + i * row_h
        bold = ' font-weight="700"' if key == "C4" else ""
        out.append(f'<text x="40" y="{y + 27}" font-size="17"{bold}>{name}</text>')
        x = left
        for k, colour in ((right, "#4945ff"), (cautious, "#c9c7ff"), (harmful, "#ff705b")):
            w = bar_w * k / total
            out.append(f'<rect x="{x:.1f}" y="{y + 8}" width="{w:.1f}" height="28" fill="{colour}"/>')
            x += w
        out.append(f'<text x="{left + bar_w + 18}" y="{y + 28}" font-size="16"><tspan font-weight="700">{right + cautious}</tspan> right or asked · '
                   f'<tspan font-weight="700" fill="#c0392b">{harmful}</tspan> harmful</text>')
    out.append(f'<text x="40" y="{H - 28}" font-size="14" fill="#66657a">Harmful: cleared a case it shouldn\'t have, or accused without the evidence. '
               'A person signs every result. Simulated records; prototype results, not field reliability.</text>')
    out += ['</g>', '</svg>']
    path = ROOT / "docs" / "readme" / "trust.svg"
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
