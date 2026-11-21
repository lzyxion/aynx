import { invoke } from "../ipc";
import { listPanes, type PaneSpec } from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";

/**
 * 원격 `$HOME` 사본 — 별칭마다 한 번 묻고, 그 별칭의 마지막 세션이 이 창에서 사라지면 버린다(다음 접속이 다시 묻는다 —
 * 그사이 호스트의 사용자가 바뀌었을 수 있다). 시계로 다시 묻지 않는다(docs/log/2026-09-24-worktrees.md).
 */

const homes = $state<Record<string, string>>({});
const asking: Record<string, Promise<string | null>> = {};
/** 버린 뒤에 도착한 옛 답이 사본을 되살리지 않게 */
const generation: Record<string, number> = {};
/** 세션을 잃는 순간엔 타일이 이미 트리에 없을 수 있다 */
const aliasOfPane: Record<string, string> = {};

const keyOf = (alias: string) => alias.trim().toLowerCase();

function aliasOf(pane: PaneSpec): string | null {
  if (pane.kind !== "ssh" || pane.adhoc || !pane.alias?.trim()) return null;
  return keyOf(pane.alias);
}

/** 무언가를 보려고 새 접속을 열지 않는다 — 이미 붙은 세션만 */
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

export function remoteHomeOf(alias: string): string | null {
  return homes[keyOf(alias)] ?? null;
}

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

/** `noteSession` 뒤에 부른다 — 사라진 세션이 [`liveSessionFor`] 에 더는 안 잡히게 */
export function remoteSessionChanged(paneId: string, sid: number | null, pane: PaneSpec | null): void {
  if (sid !== null) {
    const alias = pane ? aliasOf(pane) : null;
    if (alias === null) return;
    aliasOfPane[paneId] = alias;
    // `~` 에서 시작한 타일만 — 프로젝트를 안 쓰는 접속은 왕복이 늘지 않는다
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
