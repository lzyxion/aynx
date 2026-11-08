<script lang="ts" module>
  /** id 없는 인스턴스도 목록 이름이 겹치지 않는다. */
  let seq = 0;
</script>

<script lang="ts" generics="V extends string">
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    DROPDOWN_GAP, TYPEAHEAD_RESET_MS, dropdownMaxHeight, placeBelowOrAbove, typeaheadIndex,
  } from "$lib/dropdown";
  import {
    multiDropdownLabel, normalizeMultiValues, toggleMultiValue, type MultiDropdownOption,
  } from "$lib/multi-dropdown";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 값 여럿을 고르는 Dropdown — 손잡이·목록의 모양과 토큰은 Dropdown.svelte 와 같다.
   * 토글은 닫으면서 실행하는 항목이 아니므로 목록을 닫는 runOnMenu 를 쓰지 않는다.
   *
   * 자리는 position: fixed: 여는 순간 손잡이 좌표를 재고 폭을 맞추며, 아래가 모자라면
   * dropdown.ts 의 placeBelowOrAbove · dropdownMaxHeight 로 위에 놓는다.
   * 조상 스크롤·리사이즈에는 닫는다. 목록 자신의 스크롤은 긴 목록을 고르기 위해 남긴다.
   *
   * 손잡이의 ↑↓·Enter·Space 로 열고, 목록에서 ↑↓(끝에서 멈춤)·Home/End 로 옮긴다.
   * 글자 점프·반복 글자 순환은 Dropdown 과 같은 typeaheadIndex 를 쓰고 비활성 줄은 뺀다.
   * 클릭·Enter·Space 는 토글만 한다. Escape·바깥 클릭·Tab 은 닫고 손잡이로 돌아온다.
   * Escape 는 창의 닫기 사슬로 새지 않게 끊는다. 포커스가 밖으로 옮겨 가면 닫는다.
   *
   * bind:values 는 options 순서로 정규화한다. 둘까지는 라벨을 잇고 셋부터는
   * placeholderMany(개수), 없으면 흐린 placeholder. V extends string 은 호출부 타입을 지킨다.
   */
  let {
    id,
    values = $bindable(),
    options,
    placeholder,
    placeholderMany,
    disabled = false,
    ariaLabel,
    labelledby,
    describedby,
    ariaInvalid = false,
    onchange,
  }: {
    id?: string;
    values: V[];
    options: readonly MultiDropdownOption<V>[];
    placeholder: string;
    placeholderMany: (count: number) => string;
    disabled?: boolean;
    ariaLabel?: string;
    labelledby?: string;
    describedby?: string;
    ariaInvalid?: boolean;
    /** 사람이 토글했을 때만 부른다. */
    onchange?: (values: V[]) => void;
  } = $props();

  const fallbackId = "multi-dropdown-" + ++seq + "-listbox";
  const listId = $derived(id ? id + "-listbox" : fallbackId);
  let open = $state(false);
  let sel = $state(-1);
  let wrapEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 안쪽 스크롤 상자 — 바깥(`listEl`, 판 · 흐림 층)은 굴리지 않는다(글래스의 흐림 층이 내용과 함께 굴러가지 않게, 10-18) */
  let scrollEl = $state<HTMLElement | null>(null);
  /** 바깥 판의 위아래 안쪽 여백 합(`.menu-surface.md3-list` 의 padding 6px × 2) — 안쪽 상자의 최대 높이에서 뺀다 */
  const LIST_PAD = 12;
  let rect = $state<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const selected = $derived(normalizeMultiValues(options, values));
  const label = $derived(multiDropdownLabel(options, values, placeholder, placeholderMany));
  const enabledRows = $derived(options.flatMap((o, i) => o.disabled ? [] : [i]));
  let typed = "";
  let typedAt = 0;

  $effect(() => {
    const next = selected;
    if (values.length !== next.length || values.some((value, i) => value !== next[i])) values = next;
  });

  function gone(): boolean {
    return !triggerEl?.isConnected || triggerEl.offsetParent === null;
  }

  function openList(): void {
    if (disabled || options.length === 0) return;
    const r = triggerEl?.getBoundingClientRect();
    if (!r) return;
    rect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
    sel = enabledRows.find((i) => selected.includes(options[i].value)) ?? enabledRows[0] ?? -1;
    typed = "";
    open = true;
  }

  function close(focusBack = true): void {
    if (!open) return;
    open = false;
    rect = null;
    if (focusBack) triggerEl?.focus({ preventScroll: true });
  }

  function toggle(i: number): void {
    const option = options[i];
    if (disabled || !option || option.disabled) return;
    values = toggleMultiValue(options, values, option.value);
    onchange?.([...values]);
    listEl?.focus({ preventScroll: true });
  }

  // 동적으로 없어진/비활성화된 줄을 aria-activedescendant 로 남기지 않는다.
  $effect(() => {
    if (!open) return;
    if (disabled || options.length === 0) { close(false); return; }
    if (!enabledRows.includes(sel)) sel = enabledRows[0] ?? -1;
  });

  $effect(() => {
    const el = listEl;
    const r = rect;
    if (!el || !r) return;
    void sel;
    if (scrollEl) scrollEl.style.maxHeight = `${dropdownMaxHeight(r, window.innerHeight) - LIST_PAD}px`;
    el.style.top = placeBelowOrAbove(r, el.offsetHeight, window.innerHeight).top + "px";
    el.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => { if (open) listEl?.focus({ preventScroll: true }); });

  // 조상 패널의 스크롤은 캡처에서 받는다(버블하지 않는다).
  $effect(() => {
    if (!open) return;
    const bail = () => close(!gone());
    const onScroll = (ev: Event) => { if (!(ev.target instanceof Node && listEl?.contains(ev.target))) bail(); };
    window.addEventListener("resize", bail);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", bail);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  function triggerKeydown(ev: KeyboardEvent): void {
    if (disabled) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (!open) openList();
    }
  }

  function listKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Tab") {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬까지 닫지 않는다.
      close();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle(sel);
      return;
    }
    const pos = enabledRows.indexOf(sel);
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      sel = enabledRows[Math.min(pos + 1, enabledRows.length - 1)] ?? -1;
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      sel = enabledRows[Math.max(pos - 1, 0)] ?? -1;
    } else if (ev.key === "Home") {
      ev.preventDefault();
      sel = enabledRows[0] ?? -1;
    } else if (ev.key === "End") {
      ev.preventDefault();
      sel = enabledRows[enabledRows.length - 1] ?? -1;
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const now = Date.now();
      typed = now - typedAt > TYPEAHEAD_RESET_MS ? ev.key : typed + ev.key;
      typedAt = now;
      const hit = typeaheadIndex(enabledRows.map((i) => options[i].label), typed, pos);
      if (hit >= 0) { ev.preventDefault(); sel = enabledRows[hit]; }
    }
  }
</script>

<div class="dd" bind:this={wrapEl} onfocusout={(ev) => {
  const to = ev.relatedTarget;
  if (to instanceof Node && wrapEl?.contains(to)) return;
  close(false);
}}>
  <button {id} type="button" class="trigger" role="combobox"
    aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
    aria-label={ariaLabel} aria-labelledby={labelledby} aria-describedby={describedby} aria-invalid={ariaInvalid}
    {disabled} bind:this={triggerEl}
    onclick={() => (open ? close() : openList())} onkeydown={triggerKeydown}>
    <span class="cur" class:placeholder={selected.length === 0}><span class="cur-text">{label}</span></span>
    <UiIcon name="chevron-down" size={13} />
  </button>
  {#if open && rect}
    <button type="button" class="menu-backdrop" tabindex="-1"
      aria-label={t("app.dropdown.close.aria")} onmousedown={(ev) => ev.preventDefault()} onclick={() => close()}></button>
    <div id={listId} class="suggest menu-surface menu-keyed md3-list" role="listbox" aria-multiselectable="true" tabindex="-1"
      aria-label={labelledby ? undefined : ariaLabel} aria-labelledby={labelledby}
      aria-activedescendant={sel >= 0 ? listId + "-o" + sel : undefined} bind:this={listEl}
      style:left="{rect.left}px" style:width="{rect.width}px" style:top="{rect.bottom + DROPDOWN_GAP}px"
      onkeydown={listKeydown}>
      <div class="md3-scroll" bind:this={scrollEl}>
      {#each options as o, i (o.value)}
        <button id={listId + "-o" + i} type="button" tabindex="-1" class="row menu-row"
          class:selected={i === sel} data-sel={i === sel ? "" : undefined}
          role="option" aria-selected={selected.includes(o.value)} aria-disabled={o.disabled || undefined}
          disabled={o.disabled} onmouseenter={() => { if (!o.disabled) sel = i; }}
          onmousedown={(ev) => ev.preventDefault()} onclick={() => toggle(i)}>
          <span class="check" aria-hidden="true">{#if selected.includes(o.value)}<UiIcon name="check" size={12} />{/if}</span>
          <span class="opt-text">{o.label}</span>
          {#if o.hint}<span class="hint">{o.hint}</span>{/if}
        </button>
      {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .dd {
    min-width: 0;
  }

  /*
   * 닫힌 손잡이 — MD3 filled 면(2026-10-18): `--field-height` · surfaceContainerHighest(`--field-bg`) · `--field-radius` · 테두리 없음.
   * 다른 것은 오른쪽 끝의 `▾` 하나뿐이고, 그것은 네이티브가 스스로 그리던 자리다.
   */
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-2) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
    cursor: pointer;
  }

  .trigger:hover:not(:disabled) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 링 — 둥근 모양을 따른다 (docs/log/2026-09-25-finish-menus.md) */
  .trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .trigger:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* 고른 값 한 줄 — 길면 말줄임으로 끊는다 (`▾` 를 밀어내지 않는다) */
  .cur {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    user-select: none;
  }

  .cur-text,
  .opt-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 줄: 체크 칸 · 이름 · 선택적 보조 글자 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .opt-text {
    flex: 1 1 auto;
  }

  .check {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--fg-2);
    width: 12px;
    height: 12px;
    align-items: center;
  }

  .placeholder { color: var(--fg-3); }

  .hint {
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .trigger :global(.ui-icon) {
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

  /*
   * 상자·줄은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface` · `.menu-row` · 골라진 줄이 하나인
   * `.menu-keyed`)이다 — 앱 안의 "고르는 목록" 이 서로 다르게 생기면 같은 종류라는 사실이 사라진다.
   * 폭은 손잡이와 같게 인라인으로 온다(네이티브 `<select>` 와 같은 몸짓).
   */
  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

</style>
