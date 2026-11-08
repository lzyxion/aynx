/**
 * **화면 축소판 — 순수 모델** (docs/log/2026-09-29-session-chips.md 의 "미리 보기: 화면 축소판" ·
 * 2026-09-29-dashboard-thumbs.md).
 *
 * 대시보드 세션 칸의 카드마다 그 타일의 **보이는 화면을 색째** 작게 그린다(OS 작업 표시줄 미리 보기처럼 —
 * 처음에는 상태바 칩의 호버 카드에 있었고, 그 카드가 걷히며 대시보드로 옮겼다).
 * 읽으라는 것이 아니라 **알아보라는** 것이다 — Claude 가 도는 중인지, vim 이 열려 있는지, 로그가 흐르는지.
 *
 * 이 모듈은 xterm 버퍼(를 닮은 것)를 읽어 **줄마다 같은 모양의 칸을 이은 토막(run)** 으로 접는다. 룬도 DOM 도
 * 없고, xterm 도 import 하지 않는다 — 버퍼 · 칸 · 팔레트는 구조 타입으로만 받는다(node vitest 로 가짜 칸을 먹인다).
 *
 * - 색: 팔레트 번호(0–255) → 테마의 16색(`black`…`brightWhite`) · `extendedAnsi` · 없으면 xterm 기본값과 같은 6×6×6
 *   정육면체 · 회색 24단. RGB 는 `#rrggbb`. 기본색은 `null`(= 판의 기본 글자색 · 바탕색을 물려받는다).
 * - 반전(`CSI 7 m`)은 글자색과 바탕색을 맞바꾼다 — 기본색이었으면 판의 기본색을 **적어서** 바꾼다.
 * - 굵게 + 팔레트 0–7 은 밝은 색 8–15 로(xterm 의 `drawBoldTextInBrightColors` 기본값과 같다).
 * - 숨김(`CSI 8 m`)은 공백으로.
 * - 넓은 글자(CJK) 뒤의 폭 0 칸은 건너뛴다.
 * - 줄 끝의 **기본 바탕 공백**은 뗀다(그릴 것이 없다).
 */

/** 테마에서 읽는 칸만 — xterm `ITheme` 과 같은 이름(구조 타입) */
export interface ThumbTheme {
  foreground?: string;
  background?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
  extendedAnsi?: string[];
}

/** 칸 하나 — xterm `IBufferCell` 에서 여기서 읽는 것만 */
export interface ThumbCell {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  isBold(): number;
  isDim(): number;
  isInverse(): number;
  isInvisible(): number;
}

/** 줄 하나 — xterm `IBufferLine` 에서 읽는 것만 */
export interface ThumbLine {
  readonly length: number;
  getCell(x: number, cell?: ThumbCell): ThumbCell | undefined;
}

/** 버퍼 — xterm `IBuffer` 에서 읽는 것만(보통 · 대체 화면 어느 쪽이든 `buffer.active`) */
export interface ThumbBuffer {
  readonly viewportY: number;
  readonly length: number;
  getLine(y: number): ThumbLine | undefined;
  getNullCell(): ThumbCell;
}

/** 같은 모양의 칸을 이은 토막 — 색이 `null` 이면 판의 기본색 */
export interface ThumbRun {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

/** 화면 한 장 */
export interface ScreenSnapshot {
  /** 그린 칸 수(상한을 지난 뒤) — 축소판의 가로세로 비를 정한다 */
  cols: number;
  rows: number;
  /** 판의 기본 글자색 · 바탕색 */
  fg: string;
  bg: string;
  /** 줄마다 토막들 (`rows` 개 — 빈 줄은 빈 배열) */
  lines: ThumbRun[][];
}

/** 일을 막는 상한 — 타일 하나에 이만큼까지만 읽는다 */
export const SNAPSHOT_MAX_ROWS = 60;
export const SNAPSHOT_MAX_COLS = 200;

/** xterm 의 기본 16색 (`DEFAULT_ANSI_COLORS` 앞 16칸과 같다) — 테마가 비워 둔 칸의 대안 */
const DEFAULT_16 = [
  "#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
  "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
];
const THEME_16: (keyof ThumbTheme)[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];
/** xterm 기본 글자색 · 바탕색 */
export const DEFAULT_FG = "#ffffff";
export const DEFAULT_BG = "#000000";

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** `0xRRGGBB` → `#rrggbb` */
export function rgbHex(n: number): string {
  return `#${hex2((n >> 16) & 0xff)}${hex2((n >> 8) & 0xff)}${hex2(n & 0xff)}`;
}

/**
 * 팔레트 번호(0–255) → 색. 0–15 는 테마(없으면 xterm 기본), 16–255 는 테마의 `extendedAnsi` 가 있으면 그것,
 * 없으면 6×6×6 정육면체(16–231) · 회색 24단(232–255). 순수 함수.
 */
export function paletteColor(index: number, theme: ThumbTheme): string {
  const i = Math.max(0, Math.min(255, Math.trunc(index)));
  if (i < 16) {
    const v = theme[THEME_16[i]];
    return typeof v === "string" && v !== "" ? v : DEFAULT_16[i];
  }
  const ext = theme.extendedAnsi?.[i - 16];
  if (ext) return ext;
  if (i < 232) {
    const n = i - 16;
    const step = (k: number): number => (k === 0 ? 0 : 55 + k * 40);
    return `#${hex2(step(Math.floor(n / 36)))}${hex2(step(Math.floor(n / 6) % 6))}${hex2(step(n % 6))}`;
  }
  const g = 8 + (i - 232) * 10;
  return `#${hex2(g)}${hex2(g)}${hex2(g)}`;
}

/** 칸 하나의 모양 — 색은 `null` 이면 기본 */
export interface CellStyle {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

/**
 * 칸의 모양을 푼다 — 팔레트 · RGB · 기본, 굵게의 밝은 색, 반전. 순수 함수.
 * `defaults` 는 반전이 기본색을 맞바꿀 때만 쓴다.
 */
export function cellStyle(cell: ThumbCell, theme: ThumbTheme, defaults: { fg: string; bg: string }): CellStyle {
  const bold = cell.isBold() !== 0;
  let fg: string | null = null;
  if (cell.isFgRGB()) fg = rgbHex(cell.getFgColor());
  else if (cell.isFgPalette()) {
    const n = cell.getFgColor();
    fg = paletteColor(bold && n < 8 ? n + 8 : n, theme);
  }
  let bg: string | null = null;
  if (cell.isBgRGB()) bg = rgbHex(cell.getBgColor());
  else if (cell.isBgPalette()) bg = paletteColor(cell.getBgColor(), theme);
  if (cell.isInverse() !== 0) {
    const f = fg ?? defaults.fg;
    fg = bg ?? defaults.bg;
    bg = f;
  }
  return { fg, bg, bold, dim: cell.isDim() !== 0 };
}

const sameStyle = (a: CellStyle, b: CellStyle): boolean =>
  a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim;

/**
 * (글자, 모양) 열 → 토막들. 이웃한 같은 모양을 잇고, 줄 끝의 **기본 바탕 공백**을 뗀다(색 바탕 공백은 그림이라
 * 둔다). 순수 함수.
 */
export function coalesceRow(cells: readonly { ch: string; style: CellStyle }[]): ThumbRun[] {
  const runs: ThumbRun[] = [];
  for (const { ch, style } of cells) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, style)) last.text += ch;
    else runs.push({ text: ch, fg: style.fg, bg: style.bg, bold: style.bold, dim: style.dim });
  }
  while (runs.length > 0) {
    const last = runs[runs.length - 1];
    if (last.bg !== null) break;
    const trimmed = last.text.replace(/ +$/, "");
    if (trimmed === "") {
      runs.pop();
      continue;
    }
    last.text = trimmed;
    break;
  }
  return runs;
}

/**
 * 버퍼의 **보이는 화면**(`viewportY` 부터 `rows` 줄 — 스크롤해 둔 자리 그대로) → 축소판 한 장. 줄은 아래쪽
 * [`SNAPSHOT_MAX_ROWS`] 줄, 칸은 왼쪽 [`SNAPSHOT_MAX_COLS`] 칸까지만 읽는다. 기본색은 테마(없으면 xterm 기본).
 * 순수 함수(버퍼는 읽기만 한다).
 */
export function snapshotScreen(
  buffer: ThumbBuffer,
  size: { cols: number; rows: number },
  theme: ThumbTheme,
): ScreenSnapshot {
  const cols = Math.max(0, Math.min(size.cols, SNAPSHOT_MAX_COLS));
  const rows = Math.max(0, Math.min(size.rows, SNAPSHOT_MAX_ROWS));
  const defaults = { fg: theme.foreground || DEFAULT_FG, bg: theme.background || DEFAULT_BG };
  // 화면이 상한보다 높으면 아래쪽(최근) 줄들
  const top = buffer.viewportY + Math.max(0, size.rows - rows);
  const reuse = buffer.getNullCell();
  const lines: ThumbRun[][] = [];
  for (let y = top; y < top + rows; y += 1) {
    const line = y < buffer.length ? buffer.getLine(y) : undefined;
    if (!line) {
      lines.push([]);
      continue;
    }
    const cells: { ch: string; style: CellStyle }[] = [];
    const end = Math.min(cols, line.length);
    for (let x = 0; x < end; x += 1) {
      const cell = line.getCell(x, reuse);
      if (!cell) break;
      if (cell.getWidth() === 0) continue; // 넓은 글자의 뒤 칸
      const style = cellStyle(cell, theme, defaults);
      const chars = cell.getChars();
      cells.push({ ch: chars === "" || cell.isInvisible() !== 0 ? " ".repeat(Math.max(1, cell.getWidth())) : chars, style });
    }
    lines.push(coalesceRow(cells));
  }
  return { cols, rows, fg: defaults.fg, bg: defaults.bg, lines };
}

/** 그릴 글자가 하나도 없는 판인가 — 색 바탕도 없으면 비었다(카드는 글 미리 보기로 떨어진다) */
export function isBlankSnapshot(s: ScreenSnapshot): boolean {
  return s.lines.every((runs) => runs.every((r) => r.bg === null && r.text.trim() === ""));
}

/**
 * 축소판에 그릴 **줄들** — 꼬리의 빈 줄(글자도 색 바탕도 없는 줄)을 떼고 마지막 [`max`] 줄. 짧은 화면은 위에서부터,
 * 긴 화면은 최근(아래) 쪽이 보인다 — 대시보드 카드의 축소판은 높이가 정해져 있어 넘치는 위쪽을 버린다.
 * 순수 함수.
 */
export function thumbTail(s: ScreenSnapshot, max: number): ThumbRun[][] {
  let end = s.lines.length;
  while (end > 0 && s.lines[end - 1].every((r) => r.bg === null && r.text.trim() === "")) end -= 1;
  return s.lines.slice(Math.max(0, end - Math.max(0, max)), end);
}

// ---------------------------------------------------------------------------
// 글 미리 보기 — 축소판이 없을 때의 대안 (예전 `chip-card.ts` 에서 옮김 · docs/log/2026-09-29-dashboard-thumbs.md)
// ---------------------------------------------------------------------------

/** 대안 글 미리 보기에 남기는 마지막 줄 수 */
export const PREVIEW_LINES = 5;

/**
 * 터미널 이스케이프를 걷는다 — CSI(`ESC [ … 끝글자`) · OSC(`ESC ] … BEL|ST`) · 그 밖의 두 글자 ESC 열 ·
 * 8비트 CSI(`\x9b`). 남은 제어 문자는 지우고 탭은 공백 하나로. 순수 함수.
 */
export function stripAnsi(text: string): string {
  return (
    text
      // OSC — BEL 또는 ST(ESC \) 로 끝난다. 끝이 없으면 줄 끝까지
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, "")
      // DCS · SOS · PM · APC — ST 로 끝난다
      .replace(/\x1b[P^_X][^\x1b]*(?:\x1b\\|$)/g, "")
      // CSI (7비트 · 8비트)
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
      // 나머지 ESC 열 — 중간 글자(0x20–0x2F, 문자 집합 지정 `ESC ( B` 등) + 끝 글자 하나(`ESC =` · `ESC 7` …)
      .replace(/\x1b[ -/]*[0-~]/g, "")
      .replace(/\t/g, " ")
      // 남은 C0 · DEL · C1 제어 문자
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
  );
}

/**
 * 줄 배열 → 그릴 **마지막 [`max`] 줄**. 이스케이프를 걷고 오른쪽 여백을 뗀 뒤, 꼬리의 빈 줄을
 * 떼고 끝에서부터 센다. 가운데 빈 줄은 출력의 일부라 둔다. 앞머리의 빈 줄은 뗀다(위가 비어 보이지 않게).
 */
export function previewLines(lines: readonly string[], max = PREVIEW_LINES): string[] {
  // 줄바꿈으로 먼저 가른다 — `stripAnsi` 는 남은 제어 문자(줄바꿈 포함)를 지운다
  const clean = lines.flatMap((line) => line.split(/\r?\n|\r/)).map((line) => stripAnsi(line).trimEnd());
  while (clean.length > 0 && clean[clean.length - 1] === "") clean.pop();
  const tail = clean.slice(Math.max(0, clean.length - max));
  while (tail.length > 0 && tail[0] === "") tail.shift();
  return tail;
}

/** 블록 기록의 모양 중 여기서 읽는 칸만 — `block-history` 를 들이지 않으려는 구조 타입 */
export interface PreviewBlock {
  commandLine: string;
  excerpt: { head: readonly string[]; tail: readonly string[] };
}

/**
 * 살아 있는 화면이 없을 때(터미널이 아직 없다)의 대안 — 마지막 명령 블록의 `$ 명령` + 출력 발췌(머리 · 꼬리).
 * 블록이 없으면 빈 배열.
 */
export function blockPreview(block: PreviewBlock | null | undefined): string[] {
  if (!block) return [];
  const head = block.commandLine.trim() === "" ? [] : [`$ ${block.commandLine}`];
  return [...head, ...block.excerpt.head, ...block.excerpt.tail];
}
