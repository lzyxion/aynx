/**
 * 에이전트 "완료 · 아직 안 봄" 표식 — 수명은 벨의 안 본 표식과 같다(그 탭을 보는 순간 `app/tabs` 의 `clearSeenStatus` 가 거둔다).
 * 잎 모듈이다 — `app/tabs` 가 거두고 `app/agent-status` 가 붙이는데 agent-status 가 tabs 를 부르므로 어느 한쪽에 두면 순환이 선다.
 */

const unseen = $state<Record<string, boolean>>({});

export function markAgentUnseen(paneId: string): void {
  unseen[paneId] = true;
}

export function hasAgentUnseen(paneId: string): boolean {
  return unseen[paneId] === true;
}

export function clearAgentUnseen(paneIds: Iterable<string>): void {
  for (const id of paneIds) if (id in unseen) delete unseen[id];
}
