import { agentHooksTargets, type AgentHooksTarget } from "$lib/context";

/** 에이전트 훅 표(Rust `agent_hooks::TARGETS`) — 화면은 에이전트를 손으로 적지 않고 이 목록을 돌며 그린다 */

let targets = $state<AgentHooksTarget[]>([]);
let pending: Promise<void> | null = null;

export function hookTargets(): AgentHooksTarget[] {
  return targets;
}

/** 표는 빌드마다 고정이라 한 번만 읽는다 — 빈 목록이면 다음 부름에서 다시 */
export function loadHookTargets(): Promise<void> {
  if (targets.length > 0) return Promise.resolve();
  pending ??= agentHooksTargets().then((list) => {
    targets = list;
    pending = null;
  });
  return pending;
}
