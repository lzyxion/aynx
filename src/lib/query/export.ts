/**
 * **결과 내보내기**(2026-11-10) — 결과 표 상태 줄의 [내보내기 ▾](`ResultGrid`)가 쓰는 변환. **순수 함수**(저장 대화상자 · 클립보드는 부르는 쪽 —
 * 저장은 `sql-file-io` 의 `saveTextAs`).
 *
 * 대상은 그리드가 받은 행(데이터 탭은 지금 쪽만 — 사용자 결정) · 보이는 정렬 순서 · 열 순서 그대로이고, 범위를 2칸 이상 골랐으면 그 사각형만
 * 고를 수 있다(`exportSlice`).
 *
 * | 형식 | 머리 | NULL | 숫자 · 참/거짓 | 바이트 |
 * | --- | --- | --- | --- | --- |
 * | CSV(RFC 4180 · CRLF — 파일은 UTF-8 BOM) | 열 이름 줄 | 빈 칸 | 글자 | `cellExport`(`0x…` 또는 `‹bytes N›`) |
 * | JSON(행 객체 배열 · 2칸 들여쓰기) | 열 이름이 겹치면 `_2` · `_3` … | `null` | 숫자 · 불리언(큰 정수는 서버가 글자로 준 그대로 글자) | `cellExport` |
 * | Markdown 표 | 열 이름 줄 + `---` | `NULL` | 글자 | `cellExport` |
 *
 * Markdown 칸의 `|` 는 `\|`, 줄바꿈은 빈칸 하나로.
 */
import type { Cell, DbColumn } from "./query-backend";
import { cellExport, csvField, csvFileName, type CellRange } from "./cells";

export type ExportFormat = "csv" | "json" | "md";

/** 내보낼 표 — 열 · 행(같은 차례) */
export interface ExportTable {
  columns: readonly DbColumn[];
  rows: readonly (readonly Cell[])[];
}

/** 고른 사각형만(없으면 전부) — 표 밖으로 나간 모서리는 잘라 낸다 */
export function exportSlice(columns: readonly DbColumn[], rows: readonly (readonly Cell[])[], range: CellRange | null): ExportTable {
  if (!range) return { columns, rows };
  const r1 = Math.min(range.r1, rows.length - 1);
  const c1 = Math.min(range.c1, columns.length - 1);
  return {
    columns: columns.slice(range.c0, c1 + 1),
    rows: rows.slice(range.r0, r1 + 1).map((r) => r.slice(range.c0, c1 + 1)),
  };
}

/** 범위가 고를 만한가(2칸 이상) — 내보내기 메뉴의 "고른 범위 / 전부" 머리가 선다 */
export function rangeCells(range: CellRange | null): number {
  return range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;
}

const BOM = "﻿";

/** CSV — 머리줄 · CRLF · 끝 줄바꿈. `bom` 이면 맨 앞에 UTF-8 BOM(파일 — 엑셀이 한글을 읽게) */
export function exportCsv(t: ExportTable, bom: boolean): string {
  const lines = [t.columns.map((c) => csvField(c.name)).join(",")];
  for (const r of t.rows) lines.push(t.columns.map((_, i) => csvField(cellExport(r[i] ?? null))).join(","));
  return (bom ? BOM : "") + lines.join("\r\n") + "\r\n";
}

/** JSON 키 — 겹치는 이름은 뒤에 `_2` · `_3` …(이미 있는 이름과도 겹치지 않게) */
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

/** JSON — 행 객체 배열 */
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

/** Markdown 표 — 머리줄 · 구분 줄 · 행 */
export function exportMarkdown(t: ExportTable): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const lines = [line(t.columns.map((c) => mdField(c.name))), line(t.columns.map(() => "---"))];
  for (const r of t.rows) lines.push(line(t.columns.map((_, i) => mdField(cellExport(r[i] ?? null) ?? "NULL"))));
  return lines.join("\n") + "\n";
}

/** 저장 파일 이름 — `<이름>-<YYYYMMDD-HHMM>.<확장자>`(Windows 금지 글자는 `_` — `csvFileName` 과 같은 규칙) */
export function exportFileName(name: string, ext: "csv" | "json", at: Date): string {
  return csvFileName(name, at).replace(/\.csv$/, `.${ext}`);
}
