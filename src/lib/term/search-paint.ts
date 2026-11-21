// 터미널 검색 강조의 그림 재료. xterm 데코레이션 색은 **불투명 `#RRGGBB`** 여야 한다 — `css.toColor` 는 알파가 1 이 아니면 던지고,
// 통과해도 렌더러가 알파를 버린다. 토큰(`--accent-soft` 등)은 글래스에서 반투명 식이고 크롬 면 위의 색이라,
// 강조색을 **터미널 바탕 위에** 합성해 불투명 색으로 만든다.
import type { IBufferRange } from "@xterm/xterm";

/** `y` 는 버퍼 절대 줄, `x` · `width` 는 셀 */
export interface PaintRow {
  y: number;
  x: number;
  width: number;
}

/** 끝 `x` 는 미포함 · 중간 줄은 끝까지 — addon-search 의 `DecorationManager` 와 같은 쪼개기 */
export function selectionRows(sel: IBufferRange, cols: number): PaintRow[] {
  const out: PaintRow[] = [];
  for (let y = sel.start.y; y <= sel.end.y; y++) {
    const x0 = y === sel.start.y ? sel.start.x : 0;
    const x1 = y === sel.end.y ? sel.end.x : cols;
    if (x1 > x0) out.push({ y, x: x0, width: x1 - x0 });
  }
  return out;
}

/** 검색이 만든 선택만 지우는 판정 — 사람이 고른 선택은 범위가 달라 남는다 */
export function sameRange(a: IBufferRange | undefined | null, b: IBufferRange | undefined | null): boolean {
  if (!a || !b) return false;
  return a.start.x === b.start.x && a.start.y === b.start.y && a.end.x === b.end.x && a.end.y === b.end.y;
}

export function hexOf(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * hex 색의 RGB 만 — 알파는 버린다. 터미널 투명도의 바탕은 `#rrggbb00` 인데 캔버스에 칠해 읽으면 미리 곱한 알파라 RGB 가 사라진다
 * — 그래서 hex 는 문자열에서 직접 읽는다.
 */
export function hexRgbOf(css: string | undefined): string | null {
  const s = css?.trim() ?? "";
  if (!/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return null;
  if (s.length <= 5) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return s.slice(0, 7).toLowerCase();
}

export interface SearchColors {
  soft: string;
  active: string;
  onActive: string;
}

export const SOFT_ALPHA = 0.35;

/** 캔버스가 없는 곳(테스트 · 노드)의 값 */
const FALLBACK: SearchColors = { soft: "#0e3450", active: "#22e0ff", onActive: "#000000" };

let ctx: CanvasRenderingContext2D | null | undefined;
function canvas(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const c = typeof document !== "undefined" && typeof document.createElement === "function" ? document.createElement("canvas") : null;
    if (c) c.width = c.height = 1;
    ctx = c?.getContext("2d", { willReadFrequently: true }) ?? null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 바탕이 반투명이면 알파를 뺀 그 색을 바탕으로 본다. 잘못된 색은 캔버스가 무시해 `fallback` 이 남는다. */
export function searchColors(tok: { accent: string; onAccent: string }, termBg: string | undefined): SearchColors {
  const c = canvas();
  if (!c) return FALLBACK;
  const px = (): [number, number, number, number] => {
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  const paint = (color: string, fallback: string, alpha = 1) => {
    c.globalAlpha = alpha;
    c.fillStyle = fallback;
    c.fillStyle = color; // 못 읽는 값이면 앞의 `fallback` 이 그대로 남는다
    c.fillRect(0, 0, 1, 1);
    c.globalAlpha = 1;
  };
  // `copy` 라 아래 픽셀과 섞이지 않는다
  let base = hexRgbOf(termBg);
  if (base === null) {
    c.globalCompositeOperation = "copy";
    paint(termBg ?? "#000000", "#000000");
    const [br, bg, bb] = px();
    base = hexOf(br, bg, bb);
  }
  c.globalCompositeOperation = "source-over";
  const over = (color: string, under: string, fallback: string, alpha = 1) => {
    paint(under, "#000000");
    paint(color, fallback, alpha);
    const [r, g, b] = px();
    return hexOf(r, g, b);
  };
  const active = over(tok.accent, base, FALLBACK.active);
  return {
    active,
    soft: over(tok.accent, base, FALLBACK.active, SOFT_ALPHA),
    onActive: over(tok.onAccent, active, FALLBACK.onActive),
  };
}
