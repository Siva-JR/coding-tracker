"""Cuts the RMK crest out of its white background and writes a transparent PNG (and a favicon) to public/brand/.

Usage (from web/):  python3 scripts/make-brand-assets.py <crest.jpg>
Needs Pillow and numpy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'public' / 'brand'


def cutout(src, name, thresh, max_side, pad=6):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    marked = im.copy()
    key = (255, 0, 255)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(marked, seed, key, thresh=thresh)
    a = np.array(marked)
    is_bg = (a[:, :, 0] == 255) & (a[:, :, 1] == 0) & (a[:, :, 2] == 255)
    alpha = Image.fromarray(np.where(is_bg, 0, 255).astype('uint8'))
    # shave a pixel of fringe, then soften the edge so it blends on any background
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.copy()
    rgba.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
    rgba = rgba.crop((max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, w), min(bbox[3] + pad, h)))
    scale = max_side / max(rgba.size)
    if scale < 1:
        rgba = rgba.resize((round(rgba.width * scale), round(rgba.height * scale)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    rgba.save(OUT / name, optimize=True)
    return rgba


def dominant(img, n=5):
    a = np.array(img.convert('RGBA')).reshape(-1, 4)
    a = a[a[:, 3] > 200][:, :3]
    sat = a.max(1).astype(int) - a.min(1).astype(int)
    a = a[sat > 50]
    q = (a // 24) * 24 + 12
    cols, cnt = np.unique(q, axis=0, return_counts=True)
    return ['#%02x%02x%02x' % tuple(cols[i]) for i in np.argsort(-cnt)[:n]]


if __name__ == '__main__':
    crest_src = sys.argv[1]
    crest = cutout(crest_src, 'rmk-crest.png', thresh=34, max_side=489)

    # square favicon from the crest
    side = max(crest.size)
    icon = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    icon.alpha_composite(crest, ((side - crest.width) // 2, (side - crest.height) // 2))
    icon.resize((128, 128), Image.LANCZOS).save(OUT / 'favicon.png', optimize=True)

    print('crest', crest.size)
    print('crest colours:', dominant(crest))
