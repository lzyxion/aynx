<script lang="ts">
  /** `noDefault`(AI 타일 대화 면) — 그 CLI 의 `/effort` 에는 "기본" 이 없어 왼쪽 Default 고리를 세우지 않는다 */
  import { tick } from "svelte";
  import { gaugeKeyStep } from "$lib/ai-gauge";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    levels,
    value,
    nameOf,
    touch = false,
    noDefault = false,
    onpick,
  }: {
    /** 낮은 것부터 · "Default" 는 빼고 */
    levels: readonly string[];
    /** `""` = Default */
    value: string;
    nameOf: (effort: string) => string;
    touch?: boolean;
    noDefault?: boolean;
    onpick: (effort: string) => void;
  } = $props();

  /** 0 = Default · `noDefault` 면 0 부터 단계이고 모르면 -1 */
  const stops = $derived(noDefault ? [...levels] : ["", ...levels]);
  const at = $derived(noDefault ? stops.indexOf(value) : Math.max(0, stops.indexOf(value)));
  const ring = $derived(!noDefault);
  const labelId = `effort-${Math.random().toString(36).slice(2, 8)}`;

  let group = $state<HTMLElement | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  $effect(() => {
    const i = at;
    const g = group;
    if (!g) return;
    void tick().then(() => {
      if (g.contains(document.activeElement) && document.activeElement !== buttons[i]) buttons[i]?.focus();
    });
  });

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    ev.stopPropagation();
    const next = gaugeKeyStep(at, ev.key, stops.length);
    if (next !== null && next !== at) onpick(stops[next]);
  }

  function shape(i: number): "start" | "mid" | "end" | "only" {
    if (levels.length === 1) return "only";
    const li = ring ? i - 1 : i;
    return li === 0 ? "start" : li === levels.length - 1 ? "end" : "mid";
  }
</script>

<div class="eg" class:touch data-chat-effort-gauge>
  <div class="head">
    <span class="title" id={labelId}>{t("app.chatDock.effort.menu")}</span>
    <span class="now" data-chat-effort-now>{nameOf(value)}</span>
  </div>
  <div
    class="track"
    class:no-def={!ring}
    style:--eg-n={levels.length}
    role="radiogroup"
    aria-labelledby={labelId}
    tabindex="-1"
    bind:this={group}
    onkeydown={onKey}
  >
    {#each stops as lv, i (lv)}
      {@const on = i === at}
      <button
        type="button"
        role="radio"
        class="lv"
        class:def={ring && i === 0}
        class:on
        aria-checked={on}
        aria-label={nameOf(lv)}
        title={nameOf(lv)}
        tabindex={on || (at < 0 && i === 0) ? 0 : -1}
        data-chat-effort={lv}
        bind:this={buttons[i]}
        onclick={() => {
          if (!on) onpick(lv);
        }}
      >
        <span class="mark" aria-hidden="true">
          {#if ring && i === 0}
            <span class="ring" class:on></span>
          {:else}
            <span class="seg" class:filled={at >= i} class:on data-shape={shape(i)}></span>
          {/if}
        </span>
        <span class="tick" aria-hidden="true">{nameOf(lv)}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .eg {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-2);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 2px var(--space-1) 0;
  }

  .title {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .now {
    margin-left: auto;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--control-sel-fg);
  }

  .track {
    display: grid;
    grid-template-columns: 44px repeat(var(--eg-n), minmax(0, 1fr));
    gap: 4px;
    outline: none;
  }

  .track.no-def {
    grid-template-columns: repeat(var(--eg-n), minmax(0, 1fr));
  }

  .lv {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    min-height: 36px;
    padding: 0;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .eg.touch .lv {
    min-height: 44px;
  }

  .lv:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .mark {
    display: flex;
    align-items: center;
    height: 20px;
  }

  .seg {
    display: block;
    width: 100%;
    height: 8px;
    border-radius: 2px;
    background: var(--control-track);
    transition: background-color 120ms ease;
  }

  .seg[data-shape="start"] {
    border-radius: 999px 2px 2px 999px;
  }

  .seg[data-shape="end"] {
    border-radius: 2px 999px 999px 2px;
  }

  .seg[data-shape="only"] {
    border-radius: 999px;
  }

  .seg.filled {
    background: var(--control-on-bg);
  }

  .seg.on {
    outline: 1.5px solid var(--fg-1);
    outline-offset: 2px;
  }

  .lv:hover .seg:not(.filled) {
    background: color-mix(in srgb, var(--control-on-bg) 30%, var(--control-track));
  }

  .ring {
    display: block;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid var(--line-strong);
  }

  .lv:hover .ring,
  .ring.on {
    border-color: var(--control-on-bg);
  }

  .ring.on {
    background: color-mix(in srgb, var(--control-on-bg) 35%, transparent);
  }

  .tick {
    overflow: hidden;
    font-size: 10px;
    line-height: 1.3;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lv.def .tick {
    text-align: left;
  }

  .lv:hover .tick {
    color: var(--fg-1);
  }

  /* 굵게 하지 않는다 — 칸이 여섯일 때 "Medium" 이 넓어져 말줄임으로 잘린다 */
  .lv.on .tick {
    color: var(--fg-1);
  }

  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
