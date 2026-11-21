/**
 * 지금 돌아가고 있는 것 — 실행 중인 AI 에이전트 · 열린 헤드리스 위임 접속 · 실행 중인 작업안 (docs/log/2026-10-05-dashboard-badge.md).
 * 권한 대기 · 완료(안 봄) · 승인 대기는 다른 배지가 세므로 여기 넣지 않는다 — 같은 일을 두 번 세지 않게.
 */

export type RunningKind = "agents" | "headless" | "plans";

export const RUNNING_KINDS: readonly RunningKind[] = ["agents", "headless", "plans"];

export const RUNNING_SHOW = 4;

export type RunningInput = Readonly<Record<RunningKind, readonly string[]>>;

export interface RunningSection {
  kind: RunningKind;
  count: number;
  shown: string[];
  /** "외 N" */
  more: number;
}

export interface RunningSummary {
  total: number;
  /** 0 인 줄도 개수 0 으로 선다 */
  sections: RunningSection[];
}

export const EMPTY_RUNNING: RunningSummary = summarizeRunning({ agents: [], headless: [], plans: [] });

/** 빈 이름은 `?` 로 세운다 — 세는 수와 보이는 줄 수가 갈리지 않게 */
export function summarizeRunning(input: RunningInput, limit: number = RUNNING_SHOW): RunningSummary {
  const cap = Math.max(0, Math.floor(limit));
  const sections = RUNNING_KINDS.map((kind): RunningSection => {
    const names = input[kind].map((n) => n.trim() || "?");
    const shown = names.slice(0, cap);
    return { kind, count: names.length, shown, more: names.length - shown.length };
  });
  return { total: sections.reduce((sum, s) => sum + s.count, 0), sections };
}

/** Rust `delegated_stream_id` · `console/host-groups` 와 같은 글자 */
const DELEGATED_PREFIX = "delegated:";

export function isOpenHeadless(s: { id: string; connected: boolean; dropped?: boolean }): boolean {
  return s.id.startsWith(DELEGATED_PREFIX) && s.connected && s.dropped !== true;
}

/** `approved` 도 센다 — 브로커가 첫 대상을 띄우기까지의 틈에 수가 비면 눌러 놓고 아무 일도 안 일어난 것처럼 읽힌다 */
export function isRunningPlan(op: { state: string }): boolean {
  return op.state === "approved" || op.state === "running";
}

export function planName(op: { title: string | null; command: string }): string {
  const title = op.title?.trim();
  if (title) return title;
  return op.command.split("\n")[0]?.trim() ?? "";
}
