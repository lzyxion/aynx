// **폰 덮개의 나가는 움직임**(원격 웹 R5 · 10-25) — 들어오는 움직임(각 덮개의 CSS `@keyframes`)의 짝. 전체 화면 덮개(고르기 · 둘러보기 ·
// 설정 · 알림)는 오른쪽으로 밀려 나가고, 새 탭 시트는 아래로 내려간다. 움직임 줄이기를 켠 기기에서는 곧장 사라진다.
//
// 나가기 시작하는 순간 그 덮개를 `inert` 로 만든다 — 움직이는 동안 눌리지 않고, 안에 있던 포커스가 놓여 위 띠(`MobileBar`)가 제
// 단추로 포커스를 돌려받는다(포커스가 나가는 덮개에 남아 있으면 돌려받지 못한다).

import { cubicIn } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

function leaving(node: HTMLElement, duration: number, css: (u: number) => string): TransitionConfig {
  node.inert = true;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { duration: reduced ? 0 : duration, easing: cubicIn, css: (_t, u) => css(u) };
}

/** 전체 화면 덮개 — 화면 폭 전체가 오른쪽으로 밀려 나간다 */
export function pushOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 220, (u) => `transform: translateX(${u * 100}%)`);
}

/** 새 탭 시트의 판 — 제 높이만큼 아래로 내려간다 */
export function sheetOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 200, (u) => `transform: translateY(${u * 100}%)`);
}

/** 시트 뒤의 흐린 막 */
export function scrimOut(node: HTMLElement): TransitionConfig {
  return leaving(node, 200, (u) => `opacity: ${1 - u}`);
}
