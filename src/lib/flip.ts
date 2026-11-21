/**
 * 한 줄 안 FLIP 재배치 — 항목은 `data-flip-id` 로 찾는다.
 * Web Animations(`el.animate`)만 쓴다 — 인라인 style 을 건드리면 다시 그리기가 덮어써 움직임이 지워진다. 곡선 · 시간 값은 사용자가 고른 그대로다.
 */

export const FLIP_EASE = "cubic-bezier(.22,1,.36,1)";
export const FLIP_SLIDE_MS = 600;
export const FLIP_POP_MS = 480;

const ITEM = "[data-flip-id]";

function items(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM));
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 순서가 바뀌기 직전에 잰다 — 움직이는 중이면 그 중간 자리 */
export function measureLefts(container: HTMLElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of items(container)) {
    const id = el.dataset.flipId;
    if (id !== undefined) out.set(id, el.getBoundingClientRect().left);
  }
  return out;
}

/** 바뀐 DOM 이 선 뒤(`tick()` 뒤) 부른다. `pop` 은 방금 놓인 항목(미끄러지지 않고 내려앉는다) */
export function playFlip(container: HTMLElement, before: Map<string, number>, pop: string | null = null): void {
  const els = items(container);
  for (const el of els) for (const a of el.getAnimations()) a.cancel();
  if (reducedMotion()) return;
  for (const el of els) {
    const id = el.dataset.flipId;
    if (id === undefined) continue;
    if (id === pop) {
      el.animate(
        [
          { transform: "scale(.8)", opacity: 0.15 },
          { transform: "scale(1.08)", opacity: 1, offset: 0.55 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: FLIP_POP_MS, easing: FLIP_EASE },
      );
      continue;
    }
    const old = before.get(id);
    if (old === undefined) continue;
    const dx = old - el.getBoundingClientRect().left;
    if (Math.abs(dx) < 0.5) continue;
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
      duration: FLIP_SLIDE_MS,
      easing: FLIP_EASE,
    });
  }
}

/** `rest` 는 끄는 항목을 뺀 나머지. `container` 는 항목들의 offsetParent(`position: relative`)여야 한다 */
export function insertIndexAt(container: HTMLElement, rest: readonly string[], clientX: number): number {
  const left = container.getBoundingClientRect().left - container.scrollLeft;
  for (let i = 0; i < rest.length; i++) {
    const el = container.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(rest[i])}"]`);
    if (el && clientX < left + el.offsetLeft + el.offsetWidth / 2) return i;
  }
  return rest.length;
}
