/**
 * 선택 · 키보드 · 끌기는 편 줄들의 순서를 본다 — 둥지(`nestRows`)는 그리는 모양일 뿐이다.
 * 시계는 넣어 받는다(`timers` · `now`) — 시험이 가짜 시계로 돈다.
 */
import type { TransitionConfig } from "svelte/transition";

// ---------------------------------------------------------------------------
// 둥지 꼴
// ---------------------------------------------------------------------------

export interface TreeNode<T> {
  row: T;
  children: TreeNode<T>[];
}

export function nestRows<T>(rows: readonly T[], depthOf: (row: T) => number): TreeNode<T>[] {
  const top: TreeNode<T>[] = [];
  const stack: { depth: number; node: TreeNode<T> }[] = [];
  for (const row of rows) {
    const depth = depthOf(row);
    const node: TreeNode<T> = { row, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length === 0) top.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  return top;
}

// ---------------------------------------------------------------------------
// 곡선 — 설정 › AI 에이전트 펼침(`settings.css` 의 `.slist.accordion`)과 같은 200ms · cubic-bezier(0.2, 0.8, 0.2, 1)
// ---------------------------------------------------------------------------

export const ACCORDION_MS = 200;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 30; i++) {
      t = (lo + hi) / 2;
      if (bez(t, x1, x2) < x) lo = t;
      else hi = t;
    }
    return bez(t, y1, y2);
  };
}

export const ACCORDION_EASE = cubicBezier(0.2, 0.8, 0.2, 1);

// ---------------------------------------------------------------------------
// 시계
// ---------------------------------------------------------------------------

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ---------------------------------------------------------------------------
// 누르기 ↔ 두 번 누르기
// ---------------------------------------------------------------------------

export const CLICK_TOGGLE_DELAY_MS = 250;

/** `cancel` 은 걸린 것을 모두 거둔다 — 두 번 누르기가 오면 그 앞의 누르기 둘이 건 것이 함께 사라져야 한다 */
export function createDeferredClick(delayMs = CLICK_TOGGLE_DELAY_MS, timers: Timers = realTimers) {
  const pending = new Set<unknown>();
  return {
    schedule(fn: () => void): void {
      const h = timers.set(() => {
        pending.delete(h);
        fn();
      }, delayMs);
      pending.add(h);
    },
    cancel(): void {
      for (const h of pending) timers.clear(h);
      pending.clear();
    },
    get pending(): number {
      return pending.size;
    },
  };
}

export function plainClick(ev: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }): boolean {
  return !ev.ctrlKey && !ev.shiftKey && !ev.metaKey;
}

// ---------------------------------------------------------------------------
// 끌다 머물면 펼침
// ---------------------------------------------------------------------------

export const SPRING_LOAD_MS = 600;

/** 같은 자리를 다시 걸면 시계를 새로 걸지 않는다 — dragover 는 끊임없이 오므로 머문 시간이 쌓여야 한다 */
export function createSpringLoad(delayMs = SPRING_LOAD_MS, timers: Timers = realTimers) {
  let armed: { key: string; handle: unknown } | null = null;
  return {
    arm(key: string, fire: () => void): void {
      if (armed?.key === key) return;
      if (armed) timers.clear(armed.handle);
      const handle = timers.set(() => {
        armed = null;
        fire();
      }, delayMs);
      armed = { key, handle };
    },
    disarm(key?: string): void {
      if (!armed || (key !== undefined && armed.key !== key)) return;
      timers.clear(armed.handle);
      armed = null;
    },
    get armed(): string | null {
      return armed?.key ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// 움직임 문지기
// ---------------------------------------------------------------------------

export function createToggleMotion(windowMs = ACCORDION_MS + 200, now: () => number = () => performance.now()) {
  let last: { key: string; at: number } | null = null;
  return {
    mark(key: string): void {
      last = { key, at: now() };
    },
    allows(key: string): boolean {
      return last !== null && last.key === key && now() - last.at <= windowMs;
    },
  };
}

/** 세 칸이 나눠 쓴다 — 키에 칸 이름을 붙인다(`host:` · `db:` · `project:`) */
export const treeMotion = createToggleMotion();

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function accordion(node: HTMLElement, params: { key: string }): TransitionConfig {
  if (reducedMotion() || !treeMotion.allows(params.key)) return { duration: 0 };
  const cs = getComputedStyle(node);
  const height = node.offsetHeight;
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  return {
    duration: ACCORDION_MS,
    easing: ACCORDION_EASE,
    css: (t) =>
      `overflow:hidden;opacity:${Math.min(1, t * 1.5).toFixed(3)};height:${(t * height).toFixed(2)}px;` +
      `padding-top:${(t * padTop).toFixed(2)}px;padding-bottom:${(t * padBottom).toFixed(2)}px`,
  };
}

/**
 * 패널을 가진 화면마다 문지기(`createToggleMotion`)를 하나씩 두고 사람이 단추로 여닫을 때만 `mark` 한다.
 * 안쪽 내용은 고정 폭이어야 한다(부르는 쪽 CSS 몫) — 아니면 줄이 다시 흐른다.
 */
export function sidePanelGrow(
  node: HTMLElement,
  params: { motion: ReturnType<typeof createToggleMotion>; key: string },
): TransitionConfig {
  if (reducedMotion() || !params.motion.allows(params.key)) return { duration: 0 };
  const w = parseFloat(getComputedStyle(node).width) || node.offsetWidth;
  return {
    duration: ACCORDION_MS,
    easing: ACCORDION_EASE,
    css: (t) => {
      const px = (t * w).toFixed(2);
      return `overflow:hidden;width:${px}px;flex-basis:${px}px;min-width:0`;
    },
  };
}
