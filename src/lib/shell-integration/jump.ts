// **내부 전용** — 명령 점프(Ctrl+↑/↓) · 착지 반짝임.

import { prune } from "./records";
import type { SiState } from "./state";

/** CSS 애니메이션 시간과 맞춘다 */
const FLASH_MS = 600;

/** 1회성 데코 — 상태 띠와 수명이 달라 `rec.decorations` 에 넣지 않는다. */
export function flashLanding(s: SiState, line: number) {
  const rec = s.records.find((r) => !r.promptMarker.isDisposed && r.promptMarker.line === line);
  if (!rec) return;
  const flash = s.term.registerDecoration({
    marker: rec.promptMarker,
    x: 0,
    width: s.term.cols,
    layer: "top",
  });
  if (!flash) return;
  flash.onRender((el) => el.classList.add("aynx-jump-flash"));
  setTimeout(() => flash.dispose(), FLASH_MS);
}

export function jump(s: SiState, dir: -1 | 1): boolean {
  prune(s);
  // 인덱스로 다룬다 — `viewportY` 를 기준으로 잡으면 화면 안에 보이는 바로 위 명령들을 건너뛴다.
  const lines = s.records
    .map((r) => r.promptMarker)
    .filter((m) => !m.isDisposed)
    .map((m) => m.line)
    .sort((a, b) => a - b);
  const n = lines.length;
  if (n === 0) return false;

  // 시작점은 맨 아래(지금 프롬프트) — `A` 핸들러가 `jumpCursor` 를 비운다.
  const base = s.jumpCursor ?? n - 1;
  const next = base + dir;
  if (next < 0 || next >= n) return false;
  s.jumpCursor = next;

  // 한 줄 위에 착지한다 — 프롬프트가 맨 윗줄에 붙으면 직전 출력 끝이 안 보여 경계가 안 읽힌다.
  s.term.scrollToLine(Math.max(0, lines[next] - 1));
  flashLanding(s, lines[next]);
  return true;
}
