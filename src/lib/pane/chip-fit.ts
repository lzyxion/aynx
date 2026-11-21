/**
 * 타일 머리줄 칩 접기 판정(순수 · docs/log/2026-10-23-header-chip-fit.md) — 실제로 넘칠 때만, 사용자 순서를 중요도로:
 * 끝에서부터 짧은 꼴로 → 그래도 넘치면 끝에서부터 숨기고 "+N"(`pinned` 는 숨기지 않는다). 펴는 쪽은 `hysteresis` 만큼 남을 때만.
 */

export type ChipFitMode = "full" | "compact" | "icon" | "hidden";

const LEVEL_MODE: readonly ChipFitMode[] = ["full", "compact", "icon"];

export interface FitChip {
  id: string;
  /** 꼴마다의 폭(px, 간격 제외) — `[제 폭, 짧은 꼴, 더 짧은 꼴?]` */
  widths: readonly number[];
  pinned?: boolean;
}

export interface FitState {
  step: number;
  signature: string;
}

export interface FitInput {
  /** 사용자 순서대로(앞이 중요하다) */
  chips: readonly FitChip[];
  available: number;
  /** 칩마다 앞에 하나씩 붙는다 */
  gap: number;
  overflowWidth: number;
  prev?: FitState | null;
  hysteresis?: number;
}

export interface FitResult extends FitState {
  ids: string[];
  modes: ChipFitMode[];
  hidden: string[];
  needed: number;
  /** 다 접어도 넘친다 — 넘치는 몫은 묶음이 자른다 */
  overflows: boolean;
}

/** 자원 칩 숫자가 2초마다 몇 px 흔들려도 문턱에서 깜빡이지 않을 만큼 */
export const FIT_HYSTERESIS = 16;

/** 칩이 이름을 0 까지 밀어내지 않게 이름이 지키는 최소 폭 */
export const TITLE_MIN_PX = 72;

/** 폭은 넣지 않는다 — 숫자가 바뀌어도 이력이 이어져야 한다. 구성이 바뀌면 단계 번호의 뜻이 달라져 이력을 버린다 */
export function fitSignature(chips: readonly FitChip[]): string {
  return chips.map((c) => `${c.id}:${c.widths.length}${c.pinned ? "!" : ""}`).join(",");
}

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

/** 칩마다의 꼴 자리(`-1` = 숨김) */
type Levels = number[];

function stepsOf(chips: readonly FitChip[]): Levels[] {
  const cur: Levels = chips.map(() => 0);
  const steps: Levels[] = [cur.slice()];
  for (let i = chips.length - 1; i >= 0; i--) {
    const w = chips[i].widths;
    for (let l = 1; l < w.length; l++) {
      // 짧아지지 않는 꼴은 단계가 아니다 — 이력의 한 칸을 헛되이 쓰지 않게
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
  // 마지막 단계가 늘 가장 좁지는 않다 — 숨김이 "+N" 을 세우며 넓어질 수 있다
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

/** "+N" 은 첫 숨은 칩의 자리에 선다 — 고정 칩(AI 권한)은 제 자리(끝)를 지킨다 */
export function overflowAnchor(r: Pick<FitResult, "ids" | "modes">): string | null {
  const i = r.modes.indexOf("hidden");
  return i < 0 ? null : r.ids[i];
}
