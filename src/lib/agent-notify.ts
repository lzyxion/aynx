/** 에이전트 턴 끝 · 권한 물음을 무엇으로 알릴지 정하는 순수 모듈 — 띄우는 쪽은 `app/agent-notify.ts` */

import type { Tr } from "$lib/finish-notify";

/** `"toast"` 는 이름만 남은 것이다 — 창 안 표면은 에이전트 알림 배너다 */
export type AgentStopNotify = "none" | "toast" | "focused" | "os";

export interface AgentStopNotifyInput {
  enabled: boolean;
  windowFocused: boolean;
  /** 이 창의 활성 탭에서 포커스된 타일인가 — 분할된 옆 타일은 보여도 아니다 */
  focusedTile: boolean;
  /** 훅 `start` 부터 이 신호까지. 시작을 못 봤으면 `null` — 보고 있는 타일은 알리지 않는다 */
  turnMs: number | null;
  /** `0` 이하 = 끔 */
  focusedAfterMs: number;
}

export function shouldNotifyAgentStop(input: AgentStopNotifyInput): AgentStopNotify {
  if (!input.enabled) return "none";
  if (!input.windowFocused) return "os";
  if (!input.focusedTile) return "toast";
  const long = input.focusedAfterMs > 0 && input.turnMs !== null && input.turnMs >= input.focusedAfterMs;
  return long ? "focused" : "none";
}

export type AgentNotifyKind = "stop" | "permission";

/**
 * `waiting` 은 범주 `permission` 만 알린다 — `idle`(stop 뒤 약 60초)까지 받으면 한 턴에 두 번 온다.
 * 범주는 훅 스크립트가 싣는다(`src-tauri/src/agent_hooks.rs`) · 범주 없는 옛 스크립트는 알리지 않는다.
 */
export function agentNotifyKind(event: unknown, detail: unknown): AgentNotifyKind | null {
  if (event === "stop") return "stop";
  if (event === "waiting" && detail === "permission") return "permission";
  return null;
}

export interface AgentStopMessage {
  body: string;
  /** 제목이 없는 표면이라 타일 이름을 앞에 붙인다 */
  toast: string;
}

export function agentStopMessage(tileName: string, tr: Tr, agent?: string | null): AgentStopMessage {
  return agentNotifyMessage("stop", tileName, tr, agent);
}

export function agentNotifyMessage(
  kind: AgentNotifyKind,
  tileName: string,
  tr: Tr,
  agent?: string | null,
): AgentStopMessage {
  const who = agent || tr("app.agent.name.generic");
  return {
    body: tr(`app.agent.${kind}.body`, { agent: who }),
    toast: tr(`app.agent.${kind}.toast`, { name: tileName, agent: who }),
  };
}
