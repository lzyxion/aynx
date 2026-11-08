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

/** 호스트 제거의 팬아웃. cold/aux를 포함한 저장 트리에서는 참조 잎을 빼고
 * 빈 탭은 시작 타일 하나로 남긴다. live 세션은 닫지 않는다.
 * 모든 창 큐 pause → Rust 파일 변경 → 각 창 메모리 ACK → resume 순서다. */

/** 이 별칭들을 가리키고 있는 자리의 수 — 전부 **제거 확인 문구**를 위한 값이다 */
export interface HostRefCounts {
  /** 즐겨찾기 칸 (하단 독) */
  favorites: number;
  /** 호스트 범위 스니펫 줄 */
  snippets: number;
  /** cold/다른 창의 저장 트리에 있는 호스트 잎 */
  workspaces: number;
  /** 이 창에 열려 있는 SSH 타일 — **닫지 않는다** (머리말) */
  tiles: number;
  /**
   * `~/.aynx/delegation.toml` 의 **AI 위임** 줄. 다른 넷과 무게가 다르다 — 지우지 않으면 그 줄은
   * 가리킬 것이 없어진 채로 **권한을 그대로 든다**(그리고 관제판에 영원히 "설정에 없음"
   * 으로 남는다). 그래서 확인 문구가 그 수를 먼저 말한다.
   */
  delegation: number;
  /**
   * 그 호스트를 가리키는 **원격 프로젝트** (docs/log/2026-09-24-projects.md) — 호스트와 함께
   * 목록에서 빠진다(호스트 없는 원격 프로젝트는 열 방법이 없는 줄이다). 저장소 폴더 자체는
   * 서버에 그대로다.
   */
  projects: number;
  /**
   * 그 호스트를 **경유하는 DB 연결**(`db-connections.json` 의 `via`) — 호스트와 함께 지운다(Rust `remove_host` 가 같은 명령
   * 안에서 · 볼트 비밀번호는 `hostsRemoved` 가 걷는다). 경유 없는 연결은 쓸 데가 없는 줄이라 남기지 않는다.
   */
  dbConns: number;
}

/**
 * 지금 상태에서 이 별칭들이 몇 자리에 적혀 있는가. 어느 저장소도 건드리지 않는다.
 *
 * 하나가 던져도 나머지는 세어야 하므로 걸음마다 감싼다 — 확인 문구의 숫자 한 칸이 빠지는
 * 것과 대화상자가 아예 안 뜨는 것은 무게가 다르다.
 */
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
    // 앱이 든 사본을 **동기로** 읽는다 (`app/delegation.svelte.ts`) — 확인 대화상자를 띄우기 전에
    // 세어야 하는 값이라 여기서 왕복할 자리가 없다.
    delegation: counted(() => countInMap(keys, delegations()), 0),
    projects: counted(() => countAliased(projects(), (p) => p.host, keys), 0),
    dbConns: counted(() => aliases.reduce((n, a) => n + dbConnsVia(a).length, 0), 0),
  };
}

/**
 * 제거 확인 대화상자에 붙는 **한 줄** — 걸리는 자리가 하나도 없으면 `null`(줄이 붙지 않는다).
 *
 * 0 인 칸은 아예 적지 않는다: "즐겨찾기 0 · 스니펫 2" 는 사람에게 "0" 을 읽게 만들 뿐이다.
 */
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
  // DB 연결은 정리가 아니라 **삭제**라 따로 한 문장으로 말한다.
  const db = refs.dbConns > 0 ? t("files.host.remove.refs.dbconns", { n: refs.dbConns }) : null;
  if (parts.length === 0) return db;
  const line = t("files.host.remove.refs.line", { parts: parts.join(" · ") });
  return db ? `${line} ${db}` : line;
}

/** 한 걸음 — 실패해도 다음 걸음이 돈다. 실패하면 그 자리의 이름을 돌려준다 */
function step(place: Key, run: () => void): string | null {
  try {
    run();
    return null;
  } catch (e) {
    // 콘솔에는 이유를 남긴다 — 토스트 한 줄에는 자리 이름만 싣는다 (사람이 고칠 것이 아니다).
    console.warn("[aynx] 호스트 제거를 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/** 한 걸음(비동기 판) — Tauri 왕복이 끼는 자리용 (`app/host-rename.ts` 와 같은 모양) */
async function stepAsync(place: Key, run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    console.warn("[aynx] 호스트 제거를 따라가지 못했습니다:", place, e);
    return t(place);
  }
}

/**
 * **제거 팬아웃** — 사라진 별칭을 적어 둔 네 자리를 차례로 치운다.
 *
 * `aliases` 는 `~/.ssh/config` 의 **별칭**이고, 백엔드 제거가 **성공한 것만** 온다. 부르는
 * 자리는 하나다 (`app/hosts.svelte.ts` 의 `removeHostsAction`). 열린 타일은 여기 없다 —
 * 머리말의 "열린 타일은 닫지 않는다".
 *
 * 넷째가 **AI 위임**이다 (2026-09-21) — 이 걸음이 Tauri 왕복이라 함수가 `async` 다. 지우지
 * 않으면 그 줄은 가리킬 것이 없어진 채로 권한만 든다.
 */
export async function hostsRemoved(aliases: readonly string[]): Promise<void> {
  const list = aliases.map((a) => a.trim()).filter((a) => a !== "");
  if (list.length === 0) return;
  const keys = aliasKeySet(list);

  const failed: string[] = [
    // 1. 즐겨찾기 (localStorage) — 하단 독의 칸이다.
    //    칸 하나씩 빼는 것은 저장 경로를 [`removeFavorite`] 하나로 유지하기 위해서다
    //    (그 안에서 `withoutFavorite` 가 돈다). 목록이 열 칸뿐이라 비용이 없다.
    step("files.host.rename.place.favorites", () => {
      for (const fav of [...favorites()]) {
        if (fav.kind === "host" && keys.has(fav.alias.trim().toLowerCase())) removeFavorite(fav);
      }
    }),
    // 2. 호스트 스니펫 (`snippets.json`)
    step("files.host.rename.place.snippets", () => removeHostSnippets(list)),
    // 3. 모든 워크스페이스의 저장 참조 — live 세션은 유지한다
    await stepAsync("files.host.rename.place.workspaces", () => rewriteWorkspaceHosts(list)),
    // 4. **AI 위임** (`~/.aynx/delegation.toml`) — 위임이 없던 호스트면 조용한 no-op(0)이다.
    await stepAsync("files.host.rename.place.delegation", async () => {
      await removeDelegationTargets(list);
      refreshDelegationTargets(); // 목록 표식·다음 확인 문구가 곧바로 맞도록
    }),
    // 5. **접속 이력** (`history.json`, docs/log/2026-09-23-host-history.md) — 확인 문구에 세지
    //    않는다: 지워도 잃는 것이 시각 몇 개뿐이라 사람이 따져 볼 무게가 아니다.
    await stepAsync("files.host.rename.place.history", () => forgetHostHistory(list)),
    // 6. **원격 프로젝트** (`projects.json`) — 그 호스트의 프로젝트를 목록에서 뺀다. 확인 문구가
    //    수를 먼저 말했다(`refs.projects`). 다른 창은 `projects-changed` 로 맞춰진다.
    await stepAsync("files.host.rename.place.projects", () => forgetProjectsHost(list)),
    // 7. **DB 연결** — 경유 줄은 Rust `remove_host` 가 이미 지웠다. 여기서는 그 연결들의 볼트 비밀번호를 걷고(열려 있을 때만 ·
    //    지금 사본이 아직 지운 줄을 들고 있다) 즐겨찾기 칸을 빼고 사본을 다시 읽는다. 확인 문구가 수를 먼저 말했다(`refs.dbconns`).
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
