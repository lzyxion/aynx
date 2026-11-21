/**
 * 결과 칸의 글자 — 표 · 복사(TSV) · CSV. 칸 값의 모양은 Rust `db::value::to_json` 과 맞춘다.
 * CSV 맨 앞의 UTF-8 BOM 은 엑셀이 한글을 읽게 한다.
 */
import type { Cell, DbColumn } from "./query-backend";

export type CellKind = "null" | "bool" | "number" | "text" | "bytes";

export function cellKind(c: Cell): CellKind {
  if (c === null) return "null";
  if (typeof c === "boolean") return "bool";
  if (typeof c === "number") return "number";
  if (typeof c === "string") return "text";
  return "bytes";
}

const KIND_ORDER: Record<CellKind, number> = { bool: 0, number: 1, text: 2, bytes: 3, null: 4 };
const INT_RE = /^[+-]?\d+$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** 받은 행 안 정렬 — 엔진의 정렬과 같다고 약속하지 않는다(콜레이션 · 형은 화면이 모른다) */
export function compareCells(a: Cell, b: Cell): number {
  const ka = cellKind(a);
  const kb = cellKind(b);
  if (ka === "text" && kb === "text") {
    const x = a as string;
    const y = b as string;
    if (INT_RE.test(x) && INT_RE.test(y)) {
      const p = BigInt(x);
      const q = BigInt(y);
      return p < q ? -1 : p > q ? 1 : 0;
    }
    if (NUM_RE.test(x) && NUM_RE.test(y)) return Number(x) - Number(y);
    return x.localeCompare(y, undefined, { numeric: true });
  }
  if (ka !== kb) {
    // 숫자 칸과 수로 읽히는 글자 칸이 섞이면(엔진이 일부만 글자로 준 경우) 수로
    if ((ka === "number" && kb === "text" && NUM_RE.test(b as string)) || (kb === "number" && ka === "text" && NUM_RE.test(a as string))) {
      return Number(a) - Number(b);
    }
    return KIND_ORDER[ka] - KIND_ORDER[kb];
  }
  if (ka === "null") return 0;
  if (ka === "bool") return Number(a) - Number(b);
  if (ka === "number") return (a as number) - (b as number);
  return (a as { hex: string }).hex.localeCompare((b as { hex: string }).hex);
}

export function sortRows<R extends readonly Cell[]>(rows: readonly R[], col: number, dir: "asc" | "desc"): R[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((p, q) => sign * compareCells(p[col] ?? null, q[col] ?? null));
}

export function bytesLabel(len: number): string {
  return `‹bytes ${len}›`;
}

export function cellDisplay(c: Cell): string {
  if (c === null) return "NULL";
  if (typeof c === "boolean") return c ? "true" : "false";
  if (typeof c === "number") return String(c);
  if (typeof c === "string") return c;
  return bytesLabel(c.$bytes);
}

export function cellExport(c: Cell): string | null {
  if (c === null) return null;
  if (typeof c === "object") return c.hex.length === c.$bytes * 2 ? `0x${c.hex}` : bytesLabel(c.$bytes);
  return cellDisplay(c);
}

/** RFC 4180 — NULL 은 따옴표 없는 빈 칸, 빈 글자는 `""`(둘이 갈린다) */
export function csvField(v: string | null): string {
  if (v === null) return "";
  if (v === "" || /[",\r\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

const BOM = "﻿";

export function toCsv(columns: readonly DbColumn[], rows: readonly (readonly Cell[])[]): string {
  const lines = [columns.map((c) => csvField(c.name)).join(",")];
  for (const r of rows) lines.push(columns.map((_, i) => csvField(cellExport(r[i] ?? null))).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** 큰따옴표 감싸기는 스프레드시트 붙여넣기가 읽는 꼴이다 */
export function tsvField(v: string | null): string {
  if (v === null) return "";
  if (/[\t\r\n"]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function normRange(a: { r: number; c: number }, b: { r: number; c: number }): CellRange {
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

export function rangeTsv(
  columns: readonly DbColumn[],
  rows: readonly (readonly Cell[])[],
  range: CellRange,
  header = false,
): string {
  const r1 = Math.min(range.r1, rows.length - 1);
  const c1 = Math.min(range.c1, columns.length - 1);
  const lines: string[] = [];
  if (header) lines.push(columns.slice(range.c0, c1 + 1).map((c) => tsvField(c.name)).join("\t"));
  for (let r = range.r0; r <= r1; r++) {
    const row = rows[r];
    const out: string[] = [];
    for (let c = range.c0; c <= c1; c++) out.push(tsvField(cellExport(row[c] ?? null)));
    lines.push(out.join("\t"));
  }
  return lines.join("\r\n");
}

export function csvFileName(name: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stem =
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim()
      .replace(/\.+$/, "")
      .slice(0, 60)
      .trim() || "query";
  return `${stem}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.csv`;
}

/** 가상 스크롤의 그릴 범위 `[first, last)` */
export function windowRange(scrollTop: number, height: number, rowH: number, total: number, overscan = 8): { first: number; last: number } {
  if (total <= 0 || rowH <= 0) return { first: 0, last: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + Math.max(0, height)) / rowH) + overscan);
  return { first, last: Math.max(first, last) };
}
