// 상태만 쥔다 — 무거운 앱 모듈을 부르면 이것을 부르는 아이콘 부품에서 순환이 생긴다.
import { albumPulse, dockPulse, type DockPulse, type Pulse, type RunSummary } from "$lib/orchestration/model";

let list = $state<readonly RunSummary[]>([]);

export function setRunSummaries(next: readonly RunSummary[]): void {
  list = next;
}

/** 주소가 없거나 목록에 없으면 `logo` */
export function pulseOfRun(runId: string | null | undefined): Pulse {
  if (!runId) return "logo";
  return albumPulse(list.find((r) => r.runId === runId) ?? null);
}

export function runSummaryOf(runId: string | null | undefined): RunSummary | null {
  return runId ? (list.find((r) => r.runId === runId) ?? null) : null;
}

/** 런처 독 칸 — 산 앨범 수 · 배지 색(로고는 늘 헤드폰) */
export function dockRunPulse(): DockPulse {
  return dockPulse(list);
}
