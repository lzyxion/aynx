<script lang="ts" module>
  let seq = 0;
</script>

<script lang="ts">
  import {
    DROPDOWN_GAP,
    dropdownMaxHeight,
    filterSuggestions,
    placeBelowOrAbove,
    SUGGEST_MAX,
  } from "$lib/dropdown";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 자유 입력 + 제안 목록 — 네이티브 `<datalist>` 를 대신한다. 포커스만으로는 뜨지 않는다 —
   * 폼을 `Tab` 으로 훑는 사람에게 상자가 튀어나오면 아래 칸이 가려진다.
   */
  let {
    id,
    value = $bindable(""),
    suggestions,
    placeholder = "",
    ariaLabel,
    disabled = false,
    inputClass,
    openOnClick = false,
    label,
    ...rest
  }: {
    id?: string;
    value: string;
    suggestions: readonly string[];
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
    /** 주면 아래의 호스트 폼 모양을 쓰지 않는다 */
    inputClass?: string;
    openOnClick?: boolean;
    /** 표시 글자만 — 거르기 · 고른 뒤 칸에 들어가는 것은 늘 값이다 */
    label?: (value: string) => string;
    [attr: `data-${string}`]: string | boolean | undefined;
  } = $props();

  const fallbackId = `combobox-${++seq}-listbox`;
  const listId = $derived(id ? `${id}-listbox` : fallbackId);

  let open = $state(false);
  let sel = $state(0);
  let wrapEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 바깥(`listEl`, 판 · 흐림 층)은 굴리지 않는다 — 글래스의 흐림 층이 내용과 함께 굴러가지 않게 */
  let scrollEl = $state<HTMLElement | null>(null);
  /** `.menu-surface.md3-list` 의 padding 6px × 2 */
  const LIST_PAD = 12;
  let rect = $state<{ left: number; top: number; bottom: number; width: number } | null>(null);

  /** 클릭으로 연 목록은 전부 보인다(이미 든 값으로 거르면 고를 것이 그 하나뿐이다) */
  let all = $state(false);
  const rows = $derived(filterSuggestions(suggestions, all ? "" : value, SUGGEST_MAX));
  const shown = $derived(open && rows.length > 0);

  function gone(): boolean {
    return !inputEl?.isConnected || inputEl.offsetParent === null;
  }

  function openList(showAll = false): void {
    const r = inputEl?.getBoundingClientRect();
    if (!r) return;
    rect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
    all = showAll;
    sel = Math.max(0, showAll ? rows.indexOf(value) : 0);
    open = true;
  }

  function close(): void {
    open = false;
    rect = null;
  }

  /** 스냅샷 → 닫기 → 값 (docs/conventions.md 의 메뉴 통로와 같은 순서) */
  function pick(i: number): void {
    const next = rows[i];
    close();
    if (next !== undefined) value = next;
    inputEl?.focus({ preventScroll: true });
  }

  $effect(() => {
    const el = listEl;
    const r = rect;
    if (!el || !r) return;
    void sel;
    void rows.length;
    if (scrollEl) scrollEl.style.maxHeight = `${dropdownMaxHeight(r, window.innerHeight) - LIST_PAD}px`;
    el.style.top = `${placeBelowOrAbove(r, el.offsetHeight, window.innerHeight).top}px`;
    el.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  // 조상 패널의 스크롤까지 잡으려면 캡처 단계여야 한다
  $effect(() => {
    if (!shown) return;
    const bail = () => close();
    // 목록 자신의 스크롤은 뺀다 — 잡으면 열리자마자 닫힌다
    const onScroll = (ev: Event) => {
      if (!(ev.target instanceof Node && listEl?.contains(ev.target))) bail();
    };
    window.addEventListener("resize", bail);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", bail);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  function keydown(ev: KeyboardEvent): void {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (!shown) {
        openList();
        return;
      }
      sel = Math.min(sel + 1, rows.length - 1);
      return;
    }
    if (!shown) return;
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      sel = 0;
    } else if (ev.key === "End") {
      ev.preventDefault();
      sel = rows.length - 1;
    } else if (ev.key === "Enter") {
      // 목록이 열려 있는 동안의 Enter 는 폼을 제출하지 않는다
      ev.preventDefault();
      pick(sel);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬(호스트 폼 닫기)로 새지 않게 여기서 끊는다
      close();
    } else if (ev.key === "Tab") {
      close();
    }
  }
</script>

<div
  class="cb"
  class:own={!inputClass}
  bind:this={wrapEl}
  onfocusout={(ev) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && wrapEl?.contains(to)) return;
    close();
  }}
>
  <input
    {...rest}
    {id}
    class={inputClass}
    {disabled}
    bind:value
    bind:this={inputEl}
    {placeholder}
    role="combobox"
    aria-expanded={shown}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={shown ? `${listId}-o${sel}` : undefined}
    aria-label={ariaLabel}
    autocomplete="off"
    spellcheck="false"
    oninput={() => {
      // 친 글자에 맞춰 다시 연다 — 걸리는 것이 없으면 `shown` 이 상자를 지운다
      if (gone()) return;
      openList();
    }}
    onclick={() => {
      // 열려 있으면 백드롭이 클릭을 먼저 받는다 — 여기는 닫혀 있을 때만 온다
      if (openOnClick && !disabled && !gone()) openList(true);
    }}
    onkeydown={keydown}
  />

  {#if shown && rect}
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("app.dropdown.close.aria")}
      onclick={() => close()}
    ></button>
    <div
      id={listId}
      class="suggest menu-surface menu-keyed md3-list"
      role="listbox"
      aria-label={ariaLabel}
      bind:this={listEl}
      style:left="{rect.left}px"
      style:width="{rect.width}px"
      style:top="{rect.bottom + DROPDOWN_GAP}px"
    >
      <div class="md3-scroll" bind:this={scrollEl}>
      {#each rows as row, i (row)}
        <button
          id={`${listId}-o${i}`}
          type="button"
          tabindex="-1"
          class="row menu-row"
          class:selected={i === sel}
          data-sel={i === sel ? "" : undefined}
          role="option"
          aria-selected={row === value}
          onmouseenter={() => (sel = i)}
          onmousedown={(ev) => {
            // 포커스를 칸에 붙들어 둔다 — 누르기도 전에 상자가 접히면 클릭이 갈 곳이 없다
            // (`SnippetSuggest` 와 같은 이유).
            ev.preventDefault();
          }}
          onclick={() => pick(i)}
        >
          {label ? label(row) : row}
        </button>
      {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .cb {
    min-width: 0;
  }

  .cb input {
    width: 100%;
  }

  /* 호스트 폼의 `.fields input` · `Dropdown` 손잡이와 같은 값 — 스코프 CSS 가 자식에 닿지 않아 다시 적는다 */
  .cb.own input {
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .cb.own input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .cb.own input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .cb.own input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 모달 오버레이(z-100)보다 위다 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

  .row {
    font-family: var(--font-mono);
  }
</style>
