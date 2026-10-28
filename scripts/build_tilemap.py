"""첫 화면 '장소 찾기' 타일 배경 지도(img/tile-map.svg)를 만든다(2026-10-29).

사용자 10-29: "분홍색 핀만 덩그러니 … 배경에 지도 같은 거 넣고 우리 가게 위치에 핀 꼽혀 있는 것처럼" — 가게 이름은 안 넣는다.
그림을 지어내지 않으려고 실제 자료만 쓴다: 길 = 버스 노선 경로(data/bus.js line), 점 = 장소 좌표(data/places.json).
가게(송전돈가네, places_extra의 mine)가 그림 한가운데 오게 자른다 — 타일에서 핀을 그림 가운데에 꽂는다(style.css .tile-map).
자료가 바뀌어도 자주 다시 돌릴 필요는 없다(길은 거의 안 바뀐다).
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "img" / "tile-map.svg"
W, H = 400, 240          # 그림 비율(타일 오른쪽에 slice로 깔린다)
HALF_KM = 2.4            # 가게에서 좌우로 보이는 거리

def load_js(p):
    t = p.read_text(encoding="utf-8")
    return json.loads(t[t.index("{"):t.rstrip().rstrip(";").rindex("}") + 1])

places = json.loads((ROOT / "data" / "places.json").read_text(encoding="utf-8"))["places"]
me = next(p for p in places if p.get("mine"))
lat0, lng0 = me["lat"], me["lng"]
px_km = W / 2 / HALF_KM
kx = px_km * 111.32 * math.cos(math.radians(lat0))  # 경도 1도 → 픽셀
ky = px_km * 110.57                                 # 위도 1도 → 픽셀(가로세로 같은 축척)
xy = lambda la, lo: (W / 2 + (lo - lng0) * kx, H / 2 - (la - lat0) * ky)
inside = lambda x, y, m=40: -m <= x <= W + m and -m <= y <= H + m

# 길: 노선 경로를 그림 안쪽만 이어 붙인다(같은 길을 여러 노선이 지나도 path 하나라 진해지지 않는다)
segs = []
for r in load_js(ROOT / "data" / "bus.js")["routes"]:
    for line in r.get("line") or []:
        cur = []
        for la, lo in line:
            x, y = xy(la, lo)
            if inside(x, y):
                cur.append(f"{x:.1f} {y:.1f}")
            elif cur:
                segs.append(cur); cur = []
        if len(cur) > 1:
            segs.append(cur)
roads = " ".join("M" + " L".join(s) for s in segs if len(s) > 1)

# 점: 가게·시설 자리(마을이 어디 모여 있는지 보인다). 같은 칸은 한 번만
seen, dots = set(), []
for p in places:
    x, y = xy(p["lat"], p["lng"])
    if not inside(x, y, 0):
        continue
    k = (round(x / 5), round(y / 5))
    if k in seen:
        continue
    seen.add(k)
    dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.6"/>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">
<g fill="#fff" fill-opacity=".22">{"".join(dots)}</g>
<path d="{roads}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
<path d="{roads}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''
OUT.write_text(svg, encoding="utf-8")
print(f"→ {OUT} (길 {len(segs)}토막, 점 {len(dots)}개, {OUT.stat().st_size // 1024}KB)")
