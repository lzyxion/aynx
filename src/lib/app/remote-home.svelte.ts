import { invoke } from "../ipc";
import { listPanes, type PaneSpec } from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";

/**
 * **원격 `$HOME` 사본** — 별칭마다 한 번 묻고 그 전송로가 사는 동안 쥔다
 * (docs/log/2026-09-24-worktrees.md "`~` 와 git 의 절대 경로").
 *
 * 사람은 원격 프로젝트를 `~/api` 로 적고 git 은 `/root/api` 로 적는다. 독 트리의 에이전트 점이
 * 둘을 맞대려면 그 서버의 홈을 알아야 한다(`$lib/projects` 의 `expandRemotePath`).
 *
 * ## 언제 묻나 — 필요할 때 한 번
 *
 * - 원격 워크트리 목록을 읽기 직전(`app/projects` 의 `listProjectWorktrees`).
 * - `~` 로 시작하는 폴더에서 연 SSH 타일이 **세션을 얻은 순간**(`+page` 의 `onsession` →
 *   [`remoteSessionChanged`]) — 트리를 펼치기 전에 타일을 열어도 점이 곧바로 맞는다.
 *   `~` 가 아닌 타일은 묻지 않는다(프로젝트를 안 쓰는 사람의 접속은 왕복이 하나도 늘지 않는다).
 *
 * 시계로 다시 묻지 않는다. 같은 별칭에 이미 답이 있거나 묻는 중이면 그것을 쓴다.
 *
 * ## 언제 버리나 — 그 별칭의 마지막 세션이 사라질 때
 *
 * 전송로 풀(`ssh_pool.rs`)의 신호를 프런트로 끌어오는 대신 **이미 있는 `onsession(id, null)`**
 * 에 건다 — `ssh-exit`(끊김·종료)도 타일 닫기도 그 한 길을 지나므로 더 싸다. 그 별칭에 붙은
 * 세션이 이 창에 하나도 남지 않으면 = 공유 전송로도 죽었다고 보고 지운다. 다음 접속이 다시
 * 묻는다(그사이 호스트의 사용자가 바뀌었을 수 있다).
 */

/** 별칭(소문자) → 그 서버의 `$HOME` */
const homes = $state<Record<string, string>>({});
/** 묻는 중인 별칭 → 그 약속 (같은 별칭을 두 번 묻지 않는다) */
const asking: Record<string, Promise<string | null>> = {};
/** 별칭 → 버린 횟수 — 버린 뒤에 도착한 옛 답이 사본을 되살리지 않게 */
const generation: Record<string, number> = {};
/** 타일 id → 그 타일의 별칭(소문자) — 세션을 잃는 순간엔 타일이 이미 트리에 없을 수 있다 */
const aliasOfPane: Record<string, string> = {};

const keyOf = (alias: string) => alias.trim().toLowerCase();

/** 이 타일이 홈을 쓸 **설정의 SSH 타일**이면 그 별칭(소문자) — 빠른 접속 타일은 뺀다 */
function aliasOf(pane: PaneSpec): string | null {
  if (pane.kind !== "ssh" || pane.adhoc || !pane.alias?.trim()) return null;
  return keyOf(pane.alias);
}

/**
 * 그 별칭의 **살아 있는 세션** — SSH 타일 중 세션이 붙어 있는 첫 것(어느 탭이든). 원격 목록과
 * 홈을 물을 때 쓴다 — 무언가를 보려고 새 접속을 열지 않는다.
 */
export function liveSessionFor(alias: string): number | null {
  const want = keyOf(alias);
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (aliasOf(pane) !== want) continue;
      const sid = sessionOf(pane.id);
      if (sid !== null) return sid;
    }
  }
  return null;
}

/**
 * 그 별칭의 **살아 있는 세션을 가진 SSH 타일** — [`liveSessionFor`] 와 같은 판정인데 타일 id 와 그 별칭을 돌려준다(원격 문서가
 * 빌릴 세션의 주인 — 브랜치 그래프의 파일 열기, docs/log/2026-09-29-branch-graph.md). `preferTabId` 의 타일이 먼저다.
 */
export function livePaneFor(alias: string, preferTabId?: string | null): { paneId: string; alias: string } | null {
  const want = keyOf(alias);
  const tabs = [...residentWindowTabs()].sort((a, b) => Number(b.id === preferTabId) - Number(a.id === preferTabId));
  for (const tab of tabs) {
    for (const pane of listPanes(tab.root)) {
      if (aliasOf(pane) !== want || sessionOf(pane.id) === null) continue;
      return { paneId: pane.id, alias: pane.alias ?? alias };
    }
  }
  return null;
}

/** 그 별칭의 `$HOME` — 아직 모르면 `null` (반응형) */
export function remoteHomeOf(alias: string): string | null {
  return homes[keyOf(alias)] ?? null;
}

/**
 * 그 별칭의 `$HOME` 을 (필요하면) 한 번 묻는다 — 붙어 있는 세션이 없거나 서버가 답을 못 하면
 * `null` 이고 오류로 올리지 않는다(부르는 쪽은 글자 비교로 돈다).
 */
export function ensureRemoteHome(alias: string): Promise<string | null> {
  const key = keyOf(alias);
  const known = homes[key];
  if (known) return Promise.resolve(known);
  const inflight = asking[key];
  if (inflight) return inflight;
  const id = liveSessionFor(alias);
  if (id === null) return Promise.resolve(null);
  const gen = generation[key] ?? 0;
  const p = invoke<string>("ssh_remote_home", { id })
    .then((home) => {
      if ((generation[key] ?? 0) !== gen || typeof home !== "string" || home === "") return null;
      homes[key] = home;
      return home;
    })
    .catch(() => null)
    .finally(() => {
      if (asking[key] === p) delete asking[key];
    });
  asking[key] = p;
  return p;
}

/**
 * 타일의 세션이 붙었거나(`sid`) 사라졌다(`null`) — `+page` 의 `onsession` 이 `noteSession`
 * **뒤에** 부른다(사라진 세션이 [`liveSessionFor`] 에 더는 안 잡히게).
 *
 * `pane` 은 붙을 때만 필요하다(사라질 때는 타일이 이미 트리 밖일 수 있어 적어 둔 별칭을 쓴다).
 */
export function remoteSessionChanged(paneId: string, sid: number | null, pane: PaneSpec | null): void {
  if (sid !== null) {
    const alias = pane ? aliasOf(pane) : null;
    if (alias === null) return;
    aliasOfPane[paneId] = alias;
    // `~` 에서 시작한 타일만 — 독 트리의 점이 이 타일을 git 의 절대 경로와 맞대야 한다.
    const cwd = pane?.cwd?.trim() ?? "";
    if (cwd === "~" || cwd.startsWith("~/")) void ensureRemoteHome(alias);
    return;
  }
  const alias = aliasOfPane[paneId];
  if (alias === undefined) return;
  delete aliasOfPane[paneId];
  if (liveSessionFor(alias) !== null) return; // 같은 별칭의 다른 세션이 아직 산다(공유 전송로)
  generation[alias] = (generation[alias] ?? 0) + 1;
  delete homes[alias];
  delete asking[alias];
}
