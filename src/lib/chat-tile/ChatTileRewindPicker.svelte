<script lang="ts">
  /**
   * `/rewind` 고르기 메뉴 — 되감을 사람 말을 고른다(최신이 위 · 20줄). 고르면 카드를 열 뿐 되감지 않는다.
   * 자리는 `/` 메뉴와 같다 — 입력 칸 상자 위 · 타일 몸(`bound`) 안. 포커스는 목록이 쥔다(↑↓ · Enter · Esc).
   * 고르기는 부르는 쪽의 `runOnMenu` 를 지난다(`onpick`).
   */
  import { onMount, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { isImeKey } from "$lib/pane/ai-flip-keys";
  import type { TranscriptItem } from "$lib/context";
  import { rewindQuote } from "$lib/chat-tile/chat-tile-rewind";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    items,
    busy,
    anchor,
    bound = null,
    touch = false,
    onpick,
    onclose,
  }: {
    /** 고를 수 있는 사람 말 — 최신이 앞 */
    items: TranscriptItem[];
    busy: boolean;
    /** 입력 칸 상자 */
    anchor: HTMLElement;
    bound?: HTMLElement | null;
    touch?: boolean;
    onpick: (it: TranscriptItem) => void;
    /** `back` = 입력 칸으로 포커스를 돌린다 */
    onclose: (back: boolean) => void;
  } = $props();

  const MAX = 20;
  const EDGE = 8;
  const MAX_W = 560;
  const MIN_H = 124;
  const rows = $derived(items.slice(0, MAX));
  let active = $state(0);
  let el = $state<HTMLElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let left = $state(0);
  let bottom = $state(0);
  let width = $state(320);
  let maxH = $state(240);
  const idBase = `ct-rw-pick-${Math.random().toString(36).slice(2, 10)}`;

  function place(): void {
    const box = anchor.getBoundingClientRect();
    const lim = bound?.getBoundingClientRect() ?? null;
    const lo = Math.max(EDGE, lim ? lim.left + 4 : 0);
    const hi = Math.min(window.innerWidth - EDGE, lim ? lim.right - 4 : Infinity);
    width = Math.max(Math.min(200, hi - lo), Math.min(MAX_W, box.width, hi - lo));
    left = Math.max(lo, Math.min(box.left, hi - width));
    bottom = window.innerHeight - box.top + 4;
    const top = Math.max(EDGE, lim ? lim.top + 4 : 0);
    maxH = Math.max(MIN_H, Math.min(box.top - 4 - top, Math.max(240, window.innerHeight * 0.5)));
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(anchor);
      if (bound) ro.observe(bound);
      window.addEventListener("resize", place);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", place);
      };
    });
  });

  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node) || el?.contains(target)) return;
      onclose(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  onMount(() => {
    listEl?.focus({ preventScroll: true });
  });

  $effect(() => {
    const i = active;
    const box = listEl;
    if (!box) return;
    untrack(() => box.querySelector<HTMLElement>(`[data-pick-i="${i}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  function pick(i: number): void {
    const it = rows[i];
    if (!it || busy) return;
    onpick(it);
  }

  function onKey(ev: KeyboardEvent): void {
    if (isImeKey(ev) || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const n = rows.length;
    if (ev.key === "Escape") onclose(true);
    else if (ev.key === "ArrowDown" && n > 0) active = (active + 1) % n;
    else if (ev.key === "ArrowUp" && n > 0) active = (active - 1 + n) % n;
    else if (ev.key === "Home" && n > 0) active = 0;
    else if (ev.key === "End" && n > 0) active = n - 1;
    else if (ev.key === "Enter") pick(active);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  const fmtAt = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleString());
</script>

<div
  class="crp menu-surface menu-keyed"
  class:touch
  style="left:{left}px;bottom:{bottom}px;width:{width}px;max-height:{maxH}px"
  bind:this={el}
  data-chat-tile-rewind-picker
>
  <div class="crp-head" id="{idBase}-head">{t("pane.chatTile.rewind.pick.title")}</div>
  {#if rows.length === 0}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="crp-note" role="status" tabindex="0" bind:this={listEl} onkeydown={onKey} data-chat-tile-rewind-pick-empty>{t("pane.chatTile.rewind.pick.empty")}</div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="crp-scroll glass-scroll"
      role="listbox"
      tabindex="0"
      aria-labelledby="{idBase}-head"
      aria-activedescendant="{idBase}-{active}"
      bind:this={listEl}
      onkeydown={onKey}
    >
      {#each rows as it, i (it.anchor ?? i)}
        <button
          type="button"
          class="menu-row crp-row"
          class:selected={i === active}
          id="{idBase}-{i}"
          role="option"
          tabindex="-1"
          aria-selected={i === active}
          aria-disabled={busy ? "true" : undefined}
          data-pick-i={i}
          data-chat-tile-rewind-pick={it.anchor}
          onmousedown={(ev) => ev.preventDefault()}
          onpointerenter={() => (active = i)}
          onclick={() => pick(i)}
        >
          <span class="crp-text">
            {#if rewindQuote(it.text)}<span class="crp-quote">{rewindQuote(it.text)}</span>
            {:else}<span class="crp-quote crp-none" data-chat-tile-rewind-pick-noquote>{t("pane.chatTile.rewind.imageOnly")}</span>{/if}
            {#if it.at !== null}<span class="crp-at">{fmtAt(it.at)}</span>{/if}
          </span>
          <span class="crp-go" aria-hidden="true"><UiIcon name="undo" size={14} /></span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .crp {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .crp-head {
    flex: none;
    padding: var(--space-2) var(--space-3) 2px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-3);
  }

  /* 포커스 표시는 고른 줄(`.selected`)이 한다 — 목록 테두리는 두르지 않는다 */
  .crp-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overscroll-behavior: contain;
    outline: none;
  }

  /* 두 줄 줄은 알약이 아니다(규칙 — 40px 넘는 줄) */
  .crp-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: auto;
    min-height: 40px;
    padding-top: 4px;
    padding-bottom: 4px;
    white-space: normal;
    border-radius: var(--radius-sm);
  }

  .crp.touch .crp-row {
    min-height: 48px;
  }

  .crp-row[aria-disabled="true"] {
    cursor: default;
    opacity: 0.55;
  }

  .crp-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .crp-quote {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
  }

  .crp-none {
    color: var(--fg-2);
    font-style: italic;
  }

  .crp-at {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .crp-go {
    flex: none;
    display: inline-flex;
    color: var(--fg-3);
  }

  .crp-note {
    flex: none;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
    outline: none;
  }
</style>
