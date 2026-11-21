/** 실행 기록의 딥링크 · 거르기 — 창마다 하나뿐인 모듈 상태(저장하지 않는다) */

import { forwardPlans, openPlans, plansOpenableHere, setPlansView } from "$lib/app/plans.svelte.js";
import { DEFAULT_FILTER, type Period, type RunFilter } from "$lib/run-history";

let historyRequest = $state<string | null>(null);
let filter = $state<RunFilter>({ ...DEFAULT_FILTER });
let period = $state<Period>(7);

export function openRunInHistory(operationId: string): void {
  if (!plansOpenableHere()) {
    forwardPlans({ history: operationId });
    return;
  }
  setPlansView("history");
  historyRequest = operationId;
  openPlans();
}

/** 한 번만 꺼내 간다(take-once) */
export function takeHistoryRequest(): string | null {
  const r = historyRequest;
  historyRequest = null;
  return r;
}

/** 꺼내지 않고 읽기만 — 효과가 의존성을 걸 때 쓴다 */
export function historyRequestPending(): string | null {
  return historyRequest;
}

export function historyFilter(): RunFilter {
  return filter;
}

export function setHistoryFilter(next: Partial<RunFilter>): void {
  filter = { ...filter, ...next };
}

export function historyPeriod(): Period {
  return period;
}

export function setHistoryPeriod(next: Period): void {
  period = next;
}

// ── 기록 지우기 — 화면에서만 ──
// 감사 파일(audit-*.jsonl)은 건드리지 않는다 — "모든 실행은 기록된다" 를 지킨다.

const CLEARED_KEY = "aynx:run-history-cleared-at";

function readClearedAt(): number {
  try {
    const v = Number(localStorage.getItem(CLEARED_KEY) ?? "0");
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

let clearedAt = $state(readClearedAt());

/** 기록 보기가 이 시각(ms) 이전에 승인된 실행을 그리지 않는다 — 0 = 지운 적 없음 */
export function historyClearedAt(): number {
  return clearedAt;
}

export function clearHistoryView(at: number = Date.now()): void {
  clearedAt = at;
  lastClearAt = at === 0 ? 0 : Date.now();
  try {
    localStorage.setItem(CLEARED_KEY, String(at));
  } catch {
    // 저장소가 막혔다 — 모듈 상태로만
  }
}

// ── 골라 지우기 — 화면에서만 ──

const HIDDEN_KEY = "aynx:run-history-hidden";
export const HIDDEN_MAX = 2000;

function readHidden(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(-HIDDEN_MAX) : [];
  } catch {
    return [];
  }
}

let hidden = $state<ReadonlySet<string>>(new Set(readHidden()));

/** 아무도 그리지 않아 `$state` 가 아니다 */
let lastClearAt = 0;

export function hiddenRuns(): ReadonlySet<string> {
  return hidden;
}

export function hideRuns(ids: readonly string[]): void {
  if (ids.length === 0) return;
  lastClearAt = Date.now();
  const list = [...hidden];
  for (const id of ids) if (!hidden.has(id)) list.push(id);
  const kept = list.slice(-HIDDEN_MAX);
  hidden = new Set(kept);
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(kept));
  } catch {
    // 저장소가 막혔다 — 모듈 상태로만
  }
}

export function historyJustCleared(windowMs: number): boolean {
  return Date.now() - Math.max(lastClearAt, clearedAt) < windowMs;
}
