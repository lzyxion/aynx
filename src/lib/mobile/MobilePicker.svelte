<!--
  모바일 배치의 탭 · 타일 고르기 화면. 고르기는 원격 로컬이다 — 메인 PC 화면은 움직이지 않는다(새 탭 · 닫기만 메인 PC 에 요청).
  닫으면 포커스를 위 띠 알약으로 돌려줄 뿐 터미널에 주지 않는다 — xterm 에 주면 폰 화면 키보드가 튀어 오른다.
-->
<script lang="ts">
  import { pushOut } from "$lib/mobile/motion";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import { activeTabId, closePaneIn, closeTabAsked, focusPane, paneOf, pickTab, residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
  import { listPanes, tabFixedTitle, type PaneSpec, type TabSpec } from "$lib/session";
  import { closeMobileOverlay, openMobileSettings, openMobileSheet } from "$lib/app/mobile-sheets.svelte.js";
  import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
  import { mirrorViewOf, mirrorWorkspaces } from "$lib/app/mirror.svelte.js";
  import { AGENT_LABEL, tileLabel, tileParts, workspaceChips } from "$lib/mobile/labels";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  const onclose = closeMobileOverlay;

  /** 칩을 누르면 이 화면만 바뀐다(원격 창의 워크스페이스는 그대로) */
  let browsing = $state(currentWorkspaceId());
  const rows = $derived(mirrorWorkspaces());
  const browsed = $derived(rows.find((w) => w.id === browsing) ?? rows.find((w) => w.id === currentWorkspaceId()) ?? null);
  const browsingId = $derived(browsed?.id ?? currentWorkspaceId());
  const isHere = $derived(browsingId === currentWorkspaceId());
  const tabs = $derived(residentWindowTabs().filter((tab) => tab.workspaceId === browsingId));
  const activeId = $derived(activeTabId());
  const title = $derived(browsed?.name || t("app.workspaces.default"));
  const chips = $derived(
    workspaceChips(
      rows,
      residentWindowTabs().map((tab) => ({ workspaceId: tab.workspaceId, paneIds: listPanes(tab.root).map((p) => p.id) })),
      (id) => mirrorViewOf(id)?.agent,
      browsingId,
    ),
  );

  let closeBtn = $state<HTMLButtonElement | null>(null);

  // 단추에 포커스 — 화면 키보드가 뜨지 않고, Esc 가 이 화면에서 받힌다
  $effect(() => {
    closeBtn?.focus({ preventScroll: true });
  });

  function tabTitle(tab: TabSpec, leaves: PaneSpec[]): string {
    const lone = leaves.length === 1 && !tabFixedTitle(tab) ? leaves[0] : null;
    return lone ? tileLabel(displayName(lone), mirrorViewOf(lone.id)) : displayTabTitle(tab);
  }

  function choose(tab: TabSpec, pane: PaneSpec) {
    if (tab.id !== activeId) pickTab(tab.id);
    focusPane(tab.id, pane.id);
    onclose();
  }

  function addTab() {
    if (browsed?.cold) return;
    openMobileSheet(browsingId, "new");
  }

  let chipRow = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const id = browsingId ?? "";
    const el = chipRow?.querySelector<HTMLElement>(`[data-ws-chip="${CSS.escape(id)}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    onclose();
  }
</script>

<div class="picker" out:pushOut|global role="dialog" aria-modal="true" aria-labelledby="mobile-picker-title" tabindex="-1" {onkeydown}>
  <header class="head">
    <h2 id="mobile-picker-title" class="title">
      <span class="ws">{title}</span>
      <span class="muted">{t("app.mobile.picker.tabs", { n: browsed?.cold ? (browsed.tabCount ?? 0) : tabs.length })}</span>
    </h2>
    <button
      type="button"
      class="round"
      title={t("app.mobile.settings.title")}
      aria-label={t("app.mobile.settings.title")}
      onclick={openMobileSettings}><UiIcon name="settings" size={18} /></button
    >
    <button
      type="button"
      class="round close"
      bind:this={closeBtn}
      title={t("app.mobile.picker.close")}
      aria-label={t("app.mobile.picker.close")}
      onclick={onclose}><UiIcon name="close" size={18} /></button
    >
  </header>

  {#if chips.length > 1}
    <div class="chips" role="tablist" aria-label={t("app.mobile.picker.workspaces")} bind:this={chipRow}>
      {#each chips as chip (chip.id)}
        {@const label = t("app.mobile.picker.chip", { name: chip.name || t("app.workspaces.default"), n: chip.tabs })}
        {@const tip = chip.agent ? `${label} · ${t(AGENT_LABEL[chip.agent])}` : label}
        <button
          type="button"
          class="chip"
          class:selected={chip.selected}
          class:cold={chip.cold}
          role="tab"
          aria-selected={chip.selected}
          data-ws-chip={chip.id}
          title={tip}
          aria-label={tip}
          onclick={() => (browsing = chip.id)}
        >
          {#if chip.agent}<AgentStatusGlyph state={chip.agent} aria-hidden="true" />{/if}
          <span class="chip-name">{chip.name || t("app.workspaces.default")}</span>
          <span class="chip-count">{chip.tabs}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="body">
    {#if browsed?.cold}
      <div class="empty">
        <p class="empty-title">{t("app.mobile.picker.cold.title")}</p>
        <p class="empty-body">{t("app.mobile.picker.cold.body")}</p>
      </div>
    {:else if tabs.length === 0}
      <div class="empty"><p class="empty-title">{t("app.mobile.picker.empty")}</p></div>
    {/if}
    {#each tabs as tab, i (tab.id)}
      {@const leaves = listPanes(tab.root)}
      {@const isActive = isHere && tab.id === activeId}
      {@const focused = isActive ? paneOf(tab) : null}
      {@const name = tabTitle(tab, leaves)}
      <section class="group" class:active={isActive} aria-label={`${i + 1}. ${name}`}>
        <div class="group-head">
          <span class="tab-name">{i + 1}. {name}</span>
          <span class="muted count">{t("app.mobile.picker.tiles", { n: leaves.length })}</span>
          <span class="spacer"></span>
          <button
            type="button"
            class="round small"
            title={t("app.mobile.closeTab", { title: name })}
            aria-label={t("app.mobile.closeTab", { title: name })}
            onclick={() => void closeTabAsked(tab.id)}><UiIcon name="close" size={16} /></button
          >
        </div>
        {#each leaves as pane (pane.id)}
          {@const view = mirrorViewOf(pane.id)}
          {@const parts = tileParts(displayName(pane), view)}
          {@const picked = pane.id === focused}
          <div class="tile-row" class:picked data-tile-row={pane.id}>
            <button type="button" class="row" aria-current={picked ? "true" : undefined} onclick={() => choose(tab, pane)}>
              <span class="icon" aria-hidden="true"><PaneIcon {pane} size={16} /></span>
              <span class="text">
                <span class="name">{parts.name}</span>
                {#if parts.sub}<span class="sub">{parts.sub}</span>{/if}
              </span>
              {#if view?.agent}
                <span class="state">
                  <AgentStatusGlyph state={view.agent} aria-hidden="true" />
                  {t(AGENT_LABEL[view.agent])}
                </span>
              {/if}
            </button>
            <button
              type="button"
              class="x"
              data-tile-close={pane.id}
              title={t("app.mobile.closeTile", { name: parts.name })}
              aria-label={t("app.mobile.closeTile", { name: parts.name })}
              onclick={() => closePaneIn(tab.id, pane.id)}><UiIcon name="close" size={14} /></button
            >
          </div>
        {/each}
      </section>
    {/each}
  </div>

  <footer class="foot">
    <button type="button" class="btn btn-primary add" disabled={!!browsed?.cold} onclick={addTab}>
      <UiIcon name="plus" size={18} />
      {t("app.mobile.newTab")}
    </button>
  </footer>
</div>

<style>
  .picker {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    /* 확인 상자(`ConfirmDialog` 114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface);
    color: var(--fg-1);
    outline: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .picker {
      animation: picker-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes picker-in {
    from {
      transform: translateX(100%);
    }
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2) var(--space-4);
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--t-lg);
    font-weight: var(--fw-semibold);
  }
  .ws {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    flex: 0 0 auto;
    color: var(--fg-2);
    font-size: var(--t-sm);
    font-weight: var(--fw-regular);
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
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  .round.small {
    width: 36px;
    height: 36px;
    background: transparent;
    color: var(--fg-2);
  }
  .round:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* 워크스페이스 칩 줄 — 이어 붙은 묶음(설정 칩과 같은 규칙) */
  .chips {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    padding: 0 var(--space-3) var(--space-2);
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 70vw;
    height: 36px;
    padding: 0 var(--space-3);
    border: 0;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    font-size: var(--t-sm);
    cursor: pointer;
  }
  .chips > .chip {
    border-radius: 6px;
    transition: border-radius 200ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 120ms ease;
  }
  .chips > .chip:first-child {
    border-top-left-radius: 18px;
    border-bottom-left-radius: 18px;
  }
  .chips > .chip:last-child {
    border-top-right-radius: 18px;
    border-bottom-right-radius: 18px;
  }
  .chips > .chip.selected {
    border-radius: 18px;
  }
  .chip.selected {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
    font-weight: var(--fw-semibold);
  }
  .chip.cold:not(.selected) {
    color: var(--fg-2);
  }
  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-count {
    flex: 0 0 auto;
    opacity: 0.7;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    padding: var(--space-6, 32px) var(--space-4);
    text-align: center;
    color: var(--fg-2);
  }
  .empty-title {
    margin: 0 0 var(--space-2);
    color: var(--fg-1);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
  }
  .empty-body {
    margin: 0;
    font-size: var(--t-sm);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-2) var(--space-2);
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container-low);
  }
  .group.active {
    background: var(--m3-surface-container);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding-left: var(--space-2);
  }
  .tab-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
  }
  .count {
    font-size: var(--t-xs);
  }
  .spacer {
    flex: 1 1 auto;
  }

  .tile-row {
    display: flex;
    align-items: stretch;
    border-radius: var(--radius-surface-inner);
    color: var(--fg-1);
  }
  .tile-row.picked {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
  }
  .row {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: var(--space-2) 0 var(--space-2) var(--space-2);
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .x {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: var(--fg-2);
    opacity: 0.75;
    cursor: pointer;
  }
  /* 선택 면 위 — 글자색(onSecondaryContainer)을 따라 대비를 지킨다 */
  .tile-row.picked .x {
    color: inherit;
    opacity: 1;
  }
  .x:active {
    opacity: 1;
  }
  .x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-2);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .sub {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .tile-row.picked .sub {
    color: inherit;
    opacity: 0.8;
  }
  .state {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .tile-row.picked .state {
    color: inherit;
  }

  .foot {
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .add {
    width: 100%;
    height: 48px;
    font-size: var(--t-md);
  }
</style>
