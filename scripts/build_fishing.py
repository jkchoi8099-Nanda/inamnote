"""이동저수지 낚시 게임 지도 → data/fishing_lake.js (window.FISH_LAKE)

- 저수지 모양: OpenStreetMap way 37220427(이동저수지, Nominatim lookup). © OpenStreetMap 기여자(ODbL) — 화면에 출처를 적는다.
  받은 원본은 logs/osm_idong_lake.json(git 밖)에 두고, 받기에 실패하면 그것을 쓴다.
- 낚시 자리: 브이월드 위성영상(2026-10-21 확인)에서 좌대(물 위 낚시집)가 모여 있는 곳 6군데의 위경도.
  공공 장소검색(브이월드)의 낚시터 업소들은 북동쪽 물가(어비리 574 일대)에 몰려 있어 자리를 나누는 데는 위성영상을 썼다.
  자리 이름은 게임용으로 지어낸 것이다(실제 업소 이름 아님, 사용자 10-21 "낚시터 이름은 임의로").
- 좌대가 물가에 붙어 있어 단순화된 OSM 모양 밖에 찍히는 자리는 물 안쪽으로 15m 이상 옮긴다.
손으로 한 번 돌린다: python site/scripts/build_fishing.py
"""
from __future__ import annotations

import json
import math
import pathlib
import urllib.request

SITE = pathlib.Path(__file__).resolve().parent.parent
CACHE = SITE.parent / "logs" / "osm_idong_lake.json"
OUT = SITE / "data" / "fishing_lake.js"
OSM_WAY = "W37220427"

# (id, 게임 속 이름, 위성영상에서 본 모습, 위도, 경도, 버드나무 자리인가)
SPOTS = [
    ("willow", "버들섬 좌대", "북쪽 물줄기, 물에 잠긴 버드나무 섬 사이에 좌대가 수십 개 떠 있는 곳", 37.13139, 127.19649, True),
    ("bank", "둑길 좌대", "북쪽 물줄기 동쪽 물가를 따라 좌대가 한 줄로 선 곳", 37.13165, 127.19869, False),
    ("port", "포구 좌대", "북동쪽 작은 만, 선착장 바로 앞 흰 좌대들", 37.12390, 127.20476, False),
    ("shade", "숲그늘 좌대", "가운데 동쪽, 숲이 물가까지 내려온 버드나무 그늘 아래 좌대 줄", 37.11926, 127.20335, True),
    ("sunset", "노을 좌대", "남동쪽 물줄기 북쪽 물가의 주황 지붕 좌대 줄, 남서쪽 넓은 물을 바라본다", 37.11332, 127.20922, False),
    ("reed", "물버들 좌대", "남동쪽 물줄기 끝, 얕은 버드나무 숲 사이", 37.11098, 127.21408, True),
]


def fetch_lake() -> list[list[float]]:
    url = f"https://nominatim.openstreetmap.org/lookup?osm_ids={OSM_WAY}&format=json&polygon_geojson=1"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "inamnote-build/0.1 (local build script)"})
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read().decode("utf-8"))
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # 받기 실패 → 지난번 받은 것
        print(f"OSM 받기 실패({e}) — {CACHE.name} 사용")
        data = json.loads(CACHE.read_text(encoding="utf-8"))
    return data[0]["geojson"]["coordinates"][0]  # [[lng, lat], ...]


def inside(p, poly) -> bool:
    x, y = p
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def edge_dist(p, poly) -> float:
    best = 1e18
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1e-12)))
        best = min(best, math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t))
    return best


def free_run(p, ang, poly, step=8.0, limit=2500.0) -> float:
    """p에서 ang 방향으로 물 위로 얼마나 트였나(m)."""
    d = step
    while d < limit:
        if not inside((p[0] + math.cos(ang) * d, p[1] + math.sin(ang) * d), poly):
            return d
        d += step
    return limit


def main() -> None:
    ring = fetch_lake()
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    lat0 = sum(p[1] for p in ring) / len(ring)
    lng0 = sum(p[0] for p in ring) / len(ring)
    kx, kz = 111320 * math.cos(math.radians(lat0)), 110540
    to_xz = lambda lat, lng: ((lng - lng0) * kx, -(lat - lat0) * kz)  # x 동쪽, z 남쪽(m)
    poly = [to_xz(p[1], p[0]) for p in ring]

    spots = []
    for sid, name, desc, lat, lng, willow in SPOTS:
        p0 = p = to_xz(lat, lng)
        moved = 0.0
        # 물가에 붙은 좌대는 단순화된 모양 밖에 찍힌다 → 가장 가까운, 물가에서 15m 이상 들어간 자리로
        if not inside(p, poly) or edge_dist(p, poly) < 15:
            for r in range(3, 400, 3):
                cands = [(p0[0] + math.cos(a * math.pi / 36) * r, p0[1] + math.sin(a * math.pi / 36) * r) for a in range(72)]
                ok = [q for q in cands if inside(q, poly) and edge_dist(q, poly) >= 15]
                if ok:
                    p, moved = ok[0], float(r)
                    break
        # 바라볼 쪽: 물이 가장 멀리 트인 방향(가까운 물가를 등지고 넓은 물을 본다)
        runs = [(free_run(p, a * math.pi / 36, poly), a * math.pi / 36) for a in range(72)]
        smooth = [(sum(runs[(k + j) % 72][0] for j in (-2, -1, 0, 1, 2)) / 5, runs[k][1]) for k in range(72)]
        reach, face = max(smooth)
        spots.append({"id": sid, "name": name, "desc": desc, "lat": lat, "lng": lng, "x": round(p[0], 1), "z": round(p[1], 1),
                      "moved": round(moved), "face": round(face, 3), "reach": round(reach), "willow": willow})
        print(f"{name}: 물 안으로 {moved:.0f}m 옮김, 바라보는 쪽 {math.degrees(face):.0f}°, 앞으로 트인 물 {reach:.0f}m")

    xs, zs = [p[0] for p in poly], [p[1] for p in poly]
    data = {
        "source": "저수지 모양 © OpenStreetMap 기여자(ODbL) · 좌대 자리 브이월드 위성영상(2026-10-21 확인) · 자리 이름은 게임용",
        "lat0": round(lat0, 6), "lng0": round(lng0, 6),
        "size": [round(max(xs) - min(xs)), round(max(zs) - min(zs))],
        "lake": [[round(x, 1), round(z, 1)] for x, z in poly],
        "spots": spots,
    }
    OUT.write_text("window.FISH_LAKE = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"저수지 점 {len(poly)}개, 크기 {data['size'][0]}×{data['size'][1]}m → {OUT.name}")


if __name__ == "__main__":
    main()
