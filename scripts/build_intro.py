"""첫 화면 소개 영상용 작은 자료(data/intro.js)를 만든다(2026-10-14).

소개 영상은 실제 가게 위치(places.json)와 실제 버스 노선 선(bus.json)을 점·선으로 그린다. 원본은 합쳐 900KB가 넘어서
영상이 바로 시작하도록 좌표만 0~1000 정수로 줄여 따로 둔다. 그림은 장식이라 자료가 조금 낡아도 괜찮다 —
build_places.py나 build_bus.py를 다시 돌린 뒤 생각나면 이것도 돌린다.

10-21 소개 영상이 H영상(img/intro-h.mp4)으로 바뀌어 점·선은 화면에 안 나온다. 지금 쓰는 값은 버스 타일의 routes(home.js)뿐.
cat_of()는 약국을 type으로 보지만 places.json은 kind에 둔다 — 점을 다시 그릴 일이 생기면 kind로 고칠 것.

같은 날 "빈약하다" → 점에 업종(색), 나머지 노선(희미한 바탕 선), 읍 이름 자리(towns)를 더했다.
10-15 3판 → 업종을 숫자 카드와 같은 기준으로(1 식당·2 카페·간식(편의점 뺌)·3 학교·4 약국), 핀이 이동읍에서 남사읍까지 타고 가는
실제 버스 노선 한 구간(trip)을 더했다.
"""
import json
import math
from pathlib import Path
from statistics import median

DATA = Path(__file__).resolve().parents[1] / "data"
N_ROUTES = 14  # 동네 정류소를 많이 지나는 노선부터 밝게 그린다. 나머지는 바탕 선


def cat_of(p):
    """점 업종: 0 기타, 1 식당, 2 카페·간식, 3 학교, 4 약국. 홈의 숫자 카드(places-search.js doorOf·matches)와 같은 기준."""
    if p.get("type") == "약국":
        return 4
    if p["cat"] == "school":
        return 3
    if p["cat"] == "food":
        return 1
    if p["cat"] == "cafe" and p.get("type") != "편의점":
        return 2
    return 0


def trip_of(lines, a, b):
    """밝은 노선 중 두 읍 가운데를 가깝고 곧게 지나는 것의 a→b 구간(평평한 [x,y,…]). 많이 돌아가는 노선은 핀이 헤매 보인다."""
    best = None
    for l in lines:
        pts = list(zip(l[::2], l[1::2]))
        ia = min(range(len(pts)), key=lambda i: math.dist(pts[i], a))
        ib = min(range(len(pts)), key=lambda i: math.dist(pts[i], b))
        sub = pts[ia:ib + 1] if ia <= ib else pts[ib:ia + 1][::-1]
        length = sum(math.dist(sub[i], sub[i + 1]) for i in range(len(sub) - 1))
        score = math.dist(pts[ia], a) + math.dist(pts[ib], b) + 0.05 * length
        if len(sub) > 2 and (best is None or score < best[0]):
            best = (score, sub)
    return [v for p in best[1] for v in p] if best else [*a, *b]


def thin(seg, xy, gap):
    q = [xy(a, b) for a, b in seg]
    keep = [q[0]]
    for c in q[1:]:  # gap단위보다 가까운 점은 버린다(6단위 ≈ 수십 m)
        if abs(c[0] - keep[-1][0]) + abs(c[1] - keep[-1][1]) >= gap:
            keep.append(c)
    return sum(keep, []) if len(keep) > 1 else None


def main() -> None:
    places = json.loads((DATA / "places.json").read_text(encoding="utf-8"))["places"]
    bus = json.loads((DATA / "bus.json").read_text(encoding="utf-8"))
    located = [p for p in places if p.get("lat") and p.get("lng")]
    lat0, lat1 = min(p["lat"] for p in located), max(p["lat"] for p in located)
    lng0, lng1 = min(p["lng"] for p in located), max(p["lng"] for p in located)
    # 가게가 모인 범위를 기준으로, 위도에 맞춰 가로를 줄여 실제 모양을 지킨다
    kx = math.cos(math.radians((lat0 + lat1) / 2))
    w, h = (lng1 - lng0) * kx, (lat1 - lat0)
    s = 1000 / max(w, h)
    pad = 0.12 * max(w, h)

    def xy(lat, lng):
        return [round(((lng - lng0) * kx + pad) * s), round(((lat1 - lat) + pad) * s)]

    size = [round((w + 2 * pad) * s), round((h + 2 * pad) * s)]
    ranked = sorted((r for r in bus["routes"] if "똑버스" not in r["no"]), key=lambda r: -r["stops_local"])
    lines = [l for r in ranked[:N_ROUTES] for seg in r["line"] if (l := thin(seg, xy, 6))]
    net = [l for r in ranked[N_ROUTES:] for seg in r["line"] if (l := thin(seg, xy, 12))]
    grid = {}
    for p in located:  # 같은 건물에 모인 가게는 점 하나로(3단위 격자). 겹치면 드문 업종(약국 > 학교 > …)을 남긴다
        x, y = xy(p["lat"], p["lng"])
        c, key = cat_of(p), (x // 3, y // 3)
        if key not in grid or c > grid[key][2]:
            grid[key] = [x, y, c]
    towns = []
    for name in ("이동읍", "남사읍"):  # 주소에 읍 이름이 들어간 가게들의 가운데
        t = [xy(p["lat"], p["lng"]) for p in located if name in p.get("addr", "")]
        if t:
            towns.append([name, round(median(a for a, _ in t)), round(median(b for _, b in t))])
    trip = trip_of(lines, towns[0][1:], towns[1][1:]) if len(towns) == 2 else []
    out = {"size": size, "pts": sum(grid.values(), []), "lines": lines, "net": net, "towns": towns, "trip": trip,
           "n": len(located), "routes": len(bus["routes"])}
    js = "window.INTRO=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (DATA / "intro.js").write_text(js, encoding="utf-8")
    print(f"intro.js {len(js.encode()) // 1024}KB · 점 {len(grid)} · 밝은 선 {len(lines)} · 바탕 선 {len(net)} · 읍 {towns} · 크기 {size}")


if __name__ == "__main__":
    main()
