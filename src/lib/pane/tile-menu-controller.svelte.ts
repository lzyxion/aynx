// 타일 ⋯ 메뉴(머리줄 ⋯ · 머리줄 우클릭 · 터미널 본문 우클릭 · 문서 본문 우클릭)의 **대상 · 항목 · 실행** — `PaneHost.svelte` 에서 뗀
// 컨트롤러(2026-10-26 분할 3차). `PaneHost` 가 하나 만들고(`createTileMenu` — 값 · 프롭 · 다른 메뉴 컨트롤러는 게터로) 그림은 `PaneMenu.svelte`.
// `$effect` · 리스너는 없다 — 폰 위 띠 등록 · 우클릭 위임 리스너는 `PaneHost` 에 있다.
//
// **항목 목록은 `pane/pane-menu.ts` 의 순수 함수**가 만들고(종류별 생략 규칙·토글 상태·
// 비활성 사유), **그리는 것과 몸짓**은 `pane/PaneMenu.svelte` 가 든다. 여기 남는 것은
// 셋뿐이다: 어디에 열지(좌표), 무엇을 대상으로 할지(스냅샷), 누른 항목을 어느 프롭으로
// 잇는지([`runMenuAction`]). 줄 실행은 `runOnMenu` 통로 하나 — 누른 순간의 좌표 · 저장할 명령 · 블록 · 고른 글 · 문서 `run` 을
// 먼저 뜨고 닫은 뒤 실행한다(docs/conventions.md "메뉴를 닫는 코드").
//
// **헤더 우클릭도 같은 메뉴**를 연다. 32px 짜리 띠에서 12px 짜리 점 세 개를 겨누는 것보다
// 띠 아무 데나 우클릭하는 편이 쉽고, 두 몸짓이 다른 메뉴를 내면 그때부터 둘 다 외워야 한다.
import { runOnMenu } from "$lib/browser/menu-runner";
import { canContinueInOrch, forkIntoOrchestration } from "$lib/app/orchestration.svelte.js";
import { isOrchTab } from "$lib/orchestration/orch-tab";
import { openBranchGraphOfPane } from "$lib/app/branch-graph.svelte.js";
import { borrowsSession, type PaneSpec, type TabSpec } from "$lib/session";
import { paneHeadShown, paneToolsOf, TOOL_ACTION_PREFIX } from "$lib/pane/pane-tools.svelte.js";
import { canFlipPane, flipViewOf, setFlipView } from "$lib/pane/ai-flip.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import { isTerminalPane } from "$lib/pane/tile-presentation";
import type { TmuxMenuController } from "$lib/pane/tmux-menu.svelte.js";
import type { AiPermMenuController } from "$lib/pane/ai-perm-menu.svelte.js";
import { queryAiOf, type DbAiMenuController } from "$lib/pane/db-ai-menu.svelte.js";
import type { LocalAiMenuController } from "$lib/pane/local-ai-menu.svelte.js";
import type { ForwardMenuController } from "$lib/pane/forward-menu.svelte.js";
import { localAiTile, paneAiStage } from "$lib/app/delegation.svelte.js";
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
  /** 화면 좌표 (`position: fixed`) */
  left: number;
  top: number;
  /**
   * **터미널 본문 우클릭으로 열렸다** — 그때의 사정(링크·선택·복사할 출력)
   * (docs/log/2026-09-05-terminal-context-menu.md). 헤더 ⋯ 로 열렸으면 `null` 이고,
   * 그 차이가 곧 목록의 차이다 ([`menuItems`]).
   *
   * 스냅샷인 것이 요점이다: 메뉴가 떠 있는 동안 커서는 링크를 떠나고 선택도 바뀔 수
   * 있는데, 사용자가 겨눈 것은 **누른 그 순간**의 화면이다.
   */
  term: {
    link: string | null;
    hasSelection: boolean;
    hasOutput: boolean;
    /** 그 줄에서 찾은 저장할 만한 명령 (docs/log/2026-09-16-snippets.md) */
    snippet: SnippetSource | null;
    /** 그 줄의 끝난 블록 — "이 블록을 AI 에게 묻기…" (docs/log/2026-09-28-ask-ai-block.md) */
    ask: AskBlockRef | null;
    /** 그때 고른 글자 — "사이드 채팅에 묻기"(사이드 채팅 v2 5단계) */
    selection?: string | null;
  } | null;
  /**
   * **문서 타일 본문 우클릭으로 열렸다**(2026-10-25) — 줄은 문서 타일이 지어 오고(`doc-menu.ts`), 누른 줄(`tool:<열쇠>`)은 `run` 으로 그 타일에
   * 돌려준다. `term` 과 같이 누른 순간의 스냅샷이다(링크 · 고른 글이 줄과 `run` 안에 묶여 있다)
   */
  doc?: { rows: PaneMenuRow[]; run: (key: string) => void } | null;
}

/**
 * `PaneHost` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). 프롭 콜백 · 다른 메뉴 컨트롤러도 같다.
 */
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
  /** 단축키 덮어쓰기(프롭 기본값 `{}` 를 거친 값) — 줄의 단축키 글자 */
  readonly keybindings: Record<string, string>;
  /** 이 탭의 동시 입력이 켜져 있는가 */
  syncOn(tabId: string): boolean;
  /** 이 패널이 동시 입력에 포함되어 있는가 */
  included(tabId: string, paneId: string): boolean;
  /** 안내 통로(`hostActions().onnotice`) */
  readonly notice: ((message: string) => void) | undefined;
  readonly tm: TmuxMenuController;
  readonly fm: ForwardMenuController;
  readonly ai: AiPermMenuController;
  readonly dbm: DbAiMenuController;
  readonly lam: LocalAiMenuController;
}

/** 타일 ⋯ 메뉴 하나를 만든다 — 상태(`tileMenu`)는 이 안에 살고 읽기는 게터로 */
export function createTileMenu(h: TileMenuHost) {
  let tileMenu = $state<TileMenu | null>(null);
  /** 메뉴를 연 ⋯ 버튼 — Escape 로 닫을 때 포커스를 되돌린다 (우클릭으로 열었으면 `null`) */
  let tileMenuTrigger: HTMLElement | null = null;
  /**
   * 메뉴를 열기 **직전에** 포커스를 갖고 있던 것 — 대개 그 타일의 터미널이다.
   *
   * 메뉴가 열리면 키보드 포커스는 메뉴로 온다(↑↓ 가 동작해야 하므로). 항목을 고르고 나면
   * 그것을 **돌려준다** — 안 그러면 "출력 복사" 한 번에 터미널 포커스가 풀려 다음 글자를
   * 치기 전에 한 번 더 클릭해야 한다. 타일 구성을 바꾸는 항목(분할·분리·닫기)에서는 돌려준
   * 포커스가 곧 덮어씌워진다: 새 타일의 포커스는 rAF 안에서 잡히므로 언제나 이보다 늦다.
   */
  let tileMenuReturn: HTMLElement | null = null;

  /** 메뉴 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡아 두는 데 쓴다 (`Tabs` 와 같은 처방) */
  const TILE_MENU_WIDTH = 200;
  /** 메뉴가 넓어질 수 있는 끝(`PaneMenu` 의 `max-width`) — 오른쪽 넘침 막기 */
  const TILE_MENU_MAX_WIDTH = 240;

  /** 메뉴가 가리키는 타일 (그 사이 닫혔거나 다른 창으로 갔으면 `null` — 메뉴도 함께 닫힌다) */
  const menuBox = $derived(
    tileMenu === null ? null : (h.boxes.find((b) => b.pane.id === tileMenu?.paneId) ?? null),
  );

  /**
   * 그 타일의 메뉴에 뜰 항목들 (종류별 표는 `pane-menu.ts`).
   *
   * 두 벌이 아니라 **한 정의의 두 가지**다: 터미널 우클릭이면 화면·클립보드 항목이 위에
   * 얹히고 아래는 헤더 ⋯ 의 목록 그대로다 (`terminalMenuItems` 가 `menuItemsFor` 를 다시 쓴다).
   */
  const menuItems = $derived.by(() => {
    if (menuBox === null) return [];
    if (tileMenu?.doc) return tileMenu.doc.rows;
    const term = tileMenu?.term ?? null;
    const ctx = {
      // 로컬 타일의 "AI 읽기 허용" (원격에서는 보지 않는다 — 아래 `aiStage`)
      shared: isShared(menuBox.pane.id),
      // 로컬 AI CLI 타일(10-23) — AI 읽기 권한이 없어 "AI 권한…" 줄이 없다
      aiTile: localAiTile(menuBox.pane),
      // 원격 타일의 호스트 AI 권한 단계 — 호스트 목록에 없는 타일(빠른 접속)은 `null`(줄이 흐려진다)
      aiStage: aiHostAlias(menuBox.pane) === null ? null : paneAiStage(menuBox.pane),
      // 쿼리 타일의 DB AI 권한(10-14) — 연결이 목록에 없으면 `null`(줄이 흐려진다)
      dbAi: menuBox.pane.kind === "query" ? queryAiOf(menuBox.pane) : null,
      syncOn: h.syncOn(menuBox.tab.id),
      included: h.included(menuBox.tab.id, menuBox.pane.id),
      // 헤더 ⋯ 는 그때그때 창구에 물어보고, 터미널 우클릭은 **누른 순간의 답**을 들고 온다.
      hasOutput: term?.hasOutput ?? (commandsOf(menuBox.pane.id)?.canCopyOutput() ?? false),
      // 간이 모드(tmux 타일) — 판정은 타일이 든 tmux 세션 이름 하나다 (`Terminal.svelte` 와 같다).
      screenOnly: menuBox.pane.tmux !== undefined && menuBox.pane.tmux !== "",
      // 스크롤백 내보내기·세션 로그 (docs/log/2026-09-17-scrollback-export-and-logs.md).
      // 둘 다 터미널 창구에 **지금** 물어본다 — `hasOutput` 의 헤더 ⋯ 갈래와 같은 자리다.
      // 세션 없는 타일(설정·파일)에는 창구가 없어 `false`·`null` 이고, 그 종류에는 애초에
      // 이 줄들이 그려지지도 않는다 (`hasSession` 묶음 안이다).
      hasScrollback: termActionsOf(menuBox.pane.id)?.hasScrollback() ?? false,
      logging: (termActionsOf(menuBox.pane.id)?.logPath() ?? null) !== null,
      // "이 폴더의 지난 대화" 줄의 단축키 글자 — 사용자가 바꾼 조합 그대로
      folderConvoHint: displayCombo(effectiveCombo("folder-conversations", h.keybindings)),
      // "사이드 채팅에서 이어 가기"(사이드 채팅 v2 6단계) — 주 창의 로컬 AI 타일 · 그 대화 연결을 알 때만(`tileForkSource` — 누른 뒤에도 같은 판정)
      sideChatFork: tileForkSource(menuBox.pane) !== null,
      // 원격 문서 타일 — "새 창으로 분리" 를 그리지 않는다(`startPaneTear` 와 같은 판정 하나)
      borrowed: borrowsSession(menuBox.pane),
      // 문서 타일의 "경로 복사"(10-20) — 문서가 받는 그 경로 · 별칭(`DocView` 의 `path` · `alias` 프롭과 같은 칸)
      docPath:
        menuBox.pane.kind === "doc" ? { path: menuBox.pane.path ?? "", alias: menuBox.pane.alias ?? "" } : null,
      // 폰 배치 — 분할 둘 · 새 창으로 분리를 그리지 않는다(위 띠 ⋯ · 길게 누르기 모두 — `PaneMenuCtx.solo`)
      solo: h.solo,
      // 오케스트레이션 탭(2026-10-29 — 노트 D11 · 0-3 Q1=B): 그 탭의 타일이면 분할 · 분리를 그리지 않고, 탭 밖의 로컬 AI 타일이면
      // [오케스트레이션으로 이어 가기] 를 세운다.
      orchTab: isOrchTab(menuBox.tab),
      orchContinue: canContinueInOrch(menuBox.pane),
    };
    if (term === null) {
      // 폰의 위 띠 ⋯ 로 열린 메뉴 — 머리줄에만 있던 단추(넘기기 · 폴더 · 브랜치)를 맨 위 줄로(`PaneMenuCtx.phone`)
      const p = menuBox.pane;
      const phone = h.solo
        ? { flip: isTerminalPane(p) && canFlipPane(p) ? flipViewOf(p.id) : null }
        : undefined;
      // 머리줄로 올라간 도구줄의 ⋯ 줄(파일 타일 B안 — 도구 ⋯ 와 타일 ⋯ 를 하나로) — 머리줄이 서 있을 때만(아니면 도구줄 끝의 제 ⋯ 가 쥔다)
      const tools = paneHeadShown(p.id) ? paneToolsOf(p.id)?.menu?.() : undefined;
      return menuItemsFor(p.kind, { ...ctx, phone, tools }, tr);
    }
    const termCtx: TermMenuCtx = {
      ...ctx,
      link: term.link,
      hasSelection: term.hasSelection,
      snippet: term.snippet,
      askBlock: term.ask,
      askHint: displayCombo(effectiveCombo("ask-ai-block", h.keybindings)),
      // 사이드 채팅에 묻기(v2 5단계) — 독이 있는 주 창에서만
      sideChat: currentWindowLabel() === "main",
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
      // 오른쪽 넘침은 메뉴의 최대 폭(`PaneMenu` 의 `max-width: 240px` — 단축키 힌트가 붙으면 200 을 넘는다)으로 잰다 — 폰(R5)의
      // 길게 누르기 자리에서 메뉴가 화면 밖으로 잘렸다(실기). 문서 타일의 옆목록(서식 · 단락 · 삽입)은 **늘 오른쪽**에 서게(10-25 사용자) 그 폭만큼
      // 더 비워 둔다 — 자리가 모자라면 `placeFlyout` 이 왼쪽으로 넘기기 때문이다.
      left: Math.max(
        8,
        Math.min(x, window.innerWidth - TILE_MENU_MAX_WIDTH - 8 - (doc?.rows.some(isGroup) ? FLYOUT_GAP + FLYOUT_EST_WIDTH : 0)),
      ),
      top: y,
      term,
      doc,
    };
  }

  /**
   * 메뉴를 닫는다. 포커스를 어디로 되돌릴지는 **어떻게 닫혔는가**가 정한다:
   * `"back"` 은 열기 직전의 자리(항목을 고른 뒤), `"trigger"` 는 ⋯ 버튼(Escape),
   * `"none"` 은 아무 데도 — 바깥을 눌렀거나 헤더를 끌기 시작한 경우다 (그쪽에서 이미
   * 다른 곳으로 포커스가 가고 있어, 여기서 한 번 더 옮기면 서로 낚아챈다).
   */
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

  /** ⋯ 버튼 — 이미 이 타일의 메뉴가 열려 있으면 닫는다 (토글) */
  function toggleTileMenu(btn: HTMLElement, item: { tab: TabSpec; pane: PaneSpec }) {
    if (tileMenu?.paneId === item.pane.id) {
      closeTileMenu();
      return;
    }
    tileMenuTrigger = btn;
    const b = btn.getBoundingClientRect();
    // 버튼은 헤더 오른쪽 끝에 있으므로 **오른쪽 변을 맞춰** 편다 (왼쪽 맞춤이면 늘 화면 밖이다)
    openTileMenu(item, b.right - TILE_MENU_WIDTH, b.bottom + 2);
  }

  /**
   * 항목 공통 — **대상을 스냅샷하고** 닫은 뒤 상위에 위임한다.
   * 순서(스냅샷 → 닫기 → 실행)는 `$lib/browser/menu-runner` 의 [`runOnMenu`] 한 구현이
   * 들고 있다 (`docs/conventions.md`) — 여기는 "무엇을 스냅샷하고 어떻게 닫는가" 두 줄만
   * 채운다. 대상을 **인자로 받는** 것이 요점이다: `menuBox` 는 `tileMenu` 에서 파생된
   * 값이라 닫는 순간 `null` 이 되고, 클로저가 그것을 읽으면 조용히 터진다
   * (docs/log/2026-09-05-titlebar-cleanup.md "실기 후 수정").
   */
  function runTileMenu(fn: (box: HostBox) => void) {
    runOnMenu(() => menuBox, () => closeTileMenu("back"), fn);
  }

  /**
   * 항목 하나 → 프롭 하나. 이 `switch` 가 메뉴의 **유일한 배선표**다 — 항목의 존재·이름·
   * 상태는 `pane-menu.ts` 가, 그리기는 `PaneMenu.svelte` 가 들고, 여기는 "누르면 누구를
   * 부르는가" 만 안다.
   */
  function runMenuAction(action: PaneMenuAction) {
    // 팝오버가 설 **좌표는 `tileMenu` 에서 온다** — 닫히는 순간 사라지므로 여기서 미리 뜬다
    // (docs/conventions.md 의 "메뉴를 닫는 코드는 값을 스냅샷한 뒤에 온다" 와 같은 이유다:
    // `runTileMenu` 가 스냅샷하는 것은 대상 타일뿐이고 좌표는 그 바깥이다).
    const at = tileMenu === null ? null : { left: tileMenu.left, top: tileMenu.top };
    // 저장할 명령도 **같은 이유로** 미리 뜬다 — `tileMenu.term` 은 닫히는 순간 사라진다.
    const snip = tileMenu?.term?.snippet ?? null;
    // "AI 에게 묻기" 의 블록도 같은 이유로 미리 뜬다 — 상자는 누른 자리(메뉴의 왼쪽 위)에 선다.
    const ask = tileMenu?.term?.ask ?? null;
    // 고른 글자도 같은 이유로 미리 뜬다(사이드 채팅에 묻기)
    const sel = tileMenu?.term?.selection ?? null;
    // 문서 타일 본문 우클릭의 줄 — 같은 통로로 닫은 뒤 그 타일이 맡긴 `run` 에 열쇠를 넘긴다(`run` 은 닫히기 전에 뜬다)
    const docRun = tileMenu?.doc?.run ?? null;
    if (docRun !== null && action.startsWith(TOOL_ACTION_PREFIX)) {
      const key = action.slice(TOOL_ACTION_PREFIX.length);
      runTileMenu(() => docRun(key));
      return;
    }
    // 타일이 맡긴 도구 줄(`tool:<열쇠>`) — 같은 통로로 대상 타일을 뜬 뒤 그 타일의 실행 함수에 열쇠를 넘긴다
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
        // 이 폴더의 지난 대화 — 그 타일을 기준(폴더 · 옆에 열 자리)으로 고르는 목록을 연다
        // (docs/log/2026-09-27-folder-conversations.md)
        case "folder-conversations":
          return openFolderConversations({ tabId: m.tab.id, paneId: m.pane.id });
        // 포트 포워딩… — 포워드가 있으면 머리줄 칩과 같은 목록 메뉴를 메뉴가 서 있던 자리에(tmux 세션… 과 같은 몸짓 —
        // 머리줄을 끈 사람의 길이다), 없으면 보여 줄 목록이 없으니 추가 모달로 곧장 간다.
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
        // AI 권한 — 메뉴가 서 있던 자리에 권한 팝오버를 연다(tmux 세션… 과 같은 몸짓). 원격 · 쿼리 · 로컬(10-23 — Off · Read 만)이 같은 상자
        case "ai-permission":
          return m.pane.kind === "query"
            ? h.dbm.open(m, at)
            : m.pane.kind === "local"
              ? h.lam.open(m, at)
              : h.ai.openAiMenu(m, at);
        case "copy-output":
          return void copyPaneOutput(m.pane.id);
        // 문서 타일의 경로 복사(10-20) — 파일 타일 우클릭의 "경로 복사"(`browser/file-actions` 의 `copyPath`)와 같은 문 · 같은 알림:
        // 별칭 없는 경로를 `$lib/clipboard` 로, 되면 안내 통로(`onnotice`) · 못 하면 오류 토스트
        case "copy-path": {
          const path = m.pane.path ?? "";
          if (path === "") return;
          return void writeClipboard(path).then((ok) =>
            ok ? h.notice?.(tr("files.browser.copypath.done")) : toast.error(tr("files.browser.copypath.fail")),
          );
        }
        // 스크롤백 저장·세션 로그 (docs/log/2026-09-17-scrollback-export-and-logs.md).
        // 둘 다 그 타일의 xterm 버퍼·세션이 대상이라 터미널 창구로 돌려보낸다.
        // (**로그 폴더**는 2026-09-17 에 이 메뉴를 떠났다 — 앱 전역 한 자리라 타일마다 같은
        // 줄이 설 이유가 없었다. 지금은 설정 › 터미널과 호스트 폼이 그 문이다.)
        case "save-scrollback":
          return termActionsOf(m.pane.id)?.saveScrollback();
        case "session-log":
          return termActionsOf(m.pane.id)?.openLog();
        // 터미널 우클릭 메뉴에만 뜨는 것들 — 전부 그 패널의 xterm 이 해야 하는 일이라
        // 레지스트리 창구로 돌려보낸다 (docs/log/2026-09-05-terminal-context-menu.md).
        case "open-link":
          return termActionsOf(m.pane.id)?.openLink();
        case "copy-link":
          return termActionsOf(m.pane.id)?.copyLink();
        case "copy":
          return termActionsOf(m.pane.id)?.copySelection();
        case "paste":
          return termActionsOf(m.pane.id)?.paste();
        case "select-all":
          return termActionsOf(m.pane.id)?.selectAll();
        case "clear-screen":
          return termActionsOf(m.pane.id)?.clear();
        // 저장 대화상자 하나로 간다 (팔레트의 저장 줄과 **같은 문**). 별칭은 여기서 정한다 —
        // "이 호스트" 선택지를 세울지는 타일이 SSH 인가로 갈리고, 그 판정은 트리를 든 이쪽의
        // 일이다 (모달은 별칭 문자열 하나만 받는다).
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
        // 사이드 채팅에 묻기(v2 5단계 — 결정 11) — 고른 글자 · 없으면 그 블록을 지금 채팅 입력 칸에 채우고 이 타일을 연결 칩에
        // 사이드 채팅에서 이어 가기(6단계) — 이 타일의 대화를 새 사이드 채팅으로 갈라 온다(서버가 대화 색인에서 원본 · 폴더를 확인)
        case "continue-side-chat":
          return void continueTileInSideChat(m.pane.id);
        // 오케스트레이션으로 이어 가기(2단계 단계 5) — 이 타일의 대화를 새 오케스트레이션 탭의 프로듀서 채팅으로 갈라 온다(이 타일은 그대로 ·
        // 서버가 그 대화의 기록된 cwd 에서 스튜디오를 정한다)
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
        // 폰의 머리줄 줄들(`pane-menu.ts` 의 `phoneRows`) — 머리줄 단추와 같은 몸통이다
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
    /** 열린 메뉴(자리 · 대상 · 누른 순간의 사정) — 닫혀 있으면 `null` */
    get tileMenu() {
      return tileMenu;
    },
    /** 메뉴가 가리키는 타일 */
    get menuBox() {
      return menuBox;
    },
    /** 그 타일의 메뉴에 뜰 항목들 */
    get menuItems() {
      return menuItems;
    },
    /** 메뉴를 연 ⋯ 버튼 — 커서에서 열 때 부르는 쪽이 `null` 로 비운다 */
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
