/**
 * **한 줄 안 FLIP 재배치** (2026-10-18 — 설정 › 터미널 "타일 머리줄 칩" 줄, 목업 E5yfAAq5XawDLGCjhSAH4U).
 *
 * 순서가 바뀌기 **직전**에 줄 안 항목들의 지금 보이는 자리(`getBoundingClientRect().left` — 움직이는 중이면 그 중간)를 재고
 * (`measureLefts`), 바뀐 DOM 이 서면(`tick()` 뒤) 진행 중 움직임을 걷고 새 자리를 재어 옛 자리 → 새 자리로 미끄러지게 한다
 * (`playFlip`). 움직이는 도중에 순서가 또 바뀌어도 튀지 않고 그 지점에서 방향만 꺾는다.
 *
 * Web Animations(`el.animate`)만 쓴다 — **인라인 style 을 건드리지 않으므로** 다시 그리기가 style 을 덮어써도 움직임이 지워지지
 * 않는다. 곡선은 끝에서 길게 감속하는 `cubic-bezier(.22,1,.36,1)` 하나(빨리 비켜서고 천천히 자리 잡는다), 미끄러짐 600ms ·
 * 놓인 항목의 내려앉기 480ms(`scale(.8)` · 흐림 → `scale(1.08)` @55% → 제자리). 값은 목업에서 사용자가 고른 그대로다.
 * `prefers-reduced-motion: reduce` 면 아무것도 움직이지 않는다(순서는 그대로 바뀐다).
 *
 * 항목은 `data-flip-id` 로 찾는다. 이 모듈은 아무것도 import 하지 않는다.
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

/** 항목 id → 지금 **보이는** 왼쪽 끝(px) */
export function measureLefts(container: HTMLElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of items(container)) {
    const id = el.dataset.flipId;
    if (id !== undefined) out.set(id, el.getBoundingClientRect().left);
  }
  return out;
}

/** 바뀐 뒤 — `before`(바뀌기 전 `measureLefts`)에서 새 자리로. `pop` 은 방금 놓인 항목(미끄러지지 않고 내려앉는다) */
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

/**
 * 커서 x 가 가리키는 **삽입 자리**(끄는 항목을 뺀 나머지 사이의 칸 번호). 비교는 항목의 **배치상** 중심
 * (`offsetLeft + offsetWidth/2`) — 움직이는 중인 항목의 transform 은 보지 않는다. `container` 는 위치가 잡힌
 * (`position: relative`) 항목들의 offsetParent 여야 한다.
 */
export function insertIndexAt(container: HTMLElement, rest: readonly string[], clientX: number): number {
  const left = container.getBoundingClientRect().left - container.scrollLeft;
  for (let i = 0; i < rest.length; i++) {
    const el = container.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(rest[i])}"]`);
    if (el && clientX < left + el.offsetLeft + el.offsetWidth / 2) return i;
  }
  return rest.length;
}
