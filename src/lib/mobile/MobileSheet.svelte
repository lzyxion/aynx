<!--
  폰의 열기 시트. "지금 탭에" 는 데스크톱의 지금 탭에 여는 길 그대로라 메인 PC 화면도 그 탭으로 넘어간다(알고 받음).
  "새 탭에" 도 원격 창이 하던 새 탭 요청이다 — 새 길은 없다. 닫은 뒤 포커스는 터미널에 주지 않는다(폰 화면 키보드가 튀어 오른다).
-->
<script lang="ts">
  import { scrimOut, sheetOut } from "$lib/mobile/motion";
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName, shellIconName } from "$lib/pane-icons";
  import { effectiveDefaultShellId, listPanes, offeredAiClis, shellInfoLabel, shellLabel, type AiCli, type ShellInfo } from "$lib/session";
  import { settings } from "$lib/settings.svelte.js";
  import {
    knownAiClis,
    knownShellList,
    openAiInNewTab,
    openAiPaneHere,
    openDefaultShell,
    openLocalFsInNewTab,
    openLocalFsPaneHere,
    openShellInNewTab,
  } from "$lib/app/panes.svelte.js";
  import { activeTab, residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { connect as connectHere, connectInNewTab, hostCache } from "$lib/app/hosts.svelte.js";
  import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { historyOf, recentHosts } from "$lib/host-history";
  import { relativeTime } from "$lib/notifications";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import { openPlans } from "$lib/app/plans.svelte.js";
  import { openFolderConversations } from "$lib/app/folder-conversations.svelte.js";
  import { mirrorHomeWorkspace, mirrorWorkspaces } from "$lib/app/mirror.svelte.js";
  import {
    closeMobileOverlay,
    mobileSheetPlace,
    mobileSheetTarget,
    openFromSheet,
    openMobileBrowse,
    openMobileChat,
    openMobileSettings,
    setMobileSheetPlace,
    type SheetPlace,
  } from "$lib/app/mobile-sheets.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import { runAfterClose } from "$lib/browser/menu-runner";
  import { runAction } from "$lib/app/keys.svelte.js";
  import { keepAwakeOn, keepAwakeSupported, setKeepAwake } from "$lib/app/keep-awake.svelte.js";
  import { launchItems, openAliases, recentHostRows, sheetHereBlock, type LaunchItem } from "$lib/mobile/launch";

  const LOGO_PX = 22;

  let shells = $state<ShellInfo[] | null>(null);
  let osDefaultId = $state<string | null>(null);
  let clis = $state<AiCli[]>([]);

  $effect(() => {
    let alive = true;
    void Promise.all([knownShellList(), knownAiClis()])
      .then(([list, ai]) => {
        if (!alive) return;
        osDefaultId = list.default_id;
        clis = ai;
        shells = list.shells;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  const defaultId = $derived(shells ? effectiveDefaultShellId(shells, settings.defaultShell, osDefaultId) : null);
  const defaultShell = $derived(shells?.find((s) => s.id === defaultId) ?? null);
  const items = $derived(
    launchItems({
      shellId: defaultId,
      shellName: defaultShell ? shellInfoLabel(defaultShell, t) : shellLabel(undefined, t),
      ai: offeredAiClis(clis, settings.disabledAgents),
      filesName: t("app.dock.launch.localfs"),
    }),
  );

  const targetName = $derived.by(() => {
    const id = mobileSheetTarget();
    return mirrorWorkspaces().find((w) => w.id === id)?.name || t("app.workspaces.default");
  });

  const now = Date.now();
  const open = $derived(openAliases(residentWindowTabs().flatMap((tab) => listPanes(tab.root))));
  const recent = $derived(
    recentHostRows(recentHosts(hostCache(), hostHistory()), (a) => historyOf(hostHistory(), a)?.last_ok_at ?? null, open),
  );
  const plans = $derived(pendingCount());

  const hereBlock = $derived(
    sheetHereBlock({
      target: mobileSheetTarget(),
      current: currentWorkspaceId(),
      hasTab: activeTab() !== null,
      homeWorkspace: mirrorHomeWorkspace(),
    }),
  );
  $effect(() => {
    if (hereBlock !== null && mobileSheetPlace() === "here") setMobileSheetPlace("new");
  });
  const place = $derived<SheetPlace>(hereBlock === null ? mobileSheetPlace() : "new");
  const placeLabel = $derived(place === "here" ? t("app.mobile.sheet.titleHere") : t("app.mobile.sheet.title"));

  function launch(item: LaunchItem) {
    openFromSheet(
      () => {
        if (item.kind === "shell") return openDefaultShell();
        if (item.kind === "ai") return openAiPaneHere({ command: item.command, id: item.id });
        openLocalFsPaneHere();
      },
      () => {
        if (item.kind === "shell") return openShellInNewTab(item.shellId ?? undefined);
        if (item.kind === "ai") return openAiInNewTab({ command: item.command, id: item.id });
        openLocalFsInNewTab();
      },
    );
  }

  function connect(name: string) {
    const host = hostCache().find((h) => h.name === name);
    if (host)
      openFromSheet(
        () => connectHere(host),
        () => connectInNewTab(host),
      );
  }

  function conversations() {
    openFromSheet(
      () => openFolderConversations(),
      () => openFolderConversations(undefined, { newTab: true }),
    );
  }

  /** `openInTarget` 을 타지 않고, 시트를 먼저 닫는다(메뉴 통로) */
  function orchestration() {
    runAfterClose(closeMobileOverlay, () => runAction("orchestration-board"));
  }
  const orchTip = $derived(t("orch.palette.board"));

  let panel = $state<HTMLElement | null>(null);
  // 판에 포커스 — 화면 키보드가 뜨지 않고, Esc 가 이 판에서 받힌다
  $effect(() => {
    panel?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMobileOverlay();
  }
</script>

<div class="scrim" aria-hidden="true" out:scrimOut|global onclick={closeMobileOverlay}></div>
<div
  class="sheet"
  out:sheetOut|global
  role="dialog"
  aria-modal="true"
  aria-label={placeLabel}
  tabindex="-1"
  bind:this={panel}
  {onkeydown}
>
  <div class="grip" aria-hidden="true"></div>
  <header class="head">
    <div class="seg" role="radiogroup" aria-label={t("app.mobile.sheet.place")} data-sheet-place={place}>
      <button
        type="button"
        role="radio"
        data-place="here"
        class:selected={place === "here"}
        aria-checked={place === "here"}
        disabled={hereBlock !== null}
        onclick={() => setMobileSheetPlace("here")}>{t("app.mobile.sheet.here")}</button
      >
      <button
        type="button"
        role="radio"
        data-place="new"
        class:selected={place === "new"}
        aria-checked={place === "new"}
        onclick={() => setMobileSheetPlace("new")}>{t("app.mobile.sheet.newTab")}</button
      >
    </div>
    <span class="muted ws">{targetName}</span>
    <button type="button" class="round" title={t("app.mobile.picker.close")} aria-label={t("app.mobile.picker.close")} onclick={closeMobileOverlay}
      ><UiIcon name="close" size={18} /></button
    >
  </header>
  {#if hereBlock === "elsewhere"}<p class="note" data-sheet-note>{t("app.mobile.sheet.hereElsewhere")}</p>{/if}

  <div class="body">
    <section aria-labelledby="mobile-sheet-new">
      <h3 id="mobile-sheet-new" class="label">{t("app.mobile.sheet.newTile")}</h3>
      <div class="grid">
        {#each items as item (item.key)}
          {@const logo = item.kind === "ai" ? aiIconName(item.id) : null}
          <button type="button" class="tile" data-launch={item.kind} aria-label={t(place === "here" ? "app.mobile.sheet.openHere" : "app.mobile.sheet.openNew", { name: item.name })} onclick={() => launch(item)}>
            <span class="ico" aria-hidden="true">
              {#if item.kind === "shell"}
                <HostIcon icon={iconRef(shellIconName(item.shellId))} size={LOGO_PX} mono />
              {:else if item.kind === "ai"}
                {#if logo}<AiGlyph name={logo} size={LOGO_PX} mono />{:else}<UiIcon name="ai" size={24} />{/if}
              {:else}
                <UiIcon name="folder-open" size={24} filled />
              {/if}
            </span>
            <span class="lbl">{item.name}</span>
          </button>
        {/each}
      </div>
    </section>

    <section aria-labelledby="mobile-sheet-hosts">
      <h3 id="mobile-sheet-hosts" class="label">{t("app.mobile.sheet.hosts")}</h3>
      <div class="panel">
        {#each recent as row (row.name)}
          <button type="button" class="row" aria-label={t(place === "here" ? "app.mobile.sheet.connectHere" : "app.mobile.sheet.connect", { name: row.name })} onclick={() => connect(row.name)}>
            <span class="row-ico" aria-hidden="true"><UiIcon name="server" size={18} /></span>
            <span class="row-name">{row.name}</span>
            {#if row.at !== null}<span class="row-sub">{relativeTime(row.at, now, t)}</span>{/if}
            {#if row.connected}<span class="dot" title={t("app.mobile.connected")} aria-label={t("app.mobile.connected")}></span>{/if}
          </button>
        {:else}
          <p class="none">{t("app.mobile.sheet.noRecent")}</p>
        {/each}
        <button type="button" class="row all" onclick={() => openMobileBrowse("hosts")}>
          <span class="row-name">{t("app.mobile.sheet.browseAll")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
      </div>
    </section>

    <section aria-labelledby="mobile-sheet-more">
      <h3 id="mobile-sheet-more" class="label">{t("app.mobile.sheet.more")}</h3>
      <div class="panel">
        <button type="button" class="row" onclick={conversations}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="conversations" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.conversations")}</span>
        </button>
        <button type="button" class="row" data-sheet="side-chat" onclick={openMobileChat}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="chat" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.chat")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
        <button type="button" class="row" data-sheet="plans" onclick={openPlans}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="list-checks" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.plans")}</span>
          {#if plans > 0}<span class="badge" aria-label={t("app.mobile.sheet.plansPending", { n: plans })}>{plans}</span>{/if}
          <UiIcon name="chevron" size={16} />
        </button>
        <button type="button" class="row" data-sheet="orchestration-start" title={orchTip} aria-label={orchTip} onclick={orchestration}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="orchestra" size={18} /></span>
          <span class="row-name">{t("app.dock.launch.orchestration")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
        {#if keepAwakeSupported()}
          <!-- 켜고 끄는 일이라 시트를 닫지 않는다 -->
          <label class="row" for="sheet-keep-awake" data-sheet="keep-awake">
            <span class="row-ico" aria-hidden="true"><UiIcon name="away" size={18} /></span>
            <span class="row-name">{t("app.keepAwake.label")}</span>
            <Toggle id="sheet-keep-awake" checked={keepAwakeOn()} onchange={(on) => void setKeepAwake(on)} />
          </label>
        {/if}
      </div>
    </section>
  </div>

  <footer class="foot">
    <button type="button" class="pill" onclick={openMobileSettings}>
      <UiIcon name="settings" size={18} />
      {t("app.mobile.settings.title")}
    </button>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    height: var(--app-h, 100dvh);
    z-index: 90;
    background: color-mix(in srgb, #000 40%, transparent);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    top: auto;
    bottom: calc(100dvh - var(--app-h, 100dvh));
    max-height: calc(var(--app-h, 100dvh) - 48px);
    /* 확인 상자(114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-surface) var(--radius-surface) 0 0;
    background: var(--m3-surface-container-low, var(--m3-surface));
    color: var(--fg-1);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .sheet {
      animation: sheet-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .scrim {
      animation: scrim-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes sheet-in {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  .grip {
    flex: 0 0 auto;
    width: 32px;
    height: 4px;
    margin: 10px auto 2px;
    border-radius: 999px;
    background: var(--fg-3);
    opacity: 0.5;
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-2) var(--space-4);
  }
  .seg {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
  }
  .seg > button {
    min-width: 0;
    height: 38px;
    padding: 0 14px;
    border: 0;
    border-radius: 6px;
    background: var(--m3-surface-container-high);
    color: var(--fg-2);
    font: inherit;
    font-size: var(--t-sm);
    white-space: nowrap;
    cursor: pointer;
    transition: border-radius 200ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 120ms ease;
  }
  .seg > button:first-child {
    border-top-left-radius: 19px;
    border-bottom-left-radius: 19px;
  }
  .seg > button:last-child {
    border-top-right-radius: 19px;
    border-bottom-right-radius: 19px;
  }
  .seg > button.selected {
    border-radius: 19px;
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
    font-weight: var(--fw-semibold);
  }
  .seg > button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .seg > button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .note {
    flex: 0 0 auto;
    margin: 0;
    padding: 0 var(--space-4) var(--space-2);
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .muted {
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .ws {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .round {
    flex: 0 0 auto;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-2);
  }
  .label {
    margin: 0 0 var(--space-2) var(--space-2);
    color: var(--accent);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    height: 76px;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    cursor: pointer;
  }
  .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    color: var(--accent);
  }
  .lbl {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container);
  }
  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: var(--fg-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-ico {
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
  .row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .row-sub {
    flex: 0 0 auto;
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .row.all .row-name {
    font-weight: var(--fw-regular);
    color: var(--fg-2);
  }
  .row.all {
    color: var(--fg-2);
  }
  .none {
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ok, #3fb950);
  }
  .badge {
    flex: 0 0 auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .foot {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .pill {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 48px;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    font-size: var(--t-md);
    cursor: pointer;
  }
  .tile:focus-visible,
  .row:focus-visible,
  .round:focus-visible,
  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
