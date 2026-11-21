<script lang="ts">
  /**
   * 사용 잔디 — 최근 다섯 주를 달력처럼(칸 = 요일, 줄 = 주). GitHub 식(요일 = 줄)은 일곱 줄이라 옆 카드보다 두 배 길어져 걷었다.
   */
  import { tick } from "svelte";
  import { formatTokens } from "$lib/agent-usage";
  import { HEAT_LEVELS, moveDate, weekdayName, type Heatmap } from "$lib/usage-board";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    heat: Heatmap;
    selected: string;
    onpick: (date: string) => void;
  }
  let { heat, selected, onpick }: Props = $props();

  const pickable = $derived(heat.rows.flat().filter((c) => c !== null && !c.pre).map((c) => c!.date));
  const tabDate = $derived(pickable.includes(selected) ? selected : (pickable.at(-1) ?? ""));

  let gridEl = $state<HTMLElement | null>(null);

  async function onKey(ev: KeyboardEvent): Promise<void> {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) return;
    ev.preventDefault();
    const next = moveDate(pickable, tabDate, ev.key);
    onpick(next);
    await tick();
    gridEl?.querySelector<HTMLElement>(`[data-heat-date="${next}"]`)?.focus();
  }

  function cellTip(date: string, total: number, pre: boolean): string {
    return pre || total <= 0 ? t("board.usage.heat.none", { date }) : t("board.usage.heat.cell", { date, n: formatTokens(total) });
  }

  const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
</script>

<div class="heat" data-usage-heat>
  <div class="wdays" aria-hidden="true">
    {#each WEEKDAYS as w (w)}
      <span class="wday">{weekdayName(w, locale())}</span>
    {/each}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="grid" role="group" aria-label={t("board.usage.heat.aria")} bind:this={gridEl} onkeydown={onKey}>
    {#each heat.rows as row, ri (ri)}
      {#each row as c, ci (c?.date ?? `slot${ri}-${ci}`)}
        {#if c === null}
          <span class="cell slot" aria-hidden="true"></span>
        {:else if c.pre}
          <span class="cell pre" data-heat-pre title={cellTip(c.date, 0, true)}><span class="dom">{c.day}</span></span>
        {:else}
          <button
            type="button"
            class="cell lv{c.level}"
            class:on={c.date === selected}
            data-heat-date={c.date}
            data-level={c.level}
            tabindex={c.date === tabDate ? 0 : -1}
            aria-pressed={c.date === selected}
            aria-label={cellTip(c.date, c.total, false)}
            title={cellTip(c.date, c.total, false)}
            onclick={() => onpick(c.date)}><span class="dom">{c.day}</span></button
          >
        {/if}
      {/each}
    {/each}
  </div>
  <div class="legend">
    <span data-heat-recorded
      >{heat.recorded < heat.days
        ? t("board.usage.heat.recorded", { r: heat.recorded, d: heat.days })
        : t("board.usage.heat.days", { d: heat.days })}</span
    >
    <span class="scale" aria-hidden="true">
      {t("board.usage.heat.less")}
      {#each Array.from({ length: HEAT_LEVELS + 1 }, (_, i) => i) as i (i)}
        <span class="cell lv{i} sample"></span>
      {/each}
      {t("board.usage.heat.more")}
    </span>
  </div>
</div>

<style>
  .heat {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .wdays,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }

  .wday {
    font-size: var(--t-xs);
    color: var(--fg-3);
    text-align: center;
  }

  /* 다섯 줄이 옆 카드(고른 날)의 키와 맞는 높이 */
  .grid {
    grid-auto-rows: 28px;
  }

  .cell {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: color-mix(in srgb, var(--ok) 5%, transparent);
  }

  button.cell {
    cursor: pointer;
  }

  .cell.slot {
    background: transparent;
  }

  /* 기록이 시작되기 전 — "안 씀" 과 다른 모양 */
  .cell.pre {
    background: transparent;
    outline: 1px dashed var(--line);
    outline-offset: -1px;
  }

  .cell.lv1 {
    background: color-mix(in srgb, var(--ok) 26%, transparent);
  }
  .cell.lv2 {
    background: color-mix(in srgb, var(--ok) 48%, transparent);
  }
  .cell.lv3 {
    background: color-mix(in srgb, var(--ok) 72%, transparent);
  }
  .cell.lv4 {
    background: var(--ok);
  }

  .dom {
    position: absolute;
    top: 3px;
    left: 5px;
    font-size: 10px;
    line-height: 1;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .cell.lv2 .dom {
    color: var(--fg-2);
  }
  .cell.lv3 .dom,
  .cell.lv4 .dom {
    color: var(--surface-raised-solid);
  }

  .cell.on {
    outline: 1.5px solid var(--fg-1);
    outline-offset: 1px;
  }

  button.cell:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .legend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .scale {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .cell.sample {
    width: 10px;
    height: 10px;
  }
</style>
