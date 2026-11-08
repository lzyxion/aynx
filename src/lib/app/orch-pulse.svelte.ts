/**
 * **앨범 목록 요약의 창 사본 — 막대 상태의 재료**(2026-10-30 오케스트레이션 탭 ⑤ · 노트 5-2 · D9).
 *
 * 탭 글리프(`Tabs`) · 플레이어 잎 아이콘(`PaneIcon`)이 `EqBars` 의 상태를, 런처 독 칸(`DockLaunch`)이 배지를 고를 때 읽는 한 칸이다. 채우는 쪽은
 * `orch-coordinators` 하나(이미 `orchestration_snapshot` 을 변화 이벤트 · 재연결 · `events-lagged` 마다 0.5초 모아 다시 읽는다 — 새 읽기 ·
 * 새 타이머 없음). 이 모듈은 상태만 쥐어 무거운 앱 모듈을 부르지 않는다(아이콘 부품이 불러도 고리가 생기지 않게).
 */

import { albumPulse, dockPulse, type DockPulse, type Pulse, type RunSummary } from "$lib/orchestration/model";

let list = $state<readonly RunSummary[]>([]);

/** `orch-coordinators` 가 목록을 읽을 때마다 */
export function setRunSummaries(next: readonly RunSummary[]): void {
  list = next;
}

/** 그 앨범의 막대 — 주소가 없거나(홈 · 준비 중) 목록에 없으면 `logo` */
export function pulseOfRun(runId: string | null | undefined): Pulse {
  if (!runId) return "logo";
  return albumPulse(list.find((r) => r.runId === runId) ?? null);
}

/** 그 앨범의 목록 요약(없으면 `null`) — 탭 닫기 확인이 "도는 앨범인가" · 이름을 본다 */
export function runSummaryOf(runId: string | null | undefined): RunSummary | null {
  return runId ? (list.find((r) => r.runId === runId) ?? null) : null;
}

/** 런처 독 칸 — 산 앨범 수 · 배지 색(로고는 늘 헤드폰) */
export function dockRunPulse(): DockPulse {
  return dockPulse(list);
}
