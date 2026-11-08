/**
 * **독 알림 칸의 줄 나가기** (2026-10-24 — End-4 사이드바 알림 지우기). 지운 줄은 데이터에서 곧바로 빠지고, DOM 만
 * `out:` 트랜지션으로 나간다(`DockAlerts.svelte` 의 `rowExit`). 이 모듈은 그 트랜지션의 **수(시간 · 지연 · 한 장면의 css)** 만
 * 쥐는 순수 함수다 — DOM 도 Svelte 도 import 하지 않는다.
 *
 * 한 줄의 나가기 = 두 막:
 * 1. **밀려 나감**(`EXIT_SLIDE_MS`) — 독이 붙은 화면 가장자리 쪽으로 `translateX` 하며 흐려진다.
 * 2. **높이 접힘**(`EXIT_COLLAPSE_MS`) — 빈 자리가 접히며 아래 줄이 부드럽게 올라온다(튀지 않게). 줄 사이 틈(`gap`)도 같이
 *    접는다 — 높이만 0 이 되면 틈 하나만큼 마지막에 툭 떨어진다(음의 `margin-bottom` 으로 틈을 갚는다).
 *
 * 여러 줄이 함께 나가면([알림 지우기]) **위 줄부터 `EXIT_STAGGER_MS` 간격으로** 차례로 떠난다. 지연은 `EXIT_STAGGER_CAP_MS` 에서
 * 멈춘다 — 마지막 줄의 밀려 나감이 끝나는 때가 0.4초(= 상한 220 + 180)를 넘지 않는다. 화면 밖(스크롤로 안 보이는) 줄은 상한에
 * 묶여 함께 떠나므로 따로 기다리지 않는다.
 *
 * `prefers-reduced-motion: reduce` 면 **흐려지기만** 한다 — 이동 · 높이 움직임 · 차례 지연 없음(끝나면 줄이 빠지며 아래가 한 번에
 * 올라온다). 상태줄 알약(`StatusBar.svelte` 의 `reveal` — 그때는 시간 0)과 같은 판정(`matchMedia`)을 부르는 쪽이 한다.
 */

export const EXIT_SLIDE_MS = 180;
export const EXIT_COLLAPSE_MS = 150;
export const EXIT_STAGGER_MS = 25;
/** 차례 지연의 상한 — 마지막 줄의 밀려 나감이 0.4초 안에 끝나게(220 + 180 = 400) */
export const EXIT_STAGGER_CAP_MS = 220;
/** 밀려 나가는 거리 — 줄 폭에 대한 % */
export const EXIT_SHIFT_PCT = 60;

/** 독이 붙은 쪽 — 줄이 그쪽 화면 가장자리로 나간다 */
export type ExitSide = "left" | "right";

/** 함께 나가는 줄 가운데 `index` 번째(위에서 0)의 출발 지연(ms) */
export function exitDelay(index: number, reduced: boolean): number {
  if (reduced || index <= 0) return 0;
  return Math.min(index * EXIT_STAGGER_MS, EXIT_STAGGER_CAP_MS);
}

/** 한 줄의 나가기 시간(지연 제외) */
export function exitDuration(reduced: boolean): number {
  return reduced ? EXIT_SLIDE_MS : EXIT_SLIDE_MS + EXIT_COLLAPSE_MS;
}

/** `count` 줄이 함께 나갈 때 마지막 줄까지 다 나가는 데 걸리는 시간(ms) — 빈 상태 문구가 그 뒤에 들어온다 */
export function exitSpan(count: number, reduced: boolean): number {
  if (count <= 0) return 0;
  return exitDelay(count - 1, reduced) + exitDuration(reduced);
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOutQuad = (x: number): number => 1 - (1 - x) * (1 - x);
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const round = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * 나가기의 한 장면 — `progress` 0(제자리) → 1(다 나감). Svelte 의 `css(t)` 는 outro 에서 t 가 1 → 0 이므로 부르는 쪽이
 * `1 - t` 를 넘긴다. `height` · `gap` 은 나가기를 시작할 때 잰 줄 높이와 줄 사이 틈(px).
 */
export function exitFrame(
  progress: number,
  o: { side: ExitSide; height: number; gap: number; reduced: boolean },
): string {
  const p = clamp01(progress);
  if (o.reduced) return `opacity: ${round(1 - p)};`;
  const split = EXIT_SLIDE_MS / (EXIT_SLIDE_MS + EXIT_COLLAPSE_MS);
  const slide = clamp01(p / split);
  const fold = easeInOutCubic(clamp01((p - split) / (1 - split)));
  const dir = o.side === "right" ? 1 : -1;
  const shift = round(dir * easeOutQuad(slide) * EXIT_SHIFT_PCT);
  return (
    `transform: translateX(${shift}%); opacity: ${round(1 - slide)}; overflow: hidden; ` +
    `height: ${round(o.height * (1 - fold))}px; margin-bottom: ${round(-o.gap * fold)}px;`
  );
}
