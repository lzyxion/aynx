/**
 * **AI 타일 [터미널 | 대화] 넘김의 움직임 — 3D 카드 뒤집기** (2026-10-17 가로 밀기 → 2026-10-20 카드 뒤집기, 사용자 선택).
 * 타일 한 장(`PaneHost` 의 `.pane-box` — 머리줄 + 본문)이 세로축으로 뒤집힌다. 각도 · 면 · 시간의 셈은 순수 층 `pane/flip-card.ts`.
 *
 * - **"반쪽 두 번"**: 상자는 한 면만 그린다. 지금 면이 ±90° 까지 돌아 사라지는 프레임에 면 내용이 바뀌고(본문 터미널 층 / 대화 층 ·
 *   머리줄 색), 반대 가장자리에서 0° 로 돌아온다 — 뒷면 · 거울 글자 · `backface-visibility` 가 없다.
 * - 면 내용의 쉬는 자리는 **언제나 클래스**가 말한다(`AiFlip` 의 `.off` · `.on`, 머리줄의 `.talk` — 클릭 순간 이미 새 면). 이 파일은
 *   면이 바뀌기 전 동안만 옛 면을 **계단 키프레임**으로 붙잡아 둔다: 터미널 층 · 대화 층의 `transform`(밀어 둔 자리 — 숨기지 않는다),
 *   머리줄의 수 `--flip-ink`(0 터미널 · 1 대화 — 머리줄 글자색 · 바탕이 그 수로 섞인다). 상자 회전과 **같은 시간 · 같은 곡선**이라
 *   계단 offset(= `swapAt`)이 정확히 가장자리를 지나는 프레임이다. 애니메이션은 `fill` 없이 끝나면 걷힌다.
 * - 상자 회전은 `composite: "add"` — 탭 전환 슬라이드(`pane/tab-slide.svelte.ts`)가 같은 상자의 `transform` 을 밀어도 덮지 않고
 *   그 위에 얹는다. `transform` 만 바꾸므로 레이아웃 · 크기가 그대로다(refit · resize 없음). 원근은 `perspective()` 함수로 상자
 *   자신에 걸고(부모 손대지 않음), 가까워진 가장자리가 위아래로 튀어나오지 않게 살짝 물러난다(`cardScale`).
 * - 도는 도중에 다시 누르면 끊기 **전에** 지금 진행도에서 면 · 각도를 읽어(`cardAt`) 거기서 새 길을 짠다 — 지금 면이 목표면 그
 *   각도에서 짧게 되돌아가고, 아니면 그 가장자리까지 가서 바꾼다. 움직임 줄이기 · 폭 0(숨은 탭)이면 움직임 없이 클래스가 곧바로 선다.
 * - 첫 그리기 · F5 · 탭 복귀에는 부르지 않는다(`AiFlip` 이 면이 **바뀔 때만** 부른다).
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

/** 머리줄 — 면 색(`--flip-ink`)을 받는 요소. 두 컴포넌트는 서로를 모르니(둘 다 `PaneHost` 아래) 타일 id 로 적는다 */
const heads = new Map<string, HTMLElement>();

let registered = false;
/** `--flip-ink` 를 수로 등록한다(등록 못 하면 미등록 사용자 속성의 이산 보간 — 계단이라 같은 그림) */
function registerInk(): void {
  if (registered) return;
  registered = true;
  try {
    CSS.registerProperty({ name: "--flip-ink", syntax: "<number>", inherits: false, initialValue: "0" });
  } catch {
    // 이미 등록됐거나 지원하지 않는다
  }
}

/** 머리줄이 제 요소를 적는다 — 돌려준 함수로 걷는다(같은 요소일 때만). 머리줄이 없으면(숨긴 설정) 상자 · 본문만 돈다 */
export function registerFlipHead(paneId: string, head: HTMLElement): () => void {
  registerInk();
  heads.set(paneId, head);
  return () => {
    if (heads.get(paneId) === head) heads.delete(paneId);
  };
}

/** 면마다의 쉬는 값 — `AiFlip` · `PaneHeader` 의 클래스와 같은 값이어야 한다 */
const TERM_LAYER: Record<Face, string> = { term: "none", convo: "translateX(-100%)" };
const CONVO_LAYER: Record<Face, string> = { term: "translateX(100%)", convo: "none" };
const INK: Record<Face, string> = { term: "0", convo: "1" };

function cardTransform(perspective: number, angle: number): string {
  return `perspective(${perspective}px) rotateY(${angle}deg) scale(${cardScale(angle)})`;
}

/** 타일 하나의 뒤집기 — `AiFlip` 이 하나 쥔다 */
export class FlipMotion {
  #anims: Animation[] = [];
  /** 지금 도는 길과 그 회전(진행도를 읽는 기준) */
  #plan: CardPlan | null = null;
  #lead: Animation | null = null;

  /** 지금 보이는 면 · 각도 — 돌지 않으면 `null` */
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

  /**
   * `from` 면에서 `to` 면으로 뒤집는다(`from` 은 쉬던 면 — 도는 중이면 무시하고 지금 상태를 읽는다). `box` 는 타일 상자(`.pane-box`).
   * 클래스(쉬는 자리)는 이미 `to` 로 바뀌어 있어야 한다 — 이 함수는 그 사이를 그릴 뿐이다.
   */
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
    if (at === null) return; // 같은 면으로 되돌아간다 — 면 내용은 이미 클래스 그대로
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
