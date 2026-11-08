<script lang="ts">
  /**
   * **사이드 채팅 하나의 대화 면**(v2 4단계 — docs/log/2026-10-23-side-chat-v2-design.md 5절) — 채팅 독(`ChatDock`)이 지금 고른 채팅마다
   * 하나 세운다. 터미널 · PTY 가 없다(v1 의 `<AiFlip><Terminal/></AiFlip>` · 화면 읽기 · 신뢰 묻기 판정을 걷었다) — 속은 세션 서버의
   * 채팅 프로세스이고 상태는 `app/side-chat-live.svelte.ts` 가 쥔다(이 컴포넌트가 사라져도 남는다 — 채팅을 바꿔도 지금 턴을 잃지 않는다).
   *
   * - **기록 + 꼬리**: 지난 턴은 기록 파일(`agent_conversation_transcript` — 대화 id 로 · 시트 · 타일 대화 면과 같은 `TranscriptBody`),
   *   지금 턴은 사건에서 접은 꼬리(`live`). 따라가기 폴링은 쓰지 않는다 — 턴이 끝나면(`ended` 가 늘면) 최신 쪽을 한 번 받고, 받은 뒤에
   *   그 턴의 꼬리를 걷는다(`clearEndedSideChat`). 턴이 도는 동안 받은 쪽은 `hold` 로 겹치는 자리에서 자른다.
   * - **권한 카드**: 꼬리 안의 카드 — 제목 · 도구 · 상세(명령 · 경로 · 파일 바꾸기의 diff) + **[허용 한 번] [거절]**(`side_chat_decide` —
   *   사람만 · "늘 허용" 없음). 끝난 요청은 그 결과(내가 허용 · 거절 / CLI 가 거둠 / 프로세스가 끝나 닫힘)를 보인다. Codex 는 읽기 전용
   *   명령을 묻지 않고 돌리고 샌드박스 밖(권한 상승)만 묻는다는 한 줄을 붙인다(설계 spike3 규칙 4).
   * - **입력 칸**: `FlipComposer` 의 알약 모양(`tools` — Enter 보내기 · Shift+Enter 줄바꿈 · IME 조합 중 Enter 무시 · 칸 안 오른쪽 아래 = 둥근
   *   보내기 · 칸 아래 줄 = 칩). 첫 보내기는
   *   서버가 CLI 를 띄운다 — 그동안 "{cli} 시작 중…". 턴이 도는 동안 보내기 자리는 **[중단]**(치기는 늘 된다). Esc 는 칸이 쓰지 않으니 독까지
   *   올라가 독을 닫는다(`ChatDock` 의 `onKeydown`).
   * - **알림**: 끊김("중단함" — 실패가 아니다) · 오류 · CLI 알림 · 종료("CLI가 종료됐습니다 [다시 시작]" — 다음 보내기도 다시 띄운다).
   * - 에이전트 말은 마크다운(코드 블록 = `CodeView` 의 강조 · [복사]) + ```mermaid 다이어그램(`TranscriptBody` 의 `diagrams` — 자라는 글의
   *   닫히지 않은 울타리는 코드 블록으로 두었다가 닫히면 그린다) · ```svg 그림(`SvgView` — `<img>` 하나).
   * - **그림**(2026-10-24): 에이전트 말의 `![alt](경로)` 는 이 면이 쥔 `DocImageCache` 하나(로컬 백엔드 — 문서 보기 타일과 같은 규칙 ·
   *   `readPreview` → `blob:` → `<img>` · 새 Tauri 명령 없음)가 읽는다. 상대 경로의 기준은 CLI 의 cwd — 갈라 온 채팅은 `cwd`(서버가 알린
   *   그 대화의 폴더), 아니면 채팅 폴더(`sideChatDir` — 기존 `side_chat_dir`). 그 폴더를 알기 전에는 그림 자리가 "불러오는 중" 이다.
   *   Codex 가 만든 그림(`imageGeneration`)은 서버가 `![지시문](savedPath)` 글로 바꿔 보낸다(절대 경로 — 그림 바이트는 오지 않는다).
   * - 찾기(`find` 단축키)는 이 면의 글자를 찾는다(`DomFindBar` — 다이어그램 SVG 는 훑지 않는다).
   * - **그림 첨부**(2026-10-24): 입력 칸에 놓은 OS 그림 파일 · 파일 타일 짐(로컬은 복사 · 원격은 내려받기) · 붙여 넣은 그림은 로컬 첨부
   *   자리(`<data_root>/attachments/<hex>/` — AI 타일 첨부와 같은 자리 · 30일 정리)의 사본이 되어 칸 위 칩으로 선다(그림만 · 10 MB · 8장).
   *   보내면 그 경로들이 `side_chat_send` 의 `images` 로 간다 — 서버가 그 자리 안의 그림 파일인지 다시 보고 사람 글의 일부로 싣는다
   *   (Claude 블록 · Codex `localImage`). 꼬리의 말풍선은 이름 칩, 기록에 들면 `pictures`(`ConvImageCache` — 타일 대화 면과 같은 명령)가
   *   그림을 그린다.
   * - **폰**(`phone` — 원격 폰 덮개 `mobile/MobileChat` · 2026-11-01): Enter 는 줄바꿈 · 보내기는 단추(화면 키보드), 끌어 놓기 · 붙여 넣기
   *   대신 칸 안 **그림 고르기** 단추(`<input type=file accept="image/*" multiple>` → 같은 `attachFiles` — 원격은 `stage_agent_attachment`
   *   가 집 PC 첨부 자리에 사본을 둔다).
   */
  import { onDestroy, untrack, type Snippet } from "svelte";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import FlipComposer from "$lib/pane/FlipComposer.svelte";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    agentConversationImage,
    agentConversationTranscript,
    type TranscriptPage,
    type TranscriptPicture,
  } from "$lib/context";
  import { ConvImageCache } from "$lib/conv-images.svelte";
  import { stageAgentFiles, stageFsPaths, stageLocalPaths } from "$lib/agent-attachments";
  import { decodeFsDrag, fsDragEmpty, FS_DRAG_TYPE } from "$lib/fs-drag";
  import { sessionOfFsKey } from "$lib/fs-drop-route";
  import { LOCAL_KEY } from "$lib/fs-backend";
  import { showNotice } from "$lib/app/notice";
  import {
    baseName,
    isImageName,
    SIDE_CHAT_IMAGE_MAX_BYTES,
  } from "$lib/pane/composer-attachments";
  import {
    clearComposerAttachments,
    composerAttachmentsOf,
    removeComposerAttachment,
    stageComposerAttachments,
  } from "$lib/pane/composer-attachments.svelte.js";
  import { entryItem, historyHold, pendingPermissions, type LiveEntry } from "$lib/side-chat-live";
  import type { LiveRow } from "$lib/transcript";
  import type { ComposerGate } from "$lib/pane/ai-flip.svelte.js";
  import {
    clearEndedSideChat,
    decideSideChat,
    dismissSideChatError,
    interruptSideChat,
    sendSideChat,
    sideChatFillOf,
    sideChatLiveOf,
    takeSideChatFill,
  } from "$lib/app/side-chat-live.svelte.js";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Decision } from "$lib/side-chat-api";
  import { DocImageCache } from "$lib/doc-images.svelte";
  import { localBackend } from "$lib/fs-backend";
  import { sideChatDir } from "$lib/app/side-chats.svelte.js";

  let {
    chatId,
    cli,
    cliName,
    tools,
    linkNote,
    linkName = null,
    onsent,
    onrestart,
    cwd = "",
    phone = false,
    inputEl = $bindable(null),
  }: {
    chatId: string;
    /** 이 채팅의 지금 CLI(`claude` · `codex`) — 기록을 읽는 갈래 */
    cli: string;
    /** 화면에 쓸 CLI 이름 */
    cliName: string;
    /** 입력 칸 아래 줄 왼쪽(CLI · 모델 칩) */
    tools?: Snippet;
    /** 입력 칸 위 한 줄(연결 칩의 안내 — 읽기 허용이 꺼진 타일 · 닫힌 타일 · 5단계) */
    linkNote?: Snippet;
    /** 연결 칩의 지금 이름 — 보낼 때 서버에 실어 머리글(기록 칩)이 같은 이름이 되게(`linkSendName`) */
    linkName?: string | null;
    /** 보냈다(제목 · 시각 — `app/side-chats`) */
    onsent?: (text: string) => void;
    /** [다시 시작] */
    onrestart: () => void;
    /** CLI 가 도는 폴더(갈라 온 채팅 — 서버가 알린 절대 경로). 비면 채팅 폴더 — 그림의 상대 경로 기준 */
    cwd?: string;
    /** 폰 덮개 — Enter 줄바꿈 · 그림 고르기 단추(머리말) */
    phone?: boolean;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  let pickEl = $state<HTMLInputElement | null>(null);

  /** 그림 고르기 — 고른 파일을 같은 첨부 길로(같은 파일을 다시 고를 수 있게 값을 비운다) */
  function onPicked(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) attachFiles(files);
  }

  /** 한 쪽의 항목 수 — 시트 · 타일 대화 면과 같다 */
  const PAGE = 40;

  const live = $derived(sideChatLiveOf(chatId));
  const st = $derived(live?.state ?? null);
  const conv = $derived(live?.historyConv ?? null);
  const convKey = $derived(conv ? `${cli}:${conv}` : null);

  async function fetchPage(before: number | null): Promise<TranscriptPage> {
    const c = conv;
    if (!c) throw new Error("no-conversation");
    return await agentConversationTranscript(cli, c, before, PAGE);
  }

  function failureOf(e: unknown): string {
    return t("board.viewer.error", { e: stripReason(e instanceof Error ? e.message : String(e)) });
  }

  // ── 그림 ─────────────────────────────────────────────────────────────────────

  const imageCache = new DocImageCache();
  /** 상대 경로를 풀 폴더 — 알기 전 `null`(그림 자리는 불러오는 중) · 못 알면 `""`(절대 경로만 · 상대는 "풀 수 없음") */
  const forkDir = untrack(() => cwd) || null;
  let baseDir = $state<string | null>(forkDir);
  if (forkDir === null) {
    void sideChatDir(untrack(() => chatId)).then(
      (d) => (baseDir = d),
      () => (baseDir = ""),
    );
  }
  /** 마지막으로 받은 그림 주소들 — 폴더를 알게 되면 그때 맞춘다 */
  let imageSrcs: readonly string[] = [];
  const syncImages = () => {
    const dir = baseDir;
    if (dir === null) return;
    // `docPath` 는 그 폴더 안의 가짜 파일 — 상대 경로가 폴더 기준으로 풀린다(`resolveDocLink`)
    const docPath = dir === "" ? "" : `${dir.replace(/[\\/]+$/, "")}/.chat`;
    imageCache.sync(imageSrcs, { backend: localBackend(), docPath, remote: false, gen: "", noNetwork: true });
  };
  $effect(() => {
    void baseDir;
    untrack(syncImages);
  });
  onDestroy(() => imageCache.dispose());
  const images = {
    state: (src: string) => imageCache.state(src),
    broken: (src: string) => imageCache.broken(src),
    source: (src: string) => imageCache.source(src),
    sync: (srcs: readonly string[]) => {
      imageSrcs = srcs;
      syncImages();
    },
  };

  // 사람 말에 바로 실린 그림(입력 칸 칩으로 보낸 그림 — Claude base64 · Codex 데이터 URL) — 타일 대화 면과 같은 캐시 · 같은 명령(로컬)
  const picCache = new ConvImageCache();
  onDestroy(() => picCache.dispose());
  function fetchPicture(p: TranscriptPicture): Promise<ArrayBuffer> {
    const c = conv;
    if (!c) return Promise.reject(new Error("no-conversation"));
    return agentConversationImage(cli, c, p);
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

  // ── 첨부 칩 — 그림만 · 로컬 첨부 자리의 사본(서버가 그 자리 안의 그림만 받는다) ─────────────────

  const attachKey = $derived(`side:${chatId}`);
  const attachments = $derived(composerAttachmentsOf(attachKey));
  onDestroy(() => clearComposerAttachments(untrack(() => attachKey)));

  /** 그림이 아니거나 너무 크면 알리고 뺀다 */
  function imagesOnly<T>(items: readonly T[], name: (x: T) => string, size: (x: T) => number | null): T[] {
    const out: T[] = [];
    for (const x of items) {
      if (!isImageName(name(x))) showNotice(t("pane.flip.composer.imagesOnly", { name: name(x) }));
      else if ((size(x) ?? 0) > SIDE_CHAT_IMAGE_MAX_BYTES) showNotice(t("pane.flip.composer.imageTooBig", { name: name(x) }));
      else out.push(x);
    }
    return out;
  }

  /** OS 파일 · 붙여 넣은 그림 — 로컬 첨부 자리로 사본(`stage_agent_attachment`) */
  function attachFiles(files: File[]): void {
    const ok = imagesOnly(files, (f) => f.name, (f) => f.size);
    if (ok.length === 0) return;
    void stageComposerAttachments(
      attachKey,
      ok.map((file) => ({ name: file.name, file })),
      () => stageAgentFiles("local", 0, ok, t),
    );
  }

  /** 이 면에 놓았다 — OS 파일 또는 파일 타일 짐(로컬은 복사 · 원격은 내려받기 — 둘 다 로컬 첨부 자리로) */
  function onDropData(dt: DataTransfer): void {
    const files = Array.from(dt.files ?? []);
    if (files.length > 0) {
      attachFiles(files);
      return;
    }
    const drag = decodeFsDrag(dt.getData(FS_DRAG_TYPE));
    if (fsDragEmpty(drag)) return;
    const paths = imagesOnly(drag.paths, baseName, () => null);
    if (paths.length === 0) return;
    const source = drag.backendKey === LOCAL_KEY ? null : sessionOfFsKey(drag.backendKey);
    if (drag.backendKey !== LOCAL_KEY && source === null) return;
    void stageComposerAttachments(
      attachKey,
      paths.map((p) => ({ name: baseName(p) })),
      () => (source === null ? stageLocalPaths(paths, t) : stageFsPaths("download", source, paths, t)),
    );
  }

  // ── 꼬리 → 줄 ────────────────────────────────────────────────────────────────

  const keyOf = (e: LiveEntry) => `e${e.n}`;

  const rows = $derived.by<LiveRow[]>(() => {
    if (!st) return [];
    return st.entries.map((e) => {
      const item = entryItem(e);
      if (!item) return { key: keyOf(e), item: null };
      if (e.kind === "user") {
        const note = e.failed ? t("app.chatDock.send.failed") : e.accepted ? null : t("pane.flip.sending");
        return { key: keyOf(e), item, dim: !e.accepted, note, files: e.files };
      }
      return {
        key: keyOf(e),
        item,
        spinning: e.kind === "tool" && !e.finished,
        // 아직 자라는 모델 글 — 닫히지 않은 ```mermaid 는 그림으로 그리지 않는다(`TranscriptBody` 의 `diagrams`)
        streaming: e.kind === "text" && !e.done && st.status === "running",
      };
    });
  });

  const byKey = $derived(new Map((st?.entries ?? []).map((e) => [keyOf(e), e] as const)));

  const busy = $derived(st?.status === "running");
  const activity = $derived.by((): "running" | "permission" | "idle" => {
    if (!st) return "idle";
    if (pendingPermissions(st).length > 0) return "permission";
    return busy ? "running" : "idle";
  });

  /** 첫 보내기 — 서버가 CLI 를 띄우고 준비를 기다리는 동안 보내기를 막고 한 줄 */
  const gate = $derived.by((): ComposerGate | null => {
    if (!live?.sending || busy) return null;
    return { text: t("app.chatDock.gate.starting", { cli: cliName }) };
  });

  function send(text: string): boolean {
    // 칩은 모두 준비된 뒤에만 보낸다(`FlipComposer` 의 `canSend`)
    const images = attachments.flatMap((a) => (a.path === null ? [] : [{ path: a.path, name: a.name }]));
    if (!sendSideChat(chatId, text, linkName, images)) return false;
    clearComposerAttachments(attachKey);
    onsent?.(text);
    return true;
  }

  // ── 권한 결정 ─────────────────────────────────────────────────────────────────

  /** 답을 보내는 중인 요청 — 두 번 누르지 않게 */
  let deciding = $state<Record<string, true>>({});

  async function decide(requestId: string, decision: Decision): Promise<void> {
    if (deciding[requestId]) return;
    deciding[requestId] = true;
    try {
      await decideSideChat(chatId, requestId, decision);
    } finally {
      delete deciding[requestId];
    }
    inputEl?.focus({ preventScroll: true });
  }

  function resolvedText(e: Extract<LiveEntry, { kind: "permission" }>): string {
    const r = e.resolved;
    if (!r) return "";
    if (r.by === "human") return r.decision === "allow" ? t("app.chatDock.perm.allowed") : t("app.chatDock.perm.denied");
    if (r.by === "cli") return t("app.chatDock.perm.byCli");
    return t("app.chatDock.perm.closed");
  }

  // ── 알림 문구 ─────────────────────────────────────────────────────────────────

  function noticeText(code: string, detail: string | null): string {
    const d = detail ?? "";
    switch (code) {
      case "handshake-failed":
        return d ? t("app.chatDock.notice.handshake.detail", { d }) : t("app.chatDock.notice.handshake");
      case "stderr":
        return t("app.chatDock.notice.stderr", { d });
      case "interrupt-failed":
        return t("app.chatDock.notice.interruptFailed");
      case "set-model-failed":
        return t("app.chatDock.notice.setModelFailed");
      case "set-effort-failed":
        return t("app.chatDock.notice.setEffortFailed");
      case "asked-plainly":
        return t("app.chatDock.notice.askedPlainly");
      case "cli-retrying":
        return t("app.chatDock.notice.retrying");
      case "unsupported-request":
        return t("app.chatDock.notice.unsupported", { d });
      case "mcp-names-skipped":
        return t("app.chatDock.notice.mcpSkipped", { n: d });
      case "mcp-locked":
        return t("app.chatDock.notice.mcpLocked", { d });
      case "mcp-name-taken":
        return t("app.chatDock.notice.mcpNameTaken", { d });
      case "mcp-failed":
        return t("app.chatDock.notice.mcpFailed", { d });
      default:
        return d ? `${code}: ${d}` : code;
    }
  }

  function exitText(reason: string, code: number | null): string {
    if (reason === "closed") return t("app.chatDock.exit.closed");
    if (reason === "protocol") return t("app.chatDock.exit.protocol");
    if (reason === "start-timeout") return t("app.chatDock.exit.startTimeout");
    if (reason === "crash") return t("app.chatDock.exit.crash");
    return code === null ? t("app.chatDock.exit.exit") : t("app.chatDock.exit.code", { code });
  }

  // ── 찾기 ─────────────────────────────────────────────────────────────────────

  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);

  function onKeydownCapture(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    const combo = comboFromEvent(ev);
    if (combo === null || combo !== effectiveCombo("find", settings.current.keybindings)) return;
    if (ev.target instanceof Element && ev.target.closest("[data-find-bar]")) return;
    ev.preventDefault();
    ev.stopPropagation();
    finder?.show();
  }

  function onFindClose(): void {
    inputEl?.focus({ preventScroll: true });
  }
</script>

{#snippet card(key: string)}
  {@const e = byKey.get(key)}
  {#if e && e.kind === "permission"}
    <div class="perm" class:done={e.resolved !== null} data-side-chat-perm={e.requestId} role="group" aria-label={t("app.chatDock.perm.aria")}>
      <div class="perm-head">
        <UiIcon name="shield-check" size={16} />
        <span class="perm-title">{e.title || t("app.chatDock.perm.title")}</span>
        {#if e.permKind === "mcpTool"}<span class="perm-badge" data-side-chat-perm-mcp>{t("app.chatDock.perm.mcp")}</span>{/if}
      </div>
      {#if e.toolName && e.permKind !== "mcpTool"}<div class="perm-tool">{e.toolName}</div>{/if}
      {#if e.detail}<pre class="perm-detail" class:diff={e.permKind === "fileChange"}>{e.detail}</pre>{/if}
      {#if e.resolved === null}
        <div class="perm-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-side-chat-allow
            disabled={!!deciding[e.requestId]}
            onclick={() => void decide(e.requestId, "allow")}>{t("app.chatDock.perm.allow")}</button
          >
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-side-chat-deny
            disabled={!!deciding[e.requestId]}
            onclick={() => void decide(e.requestId, "deny")}>{t("app.chatDock.perm.deny")}</button
          >
        </div>
        {#if cli === "codex" && e.permKind !== "mcpTool"}<p class="perm-tip">{t("app.chatDock.perm.codexTip")}</p>{/if}
      {:else}
        <div class="perm-result" data-side-chat-perm-result={e.resolved.by}>{resolvedText(e)}</div>
      {/if}
    </div>
  {:else if e && e.kind === "outcome"}
    <div class="note" class:err={e.outcome === "error"} data-side-chat-outcome={e.outcome}>
      {e.outcome === "interrupted"
        ? t("app.chatDock.outcome.interrupted")
        : e.message
          ? t("app.chatDock.outcome.error.detail", { e: e.message })
          : t("app.chatDock.outcome.error")}
    </div>
  {:else if e && e.kind === "notice"}
    <div class="note" data-side-chat-notice={e.code}>{noticeText(e.code, e.detail)}</div>
  {:else if e && e.kind === "exited"}
    <div class="exited" data-side-chat-exited={e.reason}>
      <div class="exited-text">{t("app.chatDock.gate.ended")} — {exitText(e.reason, e.code)}</div>
      <div class="exited-tip">{t("app.chatDock.exit.tip")}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-side-chat-restart onclick={onrestart}
        >{t("app.chatDock.gate.restart")}</button
      >
    </div>
  {/if}
{/snippet}

{#snippet pickImages()}
  <button
    type="button"
    class="pick"
    data-side-chat-pick
    title={t("app.chatDock.pickImages")}
    aria-label={t("app.chatDock.pickImages")}
    onclick={() => pickEl?.click()}><UiIcon name="image-plus" size={18} /></button
  >
  <input bind:this={pickEl} class="pick-input" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" onchange={onPicked} />
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="face" role="region" aria-label={t("app.chatDock.convo.aria")} data-side-chat-face={chatId} onkeydowncapture={onKeydownCapture}>
  <DomFindBar bind:this={finder} root={bodyEl} scroller={() => bodyEl} label={t("pane.flip.find")} onclose={onFindClose} />
  {#if live?.error}
    <div class="error" role="alert" data-side-chat-error>
      <span class="error-text">{live.error}</span>
      <button
        type="button"
        class="error-x"
        title={t("app.actions.close")}
        aria-label={t("app.actions.close")}
        onclick={() => dismissSideChatError(chatId)}><UiIcon name="close" size={14} /></button
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
    {images}
    {pictures}
    {activity}
    live={rows}
    liveCard={card}
    hold={st ? historyHold(st) : null}
    refresh={st?.ended ?? 0}
    onrefreshed={(ok) => ok && clearEndedSideChat(chatId)}
    onloaded={(ok) => ok && clearEndedSideChat(chatId)}
    emptyText={t("app.chatDock.convo.empty")}
    bind:bodyEl
  />
  {#if linkNote}{@render linkNote()}{/if}
  <FlipComposer
    prefill={sideChatFillOf(chatId)}
    onprefilled={(n) => takeSideChatFill(chatId, n)}
    onsend={send}
    onterminal={() => {}}
    {tools}
    {gate}
    {busy}
    oninterrupt={() => void interruptSideChat(chatId)}
    {attachments}
    onremove={(id) => removeComposerAttachment(attachKey, id)}
    onattach={attachFiles}
    ondropdata={onDropData}
    enterNewline={phone}
    inField={phone ? pickImages : undefined}
    bind:inputEl
  />
</div>

<style>
  /* 폰 — 알약 칸 안 보내기 왼쪽의 그림 고르기(보내기 원과 같은 32 원 · 터치는 칸 높이가 받는다) */
  .pick {
    width: 32px;
    height: 32px;
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

  .pick:hover,
  .pick:focus-visible {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .pick-input {
    display: none;
  }

  .face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-family: var(--font-ui);
    color: var(--fg-1);
    /* 글래스면 독(`.chat-dock` 의 `--glass-mid`)이 판을 칠한다 — 본문까지 칠하면 머리 줄 밑이 흰 면으로 잘린다(`--glass-inner`) */
    background: var(--glass-inner, var(--surface-raised-solid));
  }

  .error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--err) 12%, var(--surface-field));
    border: 1px solid color-mix(in srgb, var(--err) 40%, var(--line-strong));
    border-radius: 8px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .error-x {
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

  .error-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  /* 권한 카드 — 대화 줄 안의 얇은 판(기다리는 동안은 경고색 테두리) */
  .perm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 10px;
  }

  .perm.done {
    border-color: var(--line-strong);
    opacity: 0.85;
  }

  .perm-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .perm-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* 외부 MCP 도구의 카드 — 작은 알약 하나(설명 줄 없음) */
  .perm-badge {
    flex: none;
    padding: 1px 8px;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .perm-tool {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .perm-detail {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .perm-detail.diff {
    white-space: pre;
    overflow-wrap: normal;
  }

  .perm-actions {
    display: flex;
    gap: var(--space-2);
  }

  .perm-actions .btn {
    flex: 1;
    justify-content: center;
  }

  .perm-tip,
  .exited-tip {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .perm-result {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 알림 한 줄 — 끊김 · CLI 알림은 흐리게, 오류는 오류색 */
  .note {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .note.err {
    color: var(--err);
  }

  .exited {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
  }

  .exited .btn {
    justify-content: center;
  }
</style>
