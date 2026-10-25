"""이동읍·남사읍 장소 목록(data/places.json)을 만든다.

행정안전부 인허가 데이터(공공데이터포털, apis.data.go.kr/1741000/<업종>/info)에서
영업 중인 사업장만 받아 좌표를 WGS84로 바꾼다. 업종마다 공공데이터포털 활용신청이 따로 필요하다.
환경변수 DATA_GO_KR_KEY 에 '일반 인증키(Decoding)'를 넣는다(.env, 저장소에 올리지 않는다).

인허가 데이터에 없는 업종(셀프 빨래방 등)은 소상공인시장진흥공단 상가(상권)정보(분기 갱신, 위경도 포함)에서 받는다.

운영자가 손으로 덧붙이는 칸(새벽 영업, 확인일, 없어진 곳 gone 등)은 data/places_extra.json({id: {칸: 값}})에,
공공데이터에 아예 없는 곳은 data/places_manual.json([{name, cat, kind, addr, lat, lng, checked}])에 둔다.
이 스크립트는 두 파일을 읽어 합치기만 하고 고치지 않는다.

다시 받을 때(2026-10-13 추가):
- 이전 places.json과 견줘 사라진 곳·새로 생긴 곳·주인 잃은 places_extra 칸을 보여 주고 logs/places_changes.log에 남긴다.
- 어느 출처가 이전보다 20% 넘게 줄거나 못 받으면(API 일시 장애·키 만료) 쓰지 않고 멈춘다. 그대로 쓰면 그 업종이
  지도에서 통째로 사라진다. 정말 줄었으면 `--force`로 쓴다.
- 홈 점검(tools/health_check.py)이 updated_at이 90일 넘으면 다시 받으라고 알린다(상가정보는 분기 갱신).
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "places.json"
EXTRA = ROOT / "data" / "places_extra.json"
MANUAL = ROOT / "data" / "places_manual.json"
# 학교: 공공데이터포털 '전국초중등학교위치표준데이터'는 API가 없고 파일만 있다(2026-10-11 확인).
# 사람이 내려받은 CSV를 RAW_SCHOOLS에 두면 이동·남사만 골라 SCHOOLS(저장소에 올리는 작은 파일)로 만든다.
RAW_SCHOOLS = ROOT / "data" / "raw" / "schools.csv"
SCHOOLS = ROOT / "data" / "schools.json"
KST = timezone(timedelta(hours=9))
CHANGES_LOG = ROOT.parent / "logs" / "places_changes.log"  # git 밖
DROP_LIMIT = 0.8  # 출처별 개수가 이전의 80% 아래면 받기 실패로 본다

AREAS = ["용인시 처인구 이동읍", "용인시 처인구 남사읍"]

# 업종: (API 경로, 지도 카테고리, 표시 이름)
SERVICES = [
    ("general_restaurants", "food", "일반음식점"),
    ("rest_cafes", "cafe", "휴게음식점"),
    ("lodgings", "stay", "숙박업"),
    ("laundries", "laundry", "세탁업"),  # 세탁소만 있다. 셀프 빨래방은 이 데이터에 없다(2026-10-11 확인)
    ("golf_courses", "golf", "골프장"),
    # 10-15: 상가정보(조사 자료)에서 받던 업종을 인허가(법정 등록)로 옮김 — 상가정보는 문 닫은 곳이 남고 새로 연 곳이 늦다
    # (사용자 "현실에 최대한 근접하게 만든 다음 배포"). 문 없이 검색으로만 찾는다(etc). 겹치는 상가정보 줄은 LICENSED_SCLS로 뺀다
    ("pharmacies", "etc", "약국"),
    ("hospitals", "etc", "병원"),
    ("clinics", "etc", "의원"),  # 치과의원·한의원·보건진료소·보건지소 포함, 진료과목(subj)으로도 찾는다
    ("beauty_salons", "etc", "미용실"),  # 일반미용·네일·피부·메이크업
    ("barber_shops", "etc", "이발소"),
    ("optical_shops", "etc", "안경점"),
    ("animal_hospitals", "etc", "동물병원"),
    ("pet_grooming", "etc", "동물미용"),  # 주소 번지가 '**'로 가려져 온다(좌표는 있음)
    # 10-16: 2차로 옮김(사용자가 활용신청). 상가정보 노래방 15곳은 모두 인허가에 있었고, 당구장 노루실은 인허가에 9-30 폐업으로 찍혔는데
    # 상가정보엔 남아 있었다. 건강기능식품(97곳 대부분 편의점·다이소·온라인)·골프연습장(스크린골프가 없어 1곳)은 신청만 하고 안 쓴다
    ("karaoke_rooms", "etc", "노래방"),
    ("fitness_centers", "etc", "헬스장"),
    ("billiard_halls", "etc", "당구장"),
    ("animal_sales", "etc", "동물판매"),  # 분양·위탁. 주소 번지가 가려져 온다. 상가정보 애완용품점과는 다른 가게라 상가정보 쪽은 그대로 둔다
    ("livestock_retail", "etc", "정육점"),  # MEAT_SHOPS만 받는다(아래)
]
# 정육점(축산판매업)은 '영업 중' 116곳 중 식육판매업 70곳, 그중 동네 사람이 사러 가는 가게는 18곳뿐이었다 — 나머지는 도매·가공 공장·물류센터
# (28), 그 주소에 다른 가게가 들어선 곳(8: 구남매정육점·청화대 등), 카카오맵에 없는 곳(14). 10-16 카카오맵으로 하나씩 확인한 18곳만 받는다.
# 새로 연 정육점은 저절로 들어오지 않는다 — 확인하고 관리번호를 여기 더한다. 상가정보 정육점은 그대로 둔다(인허가에 없는 마트 안 정육코너
# 케이축산·하모니정육코너와 한숲축산·윤가우돈 같은 실제 가게가 있다). 같은 가게인 상가정보 줄은 drop_store_dups가 합친다
MEAT_SHOPS = {
    "562000000920240002",  # 캠프쿡(캠핑용 고기)
    "562000000920080017", "405000000919890003", "562000000920220049", "405000000919980029",  # 예찬축산·진목정육점·남곡정육점·남사농협 하나로마트
    "562000000920100042", "562000000920220014", "562000000920180049", "562000000920240001",  # 다모아정육점·가락 횡성 정육·더 조은 축산·대농정육점
    "562000000920250016", "562000000920210013", "562000000920050005", "562000000920120019",  # 순우리·선수축산물할인센터·이동농협하나로마트·우리한우직판장
    "562000000920080005", "562000000920110023", "562000000920180004", "562000000920200036",  # 학성정육점·일등할인마트·참고깃간·이동축산물백화점
    "405000000919910002",  # 적동정육점
    "562000000920150007",  # 동네방네 소문난 고기백화점 — 카카오맵엔 없지만 사용자 확인(스텔라 미용실과 한 건물을 나눠 씀, 10-16)
}
ROW_KEEP = {"livestock_retail": MEAT_SHOPS}
# 위 인허가 업종과 같은 상가정보 소분류 → 그 업종. 상가정보 쪽은 버린다(같은 가게가 두 번, 그중 하나는 낡은 정보).
# 단 그 인허가 업종을 이번에 못 받았으면(FAILED) 상가정보 쪽을 남긴다 — 10-15 미용업이 한 번 실패해 미용실이 통째로 사라졌다
LICENSED_SCLS = {**dict.fromkeys(["약국"], "약국"), **dict.fromkeys(["일반 병원", "종합병원", "치과병원", "한방병원", "요양병원"], "병원"),
                 **dict.fromkeys(["기타 의원", "내과/소아과 의원", "외과 의원", "치과의원", "한의원"], "의원"),
                 **dict.fromkeys(["미용실", "네일숍", "피부 관리실"], "미용실"), "이용원": "이발소", "동물병원": "동물병원",
                 "안경렌즈 소매업": "안경점", "반려동물 미용": "동물미용",
                 # 10-16: 편의점은 휴게음식점 인허가에 있다(51곳). 상가정보 편의점 71곳 중 40곳이 같은 가게였고, 나머지도 남사IC휴게소 한 자리에
                 # 4개·GS25 3m 옆 세븐일레븐처럼 바뀌기 전 이름이 많았다(사용자 "편의점 문은 51개인데 검색하면 122곳")
                 "편의점": "휴게음식점", "노래방": "노래방", "헬스장": "헬스장", "당구장": "당구장"}
FAILED = set()  # 이번에 못 받은 인허가 업종(표시 이름)
# 인허가 업태 이름 → 사람이 찾는 말(목록에 보이는 이름)
TYPE_NAMES = {"일반미용업": "미용실", "네일아트업": "네일숍", "피부미용업": "피부관리", "메이크업업": "메이크업", "일반이용업": "이발소",
              "노래연습장업": "노래방", "체력단련장업": "헬스장", "당구장업": "당구장", "식육판매업": "정육점"}
# 주소가 이동·남사 밖이어도 동네 범위(NEAR_BOX, build_bus.py의 AREA와 같은 이동·남사 주소 좌표 최소·최대) 안에 있으면 넣는 업종.
# 골프장은 넓어서 주소 동네와 코스가 걸친 동네가 다르다(은화삼CC: 주소 호동, 그늘집은 이동읍 천리). 10-15
NEAR = {"golf_courses": "용인시 처인구"}
NEAR_BOX = (37.086, 37.226, 127.109, 127.258)

# 상가(상권)정보: 행정동 코드와 업종 소분류 코드 → (지도 카테고리, 표시 이름)
STORE_TOWNS = {"41461256": "이동읍", "41461259": "남사읍"}
STORE_CODES = {"S20902": ("coin", "셀프 빨래방")}
# 나머지 업종은 문 없이 검색으로만 찾게 넣는다(사용자 10-12 "부동산을 검색하면 전부 뜨게"). 단 인허가 데이터와 겹치는
# 음식(I2)·숙박(I1)·세탁소(S20901)는 뺀다(같은 가게가 두 번 나온다).
SEARCH_SKIP_LCLS = {"I1", "I2"}
SEARCH_SKIP_SCLS = {"S20901"}

# 인허가 데이터 좌표는 중부원점 TM(Bessel, EPSG:5174)이다.
TO_WGS84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)


def load_env():
    env = ROOT.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def area_conds(area):
    """한 읍을 고르는 주소 조건 네 가지(도로명·지번 × 지금 이름 '읍'·옛 이름 '면').
    10-15 전에는 도로명 '이동읍'만 봐서 도로명이 비었거나(지번만 있는 곳) 옛 이름 '남사면'으로 남은 곳을 놓쳤다 —
    음식점 25·카페 6·골프장 1곳(한림용인CC, 도로명이 '남사면 경기동로'). 사용자 "골프장이 6개인데 실제는 훨씬 많아"로 찾음."""
    old = area.replace("읍", "면")
    return [{"cond[ROAD_NM_ADDR::LIKE]": area}, {"cond[ROAD_NM_ADDR::LIKE]": old},
            {"cond[LOTNO_ADDR::LIKE]": area}, {"cond[LOTNO_ADDR::LIKE]": old}]


def fetch(service, key, cond):
    """한 업종에서 주소 조건(cond)에 맞는 영업 중 사업장을 전부 받는다. 활용신청이 안 된 업종은 None."""
    items, page = [], 1
    while True:
        params = {
            "serviceKey": key, "pageNo": page, "numOfRows": 100, "returnType": "json",
            **cond, "cond[SALS_STTS_CD::EQ]": "01",
        }
        url = f"https://apis.data.go.kr/1741000/{service}/info?" + urllib.parse.urlencode(params)
        # 업종에 따라 응답이 30초를 넘기거나 한 번씩 오류 응답이 온다(10-15 의원·미용업) — 세 번까지.
        # 활용신청이 안 된 키(SERVICE_KEY_IS_NOT_REGISTERED)만 바로 포기한다
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    text = r.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                text = e.read().decode("utf-8", "replace")
            except (TimeoutError, OSError) as e:
                text = repr(e)
            try:
                data = json.loads(text)
            except ValueError:
                data = {}
            if "response" in data:
                break
            reason = data.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader", {}).get("errMsg") or text[:200]
            print(f"  {service}: 받지 못함 ({reason}){'' if attempt == 2 else ' — 다시'}", file=sys.stderr)
            if "NOT_REGISTERED" in reason or attempt == 2:
                return None
            time.sleep(5)
        body = data["response"]["body"]
        got = (body.get("items") or {}).get("item") or []
        items += got
        if page * 100 >= int(body.get("totalCount") or 0) or not got:
            return items
        page += 1
        time.sleep(0.2)


def fetch_stores(key, food=None):
    """상가(상권)정보에서 STORE_CODES 업종만 골라 장소로 바꾼다. 활용신청이 안 됐으면 None.
    food(list)를 주면 음식점(I2) 줄을 거기에 모은다 — 인허가 식당에 세부 업종을 붙이는 데 쓴다(add_menu_kind)."""
    out = []
    for adong in STORE_TOWNS:
        page = 1
        while True:
            params = {"serviceKey": key, "divId": "adongCd", "key": adong,
                      "numOfRows": 1000, "pageNo": page, "type": "json"}
            url = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong?" + urllib.parse.urlencode(params)
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    data = json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                print(f"  상가정보: 받지 못함 ({e.code})", file=sys.stderr)
                return None
            body = data.get("body") or {}
            items = body.get("items") or []
            for row in items:
                code = row.get("indsSclsCd")
                if food is not None and row.get("indsLclsCd") == "I2":
                    food.append(row)
                if code in STORE_CODES:
                    cat, kind = STORE_CODES[code]
                elif row.get("indsSclsNm") in LICENSED_SCLS and LICENSED_SCLS[row["indsSclsNm"]] not in FAILED:
                    continue
                elif row.get("indsLclsNm") == "부동산" and "부동산" not in FAILED:  # 국토부 중개사무소 등록(fetch_brokers)으로 대신
                    continue
                elif row.get("indsLclsCd") not in SEARCH_SKIP_LCLS and code not in SEARCH_SKIP_SCLS:
                    cat, kind = "etc", row.get("indsLclsNm", "")  # 문은 없고 검색으로만 찾는 곳(부동산·병원·미용실 등)
                else:
                    continue
                out.append({
                    "id": row["bizesId"], "name": row["bizesNm"].strip(), "cat": cat, "kind": kind,
                    "type": row.get("indsSclsNm", ""), "addr": (row.get("rdnmAdr") or row.get("lnoAdr") or "").strip(),
                    "tel": "", "since": "", "lat": round(float(row["lat"]), 6), "lng": round(float(row["lon"]), 6),
                })
            if page * 1000 >= int(body.get("totalCount") or 0) or not items:
                break
            page += 1
    return out


ROAD_RE = re.compile(r"(\S+(?:로|길)\d*(?:번길)?) (\d+(?:-\d+)?)")


def _norm(name):
    return re.sub(r"\(주\)|주식회사|\W", "", name or "")


def add_menu_kind(places, food):
    """인허가 식당·카페에 상가정보의 세부 업종(국/탕/찌개류, 중국집, 국수/칼국수…)을 menu_kind로 붙인다(2026-10-13).
    인허가 업태는 '한식'·'기타'뿐인 곳이 많아 목록만 봐서는 무엇을 파는지 모른다(사용자: 업종별 분류 말고 빠른 판단).
    같은 도로명 주소 + 이름 앞 두 글자가 겹치는 상가정보 음식점과 짝짓는다. 못 짝지으면 붙이지 않는다."""
    by_road = {}
    for r in food:
        m = ROAD_RE.search(r.get("rdnmAdr") or "")
        if m:
            by_road.setdefault(m.group(0), []).append(r)
    n = 0
    for p in places:
        if p["cat"] not in ("food", "cafe"):
            continue
        m = ROAD_RE.search(p.get("addr") or "")
        key = _norm(p["name"])[:2]
        if not m or not key:
            continue
        hit = [r for r in by_road.get(m.group(0), []) if key in _norm(r["bizesNm"])]
        if hit:
            hit.sort(key=lambda r: -len(os.path.commonprefix([_norm(r["bizesNm"]), _norm(p["name"])])))
            p["menu_kind"] = hit[0].get("indsSclsNm", "")
            n += 1
    return n


DUP_M = 40  # 이 안(또는 같은 도로명 주소)에 같은 이름이면 같은 가게


def _dist(a, b):
    dy = (a["lat"] - b["lat"]) * 111320
    return (dy ** 2 + ((a["lng"] - b["lng"]) * 111320 * 0.7969) ** 2) ** 0.5  # cos(37.15°)


def drop_store_dups(places):
    """상가정보(id MA…) 줄 중 다른 출처(인허가·중개사무소·직접 확인)나 앞선 상가정보 줄과 같은 가게인 것을 뺀다(2026-10-16).
    같은 가게 = DUP_M 안이나 같은 도로명 주소 + 이름이 같거나 세 글자 이상인 이름이 다른 쪽 이름 안에 통째로 든다
    ('효쉼'=='효쉼', '동네방네소문난고기' ⊂ '동네방네 소문난 고기백화점'). 앞 몇 글자만 같은 것은 다른 가게였다
    (고소작업대바로리프트렌탈·고소작업대국세리프트렌탈). 두 글자 이름이 품이는 것도 틀렸다('송전' ⊂ '피자스쿨(용인송전점)').
    뺀 줄의 업종은 남는 줄의 also에 붙여 그 업종으로도 찾게 한다(정육점으로 찾으면 고기백화점). 뺀 줄 목록을 돌려준다."""
    keep, store, dropped = [], [], []
    others = [p for p in places if not p["id"].startswith("MA")]
    for p in places:
        if not p["id"].startswith("MA"):
            keep.append(p)
            continue
        a, ra = _norm(p["name"]), (m.group(0) if (m := ROAD_RE.search(p.get("addr") or "")) else None)
        hit = None
        for o in others + store:
            if abs(o["lat"] - p["lat"]) > 0.001:
                continue
            b = _norm(o["name"])
            short = min((a, b), key=len)
            if not (a == b and len(a) >= 2 or len(short) >= 3 and (a in b or b in a)):
                continue
            rb = m.group(0) if (m := ROAD_RE.search(o.get("addr") or "")) else None
            if _dist(p, o) <= DUP_M or ra and ra == rb:
                hit = o
                break
        if hit:
            t = p.get("type") or p.get("kind") or ""
            if t and t not in (hit.get("type"), hit.get("kind"), hit.get("menu_kind")) and t not in hit.get("also", []):
                hit.setdefault("also", []).append(t)
            dropped.append((p, hit))
        else:
            store.append(p)
            keep.append(p)
    return keep, dropped


GEO_CACHE = ROOT / "data" / "raw" / "geocode_cache.json"  # 주소 → 좌표(git 밖). 다시 돌릴 때 Geocoding을 또 부르지 않는다


def fetch_brokers():
    """부동산 중개사무소: 국토교통부 부동산중개업 등록 정보(브이월드 getEBOfficeInfo, VWORLD_KEY). 영업중만.
    10-15 전에는 상가정보에서 받았는데 문 닫은 곳(행운공인중개사사무소)이 남고 새로 연 곳(한솔·두꺼비)이 빠졌다(사용자 현장 확인).
    등록부라 시청에 낸 그대로다(10-15 받은 자료의 갱신일 2026-10-13). 좌표가 없어 주소로 Geocoding한다. 못 받으면 None."""
    key = os.environ.get("VWORLD_KEY", "").strip()
    if not key:
        return None
    rows, page = [], 1
    while True:
        q = {"key": key, "ldCode": "41461", "format": "json", "numOfRows": 1000, "pageNo": page, "domain": "http://127.0.0.1:8091"}
        try:
            with urllib.request.urlopen("https://api.vworld.kr/ned/data/getEBOfficeInfo?" + urllib.parse.urlencode(q), timeout=120) as r:
                body = json.loads(r.read().decode("utf-8")).get("EDOffices") or {}
        except (OSError, ValueError) as e:
            print(f"  중개사무소: 받지 못함 ({e})", file=sys.stderr)
            return None
        got = body.get("field") or []
        if not got and not rows:
            print(f"  중개사무소: 받지 못함 ({body.get('resultCode')} {body.get('resultMsg')})", file=sys.stderr)
            return None
        rows += got
        if len(rows) >= int(body.get("totalCount") or 0) or not got:
            break
        page += 1
    cache = json.loads(GEO_CACHE.read_text(encoding="utf-8")) if GEO_CACHE.exists() else {}
    out = []
    for r in rows:
        road, lot = (r.get("rdnmadr") or "").strip(), (r.get("mnnmadr") or "").strip()
        if r.get("sttusSeCode") != "1" or not any(a.replace(" ", "") in (road + lot).replace(" ", "") for a in AREAS):
            continue  # 영업중이 아니거나(휴업·업무정지) 이동·남사 밖
        ll = None
        for a in (road, lot):
            a = re.sub(r"\s*[,(].*$", "", a)
            if a and not (ll := cache.get(a)):
                ll = cache[a] = geocode(a, strict=False)
            if ll:
                break
        if not ll:
            print(f"  중개사무소 좌표 못 찾음: {r.get('bsnmCmpnm')} | {road or lot}", file=sys.stderr)
            continue
        out.append({"id": "EB-" + r["jurirno"], "name": r["bsnmCmpnm"].strip(), "cat": "etc", "kind": "부동산",
                    "type": "공인중개사사무소", "addr": road or lot, "tel": "", "since": r.get("registDe") or "",
                    "lat": ll["lat"], "lng": ll["lng"]})
    GEO_CACHE.parent.mkdir(parents=True, exist_ok=True)
    GEO_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return out


def geocode(addr, strict=True):
    """네이버 클라우드 Geocoding(NCP_MAPS_ID/SECRET, 무료 이용량 안에서 쓴다)으로 주소를 좌표로 바꾼다.
    strict=False면 못 찾을 때 멈추지 않고 None(공공데이터 줄 — 그 한 곳만 빠진다)."""
    req = urllib.request.Request(
        "https://maps.apigw.ntruss.com/map-geocode/v2/geocode?" + urllib.parse.urlencode({"query": addr}),
        headers={"x-ncp-apigw-api-key-id": os.environ["NCP_MAPS_ID"], "x-ncp-apigw-api-key": os.environ["NCP_MAPS_SECRET"]})
    with urllib.request.urlopen(req, timeout=15) as r:
        found = json.loads(r.read().decode("utf-8")).get("addresses") or []
    if not found:
        if not strict:
            return None
        sys.exit(f"주소를 찾지 못함: {addr} (places_manual.json을 고친다)")
    return {"lat": round(float(found[0]["y"]), 6), "lng": round(float(found[0]["x"]), 6)}


def addr_of(row):
    """보여 줄 주소: 도로명, 없으면 지번. 옛 이름 '이동면·남사면'은 '읍'으로(지도·버스의 동네 판정이 '이동읍'·'남사읍' 글자로 한다)."""
    a = (row.get("ROAD_NM_ADDR") or row.get("LOTNO_ADDR") or "").strip()
    if "*" in a:  # 개인 사업장은 번지가 가려져 온다(동물미용업) — 가려진 앞까지만
        a = re.sub(r"\s*\S*\*.*$", "", a)
    return a.replace("처인구 이동면", "처인구 이동읍").replace("처인구 남사면", "처인구 남사읍")


def load_schools():
    """CSV가 있으면 이동·남사 운영 중 학교를 골라 schools.json으로 저장하고, 없으면 저장된 것을 쓴다."""
    if RAW_SCHOOLS.exists():
        import csv
        raw = RAW_SCHOOLS.read_bytes()
        for enc in ("utf-8-sig", "cp949"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        out = []
        for row in csv.DictReader(text.splitlines()):
            addr = (row.get("소재지도로명주소") or row.get("소재지지번주소") or "").strip()
            if not any(a in addr for a in AREAS) or (row.get("운영상태") or "운영") != "운영":
                continue
            try:
                lat, lng = float(row["위도"]), float(row["경도"])
            except (KeyError, ValueError):
                continue
            out.append({"id": row.get("학교ID") or row["학교명"], "name": row["학교명"].strip(), "cat": "school",
                        "kind": "학교", "type": (row.get("학교급구분") or "").strip(), "addr": addr, "tel": "",
                        "since": (row.get("설립일자") or "")[:10], "lat": round(lat, 6), "lng": round(lng, 6)})
        SCHOOLS.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        return out
    return json.loads(SCHOOLS.read_text(encoding="utf-8")) if SCHOOLS.exists() else None


def to_place(row, cat, kind):
    try:
        lng, lat = TO_WGS84.transform(float(row["CRD_INFO_X"]), float(row["CRD_INFO_Y"]))
    except (TypeError, ValueError, KeyError):
        # 좌표 칸이 빈 곳(10-15: 음식점 13·카페 5·세현CC)은 주소로 좌표를 찾는다. 전에는 말없이 버렸다
        ll = None
        for a in (row.get("ROAD_NM_ADDR"), row.get("LOTNO_ADDR")):
            a = re.sub(r"\s*[,(].*$", "", (a or "").strip())  # '백자로 371-2, A동 1층' → '백자로 371-2'
            a = re.sub(r"\s+\d+층.*$", "", a)
            if a and (ll := geocode(a, strict=False)):
                break
        if not ll:
            print(f"  좌표 없음·주소로도 못 찾음: {row['BPLC_NM']} | {addr_of(row)}", file=sys.stderr)
            return None
        lat, lng = ll["lat"], ll["lng"]
    return {
        "id": row["MNG_NO"],
        "name": row["BPLC_NM"].strip(),
        "cat": cat,
        "kind": kind,
        "type": TYPE_NAMES.get(t := (row.get("BZSTAT_SE_NM") or row.get("CULTR_SPTS_TPBIZ_NM") or "").strip(), t),
        **({"subj": row["MDEXM_SBJCT_CN_NM"]} if row.get("MDEXM_SBJCT_CN_NM") else {}),  # 의원 진료과목(검색용)
        "addr": addr_of(row),
        "tel": (row.get("TELNO") or "").strip(),
        "since": row.get("LCPMT_YMD") or "",
        "lat": round(lat, 6),
        "lng": round(lng, 6),
    }


def compare(old, new, extra):
    """이전·새 payload를 견준다 → (막을 이유 목록, 보고 줄 목록). 막을 이유가 있으면 쓰지 않는다."""
    block = []
    for kind, n in (old.get("counts") or {}).items():
        m = new["counts"].get(kind)
        if isinstance(n, int) and n >= 5 and not (isinstance(m, int) and m >= n * DROP_LIMIT):
            block.append(f"{kind}: {n} → {m}")
    before = {p["id"]: p for p in old.get("places") or []}
    after = {p["id"]: p for p in new["places"]}
    gone = [before[i] for i in before if i not in after]
    born = [after[i] for i in after if i not in before]
    orphan = [i for i in extra if i not in after and not extra[i].get("gone")]
    lines = [f"이전 {old.get('updated_at', '없음')} {len(before)}곳 → 지금 {len(after)}곳 · 사라진 곳 {len(gone)} · 새로 생긴 곳 {len(born)}"]
    for title, rows in (("사라진 곳", gone), ("새로 생긴 곳", born)):
        for p in rows[:15]:
            lines.append(f"  {title}: {p['name']} ({p.get('kind', '')}) {p.get('addr', '')}")
        if len(rows) > 15:
            lines.append(f"  {title}: …외 {len(rows) - 15}곳")
    if orphan:  # 현장 확인 칸을 단 가게가 목록에서 빠졌다 — 폐업인지 id가 바뀐 것인지 사람이 본다
        lines.append(f"  ⚠ places_extra.json에서 주인 잃은 칸 {len(orphan)}개: {', '.join(orphan[:5])}")
    return block, lines


def main():
    force = "--force" in sys.argv
    load_env()
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        sys.exit("DATA_GO_KR_KEY 없음")
    places, sources = [], {}
    for service, cat, kind in SERVICES:
        found, ok = {}, True  # 관리번호 → 줄(네 조건이 같은 곳을 여러 번 준다)
        conds = [c for area in AREAS for c in area_conds(area)]
        if service in NEAR:  # 경계 너머라도 동네 범위 안에 있으면(은화삼CC — 주소는 호동, 코스는 이동읍 천리에 걸침)
            conds.append({"cond[ROAD_NM_ADDR::LIKE]": NEAR[service]})
        for cond in conds:
            got = fetch(service, key, cond)
            if got is None:
                ok = False
                break
            for row in got:
                found[row["MNG_NO"]] = row
        rows = []
        for row in found.values():
            a = addr_of(row)
            if re.search(r"문화제|축제", a):  # 축제 날 하루 서는 임시 가게(처인성문화제 등)는 영업 중으로 남아 있어도 뺀다
                continue
            if service in ROW_KEEP and row["MNG_NO"] not in ROW_KEEP[service]:
                continue
            if not any(t in a for t in AREAS):
                try:
                    lng, lat = TO_WGS84.transform(float(row["CRD_INFO_X"]), float(row["CRD_INFO_Y"]))
                except (TypeError, ValueError, KeyError):
                    continue
                if not (NEAR_BOX[0] <= lat <= NEAR_BOX[1] and NEAR_BOX[2] <= lng <= NEAR_BOX[3]):
                    continue
            rows.append(row)
        sources[kind] = len(rows) if ok else "받지 못함"
        if not ok:
            FAILED.add(kind)
        for row in rows if ok else []:
            p = to_place(row, cat, kind)
            if not p:
                continue
            if service == "livestock_retail":
                # 마트 안 정육코너(하나로마트·일등할인마트)는 마트로 보이게 하고 정육점으로도 찾게 한다. 이미 다른 인허가로 들어온
                # 같은 가게(일등할인마트 = 휴게음식점)가 있으면 따로 핀을 꽂지 않고 그 줄에 붙인다
                if "마트" in p["name"]:
                    p["type"], p["also"] = "슈퍼마켓", ["정육점"]
                same = next((o for o in places if _norm(o["name"]) == _norm(p["name"]) and _dist(o, p) <= DUP_M), None)
                if same:
                    for w in ["정육점", *p.get("also", [])]:
                        if w not in same.setdefault("also", []) and w != same.get("type"):
                            same["also"].append(w)
                    continue
            places.append(p)
        print(f"{kind}: {sources[kind]}")

    brokers = fetch_brokers()
    sources["부동산"] = len(brokers) if brokers is not None else "받지 못함"
    if brokers is None:
        FAILED.add("부동산")
    places += brokers or []
    print(f"부동산(국토부 중개사무소 등록): {sources['부동산']}")

    food = []
    stores = fetch_stores(key, food)
    sources["상가정보"] = len(stores) if stores is not None else "활용신청 필요"
    print(f"상가정보(셀프 빨래방 + 검색 전용): {sources['상가정보']}")
    print(f"식당 세부 업종(상가정보와 짝지음): {add_menu_kind(places, food)}곳")
    places += stores or []

    schools = load_schools()
    sources["학교"] = len(schools) if schools is not None else "파일 필요"
    places += schools or []
    print(f"학교: {sources['학교']}")

    manual = json.loads(MANUAL.read_text(encoding="utf-8")) if MANUAL.exists() else []
    for i, p in enumerate(manual):
        if "lat" not in p:  # 주소만 적어 두면 네이버 Geocoding으로 좌표를 붙인다
            p = {**p, **geocode(p["addr"])}
        places.append({"id": f"manual-{i}", "tel": "", "since": "", "type": p.get("kind", ""), **p})
    sources["직접 확인"] = len(manual)

    places, dups = drop_store_dups(places)
    print(f"같은 가게라 뺀 상가정보 줄: {len(dups)}")

    extra = json.loads(EXTRA.read_text(encoding="utf-8")) if EXTRA.exists() else {}
    for p in places:
        p.update(extra.get(p["id"], {}))
    # 현장에서 없다고 확인한 곳(places_extra의 gone: 이유)은 뺀다. 상가정보는 문 닫은 가게가 한동안 남는다(10-15 행운공인중개사사무소)
    places = [p for p in places if not p.get("gone")]

    payload = {
        "updated_at": datetime.now(KST).isoformat(timespec="minutes"),
        "source": "행정안전부 인허가 데이터·소상공인시장진흥공단 상가정보(공공데이터포털)",
        "counts": sources,
        "places": places,
    }
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    block, lines = compare(old, payload, extra)
    block += [f"{k}: 받지 못함" for k in sorted(FAILED)]  # 한 업종이라도 못 받으면 쓰지 않는다(그 업종이 지도에서 낡은 채로 남거나 빠진다)
    print("\n".join(lines))
    if block and not force:
        sys.exit("✖ 이전보다 크게 줄어 쓰지 않음(받기 실패 의심): " + " · ".join(block)
                 + "\n  잠시 뒤 다시 돌리고, 정말 줄었으면 --force")
    CHANGES_LOG.parent.mkdir(exist_ok=True)
    with open(CHANGES_LOG, "a", encoding="utf-8") as f:
        f.write(f"===== {payload['updated_at']}" + (" (--force: " + " · ".join(block) + ")" if block else "")
                + "\n" + "\n".join(lines) + "\n")
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    # map.html은 파일을 더블클릭해 열어도 동작하도록 같은 내용을 스크립트로도 둔다(file://에서는 fetch가 막힌다).
    OUT.with_suffix(".js").write_text(
        "window.PLACES = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"→ {OUT} ({len(places)}곳)")


if __name__ == "__main__":
    main()
