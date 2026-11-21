/**
 * 탭 전환 슬라이드 (docs/log/2026-09-29-tab-slide.md).
 *
 * 요청은 `tabs.pickTab` 이 `activeId` 를 바꾸기 직전에 적는다 — 같은 반응 플러시에서 보여야 떠나는 탭의 타일이
 * 한 프레임도 `display:none` 이 되지 않는다(그 터미널의 WebGL 이 떨어졌다 다시 붙는다).
 */

import { prefersReducedMotion } from "$lib/console/dashboard-motion";

export const TAB_SLIDE = {
  ms: 460,
  /** 도는 도중에 다시 바뀌면 이 길이로 지금 자리에서 새 목표로 간다 */
  rapidMs: 120,
  /**
   * cubic-bezier 로는 "중간 등속 + 끝에서만 감속" 이 안 나와 `linear()` 점열로 적는다 — 끝에서도 빠르기가 0 이 되지 않는다.
   * 점열은 비율이라 `ms` 를 바꾸면 같은 꼴로 늘고 준다.
   */
  easing:
    "linear(0, 0.019 2.2%, 0.076 4.4%, 0.65 20.7%, 0.727 23.5%, 0.806 28%, 0.874 35.3%, 0.926 46.2%, 0.962 60.7%, 0.985 78.9%, 1)",
} as const;

export interface TabSlide {
  seq: number;
  from: string;
  to: string;
  /** 1 = 오른쪽 탭으로(내용이 왼쪽으로 밀린다) · -1 = 왼쪽 탭으로 */
  dir: 1 | -1;
}

let current = $state<TabSlide | null>(null);
let counter = 0;

export function tabSlide(): TabSlide | null {
  return current;
}

/** `dir` 은 탭 바의 순서 비교다 — 감싸 도는 다음 탭(끝 → 처음)도 처음 탭은 왼쪽에 있으므로 오른쪽으로 민다 */
export function requestTabSlide(from: string | null, to: string, dir: 1 | -1): void {
  if (from === null || from === to || prefersReducedMotion()) {
    current = null;
    return;
  }
  current = { seq: ++counter, from, to, dir };
}

export function clearTabSlide(): void {
  current = null;
}

export function endTabSlide(seq: number): void {
  if (current?.seq === seq) current = null;
}

// ── 탭 전환 슬라이드의 움직임 ────────────────────────────────────────────
// 타일 상자는 탭마다 묶여 있지 않다(앱 전역 평면 목록 — 옮겨 담으면 재마운트다) — 그 탭의 상자 전부와 분할선 층에 같은 키프레임을 건다.

function offsetOf(els: HTMLElement[]): number {
  const el = els[0];
  if (!el) return 0;
  try {
    return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
  } catch {
    return 0;
  }
}

/**
 * 캔버스 폭 + 보이는 바깥 폭. 조상이 `[data-slide-bleed]`(둥근 상태바 패널)이면 오림이 그 상자의 가로 끝까지 열리므로
 * 먼 끝까지 민다 — 패널 뒤로 지나간 타일이 끝 자리에서 창 가장자리에 걸려 보이지 않게.
 */
function slideDistance(host: HTMLDivElement | null): number {
  if (!host) return 0;
  const edge = host.closest<HTMLElement>("[data-slide-bleed]");
  if (!edge) return host.clientWidth + host.offsetLeft;
  const h = host.getBoundingClientRect();
  const e = edge.getBoundingClientRect();
  return host.clientWidth + Math.ceil(Math.max(h.left - e.left, e.right - h.right, host.offsetLeft));
}

export class TabSlideMotion {
  #host: () => HTMLDivElement | null;

  slideAnims: Animation[] = [];
  slideSeq = -1;
  slideTabs: string[] = [];

  constructor(host: () => HTMLDivElement | null) {
    this.#host = host;
  }

  tabLayers = (tabId: string): HTMLElement[] => {
    const host = this.#host();
    if (!host) return [];
    const sel = `:scope > [data-tab="${CSS.escape(tabId)}"]`;
    return [...host.querySelectorAll<HTMLElement>(sel)];
  };

  stopSlide = (): void => {
    for (const a of this.slideAnims) a.cancel();
    this.slideAnims = [];
    this.slideTabs = [];
    this.slideSeq = -1;
  };

  startSlide = (s: TabSlide): void => {
    const fromEls = this.tabLayers(s.from);
    const toEls = this.tabLayers(s.to);
    const inFlight = this.slideAnims.some((a) => a.playState === "running" || a.playState === "paused");
    // 끊기 전에 읽는다 — 그래야 계산값이 "지금 자리" 다
    const fromAt = inFlight && this.slideTabs.includes(s.from) ? offsetOf(fromEls) : 0;
    const distance = slideDistance(this.#host());
    const toAt = inFlight && this.slideTabs.includes(s.to) ? offsetOf(toEls) : s.dir * distance;
    for (const a of this.slideAnims) a.cancel();
    this.slideAnims = [];
    this.slideSeq = s.seq;
    this.slideTabs = [s.from, s.to];
    if (distance <= 0) {
      endTabSlide(s.seq);
      return;
    }
    const opts: KeyframeAnimationOptions = {
      duration: inFlight ? TAB_SLIDE.rapidMs : TAB_SLIDE.ms,
      easing: TAB_SLIDE.easing,
      fill: "forwards",
    };
    const move = (els: HTMLElement[], a: number, b: number) => {
      for (const el of els) {
        this.slideAnims.push(
          el.animate([{ transform: `translateX(${a}px)` }, { transform: `translateX(${b}px)` }], opts),
        );
      }
    };
    move(fromEls, fromAt, -s.dir * distance);
    move(toEls, toAt, 0);
    const mine = this.slideAnims;
    Promise.all(mine.map((a) => a.finished)).then(
      () => {
        if (this.slideAnims === mine) endTabSlide(s.seq);
      },
      () => {},
    );
  };
}
