"""링크 미리보기 그림 og.png(1200×630)를 scripts/og.html에서 찍는다(2026-10-26).

    python scripts/build_og.py

Playwright + 설치된 Chrome. 글꼴은 jsdelivr의 Pretendard를 받아 쓰므로 인터넷이 필요하다.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parent.parent

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.goto((SITE / "scripts" / "og.html").as_uri(), wait_until="networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(SITE / "og.png"))
    b.close()
print("ok", SITE / "og.png")
