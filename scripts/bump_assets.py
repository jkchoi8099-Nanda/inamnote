"""쪽(html)이 부르는 우리 CSS·JS 주소 뒤에 ?v=내용지문 을 붙인다(2026-10-29).

왜: GitHub Pages는 파일마다 10분 캐시(max-age=600)를 붙인다. 10-29 첫 화면을 고쳐 올렸더니
브라우저가 새 home.js + 옛 style.css를 섞어 써서 문 배치가 통째로 깨졌다(결정 로그 10-29 '사고').
주소에 파일 내용 지문을 붙이면 내용이 바뀐 파일만 주소가 바뀌어 새로 받는다.

- 지문 = git blob id 앞 8자리(줄바꿈 CRLF/LF와 상관없이 같은 값).
- data/는 뺀다(Actions가 30분마다 바꾸는 자료라 커밋마다 html이 바뀌게 된다). 외부 주소도 뺀다.
- JS 안에서 불러오는 파일(home.js의 loadScript("arrive.js") 등)은 건드리지 않는다.

쓰는 법(site/에서):
  python scripts/bump_assets.py           작업 폴더 html을 고친다
  python scripts/bump_assets.py --check   고칠 게 있으면 목록을 찍고 1로 끝난다(health_check용)
  python scripts/bump_assets.py --staged  커밋 직전 훅(.git/hooks/pre-commit): 커밋할 내용(index) 기준으로
                                          지문을 내고 index와 작업 폴더 html을 같이 고친다
"""
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
REF = re.compile(r'((?:href|src)=")((?!data/)[A-Za-z0-9_\-./]+\.(?:css|js))(?:\?v=[0-9A-Za-z]+)?(")')


def git(*args, data=None):
    r = subprocess.run(["git", *args], cwd=SITE, input=data, capture_output=True, check=True)
    return r.stdout


def staged_entries():
    """index의 {경로: (mode, blob id)}"""
    out = {}
    for line in git("ls-files", "-s", "-z").split(b"\0"):
        if not line:
            continue
        meta, path = line.split(b"\t", 1)
        mode, blob, _ = meta.split()
        out[path.decode("utf-8")] = (mode.decode(), blob.decode())
    return out


def rewrite(text, ver):
    def sub(m):
        v = ver(m.group(2))
        return m.group(0) if v is None else f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}"
    return REF.sub(sub, text)


def pages():
    return sorted(p.name for p in SITE.glob("*.html"))  # 쪽은 모두 site/ 바로 아래(scripts/og.html은 공유 그림 원본이라 뺀다)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    changed = []
    if mode == "--staged":
        idx = staged_entries()
        ver = lambda p: idx[p][1][:8] if p in idx else None
        for name in pages():
            if name in idx:  # 커밋할 내용
                old = git("show", f":{name}").decode("utf-8")
                new = rewrite(old, ver)
                if new != old:
                    blob = git("hash-object", "-w", "--stdin", data=new.encode("utf-8")).decode().strip()
                    git("update-index", "--cacheinfo", f"{idx[name][0]},{blob},{name}")
                    changed.append(name)
            f = SITE / name  # 작업 폴더도 같은 지문으로(안 그러면 다음 git status에 거꾸로 보인다)
            old = f.read_bytes().decode("utf-8")
            new = rewrite(old, ver)
            if new != old:
                f.write_bytes(new.encode("utf-8"))
    else:
        cache = {}

        def ver(p):
            if p not in cache:
                f = SITE / p
                cache[p] = git("hash-object", str(f)).decode().strip()[:8] if f.is_file() else None
            return cache[p]
        for name in pages():
            f = SITE / name
            old = f.read_bytes().decode("utf-8")
            new = rewrite(old, ver)
            if new != old:
                changed.append(name)
                if mode != "--check":
                    f.write_bytes(new.encode("utf-8"))
    if changed:
        what = "버전이 낡은 쪽" if mode == "--check" else "버전 올림"
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print(f"bump_assets: {what} {len(changed)}개 - {', '.join(changed)}")
    return 1 if mode == "--check" and changed else 0


if __name__ == "__main__":
    sys.exit(main())
