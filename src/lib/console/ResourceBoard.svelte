<script lang="ts">
  /**
   * **자원 화면의 몸통**(2026-10-17 — 로컬 자원 모니터. 처음에는 사용량 화면의 자원 칸이었고 같은 날 제 판 `ResourceView.svelte` 로
   * 나왔다). 위에서 아래로: 지금 값 띠(이 PC 전체 · 앱 · 로컬 타일 합계 — 칸마다 차트 선의 색 표시가 범례다 · 상태바 호버 카드와 같은
   * 셋 · 같은 차례) → CPU · 메모리 차트 한 줄에 반씩(같은 세 줄뿐, 지난 30분 — 10-27 사용자 A안: 타일마다의 선을 걷었다 · 같은 날 "앱 전체"
   * 칸 · 선을 더해 봤다가 걷었다 · 이 PC 전체 선은 호버 카드와 같은 지표 색 실선) → 줄 목록(앱의 두 몫 · 타일마다 — 지난 10분 메모리
   * 추이 선 · 상위 프로세스 이름).
   * 띠의 설명 글은 걷었다(10-27 사용자).
   *
   * 이 칸이 **보이는 동안만** 표본을 당긴다(`watchResources` — 세션 서버의 관찰 임대). 값의 뜻(기계 전체 대비 CPU · 전용 작업 집합 합)은
   * `$lib/resources` · `src-tauri/src/server/resources.rs` 머리말. 타일 이름은 이 창의 탭에서 스트림으로 찾고(`resource-tiles.ts`), 없으면(다른 창 ·
   * 떨어진 세션) "다른 창의 타일" 로 적는다. 타일 줄을 누르면 그 타일로 간다(타일로 가는 길이 이 화면을 걷는다).
   */
  import { resourceViewOpen } from "$lib/app/usage-view.svelte.js";
  import {
    resourceError,
    resourceInterval,
    resourceOutdated,
    resourceRing,
    resourceTop,
    watchResources,
  } from "$lib/app/resources.svelte.js";
  import { focusTile } from "$lib/app/tabs.svelte.js";
  import { localTileInfo } from "$lib/console/resource-tiles";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { PaneSpec } from "$lib/session";
  import {
    SYSTEM_SERIES,
    TILES_SERIES,
    appUsage,
    chartData,
    formatCpu,
    formatMem,
    memAxisTop,
    sparkPath,
    topLine,
    usageTrend,
    type ResourceChartData,
    type ResourceUsage,
    type TopProc,
  } from "$lib/resources";
  import { formatMemPair, lastSystemSample, systemPct } from "$lib/resource-status";
  import ResourceChart from "$lib/console/ResourceChart.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  const visible = $derived(resourceViewOpen());
  $effect(() => {
    if (!visible) return;
    return watchResources();
  });

  const ring = $derived(resourceRing());
  const last = $derived(ring.length > 0 ? ring[ring.length - 1] : null);
  const top = $derived(resourceTop());

  /** 이 창의 타일 — 스트림 → (탭 id · 타일 id · 이름) */
  const tileInfo = $derived(localTileInfo());
  /** 이 PC 전체 — `system` 이 있는 가장 새 표본(옛 서버면 없음) */
  const sys = $derived(lastSystemSample(ring)?.system ?? null);

  function labelOf(key: string): string {
    if (key === SYSTEM_SERIES) return t("board.resources.system");
    if (key === TILES_SERIES) return t("board.resources.tiles", { n: tileRows.length });
    if (key === "@app") return t("board.resources.app");
    return tileInfo.get(key)?.name ?? t("board.resources.otherTile");
  }

  const cpuData = $derived(chartData(ring, "cpu", resourceInterval()));
  const memData = $derived(chartData(ring, "mem", resourceInterval()));
  let cpuColors = $state<string[]>([]);
  let memColors = $state<string[]>([]);

  interface Row {
    key: string;
    label: string;
    usage: ResourceUsage;
    tops: TopProc[];
    jump: { tabId: string; paneId: string } | null;
    /** 줄 앞 로고 — 타일이면 그 타일(`PaneIcon`), 앱의 몫이면 UI 아이콘 이름, 다른 창의 타일이면 둘 다 없어 일반 터미널 */
    pane: PaneSpec | null;
    ui: string | null;
  }

  const appRows = $derived<Row[]>(
    last === null
      ? []
      : [
          { key: "@gui", label: t("board.resources.gui"), usage: last.gui, tops: top.gui, jump: null, pane: null, ui: "monitor" },
          { key: "@server", label: t("board.resources.server"), usage: last.server, tops: top.server, jump: null, pane: null, ui: "server" },
        ],
  );

  const tileRows = $derived<Row[]>(
    last === null
      ? []
      : Object.entries(last.tiles)
          .map(([key, usage]) => {
            const info = tileInfo.get(key) ?? null;
            return {
              key,
              label: info?.name ?? t("board.resources.otherTile"),
              usage,
              tops: top.tiles[key] ?? [],
              jump: info ? { tabId: info.tabId, paneId: info.paneId } : null,
              pane: info?.pane ?? null,
              ui: null,
            };
          })
          .sort((a, b) => b.usage.cpu - a.usage.cpu || b.usage.mem - a.usage.mem || a.label.localeCompare(b.label)),
  );

  const tilesSum = $derived(
    tileRows.reduce((acc, r) => ({ cpu: Math.min(100, acc.cpu + r.usage.cpu), mem: acc.mem + r.usage.mem }), { cpu: 0, mem: 0 }),
  );

  /** 그 시리즈의 차트 선 색 — 맨 위 칸의 색 표시 · 표 줄 추이 선이 같은 색을 쓴다(앱 · 타일 합계는 두 차트에서 같은 색) */
  function colorOf(key: string, d: ResourceChartData, colors: string[]): string {
    return colors[d.series.findIndex((x) => x.key === key)] ?? "currentColor";
  }

  /** 표 줄 추이 선의 그림 크기 */
  const SPARK = { w: 88, h: 18 } as const;
</script>

<!-- 줄 이름 칸 — 로고(타일 머리줄 · 탭과 같은 `PaneIcon`) + 이름 글자. 로고는 장식(이름이 읽어 준다) -->
{#snippet nameCell(r: Row)}
  <span class="name">
    <span class="logo">
      {#if r.pane}<PaneIcon pane={r.pane} size={14} />{:else}<UiIcon name={r.ui ?? "terminal"} size={14} />{/if}
    </span>
    <span class="label">{r.label}</span>
  </span>
{/snippet}

<!-- 표 한 줄의 칸 — 이름 · CPU · 메모리 · 지난 10분 메모리 추이(`color` = 그 묶음의 차트 선 색) · 상위 프로세스 -->
{#snippet rowCells(r: Row, color: string)}
  {@render nameCell(r)}
  <span class="num">{formatCpu(r.usage.cpu)}</span>
  <span class="num">{formatMem(r.usage.mem)}</span>
  <svg class="spark" width={SPARK.w} height={SPARK.h} viewBox="0 0 {SPARK.w} {SPARK.h}" aria-hidden="true">
    <path d={sparkPath(usageTrend(ring, r.key, "mem"), SPARK.w, SPARK.h)} stroke={color} />
  </svg>
  <span class="tops">{r.tops.map(topLine).join(" · ")}</span>
{/snippet}

<div class="res-board" data-resource-board>
  {#if resourceOutdated()}
    <p class="note" role="note">{resourceError() ?? t("board.resources.outdated")}</p>
  {:else}
    <div class="strip">
      {#if sys}
        {@const memPct = systemPct(sys, "mem")}
        <div class="cell" data-resource-system>
          <!-- 이 PC 전체는 CPU · 메모리 차트에서 색이 다르다(지표 색) — 표시를 반씩 -->
          <span class="k"
            ><span
              class="mark"
              style:--mark="linear-gradient(90deg, {colorOf(SYSTEM_SERIES, cpuData, cpuColors)} 50%, {colorOf(SYSTEM_SERIES, memData, memColors)} 50%)"
            ></span>{t("board.resources.system")}</span
          >
          <span class="v">{formatCpu(sys.cpu)}</span>
          <span class="s"
            >{memPct === null ? formatMem(sys.memUsed) : `${formatMemPair(sys.memUsed, sys.memTotal)} · ${Math.round(memPct)}%`}</span
          >
        </div>
      {/if}
      <div class="cell" data-resource-app>
        <span class="k"><span class="mark" style:--mark={colorOf("@app", cpuData, cpuColors)}></span>{t("board.resources.app")}</span>
        <span class="v">{last ? formatCpu(appUsage(last).cpu) : "—"}</span>
        <span class="s">{last ? formatMem(appUsage(last).mem) : ""}</span>
      </div>
      <div class="cell" data-resource-tiles>
        <span class="k"
          ><span class="mark" style:--mark={colorOf(TILES_SERIES, cpuData, cpuColors)}></span>{t("board.resources.tiles", {
            n: tileRows.length,
          })}</span
        >
        <span class="v">{last ? formatCpu(tilesSum.cpu) : "—"}</span>
        <span class="s">{last ? formatMem(tilesSum.mem) : ""}</span>
      </div>
    </div>
    {#if resourceError()}
      <p class="note" role="note">{resourceError()}</p>
    {/if}

    <div class="charts">
      <section class="card">
        <h3>{t("board.resources.cpu")}</h3>
        <ResourceChart
          data={cpuData}
          labels={labelOf}
          unit="%"
          format={formatCpu}
          systemToken="--accent"
          oncolors={(c) => (cpuColors = c)}
        />
      </section>

      <section class="card">
        <h3>{t("board.resources.mem")}</h3>
        <ResourceChart
          data={memData}
          labels={labelOf}
          unit="MB"
          max={sys ? memAxisTop(sys.memTotal) : 0}
          format={(v) => formatMem(v * 1024 * 1024)}
          systemToken="--chip-branch"
          oncolors={(c) => (memColors = c)}
        />
      </section>
    </div>

    <section class="card">
      <h3>{t("board.resources.now")}</h3>
      {#if last === null}
        <p class="empty">{t("board.resources.waiting")}</p>
      {:else}
        {@const tileColor = colorOf(TILES_SERIES, memData, memColors)}
        {@const appColor = colorOf("@app", memData, memColors)}
        <div class="rows">
          <div class="row head" aria-hidden="true">
            <span></span>
            <span class="num">{t("board.resources.cpu")}</span>
            <span class="num">{t("board.resources.mem")}</span>
            <span>{t("board.resources.trend")}</span>
            <span></span>
          </div>
          <div class="group">{t("board.resources.app")}</div>
          {#each appRows as r (r.key)}
            <div class="row">{@render rowCells(r, appColor)}</div>
          {/each}
          <div class="group">{t("board.resources.tiles", { n: tileRows.length })}</div>
          {#each tileRows as r (r.key)}
            {@const jump = r.jump}
            {#if jump}
              <button type="button" class="row link" title={t("board.resources.goto")} onclick={() => focusTile(jump.tabId, jump.paneId)}>
                {@render rowCells(r, tileColor)}
              </button>
            {:else}
              <div class="row">{@render rowCells(r, tileColor)}</div>
            {/if}
          {:else}
            <p class="empty">{t("board.resources.noTiles")}</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* 위아래 여백 · 덩어리 사이 간격은 사용량 화면(`.usage`)과 같다. 열 때 덩어리가 시차를 두고 떠오르는 것은
     `dashboard-motion.ts` 의 `RISE_SELECTOR`(CoverPanel 이 연다) */
  .res-board {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) 0 var(--space-6);
  }

  .note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-2);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  /* 띠 · 카드의 면 · 글자 급은 사용량 화면(`UsageBoard`)과 같다 — 불투명 면 · 칸막이 있는 상자 하나(10-27 사용자: 다크에서 더 검게 보였다) */
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    box-shadow: -1px 0 0 var(--line);
  }

  .cell .k {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .cell .v {
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .cell .s {
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  /* 차트 선의 색 표시 — 칸이 곧 범례 */
  .mark {
    flex: none;
    width: 10px;
    height: 3px;
    border-radius: 2px;
    background: var(--mark);
  }

  /* CPU · 메모리 차트를 한 줄에 반씩(10-27 사용자 — 아래 "지금" 표가 스크롤 없이 보이게). 좁으면 위아래로 */
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: var(--space-3);
  }

  .card {
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .card h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .group {
    margin: var(--space-2) 0 2px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(120px, 1.2fr) 64px 72px 88px minmax(0, 2fr);
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
  }

  .row.head {
    padding-block: 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .row.link {
    cursor: pointer;
  }

  .row.link:hover {
    background: var(--surface-field);
  }

  .row.link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .logo {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .label,
  .tops {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spark {
    display: block;
    overflow: visible;
  }

  .spark path {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .tops {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .empty {
    margin: var(--space-2) 0;
    font-size: var(--t-sm);
    color: var(--fg-2);
  }
</style>
