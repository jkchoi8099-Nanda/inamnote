"""이남노트 '오늘' 카드 데이터 갱신 (표준 라이브러리만 사용).

GitHub Actions가 30분마다 실행한다(.github/workflows/today.yml).
환경변수 DATA_GO_KR_KEY 에 공공데이터포털 '일반 인증키(Decoding)'를 넣는다. 키는 저장소에 올리지 않는다.

소스(이용 조건은 기획/리서치/07c_안C 2-2 기준):
  - 기상청 단기예보 조회서비스(공공누리 1유형): 초단기실황 + 단기예보
  - 기상청 기상특보 조회서비스(1유형): 특보 현황 중 '용인' 포함 문구
  - 에어코리아 대기오염정보(3유형, 변경 금지): 이동읍 측정소 실시간 값·등급을 그대로
  - 국립중앙의료원 약국 정보(제한 없음): 처인구 중 이동읍·남사읍 주소
  - 한국천문연구원 특일 정보: 오늘이 공휴일인지(약국 공휴일 운영시간용)
엔드포인트·파라미터는 2026-10-08 기준 문서 기억에 따른 것이라 키를 받은 뒤 첫 실행에서 확인한다.
소스 하나가 실패해도 나머지는 갱신하고, 실패한 소스는 직전 값을 그대로 두고 ok=false로 표시한다.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# TODAY_OUT: 다른 곳에 쓰고 싶을 때만(공개 전 PC 미리보기 서버가 git 밖 사본을 갱신한다 — scripts/serve_preview.py, 2026-10-12)
OUT = os.environ.get("TODAY_OUT") or os.path.join(ROOT, "data", "today.json")

# 기상청 격자: 이동읍 천리 부근 (64, 118) — 공개 변환식으로 계산한 추정값. 첫 실행 때 확인한다.
GRID = (64, 118)
AIR_STATION = "이동읍"          # 에어코리아 측정소(이동읍주민자치센터)
PHARM_Q0, PHARM_Q1 = "경기도", "용인시"  # "용인시 처인구"로 물으면 0건이다(2026-10-12 확인). 용인시 전체(약 440곳)에서 읍으로 거른다
PHARM_AREAS = ("이동읍", "남사읍")

SKY = {"1": "맑음", "3": "구름많음", "4": "흐림"}
PTY = {"0": "", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기", "5": "빗방울", "6": "빗방울·눈날림", "7": "눈날림"}
GRADE = {"1": "좋음", "2": "보통", "3": "나쁨", "4": "매우나쁨"}


def now_kst():
    return datetime.now(KST)


def get(url, params, key, timeout=20):
    q = dict(params)
    q["serviceKey"] = key
    full = url + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(full, headers={"User-Agent": "inamnote-today/1.0"})
    # 에어코리아가 30분 실행 중 약 17%를 시간 초과로 실패했다(10-12~14 미리보기 기록 13/76회, 사이사이 성공) → 시간 초과만 한 번 더
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except (TimeoutError, urllib.error.URLError) as e:  # 읽기 시간 초과 / 연결 시간 초과(URLError로 감싸 옴)
            if attempt == 2 or not isinstance(getattr(e, "reason", e), TimeoutError):
                raise
            print("시간 초과, 다시 시도:", url.rsplit("/", 1)[-1], file=sys.stderr)


def items_json(text):
    data = json.loads(text)
    body = data["response"]["body"]
    it = body.get("items") or {}
    it = it.get("item", []) if isinstance(it, dict) else it
    return it if isinstance(it, list) else [it]


VILAGE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/"


def ncst_at(key, b):
    """초단기실황(b시 정각 관측) → {항목: 값}. 최근 하루치만 받을 수 있다."""
    return {i["category"]: i["obsrValue"] for i in items_json(get(
        VILAGE + "getUltraSrtNcst",
        {"pageNo": 1, "numOfRows": 100, "dataType": "JSON", "base_date": b.strftime("%Y%m%d"),
         "base_time": b.strftime("%H00"), "nx": GRID[0], "ny": GRID[1]}, key))}


def vilage(key, bd, bt):
    # 한 번 발표에 약 4일치·시간마다 12항목(1,000줄 남짓)이라 넉넉히 받는다(1,000이면 마지막 날이 잘렸다, 10-16 확인)
    return items_json(get(
        VILAGE + "getVilageFcst",
        {"pageNo": 1, "numOfRows": 1500, "dataType": "JSON", "base_date": bd, "base_time": bt,
         "nx": GRID[0], "ny": GRID[1]}, key))


def weather(key):
    """첫 화면 한 줄(temp·sky·pop…)과 날씨 화면(weather.html)용 자료. 날씨 화면 칸: now·yday_temp·hourly·days (2026-10-16)."""
    t = now_kst()
    # 초단기실황: 매시 정각 기준, 약 40분 뒤 제공
    b = t - timedelta(minutes=45)
    obs = ncst_at(key, b)
    # '어제보다 몇 도': 실황은 최근 24시간만 받을 수 있어 어제 같은 시각을 못 묻는다(10-16 확인, 응답에 body 없음).
    # 그래서 매 실행의 관측 기온을 시각별로 26시간치 쌓아 두고(hist) 24시간 전 값과 비교한다. 첫날은 비교 없이 보인다
    try:
        hist = dict(json.load(open(OUT, encoding="utf-8"))["sources"]["weather"]["data"].get("hist") or {})
    except Exception:
        hist = {}
    if obs.get("T1H") is not None:
        hist[b.strftime("%Y%m%d%H")] = obs["T1H"]
    cut = (b - timedelta(hours=26)).strftime("%Y%m%d%H")
    hist = {k: v for k, v in sorted(hist.items()) if k >= cut}
    yday = hist.get((b - timedelta(days=1)).strftime("%Y%m%d%H"))
    # 단기예보: 02,05,08,11,14,17,20,23시 발표, 약 10분 뒤 제공
    f = t - timedelta(minutes=15)
    hours = [h for h in (2, 5, 8, 11, 14, 17, 20, 23) if h <= f.hour]
    if hours:
        bd, bt = f.strftime("%Y%m%d"), "%02d00" % hours[-1]
    else:
        y = f - timedelta(days=1)
        bd, bt = y.strftime("%Y%m%d"), "2300"
    fc = vilage(key, bd, bt)
    today = t.strftime("%Y%m%d")
    # 오늘 최저·최고(TMN·TMX)는 그날 02시 발표까지만 들어 있다 → 오후에도 보이게 오늘 02시 발표를 한 번 더 받는다
    if (bd, bt) != (today, "0200") and bd == today:
        try:
            fc0 = vilage(key, today, "0200")
            fc = [i for i in fc0 if i["fcstDate"] == today and i["category"] in ("TMN", "TMX")] + \
                 [i for i in fc if not (i["fcstDate"] == today and i["category"] in ("TMN", "TMX"))]
        except Exception as e:
            print("오늘 02시 발표 실패:", e, file=sys.stderr)
    grid = {}
    for i in fc:
        grid.setdefault((i["fcstDate"], i["fcstTime"]), {})[i["category"]] = i["fcstValue"]
    nowh0 = t.strftime("%Y%m%d%H00")
    hourly = [{"d": d, "h": h, "tmp": v.get("TMP"), "sky": v.get("SKY"), "pty": v.get("PTY"), "pop": v.get("POP"),
               "pcp": v.get("PCP"), "sno": v.get("SNO"), "reh": v.get("REH"), "wsd": v.get("WSD"), "vec": v.get("VEC")}
              for (d, h), v in sorted(grid.items()) if d + h >= nowh0 and v.get("TMP") is not None]
    days = {}
    for (d, h), v in grid.items():
        day = days.setdefault(d, {"date": d})
        if "TMN" in v: day["tmn"] = v["TMN"]
        if "TMX" in v: day["tmx"] = v["TMX"]
    for d, day in days.items():  # 오전(09시)·오후(15시) 하늘과 반나절 최고 강수확률
        for part, hh, rng in (("am", "0900", ("0000", "1200")), ("pm", "1500", ("1200", "2400"))):
            v = grid.get((d, hh)) or {}
            pops = [int(x["POP"]) for (dd, h), x in grid.items() if dd == d and rng[0] <= h < rng[1] and x.get("POP")]
            if v or pops:
                day[part] = {"sky": v.get("SKY"), "pty": v.get("PTY"), "pop": max(pops) if pops else None}
    days = [days[d] for d in sorted(days) if d >= today and ("tmn" in days[d] or "tmx" in days[d])]  # 마지막 날은 몇 시간만 있어 뺀다
    nowh = t.strftime("%H00")
    pops = [(i["fcstTime"], int(i["fcstValue"])) for i in fc
            if i["category"] == "POP" and i["fcstDate"] == today and i["fcstTime"] >= nowh]
    sky_now = next((i["fcstValue"] for i in fc if i["category"] == "SKY" and i["fcstDate"] == today and i["fcstTime"] >= nowh), None)
    tmx = next((i["fcstValue"] for i in fc if i["category"] == "TMX" and i["fcstDate"] == today), None)
    tmn = next((i["fcstValue"] for i in fc if i["category"] == "TMN" and i["fcstDate"] == today), None)
    peak = max(pops, key=lambda x: x[1]) if pops else None
    pty = PTY.get(str(obs.get("PTY", "0")), "")
    return {
        "temp": obs.get("T1H"),
        "sky": pty or SKY.get(str(sky_now), ""),
        "rain_1h": obs.get("RN1"),
        "pop_max": peak[1] if peak else None,
        "pop_at": (peak[0][:2] + "시") if peak and peak[1] >= 30 else None,
        "tmx": tmx, "tmn": tmn,
        "base": b.strftime("%H:00"),
        "now": {"t1h": obs.get("T1H"), "reh": obs.get("REH"), "wsd": obs.get("WSD"), "vec": obs.get("VEC"),
                "rn1": obs.get("RN1"), "pty": obs.get("PTY")},
        "yday_temp": yday,
        "hist": hist,
        "fcst_base": bd + bt,
        "hourly": hourly,
        "days": days,
    }


def alerts(key):
    text = get("https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus",
               {"pageNo": 1, "numOfRows": 10, "dataType": "JSON"}, key)
    it = items_json(text)
    # 특보 이름이 빠지고 전국 지역 50여 개만 보이던 것(10-18 발견: "10월 18일 오전(06시~12시) : 경기도(광명, …)") →
    # t6(발효 중)은 "o 강풍주의보 : 지역", t7(예비특보)은 "(1) 강풍 예비특보" 머리 아래 "o 시각 : 지역" 줄이다.
    # 용인이 든 줄만 골라 "특보 이름 · 시각 · 용인 구역"으로 짧게 쓴다. 지역 이름은 기상청 표기 그대로
    out = []
    for i in it:
        for field, ahead in (("t6", False), ("t7", True)):
            kind = ""
            for line in str(i.get(field) or "").replace("\r", "").split("\n"):
                line = line.strip()
                m = re.match(r"\(\d+\)\s*(.+)", line)
                if m:
                    kind = m.group(1).strip()
                    continue
                if not line.startswith("o ") or ":" not in line or "용인" not in line:
                    continue
                head, regions = line[2:].split(":", 1)
                zones = "·".join(re.findall(r"용인[가-힣]*", regions))
                out.append(f"{kind} · {head.strip()} · {zones}" if ahead else f"{head.strip()} 발효 중 · {zones}")
    return {"items": out[:3]}


def air(key):
    it = items_json(get(
        "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty",
        {"returnType": "json", "numOfRows": 1, "pageNo": 1, "stationName": AIR_STATION,
         "dataTerm": "DAILY", "ver": "1.3"}, key))
    i = it[0]
    return {
        "station": AIR_STATION,
        "time": i.get("dataTime"),
        "pm10": i.get("pm10Value"), "pm25": i.get("pm25Value"),
        "pm10_grade": GRADE.get(str(i.get("pm10Grade")), ""),
        "pm25_grade": GRADE.get(str(i.get("pm25Grade")), ""),
        # 날씨 화면(10-16): 오존·통합대기환경지수. 값·등급은 에어코리아 그대로(3유형, 변경 금지)
        "o3": i.get("o3Value"), "o3_grade": GRADE.get(str(i.get("o3Grade")), ""),
        "khai": i.get("khaiValue"), "khai_grade": GRADE.get(str(i.get("khaiGrade")), ""),
    }


def holiday(key):
    t = now_kst()
    it = items_json(get(
        "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
        {"solYear": t.year, "solMonth": "%02d" % t.month, "_type": "json", "numOfRows": 50}, key))
    days = [str(i.get("locdate")) for i in it if i and i.get("isHoliday") == "Y"]
    tomorrow = (t + timedelta(days=1)).strftime("%Y%m%d")
    return {"today": t.strftime("%Y%m%d") in days, "tomorrow": tomorrow in days, "days": days}


def pharmacies(key):
    text = get("https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire",
               {"Q0": PHARM_Q0, "Q1": PHARM_Q1, "pageNo": 1, "numOfRows": 1000}, key, timeout=40)
    root = ET.fromstring(text)
    out = []
    for item in root.iter("item"):
        g = {c.tag: (c.text or "").strip() for c in item}
        addr = g.get("dutyAddr", "")
        if not any(a in addr for a in PHARM_AREAS):
            continue
        hours = {}
        for d in range(1, 9):
            s, c = g.get("dutyTime%ds" % d), g.get("dutyTime%dc" % d)
            if s and c:
                hours[str(d)] = [s, c]
        out.append({"name": g.get("dutyName"), "addr": addr, "tel": g.get("dutyTel1"), "hours": hours})
    out.sort(key=lambda x: x["name"] or "")
    return {"items": out}


MID_LAND, MID_TA = "11B00000", "11B20612"  # 서울·인천·경기 육상 / 용인 기온 — 기상청 중기예보 활용가이드 구역코드표(2025.12)에서 확인(10-16)


def mid(key):
    """중기예보(06·18시 발표): 단기예보 다음 날부터 10일째까지 오전·오후 날씨·강수확률(8일째부터는 하루 하나)·최저/최고.
    2026-10-16 사용자 활용신청. 발표 직후엔 비어 있을 수 있어 직전 발표로 한 번 물러선다."""
    t = now_kst()
    cands = []
    for back in range(3):
        b = t - timedelta(hours=12 * back)
        base = b.replace(hour=18 if b.hour >= 18 else 6, minute=0) if b.hour >= 6 else (b - timedelta(days=1)).replace(hour=18, minute=0)
        if base.strftime("%Y%m%d%H") not in [c.strftime("%Y%m%d%H") for c in cands]:
            cands.append(base)
    last = None
    for base in cands:
        tm = base.strftime("%Y%m%d%H00")
        try:
            land = items_json(get("https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst",
                                  {"pageNo": 1, "numOfRows": 10, "dataType": "JSON", "regId": MID_LAND, "tmFc": tm}, key))[0]
            ta = items_json(get("https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa",
                                {"pageNo": 1, "numOfRows": 10, "dataType": "JSON", "regId": MID_TA, "tmFc": tm}, key))[0]
        except Exception as e:
            last = e
            continue
        days = []
        for n in range(3, 11):
            if "taMin%d" % n not in ta and "wf%d" % n not in land and "wf%dAm" % n not in land:
                continue
            am = {"wf": land.get("wf%dAm" % n, land.get("wf%d" % n)), "pop": land.get("rnSt%dAm" % n, land.get("rnSt%d" % n))}
            pm = {"wf": land.get("wf%dPm" % n, land.get("wf%d" % n)), "pop": land.get("rnSt%dPm" % n, land.get("rnSt%d" % n))}
            days.append({"date": (base + timedelta(days=n)).strftime("%Y%m%d"), "tmn": ta.get("taMin%d" % n), "tmx": ta.get("taMax%d" % n),
                         "am": am, "pm": pm})
        return {"tmfc": tm, "days": days}
    raise last or RuntimeError("중기예보 없음")


SOURCES = [("weather", weather), ("mid", mid), ("alerts", alerts), ("air", air), ("holiday", holiday), ("pharmacies", pharmacies)]


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            prev = {}
    out = {"generated_at": now_kst().isoformat(timespec="minutes"), "example": False, "sources": {}}
    if not key:
        print("DATA_GO_KR_KEY 없음: 갱신하지 않는다", file=sys.stderr)
        return 1  # GitHub Actions가 실패로 표시하고 메일을 보내게(시크릿 빠짐을 조용히 넘기지 않는다)
    for name, fn in SOURCES:
        try:
            out["sources"][name] = {"ok": True, "at": now_kst().isoformat(timespec="minutes"), "data": fn(key)}
        except Exception as e:  # 소스 하나가 실패해도 나머지는 계속
            old = (prev.get("sources") or {}).get(name, {})
            out["sources"][name] = {"ok": False, "at": old.get("at"), "data": old.get("data"), "error": str(e)[:200]}
            print("실패:", name, e, file=sys.stderr)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # 전부 실패면(키 만료·해외 접속 차단 등) 실패로 끝낸다 → Actions 실패 메일. 일부 실패는 화면이 ok=false로 보여 준다
    return 0 if any(v["ok"] for v in out["sources"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
