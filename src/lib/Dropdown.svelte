<script lang="ts" module>
  /** `id` 를 안 받은 인스턴스의 목록 id — 한 화면에 여럿이 떠도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts" generics="V extends string">
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import {
    DROPDOWN_GAP,
    TYPEAHEAD_RESET_MS,
    dropdownMaxHeight,
    placeBelowOrAbove,
    typeaheadIndex,
  } from "$lib/dropdown";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 값 하나를 고르는 목록 — 네이티브 `<select>` 를 대신한다.
   * - 스크롤 · 리사이즈에는 다시 재지 않고 닫는다 — 따라다니는 목록은 어긋나기 쉽고 네이티브도 그 자리에서 닫힌다.
   * - 묶음 머리글은 `options` 밖의 그림이라 고를 수 없다 — 하이라이트 · 키 · 타이핑 점프는 `options` 번호로만 움직인다.
   * - `generics="V extends string"` — 칸이 `string` 으로 넓어지면 없는 값을 넣어도 타입이 잡아 주지 못한다.
   */
  let {
    id,
    value = $bindable(),
    options,
    disabled = false,
    ariaLabel,
    labelledby,
    onchange,
    prefix,
    align = "auto",
  }: {
    id?: string;
    value: V;
    options: readonly { value: V; label: string; icon?: string; group?: string }[];
    disabled?: boolean;
    ariaLabel?: string;
    labelledby?: string;
    onchange?: (value: V) => void;
    prefix?: string;
    align?: "auto" | "start";
  } = $props();

  const fallbackId = `dropdown-${++seq}-listbox`;
  const listId = $derived(id ? `${id}-listbox` : fallbackId);

  let open = $state(false);
  let sel = $state(0);
  let wrapEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 바깥(`listEl`)은 굴리지 않는다 — 글래스의 흐림 층이 내용과 함께 굴러가지 않게 */
  let scrollEl = $state<HTMLElement | null>(null);
  /** `.menu-surface.md3-list` 의 padding 6px × 2 */
  const LIST_PAD = 12;
  let rect = $state<{ left: number; top: number; bottom: number; width: number; right: number } | null>(null);
  const alignRight = $derived(
    align === "auto" && rect !== null && typeof window !== "undefined" && rect.left + rect.width / 2 > window.innerWidth / 2,
  );

  const index = $derived(options.findIndex((o) => o.value === value));

  /** `start` 는 첫 줄의 `options` 번호 */
  const segments = $derived.by(() => {
    const out: { group?: string; start: number; items: (typeof options)[number][] }[] = [];
    options.forEach((o, i) => {
      const last = out.at(-1);
      if (last && last.group === o.group) last.items.push(o);
      else out.push({ group: o.group, start: i, items: [o] });
    });
    return out;
  });
  const label = $derived(index >= 0 ? options[index].label : value);
  const curIcon = $derived(index >= 0 ? options[index].icon : undefined);

  let typed = "";
  let typedAt = 0;

  function gone(): boolean {
    return !triggerEl?.isConnected || triggerEl.offsetParent === null;
  }

  function openList(): void {
    if (disabled) return;
    const r = triggerEl?.getBoundingClientRect();
    if (!r) return;
    rect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width, right: window.innerWidth - r.right };
    sel = index >= 0 ? index : 0;
    typed = "";
    open = true;
  }

  function close(focusBack = true): void {
    if (!open) return;
    open = false;
    rect = null;
    // 스크롤을 되돌리지 않는다 — 패널이 스크롤돼 닫힌 경우 포커스가 화면을 다시 끌어당긴다
    if (focusBack) triggerEl?.focus({ preventScroll: true });
  }

  function pick(i: number): void {
    runOnMenu(
      () => options[i]?.value,
      () => close(),
      (next) => {
        const changed = next !== value;
        value = next;
        if (changed) onchange?.(next);
      },
    );
  }

  $effect(() => {
    const el = listEl;
    const r = rect;
    if (!el || !r) return;
    void sel; // 하이라이트가 옮겨 가면 그 줄을 보이는 자리로 끌어온다
    if (scrollEl) scrollEl.style.maxHeight = `${dropdownMaxHeight(r, window.innerHeight) - LIST_PAD}px`;
    el.style.top = `${placeBelowOrAbove(r, el.offsetHeight, window.innerHeight).top}px`;
    el.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => {
    if (open) listEl?.focus({ preventScroll: true });
  });

  // 캡처 단계여야 조상 패널의 스크롤까지 잡는다(스크롤은 버블하지 않는다). 목록 자신의 스크롤은 뺀다 — 고른 값이 목록 아래쪽이면
  // 여는 순간 `scrollIntoView` 가 굴린 스크롤에 열리자마자 닫힌다.
  $effect(() => {
    if (!open) return;
    const bail = () => close(!gone());
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

  function triggerKeydown(ev: KeyboardEvent): void {
    if (disabled) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (!open) openList();
    }
  }

  function listKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Tab") {
      close();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬(호스트 폼 닫기)로 새지 않게 여기서 끊는다
      close();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      pick(sel);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      sel = Math.min(sel + 1, options.length - 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      sel = 0;
    } else if (ev.key === "End") {
      ev.preventDefault();
      sel = options.length - 1;
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const now = Date.now();
      typed = now - typedAt > TYPEAHEAD_RESET_MS ? ev.key : typed + ev.key;
      typedAt = now;
      const hit = typeaheadIndex(
        options.map((o) => o.label),
        typed,
        sel,
      );
      if (hit >= 0) {
        ev.preventDefault();
        sel = hit;
      }
    }
  }
</script>

{#snippet row(o: (typeof options)[number], i: number)}
  <button
    id={`${listId}-o${i}`}
    type="button"
    tabindex="-1"
    class="row menu-row"
    class:selected={i === sel}
    data-sel={i === sel ? "" : undefined}
    data-value={o.value}
    role="option"
    aria-selected={o.value === value}
    onmouseenter={() => (sel = i)}
    onclick={() => pick(i)}
  >
    {#if o.icon}<span class="ico"><HostIcon icon={o.icon} size={14} /></span>{/if}
    <span class="opt-text">{o.label}</span>
    {#if o.value === value}<span class="check"><UiIcon name="check" size={12} /></span>{/if}
  </button>
{/snippet}

<div
  class="dd"
  bind:this={wrapEl}
  onfocusout={(ev) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && wrapEl?.contains(to)) return;
    close(false);
  }}
>
  <button
    {id}
    type="button"
    class="trigger"
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listId}
    aria-label={ariaLabel}
    {disabled}
    bind:this={triggerEl}
    onclick={() => (open ? close() : openList())}
    onkeydown={triggerKeydown}
  >
    <span class="cur">
      {#if prefix}<span class="prefix">{prefix}</span>{/if}
      {#if curIcon}<span class="ico"><HostIcon icon={curIcon} size={14} /></span>{/if}
      <span class="cur-text">{label}</span>
    </span>
    <UiIcon name="chevron-down" size={13} />
  </button>

  {#if open && rect}
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
      tabindex="-1"
      aria-label={labelledby ? undefined : ariaLabel}
      aria-labelledby={labelledby}
      aria-activedescendant={`${listId}-o${sel}`}
      bind:this={listEl}
      style:left={alignRight ? undefined : `${rect.left}px`}
      style:right={alignRight ? `${rect.right}px` : undefined}
      style:min-width="{rect.width}px"
      style:width="max-content"
      style:max-width="calc(100vw - 16px)"
      style:top="{rect.bottom + DROPDOWN_GAP}px"
      onkeydown={listKeydown}
    >
      <div class="md3-scroll" bind:this={scrollEl}>
      {#each segments as seg, si (seg.start)}
        {#if seg.group}
          <div class="group" role="group" aria-labelledby={`${listId}-g${si}`}>
            <div id={`${listId}-g${si}`} class="menu-title group-head" role="presentation">{seg.group}</div>
            {#each seg.items as o, k (o.value)}{@render row(o, seg.start + k)}{/each}
          </div>
        {:else}
          {#if si > 0}<div class="menu-sep" aria-hidden="true"></div>{/if}
          {#each seg.items as o, k (o.value)}{@render row(o, seg.start + k)}{/each}
        {/if}
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

  .prefix {
    flex: 0 0 auto;
    opacity: 0.8;
    white-space: nowrap;
  }

  .cur-text,
  .opt-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ico {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .opt-text {
    flex: 1 1 auto;
  }

  /* `.md3-list .menu-row` 의 안쪽 여백(--space-3)과 같은 x 에서 시작한다 */
  .group-head {
    padding: var(--space-2) var(--space-3) var(--space-1);
    user-select: none;
  }

  .group + .group {
    margin-top: var(--space-1);
  }

  .check {
    display: inline-flex;
    flex: 0 0 auto;
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

  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

</style>
