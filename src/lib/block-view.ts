/**
 * 명령 블록 리치 보기의 순수 층 — 블록 출력(화면 버퍼에서 읽은 글자 — ANSI 는 이미 없다)의 모양을 가린다.
 * TSV 는 따로 알아보지 않는다 — xterm 의 탭은 커서만 옮겨 화면 버퍼에서 읽은 글에는 탭이 이미 공백이다.
 */

export type BlockFormat = "json" | "csv" | "columns" | "markdown" | "raw";
export type BlockViewKind = "tree" | "table" | "rendered" | "raw";

/** 이보다 크면 원문만 — 큰 글을 파싱 · 그리기로 붙잡지 않는다 */
export const MAX_RICH_CHARS = 1024 * 1024;
export const SHORT_MAX_LINES = 12;
export const SHORT_MAX_CHARS = 1500;

export interface Detected {
  format: BlockFormat;
  json?: unknown;
  columns?: Table;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function isCsv(lines: readonly string[]): boolean {
  if (lines.length < 2) return false;
  const n = splitCsvLine(lines[0]).length;
  if (n < 2) return false;
  return lines.every((l) => splitCsvLine(l).length === n);
}

const HEADING = /^#{1,6}\s+\S/m;
const FENCE = /^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/m;
const LIST_LINE = /^\s*(?:[-*+]|\d+\.)\s+\S/;

export function detectFormat(text: string): Detected {
  if (text.length > MAX_RICH_CHARS) return { format: "raw" };
  const t = text.trim();
  if (t === "") return { format: "raw" };
  if (t[0] === "{" || t[0] === "[") {
    try {
      return { format: "json", json: JSON.parse(t) };
    } catch {
      // JSON 이 아니다
    }
  }
  const lines = t.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  if (isCsv(lines)) return { format: "csv" };
  const columns = columnsTable(text);
  if (columns) return { format: "columns", columns };
  if (HEADING.test(t) || FENCE.test(t) || lines.filter((l) => LIST_LINE.test(l)).length >= 3) return { format: "markdown" };
  return { format: "raw" };
}

/** 첫째가 기본 */
export function viewsFor(d: Detected): BlockViewKind[] {
  switch (d.format) {
    case "json":
      return jsonTableRows(d.json) ? ["tree", "table", "raw"] : ["tree", "raw"];
    case "csv":
    case "columns":
      return ["table", "raw"];
    case "markdown":
      return ["rendered", "raw"];
    default:
      return ["raw"];
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function jsonTableRows(v: unknown): { path: string | null; rows: Record<string, unknown>[] } | null {
  const isRows = (x: unknown): x is Record<string, unknown>[] => Array.isArray(x) && x.length > 0 && x.every(isPlainObject);
  if (isRows(v)) return { path: null, rows: v };
  if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) if (isRows(x)) return { path: k, rows: x };
  }
  return null;
}

export function unionColumns(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
  return out;
}

export function cellText(v: unknown): string | null {
  if (v === undefined) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export interface Table {
  columns: string[];
  rows: (string | null)[][];
}

export function jsonTable(v: unknown): Table | null {
  const src = jsonTableRows(v);
  if (!src) return null;
  const columns = unionColumns(src.rows);
  return { columns, rows: src.rows.map((r) => columns.map((c) => cellText(r[c]))) };
}

export function csvTable(text: string): Table {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");
  const [head, ...body] = lines.map((l) => splitCsvLine(l));
  return { columns: head ?? [], rows: body };
}

// ── 줄 맞춘 표 ──

/**
 * 터미널 칸 수의 대략의 표(`shell-integration/decorations.ts` 의 `cellWidth` 에 그림 글자를 더했다) — 정확한 wcwidth 가 아니라
 * 결합 문자 등이 마지막 열이 아닌 곳에 끼면 경계가 어긋날 수 있다.
 */
function charCells(cp: number): number {
  if (cp >= 0x1100 && cp <= 0xffe6 && !(cp >= 0x2000 && cp <= 0x2bff)) return 2;
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
  return 1;
}

/** `[c]` = 칸 c 에서 시작하는 글자, 2칸 글자의 뒤 칸은 `""` */
function toCells(line: string): string[] {
  const out: string[] = [];
  for (const ch of line) {
    out.push(ch);
    if (charCells(ch.codePointAt(0) ?? 0) === 2) out.push("");
  }
  return out;
}

const blankAt = (cells: readonly string[], c: number): boolean => c >= cells.length || cells[c] === " " || cells[c] === "\t";

const sliceCells = (cells: readonly string[], a: number, b: number): string => cells.slice(a, b).join("").trim();

const RULE_LINE = /^[\s\-=─━+|]+$/;
const isRule = (l: string): boolean => RULE_LINE.test(l) && /[-=─━]{2,}/.test(l);

/** 머리 위 머리말(PowerShell 의 `디렉터리: …`) 몇 줄까지 */
const RULE_SEARCH_LINES = 4;

/**
 * 값 안의 공백(`docker ps` 의 `Up 2 hours`)을 쪼개지 않는 것이 목적이다. 경계는 머리 낱말 사이 틈에서 모든 아래 줄이 빈 칸인
 * 가장 오른쪽 칸이고, 없으면 두 낱말을 한 열로 합친다(`CONTAINER ID`). 끝의 조건들은 오탐(문장 · 로그 · `ls` 출력)을 거른다.
 */
export function columnsTable(text: string): Table | null {
  const all = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
  let head = 0;
  let ruled = false;
  for (let i = 1; i < Math.min(all.length, RULE_SEARCH_LINES); i++)
    if (isRule(all[i])) {
      head = i - 1;
      ruled = true;
      break;
    }
  if (all.length === 0 || isRule(all[head])) return null;
  const header = toCells(all[head]);
  const body = all
    .slice(head + 1)
    .filter((l) => !isRule(l))
    .map(toCells);
  if (body.length === 0) return null;

  // 머리 낱말 [시작, 끝)
  const words: { s: number; e: number }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (blankAt(header, c)) continue;
    const s = c;
    while (c < header.length && !blankAt(header, c)) c++;
    words.push({ s, e: c });
  }
  if (words.length < 2) return null;

  // 경계 — 자르는 칸 · 그 앞 머리 틈의 폭
  const cuts: { at: number; gap: number }[] = [];
  for (let i = 1; i < words.length; i++)
    for (let q = words[i].s - 1; q >= words[i - 1].e; q--)
      if (body.every((r) => blankAt(r, q))) {
        cuts.push({ at: q + 1, gap: words[i].s - words[i - 1].e });
        break;
      }

  const build = (): Table => {
    const edges = [0, ...cuts.map((x) => x.at), Infinity];
    const split = (cells: readonly string[]) => edges.slice(0, -1).map((a, j) => sliceCells(cells, a, edges[j + 1]));
    return { columns: split(header), rows: body.map(split) };
  };
  let t = build();
  for (let j = cuts.length; j >= 1; j--)
    if (cuts[j - 1].gap === 1 && t.rows.every((r) => r[j] === "")) {
      cuts.splice(j - 1, 1);
      t = build();
    }

  if (t.columns.length < 2) return null;
  if (body.length === 1 ? cuts.some((x) => x.gap < 2) : !cuts.some((x) => x.gap >= 2)) return null;
  if (t.columns.some((c) => /\d/.test(c) || /\.\w/.test(c))) return null;
  if (!t.columns.some((c) => /^\p{Lu}/u.test(c))) return null;
  const allCaps = t.columns.every((c) => c === c.toUpperCase());
  if (!ruled && !allCaps && !t.rows.some((r) => r.some((v) => v !== null && /\d/.test(v)))) return null;
  return t;
}

const NUM = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/** 빈 칸은 방향과 무관하게 뒤 */
export function sortRows(rows: readonly (string | null)[][], col: number, dir: 1 | -1): (string | null)[][] {
  const idx = rows.map((r, i) => ({ r, i }));
  idx.sort((a, b) => {
    const x = a.r[col] ?? null;
    const y = b.r[col] ?? null;
    const xe = x === null || x === "";
    const ye = y === null || y === "";
    if (xe || ye) return xe === ye ? a.i - b.i : xe ? 1 : -1;
    let c: number;
    if (NUM.test(x) && NUM.test(y)) c = Number(x) - Number(y);
    else c = x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    return c === 0 ? a.i - b.i : c * dir;
  });
  return idx.map((e) => e.r);
}

export function isShortOutput(text: string): boolean {
  if (text.length > SHORT_MAX_CHARS) return false;
  return text.replace(/\n+$/, "").split("\n").length <= SHORT_MAX_LINES;
}

export function headCommand(cmd: string, max = 60): string {
  const one = cmd.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const half = Math.floor((max - 1) / 2);
  return `${one.slice(0, half)}…${one.slice(one.length - half)}`;
}
