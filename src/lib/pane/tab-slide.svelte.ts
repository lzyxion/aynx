/**
 * **탭 전환 슬라이드** (docs/log/2026-09-29-tab-slide.md).
 *
 * 사람이 탭을 고르면(탭 바 클릭 · 다음/이전 탭 · `Alt+N` · 팔레트 — 전부 `pickTab`) 떠나는 탭의 타일
 * 캔버스가 옆으로 밀려 나가고 고른 탭의 캔버스가 반대편에서 들어온다. 시안 A("전체가 옆으로")의
 * "보통"(240ms)으로 돌렸다 — 두 배(400ms)는 너무 느렸다(10-17 사용자).
 *
 * 모듈 상태는 **요청 하나**다 — "지금 어느 탭에서 어느 탭으로 미끄러지는가" 한 칸. 탭을 바꾸는 쪽
 * (`tabs.pickTab`)이 `activeId` 를 바꾸기 **직전에** 적고, 그리는 쪽(`PaneHost`)이 읽는다. 같은
 * 반응 플러시에서 둘이 함께 보이므로 떠나는 탭의 타일은 한 프레임도 `display:none` 이 되지 않는다(그래야
 * 그 터미널의 WebGL 이 떨어졌다 다시 붙는 일이 없다). 움직임 자체(Web Animations)는 아래 `TabSlideMotion`
 * 이 돌리고, 그것을 부르는 `$effect` 는 `PaneHost` 에 있다.
 *
 * 탭 닫기 · 새 탭 · 이관 · 복원 · 드래그 재배치는 이 길을 지나지 않는다 — `selectTab` 을 직접 부르므로
 * 요청이 없고, `PaneHost` 는 요청의 `to` 가 지금 활성 탭과 다르면 슬라이드가 없는 것으로 본다.
 *
 * 이 모듈이 import 하는 것은 `dashboard-motion`(아무것도 import 하지 않는다) 하나다 — 순환 없음.
 */

import { prefersReducedMotion } from "$lib/console/dashboard-motion";

export const TAB_SLIDE = {
  /** 한 번의 전환 — 550ms 에서 곡선은 그대로 두고 길이만 줄였다(10-23 사용자 "좀만 빠르게") */
  ms: 460,
  /** 도는 도중에 다시 바뀌면(탭 전환 키 연타·누르고 있기) 이 길이로 **지금 자리에서** 새 목표로 간다 */
  rapidMs: 120,
  /**
   * 천천히 떠나 가운데서 빠르고 부드럽게 서는 곡선(ease-in-out 쪽). 예전 quint 감속(0.22, 1, 0.36, 1)은 첫 프레임에
   * 폭의 15% 를 한 번에 건너뛰고(들어오는 탭의 첫 그리기가 무거우면 더 크게) 끝 200ms 는 거의 서 있어서, 시작이
   * "뚝" 끊겨 보였다(10-17 사용자 · 헤드리스 rAF 표본). 지금은 세 토막(10-17 사용자 — "마지막 15% 에서 살짝
   * 느려지게", 이어 "또렷하게", "더 감속", "앞은 240ms 때 빠르기, 끝은 250ms", "감속 구간 25%", "멈추기 직전까지 느리게
   * 기어 들어오게", "더 길게 · 더 넓게", "마지막 좀만 빠르게"): 처음 24ms 에 부드럽게 붙고 → 65% 지점(114ms)까지
   * 240ms 때와 같은 빠르기 → 남은 35% 를 436ms 동안(전체 550ms) 빠르기 v0/(1+s/63ms)² 로 줄인다(이 ms 들은 550ms
   * 기준 — 점열은 비율이라 `ms` 를 바꾸면 같은 꼴로 늘고 준다). 속도는 65% 에서
   * 끊기지 않고, 거듭제곱 감속과 달리 끝에서도 0 이 되지 않아 마지막까지 눈에 보이게 기어 간다(700ms 는 끝이 늘어졌다).
   * cubic-bezier 로는 "중간 등속 + 끝에서만 감속" 이 안 나와 `linear()` 점열로 적는다.
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

/** 지금 걸린 슬라이드 요청 (없으면 `null`) */
export function tabSlide(): TabSlide | null {
  return current;
}

/**
 * `from` → `to` 로 미끄러지라고 적는다. 움직임 줄이기면 적지 않는다(이미 걸린 것도 거둔다).
 * `dir` 은 탭 바의 **순서** 비교다 — 감싸 도는 다음 탭(끝 → 처음)도 처음 탭은 왼쪽에 있으므로 오른쪽으로 민다.
 */
export function requestTabSlide(from: string | null, to: string, dir: 1 | -1): void {
  if (from === null || from === to || prefersReducedMotion()) {
    current = null;
    return;
  }
  current = { seq: ++counter, from, to, dir };
}

/** 슬라이드 없이 바꾼다 — 걸려 있던 요청을 거둔다 */
export function clearTabSlide(): void {
  current = null;
}

/** 그 슬라이드가 끝났다 (그사이 새 요청이 걸렸으면 건드리지 않는다) */
export function endTabSlide(seq: number): void {
  if (current?.seq === seq) current = null;
}

// ── 탭 전환 슬라이드의 움직임 ────────────────────────────────────────────
//
// 타일 상자는 탭마다 묶여 있지 않다(앱 전역 평면 목록 — 옮겨 담으면 재마운트다). 그래서 탭 하나를
// 미는 것은 그 탭의 상자 전부와 분할선 층에 **같은 키프레임**을 거는 일이다. 거리는 캔버스 폭 + 바깥
// 간격 하나 — 끝 자리에서 가장자리 거터에 한 줄도 비치지 않는다(바깥은 `.sliding` 이 오려 낸다).
//
// 도는 도중에 다시 바뀌면 **지금 자리에서** 새 목표로 간다: 떠나던 탭이 또 떠나거나 들어오던 탭이
// 되돌아 나가는 것은 계산된 현재 `transform` 에서 이어 가고, 이번 전환에 끼지 않는 탭은 그 자리에서
// 숨는다(이미 대부분 화면 밖이다). 쌓지 않는다 — 걸린 움직임은 늘 하나다.

/** 그 탭 층의 지금 가로 위치(px) — 도는 애니메이션의 계산값 */
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
 * 한 탭 층을 화면 밖으로 밀어낼 거리(px) — 캔버스 폭 + 보이는 바깥 폭. 보통은 바깥 거터 하나(`offsetLeft` = `--gap` —
 * `.sliding` 이 거기서 오려 낸다). 조상이 `[data-slide-bleed]`(둥근 상태바 패널)이면 오림이 그 상자의 가로 끝까지 열리므로
 * 양쪽 중 먼 끝까지 민다 — 패널 뒤로 지나간 타일이 끝 자리에서 창 가장자리에 걸려 보이지 않게.
 */
function slideDistance(host: HTMLDivElement | null): number {
  if (!host) return 0;
  const edge = host.closest<HTMLElement>("[data-slide-bleed]");
  if (!edge) return host.clientWidth + host.offsetLeft;
  const h = host.getBoundingClientRect();
  const e = edge.getBoundingClientRect();
  return host.clientWidth + Math.ceil(Math.max(h.left - e.left, e.right - h.right, host.offsetLeft));
}

/**
 * 슬라이드를 **돌리는** 쪽 — `PaneHost` 가 캔버스(`host`) 옆에서 하나 만들고, 요청이 바뀌면 그 `$effect` 가
 * [`startSlide`]·[`stopSlide`] 를 부른다 (효과는 `PaneHost` 에 있다). 요청(위의 모듈 상태)과는 다른 것이다.
 */
export class TabSlideMotion {
  #host: () => HTMLDivElement | null;

  slideAnims: Animation[] = [];
  slideSeq = -1;
  /** 지금 도는 슬라이드의 두 탭 — 다음 전환이 "지금 자리" 를 읽을 대상 */
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
