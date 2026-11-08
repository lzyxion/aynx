/**
 * 타일 배치 애니메이션의 **게이트** — 딱 하나짜리 전역 플래그다
 * (docs/log/2026-09-04-tile-layout-anim.md).
 *
 * ## 왜 게이트가 필요한가
 *
 * 타일은 `boxStyle` 이 내는 `left/top/width/height` 로 절대배치된다. 여기에 CSS 트랜지션을
 * **상시로** 걸면 위치·크기가 바뀌는 **모든** 경우가 200ms 씩 늘어진다:
 *
 *  - 분할선 마우스 드래그 — 선은 손끝에 붙어 있는데 타일은 200ms 뒤에서 따라온다(고무줄).
 *  - 창 리사이즈 — 창을 끄는 내내 타일이 뒤처지고, 그동안 xterm 이 매 프레임 refit 한다.
 *  - 탭 전환·탭 배치 복원·창 이관 — `display` 가 바뀌거나 한꺼번에 마운트되는 자리다.
 *
 * 그래서 애니메이션은 **"구조 조작"일 때만** 켠다: 타일 이동·삼키기·열기·닫기·분할·드롭
 * 이동·그룹 자동 타일링. 이 조작들만 [`withLayoutAnim`] 을 지나고, 그때만 `PaneHost` 의
 * 캔버스에 `.anim` 이 붙는다.
 *
 * ## 왜 켠 뒤 **시간**으로 끄는가
 *
 * `transitionend` 를 기다리는 방법도 있지만, 트랜지션이 아예 시작되지 않는 경우가 흔하다 —
 * 트리를 바꿨는데 그 타일의 사각형이 그대로인 경우(형제만 움직였다), 값이 소수점 아래에서만
 * 바뀐 경우, 애초에 `prefers-reduced-motion` 으로 트랜지션이 꺼진 경우. 그때마다 이벤트가
 * 오지 않아 플래그가 켜진 채 남고, 그 뒤의 **분할선 드래그가 늘어진다** — 정확히 이 게이트가
 * 막으려던 상태다. 그래서 확실히 끝나는 [`HOLD_MS`] 타이머 하나로만 끈다.
 *
 * ## 플래그를 켜는 시점은 대입 전후 어디든 좋다
 *
 * Svelte 5 는 한 틱의 상태 변경을 모아 DOM 을 **한 번** 갱신한다. 같은 동기 블록 안이라면
 * `on = true` 와 `tab.root = …` 의 순서가 무엇이든 클래스와 style 이 같은 갱신에 함께 실린다
 * (CSS 트랜지션은 *변경 후* 스타일의 `transition` 을 읽으므로 이때도 정상적으로 시작한다).
 * 그래서 긴 함수에서는 트리 대입 한 줄만 감싸도 그 함수의 나머지 대입까지 함께 애니메이션된다.
 */

/**
 * 새 타일 등장 애니메이션 길이(ms). 예전 160ms · 98% 시작은 옆 타일의 200ms 미끄러짐에 묻혀 커지는 것이 안 보였다 —
 * 220ms · 92% 시작으로 또렷하게, 그래도 작아서 280ms · 85% 시작으로 더 크게(2026-10-17 사용자). 이어 **차례로**
 * (옆 타일이 먼저 미끄러지고 [`TILE_ENTER_DELAY_MS`] 뒤에 커진다) 바꾸며 220ms 로 — 전체 ≈ 120 + 220ms.
 */
export const TILE_ENTER_MS = 220;

/**
 * 새 타일 등장의 시작 지연(ms) — 옆 타일 · 분할선이 곧바로 미끄러져 자리를 내고 새 타일은 그 뒤에 커진다(닫기의 거울).
 * 등장은 Svelte `in:` 이라 배치 플래그(`HOLD_MS`)와 무관하다 — 플래그는 위치·크기 미끄러짐(200ms)만 덮으면 된다.
 */
export const TILE_ENTER_DELAY_MS = 120;

/**
 * 타일 닫기는 **차례로** 돈다(2026-10-17 사용자 — 유령 축소와 옆 타일 미끄러짐이 동시면 어수선했다):
 * 닫히는 타일의 유령이 [`TILE_EXIT_MS`] 동안 먼저 줄며 사라지고, 옆 타일 · 분할선의 미끄러짐은
 * [`CLOSE_SLIDE_DELAY_MS`] 늦게 시작해 유령이 거의 사라질 때 빈자리를 채운다(전체 ≈ 120 + 200ms).
 * 지연은 그 닫기 하나에만 — 다른 구조 조작은 곧바로 미끄러진다.
 */
export const TILE_EXIT_MS = 150;
export const CLOSE_SLIDE_DELAY_MS = 120;

/**
 * 플래그를 켜 두는 시간(ms). 위치·크기 트랜지션(`PaneHost` 의 CSS, 200ms)보다 조금 길다 —
 * 마지막 프레임이 그려지기 전에 클래스가 빠지면 그 순간 타일이 목적지로 **순간이동**한다.
 */
const HOLD_MS = 260;

let on = $state(false);
/** 이번 미끄러짐의 시작 지연(ms) — 차례 닫기 동안만 0 이 아니다 (`PaneHost` 가 `--close-delay` 로 읽는다) */
let delay = $state(0);
let timer: ReturnType<typeof setTimeout> | undefined;

/** 지금 배치 애니메이션이 켜져 있는가 (`PaneHost` 가 캔버스 클래스로 읽는다) */
export function layoutAnimating(): boolean {
  return on;
}

/** 지금 미끄러짐의 시작 지연(ms) — 차례 닫기가 도는 동안만 0 보다 크다 */
export function layoutSlideDelay(): number {
  return delay;
}

/**
 * 트리 조작을 **애니메이션과 함께** 실행한다. 연타되면 타이머가 연장될 뿐이라
 * (`Alt+Shift+화살표` 를 다다닥 눌러도) 중간에 클래스가 빠져 튀지 않는다.
 *
 * `slideDelay` 는 차례 닫기(`tabs.closePaneNow`)만 준다 — 플래그도 그만큼 더 오래 켜 둔다(먼저 빠지면 순간이동).
 * 지연 없는 조작이 뒤이어 오면 지연은 걷힌다: 그 조작의 새 트랜지션은 지금 자리에서 곧바로 출발한다.
 */
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

/**
 * 사람이 **타일 하나를 닫는다**는 알림 — 닫기 몸통(`tabs.closePaneNow`)이 트리를 바꾸기 **직전에** 부른다.
 * 듣는 쪽(`PaneHost`)은 DOM 이 아직 그대로인 이 순간에 그 상자의 모양을 유령으로 떠 두고, 진짜 상자는
 * 평소처럼 곧바로 언마운트된다(세션 수명은 그대로). 탭 닫기 · 떼어 내기 · 이관 · 갈아 끼우기는 이 길을
 * 부르지 않으므로 유령이 없다.
 *
 * 유령을 세웠으면 듣는 쪽이 `true` 를 돌려주고, 그때만 닫는 쪽이 미끄러짐을 늦춘다(차례 닫기). 유령이 없으면
 * (움직임 줄이기 · 숨은 타일 · 연타) 옆 타일은 곧바로 미끄러진다.
 */
const closingListeners = new Set<(paneId: string) => boolean>();

export function noteTileClosing(paneId: string): boolean {
  let ghost = false;
  for (const fn of closingListeners) ghost = fn(paneId) || ghost;
  return ghost;
}

/** [`noteTileClosing`] 을 듣는다 — 돌려준 함수로 끊는다 */
export function onTileClosing(fn: (paneId: string) => boolean): () => void {
  closingListeners.add(fn);
  return () => closingListeners.delete(fn);
}

/**
 * 애니메이션을 **즉시** 끈다. 트랜지션 도중에 사용자가 분할선을 잡은 자리에서 부른다 —
 * 그 순간부터 타일은 손끝을 그대로 따라와야 하고, 200ms 뒤처진 고무줄이 되면 안 된다.
 */
export function cancelLayoutAnim(): void {
  clearTimeout(timer);
  timer = undefined;
  on = false;
  delay = 0;
}
