// **내부 전용** — 명령 레코드 장부의 살림: 죽은 레코드 걷기(`prune`) · 블록 → 줄 맵 청소(`sweepBlockLines`) ·
// 지금 레코드(`current`) · 커서 줄(`cursorLine`, 마커 거리의 기준점).

import { MAX_RECORDS, type SiState } from "./state";

/**
 * 스크롤백 밖으로 밀려 마커가 죽은 레코드를 걷어 낸다 (앞쪽부터 죽는다).
 *
 * **마지막 레코드(= 지금 프롬프트·도는 명령)는 남긴다** — 그 명령의 `C`·`D` 가 아직 `current()`
 * 로 그 레코드를 찾아야 한다. 걷어 버리면 `clear; make` 의 `D` 가 갈 곳을 잃어 블록이 영영
 * "실행 중" 으로 남는다(화면 지우기 · 출력이 스크롤백을 통째로 밀어낸 긴 명령). 다음 `A` 가
 * 새 레코드를 세우면 그때 앞쪽 레코드가 되어 여기서 걷힌다.
 */
export function prune(s: SiState) {
  while (s.records.length > 1 && s.records[0].promptMarker.isDisposed) {
    const dead = s.records.shift();
    for (const d of dead?.decorations ?? []) d.dispose();
    // 화면 지우기로 죽은 레코드([`dropErased`])는 프롬프트 마커만 죽고 나머지가 살아 있을 수
    // 있다 — 스크롤백 밖으로 밀린 것이라면 이미 죽어 있어 두 번 dispose 는 무해하다.
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

/** 죽은 마커를 [`blockLines`] 에서 걷고, 그러고도 넘치면 오래된 것부터 버린다 */
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

/** 버퍼의 **커서 줄**(내용의 끝) — 마커 거리의 기준점 ([`MarkerDistance`]) */
export function cursorLine(s: SiState): number {
  const buf = s.term.buffer.active;
  return buf.baseY + buf.cursorY;
}
