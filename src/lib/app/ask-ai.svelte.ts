import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import {
  askSummary,
  ASK_READY_TIMEOUT_MS,
  buildAskText,
  planAskTarget,
  readyForPaste,
  withSideChatRow,
  type AskAnchor,
  type AskCli,
  type AskOutput,
  type AskRow,
  type AskTile,
} from "$lib/ask-ai";
import { blockDurationMs, blocksOf, lastFinishedBlock, type CommandBlock } from "$lib/block-history";
import { commandsOf } from "$lib/shell-integration";
import { termActionsOf } from "$lib/term-actions";
import { paneAiReadable } from "$lib/app/delegation.svelte.js";
import { listPanes, offeredAiClis, type PaneSpec } from "$lib/session";
import { aiDisplayName } from "$lib/pane-icons";
import { currentWindowLabel, tileCode } from "$lib/context";
import {
  activeTabId,
  findPaneAnywhere,
  focusedPane,
  focusTile,
  tabOfPane,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import {
  agentCommandStartedAt,
  agentKindOf,
  agentLastOutputAt,
  agentStatusOf,
  isAgentPane,
} from "$lib/app/agent-status.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { knownAiClis, lastShellMenuAi, openAiPaneBeside } from "$lib/app/panes.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { askSideChat, sideChatAskBasis, sideChatAskTitle } from "$lib/app/side-chat-ask.svelte.js";
import { sideChatAskOffered } from "$lib/side-chat-link";
import { sideChatCliOk } from "$lib/side-chat";

/**
 * 명령 블록을 AI 타일에 넘기기 — 사람 → AI 타일 방향이고, 붙여 넣기만 하고 Enter 는 보내지 않는다(괄호 붙여넣기가 꺼진
 * 타일에는 넣지 않는다 — 여러 줄이 줄마다 보내진다). 그래서 원시 `send_command` 금지와 부딪히지 않는다(docs/log/2026-09-28-ask-ai-block.md).
 */

export type { AskAnchor } from "$lib/ask-ai";

export interface AskPicker {
  sourcePaneId: string;
  /** 열 때 한 번 만든다 — 상자가 떠 있는 동안 화면이 흘러도 사람이 겨눈 그 블록이다 */
  text: string;
  summary: string;
  rows: AskRow[];
  selected: number;
  hasTiles: boolean;
  anchor: AskAnchor;
  /** AI 읽기 허용이 꺼진 타일이다 — 세션에 한 번 */
  privateNote: boolean;
}

let picker = $state<AskPicker | null>(null);

export function askPicker(): AskPicker | null {
  return picker;
}

export function askPickerOpen(): boolean {
  return picker !== null;
}

/** 고른 줄은 `"none"` 으로 닫는다 — 받는 타일이 포커스를 가져간다 */
export function closeAskPicker(back: "source" | "none"): void {
  const source = picker?.sourcePaneId ?? null;
  picker = null;
  if (back === "source" && source !== null) termActionsOf(source)?.focus();
}

// ── 마지막에 쓴 AI 타일 ──

const lastFocused = new Map<string, number>();

export function watchAiFocus(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const pane = focusedPane();
      if (pane && isAgentPane(pane)) lastFocused.set(pane.id, Date.now());
    });
  });
}

// ── 입구 ──

let privateNoted = false;

export function askAiAboutLastBlock(paneId: string): void {
  const block = lastFinishedBlock(paneId);
  if (!block) {
    showNotice(t("pane.askai.no_block"));
    return;
  }
  const at = termActionsOf(paneId)?.blockAnchor(block.id) ?? null;
  askAiAboutBlock(paneId, block.id, at ?? { x: window.innerWidth / 2 - 190, y: window.innerHeight / 3, align: "left" });
}

export function askAiAboutBlock(paneId: string, blockId: number, anchor: AskAnchor): void {
  const block = blocksOf(paneId).find((b) => b.id === blockId) ?? null;
  const pane = findPaneAnywhere(paneId);
  if (!block || block.running || !pane) {
    showNotice(t("pane.askai.no_block"));
    return;
  }
  const text = buildAskText(
    {
      commandLine: block.commandLine,
      exit: block.exit,
      durationMs: blockDurationMs(block),
      host: hostLabelOf(pane),
      cwd: block.cwd,
      output: outputOf(paneId, block),
    },
    t,
  );
  const isPrivate = !paneAiReadable(pane);
  askAiWithText(paneId, text, askSummary(block.commandLine, block.exit, t), anchor, isPrivate);
}

export function askAiWithText(sourcePaneId: string, text: string, summary: string, anchor: AskAnchor, isPrivate: boolean): void {
  const paneId = sourcePaneId;
  void knownAiClis().then((detected) => {
    const clis: AskCli[] = offeredAiClis(detected, settings.disabledAgents);
    const basis = sideChatAskBasis();
    const sideChat = sideChatAskOffered({ ...basis, hasCli: clis.some((c) => sideChatCliOk(c.id)) }) ? sideChatAskTitle() : null;
    const plan = withSideChatRow(
      planAskTarget({
        tiles: aiTiles(),
        currentTabId: activeTabId(),
        sourcePaneId: paneId,
        clis,
        defaultCli: lastShellMenuAi(),
      }),
      sideChat,
    );
    if (plan.mode === "direct") {
      const note = isPrivate && !privateNoted;
      if (note) privateNoted = true;
      deliver(plan.tile.tabId, plan.tile.paneId, plan.tile.name, text, note);
      return;
    }
    if (plan.rows.length === 0) {
      showNotice(t("pane.askai.no_agents"));
      return;
    }
    const note = isPrivate && !privateNoted;
    if (note) privateNoted = true;
    picker = {
      sourcePaneId: paneId,
      text,
      summary,
      rows: plan.rows,
      selected: plan.selected,
      hasTiles: plan.hasTiles,
      anchor,
      privateNote: note,
    };
  });
}

/** 상자가 `runOnMenu` 로 값을 스냅샷해 닫은 뒤 부른다 */
export function runAskRow(pick: { row: AskRow; sourcePaneId: string; text: string }): void {
  const { row } = pick;
  if (row.kind === "tile") {
    deliver(row.tile.tabId, row.tile.paneId, row.tile.name, pick.text, false);
    return;
  }
  if (row.kind === "sideChat") {
    void askSideChat(pick.sourcePaneId, pick.text);
    return;
  }
  void openAndDeliver(pick.sourcePaneId, row.cli, pick.text);
}

// ── 재료 ──

function hostLabelOf(pane: PaneSpec): string {
  if (pane.kind === "ssh") return pane.alias?.trim() || t("pane.askai.host.local");
  return t("pane.askai.host.local");
}

/** 버퍼의 마커 사이를 먼저 읽고, 밀려났으면 블록 이력의 발췌로 물러선다(`partial` 은 버린 줄 수를 모른다) */
function outputOf(paneId: string, block: CommandBlock): AskOutput | null {
  const live = commandsOf(paneId)?.blockOutput(block.id) ?? null;
  if (live !== null) return { lines: live, droppedBefore: 0 };
  const ex = block.excerpt;
  if (ex.capture === "unavailable") return null;
  if (ex.capture === "complete") return { lines: [...ex.head, ...ex.tail], droppedBefore: 0 };
  return { lines: ex.tail.length > 0 ? ex.tail : ex.head, droppedBefore: "some" };
}

function aiTiles(): AskTile[] {
  const out: AskTile[] = [];
  const label = currentWindowLabel();
  residentWindowTabs().forEach((tab, i) => {
    for (const pane of listPanes(tab.root)) {
      if (!isAgentPane(pane)) continue;
      const ai = agentKindOf(pane) ?? "";
      out.push({
        paneId: pane.id,
        tabId: tab.id,
        ai,
        name: aiDisplayName(ai) ?? ai,
        code: tileCode(label, pane.id),
        tabTitle: displayTabTitle(tab),
        tabIndex: i + 1,
        status: agentStatusOf(pane),
        lastFocusedAt: lastFocused.get(pane.id) ?? null,
      });
    }
  });
  return out;
}

// ── 넘기기 ──

/** 보내지 않는다(Enter 없음) — 괄호 붙여넣기가 꺼진 타일이면 넣지 않는다 */
function deliver(tabId: string, paneId: string, name: string, text: string, privateNote: boolean): boolean {
  const api = termActionsOf(paneId);
  if (!api || !findPaneAnywhere(paneId)) {
    showNotice(t("pane.askai.gone"));
    return false;
  }
  const result = api.insertText(text);
  if (result === "no-bracketed") {
    showNotice(t("pane.askai.no_bracketed", { name }));
    return false;
  }
  if (result === "closed") {
    showNotice(t("pane.askai.gone"));
    return false;
  }
  focusTile(tabOfPane(paneId)?.id ?? tabId, paneId);
  glowTile(paneId, "accent");
  // 탭이 바뀌었으면 그 타일의 터미널은 다음 프레임에야 보인다 — 숨은 textarea 는 포커스를 받지 않는다
  requestAnimationFrame(() => requestAnimationFrame(() => termActionsOf(paneId)?.focus()));
  if (privateNote) showNotice(t("pane.askai.private"));
  else toast.info(t("pane.askai.pasted"));
  return true;
}

// ── 다른 입구가 빌려 쓰는 길 ──

export function askTiles(): AskTile[] {
  return aiTiles();
}

export function pasteToAiTile(tile: AskTile, text: string): boolean {
  return deliver(tile.tabId, tile.paneId, tile.name, text, false);
}

/** 사이드 채팅 입력 칸에 채우기만 한다(보내지 않는다) */
export function askSideChatFromTerminal(paneId: string, selection: string | null, blockId: number | null): void {
  const sel = selection?.trim() ? selection : null;
  if (sel !== null) {
    void askSideChat(paneId, sel);
    return;
  }
  const block = blockId !== null ? (blocksOf(paneId).find((b) => b.id === blockId) ?? null) : lastFinishedBlock(paneId);
  const pane = findPaneAnywhere(paneId);
  if (!block || block.running || !pane) {
    showNotice(t("pane.askai.no_block"));
    return;
  }
  const text = buildAskText(
    {
      commandLine: block.commandLine,
      exit: block.exit,
      durationMs: blockDurationMs(block),
      host: hostLabelOf(pane),
      cwd: block.cwd,
      output: outputOf(paneId, block),
    },
    t,
  );
  void askSideChat(paneId, text);
}

const READY_POLL_MS = 200;

/** 준비가 안 되면 넣지 않는다 — 프로그램이 뜨기 전에 넣으면 글이 셸로 샌다 */
async function openAndDeliver(sourcePaneId: string, cli: AskCli, text: string): Promise<void> {
  const tab = tabOfPane(sourcePaneId);
  if (!tab) {
    showNotice(t("pane.askai.gone"));
    return;
  }
  const id = await openAiPaneBeside(tab.id, sourcePaneId, cli);
  if (id === null) {
    showNotice(t("pane.askai.gone"));
    return;
  }
  const started = Date.now();
  const tick = (): void => {
    const pane = findPaneAnywhere(id);
    if (!pane) return;
    const ready = readyForPaste({
      now: Date.now(),
      commandStartedAt: agentCommandStartedAt(id),
      lastOutputAt: agentLastOutputAt(id),
      bracketedPaste: termActionsOf(id)?.bracketedPaste() ?? false,
    });
    if (ready) {
      deliver(tabOfPane(id)?.id ?? tab.id, id, aiDisplayName(cli.id) ?? cli.name, text, false);
      return;
    }
    if (Date.now() - started >= ASK_READY_TIMEOUT_MS) {
      showNotice(t("pane.askai.not_ready"));
      return;
    }
    setTimeout(tick, READY_POLL_MS);
  };
  setTimeout(tick, READY_POLL_MS);
}
