/**
 * **시작 화면 위젯 판의 규칙** — 순수 모듈 (docs/log/2026-10-28-start-widgets.md).
 *
 * 시작 화면(`StartPage.svelte`)은 고정된 세 단(최근 호스트 · 프로젝트 · 셸) 대신 **자유 배치 위젯 판**이다(2026-10-28 —
 * 목업 Vd194tKWh3tEUY1X3qi3uF). 위젯은 종류마다 하나까지, 겹치지 않고(서로 [`WIDGET_GAP`] 이상 떨어진다), 자리는
 * **판 가운데에서 잰 px**(`{ kind, x, y, w, h }` — x · y 는 왼쪽 위 모서리)라 창이 커져도 배치가 가운데에 그대로 선다.
 *
 * 여기 있는 것은 **좌표 셈뿐**이다 — 눈에 안 보이는 8px 격자 맞추기 · 부딪힘 · 가장 가까운 빈자리 · 맞춤 안내선 · 크기 죄기 ·
 * 처음 배치 · 작은 창의 축소 배율 · 좁은 판의 한 줄 쌓기 · 저장 글자의 해석/검증. 반응형 상태와 localStorage 왕복은 `start-widgets.svelte.ts`,
 * 그림 · 포인터는 `StartPage.svelte`. 이 저장소의 vitest 는 `environment: "node"` 라 테스트가 닿는 자리는 순수 모듈뿐이다
 * (`favorites.ts` · `launcher.ts` 와 같은 나눔).
 *
 * 격자는 **그리지 않는다**(점 격자는 사용자가 목업에서 물렸다) — 끌기 · 크기 바꾸기가 놓이는 자리만 8px 에 맞춘다.
 */

import {
  clampClockFont,
  clockBoxSize,
  DEFAULT_CLOCK_OPTIONS,
  normalizeClockOptions,
  type ClockOptions,
} from "$lib/start-clock";

export type StartWidgetKind = "clock" | "hosts" | "projects" | "shells";

/**
 * 위젯 종류 — 처음 배치 · 추가 메뉴의 순서. 시계(2026-11-03)만 **고를 줄이 없는** 위젯이다 — 키보드 선택은 그 위를
 * 건너뛴다(`launcher.ts` 는 줄이 0 인 구역을 지나친다). 박스가 글자를 꼭 감싸고 크기 모서리는 글자 크기를 바꾼다
 * ([`clampClockResize`] · 박스 셈은 `start-clock.ts` 의 `clockBoxSize`). 정리 · 처음 배치에서는 **늘 혼자 한 줄**이다(`splitRows`).
 */
export const START_WIDGET_KINDS: readonly StartWidgetKind[] = ["clock", "hosts", "projects", "shells"];

/** 판 위의 사각형 — 판 가운데가 (0, 0), x · y 는 왼쪽 위 모서리(px, 축소 배율 적용 전) */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StartWidget extends Box {
  kind: StartWidgetKind;
}

/** 놓이는 자리의 눈금(px) — 보이지 않는다 */
export const GRID = 8;
/** 위젯 사이에 늘 남는 틈 — 끌어 놓기 · 크기 바꾸기 · 정리가 모두 이 틈을 지킨다 */
export const WIDGET_GAP = 16;
/** 다른 위젯의 변 · 가운데와 이만큼 가까우면 거기에 붙이고 안내선을 긋는다 */
export const ALIGN_TOLERANCE = 6;
/** 작은 창에서 배치를 줄일 때 판 가장자리에 남기는 여백 */
export const FIT_PADDING = 16;
/**
 * 축소 배율의 바닥 — 이보다 더 줄여야 들어가면 줄이지 않고 **좁은 판**(한 줄로 쌓아 세로로 굴린다 — [`narrowStack`])으로 그린다.
 * 판 크기는 창이 아니라 시작 **타일**이라 탭을 나누면 판이 반으로 줄고 배율이 0.5 언저리까지 내려간다.
 *
 * 2026-10-29 에는 0.75(13px 글자가 10px 근처)였다. 2026-11-03 사용자 결정으로 **0.5** — "스크롤이 생기는 게 별로" 라 쌓아 굴리는
 * 좁은 판을 덜 쓰고 더 줄인다. 0.5 면 13px 글자가 약 6.5px 라 작다는 것을 **알고 받은** 선택이다. 누르는 부품(× · 크기 모서리)은
 * 배율과 상관없이 너무 작아지지 않게 역배율로 바닥을 지킨다(`StartWidgetFrame` 의 `--start-scale`).
 */
export const MIN_FIT_SCALE = 0.5;

// ── 위젯 안의 치수 — `StartWidgetFrame.svelte` 의 CSS 와 같은 값이다(같이 바꾼다) ─────────────
/** 머리 줄(위 여백 8 + 줄 32) */
export const WIDGET_HEADER_H = 40;
/** 줄 높이 — 고르는 자리라 메뉴(28)보다 한 숨 넉넉하다(예전 세 단과 같은 값) */
export const WIDGET_ROW_H = 32;
/** 몸통의 좌우 · 아래 여백 */
export const WIDGET_PAD = 8;
/** 두 단으로 흐를 때 단 사이 */
export const WIDGET_COL_GAP = 8;
/** 이 폭부터 줄이 두 단으로 흐른다 */
export const TWO_COLUMN_MIN_W = 384;

/** 종류마다 가장 작은 크기 — 목록은 머리 줄 + 두 줄은 보이게. 시계는 가장 작은 글자의 박스 아래로(저장값 검증용 바닥) */
export const WIDGET_MIN: Readonly<Record<StartWidgetKind, { w: number; h: number }>> = {
  clock: { w: 64, h: 40 },
  hosts: { w: 176, h: 112 },
  projects: { w: 200, h: 112 },
  shells: { w: 176, h: 112 },
};
/** 가장 큰 크기 — 한 위젯이 판을 통째로 덮지 않게 */
export const WIDGET_MAX_W = 960;
export const WIDGET_MAX_H = 720;
/** 새로 놓는 위젯 · 처음 배치의 크기 — 다섯 줄(예전 세 단의 상한과 같다) */
export const WIDGET_DEFAULT_SIZE = { w: 240, h: 208 };
/**
 * 종류마다 새로 놓는 · 처음 배치의 크기. 시계는 처음 표시(한국어 · 24시간 · 날짜 · 88px)의 박스 — 언어 · 표시가 다르면
 * `StartPage` 가 곧바로 그 박스로 다시 맞춘다([`withWidgetSize`]).
 */
export function widgetDefaultSize(kind: StartWidgetKind): { w: number; h: number } {
  return kind === "clock" ? clockBoxSize("ko", DEFAULT_CLOCK_OPTIONS) : { ...WIDGET_DEFAULT_SIZE };
}

/** 처음 배치 — 한 줄의 폭 상한(넘으면 다음 줄로 · 지금 처음 배치는 목록 셋 752 라 닿지 않는다 — 위젯이 늘 때의 그물) */
export const LAYOUT_MAX_ROW_W = 1024;
/** 처음 배치 — 덩어리가 세로 가운데보다 이만큼 위에 선다(출발점은 눈이 먼저 닿는 위 · 좁은 판에서 더하는 자리도 이 높이) */
export const LAYOUT_LIFT = 48;

export const snapToGrid = (v: number): number => Math.round(v / GRID) * GRID;

/** 이 폭의 위젯이 줄을 몇 단으로 흘리나 */
export function widgetColumns(w: number): 1 | 2 {
  return w >= TWO_COLUMN_MIN_W ? 2 : 1;
}

/** 이 높이의 위젯에서 한 단에 보이는 줄 수 — 안에서 굴리지 않는다(넘치는 줄은 세우지 않는다) */
export function widgetRowsPerColumn(h: number): number {
  return Math.max(0, Math.floor((h - WIDGET_HEADER_H - WIDGET_PAD) / WIDGET_ROW_H));
}

/** 이 크기의 위젯에 보이는 줄 수(단 수 × 단의 줄 수) — 목록을 이만큼만 세운다 */
export function widgetCapacity(w: number, h: number): number {
  return widgetRowsPerColumn(h) * widgetColumns(w);
}

// ---------------------------------------------------------------------------
// 부딪힘 · 빈자리
// ---------------------------------------------------------------------------

/** 두 사각형이 `gap` 보다 가까운가(겹치면 물론) — 딱 `gap` 만큼 떨어진 것은 괜찮다 */
export function boxesCollide(a: Box, b: Box, gap = WIDGET_GAP): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** `box` 가 `others` 누구와도 부딪히지 않는가 */
export function isFree(box: Box, others: readonly Box[], gap = WIDGET_GAP): boolean {
  return others.every((o) => !boxesCollide(box, o, gap));
}

/** 판의 경계(판 가운데 기준 px) — 끌어 놓은 자리가 화면 밖으로 나가지 않게 */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inside = (b: Box, bounds: Bounds) =>
  b.x >= bounds.left && b.y >= bounds.top && b.x + b.w <= bounds.right && b.y + b.h <= bounds.bottom;

/** 경계 안으로 민다 — 경계보다 큰 축은 왼쪽 · 위에 맞춘다(넘치는 쪽은 축소 배율이 맡는다) */
export function clampInto(box: Box, bounds: Bounds): Box {
  const x = Math.max(bounds.left, Math.min(box.x, bounds.right - box.w));
  const y = Math.max(bounds.top, Math.min(box.y, bounds.bottom - box.h));
  return { ...box, x, y };
}

/**
 * **가장 가까운 빈자리** — `box` 그 자리가 비었으면 그대로, 아니면 격자 눈금만큼씩 바깥으로 넓혀 가며 찾는다
 * (체비쇼프 고리 r 에서 처음 찾으면 r·√2 고리까지 더 보고 유클리드 거리가 가장 짧은 것 — 고리 순서만 믿으면 대각선이 앞선다).
 * `bounds` 가 있으면 그 안의 자리를 먼저 찾고, 없을 때만 경계를 넘는다. 끝내 못 찾으면 원래 자리(부르는 쪽이 판정한다).
 */
export function nearestFreeSpot(box: Box, others: readonly Box[], bounds: Bounds | null = null, maxSteps = 160): Box {
  if (isFree(box, others) && (!bounds || inside(box, bounds))) return box;
  const search = (useBounds: boolean): Box | null => {
    // 닫힘 안에서 바꾸므로 칸 하나에 담는다(지역 `let` 이면 TS 의 흐름 좁히기가 `null` 로 굳힌다)
    const found: { box: Box | null; d: number } = { box: null, d: Infinity };
    let limit = maxSteps;
    const consider = (i: number, j: number) => {
      const c = { ...box, x: box.x + i * GRID, y: box.y + j * GRID };
      if (useBounds && bounds && !inside(c, bounds)) return;
      if (!isFree(c, others)) return;
      const d = i * i + j * j;
      if (d < found.d) {
        found.d = d;
        found.box = c;
      }
    };
    for (let r = 1; r <= limit; r++) {
      // 고리의 둘레만 돈다(위 · 아래 변, 그다음 좌 · 우 변의 나머지) — 끄는 동안 포인터마다 불리므로 안을 다시 훑지 않는다
      for (let i = -r; i <= r; i++) {
        consider(i, -r);
        consider(i, r);
      }
      for (let j = -r + 1; j <= r - 1; j++) {
        consider(-r, j);
        consider(r, j);
      }
      // 첫 후보를 찾은 고리 r 에서 √2·r 고리까지만 더 본다 — 그 밖은 지금 후보보다 멀 수밖에 없다
      if (found.box && limit === maxSteps) limit = Math.min(maxSteps, Math.ceil(r * Math.SQRT2));
    }
    return found.box;
  };
  return (bounds && search(true)) || (isFree(box, others) ? box : search(false)) || box;
}

// ---------------------------------------------------------------------------
// 맞춤 안내선
// ---------------------------------------------------------------------------

/** 점선 안내선 하나 — `axis:"x"` 는 세로선(x = at, y 가 from~to), `"y"` 는 가로선 */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

const xLines = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const yLines = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/** 한 축에서 `tol` 안의 가장 가까운 맞춤까지의 차(없으면 0) */
function bestDelta(mine: number[], theirs: number[], tol: number): number {
  let best = 0;
  let bestAbs = Infinity;
  for (const m of mine)
    for (const t of theirs) {
      const d = t - m;
      if (Math.abs(d) <= tol && Math.abs(d) < bestAbs) {
        best = d;
        bestAbs = Math.abs(d);
      }
    }
  return best;
}

/** 다른 위젯의 변 · 가운데에서 `tol` 안이면 그리로 붙인다(축마다 따로) */
export function alignToNeighbours(box: Box, others: readonly Box[], tol = ALIGN_TOLERANCE): Box {
  const xs = others.flatMap(xLines);
  const ys = others.flatMap(yLines);
  return { ...box, x: box.x + bestDelta(xLines(box), xs, tol), y: box.y + bestDelta(yLines(box), ys, tol) };
}

/** `box` 의 변 · 가운데가 다른 위젯과 **딱 맞는** 줄들 — 두 상자를 잇는 길이로 긋는다(같은 선은 하나로) */
export function guidesFor(box: Box, others: readonly Box[]): Guide[] {
  const out: Guide[] = [];
  const add = (g: Guide) => {
    const prev = out.find((o) => o.axis === g.axis && o.at === g.at);
    if (!prev) {
      out.push(g);
      return;
    }
    prev.from = Math.min(prev.from, g.from);
    prev.to = Math.max(prev.to, g.to);
  };
  for (const o of others) {
    for (const m of xLines(box))
      for (const t of xLines(o))
        if (Math.abs(m - t) < 0.5)
          add({ axis: "x", at: m, from: Math.min(box.y, o.y), to: Math.max(box.y + box.h, o.y + o.h) });
    for (const m of yLines(box))
      for (const t of yLines(o))
        if (Math.abs(m - t) < 0.5)
          add({ axis: "y", at: m, from: Math.min(box.x, o.x), to: Math.max(box.x + box.w, o.x + o.w) });
  }
  return out;
}

/**
 * **끄는 동안의 셈** — 원래 자리 `orig` 에서 `(dx, dy)`(판 좌표 — 부르는 쪽이 축소 배율로 이미 나눴다)만큼 옮겼을 때
 *  · `landing` — 놓으면 설 자리: 격자에 맞추고 → 이웃 변 · 가운데에 붙이고 → 경계 안으로 → 부딪히면 가장 가까운 빈자리
 *  · `guides` — 그 자리가 이웃과 맞는 줄(점선)
 * 끄는 위젯 자신은 포인터를 그대로 따라간다(`transform` 만) — 이 셈은 점선 윤곽과 안내선에만 쓴다.
 */
export function dragLanding(
  orig: Box,
  dx: number,
  dy: number,
  others: readonly Box[],
  bounds: Bounds | null,
): { landing: Box; guides: Guide[] } {
  let target: Box = { ...orig, x: snapToGrid(orig.x + dx), y: snapToGrid(orig.y + dy) };
  target = alignToNeighbours(target, others);
  if (bounds) target = clampInto(target, bounds);
  const landing = nearestFreeSpot(target, others, bounds);
  return { landing, guides: guidesFor(landing, others) };
}

// ---------------------------------------------------------------------------
// 크기 바꾸기 (오른쪽 아래 모서리)
// ---------------------------------------------------------------------------

/**
 * 모서리를 끌어 원하는 크기 `(wantW, wantH)` → 실제 크기. 격자에 맞추고, 종류의 최소 · 최대 안으로, **커지다 이웃의 변
 * ([`WIDGET_GAP`] 앞)에서 멈춘다** — 폭은 지금 높이에서 오른쪽 이웃까지, 높이는 새 폭에서 아래 이웃까지(대각선의 이웃도
 * 새 폭과 가로로 겹치면 높이가 멈춘다). `bounds` 가 있으면 그 오른쪽 · 아래도 넘지 않는다. 지금 크기는 언제나 들어간다
 * (지금 배치가 부딪히지 않으므로) — 그래서 줄어드는 쪽은 최소에서만 멈춘다.
 */
export function clampResize(
  orig: StartWidget,
  wantW: number,
  wantH: number,
  others: readonly Box[],
  bounds: Bounds | null = null,
): Box {
  const min = WIDGET_MIN[orig.kind];
  let limitW = WIDGET_MAX_W;
  for (const o of others) {
    const vOverlap = o.y < orig.y + orig.h + WIDGET_GAP && orig.y < o.y + o.h + WIDGET_GAP;
    if (vOverlap && o.x >= orig.x + orig.w) limitW = Math.min(limitW, o.x - WIDGET_GAP - orig.x);
  }
  if (bounds) limitW = Math.min(limitW, Math.floor((bounds.right - orig.x) / GRID) * GRID);
  const w = Math.max(min.w, Math.min(snapToGrid(wantW), Math.max(limitW, orig.w)));

  let limitH = WIDGET_MAX_H;
  for (const o of others) {
    const hOverlap = o.x < orig.x + w + WIDGET_GAP && orig.x < o.x + o.w + WIDGET_GAP;
    if (hOverlap && o.y >= orig.y + orig.h) limitH = Math.min(limitH, o.y - WIDGET_GAP - orig.y);
  }
  if (bounds) limitH = Math.min(limitH, Math.floor((bounds.bottom - orig.y) / GRID) * GRID);
  const h = Math.max(min.h, Math.min(snapToGrid(wantH), Math.max(limitH, orig.h)));
  return { x: orig.x, y: orig.y, w, h };
}

// ---------------------------------------------------------------------------
// 처음 배치 · 더하기 · 빼기
// ---------------------------------------------------------------------------

/** 읽는 순서 — 세로로 겹치는 것끼리 한 줄(띠)로 묶고 띠 안은 왼쪽부터(좁은 판의 쌓는 순서 — [`narrowStack`]) */
export function readingOrder<T extends Box>(list: readonly T[]): T[] {
  const byTop = [...list].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const bands: T[][] = [];
  let bottom = -Infinity;
  for (const b of byTop) {
    const mid = b.y + b.h / 2;
    if (bands.length > 0 && mid <= bottom) {
      bands[bands.length - 1].push(b);
      bottom = Math.max(bottom, b.y + b.h);
    } else {
      bands.push([b]);
      bottom = b.y + b.h;
    }
  }
  return bands.flatMap((band) => band.sort((a, b) => a.x - b.x));
}

/**
 * 주어진 순서 그대로 줄을 채운다(처음 배치의 셈) — 한 줄 폭이 [`LAYOUT_MAX_ROW_W`] 를 넘으면 다음 줄, 줄은 가로 가운데 · 위 맞춤,
 * 덩어리 전체는 세로 가운데보다 [`LAYOUT_LIFT`] 위. 크기는 건드리지 않는다. **시계는 혼자 한 줄**이다 — 낮은 글자 줄이 목록 카드
 * 옆에 위 맞춤으로 붙으면 들쭉날쭉하다(위 줄 시계 · 아래 줄 목록 셋).
 */
function packRows(list: readonly StartWidget[]): StartWidget[] {
  const rows: StartWidget[][] = [];
  let width = 0;
  for (const w of list) {
    const row = rows[rows.length - 1];
    const alone = w.kind === "clock" || row?.[0]?.kind === "clock";
    if (row && !alone && width + WIDGET_GAP + w.w <= LAYOUT_MAX_ROW_W) {
      row.push(w);
      width += WIDGET_GAP + w.w;
    } else {
      rows.push([w]);
      width = w.w;
    }
  }
  const heights = rows.map((r) => Math.max(...r.map((w) => w.h)));
  const total = heights.reduce((a, h) => a + h, 0) + WIDGET_GAP * Math.max(0, rows.length - 1);
  let y = snapToGrid(-total / 2 - LAYOUT_LIFT);
  const out: StartWidget[] = [];
  rows.forEach((row, i) => {
    const rowW = row.reduce((a, w) => a + w.w, 0) + WIDGET_GAP * (row.length - 1);
    let x = snapToGrid(-rowW / 2);
    for (const w of row) {
      out.push({ ...w, x, y });
      x += w.w + WIDGET_GAP;
    }
    y += heights[i] + WIDGET_GAP;
  });
  return out;
}

/**
 * **처음 배치** — 위 줄에 시계, 아래 줄에 목록 위젯 셋이 나란히(예전 세 단처럼), 덩어리는 가운데에서 조금 위
 * (`packRows` — 시계는 혼자 한 줄).
 */
export function defaultStartWidgets(): StartWidget[] {
  return packRows(START_WIDGET_KINDS.map((kind) => ({ kind, x: 0, y: 0, ...widgetDefaultSize(kind) })));
}

/** 종류 하나를 `at`(판 좌표 — 우클릭한 자리) 가까운 빈자리에 더한다. 이미 있으면 목록 그대로 */
export function withNewWidget(
  list: readonly StartWidget[],
  kind: StartWidgetKind,
  at: { x: number; y: number },
  bounds: Bounds | null = null,
): StartWidget[] {
  if (list.some((w) => w.kind === kind)) return [...list];
  const { w, h } = widgetDefaultSize(kind);
  let box: Box = { x: snapToGrid(at.x - w / 2), y: snapToGrid(at.y - h / 2), w, h };
  if (bounds) box = clampInto(box, bounds);
  return [...list, { kind, ...nearestFreeSpot(box, list, bounds) }];
}

export function withoutWidget(list: readonly StartWidget[], kind: StartWidgetKind): StartWidget[] {
  return list.filter((w) => w.kind !== kind);
}

/**
 * 한 위젯의 **크기만** 바꾼다(시계 — 표시 · 언어가 바뀌어 박스가 달라졌다). 가운데를 지키고 눈금에 맞춘 뒤, 다른 위젯과 부딪히면
 * 기존 규칙대로 **그 위젯이** 가장 가까운 빈자리로 비켜 선다(다른 위젯은 밀지 않는다 — 끌어 놓기 · 더하기와 같은 규칙).
 */
export function withWidgetSize(
  list: readonly StartWidget[],
  kind: StartWidgetKind,
  size: { w: number; h: number },
  bounds: Bounds | null = null,
): StartWidget[] {
  const cur = list.find((w) => w.kind === kind);
  if (!cur) return [...list];
  let box: Box = {
    x: snapToGrid(cur.x + cur.w / 2 - size.w / 2),
    y: snapToGrid(cur.y + cur.h / 2 - size.h / 2),
    w: size.w,
    h: size.h,
  };
  if (bounds) box = clampInto(box, bounds);
  return withWidgetBox(list, kind, nearestFreeSpot(box, othersOf(list, kind), bounds));
}

const othersOf = (list: readonly StartWidget[], kind: StartWidgetKind) => list.filter((w) => w.kind !== kind);

/**
 * **시계의 크기 모서리** — 박스가 아니라 **글자 크기**를 바꾼다. 모서리를 끈 만큼(폭 · 높이 늘어난 합의 비율)으로 글자 크기를
 * 늘리고 줄여 범위 안으로 죄고, 박스(`boxOf` — 지금 표시 · 언어의 `clockBoxSize`)는 왼쪽 위를 지킨 채 따라간다. 커지다 이웃
 * ([`WIDGET_GAP`] 앞) · 경계에 닿으면 들어가는 데까지만 — 지금 크기는 언제나 들어간다.
 */
export function clampClockResize(
  orig: StartWidget,
  origFont: number,
  wantW: number,
  wantH: number,
  others: readonly Box[],
  bounds: Bounds | null,
  boxOf: (font: number) => { w: number; h: number },
): { font: number; box: Box } {
  const ratio = (Math.max(1, wantW) + Math.max(1, wantH)) / Math.max(1, orig.w + orig.h);
  let font = clampClockFont(origFont * ratio);
  const fits = (f: number) => {
    const b = { x: orig.x, y: orig.y, ...boxOf(f) };
    return isFree(b, others) && (!bounds || (b.x + b.w <= bounds.right && b.y + b.h <= bounds.bottom));
  };
  while (font > origFont && !fits(font)) font--;
  return { font, box: { x: orig.x, y: orig.y, ...boxOf(font) } };
}

/** 한 위젯의 자리 · 크기를 바꾼 목록 */
export function withWidgetBox(list: readonly StartWidget[], kind: StartWidgetKind, box: Box): StartWidget[] {
  return list.map((w) => (w.kind === kind ? { kind, x: box.x, y: box.y, w: box.w, h: box.h } : w));
}

// ---------------------------------------------------------------------------
// 작은 창 — 통째로 줄인다
// ---------------------------------------------------------------------------

/**
 * 배치 전체의 축소 배율 — 판 가운데를 중심으로 `transform: scale()` 한다. 위젯들의 바깥 상자(+[`FIT_PADDING`])가 판에 들어가면 1,
 * 아니면 들어갈 만큼만 줄인다. **키우지 않고, 굴리지도 않고, 다시 흘리지도(쌓지도) 않는다.** 다만 판은 창이 아니라 시작 타일이라
 * 배율이 얼마든 내려갈 수 있어, [`MIN_FIT_SCALE`] 아래면 부르는 쪽이 줄이는 대신 좁은 판([`narrowStack`])으로 그린다
 * ([`isNarrowBoard`]). 위젯이 없거나 판을 아직 못 쟀으면 1.
 */
export function fitScale(list: readonly Box[], boardW: number, boardH: number, pad = FIT_PADDING): number {
  if (list.length === 0 || boardW <= 0 || boardH <= 0) return 1;
  let hx = 0;
  let hy = 0;
  for (const b of list) {
    hx = Math.max(hx, Math.abs(b.x), Math.abs(b.x + b.w));
    hy = Math.max(hy, Math.abs(b.y), Math.abs(b.y + b.h));
  }
  const sx = hx > 0 ? (boardW / 2 - pad) / hx : 1;
  const sy = hy > 0 ? (boardH / 2 - pad) / hy : 1;
  return Math.max(0.05, Math.min(1, sx, sy));
}

/**
 * 이 배율에서 판이 보여 주는 판 좌표의 경계(여백 안) — 끌어 놓기 · 크기 바꾸기 · 더하기가 이 안에 머문다.
 * 경계는 **눈금 안쪽으로 내린다** — 경계에 밀려 붙은 위젯이 눈금에서 어긋나면 이웃 사이의 딱 맞는 틈(예: 240 폭이 꼭 들어가는
 * 256 틈)에 다시는 못 들어간다(빈자리 찾기가 눈금 단위로 움직이므로).
 */
export function boardBounds(boardW: number, boardH: number, scale: number, pad = FIT_PADDING): Bounds | null {
  if (boardW <= 0 || boardH <= 0 || scale <= 0) return null;
  const hx = Math.floor((boardW / (2 * scale) - pad) / GRID) * GRID;
  const hy = Math.floor((boardH / (2 * scale) - pad) / GRID) * GRID;
  return { left: -hx, top: -hy, right: hx, bottom: hy };
}

// ---------------------------------------------------------------------------
// 좁은 판 — 줄이면 못 읽을 만큼 작으면 한 줄로 쌓는다
// ---------------------------------------------------------------------------

/**
 * 이 판이 **좁은 판**인가 — 배치를 [`MIN_FIT_SCALE`] 아래로 줄여야 들어갈 때. 그 사이(0.5 ~ 1)는 예전처럼 줄인다.
 * 위젯이 없거나 판을 아직 못 쟀으면 아니다(`fitScale` 이 1).
 */
export function isNarrowBoard(list: readonly Box[], boardW: number, boardH: number, pad = FIT_PADDING): boolean {
  return fitScale(list, boardW, boardH, pad) < MIN_FIT_SCALE;
}

/**
 * **좁은 판의 그림 배치** — 저장된 배치를 읽는 순서([`readingOrder`])대로 한 줄로 쌓는다. **그리기 전용**이다 — 저장된 배치는
 * 건드리지 않는다(판이 다시 넓어지면 그 배치가 그대로 돌아온다).
 *
 * 좌표는 판 가운데 기준이 아니라 **굴리는 내용의 왼쪽 위**가 (0, 0) 이다(좁은 판은 세로로 굴리므로 — 내용 높이 `height` 가 곧
 * 굴림 높이). 카드는 가로 가운데, 위 · 아래 여백 `pad`, 사이는 [`WIDGET_GAP`]. 폭은 저장된 폭과 판 폭(− 양옆 `pad`) 중 작은 것 —
 * 종류의 최소 폭 아래로는 줄이지 않되, 판이 그보다 좁으면 판 폭(− 여백)에 맞춘다(가로로는 굴리지 않는다). 높이는 저장된 그대로
 * (줄 수는 부르는 쪽이 같은 `widgetCapacity` 로 센다 — 폭이 줄어 두 단이 한 단이 될 수 있다).
 * `boardH` 를 주면 쌓은 덩어리가 판보다 낮을 때 세로 가운데에 선다(높으면 위에서부터).
 */
export function narrowStack(
  list: readonly StartWidget[],
  boardW: number,
  boardH = 0,
  pad = FIT_PADDING,
): { boxes: StartWidget[]; height: number } {
  if (list.length === 0) return { boxes: [], height: 0 };
  const avail = Math.max(0, boardW - 2 * pad);
  const sized = readingOrder(list).map((w) => {
    const min = WIDGET_MIN[w.kind].w;
    const width = avail >= min ? Math.max(min, Math.min(w.w, avail)) : avail;
    return { ...w, w: width };
  });
  const stackH = sized.reduce((a, w) => a + w.h, 0) + WIDGET_GAP * (sized.length - 1);
  let y = Math.max(pad, Math.floor((boardH - stackH) / 2));
  const boxes = sized.map((w) => {
    const box = { ...w, x: Math.floor((boardW - w.w) / 2), y };
    y += w.h + WIDGET_GAP;
    return box;
  });
  return { boxes, height: y - WIDGET_GAP + pad };
}

// ---------------------------------------------------------------------------
// 저장 글자
// ---------------------------------------------------------------------------

/** 저장 글자의 판 — 모양이 바뀌면 올리고, 모르는 판은 처음 배치로 */
const FORMAT_VERSION = 1;

const isKind = (v: unknown): v is StartWidgetKind => typeof v === "string" && (START_WIDGET_KINDS as readonly string[]).includes(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 배치가 규칙을 지키는가 — 종류는 하나씩 · 크기는 최소 ~ 최대 · 서로 부딪히지 않는다 */
export function layoutValid(list: readonly StartWidget[]): boolean {
  const kinds = new Set<string>();
  for (const w of list) {
    if (!isKind(w.kind) || kinds.has(w.kind)) return false;
    kinds.add(w.kind);
    if (![w.x, w.y, w.w, w.h].every(num)) return false;
    const min = WIDGET_MIN[w.kind];
    if (w.w < min.w || w.h < min.h || w.w > WIDGET_MAX_W || w.h > WIDGET_MAX_H) return false;
  }
  return list.every((w, i) => list.every((o, j) => i === j || !boxesCollide(w, o)));
}

/**
 * localStorage 의 글자 → 배치. **`null` = 처음 배치를 써라**(저장된 적 없음 · 깨진 글자 · 모르는 판 · 규칙 위반 — 조용히 물러선다).
 * 빈 배열은 뜻이 있다(사용자가 위젯을 다 뺐다 — 빈 판 안내가 선다).
 */
export function parseStartWidgets(raw: string | null): StartWidget[] | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { v, widgets } = data as { v?: unknown; widgets?: unknown };
  if (v !== FORMAT_VERSION) return null;
  return parseStartWidgetList(widgets);
}

/**
 * 위젯 목록 한 벌(이미 JSON 을 푼 값) → 배치. 모양이 틀리거나 규칙을 어기면 `null` — localStorage 글자([`parseStartWidgets`])와
 * 모양 프로필의 시작 화면 칸(`theme-profiles.ts` 의 `startBoard`)이 같은 그물을 지난다.
 */
export function parseStartWidgetList(widgets: unknown): StartWidget[] | null {
  if (!Array.isArray(widgets)) return null;
  const list: StartWidget[] = [];
  for (const item of widgets) {
    if (typeof item !== "object" || item === null) return null;
    const { kind, x, y, w, h } = item as Record<string, unknown>;
    if (!isKind(kind) || !num(x) || !num(y) || !num(w) || !num(h)) return null;
    list.push({ kind, x, y, w, h });
  }
  return layoutValid(list) ? list : null;
}

/** 위젯 목록을 저장할 모양으로(칸 순서 고정 — 같은 배치면 같은 글자) */
export const plainStartWidgets = (list: readonly StartWidget[]): StartWidget[] =>
  list.map(({ kind, x, y, w, h }) => ({ kind, x, y, w, h }));

// ---------------------------------------------------------------------------
// 시작 화면 한 벌 — 배치 + 시계 표시 (모양 프로필이 담는다 — 2026-11-03)
// ---------------------------------------------------------------------------

/** 시작 화면 한 벌 — 모양 프로필마다 담기는 칸(`theme-profiles.ts` 의 `ThemeProfile.startBoard`) */
export interface StartBoardSnapshot {
  widgets: StartWidget[];
  clock: ClockOptions;
}

/** 두 벌이 같은가 — 칸을 직접 견준다(순서까지 — 배치는 순서가 곧 그리는 순서다) */
export function sameStartBoard(a: StartBoardSnapshot, b: StartBoardSnapshot): boolean {
  return (
    a.widgets.length === b.widgets.length &&
    a.widgets.every((w, i) => {
      const o = b.widgets[i];
      return w.kind === o.kind && w.x === o.x && w.y === o.y && w.w === o.w && w.h === o.h;
    }) &&
    a.clock.hour12 === b.clock.hour12 &&
    a.clock.seconds === b.clock.seconds &&
    a.clock.date === b.clock.date &&
    a.clock.size === b.clock.size
  );
}

/** 파일에서 온 한 벌 — 배치가 깨졌으면 통째로 없음(`undefined` — 그 프로필은 배치를 안 담은 것처럼), 시계 표시는 칸마다 고친다 */
export function parseStartBoard(raw: unknown): StartBoardSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { widgets, clock } = raw as Record<string, unknown>;
  const list = parseStartWidgetList(widgets);
  if (!list) return undefined;
  return { widgets: list, clock: normalizeClockOptions(clock) };
}

// ---------------------------------------------------------------------------
// 되돌리기 기록 (2026-11-03) — 판 메뉴 · 편집 단추 줄의 [되돌리기]
//
// 사람이 배치를 바꾼 조작(옮기기 · 크기 — 시계 글자 크기 포함 · 더하기 · 빼기 · 처음 배치로)마다 **바꾸기 전** 한 벌을 쌓고,
// [되돌리기]는 맨 위 하나를 꺼내 그 상태로 돌린다(여러 번 누르면 차례로 더 앞으로 · 다시 실행은 없다). 시계 표시 옵션(12/24 · 초 ·
// 날짜)은 **기록하지 않는다** — 메뉴에서 바로 다시 고를 수 있고, 되돌리기가 옵션까지 바꾸면 "배치를 되돌렸는데 시계 모양이 바뀌었다"
// 가 된다. 그래서 되돌릴 때 시계 옵션은 **지금 것을 두고 글자 크기만** 그때로 — 단 지운 시계를 되살릴 때는 그때의 표시 전부(지우기 되돌리기
// 규칙). 박스 크기는 시작 화면이 지금 표시로 다시 맞춘다(옵션을 바꿔 시계가 비켜 섰어도 되돌린 자리에서 가운데를 지켜 맞춘다).
// ---------------------------------------------------------------------------

/** 쌓아 두는 최대 개수 — 넘치면 가장 오래된 것부터 버린다 */
export const START_UNDO_MAX = 20;

/** 되돌리기 기록에서 "배치가 바뀌었나" — 위젯 배치와 시계 글자 크기만 본다(옵션은 머리말대로 제외) */
export function boardChangedForUndo(before: StartBoardSnapshot, after: StartBoardSnapshot): boolean {
  return !sameStartBoard(before, { widgets: after.widgets, clock: { ...before.clock, size: after.clock.size } });
}

/** 기록에 한 벌을 쌓는다(새 배열 · 상한) */
export function pushUndo(stack: readonly StartBoardSnapshot[], before: StartBoardSnapshot): StartBoardSnapshot[] {
  return [...stack, plainStartBoard(before)].slice(-START_UNDO_MAX);
}

/**
 * 맨 위 한 벌로 되돌린 결과 — `null` 이면 되돌릴 것이 없다. 시계 옵션은 지금 것 + 그때의 글자 크기, 다만 지금 판에 시계가 없고 그때는
 * 있었으면(지운 시계를 되살린다) 그때의 표시 전부.
 */
export function popUndo(
  stack: readonly StartBoardSnapshot[],
  now: StartBoardSnapshot,
): { board: StartBoardSnapshot; stack: StartBoardSnapshot[] } | null {
  const top = stack[stack.length - 1];
  if (!top) return null;
  const revive = top.widgets.some((w) => w.kind === "clock") && !now.widgets.some((w) => w.kind === "clock");
  const clock = revive ? { ...top.clock } : { ...now.clock, size: top.clock.size };
  return { board: plainStartBoard({ widgets: top.widgets, clock }), stack: stack.slice(0, -1) };
}

/** 저장할 모양으로 — 칸 순서 고정 */
export function plainStartBoard(b: StartBoardSnapshot): StartBoardSnapshot {
  const { hour12, seconds, date, size } = b.clock;
  return { widgets: plainStartWidgets(b.widgets), clock: { hour12, seconds, date, size } };
}

export function serializeStartWidgets(list: readonly StartWidget[]): string {
  return JSON.stringify({
    v: FORMAT_VERSION,
    widgets: list.map(({ kind, x, y, w, h }) => ({ kind, x, y, w, h })),
  });
}
