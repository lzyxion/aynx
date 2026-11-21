/**
 * 대시보드 카드의 화면 축소판 — xterm 버퍼를 줄마다 같은 모양의 토막으로 접는다 (docs/log/2026-09-29-dashboard-thumbs.md).
 * xterm 을 import 하지 않고 구조 타입으로만 받는다 — node vitest 로 가짜 칸을 먹인다.
 */

/** xterm `ITheme` 과 같은 이름 */
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

/** xterm `IBufferCell` 에서 읽는 것만 */
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

export interface ThumbLine {
  readonly length: number;
  getCell(x: number, cell?: ThumbCell): ThumbCell | undefined;
}

export interface ThumbBuffer {
  readonly viewportY: number;
  readonly length: number;
  getLine(y: number): ThumbLine | undefined;
  getNullCell(): ThumbCell;
}

/** 색이 `null` 이면 판의 기본색 */
export interface ThumbRun {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

export interface ScreenSnapshot {
  /** 상한을 지난 뒤의 칸 수 */
  cols: number;
  rows: number;
  fg: string;
  bg: string;
  lines: ThumbRun[][];
}

export const SNAPSHOT_MAX_ROWS = 60;
export const SNAPSHOT_MAX_COLS = 200;

/** xterm `DEFAULT_ANSI_COLORS` 앞 16칸과 같다 */
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

export function rgbHex(n: number): string {
  return `#${hex2((n >> 16) & 0xff)}${hex2((n >> 8) & 0xff)}${hex2(n & 0xff)}`;
}

/** 16–255 는 `extendedAnsi` 가 없으면 xterm 기본값과 같은 6×6×6 정육면체 · 회색 24단 */
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

export interface CellStyle {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
}

/** 굵게 + 팔레트 0–7 은 밝은 색 8–15 로 — xterm `drawBoldTextInBrightColors` 기본값과 같다 */
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

/** 줄 끝의 기본 바탕 공백만 뗀다 — 색 바탕 공백은 그림이다 */
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

/** 스크롤해 둔 자리 그대로의 보이는 화면 */
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

export function isBlankSnapshot(s: ScreenSnapshot): boolean {
  return s.lines.every((runs) => runs.every((r) => r.bg === null && r.text.trim() === ""));
}

export function thumbTail(s: ScreenSnapshot, max: number): ThumbRun[][] {
  let end = s.lines.length;
  while (end > 0 && s.lines[end - 1].every((r) => r.bg === null && r.text.trim() === "")) end -= 1;
  return s.lines.slice(Math.max(0, end - Math.max(0, max)), end);
}

// ── 글 미리 보기 — 축소판이 없을 때의 대안 ──

export const PREVIEW_LINES = 5;

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

export function previewLines(lines: readonly string[], max = PREVIEW_LINES): string[] {
  // 줄바꿈으로 먼저 가른다 — `stripAnsi` 는 남은 제어 문자(줄바꿈 포함)를 지운다
  const clean = lines.flatMap((line) => line.split(/\r?\n|\r/)).map((line) => stripAnsi(line).trimEnd());
  while (clean.length > 0 && clean[clean.length - 1] === "") clean.pop();
  const tail = clean.slice(Math.max(0, clean.length - max));
  while (tail.length > 0 && tail[0] === "") tail.shift();
  return tail;
}

/** `block-history` 를 들이지 않으려는 구조 타입 */
export interface PreviewBlock {
  commandLine: string;
  excerpt: { head: readonly string[]; tail: readonly string[] };
}

export function blockPreview(block: PreviewBlock | null | undefined): string[] {
  if (!block) return [];
  const head = block.commandLine.trim() === "" ? [] : [`$ ${block.commandLine}`];
  return [...head, ...block.excerpt.head, ...block.excerpt.tail];
}
