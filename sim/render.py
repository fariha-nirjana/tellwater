"""Render case documents as images: handwritten logbook pages and meter
photos as phone photos, maintenance records as photographed typed forms,
lab reports as clean digital reports.

Every logbook line keeps its bounding box through the photo warp, so the
model's localisation can be scored against where the line really is.
Boxes are stored on the 0 to 1000 grid the Meta models use.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from sim.documents import Document

FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
HANDS = ("Caveat.ttf", "Kalam-Regular.ttf", "HomemadeApple-Regular.ttf", "ReenieBeanie.ttf")
HAND_SIZE = {"Caveat.ttf": 46, "Kalam-Regular.ttf": 34, "HomemadeApple-Regular.ttf": 28, "ReenieBeanie.ttf": 48}
INKS = ((22, 34, 120), (18, 18, 28), (30, 52, 140))
# Bangla pages (sim/bangla.py): handwriting-style Bengali fonts, and a printed one for the register header
BN_HANDS = ("Atma-Medium.ttf", "Galada-Regular.ttf")
HAND_SIZE |= {"Atma-Medium.ttf": 36, "Galada-Regular.ttf": 33}
BN_PRINTED = "NotoSansBengali.ttf"
EN_HEADER = {"title": "EFFLUENT TREATMENT PLANT  -  DAILY LOG BOOK", "date": "Date:", "operator": "Operator:",
             "time": "Time", "remarks": "Remarks"}


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    if name in BN_HANDS or name == BN_PRINTED:
        # Bengali needs shaping (conjuncts, vowel signs): Pillow's Raqm layout, which loads fribidi at run time
        from PIL import features

        if not features.check("raqm"):
            raise RuntimeError("Bangla pages need Pillow's Raqm layout: brew install fribidi, then run with "
                               "DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib")
        return ImageFont.truetype(str(FONTS / name), size, layout_engine=ImageFont.Layout.RAQM)
    return ImageFont.truetype(str(FONTS / name), size)


def _homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """3x3 matrix mapping the 4 src points to the 4 dst points."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs += [u, v]
    h = np.linalg.solve(np.array(rows, float), np.array(rhs, float))
    return np.append(h, 1).reshape(3, 3)


def _apply(h: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.c_[pts, np.ones(len(pts))] @ h.T
    return p[:, :2] / p[:, 2:3]


def _phone_photo(img: Image.Image, rng: np.random.Generator, strength: float = 1.0):
    """Perspective, shading, blur, noise and JPEG-like softness. Returns the
    photo and the homography from page pixels to photo pixels."""
    w, h = img.size
    margin = 0.06
    canvas_w, canvas_h = int(w * (1 + 2 * margin)), int(h * (1 + 2 * margin))
    j = lambda: rng.uniform(-0.035, 0.035) * strength  # noqa: E731
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], float)
    dst = np.array([
        [canvas_w * (margin + j()), canvas_h * (margin + j())],
        [canvas_w * (1 - margin + j()), canvas_h * (margin + j())],
        [canvas_w * (1 - margin + j()), canvas_h * (1 - margin + j())],
        [canvas_w * (margin + j()), canvas_h * (1 - margin + j())],
    ])
    fwd = _homography(src, dst)
    inv = np.linalg.inv(fwd)
    background = tuple(int(c) for c in rng.integers(60, 110, 3))
    photo = img.transform((canvas_w, canvas_h), Image.Transform.PERSPECTIVE,
                          tuple((inv / inv[2, 2]).flatten()[:8]), Image.Resampling.BICUBIC, fillcolor=background)

    # light falling off across the page
    yy, xx = np.mgrid[0:canvas_h, 0:canvas_w]
    angle = rng.uniform(0, 2 * np.pi)
    grad = (np.cos(angle) * xx / canvas_w + np.sin(angle) * yy / canvas_h)
    shade = 1 - 0.22 * strength * (grad - grad.min()) / (np.ptp(grad) or 1)
    arr = np.asarray(photo, float) * shade[..., None]
    arr += rng.normal(0, 4.0 * strength, arr.shape)
    photo = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    photo = photo.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9) * strength))
    photo = ImageEnhance.Contrast(photo).enhance(rng.uniform(0.9, 1.05))
    return photo, fwd


def _norm_box(pts: np.ndarray, size: tuple[int, int]) -> dict:
    w, h = size
    return {
        "x_min": int(round(pts[:, 0].min() / w * 1000)), "y_min": int(round(pts[:, 1].min() / h * 1000)),
        "x_max": int(round(pts[:, 0].max() / w * 1000)), "y_max": int(round(pts[:, 1].max() / h * 1000)),
    }


def render_logbook(doc: Document, rng: np.random.Generator, hand_name: str | None = None) -> tuple[Image.Image, list[dict]]:
    w, h = 1240, 1650
    page = Image.new("RGB", (w, h), (247, 244, 233))
    draw = ImageDraw.Draw(page)
    bangla = doc.content.get("language") == "bn"
    if bangla:
        from sim.bangla import HEADER, LATE_NOTE

        printed, printed_small = _font(BN_PRINTED, 34), _font(BN_PRINTED, 24)
        header, late_note = HEADER, LATE_NOTE
    else:
        printed = _font("CourierPrime-Bold.ttf", 34)
        printed_small = _font("CourierPrime-Regular.ttf", 24)
        header, late_note = EN_HEADER, "(written {time})"
    chosen = str(rng.choice(BN_HANDS if bangla else HANDS))
    hand_name = hand_name or chosen
    hand = _font(hand_name, HAND_SIZE[hand_name])
    hand_small = _font(hand_name, int(HAND_SIZE[hand_name] * 0.7))
    ink = INKS[int(rng.integers(len(INKS)))]

    # printed register header and ruling
    draw.text((90, 60), header["title"], fill=(40, 40, 40), font=printed)
    draw.text((90, 118), header["date"], fill=(60, 60, 60), font=printed_small)
    draw.text((640, 118), header["operator"], fill=(60, 60, 60), font=printed_small)
    draw.text((180, 102), doc.content["date"], fill=ink, font=hand)
    draw.text((780, 102), doc.content["operator"], fill=ink, font=hand)
    top, pitch = 230, 74
    for k in range(int((h - top) / pitch)):
        y = top + k * pitch
        draw.line([(60, y), (w - 60, y)], fill=(168, 190, 222), width=2)
    draw.line([(210, 180), (210, h - 40)], fill=(214, 120, 120), width=2)
    draw.text((90, 186), header["time"], fill=(60, 60, 60), font=printed_small)
    draw.text((240, 186), header["remarks"], fill=(60, 60, 60), font=printed_small)

    lines = []
    row = 0
    for k, entry in enumerate(doc.content["entries"]):
        y = top + (row + 1) * pitch - int(HAND_SIZE[hand_name] * 1.15) + int(rng.integers(-6, 6))
        x_time, x_text = 80 + int(rng.integers(-8, 8)), 236 + int(rng.integers(-10, 14))
        # each entry on its own layer: a slight tilt and its own ink pressure
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        alpha = int(rng.uniform(200, 255))
        line_ink = (*ink, alpha)
        ld.text((x_time, y), entry["time"], fill=line_ink, font=hand)
        wrapped, current = [], ""
        for word in entry["text"].split():
            if current and ld.textlength(f"{current} {word}", font=hand) > w - 110 - x_text:
                wrapped.append(current)
                current = word
            else:
                current = f"{current} {word}".strip()
        wrapped.append(current)
        for r, text in enumerate(wrapped):
            ld.text((x_text, y + r * pitch), text, fill=line_ink, font=hand)
        row += len(wrapped)
        bbox = ld.textbbox((x_text, y + (len(wrapped) - 1) * pitch), wrapped[-1], font=hand)
        if entry.get("crossed_out"):
            mid = (bbox[1] + bbox[3]) // 2
            ld.line([(bbox[0] - 4, mid + 3), (bbox[2] + 4, mid - 3)], fill=line_ink, width=4)
        if entry.get("late"):
            note = late_note.format(time=entry["written"])
            ld.text((bbox[2] + 18, y + 14), note, fill=line_ink, font=hand_small)
        pivot = (x_time, y + HAND_SIZE[hand_name] // 2)
        layer = layer.rotate(float(rng.uniform(-0.9, 0.9)), center=pivot, resample=Image.Resampling.BICUBIC)
        page.paste(layer, (0, 0), layer)
        box = layer.getbbox()  # where the ink actually landed after the tilt
        lines.append({"index": k, "time": entry["time"], "text": entry["text"],
                      "crossed_out": entry.get("crossed_out", False), "box_px": box})

    photo, fwd = _phone_photo(page, rng)
    for line in lines:
        x0, y0, x1, y1 = line.pop("box_px")
        corners = _apply(fwd, np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float))
        line["box"] = _norm_box(corners, photo.size)
    return photo.convert("RGB"), lines


def render_maintenance(doc: Document, rng: np.random.Generator) -> Image.Image:
    c = doc.content
    w, h = 1240, 1000
    page = Image.new("RGB", (w, h), (250, 250, 246))
    draw = ImageDraw.Draw(page)
    bold, regular = _font("CourierPrime-Bold.ttf", 36), _font("CourierPrime-Regular.ttf", 28)
    draw.text((80, 60), "MAINTENANCE WORK ORDER", fill=(20, 20, 20), font=bold)
    draw.line([(80, 115), (w - 80, 115)], fill=(30, 30, 30), width=3)
    rows = [("Work order", c["work_order"]), ("Equipment", c["equipment"]), ("Start", c["start"]), ("End", c["end"])]
    for k, (key, value) in enumerate(rows):
        y = 160 + k * 62
        draw.text((80, y), f"{key}:", fill=(50, 50, 50), font=regular)
        draw.text((330, y), value, fill=(10, 10, 10), font=regular)
    draw.text((80, 430), "Work done:", fill=(50, 50, 50), font=regular)
    words, line, y = c["description"].split(), "", 480
    for word in words:
        if draw.textlength(f"{line} {word}", font=regular) > w - 200:
            draw.text((80, y), line.strip(), fill=(10, 10, 10), font=regular)
            line, y = "", y + 44
        line += f" {word}"
    draw.text((80, y), line.strip(), fill=(10, 10, 10), font=regular)
    draw.text((80, h - 170), f"Approved by: {c['approved_by']}", fill=(50, 50, 50), font=regular)
    hand_name = str(rng.choice(HANDS))
    draw.text((560, h - 190), "signed", fill=INKS[0], font=_font(hand_name, HAND_SIZE[hand_name]))
    photo, _ = _phone_photo(page, rng, strength=0.7)
    return photo


def render_meter_photo(doc: Document, rng: np.random.Generator) -> Image.Image:
    c = doc.content
    w, h = 1000, 760
    img = Image.new("RGB", (w, h), tuple(int(v) for v in rng.integers(70, 100, 3)))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([90, 70, w - 90, h - 70], radius=28, fill=(196, 198, 194), outline=(120, 122, 118), width=4)
    label = _font("CourierPrime-Bold.ttf", 28)
    draw.text((140, 110), c["meter"].upper(), fill=(40, 40, 40), font=label)
    draw.rectangle([140, 190, w - 140, 520], fill=(150, 168, 140), outline=(60, 70, 60), width=5)
    seg = _font("DSEG7Classic-Bold.ttf", 150)
    value = f"{c['value']:.1f}"
    tw = draw.textlength(value, font=seg)
    draw.text((w - 190 - tw, 250), value, fill=(25, 30, 25), font=seg)
    draw.text((w - 250, 450), c["unit"], fill=(25, 30, 25), font=_font("CourierPrime-Bold.ttf", 36))
    date, time = c["display_time"].split(" ")
    small = _font("DSEG7Classic-Bold.ttf", 34)
    draw.text((170, 560), date.replace("/", "-"), fill=(25, 30, 25), font=small)
    draw.text((560, 560), time, fill=(25, 30, 25), font=small)

    # glare across the glass
    glare = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glare)
    cx, cy = int(rng.uniform(250, 750)), int(rng.uniform(200, 450))
    gd.ellipse([cx - 220, cy - 60, cx + 220, cy + 60], fill=int(rng.uniform(60, 110)))
    glare = glare.filter(ImageFilter.GaussianBlur(40))
    img = Image.composite(Image.new("RGB", (w, h), (255, 255, 255)), img, glare)
    photo, _ = _phone_photo(img, rng, strength=0.8)
    return photo


def render_lab_report(doc: Document, rng: np.random.Generator) -> Image.Image:
    c = doc.content
    w, h = 1240, 900
    page = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(page)
    bold, regular = _font("CourierPrime-Bold.ttf", 34), _font("CourierPrime-Regular.ttf", 28)
    draw.text((80, 60), "TEST REPORT - EFFLUENT", fill=(10, 10, 10), font=bold)
    draw.text((80, 110), doc.author, fill=(80, 80, 80), font=regular)
    draw.line([(80, 160), (w - 80, 160)], fill=(30, 30, 30), width=2)
    draw.text((80, 190), f"Sample point: {c['sample_point']}", fill=(10, 10, 10), font=regular)
    draw.text((80, 240), f"Sampled: {c['sample_time']}", fill=(10, 10, 10), font=regular)
    rows = [("Parameter", "Result", "Limit"), ("BOD5 (mg/L)", f"{c['bod_mg_l']:.1f}", f"{c['bod_limit_mg_l']:.0f}"),
            ("COD (mg/L)", f"{c['cod_mg_l']:.1f}", ""), ("TSS (mg/L)", f"{c['tss_mg_l']:.1f}", ""), ("pH", f"{c['ph']:.2f}", "6.0 - 9.0")]
    for k, (a, b, l) in enumerate(rows):
        y = 320 + k * 64
        font = bold if k == 0 else regular
        draw.text((80, y), a, fill=(10, 10, 10), font=font)
        draw.text((560, y), b, fill=(10, 10, 10), font=font)
        draw.text((820, y), l, fill=(10, 10, 10), font=font)
        draw.line([(80, y + 50), (w - 80, y + 50)], fill=(200, 200, 200), width=1)
    draw.text((80, h - 90), "Simulated report for demonstration.", fill=(120, 120, 120), font=regular)
    return page


def render_case_documents(case, out_dir: Path, seed: int | None = None) -> None:
    """Render every document that has a visual form into out_dir and record
    its path (relative to out_dir) on the document."""
    rng = np.random.default_rng(case.scenario.seed if seed is None else seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    for doc in case.documents:
        name = doc.id.replace("doc:", "").replace(":", "-")
        if doc.type == "logbook":
            img, lines = render_logbook(doc, rng)
            doc.meta["lines"] = lines
        elif doc.type == "maintenance_record":
            img = render_maintenance(doc, rng)
        elif doc.type == "meter_photo":
            img = render_meter_photo(doc, rng)
        elif doc.type == "lab_report":
            img = render_lab_report(doc, rng)
        else:
            continue
        path = out_dir / f"{name}.jpg"
        img.convert("RGB").save(path, quality=int(rng.integers(72, 88)))
        doc.image = path.name
