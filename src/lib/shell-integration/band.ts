// **내부 전용** — `#` 검색 점프가 두르는 블록 띠(터미널당 하나).

import type { IMarker } from "@xterm/xterm";
import { cursorLine } from "./records";
import type { SiState } from "./state";

/** 블록 띠의 최대 높이(줄) — 수천 줄 블록을 통째로 덮으면 스크롤 내내 화면 전체가 강조색이 된다. */
export const MAX_BAND_ROWS = 500;

/** `line` 보다 아래의 첫 프롬프트 줄 — 이관으로 되심은 블록은 `blockLines` 에만 있어 두 목록을 함께 본다. */
export function nextPromptLine(s: SiState, line: number): number | null {
  let best: number | null = null;
  const consider = (m: IMarker) => {
    if (m.isDisposed || m.line <= line) return;
    if (best === null || m.line < best) best = m.line;
  };
  for (const r of s.records) consider(r.promptMarker);
  for (const m of s.blockLines.values()) consider(m);
  return best;
}

/**
 * 띠의 마지막 줄 — `D` 줄은 출력에 들지 않아(`[C, D)`) 한 줄 뺀다.
 * 되심은 블록에는 프롬프트 마커밖에 없어 다음 프롬프트 직전이 끝을 아는 유일한 길이다.
 */
export function bandLastLine(s: SiState, marker: IMarker): number {
  const rec = s.records.find((r) => r.promptMarker === marker);
  if (rec?.outMarker && !rec.outMarker.isDisposed) {
    return Math.max(marker.line, rec.outMarker.line - 1);
  }
  const next = nextPromptLine(s, marker.line);
  if (next !== null) return Math.max(marker.line, next - 1);
  return Math.max(marker.line, cursorLine(s));
}

export function disposeBand(s: SiState) {
  s.band?.deco.dispose();
  s.band = null;
}

/** `false` = 그리지 못했다(마커가 밀려났거나 렌더러가 아직 없어 데코가 안 생김). */
export function bandBlock(s: SiState, blockId: number): boolean {
  const marker = s.blockLines.get(blockId);
  if (!marker) return false;
  if (marker.isDisposed) {
    s.blockLines.delete(blockId);
    return false;
  }
  disposeBand(s); // 띠는 터미널당 하나 — 이전 점프의 것을 먼저 걷는다
  const height = Math.min(MAX_BAND_ROWS, bandLastLine(s, marker) - marker.line + 1);
  const deco = s.term.registerDecoration({ marker, height, width: s.term.cols, layer: "bottom" });
  if (!deco) return false;
  deco.onRender((el) => el.classList.add("aynx-block-band"));
  s.band = { deco, marker };
  return true;
}
