"""이동·남사를 지나는 버스 노선(정류소·경로·첫차/막차·배차)을 data/bus.json·bus.js로 만든다(2026-10-14, 사용자 "지도에 버스가 다니는 걸 실시간으로").

    python site/scripts/build_bus.py

경기도_정류소·경기도_노선 API(공공데이터포털, DATA_GO_KR_KEY, 개발 계정 하루 1,000건씩).
실시간 위치는 여기서 받지 않는다 — 지도(bus.html)가 중계(미리보기: scripts/serve_preview.py /api/bus, 공개 뒤: 중계 서버)로 25초마다 묻는다.
찾는 법: 동네 이름으로 정류소를 찾고 → 동네 범위(AREA) 안 정류소마다 지나는 노선 → 그 노선의 동네 안 정류소로 다시(새 노선이 안 나올 때까지).
API 응답은 data/raw/bus_cache/(git 밖)에 저장해 다시 돌릴 때 한도를 쓰지 않는다. 노선이 바뀌면 캐시를 지우고 다시 돌린다(분기 1회 정도).
정류소·경로는 노선 끝(서울·수원·안성 등)까지 전부 남긴다(2026-10-20 사용자 "이동 남사를 넘어가더라도 노선이 전체적으로, 정류소도 — 나중에 버스톡을 접목").
10-20 전에는 동네 둘레 약 3km(VIEW)에서 잘랐다 — 4101번(→숭례문)·24번 등 노선이 중간에 끊겨 보였다. 광역만 풀었더니 4101번이 '동네' 묶음이라 빠졌다.
다 만든 뒤 check()가 노선마다 선이 끊겼는지, 정류소가 선에서 떨어졌는지 센다(문제 있으면 끝에 줄마다 찍는다).
"""
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "bus.json"
CACHE = ROOT / "data" / "raw" / "bus_cache"
KST = timezone(timedelta(hours=9))
API = "https://apis.data.go.kr/6410000/"
# 이동·남사 범위: places.json의 이동읍·남사읍 주소 좌표 최소·최대(2026-10-14)
AREA = (37.086, 37.226, 127.109, 127.258)
SEEDS = ["송전", "이동", "남사", "천리", "덕성", "어비", "묘봉", "서리", "시미", "화산", "묵리",
         "아곡", "봉명", "완장", "진목", "북리", "창리", "방아", "원암", "전궁", "통삼", "한숲"]
calls = {}  # API 종류(정류소/노선)별 실제 호출 수 — 하루 한도가 종류마다 따로다


def key():
    k = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not k:
        for line in (ROOT.parent / ".env").read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("DATA_GO_KR_KEY="):
                k = line.split("=", 1)[1].strip().strip('"')
    return k


KEY = key()


def api(op, **q):
    tag = op.replace("/", "_") + "_" + hashlib.md5(json.dumps(q, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
    f = CACHE / f"{tag}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    svc = op.split("/")[0]
    if calls.get(svc, 0) >= 850:  # 개발 계정 하루 1,000건(API마다) — 넘기 전에 멈춘다. 캐시가 남으니 내일 이어서 돌리면 된다
        raise RuntimeError("API 호출 850건에서 멈춤(하루 한도 보호). 내일 다시 돌리면 캐시에서 이어 간다")
    url = API + op + "?" + urllib.parse.urlencode({"serviceKey": KEY, "format": "json", **q})
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "inamnote-bus"}), timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
            break
        except (TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(2)
    calls[svc] = calls.get(svc, 0) + 1
    body = (d.get("response") or {}).get("msgBody") or {}
    code = ((d.get("response") or {}).get("msgHeader") or {}).get("resultCode")
    if code not in (0, 4):  # 4 = 결과 없음
        raise RuntimeError(f"{op} {q}: resultCode {code} {d}"[:300])
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    time.sleep(0.15)
    return body


def as_list(v):
    return v if isinstance(v, list) else ([v] if v else [])


def inside(lat, lng, box):
    return box[0] <= lat <= box[1] and box[2] <= lng <= box[3]


def simplify(pts, eps=3):
    """선 줄이기(Douglas-Peucker): 원래 선에서 eps m 넘게 벗어나지 않는 점만 남긴다.
    10-15 전에는 '앞 점에서 40m 안이면 버림'이라 굽은 길에서 선이 모서리를 잘라 논밭 위로 지났다."""
    if len(pts) < 3:
        return pts
    xy = [(p[1] * 88800, p[0] * 111000) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        vx, vy = bx - ax, by - ay
        L = vx * vx + vy * vy
        far, k = 0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            t = 0 if L == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / L))
            d = (ax + t * vx - px) ** 2 + (ay + t * vy - py) ** 2
            if d > far:
                far, k = d, i
        if far > eps * eps:
            keep[k] = True
            stack += [(a, k), (k, b)]
    return [p for p, on in zip(pts, keep) if on]


def check(routes, table):
    """노선마다: 선이 한 줄인지, 정류소 id가 다 표에 있는지, 타고 내리는 정류소가 선에서 60m 안인지(bus.html이 버스를 선 위에 놓는 기준과 같다).
    (경유)는 고속도로 나들목 같은 지나가는 점이라 거리를 재지 않는다."""
    bad = []
    for r in routes:
        pts = [p for seg in r["line"] for p in seg]
        if len(r["line"]) != 1:
            bad.append(f"{r['no']}: 선이 {len(r['line'])}조각")
        missing = [sid for sid in r["stops"] if str(sid) not in table]
        if missing:
            bad.append(f"{r['no']}: 표에 없는 정류소 {len(missing)}곳")
        far = []
        for sid in r["stops"]:
            st = table.get(str(sid))
            if not st or "(경유)" in st[2]:
                continue
            d = min(dist_to_line(st, pts[i], pts[i + 1]) for i in range(len(pts) - 1)) if len(pts) > 1 else 1e9
            if d > 60:
                far.append(f"{st[2]} {d:.0f}m")
        if far:
            bad.append(f"{r['no']}: 선에서 60m 넘게 떨어진 정류소 {len(far)}곳 — " + ", ".join(far[:5]))
    return bad


def dist_to_line(s, a, b):
    ax, ay, bx, by, px, py = a[1] * 88800, a[0] * 111000, b[1] * 88800, b[0] * 111000, s[1] * 88800, s[0] * 111000
    vx, vy = bx - ax, by - ay
    l2 = vx * vx + vy * vy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / l2))
    return ((ax + t * vx - px) ** 2 + (ay + t * vy - py) ** 2) ** .5


def local_test():
    """동네 정류소 = 이동읍·남사읍 주소 가게(places.json) 중 가장 가까운 곳이 500m 안. 사각형(AREA)만 쓰면 처인구 시내 노선까지 146개가 잡혔다."""
    pts = [(p["lat"], p["lng"]) for p in json.loads((ROOT / "data" / "places.json").read_text(encoding="utf-8"))["places"]
           if p.get("lat") and ("이동읍" in p["addr"] or "남사읍" in p["addr"])]
    grid = {}
    for la, ln in pts:
        grid.setdefault((int(la / 0.005), int(ln / 0.005)), []).append((la, ln))

    def near(lat, lng, m=500):
        gi, gj = int(lat / 0.005), int(lng / 0.005)
        return any(((la - lat) * 111000) ** 2 + ((ln - lng) * 88800) ** 2 < m * m
                   for a in (-1, 0, 1) for b in (-1, 0, 1) for la, ln in grid.get((gi + a, gj + b), []))
    return near


def main():
    near = local_test()
    if not KEY:
        print("DATA_GO_KR_KEY 없음", file=sys.stderr)
        return 1
    stations = {}  # 동네 안 정류소 id → 이름
    for kw in SEEDS:
        for s in as_list(api("busstationservice/v2/getBusStationListv2", keyword=kw).get("busStationList")):
            if s.get("y") and inside(float(s["y"]), float(s["x"]), AREA):
                stations[s["stationId"]] = s["stationName"]
    routes, asked = {}, set()
    while True:
        todo = [sid for sid in stations if sid not in asked]
        if not todo:
            break
        for sid in todo:
            asked.add(sid)
            for r in as_list(api("busstationservice/v2/getBusStationViaRouteListv2", stationId=sid).get("busRouteList")):
                routes.setdefault(r["routeId"], None)
        for rid in [r for r, v in routes.items() if v is None]:
            sts = as_list(api("busrouteservice/v2/getBusRouteStationListv2", routeId=rid).get("busRouteStationList"))
            routes[rid] = sts
            for s in sts:
                if inside(float(s["y"]), float(s["x"]), AREA):
                    stations.setdefault(s["stationId"], s["stationName"])
    table = {}  # 정류소 id → [위도, 경도, 이름]
    out = []
    for rid, sts in routes.items():
        # '(경유)' 정류소는 타고 내리는 곳이 아니라 지나가는 점이다(남사진위TG(경유) 등) — 세지 않는다
        local = sum(1 for s in sts if "(경유)" not in s["stationName"] and near(float(s["y"]), float(s["x"])))
        if local < 2:  # 동네 정류소를 두 곳 이상 지나는 노선만(가장자리를 스치는 노선 제외)
            continue
        info = api("busrouteservice/v2/getBusRouteInfoItemv2", routeId=rid).get("busRouteInfoItem") or {}
        for st in sts:
            table[st["stationId"]] = [round(float(st["y"]), 5), round(float(st["x"]), 5), st["stationName"]]
        line = as_list(api("busrouteservice/v2/getBusRouteLineListv2", routeId=rid).get("busRouteLineList"))
        # 경로: 노선 전체 한 줄(bus.html은 조각 목록으로 받는다 — 조각 하나).
        # 점은 simplify()로 줄인다(원래 선에서 3m 안). 버스 아이콘이 이 선을 따라 움직이므로 길에서 벗어나면 안 된다
        cur = []
        for p in sorted(line, key=lambda p: p["lineSeq"]):
            y, x = round(float(p["y"]), 5), round(float(p["x"]), 5)
            if not cur or [y, x] != cur[-1]:
                cur.append([y, x])
        segs = [simplify(cur)] if cur else []
        out.append({
            "id": rid, "no": str(info.get("routeName", "")), "type": info.get("routeTypeName", ""), "type_cd": info.get("routeTypeCd"),
            "from": info.get("startStationName", ""), "to": info.get("endStationName", ""),
            "first": info.get("upFirstTime", ""), "last": info.get("upLastTime", ""),
            "first_back": info.get("downFirstTime", ""), "last_back": info.get("downLastTime", ""),
            "gap": info.get("peekAlloc"), "gap_off": info.get("nPeekAlloc"), "company": info.get("companyName", ""),
            "company_tel": info.get("companyTel", ""), "stops_total": len(sts), "stops_local": local,
            # 회차 정류소 순번·이름(10-15): 순번이 이보다 작으면 가는 쪽(turn_name 방면), 크면 오는 쪽(from 방면). 정류소·버스 방향 표시에 쓴다
            "turn": int(sts[0].get("turnSeq") or 0) if sts else 0,
            "turn_name": next((s["stationName"] for s in sts if str(s.get("turnYn")) == "Y"), ""),
            # 정류소: 순번(1부터) 순서대로 정류소 id — 좌표·이름은 맨 위 stations 표 하나에(노선마다 반복하면 파일이 커진다)
            "stops": [s["stationId"] for s in sorted(sts, key=lambda s: s["stationSeq"])],
            "line": segs,
        })
    # 번호 순(숫자 앞부분 기준), 같은 번호면 이름 순
    def order(r):
        n = "".join(ch for ch in r["no"] if ch.isdigit())
        return (int(n) if n else 99999, r["no"])
    out.sort(key=order)
    payload = {"updated_at": datetime.now(KST).isoformat(timespec="minutes"),
               "source": "경기도 버스정보(공공데이터포털 경기도_정류소·노선)", "area": AREA, "stations": table, "routes": out}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT.with_suffix(".js").write_text("window.BUS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"노선 {len(out)}개 · 동네 정류소 {len(stations)}곳 · 정류소 표 {len(table)}곳 · API 호출 {calls or 0}건(나머지는 캐시) → {OUT} {OUT.stat().st_size // 1024}KB")
    bad = check(out, {str(k): v for k, v in table.items()})
    for line in bad:
        print("  확인 필요:", line)
    print("검사: 선 끊김·정류소 누락·선에서 떨어진 정류소 " + (f"{len(bad)}건" if bad else "없음"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
