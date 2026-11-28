import { tick } from "svelte";
import {
  conversationList,
  ensureConversations,
  openConversation,
  openConversationInChat,
  readyWorktrees,
} from "$lib/app/agent-sessions.svelte.js";
import { viewConversation } from "$lib/app/conversation-viewer.svelte.js";
import {
  ensureRemoteConversations,
  loadRemoteConversations,
  openRemoteConversation,
} from "$lib/app/remote-conversations.svelte.js";
import { isRemoteConversation, sshScopeFolder } from "$lib/remote-conversations";
import { forgetFocusOrigin, rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { projects } from "$lib/app/project-list.svelte.js";
import { activeTab, paneOf, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import type { AgentConversation } from "$lib/agent-sessions";
import {
  folderLists,
  resolveFolderContext,
  scopeChips,
  type FolderContext,
  type FolderInput,
  type FolderLists,
} from "$lib/folder-conversations";
import { wslCwdToWindows } from "$lib/shell-integration";
import { findPane, listPanes, type PaneSpec, type TabSpec } from "$lib/session";

/**
 * 이 폴더의 지난 대화 — 저장소 (docs/log/2026-09-27-folder-conversations.md).
 * 대화 본문은 여기 오지 않는다 — 목록의 제목까지만, 저장 · 로그 · MCP 어디에도 싣지 않는다.
 */

const FOCUS_KEY = "folder-conversations";

// ---------------------------------------------------------------------------
// 기준 폴더
// ---------------------------------------------------------------------------

/** SSH 등은 `null` — 원격 폴더의 대화는 이 PC 에 없다 */
function paneFolder(pane: PaneSpec): string | null {
  if (pane.kind === "local") {
    const reported = reportedCwd(pane.id)?.trim();
    if (reported) {
      const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
      if (distro && reported.startsWith("/")) return wslCwdToWindows(distro, reported);
      return reported;
    }
    return pane.cwd?.trim() || null;
  }
  if (pane.kind === "start" && pane.startProject && !pane.startProject.host) return pane.startProject.folder;
  if (pane.kind === "chat") return pane.chat?.cwd?.trim() || null;
  return null;
}

/** 빠른 접속 타일은 별칭이 설정의 것이 아니라 뺀다 (docs/log/2026-09-27-remote-conversations.md) */
export interface RemotePickerContext {
  alias: string;
  folder: string | null;
  source: "tile" | "start" | "none";
}

function remoteOf(tab: TabSpec | null, paneId: string | null): RemotePickerContext | null {
  const pane = tab && paneId ? findPane(tab.root, paneId) : null;
  if (!pane) return null;
  if (pane.kind === "ssh" && !pane.adhoc && pane.alias?.trim()) {
    return { alias: pane.alias.trim(), ...sshScopeFolder(reportedCwd(pane.id), pane.cwd) };
  }
  if (pane.kind === "start" && pane.startProject?.host) {
    return { alias: pane.startProject.host, folder: pane.startProject.folder, source: "start" };
  }
  return null;
}

export function pickerRemote(): RemotePickerContext | null {
  const tab = anchor ? (residentWindowTabs().find((x) => x.id === anchor?.tabId) ?? null) : null;
  return remoteOf(tab, anchor?.paneId ?? null);
}

function inputOf(tab: TabSpec | null, paneId: string | null): FolderInput {
  if (!tab) return { focused: null, tabFolders: [] };
  const pane = paneId ? findPane(tab.root, paneId) : null;
  const tabFolders = listPanes(tab.root)
    .filter((p) => p.id !== paneId)
    .map(paneFolder)
    .filter((f): f is string => f !== null);
  return { focused: pane ? paneFolder(pane) : null, tabFolders };
}

function contextFor(tabId: string | null, paneId: string | null): FolderContext {
  const tab = tabId ? (residentWindowTabs().find((t) => t.id === tabId) ?? null) : null;
  return resolveFolderContext(inputOf(tab, paneId), projects(), readyWorktrees);
}

// ---------------------------------------------------------------------------
// 고르는 목록
// ---------------------------------------------------------------------------

let anchor = $state<{ tabId: string; paneId: string } | null>(null);
let open = $state(false);
/** 고른 대화를 새 탭에 연다(폰) — 아니면 연 타일 옆에 분할 */
let inNewTab = false;

export function folderConversationsVisible(): boolean {
  return open;
}

export function folderConversationsAnchor(): { tabId: string; paneId: string } | null {
  return anchor;
}

export function pickerContext(): FolderContext {
  return contextFor(anchor?.tabId ?? null, anchor?.paneId ?? null);
}

export function pickerLists(): FolderLists {
  return folderLists(conversationList(), pickerContext());
}

/** 열 때마다 목록을 다시 읽는다 — "밖에서 열림" 이 낡지 않게 */
export function openFolderConversations(at?: { tabId: string; paneId: string }, opts: { newTab?: boolean } = {}): void {
  inNewTab = opts.newTab === true;
  const tab = activeTab();
  const target = at ?? (tab ? { tabId: tab.id, paneId: paneOf(tab) } : null);
  if (!open) rememberFocusOrigin(FOCUS_KEY);
  anchor = target;
  open = true;
  const remote = pickerRemote();
  if (remote) ensureRemoteConversations(remote.alias);
  else ensureConversations();
}

/** 원격은 1분 캐시를 건너뛴다 */
export function refreshPicker(): void {
  const remote = pickerRemote();
  if (remote) void loadRemoteConversations(remote.alias, true);
  else ensureConversations();
}

export function closeFolderConversations(): void {
  if (!open) return;
  open = false;
  returnFocus(FOCUS_KEY);
}

export function toggleFolderConversations(): void {
  if (open) closeFolderConversations();
  else openFolderConversations();
}

/** 닫으며 포커스를 돌려주지 않는다 — 갈 곳을 이 동작이 정한다. `into` 는 로컬만 */
export function openFromPicker(s: AgentConversation, mode: "resume" | "fork" | "chat", into?: string): void {
  // 채팅 모양은 로컬 대화만
  if (mode === "chat" && isRemoteConversation(s)) return;
  const at = anchor;
  open = false;
  forgetFocusOrigin(FOCUS_KEY);
  const how = inNewTab ? "tab" : "beside";
  if (mode === "chat") void openConversationInChat(s, at ?? undefined, how);
  else if (isRemoteConversation(s)) void openRemoteConversation(s, mode, at ?? undefined, how);
  else void openConversation(s, mode, at ?? undefined, how, into);
}

export function viewFromPicker(s: AgentConversation): void {
  const at = anchor;
  closeFolderConversations();
  const how = inNewTab ? "tab" : "beside";
  void tick().then(() => viewConversation(s, at ?? undefined, how));
}
