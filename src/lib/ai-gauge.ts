/** AI 권한 게이지의 자리 규칙 — 자리 0 = 끔, 1~4 = 칸 넷. 찬 칸은 지금 단계의 색(`--ai-lv<자리>` — `theme.css`)을 입는다 */

export const GAUGE_SEGMENTS = 4;

/** 0 = 끔(중성) · 1~3 = 강조색 계열 · 4 = 모두 승인(주황) */
export type GaugeTone = 0 | 1 | 2 | 3 | 4;

export function gaugeIndex<S>(levels: readonly S[], value: S | null | undefined): number {
  return value === null || value === undefined ? -1 : levels.indexOf(value);
}

export function gaugeTone(at: number): GaugeTone {
  return (at <= 0 ? 0 : Math.min(at, GAUGE_SEGMENTS)) as GaugeTone;
}

export function segmentFilled(seg: number, at: number): boolean {
  return seg >= 1 && at >= seg;
}

export function segmentShape(seg: number): "start" | "mid" | "end" {
  return seg <= 1 ? "start" : seg >= GAUGE_SEGMENTS ? "end" : "mid";
}

/** 끝에서 돌지 않는다 — '끔' ↔ '모두 승인' 한 번에 뛰는 것은 확인 상자를 부르는 실수다 */
export function gaugeKeyStep(at: number, key: string, count: number): number | null {
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  if (at < 0) return 0;
  const next = at + (key === "ArrowRight" ? 1 : -1);
  return next < 0 || next >= count ? null : next;
}

/** `ui-icons.generated.ts` 의 `ai-gauge-0` ~ `ai-gauge-4`(`gen-ui-icons.mjs` 의 손 그림)와 같은 이름 */
export function gaugeIconName(at: number): string {
  return `ai-gauge-${gaugeTone(at)}`;
}
