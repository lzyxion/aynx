<script lang="ts">
  /**
   * 기록 보기 — 지난 대화 하나를 읽기 전용으로 펼치는 시트. 본문은 글자로만 그린다(`{@html}` 없음) · 이 컴포넌트의 상태에만 있고 닫으면 버린다.
   * 원격 대화는 붙은 SSH 타일 세션으로만 읽는다 — 새 접속은 열지 않는다.
   */
  import { tick } from "svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { relativeTime } from "$lib/history-search";
  import { stripReason } from "$lib/error-reason";
  import {
    agentConversationTranscript,
    agentConversationTranscriptRemote,
    type TranscriptPage,
  } from "$lib/context";
  import { hasReason } from "$lib/error-reason";
  import { isRemoteConversation } from "$lib/remote-conversations";
  import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
  import { openRemoteConversation, remoteConversations } from "$lib/app/remote-conversations.svelte.js";
  import { chatOpenBlockKey, flatConversations, shortenHome, type AgentConversation } from "$lib/agent-sessions";
  import {
    conversationChatState,
    conversationHome,
    conversationList,
    conversationOpenElsewhere,
    conversationOpen,
    conversationOpenOtherWindow,
    deleteBlockedReason,
    deleteConversation,
    goToOpenConversation,
    openConversation,
    openConversationInChat,
  } from "$lib/app/agent-sessions.svelte.js";
  import {
    closeConversationView,
    conversationView,
    type ConversationView,
  } from "$lib/app/conversation-viewer.svelte.js";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import { modelLabel } from "$lib/model-order";
  import { workerTranscript } from "$lib/orchestration/api";

  const PAGE = 40;

  const view = $derived(conversationView());
  /** 목록이 다시 읽혔으면 그 줄(시각 · 열림 등이 새것), 없으면 연 때의 것 */
  const conv = $derived.by((): AgentConversation | null => {
    const v = view;
    if (!v) return null;
    // Run 작업자의 고정 대화는 목록의 같은 id 줄과 섞지 않는다
    if (v.worker) return v.conv;
    const pool = isRemoteConversation(v.conv)
      ? (remoteConversations(v.conv.host).rows ?? [])
      : flatConversations(conversationList());
    return pool.find((c) => c.agent === v.conv.agent && c.id === v.conv.id) ?? v.conv;
  });
  const convKey = $derived(
    view
      ? `${view.worker ? `run|${view.worker.attemptId}|` : ""}${isRemoteConversation(view.conv) ? `${view.conv.host}|` : ""}${view.conv.agent}:${view.conv.id}`
      : null,
  );
  /** Run 작업자의 고정 대화면 재개 · 새 대화로 계속을 내지 않는다 */
  const worker = $derived(view?.worker ?? null);
  const remoteHost = $derived(view && isRemoteConversation(view.conv) ? view.conv.host : null);

  const GONE = "\u0000remote-gone";

  async function fetchPage(v: ConversationView, before: number | null): Promise<TranscriptPage> {
    if (v.worker) return await workerTranscript(v.worker.runId, v.worker.attemptId, before, PAGE);
    const c = v.conv;
    if (!isRemoteConversation(c)) return await agentConversationTranscript(c.agent, c.id, before, PAGE);
    const sid = liveSessionFor(c.host);
    if (sid === null) throw new Error(GONE);
    try {
      return await agentConversationTranscriptRemote(sid, c.agent, c.id, before, PAGE);
    } catch (e) {
      if (hasReason(String(e), "session-gone")) throw new Error(GONE);
      throw e;
    }
  }

  function failureOf(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === GONE && remoteHost !== null) return t("board.viewer.remoteGone", { host: remoteHost });
    return t("board.viewer.error", { e: stripReason(msg) });
  }

  let rootEl = $state<HTMLElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);

  let now = $state(Date.now());
  $effect(() => {
    if (!view) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  // 포커스는 먼저 시트에, 첫 쪽을 받아 맨 아래로 내린 뒤 몸으로 옮긴다(`onloaded`)
  $effect(() => {
    const key = convKey;
    confirming = false;
    if (!key) return;
    void tick().then(() => rootEl?.focus({ preventScroll: true }));
  });

  function pageOf(before: number | null): Promise<TranscriptPage> {
    const v = view;
    if (!v) return Promise.reject(new Error("closed"));
    return fetchPage(v, before);
  }

  // ---------------------------------------------------------------------------
  // 동작 — 지난 대화 줄과 같은 규칙
  // ---------------------------------------------------------------------------

  let confirming = $state(false);
  const link = $derived(conv ? conversationOpen(conv) : false);
  const outside = $derived(conv !== null && !link && conv.cwdExists && conversationOpenElsewhere(conv, now));

  function resume(): void {
    const s = conv;
    const v = view;
    if (!s || !v) return;
    if (conversationOpen(s)) {
      closeConversationView(false);
      goToOpenConversation(s);
      return;
    }
    if (!s.cwdExists) return;
    if (conversationOpenElsewhere(s, Date.now()) && !confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    closeConversationView(false);
    if (isRemoteConversation(s)) void openRemoteConversation(s, "resume", v.at, v.how);
    else void openConversation(s, "resume", v.at, v.how);
  }

  /** 끄면 머리 단추가 오늘 그대로 — Run 작업자 · 원격 대화에는 채팅 모양이 없다 */
  const chatState = $derived(conv && !worker ? conversationChatState(conv, now) : "hidden");
  const chatBlocked = $derived.by(() => {
    const k = chatOpenBlockKey(chatState);
    return k ? t(k) : null;
  });

  function openChat(): void {
    const s = conv;
    const v = view;
    if (!s || !v || chatState !== "ok") return;
    confirming = false;
    closeConversationView(false);
    void openConversationInChat(s, v.at, v.how);
  }

  function fork(): void {
    const s = conv;
    const v = view;
    if (!s || !v || !s.cwdExists) return;
    confirming = false;
    closeConversationView(false);
    if (isRemoteConversation(s)) void openRemoteConversation(s, "fork", v.at, v.how);
    else void openConversation(s, "fork", v.at, v.how);
  }

  /** 줄의 ⋯ 메뉴와 같은 판정 */
  const deleteBlocked = $derived(conv ? deleteBlockedReason(conv, { open: link, elsewhere: outside }) : null);

  async function remove(): Promise<void> {
    const s = conv;
    if (!s || worker || isRemoteConversation(s) || deleteBlocked !== null) return;
    await deleteConversation(s);
    const v = view;
    if (!v || v.conv.agent !== s.agent || v.conv.id !== s.id) return; // 그 사이 다른 대화로 바뀌었다
    if (!flatConversations(conversationList()).some((c) => c.agent === s.agent && c.id === s.id)) closeConversationView();
  }

  function gotoTile(): void {
    const s = conv;
    if (!s || !link) return;
    closeConversationView(false);
    goToOpenConversation(s);
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation(); // 창의 Escape 사슬(대시보드 닫기)까지 가지 않는다 — 시트 하나만
    if (confirming) {
      confirming = false;
      return;
    }
    closeConversationView();
  }

  const fmtAt = (ms: number | null) => (ms === null ? undefined : new Date(ms).toLocaleString());
</script>

{#if view && conv}
  <div class="catch" role="presentation" data-viewer-catch onmousedown={() => closeConversationView()}></div>
  <div
    class="sheet"
    role="dialog"
    aria-label={t("board.viewer.aria")}
    tabindex="-1"
    data-convo-viewer={conv.id}
    data-agent={conv.agent}
    bind:this={rootEl}
    onkeydown={onKeydown}
  >
    <header class="head">
      <div class="top">
        <span class="logo" aria-hidden="true"><AiGlyph name={conv.agent} size={18} /></span>
        <h2 class="title" class:fallback={conv.titleSource === "fallback"} title={conv.title} data-viewer-title>
          {conv.title}
        </h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm close"
          title={t("board.viewer.close")}
          aria-label={t("board.viewer.close")}
          data-viewer-close
          onclick={() => closeConversationView()}><UiIcon name="close" size={14} /></button
        >
      </div>
      <div class="meta" data-viewer-meta>
        {#if remoteHost !== null}<span class="hostchip" data-viewer-host title={t("app.remoteConvos.hostChip", { host: remoteHost })}
            ><span aria-hidden="true">⇄</span> {remoteHost}</span
          >{/if}
        <span class="mono path" title={conv.cwd} data-viewer-path
          >{shortenHome(conv.cwd, remoteHost !== null ? remoteConversations(remoteHost).home : conversationHome())}</span
        >
        {#if conv.branch}<span class="dotsep">·</span><span class="mono" data-viewer-branch
            ><span class="bglyph" aria-hidden="true">⎇</span> {conv.branch}</span
          >{/if}
        {#if conv.model}<span class="dotsep">·</span><span data-viewer-model title={conv.model}>{modelLabel(conv.model)}</span>{/if}
        <span class="dotsep">·</span><span title={fmtAt(conv.updatedAt)}
          >{t("board.viewer.updated", { when: relativeTime(conv.updatedAt, now, t) })}</span
        >
      </div>
      <div class="acts" data-viewer-acts>
        {#if worker}
          <span class="note"><span class="ro" data-viewer-worker={worker.attemptId}>{t("orch.viewer.worker.note")}</span></span>
        {:else if confirming}
          <span class="warnq" data-viewer-confirm>{t("board.convo.elsewhere.confirm")}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-act="cancel" onclick={() => (confirming = false)}
            >{t("board.convo.elsewhere.cancel")}</button
          >
          <button type="button" class="btn btn-primary btn-sm" data-act="resume-anyway" onclick={resume}
            >{t("board.convo.elsewhere.resume")}</button
          >
        {:else}
          <span class="note">
            {#if link}
              <span
                class="pill open"
                data-pill="open"
                title={conversationOpenOtherWindow(conv) ? t("board.convo.openOther.title") : undefined}
                >{t("board.convo.open")}</span
              >
            {:else if !conv.cwdExists}
              <span class="pill" data-pill="missing" title={t("board.convo.missing.title")}>{t("board.convo.missing")}</span>
            {:else if outside}
              <span
                class="pill elsewhere"
                data-pill="elsewhere"
                title={t("board.convo.elsewhere.title", { when: relativeTime(conv.updatedAt, now, t) })}
                >{t("board.convo.elsewhere")}</span
              >
            {/if}
            <span class="ro">{t("board.viewer.note")}</span>
          </span>
          {#if remoteHost === null}
            <button
              type="button"
              class="btn btn-ghost btn-sm danger-text"
              data-act="delete"
              title={deleteBlocked ?? undefined}
              disabled={deleteBlocked !== null}
              onclick={() => void remove()}>{t("board.convo.delete")}</button
            >
          {/if}
          {#if link}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-act="goto"
              onclick={gotoTile}>{t("board.convo.goto")}</button
            >
          {:else}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-act="fork"
              title={t("board.convo.fork.title")}
              disabled={!conv.cwdExists}
              onclick={fork}>{t("board.convo.fork")}</button
            >
            {#if chatState !== "hidden"}
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                data-act="resume"
                title={conv.cwdExists ? undefined : t("board.convo.missing.title")}
                disabled={!conv.cwdExists}
                onclick={resume}>{t("board.convo.openTerminal")}</button
              >
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                data-act="resume-chat"
                title={chatBlocked ?? undefined}
                disabled={chatBlocked !== null}
                onclick={openChat}>{t("board.convo.openChat")}</button
              >
            {:else}
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-act="resume"
                disabled={!conv.cwdExists}
                onclick={resume}>{t("board.convo.resume")}</button
              >
            {/if}
          {/if}
        {/if}
      </div>
    </header>

    <TranscriptBody
      {convKey}
      fetchPage={pageOf}
      {failureOf}
      bind:bodyEl
      onloaded={() => bodyEl?.focus({ preventScroll: true })}
    />
  </div>
{/if}

<style>
  /* 캔버스(`.pane`)만 덮는다 — 탭 바 · 상태바 · 독은 그대로 산다 */
  .catch {
    position: absolute;
    inset: 0;
    z-index: 99;
    background: transparent;
  }

  /* 글을 읽는 면이라 불투명이다. z-index 100 — 대시보드(90) 위, 팔레트·검색(110) 아래 */
  .sheet {
    position: absolute;
    top: var(--gap);
    right: var(--gap);
    bottom: var(--gap);
    z-index: 100;
    box-sizing: border-box;
    width: min(clamp(560px, 46%, 720px), calc(100% - 2 * var(--gap)));
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
    overflow: hidden;
    outline: none;
    transition:
      opacity 180ms ease-out,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @starting-style {
    .sheet {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet {
      transition: none;
    }
  }

  /* ── 머리 ── */
  .head {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--line);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .logo {
    flex: 0 0 auto;
    display: inline-flex;
    line-height: 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title.fallback {
    color: var(--fg-2);
    font-style: italic;
  }

  .close {
    flex: 0 0 auto;
    width: 24px;
    padding: 0;
  }

  .meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .path {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .hostchip {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    margin-right: var(--space-1);
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    white-space: nowrap;
  }

  .bglyph {
    font-family: var(--font-ui);
  }

  .dotsep {
    margin: 0 var(--space-1);
  }

  .acts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    min-height: 24px;
  }

  .note {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .ro {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* `.btn-*` 호버가 글자를 본문색으로 되돌리므로 여기서 잡는다 */
  .btn.danger-text,
  .btn.danger-text:hover {
    color: var(--err);
  }

  .warnq {
    flex: 1;
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 16px;
    color: var(--warn);
    word-break: keep-all;
  }

  .pill {
    flex: 0 0 auto;
    padding: 1px var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .pill.open {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  .pill.elsewhere {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }
</style>
