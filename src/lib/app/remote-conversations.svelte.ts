import { agentSessionRemoteLaunchSpec, agentSessionsRemoteList, agentUsageRemoteRead } from "$lib/context";
import { linkedTile, linkOpenedConversation } from "$lib/app/agent-sessions.svelte.js";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { lookupHost } from "$lib/app/hosts.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import { projects } from "$lib/app/project-list.svelte.js";
import { focusTile, openInNewTab, openPaneBeside, replaceTile, tabOfPane } from "$lib/app/tabs.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";
import { showNotice } from "$lib/app/notice";
import { stripReason } from "$lib/error-reason";
import { projectTail } from "$lib/projects";
import { noteFolderOpened } from "$lib/app/recent-worktrees.svelte.js";
import type { RemoteUsageRead } from "$lib/dashboard-source";
import {
  applyReply,
  emptyRemoteHost,
  remoteConversationPane,
  remoteFresh,
  remoteProjectFor,
  type RemoteConversation,
  type RemoteHostState,
} from "$lib/remote-conversations";

/**
 * 원격 지난 대화의 저장소 — 별칭마다 한 벌(docs/log/2026-09-27-remote-conversations.md).
 * 새 접속을 열지 않는다 — 그 별칭에 이미 붙은 타일 세션으로만 읽는다. 백그라운드로 서버를 훑지 않는다.
 * 대화 본문은 여기 오지 않는다 — 제목까지, 저장 · 로그 · MCP 어디에도 싣지 않는다.
 */

const hosts = $state<Record<string, RemoteHostState>>({});
/** 별칭의 보이는 글자(열쇠는 소문자) */
const names = $state<Record<string, string>>({});
/** 늦게 온 옛 답이 새 상태를 덮지 않게 */
const seqs: Record<string, number> = {};
/** Rust 가 늘 나아가지만 끝없는 고리는 막는다 */
const MAX_ROUNDS = 200;

const keyOf = (alias: string) => alias.trim().toLowerCase();

export function remoteConversations(alias: string): RemoteHostState {
  return hosts[keyOf(alias)] ?? emptyRemoteHost();
}

function patch(alias: string, next: Partial<RemoteHostState>): void {
  const k = keyOf(alias);
  hosts[k] = { ...(hosts[k] ?? emptyRemoteHost()), ...next };
}

/** `force` = 1분 캐시를 건너뛴다(F5) */
export async function loadRemoteConversations(alias: string, force = false): Promise<void> {
  const k = keyOf(alias);
  if (names[k] === undefined) names[k] = alias.trim();
  const mine = (seqs[k] = (seqs[k] ?? 0) + 1);
  const sid = liveSessionFor(alias);
  if (sid === null) {
    patch(alias, { offline: true, loading: false, progress: null });
    return;
  }
  patch(alias, { loading: true, offline: false, error: null });
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await agentSessionsRemoteList(sid, force && round === 0);
      if (seqs[k] !== mine) return;
      hosts[k] = applyReply(hosts[k] ?? emptyRemoteHost(), r);
      if (r.complete) break;
    }
  } catch (e) {
    if (seqs[k] === mine) patch(alias, { error: stripReason(String(e)), progress: null });
  } finally {
    if (seqs[k] === mine) patch(alias, { loading: false });
  }
}

export function ensureRemoteConversations(alias: string): void {
  const h = remoteConversations(alias);
  if (h.loading) return;
  if (remoteFresh(h, Date.now()) && liveSessionFor(alias) !== null) return;
  void loadRemoteConversations(alias);
}

/** 명령은 Rust 가 캐시에서 지은 것이고 원격 프로젝트의 첫 입력 한 줄 길로 돈다 — AI 문자열이 PTY 로 가는 새 통로는 없다 */
export async function openRemoteConversation(
  s: RemoteConversation,
  mode: "resume" | "fork",
  at?: { tabId: string; paneId: string },
  how: "replace" | "beside" | "tab" = "beside",
): Promise<void> {
  if (mode === "resume") {
    const open = linkedTile(s.agent, s.id);
    if (open) {
      focusTile(open.tabId, open.paneId);
      return;
    }
  }
  let spec;
  try {
    spec = await agentSessionRemoteLaunchSpec(s.host, s.agent, s.id, mode);
  } catch (e) {
    showNotice(stripReason(String(e)));
    return;
  }
  const host = lookupHost(s.host);
  if (host) rememberTarget(host);
  const home = remoteConversations(s.host).home;
  const pane = remoteConversationPane(
    s.host,
    spec,
    remoteProjectFor(projects(), s.host, spec.cwd, home),
    host?.meta?.scrollback,
  );
  if (mode === "resume") linkOpenedConversation(pane.id, s.agent, s.id);
  noteFolderOpened(s.host, spec.cwd);
  if (how === "tab") {
    // 폰 — 옆에 끼우면 폰에서 보이지 않는다
    openInNewTab(pane, `${s.host} · ${projectTail(spec.cwd)}`);
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    return;
  }
  if (at && how === "beside" && openPaneBeside(at.tabId, at.paneId, pane)) {
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    glowTile(pane.id, "ok");
    return;
  }
  if (!(at && how === "replace" && replaceTile(at.tabId, at.paneId, pane))) {
    openInNewTab(pane, `${s.host} · ${projectTail(spec.cwd)}`);
  }
  const tab = tabOfPane(pane.id);
  if (tab) focusTile(tab.id, pane.id);
}

/** 한 번도 읽지 않은 호스트(`rows === null`)도 든다 */
export function remoteHostList(): { alias: string; state: RemoteHostState }[] {
  return Object.keys(hosts).map((k) => ({ alias: names[k] ?? k, state: hosts[k] }));
}

// ── 전체 사용량 읽기 — 사람이 누를 때만 ──

const usageReads = $state<Record<string, RemoteUsageRead>>({});
const usageSeqs: Record<string, number> = {};

export function remoteUsageRead(alias: string): RemoteUsageRead | null {
  return usageReads[keyOf(alias)] ?? null;
}

export async function readRemoteUsageFully(alias: string, onProgress?: () => void): Promise<void> {
  const k = keyOf(alias);
  const sid = liveSessionFor(alias);
  if (sid === null) return;
  const mine = (usageSeqs[k] = (usageSeqs[k] ?? 0) + 1);
  const prev = usageReads[k];
  usageReads[k] = {
    running: true,
    doneBytes: prev?.doneBytes ?? 0,
    totalBytes: prev?.totalBytes ?? 0,
    pending: prev?.pending ?? 0,
    complete: false,
    error: null,
  };
  try {
    for (let round = 0; round < MAX_ROUNDS * 10; round++) {
      const r = await agentUsageRemoteRead(sid);
      if (usageSeqs[k] !== mine) return;
      usageReads[k] = { running: !r.complete, doneBytes: r.doneBytes, totalBytes: r.totalBytes, pending: r.pending, complete: r.complete, error: null };
      onProgress?.();
      if (r.complete) break;
    }
  } catch (e) {
    if (usageSeqs[k] === mine) usageReads[k] = { ...usageReads[k], running: false, error: stripReason(String(e)) };
  } finally {
    if (usageSeqs[k] === mine && usageReads[k]?.running) usageReads[k] = { ...usageReads[k], running: false };
  }
}

/** 다음 부름을 하지 않을 뿐이다 — 이미 간 한 번은 몇 초 안에 끝난다 */
export function stopRemoteUsageRead(alias: string): void {
  const k = keyOf(alias);
  usageSeqs[k] = (usageSeqs[k] ?? 0) + 1;
  const cur = usageReads[k];
  if (cur) usageReads[k] = { ...cur, running: false };
}
