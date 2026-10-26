# -*- coding: utf-8 -*-
"""生成端到端测试与官网截图用的模拟商品图 / 详情页素材。"""
import os
import random
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
SS = 3            # 超采样倍数
SIZE = 900        # 输出尺寸
W = SIZE * SS


def gradient(w, h, c1, c2, diagonal=0.3):
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    t = x * diagonal + y * (1 - diagonal)
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for i in range(3):
        arr[:, :, i] = c1[i] + (c2[i] - c1[i]) * t
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGB")


def soft_glow(img):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.ellipse([-W * 0.25, -W * 0.35, W * 0.55, W * 0.45], fill=(255, 255, 255, 70))
    overlay = overlay.filter(ImageFilter.GaussianBlur(int(W * 0.06)))
    return Image.alpha_composite(img.convert("RGBA"), overlay)


def base(c1, c2):
    img = gradient(W, W, c1, c2)
    img = soft_glow(img)
    shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([W * 0.24, W * 0.79, W * 0.76, W * 0.88], fill=(30, 27, 75, 55))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(W * 0.018)))
    return Image.alpha_composite(img, shadow)


def p(v):
    return int(round(v * W / 100.0))


def lw(v):
    return max(1, int(round(v * W / 100.0)))


def save(img, name):
    img = img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    img.save(os.path.join(OUT, name), "PNG", optimize=True)
    print("saved", name)


def perfume():
    img = base((253, 231, 243), (217, 199, 255))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([p(33), p(38), p(67), p(81)], radius=p(5), fill=(255, 255, 255, 150), outline=(255, 255, 255, 230), width=lw(1.1))
    d.rounded_rectangle([p(35), p(57), p(65), p(79)], radius=p(4), fill=(244, 114, 182, 165))
    d.rounded_rectangle([p(45), p(31), p(55), p(39)], radius=p(1), fill=(148, 163, 184, 235))
    d.rounded_rectangle([p(42), p(21), p(58), p(32)], radius=p(2), fill=(31, 41, 55, 245))
    d.rounded_rectangle([p(42), p(61), p(58), p(71)], radius=p(1.6), fill=(255, 255, 255, 220))
    d.line([p(45), p(64), p(55), p(64)], fill=(148, 163, 184, 200), width=lw(0.5))
    d.line([p(45), p(67), p(52), p(67)], fill=(203, 213, 225, 220), width=lw(0.45))
    d.line([p(38), p(42), p(38), p(75)], fill=(255, 255, 255, 190), width=lw(1.4))
    return img


def headphones():
    img = base((224, 242, 254), (199, 210, 254))
    d = ImageDraw.Draw(img, "RGBA")
    d.arc([p(24), p(24), p(76), p(76)], 180, 360, fill=(30, 41, 59, 245), width=lw(6))
    d.rounded_rectangle([p(21), p(51), p(35), p(73)], radius=p(5), fill=(30, 41, 59, 245))
    d.rounded_rectangle([p(65), p(51), p(79), p(73)], radius=p(5), fill=(30, 41, 59, 245))
    d.rounded_rectangle([p(24), p(55), p(32), p(69)], radius=p(3.5), fill=(129, 140, 248, 255))
    d.rounded_rectangle([p(68), p(55), p(76), p(69)], radius=p(3.5), fill=(129, 140, 248, 255))
    return img


def watch():
    img = base((254, 243, 199), (253, 230, 138))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([p(43), p(16), p(57), p(84)], radius=p(5), fill=(120, 53, 15, 235))
    for y in range(20, 82, 5):
        d.line([p(45), p(y), p(55), p(y)], fill=(254, 243, 199, 90), width=lw(0.5))
    d.ellipse([p(33), p(36), p(67), p(70)], fill=(255, 251, 235, 255), outline=(120, 53, 15, 255), width=lw(3))
    d.ellipse([p(36), p(39), p(64), p(67)], fill=(255, 255, 255, 255), outline=(245, 158, 11, 150), width=lw(0.7))
    cx, cy = p(50), p(53)
    d.line([cx, cy, cx, p(44)], fill=(30, 41, 59, 240), width=lw(1.6))
    d.line([cx, cy, cx + p(8), cy + p(4)], fill=(30, 41, 59, 240), width=lw(1.2))
    d.ellipse([cx - p(1.2), cy - p(1.2), cx + p(1.2), cy + p(1.2)], fill=(245, 158, 11, 255))
    for angle in range(0, 360, 30):
        r1, r2 = 12, 13.2
        a = math.radians(angle)
        d.line([cx + p(r1 * math.cos(a)), cy + p(r1 * math.sin(a)), cx + p(r2 * math.cos(a)), cy + p(r2 * math.sin(a))], fill=(120, 53, 15, 170), width=lw(0.4))
    d.rounded_rectangle([p(64), p(49), p(66.5), p(55)], radius=p(0.8), fill=(120, 53, 15, 255))
    return img


def camera():
    img = base((224, 231, 255), (199, 210, 254))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([p(24), p(38), p(76), p(73)], radius=p(6), fill=(30, 41, 59, 246))
    d.rounded_rectangle([p(36), p(31), p(60), p(41)], radius=p(2), fill=(30, 41, 59, 246))
    d.rounded_rectangle([p(27), p(41), p(36), p(44)], radius=p(1), fill=(148, 163, 184, 220))
    d.ellipse([p(35), p(43), p(65), p(73)], fill=(241, 245, 249, 255))
    d.ellipse([p(38), p(46), p(62), p(70)], fill=(51, 65, 85, 255))
    d.ellipse([p(43), p(51), p(57), p(65)], fill=(99, 102, 241, 235))
    d.ellipse([p(46), p(54), p(53), p(61)], fill=(224, 231, 255, 180))
    d.ellipse([p(56), p(46), p(61), p(51)], fill=(255, 255, 255, 190))
    d.ellipse([p(65), p(43), p(70), p(48)], fill=(251, 191, 36, 255))
    d.rounded_rectangle([p(32), p(60), p(34), p(66)], radius=p(0.5), fill=(148, 163, 184, 180))
    return img


def lamp():
    img = base((255, 228, 230), (254, 205, 211))
    d = ImageDraw.Draw(img, "RGBA")
    d.polygon([(p(35), p(26)), (p(65), p(26)), (p(75), p(51)), (p(25), p(51))], fill=(251, 113, 133, 235))
    d.polygon([(p(38), p(29)), (p(49), p(29)), (p(45), p(48)), (p(31), p(48))], fill=(255, 255, 255, 60))
    d.rounded_rectangle([p(48.4), p(51), p(51.6), p(79)], radius=p(1.2), fill=(120, 53, 15, 240))
    d.ellipse([p(35), p(77), p(65), p(84)], fill=(120, 53, 15, 245))
    d.ellipse([p(44), p(52), p(56), p(58)], fill=(254, 215, 170, 220))
    d.line([p(50), p(51), p(50), p(80)], fill=(255, 255, 255, 40), width=lw(0.6))
    return img


def bag():
    img = base((220, 252, 231), (187, 247, 208))
    d = ImageDraw.Draw(img, "RGBA")
    d.arc([p(38), p(22), p(62), p(54)], 180, 360, fill=(120, 53, 15, 245), width=lw(3.2))
    d.polygon([(p(28), p(43)), (p(72), p(43)), (p(76), p(79)), (p(24), p(79))], fill=(180, 83, 9, 238))
    d.polygon([(p(30), p(45)), (p(70), p(45)), (p(72), p(57)), (p(28), p(57))], fill=(217, 119, 6, 245))
    d.ellipse([p(47.5), p(55), p(52.5), p(60)], fill=(254, 243, 199, 255))
    d.line([p(31), p(70), p(69), p(70)], fill=(120, 53, 15, 100), width=lw(0.8))
    d.line([p(29), p(47), p(29), p(77)], fill=(255, 255, 255, 70), width=lw(0.9))
    return img


def plant():
    img = base((236, 252, 203), (217, 249, 157))
    d = ImageDraw.Draw(img, "RGBA")
    d.polygon([(p(38), p(64)), (p(62), p(64)), (p(58), p(83)), (p(42), p(83))], fill=(194, 65, 12, 238))
    d.rectangle([p(36), p(60), p(64), p(65)], fill=(154, 52, 18, 245))
    d.line([p(50), p(60), p(50), p(38)], fill=(22, 101, 52, 250), width=lw(1.6))
    d.line([p(50), p(50), p(36), p(40)], fill=(22, 101, 52, 250), width=lw(1.1))
    d.line([p(50), p(47), p(63), p(35)], fill=(22, 101, 52, 250), width=lw(1.1))
    for cx, cy, rx, ry, ang in [
        (43, 44, 6, 13, 28), (57, 41, 6, 12, -24), (50, 33, 5.5, 13, 2), (36, 50, 5, 10, 45), (64, 49, 5, 10, -48)
    ]:
        leaf = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ld = ImageDraw.Draw(leaf)
        ld.ellipse([p(cx - rx), p(cy - ry), p(cx + rx), p(cy + ry)], fill=(34, 197, 94, 235))
        ld.line([p(cx), p(cy + ry * 0.7), p(cx), p(cy - ry * 0.5)], fill=(21, 128, 61, 200), width=lw(0.5))
        leaf = leaf.rotate(ang, center=(p(cx), p(cy)), resample=Image.BICUBIC)
        img = Image.alpha_composite(img, leaf)
    return img


def sunglasses():
    img = base((243, 232, 255), (233, 213, 255))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([p(22), p(42), p(47), p(62)], radius=p(7), fill=(30, 41, 59, 245))
    d.rounded_rectangle([p(53), p(42), p(78), p(62)], radius=p(7), fill=(30, 41, 59, 245))
    d.rounded_rectangle([p(26), p(45), p(43), p(59)], radius=p(5), fill=(139, 92, 246, 200))
    d.rounded_rectangle([p(57), p(45), p(74), p(59)], radius=p(5), fill=(139, 92, 246, 200))
    d.arc([p(44), p(40), p(56), p(52)], 200, 340, fill=(30, 41, 59, 245), width=lw(1.8))
    d.line([p(22), p(44), p(14), p(38)], fill=(30, 41, 59, 245), width=lw(1.8))
    d.line([p(78), p(44), p(86), p(38)], fill=(30, 41, 59, 245), width=lw(1.8))
    d.line([p(27), p(46), p(33), p(46)], fill=(255, 255, 255, 100), width=lw(0.9))
    d.line([p(58), p(46), p(64), p(46)], fill=(255, 255, 255, 100), width=lw(0.9))
    return img


def make_big():
    """大尺寸抽象纹理图：视觉上可用作详情图，同时细节丰富，转 PNG 后体积足够大。"""
    side = 1800
    rng = np.random.default_rng(11)
    img = gradient(side, side, (36, 32, 96), (132, 72, 190), diagonal=0.5).convert("RGBA")

    glow = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    palette = [
        (255, 196, 128, 90),
        (255, 120, 180, 80),
        (120, 200, 255, 80),
        (180, 140, 255, 90),
        (255, 255, 255, 45),
    ]
    for _ in range(22):
        cx = rng.integers(-200, side + 200)
        cy = rng.integers(-200, side + 200)
        radius = rng.integers(140, 480)
        color = palette[int(rng.integers(0, len(palette)))]
        gd.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img = Image.alpha_composite(img, glow)

    # 细颗粒让 PNG 压缩率下降，用于验证大图转换
    arr = np.array(img.convert("RGB")).astype(np.int16)
    grain = rng.integers(-16, 17, size=(side, side, 1), dtype=np.int16)
    arr = np.clip(arr + grain, 0, 255).astype(np.uint8)
    Image.fromarray(arr, "RGB").save(os.path.join(OUT, "big.jpg"), "JPEG", quality=92)
    print("saved big.jpg")


def tryon():
    """模特试穿图：戴耳机的半身像，用于验证“试穿/模特图”会被保留。"""
    img = base((255, 237, 213), (254, 215, 170))
    d = ImageDraw.Draw(img, "RGBA")

    # 肩膀 / 上衣
    d.polygon(
        [(p(18), p(92)), (p(82), p(92)), (p(73), p(64)), (p(27), p(64))],
        fill=(79, 124, 255, 240),
    )
    d.line([p(50), p(66), p(50), p(74)], fill=(67, 56, 202, 120), width=lw(1.2))

    # 脖子
    d.rounded_rectangle([p(45), p(51), p(55), p(68)], radius=p(4), fill=(214, 163, 127, 255))

    # 头发与脸
    d.ellipse([p(31), p(16), p(69), p(60)], fill=(59, 40, 36, 255))
    d.ellipse([p(36), p(23), p(64), p(59)], fill=(248, 207, 174, 255))
    d.chord([p(35), p(14), p(65), p(44)], 180, 360, fill=(59, 40, 36, 255))

    # 眼睛与微笑
    d.ellipse([p(43), p(38), p(46), p(41)], fill=(30, 41, 59, 255))
    d.ellipse([p(54), p(38), p(57), p(41)], fill=(30, 41, 59, 255))
    d.arc([p(46), p(43), p(54), p(50)], 20, 160, fill=(190, 92, 92, 255), width=lw(0.7))
    d.ellipse([p(40), p(44), p(44), p(47)], fill=(244, 114, 182, 80))
    d.ellipse([p(56), p(44), p(60), p(47)], fill=(244, 114, 182, 80))

    # 耳机
    d.arc([p(30), p(19), p(70), p(57)], 180, 360, fill=(31, 41, 55, 255), width=lw(4.2))
    d.rounded_rectangle([p(27), p(36), p(37), p(57)], radius=p(4.5), fill=(31, 41, 55, 255))
    d.rounded_rectangle([p(63), p(36), p(73), p(57)], radius=p(4.5), fill=(31, 41, 55, 255))
    d.rounded_rectangle([p(29.5), p(40), p(34.5), p(53)], radius=p(2.4), fill=(129, 140, 248, 255))
    d.rounded_rectangle([p(65.5), p(40), p(70.5), p(53)], radius=p(2.4), fill=(129, 140, 248, 255))
    return img


def make_extras():
    # 懒加载图
    Image.open(os.path.join(OUT, "p4.png")).convert("RGB").resize((800, 800), Image.LANCZOS).save(
        os.path.join(OUT, "lazy.webp"), "WEBP", quality=88
    )
    # 背景横幅
    banner = gradient(1400, 640, (79, 124, 255), (155, 92, 246), diagonal=0.55)
    bd = ImageDraw.Draw(banner, "RGBA")
    for i in range(6):
        bd.ellipse([1400 - i * 260, -120 + i * 40, 1600 - i * 160, 220 + i * 80], outline=(255, 255, 255, 35), width=3)
    banner.save(os.path.join(OUT, "bg.jpg"), "JPEG", quality=90)
    # 小尺寸图（应被过滤）
    Image.open(os.path.join(OUT, "p6.png")).convert("RGB").resize((90, 90), Image.LANCZOS).save(
        os.path.join(OUT, "thumb.jpg"), "JPEG", quality=88
    )
    Image.new("RGB", (32, 32), (79, 124, 255)).save(os.path.join(OUT, "icon.png"))
    Image.new("RGB", (1, 1), (255, 255, 255)).save(os.path.join(OUT, "pixel.png"))

    # 用户头像（评价区，应被过滤）
    avatar = gradient(240, 240, (255, 228, 230), (224, 231, 255))
    ad = ImageDraw.Draw(avatar, "RGBA")
    ad.ellipse([70, 44, 170, 144], fill=(248, 207, 174, 255))
    ad.ellipse([92, 74, 104, 86], fill=(30, 41, 59, 255))
    ad.ellipse([136, 74, 148, 86], fill=(30, 41, 59, 255))
    ad.arc([104, 96, 136, 122], 20, 160, fill=(190, 92, 92, 255), width=4)
    ad.polygon([(30, 240), (210, 240), (186, 170), (54, 170)], fill=(79, 124, 255, 220))
    avatar.resize((120, 120), Image.LANCZOS).save(os.path.join(OUT, "user1.png"))

    # 优惠券二维码（应被过滤）
    qr = Image.new("RGB", (240, 240), "white")
    qd = ImageDraw.Draw(qr)
    rng = random.Random(9)
    cell = 20
    for gy in range(12):
        for gx in range(12):
            if rng.random() < 0.45:
                qd.rectangle([gx * cell, gy * cell, (gx + 1) * cell - 1, (gy + 1) * cell - 1], fill=(20, 20, 24))
    for ox, oy in [(0, 0), (160, 0), (0, 160)]:
        qd.rectangle([ox, oy, ox + 79, oy + 79], fill="white")
        qd.rectangle([ox, oy, ox + 79, oy + 79], outline=(20, 20, 24), width=10)
        qd.rectangle([ox + 28, oy + 28, ox + 51, oy + 51], fill=(20, 20, 24))
    qr.save(os.path.join(OUT, "code.png"))

    save(tryon(), "tryon.png")
    with open(os.path.join(OUT, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#e1251b"/><stop offset="1" stop-color="#ff7a45"/>'
            "</linearGradient></defs>"
            '<rect width="128" height="128" rx="30" fill="url(#g)"/>'
            '<text x="64" y="88" font-size="66" font-weight="700" fill="#fff" text-anchor="middle" '
            'font-family="PingFang SC,Microsoft YaHei,sans-serif">京</text>'
            "</svg>"
        )
    print("saved extras")


if __name__ == "__main__":
    save(perfume(), "p1.png")
    save(headphones(), "p2.png")
    save(watch(), "p3.png")
    save(camera(), "p4.png")
    save(lamp(), "p5.png")
    save(bag(), "p6.png")
    save(plant(), "p7.png")
    save(sunglasses(), "p8.png")
    make_big()
    make_extras()
