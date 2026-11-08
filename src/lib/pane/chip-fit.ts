/**
 * **타일 머리줄 칩 접기 — 판정(순수)** (2026-10-23 사용자 결정 — docs/log/2026-10-23-header-chip-fit.md).
 *
 * 예전에는 머리줄 폭의 고정 문턱(400 · 360 · 320 · 240px container query)으로 접었다. 칩이 몇 개인지 · 사용자가 정한
 * 순서 · 이름 길이를 모두 몰랐다. 이제는 **실제로 넘칠 때만, 사용자 순서를 중요도로** 접는다:
 *
 * 1. 칩 줄이 제 몫(머리줄 폭 − 이름 최소 폭 − 다른 칸)에 들어가면 아무것도 접지 않는다.
 * 2. 넘치면 **끝에서부터 한 칩씩** 짧은 꼴로 바꾼다(1차). 칩마다 꼴은 `widths` 의 순서(제 폭 → 짧은 꼴 → 더 짧은 꼴) —
 *    자원 칩은 `CPU · 메모리` → `CPU` → 그림, 나머지는 제 폭 → 그림만(AI 권한은 게이지만 · 포워딩은 트래픽 점이 남는다).
 *    한 칩의 꼴을 다 쓴 뒤 앞 칩으로 간다.
 * 3. 그래도 넘치면 **끝에서부터 한 칩씩 숨기고** "+N" 칩 하나를 세운다(2차). `pinned`(AI 권한)는 숨기지 않는다 — 어느 자리에
 *    있든 짧은 꼴까지만 간다.
 * 4. **이력(hysteresis)** — 더 접는 쪽으로는 모자라는 즉시 가지만, 펴는 쪽(지난 단계보다 앞 단계)은 `hysteresis` px 만큼
 *    남을 때만 간다. 문턱에서 칩이 깜빡이지 않게.
 *
 * 단계(`step`)는 위 1~3 을 한 줄로 늘어놓은 차례의 번호다(0 = 다 폄). 지난 결과(`prev`)는 칩 구성(`signature`)이 같을 때만
 * 이력에 쓴다 — 칩이 생기거나 빠지면 단계 번호의 뜻이 달라진다.
 *
 * DOM 을 모른다. 폭을 재고 결과를 칩에 입히는 일은 `chip-fit-dom.ts`, 그리기는 `HeaderChips.svelte`.
 */

/** 칩 하나의 꼴 — 순서대로 짧아진다. `hidden` 은 2차(숨김) */
export type ChipFitMode = "full" | "compact" | "icon" | "hidden";

/** `widths` 의 자리 → 꼴 이름 */
const LEVEL_MODE: readonly ChipFitMode[] = ["full", "compact", "icon"];

export interface FitChip {
  id: string;
  /** 꼴마다 칩의 폭(px, 간격 제외) — `[제 폭, 짧은 꼴, 더 짧은 꼴?]`. 하나뿐이면 접을 꼴이 없다 */
  widths: readonly number[];
  /** 숨기지 않는다(AI 권한 칩) — 짧은 꼴까지만 */
  pinned?: boolean;
}

export interface FitState {
  /** 고른 단계(0 = 다 폄) */
  step: number;
  /** 칩 구성 — 같을 때만 다음 판정의 이력으로 쓴다 */
  signature: string;
}

export interface FitInput {
  /** 사용자 순서대로(앞이 중요하다) — 지금 서 있는 칩만 */
  chips: readonly FitChip[];
  /** 칩 줄이 쓸 수 있는 폭(px) — [`chipBudget`] */
  available: number;
  /** 칩 사이 간격(px) — 칩마다 앞에 하나씩 붙는다 */
  gap: number;
  /** "+N" 칩의 폭(px, 간격 제외) */
  overflowWidth: number;
  /** 지난 결과 — 이력 */
  prev?: FitState | null;
  /** 펴기에 필요한 여유(px). 기본 [`FIT_HYSTERESIS`] */
  hysteresis?: number;
}

export interface FitResult extends FitState {
  /** 칩 id — `chips` 와 같은 순서 */
  ids: string[];
  /** 칩마다의 꼴 — `chips` 와 같은 순서 */
  modes: ChipFitMode[];
  /** 숨은 칩 id — 사용자 순서대로("+N" 카드의 줄) */
  hidden: string[];
  /** 고른 단계의 폭(간격 포함) */
  needed: number;
  /** 다 접어도 넘친다(AI 권한 칩만 남아도) — 넘치는 몫은 묶음이 자른다 */
  overflows: boolean;
}

/** 펴기에 필요한 여유 — 자원 칩 숫자가 2초마다 몇 px 흔들려도 문턱에서 깜빡이지 않을 만큼 */
export const FIT_HYSTERESIS = 16;

/**
 * 이름이 지키는 최소 폭(px) — 칩이 이름을 0 까지 밀어내지 않는다. 이름이 이보다 짧으면 이름 제 폭만 지킨다.
 * 머리줄 이름 글꼴(13px)로 한글 다섯 자 · 라틴 아홉 자 남짓 — "어느 타일인지" 를 알아볼 만큼.
 */
export const TITLE_MIN_PX = 72;

/** 칩 구성의 열쇠 — 순서 · id · 꼴 수 · 고정 여부(폭은 넣지 않는다 — 숫자가 바뀌어도 이력이 이어져야 한다) */
export function fitSignature(chips: readonly FitChip[]): string {
  return chips.map((c) => `${c.id}:${c.widths.length}${c.pinned ? "!" : ""}`).join(",");
}

/**
 * **칩 줄의 몫** — 묶음 폭에서 이름의 최소 몫(`min(이름 제 폭, titleMin)` + 이름 뒤 여백)과 칩이 아닌 칸(저장 안 함 ● ·
 * Run 칩 — 칸마다 앞 간격 포함)을 뺀 것. 0 아래로는 내려가지 않는다.
 */
export function chipBudget(o: {
  boxWidth: number;
  nameNatural: number;
  nameMargin?: number;
  titleMin?: number;
  /** 칩이 아닌 칸들의 폭(간격 제외) */
  fixed?: readonly number[];
  gap: number;
}): number {
  const name = Math.min(Math.max(0, o.nameNatural), o.titleMin ?? TITLE_MIN_PX) + (o.nameMargin ?? 0);
  const fixed = (o.fixed ?? []).reduce((s, w) => s + w + o.gap, 0);
  return Math.max(0, o.boxWidth - name - fixed);
}

/** 단계 하나 = 칩마다의 꼴 자리(`-1` = 숨김) */
type Levels = number[];

/** 단계들 — 0(다 폄) → 1차(끝에서부터 짧은 꼴) → 2차(끝에서부터 숨김, `pinned` 건너뜀) */
function stepsOf(chips: readonly FitChip[]): Levels[] {
  const cur: Levels = chips.map(() => 0);
  const steps: Levels[] = [cur.slice()];
  for (let i = chips.length - 1; i >= 0; i--) {
    const w = chips[i].widths;
    for (let l = 1; l < w.length; l++) {
      // 짧아지지 않는 꼴(이름 없는 폴더 칩 등)은 단계가 아니다 — 이력의 한 칸을 헛되이 쓰지 않게
      if (!(w[l] < w[cur[i]])) continue;
      cur[i] = l;
      steps.push(cur.slice());
    }
  }
  for (let i = chips.length - 1; i >= 0; i--) {
    if (chips[i].pinned) continue;
    cur[i] = -1;
    steps.push(cur.slice());
  }
  return steps;
}

function neededOf(chips: readonly FitChip[], levels: Levels, gap: number, overflowWidth: number): number {
  let sum = 0;
  let hidden = 0;
  levels.forEach((l, i) => {
    if (l < 0) hidden++;
    else sum += chips[i].widths[l] + gap;
  });
  return hidden > 0 ? sum + overflowWidth + gap : sum;
}

/** **판정** — 파일 머리말의 규칙 1~4. 순수 */
export function fitChips(input: FitInput): FitResult {
  const { chips, available, gap, overflowWidth } = input;
  const hyst = input.hysteresis ?? FIT_HYSTERESIS;
  const signature = fitSignature(chips);
  const prevStep = input.prev && input.prev.signature === signature ? input.prev.step : null;
  const steps = stepsOf(chips);
  const needs = steps.map((lv) => neededOf(chips, lv, gap, overflowWidth));

  let step = -1;
  for (let s = 0; s < steps.length; s++) {
    const margin = prevStep !== null && s < prevStep ? hyst : 0;
    if (needs[s] + margin <= available) {
      step = s;
      break;
    }
  }
  const overflows = step < 0;
  // 다 접어도 넘치면 가장 좁은 단계(마지막이 늘 가장 좁지는 않다 — 숨김이 "+N" 을 세우며 넓어질 수 있다)
  if (overflows) step = needs.reduce((best, n, s) => (n < needs[best] ? s : best), steps.length - 1);

  const levels = steps[step];
  return {
    step,
    signature,
    ids: chips.map((c) => c.id),
    modes: levels.map((l) => (l < 0 ? "hidden" : LEVEL_MODE[l] ?? "icon")),
    hidden: chips.filter((_, i) => levels[i] < 0).map((c) => c.id),
    needed: needs[step],
    overflows,
  };
}

/**
 * "+N" 칩이 설 자리 — **첫 숨은 칩의 자리**(그 앞에 선다). 숨김은 끝에서부터라 그 뒤에 남는 것은 고정 칩(AI 권한)뿐이다:
 * 기본 순서면 `[폴더] [브랜치] [+3] [AI]` — AI 권한은 제 자리(끝)를 지키고, "+N" 은 숨은 칩들이 서 있던 바로 그 자리에 선다.
 * 숨은 칩이 없으면 `null`.
 */
export function overflowAnchor(r: Pick<FitResult, "ids" | "modes">): string | null {
  const i = r.modes.indexOf("hidden");
  return i < 0 ? null : r.ids[i];
}
