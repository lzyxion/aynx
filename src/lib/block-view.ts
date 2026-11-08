/**
 * **명령 블록 리치 보기의 순수 층**(2026-10-18 — 목업 ②' "블록이 제자리에서 펼쳐지기"). 그림은 `term/BlockView.svelte`,
 * 여는 단추는 `shell-integration/decorations.ts` 의 블록 줄 단추, 배선은 `Terminal.svelte`.
 *
 * 블록 출력(화면 버퍼에서 읽은 글자 — ANSI 는 이미 없다)을 보고 **어떤 모양인지** 가린다. 규칙(위에서부터 처음 맞는 것):
 *
 * 1. [`MAX_RICH_CHARS`](1MB) 를 넘으면 `raw` — 큰 글을 파싱 · 그리기로 붙잡지 않는다.
 * 2. 앞뒤 공백을 걷은 글이 `{` · `[` 로 시작하고 **전체가** `JSON.parse` 되면 `json` — 트리 · (표가 되면) 표 · 원문.
 * 3. 두 줄 이상이고 모든 줄이 같은 수(1 이상)의 쉼표(따옴표 안 쉼표는 세지 않는다)로 나뉘면 `csv` — 표 · 원문.
 * 4. **줄 맞춘 표**([`columnsTable`] — `docker ps` · `kubectl get` · `ps aux` · `df -h` · PowerShell 표)면 `columns` — 표 · 원문.
 * 5. 마크다운 표지가 있으면 `markdown` — 제목 줄(`# `…) · 코드 펜스(```) 한 쌍 · 목록 줄 셋 이상 중 하나 — 렌더 · 원문.
 * 6. 그 밖은 `raw`(고정폭 원문).
 *
 * 탭으로 나뉜 글(TSV)은 따로 알아보지 않는다 — 글이 화면 버퍼에서 오므로(`shell-integration/buffer-read.ts`) xterm 의 탭은
 * 커서만 옮기고 칸에 아무것도 남기지 않아 **탭이 이미 공백**이다. 그런 글은 줄 맞춘 표 규칙을 지나거나 원문이다.
 *
 * JSON 표: 최상위가 객체 배열이면 그것, 아니면 최상위 객체의 **첫 객체 배열 값**(`{ checks: [...] }` 의 `checks`). 열은 키의
 * **합집합**(처음 나온 차례), 칸은 원시값 그대로 · 객체/배열은 한 줄 JSON. 정렬은 숫자끼리면 수, 아니면 글자(빈 칸은 늘 뒤).
 *
 * **짧은 출력**([`isShortOutput`]): 줄 [`SHORT_MAX_LINES`](12) 이하 · 글자 [`SHORT_MAX_CHARS`](1500) 이하면 타일을 덮지 않고 블록
 * 바로 아래의 작은 카드로 연다.
 */

export type BlockFormat = "json" | "csv" | "columns" | "markdown" | "raw";
export type BlockViewKind = "tree" | "table" | "rendered" | "raw";

/** 이보다 크면 원문만 */
export const MAX_RICH_CHARS = 1024 * 1024;
export const SHORT_MAX_LINES = 12;
export const SHORT_MAX_CHARS = 1500;

export interface Detected {
  format: BlockFormat;
  /** `json` 일 때 파싱한 값 */
  json?: unknown;
  /** `columns` 일 때 나눈 표 */
  columns?: Table;
}

/** 쉼표로 한 줄을 나눈다 — 큰따옴표 안의 쉼표 · `""`(따옴표 하나)를 안다 */
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
      // JSON 이 아니다 — 아래로
    }
  }
  const lines = t.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  if (isCsv(lines)) return { format: "csv" };
  const columns = columnsTable(text);
  if (columns) return { format: "columns", columns };
  if (HEADING.test(t) || FENCE.test(t) || lines.filter((l) => LIST_LINE.test(l)).length >= 3) return { format: "markdown" };
  return { format: "raw" };
}

/** 그 형식이 내놓는 보기 탭(첫째가 기본) */
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

/** JSON 에서 표로 볼 행들 — 최상위 객체 배열, 아니면 최상위 객체의 첫 객체 배열 값. 없으면 `null` */
export function jsonTableRows(v: unknown): { path: string | null; rows: Record<string, unknown>[] } | null {
  const isRows = (x: unknown): x is Record<string, unknown>[] => Array.isArray(x) && x.length > 0 && x.every(isPlainObject);
  if (isRows(v)) return { path: null, rows: v };
  if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) if (isRows(x)) return { path: k, rows: x };
  }
  return null;
}

/** 열 = 키의 합집합(처음 나온 차례) */
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

/** 칸 하나의 글자 — 없는 키는 `null`(빈 칸), 문자열은 그대로, 그 밖은 한 줄 JSON */
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

// ---------------------------------------------------------------------------
// 줄 맞춘 표 — 공백으로 열을 맞춘 명령 출력
// ---------------------------------------------------------------------------

/**
 * 글자 하나가 터미널에서 차지하는 **칸 수** — 한글 · CJK · 전각(U+1100–FFE6, 일반 문장 부호 U+2000–2BFF 는 뺀다)과 그림 글자
 * (U+1F300–1FAFF)는 2, 나머지는 1. `shell-integration/decorations.ts` 의 `cellWidth` 와 같은 대략의 표에 그림 글자를 더했다 —
 * 정확한 wcwidth(결합 문자 0칸 · 드문 2칸 구역)는 아니라서 그런 글자가 마지막 열이 아닌 곳에 끼면 경계가 어긋날 수 있다
 * (그러면 대개 열이 합쳐지거나 원문이 된다).
 */
function charCells(cp: number): number {
  if (cp >= 0x1100 && cp <= 0xffe6 && !(cp >= 0x2000 && cp <= 0x2bff)) return 2;
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
  return 1;
}

/** 한 줄을 **칸 배열**로 — `[c]` = 칸 c 에서 시작하는 글자, 2칸 글자의 뒤 칸은 `""` */
function toCells(line: string): string[] {
  const out: string[] = [];
  for (const ch of line) {
    out.push(ch);
    if (charCells(ch.codePointAt(0) ?? 0) === 2) out.push("");
  }
  return out;
}

/** 칸 c 가 비었나 — 줄 끝 너머도 빈 칸 */
const blankAt = (cells: readonly string[], c: number): boolean => c >= cells.length || cells[c] === " " || cells[c] === "\t";

const sliceCells = (cells: readonly string[], a: number, b: number): string => cells.slice(a, b).join("").trim();

/** 구분 줄 — `----  --` · `====` · `───`(PowerShell 표 머리 아래 등) */
const RULE_LINE = /^[\s\-=─━+|]+$/;
const isRule = (l: string): boolean => RULE_LINE.test(l) && /[-=─━]{2,}/.test(l);

/** 구분 줄은 첫 이만큼의 줄 안에서만 찾는다(머리 위 머리말 `디렉터리: …` 몇 줄까지) */
const RULE_SEARCH_LINES = 4;

/**
 * **줄 맞춘 표**를 나눈다 — 표가 아니면 `null`. 값 안의 공백(`docker ps` 의 `Up 2 hours`)을 쪼개지 않는 것이 목적이다.
 *
 * - **머리 줄** = 첫 줄. 첫 [`RULE_SEARCH_LINES`] 줄 안에 구분 줄(`----  --`)이 있으면 그 바로 위 줄이 머리이고, 그 위
 *   (PowerShell `Get-ChildItem` 의 `디렉터리: …`)는 표에서 뺀다. 구분 줄은 행이 아니다.
 * - **칸 위치는 표시 폭**으로 잰다([`charCells`] — 한글 · 전각은 2칸). 화면에서 접힌 줄은 읽을 때 이미 한 줄로 이어 붙었다.
 * - **경계**: 머리 낱말마다 앞 낱말과의 틈(머리의 빈 칸들) 안에서 **모든 아래 줄이 빈 칸인 가장 오른쪽 칸**을 찾고, 그다음
 *   칸에서 자른다. 왼쪽 맞춤 열이면 낱말 바로 앞 칸이라 낱말 시작이 경계이고, 오른쪽 맞춤 숫자 열(`df` 의 `Size` · `ps` 의
 *   `PID` · PowerShell 의 `Id`)이면 값이 머리보다 왼쪽으로 나와도 그 앞의 빈 칸이 경계가 된다. 그런 칸이 없으면(어떤 아래
 *   줄이 틈을 글자로 메운다) 두 낱말을 **한 열로 합친다** — `CONTAINER ID` · `Mounted on`. 아래 줄이 짧으면 빈 칸으로 본다.
 *   첫 열은 줄 처음부터, 마지막 열은 줄 끝까지. 칸은 앞뒤 공백을 걷는다.
 * - 아래 칸이 모두 비었고 머리 틈이 한 칸인 열은 앞 열에 합친다(경로가 모두 짧은 `df` 의 `Mounted on`).
 * - **표로 보는 조건**(오탐 줄이기 — 하나라도 어기면 `null`): 아래 줄 1개 이상 · 열 2개 이상 · 남은 경계 중 머리 틈이
 *   **두 칸 이상**인 것이 하나는 있다(아래 줄이 하나뿐이면 전부 — 문장은 한 칸씩 띄운다) · 머리 칸에 숫자가 없다(로그 시각 ·
 *   `1..13` · `total 8`) · 머리 칸 하나는 대문자로 시작한다 · 머리 칸에 `.글자`(파일 이름 — `ls`)가 없다 · 그리고 아래 칸에
 *   숫자가 있거나 · 구분 줄이 있거나 · 머리가 모두 대문자다(`ls ~` 의 `Desktop  Documents` 를 거른다).
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

/** 정렬한 행의 새 배열 — 숫자끼리는 수로, 아니면 글자(자연 순서). 빈 칸(`null` · 빈 글자)은 방향과 무관하게 뒤 */
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

/** 머리의 명령 글자 — 한 줄로 접고 길면 가운데 생략 */
export function headCommand(cmd: string, max = 60): string {
  const one = cmd.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const half = Math.floor((max - 1) / 2);
  return `${one.slice(0, half)}…${one.slice(one.length - half)}`;
}
