/**
 * **결과 칸의 글자** — 표에 그리는 글자 · 복사(TSV) · CSV 저장(쿼리 타일 6단계). **순수 함수**.
 *
 * 칸 값의 모양은 Rust `db::value::to_json` 하나다([`Cell`]). 그리기와 내보내기는 다르게 읽는다:
 *
 * | 값 | 표 | TSV · CSV |
 * | --- | --- | --- |
 * | NULL | 흐린 `NULL` | 빈 칸(CSV 는 따옴표 없이 — 빈 글자 `""` 와 갈린다) |
 * | 참/거짓 | `true` · `false` | 같음 |
 * | 숫자 · 큰 정수(문자열로 옴) | 그대로 | 그대로 |
 * | 바이트 | `‹bytes N›` | 앞부분이 전부 왔으면 `0x…16진`, 잘렸으면 `‹bytes N›` |
 *
 * CSV 는 RFC 4180 — 쉼표 · 큰따옴표 · 줄바꿈이 든 칸은 큰따옴표로 감싸고 안의 `"` 는 `""`, 줄 끝은 CRLF, 맨 앞에 UTF-8
 * BOM(엑셀이 한글을 읽게). 표의 머리줄(컬럼 이름)이 첫 줄이다.
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

/**
 * 칸 두 개의 순서(쿼리 탭 결과의 **받은 행 안 정렬** — 2026-11-10). 엔진의 정렬과 같다고 약속하지 않는다(콜레이션 · 형은 화면이 모른다):
 * NULL 은 가장 큰 값(PostgreSQL 의 기본처럼 오름차순 끝 · 내림차순 앞) · 종류가 다르면 참/거짓 < 숫자 < 글자 < 바이트 ·
 * 큰 정수 · 소수가 글자로 왔으면(`numeric` · `bigint`) 수로 비교(정수끼리는 `BigInt` — 자리 손실 없이) · 글자는 숫자를 수로 읽는 사전순.
 */
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
  // 바이트 — 16진 글자(앞부분)로
  return (a as { hex: string }).hex.localeCompare((b as { hex: string }).hex);
}

/** 행들을 한 열로 정렬한 새 배열(안정 정렬 — 같은 값은 받은 순서 그대로) */
export function sortRows<R extends readonly Cell[]>(rows: readonly R[], col: number, dir: "asc" | "desc"): R[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((p, q) => sign * compareCells(p[col] ?? null, q[col] ?? null));
}

/** 바이트 칸의 표 글자 */
export function bytesLabel(len: number): string {
  return `‹bytes ${len}›`;
}

/** 표에 그릴 글자 — NULL 은 `NULL`(흐림은 그리는 쪽이 `cellKind` 로) */
export function cellDisplay(c: Cell): string {
  if (c === null) return "NULL";
  if (typeof c === "boolean") return c ? "true" : "false";
  if (typeof c === "number") return String(c);
  if (typeof c === "string") return c;
  return bytesLabel(c.$bytes);
}

/** 내보낼 글자 — NULL 은 `null`(CSV 는 따옴표 없는 빈 칸으로, TSV 는 빈 칸으로) */
export function cellExport(c: Cell): string | null {
  if (c === null) return null;
  if (typeof c === "object") return c.hex.length === c.$bytes * 2 ? `0x${c.hex}` : bytesLabel(c.$bytes);
  return cellDisplay(c);
}

/** RFC 4180 칸 하나 — NULL 은 따옴표 없는 빈 칸, 빈 글자는 `""` */
export function csvField(v: string | null): string {
  if (v === null) return "";
  if (v === "" || /[",\r\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

const BOM = "﻿";

/** 표 전체 → CSV 글(BOM · 머리줄 · CRLF · 끝 줄바꿈) */
export function toCsv(columns: readonly DbColumn[], rows: readonly (readonly Cell[])[]): string {
  const lines = [columns.map((c) => csvField(c.name)).join(",")];
  for (const r of rows) lines.push(columns.map((_, i) => csvField(cellExport(r[i] ?? null))).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** TSV 칸 하나 — 탭 · 줄바꿈 · 큰따옴표가 들면 큰따옴표로 감싼다(스프레드시트 붙여넣기가 읽는 꼴) */
export function tsvField(v: string | null): string {
  if (v === null) return "";
  if (/[\t\r\n"]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

/** 칸 고르기 — 두 모서리(행 · 열)를 정렬한 사각형 */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function normRange(a: { r: number; c: number }, b: { r: number; c: number }): CellRange {
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

/**
 * 고른 사각형 → TSV(줄 끝 `\r\n` · 끝 줄바꿈 없음). `header` 면 그 열의 이름 줄을 먼저(사각형이 표 전체일 때 쓰기 좋다).
 * 표 밖으로 나간 모서리는 잘라 낸다.
 */
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

/** CSV 파일 이름 — `<타일 이름>-<YYYYMMDD-HHMM>.csv`(Windows 금지 글자는 `_`) */
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

/**
 * 가상 스크롤의 그릴 범위 — 보이는 줄 앞뒤로 `overscan` 줄씩. `[first, last)`.
 */
export function windowRange(scrollTop: number, height: number, rowH: number, total: number, overscan = 8): { first: number; last: number } {
  if (total <= 0 || rowH <= 0) return { first: 0, last: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + Math.max(0, height)) / rowH) + overscan);
  return { first, last: Math.max(first, last) };
}
