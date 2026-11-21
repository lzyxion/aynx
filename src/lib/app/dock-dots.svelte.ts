import { agentKindOf, agentStatusOf, isLiveAgentPane } from "$lib/app/agent-status.svelte.js";
import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { projects } from "$lib/app/project-list.svelte.js";
import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { worktreesOf } from "$lib/app/worktrees.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { dockWaiting, projectFolders, type DockAgentPane, type DockFolder } from "$lib/dock-dots";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { listPanes } from "$lib/session";

/** 빠른 접속 SSH 타일은 어느 줄에도 서지 않는다 */
export function dockAgentPanes(): DockAgentPane[] {
  const out: DockAgentPane[] = [];
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind !== "local" && (pane.kind !== "ssh" || pane.adhoc || !pane.alias?.trim())) continue;
      const kind = agentKindOf(pane);
      if (kind === null || !isLiveAgentPane(pane)) continue;
      const local = pane.kind === "local";
      out.push({
        id: pane.id,
        name: aiDisplayName(kind) ?? kind,
        state: agentStatusOf(pane),
        host: local ? null : (pane.alias?.trim() ?? null),
        start: pane.cwd?.trim() || null,
        current: local ? localReportedFolder(pane) : reportedCwd(pane.id)?.trim() || null,
      });
    }
  }
  return out;
}

export function dockProjectFolders(): DockFolder[] {
  return projectFolders(projects(), worktreesOf, remoteHomeOf);
}

export function dockEntranceAttention(): string | null {
  const w = dockWaiting(dockAgentPanes(), dockProjectFolders(), remoteHomeOf);
  const lines: string[] = [];
  if (w.hosts) lines.push(t("app.dock.dot.entrance.hosts"));
  if (w.projects) lines.push(t("app.dock.dot.entrance.projects"));
  return lines.length > 0 ? lines.join("\n") : null;
}
