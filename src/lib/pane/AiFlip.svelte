<script lang="ts">
  /**
   * **AI 타일 안에서 [터미널 | 대화] 넘기기** (2026-10-17 — 사용자 승인 목업 ①'). 터미널 타일의 몸(`PaneHost` 의 `<Terminal>`)을
   * **언제나** 이 상자가 감싼다 — AI 가 아닌 타일에서도(감싸개가 AI 판정에 따라 생겼다 사라지면 `<Terminal>` 이 재마운트되고, 그
   * 언마운트가 곧 세션 종료다). AI 타일이 아니면 대화 면을 그리지 않고 키도 보지 않는다 — 감싸개는 상자 하나일 뿐이다.
   *
   * ## 두 층, 같은 크기, `display:none` 없음
   *
   * 터미널 층과 대화 층은 같은 상자(`inset: 0`)이고, 쉴 때는 안 보이는 쪽이 옆으로 밀려 나 있다(터미널 왼쪽 · 대화 오른쪽 —
   * 상자가 `clip`). 넘기면 **타일 한 장(머리줄 + 본문 — `.pane-box`)이 세로축으로 뒤집힌다**(2026-10-20 사용자 선택 — 앞면 터미널 ·
   * 뒷면 대화, `pane/flip-motion.ts` · 셈은 `pane/flip-card.ts`): 지금 면이 가장자리까지 돌아 사라지는 프레임에 두 층의 자리와 머리줄
   * 색이 바뀌고 반대 가장자리에서 돌아온다(뒷면을 그리지 않는다). 시간 약 450ms · ease-in-out, 도중에 다시 누르면 지금 각도에서
   * 짧게 되돌아가고, 움직임 줄이기면 그냥 바뀐다. **터미널 층은 숨기지 않는다** — `transform` 으로 밀어 둘 뿐이라 크기가 그대로고(refit 없음), WebGL 을
   * 떼지 않으며(숨은 터미널의 0 폭 재기 — `term/hidden-render-gate.ts`), 출력도 버퍼에 계속 쌓인다. 밀려 난 터미널 층은 포인터를
   * 받지 않는다. 상자는 `overflow: clip` 이라 밖으로 밀린 층이 비치지 않고, 포커스 · 캐럿이 상자를 스크롤시킬 수도 없다.
   *
   * ## 키보드 — 대화 면의 집은 입력 칸
   *
   * 대화 면 아래 줄에 **입력 칸**(`FlipComposer` — 사이드 채팅과 같은 알약 · 칸 안 둥근 보내기 단추(Enter 와 같은 길) · Enter 보내기 ·
   * Shift+Enter 줄바꿈 · IME 조합 중 Enter 무시 · 에이전트가 일하는 동안 보내기 옆 [중지] = Esc 키 하나 — 2026-11-02)이 있고, 넘기면 포커스를
   * 거기 준다. 편집 요소라 한글 IME 가 첫 글자부터 켜져 있다(편집 요소가 아닌 곳에 포커스가 있으면 첫 글자가 조합 없이 로마자로
   * 들어간다). 보내기는 그 타일 터미널의 **사람 입력 문**(`TermActions.submitText` — 한 줄 = 친 글자, 여러 줄 = 괄호 붙여넣기, 뒤에
   * Enter 키)이라 새 쓰기 길 · Tauri 명령이 없다. 보낸 글은 기록에 나타날 때까지 흐린 "보내는 중" 말풍선(`TranscriptBody` 의
   * `pending` — 20초 안에 안 나타나면 조용히 걷는다). 에이전트가 **권한을 묻는 중**이면 칸 대신 "터미널에서 답하기 →".
   *
   * **첨부**(2026-10-24): 대화 면이 보이는 동안 타일에 놓은 파일(OS 파일 · 파일 타일 짐 — `app/transfer` 의 `pasteAttachment`)과 칸에
   * 붙여 넣은 그림은 터미널 입력 줄이 아니라 칸 위 **칩**(`pane/composer-attachments.svelte.ts` — 열쇠 = 타일 id)으로 선다. 사본 · 업로드는
   * 터미널 면과 같은 `stageAgentFiles` · `stageFsPaths`(원격 타일은 그 서버로). 보내면 그 경로들을 터미널 면 끌어 놓기와 같은 괄호
   * 붙여넣기로 글보다 먼저 넣고(`submitText` 의 `attach`) 칩을 비운다. 터미널 면의 놓기는 예전 그대로(입력 줄에 경로).
   *
   * 이 상자의 **캡처 단계** keydown 이 xterm · 입력 칸보다 먼저 본다(판정은 순수 층 `pane/ai-flip-keys.ts`): 입력 칸이면 Escape(터미널로
   * — CLI 로 보내지 않는다) · PageUp/Down(기록) 만 가로챈다. 칸 **밖**이면(기록을 눌러 글을 고른 뒤) 글자 · IME · 붙여넣기는 칸으로
   * 포커스를 옮기며 흘려보내고(권한 대기라 칸이 없으면 터미널로 넘긴다), ↑↓ · PageUp/Down · Home/End 는 기록을 밀고, 나머지(Enter ·
   * Ctrl+C(고른 글 없음) · Ctrl+D …)는 보이지 않는 CLI 로 새지 않게 삼킨다. 전역 단축키는 그대로 지나간다. 기록을 누르기만 했으면
   * (고른 글 없음) 칸으로 포커스를 돌려준다. 터미널 층에는 `inert` 를 달지 않는다(밀려 나 포인터를 받지 않을 뿐) — 대화 면인 동안
   * xterm 이 포커스를 받으면(타일 포커스 이동 · 탭 복귀) 입력 칸으로 옮긴다.
   *
   * ## 대화 면 = 그 타일의 지금 대화
   *
   * 타일 ↔ 대화 연결(`app/agent-sessions` 의 `agentLinkOf` — 훅 신호가 실어 온 대화 id · 재개로 연 타일의 autorun)을 읽어 기록
   * 보기의 몸(`TranscriptBody`)으로 그린다 — 지난 대화 시트와 같은 쪽 읽기 · 같은 그림이고 새 Tauri 명령이 없다. 로컬은 이 PC 의 대화
   * 파일, 원격은 **이 타일의 SSH 세션**으로 서버의 파일(시트의 원격 대화와 같은 명령 · 같은 범위 — 그 별칭의 목록 캐시에 없는 새
   * 대화면 목록을 한 번 다시 읽는다). 원격은 설정의 SSH 타일만(빠른 접속 타일은 목록 캐시의 열쇠가 없어 넘기지 않는다 — 단추도 없다).
   * 연결을 아직 모르면(첫 메시지 전) 빈 면 + 입력 칸뿐이다(10판 훅은 `SessionStart` 로 CLI 가 뜨자마자 잇는다 — Claude 만. Codex 는
   * 첫 질문의 `start` 가 잇는다: 그래서 새 CLI 를 띄우는 셸 명령 · 입력 칸으로 보낸 `/new` · `/resume` 류가 옛 연결을 먼저 걷는다 — 2026-10-20).
   * Claude 는 잇는 순간 대화 파일이 아직 없다(첫 사람 말에서 생긴다) — 그 사이의 "찾지 못함" 은 오류가 아니라 빈 면이다(2026-11-02 · `pane/flip-convo.ts`). 대화 면이 보이는 동안만 따라가기(로컬 1.5초 · 원격 3초)가 돈다. 대화 층은 처음 넘길 때
   * 섰다가 AI 타일인 동안 남는다(위로 올려 읽던 자리가 다음 넘김에도 그대로다).
   *
   * 에이전트 말의 ```mermaid · ```svg 는 그림으로(`TranscriptBody` 의 `diagrams`), `![alt](경로)` · 그림 파일 링크는 이 면이 쥔
   * `DocImageCache` 하나가 읽는다(2026-10-24 — 사이드 채팅과 같은 `doc-images` 규칙 · 네트워크 경로 안 읽음 · 그림 우클릭 메뉴 · 새 Tauri
   * 명령 없음). 로컬은 로컬 백엔드, 원격은 **이 타일의 SSH 세션**의 SFTP(세션이 없으면 오프라인 대체 글자). 상대 경로의 기준은 CLI 의
   * cwd ≈ 그 타일 셸이 마지막으로 알린 폴더(로컬 `localReportedFolder` · 원격 `reportedCwd`) — 모르면 절대 경로만 읽는다.
   * 사람 말에 **바로 실린** 그림(Claude 붙여넣기 · 끌어 놓은 파일의 base64 · Codex 첨부의 데이터 URL — 경로가 없다)은 쪽이 자리만 싣고
   * `ConvImageCache` 가 한 장씩 받는다(`agent_conversation_image` · 원격 `…_remote` — 쪽과 같은 색인 · 같은 전송로 · 10 MB · png/jpeg/gif/webp).
   * 에이전트 말의 **파일 경로**(구분자나 줄 꼬리가 있는 코드 조각 · 평문 속 경로 · 경로 주소의 링크 — `MarkdownBlocks` 의 `paths`)는 그냥 클릭에 문서 타일로 연다
   * (2026-11-11). 자리는 터미널 글자의 경로와 같은 `pathLinkPlace`(로컬 · SSH · WSL), 폴더는 그 타일 셸이 마지막으로 알린 값(`reportedCwd` —
   * 터미널의 `shell.cwd()` 와 같은 값의 반응형 사본), 여는 길도 같은 `onopenpath` → `openPathFromTerminal`(파일일 때만 · 꼬리 줄로).
   *
   * 넘김 상태는 `pane/ai-flip.svelte.ts`(화면 상태 — 저장 안 함). AI 타일이 아니게 되면(CLI 가 끝났다) 터미널 면으로 돌아온다.
   * **신뢰 안내 말풍선**(2026-11-04 · 옅게 누런 면 + 꼬리 — docs/log/2026-11-04-trust-bubble.md): Codex 훅 신뢰는 닫으면 이 기기에서 다시 안 뜨고, Claude 폴더 신뢰는 터미널에 질문이 떠 있는
   * 동안만 뜬다(질문 동안 훅이 오지 않아 화면을 읽는다 — `pane/claude-trust.ts`). 그 질문 동안 입력 칸은 막힌다(`FlipComposer` 의 `gate.quiet`).
   * **폰 배치는 AI 타일을 처음 볼 때 대화 면으로 연다**(2026-11-04 · 이 기기 값 — `flip-convo.ts` 의 `phoneOpensConvo` · CLI 한 번에 한 번 · 사람이 돌리면 그대로) —
   * 뒤집는 움직임 없이, **포커스도 주지 않는다**(입력 칸에 주면 화면 키보드가 올라와 기록을 가린다 — 칸을 누르면 그때). 그래서 폰의 대화 면에서는 xterm 이 받은 포커스도
   * 칸으로 옮기지 않고 놓는다(`onTermFocusIn`).
   *
   * ## 대화 기록 안 찾기 (2026-10-19)
   *
   * 대화 면에서 `find` 키(`Ctrl+F` · 팔레트 — `app/tile-find.ts`)는 밀려 난 터미널의 버퍼가 아니라 **대화 기록**을 찾는다: 대화 층 맨 위에
   * 찾기 띠(`DomFindBar` — 문서 타일과 같은 띠 · 같은 규칙)가 서고 말풍선 글자를 칠한다. `Enter` · `F3` 다음, `Shift+Enter` · `Shift+F3`
   * 이전, `Esc` 닫고 입력 칸으로. 받아 온 쪽 안에서만 찾는다(더 오래된 것은 "이전 메시지 더 보기" 로 받은 뒤). 따라가기가 새 말을
   * 붙이면 다시 찾는다. 입력 칸 안의 `Ctrl+F` 는 전역 처리기의 입력 칸 가드에 걸리므로 위 캡처 단계가 먼저 잡고, 띠 안의 키는 모두
   * 띠에 맡긴다(`ai-flip-keys.ts` 의 `inFind` · `findCombo`). 터미널 면이면 이 타일의 찾기는 없다(`false` — 예전처럼 그 터미널 범위 검색).
   */
  import { onDestroy, tick, untrack, type Snippet } from "svelte";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason, hasReason } from "$lib/error-reason";
  import {
    agentConversationTranscript,
    agentConversationTranscriptRemote,
    agentConversationImage,
    agentConversationImageRemote,
    type TranscriptPage,
    type TranscriptPicture,
  } from "$lib/context";
  import { agentLinkOf, agentPromptSent } from "$lib/app/agent-sessions.svelte.js";
  import { agentKindOf, agentSignalsOf, agentStatusOf, noteAgentInterrupted, onAgentHookSignal } from "$lib/app/agent-status.svelte.js";
  import { isClaudeTrustPrompt } from "$lib/pane/claude-trust";
  import { termActionsOf } from "$lib/term-actions";
  import { showNotice } from "$lib/app/notice";
  import FlipComposer from "$lib/pane/FlipComposer.svelte";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import { registerTileFind } from "$lib/app/tile-find";
  import { loadRemoteConversations } from "$lib/app/remote-conversations.svelte.js";
  import { settings } from "$lib/settings.svelte.js";
  import { comboFromEvent, effectiveCombo, resolveBindings } from "$lib/keybindings";
  import { FlipMotion } from "$lib/pane/flip-motion";
  import { flipKeyAction } from "$lib/pane/ai-flip-keys";
  import {
    canFlipPane,
    clearFlipPrefill,
    flipPrefillOf,
    flipRemoteAlias,
    flipViewOf,
    forgetFlip,
    setFlipView,
  } from "$lib/pane/ai-flip.svelte.js";
  import type { PaneSpec } from "$lib/session";
  import { DocImageCache } from "$lib/doc-images.svelte";
  import { ConvImageCache } from "$lib/conv-images.svelte";
  import { localBackend, remoteBackend } from "$lib/fs-backend";
  import { localReportedFolder, pathLinkPlace, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
  import { resolvePathLink, type PathMatch, type ResolvedPath } from "$lib/path-links";
  import { hasSession } from "$lib/session";
  import { stageAgentFiles } from "$lib/agent-attachments";
  import { attachmentPaths, tileAttachPastes } from "$lib/pane/composer-attachments";
  import {
    clearComposerAttachments,
    composerAttachmentsOf,
    removeComposerAttachment,
    stageComposerAttachments,
  } from "$lib/pane/composer-attachments.svelte.js";
  import TilePermissionCard from "$lib/pane/TilePermissionCard.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { aiFacePref, handheld, mobileLayout } from "$lib/app/mobile.svelte.js";
  import { cardTarget } from "$lib/tile-permission";
  import { convoNotYet, mayRefreshRemote, phoneOpensConvo, stopReady, stopShown } from "$lib/pane/flip-convo";
  import {
    closeCodexTrustHint,
    codexTrustHintShown,
    questionSummariesOf,
    reportTileFace,
    tilePermCardsOf,
    tileTuiAskingOf,
    tilePermTracesOf,
    watchTilePermissions,
  } from "$lib/app/tile-permission.svelte.js";

  let {
    pane,
    sessionId = null,
    shown = true,
    onopenpath,
    children,
  }: {
    pane: PaneSpec;
    /** 이 타일이 지금 물고 있는 세션 id — 원격 대화를 읽는 길 */
    sessionId?: number | null;
    /** 이 타일이 화면에 보이는가(숨은 탭이면 따라가기를 멈춘다) */
    shown?: boolean;
    /** 대화 면의 파일 경로를 눌렀다 — 터미널의 `onopenpath` 와 같은 손잡이(이미 풀린 경로 · 꼬리 줄) */
    onopenpath?: (target: NonNullable<ResolvedPath>, line?: number) => void;
    /** 터미널 */
    children: Snippet;
  } = $props();

  /** 한 쪽의 항목 수 — 시트와 같다 */
  const PAGE = 40;
  const FOLLOW_LOCAL_MS = 1500;
  const FOLLOW_REMOTE_MS = 3000;
  /** 원격 세션이 없어 더 읽지 못했다는 표식 */
  const GONE = "\u0000remote-gone";
  /** 대화 면의 화살표 한 번 */
  const LINE_PX = 40;

  const flippable = $derived(canFlipPane(pane));
  const view = $derived(flippable ? flipViewOf(pane.id) : "term");
  const remoteAlias = $derived(flipRemoteAlias(pane));
  const link = $derived(flippable ? agentLinkOf(pane.id) : null);
  const convKey = $derived(
    link ? `${remoteAlias !== null ? `${remoteAlias.toLowerCase()}|` : ""}${link.agent}:${link.id}` : null,
  );
  /** 대화 층을 세웠나 — 처음 넘길 때 서고 AI 타일인 동안 남는다 */
  let mounted = $state(false);
  $effect(() => {
    if (view === "convo") mounted = true;
    else if (!flippable) mounted = false;
  });

  /** CLI 가 끝나 AI 타일이 아니게 되면 터미널 면으로 */
  $effect(() => {
    if (!flippable && untrack(() => flipViewOf(pane.id)) === "convo") setFlipView(pane.id, "term");
  });
  onDestroy(() => forgetFlip(pane.id));

  let root = $state<HTMLDivElement | null>(null);
  let termEl = $state<HTMLDivElement | null>(null);
  let convoEl = $state<HTMLDivElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);
  let composerEl = $state<HTMLTextAreaElement | null>(null);
  /** 대화 기록 안 찾기 띠 */
  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);

  /** 에이전트가 권한을 묻는 중(훅 신호 — 상태 점과 같은 값) — 입력 칸 대신 "터미널에서 답하기" */
  const permission = $derived(flippable && agentStatusOf(pane) === "permission");
  // ── 타일 권한 카드(2026-11-01 — docs/log/2026-11-01-tile-permission-hook.md 10절) ─────────────────────────────
  // 로컬 AI 타일의 CLI 에만 건 훅이 세운 카드를 대화 면 입력 칸 자리에 그린다. 카드가 있으면 입력 칸 대신 카드(답이 먼저다), 없으면
  // 예전 그대로(권한 신호만 있으면 "터미널에서 답하기 →" — 훅이 없는 원격 · 신뢰 전 Codex). 스트림 = `AYNX_STREAM`.

  const stream = $derived(pane.historyStreamId ?? pane.id);
  /** 카드를 받는 타일 — 훅은 로컬 AI 타일에만 실린다(원격 SSH 타일은 2단계) */
  const permTile = $derived(flippable && pane.kind === "local");
  const permCards = $derived(permTile ? tilePermCardsOf(stream) : []);
  const permTraces = $derived(permTile ? tilePermTracesOf(stream) : []);
  // 그 타일이 서거나 세션에 다시 붙을 때(F5 · 재부착 — `seq` 가 없다) 스냅숏으로 다시 그린다
  $effect(() => {
    if (!permTile) return;
    const s = stream;
    void sessionId;
    untrack(() => void watchTilePermissions(s));
  });
  // ── 면 규칙(2026-11-02 사용자 승인 — 대화 면에서는 카드로, 터미널 면에서는 TUI 로) ─────────────────────────────
  // 이 창이 이 타일을 대화 면으로 두었는가(탭이 보이는지와 무관)를 서버에 알린다 — 대화 면으로 보는 창이 하나도 없으면 서버가 카드 없이 TUI 가
  // 묻게 하고, 카드가 선 동안 모두 터미널 면으로 넘기면 풀어 TUI 로 넘긴다. 세션이 바뀌면(새 회차 · 서버 재시작) 다시 알린다. 정리 함수로 거짓을
  // 보내지 않는다(면이 바뀔 때마다 거짓 → 참이 가면 그 틈에 카드가 풀린다) — 타일이 사라질 때만 거짓.
  const faceConvo = $derived(view === "convo");
  $effect(() => {
    if (!permTile) return;
    const s = stream;
    const convo = faceConvo;
    void sessionId;
    untrack(() => reportTileFace(s, convo));
  });
  onDestroy(() => {
    if (permTile) reportTileFace(stream, false);
  });
  /** 답한 질문의 요약("답을 보냈습니다") — 이 타일 · 지금 대화의 것. 대화 기록 사이 그 자리에 선다(`TranscriptBody` 의 `notes`) */
  const qaSummaries = $derived(permTile ? questionSummariesOf(stream, link?.id ?? null) : []);
  // 사람의 답이라 사람 말풍선 판에(A안 — 오른쪽 · 같은 배경 · 모서리 · 최대 폭)
  const qaNotes = $derived(qaSummaries.map((s) => ({ key: s.id, at: s.at, user: true })));

  /** TUI 가 묻는 중(카드 없이 물러났거나 카드가 풀렸다) — 대화 면은 입력 칸 대신 "터미널에서 답하기"(턴이 끝났으면 걷는다) */
  const tuiAsking = $derived(
    permTile && permCards.length === 0 && tileTuiAskingOf(stream) && agentStatusOf(pane) !== "finished",
  );

  /** 카드의 남은 시간 시계(카드가 있을 때만 1초) */
  let permNow = $state(Date.now());
  $effect(() => {
    if (permCards.length === 0) return;
    permNow = Date.now();
    const h = setInterval(() => (permNow = Date.now()), 1000);
    return () => clearInterval(h);
  });
  const phone = $derived(handheld());
  /** Codex 는 기다리는 동안 TUI 에 창이 없다 — 터미널 면이면 띠로 대화 면을 가리킨다(Claude 는 TUI 창이 함께 떠 있어 띄우지 않는다) */
  const codexBand = $derived(view === "term" && permCards.some((c) => c.cli === "codex"));
  /** Codex 첫 실행 신뢰 안내 — 훅이 실린 로컬 Codex 타일의 대화 면 입력 칸 바로 위 말풍선(닫으면 다시 안 뜸 · 2026-11-02 위 → 아래) */
  const trustHint = $derived(permTile && agentKindOf(pane) === "codex" && codexTrustHintShown());

  // ── Claude 폴더 신뢰 질문(2026-11-04 · 판정 `pane/claude-trust.ts` · docs/log/2026-11-04-trust-bubble.md) ─────────────────────────
  // 질문 동안에는 훅이 하나도 오지 않아(실측) 터미널 화면을 읽는다 — 대화 면 · 보이는 동안 · 그 CLI 의 훅을 아직 못 받았고 사람이 아직 말하지 않았을 때만 1초마다.
  // 그동안 입력 칸을 막는다(Enter 가 그 질문의 답이 된다 — 기본 선택은 "No, exit" 라 CLI 가 끝난다). ✕ 는 말풍선만 숨긴다 — 칸은 계속 막힌다.
  /** 이 CLI 가 훅을 보냈거나 사람이 이미 말했다 — 질문을 지났다 */
  let cliPastTrust = $state(false);
  const unhook = onAgentHookSignal((id) => {
    if (id === pane.id) cliPastTrust = true;
  });
  onDestroy(unhook);
  const claudeTile = $derived(flippable && agentKindOf(pane) === "claude");
  $effect(() => {
    if (!claudeTile) cliPastTrust = false;
  });
  /** F5 뒤에는 위 칸이 비어도 서버 표의 스냅숏이 턴 신호를 들고 온다 */
  const trustWatch = $derived.by(() => {
    if (!claudeTile || cliPastTrust) return false;
    const sig = agentSignalsOf(pane.id);
    return !sig || (sig.signalRunningAt === null && sig.signalStopAt === null && sig.signalPermissionAt === null);
  });
  let trustAsked = $state(false);
  /** ✕ — 이번 질문에서만(저장 안 함). 질문이 사라지면 풀린다 */
  let trustHidden = $state(false);
  function readTrustPrompt(): boolean {
    return isClaudeTrustPrompt(termActionsOf(pane.id)?.screenLines() ?? []);
  }
  $effect(() => {
    if (!trustWatch) {
      trustAsked = false;
      trustHidden = false;
      return;
    }
    if (view !== "convo" || !shown) return;
    const check = () => {
      const asked = readTrustPrompt();
      trustAsked = asked;
      if (!asked) trustHidden = false;
    };
    untrack(check);
    const h = setInterval(check, 1000);
    return () => clearInterval(h);
  });
  const trustGate = $derived(trustAsked ? { text: t("pane.flip.trust.gate"), quiet: true } : null);

  /** 카드의 [터미널에서 답하기] — 풀었으니 터미널 면으로 */
  function permToTerminal(): void {
    setFlipView(pane.id, "term");
    focusTerm();
  }

  /** 대화 면 안의 작업 중 표시(스피너 · 쓰는 중 점 셋) — 머리줄에는 아무것도 띄우지 않는다 */
  const activity = $derived.by((): "running" | "permission" | "idle" => {
    const s = flippable ? agentStatusOf(pane) : null;
    return s === "running" ? "running" : s === "permission" ? "permission" : "idle";
  });

  // ── [중지] — 지금 턴 끊기(2026-11-02 · 판정은 `pane/flip-convo.ts`) ─────────────────────────────
  // 사람이 누른 단추가 그 타일 TUI 에 **고정 키 Esc 하나**를 사람 키로 보낸다(`TermActions.sendEscape` — 키보드로 Esc 를 친 것과 같은 문 ·
  // 원격 웹 창도 같은 `writeInput` → `write_session{source:"keyboard"}`). AI 문자열이 아니라 "AI 문자열→PTY 길은 없다" 와 부딪치지 않는다.
  // 일하는 중(`running`)에만 서고, 권한을 묻는 중 · 카드가 서 있으면 숨는다(카드 · "터미널에서 답하기" 가 그 자리의 답).

  const stoppable = $derived(flippable && stopShown({ status: agentStatusOf(pane), cards: permCards.length }));
  /** 마지막으로 Esc 를 보낸 때 — Claude 의 Esc 두 번(되감기 메뉴)이 되지 않게 한 번만 */
  let stopAt: number | null = null;
  function stopTurn(): void {
    const now = Date.now();
    if (!stopReady(stopAt, now)) return;
    const r = termActionsOf(pane.id)?.sendEscape() ?? "closed";
    if (r === "closed") {
      showNotice(t("pane.flip.composer.closed"));
      return;
    }
    stopAt = now;
    // 서버 표에 "사람이 끊음" — Claude 는 Esc 에 훅이 없어(실측) 실행 표시 · 탭 점이 다음 신호까지 남았다. 다음 신호면 다시 실행
    noteAgentInterrupted(pane);
  }

  // ── 입력 칸 — 보내기 · 보내는 중 말풍선 ───────────────────────────────────────────────

  /** 기록에 안 나타나도 말풍선을 걷는 시간 */
  const PENDING_MS = 20_000;
  let pending = $state<{ id: number; text: string; files?: readonly string[] }[]>([]);
  let pendingSeq = 0;
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function dropPending(id: number): void {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pendingTimers.delete(id);
    if (pending.some((p) => p.id === id)) pending = pending.filter((p) => p.id !== id);
  }

  // 첨부 칩(2026-10-24) — 대화 면이 보일 때 타일에 놓은 파일(`app/transfer`) · 칸에 붙여 넣은 그림. 열쇠 = 타일 id
  const attachments = $derived(composerAttachmentsOf(pane.id));
  onDestroy(() => clearComposerAttachments(pane.id));

  /** 칸에 그림을 붙여 넣었다 — 터미널 면 끌어 놓기와 같은 자리로 사본 · 업로드(`stageAgentFiles` — 원격 타일은 그 서버로) */
  function attach(files: File[]): void {
    const sid = sessionId;
    const kind = pane.kind;
    if (sid === null || !hasSession(kind)) {
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    void stageComposerAttachments(
      pane.id,
      files.map((file) => ({ name: file.name, file })),
      () => stageAgentFiles(kind, sid, files, t),
      () => sessionId === sid && canFlipPane(pane),
    );
  }

  /**
   * 그 타일 터미널의 사람 입력 문으로 보낸다 — 보냈으면 참(칸을 비운다). 첨부 칩이 있으면 그 경로들을 터미널 면 끌어 놓기와 같은 괄호
   * 붙여넣기로 먼저 넣는다(`submitText` 의 `attach` — CLI 가 그림으로 바꾼다).
   */
  function send(text: string): boolean {
    // 시계 사이에 질문이 떴을 수 있다 — 보내기 직전에 한 번 더 본다(Enter 가 질문의 답이 되면 안 된다)
    if (trustWatch && readTrustPrompt()) {
      trustAsked = true;
      return false;
    }
    const atts = attachments;
    const files = atts.map((a) => a.name);
    const r = termActionsOf(pane.id)?.submitText(text, tileAttachPastes(attachmentPaths(atts))) ?? "closed";
    if (r === "empty") return false;
    if (r === "closed") {
      showNotice(t("pane.flip.composer.closed"));
      return false;
    }
    if (r === "no-bracketed") {
      showNotice(t("pane.drop.attach.notready"));
      return false;
    }
    clearComposerAttachments(pane.id);
    cliPastTrust = true; // 사람이 말했다 — 그 뒤로 화면을 읽을 까닭이 없다
    // 대화를 바꾸는 Codex 명령(`/new` · `/resume` …)이면 옛 연결을 버린다 — 새 대화는 첫 질문의 신호가 잇는다(빈 면). 말풍선은 띄우지 않는다
    if (agentPromptSent(pane.id, text)) return true;
    // 그림만 보냈으면 말풍선 없음(맞댈 글이 없다 — 기록이 곧 그린다)
    if (text.trim() === "") return true;
    const id = ++pendingSeq;
    pending = [...pending, { id, text, files }];
    pendingTimers.set(id, setTimeout(() => dropPending(id), PENDING_MS));
    return true;
  }
  onDestroy(() => {
    for (const timer of pendingTimers.values()) clearTimeout(timer);
  });

  // ── 쪽 받기 — 시트(`ConversationViewer`)와 같은 명령 · 같은 범위 ─────────────────────────

  /**
   * 목록 캐시를 다시 읽은 때(대화 열쇠 → 시각) — 원격의 새 대화는 별칭 캐시에 없어 다시 읽는다. 처음 한 번, 그 뒤로는 쪽을 아직 못 받은
   * 대화(파일이 곧 생긴다 — 아래 "아직 없음")만 틈마다 한 번(`mayRefreshRemote`).
   */
  const refreshed = new Map<string, number>();

  // ── "대화가 아직 없음"(2026-11-02 — `pane/flip-convo.ts` 의 `convoNotYet`) ─────────────────────────────
  // Claude 의 `SessionStart` 훅은 CLI 가 뜨자마자 대화 id 를 잇지만 대화 파일은 첫 사람 말에서 생긴다 — 그 사이의 "찾지 못했습니다" 는 빈
  // 면이다(따라가기가 계속 다시 본다). 쪽을 한 번이라도 받았거나 턴 하나가 끝났는데 못 받으면 그때는 오류로 보인다.

  /** 쪽을 한 번이라도 받은 대화 열쇠 */
  const loadedConvs = new Set<string>();
  /** 일하는 것을 본 대화 · 턴 하나가 끝난 대화 */
  const ranConvs = new Set<string>();
  const turnEndedConvs = new Set<string>();
  $effect(() => {
    const k = convKey;
    const a = activity;
    if (k === null) return;
    if (a !== "idle") ranConvs.add(k);
    else if (ranConvs.has(k)) turnEndedConvs.add(k);
  });
  /** 지금 대화가 "아직 없음" 으로 비어 있다 — 빈 면 문구도 걷는다 */
  let convoPending = $state(false);
  $effect(() => {
    void convKey;
    convoPending = false;
  });

  // ── 그림 — 사이드 채팅(`SideChatFace`)과 같은 캐시 · 같은 규칙 ─────────────────────────────

  const imageCache = new DocImageCache();
  onDestroy(() => imageCache.dispose());
  /** CLI 의 cwd ≈ 그 타일 셸이 마지막으로 알린 폴더(로컬 = 이 PC 경로 · 원격 = POSIX) — 상대 경로의 기준 */
  const imageFolder = $derived(remoteAlias !== null ? reportedCwd(pane.id) : localReportedFolder(pane));
  /** 대화 면의 경로 링크 — 터미널 글자의 경로와 같은 자리 · 같은 풀기(이 파일 머리말). 손잡이가 없거나 자리가 없으면 걸지 않는다 */
  const pathLinks = $derived.by(() => {
    const open = onopenpath;
    const place = open ? pathLinkPlace(pane, reportedCwd(pane.id)) : null;
    if (!open || !place) return undefined;
    const label = (r: NonNullable<ResolvedPath>, m: PathMatch) =>
      ("path" in r ? r.path : `~/${r.home}`) + (m.line !== undefined ? `:${m.line}` : "");
    return {
      title: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        return r ? label(r, m) : null;
      },
      open: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        if (r) open(r, m.line);
      },
    };
  });
  const imageCtx = $derived.by(() => {
    const remote = remoteAlias !== null;
    const dir = imageFolder?.trim() ?? "";
    // 폴더를 모르면 `docPath` 빈 글 — 절대 경로만 읽고 상대 경로는 "풀 수 없음"(`docImagePlan`)
    const known = dir !== "" && (!remote || dir.startsWith("/"));
    return {
      backend: remote ? remoteBackend(sessionId) : localBackend(),
      docPath: known ? `${dir.replace(/[\\/]+$/, "")}/.chat` : "",
      remote,
      gen: "",
      noNetwork: true,
    };
  });
  /** 마지막으로 받은 그림 주소들 — 폴더 · 세션이 바뀌면 그때 다시 맞춘다 */
  let imageSrcs: readonly string[] = [];
  $effect(() => {
    const ctx = imageCtx;
    void ctx.backend.online;
    // 대화를 모르게 되면(기록 몸이 걷힌다) 그 그림들도 거둔다
    if (convKey === null) imageSrcs = [];
    untrack(() => imageCache.sync(imageSrcs, ctx));
  });
  const images = {
    state: (src: string) => imageCache.state(src),
    broken: (src: string) => imageCache.broken(src),
    source: (src: string) => imageCache.source(src),
    sync: (srcs: readonly string[]) => {
      imageSrcs = srcs;
      imageCache.sync(srcs, untrack(() => imageCtx));
    },
  };

  // 사람 말에 바로 실린 그림(Claude 붙여넣기 · 끌어 놓은 파일 · Codex 첨부) — 쪽에는 자리만, 바이트는 한 장씩(같은 색인 · 같은 전송로)
  const picCache = new ConvImageCache();
  onDestroy(() => picCache.dispose());
  /** 그림 캐시의 열쇠 — 원격은 세션까지(재접속하면 못 읽은 것도 다시) */
  const picConv = $derived(convKey === null ? null : `${convKey}|${remoteAlias !== null ? (sessionId ?? "") : ""}`);
  function fetchPicture(p: TranscriptPicture): Promise<ArrayBuffer> {
    const l = link;
    if (!l) return Promise.reject(new Error("no-conversation"));
    if (remoteAlias === null) return agentConversationImage(l.agent, l.id, p);
    if (sessionId === null) return Promise.reject(new Error("[session-gone]"));
    return agentConversationImageRemote(sessionId, l.agent, l.id, p);
  }
  let picList: readonly TranscriptPicture[] = [];
  $effect(() => {
    const conv = picConv;
    untrack(() => picCache.sync(conv === null ? [] : picList, conv, fetchPicture));
  });
  const pictures = {
    state: (p: TranscriptPicture) => picCache.state(p),
    broken: (p: TranscriptPicture) => picCache.broken(p),
    source: (p: TranscriptPicture) => picCache.source(p),
    sync: (ps: readonly TranscriptPicture[]) => {
      picList = ps;
      picCache.sync(ps, untrack(() => picConv), fetchPicture);
    },
  };

  /** 쪽 받기 — 받으면 그 대화를 "받은 적 있음" 으로 적는다 */
  async function fetchPage(before: number | null): Promise<TranscriptPage> {
    const key = convKey;
    const page = await fetchPageRaw(before);
    if (key !== null && key === convKey) {
      loadedConvs.add(key);
      convoPending = false;
    }
    return page;
  }

  async function fetchPageRaw(before: number | null): Promise<TranscriptPage> {
    const l = link;
    if (!l) throw new Error("no-conversation");
    const alias = remoteAlias;
    if (alias === null) return await agentConversationTranscript(l.agent, l.id, before, PAGE);
    const sid = sessionId;
    if (sid === null) throw new Error(GONE);
    try {
      return await agentConversationTranscriptRemote(sid, l.agent, l.id, before, PAGE);
    } catch (e) {
      if (hasReason(String(e), "session-gone")) throw new Error(GONE);
      const key = `${alias.toLowerCase()}|${l.agent}:${l.id}`;
      const now = Date.now();
      if (!mayRefreshRemote(refreshed.get(key), convKey !== null && loadedConvs.has(convKey), now)) throw e;
      refreshed.set(key, now);
      await loadRemoteConversations(alias, true);
      return await agentConversationTranscriptRemote(sid, l.agent, l.id, before, PAGE);
    }
  }

  function failureOf(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    const gone = msg === GONE && remoteAlias !== null;
    const k = convKey;
    // 대화 파일이 아직 없다(첫 말 전) — 오류가 아니라 빈 면(빈 글 → 기록 몸은 빈 면 갈래로 그리고 따라가기가 다시 본다)
    if (k !== null && convoNotYet({ loaded: loadedConvs.has(k), turnEnded: turnEndedConvs.has(k), gone })) {
      convoPending = true;
      return "";
    }
    convoPending = false;
    if (gone) return t("board.viewer.remoteGone", { host: remoteAlias });
    return t("board.viewer.error", { e: stripReason(msg) });
  }

  // ── 움직임 — 카드 뒤집기 ──────────────────────────────────────────────────────────

  /** 타일 한 장을 뒤집는 움직임(`pane/flip-motion.ts` — 상자 회전 · 두 층 · 머리줄 색이 같은 시간 · 같은 곡선) */
  const motion = new FlipMotion();
  onDestroy(() => motion.stop());

  async function flip(from: "term" | "convo", to: "term" | "convo"): Promise<void> {
    await tick(); // 대화 층이 막 섰을 수 있다
    // AI 타일이 아니게 됐으면(CLI 가 끝났다 — 대화 층 · 머리줄 단추가 걷힌다) 뒤집지 않고 터미널 면 그대로
    if (!flippable) {
      motion.stop();
      return;
    }
    motion.flip(pane.id, from, to, root?.closest<HTMLElement>(".pane-box") ?? null, termEl, convoEl);
  }

  let lastView: "term" | "convo" | null = null;
  /** 다음 면 바뀜이 폰의 자동 열기다 — 뒤집지 않고 포커스도 옮기지 않는다 */
  let autoOpening = false;
  $effect(() => {
    const v = view;
    untrack(() => {
      const auto = autoOpening;
      autoOpening = false;
      if (lastView !== null && lastView !== v && !auto) {
        void flip(lastView, v);
        void settleFocus(v);
      }
      lastView = v;
    });
  });

  /** 폰의 첫 화면 — 이번 CLI 에서 이미 열었는가(CLI 가 끝나면 지운다 · 새 CLI = 다시 기본). 반응형이 아니다 */
  let phoneOpened = false;
  $effect(() => {
    const f = flippable;
    if (!f) {
      phoneOpened = false;
      return;
    }
    const open = phoneOpensConvo({ layout: mobileLayout(), pref: aiFacePref(), flippable: f, shown, opened: phoneOpened });
    if (!open) return;
    untrack(() => {
      phoneOpened = true;
      if (flipViewOf(pane.id) === "convo") return;
      autoOpening = true;
      setFlipView(pane.id, "convo");
    });
  });

  /** xterm 의 숨은 textarea — 키보드의 집 */
  function focusTerm(): void {
    termEl?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }

  /** 대화 면의 키보드 집 — 입력 칸(권한 대기면 없다 — 거짓) */
  function focusComposer(): boolean {
    if (!composerEl || permCards.length > 0) return false;
    composerEl.focus({ preventScroll: true });
    return true;
  }

  /**
   * 넘긴 뒤 포커스 — 이 타일 안(머리줄 단추 · 대화 면 · 터미널)이거나 잃어버린 채면 그 면의 집으로(대화 면 = 입력 칸, 없으면 기록 ·
   * 터미널 = xterm). 다른 곳(모달 · 다른 타일)이면 건드리지 않는다. 대화 층이 막 섰을 수 있어 한 틱 뒤에 본다.
   */
  async function settleFocus(to: "term" | "convo"): Promise<void> {
    await tick();
    const box = root?.closest<HTMLElement>("[data-pane]") ?? null;
    const el = document.activeElement;
    const lost = el === null || el === document.body || el === document.documentElement;
    if (!lost && (box === null || !box.contains(el))) return;
    if (to === "term") focusTerm();
    else if (!focusComposer()) bodyEl?.focus({ preventScroll: true });
  }

  /** 대화 면인 동안 xterm 이 포커스를 받으면(타일 포커스 이동 · 탭 복귀 — 터미널이 스스로 `focus()`) 입력 칸으로 */
  function onTermFocusIn(ev: FocusEvent): void {
    if (view !== "convo") return;
    // 폰 — 타일이 활성화되며 xterm 이 받은 포커스다. 칸으로 옮기면 화면 키보드가 올라온다 — 놓기만 한다(칸은 사람이 누를 때)
    if (mobileLayout()) {
      if (ev.target instanceof HTMLElement) ev.target.blur();
      return;
    }
    focusComposer();
  }

  // ── 대화 기록 안 찾기 ──────────────────────────────────────────────────────────

  /**
   * `find` 액션의 이 타일 몫 — 대화 면이면 띠를 연다(대화를 아직 몰라 기록이 없어도 `true`: 보이지 않는 터미널을 찾지 않는다).
   * 터미널 면이면 `false`(그 터미널 범위 검색).
   */
  function openFind(): boolean {
    if (view !== "convo") return false;
    finder?.show();
    return true;
  }

  // `find` 액션의 문 — 제 타일 id 로 적는다
  $effect(() => {
    const id = pane.id;
    return untrack(() => registerTileFind(id, openFind));
  });

  // 터미널 면으로 돌아가면 띠를 닫는다(칠도 걷는다)
  $effect(() => {
    if (view !== "convo") untrack(() => finder?.close());
  });

  /** 띠를 닫았다 — 키보드는 입력 칸으로(권한 대기라 없으면 기록으로) */
  function onFindClose(): void {
    if (!focusComposer()) bodyEl?.focus({ preventScroll: true });
  }

  // ── 키 · 누르기 (대화 면이 보일 때만) ─────────────────────────────────────────────

  function scrollBy(dy: number | "top" | "bottom"): void {
    const el = bodyEl;
    if (!el) return;
    if (dy === "top") el.scrollTop = 0;
    else if (dy === "bottom") el.scrollTop = el.scrollHeight;
    else el.scrollTop += dy;
  }

  function hasConvoSelection(): boolean {
    const sel = document.getSelection();
    return !!sel && !sel.isCollapsed && !!convoEl && sel.anchorNode !== null && convoEl.contains(sel.anchorNode);
  }

  function onKeydownCapture(ev: KeyboardEvent): void {
    if (view !== "convo") return;
    const target = ev.target instanceof Element ? ev.target : null;
    // 입력 칸 · 대화 면 안의 다른 글 칸(권한 카드의 거절 사유 · 질문 카드의 직접 입력 — 2026-11-02)은 제 키를 다 쓴다(Backspace · 화살표를
    // 기록 스크롤로 삼키지 않게). 찾기 띠의 칸은 그대로 찾기 갈래(`inFind`)로.
    const inComposer =
      target !== null &&
      (target === composerEl ||
        ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
          !!convoEl?.contains(target) &&
          !target.closest("[data-find-bar]")));
    const inConvo = !inComposer && !!target && !!convoEl && convoEl.contains(target);
    const combo = comboFromEvent(ev);
    const action = flipKeyAction(ev, {
      globalCombo: combo !== null && resolveBindings(settings.current.keybindings).global.has(combo),
      inComposer,
      inConvo,
      onControl: !!target?.closest("button, input, textarea, select, a[href], [data-path-link]"),
      hasSelection: hasConvoSelection(),
      inFind: inConvo && !!target?.closest("[data-find-bar]"),
      findCombo: combo !== null && combo === effectiveCombo("find", settings.current.keybindings),
    });
    if (action === "pass") return;
    if (action === "type") {
      // 키는 그대로 흘려보내고 포커스만 지금 옮긴다(이 keydown 의 글자는 새 포커스로 간다) — 입력 칸으로. 칸이 없으면(권한 대기)
      // 터미널로 넘긴다(답은 거기서)
      if (focusComposer()) return;
      // 권한 카드가 서 있으면 터미널로 넘기지 않는다(Claude 의 TUI 창은 낱자 키가 곧 답이다) — 답은 카드 단추로
      if (permCards.length > 0) return;
      setFlipView(pane.id, "term");
      if (inConvo) focusTerm();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    switch (action) {
      case "find":
        finder?.show();
        break;
      case "back":
        setFlipView(pane.id, "term");
        focusTerm();
        break;
      case "scroll-up":
        scrollBy(-LINE_PX);
        break;
      case "scroll-down":
        scrollBy(LINE_PX);
        break;
      case "page-up":
        scrollBy(-Math.max(LINE_PX, (bodyEl?.clientHeight ?? 0) * 0.9));
        break;
      case "page-down":
        scrollBy(Math.max(LINE_PX, (bodyEl?.clientHeight ?? 0) * 0.9));
        break;
      case "top":
        scrollBy("top");
        break;
      case "bottom":
        scrollBy("bottom");
        break;
    }
  }

  /** 대화 면을 눌렀다 놓음 — 고른 글이 없고 단추 · 칸이 아니면 키보드를 입력 칸으로 돌려준다(IME 가 첫 글자부터 켜져 있게) */
  function onConvoPointerUp(ev: PointerEvent): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest("button, input, textarea, select, a[href], [data-path-link], [data-find-bar]")) return;
    requestAnimationFrame(() => {
      if (view === "convo" && !hasConvoSelection()) focusComposer();
    });
  }

  /** 권한 대기의 "터미널에서 답하기" */
  function toTerminal(): void {
    setFlipView(pane.id, "term");
    focusTerm();
  }

  /**
   * 타일 상자(`.pane-box` — `overflow: hidden` 이라 스크롤 상자다)가 밀리면 되돌린다. 이 상자는 `clip` 이라 스스로는 밀리지
   * 않지만, 밖으로 밀린 터미널 층의 캐럿을 브라우저가 보이게 하려고 **조상**을 밀 수 있다(넘어가는 도중의 IME 조합 등) — 그 그물.
   */
  $effect(() => {
    const box = root?.closest<HTMLElement>(".pane-box");
    if (!box || !flippable) return;
    const onScroll = () => {
      if (box.scrollLeft !== 0 || box.scrollTop !== 0) {
        box.scrollLeft = 0;
        box.scrollTop = 0;
      }
    };
    box.addEventListener("scroll", onScroll);
    return () => box.removeEventListener("scroll", onScroll);
  });
</script>

{#snippet qaNote(key: string)}
  {@const s = qaSummaries.find((x) => x.id === key)}
  {#if s}
    <!-- 질문 카드에서 보낸 답(A안 — 사람 말풍선 안): 흐린 머리 줄(체크 + 질문 N개에 답함) · 2열 격자(흐린 머리 | 답) — 사람이 고르거나 친 글 그대로 -->
    <div class="qa-sent" role="note" data-tile-qa-summary>
      <span class="qa-title"
        ><UiIcon name="check" size={12} />{s.lines.length > 1
          ? t("pane.perm.answeredN", { n: s.lines.length })
          : t("pane.perm.answeredOne")}</span
      >
      <div class="qa-grid">
        {#each s.lines as l, i (i)}
          <span class="qa-head">{l.header || `Q${i + 1}`}</span><span class="qa-answer">{l.answer}</span>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flip"
  class:convo={view === "convo"}
  bind:this={root}
  data-flip={flippable ? view : null}
  onkeydowncapture={onKeydownCapture}
>
  <div class="layer term" class:off={view === "convo"} bind:this={termEl} data-flip-term onfocusin={onTermFocusIn}>
    {@render children()}
  </div>
  {#if codexBand}
    <!-- Codex 가 권한을 기다린다 — 터미널에는 창이 없다(`Running hook`) · 누르면 대화 면으로 -->
    <button type="button" class="perm-band" class:phone data-tile-perm-band onclick={() => setFlipView(pane.id, "convo")}>
      <UiIcon name="shield-check" size={14} />
      <span>{t(permCards.some((c) => c.cli === "codex" && c.kind === "question") ? "pane.perm.bandQuestion" : "pane.perm.band")}</span>
    </button>
  {/if}
  {#if mounted && flippable}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="layer talk"
      class:on={view === "convo"}
      bind:this={convoEl}
      inert={view !== "convo"}
      aria-label={t("pane.flip.convo.aria")}
      role="region"
      data-flip-convo
      onpointerup={onConvoPointerUp}
    >
      <DomFindBar bind:this={finder} root={bodyEl} scroller={() => bodyEl} label={t("pane.flip.find")} onclose={onFindClose} />
      {#if convKey === null}
        <!-- 대화를 아직 모른다(첫 메시지 전) — 빈 면 + 입력 칸만(문구 없음) · 답한 질문의 요약은 아래쪽에 -->
        <div class="blank" data-flip-blank>
          {#each qaSummaries as s (s.id)}<div class="qa-bubble">{@render qaNote(s.id)}</div>{/each}
        </div>
      {:else}
        <TranscriptBody
          {convKey}
          {fetchPage}
          {failureOf}
          emptyText={convoPending ? "" : undefined}
          follow={view === "convo" && shown}
          followMs={remoteAlias !== null ? FOLLOW_REMOTE_MS : FOLLOW_LOCAL_MS}
          column
          {pending}
          onsettled={dropPending}
          chat
          {activity}
          diagrams
          notes={qaNotes}
          noteCard={qaNote}
          {images}
          {pictures}
          paths={pathLinks}
          bind:bodyEl
        />
      {/if}
      {#if permTraces.length > 0}
        <div class="perm-traces" role="status" data-tile-perm-traces>
          {#each permTraces as tr (tr.id)}
            <div class="perm-trace" data-tile-perm-trace={tr.kind}>
              {t(tr.kind === "auto" ? "pane.perm.trace.auto" : "pane.perm.trace.terminal", { tool: tr.card.tool, target: cardTarget(tr.card) }).trim()}
            </div>
          {/each}
        </div>
      {/if}
      {#if trustHint}
        <!-- Codex 첫 실행 신뢰 안내 — 입력 칸 바로 위 말풍선(입력 칸과 같은 760 단 · 닫으면 다시 안 뜸) -->
        <div class="trust-row">
          <div class="trust-hint" role="note" data-codex-trust-hint>
            <span class="trust-text">{t("pane.perm.trustHint")}</span>
            <button
              type="button"
              class="trust-x"
              data-codex-trust-hint-close
              title={t("app.actions.close")}
              aria-label={t("app.actions.close")}
              onclick={closeCodexTrustHint}><UiIcon name="close" size={14} /></button
            >
          </div>
        </div>
      {/if}
      {#if trustAsked && !trustHidden}
        <!-- Claude 폴더 신뢰 질문 — 질문이 떠 있는 동안만(답하면 스스로 사라진다) · ✕ 는 이번 질문에서만 -->
        <div class="trust-row">
          <div class="trust-hint" role="note" data-claude-trust-hint>
            <span class="trust-text">{t("pane.flip.trust.ask")}</span>
            <button
              type="button"
              class="trust-x"
              data-claude-trust-hint-close
              title={t("app.actions.close")}
              aria-label={t("app.actions.close")}
              onclick={() => (trustHidden = true)}><UiIcon name="close" size={14} /></button
            >
            <button type="button" class="trust-go" data-claude-trust-terminal onclick={permToTerminal}
              >{t("pane.flip.gate.toTerminal")}</button
            >
          </div>
        </div>
      {/if}
      {#if permCards.length > 0}
        <div class="perms" data-tile-perms>
          {#each permCards as card (card.requestId)}
            <TilePermissionCard {card} now={permNow} {phone} onterminal={permToTerminal} />
          {/each}
        </div>
      {/if}
      <!-- 카드가 서 있는 동안 입력 칸은 숨기기만 한다(친 글 · 첨부를 잃지 않게 — 답이 먼저다) -->
      <div class="composer-slot" class:held={permCards.length > 0} class:bottom={mobileLayout()}>
      <FlipComposer
        permission={permission || tuiAsking}
        gate={trustGate}
        {stoppable}
        terminalKeys
        oninterrupt={stopTurn}
        onsend={send}
        onterminal={toTerminal}
        {attachments}
        onremove={(id) => removeComposerAttachment(pane.id, id)}
        onattach={attach}
        prefill={flipPrefillOf(pane.id)}
        onprefilled={(n) => clearFlipPrefill(pane.id, n)}
        bind:inputEl={composerEl}
      />
      </div>
    </div>
  {/if}
</div>

<style>
  /* 상자 — 두 층이 같은 크기로 겹친다. `clip`: 밖으로 밀린 층이 비치지 않고, 스크롤 상자도 아니다(포커스 · 캐럿이 못 민다) */
  .flip {
    position: absolute;
    inset: 0;
    overflow: clip;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  /* 터미널 층 — 쉴 때는 `transform` 없음(평소 타일과 같은 그림). 대화 면이면 왼쪽 밖에 밀어 둔다 — 숨기지 않는다 */
  .term.off {
    transform: translateX(-100%);
    pointer-events: none;
  }

  /*
   * 대화 층 — 글을 읽는 면이라 불투명(`--surface-raised-solid` — 시트와 같은 면 · 터미널 테마 색과 상관없이 읽힌다).
   * 터미널 면이면 오른쪽 밖에 있다.
   */
  .talk {
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    transform: translateX(100%);
  }

  .talk.on {
    transform: none;
  }

  .blank {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
  }

  /*
   * 답한 질문의 요약(A안 — 사람 말풍선 안). 판은 `TranscriptBody` 의 사람 말풍선(`.body.chat .item.user`)이 그린다 — 여기는 안쪽만. 대화를 아직
   * 몰라 기록 몸이 없을 때(빈 면)만 같은 값의 판(`.qa-bubble`)을 따로 두른다.
   */
  .qa-sent {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-ui);
  }

  .qa-title {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .qa-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-3);
    row-gap: 2px;
    font-size: var(--t-sm);
    line-height: 1.5;
  }

  .qa-head {
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .qa-answer {
    min-width: 0;
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  /* 빈 면의 말풍선 — 기록 몸의 사람 말풍선과 같은 값(오른쪽 · 최대 78% · 강조색의 옅은 판 · 오른쪽 아래 모서리만 작게) */
  .qa-bubble {
    align-self: flex-end;
    max-width: 78%;
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-raised-solid));
    border-radius: 12px 12px 4px 12px;
  }

  /* 권한 카드들 — 입력 칸 자리(길면 이 칸만 스크롤 · 기록이 위에 남는다) */
  /* 권한 · 질문 카드 — 기록 · 입력 칸(`FlipComposer` 의 `.composer`)과 같은 가운데 760 단 · 같은 좌우 여백(2026-11-03 — 넓은 타일에서 카드만 끝까지 늘던 것) */
  .perms {
    flex: 0 1 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    max-height: 72%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-5) var(--space-3);
  }

  .composer-slot.held {
    display: none;
  }

  /* 폰의 대화 면 — 키 띠가 숨어(`mobile/MobileKeys`) 입력 칸이 화면 맨 아래다. 띠가 맡던 아래 안전 여백을 여기서 */
  .composer-slot.bottom {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* 흔적 한 줄(자동 허용 · 터미널에서 답함) — 흐리게 잠깐 */
  .perm-traces {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-3) 0;
  }

  .perm-trace {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Codex 첫 실행 신뢰 안내 — 입력 칸 바로 위 말풍선. 줄은 입력 칸(`FlipComposer` 의 `.composer`)과 같은 760 단 · 같은 좌우 여백 */
  .trust-row {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-2) 0 0;
    /* 좁은 타일의 말풍선 여백(아래 `@container` — 이 줄 자신이 그릇이다. 대화 층에 걸면 그 층이 고정 위치 자식의 기준 상자가 된다) */
    container: trust-row / inline-size;
  }

  /* 안내 말풍선 — 옅게 누런 면 + 입력 칸을 가리키는 꼬리(목업 ECxt7kCXrca2NqrTJU93jf · Codex · Claude 공용) */
  .trust-hint {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-1) var(--space-2);
    margin: 0 var(--space-5);
    padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--hint-bubble-fg);
    background: var(--hint-bubble-bg);
    border: 1px solid var(--hint-bubble-line);
    border-radius: var(--radius-surface-inner);
  }

  .trust-hint::after {
    content: "";
    position: absolute;
    left: 30px;
    bottom: -6px;
    width: 10px;
    height: 10px;
    background: var(--hint-bubble-bg);
    border-right: 1px solid var(--hint-bubble-line);
    border-bottom: 1px solid var(--hint-bubble-line);
    transform: rotate(45deg);
  }

  /* 글 · ✕ 아래 줄 — 글이 그 줄을 채운다 */
  .trust-go {
    order: 3;
    margin-right: auto;
    padding: 3px 10px;
    font: inherit;
    font-weight: 500;
    color: var(--hint-bubble-bg);
    background: var(--hint-bubble-fg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .trust-go:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 좁은 타일(폰 · 나란히 나뉜 칸) — 말풍선 여백을 줄인다(글 폭이 먼저) */
  @container trust-row (max-width: 420px) {
    .trust-hint {
      gap: var(--space-1);
      margin: 0 var(--space-3);
      padding-left: var(--space-2);
    }
  }

  .trust-text {
    flex: 1 1 calc(100% - 40px);
    min-width: 0;
    word-break: keep-all; /* 한글을 음절 가운데서 끊지 않는다 */
    overflow-wrap: anywhere;
  }

  .trust-x {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .trust-x:hover {
    color: inherit;
    background: var(--control-ghost-hover);
  }

  /*
   * Codex 터미널 면의 띠 — 터미널 위쪽(입력 줄은 아래라 가리지 않는다). 터미널 층은 쌓임 맥락을 만들지 않아 그 안의 겹(배너 4 · 토스트 5 ·
   * xterm 데코레이션 6~8 · 스크롤 막대 11 · 트리거 팁 20 · 블록 보기 20/21)이 이 띠와 같은 층에서 겨룬다 — 2026-11-02 실기에서 z-index 2 띠가
   * 실제 앱에서는 보이지 않았다. 그 위로 올린다.
   */
  .perm-band {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-3));
    padding: 4px var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-raised-solid));
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .perm-band span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .perm-band.phone {
    min-height: 36px;
  }

  @media (pointer: coarse) {
    .perm-band {
      min-height: 36px;
    }
  }
</style>
