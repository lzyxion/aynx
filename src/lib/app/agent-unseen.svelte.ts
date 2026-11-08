/**
 * **에이전트 "완료 · 아직 안 봄" 표식** — 타일 id 로 드는 표식 하나 (docs/log/2026-10-01-agent-status-three.md ·
 * 처음 판 docs/log/2026-10-01-signal-grid.md).
 *
 * 에이전트 훅의 `stop`(턴 끝)이 **보이지 않는 타일**에서 왔을 때 붙는다(`app/agent-status` 의 `agentSignal`).
 * 수명은 벨의 안 본 표식(`app/bell.svelte.ts` 의 `unseen`)과 **똑같다**: 그 탭을 보는 순간
 * (`app/tabs` 의 `clearSeenStatus` — 벨·안 본 결과를 거두는 그 자리) 거두고, 새 턴(`start`·`tool`)·
 * 새 CLI · 셸 복귀 · 세션 종료 · 타일 닫힘에서도 거둔다. 보이는 타일에서 `stop` 이 오면 붙지 않는다.
 * 표식은 창마다 살지만 **확인은 창끼리 나눈다**(2026-11-04) — 다른 창에서 사람이 그 턴 끝을 봤다는 방송이 오면 여기서도 거둔다(`app/agent-seen`).
 *
 * 판정(`$lib/agent-status` 의 `agentStatus`)이 이 표식을 입력으로 받는다 — 가장 늦은 훅 신호가 `stop` 이고
 * 표식이 있으면 점 "완료", 표식이 없으면(봤다) 점이 없다. **보면 사라진다**.
 *
 * ## 왜 따로 사는가
 *
 * `app/tabs` 가 거두고 `app/agent-status` 가 붙인다 — 그런데 agent-status 가 tabs 를 이미 부른다. 표식을
 * 어느 한쪽에 두면 다른 쪽이 되불러 순환이 선다. 벨이 `app/bell` 에 따로 사는 것과 같은 이유로 잎 모듈이다
 * (아무것도 부르지 않는다).
 */

/** 타일 id → 끝났는데 아직 안 봤는가 */
const unseen = $state<Record<string, boolean>>({});

/** 보이지 않는 타일에서 턴이 끝났다 — 표식을 붙인다 */
export function markAgentUnseen(paneId: string): void {
  unseen[paneId] = true;
}

/** 그 타일에 안 본 끝남이 있는가 — 반응형 */
export function hasAgentUnseen(paneId: string): boolean {
  return unseen[paneId] === true;
}

/** 그 탭을 봤다 · 새 턴이 섰다 · 세션이 끝났다 · 타일이 사라졌다 — 표식을 거둔다 */
export function clearAgentUnseen(paneIds: Iterable<string>): void {
  for (const id of paneIds) if (id in unseen) delete unseen[id];
}
