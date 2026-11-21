import { t } from "$lib/i18n/i18n.svelte.js";
import { paneName, type PaneSpec } from "$lib/session";
import { tabOfPane } from "$lib/app/tabs.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { buildScopes, scopeLabelForPath } from "$lib/agent-sessions";
import { projects } from "$lib/app/project-list.svelte.js";
import { worktreesOf } from "$lib/app/worktrees.svelte.js";
import { localFolderOf } from "$lib/app/agent-turn";
import { bridgeLabelText } from "$lib/messenger-notify";

/** 탭 제목을 쓴다 — `paneName` 은 로컬 AI 타일에서 셸 라벨이라 Claude 타일이 여럿이면 어느 것인지 못 가른다 */
export function tileLabel(pane: PaneSpec): string {
  const tab = tabOfPane(pane.id);
  return (tab ? displayTabTitle(tab).trim() : "") || paneName(pane, t);
}

export function scopeOf(pane: PaneSpec): string | null {
  const folder = localFolderOf(pane);
  if (!folder) return null;
  const ready = (id: string) => {
    const w = worktreesOf(id);
    return w?.state === "ok" ? w.list : null;
  };
  return scopeLabelForPath(folder, buildScopes(projects(), ready, null, null).rows) || null;
}

/** 범위는 `/` 로 잇는다 — 첫 줄의 `등급 · 이름` 과 섞이지 않게 */
export function messengerLabel(pane: PaneSpec): string {
  const scope = scopeOf(pane);
  if (scope) return scope.split(" · ").join(" / ");
  return tabOfPane(pane.id)?.pinnedTitle?.trim() || tileLabel(pane);
}

/** 탭 제목 · 타일 이름은 쓰지 않는다 — 한 탭에 타일이 늘면 탭 제목이 바뀌어 이름표가 타일을 가리키지 못한다 */
export function bridgeLabel(pane: PaneSpec, agent: string | null): string {
  return bridgeLabelText(agent, scopeOf(pane), localFolderOf(pane));
}
