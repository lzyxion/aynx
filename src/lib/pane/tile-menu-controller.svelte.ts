// 타일 ⋯ 메뉴(머리줄 ⋯ · 머리줄 우클릭 · 터미널 · 문서 본문 우클릭)의 대상 · 항목 · 실행.
// 줄 실행은 `runOnMenu` 통로 하나 — 누른 순간의 값을 먼저 뜨고 닫은 뒤 실행한다(docs/conventions.md "메뉴를 닫는 코드").
import { runOnMenu } from "$lib/browser/menu-runner";
import { isRemote } from "$lib/ipc";
import { canContinueInOrch, forkIntoOrchestration } from "$lib/app/orchestration.svelte.js";
import { isOrchTab } from "$lib/orchestration/orch-tab";
import { openBranchGraphOfPane } from "$lib/app/branch-graph.svelte.js";
import { borrowsSession, isFileLeafKind, type PaneSpec, type TabSpec } from "$lib/session";
import { paneHeadShown, paneToolsOf, TOOL_ACTION_PREFIX } from "$lib/pane/pane-tools.svelte.js";
import { canFlipPane, flipViewOf, setFlipView } from "$lib/pane/ai-flip.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import { isTerminalPane } from "$lib/pane/tile-presentation";
import type { TmuxMenuController } from "$lib/pane/tmux-menu.svelte.js";
import type { AiPermMenuController } from "$lib/pane/ai-perm-menu.svelte.js";
import { queryAiOf, type DbAiMenuController } from "$lib/pane/db-ai-menu.svelte.js";
import { toggleLocalAiRead } from "$lib/pane/local-ai";
import type { ForwardMenuController } from "$lib/pane/forward-menu.svelte.js";
import { paneAiStage } from "$lib/app/delegation.svelte.js";
import { aiHostAlias } from "$lib/delegation";
import { currentWindowLabel } from "$lib/context";
import {
  isGroup,
  menuItemsFor,
  terminalMenuItems,
  type PaneMenuAction,
  type PaneMenuRow,
  type SnippetSource,
  type TermMenuCtx,
} from "$lib/pane/pane-menu";
import { openSnippetSave } from "$lib/app/snippets.svelte.js";
import { newDocState, openNewDoc } from "$lib/app/new-doc.svelte.js";
import { openFolderConversations } from "$lib/app/folder-conversations.svelte.js";
import { termActionsOf } from "$lib/term-actions";
import { FLYOUT_EST_WIDTH, FLYOUT_GAP } from "$lib/menu-flyout";
import type { AskBlockRef } from "$lib/ask-ai";
import { askAiAboutBlock, askSideChatFromTerminal } from "$lib/app/ask-ai.svelte.js";
import { continueTileInSideChat, tileForkSource } from "$lib/app/side-chat-ask.svelte.js";
import type { PaneHostProps } from "$lib/pane/props";
import { displayCombo, effectiveCombo } from "$lib/keybindings";
import { commandsOf, copyPaneOutput } from "$lib/shell-integration";
import { isShared } from "$lib/ai.svelte.js";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { writeClipboard } from "$lib/clipboard";
import { toast } from "$lib/toast.svelte";

export interface TileMenu {
  tabId: string;
  paneId: string;
  left: number;
  top: number;
  /** 터미널 본문 우클릭의 사정 — 누른 그 순간의 스냅샷이다(메뉴가 떠 있는 동안 커서 · 선택이 바뀐다) */
  term: {
    link: string | null;
    hasSelection: boolean;
    hasOutput: boolean;
    snippet: SnippetSource | null;
    ask: AskBlockRef | null;
    selection?: string | null;
    barEdits?: boolean;
    /** AI 타일의 대화 면에서 열었다 — 복사는 `selection`, 링크 복사는 `link` 스냅숏으로 하고 나머지 둘은 이 손잡이로 */
    convo?: { selectAll(): void; openLink(): void };
  } | null;
  /** 문서 타일 본문 우클릭 — `term` 과 같이 누른 순간의 스냅샷이다 */
  doc?: { rows: PaneMenuRow[]; run: (key: string) => void } | null;
}

/** `PaneHost` 가 넘기는 값 — 게터라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface TileMenuHost
  extends Pick<
    PaneHostProps,
    | "onsplitpane"
    | "forwardsOf"
    | "onforwardpane"
    | "oneditremote"
    | "onopenfiles"
    | "onsyncpane"
    | "ondetachpane"
    | "onclosepane"
  > {
  readonly boxes: HostBox[];
  readonly solo: boolean;
  readonly keybindings: Record<string, string>;
  syncOn(tabId: string): boolean;
  included(tabId: string, paneId: string): boolean;
  readonly notice: ((message: string) => void) | undefined;
  readonly tm: TmuxMenuController;
  readonly fm: ForwardMenuController;
  readonly ai: AiPermMenuController;
  readonly dbm: DbAiMenuController;
}

export function createTileMenu(h: TileMenuHost) {
  let tileMenu = $state<TileMenu | null>(null);
  let tileMenuTrigger: HTMLElement | null = null;
  /** 항목을 고른 뒤 포커스를 돌려줄 곳 — 안 돌려주면 "출력 복사" 한 번에 터미널 포커스가 풀린다 */
  let tileMenuReturn: HTMLElement | null = null;

  const TILE_MENU_WIDTH = 200;
  /** `PaneMenu` 의 `max-width` 와 같은 값 */
  const TILE_MENU_MAX_WIDTH = 240;

  const menuBox = $derived(
    tileMenu === null ? null : (h.boxes.find((b) => b.pane.id === tileMenu?.paneId) ?? null),
  );

  const menuItems = $derived.by(() => {
    if (menuBox === null) return [];
    if (tileMenu?.doc) return tileMenu.doc.rows;
    const term = tileMenu?.term ?? null;
    const ctx = {
      shared: isShared(menuBox.pane.id),
      aiStage: aiHostAlias(menuBox.pane) === null ? null : paneAiStage(menuBox.pane),
      dbAi: menuBox.pane.kind === "query" ? queryAiOf(menuBox.pane) : null,
      syncOn: h.syncOn(menuBox.tab.id),
      included: h.included(menuBox.tab.id, menuBox.pane.id),
      hasOutput: term?.hasOutput ?? (commandsOf(menuBox.pane.id)?.canCopyOutput() ?? false),
      // tmux 타일 판정 — `Terminal.svelte` 와 같다
      screenOnly: menuBox.pane.tmux !== undefined && menuBox.pane.tmux !== "",
      hasScrollback: termActionsOf(menuBox.pane.id)?.hasScrollback() ?? false,
      logging: (termActionsOf(menuBox.pane.id)?.logPath() ?? null) !== null,
      remoteWindow: isRemote,
      folderConvoHint: displayCombo(effectiveCombo("folder-conversations", h.keybindings)),
      sideChatFork: tileForkSource(menuBox.pane) !== null,
      // `startPaneTear` 와 같은 판정 하나
      borrowed: borrowsSession(menuBox.pane),
      docPath: isFileLeafKind(menuBox.pane.kind)
        ? { path: menuBox.pane.path ?? "", alias: menuBox.pane.alias ?? "" }
        : null,
      docNew: menuBox.pane.kind === "doc" ? newDocState(menuBox.pane.id) : null,
      solo: h.solo,
      orchTab: isOrchTab(menuBox.tab),
      orchContinue: canContinueInOrch(menuBox.pane),
    };
    if (term === null) {
      const p = menuBox.pane;
      const phone = h.solo
        ? { flip: isTerminalPane(p) && canFlipPane(p) ? flipViewOf(p.id) : null }
        : undefined;
      // 도구줄의 ⋯ 줄 · 문서의 "이 파일" 줄은 머리줄이 서 있을 때만 — 아니면 도구줄 끝의 제 ⋯ 가 쥔다
      const head = paneHeadShown(p.id);
      const tools = head ? paneToolsOf(p.id)?.menu?.() : undefined;
      const fileTools = head ? paneToolsOf(p.id)?.fileMenu?.() : undefined;
      return menuItemsFor(p.kind, { ...ctx, phone, tools, fileTools }, tr);
    }
    const termCtx: TermMenuCtx = {
      ...ctx,
      link: term.link,
      hasSelection: term.hasSelection,
      snippet: term.snippet,
      askBlock: term.ask,
      askHint: displayCombo(effectiveCombo("ask-ai-block", h.keybindings)),
      sideChat: currentWindowLabel() === "main",
      barEdits: term.barEdits,
      convo: term.convo !== undefined,
    };
    return terminalMenuItems(menuBox.pane.kind, termCtx, tr);
  });

  function openTileMenu(
    item: { tab: TabSpec; pane: PaneSpec },
    x: number,
    y: number,
    term: TileMenu["term"] = null,
    doc: TileMenu["doc"] = null,
  ) {
    const was = document.activeElement;
    tileMenuReturn = was instanceof HTMLElement ? was : null;
    tileMenu = {
      tabId: item.tab.id,
      paneId: item.pane.id,
      // 넘침은 최대 폭으로 잰다. 옆목록이 있는 문서 메뉴는 그 폭만큼 더 비운다 — 모자라면 `placeFlyout` 이 옆목록을 왼쪽으로 넘긴다
      left: Math.max(
        8,
        Math.min(x, window.innerWidth - TILE_MENU_MAX_WIDTH - 8 - (doc?.rows.some(isGroup) ? FLYOUT_GAP + FLYOUT_EST_WIDTH : 0)),
      ),
      top: y,
      term,
      doc,
    };
  }

  /** `"none"` 은 포커스를 옮기지 않는다 — 이미 다른 곳으로 가는 중이라 여기서 옮기면 서로 낚아챈다 */
  function closeTileMenu(back: "none" | "back" | "trigger" = "none") {
    const to =
      back === "trigger"
        ? (tileMenuTrigger ?? tileMenuReturn)
        : back === "back"
          ? tileMenuReturn
          : null;
    tileMenu = null;
    tileMenuTrigger = null;
    tileMenuReturn = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  }

  function toggleTileMenu(btn: HTMLElement, item: { tab: TabSpec; pane: PaneSpec }) {
    if (tileMenu?.paneId === item.pane.id) {
      closeTileMenu();
      return;
    }
    tileMenuTrigger = btn;
    const b = btn.getBoundingClientRect();
    openTileMenu(item, b.right - TILE_MENU_WIDTH, b.bottom + 2);
  }

  /** 대상은 인자로 받는다 — `menuBox` 는 닫는 순간 `null` 이 되어 클로저가 읽으면 조용히 터진다 */
  function runTileMenu(fn: (box: HostBox) => void) {
    runOnMenu(() => menuBox, () => closeTileMenu("back"), fn);
  }

  /** 대화 면의 복사 — 터미널 타일의 복사와 같은 한 줄로 알린다 */
  function copyConvoText(text: string | null) {
    if (text === null || text === "") return;
    void writeClipboard(text).then((ok) =>
      ok ? h.notice?.(tr("pane.term.clipboard.copied")) : toast.error(tr("pane.term.clipboard.write_failed")),
    );
  }

  function runMenuAction(action: PaneMenuAction) {
    // `runTileMenu` 가 뜨는 것은 대상 타일뿐이다 — 좌표 · 명령 · 블록 · 고른 글 · 문서 `run` 은 닫히는 순간 사라져 여기서 미리 뜬다
    const at = tileMenu === null ? null : { left: tileMenu.left, top: tileMenu.top };
    const snip = tileMenu?.term?.snippet ?? null;
    const ask = tileMenu?.term?.ask ?? null;
    const sel = tileMenu?.term?.selection ?? null;
    const convo = tileMenu?.term?.convo ?? null;
    const link = tileMenu?.term?.link ?? null;
    const docRun = tileMenu?.doc?.run ?? null;
    if (docRun !== null && action.startsWith(TOOL_ACTION_PREFIX)) {
      const key = action.slice(TOOL_ACTION_PREFIX.length);
      runTileMenu(() => docRun(key));
      return;
    }
    if (action.startsWith(TOOL_ACTION_PREFIX)) {
      const key = action.slice(TOOL_ACTION_PREFIX.length);
      runTileMenu((m) => paneToolsOf(m.pane.id)?.run?.(key));
      return;
    }
    runTileMenu((m) => {
      switch (action) {
        case "split-row":
          return h.onsplitpane?.(m.tab.id, m.pane.id, "row");
        case "split-col":
          return h.onsplitpane?.(m.tab.id, m.pane.id, "col");
        case "folder-conversations":
          return openFolderConversations({ tabId: m.tab.id, paneId: m.pane.id });
        case "forward":
          return (h.forwardsOf?.(m.pane.id) ?? []).length > 0
            ? h.fm.openForwardMenu(m, at)
            : h.onforwardpane?.(m.tab.id, m.pane.id);
        case "edit-remote":
          return h.oneditremote?.(m.tab.id, m.pane.id);
        case "sftp":
          return h.onopenfiles?.(m.tab.id, m.pane.id);
        case "tmux-sessions":
          return h.tm.openTmuxMenu(m, at);
        case "ai-permission":
          return m.pane.kind === "query" ? h.dbm.open(m, at) : h.ai.openAiMenu(m, at);
        case "toggle-ai-read":
          return toggleLocalAiRead(m.pane.id);
        case "copy-output":
          return void copyPaneOutput(m.pane.id);
        case "copy-path": {
          const path = m.pane.path ?? "";
          if (path === "") return;
          return void writeClipboard(path).then((ok) =>
            ok ? h.notice?.(tr("files.browser.copypath.done")) : toast.error(tr("files.browser.copypath.fail")),
          );
        }
        case "new-doc":
          return openNewDoc(m.pane.id, at === null ? null : { x: at.left, y: at.top });
        case "save-scrollback":
          return termActionsOf(m.pane.id)?.saveScrollback();
        case "session-log":
          return termActionsOf(m.pane.id)?.openLog();
        case "open-link":
          return convo !== null ? convo.openLink() : termActionsOf(m.pane.id)?.openLink();
        case "copy-link":
          return convo !== null ? copyConvoText(link) : termActionsOf(m.pane.id)?.copyLink();
        case "copy":
          return convo !== null ? copyConvoText(sel) : termActionsOf(m.pane.id)?.copySelection();
        case "paste":
          return termActionsOf(m.pane.id)?.paste();
        case "select-all":
          return convo !== null ? convo.selectAll() : termActionsOf(m.pane.id)?.selectAll();
        case "clear-screen":
          return termActionsOf(m.pane.id)?.clear();
        case "save-snippet":
          return snip === null
            ? undefined
            : openSnippetSave(
                snip.command,
                m.pane.kind === "ssh" ? (m.pane.alias?.trim() ?? null) : null,
              );
        case "ask-ai":
          return ask === null || at === null
            ? undefined
            : askAiAboutBlock(m.pane.id, ask.blockId, { x: at.left, y: at.top, align: "left" });
        case "continue-side-chat":
          return void continueTileInSideChat(m.pane.id);
        case "continue-orchestration":
          return void forkIntoOrchestration(m.pane.id);
        case "ask-side-chat":
          return askSideChatFromTerminal(m.pane.id, sel, ask?.blockId ?? null);
        case "toggle-sync":
          return h.onsyncpane?.(m.tab.id, m.pane.id);
        case "detach":
          return h.ondetachpane?.(m.tab.id, m.pane.id);
        case "close":
          return h.onclosepane?.(m.tab.id, m.pane.id);
        case "flip":
          return setFlipView(m.pane.id, flipViewOf(m.pane.id) === "term" ? "convo" : "term");
        case "files":
          return h.onopenfiles?.(m.tab.id, m.pane.id);
        case "branches":
          return openBranchGraphOfPane(m.pane.id, null);
      }
    });
  }

  return {
    get tileMenu() {
      return tileMenu;
    },
    get menuBox() {
      return menuBox;
    },
    get menuItems() {
      return menuItems;
    },
    get tileMenuTrigger() {
      return tileMenuTrigger;
    },
    set tileMenuTrigger(v: HTMLElement | null) {
      tileMenuTrigger = v;
    },
    openTileMenu,
    closeTileMenu,
    toggleTileMenu,
    runMenuAction,
  };
}

export type TileMenuController = ReturnType<typeof createTileMenu>;
