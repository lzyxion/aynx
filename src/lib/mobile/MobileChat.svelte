<!--
  **폰 사이드 채팅 화면**(원격 웹 · 2026-11-01 — docs/log/2026-11-01-remote-side-chat.md 화면 단계) — 전체 화면 덮개. 데스크톱 폭의 채팅 독
  (`ChatDock`) 대신 원격 폰 배치에서 선다. 들어오는 길: 상태줄의 말풍선 · 시트(`MobileSheet`)의 줄 · [사이드 채팅에 묻기](`openSideChatHere`).

  - 머리: ← 닫기(뒤로) · 지금 채팅 제목 ▾(목록 — 맨 위 [새 채팅] · 줄 = 로고 · 제목 · 모델 · 시각 · 점 + 늘 보이는 이름 바꾸기 · 지우기 단추 —
    독과 같은 `ChatHistory`) · + 새 채팅.
    휴대폰 '뒤로' 도 닫는다 — 다른 폰 덮개와 같은 기록 칸(`MobileBar` 의 SvelteKit `pushState`).
  - 몸: 독과 같은 대화 면(`SideChatFace` 의 `phone` — Enter 줄바꿈 · 보내기는 단추 · 누르는 자리 44px). 상태는 `app/side-chat-live` 에 남아
    덮개를 닫았다 열어도 지금 턴을 잃지 않는다. 권한 카드는 원격에서도 그냥 [허용 한 번] · [거절]이다(재확인 없음 — 사용자 결정 11-01).
  - 열 때 입력 칸에 포커스를 주지 않는다(화면 키보드가 대화를 가린다) — 뒤로 단추에 준다.
  - CLI · 모델 · 강도 · 연결 · 그림 · 실린 MCP 는 독과 같은 입력 칸 한 줄(`[+]` · 모델 키워드 · 연결 칩 — 2026-11-13 목업 D안 · 대화 면이 쥔다).
    예전 폰 판의 칸 안 그림 고르기 단추는 `[+]` › 파일 업로드로 들어갔다.
  - 오른쪽에서 밀려 들어오고 밀려 나간다(다른 전체 화면 덮개와 같은 `pushOut`).
-->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { pushOut } from "$lib/mobile/motion";
  import SideChatFace from "$lib/SideChatFace.svelte";
  import ChatHistory from "$lib/chat/ChatHistory.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { closeMobileOverlay } from "$lib/app/mobile-sheets.svelte.js";
  import {
    currentSideChat,
    lastSideChatPick,
    newSideChat,
    noteSideChatSent,
    renameSideChat,
    selectSideChat,
    sideChats,
  } from "$lib/app/side-chats.svelte.js";
  import { joinSideChat, restartSideChat, setShownSideChat, sideChatDot, sideChatLiveOf } from "$lib/app/side-chat-live.svelte.js";
  import { joinListedSideChats, removeSideChat, sideChatsHeadDot } from "$lib/app/side-chat-surface.svelte.js";
  import { linkTilesHere } from "$lib/app/side-chat-ask.svelte.js";
  import { linkChipState } from "$lib/side-chat-link";
  import { sideChatCliOk, sideChatNewDefault, sortSideChats, type SideChat } from "$lib/side-chat";
  import { targetOf, type Dot } from "$lib/chat/chat-presentation";
  import { knownAiClis } from "$lib/app/panes.svelte.js";
  import { offeredAiClis, type AiCli } from "$lib/session";
  import { aiDisplayName, aiIconName } from "$lib/pane-icons";
  import { settings } from "$lib/settings.svelte.js";
  import { relativeTime } from "$lib/notifications";
  import { showNotice } from "$lib/app/notice";
  import { stripReason } from "$lib/error-reason";

  const chats = $derived(sideChats());
  const current = $derived(currentSideChat());
  const rows = $derived(sortSideChats(chats));
  const headDot = $derived<Dot>(sideChatsHeadDot());

  let clis = $state<AiCli[] | null>(null);
  const offered = $derived(clis ? offeredAiClis(clis, settings.disabledAgents).filter((c) => sideChatCliOk(c.id)) : null);

  let backBtn = $state<HTMLButtonElement | null>(null);
  let listOpen = $state(false);
  let now = $state(Date.now());

  onMount(() => {
    // 열리면 뒤로 단추에 포커스 — 입력 칸이 아니라 화면 키보드가 뜨지 않고, Esc 가 이 덮개에서 받힌다
    backBtn?.focus({ preventScroll: true });
    void knownAiClis().then((list) => (clis = list));
    void joinListedSideChats();
    return () => setShownSideChat(null);
  });

  /** 지금 채팅에 붙는다(독과 같은 길 — 구독 → attach → 없으면 open, 띄우지 않는다) */
  $effect(() => {
    const c = current;
    if (!c) return;
    void joinSideChat(untrack(() => targetOf(c)));
  });

  /** 지금 보이는 채팅 — 끝난 턴의 "새 답" 표식을 거둔다 */
  $effect(() => {
    setShownSideChat(current ? current.id : null);
  });

  $effect(() => {
    if (!listOpen) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  /** 연결 이름 — 보낼 때 서버가 머리글을 같은 이름으로 짓게(독의 연결 칩과 같은 판정 · 고르기는 없다) */
  const chipLink = $derived(
    current ? linkChipState(current.tile, linkTilesHere(), sideChatLiveOf(current.id)?.link ?? null) : ({ kind: "none" } as const),
  );

  let creating = false;

  /** 새 채팅 — 마지막에 쓴 CLI · 모델(그 CLI 가 꺼졌으면 켠 목록의 첫 항목). 띄우지 않는다(첫 보내기 때) */
  async function createChat(): Promise<void> {
    if (creating || !offered) return;
    const pick = sideChatNewDefault(offered, lastSideChatPick());
    if (!pick) return;
    creating = true;
    try {
      await newSideChat(pick.cli.id, pick.model, pick.effort);
      listOpen = false;
    } catch (e) {
      showNotice(t("app.chatDock.new.failed", { e: stripReason(String(e)) }));
    } finally {
      creating = false;
    }
  }

  function pickChat(id: string): void {
    selectSideChat(id);
    listOpen = false;
  }

  function titleOf(c: SideChat | null): string {
    return c?.title || t("app.chatDock.untitled");
  }

  function cliName(id: string): string {
    return offered?.find((c) => c.id === id)?.name ?? aiDisplayName(id) ?? id;
  }

  function rowSub(c: SideChat): string {
    const parts = [c.model || t("app.chatDock.cliDefault")];
    if (c.effort) parts.push(c.effort);
    parts.push(relativeTime(Math.max(c.usedAt, c.createdAt), now, t));
    return parts.join(" · ");
  }

  function dotOf(c: SideChat): Dot {
    return sideChatDot(c.id);
  }

  function dotLabel(d: Dot): string {
    if (d === "running") return t("app.chatDock.running");
    if (d === "permission") return t("app.chatDock.permission");
    if (d === "finished") return t("app.chatDock.unseen");
    return "";
  }

  // 목록 줄의 이름 바꾸기 · 지우기 — 줄 오른쪽 단추 둘(폰은 늘 보인다 — 우클릭이 없다). 몸은 독과 같다(`renameSideChat` · `removeSideChat`).
  // 우클릭 메뉴(`rowMenu`)는 폰에 서지 않는다 — `ChatHistory` 의 칸만 채운다
  let renaming = $state<string | null>(null);
  let renameText = $state("");
  let rowMenu = $state<{ id: string; el: HTMLElement } | null>(null);

  function startRename(c: SideChat): void {
    renaming = c.id;
    renameText = c.title;
  }

  function commitRename(): void {
    if (renaming) renameSideChat(renaming, renameText);
    renaming = null;
  }

  /** 이름 칸의 키 — 조합 중 Enter(안드로이드 IME 는 `keyCode` 229)는 확정이 아니라 조합 끝이다 */
  function onRenameKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitRename();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 덮개 · 목록을 닫지 않는다 — 이름 바꾸기만 그만둔다
      renaming = null;
    }
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape" || ev.isComposing) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (listOpen) listOpen = false;
    else closeMobileOverlay();
  }
</script>

{#snippet logo(cli: string, size: number)}
  {@const name = aiIconName(cli)}
  {#if name}<AiGlyph {name} {size} mono />{:else}<UiIcon name="ai" {size} />{/if}
{/snippet}

{#snippet dot(d: Dot)}
  {#if d}<span class="dot" data-dot={d} title={dotLabel(d)} aria-label={dotLabel(d)}></span>{/if}
{/snippet}

<div
  class="mchat"
  out:pushOut|global
  role="dialog"
  aria-modal="true"
  aria-label={t("app.chatDock.open")}
  tabindex="-1"
  data-mobile-chat
  {onkeydown}
>
  <header class="head">
    <button
      type="button"
      class="round"
      bind:this={backBtn}
      title={t("app.mobile.picker.close")}
      aria-label={t("app.mobile.picker.close")}
      data-mobile-chat-back
      onclick={closeMobileOverlay}><UiIcon name="chevron-left" size={20} /></button
    >
    <button
      type="button"
      class="title-btn"
      aria-haspopup="listbox"
      aria-expanded={listOpen}
      title={t("app.chatDock.list")}
      data-mobile-chat-list
      onclick={() => (listOpen = !listOpen)}
    >
      {#if current}<span class="title-logo">{@render logo(current.cli, 18)}</span>{/if}
      <span class="title">{current ? titleOf(current) : t("app.chatDock.title")}</span>
      {@render dot(headDot)}
      <UiIcon name="chevron-down" size={16} />
    </button>
    <button
      type="button"
      class="round"
      title={t("app.chatDock.new")}
      aria-label={t("app.chatDock.new")}
      disabled={!offered || offered.length === 0}
      data-mobile-chat-new
      onclick={() => void createChat()}><UiIcon name="plus" size={20} /></button
    >
  </header>

  {#if listOpen}
    <ChatHistory
      {rows}
      {current}
      {offered}
      {renaming}
      bind:renameText
      bind:rowMenu
      {titleOf}
      {rowSub}
      {dotOf}
      {pickChat}
      {createChat}
      {onRenameKey}
      {commitRename}
      onrename={startRename}
      ondelete={(c) => void removeSideChat(c)}
      always
      {logo}
      {dot}
    />
  {/if}

  <div class="body">
    {#if current}
      {@const c = current}
      {#key c.id}
        <SideChatFace
          chatId={c.id}
          cli={c.cli}
          chat={c}
          cliName={cliName(c.cli)}
          {offered}
          {chipLink}
          onsent={(text) => noteSideChatSent(c.id, text)}
          onrestart={() => void restartSideChat(targetOf(c))}
          cwd={c.cwd}
          phone
        />
      {/key}
    {:else}
      <div class="empty" data-mobile-chat-empty>
        {#if offered !== null && offered.length === 0}
          <p>{t("app.chatDock.noCli")}</p>
        {:else}
          <p>{t("app.chatDock.empty")}</p>
          <button type="button" class="btn btn-primary" disabled={!offered} onclick={() => void createChat()}>{t("app.chatDock.new")}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .mchat {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    /* 다른 폰 덮개와 같은 층 — 확인 상자(114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface-container);
    color: var(--fg-1);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .mchat {
      animation: mchat-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes mchat-in {
    from {
      /* 화면 폭 전체가 오른쪽에서 밀려 들어온다(밀어 넣는 화면 — 알림 · 작업안 덮개와 같은 말) */
      transform: translateX(100%);
    }
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 56px;
    padding: 0 var(--space-2);
  }
  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-1);
    cursor: pointer;
  }
  .round:disabled {
    color: var(--fg-3);
    cursor: default;
  }
  .round:focus-visible,
  .title-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .title-btn {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 17px;
    font-weight: var(--fw-semibold);
    cursor: pointer;
  }
  .title-logo {
    flex: 0 0 auto;
    display: inline-flex;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 상태 점 — 독 머리줄과 같은 말: 답하는 중(강조색) · 권한(경고) · 새 답(완료) */
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .dot[data-dot="permission"] {
    background: var(--warn);
  }
  .dot[data-dot="finished"] {
    background: var(--ok);
  }
  .body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-5);
    color: var(--fg-2);
    text-align: center;
  }
</style>
