// **내부 전용** — `#` 검색 점프가 두르는 **블록 띠**(터미널당 하나): 끝 줄 판정 · 두르기 · 걷기.

import type { IMarker } from "@xterm/xterm";
import { cursorLine } from "./records";
import type { SiState } from "./state";

/**
 * 블록 띠([`CommandApi.bandBlock`])의 최대 높이(줄).
 *
 * 빌드 로그처럼 출력이 수천 줄인 블록을 통째로 덮으면 데코 하나가 스크롤백을 끝없이 칠하고,
 * 사용자가 스크롤을 내리는 내내 화면 전체가 강조색이 된다. 띠의 일은 **"이 블록이 여기서
 * 시작한다"** 를 보이는 것이므로 프롬프트부터 이만큼만 두른다 — 끝을 말하는 것은 다음
 * 블록의 띠다.
 */
export const MAX_BAND_ROWS = 500;

/**
 * `line` 보다 **아래**에 있는 첫 프롬프트 줄 (없으면 `null`) — 블록의 끝을 재는 자다.
 *
 * 두 목록을 함께 본다: 살아 있는 셸의 [`records`] 와 [`blockLines`](이관으로 되심은
 * 블록은 이쪽에만 있다). 같은 마커가 양쪽에 있어도 최솟값을 고르므로 답은 같다.
 */
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
 * 블록 띠가 덮을 **마지막 줄** — 세 갈래로 판정한다(정확한 순서대로).
 *
 * ① 살아 있는 레코드의 `D`(`outMarker`). 셸이 직접 말한 "출력이 끝난 자리" 라 가장
 *    정확하다. `D` 의 줄은 출력에 **포함되지 않으므로**(`readLineArray` 가 `[C, D)` 를
 *    읽는다) 한 줄 뺀다.
 * ② **다음 프롬프트 직전.** 이관으로 되심은 블록에는 프롬프트 마커밖에 없다
 *    ([`restoreMarkers`] 가 A 만 심는다) — 그때 블록의 끝을 아는 유일한 길이다.
 * ③ 둘 다 없으면 **커서 줄**(내용의 끝). 마지막 블록·아직 실행 중인 블록이 여기로 온다.
 *
 * 어느 갈래든 프롬프트 줄보다 앞설 수 없다 (높이는 최소 한 줄이다).
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

/** 두른 띠를 걷는다 — [`CommandApi.clearBand`] 와 [`dispose`] 가 함께 쓴다 */
export function disposeBand(s: SiState) {
  s.band?.deco.dispose();
  s.band = null;
}

/**
 * 블록 하나에 띠를 두른다. 데코는 **`bottom` 층**이라 글자 아래에 깔리고(WebGL 캔버스
 * 위에 얹히는 반투명 배경 — `.aynx-fail-row` 와 같은 원칙), 색·왼쪽 세로선은 CSS 클래스
 * 하나(`aynx-block-band`)가 정한다. 매치 글자 강조는 검색 애드온이 그 위에 그대로 그린다.
 *
 * `false` 는 **그리지 못했다**는 뜻이다 — 마커가 밀려났거나(그 자리에서 걷는다) 렌더러가
 * 아직 없어 xterm 이 데코를 안 만들어 준 경우다.
 */
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
