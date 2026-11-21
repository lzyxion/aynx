<script lang="ts">
  /** 터미널 · 쿼리 타일의 이름 카드 — 시각 층이다(같은 글자는 이름 칸의 `aria-describedby` 가 가리키는 숨은 한 줄이 쥔다) */
  import type { InfoCard } from "$lib/session-info";
  import HoverCard from "$lib/HoverCard.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import type { TooltipRect } from "$lib/tooltip";

  let {
    name,
    code,
    address,
    color,
    icon = null,
    card,
    anchor,
  }: {
    name: string;
    code: string;
    address: string;
    color: string | null;
    icon?: string | null;
    card: InfoCard;
    anchor: TooltipRect;
  } = $props();
</script>

<HoverCard
  {anchor}
  watch={[card, name, code, address]}
  minWidth={240}
  maxWidth={440}
  gap="var(--space-2)"
  data-session-info-card=""
>
  <div class="s-head">
    <div class="s-title">
      {#if icon}
        <HostIcon {icon} size={14} />
      {:else if color}
        <span class="s-dot" style:background={color}></span>
      {/if}
      <span class="s-name">{name}</span>
      <span class="s-code">{code}</span>
    </div>
    {#if address}
      <div class="s-addr">{address}</div>
    {/if}
  </div>
  <div class="s-rows">
    {#each card.rows as r (r.key)}
      <span class="s-label">{r.label}</span>
      <span class="s-value" class:warn={r.tone === "warn"} data-row={r.key}>{r.value}</span>
    {/each}
  </div>
  {#each card.warnings as w (w)}
    <div class="s-warn">{w}</div>
  {/each}
</HoverCard>

<style>
  .s-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .s-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .s-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .s-name {
    min-width: 0;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .s-code {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
  }
  .s-addr {
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .s-rows {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-3);
    row-gap: 4px;
  }
  .s-label {
    color: var(--fg-3);
    white-space: nowrap;
  }
  .s-value {
    color: var(--fg-1);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .s-value.warn,
  .s-warn {
    color: var(--warn);
  }
</style>
