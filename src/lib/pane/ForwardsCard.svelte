<script lang="ts">
  // 포워딩 칩 호버 카드 — 타일 상자 밖(`PaneHost` 최상위)에 그린다.
  import {
    forwardKindFlag,
    forwardLabel,
    forwardStateLabel,
    isForwardActive,
    relayingConns,
    type ForwardInfo,
  } from "$lib/forward";
  import HoverCard from "$lib/HoverCard.svelte";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    forwards,
    anchor,
  }: {
    forwards: ForwardInfo[];
    anchor: TooltipRect;
  } = $props();

  const MAX_SHOWN = 8;

  const shown = $derived(forwards.slice(0, MAX_SHOWN));
  const more = $derived(forwards.length - shown.length);
  const relaying = $derived(relayingConns(forwards));
</script>

<HoverCard
  {anchor}
  watch={forwards}
  minWidth={220}
  maxWidth={420}
  padX="10px"
  gap="7px"
  lineHeight={1.3}
  data-forwards-card=""
>
  <div class="f-head">
    <span class="f-title">{t("pane.header.forward.title", { n: forwards.length })}</span>
    {#if relaying > 0}
      <span class="f-relay">{t("pane.header.forward.relaying", { n: relaying })}</span>
    {/if}
  </div>
  <div class="f-list">
    {#each shown as f (f.id)}
      {@const on = isForwardActive(f)}
      <div class="f-row">
        <span class="f-dot" class:on></span>
        <span class="f-flag">{forwardKindFlag(f)}</span>
        <span class="f-route">{forwardLabel(f, t)}</span>
        <span class="f-state" class:on>{forwardStateLabel(f, t)}</span>
      </div>
    {/each}
    {#if more > 0}
      <span class="f-more">{t("pane.tmux.card.more", { n: more })}</span>
    {/if}
  </div>
</HoverCard>

<style>
  .f-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .f-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .f-relay {
    color: var(--ok);
    white-space: nowrap;
  }

  .f-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .f-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .f-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-muted);
    opacity: 0.5;
  }
  .f-dot.on {
    background: var(--ok);
    opacity: 1;
  }
  .f-flag {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }
  .f-route {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .f-state {
    flex: none;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .f-state.on {
    color: var(--ok);
  }
  .f-more {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }
</style>
