"""이남 카트 경주로 → data/kart_track.js (window.KART_TRACK)

data/bus.js에 있는 실제 버스 노선 선(line)을 이어 붙여 한 바퀴를 만든다(2026-10-21).
  이동읍행정복지센터 → 창리 → 월곡 → 남곡사거리 (25번)
  → 북리 → 산정동 → 도장 → 봉무리 → 남사(내기) (72번)
  → 오목재 → 후촌 → 중복동 → 어비리 → 장서리 → 점촌 → 묘봉리 → 이동저수지 → 송전 (6번 돌아오는 길)
  → 이동읍행정복지센터 (25번 첫 구간)
길 모양만 쓰고 게임 크기로 줄인다(SCALE). 같은 길을 갔다 오는 가지(정류소 들르기 등)는 잘라 낸다.
버스 노선이 바뀌어도 길은 거의 그대로라 손으로 한 번 돌린다: python site/scripts/build_kart.py
"""
from __future__ import annotations

import json
import math
import pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent
BUS_JS = SITE / "data" / "bus.js"
OUT = SITE / "data" / "kart_track.js"

LEGS = [  # (노선, 출발 정류소, 도착 정류소) 차례대로 이어 붙인다
    ("25", "이동읍행정복지센터", "남곡사거리.남곡초교"),
    ("72", "남곡사거리.남곡초교", "남사"),
    ("6", "남사", "송전터미널"),
    ("25", "송전터미널", "이동읍행정복지센터"),
]
# 지나갈 때 화면에 띄우는 이름(마을·교차로 이름만, 가게·회사 이름은 쓰지 않는다). 게임에서 70m 안에 몰리는 것(봉무리·오목재)은 뺐다
LANDMARKS = [
    ("창리", "창리"), ("월곡", "월곡"), ("남곡사거리.남곡초교", "남곡사거리"),
    ("북2리", "북리"), ("산정동", "산정동"), ("도장", "도장"),
    ("내기삼거리(미정차)", "남사읍 내기"), ("후촌", "후촌"),
    ("중복동", "중복동"), ("어비1리", "어비리"), ("장서리", "장서리"), ("점촌", "점촌"),
    ("묘봉1리입구", "묘봉리"), ("이동저수지.송전낚시터", "이동저수지"),
    ("송전초교.송전바이오고교입구", "송전"),
]
GAME_LENGTH = 2400.0   # 게임 속 한 바퀴 길이(m). 실제 길이를 이 길이로 줄인다
STEP = 4.0             # 내보내는 점 간격(게임 m)
MIN_RADIUS = 26.0      # 이보다 급한 굽이는 펴 준다(게임 m)


def load_bus() -> dict:
    s = BUS_JS.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


def to_xy(lat: float, lng: float, lat0: float, lng0: float) -> tuple[float, float]:
    """위경도 → 미터(x 동쪽, y 남쪽). 이 넓이(수 km)에선 평면으로 봐도 된다."""
    return ((lng - lng0) * 111320 * math.cos(math.radians(lat0)), -(lat - lat0) * 110540)


def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def cumlen(pts) -> list[float]:
    c = [0.0]
    for a, b in zip(pts, pts[1:]):
        c.append(c[-1] + dist(a, b))
    return c


def seg_dist(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1e-12)))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)


def stop_line_index(line, latlng, start: int) -> int:
    """정류소에 가장 가까운 선 위의 점. 노선 선은 굽이에만 점이 있어 듬성하므로 선분 거리로 잰다.
    노선은 같은 길을 갔다 오므로 start부터 앞으로만 찾고, 가까운 선분(80m 안)을 찾은 뒤 멀어지면 멈춘다."""
    m = lambda q: (q[1] * 88800, q[0] * 110540)  # 위경도 → 대략 미터
    p = m(latlng)
    best, best_i = 1e18, start
    for i in range(start, len(line) - 1):
        d = seg_dist(p, m(line[i]), m(line[i + 1]))
        if d < best:
            best = d
            best_i = i if dist(p, m(line[i])) <= dist(p, m(line[i + 1])) else i + 1
        elif best < 80 and d > best + 400:
            break
    return best_i


def leg_points(route: dict, stations: dict, a: str, b: str) -> list:
    names = [stations[str(s)][2] if str(s) in stations else "" for s in route["stops"]]
    ia = names.index(a)
    ib = names.index(b, ia + 1)
    line = [p for part in route["line"] for p in part]
    li = 0
    idx = {}
    for k in range(ia + 1):
        li = stop_line_index(line, stations[str(route["stops"][k])], li)
    idx[a] = li
    for k in range(ia + 1, ib + 1):
        li = stop_line_index(line, stations[str(route["stops"][k])], li)
    idx[b] = li
    return line[idx[a]: idx[b] + 1]


def remove_spurs(pts, near=35.0, min_loop=150.0, max_loop=2500.0):
    """같은 자리로 되돌아오는 가지(갔다 오는 길, 작은 고리)를 잘라 낸다."""
    c = cumlen(pts)
    out, i, n = [], 0, len(pts)
    while i < n:
        out.append(pts[i])
        jump = None
        j = i + 2
        while j < n and c[j] - c[i] < max_loop:
            if c[j] - c[i] > min_loop and dist(pts[i], pts[j]) < near:
                jump = j
            j += 1
        i = jump + 1 if jump else i + 1
    return out


def simplify(pts, tol):
    """Douglas-Peucker"""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = dist(a, b) or 1e-9
    far, fi = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / ab
        if d > far:
            far, fi = d, i
    if far <= tol:
        return [a, b]
    return simplify(pts[: fi + 1], tol)[:-1] + simplify(pts[fi:], tol)


def resample_closed(pts, step):
    ring = pts + [pts[0]]
    c = cumlen(ring)
    total = c[-1]
    n = max(8, round(total / step))
    out, k = [], 0
    for m in range(n):
        s = total * m / n
        while c[k + 1] < s:
            k += 1
        t = (s - c[k]) / ((c[k + 1] - c[k]) or 1e-9)
        out.append((ring[k][0] + (ring[k + 1][0] - ring[k][0]) * t, ring[k][1] + (ring[k + 1][1] - ring[k][1]) * t))
    return out


def radius_at(pts, i, gap=3):
    n = len(pts)
    a, b, c = pts[(i - gap) % n], pts[i], pts[(i + gap) % n]
    ab, bc, ca = dist(a, b), dist(b, c), dist(c, a)
    cross = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    return 1e9 if cross < 1e-9 else ab * bc * ca / (2 * cross)


def relax_sharp(pts, rmin, rounds=400):
    """급한 굽이 둘레만 이웃 평균 쪽으로 당긴다(나머지 모양은 그대로)."""
    pts = list(pts)
    n = len(pts)
    for _ in range(rounds):
        sharp = [i for i in range(n) if radius_at(pts, i) < rmin]
        if not sharp:
            break
        moved = set()
        for i in sharp:
            for k in range(i - 4, i + 5):
                moved.add(k % n)
        nxt = list(pts)
        for i in moved:
            p0, p1, p2 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
            nxt[i] = (p1[0] * 0.5 + (p0[0] + p2[0]) * 0.25, p1[1] * 0.5 + (p0[1] + p2[1]) * 0.25)
        pts = nxt
    return pts


def chaikin_closed(pts, rounds=3):
    for _ in range(rounds):
        n, out = len(pts), []
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        pts = out
    return pts


def main() -> None:
    bus = load_bus()
    stations = bus["stations"]
    routes = {r["no"]: r for r in bus["routes"]}
    latlng = []
    for no, a, b in LEGS:
        seg = leg_points(routes[no], stations, a, b)
        latlng += seg if not latlng else seg[1:]
    lat0 = sum(p[0] for p in latlng) / len(latlng)
    lng0 = sum(p[1] for p in latlng) / len(latlng)
    raw = [to_xy(p[0], p[1], lat0, lng0) for p in latlng]
    raw_len = cumlen(raw)[-1]
    real = remove_spurs(raw)
    if dist(real[0], real[-1]) < 5:
        real = real[:-1]
    real_len = cumlen(real + [real[0]])[-1]

    scale = GAME_LENGTH / real_len
    pts = [(x * scale, y * scale) for x, y in simplify(real, 25.0)]
    pts = chaikin_closed(pts, 3)
    pts = resample_closed(pts, 2.0)
    pts = relax_sharp(pts, MIN_RADIUS)
    pts = resample_closed(pts, STEP)
    # 출발선은 이동읍행정복지센터(선의 첫 점). 시계 방향 여부와 상관없이 노선 차례대로 달린다.
    start = to_xy(*stations["228000854"][:2], lat0, lng0)
    start = (start[0] * scale, start[1] * scale)
    k0 = min(range(len(pts)), key=lambda i: dist(pts[i], start))
    pts = pts[k0:] + pts[:k0]
    game_c = cumlen(pts + [pts[0]])

    def s_of(lat, lng):
        x, y = to_xy(lat, lng, lat0, lng0)
        x, y = x * scale, y * scale
        i = min(range(len(pts)), key=lambda k: dist(pts[k], (x, y)))
        return round(game_c[i], 1), round(dist(pts[i], (x, y)), 1)

    by_name = {}
    for sid, (la, ln, nm) in stations.items():
        by_name.setdefault(nm, []).append((la, ln))
    marks = []
    for stop, label in LANDMARKS:
        cands = [s_of(la, ln) for la, ln in by_name.get(stop, [])]
        cands = [c for c in cands if c[1] < 60]
        if cands:
            marks.append([min(cands, key=lambda c: c[1])[0], label])
    marks.sort()
    # 이동저수지: 남쪽 길(어비리)과 동쪽 길(묘봉리) 사이. 모양은 게임 화면에서 길을 피해 그린다(실제 물가 모양 아님).
    lake_stops = ["이동저수지.송전낚시터", "어비1리", "동도사", "묘봉2리.곽터"]
    lx = [to_xy(*by_name[s][0], lat0, lng0) for s in lake_stops if s in by_name]
    lake = (sum(p[0] for p in lx) / len(lx) * scale, sum(p[1] for p in lx) / len(lx) * scale)

    min_r = min(radius_at(pts, i) for i in range(len(pts)))
    data = {
        "name": "이동·남사 한 바퀴",
        "source": "경기도 버스정보 노선 경로(data/bus.js) 25·72·6번을 이어 붙임",
        "real_km": round(real_len / 1000, 1),
        "scale": round(scale, 5),
        "length": round(game_c[-1], 1),
        "points": [[round(x, 1), round(y, 1)] for x, y in pts],
        "landmarks": marks,
        "lake": [round(lake[0], 1), round(lake[1], 1)],
    }
    OUT.write_text("window.KART_TRACK = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"버스 선 {raw_len/1000:.1f}km → 가지 자른 뒤 {real_len/1000:.1f}km → 게임 {game_c[-1]:.0f}m, "
          f"점 {len(pts)}개, 가장 급한 굽이 반지름 {min_r:.1f}m, 이름 {len(marks)}개 → {OUT.name}")
    for s, nm in marks:
        print(f"  {s:7.1f}m {nm}")


if __name__ == "__main__":
    main()
