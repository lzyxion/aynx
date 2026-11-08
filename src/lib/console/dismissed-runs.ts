/**
 * **사람이 [지우기] 한 실행** — 작업안 진행 보기에서 치운 실행 id 들(2026-10-27).
 *
 * 지우기는 화면에서만 치운다(서버 상태 · 감사 기록은 그대로). 그런데 폴링(`OpsController.refresh`)은 서버의 최근 목록에서
 * 끝난 실행을 실행 뷰로 **되살리는** 복구 길이라, 표시만 걷으면 다음 바퀴(2초)에 같은 카드가 돌아왔다. 그래서 치운 id 를
 * 여기 남기고 되살리기 · 진행 이벤트가 이 id 를 건너뛴다.
 *
 * 창마다의 모듈 상태 + `localStorage`(같은 출처의 창들이 나눠 쓰고 F5 · 다시 켜기에도 남는다 — 서버의 최근 목록은 세션 서버가
 * 사는 동안 남으므로). 저장소가 막히면 모듈 상태만으로 돈다. 오래된 것부터 버려 `MAX` 개를 넘지 않는다(최근 목록보다 넉넉히).
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
    // 저장소가 없거나 깨졌다 — 빈 목록으로 시작한다
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
    // 저장이 막혔다 — 이 창의 모듈 상태로만 기억한다
  }
}

/** 시험용 — 모듈 상태를 비워 저장소에서 다시 읽게 한다 */
export function resetDismissedRunsForTest(): void {
  ids = null;
}
