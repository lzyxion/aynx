// 폰 덮개의 나가는 움직임. 나가기 시작하는 순간 덮개를 `inert` 로 만든다 — 포커스가 나가는 덮개에 남으면 위 띠(`MobileBar`)가
// 제 단추로 포커스를 돌려받지 못한다.

import { cubicIn } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

function leaving(node: HTMLElement, duration: number, css: (u: number) => string): TransitionConfig {
  node.inert = true;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { duration: reduced ? 0 : duration, easing: cubicIn, css: (_t, u) => css(u) };
}

export function pushOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 220, (u) => `transform: translateX(${u * 100}%)`);
}

export function sheetOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 200, (u) => `transform: translateY(${u * 100}%)`);
}

export function scrimOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 200, (u) => `opacity: ${1 - u}`);
}
