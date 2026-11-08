/**
 * **캔버스를 덮는 판의 여닫기 움직임** (docs/log/2026-09-29-dashboard-motion.md).
 *
 * 처음에는 전체 화면 대시보드(`Console.svelte`)의 움직임이었다. 그 화면은 2026-10-07 에 세션 목록 판(캔버스 위쪽)과
 * 작업안 타일로 나뉘어 없어졌고, 지금 쓰는 쪽은 사용량 화면(`UsageView.svelte` — `slide` 갈래)과 탭 슬라이드
 * (`prefersReducedMotion`)다. 대시보드만 쓰던 칸 전환(`playSection`)은 걷었다. 이름은 그대로 둔다.
 *
 * 판은 늘 마운트된 채 `hidden` 으로 숨는다 — 그래서 Svelte `in:`/`out:`(블록이
 * 생기고 없어질 때 도는 전이) 대신 **Web Animations** 로 판 자신과 안쪽 첫 몇 덩어리를 직접
 * 움직인다. 움직이는 것은 **판의 `transform`·`opacity` 뿐**이다 — 밑의 타일 캔버스·xterm 의
 * 기하는 건드리지 않는다(`resize_session` 이 나가지 않는다 · 하네스가 센다).
 *
 * 값은 시안(A · 커지며 나타남)의 "보통" 의 **두 배**다 — 보통은 빨랐고 네 배는 느렸다(사용자).
 * 닫기만 두 배(240)보다 짧은 180ms: 닫는 일은 이미 끝났고(상태·포커스는 즉시) 흔적만 남는다.
 *
 * 이 모듈은 아무것도 import 하지 않는다.
 */

export const DASH_MOTION = {
  /** 열 때 판: 불투명도 0→1 · 크기 0.98→1 */
  openMs: 400,
  openScale: 0.98,
  origin: "50% 40%",
  /** 안쪽 덩어리: 8px 아래에서 떠오르며 나타난다 */
  riseMs: 440,
  risePx: 8,
  /** 순번 i 의 지연 = 120 + 56 × min(i, 5) — 여섯째부터는 같은 지연 */
  riseBaseMs: 120,
  riseStepMs: 56,
  riseCapIndex: 5,
  /** 떠오르게 할 덩어리는 앞의 이만큼만 — 긴 목록의 카드 전부를 움직이지 않는다 */
  riseMax: 10,
  /** 닫을 때 판: 불투명도 →0 · 크기 →0.99 */
  closeMs: 180,
  closeScale: 0.99,
  /**
   * **사용량 화면**(`UsageView.svelte` — 상태바 아래쪽 고리에서 나온다)의 판: 크기 대신 **세로로** 움직인다.
   * 열 때 아래 24px 에서 떠오르고(시간·곡선은 대시보드 열기와 같다), 닫을 때 아래로 24px 내려가며 흐려진다.
   */
  slidePx: 24,
  slideCloseMs: 200,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/**
 * 떠오르는 **덩어리** — 문서 순서대로 앞의 [`DASH_MOTION.riseMax`] 개만 쓴다. 머리줄 → 칸마다의
 * 윗줄(요약·보기 막대·거르개) → 묶음 머리 → 카드. 클래스 이름은 각 컴포넌트의 것이다(스코프 CSS 도
 * 원래 클래스는 그대로 달린다) — 이름이 바뀌면 그 덩어리가 조용히 안 움직일 뿐 깨지지는 않는다.
 */
export const RISE_SELECTOR = [
  ".head",
  // 사용량 화면 (UsageBoard) — 윗단 덩어리들
  "[data-usage-board] > *",
  // 자원 화면 (ResourceBoard) — 띠 · 차트 둘(한 줄 안의 카드마다) · 지금 표
  "[data-resource-board] > :not(.charts)",
  "[data-resource-board] > .charts > *",
].join(", ");

/** 순번 i 의 떠오름 지연(ms) */
export function riseDelay(i: number): number {
  return DASH_MOTION.riseBaseMs + DASH_MOTION.riseStepMs * Math.min(i, DASH_MOTION.riseCapIndex);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 지금 보이는 불투명도 — 도중에 방향을 바꿀 때 거기서 이어 간다 */
export function currentOpacity(el: HTMLElement): number {
  const v = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(v) ? v : 1;
}

function cancelAll(el: Element): void {
  for (const a of el.getAnimations()) a.cancel();
}

/**
 * 판의 움직임 갈래 — `scale`(대시보드: 커지며 나타나고 살짝 작아지며 걷힌다) · `slide`(사용량 화면: 아래에서
 * 떠오르고 아래로 내려가며 걷힌다).
 */
export type PanelMotion = "scale" | "slide";

/** 판의 출발 모양 — `from`(지금 불투명도)만큼 이미 와 있는 자리에서 이어 간다 */
function openTransform(kind: PanelMotion, from: number): string {
  const m = DASH_MOTION;
  if (kind === "slide") return `translateY(${(m.slidePx * (1 - from)).toFixed(2)}px)`;
  return `scale(${m.openScale + (1 - m.openScale) * from})`;
}

/**
 * 연다 — 판이 커지며(사용량 화면은 떠오르며) 나타나고 안쪽 덩어리가 시차를 두고 떠오른다. `from` 은
 * 닫히던 도중에 다시 열 때의 지금 불투명도(그 자리에서 이어 간다).
 */
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

/**
 * 닫는다 — 판만 흐려지며 살짝 작아진다(사용량 화면은 아래로 내려간다). 끝난 뒤 `hidden` 을 거는 것은
 * 부르는 쪽이다.
 */
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
