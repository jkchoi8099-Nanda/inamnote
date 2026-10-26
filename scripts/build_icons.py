"""홈 화면 앱(PWA) 아이콘 → img/icon/ (2026-10-26, 손으로 한 번).

모양은 소개 영상(영상/inam_H_screens18.html의 .icon) 끝 장면 아이콘과 같다:
160° 그라데이션 #2FC67A → #0E8A5A, 흰 '이'(Pretendard Black, 아이콘 한 변의 2/3 크기).

    python scripts/build_icons.py <Pretendard-Black.otf 경로>

글꼴은 저장소에 넣지 않는다(SIL OFL, jsDelivr orioncactus/pretendard@v1.3.9 packages/pretendard/dist/public/static/).
- icon-192·icon-512: purpose any. 둥근 네모(영상과 같은 모서리 비율 78/300), 바깥은 투명
- maskable-512: purpose maskable. 꽉 찬 네모, 글자는 안전 영역(가운데 80% 원) 안에 들어가게 작게
- apple-touch-icon(180): 꽉 찬 네모. 아이폰이 모서리를 알아서 둥글게 깎는다
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "img" / "icon"
TOP, BOTTOM = (0x2F, 0xC6, 0x7A), (0x0E, 0x8A, 0x5A)
SS = 4  # 크게 그린 뒤 줄여서 모서리·글자 가장자리를 매끄럽게


def gradient(n):
    """CSS linear-gradient(160deg, TOP, BOTTOM)을 n×n에 그린다."""
    a = math.radians(160)
    dx, dy = math.sin(a), -math.cos(a)  # 화면 좌표(y 아래)에서 그라데이션 방향
    half = (abs(n * dx) + abs(n * dy)) / 2
    img = Image.new("RGB", (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            t = ((x + .5 - n / 2) * dx + (y + .5 - n / 2) * dy) / (2 * half) + .5
            px[x, y] = tuple(round(c0 + (c1 - c0) * t) for c0, c1 in zip(TOP, BOTTOM))
    return img


def icon(size, font_path, glyph, rounded):
    n = size * SS
    img = gradient(n).convert("RGBA")
    font = ImageFont.truetype(font_path, round(n * glyph))
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), "이", font=font)
    d.text(((n - (r - l)) / 2 - l, (n - (b - t)) / 2 - t), "이", font=font, fill="white")
    if rounded:
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1), radius=round(n * 78 / 300), fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font = sys.argv[1]
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {
        "icon-192.png": (192, .667, True),
        "icon-512.png": (512, .667, True),
        "maskable-512.png": (512, .5, False),
        "apple-touch-icon.png": (180, .62, False),
    }
    for name, (size, glyph, rounded) in jobs.items():
        icon(size, font, glyph, rounded).save(OUT / name, optimize=True)
        print(name, (OUT / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
