/** 시작 화면(launcher)의 순수 규칙 — 판 좌표 규칙은 `start-widgets.ts` (docs/log/2026-09-25-launcher.md) */

export const LAUNCHER_COLUMN_LIMIT = 5;

export function shellColumn<S extends { id: string }>(
  shells: readonly S[],
  defaultId: string | null,
  limit = LAUNCHER_COLUMN_LIMIT,
): { shells: S[] } {
  const def = shells.find((s) => s.id === defaultId);
  const ordered = def ? [def, ...shells.filter((s) => s !== def)] : [...shells];
  return { shells: ordered.slice(0, Math.max(0, limit)) };
}

// ── 화살표 ──

/** 판 가운데 기준 px — `start-widgets.ts` 의 `Box` 와 같은 모양 */
export interface LauncherRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 구역 하나 = 위젯 하나. 빈 위젯도 그대로 넘긴다 — 호출부가 빼면 구역 번호가 화면과 어긋난다.
 * 줄은 단 우선으로 흐른다(CSS `grid-auto-flow: column`) — 줄 `i` 는 단 `⌊i / rows⌋` 의 `i % rows` 째.
 */
export interface LauncherArea {
  size: number;
  rect: LauncherRect;
  rows: number;
  cols: number;
}

export interface LauncherPos {
  area: number;
  index: number;
}

export type LauncherDir = "up" | "down" | "left" | "right";

const valid = (areas: readonly LauncherArea[], at: LauncherPos | null): at is LauncherPos =>
  at !== null && at.area >= 0 && at.area < areas.length && at.index >= 0 && at.index < areas[at.area].size;

export function firstLauncherPos(areas: readonly LauncherArea[]): LauncherPos | null {
  const i = areas.findIndex((a) => a.size > 0);
  return i < 0 ? null : { area: i, index: 0 };
}

const perCol = (a: LauncherArea) => Math.max(1, a.rows);
const usedCols = (a: LauncherArea) => Math.max(1, Math.ceil(a.size / perCol(a)));
const colLen = (a: LauncherArea, col: number) => Math.max(0, Math.min(perCol(a), a.size - col * perCol(a)));
const colCenter = (a: LauncherArea, col: number) => a.rect.x + ((col + 0.5) * a.rect.w) / Math.max(1, a.cols, usedCols(a));

const EPS = 0.5;

/** `layout.ts` 의 `neighborOfRect` 와 같은 셈에, ←→ 는 겹침이 없는 자유 배치를 위해 가운데끼리 가장 가까운 것으로 물러선다 */
function neighbour(areas: readonly LauncherArea[], from: number, dir: LauncherDir): number | null {
  const me = areas[from].rect;
  const horizontal = dir === "left" || dir === "right";
  const forward = dir === "right" || dir === "down";
  let best: { i: number; gap: number; overlap: number } | null = null;
  let loose: { i: number; dist: number } | null = null;
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (i === from || a.size === 0) continue;
    const o = a.rect;
    const gap = horizontal
      ? forward ? o.x - (me.x + me.w) : me.x - (o.x + o.w)
      : forward ? o.y - (me.y + me.h) : me.y - (o.y + o.h);
    if (gap < -EPS) continue;
    const overlap = horizontal
      ? Math.min(me.y + me.h, o.y + o.h) - Math.max(me.y, o.y)
      : Math.min(me.x + me.w, o.x + o.w) - Math.max(me.x, o.x);
    if (overlap > EPS) {
      if (!best || gap < best.gap - EPS || (gap <= best.gap + EPS && overlap > best.overlap)) best = { i, gap, overlap };
    } else if (horizontal) {
      const dist = Math.hypot(o.x + o.w / 2 - (me.x + me.w / 2), o.y + o.h / 2 - (me.y + me.h / 2));
      if (!loose || dist < loose.dist) loose = { i, dist };
    }
  }
  return best?.i ?? loose?.i ?? null;
}

function nearestCol(a: LauncherArea, x: number): number {
  let col = 0;
  for (let c = 1; c < usedCols(a); c++) if (Math.abs(colCenter(a, c) - x) < Math.abs(colCenter(a, col) - x)) col = c;
  return col;
}

/** 감싸지 않는다 — 더 갈 데가 없으면 제자리(호스트 · 프로젝트 독과 같은 감각) */
export function launcherMove(areas: readonly LauncherArea[], at: LauncherPos | null, dir: LauncherDir): LauncherPos | null {
  if (!valid(areas, at)) return firstLauncherPos(areas);
  const area = areas[at.area];
  const rows = perCol(area);
  const col = Math.floor(at.index / rows);
  const row = at.index % rows;

  if (dir === "up" || dir === "down") {
    if (dir === "up" && row > 0) return { area: at.area, index: at.index - 1 };
    if (dir === "down" && row < rows - 1 && at.index + 1 < area.size) return { area: at.area, index: at.index + 1 };
    const n = neighbour(areas, at.area, dir);
    if (n === null) return at;
    const t = areas[n];
    const tc = nearestCol(t, colCenter(area, col));
    const index = dir === "down" ? tc * perCol(t) : tc * perCol(t) + colLen(t, tc) - 1;
    return { area: n, index };
  }

  const step = dir === "right" ? 1 : -1;
  const side = col + step;
  if (side >= 0 && side < usedCols(area)) return { area: at.area, index: side * rows + Math.min(row, colLen(area, side) - 1) };
  const n = neighbour(areas, at.area, dir);
  if (n === null) return at;
  const t = areas[n];
  const tc = dir === "right" ? 0 : usedCols(t) - 1;
  return { area: n, index: tc * perCol(t) + Math.min(row, colLen(t, tc) - 1) };
}

// ── 타자 → 팔레트 ──

export interface TypedKey {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * 팔레트를 여는 타자면 미리 찍을 글자, 아니면 `null`. 스페이스는 고른 줄을 누르는 키라 아니다.
 * IME 조합 시작이면 `""` — 여기서는 열지 않는다. 조합 중에 포커스를 옮기면 조합이 취소되므로 팔레트는 `compositionstart` 에서 연다
 * (docs/log/2026-09-25-launcher.md).
 */
export function launcherSeed(ev: TypedKey): string | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  if (ev.isComposing || ev.key === "Process") return "";
  if (ev.key.length !== 1 || ev.key === " ") return null;
  return ev.key;
}

// ── 프로젝트 위젯 ──

const AGENT_RANK: Record<string, number> = { permission: 0, finished: 1, running: 2 };

/** 안정 정렬 — 점이 없는 것은 넘겨받은 순서 그대로 */
export function agentFirst<T>(list: readonly T[], statusOf: (item: T) => string | null): T[] {
  const rank = (item: T) => {
    const s = statusOf(item);
    return s === null ? 3 : (AGENT_RANK[s] ?? 3);
  };
  return list
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

// ── 팔레트의 자리 ──

/** 팔레트 덮개의 안쪽 여백(`--space-4`)과 같은 값 */
export const PALETTE_EDGE = 16;

/** `theme.css` 의 `--palette-w` 와 같은 값 */
export const PALETTE_W = 560;

/** 덮개 없이 떠 있을 때의 `max-height: 70vh` 와 같은 비율 */
export const PALETTE_MAX_VH = 0.7;

export const PALETTE_MIN_ROOM = 280;

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 창이 아니라 타일 캔버스 높이의 비율이다 — 시작 화면의 숨은 입력칸(IME 후보 창의 자리)도 같은 높이에 선다 */
export const PALETTE_CANVAS_TOP_RATIO = 0.12;

export function placeDefaultPalette(
  canvas: CanvasRect,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; width: number; maxHeight: number } {
  const width = Math.min(PALETTE_W, Math.max(0, viewportWidth - 2 * PALETTE_EDGE));
  const wantLeft = canvas.left + canvas.width / 2 - width / 2;
  const left = Math.max(PALETTE_EDGE, Math.min(wantLeft, viewportWidth - PALETTE_EDGE - width));
  const minRoom = Math.min(PALETTE_MIN_ROOM, Math.max(0, viewportHeight - 2 * PALETTE_EDGE));
  const wantTop = canvas.top + canvas.height * PALETTE_CANVAS_TOP_RATIO;
  const top = Math.max(PALETTE_EDGE, Math.min(wantTop, viewportHeight - PALETTE_EDGE - minRoom));
  const maxHeight = Math.max(0, Math.min(viewportHeight * PALETTE_MAX_VH, viewportHeight - PALETTE_EDGE - top));
  return { left, top, width, maxHeight };
}
