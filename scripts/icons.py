"""Draws the toolbar icon: an ink-black tile holding a white page with three text lines."""
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
N = 1024
img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([40, 40, N - 40, N - 40], radius=200, fill=(17, 17, 17, 255))
# page
px0, py0, px1, py1 = 270, 200, 754, 824
fold = 150
d.polygon([(px0, py0), (px1 - fold, py0), (px1, py0 + fold), (px1, py1), (px0, py1)], fill=(255, 255, 255, 255))
d.polygon([(px1 - fold, py0), (px1 - fold, py0 + fold), (px1, py0 + fold)], fill=(190, 190, 190, 255))
# text lines; the last one is short, like the end of a paragraph
for i, w in enumerate([360, 360, 220]):
    y = 430 + i * 120
    d.rounded_rectangle([px0 + 62, y, px0 + 62 + w, y + 54], radius=10, fill=(17, 17, 17, 255))
for s in (16, 32, 48, 128):
    img.resize((s, s), Image.LANCZOS).save(f"{out}/icon-{s}.png")
# App Store / store listings want a large opaque square too.
if len(sys.argv) > 2:
    flat = Image.new("RGB", (N, N), (17, 17, 17))
    flat.paste(img, (0, 0), img)
    flat.save(sys.argv[2])
