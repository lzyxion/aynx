// 탭 배지 집계(순수).

import type { Tr } from "$lib/finish-notify";
import type { PaneStatus } from "./types";

/** 가장 급한 것 하나로 접는다: 실행 중 > 실패 > 성공 — 실행 중이 지난 실패보다 먼저 보여야 한다. 셋 다 없으면 `null`(활동 점 폴백). */
export function foldStatus(statuses: readonly (PaneStatus | null | undefined)[]): PaneStatus | null {
  let fail = false;
  let ok = false;
  for (const s of statuses) {
    if (s === "running") return "running";
    if (s === "fail") fail = true;
    else if (s === "ok") ok = true;
  }
  if (fail) return "fail";
  return ok ? "ok" : null;
}

/**
 * 에이전트가 살아 있는 타일은 `running` 을 내지 않는다 — OSC 133 에게 `claude` 는 명령 하나라 세션 내내 "실행 중" 이 되어
 * 에이전트 점과 어긋난다. 안 본 결과(`sticky`)는 그대로 낸다 (docs/log/2026-09-24-agent-status-dot.md).
 */
export function paneBadgeInput(
  live: PaneStatus | null | undefined,
  sticky: PaneStatus | null | undefined,
  agentLive: boolean,
): PaneStatus | null {
  if (live === "running" && !agentLive) return "running";
  return sticky ?? null;
}

/** 문구는 인자로만 받는다 — 기본값을 두면 인자를 빠뜨린 화면이 조용히 한국어로 남는다. */
export function statusLabel(status: PaneStatus, tr: Tr): string {
  if (status === "running") return tr("pane.status.running");
  if (status === "fail") return tr("pane.status.fail");
  return tr("pane.status.ok");
}
