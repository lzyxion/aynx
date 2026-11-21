<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  /** `tone` = `ok` · `warn` · `bad` · `neutral`. 칩은 부르는 쪽이 `.vstate-chips` 안에 그린다. */
  let {
    tone,
    icon,
    note,
    id,
    bodyClass,
    title,
    chips,
    ...rest
  }: {
    tone: string;
    icon: string;
    note: string;
    id?: string;
    bodyClass?: string;
    /** `.name` 하나 */
    title: Snippet;
    chips?: Snippet;
  } & Record<`data-${string}`, unknown> = $props();
</script>

<div class="srow vstate" {id} data-tone={tone} {...rest}>
  <span class="vstate-tile" aria-hidden="true"><UiIcon name={icon} size={24} /></span>
  <div class="vstate-body {bodyClass ?? ''}" role="status">
    <div class="vstate-head">
      {@render title()}
      <span class="vstate-note">{note}</span>
    </div>
    {@render chips?.()}
  </div>
</div>

<style>
  .srow.vstate {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    position: relative;
    isolation: isolate;
  }

  /* 틴트는 판 위 한 겹 — 묶음 카드 규칙이 `background` 를 쥐어 판 자체는 못 바꾼다 */
  .srow.vstate::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
  }

  .srow.vstate[data-tone="ok"]::before {
    background: color-mix(in srgb, var(--ok) 8%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ok) 28%, transparent);
  }

  .srow.vstate[data-tone="warn"]::before {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent);
  }

  .srow.vstate[data-tone="bad"]::before {
    background: color-mix(in srgb, var(--err) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 40%, transparent);
  }

  .vstate-tile {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: calc(var(--radius-surface-inner) - 2px);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  [data-tone="ok"] > .vstate-tile {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }

  [data-tone="warn"] > .vstate-tile {
    color: var(--warn);
    background: var(--warn-soft);
  }

  [data-tone="bad"] > .vstate-tile {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 18%, transparent);
  }

  .vstate-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .vstate-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-2);
    row-gap: 2px;
  }

  .vstate-head :global(.name) {
    font-weight: 600;
  }

  .vstate-note {
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  [data-tone="warn"] .vstate-note,
  [data-tone="bad"] .vstate-note {
    color: var(--fg-1);
  }

  .vstate-body :global(.vstate-chips) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
