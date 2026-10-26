"""용인 지원사업 수집(GitHub Actions용, 2026-10-26 공개 절차 3d ①) → 공모 레이더 out/local_programs.json과 같은 모양의 JSON.

    python scripts/collect_programs.py <출력.json>
    RADAR_JSON=<출력.json> python scripts/build_programs.py   # 이어서 data/programs.js

왜 따로 두나: 공개 사이트는 GitHub에서 갱신되는데, PC의 공모 레이더(D:\\공모 레이더, 매일 07:30) 결과 파일은 GitHub이 못 읽는다(사용자 10-26 ① 선택).
레이더는 텔레그램 알림용으로 그대로 돌고, 여기는 이남노트 칸에 필요한 '용인' 항목만 매번 처음부터 모은다(레이더는 DB에 쌓는다).
→ 수집 코드가 레이더 radar.py src_smes_pblanc·src_smes_event·src_kstartup과 두 벌이다. 한쪽 API 사용법을 고치면 다른 쪽도 본다.

출처와 키(환경 변수, Actions secrets):
- 중소벤처24 공고(기업마당 공고 포함) SMES_PBLANC_KEY — 등록일이 최근 PBLANC_DAYS일 안인 공고
- 중소벤처24 행사 SMES_EVENT_KEY — token은 주소에, searchCnt는 JSON 본문에(레이더 10-20 실측)
- K-Startup DATA_GO_KR_KEY — 모집 중(rcrt_prgs_yn=Y)만, 최신순 3쪽
'용인' 판정·거르기는 레이더 classify()와 config.json(local_strong·exclude)과 같은 규칙. 남기는 건 tags=['yongin']인 것뿐이다
(build_programs.py가 yongin만 쓴다). 출처 하나가 실패하면 나머지로 만들고, 셋 다 실패하면 실패로 끝나 지난 programs.js가 남는다.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date()
PBLANC_DAYS = 120  # 접수가 몇 달 이어지는 공고도 있어 넉넉히. 레이더는 지난 실행 뒤 새 것만 받아 DB에 쌓는다
UA = {"User-Agent": "Mozilla/5.0 (inamnote-programs)"}
# 레이더 config.json과 같은 값(2026-10-26 복사). 바꾸면 양쪽 다
LOCAL_STRONG = ["용인", "처인", "이동읍", "남사읍", "원삼면", "송전리"]
EXCLUDE = ["입찰공고", "채용공고", "직원 채용", "기간제 근로자"]
OTHER_REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "충청",
                 "전북", "전남", "전라", "경북", "경남", "경상", "제주"]
DATE_RE = re.compile(r"(20\d{2})[-./]?(\d{2})[-./]?(\d{2})")


def http(url, data=None, timeout=40):
    body = json.dumps(data).encode() if data is not None else None
    h = dict(UA, **({"Content-Type": "application/json"} if body else {}))
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h), timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def clean(s):
    s = re.sub(r"<[^>]+>", " ", str(s or ""))
    return re.sub(r"\s+", " ", s.replace("&nbsp;", " ")).strip()


def dates_in(s):
    out = []
    for y, m, d in DATE_RE.findall(str(s or "")):
        try:
            out.append(date(int(y), int(m), int(d)))
        except ValueError:
            pass
    return out


def iso(d):
    return d.isoformat() if d else None


def src_smes_pblanc(key):
    # 10-26 실측: 같은 120일이 한 번은 2.8초, 60일은 60초 시간 초과 — 서버가 들쭉날쭉해서 30일씩 나눠 묻고 실패하면 한 번 더
    q = urllib.parse.quote(key, safe="")
    rows = []
    for back in range(0, PBLANC_DAYS, 30):
        end, start = TODAY - timedelta(days=back), TODAY - timedelta(days=min(back + 29, PBLANC_DAYS))
        url = f"https://portal.smes.go.kr/ione-gw/api/pblanc/list?token={q}&strDt={start:%Y%m%d}&endDt={end:%Y%m%d}&html=no"
        for attempt in (1, 2):
            try:
                rows += (json.loads(http(url, timeout=60)).get("result") or {}).get("data") or []
                break
            except Exception:
                if attempt == 2:
                    raise
    return [{
        "uid": f"smes:{x.get('pblancSeq')}", "kind": "지원사업",
        "title": clean(x.get("pblancNm")), "org": clean(x.get("refrncDept") or x.get("sportInsttNm")),
        "area": clean(x.get("areaNm")) or "전국",
        "start": iso((dates_in(x.get("pblancBgnDt")) or [None])[0]), "end": iso((dates_in(x.get("pblancEndDt")) or [None])[-1]),
        "url": x.get("pblancDtlUrl") or x.get("reqstLinkInfo") or "",
        "target": clean(x.get("sportTrget"))[:300], "summary": clean(x.get("policyCnts"))[:400],
    } for x in rows]


def src_smes_event(key):
    q = urllib.parse.quote(key, safe="")
    j = json.loads(http(f"https://portal.smes.go.kr/ione-gw/api/event/list?token={q}", data={"searchCnt": "500"}))
    items = []
    for x in ((j.get("result") or {}).get("result") or {}).get("RECORD") or []:
        rc, ev = dates_in(x.get("rcptPrdCn")), dates_in(x.get("evntPrdCn"))
        items.append({
            "uid": f"smesev:{x.get('evntInfoId')}", "kind": "행사",
            "title": clean(x.get("evntInfoTtlNm")), "org": clean(x.get("evntInfoFlfmtInstNm")),
            "area": clean(x.get("evntInfoRgnNm")) or "전국",
            "start": iso(ev[0]) if ev else None, "end": iso(rc[-1]) if rc else (iso(ev[-1]) if ev else None),
            "url": x.get("srcUrlAddr") or "",
            "target": " ".join(x.get("hstgCn") or [])[:300], "summary": clean(x.get("evntOtlnCn"))[:400],
        })
    return items


def src_kstartup(key, pages=3):
    items = []
    for page in range(1, pages + 1):
        url = ("https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01?"
               + urllib.parse.urlencode({"serviceKey": key, "page": page, "perPage": 100, "returnType": "json"}))
        rows = json.loads(http(url)).get("data") or []
        for x in rows:
            if x.get("rcrt_prgs_yn") != "Y":
                continue
            items.append({
                "uid": f"kstartup:{x.get('pbanc_sn')}", "kind": "지원사업",
                "title": clean(x.get("biz_pbanc_nm")), "org": clean(x.get("pbanc_ntrp_nm")),
                "area": clean(x.get("supt_regin")) or "전국",
                "start": iso((dates_in(x.get("pbanc_rcpt_bgng_dt")) or [None])[0]),
                "end": iso((dates_in(x.get("pbanc_rcpt_end_dt")) or [None])[-1]),
                "url": x.get("detl_pg_url") or "",
                "target": clean(f"{x.get('aply_trgt') or ''} / {x.get('aply_trgt_ctnt') or ''}")[:300],
                "summary": clean(x.get("pbanc_ctnt"))[:400],
            })
        if not rows:
            break
    return items


def other_region(it):
    m = re.match(r"\s*\[([^\]]+)\]", it["title"])
    head = m.group(1) if m else ""
    area, org = it.get("area") or "", it.get("org") or ""
    if "경기" in head or "경기" in area:
        return False
    return (any(r in head for r in OTHER_REGIONS) or any(area.startswith(r) for r in OTHER_REGIONS)
            or any(org.startswith(r) for r in OTHER_REGIONS))


def yongin(it):
    """레이더 classify()에서 'yongin' 태그가 붙는 조건만."""
    if any(w in it["title"] for w in EXCLUDE):
        return False
    if it.get("end") and it["end"] < TODAY.isoformat():
        return False
    yrs = [int(y) for y in re.findall(r"(20\d{2})년", it["title"])]
    if not it.get("end") and yrs and max(yrs) < TODAY.year:
        return False
    if other_region(it):
        return False
    return any(w in f"{it['title']} {it['target']} {it['summary']} {it['org']}" for w in LOCAL_STRONG)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    env = os.environ
    got, errors = [], []
    for name, need, fn in (
        ("중소벤처24 공고", "SMES_PBLANC_KEY", src_smes_pblanc),
        ("중소벤처24 행사", "SMES_EVENT_KEY", src_smes_event),
        ("K-Startup", "DATA_GO_KR_KEY", src_kstartup),
    ):
        try:
            if not env.get(need):
                raise RuntimeError(f"{need} 없음")
            rows = fn(env[need])
            print(f"{name}: {len(rows)}건")
            got += rows
        except Exception as e:
            msg = f"{name} 실패: {type(e).__name__} {str(e)[:80]}"
            for k in ("SMES_PBLANC_KEY", "SMES_EVENT_KEY", "DATA_GO_KR_KEY"):  # 오류문에 키가 섞여 나오지 않게
                if env.get(k):
                    msg = msg.replace(env[k], "***").replace(urllib.parse.quote(env[k], safe=""), "***")
            print(msg, file=sys.stderr)
            errors.append(name)
    if len(errors) == 3:
        return 1
    uniq = {it["uid"]: it for it in got}
    items = [it for it in uniq.values() if yongin(it)]
    items.sort(key=lambda x: x.get("end") or "9999")
    keep = ["uid", "kind", "title", "org", "area", "start", "end", "url", "summary"]
    out = {"updated_at": datetime.now(KST).replace(tzinfo=None).isoformat(timespec="minutes"),
           "items": [dict({k: x[k] for k in keep}, tags=["yongin"]) for x in items]}
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"용인 {len(items)}건 → {sys.argv[1]}" + (f" (실패: {', '.join(errors)})" if errors else ""))
    return 2 if errors else 0  # 일부만 실패: 파일은 쓰되 작업은 실패로 → 메일(조용히 줄어든 목록을 놓치지 않게)


if __name__ == "__main__":
    sys.exit(main())
