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
import { fillSideChatComposer, linkSideChat, sideChatErrorText } from "$lib/app/side-chat-live.svelte.js";
import { newSideChatId, sideChatCliOk, sideChatForkSource, sideChatForkTitle, sideChatNewDefault, sideChatPickFor } from "$lib/side-chat";
import { sideChatClose, sideChatOpen, type SideChatCli, type SideChatSnapshot } from "$lib/side-chat-api";
import { agentLinkOf } from "$lib/app/agent-sessions.svelte.js";
import { linkTileName, orderLinkTiles, type LinkTile, type SideChatTileLink } from "$lib/side-chat-link";
import { settings } from "$lib/settings.svelte.js";

/**
 * **사이드 채팅의 맥락 잇기**(v2 5단계 — docs/log/2026-10-23-side-chat-dock.md 결정 10 · 11) — 연결 칩이 고를 이 창의 타일들 · [AI에게 묻기] →
 * 사이드 채팅 · 터미널 우클릭 "사이드 채팅에 묻기" · (6단계) AI 타일 ⋯ · 우클릭 "사이드 채팅에서 이어 가기"(그 타일의 대화를 갈라 온다).
 *
 * 방향이 **사람 → 사이드 채팅 입력 칸**이다: 글은 칸에 **채우기만** 하고 보내기는 사람이 누른다. 연결은 그 블록 · 선택이 있던 타일로 건다 —
 * 그 채팅의 AI 는 MCP 읽기 도구로 그 세션만 읽고(판정은 서버가 호출마다 — 로컬 'AI 읽기 허용' · 원격 호스트 AI 권한) 앱은 값을 붙여 넣지
 * 않는다(넘긴 글 자체는 사람이 보낼 때 그 대화에 남는다). 사이드 채팅은 **사람 창**(집 PC 주 창 · 원격 웹 창 — 2026-11-01)에 선다 —
 * 데스크톱 폭은 채팅 독, 원격 폰 배치는 폰 덮개(`MobileChat`). 보조 창에서는 안내 한 줄.
 */

/** 사이드 채팅을 쓰는 창인가 — 주 창 · 원격 웹 창(보조 창 · 떼어 낸 창은 아니다) */
export function sideChatWindow(): boolean {
  return isMainWindow || isRemote;
}

/** 이 창의 사이드 채팅 자리를 연다 — 원격 폰 배치는 폰 덮개, 아니면 채팅 독의 채팅 갈래 */
export function openSideChatHere(): void {
  if (isRemote && mobileLayout()) openMobileChat();
  else openChatDockAt("chat");
}

/** 연결할 수 있는 타일인가 — 서버 거울에 오르는 터미널(로컬 · SSH) */
function linkable(pane: PaneSpec): pane is PaneSpec & { kind: "local" | "ssh" } {
  return pane.kind === "local" || pane.kind === "ssh";
}

/** 타일 하나 → 칩의 줄 */
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
  };
}

/**
 * **이 창의 연결할 수 있는 타일들** — 지금 포커스된 타일이 맨 위(기본 제안), 나머지는 탭 · 화면 순서. 반응형(`$derived` 안에서 부른다).
 * 원격 창은 그 창이 보는 워크스페이스의 탭(`+page` 의 `PaneHost` 와 같은 출처 — 집 PC 거울의 숨은 워크스페이스는 세우지 않는다).
 */
export function linkTilesHere(): LinkTile[] {
  const focusedId = focusedPane()?.id ?? null;
  const out: LinkTile[] = [];
  for (const tab of isRemote ? currentWorkspaceTabs() : residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) if (linkable(pane)) out.push(linkTileOf(pane, tab.id, focusedId));
  }
  return orderLinkTiles(out);
}

/** 그 타일의 저장 연결(스트림 · 지금 이름) — 연결할 수 없는 타일이면 `null` */
export function tileLinkOf(paneId: string): SideChatTileLink | null {
  const pane = findPaneAnywhere(paneId);
  if (!pane || !linkable(pane)) return null;
  const t = linkTileOf(pane, "", null);
  return { stream: t.stream, name: linkTileName(t) };
}

/** 이어 쓸 채팅 — 지금 고른 것, 없으면 마지막에 쓴 CLI(켜진 것)로 새로 만든다. 켠 CLI 가 없으면 `null` */
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

/** "사이드 채팅" 줄의 이름 — 지금 채팅 제목(없으면 "새 채팅") */
export function sideChatAskTitle(): string {
  return currentSideChat()?.title || t("app.chatDock.untitled");
}

/** [AI에게 묻기] 상자에 "사이드 채팅" 줄을 낼 바탕 — 사람 창(주 창 · 원격 창) · 채팅이 있나 */
export function sideChatAskBasis(): { mainWindow: boolean; hasChat: boolean } {
  return { mainWindow: sideChatWindow(), hasChat: sideChats().length > 0 };
}

/** 그 타일에서 갈라 올 원본(사람 창 · 로컬 · 대화 연결을 안다 — 순수 `sideChatForkSource`) — 메뉴 줄의 표시와 누른 뒤의 판정이 같은 함수다 */
export function tileForkSource(pane: PaneSpec): { agent: SideChatCli; conv: string } | null {
  return sideChatForkSource(pane.kind, sideChatWindow(), agentLinkOf(pane.id));
}

/**
 * **사이드 채팅에서 이어 가기**(6단계 — 타일 ⋯ · 우클릭 메뉴) — 그 AI 타일의 대화를 **새 사이드 채팅으로 갈라 온다**(원본 · 도는 타일은 그대로 —
 * Claude 는 쓰는 이 잠금이 없어 그냥 이어 가면 대화가 갈라진다). 순서: 서버에 먼저 연다(`side_chat_open{fork{from}}` — 서버가 그 CLI 의 대화
 * 색인에서 원본을 찾고 **기록된 폴더**를 cwd 로 정한다 · 화면은 경로를 주지 않는다) → 되면 목록에 적고(제목 `↪ <타일 이름>` · 폴더 이름표 ·
 * 원본) 고른다 → 독을 연다 → 그 타일을 연결 칩에 건다. 거절(색인에 없음 · 폴더 없음)이면 안내 한 줄 · 목록에 남기지 않는다. 띄우지는 않는다
 * (첫 보내기가 띄운다 — 그 전엔 원본의 기록을 보인다).
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
  // 그 에이전트 CLI 의 마지막 모델 · 강도(CLI 마다 기억 — `last.byCli`)
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
  if (link) await linkSideChat(id, link);
}

/**
 * **사이드 채팅에 묻기** — 독을 열고(닫혀 있으면) 지금 채팅을 고르고(없으면 켠 CLI 로 하나 만든다) 입력 칸에 글을 **채우고**(보내지 않는다)
 * 그 타일을 연결 칩에 건다(연결할 수 없는 타일이면 연결은 그대로). 사람 창이 아니면 안내 한 줄.
 */
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
  if (link) await linkSideChat(id, link);
  fillSideChatComposer(id, text);
}
