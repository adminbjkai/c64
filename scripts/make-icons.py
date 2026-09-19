#!/usr/bin/env python3
"""Render the PWA icons (public/icon-192.png, icon-512.png) from the same
design as public/icon.svg, using Pillow only. Run: npm run icons"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
A, B = (74, 91, 216), (139, 151, 255)  # accent gradient, top-left → bottom-right


def render(size: int, maskable: bool) -> Image.Image:
    s = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    # Diagonal gradient.
    grad = Image.new("RGBA", (s, s))
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            px[x, y] = tuple(int(A[i] + (B[i] - A[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(mask)
    pad = 0 if maskable else s * 4 // 64
    d.rounded_rectangle([pad, pad, s - pad - 1, s - pad - 1], radius=s * 14 // 64, fill=255)
    img.paste(grad, (0, 0), mask)
    # Plus sign.
    d = ImageDraw.Draw(img)
    w = s * 6 // 64
    c = s // 2
    r = s * 12 // 64
    d.rounded_rectangle([c - r, c - w // 2, c + r, c + w // 2], radius=w // 2, fill="white")
    d.rounded_rectangle([c - w // 2, c - r, c + w // 2, c + r], radius=w // 2, fill="white")
    return img.resize((size, size), Image.LANCZOS)


for size, maskable in ((192, False), (512, True)):
    out = ROOT / "public" / f"icon-{size}.png"
    render(size, maskable).save(out, optimize=True)
    print("wrote", out.relative_to(ROOT))
