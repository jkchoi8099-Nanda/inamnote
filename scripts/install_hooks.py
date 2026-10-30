"""커밋 직전 훅(scripts/pre-commit)을 .git/hooks/pre-commit에 깐다(2026-10-30).

.git/hooks/는 git에 올라가지 않는다 — 새로 받은 저장소, 새 PC, 훅 원본을 고친 뒤에는 다시 돌린다.
훅이 하는 일: verify_site.py(자료 검사, 실패하면 커밋을 막음) → bump_assets.py --staged(CSS·JS ?v= 버전).

쓰는 법(site/에서):
  python scripts/install_hooks.py          깔기(덮어쓰기)
  python scripts/install_hooks.py --check  깔린 훅이 원본과 다르면(없거나 낡음) 1로 끝난다(health_check용)
"""
import shutil
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
SRC = SITE / "scripts" / "pre-commit"


def hook_path():
    # 작업 트리 위치와 상관없이 이 저장소의 hooks 폴더(core.hooksPath를 바꿨으면 그쪽)
    r = subprocess.run(["git", "rev-parse", "--git-path", "hooks/pre-commit"], cwd=SITE, capture_output=True, text=True, check=True)
    return (SITE / r.stdout.strip()).resolve()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    dst = hook_path()
    same = dst.is_file() and dst.read_bytes() == SRC.read_bytes()
    if "--check" in sys.argv:
        print(f"install_hooks: {'최신' if same else ('낡음' if dst.is_file() else '없음')} — {dst}")
        return 0 if same else 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC, dst)
    dst.chmod(0o755)
    print(f"install_hooks: {'이미 최신' if same else '깔았음'} — {SRC.name} → {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
