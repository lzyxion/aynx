<script lang="ts">
  /**
   * AI 타일 안에서 [터미널 | 대화] 넘기기 — 터미널 타일의 몸을 언제나 감싼다(감싸개가 AI 판정에 따라 생겼다 사라지면 `<Terminal>` 이 재마운트되고,
   * 그 언마운트가 곧 세션 종료다). 터미널 층은 숨기지 않는다 — `transform` 으로 밀어 둘 뿐이라 refit 이 없고 WebGL 을 떼지 않으며 출력도 계속 쌓인다.
   * 보내기는 그 타일 터미널의 사람 입력 문(`TermActions.submitText` · `sendKeys` · `sendEscape`)뿐이라 새 쓰기 길 · Tauri 명령이 없다.
   * 모델 메뉴 · 전환 확인 카드 · [중지] 가 보내는 것은 고정 허용 목록 낱말 · 고정 키뿐이고 화면 · 기록에서 읽은 글자는 표시에만 쓴다 — "AI 문자열→PTY 길은 없다"(불변식 4).
   * 코드 블록의 [터미널에 넣기] 는 입력 줄에 넣기만 한다 — Enter 는 사람.
   */
  import { onDestroy, tick, untrack, type Snippet } from "svelte";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import TouchSelection from "$lib/term/TouchSelection.svelte";
  import ImageMenu from "$lib/ImageMenu.svelte";
  import { createTextSelectBar } from "$lib/text-select-bar.svelte.js";
  import { selectAllIn } from "$lib/doc/context-actions";
  import { commandsOf } from "$lib/shell-integration";
  import { writeClipboard } from "$lib/clipboard";
  import type { TileMenu } from "$lib/pane/tile-menu-controller.svelte.js";
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
  import { codeToTerminal } from "$lib/app/code-to-term.svelte.js";
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
  import { attachmentPaths, tileAttachPastes, type SentPic } from "$lib/pane/composer-attachments";
  import {
    clearComposerAttachments,
    composerAttachmentsOf,
    removeComposerAttachment,
    revokeSentPics,
    stageComposerAttachments,
    takeComposerPictures,
  } from "$lib/pane/composer-attachments.svelte.js";
  import TilePermissionCard from "$lib/pane/TilePermissionCard.svelte";
  import ChatModelKeyword, { type KeywordView } from "$lib/chat/ChatModelKeyword.svelte";
  import FlipModelMenu, { type FlipModelRow } from "$lib/pane/FlipModelMenu.svelte";
  import FlipModelSwitchCard from "$lib/pane/FlipModelSwitchCard.svelte";
  import { loadCodexModels, type CodexModels } from "$lib/app/side-chats.svelte.js";
  import { modelLabel } from "$lib/model-order";
  import { effortName } from "$lib/chat/side-chat-controls.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { aiDisplayName } from "$lib/pane-icons";
  import {
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_MODEL_ALIASES,
    CLAUDE_MODEL_DEFAULT,
    claudeTierOf,
    codexEffortLine,
    codexLevelsFor,
    codexMenuModels,
    codexModelLine,
    flipEffortLevels,
    flipModelLocked,
    slashEffortLine,
    slashModelLine,
    tuiInputHolds,
    tuiInputLeftover,
    type LastModel,
  } from "$lib/pane/flip-model";
  import {
    claudeSwitchAsk,
    latestAck,
    overrideOf,
    settleOverride,
    shownModel,
    SWITCH_NO_KEY,
    SWITCH_YES_KEY,
    type ModelOverride,
    type SentKind,
    type SwitchAsk,
  } from "$lib/pane/flip-model-ack";
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
    onmenu,
    children,
  }: {
    pane: PaneSpec;
    sessionId?: number | null;
    shown?: boolean;
    onopenpath?: (target: NonNullable<ResolvedPath>, line?: number) => void;
    /** 대화 면 본문의 메뉴를 열어 달라 — 터미널 본문 우클릭과 같은 타일 메뉴(`convo` 가 실린다) */
    onmenu?: (x: number, y: number, ctx: NonNullable<TileMenu["term"]>) => void;
    children: Snippet;
  } = $props();

  const PAGE = 40;
  const FOLLOW_LOCAL_MS = 1500;
  const FOLLOW_REMOTE_MS = 3000;
  const GONE = "\u0000remote-gone";
  const LINE_PX = 40;

  const flippable = $derived(canFlipPane(pane));
  const view = $derived(flippable ? flipViewOf(pane.id) : "term");
  const remoteAlias = $derived(flipRemoteAlias(pane));
  const link = $derived(flippable ? agentLinkOf(pane.id) : null);
  const convKey = $derived(
    link ? `${remoteAlias !== null ? `${remoteAlias.toLowerCase()}|` : ""}${link.agent}:${link.id}` : null,
  );
  /** 처음 넘길 때 서고 AI 타일인 동안 남는다 — 읽던 자리가 다음 넘김에도 그대로다 */
  let mounted = $state(false);
  $effect(() => {
    if (view === "convo") mounted = true;
    else if (!flippable) mounted = false;
  });

  $effect(() => {
    if (!flippable && untrack(() => flipViewOf(pane.id)) === "convo") setFlipView(pane.id, "term");
  });
  onDestroy(() => forgetFlip(pane.id));

  let root = $state<HTMLDivElement | null>(null);
  let termEl = $state<HTMLDivElement | null>(null);
  let convoEl = $state<HTMLDivElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);
  let composerEl = $state<HTMLTextAreaElement | null>(null);
  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);

  const permission = $derived(flippable && agentStatusOf(pane) === "permission");
  // ── 타일 권한 카드 ────────────────────────────────

  const stream = $derived(pane.historyStreamId ?? pane.id);
  /** 훅은 로컬 AI 타일의 CLI 에만 실린다 */
  const permTile = $derived(flippable && pane.kind === "local");
  const permCards = $derived(permTile ? tilePermCardsOf(stream) : []);
  const permTraces = $derived(permTile ? tilePermTracesOf(stream) : []);
  // F5 · 재부착에는 `seq` 가 없다 — 스냅숏으로 다시 그린다
  $effect(() => {
    if (!permTile) return;
    const s = stream;
    void sessionId;
    untrack(() => void watchTilePermissions(s));
  });
  // ── 면 규칙 ────────────────────────────────
  // 대화 면으로 보는 창이 하나도 없으면 서버가 카드 없이 TUI 가 묻게 한다. 정리 함수로 거짓을 보내지 않는다 — 면이 바뀔 때마다
  // 거짓 → 참이 가면 그 틈에 카드가 풀린다(타일이 사라질 때만 거짓).
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
  const qaSummaries = $derived(permTile ? questionSummariesOf(stream, link?.id ?? null) : []);
  const qaNotes = $derived(qaSummaries.map((s) => ({ key: s.id, at: s.at, user: true })));

  /** 카드 없이 물러났거나 카드가 풀렸다 — 턴이 끝났으면 걷는다 */
  const tuiAsking = $derived(
    permTile && permCards.length === 0 && tileTuiAskingOf(stream) && agentStatusOf(pane) !== "finished",
  );

  let permNow = $state(Date.now());
  $effect(() => {
    if (permCards.length === 0) return;
    permNow = Date.now();
    const h = setInterval(() => (permNow = Date.now()), 1000);
    return () => clearInterval(h);
  });
  const phone = $derived(handheld());
  /** Codex 는 기다리는 동안 TUI 에 창이 없다 — Claude 는 TUI 창이 함께 떠 있어 띄우지 않는다 */
  const codexBand = $derived(view === "term" && permCards.some((c) => c.cli === "codex"));
  /** 닫으면 다시 안 뜬다 */
  const trustHint = $derived(permTile && agentKindOf(pane) === "codex" && codexTrustHintShown());

  // ── Claude 폴더 신뢰 질문 (docs/log/2026-11-04-trust-bubble.md) ────────────────────────────────
  // 질문 동안 훅이 오지 않아 화면을 읽는다. 그동안 입력 칸을 막는다 — Enter 가 그 답이 되고 기본 선택이 "No, exit" 라 CLI 가 끝난다. ✕ 는 말풍선만 숨긴다.
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
  /** 이번 질문에서만(저장 안 함) */
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

  // ── Claude 의 모델 전환 확인 카드 ────────────────────────────────
  // [전환] · [취소] 는 고정 키(`SWITCH_YES_KEY` · `SWITCH_NO_KEY`)만 사람 입력 문으로 보낸다 — 화면에서 읽은 모델 이름은 카드 제목 표시에만 쓴다(불변식 4).
  let switchAsk = $state<SwitchAsk | null>(null);
  const SWITCH_POLL_MS = 1000;
  /** 답을 보낸 뒤 CLI 가 다시 그릴 틈 — 남은 확인 화면을 새 확인으로 보지 않게 */
  const SWITCH_GRACE_MS = 1500;
  let switchQuietUntil = 0;
  function readSwitch(): SwitchAsk | null {
    return claudeSwitchAsk(termActionsOf(pane.id)?.screenLines() ?? []);
  }
  $effect(() => {
    if (!claudeTile || view !== "convo" || !shown) {
      switchAsk = null;
      return;
    }
    const check = () => {
      if (Date.now() < switchQuietUntil) return;
      const a = readSwitch();
      if (a?.kind !== switchAsk?.kind || a?.name !== switchAsk?.name) switchAsk = a;
    };
    untrack(check);
    const h = setInterval(check, SWITCH_POLL_MS);
    return () => clearInterval(h);
  });
  const switchGate = $derived(switchAsk ? { text: t("pane.flip.switch.gate"), quiet: true } : null);
  /** 보내기 직전에 그 확인이 아직 떠 있는지 다시 본다 — 아니면 보내지 않고 카드만 걷는다 */
  function answerSwitch(yes: boolean): void {
    const id = pane.id;
    const now = readSwitch();
    switchAsk = null;
    if (now === null) return;
    const acts = termActionsOf(id);
    if (!acts) {
      showNotice(t("pane.flip.composer.closed"));
      return;
    }
    switchQuietUntil = Date.now() + SWITCH_GRACE_MS;
    acts.sendKeys(yes ? SWITCH_YES_KEY : SWITCH_NO_KEY);
    if (yes) watchAck(id, "claude", { kind: now.kind, line: null });
    focusComposer();
  }

  function permToTerminal(): void {
    setFlipView(pane.id, "term");
    focusTerm();
  }

  const activity = $derived.by((): "running" | "permission" | "idle" => {
    const s = flippable ? agentStatusOf(pane) : null;
    return s === "running" ? "running" : s === "permission" ? "permission" : "idle";
  });

  // ── [중지] ────────────────────────────────
  // 고정 키 Esc 하나를 사람 키와 같은 문(`TermActions.sendEscape`)으로 보낸다 — AI 문자열이 아니라 "AI 문자열→PTY 길은 없다" 와 부딪치지 않는다.

  const stoppable = $derived(flippable && stopShown({ status: agentStatusOf(pane), cards: permCards.length }));
  /** Claude 의 Esc 두 번(되감기 메뉴)이 되지 않게 한 번만 */
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
    // Claude 는 Esc 에 훅이 없어 실행 표시 · 탭 점이 다음 신호까지 남는다 — 서버 표에 "사람이 끊음" 을 적는다
    noteAgentInterrupted(pane);
  }

  // ── 입력 칸 — 보내기 · 보내는 중 말풍선 ───────────────────────────────────────────────

  const PENDING_MS = 20_000;
  let pending = $state<{ id: number; text: string; files?: readonly string[]; pics?: readonly SentPic[] }[]>([]);
  let pendingSeq = 0;
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function dropPending(id: number): void {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pendingTimers.delete(id);
    // 기록에 들면 그 줄의 `pictures` 가 그린다
    revokeSentPics(pending.find((p) => p.id === id)?.pics);
    if (pending.some((p) => p.id === id)) pending = pending.filter((p) => p.id !== id);
  }

  const attachments = $derived(composerAttachmentsOf(pane.id));
  onDestroy(() => clearComposerAttachments(pane.id));

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

  /** 보냈으면 참 — 첨부 경로는 괄호 붙여넣기로 글보다 먼저 넣는다(`submitText` 의 `attach`) */
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
    const pics = takeComposerPictures(pane.id);
    if (files.length === 0) retryEnter(pane.id, agentKindOf(pane) ?? link?.agent ?? "", text.trim());
    cliPastTrust = true; // 사람이 말했다 — 그 뒤로 화면을 읽을 까닭이 없다
    // 대화를 바꾸는 Codex 명령(`/new` · `/resume` …)이면 옛 연결을 버린다 — 새 대화는 첫 질문의 신호가 잇는다
    if (agentPromptSent(pane.id, text) || text.trim() === "") {
      revokeSentPics(pics);
      return true;
    }
    const id = ++pendingSeq;
    pending = [...pending, { id, text, files, ...(pics.length > 0 ? { pics } : {}) }];
    pendingTimers.set(id, setTimeout(() => dropPending(id), PENDING_MS));
    return true;
  }
  onDestroy(() => {
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    for (const p of untrack(() => pending)) revokeSentPics(p.pics);
  });

  // ── 입력 칸의 [+] · 모델 키워드 ────────────────────────────────

  let pickEl = $state<HTMLInputElement | null>(null);
  function onPicked(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) attach(files);
  }

  /** 표시 전용 — 터미널로 보내지 않는다 */
  let recordModel = $state<LastModel | null>(null);
  /** 화면에서 읽은 글자라 표시 전용 — 보내는 줄에는 쓰지 않는다(불변식 4). 대화가 바뀌면 걷는다 */
  let modelOverride = $state<ModelOverride | null>(null);
  /** 최신 쪽의 `last` 가 실린 줄 자리(`null` = 기록에 아직 값이 없다 · `undefined` = 이 대화의 쪽을 아직 못 받았다) */
  let recordLastAt: number | null | undefined = undefined;
  const lastModel = $derived(shownModel(recordModel, modelOverride));
  const modelCli = $derived(flippable ? (agentKindOf(pane) ?? link?.agent ?? null) : null);
  /** 폴더 신뢰 질문 중에도 잠근다 — Enter 가 그 답이 된다 */
  const modelLocked = $derived(
    trustAsked || switchAsk !== null || flipModelLocked({ status: flippable ? agentStatusOf(pane) : null, cards: permCards.length, tuiAsking }),
  );
  let modelOpen = $state(false);
  let modelBtn = $state<HTMLElement | null>(null);
  $effect(() => {
    if (modelLocked || view !== "convo" || modelCli === null) modelOpen = false;
  });

  /** SSH 타일의 Codex 는 그 서버의 목록을 몰라 `null` — 메뉴는 게이지만 */
  let codexList = $state<CodexModels | null>(null);
  const codexLocal = $derived(modelCli === "codex" && pane.kind === "local");
  $effect(() => {
    if (!codexLocal) {
      codexList = null;
      return;
    }
    untrack(() => void loadCodexModels().then((v) => (codexList = v)));
  });

  const modelKeyword = $derived.by((): KeywordView | null => {
    const cli = modelCli;
    if (cli === null) return null;
    const last = lastModel;
    const name = aiDisplayName(cli) ?? cli;
    const label = last ? modelLabel(last.model) : null;
    const effort = last?.effort ?? "";
    const head = label === null ? `${name} · ${t("pane.flip.model.unknown")}` : `${name} · ${label}${effort ? ` · ${t("app.chatDock.effort.chip", { e: effortName(effort) })}` : ""}`;
    return {
      cli,
      label,
      efforts: effort ? flipEffortLevels(cli, codexList, last?.model ?? null) : [],
      effort,
      title: modelLocked ? `${head}\n${t("pane.flip.model.busy")}` : head,
      open: modelOpen,
      locked: modelLocked,
      onopen: (el) => {
        modelBtn = el;
        modelOpen = !modelOpen;
        if (modelOpen && codexLocal) void loadCodexModels().then((v) => (codexList = v));
      },
    };
  });

  /** Claude 의 Default 줄은 기록으로 고르지 않는다 — 기록에는 실제로 쓴 모델만 있어 고정 없음과 구별되지 않는다 */
  const menu = $derived.by((): { models: FlipModelRow[]; levels: readonly string[]; effort: string; ring: boolean; note: string } | null => {
    const cli = modelCli;
    const last = lastModel;
    if (cli === "claude") {
      const tier = last ? claudeTierOf(last.model) : null;
      const e = last?.effort ?? "";
      return {
        models: [
          { value: CLAUDE_MODEL_DEFAULT, label: t("app.chatDock.cliDefault"), checked: false },
          ...CLAUDE_MODEL_ALIASES.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1), checked: m === tier })),
        ],
        levels: CLAUDE_EFFORT_LEVELS,
        effort: CLAUDE_EFFORT_LEVELS.includes(e) ? e : "",
        ring: true,
        note: t("pane.flip.model.note.claude"),
      };
    }
    if (cli === "codex") {
      const list = codexList;
      return {
        models: codexMenuModels(list).map((m) => ({ value: m, label: modelLabel(m), checked: m === last?.model })),
        levels: codexLevelsFor(list, last?.model ?? null),
        effort: last?.effort ?? "",
        ring: false,
        note: t("pane.flip.model.note.codex"),
      };
    }
    return null;
  });

  function closeModel(back: boolean): void {
    modelOpen = false;
    if (back) modelBtn?.focus({ preventScroll: true });
  }

  /** `line` 은 `flip-model.ts` 의 허용 목록 낱말로만 지은 것이다 — 기록에서 읽은 모델 이름 · 강도는 이 줄에 실리지 않는다(불변식 4) */
  function sendFixedLine(paneId: string, line: string, cli: string | null): boolean {
    const r = termActionsOf(paneId)?.submitText(line) ?? "closed";
    if (r === "closed") showNotice(t("pane.flip.composer.closed"));
    if (r === "ok" && cli !== null) retryEnter(paneId, cli, line);
    return r === "ok";
  }

  /**
   * 새로 뜬 Codex 는 첫 입력 묶음 뒤의 Enter 를 먹지 않는다 — 입력 줄이 보낸 한 줄 그대로면 Enter 하나를 한 번만 더 보낸다.
   * 화면 글자는 비교에만 쓰고 보내는 것은 늘 `\r` 하나다(불변식 4).
   */
  const ENTER_RETRY_MS = 700;
  function retryEnter(paneId: string, cli: string, sent: string): void {
    if (cli !== "codex" || sent.includes("\n")) return;
    setTimeout(() => {
      if (paneId !== pane.id) return;
      const acts = termActionsOf(paneId);
      const screen = acts?.screenBottom(INPUT_SCAN_ROWS);
      if (acts && screen && tuiInputHolds(cli, screen.lines, sent)) acts.sendKeys("\r");
    }, ENTER_RETRY_MS);
  }

  // ── 보낸 뒤 CLI 의 확인 문구 기다리기 ────────────────────────────────
  // 화면 글자는 표시에만 쓴다 — 여기서 읽은 것은 어떤 줄에도 실리지 않는다(불변식 4).
  const ACK_WAIT_MS = 3000;
  const ACK_POLL_MS = 150;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  function stopAck(): void {
    if (ackTimer !== null) clearTimeout(ackTimer);
    ackTimer = null;
  }
  onDestroy(stopAck);
  function screenOf(paneId: string): string[] {
    return termActionsOf(paneId)?.screenLines() ?? [];
  }
  function watchAck(paneId: string, cli: string, sent: { kind: SentKind; line: string | null }): void {
    stopAck();
    const conv = convKey;
    const t0 = Date.now();
    const step = () => {
      ackTimer = null;
      if (convKey !== conv || modelCli !== cli || paneId !== pane.id) return;
      const lines = screenOf(paneId);
      if (cli === "claude") {
        const ask = claudeSwitchAsk(lines);
        // 확인 대기 — 바꾸지 않고 카드를 곧바로 세운다
        if (ask !== null && Date.now() >= switchQuietUntil) {
          if (view === "convo" && shown) switchAsk = ask;
          return;
        }
        // 카드로 답한 직후 — 아직 지워지지 않은 확인 화면이다. 확인 문구를 계속 기다린다
        if (ask !== null) {
          if (Date.now() - t0 < ACK_WAIT_MS) ackTimer = setTimeout(step, ACK_POLL_MS);
          return;
        }
      }
      const r = latestAck(cli, sent, lines);
      if (r !== "wait") {
        modelOverride = overrideOf(modelOverride, r.ack, recordLastAt);
        return;
      }
      if (Date.now() - t0 < ACK_WAIT_MS) ackTimer = setTimeout(step, ACK_POLL_MS);
    };
    ackTimer = setTimeout(step, ACK_POLL_MS);
  }

  /** 인라인으로 그리는 CLI 는 입력 줄이 바닥에 붙어 있지 않을 수 있어 화면 전체를 본다 */
  const INPUT_SCAN_ROWS = 60;

  /** 사람이 치다 만 글이 TUI 입력 줄에 보이면 보내지 않는다 — 이어 치면 명령이 아니라 말이 된다(입력 줄을 못 찾으면 막지 않는다) */
  function modelSendable(cli: string): boolean {
    if (modelLocked) return false;
    if (trustWatch && readTrustPrompt()) {
      trustAsked = true;
      return false;
    }
    const screen = termActionsOf(pane.id)?.screenBottom(INPUT_SCAN_ROWS);
    if (screen && tuiInputLeftover(cli, screen.lines) === true) {
      showNotice(t("pane.flip.model.leftover"));
      return false;
    }
    return true;
  }

  function sendPicked({ id, cli, line, sent }: { id: string; cli: string; line: string; sent: SentKind }): void {
    if (sendFixedLine(id, line, cli)) watchAck(id, cli, { kind: sent, line });
    focusComposer();
  }

  function pickModel(value: string): void {
    runOnMenu(
      () => {
        const cli = modelCli;
        const line =
          cli === "claude" ? slashModelLine(value) : cli === "codex" ? codexModelLine(codexList, value, lastModel?.effort) : null;
        return cli !== null && line !== null && modelSendable(cli) ? { id: pane.id, cli, line, sent: "model" as const } : null;
      },
      () => closeModel(false),
      sendPicked,
    );
  }

  function pickEffort(level: string): void {
    runOnMenu(
      () => {
        const cli = modelCli;
        const line = cli === "claude" ? slashEffortLine(level) : cli === "codex" ? codexEffortLine(level) : null;
        return cli !== null && line !== null && modelSendable(cli) ? { id: pane.id, cli, line, sent: "effort" as const } : null;
      },
      () => closeModel(false),
      sendPicked,
    );
  }

  // ── 쪽 받기 ────────────────────────────────

  /** 원격의 새 대화는 별칭 캐시에 없어 목록을 다시 읽는다 */
  const refreshed = new Map<string, number>();

  // ── "대화가 아직 없음" ────────────────────────────────

  const loadedConvs = new Set<string>();
  const ranConvs = new Set<string>();
  const turnEndedConvs = new Set<string>();
  $effect(() => {
    const k = convKey;
    const a = activity;
    if (k === null) return;
    if (a !== "idle") ranConvs.add(k);
    else if (ranConvs.has(k)) turnEndedConvs.add(k);
  });
  let convoPending = $state(false);
  $effect(() => {
    void convKey;
    convoPending = false;
    recordModel = null;
    modelOverride = null;
    recordLastAt = undefined;
    stopAck();
  });

  // ── 그림 ────────────────────────────────

  const imageCache = new DocImageCache();
  onDestroy(() => imageCache.dispose());
  /** 상대 경로의 기준 — CLI 의 cwd ≈ 그 타일 셸이 마지막으로 알린 폴더 */
  const imageFolder = $derived(remoteAlias !== null ? reportedCwd(pane.id) : localReportedFolder(pane));
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
  const codeActions = {
    onterm: (code: string, button: HTMLElement) => {
      const r = button.getBoundingClientRect();
      codeToTerminal(pane.id, code, { x: r.right, y: r.bottom + 4, align: "right" }, button);
    },
  };
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
  let imageSrcs: readonly string[] = [];
  $effect(() => {
    const ctx = imageCtx;
    void ctx.backend.online;
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

  const picCache = new ConvImageCache();
  onDestroy(() => picCache.dispose());
  /** 원격은 세션까지 — 재접속하면 못 읽은 것도 다시 */
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

  async function fetchPage(before: number | null): Promise<TranscriptPage> {
    const key = convKey;
    const page = await fetchPageRaw(before);
    if (key !== null && key === convKey) {
      loadedConvs.add(key);
      convoPending = false;
      // 최신 쪽만 마지막 답의 모델 · 강도를 싣는다 — 못 실었으면(이 쪽 밖) 앞서 받은 값을 쥔다
      if (before === null && page.last) recordModel = { model: page.last.model, effort: page.last.effort ?? null };
      if (before === null) {
        // 값을 실은 줄(Claude 답 줄 · Codex `turn_context`)이 덮은 뒤의 새 줄이면 다시 기록을 따른다 — 사람 말 · 도구 항목으로는 걷지 않는다
        const at = page.last ? (page.last.at ?? null) : undefined;
        if (at !== undefined) recordLastAt = at;
        else if (recordLastAt === undefined) recordLastAt = null;
        const ov = settleOverride(modelOverride, at);
        if (ov !== modelOverride) modelOverride = ov;
      }
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
    // 대화 파일이 아직 없다(첫 말 전) — 오류가 아니라 빈 면
    if (k !== null && convoNotYet({ loaded: loadedConvs.has(k), turnEnded: turnEndedConvs.has(k), gone })) {
      convoPending = true;
      return "";
    }
    convoPending = false;
    if (gone) return t("board.viewer.remoteGone", { host: remoteAlias });
    return t("board.viewer.error", { e: stripReason(msg) });
  }

  // ── 움직임 — 카드 뒤집기 ──────────────────────────────────────────────────────────

  const motion = new FlipMotion();
  onDestroy(() => motion.stop());

  async function flip(from: "term" | "convo", to: "term" | "convo"): Promise<void> {
    await tick(); // 대화 층이 막 섰을 수 있다
    if (!flippable) {
      motion.stop();
      return;
    }
    motion.flip(pane.id, from, to, root?.closest<HTMLElement>(".pane-box") ?? null, termEl, convoEl);
  }

  let lastView: "term" | "convo" | null = null;
  /** 폰의 자동 열기 — 뒤집지 않고 포커스도 주지 않는다(입력 칸에 주면 화면 키보드가 올라와 기록을 가린다) */
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

  /** 반응형이 아니다 */
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

  function focusTerm(): void {
    termEl?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }

  function focusComposer(): boolean {
    if (!composerEl || permCards.length > 0) return false;
    composerEl.focus({ preventScroll: true });
    return true;
  }

  /** 다른 곳(모달 · 다른 타일)에 포커스가 있으면 건드리지 않는다 · 대화 층이 막 섰을 수 있어 한 틱 뒤에 본다 */
  async function settleFocus(to: "term" | "convo"): Promise<void> {
    await tick();
    const box = root?.closest<HTMLElement>("[data-pane]") ?? null;
    const el = document.activeElement;
    const lost = el === null || el === document.body || el === document.documentElement;
    if (!lost && (box === null || !box.contains(el))) return;
    if (to === "term") focusTerm();
    else if (!focusComposer()) bodyEl?.focus({ preventScroll: true });
  }

  function onTermFocusIn(ev: FocusEvent): void {
    if (view !== "convo") return;
    // 폰 — 칸으로 옮기면 화면 키보드가 올라온다. 놓기만 한다
    if (mobileLayout()) {
      if (ev.target instanceof HTMLElement) ev.target.blur();
      return;
    }
    focusComposer();
  }

  // ── 대화 기록 안 찾기 ──────────────────────────────────────────────────────────

  /** 대화를 아직 몰라 기록이 없어도 `true` — 보이지 않는 터미널을 찾지 않는다 */
  function openFind(): boolean {
    if (view !== "convo") return false;
    finder?.show();
    return true;
  }

  $effect(() => {
    const id = pane.id;
    return untrack(() => registerTileFind(id, openFind));
  });

  $effect(() => {
    if (view !== "convo") untrack(() => finder?.close());
  });

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
    // 대화 면 안의 다른 글 칸도 제 키를 다 쓴다 — Backspace · 화살표를 기록 스크롤로 삼키지 않게
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
      // 키는 흘려보내고 포커스만 옮긴다(이 keydown 의 글자는 새 포커스로 간다)
      if (focusComposer()) return;
      // 권한 카드가 서 있으면 터미널로 넘기지 않는다 — Claude 의 TUI 창은 낱자 키가 곧 답이다
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

  // ── 대화 면 본문의 메뉴 — 터미널 면과 같은 타일 메뉴(붙여넣기 · 화면 지우기만 없다). 폰은 고른 글 위의 띠로 연다 ──
  const convoSel = createTextSelectBar({
    body: () => bodyEl,
    box: () => convoEl,
    on: () => phone && view === "convo" && shown,
  });

  function openConvoMenu(x: number, y: number, text: string, linkEl: HTMLElement | null, barEdits: boolean): void {
    const body = bodyEl;
    if (!onmenu || !body) return;
    onmenu(x, y, {
      link: linkEl?.getAttribute("data-href") ?? linkEl?.getAttribute("data-path") ?? null,
      hasSelection: text !== "",
      hasOutput: commandsOf(pane.id)?.canCopyOutput() ?? false,
      snippet: null,
      ask: null,
      selection: text === "" ? null : text,
      barEdits,
      convo: {
        selectAll: () => selectAllIn(body),
        // 누른 것과 같은 길 — 경로 링크 · 문서 링크 · 바깥 링크를 본문의 클릭 처리가 가른다
        openLink: () => {
          if (linkEl?.isConnected) linkEl.click();
        },
      },
    });
  }

  function onConvoContextMenu(ev: MouseEvent): void {
    const target = ev.target instanceof Element ? ev.target : null;
    // 그림 메뉴가 먼저 잡았거나(`defaultPrevented`) 글 칸 · 단추 위면 비켜 선다 — 링크 칩(`button[data-href]`)은 링크다
    if (ev.defaultPrevented || !onmenu || !target || !bodyEl?.contains(target)) return;
    if (target.closest("input, textarea, [contenteditable], button:not([data-href])")) return;
    ev.preventDefault();
    const linkEl = target.closest<HTMLElement>("[data-href], [data-path-link]");
    // 손가락의 길게 누르기는 브라우저가 글을 고른다 — 브라우저의 띠만 막고(위 `preventDefault`) 메뉴는 앱 띠의 ⋯ 가 연다.
    // 링크 위에서만 링크 줄 둘을 작은 메뉴로 낸다(띠에는 링크가 없다).
    if (convoSel.byTouch(ev)) {
      const link = linkEl?.getAttribute("data-href") ?? linkEl?.getAttribute("data-path") ?? null;
      if (linkEl === null || link === null) return;
      convoSel.clear();
      linkMenu = {
        x: ev.clientX,
        y: ev.clientY,
        run: (id) => {
          if (id === "copy-link") {
            void writeClipboard(link).then((ok) => showNotice(t(ok ? "pane.term.clipboard.copied" : "pane.term.clipboard.write_failed")));
          } else if (linkEl.isConnected) linkEl.click();
        },
      };
      return;
    }
    openConvoMenu(ev.clientX, ev.clientY, convoSel.text(), linkEl, false);
  }

  /** 폰에서 링크를 길게 눌렀을 때의 작은 메뉴 — 링크는 누른 순간의 것(메뉴가 닫힌 뒤 불린다) */
  let linkMenu = $state<{ x: number; y: number; run: (id: string) => void } | null>(null);

  function copyConvoBar(): void {
    const text = convoSel.bar?.text ?? "";
    if (text === "") return;
    void writeClipboard(text).then((ok) => showNotice(t(ok ? "pane.term.clipboard.copied" : "pane.term.clipboard.write_failed")));
    convoSel.clear();
  }

  /** IME 가 첫 글자부터 켜져 있게 키보드를 입력 칸으로 돌려준다 — 링크를 길게 눌러 메뉴가 뜬 채 손가락을 뗀 것이면 두지 않는다(메뉴 밑에서 키보드가 올라온다) */
  function onConvoPointerUp(ev: PointerEvent): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest("button, input, textarea, select, a[href], [data-path-link], [data-find-bar]")) return;
    requestAnimationFrame(() => {
      if (view === "convo" && linkMenu === null && !hasConvoSelection()) focusComposer();
    });
  }

  function toTerminal(): void {
    setFlipView(pane.id, "term");
    focusTerm();
  }

  /** 밖으로 밀린 터미널 층의 캐럿을 보이게 하려고 브라우저가 조상 `.pane-box` 를 밀 수 있다(IME 조합 등) — 그 그물 */
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

{#snippet attachPlus()}
  <button
    type="button"
    class="plus"
    class:touch={phone}
    data-flip-plus
    title={t("pane.flip.composer.attach")}
    aria-label={t("pane.flip.composer.attach")}
    onclick={() => pickEl?.click()}><UiIcon name="plus" size={20} /></button
  >
{/snippet}

{#snippet keywordSlot()}
  {#if modelKeyword}<ChatModelKeyword view={modelKeyword} touch={phone} />{/if}
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
      oncontextmenu={onConvoContextMenu}
      ontouchstart={convoSel.onTouch}
      ontouchend={convoSel.onTouch}
      ontouchcancel={convoSel.onTouch}
    >
      {#if convoSel.bar}
        <TouchSelection
          start={null}
          end={null}
          barTop={convoSel.bar.top}
          oncopy={copyConvoBar}
          onselectall={() => bodyEl && selectAllIn(bodyEl)}
          onmore={(x, y) => openConvoMenu(x, y, convoSel.bar?.text ?? "", null, true)}
        />
      {/if}
      {#if linkMenu}
        <ImageMenu
          actions={[]}
          x={linkMenu.x}
          y={linkMenu.y}
          before={[
            { id: "open-link", label: t("pane.menu.open_link") },
            { id: "copy-link", label: t("pane.menu.copy_link") },
          ]}
          label={t("pane.flip.convo.aria")}
          onclose={() => (linkMenu = null)}
          onpick={() => {}}
          onextra={linkMenu.run}
        />
      {/if}
      <DomFindBar bind:this={finder} root={bodyEl} scroller={() => bodyEl} label={t("pane.flip.find")} onclose={onFindClose} />
      {#if convKey === null}
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
          {codeActions}
          copyable
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
      {#if switchAsk}
        <div class="perms" data-flip-model-switches>
          <FlipModelSwitchCard kind={switchAsk.kind} name={switchAsk.name} {phone} onyes={() => answerSwitch(true)} onno={() => answerSwitch(false)} />
        </div>
      {/if}
      {#if permCards.length > 0}
        <div class="perms" data-tile-perms>
          {#each permCards as card (card.requestId)}
            <TilePermissionCard {card} now={permNow} {phone} onterminal={permToTerminal} />
          {/each}
        </div>
      {/if}
      <!-- 숨기기만 한다 — 친 글 · 첨부를 잃지 않게 -->
      <div class="composer-slot" class:held={permCards.length > 0} class:bottom={mobileLayout()}>
      <FlipComposer
        permission={permission || tuiAsking}
        gate={trustGate ?? switchGate}
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
        leading={attachPlus}
        inField={modelKeyword ? keywordSlot : undefined}
        compact={false}
        touch={phone}
        bind:inputEl={composerEl}
      />
      </div>
      <input bind:this={pickEl} class="pick-input" type="file" multiple tabindex="-1" aria-hidden="true" data-flip-pick onchange={onPicked} />
      {#if modelOpen && modelBtn && modelCli !== null && menu}
        <FlipModelMenu
          cli={modelCli}
          models={menu.models}
          levels={menu.levels}
          effort={menu.effort}
          ring={menu.ring}
          note={menu.note}
          trigger={modelBtn}
          touch={phone}
          onmodel={pickModel}
          oneffort={pickEffort}
          onclose={closeModel}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .plus {
    position: relative;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-1);
    background: var(--control-tile-bg);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .plus:hover {
    background: var(--control-tile-bg-hover);
  }

  .plus:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .plus.touch::after {
    content: "";
    position: absolute;
    inset: -6px;
  }

  .pick-input {
    display: none;
  }

  /* `clip` — 밖으로 밀린 층이 비치지 않고 스크롤 상자도 아니다(포커스 · 캐럿이 못 민다) */
  .flip {
    position: absolute;
    inset: 0;
    overflow: clip;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  /* 숨기지 않는다 — 밀어 둘 뿐이다 */
  .term.off {
    transform: translateX(-100%);
    pointer-events: none;
  }

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

  .qa-bubble {
    align-self: flex-end;
    max-width: 78%;
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-raised-solid));
    border-radius: 12px 12px 4px 12px;
  }

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

  /* 키 띠(`mobile/MobileKeys`)가 숨어 그 띠가 맡던 아래 안전 여백을 여기서 */
  .composer-slot.bottom {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

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

  .trust-row {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-2) 0 0;
    /* 이 줄 자신이 그릇이다 — 대화 층에 걸면 그 층이 고정 위치 자식의 기준 상자가 된다 */
    container: trust-row / inline-size;
  }

  /* `ChatDock.svelte` 의 `.link-note` · `.link-go` 가 같은 값을 적는다 — 바꾸면 함께 */
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

  /* 터미널 층은 쌓임 맥락을 만들지 않아 그 안의 겹(데코레이션 · 스크롤 막대 · 팁 20/21)과 같은 층에서 겨룬다 — 그 위로 올린다 */
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
