"""scripts/make-icons.py — rasterise assets/icon.svg into Android launcher icons.

The SVG is simple enough (rounded rect, circles, rounded bars, one diagonal
gradient) that reproducing it with Pillow is more reliable than shelling out to
an SVG renderer, and it keeps the icon pipeline dependency-free apart from
Pillow.

Writes into android/app/src/main/res/:
  mipmap-{mdpi..xxxhdpi}/ic_launcher.png            legacy icon
  mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png      legacy round icon
  mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.png adaptive foreground
  mipmap-anydpi-v26/ic_launcher{,_round}.xml        adaptive icon

Run:  npm run android:icons
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG = (11, 14, 20, 255)          # #0b0e14
GRAD_A = (124, 108, 240)        # #7c6cf0
GRAD_B = (34, 211, 238)         # #22d3ee

MASTER = 1024                    # supersampled working size
SVG = 128.0                      # the SVG's viewBox edge
UNIT = MASTER / SVG

# SVG elements: (shape, coords, alpha)
#   ("circle", (cx, cy, r), a) / ("rect", (x, y, w, h, radius), a)
NOTES = [
    ("circle", (34, 88, 9), 1.0),
    ("rect", (41, 52, 4, 36, 2), 1.0),
    ("circle", (64, 66, 9), 0.85),
    ("rect", (71, 30, 4, 36, 2), 0.85),
    ("circle", (94, 44, 9), 0.7),
    ("rect", (101, 8, 4, 36, 2), 0.7),
]


def gradient(size: int) -> Image.Image:
    """Diagonal #7c6cf0 → #22d3ee, matching the SVG's linearGradient."""
    t = np.add.outer(np.arange(size), np.arange(size)) / (2 * (size - 1))
    a = np.array(GRAD_A, dtype=float)
    b = np.array(GRAD_B, dtype=float)
    rgb = a + (b - a) * t[..., None]
    return Image.fromarray(rgb.round().astype(np.uint8), "RGB")


def draw_notes(draw: ImageDraw.ImageDraw, scale: float, ox: float, oy: float) -> None:
    for kind, geom, alpha in NOTES:
        value = round(255 * alpha)
        if kind == "circle":
            cx, cy, r = geom
            draw.ellipse(
                [ox + (cx - r) * scale, oy + (cy - r) * scale,
                 ox + (cx + r) * scale, oy + (cy + r) * scale],
                fill=value,
            )
        else:
            x, y, w, h, radius = geom
            draw.rounded_rectangle(
                [ox + x * scale, oy + y * scale,
                 ox + (x + w) * scale, oy + (y + h) * scale],
                radius=radius * scale,
                fill=value,
            )


def render_full() -> Image.Image:
    """The complete icon: dark rounded square with the note path on top."""
    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle([0, 0, MASTER - 1, MASTER - 1], radius=28 * UNIT, fill=BG)

    mask = Image.new("L", (MASTER, MASTER), 0)
    draw_notes(ImageDraw.Draw(mask), UNIT, 0, 0)
    canvas.paste(gradient(MASTER), (0, 0), mask)
    return canvas


def render_foreground() -> Image.Image:
    """Adaptive-icon foreground: notes only, inside the 66dp safe circle."""
    # Bounding box of the note path in SVG units.
    x0, y0, x1, y1 = 25, 8, 105, 97
    # 66dp of 108dp is 61% of the canvas — stay just inside it.
    scale = (0.60 * MASTER) / max(x1 - x0, y1 - y0)
    ox = MASTER / 2 - ((x0 + x1) / 2) * scale
    oy = MASTER / 2 - ((y0 + y1) / 2) * scale

    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    mask = Image.new("L", (MASTER, MASTER), 0)
    draw_notes(ImageDraw.Draw(mask), scale, ox, oy)
    canvas.paste(gradient(MASTER), (0, 0), mask)
    return canvas


def save(img: Image.Image, folder: str, name: str, size: int, circle: bool = False) -> None:
    out = RES / folder
    out.mkdir(parents=True, exist_ok=True)
    icon = img.resize((size, size), Image.LANCZOS)
    if circle:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        icon.putalpha(mask)
    icon.save(out / name)


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def main() -> None:
    full = render_full()
    fg = render_foreground()

    for name, factor in DENSITIES.items():
        size = round(48 * factor)          # 48dp launcher icon
        save(full, f"mipmap-{name}", "ic_launcher.png", size)
        save(full, f"mipmap-{name}", "ic_launcher_round.png", size, circle=True)
        save(fg, f"mipmap-{name}", "ic_launcher_foreground.png", round(108 * factor))

    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (anydpi / name).write_text(adaptive, encoding="utf-8")

    print(f"icons written to {RES}")


if __name__ == "__main__":
    main()
