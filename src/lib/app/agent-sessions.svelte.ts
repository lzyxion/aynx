import { homeDir } from "@tauri-apps/api/path";
import { isRemote } from "$lib/ipc";
import { agentConversationLaunched, agentConversationLinks, agentSessionDelete, agentSessionLaunchSpec, agentSessionRename, agentSessionsList } from "$lib/context";
import {
  buildScopes,
  conversationLinkKey,
  conversationPaletteEntries,
  deleteBlock,
  flatConversations,
  forkCountOf,
  linkSurvivesCliStart,
  localProjects,
  openElsewhere,
  otherWindowStream,
  renameBlock,
  parseConversationLinks,
  registeredCwds,
  resumeAutorunFor,
  resumedConversationOf,
  scopeLabelOf,
  switchesConversation,
  type AgentConversation,
  type AgentLink,
  type ConversationLinkRow,
  type ConversationList,
  type ConversationPaletteEntry,
} from "$lib/agent-sessions";
import { projects } from "$lib/app/project-list.svelte.js";
import { loadWorktrees, worktreesOf } from "$lib/app/worktrees.svelte.js";
import {
  activeTabId,
  focusTile,
  openInNewTab,
  openPaneBeside,
  openPaneInTab,
  replaceTile,
  tabOfPane,
  findPaneAnywhere,
  currentWorkspaceTabs,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";
import { loadUsage, loadUsageSummary, scheduleLimitsRefresh, usageSummary } from "$lib/app/agent-usage.svelte.js";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { settings } from "$lib/settings.svelte.js";
import { conversationTarget, shouldShowStartScreen, type ConversationTarget } from "$lib/project-start";
import { listPanes, newAiPane, newProjectStartPane, type PaneSpec } from "$lib/session";
import { noteFolderOpened } from "$lib/app/recent-worktrees.svelte.js";
import { focusAuxStream } from "$lib/app/workspace-status.svelte.js";
import { sideChatConvMarkOf } from "$lib/app/side-chats.svelte.js";

/**
 * 지난 대화의 저장소 — 목록 한 벌과 타일 ↔ 대화 연결. 연결 표는 이 창의 타일만 안다 — 다른 창은 세션 서버 장부(`agent_conversation_links`)가 말한다.
 * 연결의 수명 = 그 타일의 셸 세션: 사본을 `PaneSpec.agentLink` 에 적어 F5 · 재시작 · 이관을 건너고, 새 세션이 서면 버린다(새 셸은 새 대화다).
 * 띄우며 적은 연결은 autorun 을 쓰기 전에 서버에도 알린다([`announceLaunch`]) — `codex resume` 은 뜨자마자 기록에 한 줄을 붙이는데
 * 장부가 모르면 질문 없이 닫았을 때 2분 동안 "밖에서 열림" 이 된다.
 */

let list = $state<ConversationList | null>(null);
let loading = $state(false);
let failed = $state<string | null>(null);
let home = $state<string | null>(null);
let homeAsked = false;
/** 늦게 온 옛 답이 새 목록을 덮지 않게 */
let seq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const REFRESH_DEBOUNCE_MS = 2000;

/** 못 읽었으면 `null`(옛 서버 — 예전 규칙) */
let convoLinks = $state.raw<Map<string, ConversationLinkRow> | null>(null);
let linksSeq = 0;
let linksTimer: ReturnType<typeof setTimeout> | null = null;
/** 타일 닫기는 창의 연결이 먼저 지고 서버의 놓기가 그 뒤라 그 사이를 넘긴다 */
const LINKS_DEBOUNCE_MS = 800;

/**
 * `pending` = 재개로 연 타일에 미리 적은 것 — 첫 세션 시작이 확정한다(그 뒤의 재시작은 지운다).
 * `launch` = 띄우며 적은 것 — 그 CLI 를 띄우는 셸 명령(OSC 133 `C`)이 지우지 않는다.
 */
const links = $state<Record<string, { agent: string; id: string; pending: boolean; launch: boolean }>>({});

export function conversationList(): ConversationList | null {
  return list;
}

export function conversationsLoading(): boolean {
  return loading;
}

export function conversationsError(): string | null {
  return failed;
}

export function conversationHome(): string | null {
  return home;
}

export function readyWorktrees(projectId: string) {
  const w = worktreesOf(projectId);
  return w?.state === "ok" ? w.list : null;
}

/** 이미 목록이 있으면 새 답이 올 때까지 그대로 둔다 — 비었다 차는 깜박임이 없게 */
export async function loadConversations(): Promise<void> {
  const mine = ++seq;
  loading = true;
  try {
    if (!homeAsked) {
      homeAsked = true;
      home = await homeDir().catch(() => null);
    }
    void loadConversationLinks();
    const locals = localProjects(projects());
    await Promise.all(locals.filter((p) => worktreesOf(p.id) === undefined).map((p) => loadWorktrees(p)));
    const r = await agentSessionsList(registeredCwds(projects(), readyWorktrees));
    if (mine === seq) {
      list = r;
      failed = null;
      // 토큰은 목록 뒤에 따로 — 첫 읽기는 파일 전체라 목록을 막지 않게(docs/log/2026-09-26-agent-usage.md)
      void loadUsage();
    }
  } catch (e) {
    if (mine === seq) failed = stripReason(String(e));
  } finally {
    if (mine === seq) loading = false;
  }
}

export async function loadConversationLinks(): Promise<void> {
  const mine = ++linksSeq;
  try {
    const v = await agentConversationLinks();
    if (mine === linksSeq) convoLinks = parseConversationLinks(v);
  } catch {
    if (mine === linksSeq) convoLinks = null;
  }
}

function scheduleLinksRefresh(): void {
  if (list === null) return;
  if (linksTimer !== null) clearTimeout(linksTimer);
  linksTimer = setTimeout(() => {
    linksTimer = null;
    void loadConversationLinks();
  }, LINKS_DEBOUNCE_MS);
}

/** 폴링하지 않는다 — 다른 창의 타일 닫기는 신호가 없어 다음 목록 읽기에 드러난다 */
export function noteConversationSignal(payload: { event?: unknown; stream?: unknown; session?: unknown; cli?: unknown }): void {
  if (list === null || typeof payload.stream !== "string") return;
  if (payload.event === "session-end") {
    scheduleLinksRefresh();
    return;
  }
  if (typeof payload.session !== "string" || payload.session === "" || typeof payload.cli !== "string") return;
  const row = convoLinks?.get(conversationLinkKey(payload.cli, payload.session));
  if (!row || !row.streams.includes(payload.stream)) scheduleLinksRefresh();
}

/** 이미 읽었어도 다시 읽는다 — "밖에서 열림" 이 낡으면 밖에서 도는 대화를 팔레트가 곧장 재개한다 */
export function ensureConversations(): void {
  if (!loading) void loadConversations();
}

export async function renameConversation(s: AgentConversation, name: string): Promise<void> {
  try {
    await agentSessionRename(s.agent, s.id, name);
  } catch (e) {
    throw new Error(stripReason(String(e)));
  }
  await loadConversations();
}

let deleting = $state.raw<ReadonlySet<string>>(new Set());

const convKey = (s: Pick<AgentConversation, "agent" | "id">) => `${s.agent}:${s.id.toLowerCase()}`;

export function conversationDeleting(s: Pick<AgentConversation, "agent" | "id">): boolean {
  return deleting.has(convKey(s));
}

export function conversationForkCount(s: Pick<AgentConversation, "agent" | "id">): number {
  return forkCountOf(flatConversations(list), s);
}

export function deleteBlockedReason(
  s: Pick<AgentConversation, "agent" | "id">,
  where: { open: boolean; elsewhere: boolean },
): string | null {
  if (conversationDeleting(s)) return t("board.convo.delete.deleting");
  const forks = conversationForkCount(s);
  const sideChat = sideChatConvMarkOf(s.agent, s.id) !== null;
  switch (deleteBlock({ ...where, sideChat, forks })) {
    case "open":
      return t(linkedTile(s.agent, s.id) ? "board.convo.delete.blocked.open" : "board.convo.delete.blocked.openOther");
    case "side-chat":
      return t("board.convo.delete.blocked.sideChat");
    case "elsewhere":
      return t("board.convo.delete.blocked.elsewhere");
    case "forks":
      return t("board.convo.delete.blocked.forks", { n: forks });
    default:
      return null;
  }
}

export function renameBlockedReason(
  s: Pick<AgentConversation, "agent" | "id">,
  where: { open: boolean; elsewhere: boolean },
): string | null {
  switch (renameBlock({ remote: false, ...where })) {
    case "open":
      return t(linkedTile(s.agent, s.id) ? "board.convo.rename.blocked.open" : "board.convo.rename.blocked.openOther");
    case "elsewhere":
      return t("board.convo.rename.blocked.elsewhere");
    default:
      return null;
  }
}

/** 그 CLI 의 기록에서 영구히 지운다 — 줄은 다시 읽기가 끝날 때까지 제자리에서 흐리다(칸이 뛰지 않게) */
export async function deleteConversation(s: AgentConversation): Promise<void> {
  const key = convKey(s);
  if (deleting.has(key)) return;
  const agent = aiDisplayName(s.agent) ?? s.agent;
  let go = false;
  try {
    go = await askConfirm(t("board.convo.delete.confirm", { title: s.title, agent }), {
      title: t("board.convo.delete.title"),
      kind: "warning",
      okLabel: t("board.convo.delete.ok"),
      danger: true,
    });
  } catch {
    return; // 상자를 띄우지 못하면 지우지 않는다
  }
  if (!go) return;
  deleting = new Set([...deleting, key]);
  try {
    await agentSessionDelete(s.agent, s.id);
    toast.success(t("board.convo.delete.done", { title: s.title }));
    await loadConversations();
    if (usageSummary() !== null) void loadUsageSummary();
  } catch (e) {
    showNotice(t("board.convo.delete.failed", { e: stripReason(String(e)) }));
  } finally {
    const next = new Set(deleting);
    next.delete(key);
    deleting = next;
  }
}

/**
 * 확인 상자는 부르는 쪽이 이미 띄웠다. 막 닫힌 CLI 가 아직 파일을 쥐었거나 서버 장부에 놓임이 아직 안 적혔으면 Rust 가 거절하므로
 * 잠깐 뒤에 다시 해 본다(서버는 프로세스가 끝날 때 놓인 시각을 적는다 — `agent_state::note_released`).
 */
export async function deleteSideChatConversations(convs: readonly { agent: string; id: string }[]): Promise<void> {
  if (convs.length === 0) return;
  await loadConversations();
  const rows = flatConversations(list);
  try {
    for (const c of convs) {
      const row = rows.find((r) => r.agent === c.agent && r.id.toLowerCase() === c.id.toLowerCase());
      if (!row) continue;
      const forks = conversationForkCount(row);
      if (forks > 0) throw new Error(t("board.convo.delete.blocked.forks", { n: forks }));
      const key = convKey(row);
      deleting = new Set([...deleting, key]);
      try {
        let err: unknown = null;
        for (const wait of [0, 1500, 4000]) {
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          try {
            await agentSessionDelete(row.agent, row.id);
            err = null;
            break;
          } catch (e) {
            err = e;
          }
        }
        if (err !== null) throw err;
      } finally {
        const next = new Set(deleting);
        next.delete(key);
        deleting = next;
      }
    }
  } finally {
    await loadConversations();
    if (usageSummary() !== null) void loadUsageSummary();
  }
}

export function scheduleConversationRefresh(): void {
  scheduleLimitsRefresh();
  if (list === null) return;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadConversations();
  }, REFRESH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 타일 ↔ 대화
// ---------------------------------------------------------------------------

/** 같은 값이면 쓰지 않는다 — 배치 저장이 헛돌지 않게 */
function persistLink(paneId: string, l: AgentLink | null): void {
  const p = findPaneAnywhere(paneId);
  if (!p || (p.kind !== "local" && p.kind !== "ssh")) return;
  if (l === null) {
    if (p.agentLink) delete p.agentLink;
    return;
  }
  if (p.agentLink && p.agentLink.agent === l.agent && p.agentLink.id === l.id) return;
  p.agentLink = { agent: l.agent, id: l.id };
}

function setLink(paneId: string, agent: string, id: string, pending: boolean, launch = false): void {
  const l = { agent, id: id.toLowerCase(), pending, launch };
  links[paneId] = l;
  persistLink(paneId, l);
  if (!pending) persistResumeAutorun(paneId, agent, id);
  scheduleLinksRefresh();
}

/**
 * 줄은 [`resumeAutorunFor`] 가 고정 낱말 · UUID 모양 id · 그 autorun 의 추가 인자로만 짓는다(AI 문자열 → PTY 길 없음 — 전문 4).
 * 원격 창(폰)은 메인 PC 의 명세를 고치지 않는다 · 이관된 타일은 저장되는 재시작 명세(`restart`)가 그 자리다.
 */
function persistResumeAutorun(paneId: string, agent: string, id: string): void {
  if (isRemote) return;
  const p = findPaneAnywhere(paneId);
  if (!p || p.kind !== "local") return;
  const holder = p.restart ?? p;
  const next = resumeAutorunFor(holder.autorun, agent, id);
  if (next !== null) holder.autorun = next;
}

function dropLink(paneId: string): void {
  // 원격 창에서는 연결의 주인이 메인 PC 거울이다 — 거울에는 "재개로 띄운 것" 표시가 없어 제 셸 사건으로 지우면 막 받은 연결이 사라진다
  if (isRemote) return;
  const had = paneId in links;
  delete links[paneId];
  persistLink(paneId, null);
  if (had) scheduleLinksRefresh();
}

/** 세션을 열기 전에 부른다 — 새 세션이 서면 [`agentSessionRestarted`] 가 버린다 */
export function seedAgentLink(pane: PaneSpec): void {
  if (pane.id in links || !pane.agentLink) return;
  links[pane.id] = { agent: pane.agentLink.agent, id: pane.agentLink.id.toLowerCase(), pending: false, launch: false };
  persistResumeAutorun(pane.id, pane.agentLink.agent, pane.agentLink.id);
}

/** 원격 창은 떼어 둔 동안 신호를 놓친다 — 연결의 주인은 신호를 놓치지 않는 메인 PC 다 */
export function mirrorAgentLink(paneId: string, link: AgentLink | undefined): void {
  const cur = links[paneId];
  if (!link || typeof link.agent !== "string" || typeof link.id !== "string" || link.id === "") {
    if (cur) delete links[paneId];
    return;
  }
  const id = link.id.toLowerCase();
  if (cur && cur.agent === link.agent && cur.id === id) return;
  links[paneId] = { agent: link.agent, id, pending: false, launch: false };
}

export function linkAgentSession(paneId: string, agent: string, id: string): void {
  const cur = links[paneId];
  if (cur && !cur.pending && !cur.launch && cur.agent === agent && cur.id === id.toLowerCase()) return;
  setLink(paneId, agent, id, false);
}

/** 링 재생에서는 부르지 않는다 — 실시간 OSC 133 `C` 만 */
export function agentCliStarted(paneId: string): void {
  if (!linkSurvivesCliStart(links[paneId])) dropLink(paneId);
}

export function agentPromptSent(paneId: string, text: string): boolean {
  const l = links[paneId];
  if (!l || !switchesConversation(l.agent, text)) return false;
  dropLink(paneId);
  return true;
}

export function agentSessionRestarted(paneId: string): void {
  const l = links[paneId];
  if (!l) return;
  if (l.pending) l.pending = false;
  else dropLink(paneId);
}

export function unlinkAgentSession(paneId: string): void {
  dropLink(paneId);
}

export function agentLinkOf(paneId: string): AgentLink | null {
  const l = links[paneId];
  return l ? { agent: l.agent, id: l.id } : null;
}

/** 타일이 마운트되기 전에 부른다 — 이관 타일은 산 세션에 다시 붙어 세션 시작 신호가 없으므로 확정된 연결로 적는다 */
export function adoptAgentLink(paneId: string, link: AgentLink): void {
  setLink(paneId, link.agent, link.id, false);
}

/** 첫 세션에만 온다 — 재연결 · 재시작한 세션은 autorun 을 다시 돌리지 않는다 */
export function linkResumedAutorun(paneId: string, autorun: string | null | undefined): Promise<void> {
  const r = resumedConversationOf(autorun);
  if (!r) return Promise.resolve();
  setLink(paneId, r.agent, r.id, false, true);
  return announceLaunch(paneId, r.agent, r.id);
}

/** 던지지 않는다 — 실패(옛 서버 · 산 신호 토큰 없음)면 그 타일은 예전 규칙 */
function announceLaunch(paneId: string, agent: string, id: string): Promise<void> {
  const p = findPaneAnywhere(paneId);
  if (!p) return Promise.resolve();
  return agentConversationLaunched(p.historyStreamId ?? p.id, agent, id).then(
    () => {},
    () => {},
  );
}

export function linkOpenedConversation(paneId: string, agent: string, id: string): void {
  setLink(paneId, agent, id, true, true);
}

export function agentSessionOf(paneId: string): string | null {
  return links[paneId]?.id ?? null;
}

export function linkedTile(agent: string, id: string): { tabId: string; paneId: string } | null {
  const want = id.toLowerCase();
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      const l = links[pane.id];
      if (l && l.agent === agent && l.id === want) return { tabId: tab.id, paneId: pane.id };
    }
  }
  return null;
}

/** `AYNX_STREAM` = `historyStreamId ?? id` */
function isThisWindowStream(stream: string): boolean {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) if ((pane.historyStreamId ?? pane.id) === stream) return true;
  }
  return false;
}

export function conversationOpenOtherWindow(s: Pick<AgentConversation, "agent" | "id">): string | null {
  if (linkedTile(s.agent, s.id)) return null;
  return otherWindowStream(convoLinks?.get(conversationLinkKey(s.agent, s.id)), isThisWindowStream);
}

export function conversationOpen(s: Pick<AgentConversation, "agent" | "id">): boolean {
  return linkedTile(s.agent, s.id) !== null || conversationOpenOtherWindow(s) !== null;
}

export function goToOpenConversation(s: Pick<AgentConversation, "agent" | "id">): boolean {
  const at = linkedTile(s.agent, s.id);
  if (at) {
    focusTile(at.tabId, at.paneId);
    return true;
  }
  const stream = conversationOpenOtherWindow(s);
  if (stream === null) return false;
  if (!focusAuxStream(stream)) showNotice(t("board.convo.openOther.notice"));
  return true;
}

function releasedAtOf(agent: string, id: string): number | null {
  return convoLinks?.get(conversationLinkKey(agent, id))?.releasedAt ?? null;
}

export type ConversationPlace = "replace" | "beside" | "tab";

/**
 * 남의 탭에는 끼우지 않는다 — 끼우는 탭은 그 워크트리의 탭뿐이다(지금 탭에 자동 분할하면 타일이 많은 탭에서 너무 작아진다 · 사용자 결정).
 * 탭 제목에 대화 제목을 쓰지 않는다 — 탭 제목은 `workspaces.json` 에 저장되고 첫 프롬프트일 수 있는 제목은 화면에만 둔다.
 */
export async function openConversation(
  s: AgentConversation,
  mode: "resume" | "fork",
  at?: { tabId: string; paneId: string },
  how: ConversationPlace = "replace",
  into?: string,
): Promise<void> {
  if (mode === "resume" && goToOpenConversation(s)) return;
  let spec;
  try {
    spec = await agentSessionLaunchSpec(s.agent, s.id, mode, into);
  } catch (e) {
    showNotice(stripReason(String(e)));
    return;
  }
  const pane = newAiPane(spec.command, spec.cwd);
  // 첫 훅 신호 전에도 "열림" 이 서야 두 번 열리지 않는다
  if (mode === "resume") links[pane.id] = { agent: s.agent, id: s.id.toLowerCase(), pending: true, launch: true };
  // 가져와 계속이면 원래 폴더가 아니라 새 타일이 서는 폴더
  const label = scopeLabelOf({ ...s, cwd: spec.cwd }, buildScopes(projects(), readyWorktrees, list, home).rows);
  // 폰은 타일 하나만 그려서 옆에 끼우면 새 타일이 보이지 않는다
  if (how === "tab") {
    openInNewTab(pane, label);
    noteFolderOpened(null, spec.cwd);
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    return;
  }
  if (at && how === "beside" && openPaneBeside(at.tabId, at.paneId, pane)) {
    noteFolderOpened(null, spec.cwd);
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    glowTile(pane.id, "ok");
    return;
  }
  // 자리는 명세를 받은 뒤에 고른다 — 그 사이 탭이 닫히거나 바뀌었을 수 있다
  const target: ConversationTarget = at && how === "replace"
    ? { kind: "replace", reason: "startScreen", tabId: at.tabId, paneId: at.paneId }
    : conversationTarget(currentWorkspaceTabs(), activeTabId(), spec.cwd);
  placeConversationPane(pane, target, label);
  noteFolderOpened(null, spec.cwd);
  const tab = tabOfPane(pane.id);
  if (tab) focusTile(tab.id, pane.id);
}

function placeConversationPane(pane: PaneSpec, target: ConversationTarget, label: string): void {
  if (target.kind === "tab") openPaneInTab(target.tabId, pane);
  else if (target.kind === "replace") {
    if (!replaceTile(target.tabId, target.paneId, pane, target.reason === "launcher" ? label : undefined)) {
      openInNewTab(pane, label);
    }
  } else openInNewTab(pane, label);
}

// ---------------------------------------------------------------------------
// 프로젝트 시작 화면
// ---------------------------------------------------------------------------

/** 목록을 기다리지 않는다 — 화면이 뜨는 순간 스스로 읽는다 */
export async function projectStartPaneFor(projectId: string, folder: string, host?: string | null): Promise<PaneSpec | null> {
  return shouldShowStartScreen(settings.projectStartScreen) ? newProjectStartPane(projectId, folder, host) : null;
}

// ---------------------------------------------------------------------------
// 팔레트
// ---------------------------------------------------------------------------

export function paletteConversations(): ConversationPaletteEntry[] {
  const rows = buildScopes(projects(), readyWorktrees, list, home).rows;
  return conversationPaletteEntries(list, rows, (agent, id) => conversationOpen({ agent, id }), Date.now(), releasedAtOf);
}

/**
 * 밖에서 열린 대화의 재개는 곧장 띄우지 않고 `elsewhere` 로 넘긴다 — 포크는 원본을 건드리지 않아 그대로 연다.
 * 기록 시트를 여기서 직접 부르지 않는다 — `conversation-viewer` 가 이 모듈을 읽어 순환이 된다.
 */
export function openConversationById(
  agent: string,
  id: string,
  fork: boolean,
  elsewhere: (agent: string, id: string) => void,
): void {
  const s = flatConversations(list).find((c) => c.agent === agent && c.id === id);
  if (!s) return;
  if (!fork && conversationOpenElsewhere(s, Date.now())) {
    elsewhere(s.agent, s.id);
    return;
  }
  void openConversation(s, fork ? "fork" : "resume");
}

export function conversationOpenElsewhere(s: AgentConversation, now: number): boolean {
  return openElsewhere(s, now, conversationOpen(s), releasedAtOf(s.agent, s.id));
}

