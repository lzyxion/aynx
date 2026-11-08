/**
 * **독 목록의 펼침 판** (2026-10-19 — 호스트 · 프로젝트 · DB 칸, 사용자 승인 목업).
 *
 * 세 칸의 줄 목록은 순수 층이 **편 꼴**(깊이를 단 줄들)로 내준다. 화면은 펼친 폴더 · 프로젝트와 그 아이들을 **한 묶음 판**
 * (한 단 밝은 면 · 둥근 모서리)으로 감싸야 하므로, 편 줄들을 다시 **둥지 꼴**로 접는다(`nestRows`) — 선택 · 키보드 · 끌기는
 * 여전히 편 줄들의 순서(`order`)를 본다. 둥지는 그리는 모양일 뿐이다.
 *
 * 그 밖의 셋:
 * - **누르기 ↔ 두 번 누르기**(`createDeferredClick`) — 프로젝트 줄은 한 번 누르면 펼치고 두 번 누르면 연다. 펼침을 잠깐 미뤄
 *   두 번째 누르기가 오면 거둔다.
 * - **끌다 머물면 펼침**(`createSpringLoad`) — 끄는 짐이 접힌 폴더 위에 잠깐 머물면 그 폴더를 연다.
 * - **움직임 문지기**(`treeMotion`) — 사람이 펼치고 접은 그 자리만 움직인다(검색이 저절로 펼친 판 · 첫 그리기는 그대로 선다).
 *
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

/**
 * 편 줄들(부모 바로 뒤에 깊이가 더 깊은 아이들이 잇따르는 꼴)을 둥지로 접는다. 줄 하나의 부모는 **앞쪽에서 가장 가까운,
 * 깊이가 더 얕은 줄**이다. 순서는 그대로 지킨다 — 둥지를 다시 편 순서가 입력과 같다.
 */
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

/** CSS `cubic-bezier(x1, y1, x2, y2)` 와 같은 꼴의 이징 함수 (x 에서 t 를 이분법으로 찾는다) */
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

/** 프로젝트 줄 — 한 번 누르기의 펼침을 이만큼 미룬다(두 번 누르기 = 열기가 오면 거둔다) */
export const CLICK_TOGGLE_DELAY_MS = 250;

/**
 * 미뤄 두는 한 번 누르기. `schedule` 은 저마다 제 시계를 건다(따로 누른 두 번은 두 번 다 돈다), `cancel` 은 걸린 것을
 * **모두** 거둔다 — 두 번 누르기(`dblclick`)가 오면 그 앞의 누르기 둘이 건 것이 함께 사라진다.
 */
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

/** 수식 없는 누르기인가 — Ctrl · Shift · Meta 누르기는 고르기만 한다(펼치지 않는다) */
export function plainClick(ev: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }): boolean {
  return !ev.ctrlKey && !ev.shiftKey && !ev.metaKey;
}

// ---------------------------------------------------------------------------
// 끌다 머물면 펼침
// ---------------------------------------------------------------------------

export const SPRING_LOAD_MS = 600;

/**
 * 한 번에 한 자리만 건다. 같은 자리를 다시 걸면 **시계를 새로 걸지 않는다**(dragover 는 끊임없이 온다 — 머문 시간이 쌓여야
 * 한다), 다른 자리를 걸면 앞의 것을 거둔다. `disarm(key)` 는 그 자리일 때만, `disarm()` 은 무엇이든 거둔다.
 */
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

/**
 * 사람이 펼치고 접은 자리를 잠깐 기억한다 — 그 자리의 판만 움직인다. 검색이 저절로 펼친 판 · 검색을 지워 사라진 판 · 첫
 * 그리기 · 목록 다시 읽기는 기억에 없으므로 그대로 선다.
 */
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

/** 앱 하나에 하나 — 세 칸이 나눠 쓴다(키에 칸 이름을 붙인다: `host:` · `db:` · `project:`) */
export const treeMotion = createToggleMotion();

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * 아이들 묶음의 열고 닫기 — 높이 · 위 틈(padding-top) · 투명도를 함께 0 에서 제자리로. 문지기가 허락하지 않거나 움직임
 * 줄이기면 곧바로 선다.
 */
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
