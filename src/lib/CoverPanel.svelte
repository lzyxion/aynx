<script lang="ts">
  import { tick, untrack, type Snippet } from "svelte";
  import { isEditableTarget } from "$lib/keybindings";
  import UiIcon from "$lib/UiIcon.svelte";
  import { currentOpacity, playClose, playOpen, prefersReducedMotion } from "$lib/console/dashboard-motion";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // 캔버스를 덮는 판의 껍데기(사용량 · 자원 화면) — 늘 마운트되고 `hidden` 으로 숨는다.
  // `data-cover-view` 는 `tabs.svelte.ts` 가 "포커스가 이 판 안에 있었나" 를 볼 때 쓰는 표식이다.

  let {
    open,
    title,
    subtitle,
    onclose,
    children,
    ...attrs
  }: {
    open: boolean;
    title: string;
    subtitle: string;
    /** 포커스를 열기 전 자리로 돌려주며 닫는다 */
    onclose: () => void;
    children: Snippet;
    [key: `data-${string}`]: unknown;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  // 열리면 키보드를 판으로 — 포커스가 밑의 터미널에 남으면 글자가 보이지 않는 셸로 간다
  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      if (panelEl && !panelEl.contains(document.activeElement)) panelEl.focus({ preventScroll: true });
    });
  });

  /** 닫혔지만 내려가는 중 — `hidden` 을 미룬다 */
  let lingering = $state(false);
  let exitAnim: Animation | null = null;
  let wasOpen = false;

  function cancelExit(): number {
    if (exitAnim === null || panelEl === null) return 0;
    const from = currentOpacity(panelEl);
    const a = exitAnim;
    exitAnim = null;
    a.cancel();
    lingering = false;
    return from;
  }

  $effect.pre(() => {
    const now = open;
    untrack(() => {
      if (now === wasOpen) return;
      wasOpen = now;
      if (now || panelEl === null || prefersReducedMotion()) return;
      lingering = true;
      const a = playClose(panelEl, "slide");
      exitAnim = a;
      a.finished.then(
        () => {
          if (exitAnim !== a) return;
          exitAnim = null;
          lingering = false;
          void tick().then(() => a.cancel());
        },
        () => {},
      );
    });
  });

  $effect(() => {
    if (!open) return;
    untrack(() => {
      const from = cancelExit();
      if (panelEl && !prefersReducedMotion()) playOpen(panelEl, from, "slide");
    });
  });

  /** 전파를 끊는다 — 창 층위 Escape 사슬이 한 번 더 먹지 않게 */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    if (isEditableTarget(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    onclose();
  }
</script>

<div
  {...attrs}
  class="cover-view"
  role="presentation"
  bind:this={panelEl}
  hidden={!open && !lingering}
  inert={!open}
  data-closing={!open && lingering ? "" : undefined}
  tabindex="-1"
  data-cover-view
  onkeydown={onKeydown}
>
  <div class="head">
    <span class="title">{title}</span>
    <span class="sub">{subtitle}</span>
    <span class="head-fill"></span>
    <button
      type="button"
      class="btn btn-ghost head-close"
      title={t("board.close.title")}
      aria-label={t("board.close")}
      onclick={() => onclose()}><UiIcon name="close" size={14} /></button
    >
  </div>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  /*
   * z-index 90 — 타일(캔버스 안 최고 21)보다 위, 독(100)보다 아래. 크롬 글자를 얹는 판이라 터미널 면이 아니다.
   * 판이 비치므로 밑의 타일은 판이 떠 있는 동안 +page `.pane` 이 감춘다.
   */
  .cover-view {
    position: absolute;
    inset: var(--gap);
    z-index: 90;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-field);
    background-clip: padding-box;
    border: 1px solid var(--tile-rim, var(--line-faint));
    border-radius: var(--radius-surface);
    overflow: hidden;
  }

  .cover-view[hidden] {
    display: none;
  }

  .cover-view:focus {
    outline: none;
  }

  .cover-view[data-closing] {
    pointer-events: none;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--line-faint);
  }

  .title {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-fill {
    flex: 1;
  }

  .head-close {
    flex: 0 0 auto;
    width: 28px;
    padding: 0;
    color: var(--fg-2);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4) var(--space-4);
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  .body > :global(*) {
    max-width: 1080px;
    margin-inline: auto;
  }
</style>
