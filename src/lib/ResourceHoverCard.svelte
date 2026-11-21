<script lang="ts">
  /** `aria-hidden` · 커서를 먹지 않음 — 틀(`HoverCard`)의 규칙이다(접근성 이름은 고리 단추의 `aria-label`) */
  import HoverCard from "$lib/HoverCard.svelte";
  import { resourceInterval, resourceRing, resourceTop } from "$lib/app/resources.svelte.js";
  import { localTileInfo } from "$lib/console/resource-tiles";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { appUsage, formatCpu, formatMem, tilesUsage } from "$lib/resources";
  import {
    formatMemPair,
    lastSystemSample,
    sparkline,
    systemPct,
    topConsumers,
    type ResourceMetric,
  } from "$lib/resource-status";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    metric,
    anchor,
    side,
  }: {
    metric: ResourceMetric;
    anchor: TooltipRect;
    /** 가로 띠면 `"vertical"`(위 · 아래), 세로 기둥이면 카드가 설 쪽 */
    side: "vertical" | "left" | "right";
  } = $props();

  const SPARK_W = 240;
  const SPARK_H = 38;

  const ring = $derived(resourceRing());
  const last = $derived(lastSystemSample(ring));
  const pct = $derived(last ? systemPct(last.system, metric) : null);
  const spark = $derived(sparkline(ring, metric, { w: SPARK_W, h: SPARK_H }));
  const fmt = (v: number) => (metric === "cpu" ? formatCpu(v) : formatMem(v));
  const rows = $derived(last ? topConsumers(last, resourceTop(), metric) : []);
  const tiles = $derived(localTileInfo());
  const every = $derived(Math.max(1, Math.round(resourceInterval() / 1000)));

  function nameOf(key: string): string {
    if (key === "@app") return t("app.statusbar.resources.card.app");
    const info = tiles.get(key);
    return info ? (info.place ?? info.paneName) : t("board.resources.otherTile");
  }
</script>

{#if last && pct !== null}
  <!-- 폭 고정 — 카드 폭이 값을 따라 출렁이면 글래스 흐림 판(`::before`)이 옛 폭에 남아 오른쪽 가장자리 빛이 잘려 보인다 -->
  <HoverCard {anchor} {side} watch={rows} minWidth={296} maxWidth={296} gap="10px" data-resource-card-hover={metric}>
    <div class="r-head">
      <span class="r-big">{Math.round(pct)}%</span>
      <span class="r-sub"
        >{metric === "cpu" ? t("app.statusbar.resources.card.cpu") : t("app.statusbar.resources.card.mem")}</span
      >
      <span class="r-fill"></span>
      {#if metric === "mem"}<span class="r-sub r-pair">{formatMemPair(last.system.memUsed, last.system.memTotal)}</span>{/if}
    </div>

    <div class="r-spark-box">
      <svg
        class="r-spark"
        class:mem={metric === "mem"}
        viewBox="0 0 {SPARK_W} {SPARK_H}"
        preserveAspectRatio="none"
        width="100%"
        height={SPARK_H}
      >
        <line class="r-ref" x1="0" y1={spark.refY} x2={SPARK_W} y2={spark.refY} />
        {#if spark.area}<path class="r-area" d={spark.area} />{/if}
        {#if spark.line}<path class="r-line" d={spark.line} />{/if}
        {#if spark.last}<circle class="r-dot" cx={spark.last.x} cy={spark.last.y} r="2.6" />{/if}
      </svg>
      <div class="r-axis"><span>{t("app.statusbar.resources.card.ago")}</span><span>{t("app.statusbar.resources.card.now")}</span></div>
    </div>

    <div class="r-split">
      <span>{t("app.statusbar.resources.card.appShort")} <b>{fmt(appUsage(last)[metric])}</b></span>
      <span>{t("app.statusbar.resources.card.tiles")} <b>{fmt(tilesUsage(last)[metric])}</b></span>
    </div>

    {#if rows.length > 0}
      <div class="r-rows">
        {#each rows as r (r.key)}
          {@const info = tiles.get(r.key)}
          <div class="r-row" data-resource-card-row={r.key}>
            <span class="r-nm"
              >{#if info}<span class="r-logo" role="img" aria-label={info.paneName} title={info.paneName}
                  ><PaneIcon pane={info.pane} size={12} /></span
                >{/if}{nameOf(r.key)}{#if r.proc}<span class="r-dim"> · </span><span class="r-proc">{r.proc}</span>{/if}</span
            >
            <span class="r-v">{fmt(r.value)}</span>
            <span class="r-bar"><i style:width="{r.frac * 100}%"></i></span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="r-ft">
      <span>{t("app.statusbar.resources.card.open")}</span>
      <span>{t("app.statusbar.resources.card.every", { n: every })}</span>
    </div>
  </HoverCard>
{/if}

<style>
  .r-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .r-big {
    flex: 0 0 auto;
    font-size: 20px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .r-sub {
    color: var(--fg-2);
    white-space: nowrap;
  }
  .r-fill {
    flex: 1;
  }
  .r-pair {
    font-variant-numeric: tabular-nums;
  }

  .r-spark {
    --spark: var(--accent);
    display: block;
    overflow: visible;
  }
  .r-spark.mem {
    --spark: var(--chip-branch);
  }
  .r-ref {
    stroke: var(--line-strong);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .r-area {
    fill: var(--spark);
    fill-opacity: 0.14;
  }
  .r-line {
    fill: none;
    stroke: var(--spark);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .r-dot {
    fill: var(--spark);
  }
  .r-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 10px;
    color: var(--fg-2);
  }

  .r-split {
    display: flex;
    gap: var(--space-3);
    color: var(--fg-2);
  }
  .r-split b {
    color: var(--fg-1);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .r-rows {
    display: grid;
    gap: 5px;
  }
  .r-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-2);
    row-gap: 3px;
    align-items: center;
  }
  .r-nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r-logo {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 5px;
  }
  .r-dim {
    color: var(--fg-2);
  }
  .r-proc {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-2);
  }
  .r-v {
    font-variant-numeric: tabular-nums;
  }
  /* 몫 대비라 경고색은 없다 */
  .r-bar {
    grid-column: 1 / -1;
    display: flex;
    gap: 2px;
    height: 6px;
  }
  .r-bar::after {
    flex: 1 1 0;
    content: "";
    border-radius: 3px;
    background: var(--control-track);
  }
  .r-bar i {
    display: block;
    flex: none;
    height: 100%;
    border-radius: 3px;
    background: var(--control-on-bg);
  }

  .r-ft {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
    color: var(--fg-2);
  }
</style>
