/**
 * **AI 타일 [터미널 | 대화] 카드 뒤집기의 순수 계산** (2026-10-20 — 사용자 선택: 가로 밀기 A안 → 3D 카드 뒤집기).
 * 그리는 쪽은 `pane/flip-motion.ts`(Web Animations), 이 파일은 각도 · 면 · 시간만 셈한다(DOM 없음 — vitest).
 *
 * ## "반쪽 두 번" — 뒷면이 없다
 *
 * 타일 상자는 언제나 **한 면만** 그린다. 넘김은 지금 면이 가장자리(±90°)까지 돌아 사라지고, 그 순간 면 내용이 바뀌어 반대쪽
 * 가장자리(∓90°)에서 0° 로 돌아온다. 그래서 각도는 늘 [-90°, 90°] 안이고 뒤집힌(거울) 글자 · `backface-visibility` · 두 면 겹치기가
 * 없다 — xterm 캔버스를 3D 로 두 번 그릴 일도 없다.
 *
 * 면마다 사는 쪽이 정해져 있다: **터미널 면은 음수 쪽, 대화 면은 양수 쪽**(`SIDE`). 터미널 → 대화는 0 → -90°(CSS `rotateY` 음수 —
 * 오른쪽 가장자리가 앞으로 온다) · 면 바뀜 · +90° → 0, 대화 → 터미널은 그 거울이다. 이 불변식 덕에 도중에 다시 눌러도 "지금 면 ·
 * 지금 각도" 하나로 다음 길이 정해진다: 지금 면이 목표면 그 자리에서 0° 로 되돌아가고(면 바뀜 없음), 아니면 지금 면의 가장자리까지
 * 가서 바꾼다.
 *
 * 각도는 **곡선을 지난 진행도(eased progress)에 대해 선형**이다 — Web Animations 의 키프레임 offset 이 바로 그 진행도라서, 같은
 * 시간 · 같은 곡선으로 건 면 바꾸기 계단(offset = `swapAt`)이 정확히 ±90° 를 지나는 프레임에 선다.
 */

export type Face = "term" | "convo";

export const FLIP_CARD = {
  /** 한 번의 뒤집기(180°) */
  ms: 450,
  /** 부드러운 ease-in-out — 천천히 떠나 가운데(면이 바뀌는 순간)가 가장 빠르고 천천히 선다 */
  easing: "cubic-bezier(0.45, 0, 0.55, 1)",
  /** 도는 도중에 다시 누르면 지금 각도에서 이 길이 안으로(돌 각도에 비례 · 아래 `rapidMinMs` 이상) */
  rapidMs: 260,
  rapidMinMs: 120,
  /** 이미 움직이는 중이라 감속만 — 되돌림 곡선 */
  rapidEasing: "cubic-bezier(0.2, 0, 0, 1)",
  /** 원근 거리 = 타일 폭 × 이 값(과하지 않게 — 2~3배) */
  perspective: 3,
} as const;

/** 면이 사는 쪽 — 터미널 음수 · 대화 양수 */
const SIDE: Record<Face, -1 | 1> = { term: -1, convo: 1 };

/** 지금 보이는 면과 그 각도(도) — 각도의 부호는 `SIDE[face]` 쪽이거나 0 */
export interface CardState {
  face: Face;
  angle: number;
}

/** 각도 정지점 하나 — `offset` 은 곡선을 지난 진행도(0..1) */
export interface CardStop {
  offset: number;
  angle: number;
}

export interface CardPlan {
  /** 처음 보이는 면 */
  from: Face;
  /** 끝 면(= 상태가 이미 가리키는 면) */
  to: Face;
  /** 정지점 — 면이 바뀌면 같은 offset 에 둘(가장자리 · 반대 가장자리) */
  stops: CardStop[];
  /** 면이 바뀌는 진행도 — 같은 면으로 되돌아가면 `null` */
  swapAt: number | null;
  /** 돌 각도의 합(도) */
  travel: number;
}

/** 쉬는 상태 */
export function restingCard(face: Face): CardState {
  return { face, angle: 0 };
}

/** 지금 상태에서 `to` 면으로 — 이미 그 면 0° 면 `null`(움직일 것 없음) */
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

/** 진행도 `p`(곡선을 지난 값 0..1)에서의 면 · 각도 — 도중에 다시 누를 때 "지금" 을 읽는다. 같은 offset 둘이면 뒤엣것(바뀐 면) */
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

/** 이 길의 시간 — 쉬던 자리에서면 한 번의 길이, 도는 도중이면 돌 각도에 비례해 짧게 */
export function flipDuration(plan: CardPlan, inFlight: boolean): number {
  if (!inFlight) return FLIP_CARD.ms;
  return Math.round(Math.max(FLIP_CARD.rapidMinMs, (FLIP_CARD.rapidMs * plan.travel) / 180));
}

/**
 * 각도의 크기 축소 — 원근으로 가까워진 가장자리가 타일 상자 위아래로 튀어나오지 않게 카드가 살짝 물러난다. 가장자리(90°)에서
 * 가까운 변의 확대는 `k / (k - 0.5)`(k = 원근 ÷ 폭)이니 거기서 `1 - 0.5 / k` 로 줄이면 높이가 정확히 상자 안이다. 정지점 사이는
 * 선형 보간이라 중간 각도에서 몇 % 남짓 넘친다(45° 에서 약 4% — 위아래 2% 씩).
 */
export function cardScale(angle: number, k: number = FLIP_CARD.perspective): number {
  const dip = 0.5 / k;
  return 1 - (dip * Math.min(90, Math.abs(angle))) / 90;
}

function clampAngle(a: number): number {
  const v = Math.max(-90, Math.min(90, a));
  return Object.is(v, -0) ? 0 : v;
}
