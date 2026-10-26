# -*- coding: utf-8 -*-
"""生成 ImageGrab 扩展图标（16/32/48/128px）。

设计：蓝紫渐变圆角方块 + 白色「图片」线框 + 右下角白色下载徽标。
使用 4 倍超采样再缩放，保证小尺寸下边缘干净。
"""
from PIL import Image, ImageDraw
import os

S = 512          # 超采样画布
SCALE = S / 128  # 以 128 为设计基准
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

C1 = (79, 124, 255)    # #4F7CFF
C2 = (155, 92, 246)    # #9B5CF6


def px(v):
    return int(round(v * SCALE))


def gradient(size):
    """对角线性渐变。"""
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        # 横向也做轻微变化，形成对角效果
        for x in range(0, size, 1):
            k = (x / (size - 1) * 0.35 + t * 0.65)
            r = int(C1[0] + (C2[0] - C1[0]) * k)
            g = int(C1[1] + (C2[1] - C1[1]) * k)
            b = int(C1[2] + (C2[2] - C1[2]) * k)
            d.point((x, y), (r, g, b))
    return img


def draw_icon():
    base = gradient(S).convert("RGBA")

    # 圆角遮罩
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=px(30), fill=255)
    base.putalpha(mask)

    d = ImageDraw.Draw(base)

    # 图片框（白色描边）
    box = [px(33), px(28), px(95), px(78)]
    d.rounded_rectangle(box, radius=px(10), outline=(255, 255, 255, 255), width=px(6.5))

    # 框内太阳
    d.ellipse([px(43), px(38), px(55), px(50)], fill=(255, 255, 255, 255))

    # 框内山峦（在框内部区域裁切绘制）
    mountain = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    md = ImageDraw.Draw(mountain)
    md.polygon(
        [(px(36), px(73)), (px(54), px(52)), (px(66), px(64)),
         (px(76), px(55)), (px(92), px(73))],
        fill=(255, 255, 255, 255),
    )
    inner = Image.new("L", (S, S), 0)
    ImageDraw.Draw(inner).rounded_rectangle(
        [box[0] + px(4), box[1] + px(4), box[2] - px(4), box[3] - px(4)],
        radius=px(7), fill=255,
    )
    base.paste(mountain, (0, 0), Image.composite(mountain.split()[3], Image.new("L", (S, S), 0), inner))

    # 右下角下载徽标
    cx, cy, r = px(97), px(97), px(22)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    # 徽标内箭头（紫蓝色）
    arrow = (99, 92, 246, 255)
    d.rounded_rectangle([cx - px(2.6), cy - px(12), cx + px(2.6), cy + px(3)], radius=px(2.6), fill=arrow)
    d.polygon([(cx - px(8), cy - px(2)), (cx + px(8), cy - px(2)), (cx, cy + px(8))], fill=arrow)
    # 托盘
    d.rounded_rectangle([cx - px(10), cy + px(11), cx + px(10), cy + px(13.5)], radius=px(1.2), fill=arrow)

    return base


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw_icon()
    for size in (16, 32, 48, 128):
        img = big.resize((size, size), Image.LANCZOS)
        path = os.path.join(OUT, f"icon{size}.png")
        img.save(path, "PNG", optimize=True)
        print("saved", path)


if __name__ == "__main__":
    main()
