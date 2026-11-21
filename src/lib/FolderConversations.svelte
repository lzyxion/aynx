<script lang="ts">
  import { tick } from "svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import ScopeChips from "$lib/ScopeChips.svelte";
  import ConvoRowActions from "$lib/ConvoRowActions.svelte";
  import ConvoMeta from "$lib/ConvoMeta.svelte";
  import ConvoTitleEdit from "$lib/ConvoTitleEdit.svelte";
  import { convoMetaChips, type ConvoMetaChip } from "$lib/convo-meta";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { aiDisplayName } from "$lib/pane-icons";
  import { relativeTime } from "$lib/history-search";
  import { placeDefaultPalette, type CanvasRect } from "$lib/launcher";
  import { comboFromEvent, effectiveCombo, type Overrides } from "$lib/keybindings";
  import { shortenHome, type AgentConversation } from "$lib/agent-sessions";
  import { folderNameOf } from "$lib/pane-chips";
  import { formatTokens, usageKey } from "$lib/agent-usage";
  import {
    canForkHere,
    effectiveScope,
    filterByTitle,
    folderBranch,
    listForScope,
    nextScope,
    pickerActionForKey,
    resumeOutcome,
    scopeChips,
    type FolderScope,
    type RowState,
  } from "$lib/folder-conversations";
  import { moveStartSelection } from "$lib/project-start";
  import { sideChatConvBadge } from "$lib/side-chat";
  import { sideChatConvMarkOf } from "$lib/app/side-chats.svelte.js";
  import {
    conversationHome,
    conversationList,
    conversationOpenElsewhere,
    conversationsError,
    conversationDeleting,
    deleteBlockedReason,
    deleteConversation,
    conversationOpen,
    conversationOpenOtherWindow,
    renameBlockedReason,
    readyWorktrees,
    renameConversation,
  } from "$lib/app/agent-sessions.svelte.js";
  import { conversationUsage } from "$lib/app/agent-usage.svelte.js";
  import {
    closeFolderConversations,
    openFromPicker,
    pickerContext,
    pickerLists,
    pickerRemote,
    refreshPicker,
    viewFromPicker,
  } from "$lib/app/folder-conversations.svelte.js";
  import { remoteConversations } from "$lib/app/remote-conversations.svelte.js";
  import { isRemoteConversation, minutesSince, remoteHere, remoteScopeChips } from "$lib/remote-conversations";

  /**
   * 이 폴더의 지난 대화 — 고르는 목록. 팔레트와 같은 자리 · 모양으로 뜬다.
   * 팔레트 안의 한 모드로 두지 않는다 — 팔레트는 "아무것도 읽지 않고 실행하지 않는" 화면이다(그 파일 머리말).
   */
  let {
    measureCanvas,
    keybindings = {},
  }: {
    measureCanvas?: () => CanvasRect | null;
    keybindings?: Overrides;
  } = $props();

  let query = $state("");
  let picked = $state<FolderScope | null>(null);
  let sel = $state(0);
  /** 한 번 묻는 중인 줄(밖에서 열림) */
  let confirmKey = $state<string | null>(null);

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  /** SSH 타일(또는 원격 프로젝트의 시작 화면)에서 열었으면 그 서버의 목록을 쓴다 — 로컬이면 `null` */
  const remote = $derived(pickerRemote());
  const rh = $derived(remote ? remoteConversations(remote.alias) : null);
  const list = $derived(conversationList());
  const ctx = $derived(pickerContext());
  const lists = $derived(
    remote && rh
      ? { here: remoteHere(rh.rows, remote.folder, rh.home), project: null, all: rh.rows ?? [] }
      : pickerLists(),
  );
  const chips = $derived(
    remote ? remoteScopeChips(remote.folder !== null, lists.here.length, lists.all.length) : scopeChips(ctx, lists, true),
  );
  const unread = $derived(remote ? !rh || rh.rows === null : list === null);
  const scope = $derived(effectiveScope(chips, picked));
  const base = $derived(listForScope(lists, scope));
  const rows = $derived(filterByTitle(base, query));
  const selIndex = $derived(rows.length === 0 ? -1 : Math.min(Math.max(0, sel), rows.length - 1));
  const home = $derived(remote ? (rh?.home ?? null) : conversationHome());
  const baseFolder = $derived(remote ? remote.folder : ctx.folder);
  const shownPath = $derived(baseFolder ? shortenHome(baseFolder, home) : null);
  const branch = $derived(
    remote
      ? (lists.here.find((s) => s.branch)?.branch ?? null)
      : folderBranch(ctx.folder, ctx.project ? readyWorktrees(ctx.project.id) : null, lists.here),
  );
  const readAgo = $derived(remote && rh ? minutesSince(rh.readAt, now) : null);

  const keyOf = (s: AgentConversation) => `${s.agent}:${s.id}`;

  function stateOf(s: AgentConversation): RowState {
    if (conversationOpen(s)) return "open";
    if (!s.cwdExists) return "missing";
    return conversationOpenElsewhere(s, now) ? "elsewhere" : "ok";
  }

  function metaOf(s: AgentConversation): ConvoMetaChip[] {
    let tokens: string | null = null;
    if (isRemoteConversation(s)) {
      // 원격은 Codex 의 누적만 — Claude 는 파일 전체를 더해야 해서 읽지 않는다
      if (s.tokens !== null) tokens = t(s.forkedFrom ? "board.usage.tokens.fork" : "board.usage.tokens", { n: formatTokens(s.tokens) });
    } else {
      const u = conversationUsage().get(usageKey(s.agent, s.id));
      if (u) tokens = t(u.forked ? "board.usage.tokens.fork" : "board.usage.tokens", { n: formatTokens(u.total) });
    }
    return convoMetaChips(s, { mixed: scope !== "here", tokens, forkedLabel: t("board.convo.forked") });
  }

  // ── 자리 · 포커스 ──

  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const canvas = measureCanvas?.() ?? null;
    return canvas ? placeDefaultPalette(canvas, vw, vh) : null;
  });

  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  $effect(() => {
    inputEl?.focus();
  });

  $effect(() => {
    const i = selIndex;
    const el = listEl;
    if (!el || i < 0) return;
    void tick().then(() => el.querySelector<HTMLElement>(`[data-fc-row][data-sel="true"]`)?.scrollIntoView({ block: "nearest" }));
  });

  // ── 동작 ──

  function setScope(next: FolderScope): void {
    picked = next;
    sel = 0;
    confirmKey = null;
  }

  function resume(s: AgentConversation): void {
    const k = keyOf(s);
    const outcome = resumeOutcome(stateOf(s), confirmKey === k);
    if (outcome === "none") return;
    if (outcome === "confirm") {
      confirmKey = k;
      return;
    }
    confirmKey = null;
    openFromPicker(s, "resume");
  }

  function fork(s: AgentConversation): void {
    if (!s.cwdExists) return;
    openFromPicker(s, "fork");
  }

  /** 로컬만 — 원격은 서버의 폴더 판정이 따로라 아직 없다 */
  function forkHere(s: AgentConversation): void {
    if (remote || !canForkHere(s, baseFolder)) return;
    openFromPicker(s, "fork", baseFolder ?? undefined);
  }

  const selRow = $derived(selIndex >= 0 ? (rows[selIndex] ?? null) : null);
  const selCanForkHere = $derived(!remote && selRow !== null && canForkHere(selRow, baseFolder));

  function view(s: AgentConversation): void {
    viewFromPicker(s);
  }

  function onKeydown(ev: KeyboardEvent): void {
    // 같은 단축키로 닫는다 — 입력칸이 포커스라 창의 전역 처리기까지 오지 않는다
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("folder-conversations", keybindings)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeFolderConversations();
      return;
    }
    const act = pickerActionForKey(ev);
    if (act === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    const s = selIndex >= 0 ? rows[selIndex] : null;
    switch (act) {
      case "close":
        if (confirmKey !== null) confirmKey = null;
        else closeFolderConversations();
        return;
      case "up":
      case "down":
        sel = moveStartSelection(rows.length, selIndex, act);
        confirmKey = null;
        return;
      case "scope":
        setScope(nextScope(chips, scope));
        return;
      case "resume":
        if (s) resume(s);
        return;
      case "fork":
        if (s) fork(s);
        return;
      case "forkHere":
        if (s) forkHere(s);
        return;
      case "view":
        if (s) view(s);
        return;
      case "refresh":
        refreshPicker();
        return;
    }
  }

  /** 클릭은 고르기만 한다 — 여는 일은 [재개] · 더블클릭 · Enter(프로젝트 시작 화면과 같은 규칙) */
  function onRowClick(ev: MouseEvent, s: AgentConversation, i: number): void {
    if (sel !== i) confirmKey = null;
    sel = i;
    if (ev.ctrlKey && ev.shiftKey) forkHere(s);
    else if (ev.ctrlKey) view(s);
    else if (ev.shiftKey) fork(s);
  }

  /** 수식 키가 붙은 클릭은 이미 제 일을 했다 */
  function onRowDblClick(ev: MouseEvent, s: AgentConversation): void {
    if (ev.ctrlKey || ev.shiftKey) return;
    resume(s);
  }

  /** 열린 동안은 마우스를 따라 고른 줄을 옮기지 않는다 — 메뉴로 가는 길에 다른 줄을 지난다 */
  let menuOpen = $state(false);

  function onMenu(open: boolean): void {
    menuOpen = open;
    // 이름 바꾸기를 골랐으면 그 칸이 포커스를 쥔다
    if (!open) void tick().then(() => renaming === null && inputEl?.focus());
  }

  /** 이름을 고치는 줄(열쇠) */
  let renaming = $state<string | null>(null);

  function renameDone(): void {
    renaming = null;
    void tick().then(() => inputEl?.focus());
  }

  function onRowEnter(i: number): void {
    if (menuOpen || sel === i) return;
    sel = i;
    confirmKey = null;
  }

  function onInput(): void {
    sel = 0;
    confirmKey = null;
  }

  function emptyText(): string {
    if (query.trim() !== "") return t("app.folderConvos.empty.filter");
    if (scope === "here") return t(ctx.registered ? "app.folderConvos.empty.worktree" : "app.folderConvos.empty.folder");
    if (scope === "project") return t("app.folderConvos.empty.project");
    return t("app.folderConvos.empty.all"); // "all" · "host"
  }

  function remoteQuiet(): string {
    const host = remote?.alias ?? "";
    if (rh?.error) return t("app.remoteConvos.error", { host, reason: rh.error });
    if (rh?.offline) return t("app.remoteConvos.offlinePicker", { host });
    return t("app.remoteConvos.reading", { host });
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="overlay"
  class:anchored={placed !== null}
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) closeFolderConversations();
  }}
>
  <div
    class="picker"
    style={placed
      ? `left:${placed.left}px;top:${placed.top}px;width:${placed.width}px;max-height:${placed.maxHeight}px`
      : undefined}
    role="dialog"
    aria-modal="true"
    aria-label={t("app.folderConvos.aria")}
    tabindex="-1"
    data-folder-convos
    data-scope={scope}
    data-source={remote ? remote.source : ctx.source}
    data-remote={remote?.alias}
    onkeydown={onKeydown}
  >
    <div class="search">
      <UiIcon name="conversations" size={16} />
      <input
        class="q"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        oninput={onInput}
        placeholder={t("app.folderConvos.placeholder")}
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        aria-label={t("app.folderConvos.placeholder")}
        data-fc-filter
      />
      <Keys combo="Esc" />
    </div>

    <div class="scope">
      <ScopeChips
        {chips}
        current={scope}
        registered={remote ? false : ctx.registered}
        host={remote?.alias ?? null}
        onpick={setScope}
      />
      {#if shownPath || remote}
        <span class="where" title={baseFolder ?? undefined} data-fc-where
          >{#if remote}<span class="hostchip" title={t("app.remoteConvos.hostChip", { host: remote.alias })} data-fc-host
              ><span aria-hidden="true">⇄</span> {remote.alias}</span
            >{/if}{#if branch}<span class="br"><span class="bglyph" aria-hidden="true">⎇</span>{` ${branch}`}</span
            >{/if}{#if shownPath}<span class="path">{#if branch}{" · "}{/if}{shownPath}</span>{/if}</span
        >
      {/if}
    </div>

    <div class="rows" bind:this={listEl} role="listbox" aria-label={t("app.folderConvos.aria")}>
      {#if unread && remote}
        <p
          class="quiet"
          data-fc-loading
          data-fc-remote-state={rh?.error ? "error" : rh?.offline ? "offline" : "loading"}
        >
          {remoteQuiet()}
        </p>
      {:else if unread}
        <p class="quiet" data-fc-loading>{conversationsError() ?? t("board.convo.loading")}</p>
      {:else if rows.length === 0}
        <div class="empty" data-fc-empty>
          <span>{emptyText()}</span>
          {#if query.trim() === "" && scope !== "all" && shownPath}<span class="sub">{shownPath}</span>{/if}
          {#if query.trim() === "" && scope === "here" && lists.project && lists.project.length > 0}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-fc-show-project
              onmousedown={(ev) => ev.preventDefault()}
              onclick={() => setScope("project")}
              >{t("app.folderConvos.showProject", { n: lists.project.length })}</button
            >
          {/if}
        </div>
      {:else}
        {#each rows as s, i (keyOf(s))}
          {@const st = stateOf(s)}
          {@const meta = metaOf(s)}
          {@const side = sideChatConvBadge(sideChatConvMarkOf(s.agent, s.id))}
          <!-- 줄 안에 단추가 서므로 줄 자체는 단추가 아니다. 키보드는 입력칸이 쥐고 있다 -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="row"
            class:sel={i === selIndex}
            class:inert={st === "missing"}
            class:deleting={conversationDeleting(s)}
            role="option"
            aria-selected={i === selIndex}
            tabindex="-1"
            data-fc-row={s.id}
            data-agent={s.agent}
            data-state={st}
            data-sel={i === selIndex ? "true" : "false"}
            onmousedown={(ev) => ev.preventDefault()}
            onmouseenter={() => onRowEnter(i)}
            onclick={(ev) => onRowClick(ev, s, i)}
            ondblclick={(ev) => onRowDblClick(ev, s)}
          >
            <span class="logo" title={aiDisplayName(s.agent) ?? s.agent}><AiGlyph name={s.agent} size={16} /></span>
            <span class="main">
              <span class="tline"
                >{#if renaming === keyOf(s)}<ConvoTitleEdit
                    value={s.title}
                    onsave={(name) => renameConversation(s, name)}
                    ondone={renameDone}
                  />{:else}<span class="title" class:fallback={s.titleSource === "fallback"}>{s.title}</span
                  >{/if}{#if side}<span class="pill side" data-pill="side-chat" title={t(side.title)}>{t(side.label)}</span
                  >{/if}{#if st === "open"}<span
                    class="pill open"
                    data-pill="open"
                    title={conversationOpenOtherWindow(s) ? t("board.convo.openOther.title") : undefined}
                    >{t("board.convo.open")}</span
                  >{:else if st === "missing"}<span class="pill" data-pill="missing" title={t("board.convo.missing.title")}
                    >{t("board.convo.missing")}</span
                  >{:else if st === "elsewhere"}<span
                    class="pill elsewhere"
                    data-pill="elsewhere"
                    title={t("board.convo.elsewhere.title", { when: relativeTime(s.updatedAt, now, t) })}
                    >{t("board.convo.elsewhere")}</span
                  >{/if}</span
              >
              <ConvoMeta chips={meta} />
            </span>
            <span class="right">
              {#if i === selIndex}
                <ConvoRowActions
                  open={st === "open"}
                  cwdExists={s.cwdExists}
                  keepFocus
                  viewKey="Ctrl+Enter"
                  onview={() => view(s)}
                  onfork={() => fork(s)}
                  onhere={!remote && canForkHere(s, baseFolder) ? () => forkHere(s) : undefined}
                  onrename={remote || isRemoteConversation(s) ? undefined : () => (renaming = keyOf(s))}
                  renameBlocked={renameBlockedReason(s, { open: st === "open", elsewhere: st === "elsewhere" })}
                  ondelete={remote || isRemoteConversation(s) ? undefined : () => void deleteConversation(s)}
                  deleteBlocked={deleteBlockedReason(s, { open: st === "open", elsewhere: st === "elsewhere" })}
                  onprimary={() => resume(s)}
                  onmenu={onMenu}
                  onclosefocus={() => inputEl?.focus()}
                />
              {:else}
                <span class="time">{relativeTime(s.updatedAt, now, t)}</span>
              {/if}
            </span>
          </div>
        {/each}
      {/if}
      {#if remote && rh && rh.rows !== null && rh.loading}
        <p class="more" data-fc-progress>
          {rh.progress
            ? t("app.remoteConvos.readingMore", { host: remote.alias, done: rh.progress.done, total: rh.progress.total })
            : t("app.remoteConvos.reading", { host: remote.alias })}
        </p>
      {:else if remote && rh && rh.rows !== null && rh.error}
        <p class="more" data-fc-error>{t("app.remoteConvos.error", { host: remote.alias, reason: rh.error })}</p>
      {/if}
    </div>

    <div class="foot" data-fc-keys>
      {#if confirmKey !== null}
        <span class="warnq" data-fc-confirm>{t("board.convo.elsewhere.confirm")}</span>
        <span class="grp">{t("app.folderConvos.confirm.hint")}</span>
      {:else}
        <span class="grp primary"><Keys combo="Enter" />{t("app.folderConvos.keys.resume")}</span>
        <span class="grp"><Keys combo="Shift+Enter" />{t("app.folderConvos.keys.fork")}</span>
        {#if selCanForkHere}
          <span class="grp" data-fc-fork-here><Keys combo="Ctrl+Shift+Enter" />{t("app.folderConvos.keys.forkHere")}</span>
        {/if}
        <span class="grp"><Keys combo="Ctrl+Enter" />{t("app.folderConvos.keys.view")}</span>
        {#if chips.length > 1}<span class="grp"><Keys combo="Tab" />{t("app.folderConvos.keys.scope")}</span>{/if}
        {#if remote}
          <span class="grp note" data-fc-read-at={rh?.readAt ?? ""}
            >{#if readAgo !== null}{readAgo === 0
                ? t("app.remoteConvos.readNow")
                : t("app.remoteConvos.readAgo", { n: readAgo })}<span class="dotsep">·</span>{/if}<Keys combo="F5" />{t("app.folderConvos.keys.refresh")}</span
          >
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  /* 팔레트와 같은 층 — 둘은 동시에 뜨지 않는다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-4) var(--space-4);
    background: var(--bg-overlay);
    animation: picker-backdrop-in 160ms ease-out;
  }

  .picker {
    transform-origin: 50% 0;
    animation: picker-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @keyframes picker-backdrop-in {
    from {
      opacity: 0;
    }
  }

  @keyframes picker-in {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay,
    .picker {
      animation: none;
    }
  }

  .overlay.anchored {
    display: block;
    padding: 0;
  }

  .overlay.anchored .picker {
    position: absolute;
    max-width: none;
  }

  .picker {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--palette-w);
    max-height: 70vh;
    overflow: hidden;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .search {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 48px;
    padding: 0 var(--space-4);
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  .q {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    outline: none;
  }

  .q::placeholder {
    color: var(--fg-3);
  }

  .scope {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-1);
    min-width: 0;
  }

  /* 칩은 줄지도 접히지도 않는다 — 좁으면 오른쪽 글자가 먼저 물러난다 */
  .scope :global(.chips) {
    flex: none;
    flex-wrap: nowrap;
  }

  .where {
    flex: 1 1 0;
    display: flex;
    justify-content: flex-end;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .where .br,
  .where .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .where .br {
    flex: 0 1 auto;
  }

  .where .path {
    flex: 0 100000 auto;
  }

  .bglyph {
    font-family: var(--font-ui);
  }

  .rows {
    flex: 1 1 auto;
    overflow-y: auto;
    /* 옆 여백 4 + 줄 안쪽 12 = 16 — 줄 아이콘이 검색칸 · 범위 줄의 16 과 한 세로줄에 선다 */
    padding: var(--space-1) var(--space-1) var(--space-2);
  }

  .quiet {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    font-size: var(--t-sm);
    text-align: center;
    color: var(--fg-3);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    font-size: var(--t-sm);
    text-align: center;
    color: var(--fg-2);
  }

  .empty .sub {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
    word-break: break-all;
  }

  .row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    /* 빼면 여백만큼 넘쳐 오른쪽 시각 · [재개] 가 잘리고 가로 스크롤바가 선다 */
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: 0;
    /* 두 줄이라 "40px 넘는 줄은 알약 빼기" 규칙의 예외 — 팔레트와 맞춘 사용자 결정 */
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
  }

  .row:hover:not(.sel) {
    background: var(--surface-hover);
  }

  .row.sel {
    background: var(--accent-soft);
  }

  .row.inert {
    cursor: default;
  }

  /* 내용 칸만 흐린다 — 줄에 opacity 를 걸면 ⋯ 메뉴(`ConvoRowActions`)까지 반투명해진다 */
  .row.inert > :not(.right),
  .row.inert > .right > .time {
    opacity: 0.6;
  }

  .row.deleting > :not(.right) {
    opacity: 0.45;
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 합성 제목(에이전트 · 브랜치) */
  .title.fallback {
    color: var(--fg-2);
    font-style: italic;
  }

  .dotsep {
    color: var(--fg-3);
  }

  .right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pill {
    padding: 1px var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .tline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .tline .title {
    min-width: 0;
  }

  .tline .pill {
    flex: none;
    line-height: 16px;
  }

  .pill.open {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  .pill.elsewhere {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }

  /* 사이드 채팅의 대화 — 상태 칩이 아니라 출처 표지라 흐린 강조색 */
  .pill.side {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .foot {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 36px;
    padding: var(--space-1) var(--space-4);
    font-size: var(--t-xs);
    color: var(--fg-3);
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }

  .foot .grp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
  }

  .foot .primary {
    color: var(--fg-2);
  }

  .warnq {
    color: var(--warn);
  }

  .hostchip {
    flex: none;
    margin-right: var(--space-2);
    padding: 0 var(--space-2);
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .more {
    margin: 0;
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .foot .note {
    margin-left: auto;
  }
</style>
