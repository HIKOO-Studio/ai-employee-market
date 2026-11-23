"""生成情景素材占位图（含中性命名的旧价促销海报 promo-poster-01.png，无透题提示）。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import matplotlib.font_manager as fm

OUT = Path(__file__).resolve().parent.parent / "materials" / "assets"
OUT.mkdir(parents=True, exist_ok=True)


def find_font():
    pref = [
        "PingFang SC",
        "Hiragino Sans GB",
        "Noto Sans CJK SC",
        "Noto Sans SC",
        "WenQuanYi Zen Hei",
        "Arial Unicode MS",
        "SimHei",
    ]
    have = {f.name: f.fname for f in fm.fontManager.ttflist}
    for name in pref:
        if name in have:
            return have[name]
    raise SystemExit("找不到中文字体")


FONT = find_font()


def font(size):
    return ImageFont.truetype(FONT, size)


def center(draw, box, text, fnt, fill):
    x0, y0, x1, y1 = box
    bb = draw.multiline_textbbox((0, 0), text, font=fnt)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    draw.multiline_text(
        (x0 + (x1 - x0 - w) / 2, y0 + (y1 - y0 - h) / 2),
        text,
        font=fnt,
        fill=fill,
        align="center",
    )


def card(path, w, h, bg, label, sub=""):
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([8, 8, w - 9, h - 9], outline=(255, 255, 255), width=3)
    center(d, (0, 0, w, h - 40 if sub else 0), label, font(44), (255, 255, 255))
    if sub:
        center(d, (0, h - 110, w, h - 30), sub, font(26), (240, 240, 240))
    img.save(OUT / path, quality=88)
    print("生成", path)


# 产品图 4 张
products = [
    ("product-1.jpg", (62, 96, 164), "澄露精华\n瓶身正面"),
    ("product-2.jpg", (96, 62, 130), "质地特写\n水润精华"),
    ("product-3.jpg", (52, 120, 110), "滴管细节"),
    ("product-4.jpg", (150, 100, 60), "手持尺寸对比"),
]
for name, color, label in products:
    card(name, 600, 600, color, label)

# 场景图 3 张
scenes = [
    ("scene-1.jpg", (70, 80, 100), "宿舍桌面"),
    ("scene-2.jpg", (40, 44, 66), "凌晨台灯"),
    ("scene-3.jpg", (110, 88, 70), "通勤包"),
]
for name, color, label in scenes:
    card(name, 800, 600, color, label)

# 视觉陷阱素材：中性文件名 promo-poster-01.png，画面印有旧价 ¥129，无任何剧透提示
w, h = 800, 1000
img = Image.new("RGB", (w, h), (246, 224, 215))
d = ImageDraw.Draw(img)
d.rectangle([20, 20, w - 21, h - 21], outline=(190, 90, 80), width=6)
center(d, (0, 70, w, 170), "澄露玻尿酸保湿精华", font(46), (120, 50, 45))
center(d, (0, 170, w, 230), "限时特惠 · 学生党保湿好物", font(28), (150, 90, 80))
d.rounded_rectangle([150, 300, 650, 560], radius=24, fill=(200, 70, 60))
center(d, (150, 300, 650, 560), "¥129", font(150), (255, 240, 220))
center(d, (0, 590, w, 650), "30ml · 5 重玻尿酸复配", font(30), (120, 50, 45))
center(d, (0, 660, w, 720), "活动时间：11月1日 - 11月30日", font(24), (150, 90, 80))
img.save(OUT / "promo-poster-01.png")
print("生成 promo-poster-01.png")
print("完成 →", OUT)
