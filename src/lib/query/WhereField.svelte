<script lang="ts" module>
  /** 목록 id — 데이터 탭이 여럿이어도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts">
  /**
   * **데이터 탭의 WHERE 칸** — 평범한 `<input>`(값 · 셀렉터 `data-query-data-where` 그대로) + 작은 자동완성 목록(2026-11-10). 후보는 부르는 쪽
   * `source`(그 표의 열 + 조건 키워드 — `sql-complete`)가 짓는다.
   *
   * 키(목록이 떠 있을 때만): `↑` `↓` = 고르기 · `Enter` · `Tab` = 넣기 · `Esc` = 닫기. 목록이 없으면 키는 부르는 쪽 `onkeydown`(Enter = 적용 ·
   * Esc = 되돌림)으로 간다. `Ctrl+Space` = 부르기. 저절로 뜨는 때는 `source` 가 정한다(낱말 두 글자 이상 · 점 뒤). 목록은 `document.body`
   * 에 그린다(쿼리 타일은 컨테이너 질의 상자 안이라 그 안의 `position: fixed` 는 창 기준이 아니다 — `GridMenu` 와 같은 까닭).
   */
  import { tick } from "svelte";
  import { DROPDOWN_GAP } from "$lib/dropdown";
  import type { CompleteItem } from "./sql-complete";

  let {
    value = $bindable(""),
    el = $bindable(null),
    placeholder,
    ariaLabel,
    source,
    onkeydown,
  }: {
    value: string;
    el?: HTMLInputElement | null;
    placeholder: string;
    ariaLabel: string;
    /** 후보 — 뜰 때가 아니면 `null`. `from` 은 바꿀 자리의 시작(칸 글자 위치) */
    source: (text: string, pos: number, explicit: boolean) => { from: number; items: CompleteItem[] } | null;
    onkeydown: (ev: KeyboardEvent) => void;
  } = $props();

  const listId = `query-where-list-${++seq}`;
  let items = $state<CompleteItem[]>([]);
  let from = 0;
  let sel = $state(0);
  let rect = $state<{ left: number; top: number } | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  const open = $derived(rect !== null && items.length > 0);

  function close() {
    rect = null;
    items = [];
  }

  function suggest(explicit: boolean) {
    const input = el;
    if (!input) return;
    const pos = input.selectionStart ?? value.length;
    const r = source(value, pos, explicit);
    if (!r || r.items.length === 0) return close();
    items = r.items;
    from = r.from;
    sel = 0;
    const b = input.getBoundingClientRect();
    rect = { left: b.left, top: b.bottom + DROPDOWN_GAP };
  }

  /** 스냅샷 → 닫기 → 넣기(메뉴 통로와 같은 순서) */
  function pick(i: number) {
    const it = items[i];
    const input = el;
    close();
    if (!it || !input) return;
    const pos = input.selectionStart ?? value.length;
    const text = it.apply ?? it.label;
    value = value.slice(0, from) + text + value.slice(pos);
    const caret = from + text.length;
    void tick().then(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }

  function keydown(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (ev.key === " " && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      suggest(true);
      return;
    }
    if (open) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        sel = (sel + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        pick(sel);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "Home" || ev.key === "End") close();
    }
    onkeydown(ev);
  }

  // 창이 움직이면 닫는다(조상 패널의 스크롤까지 — 캡처 단계 · 목록 자신의 스크롤은 빼고)
  $effect(() => {
    if (!open) return;
    const onScroll = (ev: Event) => {
      if (!(ev.target instanceof Node && listEl?.contains(ev.target))) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  $effect(() => {
    void sel;
    listEl?.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<input
  type="text"
  spellcheck="false"
  autocomplete="off"
  {placeholder}
  aria-label={ariaLabel}
  role="combobox"
  aria-expanded={open}
  aria-controls={listId}
  aria-autocomplete="list"
  bind:value
  bind:this={el}
  oninput={(ev) => {
    if (!(ev instanceof InputEvent && ev.isComposing)) suggest(false);
  }}
  oncompositionend={() => suggest(false)}
  onkeydown={keydown}
  onblur={close}
  data-query-data-where
/>

{#if open && rect}
  <div class="portal" use:portal>
    <div id={listId} class="where-list menu-surface menu-keyed" role="listbox" aria-label={ariaLabel} bind:this={listEl} style:left="{rect.left}px" style:top="{rect.top}px">
      {#each items as it, i (`${it.kind}:${it.label}:${it.detail ?? ""}`)}
        <button
          type="button"
          tabindex="-1"
          class="row menu-row"
          class:selected={i === sel}
          class:kw={it.kind === "keyword"}
          data-sel={i === sel ? "" : undefined}
          role="option"
          aria-selected={i === sel}
          onmouseenter={() => (sel = i)}
          onmousedown={(ev) => ev.preventDefault()}
          onclick={() => pick(i)}
          ><span class="lbl">{it.label}</span>{#if it.detail}<span class="det">{it.detail}</span>{/if}</button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    outline: none;
  }

  .portal {
    display: contents;
  }

  .where-list {
    position: fixed;
    z-index: 106;
    box-sizing: border-box;
    min-width: 200px;
    max-width: min(420px, 80vw);
    max-height: 240px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 22px;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kw .lbl {
    color: var(--tertiary);
  }

  .det {
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--fg-3);
  }
</style>
