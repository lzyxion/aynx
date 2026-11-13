/**
 * **실행 기록의 딥링크 · 거르기** — 창마다 하나뿐인 모듈 상태 (docs/log/2026-09-28-run-history.md).
 *
 * - [`openRunInHistory`] — 결과 알림의 [결과 보기](메모리에 그 실행이 없을 때) · 진행 보기의 딥링크가
 *   "기록에서 이 실행을 골라 달라" 를 남긴다. 기록 보기가 **한 번만** 꺼내 간다([`takeHistoryRequest`]
 *   — `plans.svelte.ts` 의 딥링크와 같은 take-once).
 *
 * 예전에는 행렬 보기와 기록 사이를 잇는 칸(기록 상세의 [행렬로 보기] · 행렬 열 머리 → 기록)도 여기 살았다 —
 * 행렬 보기를 걷으며(2026-10-25 · docs/log/2026-10-25-plans-tile-refresh.md) 함께 걷었다.
 *
 * 기록 보기의 거르기(기간 · 호스트 · 결과 · 승인 · 검색)도 여기 산다 — 다른 칸에 다녀와도 보던
 * 거르기가 남는다(작업안 보기 `plansView` 와 같은 수명 · 저장하지 않는다).
 */

import { forwardPlans, openPlans, plansOpenableHere, setPlansView } from "$lib/app/plans.svelte.js";
import { DEFAULT_FILTER, type Period, type RunFilter } from "$lib/run-history";

let historyRequest = $state<string | null>(null);
let filter = $state<RunFilter>({ ...DEFAULT_FILTER });
let period = $state<Period>(7);

/** 작업안 › **기록**을 열고 그 실행을 고르게 한다 (이미 열려 있으면 보기만 바꾼다 · 보조 창이면 주 창에 넘긴다) */
export function openRunInHistory(operationId: string): void {
  if (!plansOpenableHere()) {
    forwardPlans({ history: operationId });
    return;
  }
  setPlansView("history");
  historyRequest = operationId;
  openPlans();
}

/** 고를 실행을 **가져간다**(한 번만) — `console/RunHistory.svelte` 가 읽는다. 없으면 `null`. */
export function takeHistoryRequest(): string | null {
  const r = historyRequest;
  historyRequest = null;
  return r;
}

/** 지금 남아 있는 요청(읽기만 — 효과가 의존성을 걸 때 쓴다) */
export function historyRequestPending(): string | null {
  return historyRequest;
}

/** 기록 보기의 거르기 (기간 제외) */
export function historyFilter(): RunFilter {
  return filter;
}

export function setHistoryFilter(next: Partial<RunFilter>): void {
  filter = { ...filter, ...next };
}

/** 기록 보기의 기간 — 가져오는 범위 */
export function historyPeriod(): Period {
  return period;
}

export function setHistoryPeriod(next: Period): void {
  period = next;
}

// ---------------------------------------------------------------------------
// **기록 지우기 — 화면에서만** (2026-11-13 사용자 결정 · 작업안 머리줄의 🗑). 지운 시각 하나를 남기고 기록 보기가 그 시각 **이전에 승인된**
// 실행을 그리지 않는다. 감사 파일(audit-*.jsonl)은 그대로다 — 보관 일수(설정 › 자동화)까지 남고 "모든 실행은 기록된다" 는 유지된다.
// `localStorage` 라 같은 출처의 창들이 나눠 쓰고 다시 켜도 남는다(원격 브라우저는 제 출처 — 진행 보기의 `dismissed-runs` 와 같은 규칙).
// ---------------------------------------------------------------------------

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

/** 기록을 화면에서 지운다(지금까지) — 저장이 막히면 이 창의 상태로만 기억한다 */
export function clearHistoryView(at: number = Date.now()): void {
  clearedAt = at;
  lastClearAt = at === 0 ? 0 : Date.now();
  try {
    localStorage.setItem(CLEARED_KEY, String(at));
  } catch {
    // 저장소가 막혔다 — 모듈 상태로만
  }
}

// ---------------------------------------------------------------------------
// **골라 지우기 — 화면에서만** (2026-11-13 사용자 요청). 줄의 × · 거른 채 [보이는 기록 지우기] 가 실행 id 를 여기 남긴다. 위 "지운 시각"
// 과 같은 규칙(감사 파일은 그대로 · `localStorage` · 같은 출처의 창들이 나눠 쓴다). 오래된 것부터 버려 `HIDDEN_MAX` 를 넘지 않는다
// (그보다 오래된 실행은 기간 상한 90일 · 감사 보관 일수에 걸려 어차피 잘 안 보인다).
// ---------------------------------------------------------------------------

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

/** 마지막으로 지운(시각 · 골라) 때 — 그 직후에 빠지는 줄만 밀려 나간다(`row-exit.ts` 의 문). 아무도 그리지 않아 `$state` 가 아니다 */
let lastClearAt = 0;

/** 골라 지운 실행 id 들 */
export function hiddenRuns(): ReadonlySet<string> {
  return hidden;
}

/** 실행들을 화면에서 지운다(골라) */
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

/** 방금 지웠나(시각 지우기든 골라 지우기든) — 나가기 움직임의 문 */
export function historyJustCleared(windowMs: number): boolean {
  return Date.now() - Math.max(lastClearAt, clearedAt) < windowMs;
}
