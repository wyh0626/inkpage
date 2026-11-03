"""Puts the English and Chinese store screenshots side by side: store/preview-en-zh.png."""
import os
from PIL import Image, ImageDraw, ImageFont

root = os.path.join(os.path.dirname(__file__), "..", "store")
names = ["1-page-mode", "2-book-view", "3-paper-tones", "4-settings"]
W, H, GAP, TOP = 800, 500, 30, 64
out = Image.new("RGB", (W * 2 + GAP, TOP + len(names) * (H + 10)), "#e8e6e0")
draw = ImageDraw.Draw(out)
font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 30)
for j, label in enumerate(["English", "中文"]):
    x = j * (W + GAP) + W // 2 - draw.textlength(label, font=font) / 2
    draw.text((x, 16), label, fill="#111", font=font)
for i, name in enumerate(names):
    for j, lang in enumerate(["en", "zh"]):
        out.paste(Image.open(os.path.join(root, lang, f"{name}.png")).resize((W, H)), (j * (W + GAP), TOP + i * (H + 10)))
out.save(os.path.join(root, "preview-en-zh.png"))
