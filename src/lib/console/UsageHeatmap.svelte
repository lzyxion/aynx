<script lang="ts">
  /**
   * **사용 잔디** — 최근 다섯 주를 **달력처럼**: 칸 = 요일(일~토, 위에 요일 이름), 줄 = 주(위가 오래된 주, 마지막 줄이
   * 이번 주) (docs/log/2026-09-26-agent-usage.md "넷째 판").
   *
   * 셋째 판은 GitHub 잔디처럼 요일을 줄로 세웠는데, 다섯 열에 일곱 줄이라 카드가 옆 카드(고른 날)의 두 배로 길어지고
   * 옆은 비었다(실기). 달력 모양이면 일곱 칸이 카드 폭을 나눠 갖고 높이는 다섯 줄(칸 높이 28px)이라 옆 카드와 키가 맞는다.
   *
   * 규칙은 token-chan 그대로: 단계 = 보이는 날(기록이 시작된 뒤)의 0 아닌 값의 **사분위**, 기록이 시작되기 전 칸은 "안 씀"
   * 이 아니라 "기록 없음" 이라 투명 + 점선. 빛깔은 `--ok` 초록 다섯 단계. 칸 안 왼쪽 위에 그달의 며칠을 작게(밝은 두 단계에서는
   * 카드 바탕색 글자로 — 대비). 이번 주의 오늘 뒤는 칸이 아니라 빈 자리다. 보이는 달 이름("8월 · 9월")은 카드 머리가 든다.
   *
   * 칸을 누르면 그날을 고른다(테두리) — 옆 카드가 그날의 풀이를 보인다. 키보드: 고른 칸 하나만 Tab 에 서고(로빙)
   * ←→ 하루 · ↑↓ 한 주(축이 바뀌어 셋째 판과 뒤집혔다). 규칙은 순수 층 `$lib/usage-board`.
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

  /** 고를 수 있는 날(기록이 시작된 뒤) — 키보드가 이 차례로 옮긴다(달력 줄 순서 = 날짜 순서) */
  const pickable = $derived(heat.rows.flat().filter((c) => c !== null && !c.pre).map((c) => c!.date));
  /** Tab 이 서는 칸 — 고른 날이 격자 밖이면 마지막 칸 */
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

  /* 요일 이름 줄과 칸 — 같은 일곱 칸(카드 폭을 나눠 갖는다) */
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

  /* 칸 높이는 고정(28px) — 다섯 줄이 옆 카드(고른 날)의 키와 맞는다(1920px 에서 잰 값은 로그) */
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

  /* 이번 주의 오늘 뒤 — 칸이 아니라 빈 자리 */
  .cell.slot {
    background: transparent;
  }

  /* 기록이 시작되기 전 — 비어 있되 "안 씀" 과 다른 모양 */
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

  /* 그달의 며칠 — 왼쪽 위에 작게. 밝은 두 단계는 카드 바탕색 글자(어두운 테마 = 짙은 글자 · 밝은 테마 = 흰 글자) */
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
