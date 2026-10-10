#!/usr/bin/env python3
"""Draw the app icons (icon.svg plus the PNG sizes) from one geometry: a receptor with
notches in its underside and a key whose coloured teeth fit them. Pillow only."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent / 'icons'
BG = (2, 5, 7)
SLAB = (23, 50, 56)
RIM = (120, 240, 210)
# (notch depth 0..1, tooth colour) per site
SITES = [(0.55, (242, 184, 75)), (0.9, (180, 140, 255)), (0.35, (79, 157, 255)),
         (0.7, (255, 100, 100)), (0.45, (79, 214, 160))]


def geometry(s, inset):
    """Shapes in a 0..s square; inset shrinks the art for maskable safe zones."""
    m = s * inset
    w = s - 2 * m
    u = w * 0.8 / len(SITES)
    x0 = m + w * 0.1
    top = m + w * 0.16
    mouth = m + w * 0.48
    deep = w * 0.2
    slab = [(x0 - u * 0.2, top), (x0 + u * len(SITES) + u * 0.2, top), (x0 + u * len(SITES) + u * 0.2, mouth)]
    for i in reversed(range(len(SITES))):
        d = deep * SITES[i][0]
        a = x0 + i * u
        slab += [(a + u, mouth), (a + u * 0.88, mouth - d), (a + u * 0.12, mouth - d), (a, mouth)]
    slab += [(x0 - u * 0.2, mouth)]
    base = mouth + w * 0.2
    teeth = []
    for i, (depth, col) in enumerate(SITES):
        d = deep * depth
        a = x0 + i * u
        teeth.append(((a + u * 0.2, mouth - d + u * 0.06, a + u * 0.8, base), col))
    backbone = (x0 - u * 0.1, base, x0 + u * len(SITES) + u * 0.1, base + w * 0.05)
    return slab, teeth, backbone


def png(size, inset, rounded):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=BG)
    else:
        d.rectangle((0, 0, s, s), fill=BG)
    slab, teeth, backbone = geometry(s, inset)
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for box, col in teeth:
        gd.rectangle(box, fill=col + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.polygon(slab, fill=SLAB, outline=RIM, width=max(2, s // 90))
    for box, col in teeth:
        d.rectangle(box, fill=col)
    d.rectangle(backbone, fill=(200, 230, 235))
    return img.resize((size, size), Image.LANCZOS)


def svg():
    s = 512
    slab, teeth, backbone = geometry(s, 0.0)
    pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in slab)
    rects = ''.join(
        f'<rect x="{a:.1f}" y="{b:.1f}" width="{c - a:.1f}" height="{e - b:.1f}" fill="rgb{col}"/>'
        for (a, b, c, e), col in teeth)
    a, b, c, e = backbone
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}">'
            f'<rect width="{s}" height="{s}" rx="{s * 0.22:.0f}" fill="rgb{BG}"/>'
            f'<polygon points="{pts}" fill="rgb{SLAB}" stroke="rgb{RIM}" stroke-width="5" stroke-linejoin="round"/>'
            f'{rects}<rect x="{a:.1f}" y="{b:.1f}" width="{c - a:.1f}" height="{e - b:.1f}" fill="rgb(200,230,235)"/></svg>\n')


ROOT.mkdir(exist_ok=True)
(ROOT / 'icon.svg').write_text(svg())
png(192, 0.06, True).save(ROOT / 'icon-192.png')
png(512, 0.06, True).save(ROOT / 'icon-512.png')
png(512, 0.16, False).save(ROOT / 'icon-maskable-512.png')
png(180, 0.08, False).convert('RGB').save(ROOT / 'apple-touch-icon.png')
print('wrote', ', '.join(sorted(p.name for p in ROOT.iterdir())))
