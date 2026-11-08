// 머리줄 호버 카드의 "시계 → 띄우기 / 걷기" 한 벌 — 이름 카드 · tmux 칩 카드 · 포워딩 칩 카드가 각자 적던 같은 몸짓(2026-10-11).
//
// 뜨는 규칙은 공용 말풍선(`tooltip.svelte.ts`)에 맞춘다: 앵커에 들어오면 `TOOLTIP_DELAY_MS` 시계를 돌리고, 다 돌면 그 순간의
// 앵커 상자를 `anchor` 로 세운다. 포인터가 나가거나(부르는 쪽이 `hide`) 누르면 · `Esc` · 휠 · 스크롤 · 창 크기 · 창 포커스를
// 잃으면 걷는다. 창 전역 리스너는 시계가 돌거나 카드가 떠 있을 때만 건다(타일마다 늘 걸어 두지 않는다).
//
// **컴포넌트 초기화 중에 부른다** — 안에서 `$effect` 하나(창 전역 닫기)를 건다. 카드 값을 짓고 올리는 일(`$derived` →
// `on*card`)은 부르는 쪽 몫이다.
import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";

export interface HoverArmOptions {
  /** 앵커 요소 — 시계가 다 돈 순간 이 상자를 잰다(없거나 떨어졌으면 띄우지 않는다) */
  target: () => HTMLElement | null;
  /** 시계를 걸기 전 — `false` 면 걸지 않는다(이 타일엔 카드가 없다). 호버 갱신 같은 일도 여기서 */
  before?: () => boolean;
  /** 시계가 다 돌아 앵커를 세우기 직전 */
  onShow?: () => void;
}

export interface HoverArm {
  /** 떠 있는 카드의 앵커 상자 — 걷혔으면 `null` */
  readonly anchor: TooltipRect | null;
  /** 들어왔다 — (앞의 것을 걷고) 시계를 건다 */
  arm: () => void;
  /** 걷는다 — 시계도 멈춘다 */
  hide: () => void;
}

export function createHoverArm(o: HoverArmOptions): HoverArm {
  let anchor = $state<TooltipRect | null>(null);
  /** 시계가 돌고 있거나 카드가 떠 있다 — 창 전역 닫기 리스너를 이때만 건다 */
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
