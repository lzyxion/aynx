<!--
  모바일 배치의 위 띠. 고르기는 원격 로컬이다 — 메인 PC 화면은 움직이지 않는다. 덮개(고르기 · 시트 · 둘러보기 · 설정 · 알림 · 채팅)는
  한 번에 하나이고 그리는 곳은 이 띠 하나다. 휴대폰 '뒤로' 는 덮개를 닫는다 — 기록 칸 수를 덮개 종류로만 정해 기록이 쌓이지 않게 한다.
-->
<script lang="ts">
  import { activeTabId, currentWorkspaceTabs, paneOf } from "$lib/app/tabs.svelte.js";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import { fitThisDevice, handheld, setFitThisDevice } from "$lib/app/mobile.svelte.js";
  import { listPanes } from "$lib/session";
  import { displayName } from "$lib/app/titles.svelte.js";
  import { mirrorViewOf } from "$lib/app/mirror.svelte.js";
  import { positionChip, tileParts } from "$lib/mobile/labels";
  import MobilePicker from "$lib/mobile/MobilePicker.svelte";
  import MobileSheet from "$lib/mobile/MobileSheet.svelte";
  import MobileBrowse from "$lib/mobile/MobileBrowse.svelte";
  import MobileSettings from "$lib/mobile/MobileSettings.svelte";
  import MobileAlerts from "$lib/mobile/MobileAlerts.svelte";
  import MobilePlans from "$lib/mobile/MobilePlans.svelte";
  import MobileChat from "$lib/mobile/MobileChat.svelte";
  import { sideChats } from "$lib/app/side-chats.svelte.js";
  import { joinListedSideChats } from "$lib/app/side-chat-surface.svelte.js";
  import {
    backToMobileSheet,
    closeMobileOverlay,
    mobileOverlay,
    openMobilePicker,
    openMobileSheet,
    type MobileOverlay,
  } from "$lib/app/mobile-sheets.svelte.js";
  import { pushState } from "$app/navigation";
  import { tileMenuOpen, toggleFocusedTileMenu } from "$lib/app/tile-menu-bridge.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  const tabs = $derived(currentWorkspaceTabs());
  const tabIndex = $derived(tabs.findIndex((tab) => tab.id === activeTabId()));
  const active = $derived(tabIndex >= 0 ? tabs[tabIndex] : null);
  const panes = $derived(active ? listPanes(active.root) : []);
  const focusedId = $derived(active ? paneOf(active) : null);
  const focused = $derived(panes.find((p) => p.id === focusedId) ?? null);

  const view = $derived(focused ? mirrorViewOf(focused.id) : null);
  const parts = $derived(focused ? tileParts(displayName(focused), view) : { name: "", sub: "" });
  const chip = $derived(positionChip(tabIndex + 1, panes.findIndex((p) => p.id === focusedId) + 1, panes.length));

  const overlay = $derived(mobileOverlay());

  // 부팅(`bootSideChats`)이 이 띠보다 늦게 목록을 채울 수 있어 채팅이 처음 보일 때 한 번 붙는다
  let joinedLive = false;
  $effect(() => {
    if (joinedLive || sideChats().length === 0) return;
    joinedLive = true;
    void joinListedSideChats();
  });
  let pill = $state<HTMLButtonElement | null>(null);
  let plus = $state<HTMLButtonElement | null>(null);
  /** 닫히면 그리로 포커스 — 터미널에 주면 폰 화면 키보드가 튄다 */
  let opener: HTMLButtonElement | null = null;

  $effect(() => {
    if (overlay !== null) return;
    const back = opener;
    opener = null;
    if (!back) return;
    requestAnimationFrame(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) back.focus({ preventScroll: true });
    });
  });

  /** 둘러보기는 시트 위에 밀어 넣은 화면이라 둘 */
  function depthOf(o: MobileOverlay | null): number {
    return o === null ? 0 : o === "browse" ? 2 : 1;
  }
  let pushed = 0;
  let rewinding = 0;

  $effect(() => {
    const need = depthOf(overlay);
    if (need > pushed) {
      for (; pushed < need; pushed++) pushState("", { mobileOverlay: pushed + 1 });
    } else if (need < pushed) {
      const n = pushed - need;
      pushed = need;
      rewinding++;
      history.go(-n);
    }
  });

  $effect(() => {
    function onpopstate() {
      if (rewinding > 0) {
        rewinding--;
        return;
      }
      // 이 띠가 넣은 칸이 없으면(새로 고침 뒤 · 앞으로 가기) 덮개와 관계없는 이동이다
      if (pushed === 0) return;
      pushed--;
      if (pushed === 1 && mobileOverlay() === "browse") backToMobileSheet();
      else closeMobileOverlay();
    }
    addEventListener("popstate", onpopstate);
    return () => removeEventListener("popstate", onpopstate);
  });

  function openPicker() {
    opener = pill;
    openMobilePicker();
  }

  function openSheet() {
    opener = plus;
    openMobileSheet(undefined, "here");
  }
</script>

<div class="mobile-bar glass-band">
  <button
    type="button"
    class="pill"
    bind:this={pill}
    title={t("app.mobile.picker.open")}
    aria-haspopup="dialog"
    aria-expanded={overlay === "picker"}
    onclick={openPicker}
  >
    {#if view?.agent}
      <AgentStatusGlyph state={view.agent} aria-hidden="true" />
    {/if}
    <span class="text">
      <span class="name">{parts.name || t("app.mobile.picker.open")}</span>
      {#if parts.sub}<span class="sub">{parts.sub}</span>{/if}
    </span>
    {#if chip}<span class="chip">{chip}</span>{/if}
    <UiIcon name="chevron-down" size={16} />
  </button>
  {#if focused}
    <button
      type="button"
      class="round more"
      data-tile-menu-btn
      aria-haspopup="menu"
      aria-expanded={tileMenuOpen()}
      title={t("pane.header.menu.title")}
      aria-label={t("pane.header.menu.aria")}
      onclick={(e) => toggleFocusedTileMenu(e.currentTarget)}><UiIcon name="more" size={20} /></button
    >
  {/if}
  <button
    type="button"
    class="round plus"
    bind:this={plus}
    title={t("app.mobile.sheet.title")}
    aria-label={t("app.mobile.sheet.title")}
    aria-haspopup="dialog"
    aria-expanded={overlay === "sheet" || overlay === "browse"}
    onclick={openSheet}><UiIcon name="plus" size={20} /></button
  >
  {#if handheld()}
    <button
      type="button"
      class="fit"
      class:on={fitThisDevice()}
      aria-pressed={fitThisDevice()}
      title={fitThisDevice() ? t("app.mobile.fit.on") : t("app.mobile.fit.off")}
      aria-label={t("app.mobile.fit")}
      onclick={() => setFitThisDevice(!fitThisDevice())}><UiIcon name={fitThisDevice() ? "restore" : "maximize"} size={18} /></button
    >
  {/if}
</div>

{#if overlay === "picker"}<MobilePicker />{:else if overlay === "sheet"}<MobileSheet />{:else if overlay === "browse"}<MobileBrowse
  />{:else if overlay === "settings"}<MobileSettings />{:else if overlay === "alerts"}<MobileAlerts />{:else if overlay === "plans"}<MobilePlans />{:else if overlay === "chat"}<MobileChat />{/if}

<style>
  .mobile-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    min-width: 0;
    background: var(--glass-band, var(--bg-panel));
    border-bottom: 1px solid var(--border);
  }
  .pill {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-3) 0 var(--space-4);
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
  }
  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .sub {
    flex: 0 10 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .chip {
    flex: 0 0 auto;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-2);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }
  .round.more {
    width: 40px;
  }
  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  /* 그림은 글자(⤢)가 아니라 SVG — 폰 글꼴에 없으면 대신 그리는 글꼴의 기준선을 타서 단추 안에서 틀어진다 */
  .fit {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg);
    cursor: pointer;
  }
  .fit.on {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
  }
  .pill:focus-visible,
  .round:focus-visible,
  .fit:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
