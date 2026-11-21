/**
 * 사람이 [지우기] 한 실행 id — 지우기는 화면에서만 치운다(서버 상태 · 감사 기록은 그대로). 폴링(`OpsController.refresh`)이
 * 끝난 실행을 되살리는 복구 길이라, 표시만 걷으면 다음 바퀴에 같은 카드가 돌아온다 — 그래서 여기 남겨 건너뛴다.
 */

const KEY = "aynx:dismissed-runs";
export const DISMISSED_RUNS_MAX = 500;

let ids: string[] | null = null;

function load(): string[] {
  if (ids !== null) return ids;
  ids = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(raw)) ids = raw.filter((v): v is string => typeof v === "string").slice(-DISMISSED_RUNS_MAX);
  } catch {
    // 빈 목록으로 시작한다
  }
  return ids;
}

export function isRunDismissed(operationId: string): boolean {
  return load().includes(operationId);
}

export function dismissRuns(operationIds: readonly string[]): void {
  const list = load();
  for (const id of operationIds) if (!list.includes(id)) list.push(id);
  if (list.length > DISMISSED_RUNS_MAX) list.splice(0, list.length - DISMISSED_RUNS_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 이 창의 모듈 상태로만 기억한다
  }
}

export function resetDismissedRunsForTest(): void {
  ids = null;
}
