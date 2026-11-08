<script lang="ts">
  /**
   * **최근 7일 · 모델별 토큰** — 날마다 쌓은 세로 막대 (docs/log/2026-09-26-agent-usage.md "사용량 칸").
   *
   * 일주일 합으로 위 네 모델이 제 조각을 갖고 나머지는 "기타"(회색). 빛깔은 에이전트마다 한 빛깔(Claude 테라코타 ·
   * Codex 거의 흰 회색 — theme.css `--agent-*`)이고 같은 에이전트의 모델은 밝기로 가른다. 아주 작은 날도 보이게
   * 막대에 바닥 높이를 둔다. 막대에 포인터를 얹거나 포커스하면 그날의 모델별 줄이 뜬다. 오늘 열은 글자가 진하다.
   */
  import { formatTokens } from "$lib/agent-usage";
  import { barHeight, monthDay, shortModel, weekdayName, OTHER_KEY, type WeekChart } from "$lib/usage-board";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    chart: WeekChart;
  }
  let { chart }: Props = $props();

  const nameOf = (key: string): string => {
    if (key === OTHER_KEY) return t("board.usage.week.other");
    const s = chart.series.find((x) => x.key === key);
    const short = s ? shortModel(s.model) : "";
    return short === "" ? t("board.usage.model.unknown") : short;
  };
  const colorOf = (key: string): string => chart.series.find((x) => x.key === key)?.color ?? "var(--fg-3)";

  let hover = $state<string | null>(null);
</script>

<div class="week" data-usage-week>
  <div class="bars">
    {#each chart.days as d (d.date)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="col"
        class:today={d.isToday}
        data-week-day={d.date}
        data-total={d.total}
        tabindex="0"
        role="group"
        aria-label={`${monthDay(d.date, locale())} · ${formatTokens(d.total)}`}
        onmouseenter={() => (hover = d.date)}
        onmouseleave={() => (hover = hover === d.date ? null : hover)}
        onfocus={() => (hover = d.date)}
        onblur={() => (hover = hover === d.date ? null : hover)}
      >
        <span class="n">{d.total > 0 ? formatTokens(d.total) : ""}</span>
        <span class="track">
          <span class="stack" style:height="{barHeight(d.total, chart.max)}%">
            {#each d.segs as seg (seg.key)}
              <span class="seg" data-seg={seg.key} style:flex-grow={seg.total} style:background={colorOf(seg.key)}
              ></span>
            {/each}
          </span>
        </span>
        <span class="wd">{weekdayName(d.weekday, locale())}</span>
        {#if hover === d.date && d.total > 0}
          <div class="pop" role="tooltip" data-week-tip>
            <span class="p-head">{monthDay(d.date, locale())} · {formatTokens(d.total)}</span>
            {#each d.segs as seg (seg.key)}
              <span class="p-row"
                ><span class="sw" style:background={colorOf(seg.key)}></span><span class="p-name">{nameOf(seg.key)}</span><span
                  class="p-n">{formatTokens(seg.total)}</span
                ></span
              >
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <ul class="legend">
    {#each chart.series as s (s.key)}
      <li><span class="sw" style:background={s.color}></span>{nameOf(s.key)}</li>
    {/each}
  </ul>
</div>

<style>
  .week {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bars {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-2);
    height: 120px;
  }

  .col {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-end;
    gap: 3px;
    min-width: 0;
    border-radius: var(--radius-sm);
    outline: none;
  }

  .col:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .n {
    font-size: 10px;
    text-align: center;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* 막대가 서는 자리 — 숫자와 요일을 뺀 높이(막대의 % 는 이 높이의 %) */
  .track {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-end;
  }

  /* 쌓은 막대 — 조각은 위에서 아래로 토큰 순(column-reverse 로 큰 것이 바닥) */
  .stack {
    display: flex;
    flex-direction: column-reverse;
    gap: 1px;
    min-height: 0;
    width: 70%;
    margin-inline: auto;
    border-radius: 3px 3px 0 0;
    overflow: hidden;
  }

  .seg {
    display: block;
    flex-basis: 0;
    min-height: 1px;
  }

  .wd {
    font-size: var(--t-xs);
    text-align: center;
    color: var(--fg-3);
  }

  .col.today .wd {
    color: var(--fg-1);
    font-weight: var(--fw-semibold);
  }

  .col.today .stack {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .pop {
    position: absolute;
    z-index: 5;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-raised);
    pointer-events: none;
    white-space: nowrap;
  }

  .p-head {
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .p-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .p-name {
    flex: 1;
    color: var(--fg-2);
  }

  .p-n {
    font-variant-numeric: tabular-nums;
  }

  .sw {
    display: inline-block;
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
