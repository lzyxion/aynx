<script lang="ts" module>
  /** `id` 를 안 받은 인스턴스의 목록 id — 한 화면에 여럿이 떠도 겹치지 않게 */
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
   * **자유 입력 + 제안 목록** — 네이티브 `<datalist>` 를 대신한다
   * (docs/log/2026-09-20-host-form-tabs.md 의 "네이티브 select · datalist → Dropdown · Combobox").
   *
   * 칸은 그대로 평범한 `<input>` 이다 — **자유 입력이 이 칸의 뜻**이라(아직 없는 그룹
   * 경로를 새로 친다) 목록은 곁길이다. 갈린 것은 그 목록의 모양뿐이고, `Dropdown` 과
   * **같은 상자·같은 줄·같은 자리 셈**을 쓴다 (`dropdown.ts`).
   *
   * ## 언제 뜨는가
   *
   * **글자를 쳤을 때**와 **`↓` 를 눌렀을 때**뿐이다. 포커스만으로는 뜨지 않는다 — 폼을
   * `Tab` 으로 훑고 지나가는 사람에게 상자가 튀어나오면 그 아래 칸이 가려진다.
   * 거르기는 "포함" 이고 대소문자를 무시한다 (`filterSuggestions`).
   *
   * `Enter` 는 **하이라이트된 줄을 넣는다**. 목록이 열려 있는 동안에는 언제나
   * `preventDefault` 라 그 Enter 가 폼을 제출하는 일이 없다 — 닫혀 있으면 평소대로
   * 폼의 Enter 다. `Escape` 는 목록만 닫고 창의 사슬로 새지 않게 거기서 끊는다.
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
    ...rest
  }: {
    /** `<input>` 에 붙는다 — 폼의 `<label for>` 이 그대로 이 칸을 가리킨다 */
    id?: string;
    value: string;
    /** 고를 수 있는 값들 (차례 그대로 보여 준다) */
    suggestions: readonly string[];
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
    /** 칸 모양을 부른 쪽의 클래스로(설정의 `.value` 등) — 주면 아래의 호스트 폼 모양을 쓰지 않는다 */
    inputClass?: string;
    /** 칸을 누르면 목록을 연다 — 고르는 칸에 가까운 자리(설정의 모델 이름). 기본은 글자 · `↓` 로만 */
    openOnClick?: boolean;
    /** 나머지(`data-*` 등)는 `<input>` 에 그대로 */
    [attr: `data-${string}`]: string | boolean | undefined;
  } = $props();

  /** `id` 를 준 쪽이 라벨을 걸므로 그 글자를 따라간다 — 없으면 인스턴스 번호로 */
  const fallbackId = `combobox-${++seq}-listbox`;
  const listId = $derived(id ? `${id}-listbox` : fallbackId);

  let open = $state(false);
  /** 하이라이트된 줄 — 열릴 때 **첫 줄**이고, 그래서 Enter 가 늘 무언가를 넣는다 */
  let sel = $state(0);
  let wrapEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 안쪽 스크롤 상자 — 바깥(`listEl`, 판 · 흐림 층)은 굴리지 않는다(글래스의 흐림 층이 내용과 함께 굴러가지 않게, 10-18) */
  let scrollEl = $state<HTMLElement | null>(null);
  /** 바깥 판의 위아래 안쪽 여백 합(`.menu-surface.md3-list` 의 padding 6px × 2) — 안쪽 상자의 최대 높이에서 뺀다 */
  const LIST_PAD = 12;
  let rect = $state<{ left: number; top: number; bottom: number; width: number } | null>(null);

  /** 클릭으로 연 목록은 **전부** 보인다(이미 든 값으로 거르면 고를 것이 그 하나뿐이다) — 글자를 치면 다시 거른다 */
  let all = $state(false);
  const rows = $derived(filterSuggestions(suggestions, all ? "" : value, SUGGEST_MAX));
  /** 줄이 하나도 없으면 상자 자체가 없다 */
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
    void rows.length; // 거르기가 줄어들면 높이가 달라진다 — 다시 잰다
    if (scrollEl) scrollEl.style.maxHeight = `${dropdownMaxHeight(r, window.innerHeight) - LIST_PAD}px`;
    el.style.top = `${placeBelowOrAbove(r, el.offsetHeight, window.innerHeight).top}px`;
    el.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  // 창이 움직이면 닫는다 — 조상 패널의 스크롤까지 잡으려면 **캡처 단계**여야 한다.
  $effect(() => {
    if (!shown) return;
    const bail = () => close();
    // 목록 자신의 스크롤(고른 줄 끌어오기 · 휠)은 빼고 — 잡으면 열리자마자 닫힌다(`Dropdown` 과 같은 규칙, 10-18)
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
    if (!shown) return; // 아래는 전부 **열려 있을 때만**의 뜻이다
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
      // 목록이 열려 있는 동안의 Enter 는 **폼으로 가지 않는다**
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
    <!-- 바깥 클릭을 받아 닫는 투명 백드롭 — 목록보다 한 겹 아래 (`HostMenu` 와 같은 모양) -->
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
          {row}
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

  /*
   * 칸은 호스트 폼의 `.fields input` 과 **같은 규칙**이다 — 스코프 CSS 는 자식 컴포넌트에
   * 닿지 않으므로(그쪽 선택자에는 그 파일의 스코프 클래스가 붙는다) 여기에 다시 적는다.
   * 값이 경로(`prod/web`)라 글꼴은 저쪽과 같이 모노스페이스다. `inputClass` 를 받으면(`.own` 없음) 그쪽 모양을 쓴다.
   */
  .cb input {
    width: 100%;
  }

  /* MD3 filled 면(2026-10-18 — `Dropdown` 손잡이와 같은 값): `--field-height` · `--field-bg` · `--field-radius` · 테두리 없음 · 중성 포커스 링 */
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

  /* 바깥 클릭을 받는 투명 백드롭 — 모달 오버레이(z-100)보다 위다 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /* 상자·줄은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`) — `Dropdown` 과 같다 */
  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

  /* 줄은 전역 `.menu-row` — 값이 경로라 글꼴만 모노다 */
  .row {
    font-family: var(--font-mono);
  }
</style>
