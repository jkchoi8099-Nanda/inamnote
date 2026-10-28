"""이동읍·남사읍 공식 소식(data/notices.json, notices.js)을 만든다. 목록은 제목·날짜·기관·원문 링크,
본문은 따로 data/notice_bodies.json(2026-10-16부터, 아래 '본문' 참고 — 화면 안 읽기 창용).

출처 (2026-10-12 조사)
1. 토지이음 고시정보(국토부, eum.go.kr): 용인시 고시 가운데 제목에 이동·남사 관련 말이 있는 것.
   산단·도시개발·도로·주거환경개선처럼 주민에게 직접 해당하는 공식 고시가 여기 올라온다.
2. 처인구청 '이동읍 소식'·'남사읍 소식' 게시판. 다른 지역 아파트 '장애인 특별공급 안내'가 대부분이라 제목에 이동·남사가 없는 특별공급은 뺀다.
3. LH(국가산단·용인이동 공공주택지구 사업시행자) 보도자료·공모(보상등기·설계공모 등) — 게시판 검색(GET)으로 '용인'을 찾고
   제목이 국가산단·용인이동·이동읍·남사에 해당하는 것만 남긴다(사용자 10-12 "LH쪽에는 내용이 없을까?").
4. LH 청약플러스 분양·임대 공고: 공공데이터포털 '한국토지주택공사_분양임대공고문 조회 서비스'(DATA_GO_KR_KEY).
   경기도 최근 6개월 공고 중 이름에 용인·처인이 있는 주택 공고(청년·신혼 매입임대, 국민임대 등). 토지 공급은 이동·남사일 때만.
5. 용인시·처인구가 직접 올리는 소식(2026-10-16 사용자 "네이버에 용인 소식 … 개인이 올리는거 말고 지자체에서 올리는 자료"):
   용인시청 보도자료(최근 30일)·시정소식(공지), 처인구청 '처인 홍보관'(읍면동·구청 과가 올리는 소식).
   시 전체 글은 하루 9건쯤이라 주민이 신청·참여·조심할 글만 남긴다(시장 동정·기부·수상·다른 구 이야기·행정 공시는 뺀다).
   이동·남사·처인·산단 글은 scope "town"(전체 탭에도 보임), 나머지 시 전체 글은 scope "city"('용인시 소식' 탭에만).
   네이버 검색에 함께 나오는 계약정보·기업지원·수지구청·시의회 소식지·문화재단·평생학습관은 동네 주민 소식이 아니라 넣지 않았다.
6. 용인시보의 고시·공고 줄(2026-10-28): 수용재결신청서 열람공고·재결서 공시송달처럼 용인시가 내는 국가산단 보상 공고는
   이 줄로만 나온다. 이동·남사·국가산단 관련만 src "용인시 고시·공고", 보상 절차면 cat "comp"(화면 '보상' 탭), 아니면 cat "gosi"('공식 고시' 탭).
7. 용인시 새올 고시공고(eminwon.yongin.go.kr, 2026-10-29): 6번의 원래 게시판. 같은 src에 via "새올", 게재기간 끝 날짜 until(열람·의견 마감).
   시보는 새올에서 이미 사라진 지난 공고(게재기간 끝남)를 채우는 용도로 남긴다. 공고번호(nos)가 같으면 새올 쪽만.
처인구청 서버는 오래된 TLS 설정이라 파이썬 기본값으로는 접속이 안 된다 → 보안 수준을 한 단계 낮춘 연결을 쓴다.
"""
import base64
import hashlib
import html
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# NOTICES_DIR: 미리보기 서버가 30분마다 돌릴 때 결과(목록·본문·그림)를 git 밖 logs/preview_notices/에 쓰게 한다(2026-10-21).
# 화면에 들어가는 그림 주소는 그대로 data/notice_img/…이고, 서버가 그 요청을 이 폴더에서 내준다.
DATA = Path(os.environ["NOTICES_DIR"]) if os.environ.get("NOTICES_DIR") else ROOT / "data"
OUT = DATA / "notices.json"
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (inamnote notices; contact via site)"}

# 토지이음: 용인시(41460)와 처인구(41461) 코드로 각각 최근 목록을 받는다
EUM_SGG = ["41460", "41461"]
EUM_PAGES = 3  # 쪽당 50건
# 제목에 이 말이 있으면 이동·남사 관련으로 본다. 원삼(SK 일반산단)은 범위 밖이라 넣지 않는다(결정 로그 Q3).
EUM_KEYWORDS = re.compile(
    r"이동읍|남사읍|용인이동|이동2구역|이동\s?공공주택|이원선|송전|남사|국가산업단지|국가산단|시스템반도체"
    r"|국도\s?45|45호선|82호선|토지거래허가|천리|덕성|어비|묘봉")
BOARDS = [("이동읍", 274, 1666), ("남사읍", 275, 1667)]
LH_BOARDS = [("LH 보상공고", "board", "a10403170500", "0060"),  # 보상계획·열람, 대토보상, 분묘 개장 — 원주민에게 가장 중요
             ("LH 보도자료", "gallery", "a10502000000", "0003"), ("LH 공모·공고", "board", "a10601020000", "0034"),
             ("LH 공지", "board", "a10601010000", "0033")]
# 국지도84호선 중리~천리(이동읍 천리 통과) 보상 공고는 제목에 '용인'이 없다(2026-10-29 조사, 10-02 수용재결 공시송달 등 3건 빠져 있었음)
# → 보상공고 게시판은 '천리'로 한 번 더 찾고, 제목 규칙에도 넣는다
LH_KEEP = re.compile(r"용인.{0,6}(반도체|국가산|첨단시스템)|용인이동|이동읍|남사")
LH_KEEP_RECENT = re.compile(r"중리.{0,4}천리")  # 2016년부터 공고가 이어진 사업이라 최근 2년 것만
LH_EXTRA_KW = {"LH 보상공고": ["%EC%B2%9C%EB%A6%AC"]}  # 천리

LEGACY_TLS = ssl.create_default_context()
LEGACY_TLS.set_ciphers("DEFAULT@SECLEVEL=1")
LEGACY_TLS.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0)
# 처인구청 서버는 중간 인증서를 안 보낸다. Windows는 알아서 받아 오지만 리눅스(GitHub Actions)는 검증에 실패한다
# → 공개 중간 인증서 2장(GoGetSSL RSA DV SSL CA 2 2035-08 만료, USERTrust가 서명한 Sectigo R46 2038-01 만료,
#   둘 다 인증서 안 AIA 주소 crt.sectigo.com에서 받음)을 옆에 두고 더한다(2026-10-14, 해외 서버에서 시험 통과)
LEGACY_TLS.load_verify_locations(Path(__file__).with_name("cheoingu_ca.pem"))


def get(url, enc="utf-8", ctx=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30, context=ctx) as r:
        return r.read().decode(enc, "replace")


def text(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>|<!--.*?-->", " ", s, flags=re.S))).strip()


def rows(page_html):
    segs = re.findall(r"<tbody.*?</tbody>", page_html, re.S)
    return [r for seg in segs for r in re.findall(r"<tr.*?</tr>", seg, re.S)]


def eum():
    out, seen = [], set()
    for sgg in EUM_SGG:
        for page in range(1, EUM_PAGES + 1):
            url = (f"https://www.eum.go.kr/web/gs/gv/gvGosiList.jsp?pageNo={page}&listSize=50"
                   f"&sido_cd=41&sgg_cd={sgg}&selSggCd={sgg}")
            for r in rows(get(url, "cp949")):
                tds = re.findall(r"<td.*?</td>", r, re.S)
                link = re.search(r"href='(gvGosiDet\.jsp\?seq=(\d+))", r)
                if len(tds) < 4 or not link:
                    continue
                title = text(tds[2])
                if not EUM_KEYWORDS.search(title) or link.group(2) in seen:
                    continue
                seen.add(link.group(2))
                out.append({"src": "토지이음 고시", "date": text(tds[0]), "org": text(tds[3]), "no": text(tds[1]),
                            "title": title, "url": f"https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq={link.group(2)}"})
            time.sleep(0.5)
    return out


def boards():
    out = []
    for town, mgr, menu in BOARDS:
        page = get(f"https://www.cheoingu.go.kr/home/boardList.do?brd_mgrno={mgr}&menu_no={menu}", ctx=LEGACY_TLS)
        for r in rows(page):
            tds = [text(t) for t in re.findall(r"<td.*?</td>", r, re.S)]
            no = re.search(r"fView\('(\d+)'", r)
            if len(tds) < 4 or not no:
                continue
            title = tds[1]
            if "특별공급" in title and not re.search("이동|남사", title):
                continue
            out.append({"src": f"{town} 소식", "date": tds[3].replace(".", "-"), "org": f"처인구 {town}", "no": "",
                        "title": title,
                        "url": f"https://www.cheoingu.go.kr/home/boardView.do?brd_mgrno={mgr}&menu_no={menu}&brd_no={no.group(1)}"})
        time.sleep(0.5)
    return out


def lh():
    out, lh_cut = [], (datetime.now(KST) - timedelta(days=730)).strftime("%Y-%m-%d")
    for src, act, mid, bid in LH_BOARDS:
        # 게시판은 쪽당 10건만 준다 → '용인' 검색 결과를 3쪽까지 읽는다(2025-06 국가산단 보상계획 공고가 2쪽에 있었다)
        page = "".join(get(f"https://www.lh.or.kr/{act}.es?mid={mid}&bid={bid}&act=list&nPage={n}&b_list=30"
                           f"&keyField=T&keyWord=%EC%9A%A9%EC%9D%B8") for n in (1, 2, 3))
        page += "".join(get(f"https://www.lh.or.kr/{act}.es?mid={mid}&bid={bid}&act=list&nPage=1&b_list=30&keyField=T&keyWord={kw}")
                        for kw in LH_EXTRA_KW.get(src, []))
        if act == "board":
            for r in rows(page):
                m = re.search(r"goView3\('(\d+)'", r)
                title = text((re.search(r'aria-label="제목">(.*?)</td>', r, re.S) or [None, ""])[1])
                title = re.sub(r"^새글\s+|\s+새글$", "", title)  # 게시판의 '새글' 표시가 제목에 섞여 온다(2026-10-16)
                date =text((re.search(r'aria-label="등록일">(.*?)</td>', r, re.S) or [None, ""])[1])
                org = text((re.search(r'aria-label="본ㆍ지사">(.*?)</td>', r, re.S) or [None, ""])[1])
                kind = text((re.search(r'aria-label="분류">(.*?)</td>', r, re.S) or [None, ""])[1])
                if kind and src == "LH 보상공고":
                    title = f"[{kind}] {title}"
                if m and (LH_KEEP.search(title) or (LH_KEEP_RECENT.search(title) and date >= lh_cut)):
                    out.append({"src": src, "date": date, "org": f"LH {org}".strip(), "no": "", "title": title,
                                "url": f"https://www.lh.or.kr/{act}.es?mid={mid}&bid={bid}&act=view&list_no={m.group(1)}"})
        else:
            for m in re.finditer(r'list_no=(\d+)[^"]*"[^>]*>.*?<strong class="title">(.*?)</strong>.*?(\d{4}-\d{2}-\d{2})', page, re.S):
                title = text(m.group(2))
                if LH_KEEP.search(title):
                    out.append({"src": src, "date": m.group(3), "org": "LH", "no": "", "title": title,
                                "url": f"https://www.lh.or.kr/{act}.es?mid={mid}&bid={bid}&act=view&list_no={m.group(1)}"})
        time.sleep(0.5)
    return out


def lh_apply():
    env = ROOT.parent / ".env"
    key = os.environ.get("DATA_GO_KR_KEY") or next((l.split("=", 1)[1].strip() for l in env.read_text(encoding="utf-8").splitlines()
                                                     if l.startswith("DATA_GO_KR_KEY=")), "")
    start = (datetime.now(KST) - timedelta(days=183)).strftime("%Y%m%d")
    end = datetime.now(KST).strftime("%Y%m%d")
    out, page = [], 1
    while True:
        q = {"serviceKey": key, "PG_SZ": 500, "PAGE": page, "CNP_CD": 41, "PAN_ST_DT": start, "PAN_ED_DT": end}
        data = json.loads(get("https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1?" + urllib.parse.urlencode(q)))
        lst = next((d["dsList"] for d in data if "dsList" in d), [])
        for x in lst:
            name = x.get("PAN_NM", "")
            if not re.search("용인|처인", name):
                continue
            if x.get("UPP_AIS_TP_NM") == "토지" and not re.search("이동|남사", name):
                continue
            out.append({"src": "LH 청약·임대", "date": x["PAN_NT_ST_DT"].replace(".", "-"),
                        "org": f"LH 청약플러스 · {x.get('AIS_TP_CD_NM', '')} · {x.get('PAN_SS', '')} · 마감 {x.get('CLSG_DT', '')}",
                        "no": "", "title": name, "url": x.get("DTL_URL_MOB") or x.get("DTL_URL")})
        total = int(lst[0]["ALL_CNT"]) if lst else 0
        if page * 500 >= total or not lst:
            return out
        page += 1


# 용인시·처인구 소식 거르기(2026-10-16 최근 한 달 치 제목 230건으로 맞춤)
TOWN = re.compile(r"이동읍|남사|반도체\s?(?:국가)?산단|반도체\s?클러스터|국가산단|국가산업단지|송전|이원선|용인이동|45호선")
CHEOIN = re.compile(r"처인")  # 처인구 글은 동네에 가깝지만 구청장·시장 동정은 거른다
ELSEWHERE = re.compile(r"수지|기흥|동백|구성동|풍덕천|신갈|보정동|상현|죽전|마북|영덕|서농|역북|유림|중앙동|삼가동|동부동|양지|포곡|모현|원삼|백암"
                       r"|에버랜드|심곡|광교|역삼")
NOT_FOR_RESIDENTS = re.compile(r"기탁|기부|성금|성품|수상|표창|감사패|면담|간담회|협약|MOU|참석|방문|격려|선정돼|우수기관|최우수|평가|취임|선포|결의"
                               r"|촉구|요청|건의|토론회|양저우|자매|우호|환영")
OFFICE_ONLY = re.compile(r"공시|사업주|업무추진비|입찰|회계감사|공용차량|용인시보|이용현황|현황\(|결과\s?발표|합격자|채용|서류전형|면접|계약|재정공시"
                         r"|의료기관|안전관리책임자|종사자|당첨자"  # 보건소 글 중 병원·업소 대상 안내, 행사 당첨자(10-16)
                         r"|정보공개|행정예고|주요행사계획|시험 시행|임용|접수마감|신청 마감")
# 보도자료는 주민이 할 일이 있는 글만: 신청·참여·접종·조심할 것·행사 안내. 끝난 행사 후기·실적·교류는 뺀다
LIFE = re.compile(r"모집|신청|접수|접종|무료|지원|지급|할인|쿠폰|지역화폐|상품권|안내|당부|주의|시행|운영|개최|대책|상황실|공모|설문|개통|변경|연장"
                  r"|감면|환급|교육|검진|체험|축제|야시장|페스티벌|행사|투표")
FLUFF = re.compile(r"성황|마무리|열려|열어|이어져|실적|메달|환호|선보여|위촉|보고회|조직개편|교류|협력|구축|성과|한마음|나눔|온정|기원|새 단장|발굴"
                   r"|과제발표회|위원회.{0,3}개최|성료|기념행사|지정|법제화|강화|증명|참가")
YONGIN = "https://www.yongin.go.kr/user/bbs/"


def city_scope(title, press):
    """남길 글이면 'town'/'city', 뺄 글이면 None."""
    if TOWN.search(title):
        return "town"
    if OFFICE_ONLY.search(title) or NOT_FOR_RESIDENTS.search(title) or title.startswith("이상일"):
        return None
    if CHEOIN.search(title):
        return "town"
    if ELSEWHERE.search(title) or (press and (FLUFF.search(title) or not LIFE.search(title))):
        return None
    return "city"


def yongin_press():
    out, cutoff = [], (datetime.now(KST) - timedelta(days=30)).strftime("%Y%m%d")
    for p in (1, 2, 3, 4):  # 쪽당 50건, 한 달이면 3쪽 안팎
        page = get(f"{YONGIN}BD_selectBbsList.do?q_bbsCode=1020&q_rowPerPage=50&q_currPage={p}", ctx=LEGACY_TLS)
        for m in re.finditer(r'<dt class="btitle">.*?q_bbscttSn=(\d+)[^>]*>(.*?)</a>', page, re.S):
            sn, title = m.group(1), text(m.group(2))
            if sn[:8] < cutoff:
                return out
            scope = city_scope(title, press=True)
            if scope:
                out.append({"src": "용인시 보도자료", "date": f"{sn[:4]}-{sn[4:6]}-{sn[6:8]}", "org": "용인특례시", "no": "",
                            "title": title, "scope": scope, "url": f"{YONGIN}BD_selectBbs.do?q_bbsCode=1020&q_bbscttSn={sn}"})
        time.sleep(0.5)
    return out


def yongin_notice():
    out = []
    page = get(f"{YONGIN}BD_selectBbsList.do?q_bbsCode=1001&q_clCode=1&q_rowPerPage=50", ctx=LEGACY_TLS)
    for r in rows(page):
        # 링크는 목록에 있는 그대로 쓴다 — 농촌테마파크 글은 다른 게시판(q_bbsCode=1259)이라 1001로 만들면 "데이터 없음"(10-16 검증)
        a = re.search(r'<a href="([^"]*q_bbscttSn=\d+[^"]*)">(.*?)</a>', r, re.S)
        tds = [text(t) for t in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if not a or len(tds) < 6:
            continue
        title = text(a.group(2))
        scope = city_scope(title, press=False)
        if scope:
            out.append({"src": "용인시 공지", "date": tds[5].replace(".", "-"), "org": f"용인특례시 {tds[4]}".strip(), "no": "",
                        "title": title, "scope": scope, "url": urllib.parse.urljoin(YONGIN, html.unescape(a.group(1)))})
    # 농촌테마파크 '이번 주 주말 체험'처럼 숫자만 바뀌어 매주 오는 글은 가장 새것 하나만
    seen, uniq = set(), []
    for x in out:
        k = re.sub(r"[\d\s]", "", x["title"])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq


# 용인시보(2026-10-28 사용자 "보상 이주 청약 임대 공사 어디까지 공식발표 전부"): 용인시가 내는 고시·공고(수용재결신청서 열람공고·
# 재결서 공시송달·사업인정 의견청취 등)는 따로 게시판이 없고 시정소식의 '용인시보' 글 본문에 "- 용인시 공고 제2026-2858호 [제목]" 줄로만 나온다.
# 그 줄 가운데 이동·남사·국가산단 관련만 남긴다. 같은 시보에서 차수만 다른 공고(16~21차 등)는 한 건으로 묶는다.
# 열람·의견 제출 기간은 공고문(PDF)에만 있어 옮기지 않는다 → 읽기 창의 시보 본문·첨부에서 원문을 본다.
# 시보는 하루 1건쯤, 쪽당 50줄에 9일 치쯤. 한 번 나온 시보는 바뀌지 않으니 최근 14일만 다시 읽고 그보다 오래된 건 지난 결과를 그대로 둔다.
# 처음 채울 때·빠진 기간을 메울 때는 GAZETTE_DAYS=120 python scripts/build_notices.py 처럼 늘려서 한 번 돌린다(2026-10-28 처음 채움)
GAZETTE_DAYS = int(os.environ.get("GAZETTE_DAYS", 14))
GAZETTE_LINE = re.compile(r"^-\s*(용인시[^\[]{0,30}?(?:고시|공고) 제(\d{4}-\d+)호)\s*\[(.+)\]\s*$")
GAZETTE_COMP = re.compile(r"수용|재결|보상|사업인정|공시송달|토지\s?(?:등\s?)?취득")
GAZETTE_SKIP = re.compile(r"일반산업단지|일반산단|원삼|통삼|백암")  # SK 일반산단(원삼)은 범위 밖(결정 로그 Q3)
GAZETTE_ROUND = re.compile(r"\s*,?\s*(\d+(?:~\d+)?)\s*(?:회차|차)|\s*,?\s*\d{2}(?:수용|경정|이의)\d{4}")


def yongin_gazette():
    out, cutoff = [], (datetime.now(KST) - timedelta(days=GAZETTE_DAYS)).strftime("%Y%m%d")
    try:
        prev = json.loads(OUT.read_text(encoding="utf-8"))["items"]
    except Exception:
        prev = []
    sibo, done = [], False
    for p in range(1, 61):  # 날짜가 cutoff보다 오래되면 멈춘다(쪽당 1주일 남짓 — 처음 채울 때 200일이면 30쪽쯤)
        lst = f"{YONGIN}BD_selectBbsList.do?q_bbsCode=1001&q_rowPerPage=50&q_currPage={p}"
        try:
            page = get(lst, ctx=LEGACY_TLS)
        except Exception:  # 목록도 해외 서버에서 가끔 느리다 → 한 번 더
            time.sleep(5)
            page = get(lst, ctx=LEGACY_TLS)
        for r in rows(page):
            m = re.search(r'q_bbscttSn=(\d+)[^"]*"[^>]*>(용인시보[^<]*)</a>', r)
            if not m:
                continue
            if m.group(1)[:8] < cutoff:
                done = True
                break
            sibo.append((m.group(1), text(m.group(2))))
        if done:
            break
        time.sleep(0.5)
    # GitHub(해외) 서버에서는 시청 서버가 가끔 30초 안에 답을 못 한다(10-28 첫 실행에서 timeout) → 글마다 두 번까지 다시 묻고,
    # 그래도 안 되면 그 시보만 지난 결과를 쓴다. 전부 안 되면 출처 실패(main이 지난 결과 전체 유지 + 실패 메일)
    missed = []
    for sn, name in sibo:
        url = f"{YONGIN}BD_selectBbs.do?q_bbsCode=1001&q_bbscttSn={sn}"
        for attempt in range(3):
            try:
                body = body_yongin(get(url, ctx=LEGACY_TLS), url)["text"]
                break
            except Exception as e:
                err = e
                time.sleep(5)
        else:
            missed.append(sn)
            print(f"  용인시보 {name[:16]} 못 받음({err}) → 지난 결과", file=sys.stderr)
            out += [x for x in prev if x.get("src") == "용인시 고시·공고" and x["url"].startswith(url + "#")]
            continue
        groups = {}
        for line in body.split("\n"):
            g = GAZETTE_LINE.match(line.strip())
            if not g or not TOWN.search(g.group(3)) or (GAZETTE_SKIP.search(g.group(3)) and not re.search("이동|남사", g.group(3))):
                continue
            title = g.group(3)
            base = re.sub(r"\(\s*\)|\[\s*\]", "", re.sub(r"\s*,\s*(?=[\])])", "", GAZETTE_ROUND.sub("", title)))  # 차수를 떼고 남는 빈 괄호도 지운다
            groups.setdefault(base, []).append((g.group(1), g.group(2), title))
        num = re.search(r"제(\d{4}-\d+)호", name)
        for base, got in groups.items():
            rounds = [r for _, _, t in got for r in re.findall(r"(\d+(?:~\d+)?)\s*(?:회차|차)\b", t)]
            title = got[0][2] if len(got) == 1 else f"{base} {'·'.join(rounds)}차 ({len(got)}건)" if rounds else f"{base} ({len(got)}건)"
            no = got[0][0] if len(got) == 1 else f"{got[0][0]} 외 {len(got) - 1}건"
            # 주소 끝 #공고번호: 같은 시보에서 나온 두 건이 같은 키(notices.html key())를 갖지 않게. 서버는 # 뒤를 보지 않는다
            out.append({"src": "용인시 고시·공고", "date": f"{sn[:4]}-{sn[4:6]}-{sn[6:8]}",
                        "org": f"용인특례시 · 용인시보 제{num.group(1)}호" if num else "용인특례시 · 용인시보", "no": no,
                        "title": title, "scope": "town", "cat": "comp" if GAZETTE_COMP.search(base) else "gosi",
                        "nos": [re.sub(r"\s", "", n) for n, _, _ in got], "url": f"{url}#{got[0][1]}"})
        time.sleep(0.3)
    if sibo and len(missed) == len(sibo):
        raise RuntimeError(f"시보 {len(sibo)}건 모두 못 받음: {err}")
    cut = f"{cutoff[:4]}-{cutoff[4:6]}-{cutoff[6:8]}"
    return out + [x for x in prev if x.get("src") == "용인시 고시·공고" and x.get("via") != "새올" and x["date"] < cut]


# 용인시 새올 고시공고(2026-10-29, 조사 기획/조사-빠진-공식출처-2026-10-28.md 1위): 용인시·처인구 고시·공고의 원래 게시판.
# 시보보다 하루 빠르고, 시보에 안 실리는 공고도 있고, 목록의 '게재기간' 끝 날짜가 열람·의견 제출 마감이다 → until로 화면에 보인다.
# 게재기간이 끝난 공고는 목록에서 사라진다 → 한 번 받은 공고(parts)는 지난 결과에서 계속 들고 간다.
# 목록 제목은 40자쯤에서 잘리므로 제목 검색은 서버에 맡기고(EMINWON_Q), 처음 보는 공고만 상세에서 전체 제목을 받는다.
# 시보에서 온 같은 공고(공고번호가 같은 것)는 main에서 지운다. 검색 한 번에 10초쯤 걸린다(10-29 PC 실측).
EMINWON = "https://eminwon.yongin.go.kr/emwp/gov/mogaha/ntis/web/ofr/action/OfrAction.do"
EMINWON_Q = ["첨단시스템", "국가산업단지", "이동읍", "이동 소로", "이동(송전)", "이동2구역", "남사읍", "송전", "천리",
             "45호선", "82호선", "84호선", "용인이동", "공공주택지구"]
EMINWON_AREA = re.compile(r"이동읍|남사읍|이동\s?소로|이동\(송전\)|이동2구역|(?<!삼)천리|송전(?!선로|탑)|45호선|82호선|84호선|용인이동")
EMINWON_NOISE = re.compile(r"이동제한|이동식|남사관리소|평가위원|선정결과|삼천리")
# '송전'은 송전리·송전지구이기도 하고 전력 송전선로이기도 하다(10-29 첫 실행: 고림분기·고덕-서안성 송전선로가 걸림)
# → 송전선로·철탑은 이동·남사·국가산단 말이 함께 있을 때만(국가산단 지구외송전선로 이설은 남는다)
EMINWON_POWER = re.compile(r"송전선로|송전탑|철탑")
EMINWON_DAYS = 365  # 게재기간 없는 고시는 몇 년 치가 목록에 남아 있다 → 1년 안 공고와 아직 기간이 남은 공고만


def eminwon_keep(title):
    if EMINWON_NOISE.search(title) or (GAZETTE_SKIP.search(title) and not re.search("이동|남사", title)):
        return False
    if EMINWON_POWER.search(title):
        return bool(re.search(r"이동읍|남사|국가산업단지|국가산단|반도체", title))
    return bool(EMINWON_AREA.search(title) or TOWN.search(title.replace("송전선로", "")))


def eminwon_url(**kw):
    base = {"jndinm": "OfrNotAncmtEJB", "context": "NTIS", "homepage_pbs_yn": "Y", "subCheck": "Y", "not_ancmt_se_code": "01,04"}
    return EMINWON + "?" + urllib.parse.urlencode({**base, **kw})


def eminwon_detail_url(mgt):
    return eminwon_url(method="selectOfrNotAncmt", methodnm="selectOfrNotAncmtRegst", not_ancmt_mgt_no=mgt)


def get_twice(url):
    try:
        return get(url)
    except Exception:
        time.sleep(5)
        return get(url)


EMINWON_SKIP = set()  # 상세를 보고 거른 공고 관리번호 — main이 notices.json 'eminwon_skip'에 적어 다음 실행에 다시 안 받는다


def yongin_eminwon():
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        old = {}
    prev = old.get("items", [])
    EMINWON_SKIP.update(old.get("eminwon_skip", []))
    parts = {p["mgt"]: p for x in prev if x.get("via") == "새올" for p in x.get("parts", [])}
    found, fails = {}, []
    for q in EMINWON_Q:
        try:
            page = get_twice(eminwon_url(method="selectListOfrNotAncmt", methodnm="selectListOfrNotAncmtHomepage",
                                         not_ancmt_sj=q, pageIndex=1, ofr_pageSize=50))
        except Exception as e:
            fails.append(f"{q}: {e}")
            continue
        for r in re.findall(r"<tr.*?</tr>", page, re.S):
            m = re.search(r"searchDetail\('(\d+)'\)", r)
            tds = [text(t) for t in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
            if m and len(tds) >= 6:
                found[m.group(1)] = {"no": tds[1], "dept": tds[3], "date": tds[4],
                                     "until": (re.search(r"~\s*(\d{4}-\d{2}-\d{2})", tds[5]) or [None, ""])[1]}
        time.sleep(0.3)
    if len(fails) == len(EMINWON_Q):
        raise RuntimeError("검색 모두 실패: " + fails[0])
    if fails:
        print(f"  새올 검색 {len(fails)}건 실패(다음 실행에 다시): {fails[0][:80]}", file=sys.stderr)
    for mgt, row in found.items():
        if mgt in parts:
            parts[mgt]["until"] = row["until"]
            continue
        if mgt in EMINWON_SKIP:
            continue
        try:
            page = get_twice(eminwon_detail_url(mgt))
        except Exception as e:
            print(f"  새올 {row['no']} 상세 못 받음({e}) → 다음 실행에", file=sys.stderr)
            continue
        parts[mgt] = {"mgt": mgt, "title": text((re.search(r"<h3[^>]*>(.*?)</h3>", page, re.S) or [None, ""])[1]), **row}
        time.sleep(0.3)
    # 거르기는 들고 있는 공고 전부에 매번 다시 한다(규칙을 고치면 지난 공고에도 바로 적용). 거른 공고는 다음부터 상세를 안 받는다
    old_cut, today = (datetime.now(KST) - timedelta(days=EMINWON_DAYS)).strftime("%Y-%m-%d"), datetime.now(KST).strftime("%Y-%m-%d")
    for mgt, p in list(parts.items()):
        if not eminwon_keep(p["title"]) or (p["date"] < old_cut and p.get("until", "") < today):
            EMINWON_SKIP.add(mgt)
            del parts[mgt]
    # 차수만 다른 같은 날 공고는 한 건으로(시보와 같은 규칙)
    groups = {}
    for p in sorted(parts.values(), key=lambda p: p["no"]):
        base = re.sub(r"\(\s*\)|\[\s*\]", "", re.sub(r"\s*,\s*(?=[\])])", "", GAZETTE_ROUND.sub("", p["title"])))
        groups.setdefault((p["date"], base), []).append(p)
    out = []
    for (date, base), got in groups.items():
        rounds = [r for p in got for r in re.findall(r"(\d+(?:~\d+)?)\s*(?:회차|차)\b", p["title"])]
        title = got[0]["title"] if len(got) == 1 else f"{base} {'·'.join(rounds)}차 ({len(got)}건)" if rounds else f"{base} ({len(got)}건)"
        out.append({"src": "용인시 고시·공고", "via": "새올", "date": date, "org": f"용인특례시 {got[0]['dept']}".strip(),
                    "no": got[0]["no"] if len(got) == 1 else f"{got[0]['no']} 외 {len(got) - 1}건", "title": title, "scope": "town",
                    "cat": "comp" if GAZETTE_COMP.search(base) else "gosi", "until": max(p["until"] for p in got),
                    "nos": [re.sub(r"\s", "", p["no"]) for p in got], "parts": got, "url": eminwon_detail_url(got[0]["mgt"])})
    return out


def cheoin_promo():
    """처인구청 '처인 홍보관': 읍면동·구청 과가 올린다. 작성자가 이동읍·남사읍이거나 구청 과인 글만(다른 동·면 글은 뺀다)."""
    out = []
    page = get("https://www.cheoingu.go.kr/home/promotionList.do?brd_mgrno=366&menu_no=1683", ctx=LEGACY_TLS)
    for m in re.finditer(r"<dt><a href=\"javascript:fView\('(\d+)'\)\">(.*?)</a></dt>.*?작성자 :\s*(.*?)</li>.*?작성일 :\s*([\d.]+)", page, re.S):
        title, writer = text(m.group(2)), text(m.group(3))
        if not (writer in ("이동읍", "남사읍") or (writer.endswith("과") and not NOT_FOR_RESIDENTS.search(title))):
            continue
        out.append({"src": "처인구 소식", "date": m.group(4).replace(".", "-"), "org": f"처인구 {writer}", "no": "", "title": title,
                    "scope": "town", "url": f"https://www.cheoingu.go.kr/home/promotionView.do?brd_no={m.group(1)}&brd_mgrno=366&menu_no=1683"})
    return out


CITY_SRCS = {"용인시 보도자료", "용인시 공지", "처인구 소식"}

# ── 본문(2026-10-16 사용자 "링크로 연결되면 뒤로가기가 아니고 다시 페이지로 돌아와야 돼서 불편해 … 바로 볼수있게") ──
# 글을 누르면 이남노트 안 읽기 창에서 본문을 보여 준다 → data/notice_bodies.json(url → 본문). 이미 받은 글은 다시 받지 않는다.
# 옮겨 써도 되는 근거: 용인시·처인구 = 지자체 업무상 저작물(저작권법 24조의2, 용인시는 글마다 공공누리 제1유형 표시),
# 토지이음 고시·공고 = 보호받지 않는 저작물(7조). LH(공공기관)는 본문이 "첨부파일을 확인하라"는 한 줄뿐이라 첨부 이름·LH 바로보기 링크만 둔다.
# LH 청약플러스는 화면을 스크립트로 그려 본문을 못 읽는다 → 받지 않고 원문 링크만.
BODIES = DATA / "notice_bodies.json"
DOC_EXT = re.compile(r"\.(?:hwpx?|pdf|xlsx?|docx?|zip|pptx?)\s*$", re.I)


def body_text(seg):
    seg = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", "", seg, flags=re.S | re.I)
    seg = re.sub(r"\s+", " ", seg)  # 소스의 줄바꿈은 화면에서 띄어쓰기일 뿐 — 줄은 <br>·<p>로만 나눈다
    # 표: 칸 안의 줄바꿈은 띄어쓰기로, 칸 사이는 ' · '로 → 표의 한 행이 한 줄이 된다
    seg = re.sub(r"<t([dh])\b[^>]*>(.*?)</t\1>",
                 lambda m: re.sub(r"<br\s*/?>|</p>|</div>", " ", m.group(2), flags=re.I) + " · ", seg, flags=re.S | re.I)
    seg = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</tr>|</h\d>", "\n", seg, flags=re.I)
    seg = re.sub(r"<[^>]*$", "", seg)  # 끝에 닫히지 않은 태그 조각이 글자로 남지 않게(10-16 검증)
    s = html.unescape(re.sub(r"<[^>]+>", "", seg)).replace("\xa0", " ")
    s = re.sub("[\\x00\\u200b\\ufeff]", "", s)  # 토지이음 본문 끝에 NUL 문자가 줄줄이 붙어 온다
    lines = [re.sub(r"[ \t\r\f\v]+", " ", l).strip().removesuffix("·").strip() for l in s.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


IMG_DIR = DATA / "notice_img"  # 본문에 data: 로 박힌 그림(400KB가 넘기도 한다)을 파일로 빼 둔다
IMG_EXT = re.compile(r"\.(?:jpe?g|png|gif|webp)\s*$", re.I)


def imgs_in(seg, base):
    out = []
    for src in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', seg, re.I):
        if "kogl" in src:
            continue
        m = re.match(r"data:image/(png|jpe?g|gif|webp);base64,(.+)", src, re.S)
        if m:  # 일정표·안내 그림이 이렇게 박혀 있다(10-16 검증: Town-MICE 일정표, 불법현수막 안내)
            raw = base64.b64decode(re.sub(r"\s+", "", m.group(2)))
            name = f"{hashlib.sha1(raw).hexdigest()[:16]}.{m.group(1).replace('jpeg', 'jpg')}"
            IMG_DIR.mkdir(exist_ok=True)
            (IMG_DIR / name).write_bytes(raw)
            out.append(f"data/notice_img/{name}")
        elif not src.startswith("data:"):
            out.append(urllib.parse.urljoin(base, html.unescape(src)))
    return out


def split_files(files, imgs):
    """문서 첨부만 첨부 칸에. 본문에 그림이 하나도 없으면 그림 첨부(포스터 등)를 그림으로 보여 준다."""
    docs = [f for f in files if DOC_EXT.search(f["name"])]
    if not imgs:
        imgs = [f["url"] for f in files if IMG_EXT.search(f["name"])]
    return docs, imgs


def body_yongin(page, url):
    seg = page[page.find('class="tview_desc"'):]
    seg = seg[seg.find(">") + 1:]
    # 본문 끝 = 공공누리 안내 칸이 시작하는 곳. 본문 중간의 hwpEditorBoardContent 칸에서 자르면 뒤가 사라진다(10-16 검증)
    end = re.search(r'<div class="col-sm-10">|<img[^>]+(?:opentype|codetype)|본 저작물은', seg)
    seg = seg[:end.start()] if end else seg[:seg.find("</td>")]
    txt = seg[seg.find('<div class="txt">'):] if '<div class="txt">' in seg else seg
    files = [{"name": text(n), "url": urllib.parse.urljoin(url, html.unescape(h))}
             for h, n in re.findall(r'<a href="(/component/file/ND_fileDownload[^"]+)"[^>]*>(.*?)</a>', page, re.S)]
    # 첨부마다 있는 '바로보기'(시청 문서 뷰어, hwp도 웹 화면으로 바꿔 준다) — 휴대폰엔 한글 뷰어가 없어 내려받으면 안 열린다(10-16 사용자)
    views = {re.search(r"[?&]id=([^&]+)", v).group(1): v for v in
             (html.unescape(v) for v in re.findall(r"window\.open\('(https://www\.yongin\.go\.kr/home/preview\.jsp\?[^']+)'", page))
             if "initTTS" not in v and re.search(r"[?&]id=", v)}
    for f in files:
        fid = re.search(r"q_fileId=([^&]+)", f["url"])
        if fid and fid.group(1) in views:
            f["view"] = views[fid.group(1)]
    docs, imgs = split_files(files, imgs_in(seg, url))
    return {"text": body_text(txt), "imgs": imgs, "files": docs, "license": "용인특례시 · 공공누리 제1유형(출처표시)"}


def hwpx_text(raw):
    """hwpx(압축된 XML)에서 글자만 뽑는다. 문단(<hp:p>)마다 한 줄, 표 칸도 문단이라 한 줄씩."""
    import io, zipfile
    out = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)):
            xml = z.read(name).decode("utf-8", "replace")
            for p in re.findall(r"<hp:p\b.*?</hp:p>", xml, re.S):
                line = html.unescape("".join(re.findall(r"<hp:t\b[^>]*>(.*?)</hp:t>", p, re.S)))
                line = re.sub(r"<[^>]+>", "", line).strip()
                # 한컴 글꼴 전용 기호(동그라미 숫자 등)는 휴대폰에서 네모로 깨진다 → '•'
                line = re.sub("[\\ue000-\\uf8ff\\U000f0000-\\U000ffffd]", "•", line)
                if line and (not out or out[-1] != line):
                    out.append(line)
    return "\n".join(out)[:20000]


def body_cheoingu(page, url):
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)  # 첨부 이름 앞 주석('<!-- <img …> -->')이 이름에 섞이지 않게
    # 본문 안에 표가 있으면 첫 </td>에서 멈춘다 → 본문 칸부터 '이전글' 칸 앞까지(10-16 검증: 남사읍 글 본문이 통째로 비었다)
    # 끝은 '이전글'(처인 홍보관)·'목록' 버튼·담당부서 칸 중 먼저 나오는 곳 — 읍 소식 게시판엔 '이전글' 칸이 없어
    # 그것만 보면 사이트 바닥글(주소·Copyright)까지 들어온다(10-16 화면에서 발견)
    start = page.find('<td class="t_con"')
    ends = [i for i in (page.find(k, start) for k in ('<div class="board_bottom"', '<div class="btn"', '<div class="charge_box"')) if i > start]
    seg = page[start:min(ends)] if start >= 0 and ends else ""
    seg = seg[seg.find(">") + 1:]
    files = [{"name": text(n), "url": f"https://www.cheoingu.go.kr/common/download.do?file_no={no}"}
             for no, n in re.findall(r"download\('(\d+)'\)\">(.*?)</a>", page, re.S)]
    docs, imgs = split_files(files, imgs_in(seg, url))
    # 처인구청은 문서 뷰어가 없다 → hwpx 첨부는 글자를 뽑아 읽기 창에서 펼쳐 보이게(10-16 사용자 "hwp는 안 열리는데")
    for f in docs:
        if f["name"].lower().endswith(".hwpx"):
            try:
                with urllib.request.urlopen(urllib.request.Request(f["url"], headers=UA), timeout=60, context=LEGACY_TLS) as r:
                    f["text"] = hwpx_text(r.read(20_000_000))
            except Exception as e:
                print(f"  hwpx 글자 뽑기 실패 {f['name']}: {e}", file=sys.stderr)
    return {"text": body_text(seg), "imgs": imgs, "files": docs, "license": "용인특례시 처인구청"}


def body_lh(page, url):
    art = page[page.find('<article class="board_view"'):]
    art = art[:art.find("</article>")]
    c = re.search(r'<div class="contents">(.*?)<div class="file">', art, re.S)
    t = body_text(c.group(1)) if c and "<iframe" not in c.group(1) else ""
    files = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", art[art.find('<div class="file">'):], re.S):
        name = text(li.split('<span class="txt">')[0])
        prev = re.search(r'class="btn_line attachPreview" href="([^"]+)"', li)
        if name:
            files.append({"name": name, "url": urllib.parse.urljoin(url, html.unescape(prev.group(1))) if prev else ""})
    return {"text": t, "imgs": [], "files": files, "license": "한국토지주택공사(LH)"}


def body_eum(page, url):
    # 안쪽 빈 <div>에서 멈추지 않게 '컨텐츠 내용' 끝 주석까지(10-16 검증: 문장·고시일이 빠졌다)
    m = re.search(r'<div class="edit_view">(.*?)(?:<!--\s*컨텐츠 내용\s*//\s*-->|$)', page, re.S)
    info = []
    for k in ("고시번호", "담당기관", "고시일", "문의처", "열람장소"):
        v = re.search(rf">{k}</th>\s*<td[^>]*>(.*?)</td>", page, re.S)
        if v and text(v.group(1)):
            info.append([k, text(v.group(1))])
    files = [{"name": re.sub(r"\s*\([\d,.]+\s*KByte\)\s*$", "", text(n)), "url": ""}
             for n in re.findall(r"<a class=\"link[^\"]*\" href=\"javascript:download\(.*?\)\">(.*?)</a>", page, re.S)]
    return {"text": body_text(m.group(1)) if m else "", "imgs": [], "files": files, "info": info,
            "license": "토지이음(국토교통부) 고시정보 · 고시·공고는 저작권 보호 대상이 아님(저작권법 7조)"}


def body_eminwon(page, url):
    """새올 고시공고 상세(2026-10-29): <dl><dt>칸 이름</dt><dd>값</dd></dl> 줄 + 본문 div.viewTxt + goDownLoad('이름','저장 이름','경로') 첨부."""
    page = re.sub(r"<script.*?</script>|<!--.*?-->", "", page, flags=re.S)
    info = [[text(k), text(v)] for k, v in re.findall(r"<dt>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", page, re.S)
            if text(k) in ("고시공고번호", "등록일", "담당부서", "담당자/연락처") and text(v)]
    m = re.search(r'<div class="viewTxt">(.*?)</div>\s*</div>', page, re.S)
    files = [{"name": html.unescape(n), "url": "https://eminwon.yongin.go.kr/emwp/jsp/ofr/FileDown.jsp?" + urllib.parse.urlencode(
              {"user_file_nm": html.unescape(n), "sys_file_nm": html.unescape(s), "file_path": html.unescape(p)})}
             for n, s, p in re.findall(r"goDownLoad\('([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\)", page)]
    return {"text": body_text(m.group(1)) if m else "", "imgs": [], "files": files, "info": info,
            "license": "용인특례시 고시·공고(새올) · 고시·공고는 저작권 보호 대상이 아님(저작권법 7조)"}


# 받는 방식을 바꾸면 올린다 → 이미 받은 글도 다음 실행에 다시 받는다(2: 용인 바로보기 주소·처인구 hwpx 글자, 10-16)
BODY_VERSION = 2
BODY_RULES = [("www.yongin.go.kr", body_yongin, "utf-8"), ("www.cheoingu.go.kr", body_cheoingu, "utf-8"),
              ("www.lh.or.kr", body_lh, "utf-8"), ("www.eum.go.kr", body_eum, "cp949"),
              ("eminwon.yongin.go.kr", body_eminwon, "utf-8")]


def bodies(items):
    """새 글만 본문을 받는다. 지금 목록에 없는 글의 본문은 지운다. 실패한 글은 다음 실행 때 다시 시도한다."""
    try:
        old = json.loads(BODIES.read_text(encoding="utf-8"))
    except Exception:
        old = {}
    out, got, fail = {}, 0, []
    for x in items:
        u = x["url"]
        if u in old and old[u].get("v", 1) >= BODY_VERSION:
            out[u] = old[u]
            continue
        rule = next((r for r in BODY_RULES if urllib.parse.urlsplit(u).netloc == r[0]), None)
        if not rule:
            continue
        try:
            ctx = LEGACY_TLS if rule[0] in ("www.yongin.go.kr", "www.cheoingu.go.kr") else None
            b = rule[1](get(u, rule[2], ctx=ctx), u)
            b["at"], b["v"] = datetime.now(KST).strftime("%Y-%m-%d"), BODY_VERSION
            out[u] = b
            got += 1
            time.sleep(0.3)
        except Exception as e:
            fail.append(f"{x['src']} {u[-40:]}: {e}"[:160])
    BODIES.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    # 목록에서 빠진 글의 그림 파일도 지운다
    used = {Path(i).name for b in out.values() for i in b.get("imgs", []) if i.startswith("data/notice_img/")}
    for f in IMG_DIR.glob("*") if IMG_DIR.exists() else []:
        if f.name not in used:
            f.unlink()
    print(f"본문: 새로 {got}건, 모두 {len(out)}건, 실패 {len(fail)}건")
    return fail


def main():
    # 한 곳이 막히면 그곳은 지난번 결과를 그대로 둔다(자동 실행에서 잠깐 실패할 때마다 소식이 사라지지 않게, 2026-10-14)
    try:
        prev = json.loads(OUT.read_text(encoding="utf-8"))["items"]
    except Exception:
        prev = []
    items, errors = [], []
    for name, fn, srcs in (("토지이음", eum, {"토지이음 고시"}), ("처인구 게시판", boards, {"이동읍 소식", "남사읍 소식"}),
                           ("LH", lh, {s for s, *_ in LH_BOARDS}), ("LH 청약플러스", lh_apply, {"LH 청약·임대"}),
                           ("용인시 보도자료", yongin_press, {"용인시 보도자료"}), ("용인시 공지", yongin_notice, {"용인시 공지"}),
                           ("처인 홍보관", cheoin_promo, {"처인구 소식"}),
                           # 시보와 새올은 src가 같다('용인시 고시·공고') → 지난 결과는 via로 가른다
                           ("용인시보 고시·공고", yongin_gazette, lambda x: x.get("src") == "용인시 고시·공고" and x.get("via") != "새올"),
                           ("새올 고시·공고", yongin_eminwon, lambda x: x.get("via") == "새올")):
        try:
            got = fn()
            print(f"{name}: {len(got)}건")
            items += got
        except Exception as e:  # 한 곳이 막혀도 나머지는 만든다
            kept = [x for x in prev if (srcs(x) if callable(srcs) else x.get("src") in srcs)]
            items += kept
            errors.append(f"{name}: {e}")
            print(f"{name}: 실패 {e} → 지난 결과 {len(kept)}건 유지", file=sys.stderr)
    # 시보에서 온 공고가 새올에도 있으면(공고번호가 모두 같으면) 새올 쪽만 남긴다 — 새올에 마감일·전체 제목·첨부가 있다
    eminwon_nos = {n for x in items if x.get("via") == "새올" for n in x.get("nos", [])}
    # 10-28에 받은 지난 시보 글은 nos가 없다 → no 칸의 첫 공고번호로 견준다
    nos = lambda x: x.get("nos") or ([re.sub(r"\s|외\d+건$", "", x["no"])] if x.get("src") == "용인시 고시·공고" and x.get("no") else [])
    items = [x for x in items if x.get("via") == "새올" or not nos(x) or not set(nos(x)) <= eminwon_nos]
    # 같은 고시를 '용인시'와 '경기도 용인시'가 각각 올린 경우가 있다 → 날짜+제목(괄호 모양 무시)이 같으면 하나만
    uniq = {}
    for x in items:
        uniq.setdefault((x["date"], re.sub(r"[\[\]()（）\s]", "", x["title"])), x)
    items = sorted(uniq.values(), key=lambda x: x["date"], reverse=True)
    fail = bodies(items)
    if len(fail) > 5:  # 한두 건은 다음 실행에 다시 받는다. 많이 실패하면 사이트 구조가 바뀐 것 → 실패로 알린다
        errors.append(f"본문 {len(fail)}건 실패: " + " / ".join(fail[:3]))
    payload = {"updated_at": datetime.now(KST).isoformat(timespec="minutes"), "errors": errors, "items": items,
               "eminwon_skip": sorted(EMINWON_SKIP)}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    # 화면용 notices.js에는 다음 실행용 기록(eminwon_skip·parts)을 빼서 가볍게
    web = {**{k: v for k, v in payload.items() if k != "eminwon_skip"}, "items": [{k: v for k, v in x.items() if k != "parts"} for x in items]}
    OUT.with_suffix(".js").write_text("window.NOTICES = " + json.dumps(web, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"→ {OUT} ({len(items)}건)")
    # 한 곳이라도 실패하면 파일은 쓰되(지난 결과 유지) 실패로 끝낸다 → Actions 실패 메일. 하루 한두 번만 도니 메일이 많지 않다
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
