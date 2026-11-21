// **내부 전용** — 명령 레코드 장부의 살림.

import { MAX_RECORDS, type SiState } from "./state";

/** 마지막 레코드는 남긴다 — 걷으면 `clear; make` 의 `D` 가 갈 곳을 잃어 블록이 영영 "실행 중" 으로 남는다. */
export function prune(s: SiState) {
  while (s.records.length > 1 && s.records[0].promptMarker.isDisposed) {
    const dead = s.records.shift();
    for (const d of dead?.decorations ?? []) d.dispose();
    // 화면 지우기로 죽은 레코드는 프롬프트 마커만 죽고 나머지가 살아 있을 수 있다.
    dead?.bMarker?.dispose();
    dead?.cmdMarker?.dispose();
    dead?.outMarker?.dispose();
  }
  while (s.records.length > MAX_RECORDS) {
    const dead = s.records.shift();
    dead?.promptMarker.dispose();
    dead?.bMarker?.dispose();
    dead?.cmdMarker?.dispose();
    dead?.outMarker?.dispose();
    for (const d of dead?.decorations ?? []) d.dispose();
  }
  sweepBlockLines(s);
}

export function sweepBlockLines(s: SiState) {
  for (const [id, m] of s.blockLines) {
    if (m.isDisposed) s.blockLines.delete(id); // Map 은 순회 중 삭제가 안전하다
  }
  while (s.blockLines.size > MAX_RECORDS) {
    const oldest = s.blockLines.keys().next();
    if (oldest.done) break;
    s.blockLines.delete(oldest.value);
  }
  // 띠의 마커가 죽었으면 데코도 이미 없다 — 참조만 놓는다.
  if (s.band?.marker.isDisposed) s.band = null;
}

export const current = (s: SiState) => (s.records.length > 0 ? s.records[s.records.length - 1] : null);

/** 마커 거리의 기준점 */
export function cursorLine(s: SiState): number {
  const buf = s.term.buffer.active;
  return buf.baseY + buf.cursorY;
}
