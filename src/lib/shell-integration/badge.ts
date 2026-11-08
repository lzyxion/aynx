// 탭 배지 집계(순수) — 패널 상태 여럿을 하나로 접기(`foldStatus`) · 에이전트 타일 입력(`paneBadgeInput`) · 문구(`statusLabel`).

import type { Tr } from "$lib/finish-notify";
import type { PaneStatus } from "./types";

// ---------------------------------------------------------------------------
// 탭 배지 집계 (docs/log/2026-09-01-split-activity.md 5절의 "승격")
// ---------------------------------------------------------------------------

/**
 * 탭 하나의 배지. 패널 여럿의 상태를 **가장 급한 것 하나**로 접는다:
 * 실행 중 > 실패 있음 > 성공. 셋 다 없으면 `null` (= 활동 점 폴백).
 *
 * 순서의 뜻: "지금 돌고 있다" 는 사실이 가장 살아 있는 정보이고, 그다음이 "뭔가 깨졌다",
 * 마지막이 "다 됐다" 다. 실패가 성공을 이기는 것은 당연하지만 실행 중이 실패를 이기는
 * 것은 덜 당연한데 — 그 탭에서 지금 벌어지는 일이 지난 실패보다 먼저 보여야 한다
 * (실패는 화면 안 거터 점으로 어차피 남아 있다).
 */
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
 * 타일 하나가 [`foldStatus`] 에 내는 값 — 지금 도는 중이면 `running`, 아니면 안 본 결과(`sticky`).
 *
 * **에이전트가 살아 있는 타일은 `running` 을 내지 않는다** (docs/log/2026-09-24-agent-status-dot.md
 * 2026-09-26 덧붙임). OSC 133 에게 `claude` 는 명령 하나라 `C` 가 띄울 때 오고 `D` 는 에이전트가
 * 끝나야 온다 — 세션 내내 "실행 중" 이라 아무 말도 하지 않으면서 옆의 "입력 대기" 점과 어긋난다.
 * 그 타일의 지금은 에이전트 점이 말한다. 안 본 결과(`ok`·`fail`)는 그대로 낸다 — 에이전트가
 * 끝났다는 사실은 쓸모 있다. 같은 탭의 다른 타일은 이 함수와 무관하게 평소대로 낸다.
 */
export function paneBadgeInput(
  live: PaneStatus | null | undefined,
  sticky: PaneStatus | null | undefined,
  agentLive: boolean,
): PaneStatus | null {
  if (live === "running" && !agentLive) return "running";
  return sticky ?? null;
}

/**
 * 배지의 툴팁·스크린리더 문구 (색 하나로만 말하지 않기 위해).
 *
 * 문구는 **인자로** 들어온다 — 기본값을 두지 않아 인자를 빠뜨린 화면이 조용히 한국어로
 * 남는 일이 없다 (`i18n/ko/pane.ts` 머리말).
 */
export function statusLabel(status: PaneStatus, tr: Tr): string {
  if (status === "running") return tr("pane.status.running");
  if (status === "fail") return tr("pane.status.fail");
  return tr("pane.status.ok");
}
