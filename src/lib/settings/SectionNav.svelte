<script lang="ts">
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  /** `marked` = 저장을 막는 칸이 있는 면(이름 옆 붉은 점). 호스트 폼 · 프로젝트 폼도 이 컴포넌트를 쓴다. */
  let {
    tabs,
    active,
    onselect,
    marked = [],
  }: {
    tabs: readonly { id: string; labelKey: Key; icon?: string; dividerBefore?: boolean }[];
    active: string;
    onselect: (id: string) => void;
    marked?: readonly string[];
  } = $props();

  let navEl: HTMLElement | undefined = $state();
  let indicatorEl: HTMLElement | undefined = $state();
  let placedFor: string | null = null;

  function place(animate: boolean) {
    const nav = navEl;
    const ind = indicatorEl;
    if (!nav || !ind) return;
    const btn = nav.querySelector<HTMLElement>(`.nav-item[data-nav-tab="${CSS.escape(active)}"]`);
    if (!btn || btn.offsetHeight === 0) {
      ind.style.opacity = "0";
      placedFor = null;
      return;
    }
    const slide = animate && placedFor !== null;
    if (!slide) ind.style.transition = "none";
    ind.style.transform = `translateY(${btn.offsetTop}px)`;
    ind.style.height = `${btn.offsetHeight}px`;
    ind.style.opacity = "1";
    if (!slide) {
      void ind.offsetHeight; // 전이 없는 자리를 먼저 확정한 뒤 CSS 전이를 되돌린다
      ind.style.transition = "";
    }
    placedFor = active;
  }

  $effect(() => {
    void active;
    void tabs;
    void navEl;
    void indicatorEl;
    place(placedFor !== active);
  });

  $effect(() => {
    const nav = navEl;
    if (!nav || typeof ResizeObserver === "undefined") return;
    void tabs;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(nav);
    for (const b of nav.querySelectorAll(".nav-item")) ro.observe(b);
    return () => ro.disconnect();
  });
</script>

<nav class="settings-nav" aria-label={t("settings.nav.aria")} bind:this={navEl}>
  <div class="nav-indicator" aria-hidden="true" bind:this={indicatorEl}></div>
  {#each tabs as tab (tab.id)}
    {#if tab.dividerBefore}
      <div class="nav-sep" role="separator" data-nav-sep-before={tab.id}></div>
    {/if}
    <button
      type="button"
      class="nav-item"
      class:active={active === tab.id}
      aria-current={active === tab.id ? "page" : undefined}
      data-nav-tab={tab.id}
      data-nav-marked={marked.includes(tab.id) ? "" : undefined}
      onclick={() => onselect(tab.id)}
    >
      {#if tab.icon}
        <span class="nav-icon"><UiIcon name={tab.icon} size={15} /></span>
      {/if}
      <span class="nav-label">{t(tab.labelKey)}</span>
      {#if marked.includes(tab.id)}
        <span class="nav-dot" aria-hidden="true"></span>
        <span class="sr-only">{t("settings.nav.marked")}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .settings-nav {
    position: relative; /* 판(.nav-indicator)과 칸의 offsetTop 기준 — 스크롤하면 함께 움직인다 */
    flex: 0 0 150px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .nav-sep {
    flex: 0 0 auto;
    height: 1px;
    margin: var(--space-1) var(--space-3);
    background: var(--border);
  }

  .nav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    border-radius: 999px;
    background: var(--accent-soft);
    opacity: 0;
    pointer-events: none;
    will-change: transform;
    transition:
      transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-indicator {
      transition: none;
    }
  }

  .nav-item {
    position: relative; /* 판 위에 선다 */
    z-index: 1;
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    width: 100%;
    min-height: 28px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-2);
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    /* 글자색 전환은 두지 않는다 — 페이드가 클릭 뒤 지연으로 느껴졌다 */
  }

  .nav-item:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 판이 뒤에 깔리므로 칸 자신은 투명하다 */
  .nav-item.active {
    color: var(--on-accent-soft);
    font-weight: var(--fw-semibold);
    background: transparent;
  }

  .nav-item.active .nav-icon {
    color: var(--on-accent-soft);
  }

  .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 16px;
    width: 16px;
    margin-right: var(--space-2);
  }

  .nav-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    margin-left: var(--space-2);
    border-radius: 50%;
    background: var(--err);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
