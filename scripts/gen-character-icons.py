"""
**캐릭터 앱 아이콘 생성기** — 설정 › 앱 테마 의 "앱 아이콘" 내장 후보 넷을 원본 PNG 에서 만든다.

    py scripts/gen-character-icons.py <원본 폴더>   # 기본: ~/Downloads/character

원본은 저장소에 넣지 않는다(장당 2MB, 1254px 정사각). 원본 폴더에는 아래 [`CHARACTERS`] 의 파일
이름 그대로 PNG 가 있어야 한다. 결과는 두 갈래다:

- `src-tauri/icons/characters/<id>.png` — 256px RGBA. Rust(`app_icon.rs`)가 `include_bytes!`
  로 바이너리에 담아 창·작업 표시줄 아이콘으로 건다.
- `src/lib/assets/app-icons/<id>.png` — 96px 썸네일(설정 화면, 표시 40px × HiDPI 2x).
  기본 `gpt` 는 빌드 아이콘과 같은 그림이다(빌드 아이콘은 `scripts/gen-app-icon.py` 가 이 파일의
  `make_icon` 으로 같은 원본에서 만든다).

## 모양 — 사용자 아이콘과 **같은 둥근 마스크** (2026-10-22, docs/log/2026-10-22-custom-app-icon.md)

원본은 그림이 가장자리까지 꽉 찬 정사각이다. 사용자가 넣는 아이콘(Rust `app_icon/user.rs`)과 같은 길로 만든다:
알파를 곱한 채 결과 크기로 줄이고(LANCZOS — 투명 화소의 RGB 가 경계로 번지지 않게), **그 크기에서** 둥근 사각
마스크를 곱한다 — 사방 [`INSET`] 안쪽 · 반경 [`RADIUS`](256px 기준 — 다른 크기는 비례), 한 화소를 [`SUB`]×[`SUB`]
점으로 나눠 덮인 비율을 알파로(Rust `mask` 와 같은 표본 · 같은 반올림). 원본 해상도가 아니라 결과 크기에서 거는 것은
Rust 가 256px 로 줄인 뒤 마스크를 거는 순서와 맞추려는 것이다 — 그래야 내장과 사용자 아이콘의 경계 알파가 같다.
값을 바꾸면 `app_icon/user.rs` 의 `INSET` · `RADIUS` · `SUB` 와 `src/lib/app-icon-crop.ts` 의 `PREVIEW_CLIP` 도 함께.

검증: 결과의 모서리 알파(0)와 가운데 알파(255)를 출력한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_ICONS = ROOT / "src-tauri" / "icons" / "characters"
OUT_THUMBS = ROOT / "src" / "lib" / "assets" / "app-icons"

#: id → 원본 파일 이름. id 는 `settings.toml` 의 `[app] app_icon` 값이다 — 바꾸지 않는다.
CHARACTERS = {
    "claude": "claude.png",
    "gemini": "gemini.png",
    "gpt": "gpt.png",
    "grok": "grok.png",
}

ICON_SIZE = 256
THUMB_SIZE = 96
#: 둥근 사각 — 256px 기준 안쪽 여백 · 모서리 반경, 경계 표본 수(Rust `app_icon/user.rs` 와 같은 값).
INSET = 5.2
RADIUS = 46.0
SUB = 5


def shrink(im: Image.Image, size: int) -> Image.Image:
    """알파를 곱한 채로 줄인다 — 투명 화소의 RGB(흰색)가 경계로 번지지 않게."""
    premul = im.convert("RGBa")
    return premul.resize((size, size), Image.LANCZOS).convert("RGBA")


def mask(size: int) -> Image.Image:
    """둥근 사각 마스크(L) — 안쪽 255 · 바깥 0 · 경계는 SUB×SUB 표본의 덮인 비율(Rust `mask` 와 같은 판정)."""
    scale = size / ICON_SIZE
    inset, radius = INSET * scale, RADIUS * scale
    lo, hi = inset, size - inset

    def inside(x: float, y: float) -> bool:
        if x < lo or x > hi or y < lo or y > hi:
            return False
        cx = min(max(x, lo + radius), hi - radius)
        cy = min(max(y, lo + radius), hi - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius

    total = SUB * SUB
    data = bytearray(size * size)
    for py in range(size):
        for px in range(size):
            # 볼록한 모양이라 네 귀퉁이가 다 안이면 화소 전체가 안이다 — 표본을 건너뛴다(큰 마스터가 빨라진다).
            if all(inside(px + dx, py + dy) for dx in (0, 1) for dy in (0, 1)):
                data[py * size + px] = 255
                continue
            hit = 0
            for sy in range(SUB):
                for sx in range(SUB):
                    hit += inside(px + (sx + 0.5) / SUB, py + (sy + 0.5) / SUB)
            data[py * size + px] = (hit * 255 + total // 2) // total
    return Image.frombytes("L", (size, size), bytes(data))


def make_icon(src: Path | Image.Image, size: int) -> Image.Image:
    """원본 → `size` 정사각 아이콘(둥근 사각 · 모서리 투명). 원본이 정사각이 아니면 멈춘다."""
    im = (Image.open(src) if isinstance(src, Path) else src).convert("RGBA")
    if im.width != im.height:
        raise SystemExit(f"{src}: 정사각형이 아닙니다 {im.size}")
    out = shrink(im, size)
    a = out.getchannel("A")
    m = mask(size)
    out.putalpha(Image.frombytes("L", (size, size), bytes((x * y + 127) // 255 for x, y in zip(a.tobytes(), m.tobytes()))))
    return out


def main() -> None:
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "character"
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    OUT_THUMBS.mkdir(parents=True, exist_ok=True)
    for cid, name in CHARACTERS.items():
        print(f"{cid} ← {name}")
        full = Image.open(src_dir / name).convert("RGBA")
        icon = make_icon(full, ICON_SIZE)
        icon.save(OUT_ICONS / f"{cid}.png", optimize=True)
        make_icon(full, THUMB_SIZE).save(OUT_THUMBS / f"{cid}.png", optimize=True)
        print(f"  corner alpha={icon.getpixel((0, 0))[3]} center alpha={icon.getpixel((ICON_SIZE // 2, ICON_SIZE // 2))[3]}")


if __name__ == "__main__":
    main()
