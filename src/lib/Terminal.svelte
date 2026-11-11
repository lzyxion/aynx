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
    registerCommands,
    wslCwdToWindows,
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
    hasSession,
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
    onAgentHookSignal,
  } from "$lib/app/agent-status.svelte.js";
  import { linkResumedAutorun, seedAgentLink } from "$lib/app/agent-sessions.svelte.js";
  import { forgetReportedCwd, noteReportedCwd } from "$lib/app/pane-cwd.svelte.js";
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
  import { dropShared, isShared, setShared } from "$lib/ai.svelte.js";
  import { localAiTile, paneAiReadable } from "$lib/app/delegation.svelte.js";
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
    domRendererOnly,
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
  import { classifyInput, mergeSource, type InputSource } from "$lib/term/input-source";
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
    /**
     * 이 패널이 화면에 그려지고 있는가 (= 탭이 활성). 크기 재계산의 기준이다 —
     * 같은 탭 안의 **비포커스 패널도 보이므로** `active` 와 분리해야 한다
     * (안 그러면 분할된 탭을 다시 열 때 포커스 없는 패널이 옛 크기로 남는다).
     */
    visible?: boolean;
    /** 이 패널이 키 입력을 받아야 하는가 (= 탭 활성 && 패널 활성) */
    active?: boolean;
    /**
     * 세션이 **끝났다** (정상 종료·자동 재연결 중단). 알림일 뿐 패널을 닫지 않는다 —
     * 종료된 타일은 스크롤백을 그대로 둔 채 [`ended`] 배너로 넘어가고, 실제로 닫는 것은
     * 아래 `onclose` 다 (docs/log/2026-09-03-keys-ended-focus.md).
     */
    onexit?: () => void;
    /**
     * **이 패널을 닫아 달라** — 종료된 타일에서 `Ctrl+D` 또는 [닫기] 를 눌렀다.
     *
     * `onexit` 와 나눠 둔 이유는 둘의 뜻이 다르기 때문이다: `onexit` 은 "세션이 끝났다"
     * 는 사실 보고이고, 이것은 "패널을 트리에서 없애 달라" 는 **요청**이다. 상위는 헤더
     * `×` 와 같은 경로(`closePaneIn`)로 처리한다 — 마지막 패널이었으면 탭이 닫힌다.
     */
    onclose?: () => void;
    /**
     * 안 보이는 동안 새 출력이 도착했다 — 탭 바의 활동 점을 켜라는 신호.
     * [`ACTIVITY_THROTTLE_MS`] 로 스로틀되고, `visible` 이면 아예 부르지 않는다.
     *
     * 2단계의 **단순** 활동 표시다. 5단계에서 OSC 133 상태 배지(`onstatus`)가 그 위에
     * 얹혔지만 이 신호는 **없어지지 않았다** — 스니펫이 없는 세션(tmux 안·로컬 셸·주입
     * 실패)에는 여전히 이것뿐이라 배지의 폴백으로 남는다
     * (docs/log/2026-09-02-osc133.md).
     */
    onactivity?: () => void;
    /**
     * **명령 상태가 바뀌었다** (5단계 — OSC 133). `null` 은 "아직 아무 명령도 못 봤다"
     * 이지 "성공" 이 아니다 — 그 상태에서는 상위가 활동 점으로 폴백한다.
     *
     * `onactivity` 와 달리 스로틀이 없다: 상태 전이는 명령당 두 번(C·D)뿐이고,
     * 같은 값을 두 번 올리지 않는 것은 `attachShellIntegration` 이 보장한다.
     */
    onstatus?: (paneId: string, status: PaneStatus | null) => void;
    /**
     * 동시 입력 (4단계) — 이 패널에서 친 것을 상위(탭)가 대신 뿌릴 기회.
     *
     * `true` 를 돌려주면 "내가 처리했다" 는 뜻이라 이 패널은 **자기 write 를 하지 않는다**
     * (브로드캐스트 목록에 자기 자신이 들어 있어 이미 한 번 받는다 — 안 그러면 두 번 친다).
     * `false`/미지정이면 지금까지처럼 자기 세션에만 보낸다.
     */
    onbroadcast?: (data: string) => boolean;
    /**
     * 이 패널이 물고 있는 **백엔드 세션 id** 가 바뀔 때마다 알린다 (없으면 `null`).
     *
     * 세션 id 는 여기서만 알 수 있는데(재연결마다 새로 발급된다) 포트 포워딩 모달은
     * `+page` 에 있다 — 그래서 패널→세션 맵을 상위가 유지하도록 올려 보낸다.
     * 열림 직후 · 종료(ssh-exit) · 언마운트 세 곳에서 부른다
     * (docs/log/2026-09-01-port-forward.md).
     */
    onsession?: (paneId: string, sessionId: number | null) => void;
    /**
     * 셸이 **OSC 0/2 로 창 제목을 바꿨다** (xterm 의 `onTitleChange`). 로컬 타일 헤더·탭이
     * 이 값을 셸 이름 대신 띄운다 (`ssh user@host` 를 로컬 셸 안에서 돌리면 원격 제목이
     * 그대로 헤더에 뜬다). 표시 전용이라 레이아웃 트리는 건드리지 않는다.
     */
    ontitle?: (paneId: string, title: string) => void;
    /**
     * 로컬 세션이 열린 직후, 백엔드가 **해석한 셸 id** 를 한 번 올린다 (기본 `None` 이
     * `pwsh`/`powershell` 중 무엇으로 환원됐는지). 로컬 타일 헤더가 "로컬" 대신 진짜 셸
     * 이름을 띄우는 근거다 — SSH 열림에서는 부르지 않는다.
     */
    onshell?: (paneId: string, shell: string) => void;
    /**
     * **tmux 세션에 붙었다** — 백엔드가 고른 이름(`aynx-1` …)을 한 번 올린다
     * (docs/log/2026-09-16-tmux-toggle.md).
     *
     * `onshell` 과 같은 자리·같은 순간이지만 **가는 곳이 다르다**: 저쪽은 표시용 곁 저장소
     * (`app/titles`)이고 이쪽은 **타일 자체**(`PaneSpec.tmux`)다. 배치 파일에 저장되고
     * 재접속 힌트로 되돌아가야 하므로 트리 안에 있어야 한다.
     */
    ontmux?: (paneId: string, name: string) => void;
    /**
     * **지금 도는 명령이 바뀌었다** (OSC 133 `C` → 명령문 · `D` → `null`).
     *
     * 타일의 앞자리 아이콘·이름이 이 값을 본다 — PowerShell 타일에서 `claude` 를 손으로
     * 띄우면 도는 동안 그 칸이 "Claude Code" 가 되고, 빠져나오면 셸로 돌아온다
     * (docs/log/2026-09-16-ai-tile-identity-from-command.md). 표시 전용이라 레이아웃 트리는
     * 건드리지 않는다 — `ontitle`·`onshell` 과 같은 층(`app/titles`)이다.
     *
     * 셸 통합이 없는 세션(cmd.exe · 주입 실패 · tmux 안)에서는 **한 번도 불리지 않는다**.
     */
    oncommand?: (paneId: string, command: string | null) => void;
    /**
     * `Ctrl+Shift+E` — 원격 파일 편집 모달을 열어 달라 (5단계 — SFTP).
     *
     * 창 단위 단축키가 아니라 **여기서** 받는 이유는 대상이 "활성 패널" 이기 때문이다:
     * 키를 받은 터미널이 곧 그 패널이라 어느 세션인지 따로 계산할 필요가 없다.
     * (헤더의 ✎ 와 같은 곳으로 간다 — 헤더가 없는 1패널 탭의 진입점이 이 키다.)
     */
    onrequestedit?: () => void;
    /**
     * **파일 경로를 Ctrl+클릭했다** — 문서 보기로 열어 달라 (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
     * 화면 글자의 경로(`term-path-links.ts`)와 로컬 타일의 OSC 8 `file://` 링크가 이리로 온다. 경로는 이 셸의 폴더
     * 기준으로 이미 풀려 있고(`home` 이면 홈 기준 나머지), 파일인지 확인하고 자리를 잡는 일은 위(`openPathFromTerminal`).
     * `line` 은 화면 글자의 꼬리 `:12`(1 기준) — 있으면 연 문서가 그 줄로 한 번 스크롤한다. OSC 8 링크에는 없다.
     */
    onopenpath?: (target: NonNullable<ResolvedPath>, line?: number) => void;
    /**
     * **터미널 본문을 우클릭했다** — 그 자리에 메뉴를 열어 달라
     * (docs/log/2026-09-05-terminal-context-menu.md).
     *
     * 여기서 직접 그리지 않는 이유는 **스택 문맥**이다: 타일 상자(`.pane-box`)마다
     * `isolation: isolate` 라 그 안의 `position: fixed` 요소는 뒤에 그려지는 이웃 타일과
     * 분할선 층에 덮인다. 그래서 메뉴는 캔버스의 마지막 자식으로 한 벌만 살고
     * (`PaneHost` 의 `PaneMenu`), 여기서는 **좌표와 그 순간의 사정**만 올려 보낸다.
     *
     * 누른 항목이 되돌아오는 길은 프롭이 아니라 레지스트리다 (`$lib/term-actions`) —
     * 헤더 ⋯ 와 같은 메뉴를 쓰므로 항목의 신원이 `PaneMenuAction` 문자열 하나뿐이고,
     * 그 문자열을 받는 곳은 `PaneHost` 다.
     */
    onmenu?: (
      x: number,
      y: number,
      ctx: {
        link: string | null;
        hasSelection: boolean;
        hasOutput: boolean;
        /**
         * 누른 줄에서 찾은 **저장할 만한 명령** (없으면 `null`) —
         * docs/log/2026-09-16-snippets.md. 링크·선택과 같은 스냅샷이다.
         */
        snippet: SnippetSource | null;
        /**
         * 누른 줄의 **끝난 블록**(없으면 이 타일의 마지막 끝난 블록) — "이 블록을 AI 에게 묻기…" 의 대상
         * (docs/log/2026-09-28-ask-ai-block.md). 블록이 하나도 없으면 `null`(그 줄이 서지 않는다).
         */
        ask: AskBlockRef | null;
        /** 그때 고른 글자(없으면 `null`) — "사이드 채팅에 묻기"(v2 5단계)가 그대로 칸에 채운다 */
        selection: string | null;
      },
    ) => void;
    confirmHostKey?: ConfirmHostKey;
    promptPassword?: PromptPassword;
    promptPassphrase?: PromptPassphrase;
  } = $props();

  // ---------------------------------------------------------------------------
  // AI 컨텍스트 미러링 (6단계 — docs/log/2026-09-02-mcp-frontend.md)
  //
  // 이 패널의 명령 맥락을 Rust 컨텍스트 저장소에 비춰 MCP 서버가 외부 AI 에게 내어 주게
  // 한다. 저장소 키는 패널당 한 번만 만든다 (창 레이블 + 패널 id). 밀어 올리는 것은
  // **공유가 켜진 패널뿐이다** (`aiOn` — 프라이버시). 모든 invoke 는 오류를 삼킨다.
  //
  // "공유가 켜졌다" 의 뜻은 타일 종류로 갈린다 (2026-10-07 — `app/delegation.svelte.ts` 의 `paneAiReadable`):
  // 로컬은 타일의 "AI 읽기 허용" 토글, 원격은 **호스트의 AI 권한 단계가 `read` 이상**이다. 단계가
  // `off` 로 내려가면 로컬 토글을 끈 것과 똑같이 `optedIn:false` 가 나가 서버 쪽 데이터가 지워진다.
  // ---------------------------------------------------------------------------
  // **거울 키 = `pane.historyStreamId`** (2026-09-09 · 정체성 분리). 창 이관·리로드를 넘는
  // 안정 신원이라, AI 의 외부 참조 `(session, blockId)` 가 타일이 창을 옮겨도 살아 있다.
  // (프런트 블록 저장소는 여전히 `pane.id` 로 키를 잡는다 — 재연결·검색·거터는 안 건드린다.)
  // 세션 타일에는 생성자가 늘 발급하므로 `?? pane.id` 는 TS 방어일 뿐 실제로는 안 탄다.
  const contextKeyOf = $derived(pane.historyStreamId ?? pane.id);
  // **타일 코드**(`p2` / `t7·p2`) — 헤더가 보여 주는 것과 같은 짧은 손잡이. 거울 키와 달리
  // 이건 **지금 위치**라, 이관으로 창이 바뀌면(=`pane.id` 재부여 → 리마운트) 새 값으로
  // 다시 보고된다. 같은 창 안의 이동은 `pane.id` 가 그대로라 코드도 그대로다(위치가 아니라
  // 타일 신원의 투영이므로) — 다시 보고할 것이 없다.
  const codeOf = $derived(tileCode(currentWindowLabel(), pane.id));

  /**
   * **시청자 타일인가**(원격 웹 R2-B) — 원격 창의 터미널 타일은 집 PC 의 세션에 **시청자로 붙기만** 한다(`attachSessionViewer`): 세션을 열지도
   * 닫지도 않고(손잡이의 닫기 = 시청 끝), 자동 실행 · 설정 스크립트 · 재접속 · 체크포인트 · MCP 거울 보고를 하지 않는다(그 일은 집 PC 의
   * 주 타일이 한다 — 원격이 거울을 덮거나 지우면 AI 가 보는 타일이 엉킨다). 세션이 없거나 끝나면 기다렸다 다시 붙는다(`viewerConnect`).
   */
  const viewer = isRemote;

  /** 이 타일이 AI 에게 보이는가 — 로컬은 타일 토글, 원격은 호스트 단계(위 머리 주석). 시청자는 거울을 올리지 않는다. */
  const aiOn = $derived(!viewer && paneAiReadable(pane));
  /** 원격 타일의 호스트 별칭(호스트 목록에 있는 것만) — `report_session` 의 `hostAlias` */
  const hostAliasOf = $derived(aiHostAlias(pane));

  /**
   * **화면만 있는 세션인가** (간이 모드 — tmux 타일 · docs/log/2026-09-16-tmux-toggle.md).
   *
   * 판정은 `pane.tmux` 하나다. 참이면 이 타일에는 셸 통합 파서를 **아예 붙이지 않는다**
   * (출력을 거르는 것이 아니라 싱크를 안 만든다 — 거르면 "언젠가 올 수도" 라는 여지가 남고,
   * 그 여지가 곧 반쯤 맞는 블록 이력이다). 그래서 블록에 기대는 것은 전부 **꺼진 것으로
   * 표시된다**: 명령 점프·마지막 출력 복사·`#` 블록 검색·AI 의 명령 읽기.
   *
   * 꺼지지 **않는** 것: 활동 표시·화면 검색·스크롤백·입력·재연결·📂.
   */
  const screenOnly = $derived(pane.tmux !== undefined && pane.tmux !== "");

  /**
   * **첫 접속에서 뒤늦게 알게 된 간이 모드를 따라잡는다.**
   *
   * 새 타일은 `pane.tmux` 를 모른 채 마운트된다 — 그 이름은 **백엔드가 고르고** 접속의 답에
   * 실려 오기 때문이다(복원·이관은 이미 들고 온다). 그 창에서는 파서가 붙어 버리므로, 답이
   * 온 순간 여기서 걷는다: 등록한 OSC 133/7/9 핸들러와 데코레이션이 함께 사라져 **그 뒤로는
   * 마운트부터 tmux 였던 타일과 완전히 같은 상태**가 된다.
   *
   * 되돌리지는 않는다 (`pane.tmux` 는 한 번 붙으면 이 타일이 사는 동안 풀리지 않는다).
   */
  $effect(() => {
    if (!screenOnly || !shell) return;
    shell.dispose();
    shell = null;
    // 파서가 사라졌으니 이 타일에는 더 이상 OSC 133 상태도, 도는 명령도 없다 — 그 사실을
    // 위로 한 번 올려 옛 값이 헤더·아이콘에 굳은 채 남지 않게 한다 (활동 점 폴백으로 간다).
    onstatus?.(pane.id, null);
    oncommand?.(pane.id, null);
  });

  /**
   * 공유가 켜져 있으면 지금 명령 맥락(상태·마지막 명령·스크롤백 꼬리)을 서버로 밀어 올린다.
   *
   * **간이 모드(tmux)는 파서가 없어도 스크롤백 꼬리만은 올린다** — 09-16 기록의 "꺼지지 않는 것:
   * AI 읽기(스크롤백)" 와 MCP `mode:"screen"` 설명("get_scrollback 으로 읽어라")이 약속한 그대로다
   * (2026-10-08 까지는 `!shell` 에서 돌아서 거울이 한 번도 안 올라갔다). 상태·마지막 명령은 없으니
   * `null` 이고, 때는 상태 전이 대신 출력이 잠잠해진 뒤·쏟아지는 동안 상한마다([`scheduleScreenPush`])다.
   * 공유가 꺼져 있으면 어느 쪽도 아무것도 올리지 않는다(프라이버시).
   */
  function pushContext() {
    if (!aiOn) return;
    if (shell) {
      void updateSessionContext(contextKeyOf, shell.status(), shell.last(), shell.tail(400));
      return;
    }
    if (!screenOnly || !term) return;
    void updateSessionContext(contextKeyOf, null, null, screenTail(term.buffer.active, 400));
  }

  /** 간이 모드 거울 타이머와 아직 거울에 안 실린 첫 출력 시각 (`null` = 밀린 것 없음) */
  let screenPushTimer: ReturnType<typeof setTimeout> | undefined;
  let screenPendingSince: number | null = null;

  /**
   * 간이 모드 출력이 왔다 — 잠잠해진 뒤(1초) 올리되, 쏟아지는 동안에도 첫 출력에서 5초마다는 올린다
   * (`term/screen-tail.ts` 의 `screenPushDelay`). 보이지 않는 타일도 올린다(숨은 탭도 버퍼는 산다).
   * 일반 타일·공유 꺼짐은 건드리지 않는다.
   */
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

  /**
   * **이관으로 이력을 안고 온 타일인가** (2026-09-09 · 거울 재구성).
   *
   * 마운트(`onMount`)가 아니라 **컴포넌트가 생길 때** 정한다 — 아래 공유 `$effect` 는
   * `onMount` 보다 먼저 도는데(선언 순서), `mount()` 가 `pane.restore` 를 그 자리에서
   * 지우기 때문이다. 반응형 값이 아니라 그냥 `let` 이다: 한 번 쓰고 끄는 일회용 표시다.
   * (`untrack` 은 "지금 이 한 번만 본다" 를 컴파일러에게 말해 두는 것이다 — 이 값은
   * 곧 지워지고, 그 지움이 이 표시를 되돌리면 안 된다.)
   */
  let carriedHistory = untrack(() => pane.restore !== undefined);

  /**
   * 직전 `$effect` 실행에서 공유가 켜져 있었는가 — **OFF→ON 전이**를 잡는 표시다.
   *
   * 반응형 값이 아니라 그냥 `let`(`carriedHistory` 와 같은 성질): 이 값을 `$state` 로 두면
   * 아래 `$effect` 가 자기가 쓴 값을 다시 읽어 스스로를 깨운다. 컴포넌트가 새로 생길 때는
   * 언제나 꺼짐에서 시작하므로(마운트 기본값·이관 복원 모두), 첫 ON 은 항상 전이로 잡힌다.
   */
  let prevShared = false;

  /**
   * 이 페이지가 거울에 한 번이라도 보고했는가(`shouldReportMirror` — 2026-11-10). 새 페이지의 첫 꺼짐은 세션이 서기 전엔 보내지
   * 않는다 — 붙기가 공유 토글을 되살리기 전의 꺼짐이 서버 거울(창이 없던 동안 서버가 쓴 블록)을 지우지 않게. `prevShared` 와 같은
   * 성질의 그냥 `let` 이다.
   */
  let mirrorAnnounced = false;

  /**
   * 공유 토글을 구독한다. 마운트 시 한 번(꺼짐)으로 서버에 패널을 알리고, 헤더의 토글이
   * 뒤집힐 때마다 다시 알린다. **켤 때는 곧바로 한 번 밀어 올려** 공유된 화면이 신선하게
   * 시작하도록 한다 (`optedIn:false` 는 서버 쪽 공유 데이터를 지운다 — 프라이버시).
   */
  $effect(() => {
    // 설정·호스트 패널은 세션이 없다 — Terminal 이 마운트되지 않으므로 여기 오지 않지만,
    // kind 가 넓어졌으니 방어한다 (이 뒤로 pane.kind 는 SessionKind 로 좁혀진다).
    // 시청자(원격 창)는 거울에 보고하지 않는다 — 그 스트림의 거울은 집 PC 주 타일의 것이다(`viewer` 주석).
    if (!hasSession(pane.kind) || viewer) return;
    const key = contextKeyOf;
    const on = aiOn;
    // 실행 라우팅(단계 9): SSH 타일이면 지금 물고 있는 백엔드 세션 id 를 함께 보낸다. `sessionOf`
    // 를 읽어 이 `$effect` 가 세션 id 변화(연결·재연결·끊김)에도 다시 돌게 한다 — 라우팅 표가
    // 늘 살아 있는 연결을 가리키게. 로컬 타일은 undefined(서버가 라우팅에서 지운다).
    const live = sessionOf(pane.id);
    const sshSessionId = pane.kind === "ssh" ? (live ?? undefined) : undefined;
    // 새 페이지의 첫 꺼짐(붙기가 토글을 되살리기 전)은 보내지 않는다 — `live` 를 읽으므로 세션이 서는 순간 이 `$effect` 가 다시 돈다
    // (붙기는 토글을 되살린 **뒤** 세션을 알린다 — 같은 틱이라 첫 보고가 켜진 채 나간다).
    if (!shouldReportMirror(on, mirrorAnnounced, live !== null && live !== undefined)) return;
    mirrorAnnounced = true;
    const reported = reportSession(
      key,
      paneName(pane, tr),
      pane.kind,
      codeOf,
      on,
      sshSessionId,
      // tmux 타일은 파서를 아예 안 붙여 블록이 **영영** 안 올라온다 — 그 사실을 함께 보낸다
      // (MCP `mode:"screen"`). 안 보내면 AI 가 빈 이력을 "아직" 으로 읽는다.
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
    // ── 켤 때 이력 백필 (OFF→ON) ─────────────────────────────────────────────
    // 증분 경로(`onblock`)는 **공유가 켜진 뒤에 닫힌** 블록만 거울로 나른다 — 켜기 전에
    // 이미 돌아간 명령은 AI 가 못 본다. 그래서 공유가 꺼짐→켜짐으로 뒤집힐 때(그리고
    // 이관으로 켜진 채 마운트될 때) 지금 프런트 링에 남은 이력을 **딱 한 번** 통째로 심는다.
    // 이것은 "공유 시점의 최근 이력" 이지 "지금껏의 전부" 가 아니다 — 링에서 이미 축출된
    // 오래된 블록은 없고, 상한(200블록·1MB)은 Rust 가 다시 지킨다.
    //
    // 이관(`carriedHistory`)도 이 한 경로로 흡수된다: 새 키는 빈 상태라 재구성이 곧 백필이다.
    // 중복 걱정은 없다 — Rust `push_block` 이 id 로 upsert 하므로 배치와 증분이 같은 블록을
    // 겹쳐 밀어도 한 번만 남는다 (context.rs 의 근거 주석).
    //
    // 등록(`report_session`)이 **끝난 뒤에** 보낸다 — 키가 아직 없으면 Rust 가 조용히 버린다.
    // 전이일 때만 보낸다: 공유 중 이름이 바뀌어 `$effect` 가 다시 돌아도 다시 밀지 않는다.
    const turnedOn = !prevShared || carriedHistory;
    prevShared = true;
    if (!turnedOn) return;
    carriedHistory = false;
    const blocks = blocksOf(pane.id);
    if (blocks.length > 0) void reported.then(() => pushSessionBlocks(key, blocks));
  });

  /**
   * **로컬 타일의 "AI 읽기 허용" 을 세션 서버의 세션 메타에 남긴다** (③-4) — GUI 를 다시 켜면 다시 붙는 타일이 이 값으로
   * 토글을 되살린다([`attachDetached`] — probe 의 `aiRead`). 예전에는 창 메모리라 재시작마다 꺼졌다.
   *
   * **세션이 선 뒤에만** 보낸다 — 마운트 직후(토글은 아직 꺼짐)에 `false` 를 보내면 붙기 전에 서버 값이 지워진다. 같은
   * 세션·같은 값이면 다시 보내지 않는다(새 셸이 열리면 그 세션에 다시 적는다).
   */
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

  /**
   * **로컬 AI CLI 타일에는 AI 읽기 허용이 없다**(10-23 사용자 결정) — 되살아난 · 옮겨 온 타일에 켜진 값이 남아 있거나 셸에서 CLI 가
   * 떠 AI 타일이 되면 같은 끄기 길(`setShared(…, false)`)로 끈다. 서버 메타는 위 `$effect` 가 `aiOn`(= `paneAiReadable` — AI 타일은
   * 늘 `false`)을 따라 `false` 로 고친다.
   */
  $effect(() => {
    if (localAiTile(pane) && isShared(pane.id)) setShared(pane.id, false);
  });

  /**
   * 활동 알림 간격. 출력 한 덩어리마다 상위 상태를 건드리면 대량 출력 시
   * 프레임마다 재렌더가 돈다 — 어차피 표시는 점 하나라 0.5초면 충분하다.
   */
  const ACTIVITY_THROTTLE_MS = 500;
  let lastActivity = 0;

  /**
   * 상자 크기가 **멎고 나서** refit 하기까지 기다리는 시간(ms).
   * 근거는 아래 `ResizeObserver` 를 거는 자리의 주석에 있다.
   */
  const REFIT_DEBOUNCE_MS = 80;

  /** AI 타일의 출력 시각을 마지막으로 올린 시각 (같은 500ms 스로틀) */
  let lastAgentTick = 0;

  /**
   * onData 에서 부른다. 보고 있는 탭은 건너뛴다 (점을 켤 이유가 없다).
   *
   * AI 타일의 **마지막 출력 시각**도 이 자리에서 올린다 — 같은 500ms 로 줄이되 **보고 있는 탭도**.
   * 에이전트 상태 점을 정하지는 않는다(포커스 보고 · 크기 맞춤의 다시 그리기도 출력이라 —
   * docs/log/2026-10-01-agent-status-three.md). 새 AI 타일이 붙여 넣기를 받을 준비가 됐나 · 셸 프롬프트
   * 복귀가 에이전트 뒤의 것인가가 읽는다. AI 타일인지는 받는 쪽(`app/agent-status`)이 가른다.
   */
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

  // ---------------------------------------------------------------------------
  // 출력만 복사 (5단계 · docs/log/2026-09-02-osc133.md)
  //
  // 결과는 **터미널 버퍼가 아니라 겹치는 토스트**로 알린다. 버퍼에 찍으면 복사 한 번마다
  // 스크롤백에 안내 줄이 쌓이고, 그 줄들이 다음 명령의 출력 구간 한가운데 끼어든다.
  // ---------------------------------------------------------------------------

  /** 복사 결과 → 사용자에게 보여 줄 한 줄. 성공도 말해 준다 (클립보드는 눈에 안 보인다) */
  const COPY_MESSAGE: Record<CopyResult, Key> = {
    ok: "pane.term.copy.ok",
    empty: "pane.term.copy.empty",
    denied: "pane.term.copy.denied",
    none: "pane.term.copy.none",
  };

  /** 잠깐 떴다 사라지는 안내 (`null` = 없음) */
  let toast = $state<{ text: string; ok: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const TOAST_MS = 2500;

  function showToast(result: CopyResult) {
    showNote(tr(COPY_MESSAGE[result]), result === "ok");
  }

  /** 같은 토스트를 임의의 한 줄로 — 클립보드·링크 조작이 결과를 알릴 때 쓴다 */
  function showNote(text: string, ok: boolean) {
    toast = { text, ok };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), TOAST_MS);
  }

  // ---------------------------------------------------------------------------
  // 스크롤백 내보내기 · 세션 로그 열기
  // (docs/log/2026-09-17-scrollback-export-and-logs.md)
  //
  // 저장 대화상자 · 파일 쓰기 · 로그 열기와 그 앱 토스트는 `term/scrollback-actions.ts`. 타일의 값은 게터로 넘긴다
  // (`term` · `logPath` 는 `mount()` · 세션 수명이 채운다). 부르는 자리는 아래 터미널 창구(`termActions`).
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 우클릭·클립보드 (docs/log/2026-09-05-terminal-context-menu.md)
  //
  // 설정 `[terminal] right_click` 이 두 벌을 가른다:
  //
  // | | 우클릭 | Shift+우클릭 | 드래그 선택 |
  // | --- | --- | --- | --- |
  // | `menu`(기본) | 컨텍스트 메뉴 | 즉시 붙여넣기 | (아무 일도 없음) |
  // | `paste` | 붙여넣기 | 컨텍스트 메뉴 | 놓는 순간 클립보드로 복사 |
  //
  // `paste` 에서 **선택이 있어도 우클릭은 붙여넣기**다 (사용자 정의 — 선택=복사,
  // 우클릭=붙여넣기). 즉 우클릭 한 번의 뜻이 선택 유무에 따라 갈리지 않는다.
  // ---------------------------------------------------------------------------

  /** 마우스가 지금 올라가 있는 링크 (`null` = 링크 위가 아니다). 링크 프로바이더 둘이 채운다 */
  let hoveredLink: string | null = null;
  /**
   * **우클릭한 그 순간의** 링크. 메뉴 항목이 실행될 때 커서는 이미 메뉴 위에 있어
   * [`hoveredLink`] 는 `null` 로 돌아가 있다 — 그래서 스냅샷을 따로 든다
   * (`docs/conventions.md` 의 "값을 스냅샷한 뒤에 닫는다" 와 같은 결의 문제다).
   */
  let menuLink: string | null = null;

  // ---------------------------------------------------------------------------
  // 우클릭한 줄 → 명령 블록 (docs/log/2026-09-16-snippets.md)
  //
  // 우클릭 메뉴의 "스니펫으로 저장" 은 **가리킨 줄의 명령**을 대상으로 삼는다. 그 다리가
  // 여기 둘이고, 둘 다 우클릭 **그 순간**에만 돈다 (메뉴가 떠 있는 동안 화면은 계속 흐른다).
  //
  // 자리를 이 컴포넌트로 잡은 이유는 재료가 여기에만 모여 있기 때문이다: 화면 기하(어느
  // 줄을 눌렀나)는 xterm 인스턴스가, 블록 → 줄 다리는 `shell.lineOfBlock` 이, 블록 자체는
  // 이력 저장소가 쥔다. 규칙만큼은 순수 층에 있다 (`blockAtRow` — 테스트가 그것을 본다).
  // ---------------------------------------------------------------------------

  // 몸통(화면 좌표 → 버퍼 줄 → 블록 · 앵커)은 `term/block-target.ts` — 값은 게터로 넘긴다(`shell` 은 `mount()` 가 채운다).
  const { snippetSourceAt, askRefAt, blockAnchorOf } = createBlockTarget({
    get paneId() {
      return pane.id;
    },
    get shell() {
      return shell;
    },
  });

  // ---------------------------------------------------------------------------
  // 입력 중 스니펫 제안 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안") — 상태·다시 세기·수락·상자 키·IME 는
  // `term/snippet-suggest.svelte.ts`. 여기 남는 것: 그림(`SnippetSuggest`) · 리스너 부착(`mount()`) · 접는 두 `$effect`.
  // ---------------------------------------------------------------------------

  /** 이 타일의 SSH 별칭 (로컬·끊긴 타일은 `null`) — 범위 거르기가 받는 값 */
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

  // 선택 자동 복사 · 선택 복사 · 붙여넣기 요청과 확인 대기(고칠 수 있는 글 · 줄 수 · [붙여넣기] 단추) · 클립보드 읽기 —
  // `term/clipboard-controller.svelte.ts`(2026-10-27 분할 6차). 실제로 넣는 `pasteToTerm`(입력 출처의 동기 구간)과 토스트는 여기 남아 넘긴다.
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

  /**
   * **입력 출처의 문맥**(오케스트레이션 5단계 — `$lib/term/input-source`) — 붙여넣기 · 키 이벤트가 도는 동안 `onData` 로 나온 글은
   * 사람 것이다(내용이 터미널 응답과 같은 모양이어도 — Ctrl+F3 = `ESC[1;5R`). 그 밖의 응답 모양은 xterm 이 스스로 낸 터미널 응답.
   */
  let inputPasting = false;
  let inputKeyEvent = false;

  /** `term.paste()` — 그 동안 나온 글은 붙여넣기(사람)로 친다(`paste()` 는 `onData` 를 동기로 낸다) */
  function pasteToTerm(text: string) {
    inputPasting = true;
    try {
      term?.paste(text);
    } finally {
      inputPasting = false;
    }
  }

  // 확인 모달의 [붙여넣기] 버튼 — 모달이 뜨면 여기로 포커스를 옮긴다(까닭은 `clip.pasteConfirmBtn` 머리말).
  $effect(() => {
    if (clip.pastePrompt) clip.pasteConfirmBtn?.focus({ preventScroll: true });
  });

  // 마운트 시 한 번 만들고 탭이 닫힐 때까지 유지한다. active=false 여도 dispose 하지 않는다.
  let term: Terminal | null = null;
  /** 숨은 동안 DOM 렌더러가 행을 그리지 않게 하는 문(`term/hidden-render-gate.ts` — 탭 전환 멈춤). `mount()` 의 `t.open` 뒤에 선다 */
  let renderGate: HiddenRenderGate | null = null;
  let fit: FitAddon | null = null;
  let session: SessionHandle | null = null;
  /**
   * **여는 중의 입력** — 새 세션의 손잡이가 서기 전에 xterm 이 내는 입력(대개 셸 시작 때의 커서 위치 질의 `ESC[6n` 에 대한
   * 답)을 모았다가 손잡이가 서면 보낸다. 세션 서버(③-2)의 셸은 그 답을 받아야 첫 출력을 낸다 — 출력 프레임이 열기 응답보다
   * 먼저 닿으면 답이 버려져 셸이 멈춘다(서버는 붙은 창이 있는 동안 대신 답하지 않는다 — 두 번 답하면 남는 답이 입력으로 샌다).
   */
  let opening = false;
  let earlyInput = "";
  /** 모인 여는 중 입력의 출처(대개 터미널 응답 — `protocol`) */
  let earlySource: InputSource | null = null;
  const EARLY_INPUT_CAP = 4096;
  /**
   * OSC 133 명령 경계 (5단계). **터미널에 붙어 있지 세션에 붙어 있지 않다** — 재연결로
   * 세션이 갈려도 버퍼가 그대로이므로 명령 레코드도 그대로 이어진다 (역압 카운터와 같은
   * 이유다). 터미널과 함께 나고 죽는다.
   */
  let shell: ShellIntegration | null = null;

  // ── 블록 리치 보기 카드 (2026-10-18 — `term/BlockView.svelte`) ─────────────────────────────
  /** 지금 펼친 블록(없으면 `null`) — 화면 상태일 뿐(저장 · 이관 안 함) */
  let blockView = $state<BlockViewOpen | null>(null);
  /** 카드의 기준 상자(`.term`) */
  let termRoot = $state<HTMLDivElement | null>(null);

  /**
   * 블록 줄의 [리치하게 보기] — 출력은 **버퍼의 전부**(`blockOutput` — "출력만 복사" 와 같은 읽기)가 먼저, 밀려났으면 이력의
   * 발췌(가운데가 빠졌다고 카드가 말한다). 이미 화면에 있던 글자뿐이다.
   */
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

  /** 카드가 줄어들 자리 — 그 블록 줄의 **지금** 가운데(상자 기준). 스크롤로 화면 밖이면 `null`(상자 가운데로) */
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
  /**
   * 표시 트리거 하이라이트 (`$lib/triggers`). OSC 133 과 같은 이유로 **터미널에 붙어 있다** —
   * 마커·데코레이션이 버퍼 좌표라 세션이 갈려도 그대로 이어진다.
   */
  let triggers: TriggerHighlighter | null = null;
  /** 파일 경로 링크 프로바이더 (`term-path-links.ts`) — 트리거처럼 터미널보다 먼저 뗀다 */
  let pathLinks: { dispose(): void } | null = null;

  /**
   * 경로 링크를 풀 자리 — 이 셸이 어디의 셸이고 지금 어느 폴더인가(OSC 7). 호버마다 부른다(`cd` 를 따라간다).
   * 상대 경로는 폴더를 모르면 걸지 않는다(`resolvePathLink`).
   */
  function pathPlace(): PathLinkPlace | null {
    const cwd = shell?.cwd() ?? null;
    if (pane.kind === "ssh") return { kind: "remote", cwd };
    if (pane.kind !== "local") return null;
    const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
    if (distro) return { kind: "wsl", cwd, toLocal: (p) => wslCwdToWindows(distro, p) };
    return { kind: "local", cwd };
  }
  /** 언마운트됐다 — 진행 중인 접속·타이머는 전부 여기서 걸러 낸다 */
  let disposed = false;
  /**
   * **이 세션이 쓰고 있는 세션 로그 파일** (`null` = 로깅이 꺼져 있다 ·
   * docs/log/2026-09-17-scrollback-export-and-logs.md).
   *
   * 값을 **미리 받아 두는** 이유는 메뉴가 동기이기 때문이다: ⋯ 메뉴의 항목 목록은
   * `PaneHost` 의 `$derived` 한 줄에서 만들어지므로 그 자리에서 `await` 할 수 없다.
   * 메뉴가 열린 뒤에 답이 도착하게 두면 "세션 로그 열기" 가 눈앞에서 흐림/켜짐으로
   * 바뀐다 — 그래서 세션이 붙는 그 순간에 한 번 묻고 여기에 붙들어 둔다.
   * 로깅 여부는 접속 시각에 정해져 세션이 사는 내내 변하지 않으므로 갱신할 일도 없다.
   */
  let logPath: string | null = null;

  /** 새 세션이 붙었다 — 그 세션의 로그 경로를 한 번 묻는다 (실패는 `null` 로 삼켜진다) */
  async function refreshLogPath(handle: SessionHandle) {
    const path = await logPathOf(handle.kind, handle.id);
    // 그 사이 세션이 갈렸으면(재연결·이관) 늦게 온 답을 버린다.
    if (!disposed && session?.id === handle.id) logPath = path;
  }

  // ---------------------------------------------------------------------------
  // 터미널 검색 (addon-search) — 창 전역 오버레이가 `search-registry` 로 두드리는 창구
  // (애드온·질의·매치 번호·남긴 강조는 `term/search.ts`). 애드온도 상태도 **터미널과 같은 수명**이다 —
  // 등록(`registerSearch`)·부착(`t.open` 뒤)·정리는 `mount()` 가, 포커스를 잃으면 지우는 것은 아래 `$effect` 가 한다.
  // ---------------------------------------------------------------------------
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

  /**
   * 남긴 강조의 두 번째 계기 — **포커스를 잃으면** 지운다.
   *
   * `active`(= 탭 활성 && 패널 활성)가 내려가는 것이 이 앱에서 "이 터미널에서 눈을 뗐다" 의
   * 정확한 정의다. 다른 타일을 고르든 탭을 갈아타든 **둘 다 `active` 를 내리므로**,
   * 계기를 여기 한 곳에만 걸면 두 몸짓이 함께 잡힌다 (탭 전환을 따로 구독할 이유가
   * 없다는 뜻이다).
   *
   * 마운트 직후 `active=false` 로 한 번 도는 경우가 있는데 그때 상태는 `idle` 이라
   * `stepKept` 가 `idle → idle`(지우지 않음)로 흘려보낸다 — 무해하다.
   */
  $effect(() => {
    if (!active) {
      termSearch.keptEvent("blur");
      // 제안 상자도 같은 계기에 접는다 — 포커스가 없는 타일의 커서 옆에 목록이 떠 있으면
      // 어느 프롬프트의 것인지가 화면에서 사라진다 (`active` 의 뜻은 "이 타일이 키를 받는다").
      suggest.closeSuggest();
    }
  });

  /**
   * 설정을 끄면 **그 자리에서** 접는다. 다시 세는 쪽(`recomputeSuggest`)도 이 값을 보지만
   * 그쪽은 셸이 뭔가를 써야 돌아서, 아무 일도 없는 프롬프트에 상자가 남아 있게 된다.
   */
  $effect(() => {
    if (!settings.inlineSnippets) suggest.closeSuggest();
  });

  // ---------------------------------------------------------------------------
  // 렌더러 애드온 — WebGL(보이는 패널에만) · 합자(옵트인, WebGL 위에서만) · 인라인 이미지
  // (몸통·상태·정책 주석은 `term/renderer-addons.ts`). **언제 붙이고 떼는지는 여기서 정한다** —
  // 아래 두 `$effect`(이미지 설정 · 가시성/렌더러) · `mount()` 의 첫 이미지 부착 · 정리 순서.
  // ---------------------------------------------------------------------------
  const addons = new RendererAddons({
    get term() {
      return term;
    },
    get disposed() {
      return disposed;
    },
  });

  // 설정 토글을 **열린 타일에도 바로** 따른다. 첫 실행은 `term` 이 없어 걸러지고(이 효과가
  // `onMount` 보다 먼저 돈다), 첫 부착은 `mount()` 가 `t.open` 직후에 한다.
  $effect(() => {
    if (settings.inlineImages) addons.loadImages();
    else addons.unloadImages();
  });

  // 모양과 뜻(세 배너의 차이)은 `term/Banners.svelte` 의 `Reconnect` · `Deferred` · `Ended`. 배너가 이 값을 그린다.
  let reconnect = $state<Reconnect | null>(null);

  let deferred = $state<Deferred | null>(null);
  /** 연결 레지스트리 해제 함수 — 붙는 데 성공하면 그 자리에서, 아니면 언마운트에서 부른다 */
  let unconnect: (() => void) | null = null;

  let ended = $state<Ended | null>(null);

  /**
   * **재부착 유실 안내** (`null` = 없음) — 떨어진 세션에 다시 붙었는데 링을 넘긴 출력이 있었다. 버퍼가 아니라 타일 위
   * 막대(`Banners`)로 띄운다 — 버퍼 한 줄은 재생·실시간 출력·재그림에 묻혀 보이지 않았다(설치본 실기 10-10).
   * 아무 키 · 클릭 · [`LOST_NOTICE_MS`] 뒤 자동으로 걷힌다.
   */
  let lost = $state<LostNotice | null>(null);
  let lostTimer: ReturnType<typeof setTimeout> | undefined;

  function showLost(n: LostNotice) {
    lost = n;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => (lost = null), LOST_NOTICE_MS);
  }

  /** 타일의 아무 키 · 클릭이 유실 안내를 걷는다 (캡처 단계 — xterm 이 키를 삼키기 전) */
  function dismissLostOnKey(ev: KeyboardEvent) {
    if (lost && dismissesLostNotice(ev.key)) lost = null;
  }
  function dismissLostOnPointer() {
    if (lost) lost = null;
  }

  /**
   * **"살아 있는 세션이 없다" 는 하나의 술어** — 죽은 타일에서만 도는 키(Enter·Ctrl+D)와
   * 배너가 함께 보는 자리다 (docs/log/2026-09-04-default-shell-close-tile.md).
   *
   * 상태를 새로 만들지 않고 이미 있는 둘을 모은다:
   * - [`ended`] — 끝났다(정상 종료·재연결 포기) **또는 처음부터 못 붙었다**.
   * - [`deferred`] — 배치 복원으로 떴고 아직 한 번도 안 붙었다.
   *
   * [`reconnect`] 는 **여기 들어오지 않는다**: 세션이 없는 것은 같지만 곧 스스로 다시 붙는
   * 중이라 Enter 가 끼어들 이유가 없고, 배너에 [지금 재연결]·[중단] 이 따로 있다.
   */
  function deadState(): Ended | Deferred | null {
    return ended ?? deferred;
  }

  /**
   * 종료된 타일을 **다시 접속**시킨다 (Enter · [다시 접속]).
   *
   * 첫 접속·[연결] 과 **같은 `startSession(true)` 경로**다 — 그래야 TOFU 확인과 비밀번호
   * 모달이 그대로 뜬다. 로컬 셸이면 그냥 새 셸이 하나 열린다 (스크롤백은 그 위에 이어진다).
   *
   * **tmux 타일에서는 [다시 붙기]** 다 — 같은 경로지만 결과가 다르다: `pane.tmux` 가 접속
   * 힌트로 실려 나가므로(`openSession`) 새 셸이 아니라 **떼어 두었던 그 세션**이 돌아온다.
   */
  async function reconnectEnded() {
    if (disposed || !ended || ended.connecting) return;
    const first = ended.unopened === true;
    // tmux 배너의 갈래는 **재접속을 거쳐도 유지한다** — 실패하면 같은 배너로 돌아와야 한다.
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

    // 실패하면 종료됨 상태에 그대로 머문다 — Enter 를 다시 누를 수 있어야 한다.
    const message = result.error === null ? null : describeOpenError(result.error, tr);
    const hint = result.error === null ? null : openErrorHintOf(result.error, tr);
    ended = { connecting: false, note: message, hint, unopened: first, tmuxExit: fromTmux };
    if (message) notice(hint ? `${message}\n${hint}` : message, "91");
  }

  /** 회색(또는 지정 색) 안내 줄을 터미널 버퍼에 직접 찍는다 */
  function notice(msg: string, sgr = "90") {
    const body = msg
      .split("\n")
      .map((line) => `\x1b[${sgr}m${line}\x1b[0m`)
      .join("\r\n");
    term?.write(`\r\n${body}\r\n`);
  }

  /**
   * **이관 버퍼를 소스 창의 크기로 재생하는 중인가** (2026-09-09).
   *
   * 그 사이의 [`refit`] 은 전부 건너뛴다 — 다른 크기로 맞춰 버리면 버퍼가 리플로돼 줄이
   * 밀리고, 아직 심지 않은 마커 거리가 통째로 어긋난다. 켜지는 자리도 꺼지는 자리도
   * 마운트의 복원 경로 **한 곳뿐**이고, 끄는 그 자리에서 곧바로 진짜 크기로 맞춘다.
   * (`ResizeObserver` 의 첫 콜백·탭 표시 rAF·설정 `$effect` 가 전부 이 문을 지난다.)
   */
  let restoring = false;

  // 임시 상자 크기를 PTY 에 보내지 않는다. RO 외의 포커스 rAF refit 도 같은 문에서 멈춘다.
  let refitSkipped = false;
  let resumeRefit: (() => void) | null = null;

  /**
   * **폰의 대화 면 동안 상자 크기를 따라가지 않는다**(2026-11-04) — 대화 면이면 키 띠가 숨어(`mobile/MobileKeys`) 상자가 그 높이만큼 늘고, 터미널 면으로 돌아오면 줄어든다.
   * 따라가면 넘길 때마다 PTY 크기가 흔들려 TUI 가 다시 그려진다. 터미널은 밀려 나 보이지 않으니 멎어 있어도 되고, 돌아오면 그때 크기로 한 번 맞춘다.
   */
  const refitParked = () => mobileLayout() && flipViewOf(pane.id) === "convo";

  $effect(() => {
    const previewing = dropPreviewing() || refitParked();
    untrack(() => {
      if (!previewing && refitSkipped) resumeRefit?.();
    });
  });

  /** 보이는 상태일 때만 크기를 다시 잡는다 (숨은 탭은 0x0 이라 fit 이 깨진다) */
  function refit() {
    if (!term || !fit || !container || restoring) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    if (dropPreviewing() || refitParked()) {
      refitSkipped = true;
      return;
    }
    // 보류한 refit 은 취소·커밋 트랜지션의 도착까지 기다린다. 포커스 rAF 도 중간 크기를 보내면 안 된다.
    if (refitSkipped && layoutAnimating()) {
      resumeRefit?.();
      return;
    }
    refitSkipped = false;
    // 크기 주인이 아니면(원격 웹 R2-B — 다른 창이 마지막으로 쳤다) 주인의 크기로 그린다 — 제 상자에 맞추지 않는다(남는 칸은 여백 · 넘치면
    // 스크롤). 제 상자에 맞는 크기는 그래도 보낸다: 서버가 적어 두었다가 이 쪽이 치는 순간 건다(`$lib/term/size-owner`).
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

  // ---------------------------------------------------------------------------
  // 크기 주인 (원격 웹 R2-A 서버 · R2-B — `$lib/term/size-owner` 머리말)
  //
  // 한 세션을 집 PC 창(주)과 원격 창(시청자)이 함께 보면 PTY 크기는 마지막으로 사람이 친 쪽의 것이다. 주인이 아닌 쪽은 ① 주인의 크기로
  // 그리고(`refit`) ② xterm 의 터미널 응답(DSR · DA · DECRQM · OSC 색)을 보내지 않는다(`sendInput` — 둘 다 답하면 셸 입력에 두 번 샌다).
  // 집 PC 타일도 같다(원격이 주인이면 집 PC 가 삼킨다). 새 세션을 연 쪽은 주인이다. 바뀜은 이벤트 `session-size-owner` 로 온다.
  // ---------------------------------------------------------------------------

  /** 이 타일이 지금 크기 주인인가 */
  let sizeOwner = $state(true);
  /** 주인이 아닐 때 그릴 크기(주인의 크기 — 모르면 `null` = 제 상자에 맞춘다) */
  let ownerSize = $state<OwnerSize | null>(null);

  /**
   * 주인의 화면이 이 상자보다 크면(상자는 스크롤) **커서 줄이 보이게** 스크롤한다 — 프롬프트 · 지금 치는 줄이 상자 밖에 숨지 않게. 한
   * 프레임에 한 번(커서가 움직일 때마다 부른다 — `onCursorMove`).
   */
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

  /** 주인 상태를 바꾼다 — 바뀌었으면 크기를 다시 맞춘다 */
  function applyOwner(v: OwnerView) {
    const same =
      v.owner === sizeOwner &&
      (v.size === null ? ownerSize === null : ownerSize !== null && v.size.cols === ownerSize.cols && v.size.rows === ownerSize.rows);
    sizeOwner = v.owner;
    ownerSize = v.owner ? null : v.size;
    if (v.primary !== undefined) ownerPrimary = v.primary;
    if (!same) refit();
  }

  // ---------------------------------------------------------------------------
  // 다른 기기 크기 안내(10-20 — 목업 B · 판정은 `$lib/term/size-notice`): 주인이 아닌 타일은 그려진 영역(cols×rows)에 점선 테두리 + 위
  // 가장자리 꼬리표를 늘 달고, **포커스 타일만**(`active`) 빈 자리에 카드 하나를 띄운다(자리가 모자라면 카드 없이 꼬리표를 눌러 같은 단추).
  // 단추는 손잡이의 `claimSize` — **셸에 아무것도 쓰지 않고** 이 창을 크기 주인으로 삼아 제 상자 크기를 건다. [모두 되돌리기] 는 이 창의
  // 지금 워크스페이스에서 줄어든 타일 전부(`$lib/app/size-notice.svelte`). 폰 배치에는 없다(띠의 ⤢).
  // ---------------------------------------------------------------------------

  /** 주인이 주(집 PC 창)인가 — 꼬리표 문구(모르면 `undefined`) */
  let ownerPrimary = $state<boolean | undefined>(undefined);
  /** 터미널 상자 · 그려진 영역(`.xterm-screen`)의 px — 테두리 · 카드 자리 */
  let noticeBox = $state<Size2 | null>(null);
  let noticeDrawn = $state<Size2 | null>(null);
  /** 카드 높이(그려지면 잰 값으로 고친다 — 폭은 CSS 고정) */
  let noticeCardH = $state(118);
  const NOTICE_CARD_W = 300;
  /** 꼬리표를 눌러 연 단추 상자 */
  let noticePop = $state(false);
  /** 자격 없는 이 기기(폰)가 "이 기기 크기로 맞추기" 를 켰다 — 다시 붙은 뒤 곧바로 되찾는다 */
  let claimAfterAttach = false;

  const foreignShown = $derived(!sizeOwner && ownerSize !== null && !mobileLayout());
  const noticeKind = $derived(noticeSide(isRemote, ownerPrimary));
  const noticeOutline = $derived(noticeBox && noticeDrawn ? outlineBox(noticeBox, noticeDrawn) : null);
  const noticeCard = $derived(
    foreignShown && active && noticeBox && noticeDrawn
      ? placeCard(noticeBox, noticeDrawn, { width: NOTICE_CARD_W, height: noticeCardH })
      : null,
  );
  /** 단추 — 자격 없는 이 기기(폰 · 넓은 배치)는 "이 기기 크기로" 하나(켜면 다시 붙어 되찾는다) */
  const noticeButtons = $derived(noticeActions(shrunkCount(), !viewer || viewerEligible()));

  $effect(() => {
    const on = foreignShown;
    const id = pane.id;
    untrack(() => {
      if (on) markShrunk(id, reclaimSize);
      else {
        clearShrunk(id);
        noticePop = false;
      }
    });
    return () => clearShrunk(id);
  });

  // 꼬리표 상자 — 밖을 누르거나 Esc 면 닫는다.
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
  /** 다음 프레임에 상자 · 그려진 영역을 잰다(refit · 주인 바뀜 뒤) */
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

  /** 이 타일을 이 창 크기로 — 셸에 쓰지 않는다(서버 `claim_size`). 자격 없는 이 기기는 "이 기기 크기로 맞추기" 를 켜고 다시 붙은 뒤 되찾는다. */
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

  // 탭이 다시 보이게 되면 레이아웃 확정 후 크기를 맞춘다.
  // 포커스는 **활성 패널에만** 준다 — 분할된 탭에서 모든 패널이 focus() 를 부르면
  // 마지막으로 실행된 패널이 포커스를 훔쳐 간다.
  //
  // WebGL 부착도 여기 얹는다 — 숨겨지는 순간 곧바로 떼고(컨텍스트를 놓아 준다), 다시
  // 보일 때는 **refit 과 같은 rAF 안에서** 붙인다. 레이아웃이 확정되기 전에 붙이면 캔버스가
  // 0×0 으로 잡히고, 탭 전환마다 dispose/재부착 비용이 그대로 프레임에 실린다.
  $effect(() => {
    const useLigatures = settings.ligatures;
    // 합자는 WebGL 렌더러에서만 그려진다 (xterm 6) — 켜면 WebGL 도 함께 켠다. WebGL 을
    // 껐더라도 합자를 켜면 이 패널만 WebGL 로 그린다 (설정이 정직하게 동작하도록).
    // 폰 · 터치 기기의 원격 창(R5)은 WebGL 을 쓰지 않는다 — DOM 렌더러(모바일 GPU 컨텍스트 상실 · 메모리 · `$lib/mobile/policy`).
    const useWebgl = (settings.webgl || useLigatures) && !domRendererOnly(); // 설정을 바꾸면 즉시 붙거나 떨어진다
    if (!visible) {
      // 문을 **먼저** 닫는다 — WebGL 애드온의 dispose 가 새 DOM 렌더러를 세우고 곧바로 resize 로 모든 행을 그리는데,
      // 숨은(`display:none`) 채 그리면 글자마다 0 폭을 재며 메인 스레드를 수 초 잡는다(`term/hidden-render-gate.ts`).
      renderGate?.hide();
      addons.unloadLigatures();
      addons.unloadWebgl();
      return;
    }
    const takeFocus = active;
    const raf = requestAnimationFrame(() => {
      // **렌더러를 먼저 정하고 그다음에 잰다** (docs/log/2026-09-26-osc-notify-inline-images.md ③).
      // 칸 폭은 렌더러마다 다르다 — WebGL 은 기기 픽셀로 내림하고(`WebglRenderer` 의
      // `Math.floor(charWidth * dpr)`) DOM 렌더러는 그러지 않는다. 숨길 때 WebGL 을 뗐으므로
      // 순서가 거꾸로면 첫 fit 은 DOM 칸 폭으로 재서 열 수가 달라지고(실측 127→123), 곧이어
      // ResizeObserver 의 refit 이 WebGL 칸 폭으로 되돌린다 — 탭을 볼 때마다 버퍼가 두 번
      // 리플로되고 원격 resize 가 두 번 나갔다(로컬은 ConPTY 가 그때마다 화면을 다시 그려
      // 인라인 그림이 지워졌다).
      if (useWebgl) addons.loadWebgl();
      else addons.unloadWebgl();
      // 렌더러가 정해진 뒤에 연다 — DOM 렌더러로 남았으면 숨은 동안 건너뛴 그림을 한 번 다 그린다(WebGL 이면 할 일 없음).
      renderGate?.show();
      refit();
      // 합자는 WebGL 이 붙은 뒤에 붙인다. WebGL 이 못 뜬 기기(webglLost)면 webgl 이 null 이라
      // 여기서 걸러진다 — 그때는 합자를 조용히 포기한다 (DOM 렌더러는 조이너를 안 그린다).
      if (useLigatures && addons.hasWebgl) void addons.loadLigatures();
      else addons.unloadLigatures();
      // **묻는 창이 떠 있으면 포커스를 빼앗지 않는다** (2026-09-19 ②).
      //
      // 이 rAF 는 타일이 처음 붙을 때도 돈다. 금고 잠금 해제 관문은 `open_ssh_session` 을
      // 부르기 **전에** 뜨므로, 그 순간 이 줄이 터미널로 포커스를 가져가면 사용자가 친
      // Escape·Enter 가 모달이 아니라 셸로 간다 (xterm 이 Escape 를 삼킨다).
      // 조건을 rAF **안에서** 읽는 것은 의도다 — 밖에서 읽으면 모달이 뜨고 닫힐 때마다
      // 이 효과가 다시 돌아 refit 이 따라 돈다.
      if (takeFocus && !promptsBlocking()) term?.focus();
    });
    return () => cancelAnimationFrame(raf);
  });

  // 트리거 목록 구독 — 이미 열려 있는 터미널까지 실시간으로 따라간다 (앱 테마와 같은 계약).
  // 소급 적용은 하지 않으므로 **새 출력부터** 새 규칙이 보인다 ($lib/triggers 주석 참고).
  $effect(() => {
    const list = settings.triggers;
    triggers?.setTriggers(list);
  });

  // 설정 구독 — **이미 열려 있는** 터미널까지 실시간으로 따라간다 (docs/log/2026-08-31-app-settings.md).
  //
  // 세 값을 먼저 읽어야 term 이 아직 없는 첫 실행에서도 의존성이 등록된다. 글꼴이 바뀌면 셀
  // 크기가 달라져 cols/rows 가 변하므로 refit 으로 원격 크기까지 맞춰 준다.
  // (scrollback 은 호스트별 값이고 생성 시 1회라 여기 목록에 없다 — mount() 참조)
  $effect(() => {
    // 배경에 터미널 투명도까지 입힌 팔레트다 (100% 면 프리셋 원본 그대로의 **같은 객체**).
    const theme = settings.termThemeEffective;
    // 합자 토글·글꼴 변경 모두 여기서 반영된다 (fontFamilyEffective 가 둘을 합친다).
    const fontFamily = settings.fontFamilyEffective;
    // UI 크기(웹뷰 확대)만큼 되돌린 값이다 — 사용자가 정한 크기 그대로 보인다
    // (docs/log/2026-09-25-ui-scale-font.md). 배율이 바뀌어도 이 값이 같이 바뀌어 refit 된다.
    const fontSize = settings.termFontSize;
    // 커서 모양도 이미 열려 있는 탭에 즉시 반영한다 (유니온이 xterm 의 값과 같다).
    const cursorStyle = settings.cursorStyle;
    // xterm 은 배경의 알파를 **`allowTransparency` 가 켜져 있을 때만** 제대로 다룬다:
    // 이 값이 글리프 아틀라스 설정으로 흘러 들어가(WebGL 애드온 `CharAtlasUtils.ts`),
    // "배경은 불투명하다" 를 전제로 글자 뒤 픽셀을 지우는 최적화를 끈다. 100% 에서는 꺼 둔
    // 채로 남겨 예전 렌더 경로를 그대로 쓴다 (docs/log 참고).
    //
    // **런타임에 바꿔도 WebGL 애드온을 다시 붙일 필요가 없다.** 애드온이 만들어질 때
    // `optionsService.onOptionChange(() => this._handleOptionsChanged())` 를 걸어 두고, 그
    // 핸들러가 `_refreshCharAtlas()` 로 **지금 옵션(allowTransparency 포함)** 을 넣어 아틀라스를
    // 다시 얻는다 (`acquireTextureAtlas` · `configEquals` 가 그 칸을 비교한다). 배경색 쪽도
    // `onChangeColors` → `_updateViewportRectangle()` 로 클리어 색의 **알파까지** 새로 읽는다.
    // 그래서 여기서는 두 옵션을 다시 걸기만 한다 — dispose/재로드 경로는 만들지 않는다.
    const transparent = settings.termOpacity < 100;
    if (!term) return;
    term.options.allowTransparency = transparent;
    term.options.theme = theme;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    term.options.cursorStyle = cursorStyle;
    // 한글 조합 중에는 xterm 커서 대신 `.composition-view` 가 보인다 — xterm.css 기본은 검정 판 · 흰 글자라
    // 커서 모양과 무관하게 늘 블럭처럼 보였다(10-17 사용자). 모양 · 색을 넘겨 theme.css 가 커서처럼 그린다.
    if (container) {
      container.dataset.cursor = cursorStyle;
      container.style.setProperty("--ime-cursor", theme.cursor ?? theme.foreground ?? "#fff");
      container.style.setProperty("--ime-accent", theme.cursorAccent ?? theme.background ?? "#000");
      container.style.setProperty("--ime-fg", theme.foreground ?? "#fff");
      container.style.setProperty("--ime-bg", theme.background ?? "#000");
    }
    refit();
  });

  // ---------------------------------------------------------------------------
  // 출력 역압 (docs/log/2026-08-31-backpressure.md)
  //
  // `t.write()` 는 비동기다. 파서보다 빨리 밀어넣으면 xterm 내부 쓰기 버퍼가 부풀다
  // 50MB 하드캡에서 폐기되고 그전에 UI 가 언다. 그래서 "넣었지만 아직 파싱되지 않은
  // 바이트"(pending)를 세고, 워터마크를 넘으면 Rust 쪽 수문을 닫아 **소스를 세운다**.
  //
  // 이 상태는 **터미널에 붙어 있지 세션에 붙어 있지 않다** — 재연결로 세션이 바뀌어도
  // 버퍼는 그대로이므로 카운터도 그대로 이어 간다 (`gated` 만 새 세션 기준으로 되돌린다).
  // ---------------------------------------------------------------------------

  let received = 0;
  /** write() 에 넣었지만 아직 파싱 콜백이 오지 않은 바이트 */
  let pending = 0;
  /** 콜백을 아직 달지 않은 누적분 — ACK_INTERVAL 마다 한 번만 단다 */
  let unacked = 0;
  /** 수문을 닫아 둔 상태인가 (상태 전이에서만 invoke 한다) */
  let gated = false;

  /**
   * **화면에 반영된 출력 오프셋** — 창 이관 틈의 출력 재생(R02)의 근거. Rust 출력 꼬리 링
   * (`output.rs` `TailRing`)과 같은 축이다: 지금 세션 채널의 첫 바이트 오프셋(`base`) + 그 채널에서
   * write 콜백이 **돌아온** 바이트(`parsed`). `buildTear` 가 버퍼를 뜨는 같은 동기 순간에 읽어
   * 짐의 `consumed` 로 싣는다 (`registerSerialize`).
   *
   * 맞는 이유: xterm 은 write 한 덩어리를 통째로 파싱한 뒤 그 콜백을 부르고, 직렬화는 별도
   * 태스크(dragstart)에서 돌므로 그 순간 화면 = 콜백이 돌아온 덩어리들까지다. (예외 하나 —
   * 파서 핸들러가 Promise 를 돌려 덩어리 중간에서 쉬는 동안 뜨면 그 덩어리 앞부분이 재생에서
   * 한 번 더 그려질 수 있다. 이 앱의 OSC 핸들러는 동기라 실제로는 인라인 그림 정도다.)
   *
   * 채널(= 열기·재연결·재부착 시도)마다 **새 카운터**를 만든다 — 옛 채널의 늦은 덩어리가 새 축에
   * 섞이지 않게. 새 열림은 `base` 0(Rust 링도 그 채널의 첫 바이트가 0 이다), 재부착은 Rust 가
   * 돌려준 `start`(`SessionHandle.outputStart`) — 그걸 알기 전(또는 옛 Rust)이면 `null` 이라
   * 짐에 `consumed` 를 싣지 않는다(= 재생 없이 재그림). 재생 바이트도 이 채널로 오므로 `parsed`
   * 에 자연히 들어간다.
   */
  type OutCount = {
    base: number | null;
    parsed: number;
    acked?: number;
    /** 이 채널에서 받아 xterm 에 넣은 바이트(파싱 전 포함) — 시청자 재동기화의 이어 붙일 자리(R2-B) */
    received?: number;
    /** 버린 채널(시청자 재동기화 — 옛 채널의 늦은 덩어리는 새 채널이 다시 보낸다) */
    dead?: boolean;
  };

  /**
   * **ACK 크레딧** (세션 서버 ③-2 — `server::credit`) — 이 채널에서 화면에 반영한 오프셋을 Rust 에 돌려준다. 로컬·SSH
   * 세션의 역압은 이것 하나다(서버가 송신 − ACK 로 생산자를 멈춘다 — 예전 pause/resume 대신 · SSH 는 ③-3b2 부터).
   * 64 KiB 마다 한 번 — 서버의 예산(1 MiB)보다 충분히 잘다.
   */
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

  // ---------------------------------------------------------------------------
  // 떨어진 세션에 다시 붙기 (세션 코어 ② — docs/internal/session-server-design-2026-10-08.md 4.3)
  //
  // 페이지 리로드·웹뷰 크래시 뒤 타일(로컬·SSH — ②-2)은 새 셸·새 접속을 열지 않고 **살아 있는 세션에 다시 붙는다**:
  // 맡겨 둔 화면(체크포인트) → Rust 꼬리 링의 [소비..끝) 재생 → 실시간. 재생은 이미 한 번 일어난 출력이라
  // 그 구간 동안은 OSC 9/777 알림 · OSC 52 클립보드 · DSR/DA 응답(키 입력 길) · 벨을 **다시 일으키지 않는다**.
  // ---------------------------------------------------------------------------

  /** 링 재생 구간인가 — 위 부작용들을 삼킨다 */
  let replaying = false;
  /** 재생이 끝나는 오프셋(이 채널의 축) — 붙기 결과를 받기 전에는 `null` */
  let replayUntil: number | null = null;
  /** 재생 표시가 어떤 이유로든 끝나지 않을 때의 안전판 */
  let replayGuard: ReturnType<typeof setTimeout> | undefined;
  /**
   * **붙기 결과(시작 오프셋 · 재생 끝)가 오기 전에** 이 채널로 온 덩어리 — 쓰지 않고 모았다가 결과가 오면 재생 끝([`replayUntil`])에서
   * **나누어** 쓴다(7단계 발견 ① — 부트스트랩 DSR 무응답 멈춤). 재생분은 답하지 않고(창이 없던 동안 서버가 이미 답했다) 경계 뒤
   * 실시간분은 xterm 이 답한다. 예전에는 결과 전 덩어리를 통째로 재생으로 보아 그 사이 실시간 질의(`ESC[6n` 등)를 삼켰다 — 서버는
   * 창이 붙었으니 답하지 않아 셸 · CLI 가 기다린 채 멈췄다. 서버가 "붙기 완료 ACK 전" 까지 답하게 하는 안은 쓰지 않았다(창과 서버가 같은
   * 질의에 둘 다 답할 틈이 생긴다 — 오프셋으로 가르는 이쪽이 단순하고 확실하다).
   */
  let held: { chunk: Uint8Array; done: (parsed: number, last: boolean) => void }[] | null = null;
  /** 붙기 채널의 셈(이 채널의 덩어리만 경계로 나눈다) · 그 채널에 지금까지 쓴 바이트 */
  let attachCount: OutCount | null = null;
  let attachWritten = 0;
  /** 재생을 붙기 전 PTY 크기로 쓰는 중(10-15 — [`replayResize`]) — 재생 끝([`endReplay`])에서 타일 크기로 돌린다 */
  let replaySized = false;
  const REPLAY_GUARD_MS = 10_000;
  /** 같은 스트림의 세션이 아직 닫히는 중·여는 중일 때(`[session-alive]`·`[session-busy]`) 다시 보는 횟수·간격 */
  // 옛 페이지의 열기가 셸 생성 직렬화(`SPAWN_LOCK`)에 줄 서 있으면 몇 초 걸릴 수 있다 — 넉넉히 4.5초.
  const OPEN_RETRIES = 15;
  const OPEN_RETRY_MS = 300;
  /** 붙어 있는 동안 화면을 맡기는 주기 — 출력이 있었을 때만(설계 4.3 "맡기는 때") */
  const CHECKPOINT_INTERVAL_MS = 30_000;
  /** 첫 체크포인트(마운트 뒤) — 열기·붙기의 재생이 화면에 반영될 틈 */
  const CHECKPOINT_FIRST_MS = 5_000;

  /**
   * 종료 사유 → 화면 문구(로컬은 세션 서버가 코드만 보낸다 — `pty::LocalExit`). 코드가 없으면(SSH) Rust 의 문구 그대로.
   */
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
    // 재생을 PTY 크기로 썼다면(`replayResize`) 여기서 타일 크기로 돌린다 — 재생 끝 덩어리의 콜백 안이라 뒤 실시간분(서버 resize 뒤 ConPTY
    // 다시 그림)은 타일 크기에서 파싱된다. 시한 · 실패로 끝나도 같은 자리에서 돌린다.
    if (replaySized) {
      replaySized = false;
      restoring = false;
      if (!disposed) refit();
    }
  }

  /** 재생 끝 오프셋까지 화면에 반영됐으면 재생 표시를 끈다 (write 콜백 · 붙기 결과를 받은 순간) */
  function endReplayIfDone(count: OutCount) {
    if (!replaying || replayUntil === null || count.base === null) return;
    if (count.base + count.parsed >= replayUntil) endReplay();
  }

  /**
   * 붙기 채널의 덩어리 하나를 쓴다 — 재생 끝이 덩어리 **안**에 있으면 둘로 나눈다(앞 몫의 콜백이 재생 표시를 끄고 나서 뒤 몫이 파싱된다 —
   * xterm 은 쓴 순서대로 파싱하고 콜백을 부른다). `done(parsed, last)` 는 [`onData`] 의 셈 · ACK.
   */
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

  // Rust 가 모아 보낸 출력 덩어리를 그대로 흘려 넣는다.
  // (Tauri Channel 은 invoke 시도마다 session.ts 가 새로 만든다 — 재사용 금지)
  function onData(buf: ArrayBuffer, count?: OutCount) {
    const t = term;
    if (!t) return;
    // 시청자가 재동기화로 버린 채널의 늦은 덩어리 — 새 채널이 그 자리부터 다시 보낸다(두 번 그리지 않게).
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

    // 세션 id 를 알기 전(오픈 중) 도착분은 세울 방법이 없으니 그냥 쓴다.
    const src = session;
    const willGate = !gated && src !== null && pending > HIGH_WATER;

    // 수문을 닫을 때와 닫힌 동안 도착한 잔여 출력에는 반드시 콜백을 단다.
    // pause 요청 전에 배처·IPC 에 이미 쌓인 청크는 뒤늦게 올 수 있다. 그 청크를
    // ACK_INTERVAL 까지 모으면 새 출력이 멈춘 뒤 pending 이 LOW_WATER 아래로
    // 못 내려가, 화면이 전부 파싱되어도 세션이 멈춘 채 남는다.
    //
    // 콜백은 이제 **덩어리마다** 단다 — 출력 오프셋(`outCount`)이 정확해야 이관 재생이 겹치지
    // 않는다. 차감(`pending`)은 예전처럼 ACK_INTERVAL 마다 몰아서 한다. 이 "덩어리" 는 Rust 배치
    // (4ms/64KB)라 클로저는 초당 수백 개를 넘지 않는다 (docs/log/2026-08-31-backpressure.md 가
    // 경계한 것은 잘게 쪼갠 write 마다의 클로저다).
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
      // 이 콜백 시점에 앞선 write 는 전부 파싱이 끝나 있다 (write 는 순서 보장).
      pending -= acked;
      if (gated && pending < LOW_WATER) {
        gated = false;
        session?.resume();
      }
    };
    if (count && count === attachCount) {
      // 떨어진 세션에 다시 붙는 채널 — 결과 전이면 모으고, 뒤로는 재생 끝에서 나누어 쓴다(`held` 주석).
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

  // ---------------------------------------------------------------------------
  // 세션 열기 · 3단계 자동 재연결 (docs/log/2026-09-01-reconnect.md)
  //
  //   ssh-exit(reason)
  //     ├ "exit"  (사용자가 exit / 셸이 신호로 죽음) → 안내 한 줄, 끝
  //     └ "error" (keepalive 무응답·소켓 오류·서버가 끊음)
  //          → 핸들 무효화 · 배너 · 1s→2s→4s…30s(±30%) 백오프로 openSession 재호출
  //
  // 터미널은 **절대 dispose 하지 않는다** — 스크롤백을 그대로 두고 새 세션의 입출력만
  // 다시 배선한다. 새 Tauri Channel 은 session.ts 가 시도마다 새로 만든다.
  // ---------------------------------------------------------------------------

  type Attempt = { ok: true } | { ok: false; error: unknown };

  /** 재연결 타이머 두 개 — 다음 시도(retry)와 1초 카운트다운(tick) */
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * **첫 접속**을 늦추는 타이머 (`PaneSpec.openDelay` — 그룹 전체 열기의 계단식 시작).
   * 위 두 개와 따로 두는 이유: `clearTimers()` 는 재연결 루프가 매 시도마다 부르는데,
   * 이것은 재연결과 무관하게 마운트 때 딱 한 번 걸리고 언마운트에서만 풀린다.
   */
  let openTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(retryTimer);
    clearInterval(tickTimer);
    retryTimer = undefined;
    tickTimer = undefined;
  }

  /**
   * 세션을 하나 연다 (첫 접속·재연결 공통). 성공하면 손잡이를 꽂는다.
   *
   * `interactive` 가 false 면 호스트 키·비밀번호 **모달을 넘기지 않는다** — 자동 재시도가
   * 몇 초마다 모달을 띄우는 사태를 막기 위해서다. 그 경우 사람 손이 필요한 실패는
   * `password_required` / `host_key_unknown` 으로 되돌아오고, 호출부가 루프를 멈춘 뒤
   * 사용자에게 넘긴다 (배너의 [지금 재연결] 을 누른 시도에서만 `interactive` 가 true 다).
   */
  /**
   * **원격 프로젝트 타일의 첫 입력 재료** — 아직 쓰지 않았으면 값, 첫 접속이 선 뒤로는 `null`
   * (docs/log/2026-09-24-projects.md).
   *
   * 로컬 `autorun` 과 같은 1회용이다: 로컬은 첫 열기의 `.then` 이 한 번 써 넣고, SSH 는 이 값을
   * **접속이 설 때까지** 매 시도에 싣는다(인증 실패 뒤 Enter 로 다시 붙은 경우도 첫 접속이다) —
   * 서고 나면 비운다. 자동 재연결은 이미 선 뒤라 싣지 않는다: tmux 타일이면 힌트로 **돌고 있던
   * 에이전트에** 다시 붙고, 평범한 셸이면 새 셸이 홈에서 뜬다(명령을 두 번 돌리지 않는다).
   */
  let sshStart: {
    cwd: string;
    command: string | null;
    worktree?: { repo: string; name: string; ticket: string } | null;
    setup?: { projectId: string; nonce: string } | null;
  } | null = null;

  // ── 원격 새 워크트리의 준비 (2026-09-29 B안 · docs/log/2026-09-29-remote-worktree-after-connect.md) ─────────
  //
  // 접속한 뒤 · 첫 입력 전에 Rust 가 그 전송로의 exec 로 워크트리를 만든다. 이 타일은 마운트에서 뽑은 표(`ticket`)로
  // 준비 이벤트를 받아 — `preparing` 이면 터미널 자리에 앱이 그린 "워크트리 준비 중…" 한 줄(서버로 가지 않는다), `ask`
  // 면 위쪽 막대로 첫 커밋을 묻고, `failed`·`identity` 면 막대로 알린 뒤 평범한 셸로 간다. 준비가 끝날 때까지 접속 명령이
  // 돌아오지 않으므로 세션이 없고, 사람의 입력은 서버로 가지 않는다(`sendInput` 이 갈 곳이 없다).

  /** 기다리는 준비의 표 — 준비가 끝나면(`isFinalPrepPhase`) 비운다. 타일이 닫힐 때 남아 있으면 멈춤을 보낸다 */
  let wtTicket: string | null = null;
  /** 표의 이벤트 구독 — 선 뒤에 풀리는 약속(접속 명령 전에 기다린다) · 해제 함수 */
  let wtListening: Promise<void> | null = null;
  let wtUnlisten: (() => void) | null = null;
  /** 만드는 워크트리의 프로젝트 id — 명세에서 워크트리 재료를 지우기 전에 잡는다(Rust 로는 가지 않는다) */
  let wtProjectId: string | null = null;
  /**
   * 준비가 `ready` 로 끝났다 — 이 세션이 선 뒤(`startSession`) 그 프로젝트의 독 목록을 한 번 다시 읽는다. `ready`
   * 순간에는 이 타일의 세션이 아직 없어(접속 명령이 돌아오기 전), 그 호스트에 다른 타일이 없으면 목록이 `offline` 이 된다.
   */
  let wtReloadProject: string | null = null;
  /** 위쪽 막대 — 첫 커밋 질문 · 실패 · git 신원 없음 */
  let wtPrep = $state<WorktreePrepBar | null>(null);

  /** 준비 이벤트 하나 — 제 표의 것만 온다(`listenWorktreePrep`) */
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
    // 준비가 끝났다 — 재료는 한 번만 쓰인다(이 뒤의 재시도 · 재접속은 워크트리를 다시 만들지 않는다).
    wtTicket = null;
    wtUnlisten?.();
    wtUnlisten = null;
    if (prepEndsInPlainShell(ev.phase)) {
      // Rust 가 시작 재료를 통째로 버렸다 — 타일도 그 폴더 · 에이전트 · 설정 스크립트를 잊는다(분할 · 다시 접속이
      // 없는 폴더로 가지 않게, 머리줄이 에이전트 이름을 달지 않게).
      sshStart = null;
      setupReq = null;
      setupNonce = null;
      delete pane.cwd;
      delete pane.autorun;
    } else if (sshStart) {
      sshStart.worktree = null;
    }
    // 워크트리가 섰다 — 독에 새 줄이 서게(로컬과 같은 조건 · 한 번 — `reloadWorktreesAfterCreate`).
    if (ev.phase === "ready") wtReloadProject = wtProjectId;
    wtProjectId = null;
    wtPrep =
      ev.phase === "failed"
        ? { kind: "failed", message: ev.message ?? "" }
        : ev.phase === "identity"
          ? { kind: "identity" }
          : null;
  }

  /** 막대의 [첫 커밋 만들고 계속] · [셸로 열기] */
  function answerPrep(answer: WorktreePrepAnswer): void {
    const ticket = wtTicket;
    if (!ticket || wtPrep?.kind !== "ask" || wtPrep.busy) return;
    wtPrep = { ...wtPrep, busy: true };
    void answerWorktreePrep(ticket, answer).then((waiting) => {
      // 기다리던 준비가 없었다(연결이 이미 끊겼다) — 막대를 걷는다. 접속 실패는 종료 배너가 말한다.
      if (!waiting && !disposed && wtTicket === ticket && wtPrep?.kind === "ask") wtPrep = null;
    });
  }

  // ── 로컬 AI 타일 로딩 덮개 (판정 `term/ai-veil.ts` · 그림 `term/AiVeil.svelte`) ───────────────
  //
  // 첫 열기에서 autorun 을 칠 때만 씌운다 — 셸 프롬프트와 앱이 쳐 넣는 긴 한 줄(`--settings … --mcp-config …`)을 가린다.
  // 떨어진 세션에 붙기(F5 · 복원 · 이관 — 붙기 시도가 먼저라 붙으면 씌우지 않는다) · SSH · 시청자 · 설정 스크립트 갈래에는 없다
  // (설정 스크립트는 사람이 볼 출력이고, 첫 `C` 가 스크립트 줄이라 지우기가 그 출력을 지운다).

  /** 지금 씌운 덮개 — 걷히면 `null` */
  let aiVeil: AiVeil | null = null;
  /** 덮개를 세운 적이 있다(그림 컴포넌트가 산다 — 걷힘 페이드가 돌 자리) · 덮여 있다 · 걷힘이 즉시 */
  let veilMounted = $state(false);
  let veilShown = $state(false);
  let veilInstant = $state(false);
  /** 덮개 그림의 재료 — 씌우는 순간에 한 번 정한다 */
  let veilFace = $state<{ logo: string | null; cwd: string | null; branch: string | null }>({ logo: null, cwd: null, branch: null });
  /** 훅 신호 귀 — 걷히면 뗀다 */
  let unVeilHook: (() => void) | null = null;

  /** 덮개를 씌운다 — 로컬 AI 타일의 새 셸(붙기 아님)이고 autorun 을 칠 때만 */
  function beginAiVeil(): void {
    if (aiVeil || disposed || viewer || pane.kind !== "local" || !pane.autorun || setupReq) return;
    const cwd = pane.cwd?.trim() || null;
    veilFace = { logo: aiIconName(pane.autorun), cwd, branch: cwd ? localWorktreeBranchAt(cwd) : null };
    aiVeil = createAiVeil({
      reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
      // xterm 화면만 — 커서 위까지 지우고(줄은 그대로라 ConPTY 의 커서 자리와 어긋나지 않는다) 스크롤백도 비운다. 셸에는 보내지 않는다.
      clearScreen: () => term?.write("\x1b[1J\x1b[3J"),
      lift: (_reason, instant) => {
        aiVeil = null;
        unVeilHook?.();
        unVeilHook = null;
        veilInstant = instant;
        veilShown = false;
      },
    });
    // Claude 의 `SessionStart` 훅(→ `session`) — CLI 가 섰다
    unVeilHook = onAgentHookSignal((paneId, event) => {
      if (paneId === pane.id && event === "session") aiVeil?.hookSignal();
    });
    veilMounted = true;
    veilInstant = false;
    veilShown = true;
    // 폴더를 정하지 않은 타일(홈에서 연 첫 AI 타일 — 뒤 타일은 포커스된 타일의 폴더를 물려받는다)은 셸이 홈에서 선다(`pty::spawn_cwd`) —
    // 덮개도 홈을 보인다. WSL 셸은 그 배포판의 홈이라 비운다.
    if (!cwd && !pane.shell?.startsWith("wsl:")) {
      const veil = aiVeil;
      void homeDir()
        .then((home) => {
          if (home && aiVeil === veil && !veilFace.cwd) veilFace = { ...veilFace, cwd: home, branch: localWorktreeBranchAt(home) };
        })
        .catch(() => {});
    }
  }

  /** 덮개를 눌렀다 — 걷고 xterm 에 포커스 */
  function liftAiVeilByPointer(): void {
    aiVeil?.input();
    term?.focus();
  }

  // ── 프로젝트 설정 스크립트 (docs/log/2026-09-28-project-agent-setup-script.md) ─────────────
  //
  // 새 워크트리 타일(또는 독의 [설정 스크립트 실행])은 셸이 열리면 스크립트부터 돌린다. 여러 줄을 키로 치지 않는다 —
  // Rust 가 그 셸이 돌릴 **한 줄**을 짓고(`project_setup_line` · 원격은 첫 입력), 그 한 줄이 끝에서 OSC 7717 을
  // 찍는다. 이 타일은 자기 nonce 의 신호만 받아 — 성공이면 에이전트(로컬은 AI 타일과 같은 autorun 문, 원격은 이미
  // 같은 줄의 `&& <에이전트>`), 실패면 위쪽 막대([스크립트 편집] [다시 실행] [<에이전트> 띄우기])를 세운다.

  /** 이 타일의 설정 스크립트 재료 — 마운트에서 명세의 `setup` 을 읽어 둔다(명세에서는 지운다 — 1회용) */
  let setupReq = $state.raw<NonNullable<PaneSpec["setup"]> | null>(null);
  /** 지금 기다리는 끝 신호의 nonce — 받으면 비운다 */
  let setupNonce: string | null = null;
  /** 실패 막대 — 종료 코드 · 다시 실행 중인가 */
  let setupFail = $state<{ code: number; busy: boolean } | null>(null);

  /**
   * 설정 스크립트를 친다 — 로컬 첫 열기 · [다시 실행]. 한 줄을 받지 못하면(그사이 스크립트를 지웠다 · 파일을 못
   * 썼다) 한 줄 알리고, 첫 열기였으면 스크립트 없이 여는 것과 같게 에이전트를 띄운다.
   */
  async function runSetup(first: boolean): Promise<void> {
    const req = setupReq;
    const opened = session;
    if (!req || !opened || disposed) return;
    const nonce = newSetupNonce();
    const remote = pane.kind === "ssh";
    let line: string;
    try {
      // 원격 다시 실행은 줄 끝에 `&& <에이전트>` 가 붙어 온다 — 신호 없이도 성공일 때만 뜬다. 세션 번호를 넘기면 Rust 가
      // 그 전송로의 exec 로 스크립트를 서버 파일에 먼저 써 두고 짧은 줄을 준다(첫 입력과 같은 길 — 못 쓰면 긴 한 줄).
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

  /** 끝 신호를 받았다 — 로컬이면 곁 파일에 적고, 성공이면 에이전트(로컬만 — 원격은 이미 같은 줄), 실패면 막대 */
  function onSetupDone(code: number): void {
    const req = setupReq;
    if (!req) return;
    if (pane.kind === "local" && pane.cwd) void recordSetupResult(req.repo, pane.cwd, code);
    if (code === 0) {
      setupFail = null;
      // 스크립트를 돌린 자식 셸이 물러나고 프롬프트가 설 때쯤 친다 — 그 사이 친 글자는 셸의 입력 버퍼에 남지만,
      // 자식이 아직 콘솔 입력을 쥐고 있는 짧은 순간을 피한다.
      if (pane.kind === "local") setTimeout(() => launchSetupAgent(), 300);
    } else {
      setupFail = { code, busy: false };
    }
  }

  /**
   * 프로젝트의 에이전트를 띄운다 — 로컬은 AI 타일과 **같은 문**(`agentAutorunCommand` — 추가 인자 · 장식)을 지나고,
   * 띄운 뒤로 이 타일은 AI 타일이다(`autorun` — 분할하면 새 셸도 에이전트로 뜬다). 원격은 에이전트 이름 그대로
   * (원격 자동 실행 길은 장식을 붙이지 않는다 — 첫 입력과 같다).
   */
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

  /** 막대의 [다시 실행] */
  function rerunSetup(): void {
    if (!setupFail || setupFail.busy) return;
    setupFail = { ...setupFail, busy: true };
    void runSetup(false).finally(() => {
      if (setupFail?.busy) setupFail = null;
    });
  }

  async function startSession(interactive: boolean): Promise<Attempt> {
    const t = term;
    if (!t) return { ok: false, error: null };
    try {
      // **금고 관문** (2026-09-19 ② · docs/log/2026-09-19-vault.md).
      //
      // 마스터가 걸린 금고가 잠겨 있으면 백엔드의 `password_for` 는 `None` 을 준다 —
      // 담아 둔 값이 있어도 없는 것과 같다. 그러니 여는 것은 **접속을 시작하기 전**이어야
      // 하고(뒤에 열면 이미 모달이 떠 버렸다), 사람이 그 자리에 있을 때만이다:
      // 자동 재연결(`interactive === false`)은 몇 초마다 잠금 해제 창을 띄우면 안 된다.
      // [이번엔 건너뛰기] 도 언제나 있다 — 그 경우 이번 접속만 금고 없이 간다.
      if (interactive && pane.kind === "ssh") await ensureVaultUnlocked();
      // 원격 새 워크트리 — 준비 이벤트 구독이 선 뒤에 접속한다(첫 이벤트를 놓치지 않게).
      if (sshStart?.worktree && wtListening) await wtListening;
      // 새 세션의 채널은 Rust 출력 링의 0 에서 시작한다 (`outCount` 주석).
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
        // 원격 타일의 에이전트 신호는 세션 서버가 정한다(앱이 띄운 AI · 호스트의 에이전트 활성화 — Rust `signal_stream`).
        start: sshStart ?? undefined,
      });
      // 첫 입력은 실렸다 — 이 뒤의 재연결은 싣지 않는다 (위 `sshStart` 주석).
      sshStart = null;
      if (disposed) {
        void s.close();
        return { ok: false, error: null };
      }
      session = s;
      outCount = count;
      // 새 세션을 연 쪽이 크기 주인이다(R2-A).
      applyOwner({ owner: true, size: null });
      // 손잡이가 서기 전에 모인 입력(셸 시작의 커서 위치 질의에 대한 답 등)을 이제 보낸다.
      opening = false;
      if (earlyInput) s.write(earlyInput, earlySource ?? "keyboard");
      earlyInput = "";
      earlySource = null;
      // 그 사이 화면에 반영된 몫도 곧바로 돌려준다(ACK 크레딧).
      ackParsed(count);
      // 새 백엔드 세션은 수문이 열린 채 시작한다 — 죽은 세션에서 닫아 둔 상태를 물려주지 않는다.
      gated = false;
      // 에이전트 상태 점도 새 세션부터 다시 본다 (옛 세션의 "끝남"·출력 시각을 물려주지 않는다).
      agentSessionStart(pane.id);
      // 셸이 갈렸으니 OSC 133 의 **출처 고정**도 푼다 (터미널은 그대로 살아 있다).
      shell?.resetSource();
      // 옛 셸에서 돌던 명령도 함께 뜻을 잃는다 — 안 지우면 재연결한 타일이 죽은 명령의
      // 이름·아이콘(예: "Claude Code")을 계속 달고 선다.
      oncommand?.(pane.id, null);
      // 상위에 새 세션 id 를 알린다. 포트 포워딩 모달은 SSH 만 보지만, **창 이관**은
      // 로컬 셸의 id 도 필요로 한다 (그 세션을 새 창이 그대로 이어받는다) — 그래서
      // 종류를 가리지 않고 올린다 (docs/log/2026-09-02-tear-out.md).
      onsession?.(pane.id, s.id);
      // 원격 새 워크트리가 섰다 — 이 세션이 올라간 뒤라 목록 왕복이 이 세션을 쓸 수 있다.
      if (wtReloadProject) {
        reloadWorktreesAfterCreate(wtReloadProject);
        wtReloadProject = null;
      }
      // 로컬 새 열림에서만 해석된 셸 id 가 실려 온다 — 헤더가 "로컬" 대신 진짜 셸 이름을
      // 띄우도록 한 번 올린다 (SSH 열림·창 이관 재부착에는 없어 폴백을 쓴다).
      // 이 세션이 로그를 쓰고 있는지 한 번 묻는다 — ⋯ 메뉴가 동기라 미리 받아 둔다
      // (docs/log/2026-09-17-scrollback-export-and-logs.md). 답이 늦어도 메뉴만 늦게 켜진다.
      logPath = null;
      void refreshLogPath(s);
      if (s.resolvedShell) onshell?.(pane.id, s.resolvedShell);
      // tmux 호스트의 새 열림에서만 실려 온다 — 타일에 적어 두었다가 **다음 접속의 힌트**로
      // 되돌려 준다(같은 세션으로 돌아가는 유일한 근거). 재접속이면 보낸 값과 같은 값이
      // 돌아오므로 다시 적어도 무해하다.
      if (s.tmuxName) ontmux?.(pane.id, s.tmuxName);
      s.resize(t.cols, t.rows); // 접속을 기다리는 동안 창 크기가 바뀌었을 수 있다
      // 모달에서 "이 앱에 저장" 을 켠 사람 — **접속이 선 지금**이 그 자리다. 물을 때
      // 곧바로 담으면 틀린 값이 금고에 들어가고, 다음 접속이 그 값으로 한 번 더 거부당한다
      // (docs/log/2026-09-19-vault.md). 적어 두는 곳은 `app/prompts` 다.
      void flushVaultSaves();
      return { ok: true };
    } catch (e) {
      opening = false;
      earlyInput = "";
      earlySource = null;
      // 접속이 서지 않았다 — 적어 둔 값은 담지 않고 버린다.
      dropVaultSaves();
      // 첫 커밋 질문을 세워 둔 채 연결이 끊겼다 — 물을 곳이 없어졌으니 막대를 걷는다(다시 접속하면 다시 묻는다).
      if (wtPrep?.kind === "ask") wtPrep = null;
      return { ok: false, error: e };
    }
  }

  /**
   * **첫 열기** — 먼저 떨어진 세션에 붙어 본다([`attachDetached`] — 페이지 리로드 뒤, 로컬·SSH). 붙었으면
   * `attached` 라 자동 실행·설정 스크립트(로컬) · 원격 첫 입력(SSH)을 다시 돌리지 않는다. 같은 스트림이 아직 닫히는
   * 중·여는 중이면(`[session-alive]`·`[session-busy]` — 언마운트의 닫기가 아직 안 닿았거나 옛 페이지의 열기가 진행 중)
   * 잠깐 뒤 다시 본다(그 사이 떨어진 세션이 되면 붙는다).
   */
  async function startFirst(): Promise<Attempt & { attached?: boolean }> {
    for (let i = 0; ; i++) {
      const attached = await attachDetached();
      if (attached) return { ...attached, attached: attached.ok };
      // 붙을 세션이 없다 — 새 셸이 뜬다(로컬 AI 타일이면 프롬프트 · autorun 줄을 덮는다)
      beginAiVeil();
      const result = await startSession(true);
      if (result.ok || disposed || i >= OPEN_RETRIES) return result;
      if (!isLiveSessionConflict(result.error)) return result;
      await new Promise((r) => setTimeout(r, OPEN_RETRY_MS));
    }
  }

  /** 맡겨 둔 화면을 **그 크기로** 먼저 그리고 이 타일 크기로 맞춘다 (이관 복원과 같은 순서 — 아래 마운트 주석) */
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

  /**
   * **페이지 리로드 뒤 — 떨어진 세션(로컬·SSH)에 다시 붙는다** (세션 코어 ② · 설계 4.3).
   *
   * Rust 에 이 타일의 스트림을 묻고([`probeSession`]) 같은 종류의 떨어진 세션이면: 맡겨 둔 화면이 같은 회차면 먼저
   * 그리고 그 화면의 오프셋부터, 없으면 링 전체를 재생한다([`planAttach`]). 재생 구간은 [`replaying`] 으로 부작용을
   * 삼킨다. 링을 넘쳤으면 Rust 가 resize 로 재그림을 부르고 여기서는 유실 안내를 단다. 붙을 것이 없거나 붙기가
   * 실패하면 `null` — 부른 쪽이 새로 연다. SSH 는 새 접속이 아니라 원격 첫 입력(`sshStart`)을 다시 보내지 않는다.
   */
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
    // 숨은 탭의 타일은 아직 크기를 잴 수 없다 — 크기를 싣지 않고(Rust 가 PTY 크기를 그대로 둔다) 보일 때 맞춘다.
    const sized = !!container && container.clientWidth > 0 && container.clientHeight > 0;
    const count: OutCount = { base: null, parsed: 0 };
    // 결과 전 덩어리는 모은다(`held` 주석).
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
        // 붙는 사이 타일이 닫혔다 — 타일 닫기는 세션 종료다.
        held = null;
        attachCount = null;
        void s.close();
        endReplay();
        return { ok: false, error: null };
      }
      session = s;
      // 주는 붙으며 크기 주인이 된다(R2-A — 답의 `sizeOwner`).
      applyOwner(ownerFromReply(s));
      // 같은 세션에 붙었다 — 원격 첫 입력(프로젝트 시작 명령 · 워크트리)은 이미 그 셸에서 돌았다(다시 싣지 않는다).
      sshStart = null;
      count.base = s.outputStart ?? null;
      outCount = count;
      // 붙기 답을 받기 전에 화면에 반영된 몫(재생 포함)도 곧바로 돌려준다 — 안 그러면 다음 덩어리까지 ACK 가 없어
      // 1 MiB 넘게 받은 채 멈춘 수문이 영영 안 열린다(재리뷰 R03 · `startSession` 과 같은 자리).
      ackParsed(count);
      replayUntil = s.replayEnd ?? null;
      endReplayIfDone(count);
      // 맡긴 화면 없이 링을 재생한다면 **그 링이 쓰인 크기**(붙기 전 PTY 크기)로 쓴다 — ConPTY 의 절대 커서 이동이 다른 폭에서 어긋나
      // 줄 끝 글자가 빈 줄 끝에 남던 것(작업자 타일 첫 줄 찌꺼기 — 서버가 120칸으로 띄운 작업자를 좁은 타일에 처음 붙일 때). 재생 끝에서
      // [`endReplay`] 가 타일 크기로 돌린다(그 사이 refit 은 `restoring` 이 막는다). 체크포인트가 있으면 그 화면이 크기를 이미 정했다.
      const rs = replaying ? replayResize(s.replaySize, { cols: t.cols, rows: t.rows }, !!plan.checkpoint, sized) : null;
      if (rs) {
        restoring = true;
        replaySized = true;
        t.resize(rs.cols, rs.rows);
      }
      // 모아 둔 덩어리를 이제 쓴다 — 시작 오프셋을 알았으니 재생 끝에서 나눈다(재생분은 답하지 않고, 뒤 실시간분의 질의는
      // xterm 이 답해 `session` 으로 간다 — 그래서 `session` 을 단 뒤에 쓴다).
      const queued = held ?? [];
      held = null;
      for (const q of queued) writeAttached(t, count, q.chunk, q.done);
      // 떨어진 동안 수문은 열려 있었고 새 임대가 다시 쥔다 — 이 창은 0 에서 센다.
      gated = false;
      shell?.resetSource();
      // 로컬 타일의 "AI 읽기 허용" 은 세션 서버의 세션 메타에 남아 있다(③-4) — 세션을 알리기 전에 되살려, 거울이 첫
      // 보고부터 켜진 채 나가게 한다.
      if (pane.kind === "local" && plan.aiRead && !localAiTile(pane)) setShared(pane.id, true);
      onsession?.(pane.id, s.id);
      // 같은 세션이다 — 에이전트 상태는 Rust 표의 것을 그대로 받는다(이관 재부착과 같은 자리).
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

  /**
   * **다른 창에서 넘어온 패널** — 새 세션을 열지 않고 살아 있는 세션에 다시 붙는다.
   * (버퍼 재생은 이 호출 **전에** 끝나 있어야 원격 출력이 이력 뒤에 이어진다.)
   */
  async function resumeSession(sessionId: number, consumed?: number) {
    const t = term;
    if (!t) return;
    // 재부착 채널의 시작 오프셋은 Rust 가 돌려준 뒤에야 안다 — 그때까지 온 덩어리(재생 꼬리)도 센다.
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
        void s.detach(); // 이관 도중 또 언마운트됐다 — 세션은 살려 둔다
        return;
      }
      session = s;
      // 이관은 임대를 빼앗아 주가 된다 — 크기 주인이다(R2-A).
      applyOwner({ owner: true, size: null });
      count.base = s.outputStart ?? null;
      outCount = count;
      // 그 사이 화면에 반영된 몫도 곧바로 돌려준다(ACK 크레딧 — 위 `attachDetached` 와 같다 · 재리뷰 R03).
      ackParsed(count);
      // 옛 창이 역압으로 수문을 닫아 둔 채 넘겼어도 Rust 쪽이 열어 준다 (reattach_output).
      gated = false;
      // 다른 창의 세션을 이어받았다 — OSC 133 의 **출처 고정**을 푼다.
      shell?.resetSource();
      // 도는 명령은 **지우지 않는다** — 넘어온 화면에 133 은 실리지 않지만, 그 값은 이관 짐이 실어 와 이미
      // 이 타일에 심겨 있다(`$lib/tear` 의 `titles` · 2026-09-30). 여기서 지우면 넘어간 Claude Code 타일이
      // 다음 명령까지 셸 이름("로컬")으로 선다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md).
      onsession?.(pane.id, s.id);
      // 에이전트 상태 점 — 같은 세션이니 Rust 표의 상태를 그대로 받는다(이관 짐에 싣지 않는다 · 예전엔 다음 신호까지 비었다).
      agentStateResumed(pane);
      // 넘어온 세션도 자기 로그를 쓰고 있을 수 있다 — 새 창에서 다시 묻는다.
      logPath = null;
      void refreshLogPath(s);
      if (active) t.focus();
    } catch (e) {
      notice(tr("pane.notice.handoff_failed", { reason: describeOpenError(e, tr) }), "91");
    }
  }

  // ---------------------------------------------------------------------------
  // 시청자 (원격 웹 R2-B — 원격 창의 터미널 타일 · `viewer` 주석)
  //
  // 붙기: 스트림을 묻고(`probeSession` — 집 PC 가 붙어 있든 떨어졌든 살아 있는 회차면) 화면이 비어 있으면 맡겨 둔 화면(체크포인트)부터 그린
  // 뒤 그 오프셋부터, 아니면 링 전부(소비 0)를 재생받는다 — 집 PC 의 리로드 붙기와 같은 재생 규칙(재생분의 질의에는 답하지 않는다).
  // 붙을 세션이 없으면(집 PC 가 아직 안 열었다 · 끝났다) 안내 한 줄을 두고 기다렸다 다시 본다. 서버가 시청을 끝내면: 예산 초과(느린 원격)는
  // 받은 자리부터 다시 붙어 재동기화하고, 세션 끝은 끝 안내 뒤 다시 기다린다(집 PC 가 같은 스트림을 다시 열면 이어 본다 — SSH 재접속 포함).
  // ---------------------------------------------------------------------------

  /** 다시 붙어 보기까지 기다리는 시간 — 처음 2초, 실패마다 두 배, 15초까지 */
  const VIEWER_RETRY_MIN_MS = 2_000;
  const VIEWER_RETRY_MAX_MS = 15_000;
  let viewerRetryMs = VIEWER_RETRY_MIN_MS;
  let viewerRetryTimer: ReturnType<typeof setTimeout> | undefined;
  /** "아직 열려 있지 않다" 안내를 이미 찍었나(기다리는 동안 한 번만) */
  let viewerWaiting = false;

  /** 시청자로 붙어 본다 — 못 붙으면 안내 한 줄 뒤 기다렸다 다시. 재동기화(`resync`)는 그 회차 · 그 자리에서만 잇는다. */
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
      // 맡겨 둔 화면은 **빈 화면에만** — 앞 세션의 이력이 남은 화면에 덧그리면 이력이 두 벌이 된다(그때는 새 세션의 링 처음부터).
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
    // 서버에 적어 둘 크기는 **제 상자에 맞춘 크기**다(주인이 아니면 xterm 은 주인의 크기로 그리고 있다).
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
        void s.close(); // 시청 끝 — 세션은 그대로
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
      // 주인이 아니면 주인의 크기로 — 링의 재생분도 대개 그 크기(PTY 크기)로 쓰였다.
      const view = ownerFromReply(s);
      sizeOwner = view.owner;
      ownerSize = view.owner ? null : (view.size ?? s.replaySize ?? null);
      ownerPrimary = view.primary;
      if (!view.owner && ownerSize) {
        if (t.cols !== ownerSize.cols || t.rows !== ownerSize.rows) t.resize(ownerSize.cols, ownerSize.rows);
      } else {
        // 이 쪽이 곧 주인이다(집 PC 의 주가 없다) — 재생은 붙기 전 PTY 크기로 쓰고 재생 끝에서 제 크기로(집 PC 리로드 붙기와 같다).
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
      // "이 기기 크기로 맞추기" 를 켜며 되찾기로 했다(꼬리표 · 카드 단추) — 새 자격으로 붙었으니 곧바로.
      if (claimAfterAttach) {
        claimAfterAttach = false;
        if (!view.owner) void reclaimSize();
      }
      // 붙는 사이 떼기로 했다(R5 — 숨은 타일 · 백그라운드) — 곧바로 다시 뗀다(받은 자리는 기억).
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

  /** 서버가 이 시청을 끝냈다 — 예산 초과면 받은 자리부터 다시 붙고, 세션 끝이면 끝 안내 뒤 기다린다. 창 · 연결은 이 페이지가 사라지는 중. */
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

  /**
   * 시청을 놓고 **다시 이을 자리**를 돌려준다 — 받은 바이트(`received` — 파싱 전 포함) 자리 · 같은 회차. 옛 채널의 늦은 덩어리는 버린다
   * (`dead` — 파싱 몫으로 이으면 그 사이 덩어리가 두 번 그려진다). 예산 초과 재동기화 · 시청 떼어 두기(R5)가 같이 쓴다.
   */
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

  // ---------------------------------------------------------------------------
  // 시청 구독(원격 웹 R5 — `$lib/mobile/policy`): 페이지가 뒤로 가거나(백그라운드) 모바일 배치에서 화면에 없는 타일은 잠깐 뒤 시청자를
  // **뗀다**(데이터 · 배터리). 돌아오면 받은 자리부터 다시 붙어 재동기화한다(예산 초과 재동기화와 같은 길 · 링이 넘쳤으면 유실 안내).
  // 크기 주인 자격(폰 기본 거짓 · "이 기기 크기로 맞추기")이 바뀌면 곧바로 떼고 다시 붙는다(자격은 붙을 때 싣는다).
  // ---------------------------------------------------------------------------

  /** 떼어 둔 상태다(다시 붙지 않는다 — 기다림 · 다시 붙기 타이머도 멈춤) */
  let viewerParked = false;
  /** 떼어 둘 때 기억한 이을 자리(없으면 처음 붙기처럼) */
  let viewerResume: { sessionEpoch: number; consumed: number } | null = null;
  let viewerParkTimer: ReturnType<typeof setTimeout> | undefined;
  /** 지금 붙은 시청이 실은 자격 */
  let viewerEligibleNow: boolean | null = null;

  function parkViewerNow() {
    clearTimeout(viewerParkTimer);
    viewerParkTimer = undefined;
    viewerParked = true;
    clearTimeout(viewerRetryTimer);
    viewerRetryTimer = undefined;
    const h = session;
    if (!h) return; // 기다리는 중 — 타이머만 멈춘다(붙는 중이면 붙은 뒤 `attachAsViewer` 가 다시 부른다)
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
      // 자격이 바뀌었다 — 붙어 있으면 떼고 곧바로 다시(새 자격으로)
      if (viewerEligibleNow !== null && viewerEligibleNow !== eligible && session) {
        parkViewerNow();
        resumeViewer();
      }
    });
  });

  /** 시청하던 세션이 끝났다 — 안내 한 줄 · 크기는 제 상자로 · 기다렸다 다시 붙어 본다(같은 스트림의 새 회차) */
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
    viewerWaiting = true; // 끝 안내가 기다림 안내를 겸한다
    applyOwner({ owner: true, size: null });
    viewerRetryMs = VIEWER_RETRY_MIN_MS;
    clearTimeout(viewerRetryTimer);
    viewerRetryTimer = setTimeout(() => void viewerConnect(null), viewerRetryMs);
  }

  /** `ssh-exit` 수신 — 재연결할지 여기서 갈린다 */
  function handleExit(reason: SessionExitReason) {
    // 시청자는 재접속하지 않는다 — 세션을 여는 것은 집 PC 의 일이다(끝 안내 뒤 다시 붙어 본다).
    if (viewer) {
      viewerSessionEnded();
      return;
    }
    aiVeil?.exit(); // 로딩 덮개 — 끝난 세션을 가리지 않는다
    // ① 핸들을 먼저 무효화한다. 이 뒤의 입력은 갈 곳이 없어 자연히 버려진다.
    const dying = session;
    endReplay();
    session = null;
    cancelScreenPush(); // 간이 모드 거울 타이머도 (죽은 세션의 꼬리를 늦게 올리지 않게)
    // 죽은 세션은 백엔드 맵에서도 지운다 (기존 close_ssh 경로 — 재연결마다 새 id 가 쌓인다).
    // 이 호출이 **그 세션에 걸려 있던 포트 포워드까지 정리**한다 (Rust `close_ssh`).
    void dying?.close();
    // 세션이 사라졌다 — 포워딩 버튼·모달과 창 이관이 죽은 id 를 잡고 있지 않게 즉시 알린다.
    onsession?.(pane.id, null);
    if (disposed) return;

    // **자동 재연결이 갈리는 자리는 여기 하나다.** 로컬 셸과 정상 종료는 되살리지 않는다 —
    // 안내 한 줄을 그대로 찍고 **종료됨 상태**로 넘어간다 (스크롤백은 남고, Enter 로 다시
    // 붙거나 Ctrl+D 로 닫는다). 안내 줄을 없애지 않는 것이 중요하다: 배너는 사라져도(재접속)
    // 버퍼의 그 줄은 남아 "여기서 세션이 한 번 끝났다" 는 경계를 이력에 남긴다.
    //
    // **tmux 타일의 깨끗한 종료도 이 분기다** (docs/log/2026-09-16-tmux-toggle.md). 따로
    // 예외를 팔 필요가 없는 이유가 Rust 의 판정에 이미 들어 있다: `exec tmux` 라 tmux 가
    // 끝나면 그 셸도 끝나고, 채널이 코드 0(또는 정돈된 닫힘)으로 닫히므로 `reason.kind` 가
    // `"exit"` 이다 = **자동 재연결 대상이 아니다.** 그게 맞다 — detach 든 `exit` 든 사람이
    // 나간 것이라, 앱이 몰래 다시 붙으면 방금 한 조작을 되돌리는 꼴이다. 설정의 자동 재연결은
    // 여전히 **끊김**(전송 오류)에만 적용된다(아래 `"error"` 갈래).
    if (pane.kind !== "ssh" || reason.kind !== "error") {
      // **깨끗한 종료**(코드 0 · 정돈된 채널 닫힘)만 tmux 배너로 간다. Rust 가 코드 0 과
      // 정돈된 닫힘에만 `message: null` 을 실으므로, 그것이 곧 "깨끗함" 의 판정이다
      // (`종료 코드 130` 처럼 사유가 붙은 종료는 여느 종료 배너 그대로 — 말할 것이 있다).
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
      agentExit(pane); // 에이전트 상태 점 — 세션이 끝나면 점이 없다 (재연결로 넘어가는 끊김은 여기 오지 않는다)
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
      // 아직 한 번도 붙어 보지 않았다 — 힌트는 첫 시도가 실패한 뒤에 생긴다.
      hint: null,
    };
    scheduleRetry();
  }

  /** 다음 재시도를 예약하고 카운트다운을 돌린다 */
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
    // 표시용 카운트다운은 1초 간격. 남은 시간은 목표 시각에서 되계산해 드리프트를 없앤다.
    tickTimer = setInterval(() => {
      if (reconnect) reconnect.secondsLeft = Math.max(0, Math.ceil((due - Date.now()) / 1000));
    }, 1000);
    retryTimer = setTimeout(() => void tryReconnect(false), delay);
  }

  /**
   * 재연결을 한 번 시도한다.
   * `manual` = 사용자가 배너의 [지금 재연결] 을 눌렀다 → **이 시도에서만** 모달을 허용한다.
   */
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
    // 붙지 못한 사유의 "다음에 할 일" — 배너의 흐린 둘째 줄이 된다.
    const hint = openErrorHint(detail, tr);
    reconnect = { ...reconnect, hint };

    // 되살릴 수 없는 실패 — 재시도해도 같은 답만 온다.
    if (detail.kind === "host_key_changed") {
      stopReconnect(describeSessionError(detail, tr), "91");
      return;
    }

    // 사람 손이 필요한 실패 — 여기서 자동 루프를 멈춘다. 계속 돌면 몇 초마다 모달이
    // 다시 떠서 화면을 점거한다 (모달 스팸 방지).
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

  /**
   * 자동 재연결을 끝낸다 (사용자의 [중단] · 되살릴 수 없는 실패).
   *
   * 루프가 끝나도 타일은 남는다 — **종료됨 상태**로 넘긴다. 그러면 정상 종료와 똑같이
   * Enter 로 손수 다시 붙어 보거나 Ctrl+D 로 닫을 수 있다 (배너 없이 죽은 타일만 남으면
   * 남은 길이 헤더 `×` 뿐이라 1패널 탭에서는 그마저 없다).
   */
  function stopReconnect(message: string, sgr = "90") {
    clearTimers();
    reconnect = null;
    notice(message, sgr);
    ended = { connecting: false, note: null };
    onexit?.();
  }

  // ---------------------------------------------------------------------------
  // 연결 대기 (배치 복원 — docs/log/2026-09-03-workspace-restore.md)
  //
  // 복원된 SSH 타일은 마운트에서 세션을 **열지 않는다**. 대신 배너 하나를 띄우고 접속
  // 함수를 레지스트리에 올려 둔다 — 사람이 [연결] 을 누르거나, `+page` 의 `reconnect-all`
  // 이 계단식으로 부르거나(같은 함수다), 시작 시 자동 재접속이 그 계단식을 돌릴 때 붙는다.
  // ---------------------------------------------------------------------------

  /**
   * 연결 대기 타일을 지금 접속시킨다. **사람이 시작한 접속**이므로 TOFU·비밀번호 모달을
   * 허용한다 (`startSession(true)` — 첫 접속과 같은 경로다).
   *
   * 시도를 시작하는 순간 `pane.deferred` 를 지운다 — 계단식 재연결이 같은 타일을 두 번
   * 집지 않게. 실패하면 다시 세워 두어 [연결] 과 `reconnect-all` 의 대상으로 남긴다.
   */
  async function connectDeferred() {
    // 대기 여부의 진실은 **레지스트리 등록**이다 (`deferred` 배너가 아니다) — 사용자가
    // 배너를 [닫기] 로 감춘 타일도 '모두 재연결' 로는 붙어야 하기 때문이다.
    if (disposed || !unconnect || deferred?.connecting) return;
    deferred = { connecting: true, note: null };
    delete pane.deferred;

    const result = await startSession(true);
    if (disposed) return;

    if (result.ok) {
      deferred = null;
      unconnect?.(); // 붙었으니 레지스트리에서 빠진다 (다음 `reconnect-all` 이 건너뛴다)
      unconnect = null;
      if (active) term?.focus();
      return;
    }

    // 다시 대기 상태로 — 사용자가 비밀번호를 잘못 쳤거나 서버가 아직 안 떠 있을 수 있다.
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
    // 타일 명세에 남은 대화 연결 사본을 표로 — 세션을 열기 **전에**(산 세션에 다시 붙으면 그대로 · 새 세션이면
    // `agentSessionStart` 가 버린다 · `PaneSpec.agentLink`).
    seedAgentLink(pane);
    // 이관 지시서는 **1회용**이다 — 여기서 읽어 내고 명세에서 지운다. 남겨 두면 이 패널이
    // 다시 마운트될 때(창 안 이동 등) 낡은 버퍼를 또 재생하고 죽은 세션 id 를 다시 잡는다.
    const restore = pane.restore;
    if (restore) delete pane.restore;

    // 계단식 시작 지연도 **1회용**이라 같은 자리에서 읽어 내고 명세에서 지운다
    // (docs/log/2026-09-03-group-open-tiled.md). 남겨 두면 이 패널이 다시 마운트될 때마다
    // — 창 안 이동 등 — 이유 없이 또 기다린다. 재연결·재부착 경로는 이 값을 보지 않는다:
    // 아래 **최초 `startSession` 앞**에서만 기다린다.
    const openDelay = pane.openDelay ?? 0;
    if (pane.openDelay !== undefined) delete pane.openDelay;

    // 배치 복원의 **연결 대기** 표시. 여기서는 읽기만 한다 — 실제로 지우는 것은 접속을
    // 시작하는 `connectDeferred` 다 (`+page` 가 이 표시로 "아직 안 붙은 타일" 을 찾는다).
    const startsDeferred = pane.deferred === true;

    // 원격 프로젝트의 시작 폴더·명령 — 새로 여는 SSH 타일에서만 (이관 재부착은 새 세션을 열지
    // 않는다). 값을 명세에서 지우지는 않는다: 로컬 `autorun` 처럼 `clonePane` 이 물려줘야
    // 분할한 타일도 같은 프로젝트로 뜬다 (docs/log/2026-09-24-projects.md).
    sshStart =
      pane.kind === "ssh" && !restore && pane.cwd
        ? {
            cwd: pane.cwd,
            command: pane.autorun?.trim() ? pane.autorun : null,
            // 표 — 준비 이벤트 · 답이 이 타일을 가리키는 글자(2026-09-29 B안)
            // (`projectId` 는 앱 안에서만 — Rust `SshWorktree` 에는 저장소 · 이름 · 표만 싣는다)
            worktree: pane.worktree
              ? { repo: pane.worktree.repo, name: pane.worktree.name, ticket: newSetupNonce() }
              : null,
          }
        : null;
    // 워크트리 **만들기** 재료는 여기서 명세에서 지운다 — `cwd`·`autorun` 과 달리 분할 복제가
    // 물려받으면 같은 워크트리를 또 만들려 한다 (docs/log/2026-09-24-worktrees.md).
    const worktreeProjectId = pane.worktree?.projectId ?? null;
    if (pane.worktree !== undefined) delete pane.worktree;
    if (sshStart?.worktree) {
      const ticket = sshStart.worktree.ticket;
      wtTicket = ticket;
      wtProjectId = worktreeProjectId;
      wtListening = listenWorktreePrep(ticket, onWorktreePrep).then((un) => {
        // 구독이 서기 전에 타일이 닫혔거나 준비가 이미 끝났다 — 곧바로 푼다.
        if (disposed || wtTicket !== ticket) un();
        else wtUnlisten = un;
      });
    }

    // 설정 스크립트 재료도 같은 1회용이다 — 읽어 두고 명세에서 지운다(분할한 타일이 또 돌리지 않게). 원격은 첫 입력에
    // 프로젝트 id 와 nonce 를 싣는다(Rust 가 그 명령 자리를 `sh -c '<스크립트>' && <에이전트>` 로 짓는다).
    setupReq = !restore && pane.setup ? { ...pane.setup } : null;
    if (pane.setup !== undefined) delete pane.setup;
    if (setupReq && pane.kind === "ssh" && sshStart) {
      setupNonce = newSetupNonce();
      sshStart.setup = { projectId: setupReq.projectId, nonce: setupNonce };
    }

    const t = new Terminal({
      allowProposedApi: true, // Unicode11 애드온·OSC 133 핸들러(5단계)가 요구
      // 새로 여는 탭도 현재 설정으로 시작한다 (설정이 비어 있으면 이 값들이 원래 기본값이다).
      // 합자를 켰고 글꼴을 안 정했으면 fontFamilyEffective 가 합자 지원 스택으로 준다.
      fontFamily: settings.fontFamilyEffective,
      fontSize: settings.termFontSize, // UI 배율만큼 되돌린 값 (위 설정 구독과 같다)
      // kitty 감각의 타이포 — 줄 사이 여유(1.1)와 블록 커서. 렌더 취향값이라 설정에 없고
      // 생성 시 기본으로 박는다 (재시작하면 전 탭에 적용된다).
      lineHeight: 1.1,
      cursorStyle: settings.cursorStyle,
      cursorBlink: true,
      // 호스트별 스크롤백 (sessions.toml). **생성 시 1회** — 아래 설정 $effect 에 넣지 않는다:
      // 앱 설정이 아니라 호스트 설정이고, 줄어들면 이미 쌓인 이력이 잘려 나가므로
      // 살아 있는 탭에 소급 적용하지 않는다 (docs/log/2026-09-01-on-connect.md).
      scrollback: pane.scrollback ?? DEFAULT_SCROLLBACK,
      // 새 터미널도 현재 투명도로 시작한다 — 위 $effect 가 곧 같은 값을 다시 걸지만,
      // 여기서 미리 주지 않으면 **첫 프레임이 불투명**했다가 바뀌는 깜빡임이 보인다.
      allowTransparency: settings.termOpacity < 100,
      theme: settings.termThemeEffective,
      windowsPty: { backend: "conpty" },
      // ── 얇은 스크롤바 (docs/log/2026-09-26-thin-terminal-scrollbar.md) ─────────
      //
      // xterm 6 에서 세로 스크롤바 폭을 정하는 손잡이는 **이것 하나뿐**이다 — 뷰포트가
      // `verticalScrollbarSize: overviewRuler.width || 14` 로 읽고, FitAddon 도 같은 값을
      // 열 계산에서 뺀다. 그래서 CSS 로 폭을 줄이면 글자 칸은 14px 를 비워 둔 채 남는다.
      // 10px 는 **잡는 자리**의 폭이다 — 보이는 손잡이(쉴 때 3px, 올리면 6px)는 theme.css 가
      // 투명 테두리로 그 안에서 깎는다. 켜는 김에 눈금자 캔버스가 생기는데, 그 테두리선은
      // `withScrollbarSlider` 가 지우고 남는 것은 검색 매치 표시(가운데 1/3 줄)뿐이다.
      overviewRuler: { width: 10 },
      // ── OSC 8 하이퍼링크 (docs/log/2026-09-23-osc52-osc8.md) ───────────────
      //
      // `ls --hyperlink=auto`·`gh`·`cargo` 처럼 **글자 뒤에 주소를 숨겨 보내는** 링크다.
      // 파싱은 xterm 이 이미 한다 — 없는 것은 이 손잡이뿐이었고, 그래서 지금까지 OSC 8
      // 링크는 밑줄도 안 서고 눌러도 아무 일이 없었다(URL 자동 탐지와는 다른 길이다:
      // 저쪽은 화면 글자에서 정규식으로 찾는다).
      //
      // **아래 WebLinks 블록과 정확히 같은 조작**이어야 한다 — 한 화면에 두 종류의 링크가
      // 섞여 있고, 그중 어느 것인지는 사람이 구별할 수 없다. 그래서 셋 다 베낀다:
      // Ctrl(맥은 ⌘)+클릭에서만 열고 · 여는 것은 `openUrl`(웹뷰 안에서 열면 터미널 창이
      // 브라우저가 된다) · 호버는 같은 `hoveredLink` 에 적는다(우클릭 메뉴가 그 값을 읽는다).
      //
      // (2026-09-23 판) **`allowNonHttpProtocols` 는 건드리지 않는다**(기본 `false`). 그 기본이 곧
      // `http:`·`https:` **둘만** 통과시키는 필터이고, 그 필터가 OSC 8 의 유일한 방어선이다:
      // 주소는 화면 글자가 아니라 **원격이 보낸 바이트**라 사람 눈에 보이지 않는다.
      // 켜면 `file:` 이 통과해 원격 호스트가 **이 PC 의 로컬 파일**을 열 수 있고
      // (`javascript:` 는 더 나쁘다), 그 클릭은 겉보기에 평범한 링크와 구별되지 않는다.
      //
      // **2026-09-27 — `file://` 하나를 더 받는다** (docs/log/2026-09-27-doc-tile.md "A — 여는 길"). 로컬 타일의
      // `ls --hyperlink` 가 붙이는 이 컴퓨터의 파일(호스트가 비었거나 localhost · 이름이 텍스트로 보이는 것)을 문서
      // 보기로 연다. 그러려면 xterm 의 기본 필터(`allowNonHttpProtocols: false`)를 끄고 **같은 필터를 여기서 직접**
      // 세워야 한다 — 그것이 [`oscLinkAction`] 하나다: `http:`·`https:` 는 지금처럼 `openUrl`, 로컬 타일의 로컬
      // `file://` 은 문서 보기, **그 밖은 전부 아무것도 하지 않는다**(`javascript:` · 원격 타일의 `file:` · 다른
      // 호스트의 `file:`). `openUrl` 로 가는 것은 여전히 http(s) 둘뿐이고, 우클릭 "링크 열기" 가 읽는 `hoveredLink`
      // 에도 http(s) 만 적는다. 대가 하나: 걸러진 주소도 호버에 밑줄은 선다(xterm 이 링크로 세운 뒤에 거르므로).
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
    // 창 이관용 직렬화 (docs/log/2026-09-02-tear-out.md). 애드온 자체는 비용이 없고
    // `serialize()` 를 부를 때만 버퍼를 훑는다 — 그 호출은 탭 드래그 시작 때뿐이다.
    const ser = new SerializeAddon();
    t.loadAddon(ser);
    // 직렬화가 싣지 않는 마우스 인코딩(SGR)을 기억해 끝에 덧붙인다 — 그 화면으로 시작한 터미널의 휠 보고가 사라지지 않게(`term/mouse-encoding`)
    const mouseEnc = watchMouseEncoding(t);
    term = t;
    fit = f;

    // OSC 0/2 (창 제목) — 셸이 제목을 바꾸면 상위가 헤더·탭에 셸 이름 대신 띄운다.
    // 표시 전용이라 레이아웃 트리는 건드리지 않는다 (`ontitle` 주석 참고).
    t.onTitleChange((title) => {
      ontitle?.(pane.id, title);
    });

    // 다른 창의 크기로 그리는 중이면(R2-B) 커서 줄을 상자 안에 둔다(`revealCursorSoon`). 주인이면 아무 일도 없다.
    t.onCursorMove(() => {
      if (!sizeOwner && ownerSize !== null) revealCursorSoon();
    });

    // 벨(`\a`) — 타일 테두리 번쩍임 · 안 보는 탭이면 탭 표식 · (설정하면) 소리.
    // 무엇을 할지는 전부 `app/bell` 이 정한다 (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
    // **간이 모드(tmux)에서도 산다** — 셸 통합과 달리 벨은 OSC 133 과 무관한 제어 문자다.
    // 구독 해제는 따로 하지 않는다: `t.dispose()` 가 이벤트를 함께 거둔다 (`onTitleChange` 와 같다).
    t.onBell(() => {
      // 다시 붙을 때의 링 재생 — 이미 한 번 울린 종이다.
      if (replaying) return;
      bell(pane.id, visible);
    });

    // 이 패널의 버퍼를 이관 레지스트리에 올린다 (동시 입력 레지스트리와 같은 패턴).
    // **지금 크기를 함께 싣는다** — 그 문자열은 이 열 수에서만 원래의 줄바꿈을 재현한다
    // (docs/log/2026-09-08-block-history-store.md 의 "폭이 다른 창으로 이관").
    const unserialize = registerSerialize(pane.id, (scrollback = TEAR_SCROLLBACK) => ({
      buffer: ser.serialize({ scrollback }) + encodingSuffix(mouseEnc.current()),
      cols: t.cols,
      rows: t.rows,
      // 버퍼와 **같은 동기 순간**의 출력 오프셋 — 받는 창이 이 뒤를 재생한다 (`outCount` 주석).
      ...(outCount && outCount.base !== null ? { consumed: outCount.base + outCount.parsed } : {}),
    }));

    // **화면 체크포인트 30초 주기** (세션 코어 ② · 설계 4.3 "맡기는 때") — 타일(로컬·SSH)이 붙어 있고 지난번 뒤로 출력이
    // 있었을 때만. 웹뷰가 갑자기 죽어도(크래시 — `pagehide` 가 없다) 새 페이지가 이 화면부터 그린다. 창이 가려질 때 ·
    // `pagehide` 의 체크포인트는 `app/boot` 이 맡긴다.
    let checkpointedAt = -1;
    // 첫 장은 붙거나 연 뒤 곧(5초) — 30초를 기다리는 사이 GUI 가 죽으면(kill) 다음 붙기에 맡겨 둔 화면이 없어 세션 시작부터를
    // 유실로 센다(실기 10-09 ③). 그 뒤로는 30초마다.
    const checkpointNow = () => {
      const s = session;
      const count = outCount;
      // 시청자는 맡기지 않는다 — 체크포인트는 주의 일(서버도 시청자 열쇠를 거절한다).
      if (viewer || !s || !count || count.base === null || replaying) return;
      const consumed = count.base + count.parsed;
      if (consumed === checkpointedAt) return;
      checkpointedAt = consumed;
      try {
        stashCheckpoint(s.kind, s.id, {
          buffer: ser.serialize({ scrollback: CHECKPOINT_SCROLLBACK }) + encodingSuffix(mouseEnc.current()),
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

    /**
     * 키 입력을 세션으로. **끊긴 동안 친 키는 버린다** — 큐에 모아 두었다가 재연결 후
     * 몰아 보내면 사용자가 무엇을 실행하는지 못 본 채로 실행된다 (`rm …` 를 치다 끊겼는데
     * 다시 붙는 순간 그게 날아가는 식). 위험을 감수할 만한 편의가 아니다.
     */
    const writeInput = (data: string, source: InputSource = "keyboard") => {
      if (reconnect) return;
      // 크기 주인이 아니면 터미널 응답은 보내지 않는다(R2-B — 주인이 답한다). 사람의 키 · 붙여넣기는 언제나 간다 — 그리고 그 쪽이
      // 곧 주인이다(서버가 이 쓰기에서 주인을 바꾼다 — 이벤트를 기다리지 않고 먼저 맞춰 둔다).
      if (!shouldSendInput(source, sizeOwner)) return;
      // 폰(R5 — 자격 없는 시청자)은 쳐도 주인이 되지 않는다(서버도 그 쓰기에서 주인을 바꾸지 않는다) — 주인의 크기로 계속 그린다.
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

    /**
     * **이 패널이 받은 키 입력의 유일한 입구.** 동시 입력이 켜진 탭이면 상위가 여기서
     * 가로채 형제 패널까지 함께 보낸다 (자기 자신 포함 — `writeInput` 을 직접 부르지 않는다).
     *
     * 이 자리는 xterm 의 `onData` 이후, 즉 **IME 조합이 끝난 최종 문자열** 이다.
     * 붙여넣기도 여기로 온다 (의도된 브로드캐스트 대상 — docs/log/2026-09-01-sync-input.md).
     */
    const sendInput = (data: string) => {
      // 다시 붙을 때의 링 재생 구간 — xterm 이 재생 바이트의 DSR/DA 질의에 답한 것이 여기로 온다. 셸은 이미 한 번
      // 답을 받았다(동시 입력 형제에게도 가면 안 된다). 사람의 키도 이 짧은 구간(수 ms)엔 버려진다.
      if (replaying) return;
      // 출처(오케스트레이션 5단계) — 붙여넣기 · 키 이벤트 중이면 사람, 아니면 내용으로(터미널 응답 = `protocol`).
      const source = classifyInput(data, { pasting: inputPasting, keyEvent: inputKeyEvent });
      // 모바일 키 띠의 끈적 Ctrl(R5) — 걸려 있으면 사람이 친 다음 글자 하나에 붙이고 푼다(붙일 수 없는 글자면 그대로 보내고 푼다).
      if (source === "keyboard" && stickyCtrl()) {
        setStickyCtrl(false);
        data = ctrlOf(data) ?? data;
      }
      // 크기 주인이 아닌 쪽의 터미널 응답은 동시 입력 형제에게도 가지 않는다(R2-B — 주인이 답한다).
      if (!shouldSendInput(source, sizeOwner)) return;
      if (onbroadcast?.(data)) return;
      writeInput(data, source);
    };

    // 인라인 제안이 수락한 글자도 **이 문으로** 나간다 (사람이 친 키와 같은 길).
    suggest.inputSink = sendInput;

    // 동시 입력 레지스트리에 이 패널을 올린다. 등록하는 것은 `sendInput` 이 아니라
    // **`writeInput`** 이다 — 브로드캐스트가 다시 브로드캐스트를 부르는 고리를 원천에서 끊는다.
    const unregister = registerInput(pane.id, writeInput);

    // 크기 주인이 바뀌었거나 주인이 크기를 바꿨다(R2-B) — 이 손잡이의 세션 것만(`ownerFromEvent`).
    const unOwner = listen<unknown>(SIZE_OWNER_EVENT, (ev) => {
      const v = ownerFromEvent(session?.lease, ev.payload);
      if (v && !disposed) applyOwner(v);
    }).catch(() => () => {});

    // ── OSC 133 창구 (5단계) ────────────────────────────────────────────────
    // 패널 헤더의 ⧉ 와 6단계 MCP 가 두드릴 문. 복사 결과의 **토스트까지 여기서** 붙여
    // 두므로 어느 진입점(버튼·단축키)으로 와도 같은 피드백이 뜬다. `shell` 은 아직
    // null 이지만(터미널이 열린 뒤에 붙는다) 이 함수들은 전부 나중에 불린다.
    const commands = {
      status: () => shell?.status() ?? null,
      // 셸이 알려 준 현재 폴더 — 로컬 타일의 📂 가 첫 번째로 보는 값이다.
      cwd: () => shell?.cwd() ?? null,
      last: () => shell?.last() ?? null,
      tail: (n: number) => shell?.tail(n) ?? [],
      jump: (dir: -1 | 1) => shell?.jump(dir) ?? false,
      // `#` 블록 검색의 점프가 묻는 값 — 마커가 밀려났으면 `null` 이다.
      lineOfBlock: (id: number) => shell?.lineOfBlock(id) ?? null,
      // 점프가 착지한 뒤 블록 전체를 두르는 띠. 수명은 남긴 강조와 같다 (아래 `clearBand` 배선).
      bandBlock: (id: number) => shell?.bandBlock(id) ?? false,
      clearBand: () => shell?.clearBand(),
      // 이관이 실어 보내는 마커 자리 (거리). 창을 건널 수 있는 유일한 모양이다.
      markerDistances: () => shell?.markerDistances() ?? [],
      copyOutput: async (): Promise<CopyResult> => {
        const result = shell ? await shell.copyOutput() : ("none" as CopyResult);
        showToast(result);
        return result;
      },
      canCopyOutput: () => shell?.canCopyOutput() ?? false,
      // 블록을 AI 타일에 넘길 때 발췌보다 먼저 보는 출력 전부 (docs/log/2026-09-28-ask-ai-block.md)
      blockOutput: (id: number) => shell?.blockOutput(id) ?? null,
    };
    const uncommands = registerCommands(pane.id, commands);

    // 사람 키 문 — 그 동안 나온 글은 키(사람)로 친다(입력 출처 `keyboard` 의 동기 구간 `inputKeyEvent` — `sendInput` 은 동기다).
    // 터미널 창구의 띠 키 · 입력 칸 보내기가 부른다(옛 자리마다 있던 같은 try/finally 를 한 자리로 — 순서 · 범위 그대로).
    const sendAsKey = (data: string) => {
      inputKeyEvent = true;
      try {
        sendInput(data);
      } finally {
        inputKeyEvent = false;
      }
    };

    // ── 터미널 조작 창구 (docs/log/2026-09-05-terminal-context-menu.md) ──────
    // 컨텍스트 메뉴는 `PaneHost` 가 그리므로(타일 상자 밖) 항목을 누른 결과가 여기로
    // 돌아올 길이 필요하다. 명령 창구(`registerCommands`)와 같은 패턴이고, 나눠 둔 이유는
    // 층이 다르기 때문이다 — 저기는 OSC 133 블록, 여기는 화면과 클립보드다.
    // 몸통은 `term/actions-controller.ts`(2026-10-27 분할 8차) — 입력 출처의 동기 구간(`sendAsKey` · `pasteToTerm`)과 `writeInput` · `sendInput` 은 여기.
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

    // ── 검색 창구 (`$lib/search-registry`) — 손잡이는 `term/search.ts` 의 `target` ──────────
    // 창 전역 검색 오버레이가 이 손잡이로 **모든 터미널을 한꺼번에** 훑는다. 등록은 **마운트 수명**이고
    // 애드온은 아직 없다(`t.open` 뒤에 붙는다 — 아래 `termSearch.attach`).
    const unsearch = registerSearch(
      termSearch.target({
        paneId: pane.id,
        name: () => paneName(pane, tr),
        screenOnly: () => screenOnly,
      }),
    );

    // ── 키 가로채기 (`term/key-handlers.ts`) — 죽은 타일 Enter·Ctrl+D → 제안 상자 → 단축키 → IME 229 시임 ──
    // **`t.open` 앞, 이 자리에서** 한 번 건다(옮기기 전과 같은 자리). 조합은 `ev.code` 로만 만든다.
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
    // 화면이 바쁠 때 한글 조합이 빠지거나 두 번 들어가던 xterm 6.0.0 결함 — 조합 도우미는 open 에서 생긴다.
    patchTerminalComposition(t);
    // 숨은 터미널의 DOM 렌더러가 글자 폭을 0 으로 재며 모든 행을 다시 그리던 것(탭 전환 멈춤) — 렌더러는 open 에서 생긴다.
    // 숨은 채 열리는 타일(복원된 다른 탭)은 닫힌 문으로 시작한다. 여는 것은 가시성 `$effect` 의 rAF 다.
    renderGate = installHiddenRenderGate(t, !visible);
    f.fit();
    // 인라인 이미지 — 세션 출력이 들어오기 **전에** 붙인다 (위 "인라인 이미지" 머리말).
    if (settings.inlineImages) addons.loadImages();

    // ── OSC 133 (5단계) ─────────────────────────────────────────────────────
    // `t.open` **뒤에** 건다 — 실패 데코레이션은 렌더러가 서 있어야 그릴 수 있다.
    // 상태는 그대로 위로 흘려보낸다 (`null` = 이 세션엔 OSC 133 이 없다 → 활동 점 폴백).
    //
    // 블록 이력(`$lib/block-history`)도 여기서 붙는다. 저장소는 **모듈 전역**이라 이 컴포넌트가
    // 이관·재연결로 죽었다 살아나도 그대로 남는다 — 이 자리는 "어느 타일의 이력인가" 를
    // 알려 주는 것뿐이다. 닫힌 블록 하나를 Rust 거울로 밀어 올릴지는 **공유 여부**가 정한다
    // (프라이버시 판단은 이 파일에만 있다 — shell-integration 은 그것을 알지 못한다).
    //
    // **tmux 타일(간이 모드)에는 아예 붙이지 않는다** (docs/log/2026-09-16-tmux-toggle.md).
    // 출력을 거르는 방식이 아니라 **싱크를 만들지 않는 방식**인 것이 요점이다: 거르면
    // "언젠가 반쪽 마커가 통과할 수도" 라는 여지가 남고, 그 여지가 곧 반쯤 맞는 블록
    // 이력이다. 파서가 없으면 `shell` 은 `null` 로 남아 상태(OSC 133)·블록·OSC 7·도는 명령이
    // **하나도 생기지 않는다** — 그 세 갈래는 이미 `shell` 이 없는 경우를 다룬다(활동 점 폴백).
    if (!screenOnly) {
      shell = attachShellIntegration(
        t,
        (status) => {
          onstatus?.(pane.id, status);
          // 공유가 켜진 패널만 서버로 밀어 올린다 (running/ok/fail 전이가 곧 갱신 주기다).
          pushContext();
        },
        {
          paneId: pane.id,
          onblock: (block) => {
            // **긴 명령 완료 알림은 공유와 무관하다** — 서버로 나가는 값이 아니라 이 창
            // 사람에게 하는 말이다 (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
            // `visible` 이 곧 "지금 보이는 탭에 있는가" 라, 포커스·가시성 판정의 절반이
            // 여기서 그대로 넘어간다.
            notifyFinishedBlock(pane.id, paneName(pane, tr), block, visible);
            if (!aiOn) return;
            // **재생(떨어진 세션에 다시 붙기)이 다시 만든 블록은 올리지 않는다**(2026-11-10) — 그 바이트가 흐를 때 거울을 쥔 쪽(옛 페이지의
            // 프런트 · 창이 없던 동안의 서버 해석기)이 이미 올렸다. 다시 올리면 시작 시각이 달라 같은 명령이 다른 블록으로 하나 더 선다.
            if (replaying) return;
            void pushSessionBlock(contextKeyOf, block);
          },
          // 거터 표식(`12.4초`)을 몇 초부터 달 것인가 — **설정을 아는 쪽은 여기다**
          // (shell-integration 은 프라이버시도 설정도 알지 못한다는 같은 분담).
          // 매번 다시 읽으므로 바꾼 값이 다음 블록부터 곧바로 듣는다.
          markAfterSecs: () => settings.markAfterSecs,
          // 표식·말풍선의 문구 — `markAfterSecs` 와 같은 자리, 같은 이유로 **함수**다
          // (그 모듈은 설정도 언어도 구독할 수 없다).
          tr,
          // 도는 명령은 **공유와 무관하게** 올린다 — 이건 서버로 나가는 값이 아니라 이 창의
          // 타일 아이콘·이름이 읽는 표시 신호다 (`app/titles` 의 `reportRunningCommand`).
          oncommand: (commandLine) => {
            oncommand?.(pane.id, commandLine);
            // 로딩 덮개 — 첫 `C`(autorun 줄)면 xterm 화면만 지우고, `D`(명령이 끝남)면 걷는다
            if (commandLine !== null) aiVeil?.commandStarted();
            else aiVeil?.commandEnded();
            // 에이전트 CLI 가 돌기 시작했다 — 신원 보고 **뒤에**(손으로 친 `claude` 도 그 보고로 AI 타일이 된다)
            // 링 재생의 `C` 는 지난 명령이다 — 대화 연결을 버리지 않게 알린다(`replaying`)
            if (commandLine !== null) agentCommandStarted(pane, replaying);
          },
          // 에이전트 명령이 끝나 셸 프롬프트가 돌아왔다 → 타일 신원이 셸로 (2026-09-24 실기 ② · 거르는 일은 받는 쪽)
          onprompt: () => agentPromptReturned(pane),
          // 셸이 알려 준 폴더가 바뀌었다 — "이 폴더의 지난 대화" 의 기준 폴더가 따라간다. 로컬 타일과 SSH 타일
          // (원격은 그 서버의 폴더 — 그 서버의 대화를 고른다: docs/log/2026-09-27-remote-conversations.md).
          oncwd: (cwd) => {
            if (pane.kind === "local" || pane.kind === "ssh") noteReportedCwd(pane.id, cwd);
          },
          // 실패 줄의 [AI에게 묻기] — 단추 아래에 상자가 선다(오른쪽 맞춤). 조합은 사용자가 바꾼 그대로 적는다.
          // 블록 줄의 [리치하게 보기] — 카드가 그 줄에서 커진다(`term/BlockView.svelte`)
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

    // ── OSC 52 · 9 · 777 · 7717 (몸통은 `term/osc-handlers.ts`) ─────────────────
    //
    // **이 자리와 순서가 곧 동작이다** — xterm 은 같은 번호의 핸들러를 나중에 건 것부터 부른다. 셸 통합(위 OSC 133/7/9)
    // **뒤에** 52 → 9·777 → 7717 순서로 건다. 셋 다 `if (!screenOnly)` 바깥이다(훅 없는 타일에서도 와야 한다 — 각 머리말).
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
    // **재생 구간 가리개** — 위 셋보다 **나중에** 건다(몸통·규칙은 `term/replay-mute.ts`).
    const replayMute = attachReplayMute(t, () => replaying);

    // ── 표시 트리거 (docs/log/2026-09-02-triggers-webgl-logging.md) ──────────
    // 데코레이션을 쓰므로 `t.open` 뒤여야 하는 것은 OSC 133 과 같다. 첫 목록은 여기서
    // 직접 넣는다 — 위의 구독 `$effect` 는 이 함수보다 **먼저** 한 번 돌아 이 시점에는
    // 아직 `triggers` 가 null 이었다 (그 뒤의 변경만 구독이 받는다).
    // 링크 호버를 함께 받는다 — 우클릭 메뉴의 "링크 열기" 는 그 상태를 읽는다
    // (같은 정규식·같은 템플릿 치환을 우클릭 때 한 번 더 돌리지 않는다).
    triggers = attachTriggers(t, tr, (url) => (hoveredLink = url));
    triggers.setTriggers(settings.current.triggers);

    // ── 기본 URL 자동 링크 (docs/log/2026-09-04-trigger-links-tooltips.md) ────
    //
    // **트리거 프로바이더 뒤에 건다.** xterm 은 링크 프로바이더를 등록 순서대로 물어보고
    // 먼저 답한 쪽에서 멈추므로, 이 순서라야 사용자가 적은 트리거 링크가 기본 URL 링크를
    // 이긴다 (같은 글자에 둘 다 걸리면 사용자의 규칙이 이겨야 한다).
    //
    // 여는 것은 `window.open` 이 아니라 **`openUrl`(plugin-opener)** 이다 — 웹뷰 안에서
    // 열면 터미널 창이 웹 브라우저로 변해 돌아올 길이 없다. 그리고 트리거 링크와 같은
    // 조작이 되도록 **Ctrl(맥은 ⌘)+클릭**에서만 연다.
    //
    // **OSC 8 하이퍼링크의 `linkHandler` 가 이 세 줄을 그대로 베낀다** (위 `new Terminal`
    // 의 `linkHandler`). 한 화면에 두 종류의 링크가 섞이는데 사람은 그것을 구별할 수 없어서,
    // 한쪽만 고치면 "어떤 링크는 Ctrl+클릭이 안 되는" 화면이 된다 — 고칠 때는 둘 다 본다.
    t.loadAddon(
      new WebLinksAddon(
        (ev, uri) => {
          if (!ev.ctrlKey && !ev.metaKey) return;
          void openUrl(uri).catch((e: unknown) => {
            console.error(`[aynx] 링크를 열지 못했습니다: ${uri}`, e);
          });
        },
        {
          // 트리거 링크와 **같은 변수**에 적는다. 한 자리에는 프로바이더 하나만 답하므로
          // (먼저 답한 쪽에서 멈춘다) 둘이 서로의 값을 덮어쓸 일이 없다.
          hover: (_ev, uri) => (hoveredLink = uri),
          leave: () => (hoveredLink = null),
        },
      ),
    );

    // ── 파일 경로 링크 (docs/log/2026-09-27-doc-tile.md "A — 여는 길") ─────────
    //
    // **web-links 뒤에 건다** — 등록 순서가 우선순위라 트리거 · URL 이 경로를 이긴다. 같은 Ctrl+클릭 규칙이고,
    // 여는 것은 브라우저가 아니라 문서 보기 타일이다(위로 올려 보낸다 — 파일인지 확인 · 자리 잡기는 그쪽).
    pathLinks = attachPathLinks(t, pathPlace, (target, line) => onopenpath?.(target, line));

    // ── 검색 애드온 — **`t.open` 뒤에 붙인다** (데코레이션은 렌더러가 서 있어야 생긴다 · `term/search.ts` `attach`) ──
    termSearch.attach(t);

    console.log(`[aynx] xterm 마운트 완료 (${pane.kind}) cols=${t.cols} rows=${t.rows}`);

    if (viewer) {
      // ── 원격 창의 시청자 타일(R2-B) — 집 PC 의 세션에 붙기만 한다(`viewer` 주석). 이관 · 연결 대기 · 첫 열기는 집 PC 의 일이다.
      // 모바일 배치에서 화면에 없는 타일 · 뒤로 간 페이지(R5)는 붙지 않고 떼어 둔 채로 시작한다(보이면 붙는다).
      if (viewerWanted(visible)) void viewerConnect();
      else viewerParked = true;
    } else if (restore) {
      // ── 다른 창에서 넘어온 패널 ────────────────────────────────────────────
      // 이력을 먼저 찍고 그다음에 세션을 이어붙인다. `write` 는 순서를 지키므로
      // 이 순서면 재생된 스크롤백 뒤에 원격의 새 출력이 자연스럽게 이어진다.
      // (재생분은 역압 계산에 넣지 않는다 — 한 번에 들어가고 끝나는 고정량이다.)
      //
      // **마커 되심기는 그 쓰기가 끝난 뒤다** (`write` 의 콜백 — 파서가 실제로 삼킨 시점).
      // 곧바로 부르면 버퍼가 아직 비어 있어 모든 자리가 범위 밖으로 떨어지고, 넘어온 타일은
      // 여전히 "화면에서 밀려난 블록입니다" 만 낸다 (docs/log/2026-09-08-block-history-store.md).
      //
      // **버퍼는 소스 창의 크기로 쓴다** (2026-09-09). 직렬화 문자열은 뜬 그 열 수에서만
      // 원래의 줄바꿈을 재현하므로, 폭이 다른 타일에 그대로 쓰면 xterm 이 그 자리에서
      // 리플로해 줄이 밀린다 — 마커를 심기도 전에 거리가 어긋난다. 그래서 순서가 넷이다:
      // ①원래 크기로 되돌린다 ②버퍼를 쓴다 ③마커를 심는다 ④**그다음에** 이 타일의 진짜
      // 크기로 맞춘다(xterm 의 리플로가 심어 둔 마커를 함께 끌고 간다).
      const markers = restore.markers ?? [];
      const size = restore.size;
      if (size) {
        restoring = true; // ①·② 사이에 끼어드는 refit 을 전부 막는다
        t.resize(size.cols, size.rows);
      }
      const finish = () => {
        // 켠 자리와 짝이다 — 중간에 언마운트돼도 문은 반드시 다시 열린다.
        restoring = false;
        if (!disposed) {
          if (markers.length > 0) shell?.restoreMarkers(markers); // ③
          if (size) refit(); // ④ 여기서 비로소 타일 크기 (fit → session.resize)
        }
        // 세션을 이어붙이는 것도 **크기를 맞춘 뒤**다 — `reattach_output` 에 실리는 cols/rows 는
        // 원본 창의 것이 아니라 이 타일의 것이어야 원격이 처음부터 옳은 크기로 그린다.
        if (restore.sessionId === null) {
          notice(tr("pane.notice.session_left_behind"), "33");
        } else {
          void resumeSession(restore.sessionId, restore.consumed);
        }
      };
      if (restore.buffer !== "") t.write(restore.buffer, finish);
      else finish();
    } else if (startsDeferred) {
      // ── 배치 복원으로 뜬 SSH 타일 ─────────────────────────────────────────
      // 세션을 새로 열지 않는다. 다만 **페이지 리로드 뒤면 이 타일의 세션이 아직 살아 있다**(세션 코어 ②-2 — 리로드는
      // 떨어뜨리기만 한다) — 먼저 붙어 본다(새 접속이 아니라 대기 배너가 필요 없다). 붙을 것이 없으면 예전처럼
      // 배너와 레지스트리 등록만 하고 사람의 요청을 기다린다.
      const waitForConnect = () => {
        deferred = { connecting: false, note: null };
        unconnect = registerConnect(pane.id, () => void connectDeferred());
        notice(tr("pane.notice.restored", { name: paneName(pane, tr) }));
      };
      // 복원 안내·자동 재접속(`bootTabs`)은 이 결과가 확정된 뒤에 센다 — 등록(`waitForConnect`)을 마친 뒤 풀린다.
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
      // 첫 접속은 사용자가 직접 시작한 것이므로 모달을 허용한다 (interactive = true).
      // 로컬이면 먼저 떨어진 세션에 붙어 본다(`startFirst` — 페이지 리로드 뒤). 붙었으면 자동 실행·설정 스크립트를
      // 다시 돌리지 않는다 — 그 셸에서 이미 돌았다.
      const openFirst = () =>
        void startFirst().then((result) => {
          if (disposed) return;
          if (result.ok && result.attached) {
            aiVeil?.close(); // 열기 충돌 뒤 다시 시도한 붙기가 이겼다 — 그 셸에서 이미 돌았다
            return;
          }
          if (!result.ok) aiVeil?.exit();
          if (result.ok) {
            console.log(`[aynx] 세션 열림 (${pane.kind})`);
            // 설정 스크립트가 먼저다 — 로컬은 여기서 한 줄을 친다(에이전트는 끝 신호가 성공이면). 원격은 첫 입력에
            // 이미 실렸다.
            if (pane.kind === "local" && setupReq) {
              void runSetup(true);
              return;
            }
            // AI 패널 자동 실행 (6단계). **로컬 셸의 첫 접속에서만** 한 번 — restore 경로는
            // 여기 오지 않고(resumeSession 을 탄다), 재연결도 이 .then 을 다시 돌지 않는다.
            if (pane.kind === "local" && pane.autorun) {
              // claude 면 Rust 가 상태줄 도우미를 건 `--settings` 를 붙인다(요금제 한도 % — docs/log/2026-09-26-agent-usage.md).
              // 어떤 실패든 받은 명령 그대로 온다. 그 사이 세션이 바뀌었으면(재연결·닫힘) 쓰지 않는다.
              const opened = session;
              const cmd = pane.autorun;
              void agentAutorunCommand(cmd, opened?.resolvedShell ?? null, pane.cwd ?? null, pane.injectMcpToken === true, pane.historyStreamId ?? null).then((line) => {
                if (disposed || session !== opened || !opened) return;
                // 재개 명령이면 그 대화가 이 타일에 다시 열린다 — 페이지가 다시 떠 복원된 타일도 첫 신호 전에
                // "열림"(docs/log/2026-09-26-agent-sessions.md "연결의 수명 = 세션"). 세션 서버 장부에도 알린 **뒤에** 쓴다 —
                // 그 명령의 OSC 133 `C`(창이 서버에 보내는 지우기)가 그 알림보다 먼저 닿지 않게(서버는 그 첫 `C` 에 지우지 않는다 ·
                // docs/log/2026-10-24-convo-rename.md "띄우며 적은 연결"). 알림은 실패해도 풀린다.
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
          // SSH 명령 미등록·인증 실패·호스트 키 변경·TOFU 거부 등.
          //
          // **자동 재연결은 여전히 돌리지 않는다** — 붙은 적이 없으니 되돌릴 상태가 없고,
          // 인증 실패에 백오프로 계속 두드리면 서버의 시도 한도만 태운다. 대신 **종료됨
          // 상태로 넘긴다**: 그래야 Enter(다시 시도)·Ctrl+D(닫기)가 살아나고 배너가 실패
          // 사유를 들고 남는다. 예전에는 이 줄이 안내 한 줄만 찍어서, 접속에 실패한 SSH
          // 타일이 키보드로는 손댈 수 없는 죽은 화면으로 남았다.
          const message = describeOpenError(result.error, tr);
          const hint = openErrorHintOf(result.error, tr);
          notice(hint ? `${message}\n${hint}` : message, "91");
          // `onexit` 은 부르지 않는다 — 그 신호의 뜻은 "세션이 끝났다" 인데 여기서는
          // 시작된 적이 없다 (지금 상위는 무시하지만, 뜻이 어긋난 신호를 보내지 않는다).
          ended = { connecting: false, note: message, hint, unopened: true };
        });

      if (openDelay > 0) {
        // 그룹 전체 열기의 계단식 시작 — 기다리는 동안 패널은 이미 떠 있고 화면만 비어 있다.
        // 그 사이에 사용자가 이 패널을 닫으면(`disposed`) 세션을 아예 열지 않는다.
        openTimer = setTimeout(() => {
          openTimer = undefined;
          if (!disposed) openFirst();
        }, openDelay);
      } else {
        openFirst();
      }
    }

    // 남긴 강조는 **첫 키 입력**에 사라진다 (`stepKept` 의 `input`). `sendInput` 안에 끼워
    // 넣지 않고 핸들러를 하나 더 다는 이유: `sendInput` 은 붙여넣기 확인·브래킷 감싸기·동시
    // 입력 분배가 얽힌 자리라 조기 반환이 여럿이고, 그 어느 갈래로 빠지든 "사용자가 뭔가를
    // 쳤다" 는 사실은 똑같다. 별도 구독이면 그 갈래들과 무관하게 언제나 정확히 한 번 돈다.
    t.onData(() => termSearch.keptEvent("input"));
    t.onData(sendInput);

    // ── 입력 중 스니펫 제안 (docs/log/2026-09-16-snippets.md) ─────────────────
    //
    // **`onData` 가 아니라 `onWriteParsed`** 에 단다: 우리가 읽는 것은 키가 아니라 셸이
    // 메아리친 **버퍼**라, 키를 친 그 순간에 읽으면 방금 친 글자가 아직 화면에 없다.
    // 파서가 한 덩어리를 삼킬 때마다 불리므로 대량 출력에서는 잦은데, 디바운스 한 겹이
    // 그것을 한 번으로 접는다(그 사이 입력 모드가 아니면 첫 줄에서 곧바로 돌아온다).
    t.onWriteParsed(suggest.scheduleSuggest);

    // IME 조합 중에는 화면의 글자가 **아직 확정이 아니다** — 조합을 시작하면 접고, 끝나면 그때의 화면으로
    // 다시 센다 (몸통은 `term/snippet-suggest.svelte.ts` 의 `onComposition*`).
    const { onCompositionStart, onCompositionEnd } = suggest;
    const textarea = t.textarea ?? null;
    textarea?.addEventListener("compositionstart", onCompositionStart);
    textarea?.addEventListener("compositionend", onCompositionEnd);

    // -----------------------------------------------------------------------
    // 우클릭·선택 자동 복사·붙여넣기 가로채기
    // (docs/log/2026-09-05-terminal-context-menu.md)
    // -----------------------------------------------------------------------

    // 선택이 바뀌었다는 표시만 세우고, 실제 복사는 버튼을 뗄 때 한 번 한다 —
    // 이 콜백은 드래그하는 내내 불린다 (`term/clipboard-controller` 의 `selectionDirty` 주석).
    t.onSelectionChange(() => {
      if (settings.rightClick !== "paste") return;
      if (t.getSelection() === "") return;
      clip.markSelectionDirty();
    });

    /**
     * 우클릭 — 설정 `[terminal] right_click` 이 뜻을 정하고, **Shift 는 언제나 반대쪽**이다.
     * 어느 쪽이든 `preventDefault` 는 한다: 웹뷰의 기본 메뉴("다시 로드"·"검사")가 뜨면
     * 이 앱에서 할 수 있는 일이 하나도 없는 목록이 터미널 위에 선다.
     */
    /** 그 자리에 타일 메뉴를 연다(우클릭 · 길게 누르기) */
    const openMenuAt = (x: number, y: number) => {
      // 메뉴가 열리면 커서는 곧 메뉴 위로 가므로 지금 값을 붙든다.
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

    // ── 터치(원격 웹 R5 — 폰 · 태블릿): 세로 끌기 = 스크롤백 · 길게 누르기 = 타일 메뉴(`term/touch-gestures`) ──
    const touch = new TouchGestures({
      rowHeight: () => (t.element && t.rows > 0 ? (t.element.querySelector(".xterm-screen")?.clientHeight ?? 0) / t.rows : 0),
      // 스크롤백이 없는 화면(alt — Claude Code 풀스크린 · tmux · vim) · 마우스 추적 프로그램은 휠 사건으로 — 데스크톱 휠과 같은 길(`wheelLines`)
      scrollLines: (n, x, y) => {
        if (t.element && (t.buffer.active.type !== "normal" || t.modes.mouseTrackingMode !== "none")) wheelLines(t.element, n, x, y);
        else t.scrollLines(n);
      },
      longPress: (x, y) => openMenuAt(x, y),
    });

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 방금 길게 누르기로 메뉴를 열었다(Android 는 그 뒤 `contextmenu` 도 낸다) — 두 번 열지 않는다.
      if (touch.justLongPressed()) return;
      // 폰 · 터치 기기(R5)의 길게 누르기는 늘 메뉴다(복사 · 붙여넣기 · 모두 선택) — 붙여넣기 설정이어도 손가락이 실수로 붙여넣지 않게.
      const wantsMenu = handheld() || (settings.rightClick === "menu" ? !ev.shiftKey : ev.shiftKey);
      if (!wantsMenu) {
        void clip.pasteFromClipboard();
        return;
      }
      openMenuAt(ev.clientX, ev.clientY);
    };

    /**
     * **키보드 붙여넣기도 같은 통로로** (`Ctrl+Shift+V`·`Shift+Insert`·가운데 클릭).
     *
     * 그 조합들은 앱이 아니라 웹뷰가 처리해 xterm 의 textarea 에 `paste` 이벤트로 도착한다.
     * 그래서 **캡처 단계**에서 가로챈다 — 타깃(textarea)의 xterm 핸들러보다 먼저 돌아야
     * 확인 모달이 낄 자리가 생긴다. 확인이 필요 없는 붙여넣기는 손대지 않고 흘려보내
     * xterm 이 원래대로 처리한다 (브래킷 붙여넣기 포함).
     */
    const onPasteEvent = (ev: ClipboardEvent) => {
      if (!settings.confirmMultilinePaste) return;
      const text = ev.clipboardData?.getData("text") ?? "";
      if (!/[\r\n]/.test(text)) return;
      ev.preventDefault();
      ev.stopPropagation();
      clip.requestPaste(text);
    };

    /**
     * **링크 위 Ctrl(⌘)+클릭은 이 앱이 연다 — 마우스를 추적하는 프로그램에 넘기지 않는다.**
     *
     * Claude Code 풀스크린처럼 마우스 추적을 켠 TUI 는 클릭한 OSC 8 링크를 **스스로** 연다. 그런데 xterm 은 그 상태에서도
     * 링크 프로바이더를 깨우고 같은 클릭을 pty 로 보낸다 → 클릭 한 번에 브라우저 탭 둘. 링크 판정은 xterm 의
     * `.xterm-screen` mousedown(링크파이어)이 먼저 끝내고, pty 로 보내는 것은 바깥 `.xterm` 의 mousedown 이라 그 사이에서
     * 버블을 끊는다. 떼기(mouseup)는 보낸 누르기가 있을 때만 문서에 걸리므로 누르기 하나만 막으면 된다.
     * 링크 판정은 링크파이어가 호버 중인 링크에만 다는 `xterm-cursor-pointer`(트리거의 href 없는 줄은 달지 않는다).
     */
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
    // 원격 창에서만(집 PC 터치 화면의 동작은 예전 그대로 — 웹뷰의 길게 누르기 = `contextmenu`)
    const untouch = viewer ? attachTouchGestures(root, touch) : () => {};
    // 폰의 화면 키보드(안드로이드 삼성 키보드 등)는 textarea 를 제자리에서 고친다 — 차분만 보낸다(`term/handheld-input` 머리말).
    // 판정은 여는 순간 한 번(원격 · 폰 취급). 집 PC 창 · 데스크톱 원격 창은 xterm 조합 도우미 그대로.
    const unHandheld = (viewer && handheld() ? attachHandheldInput(t, container) : null) ?? (() => {});
    // 폰의 입력 칸 방식(10-20 · `app/mobile` 의 `lineFieldMode`)에서는 xterm 의 textarea 가 포커스를 쥐지 않는다 — 터미널을 누르거나
    // 활성화가 `t.focus()` 를 불러도 띠의 입력 칸으로 넘긴다(화면 키보드는 그 칸에 뜬다). 끌기 스크롤 · 길게 누르기 메뉴 · 마우스 추적
    // 프로그램의 누르기는 그대로다(포커스만 옮긴다). 바로 입력 방식이거나 칸이 없으면 손대지 않는다.
    const onFocusIn = (ev: FocusEvent) => {
      if (ev.target !== t.textarea || !lineFieldMode()) return;
      // 대화 면이면 이 터미널은 밀려 나 있다 — 띠의 칸으로 넘기면 키보드만 올라온다(`pane/AiFlip` 의 `onTermFocusIn` 이 놓는다)
      if (flipViewOf(pane.id) === "convo") return;
      focusLineField();
    };
    if (viewer) container.addEventListener("focusin", onFocusIn, true);
    container.addEventListener("paste", onPasteEvent, true);
    // 입력 출처의 문맥(오케스트레이션 5단계) — 키 · 붙여넣기 이벤트가 도는 동안(그 처리기 안에서 xterm 이 동기로 내는 `onData`)은
    // 사람 입력이다. 처리기가 끝나면(마이크로태스크) 내린다.
    const markKey = () => {
      inputKeyEvent = true;
      queueMicrotask(() => (inputKeyEvent = false));
    };
    const markPaste = () => {
      inputPasting = true;
      queueMicrotask(() => (inputPasting = false));
    };
    container.addEventListener("keydown", markKey, true);
    container.addEventListener("paste", markPaste, true);
    // 로딩 덮개 — 사람이 그 타일에 키를 누르면(수식 키만은 빼고) · 붙여 넣으면 걷는다. `onData` 가 아닌 이유: CLI 의 터미널
    // 질의에 xterm 이 내는 응답도 `onData` 로 나온다.
    const veilKey = (ev: KeyboardEvent) => {
      if (aiVeil && !["Shift", "Control", "Alt", "Meta"].includes(ev.key)) aiVeil.input();
    };
    const veilPaste = () => aiVeil?.input();
    container.addEventListener("keydown", veilKey, true);
    container.addEventListener("paste", veilPaste, true);
    // 버튼을 어디서 떼든 받아야 한다 — 터미널 밖까지 끌고 나가 놓는 선택이 흔하다.
    // `pointerup` 이 아니라 **창의 `mouseup`(버블)** 이다: xterm 은 드래그 선택의 변경을 문서 `mouseup` 에서야 알린다
    // (`SelectionService._handleMouseUp` → `_fireEventIfSelectionChanged`). `pointerup` 은 그보다 먼저 와서 놓는 순간에는
    // 표시가 아직 없었고, 복사가 다음 클릭으로 밀렸다(2026-10-27 사용자 실기). 같은 `mouseup` 이 문서(xterm) → 창 순서로 버블하니
    // 창에서 받으면 xterm 이 표시를 세운 바로 뒤다.
    window.addEventListener("mouseup", clip.flushSelectionCopy);

    // -----------------------------------------------------------------------
    // 크기 변화 → refit 은 **뒷자락 디바운스**로 (docs/log/2026-09-04-tile-layout-anim.md).
    //
    // `refit()` 한 번은 `fit.fit()` + `session.resize()` 다. 즉 이 콜백이 프레임마다 돌면
    // 원격으로 SIGWINCH 가 프레임마다 나가고, 그 사이 셸·TUI 는 매번 화면을 다시 그린다.
    // 상자가 **연속으로** 변하는 자리가 셋이다: 타일 배치 트랜지션(200ms), 분할선 드래그,
    // 창 리사이즈. 셋 다 "가는 동안" 의 크기는 아무도 쓰지 않고 **도착한 크기**만 뜻이 있다.
    //
    // 그래서 크기가 멎고 나서 한 번만 맞춘다. 80ms 는 사람이 지연으로 느끼기에는 짧고
    // (한 프레임이 16ms 다) 연속 변화를 한 번으로 뭉치기에는 충분하다 — 200ms 트랜지션이
    // 내던 열두어 번의 원격 resize 가 1회가 된다.
    //
    // 탭이 다시 보일 때의 rAF refit(위 `$effect`)은 그대로 둔다 — 그쪽은 단발이고, 첫 그림이
    // 어긋난 채로 80ms 를 버티면 그게 바로 눈에 띈다.
    // -----------------------------------------------------------------------
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
      clearTimeout(viewerRetryTimer); // 시청자의 다시 붙기 대기도
      clearTimeout(viewerParkTimer); // 시청 떼어 두기 대기도(R5)
      unregister(); // 동시 입력 레지스트리에서 뺀다 (죽은 패널로 입력이 가지 않게)
      unconnect?.(); // 연결 레지스트리에서도 (모두 재연결이 사라진 타일을 두드리지 않게)
      unconnect = null;
      unserialize(); // 이관 레지스트리에서도 뺀다
      mouseEnc.dispose();
      uncommands(); // 명령 레지스트리에서도 (헤더 ⧉ 가 죽은 패널을 두드리지 않게)
      untermactions(); // 터미널 조작 레지스트리에서도 (열려 있던 메뉴가 유령을 두드리지 않게)
      unsearch(); // 검색 레지스트리에서도 (오버레이가 사라진 버퍼를 훑지 않게)
      forgetReportedCwd(pane.id); // 셸이 알려 준 폴더의 반응형 사본도 (이 폴더의 지난 대화)
      screenEl?.removeEventListener("mousedown", onLinkMouseDown);
      root.removeEventListener("contextmenu", onContextMenu);
      untouch();
      unHandheld();
      container.removeEventListener("focusin", onFocusIn, true);
      container.removeEventListener("paste", onPasteEvent, true);
      container.removeEventListener("keydown", markKey, true);
      container.removeEventListener("paste", markPaste, true);
      container.removeEventListener("keydown", veilKey, true);
      container.removeEventListener("paste", veilPaste, true);
      aiVeil?.close(); // 로딩 덮개의 시계 · 훅 귀도
      window.removeEventListener("mouseup", clip.flushSelectionCopy);
      textarea?.removeEventListener("compositionstart", onCompositionStart);
      textarea?.removeEventListener("compositionend", onCompositionEnd);
      suggest.teardown(); // 예약된 제안 계산을 끊고 상자·접은 글자·조합·입력 문을 비운다
      clip.dropPrompt(); // 확인 대기 중이던 붙여넣기는 대상과 함께 사라진다
      clearTimers(); // 예약된 재연결·카운트다운을 여기서 끊는다
      clearTimeout(openTimer); // 아직 시작 전인 계단식 첫 접속도 (열지 않고 끝낸다)
      cancelScreenPush(); // 간이 모드 거울 타이머도
      // 원격 새 워크트리 준비가 도는 중이었다 — 멈춤을 보낸다(첫 커밋 질문의 대기가 풀리고 접속이 자리를 내놓는다).
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
      // 데코레이션·OSC 핸들러를 먼저 떼고 나서 터미널을 dispose 한다.
      shell?.dispose();
      shell = null;
      osc52.dispose(); // 셸 통합과 달리 **늘** 걸려 있으므로 조건 없이 뗀다
      programNotify.dispose(); // 프로그램 알림도 같은 이유로 (9 → 777 순서로 뗀다)
      oscSetup.dispose();
      replayMute.dispose();
      clearInterval(checkpointTimer);
      clearTimeout(checkpointFirst);
      endReplay();

      triggers?.dispose();
      triggers = null;
      pathLinks?.dispose();
      pathLinks = null;
      // 검색도 같은 이유로 터미널보다 먼저 놓는다 (데코레이션·이벤트 구독을 들고 있다).
      termSearch.dispose();
      // 합자 애드온을 WebGL 보다 먼저 뗀다 (조이너가 렌더러에 걸려 있다).
      addons.unloadLigatures();
      // 이미지 애드온도 렌더러의 `setRenderer` 를 가로채고 있다 — WebGL 보다 먼저 되돌린다.
      addons.unloadImages();
      // WebGL 컨텍스트도 터미널보다 먼저 놓아 준다 (상한이 16개뿐이다).
      addons.unloadWebgl();
      // 이 패널의 상태 표시도 거둔다 — 남겨 두면 사라진 패널의 배지가 탭에 남는다.
      onstatus?.(pane.id, null);
      oncommand?.(pane.id, null); // 도는 명령 표시도 같은 이유로 (`clearPaneTitle` 과 겹쳐도 무해)
      // AI 컨텍스트 저장소에서도 이 패널을 지운다 (공유 여부와 무관하게 항상). 이관이든
      // 닫힘이든 이 창의 터미널은 사라지므로 서버가 들고 있을 이유가 없다.
      // 시청자는 거울에 올린 적이 없다 — 지우면 그 스트림의 집 PC 거울(같은 열쇠)을 지운다.
      if (!viewer) void dropSession(contextKeyOf);
      dropShared(pane.id);
      // 블록 이력도 여기서 버린다. **이관이어도 안전하다** — 페이로드는 `dragstart` 시점에
      // 이미 떠 있었고(`buildTear` 가 그때 사본을 뜬다) 새 창은 그 사본을 심는다. 남겨 두면
      // 다시 열리지 않을 타일 id 아래에 발췌가 영영 쌓인다.
      dropHistory(pane.id);
      // 벨의 번쩍임·탭 표식·타이머도 함께 버린다 — 남겨 두면 사라진 타일의 종이 탭에 남는다.
      dropBell(pane.id);
      // 에이전트 상태 점의 신호도 같은 이유로 버린다.
      dropAgent(pane.id);
      ro.disconnect();
      resumeRefit = null;
      refitSkipped = false;
      clearTimeout(refitTimer); // 예약된 refit 이 죽은 세션에 resize 를 쏘지 않게
      // **창 이관 중이면 세션을 죽이지 않는다** (docs/log/2026-09-02-tear-out.md).
      // 이 언마운트는 "탭이 닫혔다" 가 아니라 "탭이 저 창으로 갔다" 는 뜻이고, 세션은
      // 새 창이 `reattach_output` 으로 이어받는다. 구독 해제·dispose 는 그대로 한다 —
      // 살아 있어야 하는 것은 **백엔드 세션**뿐이지 이 창의 물건들이 아니다.
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
  <!--
    xterm 은 **패딩 없는** 내부 요소에 마운트한다. FitAddon 은 마운트 요소의 clientWidth/Height
    로 cols/rows 를 계산하는데(패딩 포함), 마운트 요소에 직접 패딩을 주면 그만큼 과다 계산해
    마지막 줄이 잘린다. 그래서 여백은 바깥 `.term` 이 주고, 이 `.term-screen` 은 그 안쪽 상자를
    100% 채우기만 한다 (ResizeObserver 도 이 요소를 본다 → 여백 변화에도 정확히 refit).
  -->
  <div class="term-screen" class:foreign={!sizeOwner && ownerSize !== null} bind:this={container}></div>
  {#if blockView}
    <!-- 블록 리치 보기 카드 — 터미널 위에 얹힌다(터미널은 그대로 붙어 출력을 받는다 · `term/BlockView.svelte`) -->
    {#key blockView.blockId}
      <BlockView
        open={blockView}
        originNow={() => (blockView ? blockOriginNow(blockView.blockId) : null)}
        onclose={closeBlockView}
      />
    {/key}
  {/if}
  <!--
    크기 주인이 아니다(원격 웹 R2-B · 안내 10-20 — 목업 B) — 다른 창 · 원격 기기가 마지막으로 쳐서 그 크기로 그리고 있다. 그려진 영역에 점선
    테두리 + 위 가장자리 꼬리표(늘), 포커스 타일만 빈 자리에 카드(자리가 모자라면 꼬리표를 눌러 같은 단추). 테두리는 마우스를 받지 않는다
    (선택은 그대로 터미널로) — 받는 것은 꼬리표 · 카드 · 상자뿐이다. 폰 배치(`mobileLayout`)에는 띄우지 않는다 — 위 띠의 ⤢(`mobile/MobileBar`).
  -->
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
    />
  {/if}
  <!--
    입력 중 스니펫 제안 (docs/log/2026-09-16-snippets.md). **커서 옆**에 뜨는 작은 목록이라
    좌표가 있어야 서고, 그 좌표는 `term/snippet-suggest.svelte.ts` 가 셀 기하로 잰다. 배너들과 같은
    `absolute` 층이지만 화면을 밀지 않는 것은 물론이고 **쓸 것이 없으면 아예 없다**.
  -->
  {#if suggest.suggestBox && suggest.suggestItems.length > 0}
    <SnippetSuggest
      items={suggest.suggestItems}
      sel={suggest.suggestSel}
      left={suggest.suggestBox.left}
      top={suggest.suggestBox.top}
      onpick={suggest.pickSuggest}
    />
  {/if}

  <!-- 로컬 AI 타일 로딩 덮개 — 마운트에서 타일 틀로 옮겨 머리줄까지 덮는다(위 "로컬 AI 타일 로딩 덮개") -->
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

  <!--
    위쪽 막대들 — 재연결 · 복원(연결 대기) · 설정 스크립트 실패 · 원격 새 워크트리 · 종료됨 (`term/Banners.svelte`).
    감싸개 없이 조각으로 그린다(`.term` 이 기준 상자). 닫기 단추가 비우는 셋은 `bind:` 로 이 파일의 상태를 쓴다.
  -->
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

  <!--
    출력 복사 안내 — 오른쪽 아래에 **겹쳐** 잠깐 떴다 사라진다. 버퍼에 찍지 않는 이유는
    스크롤백을 더럽히지 않기 위해서다 (그 줄들이 다음 명령의 출력 구간에 끼어든다).
  -->
  {#if toast}
    <div class="toast glass-raised" class:ok={toast.ok} role="status">{toast.text}</div>
  {/if}

  <!--
    여러 줄 붙여넣기 확인 (docs/log/2026-09-05-terminal-context-menu.md).

    **타일 안에 갇힌 오버레이**다 (`TransferPanel` 의 충돌 확인과 같은 처방) — 타일이 여럿이면
    각자 자기 것만 묻고, 뒤에 깔린 다른 터미널은 그대로 쓸 수 있다. 창 단위 모달로 올리면
    "어느 타일에 붙여넣는 건가" 가 화면에서 사라진다.

    글은 **전부 · 고칠 수 있는 칸**이다(10-25 사용자 — 예전에는 첫 세 줄 미리보기였다). 포커스는 그대로 [붙여넣기] 에 서서 Enter 한 번이면 예전처럼
    붙고, 칸을 눌러 고친 뒤 `Ctrl+Enter` 나 [붙여넣기] 로 붙인다. 제목의 줄 수는 고친 글을 따라간다.
  -->
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
    position: relative; /* 재연결 배너의 기준 상자 */
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--term-pad); /* kitty 감각 안쪽 여백 — 아래 .term-screen 이 그 안을 채운다 */
    /*
     * **배경을 칠하지 않는다.** 터미널 칸의 색은 한 층에서만 나온다 — 타일 배경판
     * (`.pane-box` 의 `--term-bg-fill`, PaneHost.svelte). 여기서 `--term-bg` 를 한 번 더
     * 칠하면 그 판이 아무리 반투명해도 이 불투명한 면이 위를 덮어 뒤가 전혀 안 비친다
     * (실기에서 "터미널 투명도를 내려도 월페이퍼가 안 보인다" 의 첫 번째 원인이었다).
     * 여백도 배경판 색을 그대로 받으므로 예전과 같은 모양이다 — 투명도 100 이면
     * `--term-bg-fill` 이 `--term-bg` 와 같은 값이라 픽셀 하나 다르지 않다.
     */
    background: none;
  }

  /* xterm 마운트 전용 — 패딩 없이 .term 안쪽 상자를 채운다 (FitAddon 정확도) */
  .term-screen {
    width: 100%;
    height: 100%;
  }
  /* 다른 창의 크기로 그리는 중(R2-B) — 상자보다 크면 스크롤, 작으면 남는 칸은 여백 */
  .term-screen.foreign {
    overflow: auto;
  }

  /* 복사 안내 토스트 — 레이아웃을 밀지 않는다 (fit 이 흔들리면 원격 resize 가 돈다) */
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
    /* 앱 토스트(`Toasts.svelte`)와 같은 중 층 면(10-29): 평면은 불투명(`--surface-raised-solid` — 밑의 터미널 글자가 비치지
       않게), 글래스는 `--glass-float` 판 + `.glass-raised` 의 흐림 · 흰 선(theme.css 재질 절) */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-modal);
    pointer-events: none;
  }

  .toast.ok {
    border-color: var(--ok);
  }
  /* 글래스의 흰 선(공용 `body .glass-raised`)보다 한 단 세게 — 성공의 초록 선은 재질과 무관하게 남는다 */
  :global(:root[data-material="glass"]) .toast.ok {
    border-color: var(--ok);
  }

  /*
    OSC 133 명령 상태 띠 — 블록 시각화 (docs/log/2026-09-02-osc133.md).

    데코레이션 원소는 xterm 이 자기 DOM 안에 만들어 붙이므로 **컴포넌트 스코프 밖**이다 —
    `:global` 이 필수다. 클래스 이름에 접두사를 두는 것도 같은 이유(전역 이름공간)다.

    **모든 명령의 프롬프트 줄** 왼쪽 거터에 세로 색 띠가 선다 (iTerm2·VS Code 방식):
    실행 중 파랑(`--accent`) · 성공 회색(`--fg-muted`, 은은) · 실패 빨강(`--err`).
    명령마다 띠가 서므로 명령 경계가 눈으로 읽힌다 = 2계층 블록의 시각적 절반.
  */

  /*
    명령 상태 띠 — 프롬프트 줄 **맨 왼쪽 가장자리**의 세로 색선 (블록 시각화).

    두 가지가 실기에서 걸렸다:
    ①xterm 은 데코 요소 폭을 셀 한 칸(~9px)으로 **인라인 스타일**로 박으므로, CSS `width`
     로는 못 줄인다 → `!important` 로 3px 로 덮는다. ②요소를 왼쪽으로 당기면(translateX 음수)
     x<0 이 되어 터미널의 `overflow:hidden` 에 **통째로 잘려 사라진다** → 당기지 않고 첫 칸
     왼쪽 끝(x:0)에 그대로 둔다. 3px 라 프롬프트 첫 글자와 거의 안 겹친다.
    색은 요소 **배경**으로 준다 (border/::before 보다 확실하다 — 높이는 xterm 인라인이 보장).
  */
  :global(.aynx-cmd-band) {
    width: 3px !important;
    background: var(--fg-muted); /* 기본값 — 아래 상태 클래스가 덮는다 */
    pointer-events: none;
  }

  :global(.aynx-cmd-running) {
    background: var(--accent);
  }
  :global(.aynx-cmd-ok) {
    background: var(--fg-muted); /* 성공은 은은하게 — 있으나 눈을 끌지 않는다 */
    opacity: 0.55;
  }
  :global(.aynx-cmd-fail) {
    background: var(--err);
    /* 실패의 띠만 포인터를 받는다 — 종료 코드 말풍선이 여기 걸린다 (`.aynx-fail-row` 참고).
       커서는 물려받은 `text` 그대로 둔다 — 글자 위라 모양이 바뀌면 안 눌리는 것처럼 보인다 */
    pointer-events: auto;
  }

  /*
    명령 실행 시간 표식 — 블록이 끝난 줄의 **오른쪽 끝**
    (docs/log/2026-09-16-finish-notify-block-marks-bell.md).

    거터의 색 띠가 "어떻게 끝났나" 를 색으로 말한다면, 이쪽은 **얼마나 걸렸나**만 숫자로
    말한다 (`12.4초`). 성패는 여기서도 **색**이다(실패는 붉은 시간) — 낱말로 또 적으면 한
    사실을 한 줄에서 세 번 말하게 된다(붉은 띠 · 붉은 줄 배경 · `실패`). 종료 코드는
    말풍선 안에만 있다. `mark_after_secs` 미만으로 끝난 명령에는 성패와 무관하게 아무것도
    안 붙으므로(`blockOutcomeLabel`) 짧은 명령이 늘어선 화면은 지금까지와 똑같이 비어 있다.

    ①`justify-content: flex-end` — 데코 상자는 칸 수로 잡은 근삿값이라 글자가 그보다 좁다.
     오른쪽에 붙여야 터미널 가장자리에 줄이 맞는다.
    ②`font-size: 0.82em` — 출력보다 한 단 작게. 읽으려고 보면 읽히되 출력의 글줄을 방해하지
     않는 크기다. 셀 격자에 맞출 필요가 없다(글자를 다시 찍는 트리거 표시와 다른 점이다).
    ③`user-select: none` — 드래그 선택이 이 요소를 지나도 글자가 딸려 가지 않는다. 터미널
     본문의 복사는 `.xterm` 버퍼에서 오므로 원래도 섞이지 않지만, 마우스로 훑을 때 파란
     선택 박스가 뜨는 것까지 막는다.
    ④`pointer-events: auto` — 말풍선(`title`)을 띄우려면 포인터를 받아야 한다. 이 한 토막은
     **네이티브 말풍선**이다: 앱 툴팁 층이 `.xterm` 안쪽을 일부러 비켜 간다
     (docs/log/2026-09-16-themed-tooltips.md).
  */
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

  /* 실패는 거터 띠와 **같은 색으로** 말한다 — 한 사건을 두 자리에서 다른 색으로 말하지 않는다 */
  :global(.aynx-block-mark-fail) {
    color: var(--err);
    opacity: 0.95;
  }

  /*
    실패한 프롬프트 줄 배경의 **미세한** 강조 (띠에 더해). 글자를 읽는 데 방해가 되면 안
    되므로 거의 안 보일 만큼 옅다 — 눈에 띄는 일은 빨간 띠가 한다.

    **반투명이 필수다.** WebGL 렌더러에서 글자는 캔버스 안에 있고 이 데코레이션 DOM 은
    그 위에 얹힌다 — 불투명 배경이면 그 줄의 명령 텍스트를 통째로 덮어 "빨간 줄이 명령을
    가리는" 증상이 된다 (실기 발견). rgba 로 깔아 글자가 비쳐 보이게 한다
    (표시 트리거의 BG_ALPHA 와 같은 근거).

    **포인터를 받는다** — 종료 코드 말풍선(`blockMarkTitle`)이 이 줄에 걸리기 때문이다.
    표식(`.aynx-block-mark`)은 임계를 넘긴 명령에만 서므로, 말풍선이 거기에만 있으면 0.2초
    만에 죽은 명령의 코드를 볼 길이 없다. 줄 전체가 과녁이라 3px 거터보다 맞히기 쉽다.
    선택·클릭은 그대로 아래 글자에 간다 — 이 원소는 `.xterm-screen` 의 자손이라 이벤트가
    버블해 xterm 의 선택 처리에 그대로 닿고, 좌표는 대상이 아니라 포인터가 정한다.
    `user-select: none` 은 `.aynx-block-mark` 과 같은 이유(드래그가 지날 때 파란 상자).
  */
  :global(.aynx-fail-row) {
    background: rgba(247, 118, 142, 0.14); /* --err(#f7768e) 저알파 — 글자를 안 덮는다 */
    pointer-events: auto;
    user-select: none;
  }

  /*
    실패 줄의 **[AI에게 묻기]** (docs/log/2026-09-28-ask-ai-block.md) — `shell-integration.ts` 가 실패 줄 배경
    (`.aynx-fail-row`) 안에 심는 단추. 손을 올린 줄에만 뜨고(`display` 가 `:hover` 로만 선다), 그 줄은 옅은 붉은
    테두리로 "이 줄이다" 를 말한다. 줄 오른쪽 끝에 서므로 같은 줄의 시간 표식은 그동안 가린다
    (`.aynx-block-mark-hidden` — 스크립트가 붙인다). 글자는 셀 격자가 아니라 앱의 UI 글꼴이다 — 터미널 글자처럼
    보이면 출력의 일부로 읽힌다. 강조색은 쓰지 않는다(누를 곳이지 골라진 것이 아니다).
  */
  :global(.aynx-fail-row:hover) {
    outline: 1px solid rgba(247, 118, 142, 0.35);
    outline-offset: -1px;
  }
  /*
    줄 오른쪽 끝의 단추 묶음(10-18) — [리치하게 보기] · [AI에게 묻기] 가 나란히 선다. 손을 올린 줄에만 보인다.
  */
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
  /*
    성공 블록의 줄 데코(10-18 — [리치하게 보기] 를 얹을 자리) — 배경 없이 투명, 손을 올리면 옅은 선만. 실패 줄과 같은 결로
    포인터를 받는다(그래야 손을 올린 줄을 안다).
  */
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

  /*
    블록 띠 — `#` 검색이 점프한 **블록 전체**(프롬프트 줄 ~ 마지막 출력 줄)의 강조
    (docs/log/2026-09-08-block-search.md 의 "블록 띠 강조").

    매치된 글자만 색칠하면 그 블록이 어디서 시작해 어디서 끝나는지가 안 읽힌다 — 거터의
    상태 띠는 프롬프트 한 줄에만 서기 때문이다. 그래서 데코 **하나**로 블록 높이만큼의
    상자를 깔고, 왼쪽 가장자리에 세로선을 세운다.

    `.aynx-fail-row` 와 같은 WebGL 원칙: 배경은 글자 위(캔버스 밖 DOM)라 **반투명이 필수**다.
    `--accent` 는 월페이퍼 추출 테마가 갈아 끼우는 토큰이라 하드코딩하지 않고 `color-mix`
    로 알파만 입힌다. 세로선의 폭이 상자 밖으로 새지 않게 `border-box` 로 잡는다 (xterm 이
    폭·높이를 인라인 스타일로 박는다).
  */
  :global(.aynx-block-band) {
    pointer-events: none; /* 선택·클릭은 그대로 아래 글자에 간다 */
    box-sizing: border-box;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-left: 2px solid var(--accent);
  }

  /*
    점프 착지 반짝임 (docs/log/2026-09-02-osc133.md).

    명령 점프는 **스크롤만** 하고 포커스는 옮기지 않는다 (입력은 여전히 현재 프롬프트). 그래서
    착지한 줄을 0.6초 노랗게 반짝여 "여기로 왔다" 를 눈에 보이게 한다. 배경은 명령 텍스트
    **위**에 얹히므로 반투명이다 (`.aynx-fail-row` 와 같은 WebGL 원칙). 데코 자체는 1회성이라
    JS 가 0.6초 뒤 dispose 하지만, fade out 은 여기 애니메이션이 그린다.
  */
  :global(.aynx-jump-flash) {
    pointer-events: none;
    background: rgba(224, 175, 104, 0.35); /* --warn(#e0af68) — 글자가 비친다 */
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

  /*
    표시 트리거 (docs/log/2026-09-02-triggers-webgl-logging.md).

    색 자체는 인라인으로 들어온다 (사용자가 정한 임의의 CSS 색이라 토큰이 될 수 없다) —
    여기서는 위치·글꼴만 잡는다. `:global` 이 필요한 이유는 실패 표시와 같다.
  */

  /* 배경만 칠하는 경우 — 글자 아래(bottom 층)에 깔린다 */
  :global(.aynx-trigger-bg) {
    pointer-events: none;
  }

  /*
    글자색까지 바꾸는 경우 — 원래 글자 위(top 층)에 같은 글자를 다시 찍는다.
    셀 격자에 맞아떨어져야 하므로 자간·줄바꿈을 강제하고, 넘치는 부분은 잘라 낸다
    (넓은 글자 반올림으로 1px 이 삐져나와도 옆 칸을 덮지 않게).
  */
  :global(.aynx-trigger-text) {
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: pre;
    letter-spacing: 0;
    pointer-events: none;
    user-select: none;
  }

  /*
    트리거 툴팁 팝오버 (docs/log/2026-09-04-trigger-links-tooltips.md).

    `$lib/triggers` 가 `term.element` 안에 직접 만들어 넣는 원소라 `:global` 이다 (데코레이션
    과 같은 이유). 자리(`left`/`top`/`display`)는 스크립트가 잡고, 여기서는 **모양만** 정한다.

    색은 전부 앱 토큰이다 — 터미널 안이지만 이 팝오버는 앱의 UI 지 원격 출력이 아니다.
    글꼴도 앱 글꼴을 쓴다 (사용자가 고른 등폭 글꼴이 좁으면 설명이 읽기 나빠진다).
    `xterm-hover` 는 xterm 과의 약속이라 클래스에 함께 붙어 있다.
  */
  :global(.aynx-trigger-tip) {
    position: absolute;
    z-index: 20;
    max-width: min(420px, 80%);
    padding: 6px 9px;
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg);
    /* `--bg-panel` 이 아니라 **불투명한** `--bg-panel-base` 다 — 팝오버 뒤로 터미널 글자가
       비쳐 보이면 설명이 읽히지 않는다 (창 투명도와 상관없이 이 한 겹은 불투명해야 한다) */
    background: var(--bg-panel-base);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-modal);
    /* 마우스를 따라가지 않는다 — 팝오버가 커서를 가로채면 그 순간 hover 가 끊긴다 */
    pointer-events: none;
    user-select: none;
    /* 긴 설명·긴 URL 이 창을 밀지 않게. 한국어는 어절 단위로 접는다 */
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  /* URL 줄 — 설명보다 한 칸 낮은 정보라 작고 흐리게, URL 이니 등폭으로 */
  :global(.aynx-trigger-tip .aynx-tip-url) {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
  }

  /* 설명만 있는 경우 URL 줄의 위 여백이 남지 않게 */
  :global(.aynx-trigger-tip .aynx-tip-text[hidden] + .aynx-tip-url) {
    margin-top: 0;
  }

  .mount-error {
    margin: 0;
    padding: 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    /* 실패색은 토큰을 쓴다 — 박아 둔 빨강(#e06c75)은 라이트 모드의 흰 패널에서 3:1 을
       못 넘겨 정작 읽어야 할 오류 문구가 흐려졌다 (2026-09-04 라이트 테마). */
    color: var(--err);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
