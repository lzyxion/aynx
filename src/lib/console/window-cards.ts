/**
 * 이 창의 세션 카드 판 — 세션 목록 판과 워크스페이스마다의 배지가 같은 재료를 받는다. 이 창의 타일만 보여 주므로 폴링 · invoke 가 없다.
 * `$state` 를 만들지 않고 읽기만 한다 — `$derived.by` 안에서 불러야 반응한다.
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

export interface WindowCards {
  board: SessionBoard;
  panes: Map<string, PaneSpec>;
}

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

/** 보조 창에서는 다른 창의 보고를 받지 않으므로 제 탭만 센다 */
export function workspaceSheetBuckets(tr: Tr, now: number): Map<string, SheetBuckets> {
  const { board } = windowSessionCards(tr);
  const owners = auxPaneWorkspaces();
  for (const tab of residentWindowTabs()) {
    if (!tab.workspaceId) continue;
    for (const pane of listPanes(tab.root)) owners.set(pane.id, tab.workspaceId);
  }
  return sheetBucketsBy(board, (card) => (card.paneId === null ? null : owners.get(card.paneId)), now);
}
