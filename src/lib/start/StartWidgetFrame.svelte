<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Box, StartWidgetKind } from "$lib/start-widgets";

  /**
   * 끄는 동안은 `translate` 에 포인터의 차만 더한다 — 배치를 다시 계산하지 않는다(합성만) (docs/log/2026-10-28-start-widgets.md).
   * ×·모서리는 포커스를 가져가지 않는다 — 이 화면의 포커스 주인은 숨은 입력칸 하나다.
   * 치수(머리 40 · 줄 32 · 여백 8 · 두 단 사이 8)는 `start-widgets.ts` 의 상수와 같은 값이다 — 줄 수를 거기서 센다.
   */
  let {
    kind,
    title,
    box,
    offset = null,
    mode = null,
    fixed = false,
    rows,
    count,
    empty = "",
    bare = false,
    editing = false,
    ongrip,
    onremove,
    onresize,
    children,
  }: {
    kind: StartWidgetKind;
    title: string;
    box: Box;
    /** 끄는 동안 포인터가 간 만큼(판 좌표) */
    offset?: { dx: number; dy: number } | null;
    mode?: "drag" | "resize" | null;
    /** 좁은 판 — 쌓아 그린 자리 */
    fixed?: boolean;
    /** 한 단의 줄 수 */
    rows: number;
    count: number;
    empty?: string;
    /** 맨몸(시계) — 카드 · 머리 줄 없이 내용만 */
    bare?: boolean;
    editing?: boolean;
    ongrip: (ev: PointerEvent) => void;
    onremove: () => void;
    onresize: (ev: PointerEvent) => void;
    children: Snippet;
  } = $props();

  const tx = $derived(box.x + (offset?.dx ?? 0));
  const ty = $derived(box.y + (offset?.dy ?? 0));
  const movable = $derived(editing && !fixed);
</script>

{#snippet removeButton()}
  <button
    type="button"
    class="remove"
    tabindex="-1"
    aria-label={t("app.start.widget.remove", { name: title })}
    title={t("app.start.widget.remove", { name: title })}
    data-widget-remove
    onmousedown={(ev) => ev.preventDefault()}
    onclick={onremove}
  >
    <UiIcon name="close" size={12} />
  </button>
{/snippet}

<!-- `data-widget-grip` — 하네스가 끄는 자리를 이 표식으로 찾는다 -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="widget"
  class:glass-mid={!bare}
  class:bare
  class:editing
  class:movable
  class:dragging={mode === "drag"}
  class:resizing={mode === "resize"}
  class:fixed
  data-start-widget={kind}
  data-widget-grip={movable ? "" : undefined}
  aria-label={title}
  style:width="{box.w}px"
  style:height="{box.h}px"
  style:transform="translate({tx}px, {ty}px)"
  onpointerdown={movable ? ongrip : undefined}
>
  {#if bare}
    <div class="body">
      {@render children()}
    </div>
    {#if editing}{@render removeButton()}{/if}
  {:else}
    <header class="head">
      <h3>{title}</h3>
      {#if editing}{@render removeButton()}{/if}
    </header>

    {#if count > 0}
      <div class="rows" style:grid-template-rows="repeat({Math.max(1, rows)}, 32px)">
        {@render children()}
      </div>
    {:else if empty}
      <p class="empty">{empty}</p>
    {/if}
  {/if}

  {#if movable}
    <span
      class="corner"
      role="presentation"
      title={t("app.start.widget.resize", { name: title })}
      data-widget-resize
      onmousedown={(ev) => ev.preventDefault()}
      onpointerdown={onresize}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9" /></svg>
    </span>
  {/if}
</section>

<style>
  .widget {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-mid, var(--start-widget-bg, var(--control-tile-bg)));
    border-radius: var(--radius-surface);
    box-shadow: var(--glass-ctl-edge, inset 0 0 0 1px var(--line));
  }

  /* 공용 선 규칙(theme.css)은 이미 있는 선의 색만 바꾸므로 선 하나를 둔다 */
  :global(:root[data-material="glass"]) .widget {
    /* 색은 적지 않는다 — 이 규칙(0,4,0)이 공용 규칙(0,3,1)보다 세서 `border` 단축형이면 색이 `currentColor` 로 되돌아간다 */
    border-width: 1px;
    border-style: solid;
  }

  /* `opacity` 를 낮추지 않는다 — 1 아래면 카드가 배경 뿌리가 되어 흐림이 창 뒤를 못 본다(theme.css "글래스 면의 등장은 `opacity` 를 움직이지 않는다") */
  .widget.dragging {
    z-index: 2;
    box-shadow: var(--glass-ctl-edge, inset 0 0 0 1px var(--line)), var(--shadow-raised);
    will-change: transform;
    cursor: grabbing;
  }

  :global(:root[data-material="glass"]) .widget.dragging {
    box-shadow: var(--glass-shadow), var(--shadow-raised);
  }

  /* 위 여백 8 + 줄 32 = 40 (`WIDGET_HEADER_H`) */
  .head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
    box-sizing: border-box;
    height: 40px;
    padding: var(--space-2) var(--space-2) 0;
  }

  .head h3 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 32px;
    color: var(--fg-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .widget.editing {
    outline: 1px dashed var(--line-strong, var(--line));
    /* `--start-scale` — `StartPage` 의 무대 배율 */
    outline-width: max(1px, calc(1px / var(--start-scale, 1)));
    outline-offset: 3px;
  }

  .remove,
  .corner {
    scale: max(1, calc(0.75 / var(--start-scale, 1)));
  }

  .remove {
    transform-origin: right center;
  }

  .corner {
    transform-origin: right bottom;
  }

  .widget.movable {
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .widget.movable.dragging {
    cursor: grabbing;
  }

  .widget.editing :global(.row) {
    cursor: inherit;
  }

  .widget.editing :global(.row:not(.selected):hover) {
    background: transparent;
  }

  .remove {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 24px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
  }

  .head h3 {
    padding-left: var(--space-2);
  }

  .remove {
    width: 24px;
    cursor: pointer;
  }

  .remove:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .rows {
    display: grid;
    flex: 1 1 auto;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    column-gap: 8px;
    min-height: 0;
    padding: 0 var(--space-2) var(--space-2);
    overflow: hidden;
  }

  .widget.bare {
    overflow: visible;
    background: none;
    box-shadow: none;
  }

  .widget.bare.editing {
    outline-offset: -1px;
  }

  :global(:root[data-material="glass"]) .widget.bare {
    border-style: none;
  }

  .widget.bare.dragging {
    box-shadow: none;
  }

  :global(:root[data-material="glass"]) .widget.bare.dragging {
    box-shadow: none;
  }

  .bare .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: visible;
  }

  .bare .remove {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    background: var(--bg-chip);
    border-radius: 999px;
  }

  .empty {
    margin: 0;
    padding: var(--space-1) var(--space-4);
    overflow: hidden;
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-3);
    word-break: keep-all;
  }

  .corner {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    width: 20px;
    height: 20px;
    padding: 0 5px 5px 0;
    box-sizing: border-box;
    color: var(--fg-3);
    cursor: nwse-resize;
    touch-action: none;
  }

  .corner svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

</style>
