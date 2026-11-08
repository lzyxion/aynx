<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import type { ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * **"+N" 칩의 메뉴** (2026-10-23 — 머리줄 칩 접기 2차) — 넘쳐서 숨은 칩들을 **제 폭 글자로** 한 줄씩 늘어놓는다.
   *
   * ```text
   * web-01 · 숨은 칩
   * ⎇  feature/header-chip-fit
   * ⇢  경유 bastion          (보기만)
   * ⇄  포워딩 2
   * ```
   *
   * tmux 세션 목록 · 포워딩 목록과 **같은 상자 · 같은 몸짓**이다(`TmuxMenu` · `ForwardMenu`): 칩 왼쪽 변 바로 아래에 서고, 바깥 클릭 ·
   * 창 크기 변경 · Escape 로 닫히며, ↑↓ · Home/End 로 줄을 돈다. 타일 상자 **밖**(`PaneHost`)에서 그린다 — 상자마다 `isolation: isolate`.
   * 누르면 하는 일은 모른다 — 고른 줄을 **인자로** 올리고(`onpick`) 스냅샷 → 닫기 → 실행은 `PaneHost` 의 통로(`runOnMenu`)가 든다.
   */
  let {
    title,
    items,
    left,
    top,
    onpick,
    onclose,
  }: {
    /** 머리글 = 대상 타일의 이름 */
    title: string;
    items: ChipMoreItem[];
    left: number;
    top: number;
    onpick: (item: ChipMoreItem) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  /** 뜨면 자신에 포커스 — 세로 넘침은 붙은 뒤 잰다(`ForwardMenu` 와 같은 처방) */
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

  /** 바깥을 누르면 닫는다 — "+N" 칩만 비켜 간다(누름이 먼저 닫고 뒤따르는 click 이 다시 열지 않게) */
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
      <!-- 누를 데가 없는 칩(경유 — 상태 하나뿐) — 보기만 하는 줄. ↑↓ 가 건너뛴다 -->
      <div class="row info menu-row" aria-disabled="true" data-chip-more-row={item.id}>
        <span class="menu-mark"><UiIcon name={item.icon} size={14} /></span>
        <span class="t">{item.label}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* 상자 · 머리글 · 줄 · 그림 칸은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`) — `TmuxMenu` · `ForwardMenu` 와 같은 종류 */
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

  /* 흐린 글자 — 폴더를 모를 때의 `folder` */
  .t.muted {
    color: var(--fg-3);
  }

  /* 보기만 하는 줄 — 판 · 손가락 커서가 없다 */
  .info {
    cursor: default;
    color: var(--fg-2);
  }
</style>
