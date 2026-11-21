<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import type { ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * "+N" 칩의 메뉴 — 타일 상자 밖에서 그린다(상자마다 `isolation: isolate`).
   * 고른 줄을 인자로 올리기만 한다 — 스냅샷 → 닫기 → 실행은 `runOnMenu` 통로가 든다.
   */
  let {
    title,
    items,
    left,
    top,
    onpick,
    onclose,
  }: {
    title: string;
    items: ChipMoreItem[];
    left: number;
    top: number;
    onpick: (item: ChipMoreItem) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  /** 세로 넘침은 붙은 뒤 잰다 */
  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const at = shownTop;
    void items.length;
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (at > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  });

  /** "+N" 칩만 비켜 간다 — 누름이 먼저 닫고 뒤따르는 click 이 다시 열지 않게 */
  $effect(() => closeOnOutside(() => el, "[data-chip-more]", onclose));

  function onKey(ev: KeyboardEvent) {
    menuKeydown(ev, el, "button:not([disabled])", onclose);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="moremenu menu-surface"
  role="menu"
  aria-label={tr("pane.chipmore.aria", { title })}
  tabindex="-1"
  data-chip-more-menu
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <p class="menu-title">{tr("pane.chipmore.group", { title })}</p>
  {#each items as item (item.id)}
    {#if item.action !== null}
      <button type="button" class="row menu-row" role="menuitem" data-chip-more-row={item.id} title={item.title} onclick={() => onpick(item)}>
        <span class="menu-mark"><UiIcon name={item.icon} size={14} /></span>
        <span class="t" class:muted={item.muted}>{item.label}</span>
      </button>
    {:else}
      <div class="row info menu-row" aria-disabled="true" data-chip-more-row={item.id}>
        <span class="menu-mark"><UiIcon name={item.icon} size={14} /></span>
        <span class="t">{item.label}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .moremenu {
    position: fixed;
    z-index: 20;
    min-width: 200px;
    max-width: 300px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t.muted {
    color: var(--fg-3);
  }

  .info {
    cursor: default;
    color: var(--fg-2);
  }
</style>
