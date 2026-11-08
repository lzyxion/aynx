/**
 * **시작 화면(launcher)의 규칙** — 순수 모듈 (docs/log/2026-09-25-launcher.md · 2026-10-28-start-widgets.md).
 *
 * 빈 탭은 "출발점" 이다. 2026-10-28 부터 **자유 배치 위젯 판**이다 — 최근 호스트 · 프로젝트 · 셸 위젯을 사용자가 판 위
 * 아무 데나 놓는다(겹치지 않게). 검색 칸 모양 단추는 걷었다: 글자를 치면 그대로 명령 팔레트가 뜨고(친 글자를 싣고),
 * 팔레트는 늘 제 기본 자리(타일 캔버스 기준 — [`placeDefaultPalette`])에 선다(검색 칸에 겹쳐 펼치던 자리 셈은 칸과 함께 걷었다).
 *
 * 그림은 `StartPage.svelte` 가 그리고, 판의 좌표 규칙(격자 · 부딪힘 · 정리 · 축소)은 `start-widgets.ts`, 여기는
 * **무엇을 몇 줄 세울지 · 화살표가 어디로 가는지 · 어떤 키가 팔레트를 여는지 · 팔레트가 어디 서는지** 다 — 이 저장소의
 * vitest 는 `environment: "node"` 라 `.svelte` 를 못 읽으므로 테스트가 닿는 자리는 순수 모듈뿐이다
 * (`favorites.ts` · `status-items.ts` 와 같은 나눔).
 */

/** 셸 목록을 자를 때의 기본 상한 — 시작 화면은 위젯 높이만큼(`widgetCapacity`)을 넘긴다 */
export const LAUNCHER_COLUMN_LIMIT = 5;

/** 기본 셸을 맨 위에 두고 나머지는 감지 순서를 유지한다. */
export function shellColumn<S extends { id: string }>(
  shells: readonly S[],
  defaultId: string | null,
  limit = LAUNCHER_COLUMN_LIMIT,
): { shells: S[] } {
  const def = shells.find((s) => s.id === defaultId);
  const ordered = def ? [def, ...shells.filter((s) => s !== def)] : [...shells];
  return { shells: ordered.slice(0, Math.max(0, limit)) };
}

// ---------------------------------------------------------------------------
// 화살표 — 한 선택이 모든 위젯의 줄을 지난다
// ---------------------------------------------------------------------------

/** 위젯의 판 위 사각형(판 가운데 기준 px — `start-widgets.ts` 의 `Box` 와 같은 모양) */
export interface LauncherRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 선택이 지나는 **구역** 하나 = 위젯 하나. 빈 위젯 · 줄이 없는 위젯(시계 — 늘 0 줄)도 그대로 넘긴다(건너뛰는 것은 이 모듈의 일이다 — 호출부가 빈 것을
 * 빼면 구역 번호가 화면과 어긋난다).
 *
 *  · `rect` — 판 위 자리. 위젯 사이의 ←→ · 가장자리를 넘는 ↑↓ 가 이 기하로 이웃을 고른다.
 *  · `rows` — 한 단에 서는 줄 수(위젯 높이로 정해진다). 넓은 위젯은 줄이 **단 우선**으로 두 단에 흐른다
 *    (첫 단을 `rows` 줄 채우고 다음 단 — CSS `grid-auto-flow: column`). 줄 `i` 는 단 `⌊i / rows⌋` 의 `i % rows` 째.
 *  · `cols` — 위젯이 가진 단 수(1 · 2 — 폭으로 정해진다, `widgetColumns`). 단의 가로 자리를 어림하는 데만 쓴다.
 */
export interface LauncherArea {
  size: number;
  rect: LauncherRect;
  rows: number;
  cols: number;
}

/** 선택의 자리 — 몇째 구역의 몇째 줄 */
export interface LauncherPos {
  area: number;
  index: number;
}

export type LauncherDir = "up" | "down" | "left" | "right";

const valid = (areas: readonly LauncherArea[], at: LauncherPos | null): at is LauncherPos =>
  at !== null && at.area >= 0 && at.area < areas.length && at.index >= 0 && at.index < areas[at.area].size;

/** 선택이 없을 때 첫 자리 — 비지 않은 첫 위젯의 첫 줄 */
export function firstLauncherPos(areas: readonly LauncherArea[]): LauncherPos | null {
  const i = areas.findIndex((a) => a.size > 0);
  return i < 0 ? null : { area: i, index: 0 };
}

const perCol = (a: LauncherArea) => Math.max(1, a.rows);
/** 실제로 줄이 선 단의 수 */
const usedCols = (a: LauncherArea) => Math.max(1, Math.ceil(a.size / perCol(a)));
/** 단 `col` 의 줄 수 */
const colLen = (a: LauncherArea, col: number) => Math.max(0, Math.min(perCol(a), a.size - col * perCol(a)));
/** 단 `col` 의 가로 가운데(판 좌표) — 단 폭은 위젯 폭을 단 수로 나눈 어림 */
const colCenter = (a: LauncherArea, col: number) => a.rect.x + ((col + 0.5) * a.rect.w) / Math.max(1, a.cols, usedCols(a));

const EPS = 0.5;

/**
 * `from` 위젯의 `dir` 쪽 이웃 — 진행 축에서 내 변을 넘어서 있는 비지 않은 위젯 가운데
 *  · ↑↓: **가로로 겹치는** 것만(바로 위 · 아래). 가장자리 거리 → 겹침 길이 순.
 *  · ←→: 세로로 겹치는 것이 있으면 그중 가장자리 거리 → 겹침 길이, 없으면 가운데끼리 가장 가까운 것
 *    (타일의 `Alt+화살표` — `layout.ts` 의 `neighborOfRect` — 와 같은 셈에, 겹침이 없는 자유 배치를 위한 물러섬 하나).
 */
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

/** 가로 위치 `x` 에 가장 가까운 단 */
function nearestCol(a: LauncherArea, x: number): number {
  let col = 0;
  for (let c = 1; c < usedCols(a); c++) if (Math.abs(colCenter(a, c) - x) < Math.abs(colCenter(a, col) - x)) col = c;
  return col;
}

/**
 * 화살표 하나 → 다음 자리. **감싸지 않는다**(더 갈 데가 없으면 제자리) — 호스트 · 프로젝트 독과 같은 감각이다.
 *
 *  · ↑↓ — 위젯 안의 단에서 위 · 아랫줄. 단의 끝에서 더 가면 **바로 위 · 아래에 가로로 겹친 위젯**으로 넘어간다(가까운 단의
 *    맨 아랫줄 · 맨 윗줄). 그런 위젯이 없으면 제자리.
 *  · ←→ — 두 단 위젯이면 먼저 옆 단(같은 줄, 짧으면 그 단의 끝 줄). 위젯의 끝 단에서 더 가면 그 방향의 **가장 가까운 위젯**
 *    (기하로 — 위 [`neighbour`])의 첫 단(→) · 끝 단(←), 같은 번째 줄(짧으면 끝 줄).
 */
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

// ---------------------------------------------------------------------------
// 타자 → 팔레트
// ---------------------------------------------------------------------------

/** `KeyboardEvent` 에서 이 판정이 보는 것만 */
export interface TypedKey {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * 시작 화면에 포커스가 있을 때 이 키가 **팔레트를 여는 타자**인가 — 그렇다면 입력칸에 미리 찍을
 * 글자(`seed`)를, 아니면 `null` 을 돌려준다.
 *
 *  · 글자 하나(수식 없음 · Shift 는 괜찮다 — 대문자·기호) → 그 글자. 팔레트의 접두사(`>` `@` `#`
 *    `;` `!`)도 그대로 들어가 그 섹션만 보이는 채로 열린다.
 *  · 스페이스는 **아니다** — 고른 줄을 누르는 키다(예전 줄 단추의 기본 뜻).
 *  · IME 조합 시작(`Process` · `isComposing`) → 빈 문자열(= 여기서는 열지 않는다). 부르는 쪽은 기본
 *    동작을 막지 않아 조합이 자기 포커스 주인(숨은 입력칸)에서 시작되게 두고, 팔레트는 그
 *    `compositionstart` 에서 거울 모드로 연다 — 조합 중에 포커스를 옮기면 조합이 취소되기 때문이다
 *    (`StartPage.svelte` · docs/log/2026-09-25-launcher.md 3절).
 */
export function launcherSeed(ev: TypedKey): string | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  if (ev.isComposing || ev.key === "Process") return "";
  if (ev.key.length !== 1 || ev.key === " ") return null;
  return ev.key;
}

// ---------------------------------------------------------------------------
// 프로젝트 위젯 — 에이전트가 붙은 것이 위로
// ---------------------------------------------------------------------------

/** 점의 무게 — 손을 기다리는 것(권한 대기)이 맨 위, 그다음 끝나서 볼 것(완료), 도는 것 */
const AGENT_RANK: Record<string, number> = { permission: 0, finished: 1, running: 2 };

/**
 * 프로젝트 줄의 순서 — **에이전트 점이 있는 프로젝트가 먼저**(권한 대기 → 완료 → 실행 중),
 * 점이 없는 것은 그 뒤에 들어온 순서 그대로(호출부가 이미 `sortProjects` 의 "최근" 으로 줄 세운
 * 목록을 넘긴다). 빈 탭을 연 사람에게 "지금 나를 기다리는 곳" 이 첫 줄이어야 한다.
 * 안정 정렬이다 — 같은 무게끼리는 순서를 바꾸지 않는다.
 */
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

// ---------------------------------------------------------------------------
// 팔레트의 자리 (docs/log/2026-09-25-launcher.md 덧붙임)
//
// 예전엔 시작 화면의 검색 칸이 보이면 판을 그 칸 자리에 겹쳐 펼쳤다(`placeAnchoredPalette`). 2026-10-28 위젯 판에서 칸을
// 걷으며 그 길도 걷었다 — 팔레트는 어디서 열든 아래 기본 자리 하나다.
// ---------------------------------------------------------------------------

/** 화면 가장자리 여백 — 팔레트 덮개의 안쪽 여백(`--space-4`)과 같은 값 */
export const PALETTE_EDGE = 16;

/** 판 폭 — `theme.css` 의 `--palette-w` 와 같은 값 */
export const PALETTE_W = 560;

/** 판 높이 상한 — 덮개 없이 떠 있을 때의 `max-height: 70vh` 와 같은 비율 */
export const PALETTE_MAX_VH = 0.7;

/**
 * 판 위쪽 아래로 이만큼은 펼 자리가 있어야 한다 — 검색 줄 48 + 줄 네댓 + 바닥 줄 36.
 * 모자라면 판을 위로 끌어올린다(목록이 화면 밖으로 나가는 것보다 낫다).
 */
export const PALETTE_MIN_ROOM = 280;

/** 타일 캔버스(`+page` 의 `.pane`)의 화면 사각형(CSS px) — 팔레트 · 고르는 판들의 기준 상자 */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 팔레트가 캔버스 위 가장자리에서 떨어지는 거리 — **캔버스 높이의 비율**.
 *
 * 예전 자리(창 높이의 12% 아래)는 창 기준이라 상태바가 위·아래·옆 어디 있느냐에 따라 판이 타일
 * 영역에서 제멋대로 비켜 섰다. 같은 12% 를 **캔버스**에서 잰다 — 뜻("위쪽 1/8 쯤, 목록이 아래로
 * 자란다")은 그대로이고 기준 상자만 바뀐다. 고정 px 가 아니라 비율인 이유: 창이 낮아지면 예전처럼
 * 같이 줄어야 아래 목록 자리가 남는다. 시작 화면의 숨은 입력칸(IME 후보 창의 자리)도 판 위 같은 높이에 선다.
 */
export const PALETTE_CANVAS_TOP_RATIO = 0.12;

/**
 * **팔레트의 자리** — 타일 캔버스 가로 가운데 · 캔버스 위 + 캔버스 높이 × [`PALETTE_CANVAS_TOP_RATIO`].
 * 폭은 [`PALETTE_W`](560, `--palette-w`)이되 창 좌우 여백 안. 가장자리 여백 안으로 죄고, 아래로 [`PALETTE_MIN_ROOM`] 이
 * 남게 끌어올리며, 높이 상한은 70vh 와 "위치부터 바닥 여백까지" 중 작은 쪽.
 */
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
