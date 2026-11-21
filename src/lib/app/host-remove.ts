import { showNotice } from "$lib/app/notice";
import { t, type Key } from "$lib/i18n/i18n.svelte.js";
import { aliasKeySet, countAliased, countInMap } from "$lib/host-remove";
import { favorites, removeFavorite } from "$lib/favorites.svelte.js";
import { countHostSnippets, removeHostSnippets } from "$lib/snippets.svelte.js";
import { countWorkspaceHostRefs } from "$lib/app/workspaces.svelte.js";
import { rewriteWorkspaceHosts } from "$lib/app/workspace-hosts";
import { countHostTilesInTabs } from "$lib/app/tabs.svelte.js";
import { delegations, refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
import { removeDelegationTargets } from "$lib/delegation";
import { forgetHostHistory } from "$lib/app/host-history.svelte.js";
import { forgetProjectsHost, projects } from "$lib/app/project-list.svelte.js";
import { dbConnsVia, forgetDbFavorites, forgetDbPasswords, reloadDbConns } from "$lib/app/db-conns.svelte.js";

/** 호스트 제거의 팬아웃. 저장 트리의 참조 잎은 빼고 빈 탭은 시작 타일 하나로 남긴다 — live 세션은 닫지 않는다.
 * 워크스페이스는 모든 창 큐 pause → Rust 파일 변경 → 각 창 메모리 ACK → resume 순서다. */

/** 제거 확인 문구를 위한 값 */
export interface HostRefCounts {
  favorites: number;
  snippets: number;
  workspaces: number;
  /** 닫지 않는다 */
  tiles: number;
  /** 지우지 않으면 그 위임 줄은 가리킬 것 없이 권한을 그대로 든다 */
  delegation: number;
  projects: number;
  /** 경유하는 DB 연결은 호스트와 함께 지운다(Rust `remove_host`) */
  dbConns: number;
}

/** 하나가 던져도 나머지는 센다 — 숫자 한 칸이 빠져도 대화상자는 떠야 한다 */
export function countHostRefs(aliases: readonly string[]): HostRefCounts {
  const keys = aliasKeySet(aliases);
  const counted = <T>(run: () => T, fallback: T): T => {
    try {
      return run();
    } catch (e) {
      console.warn("[aynx] 호스트 참조를 세지 못했습니다:", e);
      return fallback;
    }
  };
  return {
    favorites: counted(
      () => countAliased(favorites(), (f) => (f.kind === "host" ? f.alias : null), keys),
      0,
    ),
    snippets: counted(() => countHostSnippets(aliases), 0),
    workspaces: counted(() => countWorkspaceHostRefs(aliases), 0),
    tiles: counted(() => countHostTilesInTabs(aliases), 0),
    delegation: counted(() => countInMap(keys, delegations()), 0),
    projects: counted(() => countAliased(projects(), (p) => p.host, keys), 0),
    dbConns: counted(() => aliases.reduce((n, a) => n + dbConnsVia(a).length, 0), 0),
  };
}

export function describeHostRefs(aliases: readonly string[]): string | null {
  const refs = countHostRefs(aliases);
  const parts: string[] = [];
  const part = (key: Key, n: number) => {
    if (n > 0) parts.push(t(key, { n }));
  };
  part("files.host.remove.refs.favorites", refs.favorites);
  part("files.host.remove.refs.snippets", refs.snippets);
  part("files.host.remove.refs.workspaces", refs.workspaces);
  part("files.host.remove.refs.tiles", refs.tiles);
  part("files.host.remove.refs.delegation", refs.delegation);
  part("files.host.remove.refs.projects", refs.projects);
  // DB 연결은 정리가 아니라 삭제라 따로 한 문장으로 말한다
  const db = refs.dbConns > 0 ? t("files.host.remove.refs.dbconns", { n: refs.dbConns }) : null;
  if (parts.length === 0) return db;
  const line = t("files.host.remove.refs.line", { parts: parts.join(" · ") });
  return db ? `${line} ${db}` : line;
}

/** 실패해도 다음 걸음이 돈다 */
function step(place: Key, run: () => void): string | null {
  try {
    run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 제거를 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

async function stepAsync(place: Key, run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 제거를 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/** `aliases` 는 백엔드 제거가 성공한 별칭만 온다 */
export async function hostsRemoved(aliases: readonly string[]): Promise<void> {
  const list = aliases.map((a) => a.trim()).filter((a) => a !== "");
  if (list.length === 0) return;
  const keys = aliasKeySet(list);

  const failed: string[] = [
    step("files.host.rename.place.favorites", () => {
      for (const fav of [...favorites()]) {
        if (fav.kind === "host" && keys.has(fav.alias.trim().toLowerCase())) removeFavorite(fav);
      }
    }),
    step("files.host.rename.place.snippets", () => removeHostSnippets(list)),
    await stepAsync("files.host.rename.place.workspaces", () => rewriteWorkspaceHosts(list)),
    await stepAsync("files.host.rename.place.delegation", async () => {
      await removeDelegationTargets(list);
      refreshDelegationTargets();
    }),
    await stepAsync("files.host.rename.place.history", () => forgetHostHistory(list)),
    await stepAsync("files.host.rename.place.projects", () => forgetProjectsHost(list)),
    // 경유 줄은 Rust `remove_host` 가 이미 지웠다 — 볼트 비밀번호는 사본이 아직 지운 줄을 들고 있을 때 걷는다
    await stepAsync("files.host.rename.place.dbconns", async () => {
      const ids = list.flatMap((a) => dbConnsVia(a).map((d) => d.id));
      forgetDbFavorites(ids);
      await forgetDbPasswords(ids);
      await reloadDbConns();
    }),
  ].filter((p): p is string => p !== null);

  if (failed.length > 0) {
    showNotice(t("files.host.remove.partial", { places: failed.join(" / ") }));
  }
}
