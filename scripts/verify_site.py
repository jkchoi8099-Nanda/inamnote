"""사이트에 나갈 자료(data/·html)를 브라우저 없이 빠르게 검사한다(2026-10-30, 사용자 승인).

왜: 10-13~23에 "확인했다"고 보고했는데 오류가 남은 일이 되풀이됐다 — 누르면 옆집 정보가 뜨는 핀, 동네 둘레에서 잘린 4101번 등
17개 노선, 같은 가게가 두 번 든 장소, 보고서에 빠진 수치. 사람(과 Claude)의 "봤다"를 믿지 않고 커밋할 때마다 기계가 센다.

검사(실패 = 1로 끝나 커밋을 막는다, 경고 = 찍기만):
  [1] 장소 중복 — 같은 id, 또는 같은 이름(build_places.py _norm 기준)이 100m 안에 둘 이상
  [2] 개수·사본 일치 — .js/.json 두 벌이 같은지, intro.js 노선 수 = bus.js 노선 수, 중계 허용 목록(relay/src/allow.js) = bus.js
      (지도 문·첫 화면 숫자는 화면이 places.js 한 배열에서 그때그때 세므로 따로 어긋날 색인이 없다)
  [3] 눌렀을 때 같은 항목 — 지도 핀·목록·메뉴는 장소 id로 찾고(map.html markers), 읽기 창은 원문 주소의 짧은 키(notices.html key)·
      혜택 id(#b=)로 찾는다. 키가 겹치면 다른 항목이 열린다. 좌표가 숫자이고 동네 둘레 안인지, 정류소 id가 정류소 표에 있는지
  [4] 버스 노선 끝점 — 정류소 수가 API 원본(data/raw/bus_cache, 있을 때만)과 같은지, 첫 정류소 = 기점, 회차 정류소 = 종점,
      경로 선이 한 줄이고 양 끝·회차·정류소가 선에서 떨어지지 않았는지(build_bus.py check()와 같은 60m 기준)
  [5] 화면 글에 undefined·NaN·null·None·[object Object] — html 본문 글·alt 등, 자료 파일의 글 값. JSON 숫자 자리 NaN(JSON.parse가 깨진다)

브라우저에서 JS가 그린 글(템플릿에 빈 값이 끼는 것)·핀 벌리기·휴대폰 터치는 여기서 못 본다 — 미리보기·휴대폰으로 본다.
작업 폴더 파일을 읽는다(커밋할 내용과 다르면 작업 폴더 기준).

쓰는 법(site/에서):
  python scripts/verify_site.py        실패가 있으면 1로 끝난다. 커밋 직전 훅(scripts/pre-commit)이 부른다
  python scripts/verify_site.py -v     통과한 항목의 숫자도 찍는다
"""
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DATA = SITE / "data"
RELAY_ALLOW = SITE.parent / "relay" / "src" / "allow.js"  # 바깥 저장소(공개 저장소엔 없다 — 없으면 건너뜀)
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("DATA_GO_KR_KEY", "-")  # build_bus는 불러올 때 키를 읽는다. 여기선 API를 안 부르니 .env 없는 PC에서도 불러오게
import build_bus  # noqa: E402  (as_list·dist_to_line·CACHE를 같이 쓴다)

DUP_NEAR_M = 100  # 같은 이름이 이 안이면 중복으로 본다(build_places.py는 40m·같은 도로명에서 합친다 — 그보다 넓게 잡아 남은 것을 본다)
# 같은 이름·가까운 자리지만 사용자가 실제로 다른 곳이라고 확인한 쌍: {(id, id)} — 날짜·근거를 같이 적는다
DUP_OK = set()
AREA = (37.07, 37.24, 127.09, 127.28)  # 장소 좌표 둘레(home.js AREA와 같다 — 이동·남사보다 조금 넓게)
LINE_M = 60  # 정류소 ↔ 경로 선(build_bus.py check(), bus.html이 버스를 선 위에 놓는 기준)
END_M = 150  # 경로 선의 양 끝 ↔ 첫·마지막 정류소
BAD_WORD = re.compile(r"\b(undefined|NaN|null|None)\b|\[object Object\]")

fails, warns, infos = [], [], []
VERBOSE = "-v" in sys.argv


def fail(sec, msg):
    fails.append(f"[{sec}] {msg}")


def warn(sec, msg):
    warns.append(f"[{sec}] {msg}")


def ok(sec, msg):
    infos.append(f"[{sec}] {msg}")


def _no_nan(c):
    raise ValueError(f"JSON에 {c}")  # 파이썬 json은 NaN·Infinity를 받아 주지만 브라우저 JSON.parse는 깨진다


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=_no_nan)


def load_js(path):
    """window.X = {...}; 꼴 자료 파일의 {...}"""
    s = path.read_text(encoding="utf-8")
    return json.loads(s[s.index("=") + 1:].strip().rstrip(";"), parse_constant=_no_nan)


def meters(a, b):
    return math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 88800)  # build_bus.py와 같은 근사(위도 37°)


def norm(name):
    return re.sub(r"\(주\)|주식회사|\W", "", name or "")  # build_places.py _norm과 같다(그 파일은 pyproj를 불러 느려서 옮겨 씀)


# ── [1] 장소 중복 ──
def check_places(P):
    ids = defaultdict(list)
    for p in P:
        ids[p["id"]].append(p["name"])
    for i, names in ids.items():
        if len(names) > 1:
            fail(1, f"같은 id {i} 가 {len(names)}곳: {', '.join(names)}")
    by = defaultdict(list)
    for p in P:
        n = norm(p["name"])
        if len(n) >= 2 and isinstance(p.get("lat"), (int, float)):
            by[n].append(p)
    pairs = []
    for group in by.values():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                d = meters((a["lat"], a["lng"]), (b["lat"], b["lng"]))
                if d <= DUP_NEAR_M and tuple(sorted((a["id"], b["id"]))) not in DUP_OK:
                    pairs.append((d, a, b))
    for d, a, b in sorted(pairs, key=lambda x: x[0]):
        where = lambda p: f"{p['id']}({p.get('kind', '')}, {p['addr'].replace('경기도 용인시 처인구 ', '')})"
        fail(1, f"같은 이름 {d:.0f}m: {a['name']} — {where(a)} / {where(b)}")
    if not pairs:
        ok(1, f"장소 {len(P)}곳, 중복 없음(같은 id·같은 이름 {DUP_NEAR_M}m 안)")


# ── [2] 개수·사본 일치 ──
def web_notices(d):
    """build_notices.py가 화면용 notices.js에서 빼는 칸(다음 실행용 eminwon_skip·글마다 parts)을 똑같이 뺀다"""
    return {**{k: v for k, v in d.items() if k != "eminwon_skip"}, "items": [{k: v for k, v in x.items() if k != "parts"} for x in d["items"]]}


def check_twins():
    for name, web in (("places", None), ("bus", None), ("notices", web_notices), ("benefits", None)):
        j, s = DATA / f"{name}.json", DATA / f"{name}.js"
        if j.exists() and s.exists():
            if (web or (lambda d: d))(load_json(j)) != load_js(s):
                fail(2, f"data/{name}.json과 {name}.js 내용이 다르다(한쪽만 고쳤거나 만들다 멈춤) — 화면은 .js, 다른 스크립트는 .json을 읽는다")
            else:
                ok(2, f"{name}.json = {name}.js")


def check_counts(bus):
    intro = load_js(DATA / "intro.js")
    if intro.get("routes") != len(bus["routes"]):
        fail(2, f"첫 화면 버스 타일 노선 수 intro.js routes={intro.get('routes')} ≠ bus.js {len(bus['routes'])}개 — python scripts/build_intro.py")
    else:
        ok(2, f"버스 타일 노선 수 {len(bus['routes'])} = bus.js")
    if RELAY_ALLOW.exists():
        s = RELAY_ALLOW.read_text(encoding="utf-8")
        got = {k: set(json.loads(m.group(1))) for k, m in ((k, re.search(rf"{k} = new Set\((\[.*?\])\)", s)) for k in ("ROUTES", "STATIONS")) if m}
        want = {"ROUTES": {str(r["id"]) for r in bus["routes"]}, "STATIONS": set(bus["stations"])}
        for k, w in want.items():
            g = got.get(k, set())
            if g != w:
                fail(2, f"중계 허용 목록 {k}: bus.js에만 {len(w - g)}개 · allow.js에만 {len(g - w)}개 — node relay/build_allow.mjs 후 배포")
            else:
                ok(2, f"중계 허용 목록 {k} {len(w)}개 = bus.js")


def check_extra(P):
    """places_extra.json의 손으로 넣은 칸(메뉴·영업시간·확인일)이 붙을 장소가 없으면 화면에 안 나온다(build_places.py는 다시 받을 때만 알린다)"""
    ids = {p["id"] for p in P}
    extra = load_json(DATA / "places_extra.json")
    orphan = [k for k, v in extra.items() if k not in ids and not v.get("gone")]
    back = [k for k, v in extra.items() if v.get("gone") and k in ids]
    if orphan:
        fail(2, f"places_extra.json 주인 없는 칸 {len(orphan)}개(메뉴·영업시간이 화면에 안 나옴): {', '.join(orphan[:5])}")
    if back:
        fail(2, f"없어졌다고(gone) 적은 곳이 지도에 남아 있다 {len(back)}곳: {', '.join(back[:5])}")
    if not orphan and not back:
        ok(2, f"places_extra.json {len(extra)}칸 모두 제자리")


# ── [3] 눌렀을 때 같은 항목 ──
def check_pins(P):
    bad = [p for p in P if not (isinstance(p.get("lat"), (int, float)) and isinstance(p.get("lng"), (int, float))
                                and AREA[0] <= p["lat"] <= AREA[1] and AREA[2] <= p["lng"] <= AREA[3])]
    for p in bad[:10]:
        fail(3, f"좌표가 숫자가 아니거나 동네 둘레 밖: {p['name']} {p['id']} ({p.get('lat')}, {p.get('lng')})")
    empty = [p["id"] for p in P if not (p.get("name") or "").strip() or not isinstance(p.get("addr"), str)]
    if empty:
        fail(3, f"이름이 비었거나 주소가 글이 아닌 장소 {len(empty)}곳(핀 이름표·안내 창이 빈다): {', '.join(empty[:5])}")
    if not bad and not empty:
        ok(3, f"장소 {len(P)}곳 id 하나씩·좌표 동네 안·이름 있음(핀 = 안내 창 = 목록이 같은 id로 이어진다)")


def note_key(url):
    """notices.html key()와 같은 계산(djb2, 32비트) — 읽기 창 주소 #r=키"""
    h = 5381
    for c in url:  # JS for...of는 글자(코드 포인트)마다, charCodeAt(0)은 그 첫 UTF-16 단위 — BMP 밖 글자는 앞 단위만
        unit = ord(c) if ord(c) < 0x10000 else 0xD800 + ((ord(c) - 0x10000) >> 10)
        h = (h * 33 + unit) & 0xFFFFFFFF
    return h


def check_readers():
    N = load_json(DATA / "notices.json")["items"]
    urls = [x["url"] for x in N]
    keys = defaultdict(set)
    for u in urls:
        keys[note_key(u)].add(u)
    dupu = len(urls) - len(set(urls))
    clash = [v for v in keys.values() if len(v) > 1]
    if dupu:
        fail(3, f"공식 소식 같은 원문 주소 {dupu}건(목록에 두 번)")
    for v in clash:
        fail(3, f"읽기 창 키가 겹친다(다른 글이 열린다): {' / '.join(sorted(v))}")
    bodies = load_json(DATA / "notice_bodies.json")
    # LH 청약플러스는 화면을 스크립트로 그려 본문을 안 받는다(build_notices.py) — 그 밖에 본문이 없는 글은 다음 실행 때 다시 받는다
    nob = [x for x in N if x["url"] not in bodies and x["src"] != "LH 청약·임대"]
    if nob:
        warn(3, f"본문 없는 공식 소식 {len(nob)}건(읽기 창이 '원문에서 보기'만): " + ", ".join(x["title"][:20] for x in nob[:3]))
    if not dupu and not clash:
        ok(3, f"공식 소식 {len(N)}건 읽기 창 키 겹침 없음")

    B = load_json(DATA / "benefits.json")["items"]
    bid = [x["id"] for x in B]
    if len(bid) != len(set(bid)):
        fail(3, f"혜택 id 겹침 {len(bid) - len(set(bid))}건(#b= 읽기 창이 다른 혜택을 연다)")
    bb = load_json(DATA / "benefit_bodies.json")
    if set(bid) - set(bb):
        warn(3, f"전문 없는 혜택 {len(set(bid) - set(bb))}건")
    recent = load_js(DATA / "benefits_recent.js")
    lost = [x["id"] for k in ("items", "always") for x in recent.get(k, []) if x.get("id") and x["id"] not in set(bid)]
    if lost:
        fail(3, f"첫 화면 혜택(benefits_recent.js) {len(lost)}건이 혜택 목록에 없다(누르면 빈 읽기 창): {', '.join(lost[:5])}")
    if len(bid) == len(set(bid)) and not lost:
        ok(3, f"혜택 {len(bid)}건 id 하나씩, 첫 화면 혜택 모두 목록에 있음")


# ── [4] 버스 노선 끝점 ──
def far_stops(stops, pts):
    """선에서 LINE_M 넘게 떨어진 정류소(이름, m). 선 조각을 격자에 넣어 가까운 조각만 잰다(전부 재면 4초 — build_bus.py check())"""
    C = 0.002  # 격자 한 칸(약 200m)
    grid = defaultdict(list)
    pad = (LINE_M + 10) / 88800
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        for gy in range(int((min(a[0], b[0]) - pad) / C), int((max(a[0], b[0]) + pad) / C) + 1):
            for gx in range(int((min(a[1], b[1]) - pad) / C), int((max(a[1], b[1]) + pad) / C) + 1):
                grid[(gy, gx)].append(i)
    out = []
    for st in stops:
        cand = grid.get((int(st[0] / C), int(st[1] / C)), [])
        d = min((build_bus.dist_to_line(st, pts[i], pts[i + 1]) for i in cand), default=1e9)
        if d > LINE_M:
            if not cand:  # 근처 조각이 없으면 전부 재서 실제 거리를 찍는다
                d = min((build_bus.dist_to_line(st, pts[i], pts[i + 1]) for i in range(len(pts) - 1)), default=1e9)
            out.append((st[2], d))
    return out


def raw_count(rid):
    """API 원본(data/raw/bus_cache, git 밖) 노선 정류소 수 — build_bus.py api()의 캐시 이름 규칙"""
    import hashlib
    for q in ({"routeId": rid}, {"routeId": str(rid)}):
        tag = "busrouteservice_v2_getBusRouteStationListv2_" + hashlib.md5(json.dumps(q, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
        f = build_bus.CACHE / f"{tag}.json"
        if f.exists():
            return len(build_bus.as_list(json.loads(f.read_text(encoding="utf-8")).get("busRouteStationList")))
    return None


def check_bus(bus):
    ST = bus["stations"]
    badst = [k for k, v in ST.items() if not (isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) for x in v[:2]) and v[2])]
    if badst:
        fail(3, f"정류소 표에 좌표·이름이 빈 곳 {len(badst)}: {', '.join(badst[:5])}")
    nraw = 0
    for r in bus["routes"]:
        no, s = r["no"], r["stops"]
        missing = [i for i in s if str(i) not in ST]
        if missing:
            fail(3, f"{no}번: 정류소 표에 없는 정류소 {len(missing)}곳(정류소 창이 빈다)")
            continue
        if len(s) < 2:
            fail(4, f"{no}번: 정류소 {len(s)}곳")
            continue
        names = [ST[str(i)][2] for i in s]
        if r.get("stops_total") != len(s):
            fail(4, f"{no}번: 정류소 {len(s)}곳 ≠ stops_total {r.get('stops_total')}(만들 때 잘림)")
        n = raw_count(r["id"])
        if n is not None:
            nraw += 1
            if n != len(s):
                fail(4, f"{no}번: 정류소 {len(s)}곳 ≠ API 원본 {n}곳(잘렸거나 원본이 바뀜 — build_bus.py 다시)")
        if names[0] != r.get("from"):
            fail(4, f"{no}번: 첫 정류소 '{names[0]}' ≠ 기점 '{r.get('from')}'(앞이 잘림)")
        t = r.get("turn") or 0
        if not 1 <= t <= len(s) or names[t - 1] != r.get("to"):
            fail(4, f"{no}번: 회차 정류소({t}번째 '{names[t - 1] if 1 <= t <= len(s) else '없음'}') ≠ 종점 '{r.get('to')}'(뒤가 잘림)")
        if len(r["line"]) != 1:
            fail(4, f"{no}번: 경로 선이 {len(r['line'])}조각")
        pts = [p for seg in r["line"] for p in seg]
        if len(pts) < 2:
            fail(4, f"{no}번: 경로 선 없음")
            continue
        first, last = ST[str(s[0])], ST[str(s[-1])]
        d0, d1 = meters(pts[0], first), meters(pts[-1], last)
        if d0 > END_M or d1 > END_M:
            fail(4, f"{no}번: 경로 선 끝이 첫·마지막 정류소에서 {d0:.0f}m·{d1:.0f}m(선이 잘림)")
        far = far_stops([ST[str(i)] for i in s if "(경유)" not in ST[str(i)][2]], pts)
        if far:
            fail(4, f"{no}번: 선에서 {LINE_M}m 넘게 떨어진 정류소 {len(far)}곳 — " + ", ".join(f"{a} {d:.0f}m" for a, d in far[:4]))
    if not [f for f in fails if f.startswith("[4]")]:
        ok(4, f"노선 {len(bus['routes'])}개 기점·종점·선 끝·정류소 모두 맞음(API 원본 정류소 수 대조 {nraw}개"
              + ("" if nraw else " — data/raw/bus_cache 없음, 대조 못 함") + ")")


# ── [5] 화면 글에 undefined·NaN·null ──
def strings(v, path=""):
    if isinstance(v, str):
        yield path, v
    elif isinstance(v, dict):
        for k, x in v.items():
            yield from strings(x, f"{path}.{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from strings(x, f"{path}[{i}]")


JS_STR = re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`')


def check_words():
    hits = []
    for f in sorted(DATA.glob("*.json")) + sorted(DATA.glob("*.js")):
        try:
            d = load_json(f) if f.suffix == ".json" else load_js(f)
            found = [(p, s) for p, s in strings(d) if BAD_WORD.search(s)]
        except ValueError as e:
            if "JSON에" in str(e):
                fail(5, f"data/{f.name}: {e} — 브라우저 JSON.parse가 깨진다")
                continue
            # 손으로 쓴 JS(tips.js 등): 따옴표 글만 본다(주석 제외)
            src = re.sub(r"/\*.*?\*/|^\s*//.*$", "", f.read_text(encoding="utf-8"), flags=re.S | re.M)
            found = [("", m.group(0)) for m in JS_STR.finditer(src) if BAD_WORD.search(m.group(0))]
        hits += [f"data/{f.name}{p}: {s[:60]!r}" for p, s in found]
    for f in sorted(SITE.glob("*.html")):
        s = f.read_text(encoding="utf-8")
        s = re.sub(r"<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->", "", s, flags=re.S | re.I)
        for m in re.finditer(r'>([^<]+)<|\b(?:alt|title|aria-label|placeholder|content)="([^"]*)"', s):
            t = m.group(1) or m.group(2) or ""
            if BAD_WORD.search(t):
                hits.append(f"{f.name}: {t.strip()[:60]!r}")
    for h in hits:
        fail(5, f"화면에 나갈 글에 빈 값 낱말: {h}")
    if not hits:
        ok(5, "자료 파일 글 값·html 본문에 undefined·NaN·null·None 없음")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    places = load_js(DATA / "places.js")["places"]  # 화면(map.html·첫 화면)이 읽는 쪽
    bus = load_js(DATA / "bus.js")
    for fn, args in ((check_places, (places,)), (check_twins, ()), (check_counts, (bus,)), (check_extra, (places,)),
                     (check_pins, (places,)), (check_readers, ()), (check_bus, (bus,)), (check_words, ())):
        try:
            fn(*args)
        except Exception as e:  # 자료 모양이 바뀌어 검사 자체가 깨지면 그것도 실패로 — 조용히 넘어가지 않는다
            fail("!", f"{fn.__name__} 검사가 멈춤: {e!r}"[:200])
    for line in (infos if VERBOSE else []) + [f"경고 {w}" for w in warns] + [f"실패 {f}" for f in fails]:
        print(line)
    print(f"verify_site: 실패 {len(fails)} · 경고 {len(warns)}" + (" — 커밋을 막는다. 자료를 고치거나, 실제로 다른 곳이면 DUP_OK에 근거와 같이" if fails else " — 통과"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
