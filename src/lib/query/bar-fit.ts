/**
 * **쿼리 타일 실행 줄의 접기**(10-14 개편 — 편집기와 결과 사이의 줄, Beekeeper Studio 식). 폭에 다 안 들어가면 덜 중요한 것부터 뺀다
 * (예전 위 띠의 접기 — 10-13 실기: 작업 중이면 [실행] 이 타일 밖으로 밀렸다 — 를 이 줄 기준으로 다시 맞췄다).
 *
 * 줄의 차례(왼쪽부터): `[읽기 전용 / 쓰기 켬]`(알약 — 늘 있다) · `[자동 | 수동 커밋]`(두 칸 전환 단추) · `[시작] [커밋] [되돌리기]` · 상태(`● 트랜잭션 · N문장 · 00:42` — 경고 땐
 * `⏱ 00:59 뒤 되돌림 · N문장` + [연장]) · … · AI 에 묻기(그림) · 경과 · `[스크립트 실행]` · `[실행]`.
 *
 * **[실행] 은 글자째 늘 남는다**(목업 `Narrow`). 커밋 방식은 "자동 | 수동 커밋" → "자동 | 수동", 작업 단추 · [스크립트 실행] · [연장] 은
 * 글자가 빠지고 그림 + 툴팁이 남는다. 쓰기 알약은 자물쇠 그림만 남는다(10-14 — 탭 줄에서 이 줄 맨 왼쪽으로 옮겼다). 작업 단추 중 **지금 누를 수 없는 것**(작업 없음의 [커밋] · [되돌리기], 작업 중의 [시작])은 좁으면
 * 아예 숨는다(목업 `Narrow` — 수동 · 작업 중엔 ✓ ↶ 둘만). 빠지는 순서(앞이 먼저):
 *
 * | 상태 | 순서 |
 * |---|---|
 * | 작업 중 | 상태의 경과 → 커밋 방식 긴 글자 → 못 누르는 작업 단추 → 상태의 "트랜잭션" → 알약 글자 → 단추 글자 → 스크립트 글자 → 상태의 문장 수 |
 * | 작업 중 · 1분 전 경고 | 커밋 방식 긴 글자 → 못 누르는 작업 단추 → 상태의 "트랜잭션" → 알약 글자 → 단추 글자 → 스크립트 글자 → 문장 수 → 남은 시간 |
 * | 작업 없음 | 커밋 방식 긴 글자 → 못 누르는 작업 단추 → 알약 글자 → 단추 글자 → 스크립트 글자 |
 * | 읽기 전용 | 알약 글자 → 스크립트 글자 |
 *
 * 경고 땐 상태의 시간 칸이 경과가 아니라 **남은 시간**("00:59 뒤 되돌림")이고 가장 늦게 빠진다(경과는 툴팁에 남는다). 상태의 글자가 다
 * 빠지면 점만 남는다(툴팁에 전부). 연결 상태 점은 이 줄에 없다(탭 줄 오른쪽 끝 — 좁으면 글자만 빠진다, CSS 컨테이너 질의).
 *
 * 폭은 **넉넉한 어림**이다(글자 수 × 글자 폭 — 잰 값이 아니다). 어림이 모자라도 상태 칸만 줄어든다(`min-width: 0` · 말줄임). 순수하다 —
 * 글자는 부르는 쪽(`QueryView`)이 지어 넣는다.
 */

/** 실행 줄이 그리는 것들의 글자(부르는 쪽이 지금 언어로 지어 넣는다) */
export interface RunLineIn {
  /** 줄 폭(px) — 0 이하면 아직 못 쟀다(다 보인다) */
  width: number;
  /** 쓰기 알약의 글자("읽기 전용" · "쓰기 켬" — 늘 그린다) */
  pill: string;
  /** 커밋 방식 두 칸 — 긴 글자 둘 · 짧은 글자 둘(판 13 서버 · 쓰기 모드에서만, 없으면 `null`) */
  mode: { long: [string, string]; short: [string, string] } | null;
  /** 작업 단추 — [시작] · [커밋] · [되돌리기] 글자와 지금 작업 중인가(쓰기 모드 · 판 9 서버에서만, 없으면 `null`) */
  tx: { begin: string; commit: string; rollback: string; working: boolean } | null;
  /** 작업 상태(없으면 `null`) — `time` 은 평소 경과, 경고 땐 남은 시간 문구 */
  chip: ChipParts | null;
  /** [연장] 글자(경고 때만, 없으면 `null`) */
  extend: string | null;
  /** "AI 에 묻기" 그림 단추 */
  ask: boolean;
  /** 도는 동안의 경과("1.2s" — 없으면 `null`) */
  elapsed: string | null;
  /** [스크립트 실행] 글자(판 9 서버면 없다 — `null`) */
  script: string | null;
  /** [실행] · [취소] 글자 */
  run: string;
}

export interface ChipParts {
  name: string;
  stmts: string;
  time: string;
  warn: boolean;
}

/** 무엇을 그리나 — `false` 면 그 글자 · 칸을 뺀다 */
export interface RunLineFit {
  /** 쓰기 알약의 글자 — 거짓이면 자물쇠 그림만 */
  pillLabel: boolean;
  /** 커밋 방식의 긴 글자("수동 커밋") — 거짓이면 짧은 글자("수동") */
  modeLong: boolean;
  /** 지금 누를 수 없는 작업 단추 */
  idleTx: boolean;
  /** 작업 단추 · [연장] 글자 */
  txLabels: boolean;
  /** [스크립트 실행] 글자 */
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

/** 빼는 순서(머리말 표) */
export function dropOrder(chip: ChipParts | null): Step[] {
  if (!chip) return ["modeLong", "idleTx", "pillLabel", "txLabels", "scriptLabel"];
  if (chip.warn) return ["modeLong", "idleTx", "chipName", "pillLabel", "txLabels", "scriptLabel", "chipStmts", "chipTime"];
  return ["chipTime", "modeLong", "idleTx", "chipName", "pillLabel", "txLabels", "scriptLabel", "chipStmts"];
}

/** 11px UI 글꼴의 글자 폭 어림(px) — 한글 · 한자 · 가나 · 전각은 11, 빈칸 3, 나머지 6.5(Pretendard 실측보다 조금 넉넉하게) */
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

/** 상태 글자 — 보이는 칸만 " · " 로 잇는다(다 빠지면 빈 글자 — 점만) */
export function chipText(c: ChipParts, f: Pick<RunLineFit, "chipName" | "chipStmts" | "chipTime">): string {
  const parts: string[] = [];
  if (c.warn) {
    // 경고 땐 남은 시간이 앞(목업 `Warn` — "⏱ 00:59 뒤 되돌림 · 3문장")
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

/** 지금 그 작업 단추를 누를 수 있는가 — 작업 없음 = [시작], 작업 중 = [커밋] · [되돌리기] */
export function txLive(working: boolean, which: "begin" | "commit" | "rollback"): boolean {
  return which === "begin" ? !working : working;
}

// 줄의 치수(QueryView 의 CSS 와 맞춘다 — 고치면 같이 고친다)
const PAD = 20; // .runline 좌우 padding 10
const GAP = 6; // .runline gap
const SLACK = 8; // 어림의 여유
const SEG = 2 + 4 + 2 * 16; // .seg — 테두리 · 안쪽 2 · 칸마다 padding 8
const BTN = 2 + 16; // .tb — 테두리 · padding 8
const ICON = 12; // .tb 의 그림
const ICON_BTN = 2 + 10 + 13; // .tb.icon(AI 에 묻기) — 테두리 · padding 5 · 그림 13
const DOT = 7 + 5; // 상태 점 · 사이
const PILL = 2 + 16 + 11; // .ro — 테두리 · padding 8 · 자물쇠 11
const PILL_GAP = 4; // .ro 의 그림 · 글자 사이

/** 그 모양의 줄 폭 어림(px) */
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

/** 이 폭에 무엇을 그리나 — 다 들어가면 다, 아니면 머리말 표의 순서로 하나씩 뺀다 */
export function fitRunLine(b: RunLineIn): RunLineFit {
  const f: RunLineFit = { ...FULL };
  if (b.width <= 0) return f;
  for (const step of dropOrder(b.chip)) {
    if (runLineWidth(b, f) + SLACK <= b.width) break;
    f[step] = false;
  }
  return f;
}
