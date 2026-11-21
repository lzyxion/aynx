<script lang="ts" generics="S extends string">
  /**
   * AI 권한 고르개 — 누르면 `onpick` 만 올린다. 확인 상자(YOLO) · 저장 · 원격 웹 재확인은 부르는 쪽에 둔다.
   * `data-gauge-stop` 은 팝오버의 ↑↓ 가 이 고르개를 줄 하나로 세는 손잡이다.
   */
  import { tick } from "svelte";
  import { GAUGE_SEGMENTS, gaugeIndex, gaugeKeyStep, gaugeTone, segmentShape } from "$lib/ai-gauge";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    levels,
    value,
    nameOf,
    descOf,
    title = "",
    labelledby,
    label,
    compact = false,
    itemAttr = "stage",
    onpick,
    ...rest
  }: {
    /** 낮은 것부터 — 0 = 끔 */
    levels: readonly S[];
    /** `null` = 어느 자리도 고르지 않음(DB 연결의 대상이 바뀌어 풀림) */
    value: S | null;
    nameOf: (s: S) => string;
    descOf: (s: S) => string;
    title?: string;
    labelledby?: string;
    label?: string;
    compact?: boolean;
    /** 단추의 `data-*` 손잡이 이름 */
    itemAttr?: "stage" | "level";
    onpick: (s: S) => void;
    [key: `data-${string}`]: unknown;
  } = $props();

  const at = $derived(gaugeIndex(levels, value));
  const tone = $derived(gaugeTone(at));
  const yolo = $derived(at === GAUGE_SEGMENTS);

  let group = $state<HTMLElement | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  // 포커스가 이 묶음 안에 있을 때만 옮긴다 — 확인 상자가 포커스를 가져갔으면 손대지 않는다
  $effect(() => {
    const i = at;
    const g = group;
    if (!g || i < 0) return;
    void tick().then(() => {
      if (g.contains(document.activeElement) && document.activeElement !== buttons[i]) buttons[i]?.focus();
    });
  });

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    ev.stopPropagation();
    const next = gaugeKeyStep(at, ev.key, levels.length);
    if (next !== null) onpick(levels[next]);
  }
</script>

<div class="gauge" class:compact class:yolo data-ai-tone={tone} data-ai-gauge {...rest}>
  <div class="head">
    {#if title}<span class="title">{title}</span>{/if}
    <span class="now" class:badge={yolo} data-ai-gauge-now>{value === null ? t("app.ai.gauge.none") : nameOf(value)}</span>
  </div>

  <div
    class="track"
    role="radiogroup"
    aria-labelledby={labelledby}
    aria-label={labelledby ? undefined : label}
    tabindex="-1"
    bind:this={group}
    onkeydown={onKey}
  >
    {#each levels as lv, i (lv)}
      {@const on = i === at}
      <button
        type="button"
        role="radio"
        class="lv"
        class:off={i === 0}
        class:on
        aria-checked={on}
        aria-label={nameOf(lv)}
        title={descOf(lv)}
        tabindex={on || (at < 0 && i === 0) ? 0 : -1}
        data-gauge-stop={on || (at < 0 && i === 0) ? "" : undefined}
        {...{ [`data-${itemAttr}`]: lv }}
        bind:this={buttons[i]}
        onclick={() => {
          if (!on) onpick(lv);
        }}
      >
        <span class="mark" aria-hidden="true">
          {#if i === 0}
            <span class="ring" class:on></span>
          {:else}
            <span class="seg" class:filled={at >= i} data-shape={segmentShape(i)}></span>
          {/if}
        </span>
        <span class="tick" aria-hidden="true">{nameOf(lv)}</span>
      </button>
    {/each}
  </div>

  {#if value !== null}
    <p class="desc" data-ai-gauge-desc>{descOf(value)}</p>
  {/if}
</div>

<style>
  .gauge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }

  .gauge.yolo {
    border-color: var(--ai-all-line);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }

  .title {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .now {
    margin-left: auto;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--ai-c);
  }

  .now.badge {
    padding: 0 6px;
    border-radius: 4px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--on-ai-lv4);
    background: var(--ai-lv4);
  }

  .track {
    display: grid;
    grid-template-columns: 48px repeat(4, minmax(0, 1fr));
    gap: 6px;
    outline: none;
  }

  .lv {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    min-height: 44px;
    padding: 0;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .lv:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .mark {
    display: flex;
    align-items: center;
    height: 28px;
  }

  .seg {
    display: block;
    width: 100%;
    height: 12px;
    border-radius: 4px;
    background: var(--ai-track);
    transition: background-color 120ms ease;
  }

  .seg[data-shape="start"] {
    border-radius: 999px 4px 4px 999px;
  }

  .seg[data-shape="end"] {
    border-radius: 4px 999px 999px 4px;
  }

  .seg.filled {
    background: var(--ai-c);
  }

  .lv:hover .seg:not(.filled) {
    background: color-mix(in srgb, var(--ai-c) 30%, var(--ai-track));
  }

  .ring {
    display: block;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid var(--ai-ring);
  }

  .lv:hover .ring,
  .ring.on {
    border-color: var(--ai-lv0);
  }

  .ring.on {
    background: color-mix(in srgb, var(--ai-lv0) 35%, transparent);
  }

  .tick {
    padding-bottom: 2px;
    font-size: var(--t-xs);
    font-weight: 500;
    line-height: 1.3;
    text-align: center;
    word-break: keep-all;
  }

  .lv.off .tick {
    text-align: left;
  }

  .lv:hover .tick {
    color: var(--fg-1);
  }

  .lv.on .tick {
    font-weight: 700;
    color: var(--ai-c);
  }

  .desc {
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-1);
    background: var(--surface-field-solid);
    word-break: keep-all;
  }

  .yolo .desc {
    background: var(--ai-all-soft);
  }

  /* 상자는 칩 팝오버가 그린다 */
  .compact {
    gap: var(--space-1);
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  .compact .now {
    font-size: var(--t-xs);
  }

  .compact .track {
    grid-template-columns: 30px repeat(4, minmax(0, 1fr));
    gap: 4px;
  }

  .compact .lv {
    min-height: 32px;
  }

  .compact .mark {
    height: 18px;
  }

  .compact .seg {
    height: 8px;
    border-radius: 3px;
  }

  .compact .seg[data-shape="start"] {
    border-radius: 999px 3px 3px 999px;
  }

  .compact .seg[data-shape="end"] {
    border-radius: 3px 999px 999px 3px;
  }

  .compact .ring {
    width: 10px;
    height: 10px;
  }

  .compact .tick {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact .desc {
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--fg-2);
  }

  .compact.yolo .desc {
    background: transparent;
    color: color-mix(in srgb, var(--ai-lv4) 60%, var(--fg-1));
  }

  @media (pointer: coarse) {
    .compact .lv {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
