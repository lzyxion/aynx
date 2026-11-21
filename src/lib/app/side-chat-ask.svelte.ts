import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { currentWindowLabel, tileCode } from "$lib/context";
import { listPanes, offeredAiClis, sessionStreamOf, type PaneSpec } from "$lib/session";
import { currentWorkspaceTabs, findPaneAnywhere, focusedPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { isMainWindow, isRemote } from "$lib/app/window.svelte.js";
import { mobileLayout } from "$lib/app/mobile.svelte.js";
import { openMobileChat } from "$lib/app/mobile-sheets.svelte.js";
import { paneAiReadable } from "$lib/app/delegation.svelte.js";
import { displayName } from "$lib/app/titles.svelte.js";
import { knownAiClis } from "$lib/app/panes.svelte.js";
import { openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { addForkedSideChat, currentSideChat, lastSideChatPick, newSideChat, sideChats } from "$lib/app/side-chats.svelte.js";
import { addSideChatLink, fillSideChatComposer, setSideChatLinks, sideChatErrorText } from "$lib/app/side-chat-live.svelte.js";
import { newSideChatId, sideChatCliOk, sideChatForkSource, sideChatForkTitle, sideChatNewDefault, sideChatPickFor } from "$lib/side-chat";
import { sideChatClose, sideChatOpen, type SideChatCli, type SideChatSnapshot } from "$lib/side-chat-api";
import { agentLinkOf } from "$lib/app/agent-sessions.svelte.js";
import { SIDE_CHAT_LINK_MAX, linkTileName, orderLinkTiles, type LinkTile, type SideChatTileLink } from "$lib/side-chat-link";
import { settings } from "$lib/settings.svelte.js";

/**
 * 사이드 채팅의 맥락 잇기 — 글은 입력 칸에 채우기만 하고 보내기는 사람이 누른다.
 * 연결한 세션은 그 채팅의 AI 가 MCP 읽기 도구로만 읽는다(판정은 서버가 호출마다 — 로컬 'AI 읽기 허용' · 원격 호스트 AI 권한) — 앱은 값을 붙여 넣지 않는다.
 */

/** 주 창 · 원격 웹 창 — 보조 창 · 떼어 낸 창은 아니다 */
export function sideChatWindow(): boolean {
  return isMainWindow || isRemote;
}

export function openSideChatHere(): void {
  if (isRemote && mobileLayout()) openMobileChat();
  else openChatDockAt("chat");
}

/** 서버 거울에 오르는 터미널만 */
function linkable(pane: PaneSpec): pane is PaneSpec & { kind: "local" | "ssh" } {
  return pane.kind === "local" || pane.kind === "ssh";
}

function linkTileOf(pane: PaneSpec & { kind: "local" | "ssh" }, tabId: string, focusedId: string | null): LinkTile {
  return {
    paneId: pane.id,
    tabId,
    stream: sessionStreamOf(pane),
    code: tileCode(currentWindowLabel(), pane.id),
    name: displayName(pane),
    kind: pane.kind,
    readable: paneAiReadable(pane),
    focused: pane.id === focusedId,
    pane,
  };
}

/** 원격 창은 보는 워크스페이스의 탭만 — `+page` 의 `PaneHost` 와 같은 출처 */
export function linkTilesHere(): LinkTile[] {
  const focusedId = focusedPane()?.id ?? null;
  const out: LinkTile[] = [];
  for (const tab of isRemote ? currentWorkspaceTabs() : residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) if (linkable(pane)) out.push(linkTileOf(pane, tab.id, focusedId));
  }
  return orderLinkTiles(out);
}

export function tileLinkOf(paneId: string): SideChatTileLink | null {
  const pane = findPaneAnywhere(paneId);
  if (!pane || !linkable(pane)) return null;
  const t = linkTileOf(pane, "", null);
  return { stream: t.stream, name: linkTileName(t) };
}

async function ensureChat(): Promise<string | null> {
  const cur = currentSideChat();
  if (cur) return cur.id;
  const detected = await knownAiClis();
  const offered = offeredAiClis(detected, settings.disabledAgents).filter((c) => sideChatCliOk(c.id));
  const pick = sideChatNewDefault(offered, lastSideChatPick());
  if (!pick) return null;
  const chat = await newSideChat(pick.cli.id, pick.model, pick.effort);
  return chat.id;
}

export function sideChatAskTitle(): string {
  return currentSideChat()?.title || t("app.chatDock.untitled");
}

export function sideChatAskBasis(): { mainWindow: boolean; hasChat: boolean } {
  return { mainWindow: sideChatWindow(), hasChat: sideChats().length > 0 };
}

/** 메뉴 줄의 표시와 누른 뒤의 판정이 같은 함수다 */
export function tileForkSource(pane: PaneSpec): { agent: SideChatCli; conv: string } | null {
  return sideChatForkSource(pane.kind, sideChatWindow(), agentLinkOf(pane.id));
}

/**
 * 그 AI 타일의 대화를 새 사이드 채팅으로 갈라 온다(원본 타일은 그대로). 서버에 먼저 연다 — cwd 는 서버가 대화 색인의 기록된 폴더로
 * 정하고 화면은 경로를 주지 않는다. 거절이면 목록에 남기지 않는다.
 */
export async function continueTileInSideChat(paneId: string): Promise<void> {
  if (!sideChatWindow()) {
    showNotice(t("app.chatDock.ask.mainOnly"));
    return;
  }
  const pane = findPaneAnywhere(paneId);
  const src = pane ? tileForkSource(pane) : null;
  if (!pane || !src) {
    showNotice(t("app.chatDock.fork.unknown"));
    return;
  }
  const mem = sideChatPickFor(lastSideChatPick(), src.agent);
  const id = newSideChatId();
  let snap: SideChatSnapshot;
  try {
    snap = await sideChatOpen({
      chat: id,
      cli: src.agent,
      model: mem.model,
      effort: mem.effort || null,
      mode: { kind: "fork", from: src.conv },
    });
  } catch (e) {
    showNotice(t("app.chatDock.fork.failed", { e: sideChatErrorText(e) }));
    return;
  }
  try {
    await addForkedSideChat({
      id,
      cli: src.agent,
      model: snap.model,
      effort: snap.effort ?? "",
      title: sideChatForkTitle(displayName(pane)),
      forkedFrom: src,
      cwd: snap.cwd ?? "",
    });
  } catch (e) {
    void sideChatClose(id).catch(() => false);
    showNotice(t("app.chatDock.new.failed", { e: sideChatErrorText(e) }));
    return;
  }
  openSideChatHere();
  const link = tileLinkOf(paneId);
  if (link) await setSideChatLinks(id, [link]);
}

/** 글은 채우기만 한다 — 보내지 않는다 */
export async function askSideChat(sourcePaneId: string, text: string): Promise<void> {
  if (!sideChatWindow()) {
    showNotice(t("app.chatDock.ask.mainOnly"));
    return;
  }
  let id: string | null;
  try {
    id = await ensureChat();
  } catch {
    id = null;
  }
  if (!id) {
    showNotice(t("app.chatDock.noCli"));
    return;
  }
  openSideChatHere();
  const link = tileLinkOf(sourcePaneId);
  if (link && !(await addSideChatLink(id, link))) showNotice(t("app.chatDock.link.full", { max: SIDE_CHAT_LINK_MAX }));
  fillSideChatComposer(id, text);
}
