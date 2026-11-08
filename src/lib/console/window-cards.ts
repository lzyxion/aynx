/**
 * **이 창의 세션 카드 판** — 세션 목록 판(캔버스 위쪽 · `SessionSheet.svelte`)과 워크스페이스마다의 배지(상태바 세션 칸 ·
 * 탭 줄의 워크스페이스 단추 · 목록 — [`workspaceSheetBuckets`])가 같은 재료를 받는다.
 *
 * 몸통은 전체 화면 대시보드의 세션 칸(`console/SessionBoard.svelte` — 2026-10-07 에 시트로 옮기며 걷었다)이 하던
 * 그대로다: 이 창의 행(`windowRows`)을 호스트로 묶고(`groupSessions`), AI 타일의 재료(상태 · 신호 · 턴 시각 ·
 * 자리)를 훑어 카드 판(`buildSessionCards`)을 세운다. 다른 점 하나 — **폴링하지 않는다.** 대시보드는 열려 있는 동안
 * 앱 전역 세션 뷰(`list_console_sessions`)를 2초마다 읽어 헤드리스 위임 카드를 그렸지만, 시트는 이 창의 타일만
 * 보여 준다(누를 타일이 없는 헤드리스 줄은 시트가 빼고, 접속 위임은 호스트 독이 말한다). 그래서 Rust invoke 가 없다.
 *
 * `window-rows.ts` 와 같은 결 — `$state` 를 만들지 않고 **읽기만** 하므로 `$derived.by` 안에서 부르면 탭 · 타일 ·
 * 상태 · 블록 버전이 그대로 의존성이 된다.
 */

import { auxAgentTiles, auxPaneWorkspaces } from "$lib/app/workspace-status.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { agentKindOf, agentSignalsOf, agentStatusOf, agentTurnStartedAt } from "$lib/app/agent-status.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { projects } from "$lib/app/project-list.svelte.js";
import { worktreesOf } from "$lib/app/projects.svelte.js";
import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { agentPlace } from "$lib/agent-board";
import { currentWindowLabel } from "$lib/context";
import { hasSession, listPanes, type PaneSpec, type Tr } from "$lib/session";
import { groupSessions } from "./host-groups";
import { buildSessionCards, type SessionBoard } from "./session-cards";
import { sheetBucketsBy, type SheetBuckets } from "./session-sheet";
import { windowRows } from "./window-rows";

/** 카드 판 + 아이콘을 그릴 `PaneSpec`(paneId → 명세) */
export interface WindowCards {
  board: SessionBoard;
  panes: Map<string, PaneSpec>;
}

/** 이 창의 세션 타일 → 카드 판 */
export function windowSessionCards(tr: Tr): WindowCards {
  const list = projects();
  const agents = auxAgentTiles();
  const order = new Map<string, number>();
  const cwds = new Map<string, string>();
  const panes = new Map<string, PaneSpec>();
  let n = 0;
  for (const tab of residentWindowTabs()) {
    const title = displayTabTitle(tab);
    for (const pane of listPanes(tab.root)) {
      if (!hasSession(pane.kind)) continue;
      order.set(pane.id, n++);
      panes.set(pane.id, pane);
      const cwd = reportedCwd(pane.id) ?? pane.cwd ?? null;
      if (cwd) cwds.set(pane.id, cwd);
      // `agentKindOf` 가 곧 `isAgentPane` 의 몸통이다 — 판정 한 번에 로고 이름까지 받는다
      const ai = agentKindOf(pane);
      if (ai === null) continue;
      agents.set(pane.id, {
        paneId: pane.id,
        status: agentStatusOf(pane),
        signals: agentSignalsOf(pane.id),
        turnStartedAt: agentTurnStartedAt(pane.id),
        place: agentPlace(
          pane,
          list,
          (id) => {
            const w = worktreesOf(id);
            return w?.state === "ok" ? w.list : null;
          },
          remoteHomeOf,
          title,
        ),
        tabTitle: title,
        ai,
      });
    }
  }
  const groups = groupSessions({
    rows: windowRows(tr),
    sessions: [],
    delegations: new Map(),
    runningTargets: new Set(),
    commandByTarget: new Map(),
    metas: new Map(),
    users: new Map(),
    windowLabel: currentWindowLabel(),
    localName: tr("board.group.local"),
  });
  return {
    board: buildSessionCards({ groups, agents, order, cwds, addresses: new Map() }),
    panes,
  };
}

/**
 * **워크스페이스 id → 그 워크스페이스의 세 묶음** — 이 창의 카드 판 하나를 타일의 소속으로 가른다(2026-10-07 — 자리마다
 * 할 일 나누기: 상태바 세션 칸은 지금 워크스페이스, 탭 줄 목록은 줄마다, 탭 줄 단추는 다른 워크스페이스의 합).
 *
 * - **이 창의 탭**은 그 탭의 `workspaceId` 로 간다(숨긴 워크스페이스의 상주 탭 포함).
 * - **보조 창의 타일**(주 창에서만 — `auxWindowRows` 로 판에 이미 든 것)은 그 창이 보고한 워크스페이스로 간다
 *   (`auxPaneWorkspaces`). 보조 창에서는 다른 창의 보고를 받지 않으므로 제 탭만 센다.
 *
 * 묶음 규칙은 판과 같은 `sheetBucketsBy` 라 판의 "기다리는 것" 과 배지의 수가 같은 카드를 센다. 세션이 하나도 없는
 * 워크스페이스는 표에 없다(배지 없음).
 */
export function workspaceSheetBuckets(tr: Tr, now: number): Map<string, SheetBuckets> {
  const { board } = windowSessionCards(tr);
  const owners = auxPaneWorkspaces();
  for (const tab of residentWindowTabs()) {
    if (!tab.workspaceId) continue;
    for (const pane of listPanes(tab.root)) owners.set(pane.id, tab.workspaceId);
  }
  return sheetBucketsBy(board, (card) => (card.paneId === null ? null : owners.get(card.paneId)), now);
}
