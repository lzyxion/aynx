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

/**
 * **독의 에이전트 점의 재료** — 이 창의 AI 타일들과 등록 폴더를 순수 층(`$lib/dock-dots`)에 넘길 모양으로
 * 뽑는다 (docs/log/2026-09-27-dock-agent-dots.md). 새 신호도 시계도 없다 — 탭 점이 읽는 같은 저장소
 * (`agentStatusOf`)와 셸이 알려 준 폴더(`reportedCwd`)를 읽을 뿐이라, 부르는 `$derived` 가 그 값들을 따라간다.
 */

/** 이 창의 AI 타일들 — 로컬과 설정 별칭의 SSH 타일만(빠른 접속 타일은 어느 줄에도 서지 않는다). 반응형 */
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

/** 등록된 프로젝트 폴더들(읽어 둔 워크트리 목록 포함) — 반응형 */
export function dockProjectFolders(): DockFolder[] {
  return projectFolders(projects(), worktreesOf, remoteHomeOf);
}

/**
 * 상태 표시줄 독 입구의 부름 — 권한 대기 · 완료(안 봄)인 에이전트가 호스트(원격) · 프로젝트 쪽에 있으면 그 말풍선
 * 한 줄씩, 없으면 `null`. 실행 중은 입구에 서지 않는다.
 */
export function dockEntranceAttention(): string | null {
  const w = dockWaiting(dockAgentPanes(), dockProjectFolders(), remoteHomeOf);
  const lines: string[] = [];
  if (w.hosts) lines.push(t("app.dock.dot.entrance.hosts"));
  if (w.projects) lines.push(t("app.dock.dot.entrance.projects"));
  return lines.length > 0 ? lines.join("\n") : null;
}
