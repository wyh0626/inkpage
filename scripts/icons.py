"""Draws the toolbar icon: an ink-black tile holding a white page with three text lines.

Every size comes from the page width Wp (construction card: store/icon-geometry/construction.png):
page height Wp*sqrt(phi), margin Wp/8, line thickness Wp/9, line gap = margin,
folded corner Wp/3, short line = long line / phi. The three lines sit centred
between the fold and the foot of the page.
"""
import sys
from PIL import Image, ImageDraw

PHI = (1 + 5 ** 0.5) / 2

out = sys.argv[1]
N = 1024
S = 4  # draw 4x larger, then downsample, for clean edges
K = N * S / 100  # spec units (100 x 100 artboard) to pixels

Wp = 48
Hp = Wp * PHI ** 0.5
m, U, f = Wp / 8, Wp / 9, Wp / 3
L = Wp - 2 * m
x0, x1 = 50 - Wp / 2, 50 + Wp / 2
y0, y1 = 50 - Hp / 2, 50 + Hp / 2
t0 = y0 + f + (Hp - f - (3 * U + 2 * m)) / 2

INK, PAGE, FOLD = (17, 17, 17, 255), (255, 255, 255, 255), (190, 190, 190, 255)
px = lambda *v: [round(c * K) for c in v]

img = Image.new("RGBA", (N * S, N * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle(px(40 / 10.24, 40 / 10.24, 100 - 40 / 10.24, 100 - 40 / 10.24), radius=round(200 / 10.24 * K), fill=INK)
d.polygon([tuple(px(*p)) for p in [(x0, y0), (x1 - f, y0), (x1, y0 + f), (x1, y1), (x0, y1)]], fill=PAGE)
d.polygon([tuple(px(*p)) for p in [(x1 - f, y0), (x1 - f, y0 + f), (x1, y0 + f)]], fill=FOLD)
# text lines; the last one is short, like the end of a paragraph
for i, w in enumerate([L, L, L / PHI]):
    y = t0 + i * (U + m)
    d.rounded_rectangle(px(x0 + m, y, x0 + m + w, y + U), radius=round(1 * K), fill=INK)
img = img.resize((N, N), Image.LANCZOS)

for s in (16, 32, 48, 128):
    img.resize((s, s), Image.LANCZOS).save(f"{out}/icon-{s}.png")
# App Store / store listings want a large opaque square too.
if len(sys.argv) > 2:
    flat = Image.new("RGB", (N, N), INK[:3])
    flat.paste(img, (0, 0), img)
    flat.save(sys.argv[2])
