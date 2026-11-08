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
 * **명령 블록을 AI 타일에 넘기기** — 입구 셋(실패 줄 단추 · 우클릭 메뉴 · 단축키)이 모이는 코디네이터
 * (docs/log/2026-09-28-ask-ai-block.md).
 *
 * 규칙(넘길 글 · 받을 타일 · 새 타일의 준비 · 붙여 넣는 바이트)은 순수 모듈 `$lib/ask-ai` 에 있고, 여기는
 * 그 규칙에 **지금 창의 사실**(블록 · AI 타일들 · 상태 점 · 공유 여부)을 먹여 결과를 실행한다:
 *
 * - 받을 타일이 곧장 정해지면 그 타일 터미널의 창구(`termActionsOf(id).insertText`)로 붙여 넣고 그 타일로
 *   포커스를 옮겨 테두리를 한 번 빛낸다(`glowTile` — 에이전트 배너의 [보기] 와 같은 빛).
 * - 고를 것이 있으면 고르기 상자(`AskAiPicker.svelte`)의 상태를 세운다. 상자는 `+page` 에 늘 마운트돼 있고
 *   이 상태가 있을 때만 그린다.
 *
 * ## 보안 원칙과의 관계
 *
 * 방향이 **사람 → AI 타일**이고 사람이 누른 동작이다. 붙여 넣기만 하고 Enter 는 보내지 않으며(괄호 붙여넣기가
 * 꺼진 타일에는 아예 넣지 않는다 — 여러 줄이 줄마다 보내지므로), AI 가 무엇을 실행하는 길도 아니다. 그래서
 * "AI 문자열을 PTY 에 쓰는 원시 `send_command` 는 만들지 않는다" 와 부딪히지 않고, MCP·Rust 는 건드리지 않는다.
 * AI 읽기 허용이 꺼진 셸 타일에서도 된다 — 사람이 직접 넘기는 것이라서다. 넘긴 글이 AI 대화에 남는다는 점만
 * 세션에 한 번 말한다.
 */

/** 상자가 서는 자리 — 단추 아래(오른쪽 맞춤) · 누른 자리 · 블록 줄 아래 */
export type { AskAnchor } from "$lib/ask-ai";

/** 고르기 상자의 상태 — 있으면 상자가 뜬다 */
export interface AskPicker {
  /** 넘길 블록이 사는 셸 타일 — Esc 로 닫으면 포커스가 여기로 돌아간다 */
  sourcePaneId: string;
  /** 붙여 넣을 글 (열 때 한 번 만든다 — 상자가 떠 있는 동안 화면이 흘러도 사람이 겨눈 그 블록이다) */
  text: string;
  /** 머리의 요약 (`npm run build · 종료 2`) */
  summary: string;
  rows: AskRow[];
  selected: number;
  /** 열린 AI 타일이 하나라도 있는가 — 없으면 새로 열기 줄만 있다 */
  hasTiles: boolean;
  anchor: AskAnchor;
  /** AI 읽기 허용이 꺼진 타일이다 — 머리 아래 한 줄 (세션에 한 번) */
  privateNote: boolean;
}

let picker = $state<AskPicker | null>(null);

/** 떠 있는 고르기 상자 (없으면 `null`) — `AskAiPicker.svelte` 가 읽는다 */
export function askPicker(): AskPicker | null {
  return picker;
}

/** 상자가 떠 있는가 — 전역 키 가드(`anyModalOpen`)가 본다 */
export function askPickerOpen(): boolean {
  return picker !== null;
}

/**
 * 상자를 닫는다. `"source"` 면 포커스를 원본 셸 타일로 돌려준다(Esc) — 고른 줄은 `"none"` 으로 닫고 받는
 * 타일이 포커스를 가져간다.
 */
export function closeAskPicker(back: "source" | "none"): void {
  const source = picker?.sourcePaneId ?? null;
  picker = null;
  if (back === "source" && source !== null) termActionsOf(source)?.focus();
}

// ---------------------------------------------------------------------------
// 마지막에 쓴 AI 타일 — "마지막에 씀"
// ---------------------------------------------------------------------------

/** 타일 id → 사람이 마지막으로 그 AI 타일에 포커스를 둔 시각 (화면에 그릴 값이 아니라 반응형이 아니다) */
const lastFocused = new Map<string, number>();

/**
 * 포커스된 타일을 지켜보다 AI 타일이면 시각을 적는다 — 창마다 `mountAppListeners` 가 한 번 건다.
 * 돌려주는 함수가 구독을 푼다.
 */
export function watchAiFocus(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const pane = focusedPane();
      if (pane && isAgentPane(pane)) lastFocused.set(pane.id, Date.now());
    });
  });
}

// ---------------------------------------------------------------------------
// 입구
// ---------------------------------------------------------------------------

/** AI 읽기 허용이 꺼진 타일의 블록을 넘긴다는 말을 이번 세션에 이미 했는가 */
let privateNoted = false;

/**
 * 그 타일의 **마지막 끝난 블록**을 넘긴다 — 단축키(`ask-ai-block`)와 팔레트가 부른다. 블록이 없으면 안내 한 줄.
 * 상자는 그 블록의 프롬프트 줄 아래(화면 밖이면 커서 줄 아래)에 선다.
 */
export function askAiAboutLastBlock(paneId: string): void {
  const block = lastFinishedBlock(paneId);
  if (!block) {
    showNotice(t("pane.askai.no_block"));
    return;
  }
  const at = termActionsOf(paneId)?.blockAnchor(block.id) ?? null;
  askAiAboutBlock(paneId, block.id, at ?? { x: window.innerWidth / 2 - 190, y: window.innerHeight / 3, align: "left" });
}

/**
 * 블록 하나를 AI 타일에 넘긴다 — 세 입구의 공통 몸통. 받을 타일이 곧장 정해지면 붙여 넣고, 아니면 상자를 연다.
 */
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
  // AI 가 이 타일을 못 보는가 — 로컬은 타일 토글, 원격은 호스트의 AI 권한 단계(`paneAiReadable`)
  const isPrivate = !paneAiReadable(pane);
  askAiWithText(paneId, text, askSummary(block.commandLine, block.exit, t), anchor, isPrivate);
}

/**
 * **지은 글 하나를 AI 타일에 넘긴다** — 블록 → AI 타일의 몸통(받을 타일 고르기 · 곧장이면 붙여 넣기 · 아니면 고르기 상자 · 없으면 옆에
 * 열기)을 다른 입구도 쓴다: 쿼리 타일의 "AI 에 묻기"(쿼리 타일 3b — 글은 `$lib/query/ask-ai-db`). `sourcePaneId` 는 상자를 닫을 때
 * 포커스가 돌아갈 · 새 AI 타일이 옆에 설 타일이다. `isPrivate` 면 "AI 가 이 타일을 못 본다" 를 세션에 한 번 말한다.
 */
export function askAiWithText(sourcePaneId: string, text: string, summary: string, anchor: AskAnchor, isPrivate: boolean): void {
  const paneId = sourcePaneId;
  // 상자가 뜨는 동안 감지를 기다리지 않도록 캐시가 이미 있으면 곧장 온다 — 없으면 한 번만 기다린다.
  void knownAiClis().then((detected) => {
    // 설정에서 끈 에이전트는 "새로 열기" 줄에서 빠진다 — 이미 열린 AI 타일 줄은 그대로다.
    const clis: AskCli[] = offeredAiClis(detected, settings.disabledAgents);
    // (사이드 채팅 v2 5단계) 주 창이면 "사이드 채팅" 줄 — 이어 쓸 채팅이 있거나 새로 만들 CLI 가 켜져 있을 때
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
    // 열린 AI 타일도 없고 에이전트를 모두 껐다 — 빈 상자 대신 한 줄로 알린다.
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

/**
 * 상자에서 고른 줄을 실행한다 — 상자가 `runOnMenu` 로 **값을 스냅샷해 닫은 뒤** 부른다
 * (docs/conventions.md 의 메뉴 통로).
 */
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

// ---------------------------------------------------------------------------
// 재료
// ---------------------------------------------------------------------------

/** 글에 적을 호스트 — SSH 는 별칭, 로컬은 "이 PC" */
function hostLabelOf(pane: PaneSpec): string {
  if (pane.kind === "ssh") return pane.alias?.trim() || t("pane.askai.host.local");
  return t("pane.askai.host.local");
}

/**
 * 블록의 출력 — **버퍼의 마커 사이를 먼저** 읽는다(전부라 "앞 N줄 생략" 의 N 이 정확하다). 마커가 밀려났으면
 * 블록 이력의 발췌로 물러선다: `complete` 면 머리+꼬리가 곧 전부, `partial` 이면 꼬리만(버린 줄 수는 모른다),
 * `unavailable` 이면 못 읽었다(`null`). 둘 다 화면에서 읽은 글자라 제어 문자가 없다.
 */
function outputOf(paneId: string, block: CommandBlock): AskOutput | null {
  const live = commandsOf(paneId)?.blockOutput(block.id) ?? null;
  if (live !== null) return { lines: live, droppedBefore: 0 };
  const ex = block.excerpt;
  if (ex.capture === "unavailable") return null;
  if (ex.capture === "complete") return { lines: [...ex.head, ...ex.tail], droppedBefore: 0 };
  return { lines: ex.tail.length > 0 ? ex.tail : ex.head, droppedBefore: "some" };
}

/** 이 창의 AI 타일들 — 탭 순서 · 화면 순서 그대로 (판정은 탭 점과 같은 `isAgentPane`) */
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

// ---------------------------------------------------------------------------
// 넘기기
// ---------------------------------------------------------------------------

/**
 * 그 타일 입력 줄에 붙여 넣고(보내지 않는다) 그리로 간다 — 포커스 · 탭 전환 · 테두리 한 번 빛나기.
 * 괄호 붙여넣기가 꺼진 타일이면 넣지 않고 까닭을 말한다(그 자리에 머문다).
 */
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
  // 탭이 바뀌었으면 그 타일의 터미널은 다음 프레임에야 보인다 — 숨은 textarea 는 포커스를 받지 않는다.
  requestAnimationFrame(() => requestAnimationFrame(() => termActionsOf(paneId)?.focus()));
  if (privateNote) showNotice(t("pane.askai.private"));
  else toast.info(t("pane.askai.pasted"));
  return true;
}

// ---------------------------------------------------------------------------
// 다른 입구가 빌려 쓰는 길 — diff 줄 코멘트 (docs/log/2026-10-05-diff-tile.md "2단계")
// ---------------------------------------------------------------------------

/**
 * 이 창의 AI 타일들 — 블록 → AI 타일과 **같은 판정**(`isAgentPane` · `agentKindOf` · 상태 점 · 마지막 포커스). diff 타일의
 * 코멘트 트레이가 받을 곳 목록을 세울 때 쓴다(차례는 `$lib/diff-comments` 의 `orderDiffTargets`).
 */
export function askTiles(): AskTile[] {
  return aiTiles();
}

/**
 * 그 AI 타일 입력 줄에 **붙여 넣기만** 한다 — 블록 → AI 타일과 같은 몸통(`insertText` = 괄호 붙여넣기 · Enter 없음, 괄호
 * 붙여넣기가 꺼진 타일엔 넣지 않는다 · 포커스 · 테두리 빛). 넣었으면 참.
 */
export function pasteToAiTile(tile: AskTile, text: string): boolean {
  return deliver(tile.tabId, tile.paneId, tile.name, text, false);
}

/**
 * **사이드 채팅에 묻기**(터미널 우클릭 — v2 5단계 · 결정 11) — 고른 글자가 있으면 그것, 없으면 그 블록(누른 줄 · 마지막 끝난 블록)의 묻기 글을
 * 지금 사이드 채팅 입력 칸에 채우고(보내지 않는다) 그 타일을 연결 칩에 건다. 넘길 것이 없으면 안내 한 줄.
 */
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

/** 준비를 다시 보는 간격 (ms) */
const READY_POLL_MS = 200;

/**
 * 원본 셸 타일 **오른쪽에** AI 타일을 열고, 입력을 받을 준비가 되면 붙여 넣는다([`readyForPaste`]).
 * [`ASK_READY_TIMEOUT_MS`](20초) 안에 안 되면 넣지 않고 알린다 — 프로그램이 뜨기 전에 넣으면 글이 셸로 샌다.
 * 기다리는 동안 그 타일이 닫히면 조용히 그만둔다.
 */
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
    if (!pane) return; // 닫혔다 — 넣을 곳이 없다
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
