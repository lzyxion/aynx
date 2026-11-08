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
 * Rust FILE_LOCK 아래 변경하고 각 창의 메모리 ACK 후 재개한다.
 * 즐겨찾기·스니펫·위임·이력·프로젝트는 기존 저장소 규칙을 유지한다. */

/** 창 사이로 "호스트 이름이 방금 바뀌었다" 를 알리는 이벤트 이름 */
export const HOST_RENAMED_EVENT = "host-renamed";

/**
 * [`HOST_RENAMED_EVENT`] 의 짐 — 옛 이름·새 이름과 **보낸 창의 라벨**.
 *
 * 방송은 자기 자신에게도 오므로 라벨로 거른다 (`SettingsSavedPayload` 와 같은 규칙).
 * 값(별칭 두 글자)을 싣는 것은 설정과 반대인데, 여기서는 **파일이 진실이 아니기** 때문이다:
 * 받는 창이 고쳐야 하는 것은 자기 메모리 안의 목록이고, "무엇을 무엇으로" 는 이 짐에만 있다.
 */
export interface HostRenamedPayload {
  from: string;
  to: string;
  /** 보낸 창의 라벨 — 자기 방송을 거르는 데만 쓴다 */
  window: string;
}

/** 한 걸음 — 실패해도 다음 걸음이 돈다. 실패하면 그 자리의 이름을 돌려준다 */
function step(place: Key, run: () => void): string | null {
  try {
    run();
    return null;
  } catch (e) {
    // 콘솔에는 이유를 남긴다 — 토스트 한 줄에는 자리 이름만 싣는다 (사람이 고칠 것이 아니다).
    console.warn("[aynx] 호스트 이름 변경을 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/** 한 걸음(비동기 판) — Tauri 왕복이 끼는 자리용. 규칙은 [`step`] 과 똑같다 */
async function stepAsync(place: Key, run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 이름 변경을 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/**
 * **이름 변경 팬아웃** — 별칭을 적어 둔 다섯 자리를 차례로 고친다.
 *
 * `from` 과 `to` 는 `~/.ssh/config` 에 적히는 **별칭**이다(호스트 이름이 아니다). 부르는
 * 자리는 하나뿐이고(`submitForm` 의 메타 이관이 끝난 자리), 이미 성공한 이름 변경을
 * 따라가는 일이라 **되돌리지 않는다** — 한 걸음이 실패해도 나머지는 새 이름으로 간다.
 */
export async function hostAliasRenamed(from: string, to: string): Promise<void> {
  const before = from.trim();
  const after = to.trim();
  if (before === "" || after === "" || before === after) return;

  const failed: string[] = [
    // 1. 즐겨찾기 (localStorage) — 사라진 것이 가장 먼저 눈에 띄는 자리다.
    step("files.host.rename.place.favorites", () => renameFavoriteHost(before, after)),
    // 2. 호스트 스니펫 (`snippets.json`)
    step("files.host.rename.place.snippets", () => renameSnippetHost(before, after)),
    // 3. 모든 워크스페이스의 cold/resident/aux 저장 트리
    await stepAsync("files.host.rename.place.workspaces", () => rewriteWorkspaceHosts([before], after)),
    // 4. 이 창에 열려 있는 탭들의 타일 명세 (저장은 평소 자동 저장이 받는다)
    step("files.host.rename.place.tabs", () => renameHostInTabs(before, after)),
    // 5. **AI 위임** (`~/.aynx/delegation.toml`) — 스니펫·워크스페이스과 같은 **파일**이라 이름을 바꾼
    //    창에서만 돈다(다른 창은 `listenHostRenamed` 에서 1·4 만 다시 돈다 — 머리말).
    //    위임이 없던 호스트면 백엔드가 `false` 를 돌려주는 조용한 no-op 이다.
    await stepAsync("files.host.rename.place.delegation", () => renameDelegationTarget(before, after)),
    // 6. **접속 이력** (`history.json`, docs/log/2026-09-23-host-history.md) — Rust 가 쓰는 파일이라
    //    이 창에서 한 번만 부른다. 다른 창의 사본은 Rust 가 쏘는 `host-history-changed` 가 맞춘다.
    await stepAsync("files.host.rename.place.history", () => renameHostHistory(before, after)),
    // 7. **원격 프로젝트** (`projects.json`, docs/log/2026-09-24-projects.md) — 그 호스트를 가리키던
    //    프로젝트가 새 별칭을 따라간다. Rust 가 쓰는 파일이라 이 창에서 한 번만 부르고, 다른 창의
    //    사본은 Rust 가 쏘는 `projects-changed` 가 맞춘다.
    await stepAsync("files.host.rename.place.projects", () => renameProjectsHost(before, after)),
    // 8. **DB 연결의 경유** (`db-connections.json`) — Rust `edit_host` 가 같은 명령 안에서 이미 고쳤다(실패는 그 명령의 경고).
    //    여기서는 이 창의 사본만 다시 읽는다.
    await stepAsync("files.host.rename.place.dbconns", () => reloadDbConns()),
  ].filter((p): p is string => p !== null);

  // 다른 창에도 알린다 — 실패는 삼킨다 (이 창의 결과가 달라지지 않는다).
  const payload: HostRenamedPayload = { from: before, to: after, window: thisWindowLabel() };
  void emit(HOST_RENAMED_EVENT, payload).catch(() => {});

  if (failed.length > 0) {
    showNotice(
      t("files.host.rename.partial", { from: before, to: after, places: failed.join(" / ") }),
    );
  }
}

/**
 * 다른 창의 이름 변경을 받아 **이 창의 메모리 사본**을 맞춘다 — `mountAppListeners` 가 건다.
 *
 * 도는 것은 **1·4 단계뿐**이다 (머리말의 "다른 창"). 여기서는 안내를 띄우지 않는다: 이 창의
 * 사용자가 한 일이 아니라, 실패했다 해도 알려 줄 맥락이 없다.
 */
export function listenHostRenamed(): Promise<() => void> {
  return listen<HostRenamedPayload>(HOST_RENAMED_EVENT, (ev) => {
    const p = ev.payload;
    if (!p || typeof p.from !== "string" || typeof p.to !== "string") return;
    if (p.window === thisWindowLabel()) return;
    step("files.host.rename.place.favorites", () => renameFavoriteHost(p.from, p.to));
    step("files.host.rename.place.tabs", () => renameHostInTabs(p.from, p.to));
    void reloadDbConns(); // DB 연결의 경유는 파일이 진실이다(Rust 가 고쳤다) — 사본만 다시 읽는다
  });
}
