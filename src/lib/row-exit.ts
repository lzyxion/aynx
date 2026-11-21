/** 지운 줄의 나가기 트랜지션 — DOM 을 재는 몫만 쥐고 수(시간 · 지연 · css)는 순수 모듈 `dock-alert-exit.ts` 의 것이다. */
import type { TransitionConfig } from "svelte/transition";
import { exitDelay, exitDuration, exitFrame, exitSpan, type ExitSide } from "$lib/dock-alert-exit";

/** 상태줄 알약(`StatusBar.svelte` 의 `reducedMotion`)과 같은 판정 */
export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Svelte 가 outro 동안 `inert` 를 건다 */
export const exitingIn = (parent: Element | null): Element[] =>
  parent ? Array.from(parent.children).filter((c) => (c as HTMLElement).inert) : [];

/** 줄이 여러 부모에 흩어져 있으면 `exiting` 을 바깥 상자에서 모아 넘긴다 */
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
 * 지연 설정(함수를 돌려주는 함수)이다 — Svelte 가 한 마이크로태스크 뒤에 부르므로 그때는 함께 지워진 줄이 모두 `inert` 다.
 * `active` 가 거짓이면 곧바로 빠진다 — 지우기가 아닌 까닭(보기 전환 · 거르기 · 내려감)에 `|global` 트랜지션이 화면을 붙잡지 않게 하는 문이다.
 */
export function makeRowExit(
  side: () => ExitSide,
  active: () => boolean = () => true,
  exiting?: (node: HTMLElement) => Element[],
): (node: HTMLElement) => () => TransitionConfig {
  return (node) => () => (active() ? rowExitConfig(node, side(), exiting?.(node)) : { duration: 0 });
}

export function exitingWithin(root: Element | null, selector: string): Element[] {
  return root ? Array.from(root.querySelectorAll(selector)).filter((e) => (e as HTMLElement).inert) : [];
}

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

/** 가장 긴 나가기(차례 상한 220 + 180 + 150)에 넉넉히 */
export const EXIT_WINDOW_MS = 1500;
