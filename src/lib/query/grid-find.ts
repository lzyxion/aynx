/**
 * 쿼리 결과 표 안 찾기. 표는 가상 스크롤이라 DOM 을 훑지 않고 화면에 그리는 칸 글자에서 찾는다.
 * 칸이 수십만일 수 있다 — 정규식은 질의마다 하나만 만들어 `lastIndex` 를 되돌려 쓰고, 상한에서 멈춘다.
 */
import { FIND_LIMIT, findRegExp } from "$lib/doc-find";

/** `ResultGrid` 의 그리기 · 찾기가 같은 값을 본다 */
export const CELL_SHOWN_MAX = 400;

/** 찾기도 이 글자에서 찾아야 칠 자리가 화면 글자와 맞는다 */
export function shownCellText(text: string): string {
  return text.length > CELL_SHOWN_MAX ? text.slice(0, CELL_SHOWN_MAX) : text;
}

/** 그 칸 글자의 `[start, end)` */
export interface GridMatch {
  r: number;
  c: number;
  start: number;
  end: number;
}

/** 행 → 열 → 칸 안 자리 차례. `textAt` 은 [`shownCellText`] 를 지난 값을 준다 */
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
        if (m[0].length === 0) re.lastIndex++;
        out.push({ r, c, start: m.index, end: m.index + m[0].length });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** 일치가 행 차례라는 것에 기댄다(이분 탐색) */
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

export function matchesInRows(matches: readonly GridMatch[], first: number, last: number): { from: number; to: number } {
  return { from: lowerBoundRow(matches, first), to: lowerBoundRow(matches, last) };
}

export function firstMatchFromRow(matches: readonly GridMatch[], row: number): number {
  if (matches.length === 0) return -1;
  const i = lowerBoundRow(matches, row);
  return i >= matches.length ? 0 : i;
}
