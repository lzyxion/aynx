<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { dockPinned } from "$lib/floating-dock-pin.svelte.js";
  import { inDockHover } from "$lib/floating-dock";
  import { favoriteDropKind } from "$lib/favorite-drop";

  /** 하단 중앙 호버 독 — 창 아래 가운데에 커서를 대면 올라온다. 모달 · 가림막(`blocked`) 동안은 고정이어도 숨는다 */
  let {
    children,
    busy = false,
    blocked = false,
    bottomInset = "0px",
    oncollapse,
  }: {
    children: Snippet;
    busy?: boolean;
    blocked?: boolean;
    /** 하단 상태바가 차지하는 높이(바깥 여백 포함) */
    bottomInset?: string;
    oncollapse: () => void;
  } = $props();
  let root = $state<HTMLDivElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let expanded = $state(false);
  let hovered = $state(false);
  let keyboardWithin = $state(false);
  let dismissed = false;
  let previousFocus: HTMLElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 모달 · 가림막(`blocked`)은 고정보다 먼저다 */
  const pinned = $derived(dockPinned());

  function clearTimer(): void {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  }
  function reveal(): void {
    if (blocked || dismissed) return;
    if (!expanded && document.activeElement instanceof HTMLElement && !root?.contains(document.activeElement)) {
      previousFocus = document.activeElement;
    }
    clearTimer();
    expanded = true;
  }
  function collapse(restoreFocus = false): void {
    if (pinned && !blocked) return;
    clearTimer();
    dismissed = hovered;
    expanded = false;
    oncollapse();
    keyboardWithin = false;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  /** 창 좌표로 감지한다 — 닫힌 투명 영역이 터미널 클릭을 가로채지 않게 */
  function hoverAt(x: number, y: number, target: EventTarget | null): void {
    const zone = root?.getBoundingClientRect() ?? null;
    const showing = !!panel && (expanded || getComputedStyle(panel).visibility === "visible");
    hovered = inDockHover(x, y, window.innerWidth, zone, showing ? panel!.getBoundingClientRect() : null)
      || (expanded && target instanceof Node && !!root?.contains(target));
    if (!hovered) dismissed = false;
    else reveal();
  }
  function pointerMove(ev: PointerEvent): void {
    if (ev.pointerType === "touch") return;
    hoverAt(ev.clientX, ev.clientY, ev.target);
  }

  // ── 끄는 동안 열기 ──
  // 여기서는 `preventDefault` 하지 않는다 — 받는 일은 `DockFavorites` 가 하고, 독 밖의 드롭은 그대로 살아야 한다.
  let dragging = false;
  let dragQuiet: ReturnType<typeof setTimeout> | null = null;
  function dragDone(): void {
    if (dragQuiet !== null) clearTimeout(dragQuiet);
    dragQuiet = null;
    if (!dragging) return;
    dragging = false;
    hovered = false;
    dismissed = false;
  }
  function dropped(ev: DragEvent): void {
    const was = dragging;
    dragDone();
    if (was) hoverAt(ev.clientX, ev.clientY, ev.target);
  }
  function dragOver(ev: DragEvent): void {
    if (favoriteDropKind(ev.dataTransfer?.types) === null) return;
    dragging = true;
    dismissed = false;
    hoverAt(ev.clientX, ev.clientY, ev.target);
    // `dragover` 는 멈춰 있어도 계속 온다(명세 350ms 안팎) — 끊기면 창 밖으로 나갔다고 본다
    if (dragQuiet !== null) clearTimeout(dragQuiet);
    dragQuiet = setTimeout(dragDone, 600);
  }
  function focusIn(ev: FocusEvent): void {
    if (ev.target === root && ev.relatedTarget instanceof HTMLElement) previousFocus = ev.relatedTarget;
    keyboardWithin = ev.target instanceof HTMLElement && ev.target.matches(":focus-visible");
    if (keyboardWithin) { dismissed = false; reveal(); }
  }
  function focusOut(ev: FocusEvent): void {
    if (!(ev.relatedTarget instanceof Node) || !root?.contains(ev.relatedTarget)) keyboardWithin = false;
  }
  $effect(() => {
    clearTimer();
    if (blocked) { if (expanded) collapse(); return; }
    if (pinned) { expanded = true; return; }
    if (expanded && !hovered && !keyboardWithin && !busy) closeTimer = setTimeout(() => collapse(), 260);
    return clearTimer;
  });
  onMount(() => {
    const outside = (ev: PointerEvent) => {
      if (expanded && ev.target instanceof Node && !root?.contains(ev.target)) collapse();
    };
    const key = (ev: KeyboardEvent) => {
      // 하위 메뉴가 첫 Escape 를 처리한다. 고정이면 Escape 를 삼키지 않는다
      if (ev.key !== "Escape" || !expanded || busy || blocked || pinned) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      collapse(root?.contains(document.activeElement) ?? false);
    };
    const leaveWindow = (ev: PointerEvent) => {
      if (ev.relatedTarget === null && (ev.clientX < 0 || ev.clientX >= innerWidth || ev.clientY < 0 || ev.clientY >= innerHeight)) {
        hovered = false; dismissed = false;
      }
    };
    const blur = () => { hovered = false; collapse(); };
    const resize = () => { hovered = false; collapse(); };
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerout", leaveWindow);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    window.addEventListener("dragover", dragOver, true);
    window.addEventListener("drop", dropped, true);
    window.addEventListener("dragend", dragDone, true);
    return () => {
      clearTimer();
      dragDone();
      window.removeEventListener("dragover", dragOver, true);
      window.removeEventListener("drop", dropped, true);
      window.removeEventListener("dragend", dragDone, true);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerout", leaveWindow);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
    };
  });
</script>

<div class="floating-status-dock" data-floating-status-dock data-expanded={expanded}
  style:--floating-status-inset={bottomInset}
  role="toolbar" tabindex={blocked ? -1 : 0} aria-label={t("app.start.favorites.aria")}
  hidden={blocked} bind:this={root} onfocusin={focusIn} onfocusout={focusOut}>
  <div class="floating-status-panel" class:expanded aria-hidden={!expanded} inert={!expanded} bind:this={panel}>
    {@render children()}
  </div>
</div>

<style>
  .floating-status-dock {
    position: fixed;
    inset-inline: 0;
    bottom: var(--floating-status-inset);
    z-index: 101;
    width: fit-content;
    min-width: 180px;
    height: 16px;
    max-width: calc(100vw - 24px);
    margin-inline: auto;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
    outline: none;
  }
  .floating-status-dock[hidden] { display: none; }
  /* 숨은 자리는 독 높이 + 여백보다 아래여야 한다(칸 = 44px 한 줄 + 안쪽 6px 기준) */
  .floating-status-panel {
    position: relative;
    bottom: -72px;
    max-width: 100%;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: bottom 180ms ease-in, opacity 180ms ease-in, visibility 0s 180ms;
  }
  /* transform 이 아니라 bottom 을 움직인다 — fixed 하위 메뉴가 창 좌표를 그대로 쓰게 */
  .floating-status-panel.expanded {
    bottom: var(--gap);
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition: bottom 180ms ease-out, opacity 180ms ease-out, visibility 0s;
  }
  /* 글래스 — 패널에 `opacity` 를 걸면 움직이는 동안 유리 흐림이 창 뒤를 못 본다(theme.css 모달 등장 절). 안의 칸만 페이드한다 */
  :global(:root[data-material="glass"]) .floating-status-panel {
    --floating-in: 0;
    opacity: 1;
    transition: bottom 180ms ease-in, --floating-in 180ms ease-in, visibility 0s 180ms;
  }
  :global(:root[data-material="glass"]) .floating-status-panel.expanded {
    --floating-in: 1;
    transition: bottom 180ms ease-out, --floating-in 180ms ease-out, visibility 0s;
  }
  :global(:root[data-material="glass"]) .floating-status-panel > :global(*) {
    transition: background-color 180ms ease-out, border-color 180ms ease-out, box-shadow 180ms ease-out;
  }
  :global(:root[data-material="glass"]) .floating-status-panel:not(.expanded) > :global(*) {
    background-color: transparent;
    border-color: transparent;
    box-shadow: none;
    transition-timing-function: ease-in;
  }
  /* 끌기 잔상 · 우클릭 메뉴는 제 불투명도를 쓴다 — 메뉴는 그 자체가 글래스 면이라 `opacity` 를 받으면 안 된다 */
  :global(:root[data-material="glass"]) .floating-status-panel > :global(*) > :global(:not(.dock-fav-ghost, .menu-surface)) {
    opacity: var(--floating-in);
  }
  @media (prefers-reduced-motion: reduce) {
    .floating-status-panel,
    :global(:root[data-material="glass"]) .floating-status-panel,
    :global(:root[data-material="glass"]) .floating-status-panel.expanded,
    :global(:root[data-material="glass"]) .floating-status-panel > :global(*) {
      transition: none;
    }
  }
</style>
