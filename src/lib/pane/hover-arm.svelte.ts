// 머리줄 호버 카드의 "시계 → 띄우기 / 걷기" 한 벌 — 컴포넌트 초기화 중에 부른다(안에서 `$effect` 를 건다).
import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";

export interface HoverArmOptions {
  target: () => HTMLElement | null;
  /** `false` 면 시계를 걸지 않는다 */
  before?: () => boolean;
  onShow?: () => void;
}

export interface HoverArm {
  readonly anchor: TooltipRect | null;
  arm: () => void;
  hide: () => void;
}

export function createHoverArm(o: HoverArmOptions): HoverArm {
  let anchor = $state<TooltipRect | null>(null);
  /** 창 전역 닫기 리스너는 이때만 건다 */
  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function hide(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    anchor = null;
    armed = false;
  }

  function arm(): void {
    hide();
    if (o.before && !o.before()) return;
    armed = true;
    timer = setTimeout(() => {
      timer = null;
      const el = o.target();
      if (!el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      o.onShow?.();
      anchor = { left: r.left, top: r.top, width: r.width, height: r.height };
    }, TOOLTIP_DELAY_MS);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") hide();
  }

  $effect(() => {
    if (!armed) return;
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", hide, opts);
    window.addEventListener("wheel", hide, opts);
    window.addEventListener("scroll", hide, opts);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", hide, opts);
      window.removeEventListener("wheel", hide, opts);
      window.removeEventListener("scroll", hide, opts);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  });

  return {
    get anchor() {
      return anchor;
    },
    arm,
    hide,
  };
}
