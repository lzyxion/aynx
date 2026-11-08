/**
 * 패널 트리 → **화면 기하**. 순수 계산만 있고 DOM 도 반응성도 없다.
 *
 * 원래 `SplitView.svelte` 안에 있던 것을 모듈로 꺼냈다. 이유는 하나다 —
 * 이제 **패널 상자(터미널)와 분할선이 서로 다른 컴포넌트**에서 그려지기 때문이다
 * (`PaneHost.svelte` 가 전 탭의 패널을 한 목록으로 그리고, `SplitView.svelte` 는
 * 한 탭의 분할선 레이어만 그린다). 둘이 **같은 함수로 같은 사각형**을 얻어야
 * 어긋나지 않는다. docs/log/2026-09-02-pane-host.md
 */

import {
  clampRatio,
  type PaneNode,
  type PaneSpec,
  type PaneSide,
  type PaneSplit,
  type SplitDir,
} from "$lib/session";

/**
 * 분할선의 두께이자 패널(타일) 사이의 실제 간격(px).
 * theme.css 의 `--gap` 토큰과 **같은 값**이어야 타일 사이 거터와 창 가장자리 여백이 맞는다.
 */
export const GAP = 8;

/** `calc(<pct>% + <px>px)` 로 펴지는 길이 — 퍼센트 분할과 px 간격을 함께 담는다 */
export interface Len {
  pct: number;
  px: number;
}

export interface Rect {
  x: Len;
  y: Len;
  w: Len;
  h: Len;
}

export interface PaneBox {
  pane: PaneSpec;
  rect: Rect;
}

export interface DividerBox {
  key: string;
  /** 이 분할선이 조종하는 노드 (드래그가 `ratio` 를 직접 쓴다 — 트리 프록시 참조다) */
  node: PaneSplit;
  dir: SplitDir;
  /** 노드가 차지하는 전체 영역 — 드래그에서 픽셀 → 비율 환산에 쓴다 */
  host: Rect;
  /** 분할선 자체의 영역 */
  rect: Rect;
}

export interface Layout {
  panes: PaneBox[];
  lines: DividerBox[];
}

/**
 * 캔버스를 **통째로** 차지하는 사각형 — 트리의 뿌리가 받는 값이고,
 * 타일 최대화(zoom)가 그 한 타일에 그대로 다시 쓰는 값이다
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
 */
export const FULL_RECT: Rect = {
  x: { pct: 0, px: 0 },
  y: { pct: 0, px: 0 },
  w: { pct: 100, px: 0 },
  h: { pct: 100, px: 0 },
};

/** 분할 하나의 **자르는 자리**(부모 시작점에서의 거리)를 `Len` 으로 — 비율이라 퍼센트와 px 가 함께 늘어난다 */
function cutOf(node: PaneSplit, span: Len): Len {
  const r = clampRatio(node.ratio);
  return { pct: span.pct * r, px: span.px * r + (node.px ?? 0) };
}

function walk(
  node: PaneNode,
  rect: Rect,
  key: string,
  panes: PaneBox[],
  lines: DividerBox[],
) {
  if (node.type === "leaf") {
    panes.push({ pane: node.pane, rect });
    return;
  }
  const half = GAP / 2;

  if (node.dir === "row") {
    // 좌우 분할 — 세로 분할선. `cut` 은 부모 왼쪽 변에서 분할선 **한가운데**까지의 거리다.
    const cut = cutOf(node, rect.w);
    const cutPct = rect.x.pct + cut.pct;
    const cutPx = rect.x.px + cut.px;
    const aW: Len = { pct: cut.pct, px: cut.px - half };
    const bX: Len = { pct: cutPct, px: cutPx + half };
    const bW: Len = { pct: rect.w.pct - cut.pct, px: rect.w.px - cut.px - half };
    walk(node.a, { ...rect, w: aW }, `${key}a`, panes, lines);
    walk(node.b, { ...rect, x: bX, w: bW }, `${key}b`, panes, lines);
    lines.push({
      key,
      node,
      dir: "row",
      host: rect,
      rect: {
        x: { pct: cutPct, px: cutPx - half },
        y: rect.y,
        w: { pct: 0, px: GAP },
        h: rect.h,
      },
    });
  } else {
    // 상하 분할 — 가로 분할선
    const cut = cutOf(node, rect.h);
    const cutPct = rect.y.pct + cut.pct;
    const cutPx = rect.y.px + cut.px;
    const aH: Len = { pct: cut.pct, px: cut.px - half };
    const bY: Len = { pct: cutPct, px: cutPx + half };
    const bH: Len = { pct: rect.h.pct - cut.pct, px: rect.h.px - cut.px - half };
    walk(node.a, { ...rect, h: aH }, `${key}a`, panes, lines);
    walk(node.b, { ...rect, y: bY, h: bH }, `${key}b`, panes, lines);
    lines.push({
      key,
      node,
      dir: "col",
      host: rect,
      rect: {
        x: rect.x,
        y: { pct: cutPct, px: cutPx - half },
        w: rect.w,
        h: { pct: 0, px: GAP },
      },
    });
  }
}

/** 트리 하나를 잎 사각형 목록 + 분할선 목록으로 편다 (탭 본문 전체 = 100% × 100%). */
export function computeLayout(root: PaneNode, base: Rect = FULL_RECT): Layout {
  const panes: PaneBox[] = [];
  const lines: DividerBox[] = [];
  walk(root, base, "r", panes, lines);
  return { panes, lines };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const len = (l: Len) => `calc(${round(l.pct)}% + ${round(l.px)}px)`;

/** 사각형 하나를 인라인 style 문자열로 */
export const boxStyle = (r: Rect) =>
  `left:${len(r.x)};top:${len(r.y)};width:${len(r.w)};height:${len(r.h)}`;

/** 길이를 실제 픽셀로 (컨테이너 한 변의 픽셀 크기가 필요하다) */
export function toPx(l: Len, total: number): number {
  return (l.pct / 100) * total + l.px;
}

// ---------------------------------------------------------------------------
// 드랍 4분면 판정 (docs/log/2026-09-01-drag-split-sync-select.md 1절)
//
// 마우스가 올라간 **패널 하나**를 상자로 보고, 그 안에서 커서가 어느 변에 가장 가까운지로
// 방향을 정한다. 가장자리 40% 가 그 변의 영역이고, 네 변 모두에서 40% 보다 먼 한가운데
// (= 가로·세로 각각 중앙 20%)는 "이 패널 오른쪽" 을 기본으로 쓴다 — 방향을 못 정하겠다는
// 뜻이 아니라 **좌우 분할이 가장 흔한 쓰임**이기 때문이다.
//
//        ┌───────────────┐
//        │ ╲    위     ╱ │   변까지의 거리(비율) 중 최소를 고른다.
//        │  ╲_________╱  │   대각선은 자연스럽게 두 변의 등거리선이 된다.
//        │ 왼 │ 기본 │ 오 │
//        │  ╱‾‾‾‾‾‾‾‾‾╲  │   중앙 20%×20% = 오른쪽
//        │ ╱    아래   ╲ │
//        └───────────────┘
// ---------------------------------------------------------------------------

/** 가장자리 영역의 두께 (상자 한 변에 대한 비율) */
export const EDGE = 0.4;

export type DropZone = "left" | "right" | "top" | "bottom";

/** 4분면 → 트리 조작 (`insertSubtree` 의 dir·side) */
export const ZONE_SPLIT: Record<DropZone, { dir: SplitDir; side: PaneSide }> = {
  left: { dir: "row", side: "before" },
  right: { dir: "row", side: "after" },
  top: { dir: "col", side: "before" },
  bottom: { dir: "col", side: "after" },
};

export function zoneOf(rect: DOMRect, x: number, y: number): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "right";
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  // 좌·우·상·하 각 변까지의 거리 (0 = 변 위, 0.5 = 한가운데)
  const dist: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  let best = dist[0];
  for (const d of dist) if (d[1] < best[1]) best = d;
  return best[1] < EDGE ? best[0] : "right";
}

/**
 * 이 사각형을 다시 나눌 때 **어느 방향으로 자를 것인가** — 긴 변을 자른다
 * (docs/log/2026-09-04-tiling-move-resize.md).
 *
 * 새 타일은 지금까지도 앞으로도 **포커스된 타일 안**으로 들어간다. 바뀌는 것은 방향뿐이다:
 * 예전에는 무조건 `row`(좌우) 라서, 이미 세로로 길쭉한 타일에 파일 브라우저를 열면 폭이
 * 반으로 접힌 띠 두 개가 됐다 (SFTP·로컬 브라우저를 열 때마다 나오던 그 모양이다). 픽셀
 * 폭이 높이보다 크면 좌우로, 아니면 상하로 자르면 **결과가 언제나 정사각형에 가까워진다** —
 * 두 타일 다 쓸 만한 크기로 남는다.
 *
 * 순수 함수다. 퍼센트와 px 가 섞인 [`Len`] 을 실제 픽셀로 펴려면 컨테이너의 두 변이
 * 필요한데(여기서는 **축을 가로지르는 비교**라 [`neighborInDirection`] 처럼 명목값으로
 * 때울 수 없다), 컨테이너 크기를 아직 모르면(0 · 마운트 전) `"row"` 로 떨어진다 —
 * 그것이 이 앱이 지금까지 써 온 기본값이라 폴백이 동작을 바꾸지 않는다.
 */
export function autoSplitDir(rect: Rect, containerW: number, containerH: number): SplitDir {
  if (!(containerW > 0) || !(containerH > 0)) return "row";
  const w = toPx(rect.w, containerW);
  const h = toPx(rect.h, containerH);
  return w >= h ? "row" : "col";
}

// ---------------------------------------------------------------------------
// 방향 포커스 이동 (docs/log/2026-09-03-keys-ended-focus.md)
//
// `Alt+화살표` 가 "지금 타일의 **그쪽 이웃**" 으로 포커스를 옮긴다. 트리를 타고 형제를
// 찾는 방법(부모로 올라가며 dir 이 맞는 분할을 찾기)도 있지만, 그것은 **화면에서 보이는
// 이웃과 어긋난다**: 트리가 `row(a, col(b, c))` 면 a 의 "오른쪽 형제" 는 `col(b,c)` 라는
// 부분트리이지 b 도 c 도 아니다. 사용자가 보는 것은 사각형뿐이므로 **사각형으로 푼다**
// (i3·kitty·VS Code 가 모두 이 방식이다).
//
//        ┌───────┬───────┐   A 에서 →  : B·C 둘 다 오른쪽에 있고 세로로 겹친다. 가장자리
//        │       │   B   │             거리도 겹침도 같아 **중심이 가까운 쪽**까지 가는데,
//        │   A   ├───────┤             그림처럼 완전 대칭이면 어느 쪽이든 뜻이 같다.
//        │       │   C   │   A 에서 ↓  : D (아래로 A 를 넘어서고 가로로 겹친다).
//        ├───────┴───────┤   B 에서 ↓  : C — D 도 후보지만 **가장자리가 더 먼** 뒤쪽이다.
//        │       D       │   B 에서 ←  : A.
//        └───────────────┘
//
// ## 규칙 (단위 테스트로 옮긴다면 이 문단이 그대로 케이스다)
//
//   1. **후보 자격** — 진행 축에서 포커스 사각형의 그 변을 *넘어서* 시작하고
//      (`좌`면 후보의 오른쪽 변 ≤ 내 왼쪽 변), 수직 축에서 **실제로 겹쳐야** 한다
//      (닿기만 하는 것은 겹침이 아니다 — 대각선 타일로 튀지 않게).
//   2. **1순위: 가장자리 거리** — 내 변과 후보 변 사이가 가장 가까운 것. 거터(GAP) 때문에
//      맞닿은 이웃도 거리가 0 이 아니라 8px 이라, 절대값이 아니라 **비교**만 쓴다.
//   3. **2순위: 겹침 길이** — 위 그림의 B·C 처럼 거리가 같으면 나와 더 많이 겹친 쪽.
//   4. **3순위: 중심 거리** — 겹침까지 같으면 수직 축 중심이 가까운 쪽 (완전 대칭 깨기).
//   5. 후보가 없으면 `null` — 호출부는 아무것도 하지 않는다 (감싸 돌지 않는다: 2×2 에서
//      왼쪽 끝에서 ← 를 눌렀는데 오른쪽 끝으로 튀면 방향 감각이 무너진다).
//
// 퍼센트와 px 가 섞인 `Len` 은 **명목 1000px** 컨테이너로 편다. 실제 창 크기를 몰라도
// 되는 이유는 이 계산이 전부 **한 축 안의 대소 비교**뿐이기 때문이다 — 축을 가로지르는
// 비교가 없으니 화면 종횡비도, 실제 픽셀 크기도 답을 바꾸지 않는다. 다만 GAP 이 퍼센트에
// 묻혀 사라지지 않을 만큼은 커야 해서 100 이 아니라 1000 을 쓴다.
// ---------------------------------------------------------------------------

/** 명목 컨테이너 한 변(px) — `Len` 을 비교 가능한 스칼라로 펴는 데만 쓴다 */
const NOMINAL = 1000;

/**
 * 부동소수 오차 흡수용 여유(명목 px). GAP(8) 보다 한참 작아 **맞닿은 이웃과 겹치는 이웃**을
 * 가르는 판정에는 영향을 주지 않는다.
 */
const FEPS = 0.001;

export type FocusDir = "left" | "right" | "up" | "down";

/** 한 축으로 편 사각형 — `[진행축 시작, 진행축 끝, 수직축 시작, 수직축 끝]` */
interface Span {
  /** 진행 축(방향이 가리키는 축)의 시작·끝 */
  a0: number;
  a1: number;
  /** 수직 축의 시작·끝 */
  p0: number;
  p1: number;
}

/** 사각형을 방향에 맞춰 `Span` 으로 편다 (좌우면 x 가 진행 축, 상하면 y 가 진행 축) */
function spanOf(rect: Rect, dir: FocusDir): Span {
  const horizontal = dir === "left" || dir === "right";
  const x0 = toPx(rect.x, NOMINAL);
  const x1 = x0 + toPx(rect.w, NOMINAL);
  const y0 = toPx(rect.y, NOMINAL);
  const y1 = y0 + toPx(rect.h, NOMINAL);
  return horizontal
    ? { a0: x0, a1: x1, p0: y0, p1: y1 }
    : { a0: y0, a1: y1, p0: x0, p1: x1 };
}

/**
 * 포커스된 타일의 `dir` 쪽 **가장 가까운 이웃**의 패널 id. 없으면 `null`.
 *
 * 순수 함수다 — `computeLayout(root).panes` 만 있으면 되고 DOM 도 반응성도 보지 않는다.
 * 규칙은 위 doc-comment 의 5줄이 전부다. 실제 판정은 [`neighborOfRect`] 가 한다 —
 * 이 함수는 "포커스 잎의 사각형" 을 찾아 넘기는 껍데기다.
 */
export function neighborInDirection(
  panes: PaneBox[],
  focusedId: string,
  dir: FocusDir,
): string | null {
  const me = panes.find((p) => p.pane.id === focusedId);
  if (!me) return null;
  return neighborOfRect(panes, me.rect, dir, new Set([focusedId]));
}

/**
 * **사각형 하나**를 기준으로 한 방향 이웃 — [`neighborInDirection`] 의 일반형.
 *
 * 임의의 사각형에서 출발할 수 있고, 후보에서 뺄 잎들을 `exclude` 로 받는다.
 *
 * 규칙은 위 doc-comment 의 5줄 그대로다 — 가장자리 거리 → 겹침 길이 → 중심 거리.
 */
export function neighborOfRect(
  panes: readonly PaneBox[],
  region: Rect,
  dir: FocusDir,
  exclude?: ReadonlySet<string>,
): string | null {
  const from = spanOf(region, dir);
  /** 진행 축에서 "앞" 이 커지는 방향인가 (오른쪽·아래) */
  const forward = dir === "right" || dir === "down";

  let bestId: string | null = null;
  let bestGap = Infinity;
  let bestOverlap = -Infinity;
  let bestCenter = Infinity;

  for (const box of panes) {
    if (exclude?.has(box.pane.id)) continue;
    const to = spanOf(box.rect, dir);

    // ① 진행 축에서 내 변을 넘어서 있는가
    const gap = forward ? to.a0 - from.a1 : from.a0 - to.a1;
    if (gap < -FEPS) continue;

    // ② 수직 축에서 실제로 겹치는가 (닿기만 하면 후보가 아니다)
    const overlap = Math.min(from.p1, to.p1) - Math.max(from.p0, to.p0);
    if (overlap <= FEPS) continue;

    const center = Math.abs((from.p0 + from.p1) / 2 - (to.p0 + to.p1) / 2);

    // ③ 가장자리 거리 → 겹침 길이 → 중심 거리 순으로 고른다
    const better =
      gap < bestGap - FEPS ||
      (gap <= bestGap + FEPS &&
        (overlap > bestOverlap + FEPS ||
          (overlap >= bestOverlap - FEPS && center < bestCenter - FEPS)));
    if (!better) continue;

    bestId = box.pane.id;
    bestGap = gap;
    bestOverlap = overlap;
    bestCenter = center;
  }
  return bestId;
}
