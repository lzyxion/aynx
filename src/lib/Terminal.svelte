<script lang="ts">
  import { tabOfPane } from "$lib/app/tabs.svelte.js";
  import { workspaceList } from "$lib/app/workspaces.svelte.js";
  import { onMount, untrack } from "svelte";
  import { dropPreviewing } from "$lib/drop-preview-state.svelte.js";
  import { layoutAnimating } from "$lib/layout-anim.svelte.js";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { SerializeAddon } from "@xterm/addon-serialize";
  import { Unicode11Addon } from "@xterm/addon-unicode11";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import "@xterm/xterm/css/xterm.css";
  import { settings } from "$lib/settings.svelte.js";
  import { t as tr, type Key } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { attachTriggers, type TriggerHighlighter } from "$lib/triggers";
  import { attachPathLinks } from "$lib/term-path-links";
  import { oscLinkAction, type PathLinkPlace, type ResolvedPath } from "$lib/path-links";
  import { registerInput } from "$lib/sync.svelte.js";
  import { registerConnect, registerSettling } from "$lib/reconnect-registry";
  import { CHECKPOINT_SCROLLBACK, isHandoff, registerSerialize, TEAR_SCROLLBACK } from "$lib/tear";
  import {
    attachShellIntegration,
    cwdSuffix,
    registerCommands,
    type CopyResult,
    type PaneStatus,
    type ShellIntegration,
  } from "$lib/shell-integration";
  import {
    attachSession,
    attachSessionViewer,
    SIZE_OWNER_EVENT,
    type SessionCheckpoint,
    isLiveSessionConflict,
    openSession,
    planAttach,
    probeSession,
    reattachSession,
    sessionStreamOf,
    setSessionAiRead,
    stashCheckpoint,
    describeOpenError,
    describeSessionError,
    openErrorHint,
    openErrorHintOf,
    freshStartCwd,
    hasSession,
    lastCwdToKeep,
    paneName,
    reconnectDelayMs,
    sessionErrorOf,
    ACK_INTERVAL,
    DEFAULT_SCROLLBACK,
    HIGH_WATER,
    LOW_WATER,
    type ConfirmHostKey,
    type PromptPassphrase,
    type PromptPassword,
    type PaneSpec,
    type SessionExitReason,
    type SessionHandle,
  } from "$lib/session";
  import BlockView, { type BlockViewOpen } from "$lib/term/BlockView.svelte";
  import {
    blockDurationMs,
    blocksOf,
    dropHistory,
  } from "$lib/block-history";
  import { bell, dropBell } from "$lib/app/bell.svelte.js";
  import {
    agentCommandStarted,
    agentExit,
    agentOutput,
    agentPromptReturned,
    agentSessionStart,
    agentStateResumed,
    dropAgent,
    isAgentPane,
    isLiveAgentPane,
    onAgentHookSignal,
  } from "$lib/app/agent-status.svelte.js";
  import { messengerLabel } from "$lib/app/messenger-label";
  import { linkResumedAutorun, seedAgentLink } from "$lib/app/agent-sessions.svelte.js";
  import { forgetReportedCwd, noteReportedCwd, pathLinkPlace } from "$lib/app/pane-cwd.svelte.js";
  import { notifyFinishedBlock } from "$lib/app/finish-notify";
  import {
    agentAutorunCommand,
    projectSetupLine,
    recordSetupResult,
    currentWindowLabel,
    dropSession,
    pushSessionBlock,
    pushSessionBlocks,
    reportSession,
    shouldReportMirror,
    tileCode,
    updateSessionContext,
  } from "$lib/context";
  import { dropShared, setShared } from "$lib/ai.svelte.js";
  import { paneAiReadable } from "$lib/app/delegation.svelte.js";
  import { aiHostAlias } from "$lib/delegation";
  import { sessionOf } from "$lib/app/sessions.svelte.js";
  import {
    dropVaultSaves,
    ensureVaultUnlocked,
    flushVaultSaves,
    promptsBlocking,
  } from "$lib/app/prompts.svelte.js";
  import { createClipboardController } from "$lib/term/clipboard-controller.svelte.js";
  import { createTermActions } from "$lib/term/actions-controller";
  import { newSetupNonce } from "$lib/setup-script";
  import { answerWorktreePrep, listenWorktreePrep } from "$lib/app/remote-worktree";
  import { localWorktreeBranchAt, reloadWorktreesAfterCreate } from "$lib/app/worktrees.svelte.js";
  import { homeDir } from "@tauri-apps/api/path";
  import AiVeilView from "$lib/term/AiVeil.svelte";
  import { createAiVeil, type AiVeil } from "$lib/term/ai-veil";
  import { aiIconName } from "$lib/pane-icons";
  import {
    isFinalPrepPhase,
    prepEndsInPlainShell,
    type WorktreePrepAnswer,
    type WorktreePrepEvent,
  } from "$lib/remote-worktree";
  import Banners, { type Deferred, type Ended, type Reconnect, type WorktreePrepBar } from "$lib/term/Banners.svelte";
  import { attachKeyHandler } from "$lib/term/key-handlers";
  import { patchTerminalComposition } from "$lib/term/ime-composition-fix";
  import { attachHandheldInput } from "$lib/term/handheld-input";
  import { flipViewOf } from "$lib/pane/flip-view.svelte.js";
  import { installHiddenRenderGate, type HiddenRenderGate } from "$lib/term/hidden-render-gate";
  import { SnippetSuggestController } from "$lib/term/snippet-suggest.svelte";
  import { RendererAddons } from "$lib/term/renderer-addons";
  import { attachOsc52, attachProgramNotify, attachSetupOsc } from "$lib/term/osc-handlers";
  import { attachReplayMute } from "$lib/term/replay-mute";
  import { replayResize, replaySplitAt } from "$lib/term/replay-split";
  import { LOST_NOTICE_MS, dismissesLostNotice, lostNoticeOf, type LostNotice } from "$lib/term/lost-notice";
  import { registerTermActions } from "$lib/term-actions";
  import {
    claimSizeOnAttach,
    domRendererOnly,
    dropFitOnOwnerLoss,
    focusLineField,
    handheld,
    lineFieldMode,
    mobileLayout,
    setFitThisDevice,
    setStickyCtrl,
    stickyCtrl,
    viewerEligible,
    viewerWanted,
    pageShown,
  } from "$lib/app/mobile.svelte.js";
  import { ctrlOf } from "$lib/mobile/keys";
  import { TouchGestures, attachTouchGestures, wheelLines } from "$lib/term/touch-gestures";
  import { encodingSuffix, watchMouseEncoding } from "$lib/term/mouse-encoding";
  import { parkDelayMs } from "$lib/mobile/policy";
  import type { AskBlockRef } from "$lib/ask-ai";
  import { classifyInput, mergeSource, type InputContext, type InputSource } from "$lib/term/input-source";
  import {
    claimsOwnership,
    ownerFromEvent,
    ownerFromReply,
    shouldSendInput,
    viewSize,
    type OwnerView,
    type TermSize as OwnerSize,
  } from "$lib/term/size-owner";
  import { noticeActions, noticeSide, outlineBox, placeCard, type NoticeAction, type Size2 } from "$lib/term/size-notice";
  import { clearShrunk, markShrunk, reclaimAll, shrunkCount } from "$lib/app/size-notice.svelte.js";
  import { isRemote, listen } from "$lib/ipc";
  import { askAiAboutBlock } from "$lib/app/ask-ai.svelte.js";
  import { logPathOf } from "$lib/session-logs";
  import { createScrollbackActions } from "$lib/term/scrollback-actions";
  import { createBlockTarget } from "$lib/term/block-target";
  import SizeNotice from "$lib/term/SizeNotice.svelte";
  import PasteConfirm from "$lib/term/PasteConfirm.svelte";
  import { registerSearch } from "$lib/search-registry";
  import { TermSearch } from "$lib/term/search";
  import { screenPushDelay, screenTail } from "$lib/term/screen-tail";
  import type { SnippetSource } from "$lib/pane/pane-menu";
  import SnippetSuggest from "$lib/SnippetSuggest.svelte";

  let {
    pane,
    visible = true,
    active = true,
    onexit,
    onclose,
    onactivity,
    onstatus,
    onbroadcast,
    onsession,
    ontitle,
    onshell,
    ontmux,
    oncommand,
    onrequestedit,
    onopenpath,
    onmenu,
    confirmHostKey,
    promptPassword,
    promptPassphrase,
  }: {
    pane: PaneSpec;
    /** 탭이 보이는가 — 같은 탭의 비포커스 패널도 보이므로 `active` 와 섞으면 분할 탭을 다시 열 때 옛 크기로 남는다 */
    visible?: boolean;
    /** 키 입력을 받는가 (= 탭 활성 && 패널 활성) */
    active?: boolean;
    onexit?: () => void;
    onclose?: () => void;
    onactivity?: () => void;
    onstatus?: (paneId: string, status: PaneStatus | null) => void;
    /** 동시 입력 — `true` 면 자기 write 를 하지 않는다(브로드캐스트 목록에 자기도 있어 두 번 친다) */
    onbroadcast?: (data: string, source: InputSource) => boolean;
    onsession?: (paneId: string, sessionId: number | null) => void;
    ontitle?: (paneId: string, title: string) => void;
    onshell?: (paneId: string, shell: string) => void;
    ontmux?: (paneId: string, name: string) => void;
    oncommand?: (paneId: string, command: string | null) => void;
    onrequestedit?: () => void;
    onopenpath?: (target: NonNullable<ResolvedPath>, line?: number) => void;
    /** 우클릭 메뉴를 열어 달라 — 여기서 그리면 `.pane-box` 의 `isolation: isolate` 탓에 이웃 타일에 덮인다 */
    onmenu?: (
      x: number,
      y: number,
      ctx: {
        link: string | null;
        hasSelection: boolean;
        hasOutput: boolean;
        snippet: SnippetSource | null;
        ask: AskBlockRef | null;
        selection: string | null;
      },
    ) => void;
    confirmHostKey?: ConfirmHostKey;
    promptPassword?: PromptPassword;
    promptPassphrase?: PromptPassphrase;
  } = $props();

  // ── AI 컨텍스트 미러링 ──
  // 공유가 켜진 패널(`aiOn`)만 밀어 올린다(프라이버시) — 로컬은 타일 토글, 원격은 호스트 AI 권한 `read` 이상. `optedIn:false` 는 서버 쪽 데이터를 지운다.
  // 거울 키는 창 이관 · 리로드를 넘는 `historyStreamId` 다 — AI 의 `(session, blockId)` 참조가 타일이 창을 옮겨도 산다.
  const contextKeyOf = $derived(pane.historyStreamId ?? pane.id);
  const codeOf = $derived(tileCode(currentWindowLabel(), pane.id));

  // 원격 창의 타일은 시청자다 — 세션을 열거나 닫지 않고 자동 실행 · 설정 스크립트 · 재접속 · 체크포인트 · 거울 보고를 하지 않는다
  // (원격이 거울을 덮거나 지우면 AI 가 보는 타일이 엉킨다).
  const viewer = isRemote;

  const aiOn = $derived(!viewer && paneAiReadable(pane));
  const hostAliasOf = $derived(aiHostAlias(pane));

  // tmux 타일에는 셸 통합 파서를 아예 붙이지 않는다(출력을 거르지 않는다) — 반쯤 맞는 블록 이력을 남기지 않는다.
  const screenOnly = $derived(pane.tmux !== undefined && pane.tmux !== "");

  // 새 타일은 `pane.tmux` 를 접속 답에서야 안다 — 그새 붙은 파서를 걷고 옛 상태 · 명령이 헤더에 굳지 않게 지운다.
  $effect(() => {
    if (!screenOnly || !shell) return;
    shell.dispose();
    shell = null;
    onstatus?.(pane.id, null);
    oncommand?.(pane.id, null);
  });

  function pushContext() {
    if (!aiOn) return;
    if (shell) {
      void updateSessionContext(contextKeyOf, shell.status(), shell.last(), shell.tail(400));
      return;
    }
    // tmux 는 파서가 없어도 스크롤백 꼬리를 올린다 — MCP `mode:"screen"` 설명이 get_scrollback 으로 읽으라고 약속한다.
    if (!screenOnly || !term) return;
    void updateSessionContext(contextKeyOf, null, null, screenTail(term.buffer.active, 400));
  }

  let screenPushTimer: ReturnType<typeof setTimeout> | undefined;
  let screenPendingSince: number | null = null;

  function scheduleScreenPush() {
    if (!screenOnly || shell || !aiOn) return;
    const now = Date.now();
    if (screenPendingSince === null) screenPendingSince = now;
    clearTimeout(screenPushTimer);
    screenPushTimer = setTimeout(() => {
      screenPushTimer = undefined;
      screenPendingSince = null;
      if (disposed) return;
      pushContext();
    }, screenPushDelay(now, screenPendingSince));
  }

  function cancelScreenPush() {
    clearTimeout(screenPushTimer);
    screenPushTimer = undefined;
    screenPendingSince = null;
  }

  // 마운트가 아니라 생성 때 정한다 — 공유 `$effect` 가 `onMount` 보다 먼저 돌고, `mount()` 가 `pane.restore` 를 지운다.
  let carriedHistory = untrack(() => pane.restore !== undefined);

  // `$state` 로 두면 아래 `$effect` 가 제가 쓴 값을 읽어 스스로를 깨운다.
  let prevShared = false;

  // 새 페이지의 첫 꺼짐은 세션이 서기 전엔 보내지 않는다 — 붙기가 토글을 되살리기 전의 꺼짐이 서버 거울을 지운다.
  let mirrorAnnounced = false;

  $effect(() => {
    if (!hasSession(pane.kind) || viewer) return;
    const key = contextKeyOf;
    const on = aiOn;
    // `sessionOf` 를 읽어 세션 id 가 바뀔 때도 다시 돈다 — 라우팅 표가 늘 산 연결을 가리키게.
    const live = sessionOf(pane.id);
    const sshSessionId = pane.kind === "ssh" ? (live ?? undefined) : undefined;
    // 붙기는 토글을 되살린 **뒤** 세션을 알린다 — 같은 틱이라 첫 보고가 켜진 채 나간다.
    if (!shouldReportMirror(on, mirrorAnnounced, live !== null && live !== undefined)) return;
    mirrorAnnounced = true;
    const reported = reportSession(
      key,
      paneName(pane, tr),
      pane.kind,
      codeOf,
      on,
      sshSessionId,
      // 안 보내면 AI 가 tmux 타일의 빈 이력을 "아직" 으로 읽는다(MCP `mode:"screen"`).
      screenOnly,
      {
        workspaceId: tabOfPane(pane.id)?.workspaceId,
        workspaceName: workspaceList().find((w) => w.id === tabOfPane(pane.id)?.workspaceId)?.name,
        tabKey: tabOfPane(pane.id)?.tabKey,
      },
      hostAliasOf,
    );
    if (!on) {
      prevShared = false;
      return;
    }
    pushContext();
    // OFF→ON 전이(또는 이관 마운트)에서만 링 이력을 한 번 심는다 — `report_session` 이 끝난 뒤여야 한다(키가 없으면 Rust 가 버린다).
    // 증분과 겹쳐도 Rust `push_block` 이 id 로 upsert 한다.
    const turnedOn = !prevShared || carriedHistory;
    prevShared = true;
    if (!turnedOn) return;
    carriedHistory = false;
    const blocks = blocksOf(pane.id);
    if (blocks.length > 0) void reported.then(() => pushSessionBlocks(key, blocks));
  });

  // 로컬 "AI 읽기 허용" 을 세션 메타에 남긴다 — 세션이 선 뒤에만(마운트 직후의 `false` 가 붙기 전에 서버 값을 지운다).
  let aiReadSent: string | null = null;
  $effect(() => {
    if (pane.kind !== "local" || viewer) return;
    const live = sessionOf(pane.id);
    const on = aiOn;
    if (live === null || live === undefined) return;
    const mark = `${live}:${on}`;
    if (aiReadSent === mark) return;
    aiReadSent = mark;
    setSessionAiRead(contextKeyOf, on);
  });

  const ACTIVITY_THROTTLE_MS = 500;
  let lastActivity = 0;

  const REFIT_DEBOUNCE_MS = 80;

  let lastAgentTick = 0;

  // 에이전트 상태 점은 출력 시각으로 정하지 않는다 — 포커스 보고 · 크기 맞춤의 다시 그리기도 출력이다.
  function reportActivity() {
    const now = Date.now();
    if (now - lastAgentTick >= ACTIVITY_THROTTLE_MS) {
      lastAgentTick = now;
      agentOutput(pane);
    }
    if (visible || !onactivity) return;
    if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    onactivity();
  }

  let container: HTMLDivElement;
  let mountError = $state<string | null>(null);

  // ── 출력만 복사 ──
  // 결과는 버퍼가 아니라 토스트로 — 버퍼에 찍으면 안내 줄이 다음 명령의 출력 구간에 끼어든다.
  const COPY_MESSAGE: Record<CopyResult, Key> = {
    ok: "pane.term.copy.ok",
    empty: "pane.term.copy.empty",
    denied: "pane.term.copy.denied",
    none: "pane.term.copy.none",
  };

  let toast = $state<{ text: string; ok: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const TOAST_MS = 2500;

  function showToast(result: CopyResult) {
    showNote(tr(COPY_MESSAGE[result]), result === "ok");
  }

  function showNote(text: string, ok: boolean) {
    toast = { text, ok };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), TOAST_MS);
  }

  // ── 스크롤백 내보내기 · 세션 로그 열기 ──
  const { saveScrollback, openThisLog } = createScrollbackActions({
    get term() {
      return term;
    },
    get pane() {
      return pane;
    },
    get logPath() {
      return logPath;
    },
  });

  // ── 우클릭 · 클립보드 ──
  let hoveredLink: string | null = null;
  // 우클릭 순간의 스냅샷 — 메뉴 항목이 돌 때 커서는 메뉴 위라 `hoveredLink` 는 이미 `null` 이다.
  let menuLink: string | null = null;

  // ── 우클릭한 줄 → 명령 블록 ──
  const { snippetSourceAt, askRefAt, blockAnchorOf } = createBlockTarget({
    get paneId() {
      return pane.id;
    },
    get shell() {
      return shell;
    },
  });

  // ── 입력 중 스니펫 제안 ──
  const paneAlias = $derived(
    pane.kind === "ssh" && pane.alias?.trim() ? pane.alias.trim() : null,
  );

  const suggest = new SnippetSuggestController({
    get term() {
      return term;
    },
    get container() {
      return container ?? null;
    },
    get disposed() {
      return disposed;
    },
    get shell() {
      return shell;
    },
    get active() {
      return active;
    },
    get alias() {
      return paneAlias;
    },
  });

  const clip = createClipboardController({
    get term() {
      return term;
    },
    get active() {
      return active;
    },
    showNote,
    pasteToTerm,
  });

  // 입력 출처: 붙여넣기 · 키 이벤트 동안 `onData` 로 나온 글은 내용이 터미널 응답 모양이어도 사람 것이다(Ctrl+F3 = `ESC[1;5R`).
  // 포인터 이벤트 동안의 글은 마우스다 — 휠이 바뀐 방향키(`ESC[A`)가 크기 주인을 바꾸지 않게.
  // 불리언은 이벤트 없이 코드가 부르는 동기 구간(`pasteToTerm` · `sendAsKey`), `*Ev` 는 캡처 리스너가 적어 둔 DOM 이벤트다.
  let inputPasting = false;
  let inputKeyEvent = false;
  let keyEv: Event | null = null;
  let pasteEv: Event | null = null;
  let pointerEv: Event | null = null;
  // 마이크로태스크로 깃발을 내리면 안 된다 — 신뢰된 이벤트는 리스너 사이에도 마이크로태스크가 돌아 xterm 의 처리기 전에 꺼진다.
  const delivering = (ev: Event | null) => ev !== null && ev.eventPhase !== Event.NONE;
  const inputContext = (): InputContext => ({
    pasting: inputPasting || delivering(pasteEv),
    keyEvent: inputKeyEvent || delivering(keyEv),
    pointer: delivering(pointerEv),
  });

  // `paste()` 는 `onData` 를 동기로 낸다 — 그래서 이 구간 표시로 출처가 갈린다.
  function pasteToTerm(text: string) {
    inputPasting = true;
    try {
      term?.paste(text);
    } finally {
      inputPasting = false;
    }
  }

  $effect(() => {
    if (clip.pastePrompt) clip.pasteConfirmBtn?.focus({ preventScroll: true });
  });

  let term: Terminal | null = null;
  let renderGate: HiddenRenderGate | null = null;
  let fit: FitAddon | null = null;
  let session: SessionHandle | null = null;
  // 손잡이가 서기 전에 xterm 이 낸 입력(셸 시작의 `ESC[6n` 답)을 모았다가 보낸다 — 버리면 셸이 첫 출력을 못 내고 멈춘다
  // (서버는 창이 붙은 동안 대신 답하지 않는다 — 두 번 답하면 남는 답이 입력으로 샌다).
  let opening = false;
  let earlyInput = "";
  let earlySource: InputSource | null = null;
  const EARLY_INPUT_CAP = 4096;
  // 셸 통합 · 트리거는 세션이 아니라 터미널에 붙는다 — 재연결로 세션이 갈려도 버퍼 좌표가 그대로 이어진다.
  let shell: ShellIntegration | null = null;

  // ── 블록 리치 보기 카드 ──
  let blockView = $state<BlockViewOpen | null>(null);
  let termRoot = $state<HTMLDivElement | null>(null);

  function openBlockView(blockId: number, rowRect: DOMRect): void {
    const block = blocksOf(pane.id).find((b) => b.id === blockId);
    if (!block || !termRoot) return;
    const lines = shell?.blockOutput(blockId) ?? null;
    const text = (lines ?? [...block.excerpt.head, ...block.excerpt.tail]).join("\n");
    const host = termRoot.getBoundingClientRect();
    blockView = {
      blockId,
      command: block.commandLine,
      exit: block.exit,
      durationMs: blockDurationMs(block),
      text,
      partial: lines === null && block.excerpt.truncated,
      row: {
        top: rowRect.top - host.top,
        bottom: rowRect.bottom - host.top,
        left: rowRect.left - host.left,
        right: rowRect.right - host.left,
      },
    };
  }

  function blockOriginNow(blockId: number): { x: number; y: number } | null {
    if (!termRoot) return null;
    const btn = termRoot.querySelector<HTMLElement>(`.aynx-rich-view[data-block-id="${blockId}"]`);
    const row = btn?.closest<HTMLElement>(".aynx-block-row, .aynx-fail-row");
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const host = termRoot.getBoundingClientRect();
    if (r.height <= 0 || r.bottom <= host.top || r.top >= host.bottom) return null;
    return { x: (r.left + r.right) / 2 - host.left, y: (r.top + r.bottom) / 2 - host.top };
  }

  function closeBlockView(): void {
    blockView = null;
    if (active) term?.focus();
  }
  let triggers: TriggerHighlighter | null = null;
  let pathLinks: { dispose(): void } | null = null;

  function pathPlace(): PathLinkPlace | null {
    return pathLinkPlace(pane, shell?.cwd() ?? null);
  }
  let disposed = false;
  // 세션이 붙을 때 미리 받아 둔다 — ⋯ 메뉴 항목은 `PaneHost` 의 `$derived` 라 `await` 할 수 없다.
  let logPath: string | null = null;

  async function refreshLogPath(handle: SessionHandle) {
    const path = await logPathOf(handle.kind, handle.id);
    if (!disposed && session?.id === handle.id) logPath = path;
  }

  // ── 터미널 검색 ──
  const termSearch = new TermSearch({
    get term() {
      return term;
    },
    get disposed() {
      return disposed;
    },
    get shell() {
      return shell;
    },
  });

  $effect(() => {
    if (!active) {
      termSearch.keptEvent("blur");
      suggest.closeSuggest();
    }
  });

  $effect(() => {
    if (!settings.inlineSnippets) suggest.closeSuggest();
  });

  // ── 렌더러 애드온 ──
  const addons = new RendererAddons({
    get term() {
      return term;
    },
    get disposed() {
      return disposed;
    },
  });

  $effect(() => {
    if (settings.inlineImages) addons.loadImages();
    else addons.unloadImages();
  });

  let reconnect = $state<Reconnect | null>(null);

  let deferred = $state<Deferred | null>(null);
  let unconnect: (() => void) | null = null;

  let ended = $state<Ended | null>(null);

  let lost = $state<LostNotice | null>(null);
  let lostTimer: ReturnType<typeof setTimeout> | undefined;

  function showLost(n: LostNotice) {
    lost = n;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => (lost = null), LOST_NOTICE_MS);
  }

  // 마크업의 캡처 단계에서 받는다 — xterm 이 키를 삼키기 전.
  function dismissLostOnKey(ev: KeyboardEvent) {
    if (lost && dismissesLostNotice(ev.key)) lost = null;
  }
  function dismissLostOnPointer() {
    if (lost) lost = null;
  }

  // `reconnect` 는 넣지 않는다 — 곧 스스로 다시 붙는 중이라 Enter 가 끼어들 이유가 없다.
  function deadState(): Ended | Deferred | null {
    return ended ?? deferred;
  }

  // 첫 접속과 같은 `startSession(true)` 경로여야 TOFU 확인 · 비밀번호 모달이 뜬다.
  async function reconnectEnded() {
    if (disposed || !ended || ended.connecting) return;
    const first = ended.unopened === true;
    const fromTmux = ended.tmuxExit === true;
    ended = { connecting: true, note: null, unopened: first, tmuxExit: fromTmux };

    const result = await startSession(true);
    if (disposed) return;

    if (result.ok) {
      ended = null;
      notice(
        fromTmux
          ? tr("pane.notice.tmux_reattached")
          : first
            ? tr("pane.notice.connected")
            : tr("pane.notice.reconnected"),
      );
      if (active) term?.focus();
      return;
    }

    const message = result.error === null ? null : describeOpenError(result.error, tr);
    const hint = result.error === null ? null : openErrorHintOf(result.error, tr);
    ended = { connecting: false, note: message, hint, unopened: first, tmuxExit: fromTmux };
    if (message) notice(hint ? `${message}\n${hint}` : message, "91");
  }

  function notice(msg: string, sgr = "90") {
    const body = msg
      .split("\n")
      .map((line) => `\x1b[${sgr}m${line}\x1b[0m`)
      .join("\r\n");
    term?.write(`\r\n${body}\r\n`);
  }

  // 이관 버퍼를 소스 창 크기로 재생하는 동안 refit 을 막는다 — 다른 크기로 맞추면 리플로로 아직 안 심은 마커 거리가 어긋난다.
  let restoring = false;

  let refitSkipped = false;
  let resumeRefit: (() => void) | null = null;

  // 폰의 대화 면에서는 상자를 따라가지 않는다 — 키 띠가 숨고 설 때마다 PTY 크기가 흔들려 TUI 가 다시 그려진다.
  const refitParked = () => mobileLayout() && flipViewOf(pane.id) === "convo";

  $effect(() => {
    const previewing = dropPreviewing() || refitParked();
    untrack(() => {
      if (!previewing && refitSkipped) resumeRefit?.();
    });
  });

  function refit() {
    if (!term || !fit || !container || restoring) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    if (dropPreviewing() || refitParked()) {
      refitSkipped = true;
      return;
    }
    // 보류한 refit 은 트랜지션 도착까지 기다린다 — 포커스 rAF 도 중간 크기를 보내면 안 된다.
    if (refitSkipped && layoutAnimating()) {
      resumeRefit?.();
      return;
    }
    refitSkipped = false;
    // 주인이 아니면 주인의 크기로 그리되 제 상자 크기는 보낸다 — 서버가 적어 두었다가 이 쪽이 치는 순간 건다.
    if (!sizeOwner && ownerSize) {
      const fitted = fit.proposeDimensions();
      const want = viewSize({ owner: false, size: ownerSize }, null);
      if (want && (term.cols !== want.cols || term.rows !== want.rows)) term.resize(want.cols, want.rows);
      if (fitted && fitted.cols > 0 && fitted.rows > 0) session?.resize(fitted.cols, fitted.rows);
      revealCursorSoon();
      measureNoticeSoon();
      return;
    }
    fit.fit();
    session?.resize(term.cols, term.rows);
    if (noticeDrawn) measureNoticeSoon();
  }

  // ── 크기 주인 ──
  // 주인이 아닌 쪽은 xterm 의 터미널 응답(DSR · DA · DECRQM · OSC 색)을 보내지 않는다 — 둘 다 답하면 셸 입력에 두 번 샌다.
  let sizeOwner = $state(true);
  let ownerSize = $state<OwnerSize | null>(null);

  let revealPending = false;
  function revealCursorSoon() {
    if (revealPending) return;
    revealPending = true;
    requestAnimationFrame(() => {
      revealPending = false;
      const box = container;
      const t = term;
      if (sizeOwner || !box || !t?.element || t.rows <= 0) return;
      if (box.scrollHeight <= box.clientHeight) return;
      const rowH = t.element.clientHeight / t.rows;
      const cursorTop = t.buffer.active.cursorY * rowH;
      if (cursorTop < box.scrollTop) box.scrollTop = Math.max(0, cursorTop - rowH);
      else if (cursorTop + rowH > box.scrollTop + box.clientHeight) box.scrollTop = cursorTop + 2 * rowH - box.clientHeight;
    });
  }

  function applyOwner(v: OwnerView) {
    const same =
      v.owner === sizeOwner &&
      (v.size === null ? ownerSize === null : ownerSize !== null && v.size.cols === ownerSize.cols && v.size.rows === ownerSize.rows);
    sizeOwner = v.owner;
    ownerSize = v.owner ? null : v.size;
    if (v.primary !== undefined) ownerPrimary = v.primary;
    if (!same) refit();
  }

  // ── 다른 기기 크기 안내 ──
  let ownerPrimary = $state<boolean | undefined>(undefined);
  let noticeBox = $state<Size2 | null>(null);
  let noticeDrawn = $state<Size2 | null>(null);
  let noticeCardH = $state(118);
  const NOTICE_CARD_W = 300;
  let noticePop = $state(false);
  // 글자 위에 겹친 카드만 닫힌다 — 닫으면 꼬리표 단추로 돌아가고, 주인 아님이 끝나면 풀린다.
  let noticeDismissed = $state(false);
  let claimAfterAttach = false;

  const foreignShown = $derived(!sizeOwner && ownerSize !== null && !mobileLayout());
  const noticeKind = $derived(noticeSide(isRemote, ownerPrimary));
  const noticeOutline = $derived(noticeBox && noticeDrawn ? outlineBox(noticeBox, noticeDrawn) : null);
  const noticeCard = $derived.by(() => {
    if (!foreignShown || !active || !noticeBox || !noticeDrawn) return null;
    const p = placeCard(noticeBox, noticeDrawn, { width: NOTICE_CARD_W, height: noticeCardH });
    return p?.side === "over" && noticeDismissed ? null : p;
  });
  const noticeButtons = $derived(noticeActions(shrunkCount(), !viewer || viewerEligible()));

  $effect(() => {
    const on = foreignShown;
    const id = pane.id;
    untrack(() => {
      if (on) markShrunk(id, reclaimSize);
      else {
        clearShrunk(id);
        noticePop = false;
        noticeDismissed = false;
      }
    });
    return () => clearShrunk(id);
  });

  $effect(() => {
    if (!noticePop) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.(".size-pop, .size-tag")) noticePop = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") noticePop = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  let noticeMeasurePending = false;
  function measureNoticeSoon() {
    if (noticeMeasurePending) return;
    noticeMeasurePending = true;
    requestAnimationFrame(() => {
      noticeMeasurePending = false;
      const box = container;
      const scr = term?.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!box || !scr || sizeOwner) {
        noticeBox = null;
        noticeDrawn = null;
        return;
      }
      noticeBox = { width: box.clientWidth, height: box.clientHeight };
      noticeDrawn = { width: scr.offsetWidth, height: scr.offsetHeight };
    });
  }

  // 셸에는 아무것도 쓰지 않는다(서버 `claim_size`).
  async function reclaimSize(): Promise<void> {
    noticePop = false;
    const s = session;
    if (!s || !fit || sizeOwner) return;
    if (viewer && !viewerEligible()) {
      claimAfterAttach = true;
      setFitThisDevice(true);
      return;
    }
    const fitted = fit.proposeDimensions();
    if (!fitted || !(fitted.cols > 0) || !(fitted.rows > 0)) return;
    const owner = await s.claimSize(fitted.cols, fitted.rows);
    if (owner && session === s && !disposed) applyOwner({ owner: true, size: null });
  }

  function runNotice(a: NoticeAction) {
    if (a.act === "all") void reclaimAll();
    else void reclaimSize();
    if (active) term?.focus();
  }

  function dismissNotice() {
    noticeDismissed = true;
    if (active) term?.focus();
  }

  // 포커스는 활성 패널에만 — 분할 탭의 모든 패널이 부르면 마지막 패널이 훔친다.
  // WebGL 은 숨길 때 떼고, 보일 때 refit 과 같은 rAF 안에서 붙인다 — 레이아웃 확정 전이면 캔버스가 0×0 으로 잡힌다.
  $effect(() => {
    const useLigatures = settings.ligatures;
    // 합자는 WebGL 렌더러에서만 그려진다(xterm 6). 폰 · 터치 기기는 DOM 렌더러만(모바일 GPU 컨텍스트 상실 — `$lib/mobile/policy`).
    const useWebgl = (settings.webgl || useLigatures) && !domRendererOnly();
    if (!visible) {
      // 문을 먼저 닫는다 — WebGL dispose 가 세운 DOM 렌더러가 숨은 채 모든 행을 그리며 메인 스레드를 수 초 잡는다.
      renderGate?.hide();
      addons.unloadLigatures();
      addons.unloadWebgl();
      return;
    }
    const takeFocus = active;
    const raf = requestAnimationFrame(() => {
      // 렌더러를 먼저 정하고 잰다 — 칸 폭이 렌더러마다 달라, 거꾸로면 탭을 볼 때마다 리플로 · 원격 resize 가 두 번 나간다.
      if (useWebgl) addons.loadWebgl();
      else addons.unloadWebgl();
      renderGate?.show();
      refit();
      if (useLigatures && addons.hasWebgl) void addons.loadLigatures();
      else addons.unloadLigatures();
      // 묻는 창이 떠 있으면 포커스를 가져가지 않는다 — Escape · Enter 가 모달 대신 셸로 간다.
      // 조건을 rAF 안에서 읽는다 — 밖에서 읽으면 모달이 뜨고 닫힐 때마다 이 효과와 refit 이 다시 돈다.
      if (takeFocus && !promptsBlocking()) term?.focus();
    });
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    const list = settings.triggers;
    triggers?.setTriggers(list);
  });

  // 값을 `term` 검사보다 먼저 읽어야 첫 실행에서도 의존성이 잡힌다. scrollback 은 생성 시 1회라 여기 없다.
  $effect(() => {
    const theme = settings.termThemeEffective;
    const fontFamily = settings.fontFamilyEffective;
    const fontSize = settings.termFontSize;
    const cursorStyle = settings.cursorStyle;
    // `allowTransparency` 가 꺼져 있으면 WebGL 이 배경을 불투명으로 보고 글자 뒤 픽셀을 지운다.
    // 런타임에 바꿔도 WebGL 애드온을 다시 붙일 필요는 없다(애드온이 옵션 변경에 아틀라스 · 클리어 색을 다시 읽는다).
    const transparent = settings.termOpacity < 100;
    if (!term) return;
    term.options.allowTransparency = transparent;
    term.options.theme = theme;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    term.options.cursorStyle = cursorStyle;
    // 한글 조합 중엔 커서 대신 `.composition-view` 가 보인다 — 모양 · 색을 넘겨 theme.css 가 커서처럼 그린다.
    if (container) {
      container.dataset.cursor = cursorStyle;
      container.style.setProperty("--ime-cursor", theme.cursor ?? theme.foreground ?? "#fff");
      container.style.setProperty("--ime-accent", theme.cursorAccent ?? theme.background ?? "#000");
      container.style.setProperty("--ime-fg", theme.foreground ?? "#fff");
      container.style.setProperty("--ime-bg", theme.background ?? "#000");
    }
    refit();
  });

  // ── 출력 역압 ──
  // 역압 상태는 세션이 아니라 터미널에 붙는다 — 재연결해도 카운터를 잇고 `gated` 만 새 세션 기준으로 되돌린다.
  let received = 0;
  let pending = 0;
  let unacked = 0;
  let gated = false;

  // 화면에 반영된 출력 오프셋 — Rust 출력 꼬리 링(`output.rs` `TailRing`)과 같은 축. 채널마다 새로 만든다(옛 채널의 늦은 덩어리가 섞이지 않게).
  type OutCount = {
    base: number | null;
    parsed: number;
    acked?: number;
    received?: number;
    dead?: boolean;
  };

  // ACK 크레딧(`server::credit`) — 서버의 예산(1 MiB)보다 충분히 잘게.
  const ACK_STEP = 64 * 1024;
  function ackParsed(count: OutCount) {
    const s = session;
    if (!s?.ack || count !== outCount || count.base === null) return;
    const consumed = count.base + count.parsed;
    if (consumed - (count.acked ?? count.base) < ACK_STEP) return;
    count.acked = consumed;
    s.ack(consumed);
  }
  let outCount: OutCount | null = null;

  // ── 떨어진 세션에 다시 붙기 ──
  // 재생 구간은 이미 일어난 출력이다 — OSC 9/777 알림 · OSC 52 · DSR/DA 응답 · 벨을 다시 일으키지 않는다.
  let replaying = false;
  let replayUntil: number | null = null;
  let replayGuard: ReturnType<typeof setTimeout> | undefined;
  // 붙기 결과 전 덩어리는 모았다가 재생 끝에서 나눠 쓴다 — 통째로 재생으로 보면 그 사이 실시간 질의(`ESC[6n`)를 삼켜 셸이 멈춘다.
  // 서버가 "붙기 완료 ACK 전" 까지 답하게 하는 안은 쓰지 않는다 — 창과 서버가 같은 질의에 둘 다 답할 틈이 생긴다.
  let held: { chunk: Uint8Array; done: (parsed: number, last: boolean) => void }[] | null = null;
  let attachCount: OutCount | null = null;
  let attachWritten = 0;
  let replaySized = false;
  const REPLAY_GUARD_MS = 10_000;
  // 옛 페이지의 열기가 `SPAWN_LOCK` 에 줄 서 있으면 몇 초 걸린다 — 넉넉히 4.5초.
  const OPEN_RETRIES = 15;
  const OPEN_RETRY_MS = 300;
  const CHECKPOINT_INTERVAL_MS = 30_000;
  const CHECKPOINT_FIRST_MS = 5_000;

  function exitNote(reason: SessionExitReason): string | null {
    if (reason.code === "server-stopped") return tr("pane.notice.server_stopped");
    if (reason.code === "exit" && typeof reason.exitCode === "number" && reason.exitCode !== 0)
      return tr("pane.notice.exit_code", { code: reason.exitCode });
    return reason.message;
  }

  function startReplay() {
    replaying = true;
    replayUntil = null;
    clearTimeout(replayGuard);
    replayGuard = setTimeout(endReplay, REPLAY_GUARD_MS);
  }

  function endReplay() {
    replaying = false;
    replayUntil = null;
    clearTimeout(replayGuard);
    // 재생 끝 덩어리의 콜백 안에서 타일 크기로 돌린다 — 뒤 실시간분(서버 resize 뒤 ConPTY 다시 그림)이 타일 크기에서 파싱되게.
    if (replaySized) {
      replaySized = false;
      restoring = false;
      if (!disposed) refit();
    }
  }

  function endReplayIfDone(count: OutCount) {
    if (!replaying || replayUntil === null || count.base === null) return;
    if (count.base + count.parsed >= replayUntil) endReplay();
  }

  // 재생 끝이 덩어리 안이면 둘로 나눈다 — xterm 은 쓴 순서대로 파싱 · 콜백하므로 앞 몫의 콜백이 재생 표시를 끈 뒤 뒤 몫이 파싱된다.
  function writeAttached(t: Terminal, count: OutCount, chunk: Uint8Array, done: (parsed: number, last: boolean) => void) {
    const off = (count.base ?? 0) + attachWritten;
    attachWritten += chunk.length;
    const cut = count.base === null ? null : replaySplitAt(off, chunk.length, replayUntil, replaying);
    if (cut !== null) {
      t.write(chunk.subarray(0, cut), () => done(cut, false));
      t.write(chunk.subarray(cut), () => done(chunk.length - cut, true));
      return;
    }
    t.write(chunk, () => done(chunk.length, true));
  }

  // Tauri Channel 은 시도마다 session.ts 가 새로 만든다 — 재사용 금지.
  function onData(buf: ArrayBuffer, count?: OutCount) {
    const t = term;
    if (!t) return;
    if (count?.dead) return;
    if (count) count.received = (count.received ?? 0) + buf.byteLength;
    if (received === 0)
      console.log("[aynx] 첫 출력 수신:", buf?.constructor?.name, buf?.byteLength ?? buf);
    received++;
    reportActivity();
    aiVeil?.output();
    scheduleScreenPush();

    const chunk = new Uint8Array(buf);
    pending += chunk.length;
    unacked += chunk.length;

    const src = session;
    const willGate = !gated && src !== null && pending > HIGH_WATER;

    // 수문을 닫을 때와 닫힌 동안 온 잔여 출력엔 반드시 차감을 단다 — 늦게 온 청크를 ACK_INTERVAL 까지 모으면
    // pending 이 LOW_WATER 아래로 못 내려가 세션이 멈춘 채 남는다. 콜백은 덩어리마다 — 오프셋이 정확해야 이관 재생이 겹치지 않는다.
    const n = chunk.length;
    let acked = 0;
    if (unacked >= ACK_INTERVAL || willGate || gated) {
      acked = unacked;
      unacked = 0;
    }
    const done = (parsed: number, last: boolean) => {
      if (count) {
        count.parsed += parsed;
        if (replaying) endReplayIfDone(count);
        ackParsed(count);
      }
      if (!last || acked === 0) return;
      pending -= acked;
      if (gated && pending < LOW_WATER) {
        gated = false;
        session?.resume();
      }
    };
    if (count && count === attachCount) {
      if (held && count.base === null) held.push({ chunk, done });
      else writeAttached(t, count, chunk, done);
    } else {
      t.write(chunk, () => done(n, true));
    }

    if (willGate && src) {
      gated = true;
      src.pause();
    }
  }

  // ── 세션 열기 · 자동 재연결 ──
  // 터미널은 dispose 하지 않는다 — 스크롤백을 둔 채 새 세션의 입출력만 다시 배선한다.
  type Attempt = { ok: true } | { ok: false; error: unknown };

  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  // `clearTimers()` 에 넣지 않는다 — 재연결 루프가 매 시도마다 그것을 부른다.
  let openTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(retryTimer);
    clearInterval(tickTimer);
    retryTimer = undefined;
    tickTimer = undefined;
  }

  // 원격 첫 입력 재료 — 접속이 설 때까지 매 시도에 싣고 선 뒤 비운다(자동 재연결에 실으면 명령이 두 번 돈다).
  let sshStart: {
    cwd: string;
    command: string | null;
    worktree?: { repo: string; name: string; ticket: string } | null;
    setup?: { projectId: string; nonce: string } | null;
  } | null = null;

  // ── 원격 새 워크트리의 준비 ──
  let wtTicket: string | null = null;
  let wtListening: Promise<void> | null = null;
  let wtUnlisten: (() => void) | null = null;
  let wtProjectId: string | null = null;
  // `ready` 순간엔 이 타일의 세션이 아직 없어 목록이 `offline` 이 된다 — 세션이 선 뒤 다시 읽는다.
  let wtReloadProject: string | null = null;
  let wtPrep = $state<WorktreePrepBar | null>(null);

  function onWorktreePrep(ev: WorktreePrepEvent): void {
    if (disposed) return;
    switch (ev.phase) {
      case "preparing":
        notice(tr("pane.worktree.preparing", { path: ev.path }));
        return;
      case "ask":
        wtPrep = { kind: "ask", repo: ev.repo, branch: ev.branch || "main", busy: false };
        return;
      case "committing":
        if (wtPrep?.kind === "ask") wtPrep = { ...wtPrep, busy: true };
        return;
    }
    if (!isFinalPrepPhase(ev.phase)) return;
    wtTicket = null;
    wtUnlisten?.();
    wtUnlisten = null;
    if (prepEndsInPlainShell(ev.phase)) {
      sshStart = null;
      setupReq = null;
      setupNonce = null;
      delete pane.cwd;
      delete pane.autorun;
    } else if (sshStart) {
      sshStart.worktree = null;
    }
    if (ev.phase === "ready") wtReloadProject = wtProjectId;
    wtProjectId = null;
    wtPrep =
      ev.phase === "failed"
        ? { kind: "failed", message: ev.message ?? "" }
        : ev.phase === "identity"
          ? { kind: "identity" }
          : null;
  }

  function answerPrep(answer: WorktreePrepAnswer): void {
    const ticket = wtTicket;
    if (!ticket || wtPrep?.kind !== "ask" || wtPrep.busy) return;
    wtPrep = { ...wtPrep, busy: true };
    void answerWorktreePrep(ticket, answer).then((waiting) => {
      if (!waiting && !disposed && wtTicket === ticket && wtPrep?.kind === "ask") wtPrep = null;
    });
  }

  // ── 로컬 AI 타일 로딩 덮개 ──
  // 설정 스크립트 갈래에는 씌우지 않는다 — 첫 `C` 가 스크립트 줄이라 화면 지우기가 사람이 볼 출력을 지운다.
  let aiVeil: AiVeil | null = null;
  let veilMounted = $state(false);
  let veilShown = $state(false);
  let veilInstant = $state(false);
  let veilFace = $state<{ logo: string | null; cwd: string | null; branch: string | null }>({ logo: null, cwd: null, branch: null });
  let unVeilHook: (() => void) | null = null;

  function beginAiVeil(): void {
    if (aiVeil || disposed || viewer || pane.kind !== "local" || !pane.autorun || setupReq) return;
    const cwd = pane.cwd?.trim() || null;
    veilFace = { logo: aiIconName(pane.autorun), cwd, branch: cwd ? localWorktreeBranchAt(cwd) : null };
    aiVeil = createAiVeil({
      reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
      // xterm 화면만 — 커서 위까지 지워 줄은 그대로 둔다(ConPTY 의 커서 자리와 어긋나지 않게). 셸에는 보내지 않는다.
      clearScreen: () => term?.write("\x1b[1J\x1b[3J"),
      lift: (_reason, instant) => {
        aiVeil = null;
        unVeilHook?.();
        unVeilHook = null;
        veilInstant = instant;
        veilShown = false;
      },
    });
    unVeilHook = onAgentHookSignal((paneId, event) => {
      if (paneId === pane.id && event === "session") aiVeil?.hookSignal();
    });
    veilMounted = true;
    veilInstant = false;
    veilShown = true;
    if (!cwd && !pane.shell?.startsWith("wsl:")) {
      const veil = aiVeil;
      void homeDir()
        .then((home) => {
          if (home && aiVeil === veil && !veilFace.cwd) veilFace = { ...veilFace, cwd: home, branch: localWorktreeBranchAt(home) };
        })
        .catch(() => {});
    }
  }

  function liftAiVeilByPointer(): void {
    aiVeil?.input();
    term?.focus();
  }

  // ── 프로젝트 설정 스크립트 ──
  // 여러 줄을 키로 치지 않는다 — Rust 가 짓는 한 줄(`project_setup_line`)이 끝에 OSC 7717 을 찍는다.
  let setupReq = $state.raw<NonNullable<PaneSpec["setup"]> | null>(null);
  let setupNonce: string | null = null;
  let setupFail = $state<{ code: number; busy: boolean } | null>(null);

  async function runSetup(first: boolean): Promise<void> {
    const req = setupReq;
    const opened = session;
    if (!req || !opened || disposed) return;
    const nonce = newSetupNonce();
    const remote = pane.kind === "ssh";
    let line: string;
    try {
      line = await projectSetupLine(
        req.projectId,
        pane.cwd ?? "",
        opened.resolvedShell ?? null,
        nonce,
        req.agent !== null,
        remote ? opened.id : null,
      );
    } catch (e) {
      if (disposed || session !== opened) return;
      notice(tr("pane.setup.prepareFailed", { reason: String(e instanceof Error ? e.message : e) }), "33");
      if (first && !remote) launchSetupAgent();
      return;
    }
    if (disposed || session !== opened) return;
    setupNonce = nonce;
    opened.write(`${line}\r`);
  }

  function onSetupDone(code: number): void {
    const req = setupReq;
    if (!req) return;
    if (pane.kind === "local" && pane.cwd) void recordSetupResult(req.repo, pane.cwd, code);
    if (code === 0) {
      setupFail = null;
      // 스크립트를 돌린 자식 셸이 아직 콘솔 입력을 쥐고 있는 짧은 순간을 피한다.
      if (pane.kind === "local") setTimeout(() => launchSetupAgent(), 300);
    } else {
      setupFail = { code, busy: false };
    }
  }

  function launchSetupAgent(): void {
    const agent = setupReq?.agent;
    const opened = session;
    if (!agent || !opened || disposed) return;
    setupFail = null;
    if (pane.kind === "ssh") {
      opened.write(`${agent}\r`);
      return;
    }
    pane.autorun = agent;
    void agentAutorunCommand(agent, opened.resolvedShell ?? null, pane.cwd ?? null, pane.injectMcpToken === true, pane.historyStreamId ?? null).then((line) => {
      if (disposed || session !== opened) return;
      opened.write(`${line}\r`);
    });
  }

  function rerunSetup(): void {
    if (!setupFail || setupFail.busy) return;
    setupFail = { ...setupFail, busy: true };
    void runSetup(false).finally(() => {
      if (setupFail?.busy) setupFail = null;
    });
  }

  // `interactive` 가 false 면 호스트 키 · 비밀번호 모달을 넘기지 않는다 — 자동 재시도가 몇 초마다 모달을 띄우면 안 된다.
  async function startSession(interactive: boolean, localCwd?: string): Promise<Attempt> {
    const t = term;
    if (!t) return { ok: false, error: null };
    try {
      // 금고는 접속 전에 연다 — 잠긴 금고면 `password_for` 가 `None` 이라 모달이 먼저 뜬다. 자동 재연결은 잠금 해제 창을 띄우지 않는다.
      if (interactive && pane.kind === "ssh") await ensureVaultUnlocked();
      // 준비 이벤트 구독이 선 뒤에 접속한다 — 첫 이벤트를 놓치지 않게.
      if (sshStart?.worktree && wtListening) await wtListening;
      const count: OutCount = { base: 0, parsed: 0 };
      opening = pane.kind === "local";
      earlyInput = "";
      earlySource = null;
      const s = await openSession(pane, {
        onData: (buf) => onData(buf, count),
        cols: t.cols,
        rows: t.rows,
        confirmHostKey: interactive ? confirmHostKey : undefined,
        promptPassword: interactive ? promptPassword : undefined,
        promptPassphrase: interactive ? promptPassphrase : undefined,
        onExit: handleExit,
        localCwd,
        start: sshStart ?? undefined,
      });
      sshStart = null;
      if (disposed) {
        void s.close();
        return { ok: false, error: null };
      }
      session = s;
      outCount = count;
      applyOwner({ owner: true, size: null });
      opening = false;
      if (earlyInput) s.write(earlyInput, earlySource ?? "keyboard");
      earlyInput = "";
      earlySource = null;
      ackParsed(count);
      gated = false;
      agentSessionStart(pane.id);
      shell?.resetSource();
      oncommand?.(pane.id, null);
      // 종류를 가리지 않고 올린다 — 창 이관은 로컬 셸의 id 도 쓴다.
      onsession?.(pane.id, s.id);
      if (wtReloadProject) {
        reloadWorktreesAfterCreate(wtReloadProject);
        wtReloadProject = null;
      }
      logPath = null;
      void refreshLogPath(s);
      if (s.resolvedShell) onshell?.(pane.id, s.resolvedShell);
      // 다음 접속의 힌트 — 같은 tmux 세션으로 돌아가는 유일한 근거다.
      if (s.tmuxName) ontmux?.(pane.id, s.tmuxName);
      s.resize(t.cols, t.rows);
      // "이 앱에 저장" 은 접속이 선 지금 담는다 — 물을 때 담으면 틀린 값이 금고에 들어간다.
      void flushVaultSaves();
      return { ok: true };
    } catch (e) {
      opening = false;
      earlyInput = "";
      earlySource = null;
      dropVaultSaves();
      if (wtPrep?.kind === "ask") wtPrep = null;
      return { ok: false, error: e };
    }
  }

  async function startFirst(): Promise<Attempt & { attached?: boolean }> {
    for (let i = 0; ; i++) {
      const attached = await attachDetached();
      if (attached) return { ...attached, attached: attached.ok };
      beginAiVeil();
      const result = await startSession(true, freshStartCwd(pane));
      if (result.ok || disposed || i >= OPEN_RETRIES) return result;
      if (!isLiveSessionConflict(result.error)) return result;
      await new Promise((r) => setTimeout(r, OPEN_RETRY_MS));
    }
  }

  function writeCheckpoint(t: Terminal, buffer: string, cols: number, rows: number): Promise<void> {
    return new Promise((resolve) => {
      restoring = true;
      t.resize(cols, rows);
      t.write(buffer, () => {
        restoring = false;
        if (!disposed) refit();
        resolve();
      });
    });
  }

  async function attachDetached(): Promise<Attempt | null> {
    const t = term;
    if (!t || (pane.kind !== "local" && pane.kind !== "ssh")) return null;
    const plan = planAttach(await probeSession(sessionStreamOf(pane), pane.kind), pane.kind);
    if (plan.mode !== "attach" || disposed) return null;
    startReplay();
    if (plan.checkpoint) {
      await writeCheckpoint(t, plan.checkpoint.buffer, plan.checkpoint.cols, plan.checkpoint.rows);
      if (disposed) {
        endReplay();
        return { ok: false, error: null };
      }
    }
    // 숨은 탭은 크기를 잴 수 없다 — 싣지 않으면 Rust 가 PTY 크기를 그대로 둔다.
    const sized = !!container && container.clientWidth > 0 && container.clientHeight > 0;
    const count: OutCount = { base: null, parsed: 0 };
    held = [];
    attachCount = count;
    attachWritten = 0;
    try {
      const s = await attachSession(
        pane,
        { onData: (buf) => onData(buf, count), cols: t.cols, rows: t.rows, onExit: handleExit },
        { sessionEpoch: plan.sessionEpoch, consumed: plan.consumed, sized },
      );
      if (disposed) {
        held = null;
        attachCount = null;
        void s.close();
        endReplay();
        return { ok: false, error: null };
      }
      session = s;
      applyOwner(ownerFromReply(s));
      sshStart = null;
      count.base = s.outputStart ?? null;
      outCount = count;
      // 곧바로 돌려준다 — 안 그러면 다음 덩어리까지 ACK 가 없어 1 MiB 넘게 받은 채 멈춘 수문이 영영 안 열린다.
      ackParsed(count);
      replayUntil = s.replayEnd ?? null;
      endReplayIfDone(count);
      // 맡긴 화면 없이 링을 재생하면 그 링이 쓰인 크기(붙기 전 PTY 크기)로 쓴다 — ConPTY 의 절대 커서 이동이 다른 폭에서 어긋난다.
      const rs = replaying ? replayResize(s.replaySize, { cols: t.cols, rows: t.rows }, !!plan.checkpoint, sized) : null;
      if (rs) {
        restoring = true;
        replaySized = true;
        t.resize(rs.cols, rs.rows);
      }
      // `session` 을 단 뒤에 쓴다 — 뒤 실시간분의 질의에 xterm 이 낸 답이 `session` 으로 가야 한다.
      const queued = held ?? [];
      held = null;
      for (const q of queued) writeAttached(t, count, q.chunk, q.done);
      gated = false;
      shell?.resetSource();
      // 세션을 알리기 전에 되살린다 — 거울이 첫 보고부터 켜진 채 나가게.
      if (pane.kind === "local" && plan.aiRead) setShared(pane.id, true);
      onsession?.(pane.id, s.id);
      agentStateResumed(pane);
      if (s.resolvedShell) onshell?.(pane.id, s.resolvedShell);
      logPath = null;
      void refreshLogPath(s);
      const lostBytes = s.overrunBytes ?? 0;
      console.log(
        `[aynx] 떨어진 세션에 다시 붙음 (${s.kind} ${s.id}) — ${plan.checkpoint ? "체크포인트 + " : ""}재생 ${s.outputStart}..${s.replayEnd}${lostBytes ? ` · 유실 ${lostBytes}B` : ""}`,
      );
      const lostNote = lostNoticeOf(lostBytes);
      if (lostNote) showLost(lostNote);
      return { ok: true };
    } catch (e) {
      held = null;
      attachCount = null;
      endReplay();
      console.warn("[aynx] 떨어진 세션에 붙지 못해 새로 엽니다:", e);
      return null;
    }
  }

  async function resumeSession(sessionId: number, consumed?: number) {
    const t = term;
    if (!t) return;
    const count: OutCount = { base: null, parsed: 0 };
    try {
      const s = await reattachSession(
        pane,
        sessionId,
        {
          onData: (buf) => onData(buf, count),
          cols: t.cols,
          rows: t.rows,
          onExit: handleExit,
        },
        consumed,
      );
      if (disposed) {
        void s.detach();
        return;
      }
      session = s;
      applyOwner({ owner: true, size: null });
      count.base = s.outputStart ?? null;
      outCount = count;
      ackParsed(count);
      gated = false;
      shell?.resetSource();
      // 도는 명령은 지우지 않는다 — 이관 짐이 이미 심었다. 지우면 넘어간 AI 타일이 다음 명령까지 셸 이름으로 선다.
      onsession?.(pane.id, s.id);
      agentStateResumed(pane);
      logPath = null;
      void refreshLogPath(s);
      if (active) t.focus();
    } catch (e) {
      notice(tr("pane.notice.handoff_failed", { reason: describeOpenError(e, tr) }), "91");
    }
  }

  // ── 시청자 ──
  const VIEWER_RETRY_MIN_MS = 2_000;
  const VIEWER_RETRY_MAX_MS = 15_000;
  let viewerRetryMs = VIEWER_RETRY_MIN_MS;
  let viewerRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let viewerWaiting = false;

  async function viewerConnect(resync: { sessionEpoch: number; consumed: number } | null = null): Promise<void> {
    clearTimeout(viewerRetryTimer);
    viewerRetryTimer = undefined;
    if (disposed || !term || session || viewerParked) return;
    const ok = await attachAsViewer(resync);
    if (disposed || ok) {
      viewerRetryMs = VIEWER_RETRY_MIN_MS;
      return;
    }
    if (!viewerWaiting) {
      viewerWaiting = true;
      notice(tr("pane.viewer.waiting"));
    }
    viewerRetryTimer = setTimeout(() => void viewerConnect(null), viewerRetryMs);
    viewerRetryMs = Math.min(viewerRetryMs * 2, VIEWER_RETRY_MAX_MS);
  }

  async function attachAsViewer(resync: { sessionEpoch: number; consumed: number } | null): Promise<boolean> {
    const t = term;
    if (!t || (pane.kind !== "local" && pane.kind !== "ssh")) return false;
    let sessionEpoch: number | null = resync?.sessionEpoch ?? null;
    let consumed = resync?.consumed ?? 0;
    let checkpoint: SessionCheckpoint | null = null;
    if (!resync) {
      const probe = await probeSession(sessionStreamOf(pane), pane.kind);
      if (disposed) return false;
      if (!probe || probe.sessionEpoch === null || (probe.state !== "attached" && probe.state !== "detached")) return false;
      if (probe.kind && probe.kind !== pane.kind) return false;
      sessionEpoch = probe.sessionEpoch;
      // 맡긴 화면은 빈 화면에만 — 이력이 남은 화면에 덧그리면 이력이 두 벌이 된다.
      const cp = probe.checkpoint;
      if (received === 0 && cp && cp.sessionEpoch === probe.sessionEpoch) {
        checkpoint = cp;
        consumed = cp.consumed;
      }
    }
    startReplay();
    if (checkpoint) {
      await writeCheckpoint(t, checkpoint.buffer, checkpoint.cols, checkpoint.rows);
      if (disposed) {
        endReplay();
        return false;
      }
    }
    const sized = !!container && container.clientWidth > 0 && container.clientHeight > 0;
    const fitted = sized ? fit?.proposeDimensions() : undefined;
    const count: OutCount = { base: null, parsed: 0 };
    held = [];
    attachCount = count;
    attachWritten = 0;
    let mine: SessionHandle | null = null;
    try {
      const s = await attachSessionViewer(
        pane,
        {
          onData: (buf) => onData(buf, count),
          cols: fitted?.cols ?? t.cols,
          rows: fitted?.rows ?? t.rows,
          onExit: handleExit,
          onViewerEnded: (reason) => onViewerEnded(mine, reason),
        },
        { sessionEpoch, consumed, sized: sized && !!fitted, eligible: viewerEligible() },
      );
      mine = s;
      if (disposed || session) {
        held = null;
        attachCount = null;
        void s.close();
        endReplay();
        return disposed ? false : true;
      }
      session = s;
      viewerWaiting = false;
      viewerEligibleNow = viewerEligible();
      count.base = s.outputStart ?? null;
      outCount = count;
      ackParsed(count);
      replayUntil = s.replayEnd ?? null;
      endReplayIfDone(count);
      const view = ownerFromReply(s);
      sizeOwner = view.owner;
      ownerSize = view.owner ? null : (view.size ?? s.replaySize ?? null);
      ownerPrimary = view.primary;
      if (!view.owner && ownerSize) {
        if (t.cols !== ownerSize.cols || t.rows !== ownerSize.rows) t.resize(ownerSize.cols, ownerSize.rows);
      } else {
        const rs = replaying ? replayResize(s.replaySize, { cols: t.cols, rows: t.rows }, !!checkpoint, sized) : null;
        if (rs) {
          restoring = true;
          replaySized = true;
          t.resize(rs.cols, rs.rows);
        }
      }
      const queued = held ?? [];
      held = null;
      for (const q of queued) writeAttached(t, count, q.chunk, q.done);
      gated = false;
      shell?.resetSource();
      onsession?.(pane.id, s.id);
      agentStateResumed(pane);
      if (s.resolvedShell) onshell?.(pane.id, s.resolvedShell);
      const lostBytes = s.overrunBytes ?? 0;
      console.log(
        `[aynx] 시청자로 붙음 (${s.kind} ${s.id}) — ${checkpoint ? "체크포인트 + " : ""}재생 ${s.outputStart}..${s.replayEnd} · 크기 주인 ${view.owner}${lostBytes ? ` · 유실 ${lostBytes}B` : ""}`,
      );
      const lostNote = lostNoticeOf(lostBytes);
      if (lostNote) showLost(lostNote);
      if (!replaySized) refit();
      if (claimAfterAttach || claimSizeOnAttach()) {
        claimAfterAttach = false;
        if (!view.owner) void reclaimSize();
      }
      if (viewerParked) parkViewerNow();
      return true;
    } catch (e) {
      held = null;
      attachCount = null;
      endReplay();
      console.warn("[aynx] 시청자로 붙지 못했습니다:", e);
      return false;
    }
  }

  function onViewerEnded(h: SessionHandle | null, reason: string) {
    if (!h || session !== h || disposed) return;
    if (reason === "overflow") {
      const resync = dropViewer(h);
      console.log(`[aynx] 시청자 재동기화 (${h.kind} ${h.id}) — ${resync?.consumed ?? "처음"} 부터`);
      void viewerConnect(resync);
      return;
    }
    if (reason === "ended") viewerSessionEnded();
  }

  // 받은 바이트(파싱 전 포함) 자리로 잇고 옛 채널은 버린다 — 파싱 몫으로 이으면 그 사이 덩어리가 두 번 그려진다.
  function dropViewer(h: SessionHandle): { sessionEpoch: number; consumed: number } | null {
    const count = outCount;
    const lease = h.lease;
    const consumed = count && count.base !== null ? count.base + (count.received ?? count.parsed) : null;
    if (count) count.dead = true;
    session = null;
    outCount = null;
    onsession?.(pane.id, null);
    void h.detach();
    return lease && consumed !== null ? { sessionEpoch: lease.sessionEpoch, consumed } : null;
  }

  // ── 시청 구독 ──
  let viewerParked = false;
  let viewerResume: { sessionEpoch: number; consumed: number } | null = null;
  let viewerParkTimer: ReturnType<typeof setTimeout> | undefined;
  let viewerEligibleNow: boolean | null = null;

  function parkViewerNow() {
    clearTimeout(viewerParkTimer);
    viewerParkTimer = undefined;
    viewerParked = true;
    clearTimeout(viewerRetryTimer);
    viewerRetryTimer = undefined;
    const h = session;
    if (!h) return;
    const at = dropViewer(h);
    if (at) viewerResume = at;
    console.log(`[aynx] 시청자 떼어 둠 (${h.kind} ${h.id}) — ${at?.consumed ?? "처음"} 자리 기억`);
  }

  function resumeViewer() {
    clearTimeout(viewerParkTimer);
    viewerParkTimer = undefined;
    if (!viewerParked) return;
    viewerParked = false;
    const at = viewerResume;
    viewerResume = null;
    viewerRetryMs = VIEWER_RETRY_MIN_MS;
    console.log(`[aynx] 시청자 다시 붙기 — ${at?.consumed ?? "처음"} 부터`);
    void viewerConnect(at);
  }

  $effect(() => {
    if (!viewer) return;
    const want = viewerWanted(visible);
    const eligible = viewerEligible();
    const delay = parkDelayMs(pageShown());
    untrack(() => {
      if (disposed) return;
      if (!want) {
        if (!viewerParked && viewerParkTimer === undefined) viewerParkTimer = setTimeout(parkViewerNow, delay);
        return;
      }
      clearTimeout(viewerParkTimer);
      viewerParkTimer = undefined;
      if (viewerParked) {
        resumeViewer();
        return;
      }
      if (viewerEligibleNow !== null && viewerEligibleNow !== eligible && session) {
        parkViewerNow();
        resumeViewer();
      }
    });
  });

  function viewerSessionEnded() {
    const dying = session;
    if (!dying) return; // 종료 이벤트와 `session-viewer-ended{ended}` 가 둘 다 온다 — 한 번만
    endReplay();
    session = null;
    outCount = null;
    void dying?.close();
    onsession?.(pane.id, null);
    if (disposed) return;
    agentExit(pane);
    notice(tr("pane.viewer.ended"));
    viewerWaiting = true;
    applyOwner({ owner: true, size: null });
    viewerRetryMs = VIEWER_RETRY_MIN_MS;
    clearTimeout(viewerRetryTimer);
    viewerRetryTimer = setTimeout(() => void viewerConnect(null), viewerRetryMs);
  }

  function handleExit(reason: SessionExitReason) {
    if (viewer) {
      viewerSessionEnded();
      return;
    }
    aiVeil?.exit();
    // 핸들을 먼저 무효화한다 — 이 뒤의 입력은 갈 곳이 없어 버려진다.
    const dying = session;
    endReplay();
    session = null;
    cancelScreenPush();
    // 그 세션에 걸린 포트 포워드까지 정리된다(Rust `close_ssh`).
    void dying?.close();
    onsession?.(pane.id, null);
    if (disposed) return;

    // 안내 줄은 지우지 않는다 — 세션이 한 번 끝난 경계를 이력에 남긴다.
    // tmux 의 detach · `exit` 는 사람이 나간 것이라 다시 붙지 않는다 — 자동 재연결은 전송 오류(`"error"`)에만.
    if (pane.kind !== "ssh" || reason.kind !== "error") {
      // Rust 는 코드 0 · 정돈된 채널 닫힘에만 `message: null` 을 싣는다 — 그것이 "깨끗한 종료" 의 판정이다.
      const leftTmux =
        screenOnly && reason.kind === "exit" && reason.message === null ? true : undefined;
      const note = exitNote(reason);
      notice(
        leftTmux
          ? tr("pane.notice.tmux_left")
          : note
            ? tr("pane.notice.ended.reason", { reason: note })
            : tr("pane.notice.ended"),
      );
      ended = { connecting: false, note: null, tmuxExit: leftTmux };
      agentExit(pane);
      onexit?.();
      return;
    }

    notice(
      reason.message
        ? tr("pane.notice.dropped.reason", { reason: reason.message })
        : tr("pane.notice.dropped"),
      "33",
    );
    reconnect = {
      attempt: 0,
      secondsLeft: 0,
      connecting: false,
      paused: null,
      reason: reason.message,
      hint: null,
    };
    scheduleRetry();
  }

  function scheduleRetry() {
    if (disposed || !reconnect) return;
    clearTimers();
    const attempt = reconnect.attempt + 1;
    const delay = reconnectDelayMs(attempt);
    const due = Date.now() + delay;
    reconnect = {
      ...reconnect,
      attempt,
      connecting: false,
      paused: null,
      secondsLeft: Math.ceil(delay / 1000),
    };
    tickTimer = setInterval(() => {
      if (reconnect) reconnect.secondsLeft = Math.max(0, Math.ceil((due - Date.now()) / 1000));
    }, 1000);
    retryTimer = setTimeout(() => void tryReconnect(false), delay);
  }

  async function tryReconnect(manual: boolean) {
    if (disposed || !reconnect || reconnect.connecting) return;
    clearTimers();
    reconnect = { ...reconnect, connecting: true, secondsLeft: 0, paused: null };

    const result = await startSession(manual);
    if (disposed || !reconnect) return;

    if (result.ok) {
      clearTimers();
      reconnect = null;
      notice(tr("pane.notice.reconnected.new"));
      if (active) term?.focus();
      return;
    }

    const detail = sessionErrorOf(result.error, tr);
    const hint = openErrorHint(detail, tr);
    reconnect = { ...reconnect, hint };

    if (detail.kind === "host_key_changed") {
      stopReconnect(describeSessionError(detail, tr), "91");
      return;
    }

    // 사람 손이 필요한 실패에서 루프를 멈춘다 — 계속 돌면 몇 초마다 모달이 다시 뜬다.
    const needsUser =
      detail.kind === "password_required"
        ? tr("pane.banner.reconnect.paused.password")
        : detail.kind === "password_cancelled"
          ? tr("pane.banner.reconnect.paused.password_cancelled")
          : detail.kind === "host_key_unknown"
            ? tr("pane.banner.reconnect.paused.host_key")
            : detail.kind === "cancelled"
              ? tr("pane.banner.reconnect.paused.host_key_cancelled")
              : null;
    if (needsUser) {
      reconnect = { ...reconnect, connecting: false, secondsLeft: 0, paused: needsUser, hint };
      return;
    }

    scheduleRetry();
  }

  function stopReconnect(message: string, sgr = "90") {
    clearTimers();
    reconnect = null;
    notice(message, sgr);
    ended = { connecting: false, note: null };
    onexit?.();
  }

  // ── 연결 대기 ──
  async function connectDeferred() {
    // 대기의 진실은 레지스트리 등록이다(배너가 아니다) — 배너를 [닫기] 한 타일도 '모두 재연결' 로 붙어야 한다.
    if (disposed || !unconnect || deferred?.connecting) return;
    deferred = { connecting: true, note: null };
    // 시도 시작에 지운다 — 계단식 재연결이 같은 타일을 두 번 집지 않게. 실패하면 다시 세운다.
    delete pane.deferred;

    const result = await startSession(true);
    if (disposed) return;

    if (result.ok) {
      deferred = null;
      unconnect?.();
      unconnect = null;
      if (active) term?.focus();
      return;
    }

    pane.deferred = true;
    const message = result.error === null ? null : describeOpenError(result.error, tr);
    const hint = result.error === null ? null : openErrorHintOf(result.error, tr);
    deferred = { connecting: false, note: message, hint };
    if (message) notice(hint ? `${message}\n${hint}` : message, "91");
  }

  onMount(() => {
    try {
      return mount();
    } catch (e) {
      mountError = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error("[aynx] 터미널 마운트 실패:", e);
      return undefined;
    }
  });

  function mount() {
    // 세션을 열기 전에 심는다 — 산 세션에 다시 붙으면 그대로, 새 세션이면 `agentSessionStart` 가 버린다.
    seedAgentLink(pane);
    // 이관 지시서 · 계단식 지연은 1회용 — 남기면 다시 마운트될 때(창 안 이동 등) 낡은 버퍼를 또 재생하고 또 기다린다.
    const restore = pane.restore;
    if (restore) delete pane.restore;

    const openDelay = pane.openDelay ?? 0;
    if (pane.openDelay !== undefined) delete pane.openDelay;

    // 여기서는 읽기만 — 지우는 것은 `connectDeferred` 다(`+page` 가 이 표시로 아직 안 붙은 타일을 찾는다).
    const startsDeferred = pane.deferred === true;

    // 시작 폴더 · 명령은 명세에서 지우지 않는다 — `clonePane` 이 물려줘야 분할 타일도 같은 프로젝트로 뜬다.
    sshStart =
      pane.kind === "ssh" && !restore && pane.cwd
        ? {
            cwd: pane.cwd,
            command: pane.autorun?.trim() ? pane.autorun : null,
            // `projectId` 는 앱 안에서만 — Rust `SshWorktree` 에는 저장소 · 이름 · 표만 싣는다.
            worktree: pane.worktree
              ? { repo: pane.worktree.repo, name: pane.worktree.name, ticket: newSetupNonce() }
              : null,
          }
        : null;
    // 워크트리 만들기 · 설정 스크립트 재료는 지운다 — 분할 복제가 물려받으면 같은 워크트리를 또 만들고 스크립트를 또 돌린다.
    const worktreeProjectId = pane.worktree?.projectId ?? null;
    if (pane.worktree !== undefined) delete pane.worktree;
    if (sshStart?.worktree) {
      const ticket = sshStart.worktree.ticket;
      wtTicket = ticket;
      wtProjectId = worktreeProjectId;
      wtListening = listenWorktreePrep(ticket, onWorktreePrep).then((un) => {
        if (disposed || wtTicket !== ticket) un();
        else wtUnlisten = un;
      });
    }

    setupReq = !restore && pane.setup ? { ...pane.setup } : null;
    if (pane.setup !== undefined) delete pane.setup;
    if (setupReq && pane.kind === "ssh" && sshStart) {
      setupNonce = newSetupNonce();
      sshStart.setup = { projectId: setupReq.projectId, nonce: setupNonce };
    }

    const t = new Terminal({
      allowProposedApi: true, // Unicode11 애드온 · OSC 133 핸들러가 요구
      fontFamily: settings.fontFamilyEffective,
      fontSize: settings.termFontSize,
      lineHeight: 1.1,
      cursorStyle: settings.cursorStyle,
      cursorBlink: true,
      // 호스트별 값이고 생성 시 1회 — 줄이면 쌓인 이력이 잘리므로 열린 탭에 소급하지 않는다.
      scrollback: pane.scrollback ?? DEFAULT_SCROLLBACK,
      // 미리 주지 않으면 첫 프레임이 불투명했다가 바뀌는 깜빡임이 보인다.
      allowTransparency: settings.termOpacity < 100,
      theme: settings.termThemeEffective,
      windowsPty: { backend: "conpty" },
      // xterm 6 에서 세로 스크롤바 폭의 유일한 손잡이다 — FitAddon 도 이 값을 열 계산에서 빼므로 CSS 로 줄이면 칸이 빈다.
      overviewRuler: { width: 10 },
      // OSC 8 주소는 원격이 보낸, 사람 눈에 안 보이는 바이트다 — 원격이 이 PC 의 로컬 파일을 열게 하면 안 된다(`javascript:` 는 더 나쁘다).
      // xterm 기본 필터(`allowNonHttpProtocols: false`)를 끄고 `oscLinkAction` 이 직접 거른다: http(s) → `openUrl`, 로컬 타일의 로컬
      // `file://` → 문서 보기, 그 밖은 아무것도 하지 않는다. `hoveredLink` 에도 http(s) 만 적는다.
      // Ctrl(⌘)+클릭 · `openUrl` · `hoveredLink` 는 아래 WebLinks 와 같아야 한다 — 사람은 두 종류의 링크를 구별하지 못한다.
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (ev, uri) => {
          if (!ev.ctrlKey && !ev.metaKey) return;
          const act = oscLinkAction(uri, pane.kind === "local");
          if (act?.kind === "web") {
            void openUrl(act.url).catch((e: unknown) => {
              console.error(`[aynx] 링크를 열지 못했습니다: ${uri}`, e);
            });
          } else if (act?.kind === "doc") {
            onopenpath?.({ path: act.path });
          }
        },
        hover: (_ev, uri) => (hoveredLink = oscLinkAction(uri, false)?.kind === "web" ? uri : null),
        leave: () => (hoveredLink = null),
      },
    });
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = "11"; // 한글 셀 폭 계산에 필수
    const f = new FitAddon();
    t.loadAddon(f);
    const ser = new SerializeAddon();
    t.loadAddon(ser);
    // 직렬화가 싣지 않는 마우스 인코딩(SGR)을 덧붙인다 — 빠지면 그 화면으로 시작한 터미널의 휠 보고가 사라진다.
    // 지금 폴더(OSC 7)도 같은 이유로 덧붙인다 — 빠지면 다시 붙은 창이 다음 프롬프트까지 폴더 칩을 못 띄운다.
    const mouseEnc = watchMouseEncoding(t);
    const bufferTail = () => encodingSuffix(mouseEnc.current()) + cwdSuffix(shell?.cwd());
    term = t;
    fit = f;

    t.onTitleChange((title) => {
      ontitle?.(pane.id, title);
    });

    t.onCursorMove(() => {
      if (!sizeOwner && ownerSize !== null) revealCursorSoon();
    });

    t.onBell(() => {
      if (replaying) return;
      bell(pane.id, visible);
    });

    // 지금 크기를 함께 싣는다 — 직렬화 문자열은 이 열 수에서만 원래의 줄바꿈을 재현한다.
    const unserialize = registerSerialize(pane.id, (scrollback = TEAR_SCROLLBACK) => ({
      buffer: ser.serialize({ scrollback }) + bufferTail(),
      cols: t.cols,
      rows: t.rows,
      // 버퍼와 같은 동기 순간의 오프셋 — 받는 창이 이 뒤를 재생한다.
      ...(outCount && outCount.base !== null ? { consumed: outCount.base + outCount.parsed } : {}),
    }));

    // 웹뷰 크래시에는 `pagehide` 가 없다 — 그래서 주기로 맡긴다(가려질 때 · `pagehide` 의 체크포인트는 `app/boot`).
    // 첫 장을 곧(5초) 맡기지 않으면 그 사이 GUI 가 죽었을 때 세션 시작부터를 유실로 센다.
    let checkpointedAt = -1;
    const checkpointNow = () => {
      const s = session;
      const count = outCount;
      // 시청자는 맡기지 않는다(서버도 시청자 열쇠를 거절한다).
      if (viewer || !s || !count || count.base === null || replaying) return;
      const consumed = count.base + count.parsed;
      if (consumed === checkpointedAt) return;
      checkpointedAt = consumed;
      try {
        stashCheckpoint(s.kind, s.id, {
          buffer: ser.serialize({ scrollback: CHECKPOINT_SCROLLBACK }) + bufferTail(),
          cols: t.cols,
          rows: t.rows,
          consumed,
        });
      } catch {
        /* 직렬화 실패 — 다음 주기에 다시 */
      }
    };
    const checkpointFirst = setTimeout(checkpointNow, CHECKPOINT_FIRST_MS);
    const checkpointTimer = setInterval(checkpointNow, CHECKPOINT_INTERVAL_MS);

    // 끊긴 동안 친 키는 버린다 — 재연결 뒤 몰아 보내면 사람이 보지 못한 채 실행된다(`rm …` 를 치다 끊긴 경우).
    const writeInput = (data: string, source: InputSource = "keyboard") => {
      if (reconnect) return;
      if (!shouldSendInput(source, sizeOwner)) return;
      // 자격 없는 시청자(폰)는 쳐도 주인이 되지 않는다(서버도 그 쓰기에서 주인을 바꾸지 않는다).
      if (session && !sizeOwner && claimsOwnership(source, !viewer || viewerEligibleNow !== false)) applyOwner({ owner: true, size: null });
      if (!session && opening) {
        if (earlyInput.length + data.length <= EARLY_INPUT_CAP) {
          earlyInput += data;
          earlySource = mergeSource(earlySource, source);
        }
        return;
      }
      session?.write(data, source);
    };

    // xterm 의 `onData` 뒤라 IME 조합이 끝난 최종 문자열이다.
    const sendInput = (data: string) => {
      // 재생 구간의 DSR/DA 답은 버린다 — 셸은 이미 답을 받았다(동시 입력 형제에게도 가면 안 된다).
      if (replaying) return;
      const source = classifyInput(data, inputContext());
      if (source === "keyboard" && stickyCtrl()) {
        setStickyCtrl(false);
        data = ctrlOf(data) ?? data;
      }
      if (!shouldSendInput(source, sizeOwner)) return;
      if (onbroadcast?.(data, source)) return;
      writeInput(data, source);
    };

    suggest.inputSink = sendInput;

    // `sendInput` 이 아니라 `writeInput` 을 올린다 — 브로드캐스트가 다시 브로드캐스트를 부르는 고리를 끊는다.
    const unregister = registerInput(pane.id, writeInput);

    const unOwner = listen<unknown>(SIZE_OWNER_EVENT, (ev) => {
      const v = ownerFromEvent(session?.lease, ev.payload);
      if (!v || disposed) return;
      const was = sizeOwner;
      applyOwner(v);
      if (viewer) dropFitOnOwnerLoss(visible, was, v.owner);
    }).catch(() => () => {});

    // ── OSC 133 창구 ──
    const commands = {
      status: () => shell?.status() ?? null,
      cwd: () => shell?.cwd() ?? null,
      last: () => shell?.last() ?? null,
      tail: (n: number) => shell?.tail(n) ?? [],
      jump: (dir: -1 | 1) => shell?.jump(dir) ?? false,
      lineOfBlock: (id: number) => shell?.lineOfBlock(id) ?? null,
      bandBlock: (id: number) => shell?.bandBlock(id) ?? false,
      clearBand: () => shell?.clearBand(),
      markerDistances: () => shell?.markerDistances() ?? [],
      copyOutput: async (): Promise<CopyResult> => {
        const result = shell ? await shell.copyOutput() : ("none" as CopyResult);
        showToast(result);
        return result;
      },
      canCopyOutput: () => shell?.canCopyOutput() ?? false,
      blockOutput: (id: number) => shell?.blockOutput(id) ?? null,
    };
    const uncommands = registerCommands(pane.id, commands);

    // 그 동안 나온 글은 사람 키로 친다 — `sendInput` 이 동기라 구간 표시가 맞는다.
    const sendAsKey = (data: string) => {
      inputKeyEvent = true;
      try {
        sendInput(data);
      } finally {
        inputKeyEvent = false;
      }
    };

    // ── 터미널 조작 창구 ──
    const untermactions = registerTermActions(
      pane.id,
      createTermActions({
        t,
        get session() {
          return session;
        },
        get reconnecting() {
          return reconnect !== null;
        },
        get disposed() {
          return disposed;
        },
        get menuLink() {
          return menuLink;
        },
        get logPath() {
          return logPath;
        },
        clip,
        showNote,
        pasteToTerm,
        writeInput,
        sendAsKey,
        saveScrollback,
        openThisLog,
        blockAnchorOf,
      }),
    );

    // ── 검색 창구 ──
    const unsearch = registerSearch(
      termSearch.target({
        paneId: pane.id,
        name: () => paneName(pane, tr),
        screenOnly: () => screenOnly,
      }),
    );

    // ── 키 가로채기 — `t.open` 앞에서 건다 ──
    attachKeyHandler(t, {
      get paneId() {
        return pane.id;
      },
      get screenOnly() {
        return screenOnly;
      },
      deadState,
      get ended() {
        return ended;
      },
      reconnectEnded,
      connectDeferred,
      get onclose() {
        return onclose;
      },
      get onrequestedit() {
        return onrequestedit;
      },
      handleSuggestKeys: suggest.handleSuggestKeys,
      commands,
      showNote,
      sendInput,
    });

    t.open(container);
    // xterm 6.0.0 의 한글 조합 누락 · 중복 우회(#6089 · #6045 — `term/ime-composition-fix`). 조합 도우미가 open 에서 생기므로 open 뒤에.
    patchTerminalComposition(t);
    // 숨은 채 열리는 타일은 닫힌 문으로 시작한다 — 여는 것은 가시성 `$effect` 의 rAF 다.
    renderGate = installHiddenRenderGate(t, !visible);
    f.fit();
    // 인라인 이미지는 세션 출력이 들어오기 전에 붙인다.
    if (settings.inlineImages) addons.loadImages();

    // ── OSC 133 — `t.open` 뒤에 건다(데코레이션은 렌더러가 서 있어야 그린다) ──
    // 블록을 거울로 올릴지는 공유 여부(`aiOn`)가 정한다 — 그 판단은 이 파일에만 있다(shell-integration 은 모른다).
    if (!screenOnly) {
      shell = attachShellIntegration(
        t,
        (status) => {
          onstatus?.(pane.id, status);
          pushContext();
        },
        {
          paneId: pane.id,
          onblock: (block) => {
            // 완료 알림은 공유와 무관하다 — 서버로 나가는 값이 아니라 이 창의 사람에게 하는 말이다.
            notifyFinishedBlock(pane.id, paneName(pane, tr), block, visible, messengerLabel(pane));
            if (!aiOn) return;
            // 재생이 다시 만든 블록은 올리지 않는다 — 이미 올라갔고, 시작 시각이 달라 같은 명령이 다른 블록으로 하나 더 선다.
            if (replaying) return;
            void pushSessionBlock(contextKeyOf, block);
          },
          markAfterSecs: () => settings.markAfterSecs,
          tr,
          // 도는 명령은 공유와 무관하게 올린다 — 이 창의 타일 아이콘 · 이름이 읽는 표시 신호다.
          oncommand: (commandLine) => {
            oncommand?.(pane.id, commandLine);
            if (commandLine !== null) aiVeil?.commandStarted();
            else aiVeil?.commandEnded();
            // 신원 보고 뒤에 — 링 재생의 `C` 는 지난 명령이라 대화 연결을 버리지 않게 `replaying` 을 넘긴다.
            if (commandLine !== null) agentCommandStarted(pane, replaying);
          },
          onprompt: () => agentPromptReturned(pane),
          oncwd: (cwd) => {
            if (pane.kind === "local" || pane.kind === "ssh") noteReportedCwd(pane.id, cwd);
            const keep = lastCwdToKeep(pane, cwd);
            if (keep !== null && pane.lastCwd !== keep) pane.lastCwd = keep;
          },
          richButton: {
            label: () => tr("pane.blockview.button"),
            title: () => tr("pane.blockview.button.title"),
            run: (blockId, rowRect) => openBlockView(blockId, rowRect),
          },
          askButton: {
            label: () => tr("pane.askai.button"),
            hint: () => displayCombo(effectiveCombo("ask-ai-block", settings.current.keybindings)),
            title: () => tr("pane.askai.button.title"),
            run: (blockId, rect) =>
              askAiAboutBlock(pane.id, blockId, { x: rect.right, y: rect.bottom + 4, align: "right" }),
          },
        },
      );
    }

    // ── OSC 52 · 9 · 777 · 7717 ──
    // 같은 번호의 핸들러는 나중에 건 것부터 불린다 — 셸 통합 뒤에 52 → 9·777 → 7717 순서로, `screenOnly` 바깥에서 건다.
    const osc52 = attachOsc52(t, {
      get disposed() {
        return disposed;
      },
      get aiTile() {
        return isAgentPane(pane);
      },
      showNote,
    });
    const programNotify = attachProgramNotify(t, {
      get paneId() {
        return pane.id;
      },
      name: () => paneName(pane, tr),
      get visible() {
        return visible;
      },
      get agent() {
        return isLiveAgentPane(pane);
      },
    });
    const oscSetup = attachSetupOsc(t, {
      get nonce() {
        return setupNonce;
      },
      set nonce(v) {
        setupNonce = v;
      },
      done: onSetupDone,
    });
    // 재생 구간 가리개는 위 셋보다 나중에 건다.
    const replayMute = attachReplayMute(t, () => replaying);

    // ── 표시 트리거 ──
    // 첫 목록은 여기서 넣는다 — 구독 `$effect` 가 먼저 돌 때 `triggers` 는 아직 null 이다.
    triggers = attachTriggers(t, tr, (url) => (hoveredLink = url));
    triggers.setTriggers(settings.current.triggers);

    // ── 기본 URL 자동 링크 ──
    // 트리거 프로바이더 뒤에 건다 — xterm 은 먼저 답한 프로바이더에서 멈추므로 사용자 트리거 링크가 이긴다.
    // `window.open` 금지 — 웹뷰 안에서 열면 터미널 창이 브라우저가 되어 돌아올 길이 없다.
    t.loadAddon(
      new WebLinksAddon(
        (ev, uri) => {
          if (!ev.ctrlKey && !ev.metaKey) return;
          void openUrl(uri).catch((e: unknown) => {
            console.error(`[aynx] 링크를 열지 못했습니다: ${uri}`, e);
          });
        },
        {
          hover: (_ev, uri) => (hoveredLink = uri),
          leave: () => (hoveredLink = null),
        },
      ),
    );

    // ── 파일 경로 링크 — web-links 뒤에 건다(트리거 · URL 이 경로를 이긴다) ──
    pathLinks = attachPathLinks(t, pathPlace, (target, line) => onopenpath?.(target, line));

    // 검색 애드온도 `t.open` 뒤 — 데코레이션은 렌더러가 서 있어야 생긴다.
    termSearch.attach(t);

    console.log(`[aynx] xterm 마운트 완료 (${pane.kind}) cols=${t.cols} rows=${t.rows}`);

    if (viewer) {
      if (viewerWanted(visible)) void viewerConnect();
      else viewerParked = true;
    } else if (restore) {
      // 순서: 원래 크기로 → 버퍼 쓰기 → (write 콜백에서) 마커 심기 → 타일 크기로 → 세션 재부착.
      // 다른 폭에 쓰면 리플로로 마커 거리가 어긋나고, 콜백 전에 심으면 버퍼가 비어 범위 밖이다. `reattach_output` 의 크기도 이 타일의 것이어야 한다.
      const markers = restore.markers ?? [];
      const size = restore.size;
      if (size) {
        restoring = true;
        t.resize(size.cols, size.rows);
      }
      const finish = () => {
        // 켠 자리와 짝이다 — 중간에 언마운트돼도 문은 반드시 다시 열린다.
        restoring = false;
        if (!disposed) {
          if (markers.length > 0) shell?.restoreMarkers(markers);
          if (size) refit();
        }
        if (restore.sessionId === null) {
          notice(tr("pane.notice.session_left_behind"), "33");
        } else {
          void resumeSession(restore.sessionId, restore.consumed);
        }
      };
      if (restore.buffer !== "") t.write(restore.buffer, finish);
      else finish();
    } else if (startsDeferred) {
      const waitForConnect = () => {
        deferred = { connecting: false, note: null };
        unconnect = registerConnect(pane.id, () => void connectDeferred());
        notice(tr("pane.notice.restored", { name: paneName(pane, tr) }));
      };
      // 복원 안내 · 자동 재접속(`bootTabs`)은 이 결과가 확정된 뒤에 센다.
      registerSettling(
        pane.id,
        attachDetached().then((attached) => {
          if (disposed) return;
          if (attached?.ok) {
            delete pane.deferred;
            return;
          }
          waitForConnect();
        }),
      );
    } else {
      const openFirst = () =>
        void startFirst().then((result) => {
          if (disposed) return;
          if (result.ok && result.attached) {
            aiVeil?.close();
            return;
          }
          if (!result.ok) aiVeil?.exit();
          if (result.ok) {
            console.log(`[aynx] 세션 열림 (${pane.kind})`);
            if (pane.kind === "local" && setupReq) {
              void runSetup(true);
              return;
            }
            if (pane.kind === "local" && pane.autorun) {
              const opened = session;
              const cmd = pane.autorun;
              void agentAutorunCommand(cmd, opened?.resolvedShell ?? null, pane.cwd ?? null, pane.injectMcpToken === true, pane.historyStreamId ?? null).then((line) => {
                if (disposed || session !== opened || !opened) return;
                // 세션 서버 장부에 알린 뒤에 쓴다 — 그 명령의 OSC 133 `C` 가 알림보다 먼저 닿으면 안 된다(docs/log/2026-10-24-convo-rename.md).
                void linkResumedAutorun(pane.id, cmd).then(() => {
                  if (disposed || session !== opened) return;
                  opened.write(`${line}\r`);
                });
              });
            }
            return;
          }
          if (result.error === null) return;
          console.error("[aynx] 세션 열기 실패:", result.error);
          // 자동 재연결하지 않는다 — 인증 실패에 백오프로 두드리면 서버의 시도 한도만 태운다. 종료됨 상태로 넘겨 Enter · Ctrl+D 를 살린다.
          const message = describeOpenError(result.error, tr);
          const hint = openErrorHintOf(result.error, tr);
          notice(hint ? `${message}\n${hint}` : message, "91");
          ended = { connecting: false, note: message, hint, unopened: true };
        });

      if (openDelay > 0) {
        openTimer = setTimeout(() => {
          openTimer = undefined;
          if (!disposed) openFirst();
        }, openDelay);
      } else {
        openFirst();
      }
    }

    // 남긴 검색 강조는 사람 입력에만 지운다 — 포커스 보고(`?1004`)의 `ESC[I` 가 점프 직후 강조를 지운다.
    t.onData((data) => {
      if (classifyInput(data, inputContext()) !== "protocol") termSearch.keptEvent("input");
    });
    t.onData(sendInput);

    // `onData` 가 아니라 `onWriteParsed` — 셸이 메아리친 버퍼를 읽으므로 키를 친 순간에는 방금 친 글자가 아직 없다.
    t.onWriteParsed(suggest.scheduleSuggest);

    const { onCompositionStart, onCompositionEnd } = suggest;
    const textarea = t.textarea ?? null;
    textarea?.addEventListener("compositionstart", onCompositionStart);
    textarea?.addEventListener("compositionend", onCompositionEnd);

    // ── 우클릭 · 선택 자동 복사 · 붙여넣기 가로채기 ──
    t.onSelectionChange(() => {
      if (settings.rightClick !== "paste") return;
      if (t.getSelection() === "") return;
      clip.markSelectionDirty();
    });

    const openMenuAt = (x: number, y: number) => {
      menuLink = hoveredLink;
      onmenu?.(x, y, {
        link: menuLink,
        hasSelection: t.hasSelection(),
        hasOutput: shell?.canCopyOutput() ?? false,
        snippet: snippetSourceAt(t, y),
        ask: askRefAt(t, y),
        selection: t.hasSelection() ? t.getSelection().slice(0, 64 * 1024) : null,
      });
    };

    // ── 터치 ──
    const touch = new TouchGestures({
      rowHeight: () => (t.element && t.rows > 0 ? (t.element.querySelector(".xterm-screen")?.clientHeight ?? 0) / t.rows : 0),
      scrollLines: (n, x, y) => {
        if (t.element && (t.buffer.active.type !== "normal" || t.modes.mouseTrackingMode !== "none")) wheelLines(t.element, n, x, y);
        else t.scrollLines(n);
      },
      longPress: (x, y) => openMenuAt(x, y),
    });

    // 늘 `preventDefault` — 웹뷰 기본 메뉴("다시 로드" · "검사")가 터미널 위에 서면 안 된다.
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Android 는 길게 누르기 뒤 `contextmenu` 도 낸다 — 두 번 열지 않는다.
      if (touch.justLongPressed()) return;
      const wantsMenu = handheld() || (settings.rightClick === "menu" ? !ev.shiftKey : ev.shiftKey);
      if (!wantsMenu) {
        void clip.pasteFromClipboard();
        return;
      }
      openMenuAt(ev.clientX, ev.clientY);
    };

    // 캡처 단계에서 가로챈다 — textarea 의 xterm 핸들러보다 먼저 돌아야 확인 모달이 낄 자리가 생긴다.
    const onPasteEvent = (ev: ClipboardEvent) => {
      if (!settings.confirmMultilinePaste) return;
      const text = ev.clipboardData?.getData("text") ?? "";
      if (!/[\r\n]/.test(text)) return;
      ev.preventDefault();
      ev.stopPropagation();
      clip.requestPaste(text);
    };

    // 마우스 추적 TUI 는 클릭한 OSC 8 링크를 스스로 연다 — 링크 위 Ctrl+클릭을 pty 로 보내는 바깥 `.xterm` mousedown 전에
    // 끊지 않으면 브라우저 탭이 둘 열린다. 링크 판정은 링크파이어가 호버 중에만 다는 `xterm-cursor-pointer`.
    const screenEl = t.element?.querySelector<HTMLElement>(".xterm-screen") ?? null;
    const onLinkMouseDown = (ev: MouseEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      if (t.modes.mouseTrackingMode === "none") return;
      if (!screenEl?.classList.contains("xterm-cursor-pointer")) return;
      ev.stopPropagation();
      ev.preventDefault();
      t.focus();
    };
    screenEl?.addEventListener("mousedown", onLinkMouseDown);

    const root = container.parentElement ?? container;
    root.addEventListener("contextmenu", onContextMenu);
    const untouch = viewer ? attachTouchGestures(root, touch) : () => {};
    const unHandheld = (viewer && handheld() ? attachHandheldInput(t, container) : null) ?? (() => {});
    const onFocusIn = (ev: FocusEvent) => {
      if (ev.target !== t.textarea || !lineFieldMode()) return;
      if (flipViewOf(pane.id) === "convo") return;
      focusLineField();
    };
    if (viewer) container.addEventListener("focusin", onFocusIn, true);
    container.addEventListener("paste", onPasteEvent, true);
    // 그 이벤트가 배달되는 동안(`inputContext`) xterm 처리기가 동기로 내는 `onData` 가 그 출처다 — 적어 두기만 한다.
    const markKey = (ev: Event) => (keyEv = ev);
    const markPaste = (ev: Event) => (pasteEv = ev);
    // xterm 은 문서에 단 `mouseup` · 끌기에서도 보고를 낸다 — 이 구간 밖의 것은 `classifyInput` 이 모양으로 가른다.
    const markPointer = (ev: Event) => (pointerEv = ev);
    const POINTER_EVENTS = ["wheel", "mousedown", "mouseup", "mousemove"] as const;
    const pointerOpts = { capture: true, passive: true };
    container.addEventListener("keydown", markKey, true);
    container.addEventListener("paste", markPaste, true);
    for (const type of POINTER_EVENTS) container.addEventListener(type, markPointer, pointerOpts);
    // 덮개는 `onData` 로 걷지 않는다 — CLI 의 터미널 질의에 xterm 이 내는 응답도 `onData` 로 나온다.
    const veilKey = (ev: KeyboardEvent) => {
      if (aiVeil && !["Shift", "Control", "Alt", "Meta"].includes(ev.key)) aiVeil.input();
    };
    const veilPaste = () => aiVeil?.input();
    container.addEventListener("keydown", veilKey, true);
    container.addEventListener("paste", veilPaste, true);
    // `pointerup` 이 아니라 창의 `mouseup`(버블) — xterm 은 선택 변경을 문서 `mouseup` 에서야 알린다(`pointerup` 이면 복사가 다음 클릭으로 밀린다).
    window.addEventListener("mouseup", clip.flushSelectionCopy);

    // 크기가 멎은 뒤 한 번만 맞춘다 — 프레임마다 맞추면 원격에 SIGWINCH 가 프레임마다 나가 TUI 가 매번 다시 그린다.
    let refitTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefit = () => {
      clearTimeout(refitTimer);
      refitTimer = undefined;
      if (dropPreviewing() || refitParked()) {
        refitSkipped = true;
        return;
      }
      refitTimer = setTimeout(() => {
        refitTimer = undefined;
        if (disposed) return;
        refit();
      }, REFIT_DEBOUNCE_MS);
    };
    resumeRefit = scheduleRefit;
    const ro = new ResizeObserver(scheduleRefit);
    ro.observe(container);

    return () => {
      disposed = true;
      void unOwner.then((un) => un());
      clearTimeout(viewerRetryTimer);
      clearTimeout(viewerParkTimer);
      unregister();
      unconnect?.();
      unconnect = null;
      unserialize();
      mouseEnc.dispose();
      uncommands();
      untermactions();
      unsearch();
      forgetReportedCwd(pane.id);
      screenEl?.removeEventListener("mousedown", onLinkMouseDown);
      root.removeEventListener("contextmenu", onContextMenu);
      untouch();
      unHandheld();
      container.removeEventListener("focusin", onFocusIn, true);
      container.removeEventListener("paste", onPasteEvent, true);
      container.removeEventListener("keydown", markKey, true);
      container.removeEventListener("paste", markPaste, true);
      for (const type of POINTER_EVENTS) container.removeEventListener(type, markPointer, pointerOpts);
      container.removeEventListener("keydown", veilKey, true);
      container.removeEventListener("paste", veilPaste, true);
      aiVeil?.close();
      window.removeEventListener("mouseup", clip.flushSelectionCopy);
      textarea?.removeEventListener("compositionstart", onCompositionStart);
      textarea?.removeEventListener("compositionend", onCompositionEnd);
      suggest.teardown();
      clip.dropPrompt();
      clearTimers();
      clearTimeout(openTimer);
      cancelScreenPush();
      if (wtTicket) void answerWorktreePrep(wtTicket, "cancel");
      wtTicket = null;
      wtUnlisten?.();
      wtUnlisten = null;
      wtPrep = null;
      clearTimeout(toastTimer);
      clearTimeout(lostTimer);
      lost = null;
      reconnect = null;
      deferred = null;
      ended = null;
      // 데코레이션 · OSC 핸들러를 먼저 떼고 나서 터미널을 dispose 한다.
      shell?.dispose();
      shell = null;
      osc52.dispose();
      programNotify.dispose();
      oscSetup.dispose();
      replayMute.dispose();
      clearInterval(checkpointTimer);
      clearTimeout(checkpointFirst);
      endReplay();

      triggers?.dispose();
      triggers = null;
      pathLinks?.dispose();
      pathLinks = null;
      termSearch.dispose();
      // 합자 · 이미지를 WebGL 보다 먼저 뗀다(조이너 · `setRenderer` 가로채기가 렌더러에 걸려 있다). WebGL 컨텍스트는 상한이 16개다.
      addons.unloadLigatures();
      addons.unloadImages();
      addons.unloadWebgl();
      onstatus?.(pane.id, null);
      oncommand?.(pane.id, null);
      // 시청자는 거울을 지우지 않는다 — 같은 열쇠의 메인 PC 거울이 지워진다.
      if (!viewer) void dropSession(contextKeyOf);
      dropShared(pane.id);
      // 이관이어도 안전하다 — 페이로드는 `dragstart` 때 이미 사본으로 떴다.
      dropHistory(pane.id);
      dropBell(pane.id);
      dropAgent(pane.id);
      ro.disconnect();
      resumeRefit = null;
      refitSkipped = false;
      clearTimeout(refitTimer);
      // 창 이관 중이면 세션을 죽이지 않는다 — 새 창이 `reattach_output` 으로 이어받는다.
      if (isHandoff(pane.id)) void session?.detach();
      else void session?.close();
      session = null;
      onsession?.(pane.id, null);
      term = null;
      fit = null;
      t.dispose();
    };
  }
</script>

<div class="term" bind:this={termRoot} onkeydowncapture={dismissLostOnKey} onpointerdowncapture={dismissLostOnPointer} role="presentation">
  <!-- 패딩은 바깥 `.term` 이 준다 — FitAddon 이 마운트 요소의 패딩까지 칸으로 세어 마지막 줄이 잘린다. -->
  <div class="term-screen" class:foreign={!sizeOwner && ownerSize !== null} bind:this={container}></div>
  {#if blockView}
    {#key blockView.blockId}
      <BlockView
        open={blockView}
        originNow={() => (blockView ? blockOriginNow(blockView.blockId) : null)}
        onclose={closeBlockView}
      />
    {/key}
  {/if}
  {#if foreignShown && ownerSize && noticeOutline}
    <SizeNotice
      kind={noticeKind}
      {ownerSize}
      outline={noticeOutline}
      card={noticeCard}
      cardW={NOTICE_CARD_W}
      bind:cardH={noticeCardH}
      bind:pop={noticePop}
      buttons={noticeButtons}
      onrun={runNotice}
      ondismiss={dismissNotice}
    />
  {/if}
  {#if suggest.suggestBox && suggest.suggestItems.length > 0}
    <SnippetSuggest
      items={suggest.suggestItems}
      sel={suggest.suggestSel}
      left={suggest.suggestBox.left}
      top={suggest.suggestBox.top}
      onpick={suggest.pickSuggest}
    />
  {/if}

  {#if veilMounted}
    <AiVeilView
      shown={veilShown}
      instant={veilInstant}
      logo={veilFace.logo}
      cwd={veilFace.cwd}
      branch={veilFace.branch}
      onlift={liftAiVeilByPointer}
    />
  {/if}

  <Banners
    {reconnect}
    bind:deferred
    {setupReq}
    bind:setupFail
    bind:wtPrep
    {ended}
    {lost}
    {tryReconnect}
    {stopReconnect}
    {connectDeferred}
    {rerunSetup}
    {launchSetupAgent}
    {answerPrep}
    {reconnectEnded}
    {onclose}
  />

  {#if toast}
    <div class="toast glass-raised" class:ok={toast.ok} role="status">{toast.text}</div>
  {/if}

  {#if clip.pastePrompt}
    <PasteConfirm
      lines={clip.pasteDraftLines}
      bind:draft={clip.pasteDraft}
      bind:confirmBtn={clip.pasteConfirmBtn}
      onconfirm={clip.confirmPaste}
      oncancel={clip.cancelPaste}
    />
  {/if}

  {#if mountError}
    <pre class="mount-error">{tr("pane.term.mount_error")}
{mountError}</pre>
  {/if}
</div>

<style>
  .term {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--term-pad);
    /* 칠하지 않는다 — 타일 배경판(`.pane-box` 의 `--term-bg-fill`)을 덮으면 터미널 투명도를 내려도 뒤가 안 비친다 */
    background: none;
  }

  .term-screen {
    width: 100%;
    height: 100%;
  }
  .term-screen.foreign {
    overflow: auto;
  }

  .toast {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 5;
    max-width: calc(100% - 20px);
    padding: 5px 10px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-modal);
    pointer-events: none;
  }

  .toast.ok {
    border-color: var(--ok);
  }
  /* 글래스의 흰 선(공용 `body .glass-raised`)보다 한 단 세게 — 성공의 초록 선이 재질과 무관하게 남는다 */
  :global(:root[data-material="glass"]) .toast.ok {
    border-color: var(--ok);
  }

  /* xterm 이 데코 폭을 인라인 스타일로 박아 `!important` 로 덮는다. 왼쪽으로 당기면(x<0) `overflow:hidden` 에 통째로 잘린다 */
  :global(.aynx-cmd-band) {
    width: 3px !important;
    background: var(--fg-muted);
    pointer-events: none;
  }

  :global(.aynx-cmd-running) {
    background: var(--accent);
  }
  :global(.aynx-cmd-ok) {
    background: var(--fg-muted);
    opacity: 0.55;
  }
  :global(.aynx-cmd-fail) {
    background: var(--err);
    pointer-events: auto; /* 종료 코드 말풍선이 여기 걸린다 */
  }

  :global(.aynx-block-mark) {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    overflow: visible;
    white-space: pre;
    font-size: 0.82em;
    line-height: 1;
    color: var(--fg-muted);
    opacity: 0.75;
    user-select: none;
    cursor: default;
  }

  :global(.aynx-block-mark-fail) {
    color: var(--err);
    opacity: 0.95;
  }

  /* 반투명이 필수다 — WebGL 캔버스의 글자 위에 얹히는 DOM 이라 불투명하면 명령을 가린다. 포인터는 종료 코드 말풍선 때문에 받는다 */
  :global(.aynx-fail-row) {
    background: rgba(247, 118, 142, 0.14);
    pointer-events: auto;
    user-select: none;
  }

  :global(.aynx-fail-row:hover) {
    outline: 1px solid rgba(247, 118, 142, 0.35);
    outline-offset: -1px;
  }
  :global(.aynx-row-acts) {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    display: none;
    align-items: center;
    gap: 6px;
  }
  :global(.aynx-fail-row:hover .aynx-row-acts),
  :global(.aynx-block-row:hover .aynx-row-acts) {
    display: inline-flex;
  }
  :global(.aynx-block-row) {
    pointer-events: auto;
    user-select: none;
  }
  :global(.aynx-block-row:hover) {
    outline: 1px solid var(--line-strong);
    outline-offset: -1px;
  }
  :global(.aynx-ask-ai),
  :global(.aynx-rich-view) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    margin: 0;
    padding: 0 8px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-raised);
    cursor: pointer;
    user-select: none;
  }
  :global(.aynx-ask-ai:hover),
  :global(.aynx-rich-view:hover) {
    background: var(--surface-hover);
  }
  :global(.aynx-block-mark-hidden) {
    visibility: hidden;
  }

  :global(.aynx-block-band) {
    pointer-events: none;
    box-sizing: border-box;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-left: 2px solid var(--accent);
  }

  :global(.aynx-jump-flash) {
    pointer-events: none;
    background: rgba(224, 175, 104, 0.35);
    animation: aynx-jump-fade 0.6s ease-out forwards;
  }

  @keyframes aynx-jump-fade {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  :global(.aynx-trigger-bg) {
    pointer-events: none;
  }

  :global(.aynx-trigger-text) {
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: pre;
    letter-spacing: 0;
    pointer-events: none;
    user-select: none;
  }

  :global(.aynx-trigger-tip) {
    position: absolute;
    z-index: 20;
    max-width: min(420px, 80%);
    padding: 6px 9px;
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg);
    /* 불투명한 `--bg-panel-base` — 뒤로 터미널 글자가 비치면 설명이 읽히지 않는다 */
    background: var(--bg-panel-base);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-modal);
    pointer-events: none; /* 팝오버가 커서를 가로채면 그 순간 hover 가 끊긴다 */
    user-select: none;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  :global(.aynx-trigger-tip .aynx-tip-url) {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
  }

  :global(.aynx-trigger-tip .aynx-tip-text[hidden] + .aynx-tip-url) {
    margin-top: 0;
  }

  .mount-error {
    margin: 0;
    padding: 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--err);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
