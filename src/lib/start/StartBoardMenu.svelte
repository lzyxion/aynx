<script lang="ts">
  import { tick } from "svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
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
   * **시작 화면 판의 우클릭 메뉴** (docs/log/2026-10-28-start-widgets.md) — 빈 자리나 시계 아닌 위젯 위를 우클릭하면(위젯을 더하는 길은 이것 하나)
   *  · 평소(잠김) = `배치 편집` 한 줄
   *  · 편집 중 = `위젯 추가 ▸`(옆목록에 네 종류 — 시계 · 최근 호스트 · 프로젝트 · 셸, 이미 놓인 것은 흐리게 "놓임" — 종류마다 하나)
   *    · 구분선 · `편집 완료` · `되돌리기` · `레이아웃 리셋`(판 위 편집 단추 줄과 같은 동작 · 위젯 메뉴에는 없다)
   *    (2026-11-03 — 가지런히 정리는 사용자가 걷었다)
   *
   * 상자 모양은 앱 메뉴 한 벌(`.menu-surface` · `.menu-row` · `.menu-sep` · `.menu-kbd`), 옆목록의 자리 · 뜸 · 키는 타일 ⋯ 메뉴와 같은
   * `$lib/menu-flyout`. `document.body` 로 옮겨 그린다(`ImageMenu` 와 같은 까닭 — 타일 상자 안에서는 `position: fixed` 의 기준이
   * 창이 아닐 수 있다). 항목 핸들러는 **메뉴 통로 하나**를 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를
   * 닫는 코드"): 스냅샷 → 닫기 → 실행.
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
    /** 연 자리(창 좌표 — 우클릭한 포인터) */
    x: number;
    y: number;
    /** 이미 판에 놓인 종류 */
    placed: readonly StartWidgetKind[];
    /** 되돌릴 배치 조작이 있는가 — 없으면 [되돌리기]가 흐리다 */
    canUndo: boolean;
    /** 편집 모드인가 — [배치 편집] 줄이 [편집 완료]로 */
    editing: boolean;
    /** 편집 모드 들어가기 · 나오기 — 메뉴가 닫힌 **뒤** 불린다 */
    onedit: () => void;
    onclose: () => void;
    /** 바로 앞 배치로 — 메뉴가 닫힌 **뒤** 불린다 */
    onundo: () => void;
    /** 고른 종류 — 메뉴가 닫힌 **뒤** 불린다 */
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

  /** 이 노드를 `body` 끝으로 옮긴다(머리말의 까닭) — 사라질 때 함께 걷는다 */
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

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게(`ImageMenu` · `TreeMenu` 와 같은 클램프)
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

  /** 옆목록을 그 줄 옆에 — 처음엔 어림 크기, 그려진 뒤 실제 크기로 고친다 */
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

  /** 누를 수 있는 줄들(흐린 줄 빼고) */
  function enabledItems(box: HTMLElement): HTMLElement[] {
    return [...box.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (el) => el.getAttribute("aria-disabled") !== "true" && !(el as HTMLButtonElement).disabled,
    );
  }

  /** ↑↓ 로 상자 안의 누를 수 있는 줄 사이를 돈다 · Escape 는 한 켜씩 닫는다 · →← 는 옆목록을 여닫는다 */
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
    <!-- 위젯 추가 · 되돌리기 · 레이아웃 리셋은 **편집 중에만**(사용자 결정 2026-11-03 — 배치를 고치는 줄은 휴대폰 홈 화면처럼
         편집 모드 안에만 둔다 · 잠긴 평소 메뉴는 [배치 편집] 한 줄) -->
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
        <span class="menu-kbd" aria-hidden="true">▸</span>
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

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 독(z 100) 위(`ImageMenu` · 독 즐겨찾기 메뉴와 같은 층) */
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

  /* 줄 = 글자 + 오른쪽 부연(`▸` · "놓임") */
  .row {
    display: flex;
    align-items: center;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
