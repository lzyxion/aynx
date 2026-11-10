/**
 * **쿼리 탭 결과의 받은 행 거르기**(2026-11-10) — 칸 우클릭 [이 값으로 거르기] · [이 값 빼고 거르기] · [거르기에 더하기] 가 짓는 조건 목록과
 * 그 판정. **순수 함수**(그림 · 칩 줄은 `ResultGrid`). 다시 실행하지 않고 받은 행만 거른다(정렬 `sortRows` 와 같은 결) — 데이터 탭은 이 길이
 * 아니라 WHERE 로 다시 조회한다(`data-tab` 의 `cellCondition`).
 *
 * - 조건은 모두 AND. `eq` = 같다 · `ne` = 다르다. 값이 NULL 이면 `eq` = IS NULL · `ne` = IS NOT NULL(NULL 은 NULL 하고만 같다).
 * - 같음은 표시 글자가 아니라 **칸 값**으로 — `cells` 의 `compareCells` 가 0 이면 같다(정렬과 같은 비교 — 큰 정수 글자 `"01"` = `"1"` 등).
 * - 열은 번호로 가른다(같은 이름의 열이 둘이어도) · 이름은 칩 글자에만.
 */
import { cellDisplay, compareCells } from "./cells";
import type { Cell } from "./query-backend";

export interface RowFilter {
  /** 열 번호(결과의 `columns` 차례) */
  col: number;
  /** 칩에 보일 열 이름 */
  name: string;
  op: "eq" | "ne";
  /** 누른 칸의 원값 */
  value: Cell;
}

/** 칸 두 개가 같은가 — NULL 은 NULL 끼리만, 그 밖은 `compareCells` 가 0 */
export function cellsEqual(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  return compareCells(a, b) === 0;
}

/** 한 행이 조건 하나를 채우나 */
export function rowMatches(row: readonly Cell[], f: RowFilter): boolean {
  const same = cellsEqual(row[f.col] ?? null, f.value);
  return f.op === "eq" ? same : !same;
}

/** 조건을 모두(AND) 채우는 행들 — 조건이 없으면 받은 배열 그대로 */
export function filterRows<R extends readonly Cell[]>(rows: readonly R[], filters: readonly RowFilter[]): readonly R[] {
  if (filters.length === 0) return rows;
  return rows.filter((r) => filters.every((f) => rowMatches(r, f)));
}

function sameFilter(a: RowFilter, b: RowFilter): boolean {
  return a.col === b.col && a.op === b.op && cellsEqual(a.value, b.value);
}

/** [이 값으로] · [빼고] = 그 하나로 바꾼다(`replace`) · [더하기] = 덧붙인다(같은 조건이 이미 있으면 그대로) */
export function withFilter(list: readonly RowFilter[], f: RowFilter, mode: "replace" | "add"): RowFilter[] {
  if (mode === "replace") return [f];
  return list.some((x) => sameFilter(x, f)) ? [...list] : [...list, f];
}

const LABEL_MAX = 32;

/** 칩 글자 — `col = 'v'` · `col <> 'v'` · `col IS NULL` · `col IS NOT NULL`. 글자 값은 따옴표, 길면 말줄임 */
export function filterLabel(f: RowFilter): string {
  if (f.value === null) return `${f.name} ${f.op === "eq" ? "IS NULL" : "IS NOT NULL"}`;
  let v = cellDisplay(f.value).replace(/\s+/g, " ");
  if (v.length > LABEL_MAX) v = v.slice(0, LABEL_MAX - 1) + "…";
  const shown = typeof f.value === "string" ? `'${v}'` : v;
  return `${f.name} ${f.op === "eq" ? "=" : "<>"} ${shown}`;
}
