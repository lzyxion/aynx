<script lang="ts">
  /**
   * 앱 툴팁 말풍선 — `+page` 에 한 번만 마운트한다(분리 창은 창마다 하나).
   * 폭이 내용에 달려 있어 먼저 투명하게 그려 잰 뒤 자리를 잡는다.
   */
  import { onMount } from "svelte";
  import { placeTooltip, tooltipSegments } from "$lib/tooltip";
  import { installTooltips, tooltipShown } from "$lib/tooltip.svelte.js";
  import Keys from "$lib/Keys.svelte";

  const tip = $derived(tooltipShown());
  const segments = $derived(tip ? tooltipSegments(tip.text) : []);

  let bubble = $state<HTMLDivElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  onMount(() => installTooltips());

  $effect(() => {
    const t = tooltipShown();
    const el = bubble;
    if (!t || !el) {
      pos = null;
      return;
    }
    const box = el.getBoundingClientRect();
    pos = placeTooltip(
      t.rect,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      t.above ? "above" : "below",
    );
  });
</script>

<!-- 순수한 시각 층이라 `aria-hidden` — `role="tooltip"` 을 붙이면 같은 문구가 두 번 읽힌다 -->
{#if tip}
  <div
    class="tip"
    class:on={pos !== null}
    aria-hidden="true"
    bind:this={bubble}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
  >{#each segments as seg, i (i)}{#if seg.kind === "kbd"}<Keys combo={seg.value} size="sm" />{:else}{seg.value}{/if}{/each}{#if tip.sub}<span
        class="sub">{tip.sub}</span
      >{/if}</div>
{/if}

<style>
  /* z 130 — 토스트(120) 위, 그 위로는 아무것도 없다(한 층이라도 덮이면 그 자리에서만 툴팁이 사라진다) */
  .tip {
    position: fixed;
    z-index: 130;
    max-width: 360px;
    padding: 6px var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.45;
    /* `title` 의 `\n` 을 그대로 줄로 읽는다 */
    white-space: pre-line;
    color: var(--fg-1);
    /* 무엇 위에든 뜨므로 비치지 않는 판 */
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    /* 커서를 먹으면 자기 밑의 요소에서 pointerout 이 나 말풍선이 깜빡인다 */
    pointer-events: none;
    /* 잰 뒤에야 보인다 — 그 전에는 (0,0) 에 투명하게 서 있다 */
    opacity: 0;
  }

  .tip.on {
    opacity: 1;
    /* 전이가 아니라 애니메이션 — 클래스를 붙이는 것이 삽입과 같은 프레임이라 전이는 시작 상태를 못 보고 건너뛸 수 있다 */
    animation: tip-in 80ms ease-out;
  }

  @keyframes tip-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tip.on {
      animation: none;
    }
  }

  /* 흐린 곁말(`data-tip-sub`) */
  .sub {
    margin-left: 6px;
    color: var(--fg-3);
  }
</style>
