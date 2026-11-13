/**
 * **지운 줄의 나가기 트랜지션** — 독 알림 칸(`DockAlerts.svelte`)에서 시작해 작업안의 진행 · 기록 지우기(2026-11-13)가 함께 쓴다.
 * 수(시간 · 지연 · 한 장면의 css)는 순수 모듈 `dock-alert-exit.ts` 의 것이고, 여기는 DOM 을 재는 몫(높이 · 틈 · 함께 나가는 줄의
 * 차례 · 움직임 줄이기 판정)만 쥔다.
 *
 * Svelte `out:` 에 넘기는 **지연 설정**(함수를 돌려주는 함수)이다 — Svelte 가 한 마이크로태스크 뒤에 부르므로 그때는 함께 지워진
 * 줄이 모두 `inert` 다. 그래서 "함께 나가는 줄 가운데 몇 번째" 로 차례 지연을 정한다(한 줄이면 0).
 *
 * `active` 를 주면 그것이 참일 때만 움직인다(거짓이면 시간 0 — 곧바로 빠진다). 지우기가 아닌 까닭으로 줄이 빠질 때(보기 전환 ·
 * 거르기 · 컴포넌트가 내려감) `|global` 트랜지션이 화면을 붙잡지 않게 하는 문이다.
 */
import type { TransitionConfig } from "svelte/transition";
import { exitDelay, exitDuration, exitFrame, exitSpan, type ExitSide } from "$lib/dock-alert-exit";

/** 상태줄 알약(`StatusBar.svelte` 의 `reducedMotion`)과 같은 판정 — 나가기를 시작하는 그 순간에 본다 */
export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 지금 나가는 중인 형제 줄(Svelte 가 outro 동안 `inert` 를 건다) */
export const exitingIn = (parent: Element | null): Element[] =>
  parent ? Array.from(parent.children).filter((c) => (c as HTMLElement).inert) : [];

/**
 * 한 줄의 나가기 설정 — 밀려 나감 → 높이 접힘(`dock-alert-exit.ts` 머리말). 높이 · 틈은 이 순간 잰다.
 * `exiting` 은 차례를 매길 "함께 나가는 줄" 목록(문서 순서) — 생략하면 같은 부모의 형제 줄. 줄이 여러 부모에 흩어져 있으면
 * (기록 보기의 날짜 묶음마다 카드) 바깥 상자에서 모아 넘긴다.
 */
export function rowExitConfig(node: HTMLElement, side: ExitSide, exiting?: Element[]): TransitionConfig {
  const reduced = reducedMotion();
  const index = (exiting ?? exitingIn(node.parentElement)).indexOf(node);
  const height = node.getBoundingClientRect().height;
  const gap = node.parentElement ? parseFloat(getComputedStyle(node.parentElement).rowGap) || 0 : 0;
  return {
    delay: exitDelay(index, reduced),
    duration: exitDuration(reduced),
    css: (t) => exitFrame(1 - t, { side, height, gap, reduced }),
  };
}

/**
 * `out:` 에 넘길 트랜지션을 만든다 — `side` 는 줄이 밀려 나갈 화면 가장자리, `active` 는 위 머리말의 문,
 * `exiting` 은 차례를 매길 줄 목록(생략하면 같은 부모의 형제 — `rowExitConfig`).
 */
export function makeRowExit(
  side: () => ExitSide,
  active: () => boolean = () => true,
  exiting?: (node: HTMLElement) => Element[],
): (node: HTMLElement) => () => TransitionConfig {
  return (node) => () => (active() ? rowExitConfig(node, side(), exiting?.(node)) : { duration: 0 });
}

/** `root` 안에서 나가는 중인(`inert`) `selector` 줄들 — 문서 순서. 여러 부모에 흩어진 줄의 차례를 하나로 매긴다 */
export function exitingWithin(root: Element | null, selector: string): Element[] {
  return root ? Array.from(root.querySelectorAll(selector)).filter((e) => (e as HTMLElement).inert) : [];
}

/** 빈 상태 문구 — `exiting`(함께 나가는 줄들)의 마지막 줄까지 다 나간 뒤에 흐릿하게 들어온다(`active` 가 거짓이면 곧바로) */
export function makeEmptyIn(
  exiting: () => Element[],
  active: () => boolean = () => true,
): (node: HTMLElement) => () => TransitionConfig {
  return () => () => {
    if (!active()) return { duration: 0 };
    return {
      delay: exitSpan(exiting().length, reducedMotion()),
      duration: 150,
      css: (t) => `opacity: ${t};`,
    };
  };
}

/** 지우기 뒤 이 시간(ms) 안에 빠지는 줄만 움직인다 — 가장 긴 나가기(차례 상한 220 + 180 + 150)에 넉넉히 */
export const EXIT_WINDOW_MS = 1500;
