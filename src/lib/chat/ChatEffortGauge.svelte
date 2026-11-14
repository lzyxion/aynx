<script lang="ts">
  /**
   * **추론 강도 가로 게이지**(2026-11-13 — 사이드 채팅 모델 메뉴 · 목업 D2) — AI 권한 게이지(`AiGauge`)와 같은 손: 왼쪽 작은 고리 = "Default"
   * (CLI 가 정한다), 오른쪽 같은 폭 칸 = 강도 단계(낮은 것부터 — 수 · 이름은 부르는 쪽이 준다: CLI · 모델마다 다르다). 지금 단계까지 차고
   * (`--control-on-bg`), 고른 칸에 고리 표시 · 그 아래 이름이 굵다. 위 오른쪽에 지금 이름.
   *
   * 자리 하나 = 단추 하나(`role="radio"` — 칸과 그 아래 이름이 한 단추). 묶음은 `radiogroup`, ←→ 로 고른다(끝에서 돌지 않는다 —
   * `gaugeKeyStep`) · Tab 에는 고른 단추 하나만 걸린다. 고르는 규칙은 모른다 — `onpick(강도)` 만 올린다.
   *
   * `noDefault`(AI 타일 대화 면의 모델 메뉴 — 목업 E3): 왼쪽 "Default" 고리가 없고 단계 칸만 선다(그 CLI 의 `/effort` 에 "기본" 이 없다).
   * 지금 값이 단계 밖이면(모름) 아무 칸도 고르지 않은 채다.
   */
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
    /** 강도 단계(낮은 것부터 · "Default" 는 빼고) */
    levels: readonly string[];
    /** 지금 강도(`""` = Default) */
    value: string;
    nameOf: (effort: string) => string;
    /** 폰 — 단추 44px */
    touch?: boolean;
    /** "Default" 고리 없이 단계 칸만(AI 타일 대화 면) */
    noDefault?: boolean;
    onpick: (effort: string) => void;
  } = $props();

  /** 자리 — 0 = Default, 1.. = 단계(`noDefault` 면 0.. = 단계 · 모르면 -1) */
  const stops = $derived(noDefault ? [...levels] : ["", ...levels]);
  const at = $derived(noDefault ? stops.indexOf(value) : Math.max(0, stops.indexOf(value)));
  /** 고리 칸이 있는가 — 그 칸이 0 번 */
  const ring = $derived(!noDefault);
  const labelId = `effort-${Math.random().toString(36).slice(2, 8)}`;

  let group = $state<HTMLElement | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  // 값이 바뀌면 포커스가 이 묶음 안에 있을 때만 고른 단추로(라디오 묶음의 "포커스가 선택을 따라간다")
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

  /* 첫 칸(Default 고리)은 고정 폭, 나머지는 같은 폭 */
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

  /* 고른 칸 — 틈을 둔 글자색 고리(목업 D2 의 표시 · 판 색을 몰라도 되게 outline) */
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

  /* 고른 칸 이름은 색만 바꾼다 — 굵게 하면 칸이 여섯일 때 "Medium" 이 넓어져 말줄임으로 잘렸다(2026-11-14). 이름은 머리 오른쪽에 굵게 따로 있다 */
  .lv.on .tick {
    color: var(--fg-1);
  }

  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
