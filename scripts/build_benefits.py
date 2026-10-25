"""용인·경기·전국 혜택 목록(data/benefits.json, benefits.js)을 만든다. 이름·요약·대상·신청 기간·문의·원문 링크만 짧게 둔다.

출처 (2026-10-16 연결)
- 행정안전부 '대한민국 공공서비스(혜택) 정보'(공공데이터포털 15113968, 정부24·보조금24 원본, 이용허락 제한 없음).
  api.odcloud.kr/api/gov24/v3/serviceList — 전체 약 11,000건을 한 번에 받아 아래만 남긴다.
  1. 용인: 소관기관이 경기도 용인시·용인 공공기관. 수지구·기흥구 보건소 전용 사업은 뺀다(이동·남사는 처인구).
  2. 경기도: 소관기관이 경기도이거나 도민 전체가 대상인 경기도 출연기관(KEEP_GG).
  기업·시설·단체만 대상인 사업은 뺀다(사용자구분에 개인·가구·소상공인이 없는 것).
  3. 전국: 중앙행정기관·공공기관 사업 중 정부24 조회수 상위 NATION_TOP개(많이 찾는 것). 나머지는 화면에서 보조금24로 보낸다.
신청 기간이 '2026.09.07~2026.10.02'처럼 날짜면 start·end로 풀어 둔다. 접수 중·끝남은 화면이 그날 날짜로 판단한다(목록이 며칠 묵어도 맞게).
첫 화면 '새로 나온 소식'(2026-10-20)과 '지금 접수 중인 혜택'(2026-10-23)은 신청 기간이 날짜인 것만 benefits_recent.js로 따로 쓴다
(전체 약 280KB를 첫 화면에서 안 받게).
원본에 게시일이 없어서 접수 시작일을 그 혜택이 '나온 날'로 친다.
본문(2026-10-23 사용자 "혜택 글이 바로 본문이 안 보이고 링크로 연결"): 같은 원본의 serviceDetail(지원대상·선정기준·지원내용·신청방법·구비서류·문의처 등
전문)을 받아 목록에 남은 혜택 것만 data/benefit_bodies.json으로 쓴다. 혜택 화면이 누를 때 한 번 받아 읽기 창에 보여 준다.
본문 받기만 실패하면 지난 본문 파일을 그대로 둔다(목록은 새로 쓴다).
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "benefits.json"
KST = timezone(timedelta(hours=9))
API = "https://api.odcloud.kr/api/gov24/v3/serviceList"
YONGIN = re.compile(r"^경기도 용인시$|^용인")
NOT_HERE = re.compile(r"\((수지구|기흥구)\)|\((수지|기흥)\)")
KEEP_GG = {"경기도", "경기신용보증재단", "재단법인경기도시장상권진흥원", "경기도농수산진흥원", "경기복지재단",
           "경기주택도시공사", "재단법인경기도사회서비스원", "경기도평생교육진흥원"}
NATION_TOP = 150
MIN_TOTAL = 5000  # 이보다 적게 받히면 API가 잘못된 것 → 지난 결과를 그대로 둔다


def key():
    env = ROOT.parent / ".env"
    return os.environ.get("DATA_GO_KR_KEY") or next((l.split("=", 1)[1].strip() for l in env.read_text(encoding="utf-8").splitlines()
                                                     if l.startswith("DATA_GO_KR_KEY=")), "")


def fetch(api=API):
    items, page, k = [], 1, key()
    while True:
        q = {"page": page, "perPage": 1000, "serviceKey": k}
        req = urllib.request.Request(api + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "Mozilla/5.0 (inamnote benefits)"})
        d = json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))
        items += d["data"]
        if page * 1000 >= d["totalCount"] or not d["data"]:
            return items
        page += 1


def short(s, n=130):
    """'○ 가\r\n - 나' 같은 글머리 여러 줄 → '가 · 나', n자에서 자른다"""
    if not s:
        return ""
    parts = [re.sub(r"^[\s○◦•ㆍ·\-–※□■▶>]+|\s+$", "", l) for l in re.split(r"[\r\n]+", s)]
    t = " · ".join(p for p in parts if p)
    t = re.sub(r"\s+", " ", t)
    return t if len(t) <= n else t[:n - 1].rstrip(" ·,") + "…"


DATE = re.compile(r"(?:20|')(\d\d)\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})\s*일?\.?\s*(?:\([^)]*\))?\s*[~∼-]\s*"
                  r"(?:(?:20|')(\d\d)\s*[.\-년]\s*)?(\d{1,2})\s*[.\-월]\s*(\d{1,2})")


def period(s):
    m = DATE.search(s or "")
    if not m:
        return None, None
    y1, m1, d1, y2, m2, d2 = m.groups()
    try:
        a = datetime(2000 + int(y1), int(m1), int(d1)).date()
        b = datetime(2000 + int(y2 or y1), int(m2), int(d2)).date()
    except ValueError:
        return None, None
    return (a.isoformat(), b.isoformat()) if b >= a else (None, None)


# 누구에게 — 화면의 대상 칩. 이름·대상·분야·사용자구분으로 고른다(겹칠 수 있다)
WHO = [
    ("kid", "임신·아이", lambda x, t: x["서비스분야"] in ("임신·출산",) or re.search(r"영유아|아동|어린이|초등|중학|고등학|학생|자녀|출산|임산|산모|신생아|보육", t)),
    ("young", "청년", lambda x, t: "청년" in t),
    ("old", "어르신", lambda x, t: re.search(r"노인|어르신|65세|고령|효도|경로|장기요양|기초연금", t)),
    ("farm", "농업인", lambda x, t: x["서비스분야"] == "농림축산어업" or re.search(r"농업인|농가|농민|농어민|축산|농촌", t)),
    ("biz", "소상공인", lambda x, t: "소상공인" in (x["사용자구분"] or "") or re.search(r"소상공인|자영업|전통시장|상인", t)),
    ("dis", "장애인", lambda x, t: "장애" in t),
    ("low", "저소득·한부모", lambda x, t: re.search(r"저소득|기초생활|수급|차상위|한부모|긴급복지|취약계층", t)),
]


def pick(x, area):
    t = " ".join(filter(None, (x["서비스명"], x["지원대상"], x["서비스목적요약"])))
    start, end = period(x["신청기한"])
    return {
        "id": x["서비스ID"], "area": area, "name": x["서비스명"].strip(), "sum": short(x["서비스목적요약"], 90),
        "who": short(x["지원대상"], 100), "what": short(x["지원내용"], 100), "when": short(x["신청기한"], 60),
        "start": start, "end": end, "how": (x["신청방법"] or "").replace("||", "·").replace("직접입력", ""),
        "org": " · ".join(filter(None, (x["소관기관명"], x["부서명"]))), "tel": short(x["전화문의"], 60),
        "kind": (x["지원유형"] or "").replace("||", "·"),
        "tags": [k for k, _, f in WHO if f(x, t)], "views": x["조회수"], "url": x["상세조회URL"],
    }


def tidy(s):
    """원문 글머리·들여쓰기는 살리되 줄 끝 공백과 \\r, 3줄 넘는 빈 줄만 정리한다. 내용은 고치지 않는다"""
    if not s or s.strip() in ("해당없음", "-"):
        return ""
    t = "\n".join(l.rstrip() for l in s.replace("\r", "").split("\n"))
    return re.sub(r"\n{3,}", "\n\n", t).strip()


# 읽기 창에 보여 줄 순서. 원본 칸 이름 → 화면 제목
BODY = [("서비스목적", "무엇인가요"), ("지원대상", "누가 받나요"), ("선정기준", "선정 기준"), ("지원내용", "무엇을 주나요"),
        ("신청방법", "어떻게 신청하나요"), ("구비서류", "필요한 서류"), ("본인확인필요구비서류", "본인 확인이 필요한 서류"),
        ("공무원확인구비서류", "공무원이 확인하는 서류(따로 안 내도 돼요)"), ("접수기관명", "접수하는 곳"), ("문의처", "문의")]


def write_bodies(items):
    ids = {x["id"] for x in items}
    try:
        detail = [d for d in fetch(API.replace("serviceList", "serviceDetail")) if d["서비스ID"] in ids]
    except Exception as e:
        print(f"본문(serviceDetail) 실패: {e} → 지난 본문 유지", file=sys.stderr)
        return 0
    out = {}
    for d in detail:
        secs = [[label, tidy(d.get(k))] for k, label in BODY if tidy(d.get(k))]
        law = " · ".join(filter(None, (tidy(d.get(k)) for k in ("법령", "자치법규", "행정규칙"))))
        out[d["서비스ID"]] = {"secs": secs, "when": tidy(d.get("신청기한")), "apply": (d.get("온라인신청사이트URL") or "").strip(),
                            "law": law, "mod": d.get("수정일시") or ""}
    (OUT.parent / "benefit_bodies.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(out)


def write_recent(payload):
    """첫 화면용: 신청 기간이 날짜인 혜택만 이름·기간·지역·지원유형. 접수 중인지는 화면이 그날 날짜로 거른다.
    '새로 나온 소식'은 start가 있는 것만, '지금 접수 중인 혜택'은 end가 있는 것을 쓴다(혜택 화면 '지금 접수 중'과 같은 기준).
    id는 누르면 혜택 화면 읽기 창(benefits.html#b=id)으로 바로 열기 위해 둔다.
    always(2026-10-25 사용자 "마감일 없는 상시신청은 따로 칸"): 기간 없이 '상시신청'인 것만, 첫 화면 '언제든 신청할 수 있는 혜택' 칸용, 많이 찾는 순."""
    keep = [{k: x[k] for k in ("id", "area", "name", "start", "end", "kind")} for x in payload["items"] if x.get("start") or x.get("end")]
    always = [{k: x[k] for k in ("id", "area", "name", "kind")}
              for x in sorted(payload["items"], key=lambda x: -(x.get("views") or 0)) if not x.get("end") and "상시" in (x.get("when") or "")]
    (OUT.parent / "benefits_recent.js").write_text(
        "window.BENEFITS_RECENT = " + json.dumps({"updated_at": payload["updated_at"], "items": keep, "always": always}, ensure_ascii=False) + ";\n",
        encoding="utf-8")


def main():
    try:
        raw = fetch()
        if len(raw) < MIN_TOTAL:
            raise RuntimeError(f"{len(raw)}건만 받힘")
    except Exception as e:  # 받기 실패 → 지난 파일을 그대로 두고 실패로 끝낸다(화면은 지난 목록을 보여 준다)
        print(f"공공서비스 API 실패: {e} → 지난 결과 유지", file=sys.stderr)
        return 1
    org = lambda x: (x["소관기관명"] or "").strip()
    raw_all = raw
    raw = [x for x in raw if re.search("개인|가구|소상공인", x["사용자구분"] or "")]  # 기업·시설·단체만 대상인 사업은 뺀다
    yongin = [pick(x, "yongin") for x in raw if YONGIN.search(org(x)) and not NOT_HERE.search(x["서비스명"])]
    gg = [pick(x, "gg") for x in raw if org(x) in KEEP_GG]
    nation = sorted((x for x in raw if x["소관기관유형"] in ("중앙행정기관", "공공기관")), key=lambda x: -(x["조회수"] or 0))[:NATION_TOP]
    items = yongin + gg + [pick(x, "nation") for x in nation]
    for x in items:
        x["name"] = re.sub(r"\s*\(처인구\)$", "", x["name"])  # 처인구판만 남겼으니 꼬리표는 뗀다
    payload = {"updated_at": datetime.now(KST).isoformat(timespec="minutes"), "total": len(raw_all),
               "who": [[k, label] for k, label, _ in WHO], "items": items}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT.with_suffix(".js").write_text("window.BENEFITS = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    write_recent(payload)
    nb = write_bodies(items)
    print(f"전체 {len(raw_all)}건(개인·가구·소상공인 {len(raw)}) 중 용인 {len(yongin)} · 경기도 {len(gg)} · 전국 {len(nation)} → {OUT}, 본문 {nb}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
