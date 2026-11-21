import { emit, listen } from "../ipc";
import { showNotice } from "$lib/app/notice";
import { t, type Key } from "$lib/i18n/i18n.svelte.js";
import { renameFavoriteHost } from "$lib/favorites.svelte.js";
import { renameSnippetHost } from "$lib/snippets.svelte.js";
import { rewriteWorkspaceHosts } from "$lib/app/workspace-hosts";
import { renameHostInTabs } from "$lib/app/tabs.svelte.js";
import { renameDelegationTarget } from "$lib/delegation";
import { thisWindowLabel } from "$lib/settings.svelte.js";
import { renameHostHistory } from "$lib/app/host-history.svelte.js";
import { renameProjectsHost } from "$lib/app/project-list.svelte.js";
import { reloadDbConns } from "$lib/app/db-conns.svelte.js";

/** 호스트 이름 변경의 팬아웃. workspace 파일은 모든 창 큐를 pause한 뒤
 * Rust FILE_LOCK 아래 변경하고 각 창의 메모리 ACK 후 재개한다. */

export const HOST_RENAMED_EVENT = "host-renamed";

/** 방송은 자기 자신에게도 오므로 `window` 라벨로 거른다 */
export interface HostRenamedPayload {
  from: string;
  to: string;
  window: string;
}

/** 실패해도 다음 걸음이 돈다 */
function step(place: Key, run: () => void): string | null {
  try {
    run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 이름 변경을 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

async function stepAsync(place: Key, run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 이름 변경을 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/** 이미 성공한 이름 변경을 따라가는 일이라 되돌리지 않는다 */
export async function hostAliasRenamed(from: string, to: string): Promise<void> {
  const before = from.trim();
  const after = to.trim();
  if (before === "" || after === "" || before === after) return;

  const failed: string[] = [
    step("files.host.rename.place.favorites", () => renameFavoriteHost(before, after)),
    step("files.host.rename.place.snippets", () => renameSnippetHost(before, after)),
    await stepAsync("files.host.rename.place.workspaces", () => rewriteWorkspaceHosts([before], after)),
    step("files.host.rename.place.tabs", () => renameHostInTabs(before, after)),
    // 파일 쪽 걸음은 이름을 바꾼 창에서만 돈다 — 다른 창은 `listenHostRenamed` 에서 메모리 사본만 맞춘다
    await stepAsync("files.host.rename.place.delegation", () => renameDelegationTarget(before, after)),
    await stepAsync("files.host.rename.place.history", () => renameHostHistory(before, after)),
    await stepAsync("files.host.rename.place.projects", () => renameProjectsHost(before, after)),
    // 경유는 Rust `edit_host` 가 이미 고쳤다 — 사본만 다시 읽는다
    await stepAsync("files.host.rename.place.dbconns", () => reloadDbConns()),
  ].filter((p): p is string => p !== null);

  const payload: HostRenamedPayload = { from: before, to: after, window: thisWindowLabel() };
  void emit(HOST_RENAMED_EVENT, payload).catch(() => {});

  if (failed.length > 0) {
    showNotice(
      t("files.host.rename.partial", { from: before, to: after, places: failed.join(" / ") }),
    );
  }
}

/** 이 창의 사용자가 한 일이 아니라 안내를 띄우지 않는다 */
export function listenHostRenamed(): Promise<() => void> {
  return listen<HostRenamedPayload>(HOST_RENAMED_EVENT, (ev) => {
    const p = ev.payload;
    if (!p || typeof p.from !== "string" || typeof p.to !== "string") return;
    if (p.window === thisWindowLabel()) return;
    step("files.host.rename.place.favorites", () => renameFavoriteHost(p.from, p.to));
    step("files.host.rename.place.tabs", () => renameHostInTabs(p.from, p.to));
    void reloadDbConns();
  });
}
