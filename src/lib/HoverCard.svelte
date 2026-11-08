<script lang="ts">
  /**
   * **호버 카드의 틀** (2026-10-11) — 얹으면 뜨는 작은 카드 다섯(타일 이름 · tmux 칩 · 포워딩 칩 · 상태바 사용량 고리 ·
   * 작업안 칸)이 각자 적던 같은 판을 한 곳에 모았다. 카드는 **안에 드는 것만** 채운다(`children`).
   *
   * 틀이 쥐는 것:
   * - **자리** — `position: fixed`, 가로 띠·머리줄은 `placeTooltip`(아래가 기본, 모자라면 위), 세로 기둥은 `placeBeside`
   *   (`side` — 카드가 설 쪽). 두 걸음이다: 투명하게 그려 재고 → 자리를 잡은 뒤 보인다(`Tooltip.svelte` 와 같은 방식).
   *   `anchor` · `side` · `watch`(내용 — 값이 새로 오면 폭이 바뀐다)가 바뀌면 다시 잰다.
   * - **층** — 툴팁과 같은 z 130. 어디에 그리는지(타일 상자 밖 `PaneHost` 최상위 · 상태바 띠 밖)는 부르는 쪽 몫이다 —
   *   상자마다 `isolation: isolate` 라 안에서 그리면 이웃에 덮인다. (`document.body` 포털은 쓰지 않는다 — Svelte 5 는
   *   블록을 걷을 때 제 노드 줄을 형제로 따라가며 지우므로 옮긴 노드가 엉뚱한 형제를 끌고 갈 수 있다.)
   * - **판** — 뜬 면 재질: 평면이면 비치지 않는 `--surface-raised-solid`, 글래스면 메뉴(`.menu-surface`)와 같은
   *   중 층 `--glass-float` + `.glass-raised` 의 `::before` 흐림 한 겹(상자 자신에 `backdrop-filter` 를 걸지 않는
   *   이유는 `theme.css` 재질 절). 가장자리 선 하나 · 작은 모서리 · 그림자 없음(docs/log/2026-09-25-finish-menus.md) —
   *   글래스면 공용 규칙이 선을 흰 테두리로 바꾸고 그림자를 단다(글래스모피즘 10-21).
   *   평면 화면은 틀로 모으기 전과 픽셀 단위로 같다.
   * - **몸짓** — 80ms 스며듦(움직임 줄이기면 없음). 사라질 때는 `{#if}` 로 빠진다.
   * - `aria-hidden` · `pointer-events: none` — 순수한 시각 층이다(접근성 이름은 앵커가 쥔다). 커서를 먹으면 앵커에서
   *   `pointerleave` 가 나 카드가 깜빡인다.
   *
   * 카드마다 다른 것(폭 상·하한 · 가로 여백 · 줄 간격 · 줄 높이)은 프롭이다. `data-*` 손잡이(하네스가 잡는다)는 그대로
   * 상자에 얹힌다(`...attrs`).
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
    /** 앵커(칩 · 이름 칸 · 고리)의 상자 — 뷰포트 좌표 */
    anchor: TooltipRect;
    /** `"vertical"` 이면 위·아래(`placeTooltip`), 세로 기둥이면 카드가 설 쪽(`placeBeside`) */
    side?: "vertical" | "left" | "right";
    /** 내용의 값 — 바뀌면 다시 잰다(읽기만 한다) */
    watch?: unknown;
    /** 폭 하한(px) */
    minWidth: number;
    /** 폭 상한(px) — 창 폭 − 16px 를 넘지 않는다 */
    maxWidth: number;
    /** 가로 안쪽 여백(세로는 `--space-2` 고정) */
    padX?: string;
    /** 줄(자식) 사이 간격 */
    gap?: string;
    lineHeight?: number;
    children: Snippet;
    [key: `data-${string}`]: unknown;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  /** 그려진 뒤 재고 놓는다 — 앵커 · 쪽 · 내용이 바뀌면 다시 */
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
    /* 잰 뒤에야 보인다 */
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
  /* 글래스 — 카드의 `opacity` 대신 판 색 · 선 · 그림자와 내용만 페이드(theme.css `glass-surface-in` — 움직이는 동안에도 흐림이 선다) */
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
