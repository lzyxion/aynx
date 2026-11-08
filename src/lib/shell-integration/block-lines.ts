// **내부 전용** — 블록 id → 프롬프트 줄 다리(`s.blockLines`): 조회(`lineOfBlock`) · 이관에 싣는 거리(`markerDistances`) ·
// 새 창에서 되심기(`restoreMarkers`, 실패 표시 포함).

import { blocksOf } from "$lib/block-history";
import { decorate } from "./decorations";
import { cursorLine, sweepBlockLines } from "./records";
import type { SiState } from "./state";
import type { MarkerDistance } from "./types";

/**
 * 블록 → 프롬프트 줄. 마커가 죽었으면 그 항목을 **그 자리에서 걷고** `null` 을 준다 —
 * 조회 자체가 청소의 계기이기도 하다 (`prune` 을 기다리지 않는다).
 */
export function lineOfBlock(s: SiState, blockId: number): number | null {
  const marker = s.blockLines.get(blockId);
  if (!marker) return null;
  if (marker.isDisposed) {
    s.blockLines.delete(blockId);
    return null;
  }
  return marker.line;
}

/**
 * 살아 있는 마커들을 **커서 줄에서의 거리**로 적어 낸다 (죽은 것은 그 김에 걷는다).
 * 창을 건널 수 있는 유일한 모양이다 — [`MarkerDistance`] 의 설명 참고.
 */
export function markerDistances(s: SiState): MarkerDistance[] {
  sweepBlockLines(s);
  const bottom = cursorLine(s);
  const out: MarkerDistance[] = [];
  for (const [blockId, m] of s.blockLines) {
    if (m.isDisposed) continue;
    const promptFromBottom = bottom - m.line;
    // 커서보다 **아래**의 마커는 없다 (프롬프트는 언제나 커서 자리이거나 그 위다).
    // 음수가 나오면 우리가 모르는 상태이므로 지어내지 않고 버린다.
    if (promptFromBottom < 0) continue;
    out.push({ blockId, promptFromBottom });
  }
  return out;
}

export function restoreMarkers(s: SiState, entries: readonly MarkerDistance[]): number {
  const buf = s.term.buffer.active;
  const bottom = cursorLine(s);
  // 실패 표시를 다시 그리려면 종료 코드가 필요한데, 그 값은 **이미 심긴 이력**에 있다
  // (`restoreTab` 이 `importHistory` 를 탭을 꽂기 전에 끝낸다). 마커에는 없다 —
  // 넘어온 화면에는 살아 있는 레코드가 없기 때문이다.
  const exits = new Map(blocksOf(s.sink?.paneId ?? "").map((b) => [b.id, b.exit]));
  let count = 0;
  for (const { blockId, promptFromBottom } of entries) {
    if (!Number.isInteger(blockId) || !Number.isInteger(promptFromBottom)) continue;
    const line = bottom - promptFromBottom;
    // **범위 밖은 조용히 건너뛴다** — 이관은 스크롤백을 5000줄로 자르므로(`TEAR_SCROLLBACK`)
    // 그보다 오래된 블록의 줄은 새 창에 아예 없다. 그 블록은 지금까지처럼 "밀려난 블록"
    // 으로 남는다 (이력에는 발췌가 그대로 있다).
    if (line < 0 || line >= buf.length) continue;
    const marker = s.term.registerMarker(-promptFromBottom);
    if (!marker) continue;
    s.blockLines.set(blockId, marker);
    count++;
    // 실패한 명령의 거터 표시도 셀이 아니라 데코라 직렬화에 실리지 않는다 — 같은
    // 코드(`decorate`)로 다시 그린다. 성공·실행 중 띠는 그리지 않는다: 되살릴 값이
    // 정확한 것은 "실패했다" 하나이고, 넘어온 화면 전체에 띠를 다시 까는 것은
    // 재발을 보기 전의 기계다 (CLAUDE.md).
    const exit = exits.get(blockId);
    if (exit !== undefined && exit !== null && exit !== 0) {
      s.restored.push(...decorate(s, marker, "fail", "", blockId));
    }
  }
  sweepBlockLines(s);
  return count;
}
