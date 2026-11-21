<script lang="ts">
  /**
   * 자원 시간 차트 하나(CPU % 또는 메모리 MB). 색은 테마 토큰을 탐침 요소로 풀어 읽는다 — `color-mix` 토큰이 있어 변수 글자를 그대로
   * 캔버스에 못 쓴다. 범례는 부르는 쪽이 `oncolors` 로 받은 색으로 그린다.
   */
  import { untrack } from "svelte";
  import type uPlotT from "uplot";
  import { loadUPlot, type UPlot } from "$lib/uplot-loader";
  import { MEM_AXIS_INCRS, SYSTEM_SERIES, formatMemAxis, memAxisSplits, type ResourceChartData } from "$lib/resources";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    data,
    labels,
    unit,
    max = 0,
    format,
    systemToken,
    oncolors,
  }: {
    data: ResourceChartData;
    labels: (key: string) => string;
    unit: "%" | "MB";
    /** y 축 위 끝 고정값(축 단위) — 0 이면 값에 맞춘다 */
    max?: number;
    format: (v: number) => string;
    /** 이 PC 전체 선의 색 — 상태바 호버 카드의 같은 지표 스파크라인과 같은 색으로 맞춘다 */
    systemToken: "--accent" | "--chip-branch";
    oncolors?: (colors: string[]) => void;
  } = $props();

  /** 지표 색 `--accent` · `--chip-branch` 는 이 PC 전체 선의 몫이라 여기에 넣지 않는다 */
  const SERIES_TOKENS = ["--chip-folder", "--chip-tmux", "--chip-jump", "--chip-forward", "--ok", "--err"];

  interface Theme {
    axis: string;
    grid: string;
    font: string;
    colors: string[];
    system: string;
  }

  let wrapEl = $state<HTMLElement | null>(null);
  let plotEl = $state<HTMLElement | null>(null);
  let themeTick = $state(0);
  let lib = $state<UPlot | null>(null);
  let loadError = $state<string | null>(null);
  let size = $state({ w: 0, h: 0 });
  let chart: uPlotT | null = null;

  function withAlpha(color: string, alpha: number): string {
    const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : "transparent";
  }

  function areaFill(color: string): uPlotT.Series.Fill {
    return (u: uPlotT) => {
      const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
      g.addColorStop(0, withAlpha(color, 0.24));
      g.addColorStop(1, withAlpha(color, 0.02));
      return g;
    };
  }

  function readTheme(el: HTMLElement): Theme {
    const probe = document.createElement("span");
    probe.style.display = "none";
    el.appendChild(probe);
    const color = (name: string) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const fontUi = getComputedStyle(el).getPropertyValue("--font-ui").trim() || "sans-serif";
    const out: Theme = {
      axis: color("--fg-2"),
      grid: color("--line-faint"),
      font: `11px ${fontUi}`,
      colors: SERIES_TOKENS.map(color),
      system: color(systemToken),
    };
    probe.remove();
    return out;
  }

  $effect(() => {
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => themeTick++);
    });
    mo.observe(document.documentElement, { attributes: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  });

  $effect(() => {
    loadUPlot().then(
      (u) => (lib = u),
      (e: unknown) => (loadError = e instanceof Error ? e.message : String(e)),
    );
  });

  $effect(() => {
    const el = plotEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      if (w !== size.w || h !== size.h) size = { w, h };
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  function timeText(sec: number): string {
    const d = new Date(sec * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  function tooltipPlugin(keys: string[], cols: string[]): uPlotT.Plugin {
    let tip: HTMLDivElement | null = null;
    return {
      hooks: {
        init: (u) => {
          tip = document.createElement("div");
          tip.className = "r-chart-tip";
          tip.style.display = "none";
          u.over.appendChild(tip);
          u.over.addEventListener("mouseleave", () => tip && (tip.style.display = "none"));
        },
        setCursor: (u) => {
          if (!tip) return;
          const i = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;
          if (i === null || i === undefined || left < 0) {
            tip.style.display = "none";
            return;
          }
          tip.replaceChildren();
          const head = document.createElement("div");
          head.className = "r-chart-tip-x";
          head.textContent = timeText((u.data[0] as number[])[i]);
          tip.appendChild(head);
          keys.forEach((key, k) => {
            const v = (u.data[k + 1] as (number | null)[])[i];
            const row = document.createElement("div");
            row.className = "r-chart-tip-row";
            const dot = document.createElement("span");
            dot.className = "r-chart-tip-dot";
            dot.style.background = cols[k];
            const name = document.createElement("span");
            name.className = "r-chart-tip-name";
            name.textContent = labels(key);
            const val = document.createElement("span");
            val.className = "r-chart-tip-val";
            val.textContent = v === null || v === undefined ? "—" : format(v);
            row.append(dot, name, val);
            tip!.appendChild(row);
          });
          tip.style.display = "block";
          const ow = u.over.clientWidth;
          const oh = u.over.clientHeight;
          const tw = tip.offsetWidth;
          const th = tip.offsetHeight;
          tip.style.left = `${left + 12 + tw > ow ? Math.max(0, left - 12 - tw) : left + 12}px`;
          tip.style.top = `${top + 12 + th > oh ? Math.max(0, top - 12 - th) : top + 12}px`;
        },
      },
    };
  }

  function build(U: UPlot, el: HTMLElement, d: ResourceChartData, w: number, h: number, theme: Theme): uPlotT {
    const keys = d.series.map((s) => s.key);
    const lead = keys[0] === SYSTEM_SERIES ? 1 : 0;
    const cols = keys.map((key, k) => (key === SYSTEM_SERIES ? theme.system : theme.colors[(k - lead) % theme.colors.length]));
    const axis = (): uPlotT.Axis => ({
      stroke: theme.axis,
      font: theme.font,
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.grid, width: 1, size: 4 },
    });
    const yAxis: uPlotT.Axis =
      unit === "%"
        ? { ...axis(), size: 56, values: (_u, splits) => splits.map((v) => `${Math.round(v)}%`) }
        : {
            ...axis(),
            size: 56,
            incrs: MEM_AXIS_INCRS,
            ...(max > 0 ? { splits: (_u: uPlotT, _i: number, _min: number, top: number, incr: number) => memAxisSplits(top, incr) } : {}),
            values: (_u, splits) => splits.map(formatMemAxis),
          };
    const opts: uPlotT.Options = {
      width: w,
      height: h,
      scales: {
        x: { time: true },
        y: {
          range: (_u, _min, top) => [
            0,
            max > 0 ? max : unit === "%" ? Math.max(5, Math.min(100, top * 1.15)) : Math.max(1, top * 1.15),
          ],
        },
      },
      axes: [axis(), yAxis],
      series: [
        {},
        ...keys.map(
          (key, k): uPlotT.Series => ({
            stroke: cols[k],
            fill: areaFill(cols[k]),
            width: 2,
            spanGaps: false,
            points: { show: false },
          }),
        ),
      ],
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 6 } },
      plugins: [tooltipPlugin(keys, cols)],
    };
    oncolors?.(cols);
    return new U(opts, [d.xs, ...d.series.map((s) => s.values)] as uPlotT.AlignedData, el);
  }

  let builtFor: { sig: string; tick: number } | null = null;
  $effect(() => {
    const U = lib;
    const el = plotEl;
    const wrap = wrapEl;
    const d = data;
    const tick = themeTick;
    const { w, h } = size;
    if (!U || !el || !wrap || w < 40 || h < 40 || d.xs.length === 0) {
      chart?.destroy();
      chart = null;
      builtFor = null;
      return;
    }
    // 위 끝 고정 여부도 서명에 든다 — 빼면 전체 메모리가 첫 표본보다 늦게 올 때 눈금 함수가 안 바뀐다
    const sig = `${max > 0}\u0001${d.series.map((s) => s.key).join("\u0001")}`;
    if (chart && builtFor && builtFor.sig === sig && builtFor.tick === tick) {
      if (chart.width !== w || chart.height !== h) chart.setSize({ width: w, height: h });
      chart.setData([d.xs, ...d.series.map((s) => s.values)] as uPlotT.AlignedData);
      return;
    }
    chart?.destroy();
    chart = untrack(() => build(U, el, d, w, h, readTheme(wrap)));
    builtFor = { sig, tick };
  });

  $effect(() => () => {
    chart?.destroy();
    chart = null;
  });
</script>

<div class="r-chart" bind:this={wrapEl}>
  <div class="plot" bind:this={plotEl}></div>
  {#if loadError}
    <p class="empty">{t("board.resources.chartFailed", { reason: loadError })}</p>
  {:else if data.xs.length === 0}
    <p class="empty">{t("board.resources.waiting")}</p>
  {/if}
</div>

<style>
  .r-chart {
    position: relative;
    height: 180px;
  }

  .plot {
    position: absolute;
    inset: 0;
  }

  .plot :global(.uplot) {
    font-family: var(--font-ui);
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font-size: var(--t-sm);
    color: var(--fg-2);
    pointer-events: none;
  }

  /* 크롬 면 위 크롬 글자 — 터미널 면 토큰 금지(conventions) */
  .plot :global(.r-chart-tip) {
    position: absolute;
    z-index: 2;
    min-width: 140px;
    padding: 6px 8px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-modal);
    pointer-events: none;
    white-space: nowrap;
  }

  .plot :global(.r-chart-tip-x) {
    margin-bottom: 4px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .plot :global(.r-chart-tip-row) {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .plot :global(.r-chart-tip-dot) {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .plot :global(.r-chart-tip-name) {
    flex: 1;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plot :global(.r-chart-tip-val) {
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }
</style>
