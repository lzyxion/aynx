<script lang="ts" module>
  import type { DbQueryResult } from "./query-backend";
  import type { ChartPick } from "./chart-model";

  /** 결과마다 기억한다 — 저장하지 않는다 */
  const chosenPick = new WeakMap<DbQueryResult, ChartPick>();

  /** 열 이름 묶음 `cols` 가 같은 결과에만 쓴다 */
  export interface KeptPick {
    cols: string;
    pick: ChartPick;
  }

  /** 열 번호로 기억한 축이 같은 열을 가리키는지의 근거 */
  export function columnsKey(result: DbQueryResult): string {
    return JSON.stringify(result.columns.map((c) => c.name));
  }
</script>

<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type uPlotT from "uplot";
  import Dropdown from "$lib/Dropdown.svelte";
  import MultiDropdown from "$lib/MultiDropdown.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { loadUPlot, type UPlot } from "$lib/uplot-loader";
  import {
    allowedKinds,
    barLayout,
    buildSeries,
    defaultPick,
    formatNumber,
    formatX,
    MAX_Y,
    normalizePick,
    ROW_AXIS,
    xCandidates,
    xKindOf,
    yCandidates,
    type ChartKind,
    type ChartSeries,
    type ColClass,
  } from "./chart-model";

  /**
   * 쿼리 결과 차트(uPlot). 테마 토큰은 탐침 요소의 계산된 색으로 풀어 읽는다 — `color-mix` 가 든 토큰은 캔버스에 글자째 넘기지 못한다.
   * 범례는 uPlot 것을 끄고 여기서 그린다(테마 · 키보드).
   */
  let {
    result,
    classes,
    lead,
    kept = $bindable(),
  }: {
    result: DbQueryResult;
    /** `chart-model.classifyColumns(result)` — 부르는 쪽이 이미 지었다 */
    classes: ColClass[];
    lead?: Snippet;
    /** 묶으면 결과가 바뀌어도 고른 축 · 종류가 남는다 — 열 이름 묶음이 다르면 기본 축 */
    kept?: KeptPick;
  } = $props();

  // 처음 값만 — 결과가 바뀌면 부르는 쪽이 `{#key}` 로 새로 만든다
  // svelte-ignore state_referenced_locally
  const colsKey = columnsKey(result);
  // svelte-ignore state_referenced_locally
  let pick = $state<ChartPick>(
    chosenPick.get(result) ?? (kept?.cols === colsKey ? normalizePick(kept.pick, classes) : defaultPick(classes)),
  );

  function setPick(p: ChartPick) {
    const next = normalizePick(p, classes);
    // 숨긴 시리즈는 Y 자리 번호로 기억한다 — Y 가 바뀌면 번호가 어긋나므로 걷는다
    if (next.ys.join() !== pick.ys.join()) hidden = new Set();
    pick = next;
    chosenPick.set(result, pick);
    kept = { cols: colsKey, pick };
  }

  const columns = $derived(result.columns);
  const xk = $derived(xKindOf(pick.x, classes));
  const kinds = $derived(allowedKinds(xk));
  const series = $derived<ChartSeries>(buildSeries(result, classes, pick));

  const xOptions = $derived([
    { value: String(ROW_AXIS), label: t("pane.query.chart.rowOrder") },
    ...xCandidates(classes).map((i) => ({ value: String(i), label: columns[i]?.name || `#${i + 1}` })),
  ]);
  const yOptions = $derived.by(() => {
    const full = pick.ys.length >= MAX_Y;
    return yCandidates(classes, pick.x).map((i) => ({
      value: String(i),
      label: columns[i]?.name || `#${i + 1}`,
      disabled: full && !pick.ys.includes(i),
    }));
  });

  const KINDS: { kind: ChartKind; icon: string; key: Key }[] = [
    { kind: "line", icon: "chart-line", key: "pane.query.chart.kind.line" },
    { kind: "bar", icon: "chart-column", key: "pane.query.chart.kind.bar" },
    { kind: "scatter", icon: "chart-scatter", key: "pane.query.chart.kind.scatter" },
  ];

  // ── 테마 ────────────────────────────────────────────────────────────────
  /** Y 상한(`MAX_Y`)과 같은 길이 */
  const SERIES_TOKENS = ["--accent", "--chip-branch", "--chip-tmux", "--chip-folder", "--chip-forward", "--chip-jump", "--ok", "--err"];

  interface Theme {
    fg: string;
    axis: string;
    grid: string;
    font: string;
    colors: string[];
  }

  let wrapEl = $state<HTMLElement | null>(null);
  let themeTick = $state(0);

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
      fg: color("--fg-1"),
      axis: color("--fg-2"),
      grid: color("--line-faint"),
      font: `11px ${fontUi}`,
      colors: SERIES_TOKENS.map(color),
    };
    probe.remove();
    return out;
  }

  function withAlpha(c: string, a: number): string {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
    return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : c;
  }

  // 밝기 · 프로필 · 강조색은 모두 `<html>` 의 속성(`data-theme` · 인라인 `style`)으로 온다
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

  // ── uPlot ───────────────────────────────────────────────────────────────
  let lib = $state<UPlot | null>(null);
  let loadError = $state<string | null>(null);
  let plotEl = $state<HTMLElement | null>(null);
  let size = $state({ w: 0, h: 0 });
  let hidden = $state<Set<number>>(new Set());
  let chart: uPlotT | null = null;
  let colors = $state<string[]>([]);

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

  /** 라벨 폭으로 솎는다 — 다 적으면 겹친다 */
  function categorySplits(labels: string[], plotW: number) {
    const longest = Math.min(16, labels.reduce((m, s) => Math.max(m, s.length), 1));
    const step = Math.max(1, Math.ceil((labels.length * (longest * 7 + 16)) / Math.max(1, plotW)));
    return (_u: uPlotT, _axis: number, min: number, max: number) => {
      const out: number[] = [];
      for (let i = Math.max(0, Math.ceil(min)); i <= Math.min(labels.length - 1, Math.floor(max)); i += step) out.push(i);
      return out;
    };
  }

  function shortLabel(s: string): string {
    return s.length > 16 ? s.slice(0, 15) + "…" : s;
  }

  function tooltipPlugin(s: ChartSeries, names: string[], cols: string[]): uPlotT.Plugin {
    let tip: HTMLDivElement | null = null;
    return {
      hooks: {
        init: (u) => {
          tip = document.createElement("div");
          tip.className = "q-chart-tip";
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
          head.className = "q-chart-tip-x";
          head.textContent = formatX(s, s.xs[i]);
          tip.appendChild(head);
          names.forEach((name, k) => {
            if (!u.series[k + 1]?.show) return;
            const row = document.createElement("div");
            row.className = "q-chart-tip-row";
            const dot = document.createElement("span");
            dot.className = "q-chart-tip-dot";
            dot.style.background = cols[k];
            const label = document.createElement("span");
            label.className = "q-chart-tip-name";
            label.textContent = name;
            const val = document.createElement("span");
            val.className = "q-chart-tip-val";
            val.textContent = formatNumber(s.ys[k][i]);
            row.append(dot, label, val);
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

  function build(U: UPlot, el: HTMLElement, s: ChartSeries, kind: ChartKind, w: number, h: number, theme: Theme): uPlotT {
    const names = pick.ys.map((i) => columns[i]?.name || `#${i + 1}`);
    const cols = names.map((_, k) => theme.colors[k % theme.colors.length]);
    const bar = kind === "bar";
    const layout = bar ? barLayout(s.xs, names.length, s.xKind) : null;
    const discrete = s.xKind === "category" || s.xKind === "row";

    const axis = (): uPlotT.Axis => ({
      stroke: theme.axis,
      font: theme.font,
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.grid, width: 1, size: 4 },
    });
    const xAxis: uPlotT.Axis = axis();
    if (s.xKind === "category" && s.labels) {
      const labels = s.labels;
      xAxis.splits = categorySplits(labels, w - 60);
      xAxis.values = (_u, splits) => splits.map((v) => shortLabel(labels[v] ?? ""));
    } else if (s.xKind === "row") {
      xAxis.values = (_u, splits) => splits.map((v) => (Number.isInteger(v) ? String(v) : ""));
    }
    const yAxis: uPlotT.Axis = { ...axis(), size: 56 };

    // 끝 막대가 잘리지 않게 반 칸씩 넓힌다 — 끌어서 확대한 범위는 그대로 둔다
    const lo = s.xs[0];
    const hi = s.xs[s.xs.length - 1];
    const pad = layout ? layout.colW / 2 : 0.5;
    const xRange: uPlotT.Scale.Range | undefined =
      layout || discrete ? (_u, min, max) => (min === lo && max === hi ? [lo - pad, hi + pad] : [min, max]) : undefined;

    const seriesOpts: uPlotT.Series[] = [
      {},
      ...names.map((label, k): uPlotT.Series => {
        const c = cols[k];
        const base: uPlotT.Series = { label, stroke: c, show: !hidden.has(k), spanGaps: false };
        if (bar && layout) {
          return {
            ...base,
            width: 0,
            fill: withAlpha(c, 0.8),
            points: { show: false },
            paths: U.paths.bars!({
              disp: {
                x0: { unit: 1, values: (u: uPlotT) => (u.data[0] as number[]).map((x) => x + layout.offsets[k]) },
                size: { unit: 1, values: () => [layout.width] },
              },
            }),
          };
        }
        if (kind === "scatter") {
          return { ...base, width: 0, paths: () => null, points: { show: true, size: 5, width: 1, stroke: c, fill: withAlpha(c, 0.55) } };
        }
        return { ...base, width: 1.5, points: { show: s.xs.length <= 60, size: 4, fill: c, stroke: c } };
      }),
    ];

    const opts: uPlotT.Options = {
      width: w,
      height: h,
      // UTC 여야 한다 — `parseTemporal` 이 시간대 없는 글자를 그대로 UTC 로 읽었다
      tzDate: (ts) => U.tzDate(new Date(ts * 1000), "Etc/UTC"),
      scales: {
        x: { time: s.xKind === "temporal", range: xRange },
        y: bar
          ? { range: (_u, min, max) => U.rangeNum(Math.min(0, min), Math.max(0, max), 0.1, true) }
          : {},
      },
      axes: [xAxis, yAxis],
      series: seriesOpts,
      legend: { show: false },
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      plugins: [tooltipPlugin(s, names, cols)],
    };
    colors = cols;
    return new U(opts, [s.xs, ...s.ys] as uPlotT.AlignedData, el);
  }

  let builtFor: { s: ChartSeries; kind: ChartKind; tick: number } | null = null;
  $effect(() => {
    const U = lib;
    const el = plotEl;
    const s = series;
    const kind = pick.kind;
    const tick = themeTick;
    const { w, h } = size;
    const wrap = wrapEl;
    if (!U || !el || !wrap || w < 40 || h < 40 || pick.ys.length === 0 || s.xs.length === 0) {
      chart?.destroy();
      chart = null;
      builtFor = null;
      return;
    }
    if (chart && builtFor && builtFor.s === s && builtFor.kind === kind && builtFor.tick === tick) {
      chart.setSize({ width: w, height: h });
      return;
    }
    chart?.destroy();
    // 숨긴 시리즈는 짓는 순간의 값만 — 범례 단추는 다시 짓지 않고 `setSeries` 로
    chart = untrack(() => build(U, el, s, kind, w, h, readTheme(wrap)));
    builtFor = { s, kind, tick };
  });

  $effect(() => () => {
    chart?.destroy();
    chart = null;
  });

  function toggleSeries(k: number) {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    hidden = next;
    chart?.setSeries(k + 1, { show: !next.has(k) });
  }

  const empty = $derived(
    loadError
      ? t("pane.query.chart.loadFailed", { reason: loadError })
      : pick.ys.length === 0
        ? t("pane.query.chart.noY")
        : series.xs.length === 0
          ? t("pane.query.chart.noPoints")
          : !lib
            ? t("pane.query.chart.loading")
            : null,
  );
</script>

<div class="chart" bind:this={wrapEl} data-query-chart>
  <div class="ctl">
    {#if lead}{@render lead()}{/if}
    <span class="field x" data-query-chart-x>
      <span class="flabel">{t("pane.query.chart.x")}</span>
      <Dropdown
        value={String(pick.x)}
        options={xOptions}
        ariaLabel={t("pane.query.chart.x")}
        onchange={(v) => setPick({ ...pick, x: Number(v), ys: pick.ys.filter((i) => i !== Number(v)) })}
      />
    </span>
    <span class="field y" data-query-chart-y>
      <span class="flabel">{t("pane.query.chart.y")}</span>
      <MultiDropdown
        values={pick.ys.map(String)}
        options={yOptions}
        placeholder={t("pane.query.chart.y.none")}
        placeholderMany={(n) => t("pane.query.chart.y.many", { n })}
        ariaLabel={t("pane.query.chart.y")}
        onchange={(vs) => setPick({ ...pick, ys: vs.map(Number) })}
      />
    </span>
    <span class="kinds" role="group" aria-label={t("pane.query.chart.kind")}>
      {#each KINDS as k (k.kind)}
        {@const ok = kinds.includes(k.kind)}
        <button
          type="button"
          class="kbtn"
          aria-pressed={pick.kind === k.kind}
          disabled={!ok}
          title={ok ? t(k.key) : t("pane.query.chart.kind.scatterOff")}
          onclick={() => setPick({ ...pick, kind: k.kind })}
          data-query-chart-kind={k.kind}><UiIcon name={k.icon} size={12} /><span class="klabel">{t(k.key)}</span></button
        >
      {/each}
    </span>
  </div>

  {#if result.truncated || series.dropped > 0}
    <div class="notes">
      {#if result.truncated}<span class="warn" data-query-chart-truncated>{t("pane.query.chart.truncated", { n: result.rows.length })}</span>{/if}
      {#if series.dropped > 0}<span>{t("pane.query.chart.dropped", { n: series.dropped })}</span>{/if}
    </div>
  {/if}

  {#if pick.ys.length > 0 && colors.length > 0 && !empty}
    <div class="legend" role="group" aria-label={t("pane.query.chart.legend")}>
      {#each pick.ys as i, k (i)}
        <button
          type="button"
          class="lg"
          class:off={hidden.has(k)}
          aria-pressed={!hidden.has(k)}
          title={t("pane.query.chart.legend.toggle")}
          onclick={() => toggleSeries(k)}
          ><span class="lg-dot" style:background={colors[k]}></span><span class="lg-name">{columns[i]?.name || `#${i + 1}`}</span></button
        >
      {/each}
    </div>
  {/if}

  <div class="plot" role="img" aria-label={t("pane.query.chart.aria")} bind:this={plotEl}>
    {#if empty}<p class="empty" data-query-chart-empty>{empty}</p>{/if}
  </div>
</div>

<style>
  .chart {
    container: qchart / inline-size;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .ctl {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    color: var(--fg-2);
  }

  .field {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .field.x {
    width: 180px;
  }

  .field.y {
    width: 220px;
  }

  .flabel {
    flex: 0 0 auto;
    color: var(--fg-3);
  }

  .field :global(.dd) {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* 폼 높이(28px)의 손잡이를 이 줄에 맞춰 줄인다 — `RowLimit` 과 같은 치수 */
  .field :global(.trigger) {
    height: 22px;
    font-size: 11px;
  }

  .kinds {
    display: inline-flex;
    gap: 2px;
  }

  .kbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
  }

  .kbtn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .kbtn[aria-pressed="true"] {
    color: var(--fg);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .kbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .kbtn:focus-visible,
  .lg:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: 1px;
  }

  @container qchart (max-width: 520px) {
    .klabel {
      display: none;
    }

    .field.x,
    .field.y {
      width: 150px;
    }
  }

  .notes {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    padding: 3px 8px 0;
    font-size: 11px;
    color: var(--fg-2);
  }

  .warn {
    color: var(--warn);
  }

  .legend {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 4px;
    padding: 4px 8px 0;
  }

  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 200px;
    padding: 1px 6px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .lg:hover {
    background: var(--bg-hover);
  }

  .lg.off {
    color: var(--fg-3);
  }

  .lg.off .lg-dot {
    opacity: 0.3;
  }

  .lg-dot {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }

  .lg-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plot {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    margin: 4px 4px 2px;
  }

  .plot :global(.uplot) {
    position: absolute;
    inset: 0;
    font-family: var(--font-ui);
  }

  .plot :global(.u-select) {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .plot :global(.q-chart-tip) {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    min-width: 120px;
    max-width: 280px;
    padding: 5px 8px;
    font-size: 11px;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }

  .plot :global(.q-chart-tip-x) {
    margin-bottom: 3px;
    color: var(--fg);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plot :global(.q-chart-tip-row) {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .plot :global(.q-chart-tip-dot) {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .plot :global(.q-chart-tip-name) {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .plot :global(.q-chart-tip-val) {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-2);
  }
</style>
