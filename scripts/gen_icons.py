#!/usr/bin/env python3
"""Generate SeasonScope app icons: the brand 'S' monogram (italic serif) on the
green->amber brand gradient. Produces favicon + iOS/Android home-screen icons.
Run: python3 scripts/gen_icons.py  (needs Pillow)"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

GREEN = (200, 240, 96)    # --accent  #c8f060
AMBER = (240, 184, 96)    # --accent2 #f0b860
DARK  = (14, 14, 14)      # --bg      #0e0e0e
FONT  = "/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf"

SS = 1024                 # supersample master size

def gradient(size):
    """Diagonal (135deg, top-left->bottom-right) green->amber."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (int(GREEN[0] + (AMBER[0]-GREEN[0])*t),
                        int(GREEN[1] + (AMBER[1]-GREEN[1])*t),
                        int(GREEN[2] + (AMBER[2]-GREEN[2])*t))
    return img

def draw_S(img, frac):
    """Draw a centred italic-serif 'S' sized to `frac` of the canvas height."""
    size = img.size[0]
    target_h = size * frac
    fsz = int(target_h * 1.35)            # font px is larger than glyph height
    font = ImageFont.truetype(FONT, fsz)
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), "S", font=font)
    w, h = r - l, b - t
    x = (size - w) / 2 - l
    y = (size - h) / 2 - t
    d.text((x, y), "S", font=font, fill=DARK)
    return img

def rounded(img, radius_frac=0.22):
    size = img.size[0]
    rad = int(size * radius_frac)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size-1, size-1], radius=rad, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out

def master(frac, round_it):
    img = gradient(SS)
    draw_S(img, frac)
    return rounded(img, 0.22) if round_it else img.convert("RGBA")

def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print("wrote", name, size)

# Rounded tile (favicon + Android "any" + general use)
rnd = master(0.60, True)
save(rnd, "favicon-32.png", 32)
save(rnd, "icon-192.png", 192)
save(rnd, "icon-512.png", 512)

# Full-bleed square — iOS masks it itself (no pre-rounding, no transparency)
full = master(0.60, False)
save(full.convert("RGB"), "apple-touch-icon.png", 180)

# Maskable (Android): full-bleed, glyph kept smaller inside the safe zone
mask_master = master(0.46, False)
save(mask_master, "maskable-512.png", 512)

# Scalable favicon (vector) — crisp in browser tabs
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#c8f060"/><stop offset="1" stop-color="#f0b860"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <text x="32" y="33" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', serif" font-style="italic"
        font-weight="700" font-size="44" fill="#0e0e0e">S</text>
</svg>'''
open(os.path.join(OUT, "favicon.svg"), "w").write(svg)
print("wrote favicon.svg")
print("done")
