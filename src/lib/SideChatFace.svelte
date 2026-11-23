<script lang="ts">
  /**
   * 사이드 채팅 하나의 대화 면 — 상태는 `app/side-chat-live.svelte.ts` 가 쥐어 이 컴포넌트가 사라져도 지금 턴을 잃지 않는다.
   * - 턴이 끝나면(`ended` 가 늘면) 기록을 한 번 받고, 받은 뒤에야 그 턴의 꼬리를 걷는다(`clearEndedSideChat`) — 따라가기 폴링은 쓰지 않는다.
   * - 권한 카드의 답은 사람만 낸다(`side_chat_decide`) — [이 채팅에서 허용] = 허용 + 그 종류를 이 채팅의 허용 목록에(종류는 서버가 그 요청에서 읽는다).
   * - 서버가 모드(Manual · Auto) · 허용 목록으로 대신 허용한 요청은 카드 대신 단추 없는 끝난 한 줄(`perm-auto`)로 남는다.
   * - 첨부는 로컬 첨부 자리의 사본만 보낸다 — 서버가 그 자리 안의 실제 파일인지 다시 본다.
   * - [터미널에 넣기]는 입력 줄에 넣기만 하고 Enter 는 사람이 친다. 이 면은 타일이 아니라 `sourcePaneId` 가 없어 새 터미널 줄은 새 탭에 연다.
   * - 그림 · 경로 링크의 상대 경로 기준은 CLI 의 cwd(`baseDir`) — 원격 창(웹 · 폰)에서도 경로는 메인 PC 경로다.
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
  import { createTextSelectBar } from "$lib/text-select-bar.svelte.js";
  import TouchSelection from "$lib/term/TouchSelection.svelte";
  import ImageMenu from "$lib/ImageMenu.svelte";
  import type { ImageMenuExtra } from "$lib/image-menu";
  import { selectAllIn } from "$lib/doc/context-actions";
  import { writeClipboard } from "$lib/clipboard";
  import { handheld } from "$lib/app/mobile.svelte.js";
  import { baseName, SIDE_CHAT_ATTACH_MAX_BYTES, type SentPic } from "$lib/pane/composer-attachments";
  import {
    clearComposerAttachments,
    composerAttachmentsOf,
    removeComposerAttachment,
    revokeSentPics,
    stageComposerAttachments,
    takeComposerPictures,
  } from "$lib/pane/composer-attachments.svelte.js";
  import { entryItem, historyHold, pendingPermissions, policyResolved, type LiveEntry } from "$lib/side-chat-live";
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
  import { codeToTerminal } from "$lib/app/code-to-term.svelte.js";
  import { closeMobileOverlay } from "$lib/app/mobile-sheets.svelte.js";
  import { openPathFromChat } from "$lib/app/panes.svelte.js";
  import { resolvePathLink, type PathLinkPlace, type PathMatch, type ResolvedPath } from "$lib/path-links";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import ChatModelPopover from "$lib/chat/ChatModelPopover.svelte";
  import ChatModelKeyword from "$lib/chat/ChatModelKeyword.svelte";
  import ChatPermChip from "$lib/chat/ChatPermChip.svelte";
  import ChatPermMenu from "$lib/chat/ChatPermMenu.svelte";
  import { PERM_AUTO_ICON, policyResultKey } from "$lib/chat/perm-mode";
  import ChatLinkChip from "$lib/chat/ChatLinkChip.svelte";
  import { SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { linkSendNames, type LinkChip } from "$lib/side-chat-link";
  import type { SideChat } from "$lib/side-chat";
  import type { AiCli } from "$lib/session";

  let {
    chatId,
    chat,
    cli,
    cliName,
    offered,
    chipLinks,
    linkNote,
    onsent,
    onrestart,
    cwd = "",
    phone = false,
    inputEl = $bindable(null),
  }: {
    chatId: string;
    chat: SideChat;
    cli: string;
    cliName: string;
    offered: readonly Pick<AiCli, "id" | "name">[] | null;
    /** 보낼 이름은 `linkSendNames` 로 만든다 — 칩과 머리글이 같은 이름이 되게 */
    chipLinks: readonly LinkChip[];
    linkNote?: Snippet;
    onsent?: (text: string) => void;
    onrestart: () => void;
    /** 갈라 온 채팅의 CLI 폴더(서버가 알린 절대 경로) — 비면 채팅 폴더가 상대 경로의 기준이다 */
    cwd?: string;
    phone?: boolean;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  let pickEl = $state<HTMLInputElement | null>(null);
  const linkNames = $derived(linkSendNames(chipLinks));

  const ctl = new SideChatControls({
    chat: () => chat,
    offered: () => offered,
    chipLinks: () => chipLinks,
    focusHome: () => inputEl?.focus({ preventScroll: true }),
    pickFiles: () => pickEl?.click(),
  });

  export function closeMenus(): void {
    ctl.closeAll();
  }

  const codeActions = {
    onterm: (code: string, button: HTMLElement) => {
      const r = button.getBoundingClientRect();
      codeToTerminal(null, code, { x: r.right, y: r.bottom + 4, align: "right" }, button, phone ? closeMobileOverlay : undefined);
    },
  };

  /** 폴더를 알기 전(`null`)에도 절대 경로는 건다 */
  const pathLinks = $derived.by(() => {
    const place: PathLinkPlace = { kind: "local", cwd: baseDir };
    const label = (r: NonNullable<ResolvedPath>, m: PathMatch) =>
      ("path" in r ? r.path : `~/${r.home}`) + (m.line !== undefined ? `:${m.line}` : "");
    return {
      title: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        return r ? label(r, m) : null;
      },
      open: (m: PathMatch) => {
        const r = resolvePathLink(m, place);
        if (!r) return;
        void openPathFromChat(r, m.line).then((ok) => {
          if (ok && phone) closeMobileOverlay();
        });
      },
    };
  });

  /** 같은 파일을 다시 고를 수 있게 값을 비운다 */
  function onPicked(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) attachFiles(files);
  }

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

  // 사람 말에 바로 실린 그림 — 타일 대화 면과 같은 캐시 · 같은 명령(로컬)
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

  // ── 첨부 칩 ──

  const attachKey = $derived(`side:${chatId}`);
  const attachments = $derived(composerAttachmentsOf(attachKey));
  onDestroy(() => clearComposerAttachments(untrack(() => attachKey)));

  /** 막 보낸 그림의 미리보기(열쇠 `<채팅 id>:<clientId>`) — 그 말이 꼬리에서 걷히거나 면이 사라지면 거둔다 */
  let sentPics = $state<Record<string, SentPic[]>>({});
  const sentKey = (cid: string) => `${chatId}:${cid}`;
  $effect(() => {
    const prefix = `${chatId}:`;
    const live = new Set((st?.entries ?? []).flatMap((e) => (e.kind === "user" && e.clientId ? [sentKey(e.clientId)] : [])));
    untrack(() => {
      const gone = Object.keys(sentPics).filter((k) => k.startsWith(prefix) && !live.has(k));
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
        return { key: keyOf(e), item, dim: !e.accepted, note, files: e.files, sentPics: e.clientId ? sentPics[sentKey(e.clientId)] : undefined };
      }
      return {
        key: keyOf(e),
        item,
        spinning: e.kind === "tool" && !e.finished,
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

  const gate = $derived.by((): ComposerGate | null => {
    if (!live?.sending || busy) return null;
    return { text: t("app.chatDock.gate.starting", { cli: cliName }) };
  });

  function send(text: string): boolean {
    // 칩은 모두 준비된 뒤에만 보낸다(`FlipComposer` 의 `canSend`)
    const images = attachments.flatMap((a) => (a.path === null ? [] : [{ path: a.path, name: a.name }]));
    const cid = sendSideChat(chatId, text, linkNames, images);
    if (cid === null) return false;
    const pics = takeComposerPictures(attachKey);
    if (pics.length > 0) sentPics = { ...sentPics, [sentKey(cid)]: pics };
    onsent?.(text);
    return true;
  }

  // ── 권한 결정 ─────────────────────────────────────────────────────────────────

  let deciding = $state<Record<string, true>>({});

  async function decide(requestId: string, decision: Decision, remember = false): Promise<void> {
    if (deciding[requestId]) return;
    deciding[requestId] = true;
    try {
      await decideSideChat(chatId, requestId, decision, remember);
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
    const policy = policyResultKey(r.by);
    if (policy) return t(policy);
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

  // ── 본문의 글 메뉴 — 마우스는 우클릭 메뉴, 폰 · 태블릿은 고른 글 위의 띠(AI 타일 대화 면과 같은 길 · 타일 메뉴 줄은 없다) ──
  let faceEl = $state<HTMLElement | null>(null);
  const textSel = createTextSelectBar({ body: () => bodyEl, box: () => faceEl, on: () => handheld() });
  /** 줄 · 고른 글 · 링크는 누른 순간의 것 — 메뉴가 닫힌 뒤 불린다 */
  let textMenu = $state<{ x: number; y: number; rows: ImageMenuExtra[]; run: (id: string) => void } | null>(null);

  function copyPicked(text: string): void {
    if (text === "") return;
    void writeClipboard(text).then((ok) => showNotice(t(ok ? "pane.term.clipboard.copied" : "pane.term.clipboard.write_failed")));
  }

  function onBodyContextMenu(ev: MouseEvent): void {
    const target = ev.target instanceof Element ? ev.target : null;
    const body = bodyEl;
    // 그림 메뉴가 먼저 잡았거나(`defaultPrevented`) 글 칸 · 단추 위면 비켜 선다 — 링크 칩(`button[data-href]`)은 링크다
    if (ev.defaultPrevented || !target || !body?.contains(target)) return;
    if (target.closest("input, textarea, [contenteditable], button:not([data-href])")) return;
    ev.preventDefault();
    const linkEl = target.closest<HTMLElement>("[data-href], [data-path-link]");
    const link = linkEl?.getAttribute("data-href") ?? linkEl?.getAttribute("data-path") ?? null;
    // 손가락의 길게 누르기는 브라우저가 글을 고른다 — 브라우저의 띠만 막고 앱 띠가 선다. 링크 위에서만 링크 줄 둘을 낸다(띠에는 링크가 없다).
    const touch = textSel.byTouch(ev);
    if (touch && link === null) return;
    if (touch) textSel.clear();
    const text = touch ? "" : textSel.text();
    const rows: ImageMenuExtra[] = [];
    if (link !== null) {
      rows.push({ id: "open-link", label: t("pane.menu.open_link") }, { id: "copy-link", label: t("pane.menu.copy_link") });
    }
    if (text !== "") rows.push({ id: "copy", label: t("pane.menu.copy") });
    if (!touch) rows.push({ id: "select-all", label: t("pane.menu.select_all") });
    textMenu = {
      x: ev.clientX,
      y: ev.clientY,
      rows,
      run: (id) => {
        if (id === "copy") copyPicked(text);
        else if (id === "copy-link") copyPicked(link ?? "");
        else if (id === "select-all") selectAllIn(body);
        // 누른 것과 같은 길 — 경로 링크 · 바깥 링크를 본문의 클릭 처리가 가른다
        else if (id === "open-link" && linkEl?.isConnected) linkEl.click();
      },
    };
  }

  function copyBar(): void {
    copyPicked(textSel.bar?.text ?? "");
    textSel.clear();
  }

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
  {#if e && e.kind === "permission" && e.resolved && policyResolved(e.resolved.by)}
    <!-- 서버가 모드 · 허용 목록으로 대신 허용했다 — 카드 대신 끝난 한 줄(상세 · 단추 없음) -->
    <div class="perm-auto" data-side-chat-perm={e.requestId} data-side-chat-perm-auto={e.resolved.by} title={e.toolName || undefined}>
      <span class="perm-auto-icon" aria-hidden="true"><UiIcon name={e.resolved.by === "auto" ? PERM_AUTO_ICON : "shield-check"} size={13} /></span>
      <span class="perm-auto-title">{e.title || e.toolName || t("app.chatDock.perm.title")}</span>
      <span class="perm-auto-result" data-side-chat-perm-result={e.resolved.by}>{resolvedText(e)}</span>
    </div>
  {:else if e && e.kind === "permission"}
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
            data-side-chat-allow-chat
            title={t("app.chatDock.perm.allowChat.title")}
            disabled={!!deciding[e.requestId]}
            onclick={() => void decide(e.requestId, "allow", true)}>{t("app.chatDock.perm.allowChat")}</button
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

{#snippet plus()}
  <button
    type="button"
    class="plus"
    class:on={ctl.plusOpen}
    class:touch={phone}
    data-chat-plus
    aria-haspopup="menu"
    aria-expanded={ctl.plusOpen}
    title={t("app.chatDock.plus")}
    aria-label={t("app.chatDock.plus")}
    onclick={(ev) => ctl.togglePlus(ev.currentTarget)}><UiIcon name="plus" size={20} /></button
  >
{/snippet}

{#snippet linkAbove()}
  {#each chipLinks as chip (chip.stream)}
    <ChatLinkChip {chip} unlink={() => ctl.unlink(chip.stream)} touch={phone} />
  {/each}
{/snippet}

{#snippet keyword()}
  <ChatPermChip {ctl} touch={phone} />
  <ChatModelKeyword {ctl} {cliName} touch={phone} />
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="face"
  role="region"
  aria-label={t("app.chatDock.convo.aria")}
  data-side-chat-face={chatId}
  bind:this={faceEl}
  onkeydowncapture={onKeydownCapture}
  oncontextmenu={onBodyContextMenu}
  ontouchstart={textSel.onTouch}
  ontouchend={textSel.onTouch}
  ontouchcancel={textSel.onTouch}
>
  {#if textSel.bar}
    <TouchSelection start={null} end={null} barTop={textSel.bar.top} oncopy={copyBar} onselectall={() => bodyEl && selectAllIn(bodyEl)} />
  {/if}
  {#if textMenu}
    <ImageMenu
      actions={[]}
      x={textMenu.x}
      y={textMenu.y}
      before={textMenu.rows}
      label={t("app.chatDock.convo.aria")}
      onclose={() => (textMenu = null)}
      onpick={() => {}}
      onextra={textMenu.run}
    />
  {/if}
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
    {codeActions}
    copyable
    paths={pathLinks}
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
    leading={plus}
    above={chipLinks.length > 0 ? linkAbove : undefined}
    inField={keyword}
    {gate}
    {busy}
    oninterrupt={() => void interruptSideChat(chatId)}
    {attachments}
    onremove={(id) => removeComposerAttachment(attachKey, id)}
    onattach={attachFiles}
    ondropdata={onDropData}
    enterNewline={phone}
    touch={phone}
    bind:inputEl
  />
  <input bind:this={pickEl} class="pick-input" type="file" multiple tabindex="-1" aria-hidden="true" data-side-chat-pick onchange={onPicked} />
  {#if ctl.plusOpen && ctl.plusBtn}
    {#key ctl.plusView}
      <ToolbarMenu
        label={t("app.chatDock.plus")}
        rows={ctl.plusRows}
        trigger={ctl.plusBtn}
        align="left"
        touch={phone}
        onpick={(key) => ctl.pickPlus(key)}
        onback={() => ctl.plusBack()}
        onclose={(back) => ctl.closePlus(back)}
      />
    {/key}
  {/if}
  {#if ctl.modelOpen && ctl.modelBtn}
    <ChatModelPopover {ctl} trigger={ctl.modelBtn} touch={phone} />
  {/if}
  {#if ctl.permOpen && ctl.permBtn}
    <ChatPermMenu {ctl} trigger={ctl.permBtn} touch={phone} />
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

  .plus :global(svg) {
    transition: transform 160ms ease;
  }

  .plus:hover {
    background: var(--control-tile-bg-hover);
  }

  .plus.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .plus.on :global(svg) {
    transform: rotate(45deg);
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

  @media (prefers-reduced-motion: reduce) {
    .plus :global(svg) {
      transition: none;
    }
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
    border-radius: var(--radius-surface-inner);
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

  /* 좁은 독(320px)에서는 단추 줄을 바꾼다 */
  .perm-actions {
    flex-wrap: wrap;
  }

  .perm-actions .btn {
    flex: 1 1 auto;
    justify-content: center;
    white-space: nowrap;
  }

  .perm-auto {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .perm-auto-icon {
    flex: none;
    display: inline-flex;
    color: var(--fg-2);
  }

  .perm-auto-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .perm-auto-result {
    flex: none;
    white-space: nowrap;
  }

  .perm-auto-result::before {
    content: "· ";
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
    border-radius: var(--radius-surface-inner);
  }

  .exited .btn {
    justify-content: center;
  }
</style>
