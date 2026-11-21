/**
 * 쿼리 타일 실행 줄의 접기 — 폭에 다 안 들어가면 덜 중요한 글자 · 칸부터 뺀다. [실행] 은 글자째 늘 남는다.
 * 폭은 넉넉한 어림(글자 수 × 글자 폭)이다 — 모자라도 상태 칸만 줄어든다(`min-width: 0` · 말줄임).
 */

export interface RunLineIn {
  /** px — 0 이하면 아직 못 쟀다(다 보인다) */
  width: number;
  pill: string;
  mode: { long: [string, string]; short: [string, string] } | null;
  tx: { begin: string; commit: string; rollback: string; working: boolean } | null;
  /** `time` 은 평소 경과, 경고 땐 남은 시간 문구 */
  chip: ChipParts | null;
  extend: string | null;
  ask: boolean;
  elapsed: string | null;
  script: string | null;
  run: string;
}

export interface ChipParts {
  name: string;
  stmts: string;
  time: string;
  warn: boolean;
}

/** `false` 면 그 글자 · 칸을 뺀다 */
export interface RunLineFit {
  pillLabel: boolean;
  modeLong: boolean;
  /** 지금 누를 수 없는 작업 단추 */
  idleTx: boolean;
  /** 작업 단추 · [연장] 글자 */
  txLabels: boolean;
  scriptLabel: boolean;
  chipName: boolean;
  chipStmts: boolean;
  chipTime: boolean;
}

type Step = keyof RunLineFit;

const FULL: RunLineFit = {
  pillLabel: true,
  modeLong: true,
  idleTx: true,
  txLabels: true,
  scriptLabel: true,
  chipName: true,
  chipStmts: true,
  chipTime: true,
};

/** 빼는 순서 — 앞이 먼저 */
export function dropOrder(chip: ChipParts | null): Step[] {
  if (!chip) return ["modeLong", "idleTx", "pillLabel", "txLabels", "scriptLabel"];
  if (chip.warn) return ["modeLong", "idleTx", "chipName", "pillLabel", "txLabels", "scriptLabel", "chipStmts", "chipTime"];
  return ["chipTime", "modeLong", "idleTx", "chipName", "pillLabel", "txLabels", "scriptLabel", "chipStmts"];
}

/** 11px UI 글꼴의 글자 폭 어림(px) — Pretendard 실측보다 조금 넉넉하게 */
export function textPx(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x11ff) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xffef);
    w += wide ? 11 : ch === " " ? 3 : 6.5;
  }
  return Math.ceil(w);
}

export function chipText(c: ChipParts, f: Pick<RunLineFit, "chipName" | "chipStmts" | "chipTime">): string {
  const parts: string[] = [];
  if (c.warn) {
    if (f.chipTime) parts.push(c.time);
    if (f.chipName) parts.push(c.name);
    if (f.chipStmts) parts.push(c.stmts);
  } else {
    if (f.chipName) parts.push(c.name);
    if (f.chipStmts) parts.push(c.stmts);
    if (f.chipTime) parts.push(c.time);
  }
  return parts.join(" · ");
}

export function txLive(working: boolean, which: "begin" | "commit" | "rollback"): boolean {
  return which === "begin" ? !working : working;
}

// 줄의 치수 — `RunBar.svelte` 의 CSS 와 맞춘다(고치면 같이 고친다)
const PAD = 20; // .runline 좌우 padding 10
const GAP = 6; // .runline gap
const SLACK = 8;
const SEG = 2 + 4 + 2 * 16; // .seg — 테두리 · 안쪽 2 · 칸마다 padding 8
const BTN = 2 + 16; // .tb — 테두리 · padding 8
const ICON = 12; // .tb 의 그림
const ICON_BTN = 2 + 10 + 13; // .tb.icon(AI 에 묻기) — 테두리 · padding 5 · 그림 13
const DOT = 7 + 5; // 상태 점 · 사이
const PILL = 2 + 16 + 11; // .ro — 테두리 · padding 8 · 자물쇠 11
const PILL_GAP = 4; // .ro 의 그림 · 글자 사이

export function runLineWidth(b: RunLineIn, f: RunLineFit): number {
  const items: number[] = [PILL + (f.pillLabel ? PILL_GAP + textPx(b.pill) : 0)];
  if (b.mode) {
    const [x, y] = f.modeLong ? b.mode.long : b.mode.short;
    items.push(SEG + textPx(x) + textPx(y));
  }
  if (b.tx) {
    for (const which of ["begin", "commit", "rollback"] as const) {
      if (!f.idleTx && !txLive(b.tx.working, which)) continue;
      items.push(BTN + (f.txLabels ? textPx(b.tx[which]) : ICON));
    }
  }
  if (b.chip) {
    const text = chipText(b.chip, f);
    items.push(DOT + (text ? textPx(text) : 0));
  }
  if (b.extend) items.push(BTN + (f.txLabels ? textPx(b.extend) : ICON));
  items.push(0); // .sp
  if (b.ask) items.push(ICON_BTN);
  if (b.elapsed) items.push(b.elapsed.length * 7);
  if (b.script) items.push(BTN + (f.scriptLabel ? textPx(b.script) : ICON));
  items.push(BTN + ICON + 4 + textPx(b.run));
  return PAD + items.reduce((s, w) => s + w, 0) + GAP * (items.length - 1);
}

export function fitRunLine(b: RunLineIn): RunLineFit {
  const f: RunLineFit = { ...FULL };
  if (b.width <= 0) return f;
  for (const step of dropOrder(b.chip)) {
    if (runLineWidth(b, f) + SLACK <= b.width) break;
    f[step] = false;
  }
  return f;
}
