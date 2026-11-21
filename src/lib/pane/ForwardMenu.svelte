<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import {
    forwardBrowserUrl,
    forwardKindFlag,
    forwardLabel,
    forwardStateLabel,
    isForwardActive,
    relayingConns,
    type ForwardInfo,
  } from "$lib/forward";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * 포워딩 목록 메뉴 — 앱이 건 포워드(에이전트 신호)는 표에 들어오지 않아 여기 오지 않는다(`$lib/forward` 의 `userForwards`).
   * 줄의 값은 인자로 올린다 — menu-runner 통로(스냅샷 → 닫기 → 실행)는 `PaneHost` 의 `runForwardMenu` 가 든다. 순서를 뒤집으면 항목이 조용히 죽는다.
   */
  let {
    title,
    forwards,
    left,
    top,
    onstop,
    onbrowse,
    onadd,
    onclose,
  }: {
    title: string;
    forwards: ForwardInfo[];
    left: number;
    top: number;
    onstop: (f: ForwardInfo) => void;
    onbrowse: (url: string) => void;
    onadd: () => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const at = shownTop;
    void forwards.length; // 줄 수가 바뀌면 높이가 달라진다 — 그때 다시 잰다
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (at > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  });

  // 포워딩 칩은 비켜 간다 — 여기서 닫으면 뒤따르는 `click` 이 "열려 있지 않다" 를 보고 다시 연다
  $effect(() => closeOnOutside(() => el, "[data-forward-chip]", onclose));

  function onKey(ev: KeyboardEvent) {
    menuKeydown(ev, el, "button:not([disabled])", onclose);
  }

  const relaying = $derived(relayingConns(forwards));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="fwmenu menu-surface"
  role="menu"
  aria-label={tr("pane.fwmenu.aria", { title })}
  tabindex="-1"
  data-forward-menu
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <div class="head">
    <p class="group menu-title">{tr("pane.fwmenu.group", { title })}</p>
    {#if relaying > 0}
      <span class="summary">{tr("pane.header.forward.relaying", { n: relaying })}</span>
    {/if}
  </div>

  {#if forwards.length === 0}
    <p class="note">{tr("app.forward.empty")}</p>
  {/if}
  {#each forwards as f (f.id)}
    {@const on = isForwardActive(f)}
    {@const label = forwardLabel(f, tr)}
    {@const url = forwardBrowserUrl(f)}
    <div class="row" data-forward-row={f.id}>
      <span
        class="dot"
        class:on
        title={on ? tr("app.forward.dot.active") : tr("app.forward.dot.idle")}
        aria-hidden="true"
      ></span>
      <span class="flag">{forwardKindFlag(f)}</span>
      <span class="route" title={label}>{label}</span>
      <span class="state" class:on>{forwardStateLabel(f, tr)}</span>
      {#if url !== null}
        <button
          type="button"
          class="side"
          role="menuitem"
          title={tr("app.forward.open")}
          aria-label={tr("pane.fwmenu.open.aria", { url })}
          onclick={() => onbrowse(url)}
        >
          <UiIcon name="external" size={13} />
        </button>
      {/if}
      <button
        type="button"
        class="side stop"
        role="menuitem"
        title={tr("app.forward.stop")}
        aria-label={tr("pane.fwmenu.stop.aria", { label })}
        onclick={() => onstop(f)}
      >
        <UiIcon name="close" size={13} />
      </button>
    </div>
  {/each}

  <hr class="menu-sep" />
  <button type="button" class="add menu-row" role="menuitem" data-forward-add onclick={onadd}>
    <span class="menu-mark"><UiIcon name="plus" size={14} /></span>{tr(
      "pane.fwmenu.add",
    )}
  </button>
</div>

<style>
  .fwmenu {
    position: fixed;
    z-index: 20;
    min-width: 280px;
    max-width: 400px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .group {
    flex: 1;
    min-width: 0;
  }

  .summary {
    flex: none;
    padding-right: var(--space-2);
    font-size: var(--t-xs);
    color: var(--ok);
    font-variant-numeric: tabular-nums;
  }

  .note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    padding-left: var(--space-3); /* 머리글(`.menu-title`)과 같은 x */
    font-size: var(--t-sm);
    border-radius: var(--radius-row);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-muted);
    opacity: 0.5;
  }

  .dot.on {
    background: var(--ok);
    opacity: 1;
  }

  .flag {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }

  .route {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--fg-1);
  }

  .state {
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .state.on {
    color: var(--ok);
  }

  .side {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    min-height: 30px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-row); /* 칠은 메뉴 줄과 같은 알약 */
    cursor: pointer;
  }

  .side:hover,
  .side:focus-visible {
    color: var(--fg-1);
    background: var(--surface-hover);
    outline: none;
  }

  .side.stop:hover,
  .side.stop:focus-visible {
    color: var(--err);
  }

  /* `.menu-row` 는 block 이라 그림 칸과 글자를 가운데로 맞추려 flex 로 */
  .add {
    display: flex;
    align-items: center;
  }
</style>
