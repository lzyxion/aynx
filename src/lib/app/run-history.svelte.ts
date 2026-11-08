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
