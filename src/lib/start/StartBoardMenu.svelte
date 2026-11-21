<script lang="ts">
  import { tick } from "svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    FLYOUT_CLOSE_MS,
    FLYOUT_EST_ROW,
    FLYOUT_EST_WIDTH,
    FLYOUT_OPEN_MS,
    flyoutKeyAction,
    placeFlyout,
  } from "$lib/menu-flyout";
  import { START_WIDGET_KINDS, type StartWidgetKind } from "$lib/start-widgets";

  /**
   * 시작 화면 판의 우클릭 메뉴 — 위젯을 더하는 길은 이것 하나다. `document.body` 로 옮겨 그린다 — 타일 상자 안에서는 `position: fixed` 의
   * 기준이 창이 아닐 수 있다. 항목 핸들러는 메뉴 통로(`$lib/browser/menu-runner`)를 지난다: 스냅샷 → 닫기 → 실행.
   */
  let {
    x,
    y,
    placed,
    canUndo,
    editing,
    onclose,
    onundo,
    onedit,
    onadd,
    onreset,
  }: {
    x: number;
    y: number;
    placed: readonly StartWidgetKind[];
    canUndo: boolean;
    editing: boolean;
    onedit: () => void;
    onclose: () => void;
    onundo: () => void;
    onadd: (kind: StartWidgetKind) => void;
    onreset: () => void;
  } = $props();

  const KIND_LABEL = {
    clock: "app.start.col.clock",
    hosts: "app.start.col.hosts",
    projects: "app.start.col.projects",
    shells: "app.start.col.shells",
  } as const;

  let menuEl = $state<HTMLElement | null>(null);
  let flyoutEl = $state<HTMLElement | null>(null);
  let flyout = $state(false);
  let flyoutLeft = $state(0);
  let flyoutTop = $state(0);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function clearTimers() {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (closeTimer) clearTimeout(closeTimer);
    hoverTimer = closeTimer = null;
  }
  $effect(() => () => clearTimers());

  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  $effect(() => {
    if (menuEl) enabledItems(menuEl)[0]?.focus();
  });

  function placeFlyoutNow() {
    const row = menuEl?.querySelector<HTMLElement>("[data-board-menu='add']");
    if (!row || !menuEl) return;
    const size = flyoutEl
      ? { width: flyoutEl.offsetWidth, height: flyoutEl.offsetHeight }
      : { width: FLYOUT_EST_WIDTH, height: FLYOUT_EST_ROW * START_WIDGET_KINDS.length + 8 };
    const at = placeFlyout(row.getBoundingClientRect(), menuEl.getBoundingClientRect(), size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    flyoutLeft = at.left;
    flyoutTop = at.top;
  }

  $effect(() => {
    if (flyout && flyoutEl) placeFlyoutNow();
  });

  function openFlyout(focusFirst = false) {
    clearTimers();
    flyout = true;
    placeFlyoutNow();
    if (focusFirst) void tick().then(() => flyoutEl && enabledItems(flyoutEl)[0]?.focus());
  }

  function closeFlyout(refocusRow = false) {
    clearTimers();
    flyout = false;
    if (refocusRow) menuEl?.querySelector<HTMLElement>("[data-board-menu='add']")?.focus();
  }

  function hoverAddRow() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    if (flyout || hoverTimer) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      openFlyout();
    }, FLYOUT_OPEN_MS);
  }

  function leaveAddRow() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    if (!flyout) return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      flyout = false;
    }, FLYOUT_CLOSE_MS);
  }

  function enabledItems(box: HTMLElement): HTMLElement[] {
    return [...box.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (el) => el.getAttribute("aria-disabled") !== "true" && !(el as HTMLButtonElement).disabled,
    );
  }

  function onKeydown(ev: KeyboardEvent, at: "menu" | "flyout") {
    const box = at === "menu" ? menuEl : flyoutEl;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (at === "flyout") closeFlyout(true);
      else onclose();
      return;
    }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && box) {
      ev.preventDefault();
      ev.stopPropagation();
      const items = enabledItems(box);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const onRow = at === "menu" && target?.dataset.boardMenu === "add";
    const action = flyoutKeyAction(ev.key, onRow ? "row" : "flyout");
    if (onRow && action === "open") {
      ev.preventDefault();
      ev.stopPropagation();
      openFlyout(true);
    } else if (at === "flyout" && action === "close") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFlyout(true);
    }
  }
</script>

{#snippet kindRows()}
  {#each START_WIDGET_KINDS as kind (kind)}
    {@const isPlaced = placed.includes(kind)}
    <button
      type="button"
      class="menu-row row"
      role="menuitem"
      aria-disabled={isPlaced}
      data-board-add={kind}
      onclick={() => {
        if (!isPlaced) runOnMenu(() => kind, onclose, (k) => onadd(k));
      }}
    >
      <span class="label">{t(KIND_LABEL[kind])}</span>
      {#if isPlaced}<span class="menu-kbd">{t("app.start.board.menu.placed")}</span>{/if}
    </button>
  {/each}
{/snippet}

<div class="portal" use:portal>
  <button
    type="button"
    class="menu-backdrop"
    tabindex="-1"
    aria-label={t("files.menu.close.aria")}
    onclick={onclose}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      onclose();
    }}
  ></button>
  <div
    class="board-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t("app.start.board.menu.aria")}
    data-start-board-menu="board"
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={(ev) => onKeydown(ev, "menu")}
  >
    <!-- 위젯 추가 · 되돌리기 · 레이아웃 리셋은 편집 중에만 둔다(사용자 결정) — 잠긴 평소 메뉴는 [배치 편집] 한 줄 -->
    {#if editing}
      <button
        type="button"
        class="menu-row row"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={flyout}
        data-board-menu="add"
        onclick={() => (flyout ? closeFlyout() : openFlyout(true))}
        onpointerenter={hoverAddRow}
        onpointerleave={leaveAddRow}
      >
        <span class="label">{t("app.start.board.menu.add")}</span>
        <span class="chev menu-kbd" aria-hidden="true"><UiIcon name="chevron" size={12} /></span>
      </button>
      <div class="menu-sep" role="separator"></div>
    {/if}
    <button
      type="button"
      class="menu-row row"
      role="menuitem"
      data-board-menu="edit"
      onpointerenter={() => flyout && leaveAddRow()}
      onclick={() => runAfterClose(onclose, onedit)}
      >{t(editing ? "app.start.board.edit.finish" : "app.start.board.edit.start")}</button
    >
    {#if editing}
      <button
        type="button"
        class="menu-row row"
        role="menuitem"
        disabled={!canUndo}
        data-board-menu="undo"
        onpointerenter={() => flyout && leaveAddRow()}
        onclick={() => runAfterClose(onclose, onundo)}>{t("app.start.board.menu.undo")}</button
      >
      <button
        type="button"
        class="menu-row row"
        role="menuitem"
        data-board-menu="reset"
        onpointerenter={() => flyout && leaveAddRow()}
        onclick={() => runAfterClose(onclose, onreset)}>{t("app.start.board.menu.reset")}</button
      >
    {/if}
  </div>
  {#if flyout}
    <div
      class="board-flyout menu-surface"
      role="menu"
      tabindex="-1"
      aria-label={t("app.start.board.menu.add")}
      data-start-board-flyout
      style:left="{flyoutLeft}px"
      style:top="{flyoutTop}px"
      bind:this={flyoutEl}
      onkeydown={(ev) => onKeydown(ev, "flyout")}
      onpointerenter={() => {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
      }}
      onpointerleave={leaveAddRow}
    >
      {@render kindRows()}
    </div>
  {/if}
</div>

<style>
  .portal {
    display: contents;
  }

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 독(z 100) 위 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .board-menu,
  .board-flyout {
    position: fixed;
    z-index: 106;
    min-width: 180px;
    max-width: 280px;
  }

  .board-flyout {
    z-index: 107;
  }

  .row {
    display: flex;
    align-items: center;
  }

  /* 글자 `▸` 대신 chevron 아이콘 — 글자는 작아 잘 안 보였다 */
  .chev {
    display: inline-flex;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
