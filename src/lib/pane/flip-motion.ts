/**
 * AI 타일 [터미널 | 대화] 넘김의 3D 카드 뒤집기 — "반쪽 두 번": ±90° 에서 면 내용이 바뀌고 반대 가장자리에서 돌아온다(뒷면 · `backface-visibility` 없음).
 * 쉬는 자리는 늘 클래스가 말하고, 이 파일은 바뀌기 전 동안만 옛 면을 계단 키프레임으로 붙잡는다 — 상자 회전과 같은 시간 · 같은 곡선이어야 계단이 가장자리에 맞는다.
 * 상자 회전은 `composite: "add"` — 탭 전환 슬라이드(`pane/tab-slide.svelte.ts`)가 같은 상자의 `transform` 을 밀어도 덮지 않는다.
 */

import { prefersReducedMotion } from "$lib/console/dashboard-motion";
import {
  FLIP_CARD,
  cardAt,
  cardScale,
  flipDuration,
  planFlip,
  restingCard,
  type CardPlan,
  type CardState,
  type Face,
} from "$lib/pane/flip-card";

const heads = new Map<string, HTMLElement>();

let registered = false;
function registerInk(): void {
  if (registered) return;
  registered = true;
  try {
    CSS.registerProperty({ name: "--flip-ink", syntax: "<number>", inherits: false, initialValue: "0" });
  } catch {
    // 이미 등록됐거나 지원하지 않는다
  }
}

export function registerFlipHead(paneId: string, head: HTMLElement): () => void {
  registerInk();
  heads.set(paneId, head);
  return () => {
    if (heads.get(paneId) === head) heads.delete(paneId);
  };
}

/** `AiFlip` · `PaneHeader` 의 클래스와 같은 값이어야 한다 */
const TERM_LAYER: Record<Face, string> = { term: "none", convo: "translateX(-100%)" };
const CONVO_LAYER: Record<Face, string> = { term: "translateX(100%)", convo: "none" };
const INK: Record<Face, string> = { term: "0", convo: "1" };

function cardTransform(perspective: number, angle: number): string {
  return `perspective(${perspective}px) rotateY(${angle}deg) scale(${cardScale(angle)})`;
}

export class FlipMotion {
  #anims: Animation[] = [];
  #plan: CardPlan | null = null;
  #lead: Animation | null = null;

  #current(): CardState | null {
    const lead = this.#lead;
    const plan = this.#plan;
    if (!lead || !plan || (lead.playState !== "running" && lead.playState !== "paused")) return null;
    const p = lead.effect?.getComputedTiming().progress;
    return typeof p === "number" ? cardAt(plan, p) : null;
  }

  stop(): void {
    for (const a of this.#anims) a.cancel();
    this.#anims = [];
    this.#plan = null;
    this.#lead = null;
  }

  /** 클래스(쉬는 자리)는 이미 `to` 로 바뀌어 있어야 한다 — 이 함수는 그 사이를 그릴 뿐이다 */
  flip(
    paneId: string,
    from: Face,
    to: Face,
    box: HTMLElement | null,
    termEl: HTMLElement | null,
    convoEl: HTMLElement | null,
  ): void {
    // 끊기 전에 읽는다 — 그래야 진행도가 "지금" 이다
    const now = this.#current();
    const inFlight = now !== null;
    this.stop();
    const w = box?.clientWidth ?? 0;
    if (!box || w <= 0 || prefersReducedMotion()) return;
    const plan = planFlip(now ?? restingCard(from), to);
    if (!plan) return;
    const duration = flipDuration(plan, inFlight);
    const opts: KeyframeAnimationOptions = { duration, easing: inFlight ? FLIP_CARD.rapidEasing : FLIP_CARD.easing };
    const perspective = Math.round(w * FLIP_CARD.perspective);

    const lead = box.animate(
      plan.stops.map((s) => ({ offset: s.offset, transform: cardTransform(perspective, s.angle) })),
      { ...opts, composite: "add" },
    );
    this.#anims.push(lead);
    this.#lead = lead;
    this.#plan = plan;

    const at = plan.swapAt;
    if (at === null) return;
    const hold = (el: HTMLElement | null | undefined, prop: string, values: Record<Face, string>) => {
      if (!el) return;
      const a = values[plan.from];
      const b = values[plan.to];
      this.#anims.push(
        el.animate(
          [
            { [prop]: a, offset: 0 },
            { [prop]: a, offset: at },
            { [prop]: b, offset: at },
            { [prop]: b, offset: 1 },
          ] as Keyframe[],
          opts,
        ),
      );
    };
    hold(termEl, "transform", TERM_LAYER);
    hold(convoEl, "transform", CONVO_LAYER);
    hold(heads.get(paneId), "--flip-ink", INK);
  }
}
