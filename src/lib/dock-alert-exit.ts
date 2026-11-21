/** 독 알림 칸의 줄 나가기 트랜지션의 수 — 순수 모듈(`DockAlerts.svelte` 의 `rowExit`). reduced-motion 판정은 부르는 쪽이 한다. */

export const EXIT_SLIDE_MS = 180;
export const EXIT_COLLAPSE_MS = 150;
export const EXIT_STAGGER_MS = 25;
/** 마지막 줄의 밀려 나감이 0.4초 안에 끝나게(220 + 180 = 400) */
export const EXIT_STAGGER_CAP_MS = 220;
/** 줄 폭에 대한 % */
export const EXIT_SHIFT_PCT = 60;

export type ExitSide = "left" | "right";

export function exitDelay(index: number, reduced: boolean): number {
  if (reduced || index <= 0) return 0;
  return Math.min(index * EXIT_STAGGER_MS, EXIT_STAGGER_CAP_MS);
}

export function exitDuration(reduced: boolean): number {
  return reduced ? EXIT_SLIDE_MS : EXIT_SLIDE_MS + EXIT_COLLAPSE_MS;
}

/** 빈 상태 문구는 이 시간 뒤에 들어온다 */
export function exitSpan(count: number, reduced: boolean): number {
  if (count <= 0) return 0;
  return exitDelay(count - 1, reduced) + exitDuration(reduced);
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOutQuad = (x: number): number => 1 - (1 - x) * (1 - x);
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const round = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * `progress` 0(제자리) → 1(다 나감) — Svelte outro 의 `css(t)` 는 t 가 1 → 0 이라 부르는 쪽이 `1 - t` 를 넘긴다.
 * 줄 사이 틈도 음의 `margin-bottom` 으로 접는다 — 높이만 접으면 마지막에 틈 하나만큼 툭 떨어진다.
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
