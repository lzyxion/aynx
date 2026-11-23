// 터치 선택의 칸 계산(순수) — 길게 누른 자리의 낱말, 거기서 끈 자리까지의 범위, 뗀 뒤 손잡이 · 띠의 자리.
// 몸짓은 `touch-gestures.ts`, xterm 은 `Terminal`, 그림은 `TouchSelection.svelte` 가 쥔다.
// 칸은 xterm 의 것이다 — 넓은 글자(한글 등)는 두 칸이고 뒤 칸은 `tail` 로 온다.

export type CellKind = "text" | "blank" | "tail";

export interface WordSpan {
  /** 버퍼 절대 줄 */
  row: number;
  start: number;
  /** 포함 */
  end: number;
}

/** 공백으로만 끊는다(경로 · URL · 해시가 한 덩이) · 접힌 줄은 넘지 않는다. 빈 칸이면 `null`. */
export function wordSpan(kind: (col: number) => CellKind, cols: number, row: number, col: number): WordSpan | null {
  if (col < 0 || col >= cols) return null;
  let at = col;
  while (at > 0 && kind(at) === "tail") at--;
  if (kind(at) !== "text") return null;
  let start = at;
  while (start > 0 && kind(start - 1) !== "blank") start--;
  let end = at;
  while (end < cols - 1 && kind(end + 1) !== "blank") end++;
  return { row, start, end };
}

/** xterm `getSelectionPosition()` 의 꼴 — 칸은 0 부터, 줄은 버퍼 절대 줄, `end` 는 마지막 칸의 다음(같은 줄의 `cols` 까지 간다) */
export interface SelRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** 손잡이를 잡았을 때 — `anchor` = 안 움직이는 끝(한 칸), `moving` = 손잡이가 달린 끝 칸 */
export function grabEnds(which: "start" | "end", sel: SelRange, cols: number): { anchor: WordSpan; moving: { row: number; col: number } } {
  const first = sel.start.y * cols + sel.start.x;
  const last = Math.max(first, sel.end.y * cols + sel.end.x - 1);
  const cell = (pos: number) => ({ row: Math.floor(pos / cols), col: pos % cols });
  const fixed = cell(which === "start" ? last : first);
  return { anchor: { row: fixed.row, start: fixed.col, end: fixed.col }, moving: cell(which === "start" ? first : last) };
}

export interface SelGeom {
  /** 화면(`.xterm-screen`)의 왼쪽 위 — 그리는 상자 기준 px */
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  rows: number;
  viewportY: number;
  /** 그리는 상자의 크기 — 밖으로 나간 손잡이는 그리지 않는다 */
  viewW: number;
  viewH: number;
}

/**
 * 손잡이 둘의 자리(시작 = 첫 칸의 왼쪽 아래 · 끝 = 마지막 칸의 오른쪽 아래)와 띠의 위쪽 — 보이지 않는 끝은 `null`.
 * 띠는 보이는 선택의 첫 줄 위, 자리가 없으면 마지막 줄 아래(손잡이를 비켜서). 선택이 통째로 화면 밖이면 띠도 없다.
 */
export function placeSelection(sel: SelRange, g: SelGeom, barH: number): { start: Pt | null; end: Pt | null; barTop: number | null } {
  const at = (col: number, row: number): Pt | null => {
    const r = row - g.viewportY;
    if (r < 0 || r >= g.rows) return null;
    const x = g.left + col * g.cellW;
    const y = g.top + (r + 1) * g.cellH;
    return x < -1 || x > g.viewW + 1 || y > g.viewH + 1 ? null : { x, y };
  };
  const first = Math.max(sel.start.y, g.viewportY);
  const last = Math.min(sel.end.y, g.viewportY + g.rows - 1);
  let barTop: number | null = null;
  if (first <= last) {
    const above = g.top + (first - g.viewportY) * g.cellH - barH - BAR_GAP;
    const below = g.top + (last - g.viewportY + 1) * g.cellH + HANDLE_DROP + BAR_GAP;
    barTop = above >= BAR_GAP ? above : Math.max(BAR_GAP, Math.min(below, g.viewH - barH - BAR_GAP));
  }
  return { start: at(sel.start.x, sel.start.y), end: at(sel.end.x, sel.end.y), barTop };
}

export interface Pt {
  x: number;
  y: number;
}

/** 띠의 높이 — `TouchSelection.svelte` 의 `.bar` 와 같은 값 */
export const TOUCH_BAR_H = 40;
const BAR_GAP = 8;
/** 손잡이가 줄 아래로 내려오는 높이 — 아래에 서는 띠가 이만큼 비킨다 */
const HANDLE_DROP = 22;

/** `Terminal.select(col, row, length)` 의 인자 — 처음 고른 낱말은 어느 쪽으로 끌어도 통째로 남는다. */
export function dragRange(anchor: WordSpan, cell: { row: number; col: number }, cols: number): { col: number; row: number; length: number } {
  const pos = cell.row * cols + cell.col;
  const from = Math.min(pos, anchor.row * cols + anchor.start);
  const to = Math.max(pos, anchor.row * cols + anchor.end);
  return { col: from % cols, row: Math.floor(from / cols), length: to - from + 1 };
}
