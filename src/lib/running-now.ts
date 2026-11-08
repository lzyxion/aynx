/**
 * **지금 돌아가고 있는 것** — 상태바 대시보드 칸의 숫자 배지와 호버 요약 카드의 순수 조립
 * (docs/log/2026-10-05-dashboard-badge.md).
 *
 * 세는 것은 셋이다:
 * - **실행 중인 AI 에이전트** — 타일 상태 점이 `running` 인 것. 권한 대기 · 완료(안 봄)는 🔔 알림이 세므로
 *   여기 넣지 않는다 — 두 숫자가 같은 일을 두 번 세지 않게.
 * - **열린 헤드리스 위임 접속** — 타일 없는 원격 세션(`delegated:` 접두사)이 붙어 있고 떨어지지 않은 것.
 * - **실행 중인 작업안** — 승인 뒤 도는 것(`approved` · `running`). 승인 대기는 상태바 알림 배지가 센다.
 *
 * 재료(이름 목록)를 모으던 `app/running-now.svelte.ts` 와 그리던 상태바 작업안 칸의 호버 카드(`RunningHoverCard`)는 2026-10-18
 * 통합 독 때 칸과 함께 걷혔다 — 남은 술어(`isOpenHeadless` · `isRunningPlan`)는 `app/pending-plans` 가 쓴다. 이 모듈은 룬도 `invoke` 도 없다 —
 * vitest 가 그대로 읽는다(`.svelte` 는 못 읽는다).
 */

/** 세 줄의 종류 — 카드의 순서이기도 하다 */
export type RunningKind = "agents" | "headless" | "plans";

/** 카드의 순서 */
export const RUNNING_KINDS: readonly RunningKind[] = ["agents", "headless", "plans"];

/** 줄마다 이름을 몇 개까지 보이나 — 넘치면 "외 N" */
export const RUNNING_SHOW = 4;

/** 모은 재료 — 종류마다 표시 이름 목록(순서 그대로 보인다) */
export type RunningInput = Readonly<Record<RunningKind, readonly string[]>>;

/** 카드의 한 줄 */
export interface RunningSection {
  kind: RunningKind;
  count: number;
  /** 보일 이름들(최대 `limit` 개) */
  shown: string[];
  /** 접힌 수 — "외 N" (0 이면 없다) */
  more: number;
}

/** 배지 · 카드가 읽는 요약 */
export interface RunningSummary {
  /** 배지의 수 — 0 이면 배지가 없다 */
  total: number;
  /** 늘 세 줄(`RUNNING_KINDS` 순서) — 0 인 줄도 개수 0 으로 선다 */
  sections: RunningSection[];
}

/** 빈 요약 — 재료가 아직 없을 때 */
export const EMPTY_RUNNING: RunningSummary = summarizeRunning({ agents: [], headless: [], plans: [] });

/** 재료 → 요약. 빈 이름은 `?` 로 세운다(세는 수와 보이는 줄 수가 갈리지 않게). */
export function summarizeRunning(input: RunningInput, limit: number = RUNNING_SHOW): RunningSummary {
  const cap = Math.max(0, Math.floor(limit));
  const sections = RUNNING_KINDS.map((kind): RunningSection => {
    const names = input[kind].map((n) => n.trim() || "?");
    const shown = names.slice(0, cap);
    return { kind, count: names.length, shown, more: names.length - shown.length };
  });
  return { total: sections.reduce((sum, s) => sum + s.count, 0), sections };
}

/** 헤드리스 세션의 streamId 접두사 (Rust `delegated_stream_id` · `console/host-groups` 와 같은 글자) */
const DELEGATED_PREFIX = "delegated:";

/**
 * 전역 세션 항목이 **열린 헤드리스 위임 접속**인가 — 위임 대상 id 이고, 붙어 있고, 떨어지지 않았다.
 * 붙은 적 없는 발견 항목(미접속 · 고아)과 끊긴 것은 돌고 있는 것이 아니다.
 */
export function isOpenHeadless(s: { id: string; connected: boolean; dropped?: boolean }): boolean {
  return s.id.startsWith(DELEGATED_PREFIX) && s.connected && s.dropped !== true;
}

/**
 * 작업안이 **지금 도는 것**인가 — `approved` 를 `running` 과 함께 센다: 승인이 떨어진 순간부터 사람
 * 눈에는 이미 "나갔다" 이고, 브로커가 첫 대상을 띄우기까지의 틈에 수가 비면 눌러 놓고 아무 일도 안
 * 일어난 것처럼 읽힌다(2026-09-21 `▶` 신호의 판단 그대로).
 */
export function isRunningPlan(op: { state: string }): boolean {
  return op.state === "approved" || op.state === "running";
}

/** 작업안의 표시 이름 — 제목, 없으면 명령 첫 줄 */
export function planName(op: { title: string | null; command: string }): string {
  const title = op.title?.trim();
  if (title) return title;
  return op.command.split("\n")[0]?.trim() ?? "";
}
