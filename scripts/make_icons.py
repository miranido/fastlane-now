#!/usr/bin/env python3
"""Generates every app icon from one vector-ish definition.

Run after changing the mark or the colours:

    python3 scripts/make_icons.py

Needs Pillow (`pip3 install pillow`). Outputs land in public/icons/ and
app/favicon.ico, all of which are committed — so this only runs when the
design changes, never at build time.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "icons"

# Supersampling factor: draw big, shrink down, get clean edges for free.
SS = 4

BG_TOP = (26, 74, 122)     # #1a4a7a
BG_BOTTOM = (12, 40, 70)   # #0c2846
ACCENT = (232, 114, 31)    # #e8721f

# Three stacked chevrons, brightest at the top: "moving, and fast".
CHEVRON_ALPHAS = (255, 140, 70)


def gradient_background(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), BG_BOTTOM)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(1, size - 1)
        draw.line(
            [(0, y), (size, y)],
            fill=tuple(
                round(top + (bottom - top) * ratio)
                for top, bottom in zip(BG_TOP, BG_BOTTOM)
            ),
        )
    return image


def chevron_points(cx: float, cy: float, half_w: float, drop: float, thick: float):
    """A '^' shaped band with its apex at (cx, cy)."""
    return [
        (cx - half_w, cy + drop),
        (cx, cy),
        (cx + half_w, cy + drop),
        (cx + half_w, cy + drop + thick),
        (cx, cy + thick),
        (cx - half_w, cy + drop + thick),
    ]


def draw_mark(size: int, scale: float, colour=ACCENT) -> Image.Image:
    """The chevron stack on a transparent canvas."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    half_w = size * 0.24 * scale
    drop = size * 0.15 * scale
    thick = size * 0.105 * scale
    gap = size * 0.135 * scale

    # Centre the whole stack vertically.
    stack_height = drop + thick + gap * (len(CHEVRON_ALPHAS) - 1)
    top = (size - stack_height) / 2

    for index, alpha in enumerate(CHEVRON_ALPHAS):
        draw.polygon(
            chevron_points(size / 2, top + gap * index, half_w, drop, thick),
            fill=(*colour, alpha),
        )
    return layer


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (size - 1, size - 1)], radius=size * radius_ratio, fill=255
    )
    return mask


def build_icon(size: int, radius_ratio: float, mark_scale: float) -> Image.Image:
    big = size * SS
    icon = gradient_background(big).convert("RGBA")
    icon.alpha_composite(draw_mark(big, mark_scale))

    if radius_ratio > 0:
        icon.putalpha(rounded_mask(big, radius_ratio))

    return icon.resize((size, size), Image.LANCZOS)


def build_badge(size: int) -> Image.Image:
    """Android tints badges itself, so it must be a white silhouette."""
    big = size * SS
    layer = draw_mark(big, 1.15, colour=(255, 255, 255))
    # Badges read better fully opaque rather than as a fading stack.
    opaque = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    opaque.alpha_composite(layer)
    alpha = opaque.getchannel("A").point(lambda value: 255 if value > 40 else 0)
    opaque.putalpha(alpha)
    return opaque.resize((size, size), Image.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    outputs = {
        # Standard PWA icons, rounded like a real app tile.
        "icon-192.png": build_icon(192, 0.22, 1.0),
        "icon-512.png": build_icon(512, 0.22, 1.0),
        # Maskable: full bleed, mark pulled into the safe zone so Android can
        # crop it to any shape without clipping the chevrons.
        "icon-maskable-512.png": build_icon(512, 0.0, 0.72),
        # iOS applies its own mask, so ship it square.
        "apple-touch-icon.png": build_icon(180, 0.0, 1.0),
        "badge-72.png": build_badge(72),
    }

    for name, image in outputs.items():
        image.save(ICON_DIR / name, "PNG")
        print(f"wrote public/icons/{name}")

    favicon = build_icon(64, 0.22, 1.05)
    favicon.save(
        ROOT / "app" / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print("wrote app/favicon.ico")


if __name__ == "__main__":
    main()
