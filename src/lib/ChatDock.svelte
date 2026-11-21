<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import SideChatFace from "$lib/SideChatFace.svelte";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
  import PlansView from "$lib/PlansView.svelte";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import { joinListedSideChats, removeSideChat, sideChatsHeadDot } from "$lib/app/side-chat-surface.svelte.js";
  import {
    chatDockOpen,
    chatDockPinned,
    chatDockSection,
    chatDockWidth,
    closeChatDock,
    openChatDock,
    restoreChatDockWidth,
    setChatDockAvailable,
    setChatDockPinned,
    setChatDockSection,
    setChatDockWidth,
  } from "$lib/app/chat-dock.svelte.js";
  import {
    currentSideChat,
    lastSideChatPick,
    newSideChat,
    noteSideChatSent,
    renameSideChat,
    selectSideChat,
    sideChats,
  } from "$lib/app/side-chats.svelte.js";
  import {
    joinSideChat,
    removeSideChatLink,
    restartSideChat,
    setShownSideChat,
    sideChatDot,
    sideChatLiveOf,
  } from "$lib/app/side-chat-live.svelte.js";
  import { sideChatNewDefault, sideChatCliOk, sideChatCwdLabel, sortSideChats, type SideChat } from "$lib/side-chat";
  import { knownAiClis } from "$lib/app/panes.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import { offeredAiClis, type AiCli } from "$lib/session";
  import { aiDisplayName, aiIconName } from "$lib/pane-icons";
  import { relativeTime } from "$lib/notifications";
  import { effortLabel, modelLabel } from "$lib/model-order";
  import { stripReason } from "$lib/error-reason";
  import { dockSides } from "$lib/dock";
  import { createEdgeHover } from "$lib/chrome/edge-dock";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { anyModalOpen } from "$lib/app/keys.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { handheld, mobileLayout } from "$lib/app/mobile.svelte.js";
  import { shortcutTitle } from "$lib/status-items";
  import { linkChipStates, type LinkTile } from "$lib/side-chat-link";
  import { linkTilesHere } from "$lib/app/side-chat-ask.svelte.js";
  import { setLocalAiRead } from "$lib/pane/local-ai";
  import { focusTile } from "$lib/app/tabs.svelte.js";
  import { targetOf, type Dot } from "$lib/chat/chat-presentation";
  import ChatHistory from "$lib/chat/ChatHistory.svelte";

  // 숨김은 `transform` 만이다 — `{#if}` 로 걷지도 `display:none` 으로 끄지도 않는다. 닫힌 동안은 창 끝 밖으로 밀려 있고 `inert` 다.
  // 두 몸통(채팅 · 작업안)은 함께 마운트된 채 갈래가 아닌 쪽만 숨는다 — 갈래를 오가도 지금 턴 · 펼친 명령 · 위험 카드의 확인 상태가 남는다.
  // 고정(pin)이면 Esc · 바깥 누르기 둘 다 닫지 않는다.

  let dockEl = $state<HTMLElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);

  const open = $derived(chatDockOpen());
  const pinned = $derived(chatDockPinned());
  const side = $derived(dockSides(settings.dockLayout).chat);

  const chats = $derived(sideChats());
  const current = $derived(currentSideChat());

  onMount(() => {
    restoreChatDockWidth();
    setChatDockAvailable(true);
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
    const offEdge = edgeHover.attach();
    void knownAiClis().then((list) => (clis = list));
    return () => {
      setChatDockAvailable(false);
      setShownSideChat(null);
      window.removeEventListener("pointerdown", onOutsidePointerDown, true);
      offEdge();
    };
  });

  /** 목록은 부팅(`bootSideChats`)이 독 마운트보다 늦게 채울 수 있다 — 채팅이 처음 보일 때 한 번 붙는다 */
  let joinedLive = false;
  $effect(() => {
    if (joinedLive || chats.length === 0) return;
    joinedLive = true;
    void joinListedSideChats();
  });

  // ---------------------------------------------------------------------------
  // CLI 목록 · 새 채팅 · 붙기
  // ---------------------------------------------------------------------------

  let clis = $state<AiCli[] | null>(null);
  const offered = $derived(clis ? offeredAiClis(clis, settings.disabledAgents).filter((c) => sideChatCliOk(c.id)) : null);

  let creating = false;

  async function createChat(): Promise<void> {
    if (creating || !offered) return;
    const pick = sideChatNewDefault(offered, lastSideChatPick());
    if (!pick) return;
    creating = true;
    try {
      await newSideChat(pick.cli.id, pick.model, pick.effort);
      listOpen = false;
      await focusHome();
    } catch (e) {
      showNotice(t("app.chatDock.new.failed", { e: stripReason(String(e)) }));
    } finally {
      creating = false;
    }
  }

  let autoTried = false;
  $effect(() => {
    if (autoTried || !open || !offered || section !== "chat") return;
    autoTried = true;
    if (untrack(() => chats.length) === 0 && offered.length > 0) untrack(() => void createChat());
  });

  $effect(() => {
    const c = current;
    if (!c) return;
    const tg = untrack(() => targetOf(c));
    void joinSideChat(tg);
  });

  $effect(() => {
    setShownSideChat(open && section === "chat" && current ? current.id : null);
  });

  function dotOf(c: SideChat): Dot {
    return sideChatDot(c.id);
  }

  const headDot = $derived<Dot>(sideChatsHeadDot());

  function dotLabel(d: Dot): string {
    if (d === "running") return t("app.chatDock.running");
    if (d === "permission") return t("app.chatDock.permission");
    if (d === "finished") return t("app.chatDock.unseen");
    return "";
  }

  function titleOf(c: SideChat | null): string {
    return c?.title || t("app.chatDock.untitled");
  }

  function cliName(id: string): string {
    return offered?.find((c) => c.id === id)?.name ?? aiDisplayName(id) ?? id;
  }

  function rowSub(c: SideChat): string {
    const parts = [c.model ? modelLabel(c.model) : t("app.chatDock.cliDefault")];
    if (c.effort) parts.push(effortLabel(c.effort));
    parts.push(relativeTime(Math.max(c.usedAt, c.createdAt), now, t));
    return parts.join(" · ");
  }

  // ---------------------------------------------------------------------------
  // 머리줄 — 목록 · 포커스
  // ---------------------------------------------------------------------------

  let listOpen = $state(false);
  let now = $state(Date.now());
  $effect(() => {
    if (!listOpen) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!open) untrack(() => closeLists());
  });

  const rows = $derived(sortSideChats(chats));

  function pickChat(id: string): void {
    selectSideChat(id);
    listOpen = false;
    void focusHome();
  }

  /** 작업안은 첫 대기 카드 자신에 포커스한다 — [승인] 단추에 두면 Enter 한 번에 승인된다 */
  async function focusHome(): Promise<void> {
    await tick();
    const el =
      section === "plans"
        ? (plansEl?.querySelector<HTMLElement>("[data-plan-pending]") ??
          plansEl?.querySelector<HTMLElement>("[data-plans-body]") ??
          null)
        : (bodyEl?.querySelector<HTMLElement>("textarea[data-flip-input]") ?? null);
    (el ?? dockEl)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // 머리줄 ⋯ — 이름 바꾸기 · 지우기(지금 채팅)
  // ---------------------------------------------------------------------------

  let moreBtn = $state<HTMLElement | null>(null);
  let moreOpen = $state(false);

  const moreRows = $derived<ToolbarMenuRow[]>([
    { key: "rename", icon: "edit", label: t("app.chatDock.rename") },
    { key: "delete", icon: "erase", label: t("app.chatDock.delete"), sep: true, danger: true },
  ]);

  function pickMore(key: string): void {
    runOnMenu(
      () => current,
      () => (moreOpen = false),
      (chat) => {
        if (key === "rename") {
          listOpen = true;
          renaming = chat.id;
          renameText = chat.title;
        } else if (key === "delete") void removeChat(chat);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // 연결
  // ---------------------------------------------------------------------------

  const linkTiles = $derived<LinkTile[]>(current ? linkTilesHere() : []);

  const chipLinks = $derived(current ? linkChipStates(current.tiles, linkTiles, sideChatLiveOf(current.id)?.links ?? []) : []);

  /** 로컬 타일의 'AI 읽기 허용' — 사람 손의 문(원격 창이면 마스터 재확인) */
  function allowRead(tile: LinkTile): void {
    if (tile.kind === "local") setLocalAiRead(tile.paneId, true);
  }

  function revealLinked(tile: LinkTile): void {
    focusTile(tile.tabId, tile.paneId);
  }

  function restart(chat: SideChat): void {
    void restartSideChat(targetOf(chat)).then(() => focusHome());
  }

  // ---------------------------------------------------------------------------
  // 목록 줄의 우클릭 — 이름 바꾸기 · 지우기
  // ---------------------------------------------------------------------------

  let rowMenu = $state<{ id: string; el: HTMLElement } | null>(null);
  let renaming = $state<string | null>(null);
  let renameText = $state("");

  const rowMenuRows = $derived<ToolbarMenuRow[]>([
    { key: "rename", icon: "edit", label: t("app.chatDock.rename") },
    { key: "delete", icon: "erase", label: t("app.chatDock.delete"), sep: true, danger: true },
  ]);

  function pickRow(key: string): void {
    runOnMenu(
      () => (rowMenu ? chats.find((c) => c.id === rowMenu?.id) ?? null : null),
      () => (rowMenu = null),
      (chat) => {
        if (key === "rename") {
          renaming = chat.id;
          renameText = chat.title;
        } else if (key === "delete") void removeChat(chat);
      },
    );
  }

  function commitRename(): void {
    if (renaming) renameSideChat(renaming, renameText);
    renaming = null;
  }

  function onRenameKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitRename();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 독을 닫지 않는다 — 이름 바꾸기만 그만둔다
      renaming = null;
    }
  }

  const removeChat = (chat: SideChat): Promise<void> => removeSideChat(chat);

  function startRename(chat: SideChat): void {
    renaming = chat.id;
    renameText = chat.title;
  }

  let face = $state<ReturnType<typeof SideChatFace> | null>(null);

  function closeLists(): void {
    listOpen = false;
    rowMenu = null;
    moreOpen = false;
    renaming = null;
    face?.closeMenus();
  }

  // ---------------------------------------------------------------------------
  // 가장자리 호버로 열기
  // ---------------------------------------------------------------------------

  const edgeHover = createEdgeHover({
    side: () => side,
    blocked: () => chatDockOpen() || anyModalOpen() || veilVisible() || mobileLayout(),
    open: () => openChatDock(),
  });

  $effect(() => {
    void side;
    edgeHover.forgetStrip();
  });

  $effect(() => {
    const bar = document.querySelector(".titlebar");
    if (!bar) return;
    const ro = new ResizeObserver(edgeHover.forgetStrip);
    ro.observe(bar);
    return () => ro.disconnect();
  });

  /** 띠를 한 번 벗어나야 다시 센다 — 커서 아래에서 닫힌 독이 도로 열리지 않게 */
  $effect(() => {
    void open;
    untrack(() => edgeHover.afterClose());
  });

  $effect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => void focusHome());
    return () => cancelAnimationFrame(raf);
  });

  // ---------------------------------------------------------------------------
  // 닫기 — 바깥 누르기 · Esc (고정이면 둘 다 아니다)
  // ---------------------------------------------------------------------------

  /** 런처 독의 `FLOATING` 과 같은 목록 */
  const FLOATING = ".overlay, .modal, .menu, .menu-backdrop, [role='dialog'], [role='menu']";

  function onOutsidePointerDown(ev: PointerEvent): void {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (listOpen && !target.closest("[data-chat-dock-rows], [data-chat-dock-list]") && !target.closest(FLOATING)) {
      if (renaming) commitRename(); // 목록이 먼저 사라져도 글을 잃지 않게
      listOpen = false;
    }
    if (!chatDockOpen() || chatDockPinned()) return;
    if (dockEl?.contains(target)) return;
    if (target.closest(FLOATING)) return;
    if (target.closest("[data-chrome-toggle]")) return;
    if (anyModalOpen()) return;
    closeChatDock(false); // 누른 곳이 곧 갈 곳이다
  }

  /** 고정이면 닫지 않고 흘려보낸다(창의 Escape 사슬이 받는다) — 칸 · 찾기 띠 · 메뉴는 제 Escape 를 먼저 쓰고 전파를 멈춘다 */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    if (ev.isComposing || ev.keyCode === 229) return; // IME 조합을 끄는 Escape 는 칸의 것
    if (listOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      listOpen = false;
      void focusHome();
      return;
    }
    if (pinned) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeChatDock();
  }

  // ---------------------------------------------------------------------------
  // 폭 손잡이
  // ---------------------------------------------------------------------------

  const width = $derived(chatDockWidth());
  let resizing = $state(false);

  function onResizeDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    resizing = true;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }

  function onResizeMove(ev: PointerEvent): void {
    if (!resizing || !dockEl) return;
    const rect = dockEl.getBoundingClientRect();
    setChatDockWidth(side === "right" ? rect.right - ev.clientX : ev.clientX - rect.left);
  }

  function onResizeUp(ev: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    setChatDockWidth(width, true);
  }

  const closeTitle = $derived.by(() => {
    const combo = effectiveCombo("open-chat-dock", settings.current.keybindings);
    return shortcutTitle(t("app.actions.close"), combo ? displayCombo(combo) : null);
  });

  const noCli = $derived(offered !== null && offered.length === 0);

  // ---------------------------------------------------------------------------
  // 갈래 [채팅 | 작업안]
  // ---------------------------------------------------------------------------

  const section = $derived(chatDockSection());
  const plansWaiting = $derived(pendingCount());
  let plansEl = $state<HTMLElement | null>(null);
  let headEl = $state<HTMLElement | null>(null);

  /** 몸통은 둘 다 마운트된 채 `hidden` 만 바뀌므로 CSS 전환 대신 Web Animations 로 한 번 돌린다 */
  let shownSection: "chat" | "plans" | null = null;
  $effect(() => {
    const now = section;
    const prev = shownSection;
    shownSection = now;
    if (prev === null || prev === now || !untrack(() => open)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dx = now === "plans" ? 24 : -24;
    const opts: KeyframeAnimationOptions = { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
    const body = now === "plans" ? plansEl : bodyEl;
    body?.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], opts);
    headEl?.animate([{ opacity: 0 }, { opacity: 1 }], opts);
  });

  /** 포커스가 독 안이었을 때만 옮긴다 — 숨는 몸통 안의 포커스는 `<body>` 로 떨어지므로 `<body>` 도 독 안으로 본다 */
  let focusedSection: "chat" | "plans" | null = null;
  $effect(() => {
    const now = section;
    const prev = focusedSection;
    focusedSection = now;
    if (prev === null || prev === now || !untrack(() => open)) return;
    const active = document.activeElement;
    if (active && active !== document.body && !dockEl?.contains(active)) return;
    void focusHome();
  });

  function pickSection(next: "chat" | "plans"): void {
    if (next === "chat") listOpen = false;
    setChatDockSection(next);
    void focusHome();
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
  class="chat-dock edge-dock glass-mid"
  class:open
  class:pinned
  class:resizing
  style:--chat-dock-px="{width}px"
  data-chat-dock
  data-dock-side={side}
  role="presentation"
  aria-label={t("app.chatDock.aria")}
  inert={!open}
  tabindex="-1"
  bind:this={dockEl}
  onkeydown={onKeydown}
>
  <div class="top" data-chat-dock-top>
    <span aria-hidden="true"></span>
    <div class="sections" role="group" aria-label={t("app.chatDock.section.aria")} data-chat-dock-sections>
      <span class="sec-thumb" data-section={section} aria-hidden="true"></span>
      <button
        type="button"
        class="sec"
        class:on={section === "chat"}
        aria-pressed={section === "chat"}
        data-dock-section="chat"
        title={t("app.chatDock.section.chat")}
        aria-label={t("app.chatDock.section.chat")}
        onclick={() => pickSection("chat")}
        ><UiIcon name="ai" size={18} /></button
      >
      <button
        type="button"
        class="sec"
        class:on={section === "plans"}
        aria-pressed={section === "plans"}
        data-dock-section="plans"
        title={t("app.chatDock.section.plans")}
        aria-label={plansWaiting > 0
          ? t("app.chatDock.section.plansPending", { n: plansWaiting })
          : t("app.chatDock.section.plans")}
        onclick={() => pickSection("plans")}
        ><UiIcon name="list-checks" size={18} />{#if plansWaiting > 0}<span class="sec-badge" aria-hidden="true"
            >{plansWaiting}</span
          >{/if}</button
      >
    </div>
    <div class="top-btns">
      <button
        type="button"
        class="head-btn"
        class:on={pinned}
        data-chat-dock-pin
        aria-pressed={pinned}
        title={pinned ? t("app.chatDock.unpin") : t("app.chatDock.pin")}
        aria-label={pinned ? t("app.chatDock.unpin") : t("app.chatDock.pin")}
        onclick={() => setChatDockPinned(!pinned)}
        ><UiIcon name={pinned ? "pin-off" : "pin"} size={18} /></button
      >
      <button
        type="button"
        class="head-btn"
        data-chat-dock-close
        title={closeTitle}
        aria-label={t("app.actions.close")}
        onclick={() => closeChatDock()}
        ><UiIcon name="close" size={18} /></button
      >
    </div>
  </div>

  {#if section === "chat"}
  <div class="head" bind:this={headEl}>
    <button
      type="button"
      class="title-btn"
      data-chat-dock-list
      aria-haspopup="listbox"
      aria-expanded={listOpen}
      title={t("app.chatDock.list")}
      disabled={chats.length === 0 && noCli}
      onclick={() => (listOpen = !listOpen)}
    >
      {#if current}<span class="title-logo">{@render logo(current.cli, 16)}</span>{/if}
      <span class="title">{current ? titleOf(current) : t("app.chatDock.title")}</span>
      {@render dot(headDot)}
      <UiIcon name="chevron-down" size={14} />
    </button>
    <button
      type="button"
      class="head-btn"
      data-chat-dock-new
      title={t("app.chatDock.new")}
      aria-label={t("app.chatDock.new")}
      disabled={!offered || offered.length === 0}
      onclick={() => void createChat()}><UiIcon name="plus" size={18} /></button
    >
    <button
      type="button"
      class="head-btn"
      data-chat-dock-more
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      title={t("app.chatDock.more")}
      aria-label={t("app.chatDock.more")}
      disabled={!current}
      bind:this={moreBtn}
      onclick={() => (moreOpen = !moreOpen)}><UiIcon name="more" size={18} /></button
    >
  </div>
  {/if}

  {#if listOpen && section === "chat"}
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
      ondelete={(c) => void removeChat(c)}
      always={handheld()}
      {logo}
      {dot}
    />
  {/if}

  <div class="chat-body" data-chat-dock-body hidden={section !== "chat"} bind:this={bodyEl}>
    {#if current}
      {@const c = current}
      {#key c.id}
        <SideChatFace
          bind:this={face}
          chatId={c.id}
          chat={c}
          cli={c.cli}
          cliName={cliName(c.cli)}
          {offered}
          {chipLinks}
          onsent={(text) => noteSideChatSent(c.id, text)}
          onrestart={() => restart(c)}
          cwd={c.cwd}
          phone={handheld()}
        >
          {#snippet linkNote()}
            <div class="link-notes">
              {#if c.forkedFrom && c.forkedFrom.agent === c.cli && c.cwd}
                <div class="link-note" role="note" data-chat-fork-note title={c.cwd}>
                  <span class="link-note-text">{t("app.chatDock.fork.note", { folder: sideChatCwdLabel(c.cwd) })}</span>
                </div>
              {/if}
              {#each chipLinks.filter((x) => x.closed || x.readable === false) as chip (chip.stream)}
                <div class="link-note" role="status" data-chat-link-note={chip.closed ? "closed" : "read-off"}>
                  {#if chip.closed}
                    <span class="link-note-text">{t("app.chatDock.link.closedNote", { name: chip.name })}</span>
                    <button type="button" class="link-go" onclick={() => void removeSideChatLink(c.id, chip.stream)}
                      >{t("app.chatDock.link.unlink")}</button
                    >
                  {:else if chip.tile?.kind === "local"}
                    {@const tile = chip.tile}
                    <span class="link-note-text">{t("app.chatDock.link.readOffNote", { name: chip.name })}</span>
                    <button type="button" class="link-go" data-chat-link-allow onclick={() => allowRead(tile)}
                      >{t("app.chatDock.link.allowRead")}</button
                    >
                  {:else}
                    <span class="link-note-text">{t("app.chatDock.link.readOffRemote", { name: chip.name })}</span>
                    {#if chip.tile}
                      {@const tile = chip.tile}
                      <button type="button" class="link-go" onclick={() => revealLinked(tile)}>{t("app.chatDock.link.reveal")}</button>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/snippet}
        </SideChatFace>
      {/key}
    {:else}
      <div class="empty" data-chat-empty>
        {#if noCli}
          <p>{t("app.chatDock.noCli")}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick={() => openSettingsAt("ai")}>{t("app.chatDock.noCli.action")}</button>
        {:else}
          <p>{t("app.chatDock.empty")}</p>
          <button type="button" class="btn btn-primary btn-sm" disabled={!offered} onclick={() => void createChat()}>{t("app.chatDock.new")}</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="plans-body" data-chat-dock-plans hidden={section !== "plans"} bind:this={plansEl}>
    <PlansView visible={open && section === "plans"} exitSide={side} />
  </div>

  {#if moreOpen && moreBtn}
    <ToolbarMenu label={t("app.chatDock.more")} rows={moreRows} trigger={moreBtn} align="right" onpick={pickMore} onclose={() => (moreOpen = false)} />
  {/if}
  {#if rowMenu}
    <ToolbarMenu label={t("app.chatDock.list")} rows={rowMenuRows} trigger={rowMenu.el} align="left" onpick={pickRow} onclose={() => (rowMenu = null)} />
  {/if}

  <div
    class="grip"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("app.dock.resize.aria")}
    data-chat-dock-grip
    onpointerdown={onResizeDown}
    onpointermove={onResizeMove}
    onpointerup={onResizeUp}
    onpointercancel={onResizeUp}
  ></div>
</div>

<style>
  /* DOM 에서 런처 독(과 설정 모달)보다 앞에 놓여 설정 모달 · 그 배경막이 이 독을 덮는다 */
  .chat-dock {
    --chat-dock-w: min(var(--chat-dock-px, 380px), calc(100% - 2 * var(--gap)));
    position: absolute;
    top: var(--gap);
    bottom: calc(var(--gap) + var(--dock-inset-bottom, 0px));
    left: calc(var(--gap) + var(--dock-inset-left, 0px));
    z-index: 100;
    box-sizing: border-box;
    width: var(--chat-dock-w);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--glass-mid, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    overflow: hidden;
    /* 숨김은 이 이동뿐이다(`display` 는 늘 flex). 열리면 `transform: none` — 남기면 안쪽 `position: fixed` 메뉴의 기준 상자가 독으로 바뀐다 */
    transform: translateX(var(--edge-dock-off));
    transition: transform var(--edge-dock-dur) var(--edge-dock-ease);
  }

  .chat-dock[data-dock-side="right"] {
    left: auto;
    right: calc(var(--gap) + var(--dock-inset-right, 0px));
  }

  .chat-dock.open {
    transform: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-dock {
      transition: none;
    }
  }

  .chat-dock:focus {
    outline: none;
  }

  .top {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
    align-items: center;
    margin: 6px 0 2px;
  }

  .top-btns {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    padding-right: var(--space-2);
  }

  .sections {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    box-sizing: border-box;
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  .sec-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px - 2px) / 2);
    background: var(--control-sel-bg);
    border-radius: 999px;
    transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .sec-thumb[data-section="plans"] {
    transform: translateX(calc(100% + 2px));
  }

  @media (prefers-reduced-motion: reduce) {
    .sec-thumb {
      transition: none;
    }
  }

  .sec {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .sec:not(.on):hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  /* 고른 칸의 면은 `.sec-thumb` 가 깐다 — 단추는 글자색만 */
  .sec.on {
    color: var(--control-sel-fg);
  }

  .sec:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .sec-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    box-sizing: border-box;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--on-accent);
    background: var(--accent);
    border-radius: 999px;
  }

  .plans-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .plans-body[hidden],
  .chat-body[hidden] {
    display: none;
  }

  .head {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-2) var(--space-1) var(--space-2);
  }

  .title-btn {
    flex: 1;
    min-width: 0;
    height: 36px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
  }

  .title-btn:hover:not(:disabled) {
    background: var(--control-ghost-hover);
  }

  .title-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .title-logo {
    flex: 0 0 auto;
    display: inline-flex;
  }

  .title {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-btn {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .head-btn:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .head-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .head-btn.on {
    color: var(--accent);
  }

  .head-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

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

  .chat-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-inner, transparent);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-5);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-2);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  .link-notes {
    flex: 0 0 auto;
  }

  /* 면 · 테두리 · 글 · 모서리 · 꼬리는 AI 타일 대화 면의 신뢰 말풍선(`pane/AiFlip.svelte` 의 `.trust-hint`)과 같은 값 */
  .link-note {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0 var(--space-3) var(--space-1);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--hint-bubble-fg);
    background: var(--hint-bubble-bg);
    border: 1px solid var(--hint-bubble-line);
    border-radius: var(--radius-surface-inner);
  }

  /* 꼬리는 맨 아래 하나만 — 위 말풍선의 꼬리가 아래 말풍선을 찌르지 않게 */
  .link-note:last-child::after {
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

  .link-note-text {
    flex: 1 1 12em;
    min-width: 0;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  /* `.trust-go`(AiFlip)와 같은 알약 */
  .link-go {
    flex: none;
    margin-left: auto;
    padding: 3px 10px;
    font: inherit;
    font-weight: 500;
    white-space: nowrap;
    color: var(--hint-bubble-bg);
    background: var(--hint-bubble-fg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .link-go:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .grip {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    width: 6px;
    cursor: ew-resize;
    touch-action: none; /* 포인터 캡처가 스크롤 제스처에 뺏기지 않게 */
  }

  .grip:hover,
  .chat-dock.resizing .grip {
    background: var(--line-strong);
  }

  .chat-dock[data-dock-side="right"] .grip {
    left: 0;
    right: auto;
  }

  .chat-dock.resizing {
    user-select: none;
  }
</style>
