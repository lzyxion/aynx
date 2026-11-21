/**
 * 캔버스를 덮는 판의 여닫기 움직임 — 판은 늘 마운트된 채 `hidden` 으로 숨으므로 Svelte 전이 대신 Web Animations 다.
 * 움직이는 것은 판의 `transform` · `opacity` 뿐이다 — 밑의 타일 캔버스 기하를 건드리면 `resize_session` 이 나간다(하네스가 센다).
 */

export const DASH_MOTION = {
  openMs: 400,
  openScale: 0.98,
  origin: "50% 40%",
  riseMs: 440,
  risePx: 8,
  riseBaseMs: 120,
  riseStepMs: 56,
  riseCapIndex: 5,
  /** 긴 목록의 카드 전부를 움직이지 않는다 */
  riseMax: 10,
  closeMs: 180,
  closeScale: 0.99,
  /** `slide` 갈래(사용량 화면) */
  slidePx: 24,
  slideCloseMs: 200,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** 클래스 이름은 각 컴포넌트의 것이다 — 이름이 바뀌면 그 덩어리가 조용히 안 움직일 뿐 깨지지는 않는다 */
export const RISE_SELECTOR = [
  ".head",
  "[data-usage-board] > *",
  "[data-resource-board] > :not(.charts)",
  "[data-resource-board] > .charts > *",
].join(", ");

export function riseDelay(i: number): number {
  return DASH_MOTION.riseBaseMs + DASH_MOTION.riseStepMs * Math.min(i, DASH_MOTION.riseCapIndex);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 도중에 방향을 바꿀 때 거기서 이어 간다 */
export function currentOpacity(el: HTMLElement): number {
  const v = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(v) ? v : 1;
}

function cancelAll(el: Element): void {
  for (const a of el.getAnimations()) a.cancel();
}

export type PanelMotion = "scale" | "slide";

function openTransform(kind: PanelMotion, from: number): string {
  const m = DASH_MOTION;
  if (kind === "slide") return `translateY(${(m.slidePx * (1 - from)).toFixed(2)}px)`;
  return `scale(${m.openScale + (1 - m.openScale) * from})`;
}

/** `from` 은 닫히던 도중에 다시 열 때의 지금 불투명도 */
export function playOpen(panel: HTMLElement, from = 0, kind: PanelMotion = "scale"): void {
  const m = DASH_MOTION;
  cancelAll(panel);
  panel.animate(
    [
      { opacity: from, transform: openTransform(kind, from), transformOrigin: m.origin },
      { opacity: 1, transform: "none", transformOrigin: m.origin },
    ],
    { duration: m.openMs, easing: m.easeOut, fill: "backwards" },
  );
  const blocks = [...panel.querySelectorAll(RISE_SELECTOR)].slice(0, m.riseMax);
  blocks.forEach((el, i) => {
    cancelAll(el);
    el.animate(
      [
        { opacity: 0, transform: `translateY(${m.risePx}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: m.riseMs, delay: riseDelay(i), easing: m.easeOut, fill: "backwards" },
    );
  });
}

/** 끝난 뒤 `hidden` 을 거는 것은 부르는 쪽이다 */
export function playClose(panel: HTMLElement, kind: PanelMotion = "scale"): Animation {
  const m = DASH_MOTION;
  const from = currentOpacity(panel);
  cancelAll(panel);
  const to = kind === "slide" ? `translateY(${m.slidePx}px)` : `scale(${m.closeScale})`;
  const ms = kind === "slide" ? m.slideCloseMs : m.closeMs;
  return panel.animate(
    [
      { opacity: from, transform: "none", transformOrigin: m.origin },
      { opacity: 0, transform: to, transformOrigin: m.origin },
    ],
    { duration: ms * from, easing: m.easeIn, fill: "forwards" },
  );
}
