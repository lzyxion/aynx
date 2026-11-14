// 터미널 검색 강조의 그림 재료 — `term/search.ts` 가 부른다. 판정 셋(`selectionRows` · `sameRange` · `hexOf`)은 순수하고(search-paint.test.ts),
// 색 풀기(`searchColors`)만 캔버스 한 장을 쓴다.
//
// 왜 따로 풀어야 하나 — xterm 데코레이션 색은 **불투명 `#RRGGBB`** 여야 뜻대로 그려진다. xterm 의 `css.toColor` 는 문자열 안 어디든
// `#…` 가 있으면 그 길이로만 가르고, 그 밖은 캔버스로 재는데 **알파가 1 이 아니면 던진다**. 알파가 있는 값이 통과해도 렌더러는
// `rgba >> 8` 로 알파를 버린다(DOM · WebGL 둘 다). 그런데 `getPropertyValue("--accent-soft")` 는 글래스 재질에서
// `color-mix(…, transparent)` 가 섞인 **반투명 식 문자열**이고, 크롬이 라이트 · 터미널이 다크면 밝은 면이 된다(크롬 면 위의 색이다).
// 그래서 강조색을 **터미널 바탕 위에** 합성해 불투명 색으로 만든다 — 바탕이 무엇이든 "옅은 강조"는 옅고, 현재 매치는 강조색 그대로다.
import type { IBufferRange } from "@xterm/xterm";

/** 매치 칸 한 줄 몫 — `y` 는 버퍼 절대 줄, `x` · `width` 는 셀 */
export interface PaintRow {
  y: number;
  x: number;
  width: number;
}

/**
 * xterm 선택 범위(0-기반 · 끝 `x` 는 미포함 · 여러 줄이면 중간 줄은 끝까지)를 줄마다의 칸으로 쪼갠다 —
 * 창보다 긴 매치는 줄을 넘어 이어진다(addon-search 의 `DecorationManager` 와 같은 쪼개기).
 */
export function selectionRows(sel: IBufferRange, cols: number): PaintRow[] {
  const out: PaintRow[] = [];
  for (let y = sel.start.y; y <= sel.end.y; y++) {
    const x0 = y === sel.start.y ? sel.start.x : 0;
    const x1 = y === sel.end.y ? sel.end.x : cols;
    if (x1 > x0) out.push({ y, x: x0, width: x1 - x0 });
  }
  return out;
}

/** 두 선택이 같은 범위인가 — 검색이 만든 선택만 지우는 판정(사람이 마우스로 고른 선택은 범위가 달라 남는다) */
export function sameRange(a: IBufferRange | undefined | null, b: IBufferRange | undefined | null): boolean {
  if (!a || !b) return false;
  return a.start.x === b.start.x && a.start.y === b.start.y && a.end.x === b.end.x && a.end.y === b.end.y;
}

/** 채널 셋 → `#rrggbb` */
export function hexOf(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * hex 색(`#rgb` · `#rgba` · `#rrggbb` · `#rrggbbaa`)의 **RGB 만** `#rrggbb` 로 — 알파는 버린다. 그 밖의 형식이면 `null`.
 *
 * 터미널 투명도를 켜면 테마 바탕은 `withTransparentCanvas`(theme.ts)가 만든 `#rrggbb00` 이다 — RGB 는 프리셋 바탕 그대로이고
 * 알파만 0 이다(칠하는 층은 타일 판 `--term-bg-fill` 하나). 이 값을 캔버스에 칠해 읽으면 알파 0 픽셀이라 RGB 가 `0,0,0` 으로
 * 사라진다(캔버스는 미리 곱한 알파로 저장한다) — 그래서 hex 는 문자열에서 직접 읽는다.
 */
export function hexRgbOf(css: string | undefined): string | null {
  const s = css?.trim() ?? "";
  if (!/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return null;
  if (s.length <= 5) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return s.slice(0, 7).toLowerCase();
}

/** 검색 강조에 쓰는 불투명 색 넷 */
export interface SearchColors {
  /** 나머지 매치의 면 — 강조색을 터미널 바탕에 `SOFT_ALPHA` 만큼 */
  soft: string;
  /** 현재 매치의 면 — 강조색 그대로(바탕 위에 합성해 불투명하게) */
  active: string;
  /** 현재 매치의 글자 — 강조색 위 글자 토큰 */
  onActive: string;
}

/** 나머지 매치 면의 강조색 몫 — 바탕이 비치는 옅은 면 */
export const SOFT_ALPHA = 0.35;

/** 캔버스가 없는 곳(테스트 · 노드)의 값 — 예전 기본값 */
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

/**
 * 토큰 셋(`--accent` · `--on-accent` — CSS 색 문자열이면 무엇이든: `color-mix` · `rgb()` · 반투명)을 터미널 바탕 `termBg` 위에
 * 합성해 불투명 `#rrggbb` 로 푼다. 잘못된 색은 캔버스가 무시하므로 그 칸은 `fallback` 이 남는다. 바탕이 반투명(터미널 투명도)이면
 * 알파를 뺀 그 색을 바탕으로 본다 — 바탕이 덜 비칠 뿐 색은 같다. hex 바탕은 `hexRgbOf` 로 문자열에서 바로 읽고(알파 0 이어도 RGB 가
 * 산다), 그 밖의 형식만 캔버스로 잰다.
 */
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
  // 바탕 — 알파를 뺀 색. hex 면 문자열에서 바로(투명도의 `#rrggbb00` — `hexRgbOf`), 그 밖은 캔버스로(`copy` 라 아래 픽셀과 섞이지 않는다)
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
