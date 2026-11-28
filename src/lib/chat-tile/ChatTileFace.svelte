<script lang="ts" module>
  let faceSeq = 0;
</script>

<script lang="ts">
  /**
   * 채팅 모양 AI 타일의 몸 — 상태는 `app/chat-tile-live.svelte.ts` 가 쥐어 이 컴포넌트가 다시 서도 지금 턴을 잃지 않는다.
   * - stdin 에 닿는 것은 사람이 친 글 · 사람이 누른 카드 결정 · [중지] · 모델/강도/권한 모드 고르기뿐이다 — 이 면은 글을 짓지 않는다.
   *   카드 결정에는 결정 낱말과 사람이 친 글 · 고른 답만 싣는다(늘 허용의 제안 · 규칙 · 모드는 서버 어댑터가 고른다).
   * - 모드 칩은 CLI 가 알린 모드를 보인다 — 칩 밖 모드(사용자 설정의 bypass 등)는 표지일 뿐 고르는 줄이 없다.
   * - 권한이 걸려 있는 동안 입력 칸은 숨기기만 한다(친 글을 잃지 않게) — 답하면 돌아온다.
   * - 턴이 끝나면(`ended` 가 늘면) 기록을 한 번 받고, 받은 뒤에야 그 턴의 꼬리를 걷는다(`clearEndedChatTile`).
   *   기록에 없는 끊긴 턴의 부분 답(Codex) · 기록 읽기가 숨기는 `/` 명령의 말 · 출력(Claude `/context` · `/goal`)은 받은 쪽에 다시 끼운다
   *   (`withPartials` · `withLocals`) — 걷은 뒤 본 글이 사라지지 않게. 답한 Claude 계획은 사람이 본 글 · 결과를 기록 줄에 얹고(`withPlans`),
   *   [이 대화에서 늘 허용] · 압축 · 검토 끝 표지는 기록에 남지 않아 이 창이 본 것만 흔적 줄로 둔다(다시 열면 없다 — 기록에서 지어내지 않는다).
   * - 첨부는 앱 첨부 자리의 사본 경로만 보낸다 — 사용자 저장소(타일 폴더)에는 아무것도 쓰지 않는다. 서버가 그 자리 안의 실제 파일인지 다시 본다.
   * - `/` 메뉴는 `FlipComposer` 를 고치지 않고 받은 칸에 리스너를 건다 — 안의 `bind:value`(글 넣기 = `setComposerText`) · 위임된 `onkeydown`
   *   (처리한 키는 전파를 끊는다)에 기댄다. 메뉴는 글을 넣거나 Aynx 동작을 할 뿐 보내지 않는다 · 터미널 전용 명령은 보내기 전에 막는다.
   *   정확히 친 이름의 줄은 흐린 줄이어도 고른 줄이다 — 그때 Enter 는 메뉴가 받지 않고 보내기 길로 흘려 막힘 안내를 띄운다.
   *   그대로 보내는 명령을 인자 없이 정확히 친 Enter 도 보내기 길로 흘린다(두 번 누르지 않게). 줄 고르기는 포인터가 실제로 움직였을 때만.
   * - 압축은 사람 op 하나(`compactChatTile`) — 프로세스가 없으면 Claude 는 입력 칸에 `/compact` 를 넣기만 한다(보내기는 사람).
   * - 되감기는 사람이 카드의 [실행]을 눌러야만 간다 — 기록 줄 단추 · `/rewind` 고르기는 카드(미리 보기)를 열 뿐이다.
   *   대화 되감기 뒤 되감은 글은 입력 칸이 비었을 때만 넣는다(보내지 않는다 · 친 글을 덮지 않는다).
   * - 검토 · 목표(Codex)는 사람이 카드의 단추를 눌러야만 간다 — `/review` · `/goal` 은 카드를 열 뿐이고 실패해도 다시 보내지 않는다.
   *   목표 띠의 [멈춤] [다시] [지우기]도 누른 그 한 번뿐 · MCP 상태는 풍선을 열 때 · [새로 고침] 때만 CLI 에 묻는다(열린 동안 스스로 묻지 않는다).
   * - 카드 · 모드 메뉴 · 모델 메뉴 · 맥락 풍선 · MCP 풍선 · `/` 메뉴 · 고르기 메뉴는 한 번에 하나만 열린다.
   */
  import { onDestroy, tick, untrack } from "svelte";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import FlipComposer from "$lib/pane/FlipComposer.svelte";
  import FlipModelMenu, { type FlipModelRow } from "$lib/pane/FlipModelMenu.svelte";
  import ChatModelKeyword, { type KeywordView } from "$lib/chat/ChatModelKeyword.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ChatTilePermCard from "$lib/chat-tile/ChatTilePermCard.svelte";
  import ChatTilePlanCard from "$lib/chat-tile/ChatTilePlanCard.svelte";
  import ChatTileQuestionCard from "$lib/chat-tile/ChatTileQuestionCard.svelte";
  import ChatTilePlanBlock from "$lib/chat-tile/ChatTilePlanBlock.svelte";
  import ChatTileModeChip from "$lib/chat-tile/ChatTileModeChip.svelte";
  import ChatTileModeMenu from "$lib/chat-tile/ChatTileModeMenu.svelte";
  import ChatTileSlashMenu from "$lib/chat-tile/ChatTileSlashMenu.svelte";
  import ChatTileContextMeter from "$lib/chat-tile/ChatTileContextMeter.svelte";
  import ChatTileContextPopover from "$lib/chat-tile/ChatTileContextPopover.svelte";
  import ChatTileRewindCard from "$lib/chat-tile/ChatTileRewindCard.svelte";
  import ChatTileRewindPicker from "$lib/chat-tile/ChatTileRewindPicker.svelte";
  import ChatTileReviewCard from "$lib/chat-tile/ChatTileReviewCard.svelte";
  import ChatTileGoalCard from "$lib/chat-tile/ChatTileGoalCard.svelte";
  import ChatTileGoalBar from "$lib/chat-tile/ChatTileGoalBar.svelte";
  import ChatTileMcpPopover from "$lib/chat-tile/ChatTileMcpPopover.svelte";
  import { reviewDraft, type ReviewDraft } from "$lib/chat-tile/chat-tile-review";
  import { goalBar, type GoalBudget } from "$lib/chat-tile/chat-tile-goal";
  import { mcpSummary } from "$lib/chat-tile/chat-tile-mcp";
  import type { Key } from "$lib/i18n/keys";
  import { filesAfter, rewindable, rewindScopes, userTurnsFrom } from "$lib/chat-tile/chat-tile-rewind";
  import type { RewindScope, SideChatCli } from "$lib/side-chat-api";
  import {
    exactSlash,
    skillsInText,
    slashEnterSends,
    slashEntries,
    slashIntent,
    slashMatches,
    slashPending,
    slashTrigger,
    type AynxAction,
    type SlashEntry,
  } from "$lib/chat-tile/chat-tile-slash";
  import { contextView } from "$lib/chat-tile/chat-tile-context";
  import { setComposerText } from "$lib/chat-tile/composer-text";
  import { isImeKey } from "$lib/pane/ai-flip-keys";
  import { isRemote } from "$lib/ipc";
  import { tabOfPane } from "$lib/app/tabs.svelte.js";
  import { openFolderConversations } from "$lib/app/folder-conversations.svelte.js";
  import { openUsageView } from "$lib/app/usage-view.svelte.js";
  import { chatModeView, isPlanItem } from "$lib/chat-tile/chat-tile-mode";
  import type { ChatTileDecision, ReviewTargetWire } from "$lib/chat-tile/chat-tile-api";
  import { agentConversationImage, agentConversationTranscript, type TranscriptItem, type TranscriptPage, type TranscriptPicture } from "$lib/context";
  import { ConvImageCache } from "$lib/conv-images.svelte";
  import { entryItem, historyHold, pendingPermissions, type LiveEntry } from "$lib/side-chat-live";
  import type { LiveRow } from "$lib/transcript";
  import type { ComposerGate } from "$lib/pane/ai-flip.svelte.js";
  import {
    askMcpStatus,
    askRewind,
    awaitingTurn,
    cancelRewind,
    changeRewindScope,
    chatTileLiveOf,
    chatTileTierNow,
    chatTileTierOptions,
    chatTileWorking,
    clearEndedChatTile,
    compactChatTile,
    confirmRewind,
    decideChatTile,
    dismissChatTileError,
    goalChatTile,
    interruptChatTile,
    newChatInPlace,
    retuneChatTile,
    reviewChatTile,
    sendChatTile,
    setChatTilePermMode,
    switchChatTileCli,
    takeChatTileDraft,
    type ChatTileLive,
    type ChatTileTarget,
  } from "$lib/app/chat-tile-live.svelte.js";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { offeredAiClis, type AiCli } from "$lib/session";
  import { chatTileCli } from "$lib/ai-launch-pick";
  import { settings } from "$lib/settings.svelte.js";
  import { conversationList } from "$lib/app/agent-sessions.svelte.js";
  import { loadCodexModels, type CodexModels } from "$lib/app/side-chats.svelte.js";
  import { effortName, keywordModelLabel } from "$lib/chat/side-chat-controls.svelte";
  import { sideChatEffortChoices, sideChatModelChoices } from "$lib/side-chat";
  import { EFFORTS, MODEL_SUGGESTIONS } from "$lib/orchestration/config";
  import { modelLabel, orderModels } from "$lib/model-order";
  import { aiDisplayName, aiIconName } from "$lib/pane-icons";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { handheld } from "$lib/app/mobile.svelte.js";
  import { knownAiClis, openPathFromChat } from "$lib/app/panes.svelte.js";
  import { resolvePathLink, type PathMatch, type ResolvedPath } from "$lib/path-links";
  import { stripReason } from "$lib/error-reason";
  import { chatTileErrorText, chatTileNoticeText, rewindActionKey, rewindTraceText, shortDetail } from "$lib/chat-tile/chat-tile-text";
  import { dropDefaultAlias, isPlanRow, withLocals, withPartials, withPlans } from "$lib/chat-tile/chat-tile-view";
  import { CLI_MODE_WORD } from "$lib/chat-tile/chat-tile-mode";
  import { stageAgentFiles, stageFsPaths, stageLocalPaths } from "$lib/agent-attachments";
  import { decodeFsDrag, fsDragEmpty, FS_DRAG_TYPE } from "$lib/fs-drag";
  import { sessionOfFsKey } from "$lib/fs-drop-route";
  import { LOCAL_KEY } from "$lib/fs-backend";
  import { showNotice } from "$lib/app/notice";
  import { baseName, SIDE_CHAT_ATTACH_MAX_BYTES, type SentPic } from "$lib/pane/composer-attachments";
  import {
    clearComposerAttachments,
    composerAttachmentsOf,
    removeComposerAttachment,
    revokeSentPics,
    stageComposerAttachments,
    takeComposerPictures,
  } from "$lib/pane/composer-attachments.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    target,
    live,
    visible,
    onretry,
    inputEl = $bindable(null),
  }: {
    target: ChatTileTarget;
    live: ChatTileLive | null;
    visible: boolean;
    /** 서버 표에 다시 세우지 못했을 때(`gone`)의 [다시 시도] */
    onretry?: () => void;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  const PAGE = 40;
  const phone = $derived(handheld());
  const agent = $derived(aiDisplayName(target.cli) ?? target.cli);

  const st = $derived(live?.state ?? null);
  const conv = $derived(live?.historyConv ?? null);
  // 대화 되감기마다 처음부터 다시 읽는다(다른 창이 되감아도) — 그림 캐시도 이 열쇠
  const convKey = $derived(conv ? `${target.cli}:${conv}:${live?.rewindGen ?? 0}` : null);

  async function fetchPage(before: number | null): Promise<TranscriptPage> {
    const c = conv;
    if (!c) throw new Error("no-conversation");
    const page = await agentConversationTranscript(target.cli, c, before, PAGE);
    const partials = untrack(() => live?.partials ?? []);
    const locals = untrack(() => live?.locals ?? []);
    const plans = untrack(() => live?.plans ?? []);
    if (partials.length === 0 && locals.length === 0 && plans.length === 0) return page;
    const items = withPlans(withLocals(withPartials(page.items, partials), locals, { latest: before === null, oldest: page.cursor === null }), plans);
    return { ...page, items };
  }

  // 사람 말에 실린 그림 — 기록에서 다시 그린다(사이드 채팅 · 대화 면과 같은 캐시 · 같은 명령)
  const picCache = new ConvImageCache();
  onDestroy(() => picCache.dispose());
  function fetchPicture(p: TranscriptPicture): Promise<ArrayBuffer> {
    const c = conv;
    if (!c) return Promise.reject(new Error("no-conversation"));
    return agentConversationImage(target.cli, c, p);
  }
  let picList: readonly TranscriptPicture[] = [];
  $effect(() => {
    const key = convKey;
    untrack(() => picCache.sync(key === null ? [] : picList, key, fetchPicture));
  });
  const pictures = {
    state: (p: TranscriptPicture) => picCache.state(p),
    broken: (p: TranscriptPicture) => picCache.broken(p),
    source: (p: TranscriptPicture) => picCache.source(p),
    sync: (ps: readonly TranscriptPicture[]) => {
      picList = ps;
      picCache.sync(ps, untrack(() => convKey), fetchPicture);
    },
  };

  function failureOf(e: unknown): string {
    return t("board.viewer.error", { e: stripReason(e instanceof Error ? e.message : String(e)) });
  }

  /** 목록을 따로 불러오지 않는다 — 이미 받은 대화 목록에 있을 때만 */
  const title = $derived.by(() => {
    const id = conv ?? target.conv;
    const list = conversationList();
    if (!id || !list) return null;
    for (const s of [...list.groups.flatMap((g) => g.sessions), ...list.others]) {
      if (s.agent === target.cli && s.id === id) return s.title.trim() || null;
    }
    return null;
  });

  // ── 꼬리 → 줄 ──

  const keyOf = (e: LiveEntry) => `e${e.n}`;
  const HINT_NOTICES = new Set(["needs-terminal", "compacting", "compacted", "compact-canceled", "reviewing", "reviewed", "review-stopped", "goal-feedback"]);
  const ERR_NOTICES = new Set(["compact-failed", "review-failed", "goal-failed", "mcp-status-failed"]);
  /** 되감기 카드는 꼬리 끝 카드 줄로 선다 — 권한 카드처럼 대화 칸 높이까지 묶인다 */
  const REWIND_ROW = "rewind-card";
  const rows = $derived.by<LiveRow[]>(() => {
    if (!st) return [];
    const out = tailRows(st);
    if (live?.rewindAsk) out.push({ key: REWIND_ROW, item: null });
    if (reviewOpen) out.push({ key: `${REVIEW_ROW}-${reviewOpen.gen}`, item: null });
    if (goalOpen) out.push({ key: `${GOAL_ROW}-${goalOpen.gen}`, item: null });
    return out;
  });
  function tailRows(st: NonNullable<ChatTileLive["state"]>): LiveRow[] {
    return st.entries.map((e) => {
      // Codex 계획 글은 카드 줄로 그린다(`ChatTilePlanBlock`)
      if (e.kind === "text" && isPlanItem(e.item)) return { key: keyOf(e), item: null };
      const item = entryItem(e);
      if (!item) return { key: keyOf(e), item: null };
      if (e.kind === "user") {
        const note = e.failed ? t("app.chatDock.send.failed") : e.accepted ? null : t("pane.flip.sending");
        const pics = e.clientId ? sentPics[e.clientId] : undefined;
        return { key: keyOf(e), item, dim: !e.accepted, note, files: e.files, sentPics: pics };
      }
      return {
        key: keyOf(e),
        item,
        spinning: e.kind === "tool" && !e.finished,
        streaming: e.kind === "text" && !e.done && st.status === "running",
      };
    });
  }
  const byKey = $derived(new Map((st?.entries ?? []).map((e) => [keyOf(e), e] as const)));

  const running = $derived(st?.status === "running");
  const awaiting = $derived(!!live?.sending || (st ? awaitingTurn(st) : false));
  const working = $derived(live ? chatTileWorking(live) : false);
  const pendingN = $derived(st ? pendingPermissions(st).length : 0);
  const activity = $derived.by((): "running" | "permission" | "idle" => {
    if (pendingN > 0) return "permission";
    return running ? "running" : "idle";
  });

  // ── 보내기 · 중지 ──

  const gate = $derived.by((): ComposerGate | null => {
    // 띄우는 중 · 턴이 서기 전도 — 그 사이 둘째 글을 받지 않는다
    if (!awaiting || running) return null;
    return { text: t("pane.chatTile.starting", { agent }) };
  });

  // ── 첨부 ──

  // AI 타일 = 타일 id 열쇠(대화 면 첨부와 같은 규칙)
  const attachKey = $derived(target.paneId);
  const attachments = $derived(composerAttachmentsOf(attachKey));
  onDestroy(() => clearComposerAttachments(untrack(() => attachKey)));
  let pickEl = $state<HTMLInputElement | null>(null);

  /** 막 보낸 그림의 미리 보기(`clientId` 열쇠) — 그 말이 꼬리에서 걷히거나 면이 사라지면 거둔다 */
  let sentPics = $state<Record<string, SentPic[]>>({});
  $effect(() => {
    const keep = new Set((st?.entries ?? []).flatMap((e) => (e.kind === "user" && e.clientId ? [e.clientId] : [])));
    untrack(() => {
      const gone = Object.keys(sentPics).filter((k) => !keep.has(k));
      if (gone.length === 0) return;
      const next = { ...sentPics };
      for (const k of gone) {
        revokeSentPics(next[k]);
        delete next[k];
      }
      sentPics = next;
    });
  });
  onDestroy(() => {
    for (const pics of Object.values(untrack(() => sentPics))) revokeSentPics(pics);
  });

  // 같은 타일에 새 채팅이 서면(이 몸이 내려가면) 늦게 끝난 첨부를 걷는다 — 열쇠가 타일 id 라 새 몸에 칩이 남는다
  let mounted = true;
  onDestroy(() => (mounted = false));
  const stillHere = () => mounted && chatTileLiveOf(target.chat)?.gone !== true;

  /** 10 MB — 서버 판정과 같다. 크기를 모르는 것(파일 타일 짐)은 서버가 본다 */
  function withinSize<T>(items: readonly T[], name: (x: T) => string, size: (x: T) => number | null): T[] {
    const out: T[] = [];
    for (const x of items) {
      if ((size(x) ?? 0) > SIDE_CHAT_ATTACH_MAX_BYTES) showNotice(t("pane.flip.composer.fileTooBig", { name: name(x) }));
      else out.push(x);
    }
    return out;
  }

  function attachFiles(files: File[]): void {
    const ok = withinSize(files, (f) => f.name, (f) => f.size);
    if (ok.length === 0) return;
    void stageComposerAttachments(
      attachKey,
      ok.map((file) => ({ name: file.name, file })),
      () => stageAgentFiles("local", 0, ok, t),
      stillHere,
    );
  }

  function onDropData(dt: DataTransfer): void {
    const files = Array.from(dt.files ?? []);
    if (files.length > 0) {
      attachFiles(files);
      return;
    }
    const drag = decodeFsDrag(dt.getData(FS_DRAG_TYPE));
    if (fsDragEmpty(drag)) return;
    const paths = withinSize(drag.paths, baseName, () => null);
    if (paths.length === 0) return;
    const source = drag.backendKey === LOCAL_KEY ? null : sessionOfFsKey(drag.backendKey);
    if (drag.backendKey !== LOCAL_KEY && source === null) return;
    void stageComposerAttachments(
      attachKey,
      paths.map((p) => ({ name: baseName(p) })),
      () => (source === null ? stageLocalPaths(paths, t) : stageFsPaths("download", source, paths, t)),
      stillHere,
    );
  }

  /** 같은 파일을 다시 고를 수 있게 값을 비운다 */
  function onPicked(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) attachFiles(files);
  }

  function send(text: string): boolean {
    closeSlash(false);
    const intent = slashIntent(target.cli, text, slashAll);
    // 터미널 전용 명령은 CLI 에 닿지 않는다 — 글은 남긴다
    if (intent.kind === "terminal") {
      slashNote = { kind: "terminal", name: intent.name };
      slashDismissed = text;
      return false;
    }
    if (intent.kind === "aynx") {
      if (intent.action === "newChat" && isRemote) return false;
      return runSlashAction(intent.action, target, intent.args);
    }
    // 압축할 수 없으면(턴 중 · 카드 대기) 글을 남긴다
    if (intent.kind === "compact") return startCompact(null);
    // 칩은 모두 준비된 뒤에만 보낸다(`FlipComposer` 의 `canSend`)
    const ready = attachments.flatMap((a) => (a.path === null ? [] : [{ path: a.path, name: a.name }]));
    if (!sendChatTile(target, text, ready, skillsInText(text, picked))) return false;
    picked = [];
    const entries = chatTileLiveOf(target.chat)?.state.entries ?? [];
    let cid: string | undefined;
    for (let i = entries.length - 1; i >= 0 && cid === undefined; i--) {
      const e = entries[i];
      if (e.kind === "user") cid = e.clientId ?? "";
    }
    const pics = takeComposerPictures(attachKey);
    if (cid && pics.length > 0) sentPics = { ...sentPics, [cid]: pics };
    else revokeSentPics(pics);
    return true;
  }

  function stop(): void {
    void interruptChatTile(target.chat);
    inputEl?.focus({ preventScroll: true });
  }

  // ── 머리줄 — 대화 제목은 이름 뒤 · [중지]는 ⋯ 앞(타일이 맡긴 도구줄) ──

  /** 이보다 좁은 타일의 머리줄 [중지]는 그림만 */
  const HEAD_NARROW_PX = 420;
  let faceW = $state(0);
  const inHead = $derived(paneHeadShown(target.paneId));
  $effect(() => setPaneTools(target.paneId, { bar: headBar, tail: headTail, keepBar: true, wholeName: true }));

  // ── 권한 ──

  let deciding = $state<Record<string, true>>({});
  async function decide(
    requestId: string,
    decision: ChatTileDecision,
    extra?: { message?: string | null; answers?: Readonly<Record<string, string>> },
  ): Promise<void> {
    if (deciding[requestId]) return;
    deciding[requestId] = true;
    try {
      await decideChatTile(target.chat, requestId, decision, extra);
    } finally {
      delete deciding[requestId];
    }
    requestAnimationFrame(() => inputEl?.focus({ preventScroll: true }));
  }

  // ── 모델 · 강도 ──

  const isCodex = $derived(target.cli === "codex");
  // 사람이 고른 값 — CLI 가 알린 실효 이름이 아니다(사이드 채팅 칩과 같다)
  const model = $derived(live?.pick ?? target.model);
  const effort = $derived(st?.effort ?? (target.effort || ""));
  let codexList = $state<CodexModels | null>(null);
  let modelOpen = $state(false);
  let modelBtn = $state<HTMLElement | null>(null);
  const modelLocked = $derived(working || !!live?.gone || !live?.attached);
  $effect(() => {
    if (modelLocked || !visible) modelOpen = false;
  });

  const models = $derived.by<FlipModelRow[]>(() => {
    const ready = st?.ready ?? null;
    const suggestions =
      ready && ready.models.length > 0 ? ready.models : [...MODEL_SUGGESTIONS[target.cli], ...(isCodex ? (codexList?.models ?? []) : [])];
    const list = dropDefaultAlias(orderModels(sideChatModelChoices(model, isCodex ? codexList?.configured : null, suggestions)), model);
    return [
      { value: "", label: t("app.chatDock.cliDefault"), checked: model === "" },
      ...list.map((m) => ({ value: m, label: modelLabel(m), checked: model === m })),
    ];
  });
  const efforts = $derived.by<string[]>(() => {
    const list = sideChatEffortChoices(st?.ready?.efforts ?? null, model, EFFORTS[target.cli]);
    return effort === "" || list.includes(effort) ? list : [effort, ...list];
  });
  /** Codex 속도 등급 — 지금 모델이 알린 것만(Claude 는 늘 빈 목록) */
  const tierOpts = $derived(live ? chatTileTierOptions(live) : []);
  const tierNow = $derived(live?.tier ?? null);
  /** 고른 등급은 늘 칩에 표 — 그 목록을 몰라도 숨기지 않는다(속도 줄의 "CLI 기본" 으로 끈다) */
  const tierShown = $derived(live ? chatTileTierNow(live) : null);
  /** 속도 줄의 등급 줄 — 지금 모델의 목록 + 목록 밖의 고른 등급 */
  const tierRowsList = $derived(tierShown && !tierOpts.some((o) => o.id === tierShown.id) ? [...tierOpts, tierShown] : tierOpts);

  const keyword = $derived.by((): KeywordView => {
    const label = keywordModelLabel(model);
    const tierPart = tierShown ? ` · ${t("pane.chatTile.tier.chip", { name: tierShown.name })}` : "";
    const head = `${agent} · ${label}${efforts.length > 0 ? ` · ${t("app.chatDock.effort.chip", { e: effortName(effort) })}` : ""}${tierPart}`;
    return {
      cli: target.cli,
      label,
      efforts,
      effort,
      title: head,
      open: modelOpen,
      locked: modelLocked,
      onopen: (el) => {
        modelBtn = el;
        modeOpen = false;
        ctxOpen = false;
        closeSlash(true);
        closeRewindUi();
        closeExtras();
        modelOpen = !modelOpen;
        if (modelOpen && isCodex) void loadCodexModels().then((v) => (codexList = v));
      },
    };
  });

  function closeModel(back: boolean): void {
    modelOpen = false;
    if (back) modelBtn?.focus({ preventScroll: true });
  }

  /** 고른 뒤에도 메뉴는 열려 있다(모델과 강도를 한 번에) */
  function pickModel(value: string): void {
    runOnMenu(
      () => (value !== model ? { tg: target, model: value } : null),
      () => {},
      (x) => void retuneChatTile(x.tg, { model: x.model }),
    );
  }

  function pickEffort(value: string): void {
    runOnMenu(
      () => (value !== effort ? { tg: target, effort: value } : null),
      () => {},
      (x) => void retuneChatTile(x.tg, { effort: x.effort }),
    );
  }

  // ── CLI 바꾸기 = 이 자리에 다른 CLI 의 새 대화 ──

  // 원격 창은 명세를 쓰지 않는다 — 줄을 그리지 않는다
  let aiList = $state<AiCli[] | null>(null);
  if (!isRemote) void knownAiClis().then((v) => (aiList = v));
  /** 런처 [채팅] 과 같은 출처 — 지금 CLI 가 목록에서 빠졌어도(끈 에이전트) 고른 칸은 남긴다 */
  const cliChoices = $derived.by((): { id: SideChatCli; name: string }[] => {
    if (!aiList) return [];
    const list = offeredAiClis(aiList, settings.disabledAgents).flatMap((c) => (chatTileCli(c.id) ? [{ id: c.id, name: c.name }] : []));
    return list.some((c) => c.id === target.cli) ? list : [{ id: target.cli, name: agent }, ...list];
  });
  let cliRowEl = $state<HTMLElement | null>(null);

  /** 확인 없이 바로 — 쓰던 글은 새 몸이 받고 붙인 첨부는 옮기지 않는다 */
  function pickCli(cli: SideChatCli): void {
    if (cli === target.cli) return;
    runOnMenu(
      () => (!working ? { tg: target, cli, draft: inputEl?.value ?? "" } : null),
      () => closeModel(false),
      (x) => void switchChatTileCli(x.tg, x.cli, x.draft),
    );
  }

  function onCliKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight" && ev.key !== "Home" && ev.key !== "End") return;
    const list = Array.from(cliRowEl?.querySelectorAll<HTMLElement>("[data-chat-tile-cli]") ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(ev.currentTarget as HTMLElement);
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? list.length - 1 : ev.key === "ArrowRight" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus({ preventScroll: true });
  }

  // 같은 자리 새 채팅의 몸만 받는다 — 옛 몸의 쓰던 글을 넣고 입력 칸으로
  let draftTaken = false;
  $effect(() => {
    const el = inputEl;
    if (!el || draftTaken) return;
    draftTaken = true;
    untrack(() => {
      const d = takeChatTileDraft(target.chat);
      if (d === null) return;
      if (d !== "") setComposerText(el, d);
      else el.focus({ preventScroll: true });
    });
  });

  // ── 권한 모드(CLI 자신의 모드) ──

  const modeView = $derived(chatModeView(target.cli, live?.cliMode ?? null, live?.permMode ?? null));
  let modeOpen = $state(false);
  let modeBtn = $state<HTMLElement | null>(null);
  const modeLocked = $derived(!!live?.gone || !live?.attached || !!live?.modeBusy);
  $effect(() => {
    if (modeLocked || !visible || pendingN > 0) modeOpen = false;
  });

  function toggleMode(el: HTMLElement): void {
    modeBtn = el;
    modelOpen = false;
    ctxOpen = false;
    closeSlash(true);
    closeRewindUi();
    closeExtras();
    modeOpen = !modeOpen;
  }

  function closeMode(back: boolean): void {
    modeOpen = false;
    if (back) modeBtn?.focus({ preventScroll: true });
  }

  /** 고르면 입력 칸으로 — 칩은 보내는 동안 흐려져 포커스를 쥐지 못한다(Esc 는 칩으로) */
  function pickMode(mode: string): void {
    runOnMenu(
      () => (mode !== modeView.current && modeView.choices.includes(mode) ? { tg: target, mode } : null),
      () => {
        closeMode(false);
        inputEl?.focus({ preventScroll: true });
      },
      (x) => void setChatTilePermMode(x.tg, x.mode),
    );
  }

  // ── 계획 덩어리 · 결정 흔적 ──

  // 안내 줄은 지금 Codex Plan 일 때 마지막 계획 덩어리 하나에만
  const codexPlanMode = $derived(isCodex && modeView.current === "plan");
  const lastLivePlan = $derived.by(() => {
    const es = st?.entries ?? [];
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      if (e.kind === "text" && isPlanItem(e.item)) return keyOf(e);
    }
    return null;
  });

  /** 꼬리에 아직 그 카드가 있으면 흔적을 그리지 않는다(같은 결정을 두 번 보이지 않게) */
  const traceNotes = $derived.by(() => {
    const inTail = new Set((st?.entries ?? []).flatMap((e) => (e.kind === "permission" ? [e.requestId] : [])));
    const allows = (live?.traces ?? []).filter((x) => !inTail.has(x.requestId)).map((x) => ({ key: x.requestId, at: x.at }));
    // 꼬리에 압축 끝 알림이 있는 동안은 그 수만큼 최근 것을 그리지 않는다
    const tailCompacts = (st?.entries ?? []).filter((e) => e.kind === "notice" && e.code === "compacted").length;
    const cps = live?.compactions ?? [];
    const compacts = cps.slice(0, Math.max(0, cps.length - tailCompacts)).map((x) => ({ key: x.key, at: x.at }));
    const goals = (live?.goalNotes ?? []).map((x) => ({ key: x.key, at: x.at }));
    // 검토 끝 표지도 압축 줄과 같다 — 꼬리에 있는 동안은 그 수만큼 최근 것을 그리지 않는다
    const tailReviews = (st?.entries ?? []).filter((e) => e.kind === "notice" && (e.code === "reviewed" || e.code === "review-stopped")).length;
    const rvs = live?.reviews ?? [];
    const reviews = rvs.slice(0, Math.max(0, rvs.length - tailReviews)).map((x) => ({ key: x.key, at: x.at }));
    return [...allows, ...(live?.rewinds ?? []).map((x) => ({ key: x.key, at: x.at })), ...compacts, ...goals, ...reviews];
  });

  function traceWhat(allow: { kind: string; detail: string }): string {
    return allow.kind === "mode" ? CLI_MODE_WORD.acceptEdits : allow.detail;
  }

  // ── 경로 링크 ──

  const pathLinks = $derived.by(() => {
    // 폴더를 모르면(홈에서 연 타일) 절대 경로만 건다
    const place = { kind: "local" as const, cwd: target.cwd || null };
    const label = (r: NonNullable<ResolvedPath>, m: PathMatch) => ("path" in r ? r.path : `~/${r.home}`) + (m.line !== undefined ? `:${m.line}` : "");
    return {
      title: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        return r ? label(r, m) : null;
      },
      open: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        if (r) void openPathFromChat(r, m.line);
      },
    };
  });

  // ── 맥락 사용량 · 압축 ──

  let faceEl = $state<HTMLElement | null>(null);
  const ctxView = $derived(contextView(live?.context ?? null));
  const canCompact = $derived(!!live && !working && pendingN === 0 && !live.gone && !!live.attached);
  let ctxOpen = $state(false);
  let ctxBtn = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!ctxView || !visible || pendingN > 0 || live?.gone) ctxOpen = false;
  });

  function toggleCtx(el: HTMLElement): void {
    ctxBtn = el;
    modelOpen = false;
    modeOpen = false;
    closeSlash(true);
    closeRewindUi();
    closeExtras();
    ctxOpen = !ctxOpen;
  }

  function closeCtx(back: boolean): void {
    ctxOpen = false;
    if (back) ctxBtn?.focus({ preventScroll: true });
  }

  /** 프로세스가 없으면 띄우지 않는다 — Claude 는 같은 명령을 입력 칸에 넣어 사람이 보내게 하고, Codex 는 서버가 `[not-started]` 로 알린다 */
  function startCompact(instructions: string | null): boolean {
    if (!canCompact) return false;
    if (target.cli === "claude" && st?.status === "stopped") {
      if (inputEl) setComposerText(inputEl, instructions ? `/compact ${instructions}` : "/compact ");
      return true;
    }
    void compactChatTile(target, instructions);
    return true;
  }

  function compactFromPopover(instructions: string | null): void {
    runOnMenu(
      () => ({ instructions }),
      () => closeCtx(false),
      (x) => {
        startCompact(x.instructions);
        inputEl?.focus({ preventScroll: true });
      },
    );
  }

  // ── 되감기 ──

  const rewindScopesNow = $derived(rewindScopes(target.cli, live?.rewindCaps ?? null));
  const rewindAsk = $derived(live?.rewindAsk ?? null);
  /** `all` = 받은 쪽 최신 기록 전체(Codex 카드의 셈 재료) */
  let picker = $state<{ items: TranscriptItem[]; all: TranscriptItem[] | null; box: HTMLElement } | null>(null);
  let opening = false;

  /** 고르기 메뉴를 닫고 카드를 거둔다 — 다른 메뉴가 열릴 때. 실행 중인 카드는 남는다(결과를 카드가 받는다) */
  function closeRewindUi(): void {
    picker = null;
    if (untrack(() => live?.rewindAsk)) cancelRewind(target.chat);
  }

  function closeMenusForRewind(): void {
    modelOpen = false;
    modeOpen = false;
    ctxOpen = false;
    closeSlash(true);
    closeExtras();
  }

  /** 받은 쪽 최신 기록 — 실패하면 null(그래도 묻는다) */
  async function latestItems(): Promise<TranscriptItem[] | null> {
    try {
      return (await fetchPage(null)).items;
    } catch {
      return null;
    }
  }

  /** 카드를 열고 미리 보기를 묻는다 — 되감기는 카드의 [실행]만 시작한다 */
  async function openRewind(item: TranscriptItem, known: TranscriptItem[] | null = null): Promise<void> {
    const anchor = item.anchor;
    const l = chatTileLiveOf(target.chat);
    if (!anchor || !l || opening || chatTileWorking(l) || l.rewindAsk?.phase === "applying") return;
    closeMenusForRewind();
    picker = null;
    if (l.rewindAsk) cancelRewind(target.chat);
    let localTurns: number | null = null;
    let localFiles: string[] | null = null;
    // 받은 쪽에서 센 턴 수 · 바뀐 파일은 Codex 카드만 쓴다
    if (target.cli === "codex") {
      opening = true;
      const items = known ?? (await latestItems());
      opening = false;
      if (items) {
        localTurns = userTurnsFrom(items, anchor);
        localFiles = filesAfter(items, anchor);
      }
    }
    askRewind(target, { anchor, text: item.text, localTurns, localFiles });
  }

  async function openPicker(): Promise<void> {
    if (rewindScopesNow.length === 0) {
      slashNote = { kind: "terminal", name: "rewind" };
      return;
    }
    const box = faceEl?.querySelector<HTMLElement>("[data-flip-composer] .wrap") ?? inputEl;
    if (!box || opening) return;
    closeMenusForRewind();
    if (untrack(() => live?.rewindAsk?.phase) === "applying") return;
    if (untrack(() => live?.rewindAsk)) cancelRewind(target.chat);
    opening = true;
    const all = await latestItems();
    opening = false;
    const scopes = untrack(() => rewindScopesNow);
    picker = { items: (all ?? []).filter((it) => rewindable(it, scopes)).reverse(), all, box };
  }

  function closePicker(back: boolean): void {
    picker = null;
    if (back) inputEl?.focus({ preventScroll: true });
  }

  function pickRewind(it: TranscriptItem): void {
    runOnMenu(
      () => ({ it, all: untrack(() => picker?.all ?? null) }),
      () => closePicker(false),
      (x) => void openRewind(x.it, x.all),
    );
  }

  function cancelRewindCard(): void {
    cancelRewind(target.chat);
    inputEl?.focus({ preventScroll: true });
  }

  function setRewindScope(scope: RewindScope): void {
    changeRewindScope(target, scope);
  }

  $effect(() => {
    if (!visible || pendingN > 0 || live?.gone) picker = null;
  });

  // 카드가 닫히면(되감음 · 취소) 포커스를 입력 칸으로 — 카드 단추에 있던 포커스가 몸으로 떨어지지 않게
  let hadAsk = false;
  $effect(() => {
    const has = rewindAsk !== null;
    if (hadAsk && !has) {
      untrack(() => {
        const a = document.activeElement;
        if (!a || a === document.body || !a.isConnected) inputEl?.focus({ preventScroll: true });
      });
    }
    hadAsk = has;
  });

  // 대화 되감기 뒤 되감은 글 — 입력 칸이 비었을 때만 · 보내지 않는다. 이 면이 서기 전의 것은 다시 넣지 않는다
  let fillGen: number | null = null;
  $effect(() => {
    const l = live;
    const el = inputEl;
    if (!l || !el) return;
    const f = l.composerFill;
    if (fillGen === null) {
      fillGen = f?.gen ?? 0;
      return;
    }
    if (!f || f.gen === fillGen) return;
    fillGen = f.gen;
    untrack(() => {
      if (el.value.trim() === "") setComposerText(el, f.text);
    });
  });

  // ── `/` 메뉴 ──

  const slashId = `ct-slash-${++faceSeq}`;
  // 원격 창은 명세를 쓰지 않는다 — 그 자리 새 채팅은 메인 PC 창에서만
  const slashAll = $derived.by(() => {
    const all = slashEntries(target.cli, live?.commands ?? null);
    return isRemote ? all.filter((e) => e.action !== "newChat") : all;
  });
  /** `/` 뒤 글 — null 이면 닫힘 */
  let slashQuery = $state<string | null>(null);
  let slashActive = $state(-1);
  /** Esc · 바깥 누름으로 닫은 그 글 — 글이 바뀌기 전에는 다시 열지 않는다 */
  let slashDismissed: string | null = null;
  let slashBox = $state<HTMLElement | null>(null);
  /** 메뉴에서 고른 Codex 스킬 이름 — 보낼 때 글에 `$이름` 이 남은 것만 싣는다 */
  let picked = $state<string[]>([]);
  let slashNote = $state<{ kind: "terminal"; name: string } | { kind: "copyHint" | "diffHint" } | { kind: "info"; key: Key } | null>(null);

  const SLASH_MAX = 50;
  const slashMatched = $derived(slashQuery === null ? [] : slashMatches(slashAll, slashQuery));
  const slashRows = $derived(slashMatched.slice(0, SLASH_MAX));
  const slashMore = $derived(slashMatched.length - slashRows.length);
  /** 친 글이 정말 글로 보내지는가 — 아니면 빈 결과 줄("보내면 글로 갑니다")을 내지 않는다 */
  const slashSendable = $derived(slashQuery !== null && slashIntent(target.cli, `/${slashQuery}`, slashAll).kind === "send");
  const slashPend = $derived(slashPending(live?.commands ?? null));
  const slashOpen = $derived(
    slashQuery !== null && visible && pendingN === 0 && !live?.gone && (slashRows.length > 0 || slashSendable || slashPend),
  );
  const pickable = (e: SlashEntry) => e.cls !== "terminal";
  const slashAt = $derived.by(() => {
    const cur = slashRows[slashActive];
    if (cur && pickable(cur)) return slashActive;
    const exact = exactSlash(slashRows, slashQuery ?? "");
    return exact >= 0 ? exact : slashRows.findIndex(pickable);
  });

  function closeSlash(dismiss: boolean): void {
    if (slashQuery === null) return;
    slashDismissed = dismiss ? (inputEl?.value ?? null) : null;
    slashQuery = null;
    slashActive = -1;
  }

  function syncSlash(): void {
    const el = inputEl;
    if (!el) return;
    const q = slashTrigger(el.value, el.selectionStart ?? el.value.length);
    if (q === null) {
      slashDismissed = null;
      closeSlash(false);
      return;
    }
    if (slashDismissed === el.value) return;
    slashDismissed = null;
    if (slashQuery === null) {
      slashBox = el.closest<HTMLElement>("[data-flip-composer] .wrap") ?? el;
      modelOpen = false;
      modeOpen = false;
      ctxOpen = false;
      closeRewindUi();
      closeExtras();
    }
    if (q !== slashQuery) {
      slashQuery = q;
      slashActive = -1;
    }
  }

  function stepSlash(dir: 1 | -1): number {
    const n = slashRows.length;
    if (n === 0) return -1;
    let i = slashAt;
    for (let k = 0; k < n; k++) {
      i = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
      if (pickable(slashRows[i])) return i;
    }
    return -1;
  }

  /** 메뉴가 열려 있을 때만 · 수식 키 없는 다섯 키만 — 나머지(앱 단축키 · Shift+Enter · IME 조합)는 그대로 흘려보낸다 */
  function onFieldKey(ev: KeyboardEvent): void {
    // MCP 풍선은 포커스를 입력 칸에 둔 채 열릴 수 있다 — Esc 는 풍선만 닫는다(글 · 다른 층은 그대로)
    if (mcpAnchor && !slashOpen && ev.key === "Escape" && !isImeKey(ev) && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMcp(true);
      return;
    }
    if (!slashOpen || isImeKey(ev) || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    let handled = true;
    if (ev.key === "Escape") closeSlash(true);
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const i = stepSlash(ev.key === "ArrowDown" ? 1 : -1);
      if (i >= 0) slashActive = i;
      else handled = false;
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      const e = slashRows[slashAt];
      // 인자 없이 정확히 친 그대로 보내는 명령 — Enter 는 넣지 않고 보내기 길로(Tab 은 넣기)
      if (ev.key === "Enter" && slashEnterSends(slashRows, slashAt, slashQuery ?? "")) handled = false;
      else if (e && pickable(e)) pickSlash(e);
      // 흐린 줄을 고른 채 Tab — 아무것도 넣지 않고 안내만(Enter 는 보내기 길이 막고 안내한다)
      else if (e && ev.key === "Tab") slashNote = { kind: "terminal", name: e.name };
      else handled = false;
    } else handled = false;
    if (!handled) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  function pickSlash(e: SlashEntry): void {
    runOnMenu(
      () => ({ e, tg: target }),
      () => closeSlash(true),
      (x) => runSlashEntry(x.e, x.tg),
    );
  }

  function runSlashEntry(e: SlashEntry, tg: ChatTileTarget): void {
    const el = inputEl;
    if (e.cls === "terminal") {
      slashNote = { kind: "terminal", name: e.name };
      el?.focus({ preventScroll: true });
      return;
    }
    if (e.cls === "aynx" && e.action) {
      if (el) setComposerText(el, "");
      runSlashAction(e.action, tg);
      return;
    }
    if (!el || e.insert === "") return;
    setComposerText(el, e.insert);
    if (e.skill && !picked.includes(e.name)) picked = [...picked, e.name];
  }

  /** 거짓 = 친 글을 남긴다(카드를 열지 못하고 안내만 했을 때) */
  function runSlashAction(action: AynxAction, tg: ChatTileTarget, args = ""): boolean {
    switch (action) {
      case "model": {
        const el = faceEl?.querySelector<HTMLElement>("[data-chat-model-chip]");
        if (!el || modelLocked) return true;
        closeRewindUi();
        keyword.onopen(el);
        if (!modelOpen) modelOpen = true;
        return true;
      }
      case "mode": {
        const el = faceEl?.querySelector<HTMLElement>("[data-chat-tile-mode-chip]");
        if (!el || modeLocked) return true;
        closeRewindUi();
        closeExtras();
        modeBtn = el;
        modelOpen = false;
        ctxOpen = false;
        modeOpen = true;
        return true;
      }
      case "context": {
        const el = faceEl?.querySelector<HTMLElement>("[data-chat-tile-context]");
        if (!el) return true;
        closeRewindUi();
        closeExtras();
        ctxBtn = el;
        modelOpen = false;
        modeOpen = false;
        ctxOpen = true;
        return true;
      }
      case "newChat":
        if (!isRemote) newChatInPlace(tg);
        return true;
      case "conversations": {
        const tab = tabOfPane(tg.paneId);
        openFolderConversations(tab ? { tabId: tab.id, paneId: tg.paneId } : undefined);
        return true;
      }
      case "usage":
        openUsageView();
        return true;
      case "compact":
        startCompact(null);
        return true;
      case "copyHint":
      case "diffHint":
        slashNote = { kind: action };
        return true;
      case "rewind":
        void openPicker();
        return true;
      case "mcpStatus":
        openMcp(null);
        return true;
      case "review":
        return openReview(args);
      case "goal":
        return openGoal(args);
      case "fast":
        openFast();
        return true;
    }
  }

  const slashNoteText = $derived.by(() => {
    const n = slashNote;
    if (!n) return "";
    if (n.kind === "terminal") return t("pane.chatTile.slash.terminalOnly", { name: n.name });
    if (n.kind === "info") return t(n.key);
    return t(n.kind === "copyHint" ? "pane.chatTile.slash.copyHint" : "pane.chatTile.slash.diffHint");
  });

  $effect(() => {
    if (pendingN > 0 || !visible) closeSlash(false);
  });

  // ── 검토 · 목표 · MCP 상태 · 속도 ──

  const REVIEW_ROW = "review-card";
  const GOAL_ROW = "goal-card";
  let cardGen = 0;
  /** 카드는 열 때의 값으로 선다 — 다시 열면 새 카드(`gen`) */
  let reviewOpen = $state<{ draft: ReviewDraft; gen: number } | null>(null);
  let goalOpen = $state<{ objective: string; gen: number } | null>(null);
  /** 카드에서 보낸 op 의 거절 — 카드에 보이고 다시 보내지 않는다 */
  let cardErr = $state<string | null>(null);
  let cardSending = $state(false);
  let bandErr = $state<string | null>(null);
  let mcpAnchor = $state<HTMLElement | null>(null);

  const goalView = $derived(isCodex ? goalBar(live?.goal ?? null) : null);
  const mcpSum = $derived(mcpSummary(live?.mcpStatus?.servers ?? []));

  function closeCards(): void {
    reviewOpen = null;
    goalOpen = null;
    cardErr = null;
  }

  /** 다른 메뉴 · 카드가 열릴 때 — 검토 · 목표 카드의 글은 버린다 */
  function closeExtras(): void {
    mcpAnchor = null;
    closeCards();
  }

  /** 검토 · 목표 카드 · MCP 풍선을 열기 전 — 떠 있는 것 · 다른 카드를 모두 닫는다 */
  function closeAllSurfaces(): void {
    modelOpen = false;
    modeOpen = false;
    ctxOpen = false;
    closeSlash(true);
    closeRewindUi();
    closeExtras();
  }

  $effect(() => {
    if (pendingN > 0 || live?.gone) untrack(() => closeCards());
  });
  $effect(() => {
    if (pendingN > 0 || !visible || live?.gone) mcpAnchor = null;
  });
  // 목표가 새로 알려지면 지난 띠 단추의 거절 글은 걷는다
  $effect(() => {
    void live?.goal;
    untrack(() => (bandErr = null));
  });

  function openReview(args: string): boolean {
    if (!isCodex || !live || live.gone) return true;
    if (working) {
      slashNote = { kind: "info", key: "pane.chatTile.review.busy" };
      return false;
    }
    closeAllSurfaces();
    reviewOpen = { draft: reviewDraft(args), gen: ++cardGen };
    return true;
  }

  function openGoal(args: string): boolean {
    if (!isCodex || !live || live.gone) return true;
    if (working) {
      slashNote = { kind: "info", key: "pane.chatTile.goal.busy" };
      return false;
    }
    closeAllSurfaces();
    goalOpen = { objective: args, gen: ++cardGen };
    return true;
  }

  function closeCardBack(): void {
    closeCards();
    inputEl?.focus({ preventScroll: true });
  }

  /** 거절 글은 카드 · 띠에 옮기고 위 배너는 걷는다(같은 글을 두 번 보이지 않게) */
  function takeError(): string | null {
    const e = chatTileLiveOf(target.chat)?.error ?? null;
    if (!e) return null;
    dismissChatTileError(target.chat);
    return chatTileErrorText(e);
  }

  async function startReview(tgt: ReviewTargetWire): Promise<void> {
    if (cardSending) return;
    cardSending = true;
    cardErr = null;
    const ok = await reviewChatTile(target, tgt);
    cardSending = false;
    if (ok) closeCardBack();
    else cardErr = takeError();
  }

  async function setGoal(objective: string, budget: GoalBudget): Promise<void> {
    if (cardSending) return;
    cardSending = true;
    cardErr = null;
    const ok = await goalChatTile(target, "set", objective, budget);
    cardSending = false;
    if (ok) closeCardBack();
    else cardErr = takeError();
  }

  async function goalAction(action: "pause" | "resume" | "clear"): Promise<void> {
    bandErr = null;
    const ok = await goalChatTile(target, action);
    if (!ok) bandErr = takeError();
  }

  /** `anchor` 없음 = 입력 칸 상자 위에 */
  function openMcp(anchor: HTMLElement | null): void {
    const a = anchor ?? faceEl?.querySelector<HTMLElement>("[data-flip-composer] .wrap") ?? null;
    if (!a || !live || live.gone || pendingN > 0) return;
    closeAllSurfaces();
    mcpAnchor = a;
    void askMcpStatus(target);
  }

  function closeMcp(back: boolean): void {
    mcpAnchor = null;
    if (back) inputEl?.focus({ preventScroll: true });
  }

  function refreshMcp(): void {
    runOnMenu(
      () => ({ tg: target }),
      () => {},
      (x) => void askMcpStatus(x.tg),
    );
  }

  function mcpFromContext(): void {
    runOnMenu(
      () => ctxBtn,
      () => closeCtx(false),
      (el) => openMcp(el),
    );
  }

  /** Codex `/fast` — 모델 메뉴를 열고 속도 줄로. 이 모델에 등급이 없으면 안내만 */
  function openFast(): void {
    if (!isCodex || !live) return;
    if (tierRowsList.length === 0) {
      slashNote = { kind: "info", key: "pane.chatTile.tier.none" };
      return;
    }
    const el = faceEl?.querySelector<HTMLElement>("[data-chat-model-chip]");
    if (!el || modelLocked) return;
    closeRewindUi();
    keyword.onopen(el);
    if (!modelOpen) modelOpen = true;
    // 메뉴가 고른 모델 줄에 포커스를 준 뒤에 옮긴다
    void tick().then(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-flip-model-menu] [data-chat-tile-tier][tabindex="0"]')?.focus({ preventScroll: true }),
      ),
    );
  }

  /** `""` = CLI 기본 · 메뉴는 열린 채(모델 · 강도와 같다) */
  function pickTier(id: string): void {
    runOnMenu(
      () => ((id || null) !== tierNow ? { tg: target, tier: id } : null),
      () => {},
      (x) => void retuneChatTile(x.tg, { tier: x.tier }),
    );
  }

  function onTierKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown" && ev.key !== "Home" && ev.key !== "End") return;
    const box = (ev.currentTarget as HTMLElement).closest("[data-chat-tile-tiers]");
    const list = Array.from(box?.querySelectorAll<HTMLElement>("[data-chat-tile-tier]") ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(ev.currentTarget as HTMLElement);
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? list.length - 1 : ev.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus({ preventScroll: true });
  }

  // 입력 칸 갈고리 — 사건은 칸 자신에 건다(위임된 `onkeydown` 보다 먼저 돈다)
  $effect(() => {
    const el = inputEl;
    if (!el) return;
    return untrack(() => {
      const onInput = () => {
        slashNote = null;
        syncSlash();
      };
      const onKeyup = (ev: KeyboardEvent) => {
        if (!isImeKey(ev)) syncSlash();
      };
      const onBlur = (ev: FocusEvent) => {
        const to = ev.relatedTarget;
        if (to instanceof Element && to.closest("[data-chat-tile-slash-menu]")) return;
        closeSlash(true);
      };
      el.addEventListener("input", onInput);
      el.addEventListener("keydown", onFieldKey);
      el.addEventListener("keyup", onKeyup);
      el.addEventListener("blur", onBlur);
      return () => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("keydown", onFieldKey);
        el.removeEventListener("keyup", onKeyup);
        el.removeEventListener("blur", onBlur);
      };
    });
  });

  $effect(() => {
    const el = inputEl;
    if (!el) return;
    if (slashOpen) {
      el.setAttribute("aria-autocomplete", "list");
      el.setAttribute("aria-controls", `${slashId}-list`);
      if (slashAt >= 0) el.setAttribute("aria-activedescendant", `${slashId}-${slashAt}`);
      else el.removeAttribute("aria-activedescendant");
    } else {
      el.removeAttribute("aria-autocomplete");
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-activedescendant");
    }
  });

  // `routeTileFocus` 가 타일 몸의 `[data-tile-focus]` 자손에 포커스를 준다 — 입력 칸이 그 자리다
  $effect(() => {
    const el = inputEl;
    if (el) untrack(() => el.setAttribute("data-tile-focus", ""));
  });
</script>

{#snippet card(key: string)}
  {@const e = byKey.get(key)}
  {#if reviewOpen && key === `${REVIEW_ROW}-${reviewOpen.gen}`}
    <ChatTileReviewCard
      draft={reviewOpen.draft}
      busy={working}
      sending={cardSending}
      error={cardErr}
      touch={phone}
      onstart={(tg) => void startReview(tg)}
      oncancel={closeCardBack}
    />
  {:else if goalOpen && key === `${GOAL_ROW}-${goalOpen.gen}`}
    <ChatTileGoalCard
      objective={goalOpen.objective}
      replacing={!!live?.goal}
      busy={working}
      sending={cardSending}
      error={cardErr}
      touch={phone}
      onset={(o, b) => void setGoal(o, b)}
      oncancel={closeCardBack}
    />
  {:else if key === REWIND_ROW && rewindAsk}
    <ChatTileRewindCard
      ask={rewindAsk}
      cli={target.cli}
      cwd={target.cwd}
      scopes={rewindScopesNow}
      busy={working}
      touch={phone}
      onconfirm={() => confirmRewind(target)}
      oncancel={cancelRewindCard}
      onscope={setRewindScope}
    />
  {:else if e && e.kind === "permission" && e.toolName === "ExitPlanMode"}
    <ChatTilePlanCard
      perm={e}
      input={live?.permInputs[e.requestId]}
      {agent}
      busy={!!deciding[e.requestId]}
      ondecide={(d, message) => void decide(e.requestId, d, { message })}
    />
  {:else if e && e.kind === "permission" && (e.toolName === "AskUserQuestion" || e.toolName === "request_user_input")}
    <ChatTileQuestionCard
      perm={e}
      input={live?.permInputs[e.requestId]}
      cli={target.cli}
      {agent}
      busy={!!deciding[e.requestId]}
      touch={phone}
      onanswer={(answers) => void decide(e.requestId, "answer", { answers })}
      ondecline={() => void decide(e.requestId, "deny")}
    />
  {:else if e && e.kind === "permission"}
    <ChatTilePermCard
      perm={e}
      input={live?.permInputs[e.requestId]}
      sessionAllow={live?.permSessions[e.requestId]}
      {agent}
      busy={!!deciding[e.requestId]}
      ondecide={(d) => void decide(e.requestId, d)}
    />
  {:else if e && e.kind === "text" && isPlanItem(e.item)}
    <ChatTilePlanBlock text={e.text} streaming={!e.done} hint={codexPlanMode && key === lastLivePlan} />
  {:else if e && e.kind === "outcome"}
    <div class="note" class:err={e.outcome === "error"} data-chat-tile-outcome={e.outcome}>
      {e.outcome === "interrupted"
        ? t("app.chatDock.outcome.interrupted")
        : e.message
          ? t("app.chatDock.outcome.error.detail", { e: e.message })
          : t("app.chatDock.outcome.error")}
    </div>
  {:else if e && e.kind === "notice"}
    {@const text = chatTileNoticeText(e.code, e.detail)}
    {#if text !== null}
      <div
        class="note"
        class:hint={HINT_NOTICES.has(e.code)}
        class:err={ERR_NOTICES.has(e.code)}
        data-chat-tile-notice={e.code}
      >
        {#if e.code === "needs-terminal"}<UiIcon name="terminal" size={13} />
        {:else if e.code === "compacting"}<span class="spin" aria-hidden="true"><UiIcon name="sync" size={13} /></span>
        {:else if e.code === "compacted"}<UiIcon name="view-compact" size={13} />
        {:else if e.code === "reviewing"}<span class:spin={running} aria-hidden="true"><UiIcon name={running ? "sync" : "list-checks"} size={13} /></span>
        {:else if e.code === "reviewed"}<UiIcon name="list-checks" size={13} />
        {:else if e.code === "review-stopped"}<UiIcon name="stop" size={13} />
        {:else if e.code === "goal-feedback"}<UiIcon name="route" size={13} />
        {/if}<span>{text}</span>
      </div>
    {/if}
  {:else if e && e.kind === "exited"}
    <div class="note" data-chat-tile-exited={e.reason}>{t("pane.chatTile.exited")}</div>
  {/if}
{/snippet}

{#snippet recordPlan(it: TranscriptItem, last: boolean)}
  {#if it.role === "assistant"}
    <ChatTilePlanBlock text={it.text ?? ""} truncated={it.truncated} hint={codexPlanMode && last && lastLivePlan === null} />
  {:else}
    <ChatTilePlanBlock
      text={it.plan?.body ?? null}
      truncated={it.plan?.bodyTruncated ?? false}
      title={t("pane.chatTile.plan.title", { agent })}
      file={it.plan?.file ?? null}
      outcome={it.plan?.outcome ?? null}
      feedback={it.plan?.feedback ?? null}
    />
  {/if}
{/snippet}

{#snippet traceCard(key: string)}
  {@const rw = live?.rewinds.find((v) => v.key === key)}
  {@const cp = rw ? undefined : live?.compactions.find((v) => v.key === key)}
  {@const gn = rw || cp ? undefined : live?.goalNotes.find((v) => v.key === key)}
  {@const rv = rw || cp || gn ? undefined : live?.reviews.find((v) => v.key === key)}
  {@const x = rw || cp || gn || rv ? undefined : live?.traces.find((v) => v.requestId === key)}
  {#if rv}
    <div class="note hint" data-chat-tile-review-trace={rv.code}>
      <UiIcon name={rv.code === "review-stopped" ? "stop" : "list-checks"} size={13} /><span>{chatTileNoticeText(rv.code, rv.label)}</span>
    </div>
  {:else if gn}
    <div class="note hint" data-chat-tile-goal-note>
      <UiIcon name="route" size={13} /><span>{chatTileNoticeText("goal-claude", null)}</span>
    </div>
  {:else if cp}
    <div class="note hint" data-chat-tile-compact-trace>
      <UiIcon name="view-compact" size={13} /><span>{chatTileNoticeText("compacted", cp.detail)}</span>
    </div>
  {:else if rw}
    <div class="note trace" data-chat-tile-rewind-trace={rw.scope}>
      <UiIcon name="undo" size={13} /><span>{rewindTraceText(rw)}</span>
    </div>
  {:else if x}
    {@const what = traceWhat(x.allow)}
    <div class="note trace" data-chat-tile-trace={x.allow.kind} title={t("pane.chatTile.trace.session", { what })}>
      <UiIcon name="shield-check" size={13} /><span>{t("pane.chatTile.trace.session", { what: shortDetail(what) })}</span>
    </div>
  {/if}
{/snippet}

{#snippet rewindAction(it: TranscriptItem)}
  {#if live && !live.gone && rewindable(it, rewindScopesNow)}
    <button
      type="button"
      class="rw-btn"
      class:touch={phone}
      data-chat-tile-rewind={it.anchor}
      title={working ? t("pane.chatTile.rewind.action.busy") : t(rewindActionKey(rewindScopesNow))}
      aria-label={t(rewindActionKey(rewindScopesNow))}
      aria-disabled={working ? "true" : undefined}
      onclick={() => {
        if (!working) void openRewind(it);
      }}><UiIcon name="undo" size={14} /></button
    >
  {/if}
{/snippet}

{#snippet lead()}
  <button
    type="button"
    class="plus"
    class:touch={phone}
    data-chat-tile-plus
    disabled={!!live?.gone}
    title={t("pane.flip.composer.attach")}
    aria-label={t("pane.flip.composer.attach")}
    onclick={() => pickEl?.click()}><UiIcon name="plus" size={20} /></button
  >
  <span class="lead-gap" aria-hidden="true"></span>
  <ChatTileModeChip view={modeView} open={modeOpen} busy={modeLocked} touch={phone} ontoggle={toggleMode} />
  {#if ctxView}
    <ChatTileContextMeter
      view={ctxView}
      busy={working}
      {canCompact}
      open={ctxOpen}
      touch={phone}
      ontoggle={toggleCtx}
      oncompact={() => startCompact(null)}
    />
  {/if}
{/snippet}

{#snippet slashNoteRow()}
  {#if slashNote}
    <div class="slash-note" role="status" data-chat-tile-slash-note={slashNote.kind}>
      <UiIcon name={slashNote.kind === "terminal" ? "terminal" : "info"} size={13} />
      <span class="grow">{slashNoteText}</span>
      <button
        type="button"
        class="banner-x"
        title={t("app.actions.close")}
        aria-label={t("app.actions.close")}
        onclick={() => {
          slashNote = null;
          inputEl?.focus({ preventScroll: true });
        }}><UiIcon name="close" size={12} /></button
      >
    </div>
  {/if}
{/snippet}

{#snippet keywordSlot()}
  <ChatModelKeyword view={keyword} touch={phone} />
  {#if tierShown}
    <span class="tier-mark" title={t("pane.chatTile.tier.chip", { name: tierShown.name })} data-chat-tile-tier-chip={tierShown.id}
      ><UiIcon name="zap" size={12} /></span
    >
  {/if}
{/snippet}

{#snippet cliRow()}
  <div class="cli-row" class:touch={phone} bind:this={cliRowEl} data-chat-tile-cli-row>
    <div class="seg-group" role="radiogroup" aria-label={t("app.chatDock.cli.aria")} style:--seg-n={cliChoices.length}>
      {#each cliChoices as x (x.id)}
        {@const on = x.id === target.cli}
        {@const logo = aiIconName(x.id)}
        <button
          type="button"
          role="radio"
          class="seg"
          class:on
          aria-checked={on}
          tabindex={on ? 0 : -1}
          data-chat-tile-cli={x.id}
          onkeydown={onCliKey}
          onclick={() => pickCli(x.id)}
        >
          {#if logo}<AiGlyph name={logo} size={14} mono />{:else}<UiIcon name="ai" size={14} />{/if}
          <span class="seg-name">{x.name}</span>
        </button>
      {/each}
    </div>
  </div>
  <hr class="menu-sep" />
{/snippet}

{#snippet tierRows()}
  <div class="tiers" data-chat-tile-tiers>
    <div class="tier-head" id="{slashId}-tier">{t("pane.chatTile.tier.title")}</div>
    <div role="radiogroup" aria-labelledby="{slashId}-tier">
      <button
        type="button"
        role="radio"
        class="row menu-row tier-row"
        aria-checked={tierShown === null}
        tabindex={tierShown === null ? 0 : -1}
        data-chat-tile-tier="default"
        onkeydown={onTierKey}
        onclick={() => pickTier("")}
      >
        <span class="tier-text"
          ><span class="tier-name">{t("pane.chatTile.tier.default")}</span>{#if live?.tiers?.thread}<span class="tier-desc" data-chat-tile-tier-thread
              >{live.tiers.thread}</span
            >{/if}</span
        >
        <span class="tier-check" aria-hidden="true">{#if tierShown === null}<UiIcon name="check" size={14} />{/if}</span>
      </button>
      {#each tierRowsList as o (o.id)}
        {@const on = tierShown?.id === o.id}
        <button
          type="button"
          role="radio"
          class="row menu-row tier-row"
          aria-checked={on}
          tabindex={on ? 0 : -1}
          data-chat-tile-tier={o.id}
          onkeydown={onTierKey}
          onclick={() => pickTier(o.id)}
        >
          <span class="tier-text"><span class="tier-name">{o.name}</span>{#if o.description}<span class="tier-desc">{o.description}</span>{/if}</span>
          <span class="tier-check" aria-hidden="true">{#if on}<UiIcon name="check" size={14} />{/if}</span>
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet stopPill(compact: boolean)}
  <button
    type="button"
    class="stop-pill"
    class:compact
    class:touch={phone}
    data-chat-tile-stop
    data-head-act={inHead ? "" : undefined}
    title={t("pane.chatTile.stop")}
    aria-label={t("pane.chatTile.stop")}
    onclick={stop}
  >
    <span class="stop-mark" aria-hidden="true"></span>{#if !compact}<span>{t("pane.chatTile.stop")}</span>{/if}
  </button>
{/snippet}

{#snippet headTail()}
  {#if title}<span class="conv-title" title={title} data-chat-tile-title>{title}</span>{/if}
{/snippet}

{#snippet headBar()}
  {#if running}<span class="head-stop">{@render stopPill(faceW > 0 && faceW < HEAD_NARROW_PX)}</span>{/if}
{/snippet}

<div
  class="face"
  class:holding={pendingN > 0}
  bind:this={faceEl}
  bind:clientWidth={faceW}
  role="region"
  aria-label={t("pane.name.chatTile", { agent })}
  data-chat-tile-face={target.chat}
>
  {#if live?.gone}
    <div class="banner err" role="alert" data-chat-tile-gone>
      <span class="grow">{chatTileErrorText(live.error ?? "")}</span>
      {#if onretry}
        <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-retry onclick={onretry}>{t("pane.chatTile.err.retry")}</button>
      {/if}
    </div>
  {:else if live?.error}
    <div class="banner err" role="alert" data-chat-tile-error>
      <span class="grow">{chatTileErrorText(live.error)}</span>
      <button
        type="button"
        class="banner-x"
        title={t("app.actions.close")}
        aria-label={t("app.actions.close")}
        onclick={() => dismissChatTileError(target.chat)}><UiIcon name="close" size={14} /></button
      >
    </div>
  {/if}

  <TranscriptBody
    {convKey}
    {fetchPage}
    {failureOf}
    column
    chat
    diagrams
    copyable
    paths={pathLinks}
    {pictures}
    {activity}
    live={rows}
    liveCard={card}
    hold={st ? historyHold(st) : null}
    refresh={st?.ended ?? 0}
    onrefreshed={(ok) => ok && clearEndedChatTile(target.chat)}
    onloaded={(ok) => ok && clearEndedChatTile(target.chat)}
    emptyText={t("pane.chatTile.empty")}
    cardItem={isPlanRow}
    itemCard={recordPlan}
    notes={traceNotes}
    noteCard={traceCard}
    userAction={rewindAction}
  />

  {#if pendingN > 0}
    <!-- 머리줄이 없으면(폰 · 머리줄 끔) 입력 칸이 물러난 동안 [중지]는 이 줄에 -->
    <div class="held" data-chat-tile-held>
      <span role="status">{t("pane.chatTile.perm.held")}</span>
      {#if running && !inHead}{@render stopPill(false)}{/if}
    </div>
  {/if}
  {#if goalView && live?.goal}
    <div class="goal-slot" data-chat-tile-goal-slot>
      <ChatTileGoalBar
        bar={goalView}
        objective={live.goal.objective}
        busy={live.goalBusy}
        resumeBlocked={working}
        error={bandErr}
        touch={phone}
        onaction={(a) => void goalAction(a)}
        ondismiss={() => (bandErr = null)}
      />
    </div>
  {/if}
  <!-- 숨기기만 한다 — 친 글을 잃지 않게 -->
  <div class="composer-slot" class:held={pendingN > 0}>
    <FlipComposer
      onsend={send}
      onterminal={() => {}}
      leading={lead}
      inField={keywordSlot}
      above={slashNote ? slashNoteRow : undefined}
      {gate}
      busy={running}
      oninterrupt={stop}
      terminalKeys
      placeholder={t("pane.chatTile.placeholder", { agent })}
      {attachments}
      onremove={(id) => removeComposerAttachment(attachKey, id)}
      onattach={attachFiles}
      ondropdata={onDropData}
      enterNewline={phone}
      touch={phone}
      bind:inputEl
    />
  </div>
  <input bind:this={pickEl} class="pick-input" type="file" multiple tabindex="-1" aria-hidden="true" data-chat-tile-pick onchange={onPicked} />
  {#if modelOpen && modelBtn && !modelLocked}
    <FlipModelMenu
      cli={target.cli}
      {models}
      levels={efforts}
      {effort}
      ring
      note={t("pane.chatTile.model.note")}
      trigger={modelBtn}
      touch={phone}
      head={!isRemote && cliChoices.length > 1 ? cliRow : undefined}
      extra={isCodex && tierRowsList.length > 0 ? tierRows : undefined}
      onmodel={pickModel}
      oneffort={pickEffort}
      onclose={closeModel}
    />
  {/if}
  {#if modeOpen && modeBtn && !modeLocked}
    <ChatTileModeMenu cli={target.cli} view={modeView} trigger={modeBtn} touch={phone} onpick={pickMode} onclose={closeMode} />
  {/if}
  {#if ctxOpen && ctxBtn && ctxView}
    <ChatTileContextPopover
      cli={target.cli}
      view={ctxView}
      last={live?.lastCompaction ?? null}
      source={live?.context?.source ?? ""}
      status={st?.status ?? "stopped"}
      {canCompact}
      anchor={ctxBtn}
      touch={phone}
      mcp={mcpSum}
      oncompact={compactFromPopover}
      onmcp={mcpFromContext}
      onclose={closeCtx}
    />
  {/if}
  {#if mcpAnchor && live}
    <ChatTileMcpPopover
      cli={target.cli}
      status={live.mcpStatus}
      ask={live.mcpAsk}
      error={live.mcpError ? chatTileErrorText(live.mcpError) : null}
      notStarted={!live.mcpStatus && (st?.status ?? "stopped") === "stopped"}
      anchor={mcpAnchor}
      bound={faceEl}
      touch={phone}
      onrefresh={refreshMcp}
      onclose={closeMcp}
    />
  {/if}
  {#if picker}
    <ChatTileRewindPicker
      items={picker.items}
      busy={working}
      anchor={picker.box}
      bound={faceEl}
      touch={phone}
      onpick={pickRewind}
      onclose={closePicker}
    />
  {/if}
  {#if slashOpen && slashBox}
    <ChatTileSlashMenu
      entries={slashRows}
      active={slashAt}
      pending={slashPend}
      more={slashMore}
      sendable={slashSendable}
      anchor={slashBox}
      bound={faceEl}
      idBase={slashId}
      touch={phone}
      onpick={pickSlash}
      onhover={(i) => (slashActive = i)}
      onclose={() => closeSlash(true)}
    />
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

  .plus:hover:not(:disabled) {
    background: var(--control-tile-bg-hover);
  }

  .plus:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .plus:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 폰 — 보이는 크기는 그대로, 누르는 자리만 44px */
  .plus.touch::after {
    content: "";
    position: absolute;
    inset: -6px;
  }

  .lead-gap {
    flex: none;
    width: 6px;
  }

  .pick-input {
    display: none;
  }

  /* 기록 사람 줄의 [되감기] — 복사 단추와 같은 크기 · 같은 보임(데스크톱은 호버 · 포커스, 폰은 늘) */
  .rw-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--fg-3);
    background: transparent;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .rw-btn:hover:not([aria-disabled="true"]) {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .rw-btn[aria-disabled="true"] {
    cursor: default;
  }

  .rw-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  :global([data-item="user"]:hover) .rw-btn,
  :global([data-item="user"]:focus-within) .rw-btn,
  .rw-btn.touch {
    opacity: 1;
  }

  :global([data-item="user"]:hover) .rw-btn[aria-disabled="true"],
  :global([data-item="user"]:focus-within) .rw-btn[aria-disabled="true"],
  .rw-btn.touch[aria-disabled="true"] {
    opacity: 0.45;
  }

  @media (prefers-reduced-motion: reduce) {
    .rw-btn {
      transition: none;
    }
  }

  .face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  /* 머리줄 이름 뒤 — 밑동 0 으로 남는 폭만 받아 이름보다 먼저 준다(줄이는 비율로 나누면 이름도 1px 씩 잘린다) */
  .conv-title {
    flex: 1000 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .head-stop {
    display: flex;
    align-items: center;
    margin-left: auto;
    --head-act-gap: 0px;
  }

  .stop-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-sizing: border-box;
    height: 24px;
    padding: 0 10px 0 9px;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--control-tile-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .stop-pill:hover {
    background: var(--control-tile-bg-hover);
  }

  .stop-pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .stop-mark {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: currentColor;
  }

  .stop-pill.compact {
    width: 24px;
    padding: 0;
  }

  .stop-pill.touch {
    height: 36px;
    padding: 0 14px 0 12px;
  }

  .banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3) var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-1);
    border-radius: var(--radius-surface-inner);
  }

  .banner.err {
    background: color-mix(in srgb, var(--err) 12%, var(--surface-field));
    border: 1px solid color-mix(in srgb, var(--err) 40%, var(--line-strong));
  }

  .banner .grow {
    overflow-wrap: anywhere;
  }

  .banner-x {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .banner-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .note.err {
    color: var(--err);
  }

  .note.hint {
    color: var(--fg-2);
  }

  .note.trace :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--fg-2);
  }

  .note.hint :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .spin {
    flex: none;
    display: inline-flex;
    animation: ct-spin 1.1s linear infinite;
  }

  @keyframes ct-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  .slash-note {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border-radius: var(--radius-sm);
  }

  .slash-note :global(svg) {
    flex: none;
  }

  .slash-note .grow {
    overflow-wrap: anywhere;
  }

  /* 목표 띠 — 입력 칸과 같은 가운데 단 · 입력 칸 · 모드 칩을 덮지 않는 제 줄 */
  .goal-slot {
    flex: none;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-1) var(--space-5) 0;
    container: ct-face / inline-size;
  }

  .tier-mark {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--accent);
  }

  /* CLI 줄 — 사이드 채팅 모델 풍선(`ChatModelPopover`)의 세그먼트와 같은 모양 */
  .cli-row {
    flex: none;
  }

  .seg-group {
    display: grid;
    grid-template-columns: repeat(var(--seg-n), minmax(0, 1fr));
    gap: 2px;
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  .seg {
    min-width: 0;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .cli-row.touch .seg {
    height: 44px;
  }

  .seg:not(.on):hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .seg.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .seg:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .seg-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tiers {
    flex: none;
    display: flex;
    flex-direction: column;
  }

  .tier-head {
    padding: 2px var(--space-3) 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .tier-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: auto;
    min-height: 36px;
    padding-top: 4px;
    padding-bottom: 4px;
    white-space: normal;
  }

  .tier-row[aria-checked="true"] .tier-name {
    font-weight: var(--fw-semibold);
  }

  .tier-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .tier-desc {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .tier-check {
    flex: none;
    width: 16px;
    display: inline-flex;
    justify-content: center;
    color: var(--control-sel-fg);
  }

  .held {
    flex: none;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-1) var(--space-5) var(--space-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
    text-align: center;
  }

  .composer-slot.held {
    display: none;
  }

  /* 카드가 기다리는 동안 대화 칸 위아래 여백을 줄여 카드(단추 줄 · 선택지)에 높이를 준다 */
  .face.holding :global([data-viewer-body]) {
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
  }
</style>
