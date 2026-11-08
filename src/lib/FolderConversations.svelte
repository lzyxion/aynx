<script lang="ts">
  import { tick } from "svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import ScopeChips from "$lib/ScopeChips.svelte";
  import ConvoRowActions from "$lib/ConvoRowActions.svelte";
  import ConvoMeta from "$lib/ConvoMeta.svelte";
  import ConvoTitleEdit from "$lib/ConvoTitleEdit.svelte";
  import { convoMetaChips, type ConvoMetaChip } from "$lib/convo-meta";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { iconRef } from "$lib/host-icons";
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
   * **이 폴더의 지난 대화 — 고르는 목록** (docs/log/2026-09-27-folder-conversations.md).
   *
   * 팔레트와 **같은 자리 · 같은 모양**으로 뜬다(타일 캔버스 기준 자리 `placeDefaultPalette` · 불투명한 뜬 면). 팔레트
   * 안의 한 모드로 두지 않은 이유: 팔레트는 "아무것도 읽지 않고 실행하지 않는" 화면이고(그 파일 머리말) 섹션이 여섯인
   * 목록이라, 범위 칩 · 기준 폴더 · 옆에 여는 자리 같은 이 화면만의 상태를 들이면 두 화면이 한 파일에서 뒤섞인다.
   * 대신 규칙은 나눠 쓴다 — 거르기(`conversationMatches`)와 자리(`placeDefaultPalette`)는 팔레트의 것, 줄의
   * "열린 타일" · "밖에서 열림" 은 시작 화면 · 대시보드와 같은 판정, 칩은 시작 화면과 같은 `ScopeChips`.
   *
   * 위에서 아래로: 머리(말풍선 · 거르는 칸 · Esc) → 범위 칩 + 오른쪽 ⎇ 브랜치 · 폴더 → 줄들(로고 · 제목 · 에이전트 · 토큰 ·
   * 알약 · 상대 시각, 첫 줄이 골라져 있다) → 바닥 키 안내.
   *
   * 키: ↑↓ 고르기 · Enter 옆에서 이어서(재개 — 지금 타일 옆에 분할) · Shift+Enter 새 대화로 계속 · Ctrl+Shift+Enter
   * 여기로 가져와 계속(다른 폴더의 대화를 지금 폴더에서 갈라 나가기 — 로컬만) · Ctrl+Enter 기록 보기 · Tab 범위 · Esc 닫기. "열린 타일" 줄의 Enter 는 그 타일로 가기만, "밖에서 열림" 줄은 한 번 묻는다(시작
   * 화면과 같은 규칙 — 두 번째 Enter 가 그래도 재개).
   */
  let {
    measureCanvas,
    keybindings = {},
  }: {
    /** 타일 캔버스의 지금 사각형 — 팔레트와 같은 기준 자리 */
    measureCanvas?: () => CanvasRect | null;
    /** 단축키 오버라이드 — 같은 키(`folder-conversations`)로 닫는다 */
    keybindings?: Overrides;
  } = $props();

  let query = $state("");
  let picked = $state<FolderScope | null>(null);
  let sel = $state(0);
  /** 한 번 묻는 중인 줄(밖에서 열림) — 다른 줄로 손이 가면 거둔다 */
  let confirmKey = $state<string | null>(null);

  /** 상대 시각의 "지금" — 30초에 한 칸 */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  /**
   * **원격**(docs/log/2026-09-27-remote-conversations.md) — 연 타일이 SSH 타일(또는 원격 프로젝트의 시작 화면)이면 그 서버의
   * 목록을 쓴다: 칩은 "이 폴더 · N" / "<호스트> 전체 · M", 오른쪽에 호스트 칩, 바닥에 "N분 전에 읽음 · F5 다시 읽기".
   * 로컬이면 이 값이 `null` 이고 아래 판정은 전부 지금까지와 같다.
   */
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
  /** 아직 한 번도 못 읽었다 — 로컬 · 원격 모두 */
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

  /** 아래 칩 — 브랜치 · 모델 · 사용량(`convo-meta.ts`). 에이전트는 왼쪽 로고(툴팁에 이름) */
  function metaOf(s: AgentConversation): ConvoMetaChip[] {
    let tokens: string | null = null;
    if (isRemoteConversation(s)) {
      // 원격은 Codex 의 누적만(Claude 는 파일 전체를 더해야 한다 — 1단계에서 읽지 않는다)
      if (s.tokens !== null) tokens = t(s.forkedFrom ? "board.usage.tokens.fork" : "board.usage.tokens", { n: formatTokens(s.tokens) });
    } else {
      const u = conversationUsage().get(usageKey(s.agent, s.id));
      if (u) tokens = t(u.forked ? "board.usage.tokens.fork" : "board.usage.tokens", { n: formatTokens(u.total) });
    }
    return convoMetaChips(s, { mixed: scope !== "here", tokens, forkedLabel: t("board.convo.forked") });
  }

  // ---------------------------------------------------------------------------
  // 자리 · 포커스
  // ---------------------------------------------------------------------------

  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const canvas = measureCanvas?.() ?? null;
    return canvas ? placeDefaultPalette(canvas, vw, vh) : null;
  });

  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  /** 열리는 순간 입력칸으로 — 키보드가 먼저 닿는 화면이다 */
  $effect(() => {
    inputEl?.focus();
  });

  /** 고른 줄이 보이게 */
  $effect(() => {
    const i = selIndex;
    const el = listEl;
    if (!el || i < 0) return;
    void tick().then(() => el.querySelector<HTMLElement>(`[data-fc-row][data-sel="true"]`)?.scrollIntoView({ block: "nearest" }));
  });

  // ---------------------------------------------------------------------------
  // 동작
  // ---------------------------------------------------------------------------

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
    // "focus"(열린 타일) · "resume" — 둘 다 같은 길이다: 열려 있으면 그 타일로 가기만 한다(`openConversation`)
    confirmKey = null;
    openFromPicker(s, "resume");
  }

  function fork(s: AgentConversation): void {
    if (!s.cwdExists) return;
    openFromPicker(s, "fork");
  }

  /**
   * **여기로 가져와 계속** — 다른 워크트리(폴더)의 대화를 지금 폴더에서 새 대화로 갈라 나간다. 로컬만(원격은 서버의 폴더
   * 판정이 따로라 아직 없다). 기록된 폴더가 지워졌어도 된다.
   */
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
    // 같은 단축키로 닫는다(토글) — 입력칸이 포커스라 창의 전역 처리기까지 오지 않는다
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

  /**
   * 줄을 눌렀다 — **고르기만** 한다(여는 일은 고른 줄의 [⋯][재개] · 더블클릭 · Enter — 프로젝트 시작 화면과 같은 규칙).
   * 빠른 길은 그대로: Ctrl+Shift = 여기로 가져와 계속 · Shift = 새 대화로 계속 · Ctrl = 기록 보기.
   */
  function onRowClick(ev: MouseEvent, s: AgentConversation, i: number): void {
    if (sel !== i) confirmKey = null;
    sel = i;
    if (ev.ctrlKey && ev.shiftKey) forkHere(s);
    else if (ev.ctrlKey) view(s);
    else if (ev.shiftKey) fork(s);
  }

  /** 더블클릭 = 재개(Enter 와 같다 — 열린 타일이면 그리로 · 밖에서 열림이면 한 번 묻는다). 수식 키가 붙은 클릭은 이미 제 일을 했다 */
  function onRowDblClick(ev: MouseEvent, s: AgentConversation): void {
    if (ev.ctrlKey || ev.shiftKey) return;
    resume(s);
  }

  /** 고른 줄의 ⋯ 메뉴가 열려 있나 — 열린 동안은 마우스를 따라 고른 줄을 옮기지 않는다(메뉴로 가는 길에 다른 줄을 지난다) */
  let menuOpen = $state(false);

  function onMenu(open: boolean): void {
    menuOpen = open;
    // 닫히면 키보드를 입력칸으로 — 바깥 클릭으로 닫혀도 ↑↓ · Enter 가 계속 먹게(동작을 골라 팝업이 닫혔으면 할 일 없음 ·
    // 이름 바꾸기를 골랐으면 그 칸이 포커스를 쥔다)
    if (!open) void tick().then(() => renaming === null && inputEl?.focus());
  }

  /** 이름을 고치는 줄(열쇠) — 그 줄의 제목 자리에 칸이 선다(`ConvoTitleEdit` · docs/log/2026-10-24-convo-rename.md) */
  let renaming = $state<string | null>(null);


  function renameDone(): void {
    renaming = null;
    void tick().then(() => inputEl?.focus());
  }

  /** 마우스를 올린 줄이 곧 고른 줄 — 단추도 그 줄에 선다(프로젝트 시작 화면과 같은 몸짓) */
  function onRowEnter(i: number): void {
    if (menuOpen || sel === i) return;
    sel = i;
    confirmKey = null;
  }

  /** 거르는 글자가 바뀌면 첫 줄부터 */
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

  /** 원격 목록을 아직 못 읽었을 때의 한 줄 — 실패 · 붙은 세션 없음 · 읽는 중 */
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
          <!-- 줄 안에 단추가 서므로 줄 자체는 단추가 아니다. 키보드는 입력칸이 쥐고 있다(↑↓ · Enter) -->
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
            <span class="logo" title={aiDisplayName(s.agent) ?? s.agent}><HostIcon icon={iconRef(s.agent)} size={16} /></span>
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
        <!-- 이미 읽은 줄은 두고 아래에 이어 읽는 중 한 줄 — 진행을 알면 "(12 / 31)" -->
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
  /* 팔레트와 같은 덮개 · 같은 층 — 둘은 동시에 뜨지 않는다 */
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

  /* 등장 — 팔레트(`CommandPalette`)와 같은 모양: 위에서 살짝 내려오며 커진다 · 채움 없음 · 닫힘은 즉시 */
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

  /* 팔레트의 뜬 면과 같다 — 불투명 · 둥근 모서리 · 뜬 그림자 */
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
    border-radius: var(--radius-surface); /* 떠 있는 면 — 명령 팔레트와 같은 큰 면 모서리(10-29 — 예전 `--radius-md` 10) */
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

  /* 칩은 줄지도 접히지도 않는다 — 좁으면 오른쪽 글자가 먼저 물러난다(공용 `ScopeChips` 는 제 자리에서 접힘을 허용) */
  .scope :global(.chips) {
    flex: none;
    flex-wrap: nowrap;
  }

  /* 남은 폭을 다 쓰고 오른쪽에 붙는다. 좁아지면 폴더가 먼저 줄어 사라지고(말줄임) 그다음에 브랜치가 줄어든다 */
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
    /* 옆 여백 4 + 줄 안쪽 12 = 16 — 줄 아이콘이 검색칸 · 범위 줄의 16 과 한 세로줄에 선다(줄이 알약이 되며 안쪽을 늘렸다 · 10-29) */
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
    /* 폭 100% 에 안쪽 여백을 넣어 센다 — 예전엔 여백만큼 넘쳐 오른쪽 시각 · [재개] 가 잘리고 가로 스크롤바가 섰다 */
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: 0;
    /* 알약 — 명령 팔레트 줄과 같은 칠(`--radius-row`, 2026-10-29 C안). 제목 + 칩 두 줄이라 공용 규칙의 "40px 넘는 줄은 빼기"
       예외지만, 팔레트에서 이어 여는 같은 결의 목록이라 사용자 결정으로 맞췄다 — 줄 높이의 반원 안에 아이콘 · 글자가 든다 */
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

  /* 줄 자체가 아니라 내용 칸만 흐린다 — 줄에 opacity 를 걸면 오른쪽에서 뜨는 ⋯ 메뉴(`ConvoRowActions`)까지 반투명해진다 */
  .row.inert > :not(.right),
  .row.inert > .right > .time {
    opacity: 0.6;
  }

  /* 지우는 중 — 자리는 그대로 두고 내용만 흐린다(목록을 다시 읽어 줄이 빠질 때까지 · 칸이 뛰지 않게) */
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

  /* 합성 제목(에이전트 · 브랜치) — 대시보드 · 팔레트 줄과 같은 말 */
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

  /* 알약 — 시작 화면 · 대시보드와 같은 모양 */
  .pill {
    padding: 1px var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    border-radius: 999px; /* 팔레트의 '밖에서 열림' 표식과 같은 알약(10-29) */
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /* 칩 줄 끝의 상태 칩 — 다른 칩과 같은 높이 */
  /* 제목 줄 — 제목은 말줄임, 상태 칩은 그 바로 옆(줄지 않는다) */
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

  /* 사이드 채팅의 대화(10-24) — 상태 칩이 아니라 출처 표지라 흐린 강조색 */
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

  /* 원격 — 호스트 칩(범위 줄 오른쪽 맨 앞) · 이어 읽는 중 한 줄 · 바닥의 읽은 때 */
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
