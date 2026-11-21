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
   * 값 여럿을 고르는 Dropdown. 토글은 닫으면서 실행하는 항목이 아니므로 목록을 닫는 runOnMenu 를 쓰지 않는다.
   * Escape 는 창의 닫기 사슬로 새지 않게 끊는다.
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
    onchange?: (values: V[]) => void;
  } = $props();

  const fallbackId = "multi-dropdown-" + ++seq + "-listbox";
  const listId = $derived(id ? id + "-listbox" : fallbackId);
  let open = $state(false);
  let sel = $state(-1);
  let wrapEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 굴리는 것은 안쪽 상자다 — 바깥 판(흐림 층)이 내용과 함께 굴러가지 않게 */
  let scrollEl = $state<HTMLElement | null>(null);
  /** `.menu-surface.md3-list` 의 padding 6px × 2 와 맞춘다 */
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

  // 조상 패널의 스크롤은 버블하지 않으니 캡처에서 받는다
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

  .trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .trigger:disabled {
    opacity: 0.6;
    cursor: default;
  }

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

  /* 상자 · 줄은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface` · `.menu-row`)이다 — 고르는 목록이 서로 다르게 생기지 않게 */
  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

</style>
