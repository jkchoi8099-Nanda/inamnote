"""용인 사장님·창업 지원사업 목록(data/programs.js)을 만든다. 혜택 화면(benefits.html) '용인 사장님·창업 지원사업' 칸이 읽는다.

출처 (2026-10-20 연결)
- 공모 레이더(D:\\공모 레이더, 매일 07:30 GongmoRadar_Daily)가 쓰는 out/local_programs.json.
  레이더가 중소벤처24 공고·행사 API(기업마당 공고 포함)와 K-Startup에서 모아 용인·경기 진행 중 항목만 내보낸 것.
  수집은 레이더 한 곳에서만 한다(API 호출 코드를 두 벌 두지 않는다). 이 스크립트는 동네 화면에 맞게 거르기만 한다.
- 남기는 것: 레이더가 '용인' 태그를 붙인 것(제목·대상·요약·기관에 용인·처인·이동읍·남사읍 등).
  경기도 전체 항목은 뺀다(10-20 실측 74건 중 다른 시 전용 32건, 나머지도 대부분 제조·수출·바이오 기업용이라 동네 주민 화면과 안 맞음).
  민간 업체(행정사·컨설팅·(주)) 모집글과 다른 시·도에서 여는 행사도 뺀다.
- 지원사업은 start~end가 접수 기간, 행사·교육은 start가 행사일·end가 신청 마감이다(레이더 src_smes_event).
  접수 중·마감은 화면이 그날 날짜로 판단한다(목록이 하루 묵어도 맞게).
- PROGRAMS_OUT: 다른 곳에 쓰고 싶을 때만(공개 전 미리보기 서버가 git 밖 사본을 갱신한다 — scripts/serve_preview.py).
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
SRC = Path(os.environ.get("RADAR_JSON") or ROOT.parents[1] / "공모 레이더" / "out" / "local_programs.json")
OUT = Path(os.environ.get("PROGRAMS_OUT") or ROOT / "data" / "programs.js")
STALE_DAYS = 3  # 레이더 결과가 이보다 오래되면 레이더가 멈춘 것 → 지난 결과를 그대로 둔다
PRIVATE = re.compile(r"\(주\)|㈜|주식회사|행정사|사무소|컨설팅")
ELSEWHERE = re.compile(r"서울|부산|대구|인천|광주광역|대전|울산|세종|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주")


def short(s: str, n: int) -> str:
    s = re.split(r"[☞※■▶◎●○□-]\s", s or "")[0]  # 첫 문장(취지)만. 뒤의 ☞ 대상·- 내용 줄은 원문에서 본다
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n].rstrip() + "…"


def main() -> int:
    try:
        d = json.loads(SRC.read_text(encoding="utf-8"))
        age = datetime.now() - datetime.fromisoformat(d["updated_at"])
        if age.days >= STALE_DAYS:
            raise RuntimeError(f"레이더 결과가 {age.days}일 묵음({d['updated_at']})")
    except Exception as e:
        print(f"실패: 공모 레이더 결과 못 읽음: {e} → 지난 결과 유지", file=sys.stderr)
        return 1
    items = []
    for x in d["items"]:
        org, area = x.get("org") or "", x.get("area") or ""
        if "yongin" not in x["tags"] or PRIVATE.search(org) or ELSEWHERE.search(area):
            continue
        items.append({
            "id": x["uid"],
            "kind": "교육·행사" if x["kind"] == "행사" else x["kind"],
            "name": re.sub(r"^\s*\[경기\]\s*", "", x["title"]),
            "sum": short(x.get("summary"), 90),
            "org": org,
            "start": x.get("start"),
            "end": x.get("end"),
            "url": x["url"],
        })
    payload = {"updated_at": d["updated_at"], "built_at": datetime.now(KST).isoformat(timespec="minutes"), "items": items}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.PROGRAMS = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"레이더 {len(d['items'])}건 중 용인 {len(items)}건 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
