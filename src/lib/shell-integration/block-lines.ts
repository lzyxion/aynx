// **내부 전용** — 블록 id → 프롬프트 줄 다리(`s.blockLines`) · 이관 거리 · 새 창에서 되심기.

import { blocksOf } from "$lib/block-history";
import { decorate } from "./decorations";
import { cursorLine, sweepBlockLines } from "./records";
import type { SiState } from "./state";
import type { MarkerDistance } from "./types";

export function lineOfBlock(s: SiState, blockId: number): number | null {
  const marker = s.blockLines.get(blockId);
  if (!marker) return null;
  if (marker.isDisposed) {
    s.blockLines.delete(blockId);
    return null;
  }
  return marker.line;
}

export function markerDistances(s: SiState): MarkerDistance[] {
  sweepBlockLines(s);
  const bottom = cursorLine(s);
  const out: MarkerDistance[] = [];
  for (const [blockId, m] of s.blockLines) {
    if (m.isDisposed) continue;
    const promptFromBottom = bottom - m.line;
    // 커서보다 아래의 프롬프트는 없다 — 음수는 모르는 상태라 지어내지 않고 버린다.
    if (promptFromBottom < 0) continue;
    out.push({ blockId, promptFromBottom });
  }
  return out;
}

export function restoreMarkers(s: SiState, entries: readonly MarkerDistance[]): number {
  const buf = s.term.buffer.active;
  const bottom = cursorLine(s);
  // 종료 코드는 이미 심긴 이력에 있다 — `restoreTab` 이 `importHistory` 를 탭을 꽂기 전에 끝내야 한다.
  const exits = new Map(blocksOf(s.sink?.paneId ?? "").map((b) => [b.id, b.exit]));
  let count = 0;
  for (const { blockId, promptFromBottom } of entries) {
    if (!Number.isInteger(blockId) || !Number.isInteger(promptFromBottom)) continue;
    const line = bottom - promptFromBottom;
    // 범위 밖은 조용히 건너뛴다 — 이관이 스크롤백을 `TEAR_SCROLLBACK` 으로 자른다.
    if (line < 0 || line >= buf.length) continue;
    const marker = s.term.registerMarker(-promptFromBottom);
    if (!marker) continue;
    s.blockLines.set(blockId, marker);
    count++;
    // 실패 표시만 다시 그린다 — 성공 · 실행 중 띠까지 되살리는 것은 재발을 보기 전의 기계다 (CLAUDE.md).
    const exit = exits.get(blockId);
    if (exit !== undefined && exit !== null && exit !== 0) {
      s.restored.push(...decorate(s, marker, "fail", "", blockId));
    }
  }
  sweepBlockLines(s);
  return count;
}
