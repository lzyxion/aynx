<!--
  폰 알림 화면 — 전체 화면 덮개. 폰에서는 데스크톱 독을 열지 않는다. 몸은 독의 알림 칸 본문(`DockAlerts`) 그대로다.
-->
<script lang="ts">
  import { pushOut } from "$lib/mobile/motion";
  import DockAlerts from "$lib/DockAlerts.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import {
    agentBannerBadge,
    agentBannerItems,
    clearResolvedBanners,
    resolveFinishedBanners,
    resolvedAgentBanners,
  } from "$lib/app/agent-banners.svelte.js";
  import { clearNotificationHistory, markNotificationsRead, notificationList } from "$lib/app/notifications.svelte.js";
  import { toggleSessionSheet } from "$lib/app/session-sheet.svelte.js";
  import { openPlans, setPlansView } from "$lib/app/plans.svelte.js";
  import { closeMobileOverlay } from "$lib/app/mobile-sheets.svelte.js";

  let body = $state<ReturnType<typeof DockAlerts> | undefined>();

  const count = $derived(pendingCount() + agentBannerBadge().count);
  const urgent = $derived(pendingCount() > 0 || agentBannerBadge().urgent);
  const canReadAll = $derived(
    agentBannerItems().some((b) => b.kind !== "permission") || notificationList().some((e) => !e.read),
  );
  const canClear = $derived(notificationList().length > 0 || resolvedAgentBanners().length > 0);

  function readAll(): void {
    resolveFinishedBanners();
    markNotificationsRead();
  }

  /** 누른 단추가 흐려지므로 포커스는 목록으로 */
  function clearAlerts(): void {
    clearNotificationHistory();
    clearResolvedBanners();
    body?.focusList();
  }

  /** 덮개는 한 번에 하나 — 이 화면을 갈아 끼운다 */
  function openPlanHistory(): void {
    setPlansView("history");
    openPlans();
  }

  let closeBtn = $state<HTMLButtonElement | null>(null);
  // 단추에 포커스 — 입력 칸이면 화면 키보드가 뜬다 · Esc 가 이 덮개에서 받힌다
  $effect(() => {
    closeBtn?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMobileOverlay();
  }
</script>

<div class="malerts" out:pushOut|global role="dialog" aria-modal="true" aria-labelledby="mobile-alerts-title" tabindex="-1" data-mobile-alerts {onkeydown}>
  <header class="head">
    <h2 id="mobile-alerts-title" class="title">{t("app.mobile.sheet.alerts")}</h2>
    {#if count > 0}<span class="badge" class:urgent aria-label={t("app.dock.alerts.badge", { n: count })}>{count}</span>{/if}
    <span class="spacer"></span>
    <button
      type="button"
      class="round"
      bind:this={closeBtn}
      title={t("app.mobile.picker.close")}
      aria-label={t("app.mobile.picker.close")}
      onclick={closeMobileOverlay}><UiIcon name="close" size={18} /></button
    >
  </header>

  <div class="body">
    <DockAlerts bind:this={body} open={true} side="right" onclose={closeMobileOverlay} onsessions={toggleSessionSheet} />
  </div>

  <footer class="foot">
    <button type="button" class="pill" data-mobile-plans onclick={openPlanHistory}>{t("app.dock.alerts.foot.plans")}</button>
    <button type="button" class="pill" data-mobile-read-all disabled={!canReadAll} onclick={readAll}
      ><UiIcon name="check-check" size={18} />{t("app.dock.alerts.foot.readAll")}</button
    >
    <button type="button" class="pill" data-mobile-clear disabled={!canClear} onclick={clearAlerts}
      ><UiIcon name="trash" size={18} />{t("app.dock.alerts.foot.clear")}</button
    >
  </footer>
</div>

<style>
  .malerts {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    /* 확인 상자(114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface);
    color: var(--fg-1);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .malerts {
      animation: malerts-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes malerts-in {
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
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--fw-semibold);
  }
  .spacer {
    flex: 1 1 auto;
  }
  .badge {
    flex: 0 0 auto;
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-1);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 22px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  /* 상태줄 종 배지와 같은 규칙 */
  .badge.urgent {
    background: var(--accent);
    color: var(--on-accent, #fff);
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
  .body {
    flex: 1 1 auto;
    min-height: 0;
  }
  .body :global(.side) {
    width: 44px;
    height: 44px;
  }
  .body :global(.side svg) {
    width: 16px;
    height: 16px;
  }
  .foot {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .pill {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 48px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    font-size: var(--t-sm);
    white-space: nowrap;
    cursor: pointer;
  }
  .pill:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .round:focus-visible,
  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
