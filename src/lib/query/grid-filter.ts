/**
 * 쿼리 탭 결과의 받은 행 거르기 — 다시 실행하지 않는다. 데이터 탭은 이 길이 아니라 WHERE 로 다시 조회한다(`data-tab`).
 * 같음은 표시 글자가 아니라 칸 값(`compareCells`)으로, 열은 이름이 아니라 번호로 가른다(같은 이름의 열이 둘일 수 있다).
 */
import { cellDisplay, compareCells } from "./cells";
import type { Cell } from "./query-backend";

export interface RowFilter {
  col: number;
  /** 칩 글자에만 쓴다 */
  name: string;
  op: "eq" | "ne";
  value: Cell;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  return compareCells(a, b) === 0;
}

export function rowMatches(row: readonly Cell[], f: RowFilter): boolean {
  const same = cellsEqual(row[f.col] ?? null, f.value);
  return f.op === "eq" ? same : !same;
}

export function filterRows<R extends readonly Cell[]>(rows: readonly R[], filters: readonly RowFilter[]): readonly R[] {
  if (filters.length === 0) return rows;
  return rows.filter((r) => filters.every((f) => rowMatches(r, f)));
}

function sameFilter(a: RowFilter, b: RowFilter): boolean {
  return a.col === b.col && a.op === b.op && cellsEqual(a.value, b.value);
}

export function withFilter(list: readonly RowFilter[], f: RowFilter, mode: "replace" | "add"): RowFilter[] {
  if (mode === "replace") return [f];
  return list.some((x) => sameFilter(x, f)) ? [...list] : [...list, f];
}

const LABEL_MAX = 32;

export function filterLabel(f: RowFilter): string {
  if (f.value === null) return `${f.name} ${f.op === "eq" ? "IS NULL" : "IS NOT NULL"}`;
  let v = cellDisplay(f.value).replace(/\s+/g, " ");
  if (v.length > LABEL_MAX) v = v.slice(0, LABEL_MAX - 1) + "…";
  const shown = typeof f.value === "string" ? `'${v}'` : v;
  return `${f.name} ${f.op === "eq" ? "=" : "<>"} ${shown}`;
}
