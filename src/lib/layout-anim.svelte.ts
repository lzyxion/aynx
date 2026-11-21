/**
 * 타일 배치 애니메이션의 게이트 — 구조 조작만 [`withLayoutAnim`] 을 지난다. 상시로 걸면 분할선 드래그 · 창 리사이즈가 고무줄처럼 늘어진다.
 * 문서 → 문서 갈아 끼우기(`tabs.replaceTile`)는 지나지 않는다 — 틀은 뚝 바뀌고 본문만 떠오른다(`doc-swap.ts`).
 * 끄는 것은 `transitionend` 가 아니라 타이머다 — 트랜지션이 시작되지 않는 경우가 흔해 이벤트를 기다리면 플래그가 켜진 채 남는다.
 * (docs/log/2026-09-04-tile-layout-anim.md)
 */

export const TILE_ENTER_MS = 220;

/** 등장은 Svelte `in:` 이라 배치 플래그(`HOLD_MS`)와 무관하다 */
export const TILE_ENTER_DELAY_MS = 120;

/** 차례 닫기 — 유령이 먼저 줄고 옆 타일의 미끄러짐은 [`CLOSE_SLIDE_DELAY_MS`] 늦게 시작한다. 지연은 그 닫기 하나에만 */
export const TILE_EXIT_MS = 150;
export const CLOSE_SLIDE_DELAY_MS = 120;

/** `PaneHost` 의 위치·크기 트랜지션(200ms)보다 길어야 한다 — 먼저 빠지면 타일이 목적지로 순간이동한다 */
const HOLD_MS = 260;

let on = $state(false);
/** `PaneHost` 가 `--close-delay` 로 읽는다 */
let delay = $state(0);
let timer: ReturnType<typeof setTimeout> | undefined;

export function layoutAnimating(): boolean {
  return on;
}

export function layoutSlideDelay(): number {
  return delay;
}

/** `slideDelay` 는 차례 닫기(`tabs.closePaneNow`)만 준다 — 플래그도 그만큼 더 오래 켜 둔다(먼저 빠지면 순간이동) */
export function withLayoutAnim<T>(mutate: () => T, slideDelay = 0): T {
  on = true;
  delay = slideDelay;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    on = false;
    delay = 0;
  }, HOLD_MS + slideDelay);
  return mutate();
}

/** 닫기 몸통이 트리를 바꾸기 직전에 부른다 — 듣는 쪽은 DOM 이 아직 그대로인 이 순간에 유령을 뜬다. 유령을 세웠으면 `true` */
const closingListeners = new Set<(paneId: string) => boolean>();

export function noteTileClosing(paneId: string): boolean {
  let ghost = false;
  for (const fn of closingListeners) ghost = fn(paneId) || ghost;
  return ghost;
}

export function onTileClosing(fn: (paneId: string) => boolean): () => void {
  closingListeners.add(fn);
  return () => closingListeners.delete(fn);
}

/** 트랜지션 도중 분할선을 잡은 자리에서 부른다 — 그 순간부터 타일은 손끝을 따라와야 한다 */
export function cancelLayoutAnim(): void {
  clearTimeout(timer);
  timer = undefined;
  on = false;
  delay = 0;
}
