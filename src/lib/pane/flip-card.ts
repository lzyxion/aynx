/**
 * AI 타일 [터미널 | 대화] 카드 뒤집기의 순수 계산 — 그리기는 `pane/flip-motion.ts`.
 * 뒷면이 없다: 지금 면이 ±90° 까지 돌아 사라지고 면이 바뀌어 ∓90° 에서 0° 로 온다 — xterm 캔버스를 3D 로 두 번 그리지 않는다.
 * 각도는 곡선을 지난 진행도에 대해 선형이다 — 키프레임 offset 이 그 진행도라 면 바꾸기 계단(`swapAt`)이 정확히 ±90° 프레임에 선다.
 */

export type Face = "term" | "convo";

export const FLIP_CARD = {
  ms: 450,
  easing: "cubic-bezier(0.45, 0, 0.55, 1)",
  /** 도는 도중에 다시 누르면 돌 각도에 비례해 이 길이 안으로(`rapidMinMs` 이상) */
  rapidMs: 260,
  rapidMinMs: 120,
  rapidEasing: "cubic-bezier(0.2, 0, 0, 1)",
  /** 원근 거리 = 타일 폭 × 이 값 */
  perspective: 3,
} as const;

/** 터미널 음수 · 대화 양수 — 이 불변식 덕에 도중에 다시 눌러도 "지금 면 · 지금 각도" 하나로 다음 길이 정해진다 */
const SIDE: Record<Face, -1 | 1> = { term: -1, convo: 1 };

export interface CardState {
  face: Face;
  angle: number;
}

/** `offset` 은 곡선을 지난 진행도(0..1) */
export interface CardStop {
  offset: number;
  angle: number;
}

export interface CardPlan {
  from: Face;
  to: Face;
  /** 면이 바뀌면 같은 offset 에 둘(가장자리 · 반대 가장자리) */
  stops: CardStop[];
  swapAt: number | null;
  travel: number;
}

export function restingCard(face: Face): CardState {
  return { face, angle: 0 };
}

export function planFlip(state: CardState, to: Face): CardPlan | null {
  const angle = clampAngle(state.angle);
  if (state.face === to) {
    if (angle === 0) return null;
    return { from: to, to, stops: [{ offset: 0, angle }, { offset: 1, angle: 0 }], swapAt: null, travel: Math.abs(angle) };
  }
  const edge = SIDE[state.face] * 90;
  const first = Math.abs(edge - angle);
  const travel = first + 90;
  const swapAt = first / travel;
  return {
    from: state.face,
    to,
    stops: [
      { offset: 0, angle },
      { offset: swapAt, angle: edge },
      { offset: swapAt, angle: -edge },
      { offset: 1, angle: 0 },
    ],
    swapAt,
    travel,
  };
}

/** 같은 offset 둘이면 뒤엣것(바뀐 면) */
export function cardAt(plan: CardPlan, p: number): CardState {
  const q = Math.min(1, Math.max(0, p));
  const face = plan.swapAt !== null && q >= plan.swapAt ? plan.to : plan.from;
  const s = plan.stops;
  for (let i = s.length - 1; i > 0; i--) {
    const a = s[i - 1];
    const b = s[i];
    if (b.offset === a.offset) continue;
    if (q >= a.offset) {
      const t = Math.min(1, (q - a.offset) / (b.offset - a.offset));
      return { face, angle: clampAngle(a.angle + (b.angle - a.angle) * t) };
    }
  }
  return { face, angle: clampAngle(s[0].angle) };
}

export function flipDuration(plan: CardPlan, inFlight: boolean): number {
  if (!inFlight) return FLIP_CARD.ms;
  return Math.round(Math.max(FLIP_CARD.rapidMinMs, (FLIP_CARD.rapidMs * plan.travel) / 180));
}

/** 원근으로 가까워진 가장자리가 타일 상자 위아래로 튀어나오지 않게 — 90° 에서 `1 - 0.5 / k` 면 높이가 정확히 상자 안이다 */
export function cardScale(angle: number, k: number = FLIP_CARD.perspective): number {
  const dip = 0.5 / k;
  return 1 - (dip * Math.min(90, Math.abs(angle))) / 90;
}

function clampAngle(a: number): number {
  const v = Math.max(-90, Math.min(90, a));
  return Object.is(v, -0) ? 0 : v;
}
