<script lang="ts">
  // `document.body` 로 옮기는 포털은 쓰지 않는다 — Svelte 5 는 블록을 걷을 때 제 노드 줄을 형제로 따라가며 지우므로,
  // 옮긴 노드는 엉뚱한 형제를 끌고 갈 수 있다. 상태바 띠 밖(`StatusBar` 최상위)에 선다.
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { barWidth, type UsageRing } from "$lib/agent-usage";
  import HoverCard from "$lib/HoverCard.svelte";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ring,
    anchor,
    side,
  }: {
    ring: UsageRing;
    anchor: TooltipRect;
    /** 가로 띠면 `"vertical"`(위·아래), 세로 기둥이면 카드가 설 쪽 */
    side: "vertical" | "left" | "right";
  } = $props();
</script>

<HoverCard {anchor} {side} watch={ring} minWidth={280} maxWidth={440} data-usage-card-hover={ring.agent}>
  <div class="u-head">
    <span class="u-logo"><HostIcon icon={iconRef(ring.agent)} size={14} /></span>
    <span class="u-name">{ring.name}</span>
    {#if !ring.card.empty}
      <span class="u-measured" class:stale={ring.card.stale}>{ring.card.measured}</span>
    {/if}
  </div>
  {#if ring.card.empty}
    <p class="u-none">{t("app.statusbar.usage.card.none")}</p>
  {:else}
    <div class="u-rows">
      {#each ring.card.rows as r (r.key)}
        <div class="u-row" class:dim={r.dim} data-level={r.level}>
          <span class="u-label">{r.label}</span>
          <span class="u-bar">
            <span class="u-track"><span class="u-fill {r.level}" style:width="{barWidth(r.pct)}%"></span></span>
            {#if r.elapsed !== null}
              <!-- 창이 흐른 몫 — 채움이 이 선을 넘었으면 창이 끝나기 전에 한도에 닿는 속도다 -->
              <span class="u-tick" data-elapsed={r.elapsed.toFixed(3)} style:left="{r.elapsed * 100}%"></span>
            {/if}
          </span>
          <span class="u-pct {r.level}">{r.pctText}</span>
          <span class="u-reset" class:stale={r.resetStale}>{r.reset}</span>
        </div>
      {/each}
    </div>
  {/if}
</HoverCard>

<style>
  .u-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .u-logo {
    flex: 0 0 auto;
    display: inline-flex;
    line-height: 0;
  }
  .u-name {
    flex: 1;
    min-width: 0;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .u-measured {
    flex: 0 0 auto;
    padding-left: var(--space-3);
    color: var(--fg-3);
    white-space: nowrap;
  }
  .u-measured.stale {
    color: var(--warn);
  }

  .u-none {
    margin: 0;
    color: var(--fg-3);
  }

  .u-rows {
    display: grid;
    grid-template-columns: auto 120px auto auto;
    align-items: center;
    column-gap: var(--space-2);
    row-gap: 4px;
  }
  .u-row {
    display: contents;
  }
  .u-row.dim > * {
    opacity: 0.5;
  }
  .u-label {
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 눈금이 트랙 위아래로 조금 삐져나오게 겉 상자는 자르지 않는다 */
  .u-bar {
    position: relative;
    height: 12px;
    display: flex;
    align-items: center;
  }
  .u-track {
    display: flex;
    gap: 2px;
    width: 100%;
    height: 8px;
  }
  .u-track::after {
    flex: 1 1 0;
    content: "";
    border-radius: 4px;
    background: var(--control-track);
  }
  .u-fill {
    display: block;
    flex: none;
    height: 100%;
    border-radius: 4px;
    background: var(--control-on-bg);
  }
  .u-fill.warn {
    background: var(--warn);
  }
  .u-fill.err {
    background: var(--err);
  }
  .u-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--fg-1);
  }

  .u-pct {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }
  .u-pct.warn {
    color: var(--warn);
  }
  .u-pct.err {
    color: var(--err);
  }
  .u-reset {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .u-reset.stale {
    color: var(--warn);
    font-style: italic;
  }
</style>
