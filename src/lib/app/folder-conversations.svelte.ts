import { tick } from "svelte";
import {
  conversationList,
  ensureConversations,
  openConversation,
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
 * **이 폴더의 지난 대화 — 저장소** (docs/log/2026-09-27-folder-conversations.md).
 *
 * 타일에서 일하다가 그 타일이 있는 폴더(워크트리)의 지난 Claude · Codex 대화를 불러 **그 타일 옆에 분할로** 연다.
 * 규칙(기준 폴더 · 범위 칩 · 거르기 · 키)은 순수 층 `$lib/folder-conversations`, 그림은 `FolderConversations.svelte`
 * (팔레트 자리에 뜨는 고르는 목록). 입구는 셋이고 모두 [`openFolderConversations`] 로 온다 — 단축키
 * `folder-conversations`(팔레트의 같은 이름 줄도 그 액션이다) · 상태바 칸(말풍선 둘) · 타일 ⋯ 메뉴.
 *
 * 목록은 지난 대화 저장소(`app/agent-sessions`)의 **한 벌을 그대로** 쓴다 — 여기서 디스크를 읽지 않는다. 고르는
 * 목록이 열릴 때 그 저장소가 다시 읽고(팔레트와 같은 규칙 — Rust 캐시라 싸다). 앱이 뜰 때는 읽지 않는다.
 *
 * 대화 본문은 여기 오지 않는다 — 목록의 제목까지만(다른 화면과 같은 출처), 저장 · 로그 · MCP 어디에도 싣지 않는다.
 */

/** 포커스 복귀 이름표 (`app/focus-return`) */
const FOCUS_KEY = "folder-conversations";

// ---------------------------------------------------------------------------
// 기준 폴더
// ---------------------------------------------------------------------------

/**
 * 타일 하나의 **지금 폴더** — 로컬 셸 · AI 타일이면 셸이 알려 준 폴더(WSL 이면 이 PC 의 경로로 옮긴다) → 그 타일의
 * 시작 폴더, 프로젝트 시작 화면이면 그 폴더. 그 밖(SSH · 설정 · 파일 …)은 `null` — 원격 폴더의 대화는 이 PC 에 없다.
 */
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
  return null;
}

/**
 * **원격 기준** — 연 타일이 설정의 SSH 타일이면 그 별칭과 그 서버의 폴더(셸이 알려 준 폴더 → 시작 폴더 → 없음 = 그 서버
 * 전체), 원격 프로젝트의 시작 화면이면 그 별칭과 그 폴더. 그 밖은 `null`(로컬 판정 — 지금까지와 같다). 빠른 접속 타일은
 * 별칭이 설정의 것이 아니라 뺀다(docs/log/2026-09-27-remote-conversations.md).
 */
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

/** 연 타일의 원격 기준 — 로컬이면 `null`. 반응형(그 셸이 `cd` 하면 따라간다) */
export function pickerRemote(): RemotePickerContext | null {
  const tab = anchor ? (residentWindowTabs().find((x) => x.id === anchor?.tabId) ?? null) : null;
  return remoteOf(tab, anchor?.paneId ?? null);
}

/** 그 타일(과 그 탭)에서 판정의 재료를 뽑는다 */
function inputOf(tab: TabSpec | null, paneId: string | null): FolderInput {
  if (!tab) return { focused: null, tabFolders: [] };
  const pane = paneId ? findPane(tab.root, paneId) : null;
  const tabFolders = listPanes(tab.root)
    .filter((p) => p.id !== paneId)
    .map(paneFolder)
    .filter((f): f is string => f !== null);
  return { focused: pane ? paneFolder(pane) : null, tabFolders };
}

/** 그 타일의 기준 폴더 — 반응형(셸이 알려 준 폴더 · 프로젝트 · 워크트리 목록을 따라간다) */
function contextFor(tabId: string | null, paneId: string | null): FolderContext {
  const tab = tabId ? (residentWindowTabs().find((t) => t.id === tabId) ?? null) : null;
  return resolveFolderContext(inputOf(tab, paneId), projects(), readyWorktrees);
}

// ---------------------------------------------------------------------------
// 고르는 목록
// ---------------------------------------------------------------------------

/** 연 타일 — 옆에 분할로 열 자리이자 기준 폴더의 주인. 닫혀 있으면 `null` */
let anchor = $state<{ tabId: string; paneId: string } | null>(null);
let open = $state(false);
/** 고른 대화를 **새 탭에** 연다(폰 — 원격 웹 R5 · 10-20 "새 탭에 열기" 시트) — 아니면 연 타일 옆에 분할 */
let inNewTab = false;

/** 떠 있나 — 반응형(창의 키 가드 · Escape 사슬이 본다) */
export function folderConversationsVisible(): boolean {
  return open;
}

/** 연 타일 — 반응형 */
export function folderConversationsAnchor(): { tabId: string; paneId: string } | null {
  return anchor;
}

/** 연 타일의 기준 폴더 — 반응형(떠 있는 동안 그 셸이 `cd` 해도 따라간다) */
export function pickerContext(): FolderContext {
  return contextFor(anchor?.tabId ?? null, anchor?.paneId ?? null);
}

/** 연 타일의 범위별 대화 — 반응형 */
export function pickerLists(): FolderLists {
  return folderLists(conversationList(), pickerContext());
}

/**
 * 연다 — `at` 이 없으면 지금 탭의 포커스된 타일(단축키 · 팔레트 · 상태바). ⋯ 메뉴는 그 타일을 넘긴다. 열 때마다
 * 목록을 다시 읽는다(팔레트와 같은 규칙 — "밖에서 열림" 이 낡지 않게, Rust 캐시라 싸다).
 */
export function openFolderConversations(at?: { tabId: string; paneId: string }, opts: { newTab?: boolean } = {}): void {
  inNewTab = opts.newTab === true;
  const tab = activeTab();
  const target = at ?? (tab ? { tabId: tab.id, paneId: paneOf(tab) } : null);
  if (!open) rememberFocusOrigin(FOCUS_KEY);
  anchor = target;
  open = true;
  const remote = pickerRemote();
  // 원격이면 그 서버의 목록만 — 살아 있는 세션으로(새 접속 없음 · 1분 캐시). 로컬 목록은 읽지 않는다
  if (remote) ensureRemoteConversations(remote.alias);
  else ensureConversations();
}

/** **F5** — 다시 읽는다. 원격은 1분 캐시를 건너뛰고 목록을 새로 뽑는다 */
export function refreshPicker(): void {
  const remote = pickerRemote();
  if (remote) void loadRemoteConversations(remote.alias, true);
  else ensureConversations();
}

/** 닫는다 — 포커스는 연 자리로 */
export function closeFolderConversations(): void {
  if (!open) return;
  open = false;
  returnFocus(FOCUS_KEY);
}

/** 단축키는 토글이다 — 같은 키로 열고 닫는다(떠 있는 동안은 목록이 스스로 그 키를 보고 닫는다) */
export function toggleFolderConversations(): void {
  if (open) closeFolderConversations();
  else openFolderConversations();
}

/**
 * **옆에서 이어서**(`resume`) · **새 대화로 계속**(`fork`) — 연 타일 옆에 분할로(새 타일 규칙 방향 · 포커스가 옮기고
 * 한 번 빛난다). 재개할 대화가 이미 이 창의 타일에 열려 있으면 그 타일로 가기만 한다(`openConversation` 의 규칙).
 * 갈 곳을 이 동작이 정하므로 닫으며 포커스를 돌려주지 않는다. `into` 가 있으면 **여기로 가져와 계속**(로컬만) — 새 대화로
 * 계속을 그 대화의 폴더가 아니라 `into`(지금 폴더)에서 연다.
 */
export function openFromPicker(s: AgentConversation, mode: "resume" | "fork", into?: string): void {
  const at = anchor;
  open = false;
  forgetFocusOrigin(FOCUS_KEY);
  // 원격 줄 — 그 별칭의 새 SSH 타일(공유 전송로)을 옆에, 그 대화의 폴더에서
  const how = inNewTab ? "tab" : "beside";
  if (isRemoteConversation(s)) void openRemoteConversation(s, mode, at ?? undefined, how);
  else void openConversation(s, mode, at ?? undefined, how, into);
}

/**
 * **기록 보기** — 닫고(포커스는 연 타일로 돌아간다) 다음 틱에 시트를 편다. 시트 머리의 재개 · 새 대화로 계속도
 * 같은 자리(연 타일 옆)로 간다.
 */
export function viewFromPicker(s: AgentConversation): void {
  // 원격 대화도 같은 시트 — 시트가 그 호스트에 붙은 세션으로 서버의 파일을 읽는다(docs/log/2026-09-27-remote-conversations.md "2단계")
  const at = anchor;
  closeFolderConversations();
  const how = inNewTab ? "tab" : "beside";
  void tick().then(() => viewConversation(s, at ?? undefined, how));
}
