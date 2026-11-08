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
 * **원격 지난 대화의 저장소** — 별칭마다 한 벌(docs/log/2026-09-27-remote-conversations.md). 규칙은 순수 층
 * `$lib/remote-conversations`, 읽기는 Rust `agent_sessions_remote.rs`, 그림은 `ProjectStart`(원격 프로젝트의 시작 화면)와
 * `FolderConversations`(SSH 타일에서 부른 이 폴더의 지난 대화).
 *
 * ## 새 접속을 열지 않는다
 *
 * 읽기는 **그 별칭에 이미 붙어 있는 타일 세션**([`liveSessionFor`] — 이 창의 SSH 타일)으로만 한다. 없으면 `offline` 으로
 * 적고 읽지 않는다 — 시작 화면은 그 별칭의 세션이 서는 순간(다른 타일이 붙거나 사람이 여기서 셸을 열어) 스스로 다시 부른다.
 *
 * ## 언제 읽나
 *
 * 화면이 열릴 때만([`ensureRemoteConversations`]) — 1분 안에 다 읽었으면 다시 읽지 않는다(Rust 도 목록을 1분 쓴다).
 * 고르는 목록의 F5 는 캐시를 건너뛴다([`loadRemoteConversations`] `force`). 백그라운드로 서버를 훑지 않는다. 한 번 부르면
 * Rust 가 몇 초만 읽고 돌려주므로(`complete=false`), 다 읽을 때까지 이어 부르며 진행("12 / 31")을 올린다.
 *
 * 대화 본문은 여기 오지 않는다 — 제목까지(로컬과 같은 출처 · 같은 규칙), 저장 · 로그 · MCP 어디에도 싣지 않는다. 앱을 끄면
 * 사라진다(메모리).
 */

const hosts = $state<Record<string, RemoteHostState>>({});
/** 별칭의 보이는 글자(열쇠는 소문자) — 대시보드의 호스트 칩이 쓴다 */
const names = $state<Record<string, string>>({});
/** 별칭마다 부른 순번 — 늦게 온 옛 답이 새 상태를 덮지 않게 */
const seqs: Record<string, number> = {};
/** 한 번 여는 동안 이어 부르는 횟수의 상한 — Rust 가 늘 나아가지만 끝없는 고리는 막는다 */
const MAX_ROUNDS = 200;

const keyOf = (alias: string) => alias.trim().toLowerCase();

/** 그 별칭의 상태 — 반응형(아직 없으면 빈 상태) */
export function remoteConversations(alias: string): RemoteHostState {
  return hosts[keyOf(alias)] ?? emptyRemoteHost();
}

function patch(alias: string, next: Partial<RemoteHostState>): void {
  const k = keyOf(alias);
  hosts[k] = { ...(hosts[k] ?? emptyRemoteHost()), ...next };
}

/**
 * (다시) 읽는다 — 그 별칭의 살아 있는 타일 세션이 없으면 `offline` 만 적는다. `force` = 1분 캐시를 건너뛴다(F5). 이미 있는
 * 줄은 새 답이 올 때까지 그대로 둔다(깜박임 없이).
 */
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

/** 화면이 열린다 — 읽는 중이 아니고 1분 안에 다 읽은 것이 아니면 읽는다 */
export function ensureRemoteConversations(alias: string): void {
  const h = remoteConversations(alias);
  if (h.loading) return;
  if (remoteFresh(h, Date.now()) && liveSessionFor(alias) !== null) return;
  void loadRemoteConversations(alias);
}

/**
 * **원격 대화 재개 · 새 대화로 계속** — 재개할 대화가 이미 이 창의 타일에 열려 있으면 그 타일로 가기만 한다(로컬과 같은
 * 규칙). 아니면 Rust 가 캐시에서 지은 폴더 · 명령으로 **그 별칭의 새 SSH 타일**을 연다 — 같은 별칭이라 공유 전송로에
 * 얹혀 추가 인증이 없다. 명령은 원격 프로젝트가 명령을 돌리는 그 길(첫 입력 한 줄)로 돈다 — AI 문자열이 PTY 로 가는 새
 * 통로는 없다.
 *
 * 자리: `beside` = 부른 타일 옆에 분할(이 폴더의 지난 대화 — 새 타일이 한 번 빛난다) · `replace` = 그 타일 자리(원격 프로젝트의
 * 시작 화면) · `tab` = 새 탭(폰). 그 타일이 그 사이 사라졌으면 새 탭.
 */
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
    // 폰(원격 웹 R5 · 10-20) — 그 타일 하나뿐인 새 탭(옆에 끼우면 폰에서 보이지 않는다)
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

/**
 * 대화를 읽어 본 호스트들 — 대시보드의 "어디서" 칩(docs/log/2026-09-27-remote-conversations.md "2단계"). 반응형. 한 번도
 * 읽지 않은 호스트(`rows === null`)도 들지만 칩은 읽은 것만 선다(`$lib/dashboard-source`).
 */
export function remoteHostList(): { alias: string; state: RemoteHostState }[] {
  return Object.keys(hosts).map((k) => ({ alias: names[k] ?? k, state: hosts[k] }));
}

// ---------------------------------------------------------------------------
// 전체 사용량 읽기 — 사람이 누를 때만 (2단계)
// ---------------------------------------------------------------------------

const usageReads = $state<Record<string, RemoteUsageRead>>({});
const usageSeqs: Record<string, number> = {};

/** 그 별칭의 전체 읽기 상태 — 반응형(누른 적 없으면 `null`) */
export function remoteUsageRead(alias: string): RemoteUsageRead | null {
  return usageReads[keyOf(alias)] ?? null;
}

/**
 * **전체 사용량 읽기** — 그 별칭에 붙은 이 창의 SSH 타일 세션으로(새 접속 없음) 큰 대화 파일을 끝까지 센다. Rust 가 몇 초씩
 * 끊어 읽고 진행을 돌려주면 다 셀 때까지 이어 부르고, 한 번 부를 때마다 `onProgress`(사용량 요약 다시 읽기)를 부른다.
 * 붙은 세션이 없으면 아무것도 하지 않는다(단추가 서지 않는 자리다).
 */
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

/** 전체 읽기를 멈춘다 — 다음 부름을 하지 않는다(이미 간 한 번은 몇 초 안에 끝난다). 센 데까지는 남는다 */
export function stopRemoteUsageRead(alias: string): void {
  const k = keyOf(alias);
  usageSeqs[k] = (usageSeqs[k] ?? 0) + 1;
  const cur = usageReads[k];
  if (cur) usageReads[k] = { ...cur, running: false };
}
