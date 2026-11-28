// 채팅 모양 AI 타일의 탭 점 · 배너 규칙 — 순수 모듈. 띄우는 쪽은 `app/chat-tile-notify.ts` · 상태 표는 `app/chat-tile-status.svelte.ts`.
// 재료는 이미 오는 사건 · 스냅숏뿐이다 — `agent_state` 표를 쓰지 않아 메신저 다리 대상이 되지 않는다.

import type { AgentStatus } from "$lib/agent-status";
import type { BannerKind } from "$lib/agent-banners";
import type { Outcome, SideChatStatus } from "$lib/side-chat-api";

/** 권한 > 실행 > (안 봄이면) 끝남 */
export function chatTileDot(x: { status: SideChatStatus; sending: boolean; pending: number; unseen: boolean }): AgentStatus | null {
  if (x.pending > 0) return "permission";
  if (x.status === "running" || x.status === "starting" || x.sending) return "running";
  return x.unseen ? "finished" : null;
}

/** 끊은 턴(interrupted)은 사람이 한 일이라 알리지 않는다 */
export function chatTileTurnNotifyKind(outcome: Outcome): "stop" | "failed" | null {
  if (outcome === "ok") return "stop";
  return outcome === "error" ? "failed" : null;
}

/** 배너 풀기 — 턴이 서면 셋 다 · 대기 카드가 0 이 되면 권한 */
export function chatTileResolvedBy(ev: { turnStarted: boolean; permissionsCleared: boolean }): readonly BannerKind[] {
  if (ev.turnStarted) return ["stop", "failed", "permission"];
  return ev.permissionsCleared ? ["permission"] : [];
}
