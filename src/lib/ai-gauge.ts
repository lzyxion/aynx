/**
 * **AI 권한 게이지의 순수 규칙**(2026-10-23 — docs/log/2026-10-23-approve-all.md "게이지") — 호스트 단계(끔 · 읽기 전용 · 승인 후 실행 ·
 * 자동 승인 실행 · 모두 승인)와 DB 단계(끔 · 구조만 · 읽기 전용 · 승인 후 실행 · 모두 승인)가 **같은 모양**이다: 자리 0 은 '끔'(왼쪽
 * 고리), 자리 1~4 는 오른쪽 칸 넷. 고른 자리까지 칸이 차고, 찬 칸은 **지금 단계의 색**(`--ai-lv<자리>` — `theme.css`)을 입는다.
 *
 * 그리는 쪽: `AiGauge.svelte`(고르개 — 호스트 폼 · DB 연결 폼 · 칩 팝오버) · `AiGaugeMini.svelte`(보기만 — 머리줄 칩 · 설정 › 보안 표 ·
 * 모두 승인 확인 상자). 단계 id · 이름 · 저장은 모른다 — 자리(수)만 다룬다. 저장 · 확인 상자 규칙은 부르는 쪽 그대로다.
 */

/** 오른쪽 칸 수(자리 1~4) — 단계는 늘 끔 + 넷 */
export const GAUGE_SEGMENTS = 4;

/** 색 자리 — 0 = 끔(중성) · 1~3 = 강조색 계열 · 4 = 모두 승인(주황) */
export type GaugeTone = 0 | 1 | 2 | 3 | 4;

/** 단계 목록에서 지금 단계의 자리 — 고른 것이 없거나(`null`) 목록에 없으면 `-1`. **순수** */
export function gaugeIndex<S>(levels: readonly S[], value: S | null | undefined): number {
  return value === null || value === undefined ? -1 : levels.indexOf(value);
}

/** 색 자리 — 고른 것이 없으면 0(중성) */
export function gaugeTone(at: number): GaugeTone {
  return (at <= 0 ? 0 : Math.min(at, GAUGE_SEGMENTS)) as GaugeTone;
}

/** 칸 `seg`(1~4)가 차 있는가 — 지금 자리가 그 칸 이상일 때 */
export function segmentFilled(seg: number, at: number): boolean {
  return seg >= 1 && at >= seg;
}

/** 칸의 모서리 모양 — 첫 칸은 왼쪽 끝 · 마지막 칸은 오른쪽 끝이 둥글다 */
export function segmentShape(seg: number): "start" | "mid" | "end" {
  return seg <= 1 ? "start" : seg >= GAUGE_SEGMENTS ? "end" : "mid";
}

/**
 * 화살표 ←→ 로 옮겨 갈 자리 — **끝에서 돌지 않는다**(예전 세그먼트는 돌았다: '모두 승인' 에서 → 한 번에 '끔', '끔' 에서 ← 한 번에 '모두
 * 승인' 으로 뛰었다 — 게이지에서 그 도약은 확인 상자를 부르는 실수다). 고른 것이 없으면(-1) 어느 쪽이든 첫 자리(끔).
 * 다른 키 · 옮길 데가 없으면 `null`. `lockedFrom`(10-23 — 로컬 타일은 Off · Read 만)부터의 자리는 잠겨 있어 그 앞에서 멈춘다. **순수**
 */
export function gaugeKeyStep(at: number, key: string, count: number, lockedFrom: number = count): number | null {
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  if (at < 0) return 0;
  const next = at + (key === "ArrowRight" ? 1 : -1);
  return next < 0 || next >= Math.min(count, lockedFrom) ? null : next;
}

/**
 * 게이지 글리프 이름(`ui-icons.generated.ts` 의 `ai-gauge-0` ~ `ai-gauge-4` — `gen-ui-icons.mjs` 의 손 그림) — 메뉴 줄처럼 그림 이름 하나만
 * 받는 자리가 미니 게이지(`AiGaugeMini` 의 `bars`)와 같은 꼴을 그린다. 고른 것이 없으면(-1) 끔(빈 막대 넷). **순수**
 */
export function gaugeIconName(at: number): string {
  return `ai-gauge-${gaugeTone(at)}`;
}
