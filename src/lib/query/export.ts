/**
 * 결과 내보내기(CSV · JSON · Markdown) 변환. 대상은 그리드가 받은 행이다 — 데이터 탭은 지금 쪽만(사용자 결정).
 */
import type { Cell, DbColumn } from "./query-backend";
import { cellExport, csvField, csvFileName, type CellRange } from "./cells";

export type ExportFormat = "csv" | "json" | "md";

export interface ExportTable {
  columns: readonly DbColumn[];
  rows: readonly (readonly Cell[])[];
}

export function exportSlice(columns: readonly DbColumn[], rows: readonly (readonly Cell[])[], range: CellRange | null): ExportTable {
  if (!range) return { columns, rows };
  const r1 = Math.min(range.r1, rows.length - 1);
  const c1 = Math.min(range.c1, columns.length - 1);
  return {
    columns: columns.slice(range.c0, c1 + 1),
    rows: rows.slice(range.r0, r1 + 1).map((r) => r.slice(range.c0, c1 + 1)),
  };
}

export function rangeCells(range: CellRange | null): number {
  return range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;
}

const BOM = "﻿";

/** `bom` 은 파일용 — 엑셀이 한글을 읽게 */
export function exportCsv(t: ExportTable, bom: boolean): string {
  const lines = [t.columns.map((c) => csvField(c.name)).join(",")];
  for (const r of t.rows) lines.push(t.columns.map((_, i) => csvField(cellExport(r[i] ?? null))).join(","));
  return (bom ? BOM : "") + lines.join("\r\n") + "\r\n";
}

/** 겹치는 이름은 `_2` · `_3` … — 이미 있는 이름과도 겹치지 않게 */
export function jsonKeys(columns: readonly DbColumn[]): string[] {
  const used = new Set<string>();
  const taken = new Set(columns.map((c) => c.name));
  return columns.map((c) => {
    let k = c.name;
    if (used.has(k)) {
      let i = 2;
      while (used.has(`${c.name}_${i}`) || taken.has(`${c.name}_${i}`)) i++;
      k = `${c.name}_${i}`;
    }
    used.add(k);
    return k;
  });
}

function jsonValue(c: Cell): string | number | boolean | null {
  if (c === null || typeof c === "boolean" || typeof c === "string") return c;
  if (typeof c === "number") return Number.isFinite(c) ? c : String(c);
  return cellExport(c);
}

export function exportJson(t: ExportTable): string {
  const keys = jsonKeys(t.columns);
  const out = t.rows.map((r) => {
    const o: Record<string, string | number | boolean | null> = {};
    keys.forEach((k, i) => {
      o[k] = jsonValue(r[i] ?? null);
    });
    return o;
  });
  return JSON.stringify(out, null, 2) + "\n";
}

function mdField(v: string): string {
  return v.replace(/\r\n|\r|\n/g, " ").replaceAll("|", "\\|");
}

export function exportMarkdown(t: ExportTable): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const lines = [line(t.columns.map((c) => mdField(c.name))), line(t.columns.map(() => "---"))];
  for (const r of t.rows) lines.push(line(t.columns.map((_, i) => mdField(cellExport(r[i] ?? null) ?? "NULL"))));
  return lines.join("\n") + "\n";
}

export function exportFileName(name: string, ext: "csv" | "json", at: Date): string {
  return csvFileName(name, at).replace(/\.csv$/, `.${ext}`);
}
