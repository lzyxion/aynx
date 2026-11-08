/**
 * **쿼리 결과 표 안 찾기 — 순수 층** (2026-10-19 — 결과 표에 포커스가 있을 때의 `Ctrl+F`, `app/tile-find.ts`). 표는 가상 스크롤이라
 * (보이는 줄만 DOM 에 — `ResultGrid`) DOM 을 훑지 않고 **칸 글자**(화면에 그리는 글자 그대로 — [`shownCellText`])에서 찾는다. 매칭
 * 규칙은 문서 찾기와 같다(`doc-find.ts` 의 `findRegExp` — 글자 그대로 · 대소문자 기본 무시 · 상한 `FIND_LIMIT`). 일치는 행 → 열 →
 * 칸 안 자리 차례이고 한 칸을 넘지 않는다. 칠(보이는 칸의 `Range` · CSS Custom Highlight)과 띠는 `ResultGrid` 가 한다.
 *
 * 행 상한이 1만이라 칸이 수십만일 수 있다 — 정규식은 질의마다 하나만 만들어 `lastIndex` 를 되돌려 쓰고, 상한에서 멈춘다.
 */
import { FIND_LIMIT, findRegExp } from "$lib/doc-find";

/** 칸에 그리는 글자의 최대 길이 — 넘으면 앞부분만 그린다(`ResultGrid` · 찾기가 같은 값을 본다) */
export const CELL_SHOWN_MAX = 400;

/** 칸에 그리는 글자 — 찾기도 이 글자에서 찾아야 칠 자리가 화면 글자와 맞는다 */
export function shownCellText(text: string): string {
  return text.length > CELL_SHOWN_MAX ? text.slice(0, CELL_SHOWN_MAX) : text;
}

/** 칸 하나 안의 일치 — 행 `r` · 열 `c` · 그 칸 글자의 `[start, end)` */
export interface GridMatch {
  r: number;
  c: number;
  start: number;
  end: number;
}

/**
 * 표 전체의 일치 — 행 → 열 → 칸 안 자리 차례. 빈 질의면 없음. `textAt(r, c)` 는 그 칸에 그리는 글자다(부르는 쪽이
 * [`shownCellText`] 를 지난 값을 준다).
 */
export function gridMatches(
  rowCount: number,
  colCount: number,
  textAt: (r: number, c: number) => string,
  query: string,
  caseSensitive: boolean,
  limit = FIND_LIMIT,
): GridMatch[] {
  const out: GridMatch[] = [];
  if (query === "" || rowCount <= 0 || colCount <= 0) return out;
  const re = findRegExp(query, caseSensitive);
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const text = textAt(r, c);
      if (text.length < query.length && caseSensitive) continue;
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        // 빈 일치는 없다(빈 질의를 위에서 걸렀다) — 그래도 같은 자리에 머물지 않게
        if (m[0].length === 0) re.lastIndex++;
        out.push({ r, c, start: m.index, end: m.index + m[0].length });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** `matches` 에서 행이 `row` 이상인 첫 일치의 번호 — 없으면 `matches.length`(이분 탐색 · 일치는 행 차례) */
export function lowerBoundRow(matches: readonly GridMatch[], row: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].r < row) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 행 구간 `[first, last)` 에 든 일치의 번호 구간 `[from, to)` — 보이는 줄만 칠하려고 */
export function matchesInRows(matches: readonly GridMatch[], first: number, last: number): { from: number; to: number } {
  return { from: lowerBoundRow(matches, first), to: lowerBoundRow(matches, last) };
}

/** 질의를 바꿨을 때 처음 고를 일치 — 지금 맨 위에 보이는 행(`row`) 이상인 첫 일치, 모두 위면 처음(돈다). 없으면 -1 */
export function firstMatchFromRow(matches: readonly GridMatch[], row: number): number {
  if (matches.length === 0) return -1;
  const i = lowerBoundRow(matches, row);
  return i >= matches.length ? 0 : i;
}
