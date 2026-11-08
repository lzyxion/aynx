import { agentHooksTargets, type AgentHooksTarget } from "$lib/context";

/**
 * **에이전트 훅 표** — 설정 › AI 의 훅 줄과 원격 프로젝트 메뉴의 훅 항목이 함께 읽는 목록
 * (Rust `agent_hooks::TARGETS` · docs/log/2026-09-26-codex-hooks.md).
 *
 * 화면은 에이전트를 손으로 적지 않는다 — 이 목록을 돌며 그린다. 표는 빌드마다 고정이라 한 번만
 * 읽고, 읽지 못했으면(빈 목록) 다음 부름에서 다시 읽는다.
 */

let targets = $state<AgentHooksTarget[]>([]);
let pending: Promise<void> | null = null;

/** 지금 아는 에이전트 표 — 반응형이다(처음엔 비어 있다가 [`loadHookTargets`] 뒤에 찬다). */
export function hookTargets(): AgentHooksTarget[] {
  return targets;
}

/** 표를 읽는다 — 이미 읽었으면 아무것도 하지 않는다. 동시에 여러 번 불려도 한 번만 묻는다. */
export function loadHookTargets(): Promise<void> {
  if (targets.length > 0) return Promise.resolve();
  pending ??= agentHooksTargets().then((list) => {
    targets = list;
    pending = null;
  });
  return pending;
}
