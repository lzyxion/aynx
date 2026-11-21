import { invoke } from "../ipc";
import { isMainWindow } from "$lib/app/window.svelte.js";
import { activeTabId, paneOf, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { currentWorkspace, workspaceList, type RuntimeWorkspace } from "$lib/app/workspaces.svelte.js";
import { agentKindOf, agentStatusOf } from "$lib/app/agent-status.svelte.js";
import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { chipFolder } from "$lib/pane-chips";
import { buildSnapshot, type MirrorWorkspace, type PaneView } from "$lib/mirror/snapshot";
import { startBoardSnapshot } from "$lib/start-widgets.svelte.js";
import type { PaneSpec, TabSpec } from "$lib/session";

/** 주 창만 올린다(GUI 도 `main` 말고는 거절한다) · 워크스페이스가 서기 전에는 빈 화면을 원격에 비추지 않게 올리지 않는다 */

/** 디바운스(ms) — 분할선을 끄는 동안 비율이 초당 수십 번 바뀐다 */
export const MIRROR_PUBLISH_DEBOUNCE_MS = 100;

let lastSent = "";

export function scheduleMirrorPublish(): (() => void) | undefined {
  if (!isMainWindow) return;
  const workspace = currentWorkspace();
  if (!workspace) return;
  const tabs = residentWindowTabs();
  const active = activeTabId();
  const snapshot = buildSnapshot({
    source: "home",
    workspace: { id: workspace.id, name: workspace.name },
    workspaces: workspaceList().map((w) => workspaceRow(w, w.id === workspace.id ? active : null, tabs)),
    tabs: tabs.filter((tab) => workspaceList().some((w) => w.id === tab.workspaceId && w.materialized)),
    activeTabId: activeTabId(),
    focusOf: (tab) => paneOf(tab),
    viewOf,
    startBoard: startBoardSnapshot(),
  });
  const json = JSON.stringify(snapshot);
  if (json === lastSent) return;
  const timer = setTimeout(() => {
    lastSent = json;
    void invoke("mirror_publish", { snapshot: JSON.parse(json) }).catch((e: unknown) => {
      lastSent = "";
      console.warn("[aynx] 화면 배치를 원격에 알리지 못했습니다:", e);
    });
  }, MIRROR_PUBLISH_DEBOUNCE_MS);
  return () => clearTimeout(timer);
}

function workspaceRow(w: RuntimeWorkspace, currentActive: string | null, tabs: readonly TabSpec[]): MirrorWorkspace {
  const row: MirrorWorkspace = { id: w.id, name: w.name, activeTabId: null };
  if (w.icon) row.icon = w.icon;
  if (w.color) row.color = w.color;
  if (!w.materialized) {
    row.cold = true;
    row.tabCount = w.savedTabs.filter((tab) => tab.placement.kind === "main").length;
    return row;
  }
  const own = tabs.filter((tab) => tab.workspaceId === w.id);
  row.activeTabId =
    currentActive ?? own.find((tab) => tab.tabKey !== undefined && tab.tabKey === w.lastActive.tabKey)?.id ?? own[0]?.id ?? null;
  return row;
}

function viewOf(pane: PaneSpec): PaneView | null {
  if (pane.kind !== "local" && pane.kind !== "ssh") return null;
  const ai = agentKindOf(pane);
  const view: PaneView = {};
  if (ai === "claude" || ai === "codex") view.ai = ai;
  const agent = agentStatusOf(pane);
  if (agent) view.agent = agent;
  const folder = chipFolder({
    reported: pane.kind === "local" ? localReportedFolder(pane) : reportedCwd(pane.id),
    start: pane.cwd,
    tmux: pane.kind === "ssh" && !!pane.tmux,
  });
  if (folder) view.folder = folder;
  return view;
}
