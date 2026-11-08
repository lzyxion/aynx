"""
**빌드 아이콘 생성기** — GPT 원본 PNG 에서 Tauri 아이콘 세트와 웹뷰 자산을 만든다.

    py scripts/gen-app-icon.py [원본 폴더]   # 기본: ~/Downloads/character

대표 아이콘은 설정 › 앱 아이콘의 기본 `gpt` 와 **같은 그림**이다(2026-10-22 내장 넷 교체 — 그 전은 Luna,
docs/log/2026-10-22-custom-app-icon.md). 원본(`gpt.png`, 1254px · 2MB)은 저장소에 넣지 않는다 —
캐릭터 아이콘(`scripts/gen-character-icons.py`)과 같은 규칙이다. 순서:

1. 원본에서 1024px 임시 마스터를 만든다 — `gen-character-icons.py` 의 `make_icon`(알파 곱한 축소 + 그 크기의
   둥근 사각 마스크)을 **그대로** 쓴다. 그래서 내장 · 사용자 아이콘과 같은 모양이다.
2. `npx tauri icon <마스터> -o src-tauri/icons` — ico·icns·png·Square*·StoreLogo 전부. 모바일
   폴더(`android`·`ios`)는 지운다(데스크톱 전용).
3. 웹뷰 자산: 시작 화면·스플래시 로고 `static/logo.png`(256px — 표시 96px × HiDPI 2x 위로 여유)와
   파비콘 `static/favicon.png`(= 방금 만든 `32x32.png` 바이트 그대로 — 작업 표시줄과 같은 그림).

검증: 결과의 모서리 알파가 0, 가운데가 255 인지 찍는다.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
STATIC = ROOT / "static"
SOURCE_NAME = "gpt.png"
MASTER_SIZE = 1024
WEB_LOGO_SIZE = 256


def load_character_module():
    spec = importlib.util.spec_from_file_location("gen_character_icons", ROOT / "scripts" / "gen-character-icons.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def report(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    print(f"  {path.relative_to(ROOT)}  {im.size}  alpha(0,0)={im.getpixel((0, 0))[3]} center={im.getpixel((w // 2, h // 2))[3]}")


def main() -> None:
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "character"
    chars = load_character_module()
    print(f"gpt ← {src_dir / SOURCE_NAME}")
    full = Image.open(src_dir / SOURCE_NAME).convert("RGBA")
    master = chars.make_icon(full, MASTER_SIZE)
    with tempfile.TemporaryDirectory() as tmp:
        master_path = Path(tmp) / "app-icon-master.png"
        master.save(master_path)
        npx = shutil.which("npx") or "npx"
        subprocess.run([npx, "tauri", "icon", str(master_path), "-o", str(ICONS)], check=True, cwd=ROOT)
    for mobile in ("android", "ios"):
        shutil.rmtree(ICONS / mobile, ignore_errors=True)
    chars.make_icon(full, WEB_LOGO_SIZE).save(STATIC / "logo.png", optimize=True)
    (STATIC / "favicon.png").write_bytes((ICONS / "32x32.png").read_bytes())
    for p in (ICONS / "icon.png", ICONS / "32x32.png", STATIC / "logo.png", STATIC / "favicon.png"):
        report(p)


if __name__ == "__main__":
    main()
