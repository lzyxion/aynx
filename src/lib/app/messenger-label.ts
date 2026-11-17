import { t } from "$lib/i18n/i18n.svelte.js";
import { paneName, type PaneSpec } from "$lib/session";
import { tabOfPane } from "$lib/app/tabs.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { buildScopes, scopeLabelForPath } from "$lib/agent-sessions";
import { projects } from "$lib/app/project-list.svelte.js";
import { worktreesOf } from "$lib/app/worktrees.svelte.js";
import { localFolderOf } from "$lib/app/agent-turn";

/**
 * **메신저 · 알림의 이름표** — 폰에서 **어느 일**인지 읽혀야 한다(docs/log/2026-09-27-discord-notify.md "둘째 줄 — 맥락").
 * 에이전트 알림(`app/agent-notify`)과 긴 명령 알림(`Terminal` → `app/finish-notify`)이 같은 이름을 쓴다(2026-11-16 — 긴 명령도
 * 타일 이름 `pwsh` 대신 프로젝트 / 워크트리).
 */

/**
 * 알림에 적을 이름 — 그 타일이 든 **탭의 제목**(탭 바가 그리는 `displayTabTitle` 그대로, 예
 * `aynx · feat-y`). `paneName` 은 로컬 AI 타일에서 셸 라벨(`PowerShell 7`)이라 Claude 타일이 여럿이면
 * 어느 것이 끝났는지 못 가른다. 탭을 못 찾거나 제목이 비었으면 `paneName` 으로 떨어진다.
 */
export function tileLabel(pane: PaneSpec): string {
  const tab = tabOfPane(pane.id);
  return (tab ? displayTabTitle(tab).trim() : "") || paneName(pane, t);
}

/** 로컬 타일의 폴더가 든 등록 범위(`<프로젝트> · <워크트리>`) — 없으면 `null`. 메신저 이름과 지난 알림 묶음이 함께 쓴다 */
export function scopeOf(pane: PaneSpec): string | null {
  const folder = localFolderOf(pane);
  if (!folder) return null;
  const ready = (id: string) => {
    const w = worktreesOf(id);
    return w?.state === "ok" ? w.list : null;
  };
  return scopeLabelForPath(folder, buildScopes(projects(), ready, null, null).rows) || null;
}

/**
 * 메신저 이름 — 로컬 타일이면 그 폴더가 든 등록 범위(`<프로젝트> / <워크트리>` — 첫 줄의 `등급 · 이름` 과 섞이지 않게 `/`), 아니면 그 탭의
 * 고정 제목(`TabSpec.pinnedTitle` — 프로젝트·워크트리로 연 탭), 그것도 없으면 창 안 알림과 같은 [`tileLabel`](SSH 는 호스트가 든 탭 제목).
 */
export function messengerLabel(pane: PaneSpec): string {
  const scope = scopeOf(pane);
  if (scope) return scope.split(" · ").join(" / ");
  return tabOfPane(pane.id)?.pinnedTitle?.trim() || tileLabel(pane);
}
