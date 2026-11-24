<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    isGroup,
    rowId,
    type PaneFlyoutId,
    type PaneMenuAction,
    type PaneMenuRow,
  } from "$lib/pane/pane-menu";
  import {
    FLYOUT_CLOSE_MS,
    FLYOUT_EST_ROW,
    FLYOUT_EST_WIDTH,
    FLYOUT_OPEN_MS,
    flyoutKeyAction,
    placeFlyout,
  } from "$lib/menu-flyout";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * 타일 ⋯ 메뉴 — 대상 스냅샷 · 닫기 순서는 통로(`tile-menu-controller` 의 `runTileMenu` → `runOnMenu`)가 든다.
   * - 타일 상자 밖에 한 벌만 그린다 — `.pane-box` 는 `isolation: isolate` 라 안의 `position: fixed` 가 이웃 타일 · 분할선에 덮인다.
   * - 옆목록은 메뉴 상자의 형제다 — 메뉴가 `overflow-y: auto` 라 안에 넣으면 잘린다.
   */
  let {
    title,
    items,
    left,
    top,
    onrun,
    /** `"none"` 은 포커스를 옮기지 않는다 — 이미 다른 곳으로 가는 중이라 여기서 옮기면 서로 낚아챈다 */
    onclose,
  }: {
    title: string;
    items: readonly PaneMenuRow[];
    left: number;
    top: number;
    onrun: (action: PaneMenuAction) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  // ── 옆으로 뜨는 목록 (docs/log/2026-09-17-tile-menu-flyouts.md) ────────────

  let flyout = $state<PaneFlyoutId | null>(null);
  let flyoutLeft = $state(0);
  let flyoutTop = $state(0);
  let flyoutEl = $state<HTMLElement | null>(null);

  const openGroup = $derived(items.filter(isGroup).find((g) => g.flyout === flyout) ?? null);

  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFlyoutTimers() {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    hoverTimer = null;
    closeTimer = null;
  }

  $effect(() => () => clearFlyoutTimers());

  /** `data-flyout` 은 하네스 스크립트의 손잡이이기도 하다 */
  function rowElement(kind: PaneFlyoutId): HTMLButtonElement | null {
    return el?.querySelector<HTMLButtonElement>(`[data-flyout="${kind}"]`) ?? null;
  }

  function placeFlyoutNow(kind: PaneFlyoutId) {
    const row = rowElement(kind)?.getBoundingClientRect();
    const menu = el?.getBoundingClientRect();
    if (!row || !menu) return;
    const count = items.filter(isGroup).find((g) => g.flyout === kind)?.children.length ?? 0;
    const size = flyoutEl
      ? { width: flyoutEl.offsetWidth, height: flyoutEl.offsetHeight }
      : { width: FLYOUT_EST_WIDTH, height: count * FLYOUT_EST_ROW + 8 };
    const at = placeFlyout(row, menu, size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    flyoutLeft = at.left;
    flyoutTop = at.top;
  }

  function openFlyout(kind: PaneFlyoutId, focusFirst = false) {
    clearFlyoutTimers();
    flyout = kind;
    placeFlyoutNow(kind);
    if (!focusFirst) return;
    void tick().then(() => flyoutEl?.querySelector("button")?.focus());
  }

  function closeFlyout() {
    clearFlyoutTimers();
    flyout = null;
  }

  /** 다른 줄의 목록이 떠 있어도 같은 뜸 뒤에 갈아 끼운다 — 옆 줄로 스치기만 해도 목록이 바뀌지 않게 */
  function hoverRow(kind: PaneFlyoutId, disabled: boolean) {
    if (disabled) return;
    clearFlyoutTimers();
    if (flyout === kind) return;
    hoverTimer = setTimeout(() => openFlyout(kind), FLYOUT_OPEN_MS);
  }

  /** 줄 ↔ 목록 사이 빈틈을 지나는 손을 위해 조금 뒤에 닫는다 */
  function leaveSoon() {
    clearFlyoutTimers();
    closeTimer = setTimeout(() => (flyout = null), FLYOUT_CLOSE_MS);
  }

  /** 이미 떠 있으면 닫지 않는다 — 호버로 막 열린 목록을 그 줄을 누르려던 클릭이 닫아 버린다 */
  function toggleFlyout(kind: PaneFlyoutId) {
    if (flyout !== kind) openFlyout(kind);
    else clearFlyoutTimers();
  }

  function rowKey(ev: KeyboardEvent, kind: PaneFlyoutId, disabled: boolean) {
    if (disabled || flyoutKeyAction(ev.key, "row") !== "open") return;
    ev.preventDefault();
    openFlyout(kind, true);
  }

  $effect(() => {
    const kind = flyout;
    if (kind === null || !flyoutEl) return;
    placeFlyoutNow(kind);
  });

  /** Escape 는 여기서 끊고 한 켜만 닫는다 — 목록은 메뉴의 형제라 `onKey` 를 지나지 않고, 창 전역까지 가면 뒤 화면까지 닫힌다 */
  function onFlyoutKey(ev: KeyboardEvent) {
    const node = flyoutEl;
    const back = flyout;
    if (!node || back === null) return;
    if (ev.key === "Escape" || flyoutKeyAction(ev.key, "flyout") === "close") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFlyout();
      rowElement(back)?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    moveFocus(node, ev.key);
  }

  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  /** `left` · `items` 도 읽는다 — 나란한 두 타일의 머리줄은 `top` 이 같아 세로만 보면 갈아탄 것을 못 알아챈다 */
  $effect(() => {
    void left;
    void items;
    void top;
    clamped = null;
  });

  $effect(() => {
    const node = el;
    const t = shownTop;
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    // 옆목록에 간 포커스는 뺏지 않는다 — 목록은 상자 밖(형제)이라 `node.contains` 로는 안 보인다
    const focused = document.activeElement;
    if (!node.contains(focused) && !flyoutEl?.contains(focused)) {
      node.focus({ preventScroll: true });
    }
  });

  /**
   * 바깥을 누르면 닫는다 — ⋯ 버튼은 자기 click 이 토글한다.
   * 옆목록도 "안" 이다 — 빼먹으면 목록의 줄을 누르는 순간 메뉴가 닫혀 그 항목이 조용히 죽는다.
   */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (el?.contains(t) || flyoutEl?.contains(t)) return;
      if (t instanceof Element && t.closest("[data-tile-menu-btn]")) return;
      onclose("none");
    };
    const onResize = () => onclose("none");
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  });

  /** Escape 는 여기서 끊는다 — 창 전역 Escape 까지 가면 뒤에 있는 화면까지 함께 닫힌다 */
  function onKey(ev: KeyboardEvent) {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      const back = flyout;
      if (back !== null) {
        closeFlyout();
        rowElement(back)?.focus();
        return;
      }
      onclose("trigger");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    moveFocus(node, ev.key);
  }

  function moveFocus(node: HTMLElement, key: string) {
    const buttons = Array.from(
      node.querySelectorAll<HTMLButtonElement>("button.item:not([disabled])"),
    );
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = key === "ArrowDown";
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? buttons.length - 1
          : at < 0
            ? down
              ? 0
              : buttons.length - 1
            : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<!-- 켜고 끄는 줄의 ✓ — 앞자리는 그 줄의 그림이라 끝 칸에 둔다(꺼져 있어도 칸 폭은 남긴다) -->
{#snippet checkMark(on: boolean)}
  <span class="tick" aria-hidden="true">{#if on}<UiIcon name="check" size={14} />{/if}</span>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tilemenu menu-surface"
  role="menu"
  aria-label={tr("pane.menu.aria", { title })}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <p class="group menu-title" {title}>{title}</p>
  {#each items as item (rowId(item))}
    {#if item.separator}
      <hr class="menu-sep" />
    {/if}
    {#if isGroup(item)}
      <button
        type="button"
        class="item parent menu-row"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={flyout === item.flyout}
        data-flyout={item.flyout}
        disabled={item.disabled}
        title={item.title}
        onclick={() => toggleFlyout(item.flyout)}
        onkeydown={(ev) => rowKey(ev, item.flyout, item.disabled === true)}
        onpointerenter={() => hoverRow(item.flyout, item.disabled === true)}
        onpointerleave={leaveSoon}
      >
        <span class="mark menu-mark"
          >{#if item.icon}<UiIcon name={item.icon} size={14} />{/if}</span
        >{item.label}<span class="chev menu-kbd"
          ><UiIcon name="chevron" size={12} /></span
        >
      </button>
    {:else}
      <button
        type="button"
        class="item menu-row"
        class:hinted={!!item.hint || item.checkbox}
        role={item.checkbox ? "menuitemcheckbox" : "menuitem"}
        aria-checked={item.checkbox ? item.checked : undefined}
        data-action={item.action}
        disabled={item.disabled}
        title={item.title}
        onclick={() => onrun(item.action)}
      >
        <!-- `.mark` 안에는 공백도 넣지 않는다 — inline-flex 칸이라 공백 노드가 flex 항목이 되어 아이콘이 밀린다 -->
        <span class="mark menu-mark"
          >{#if item.icon}<UiIcon name={item.icon} size={14} />{/if}</span
        >{item.label}{#if item.hint}<kbd class="menu-kbd" data-menu-hint>{item.hint}</kbd>{/if}{#if item.checkbox}{@render checkMark(item.checked === true)}{/if}
      </button>
    {/if}
  {/each}
</div>

{#if openGroup}
  <div
    class="flyout menu-surface"
    role="menu"
    aria-label={openGroup.label}
    tabindex="-1"
    bind:this={flyoutEl}
    style="left:{flyoutLeft}px;top:{flyoutTop}px"
    onpointerenter={clearFlyoutTimers}
    onpointerleave={leaveSoon}
    onkeydown={onFlyoutKey}
  >
    {#each openGroup.children as child (child.action)}
      <button
        type="button"
        class="item menu-row"
        class:hinted={!!child.hint || child.checkbox}
        role={child.checkbox ? "menuitemcheckbox" : "menuitem"}
        aria-checked={child.checkbox ? child.checked : undefined}
        data-action={child.action}
        disabled={child.disabled}
        title={child.title}
        onclick={() => onrun(child.action)}
      >
        <span class="mark menu-mark"
          >{#if child.icon}<UiIcon
              name={child.icon}
              size={14}
            />{/if}</span
        >{child.label}{#if child.hint}<kbd class="menu-kbd" data-menu-hint>{child.hint}</kbd>{/if}{#if child.checkbox}{@render checkMark(child.checked === true)}{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .tilemenu {
    position: fixed;
    z-index: 20; /* 분할선(.lines: 2)·포커스 타일(1) 위 — 캔버스 안에서 가장 높다 */
    min-width: 180px;
    max-width: 240px;
    max-height: 60vh;
    overflow-y: auto;
  }

  /* `▸` 를 끝으로 밀려고 이 줄만 flex 다. `gap` 은 쓰지 않는다 — 글자 시작 x 가 다른 줄과 같아야 한다 */
  .item.parent {
    display: flex;
    align-items: center;
  }

  .item.hinted {
    display: flex;
    align-items: center;
  }

  /* 단축키가 없으면 끝으로 밀고, 있으면 단축키 바로 뒤 — 단축키 → ✓ 순 */
  .tick {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: auto;
    padding-left: var(--space-3);
    color: var(--fg-2);
  }

  .menu-kbd + .tick {
    margin-left: var(--space-2);
    padding-left: 0;
  }

  .item.parent .chev {
    display: inline-flex;
  }

  /* 메뉴(20)보다 한 칸 위 — 왼쪽으로 넘어갔을 때 메뉴에 가리지 않게 */
  .flyout {
    position: fixed;
    z-index: 21;
    min-width: 160px;
    max-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
  }
</style>
