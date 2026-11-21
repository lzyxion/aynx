<script lang="ts">
  /**
   * 호버 카드의 공용 틀 — 카드는 내용만 채운다(`children`). 투명하게 그려 잰 뒤 자리를 잡고 보인다.
   * 어디에 그리는지는 부르는 쪽 몫이다 — 타일 상자 안은 `isolation: isolate` 라 이웃에 덮인다.
   * `document.body` 포털은 쓰지 않는다 — Svelte 5 가 블록을 걷을 때 옮긴 노드가 엉뚱한 형제를 끌고 갈 수 있다.
   * `pointer-events: none` — 커서를 먹으면 앵커에서 `pointerleave` 가 나 카드가 깜빡인다.
   */
  import type { Snippet } from "svelte";
  import { placeBeside, placeTooltip, type TooltipRect } from "$lib/tooltip";

  let {
    anchor,
    side = "vertical",
    watch,
    minWidth,
    maxWidth,
    padX = "var(--space-3)",
    gap = "6px",
    lineHeight = 1.4,
    children,
    ...attrs
  }: {
    /** 뷰포트 좌표 */
    anchor: TooltipRect;
    side?: "vertical" | "left" | "right";
    /** 내용의 값 — 바뀌면 다시 잰다(읽기만 한다) */
    watch?: unknown;
    minWidth: number;
    maxWidth: number;
    padX?: string;
    gap?: string;
    lineHeight?: number;
    children: Snippet;
    [key: `data-${string}`]: unknown;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    const node = el;
    const a = anchor;
    const s = side;
    void watch;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const size = { width: box.width, height: box.height };
    const view = { width: window.innerWidth, height: window.innerHeight };
    pos = s === "vertical" ? placeTooltip(a, size, view) : placeBeside(a, size, view, s);
  });
</script>

<div
  {...attrs}
  class="hcard glass-raised"
  class:on={pos !== null}
  aria-hidden="true"
  bind:this={el}
  style:left="{pos?.left ?? 0}px"
  style:top="{pos?.top ?? 0}px"
  style:--hc-min="{minWidth}px"
  style:--hc-max="{maxWidth}px"
  style:--hc-pad-x={padX}
  style:--hc-gap={gap}
  style:--hc-lh={lineHeight}
>
  {@render children()}
</div>

<style>
  .hcard {
    position: fixed;
    z-index: 130;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--hc-gap);
    min-width: var(--hc-min);
    max-width: min(var(--hc-max), calc(100vw - 16px));
    padding: var(--space-2) var(--hc-pad-x);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: var(--hc-lh);
    color: var(--fg-1);
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    pointer-events: none;
    opacity: 0;
  }
  .hcard.on {
    opacity: 1;
    animation: hcard-in 80ms ease-out;
  }
  @keyframes hcard-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  /* 글래스는 `opacity` 대신 판과 내용만 페이드한다 — 움직이는 동안에도 흐림이 선다(theme.css `glass-surface-in`) */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .hcard.on {
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .hcard.on > :global(*) {
      animation: glass-content-in 80ms ease-out;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hcard.on {
      animation: none;
    }
  }
</style>
