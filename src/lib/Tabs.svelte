<script lang="ts">
  import { tick } from "svelte";
  import type { TransitionConfig } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { isMainWindow } from "$lib/app/window.svelte.js";
  import { currentWorkspace, currentWorkspaceId, reorderWorkspaces, workspaceList, workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { openWorkspace } from "$lib/app/workspace-actions.svelte.js";
  import { reorderWorkspaceIds, workspaceDropBefore } from "$lib/workspaces/sidebar";
  import { workspaceSheetBuckets } from "$lib/console/window-cards";
  import WorkspaceIcon from "$lib/WorkspaceIcon.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import EqBars from "$lib/orchestration/EqBars.svelte";
  import { pulseOfRun } from "$lib/app/orch-pulse.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { shortcutTitle } from "$lib/status-items";
  import {
    draggingTab,
    listPanes,
    type TabSpec,
  } from "$lib/session";
  import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
  import type { TabCommandStatus } from "$lib/app/tabs.svelte.js";
  import type { HostsDrag } from "$lib/hosts";
  import { tabDot, tabDotInput, tabHasUnseen, type TabDotAgent } from "$lib/tab-dot";
  import { elidedTabIds, tabCapacity, type TabFit } from "$lib/tab-overflow";
  import { DEV_INSTANCE } from "$lib/app/instance";
  import { dirtyDocPanes } from "$lib/app/doc-dirty.svelte.js";
  import { DEFAULT_TAB_STYLE, settings, type TabStyle } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import TabOverflowMenu from "$lib/tabbar/TabOverflowMenu.svelte";
  import TabContextMenu from "$lib/tabbar/TabContextMenu.svelte";
  import WorkspacePicker from "$lib/tabbar/WorkspacePicker.svelte";
  import { menuEscape, menuRows } from "$lib/tabbar/tab-menu";
  import { createTabDrag } from "$lib/tabbar/tab-drag.svelte.js";
  import TabStatusGlyph, { tabIconPane } from "$lib/tabbar/TabStatusGlyph.svelte";

  let {
    tabs,
    activeId,
    hasActivity = {},
    tabStatus = {},
    tabBells = {},
    agents = {},
    onagentdot,
    tabStyle = DEFAULT_TAB_STYLE,
    onselect,
    ondragselect,
    onclose,
    oncloseothers,
    oncloseright,
    onrename,
    onnewtab,
    onreorder,
    onpromotepane,
    ondrophosts,
    ontearstart,
    ontearout,
    ontearrefused,
    ontearmerge,
    syncTabs,
    onsynctoggle,
  }: {
    tabs: TabSpec[];
    activeId: string | null;
    hasActivity?: Record<string, boolean>;
    tabStyle?: TabStyle;
    tabStatus?: Record<string, TabCommandStatus>;
    tabBells?: Record<string, boolean>;
    agents?: Record<string, TabDotAgent[]>;
    onagentdot?: (tabId: string) => void;
    onselect: (id: string) => void;
    /**
     * 타일 드래그 중 머문 탭은 슬라이드 없이 연다 — 캔버스가 미끄러지는 동안 드롭 판정의 상자 좌표 스냅숏이 움직이는 상자를 찍는다.
     */
    ondragselect?: (id: string) => void;
    onclose: (id: string) => void;
    oncloseothers?: (id: string) => void;
    oncloseright?: (id: string) => void;
    /** 빈 문자열 = 이름 지우기(자동 제목으로) */
    onrename?: (id: string, name: string) => void;
    onnewtab: () => void;
    /** `beforeId` 앞으로(null 이면 맨 뒤로) — `onpromotepane` · `ondrophosts` · `ontearmerge` 도 같다 */
    onreorder?: (dragId: string, beforeId: string | null) => void;
    onpromotepane?: (paneId: string, beforeId: string | null) => void;
    ondrophosts?: (payload: HostsDrag, beforeId: string | null) => void;
    /** 동기여야 한다 — `dragstart` 안에서 `dataTransfer` 에 싣는다. `null` 이면 이 드래그는 창을 넘을 수 없다 */
    ontearstart?: (tabId: string) => number | null;
    ontearout?: (screenX: number, screenY: number) => Promise<boolean> | void;
    ontearrefused?: () => void;
    ontearmerge?: (token: number, beforeId: string | null) => void;
    syncTabs?: ReadonlySet<string>;
    onsynctoggle?: (tabId: string) => void;
  } = $props();

  const dots = $derived.by(() => {
    const sources = {
      activeId,
      agents,
      status: tabStatus,
      bells: tabBells,
      activity: hasActivity,
      paneName: displayName,
    };
    return Object.fromEntries(tabs.map((tab) => [tab.id, tabDot(tabDotInput(tab, sources), t)]));
  });

  const unsavedTabs = $derived.by(() => {
    const dirty = dirtyDocPanes();
    const out = new Set<string>();
    if (dirty.length === 0) return out;
    for (const tab of tabs) if (listPanes(tab.root).some((p) => dirty.includes(p.id))) out.add(tab.id);
    return out;
  });

  // -------------------------------------------------------------------------
  // 탭 이름 바꾸기
  //
  // 고치는 동안 그 탭만 `draggable=false` 로 내리고 입력칸의 포인터 · 드래그 이벤트는 올려보내지 않는다 —
  // 아니면 글자를 끌어 고르는 순간 탭이 끌려간다. 시작이 `dblclick` 뿐인 것도 같은 이유다.
  // -------------------------------------------------------------------------

  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  let renameInitial = "";

  function startRename(tab: TabSpec) {
    ctxTab = null;
    renaming = tab.id;
    // 탭 바에 찍힌 글자 그대로(`displayTabTitle`)여야 한다 — 순수 `tabDisplayTitle` 은 런타임 신호를 몰라 다른 글자가 들어온다.
    renameValue = tab.name?.trim() || displayTabTitle(tab);
    renameInitial = renameValue;
  }

  /** blur 로도 확정한다 — Escape 는 `renaming` 을 먼저 비우므로 뒤따르는 blur 는 조용히 빠진다 */
  function commitRename() {
    const id = renaming;
    if (id === null) return;
    renaming = null;
    // 고치지 않았으면 아무것도 하지 않는다 — 아니면 더블클릭만 하고 나와도 자동 제목이 사용자 이름으로 박힌다.
    const next = renameValue.trim();
    if (next === renameInitial.trim()) return;
    onrename?.(id, next);
  }

  function cancelRename() {
    renaming = null;
  }

  function onRenameKey(ev: KeyboardEvent) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      commitRename();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      // 창 전역 Escape(모달 닫기 · 우클릭 메뉴 닫기)까지 가지 않게 여기서 끊는다.
      ev.stopPropagation();
      cancelRename();
    }
  }

  $effect(() => {
    if (renaming === null) return;
    renameInput?.focus();
    renameInput?.select();
  });

  // -------------------------------------------------------------------------
  // 탭 우클릭 메뉴
  //
  // 스트립이 `overflow-x: auto` 라 절대배치 메뉴는 잘린다 — `position: fixed` 에 화면 좌표를 넣는다.
  // -------------------------------------------------------------------------

  let ctxTab = $state<string | null>(null);
  let ctxLeft = $state(0);
  let ctxTop = $state(0);
  let ctxEl = $state<HTMLElement | null>(null);

  function openTabMenu(ev: MouseEvent, tab: TabSpec) {
    ev.preventDefault();
    ctxTab = tab.id;
    ctxLeft = Math.max(8, Math.min(ev.clientX, window.innerWidth - MENU_WIDTH - 8));
    ctxTop = ev.clientY;
  }

  const ctxTarget = $derived(ctxTab === null ? null : (tabs.find((t) => t.id === ctxTab) ?? null));

  /** 메뉴 항목은 모두 이 통로로 — `ctxTarget` 은 닫는 순간 `null` 이 된다(docs/conventions.md "메뉴를 닫는 코드") */
  function runTabMenu(fn: (tabId: string) => void) {
    runOnMenu(() => ctxTab, () => (ctxTab = null), fn);
  }

  const syncing = (tabId: string) => syncTabs?.has(tabId) ?? false;

  // -------------------------------------------------------------------------
  // 탭 드래그
  // -------------------------------------------------------------------------

  let strip = $state<HTMLDivElement | null>(null);

  const drag = createTabDrag({
    get tabs() {
      return tabs;
    },
    get activeId() {
      return activeId;
    },
    get strip() {
      return strip;
    },
    get ondragselect() {
      return ondragselect;
    },
    get onreorder() {
      return onreorder;
    },
    get onpromotepane() {
      return onpromotepane;
    },
    get ondrophosts() {
      return ondrophosts;
    },
    get ontearstart() {
      return ontearstart;
    },
    get ontearout() {
      return ontearout;
    },
    get ontearrefused() {
      return ontearrefused;
    },
    get ontearmerge() {
      return ontearmerge;
    },
  });

  // 펼침은 이어지는 목록에 덧붙은 탭만 — 처음 그릴 때와 워크스페이스 전환에 줄 전체가 한꺼번에 펼쳐지지 않게.
  // 탭 목록과 워크스페이스 id 는 한 갱신에 함께 바뀐다.
  let knownTabIds: Set<string> | null = null;
  let knownWorkspace: string | null = null;
  let enteringTabs = $state<Record<string, true>>({});
  let quietLeave = true;
  let leavingDragged: string | null = null;
  $effect.pre(() => {
    const ids = new Set(tabs.map((tab) => tab.id));
    const workspace = currentWorkspaceId();
    const known = knownTabIds;
    if (known !== null && ids.size === known.size && [...ids].every((id) => known.has(id))) {
      knownWorkspace = workspace; // 빈 워크스페이스끼리 옮겨 다닌 것도 따라간다
      return;
    }
    const continued = known !== null && ([...known].some((id) => ids.has(id)) ||
      (known.size === 0 && ids.size === 1 && workspace === knownWorkspace));
    // 접힘은 같은 워크스페이스 안에서 빠진 탭만 — 끌어서 옮긴 탭은 이미 줄에서 빠져 있다.
    const dragged = drag.previewDraggedTab ?? draggingTab();
    quietLeave = known === null || workspace !== knownWorkspace;
    leavingDragged = dragged !== null && !ids.has(dragged) ? dragged : null;
    const fresh = continued && !prefersReducedMotion()
      ? [...ids].filter((id) => !known!.has(id))
      : [];
    // 펼쳐지던 중에 닫힌 탭은 animationend 가 오지 않는다 — 목록에서 사라진 표시는 여기서 걷는다.
    const kept = Object.keys(enteringTabs).filter((id) => ids.has(id));
    if (fresh.length > 0 || kept.length !== Object.keys(enteringTabs).length) {
      enteringTabs = Object.fromEntries([...kept, ...fresh].map((id) => [id, true]));
    }
    knownTabIds = ids;
    knownWorkspace = workspace;
  });

  function prefersReducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function tabLeave(node: HTMLElement, { id }: { id: string }): TransitionConfig {
    if (quietLeave || id === leavingDragged || prefersReducedMotion()) return { duration: 0 };
    const width = node.getBoundingClientRect().width;
    node.style.overflow = "hidden";
    node.style.pointerEvents = "none";
    // 접히는 동안은 탭이 아니다 — 드래그 스냅숏·커서 아래 탭·× 폭 얼리기가 이 칸을 세지 않는다.
    delete node.dataset.tab;
    node.dataset.leaving = "";
    return {
      duration: 180,
      easing: cubicOut,
      css: (t) => `max-width: ${t * width}px; min-width: 0; flex-basis: ${t * width}px; opacity: ${Math.min(1, t * 1.6)};`,
    };
  }

  function tabEntered(id: string) {
    if (!enteringTabs[id]) return;
    const { [id]: _, ...rest } = enteringTabs;
    enteringTabs = rest;
  }

  // 다른 경로로 탭을 골랐거나 닫았으면 남은 시계도 뜻을 잃는다.
  $effect(() => {
    drag.pruneHover();
  });

  // 캔버스 병합·창 넘기기는 목록 변경과 같은 틱에 이동량을 걷는다.
  $effect.pre(() => {
    drag.finishIfGone();
  });

  $effect(() => {
    const el = strip;
    if (!el) return;
    return drag.attach(el);
  });

  // -------------------------------------------------------------------------
  // × 로 닫는 동안 폭 얼리기 (docs/log/2026-09-29-tab-width-shrink.md)
  //
  // 줄어든 줄에서 × 로 하나를 닫으면 남은 탭이 넓어져 다음 탭의 × 가 커서 밑에서 달아난다 —
  // 누르는 순간의 폭을 얼리고 커서가 스트립을 떠나면 푼다(Chrome 과 같은 규칙).
  // -------------------------------------------------------------------------

  let frozenWidth = $state<number | null>(null);

  function closeFromButton(ev: MouseEvent, tabId: string) {
    // 키보드(Enter·Space)로 누른 클릭은 `detail === 0` — 커서가 없으니 얼릴 까닭이 없다.
    if (ev.detail > 0 && strip) {
      // `[data-tab]` = 접히는 중(`data-leaving`)도 생략된(`.elided`) 칸도 아닌 탭
      const all = strip.querySelectorAll<HTMLElement>(".tab[data-tab]");
      const ref = all[all.length - 1];
      if (ref) frozenWidth = ref.getBoundingClientRect().width;
    }
    onclose(tabId);
  }

  // 마크업에 직접 달면 `<div>` 가 정적 요소 상호작용으로 잡혀 여기서 건다.
  $effect(() => {
    const el = strip;
    if (!el) return;
    const unfreeze = () => (frozenWidth = null);
    el.addEventListener("pointerleave", unfreeze);
    return () => el.removeEventListener("pointerleave", unfreeze);
  });

  // 탭이 늘면 얼림을 푼다 — 얼린 채면 새 탭이 넘친다.
  let lastTabCount = 0;
  $effect(() => {
    const n = tabs.length;
    if (n > lastTabCount) frozenWidth = null;
    lastTabCount = n;
  });

  // -------------------------------------------------------------------------
  // 생략 — 아이콘 폭까지 줄어도 넘치는 탭
  //
  // 생략된 탭은 `data-tab` 도 뗀다 — 드래그 스냅숏 · 얼리기가 세지 않게.
  // -------------------------------------------------------------------------

  /** `.more` 의 CSS `width` 와 같은 값 */
  const MORE_WIDTH = 40;
  let tabFit = $state<TabFit>({ width: 0, slot: 0, reserve: 0, more: MORE_WIDTH });
  const elided = $derived(
    elidedTabIds(tabs.map((tab) => tab.id), activeId, tabCapacity(tabFit, tabs.length)),
  );
  const elidedTabs = $derived(tabs.filter((tab) => elided.has(tab.id)));
  const elidedAttention = $derived(
    elidedTabs.some((tab) => dots[tab.id] || tabBells[tab.id] ||
      tabHasUnseen({ active: false, agents: agents[tab.id] })),
  );

  function measureFit(el: HTMLDivElement) {
    const css = getComputedStyle(el);
    const gap = parseFloat(css.columnGap) || 0;
    const min = parseFloat(css.getPropertyValue("--tab-min-width")) || 0;
    const outer = (node: HTMLElement | null, base: number) => {
      if (!node) return 0;
      const s = getComputedStyle(node);
      return base + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
    };
    const plus = el.querySelector<HTMLElement>(".new");
    const drag = el.querySelector<HTMLElement>(".dragspace");
    const reserve =
      outer(plus, plus ? parseFloat(getComputedStyle(plus).width) || 0 : 0) +
      outer(drag, drag ? parseFloat(getComputedStyle(drag).minWidth) || 0 : 0) +
      2 * gap;
    tabFit = { width: el.clientWidth, slot: min + gap, reserve, more: MORE_WIDTH + gap };
  }

  $effect(() => {
    const el = strip;
    void tabStyle; // 모양이 바뀌면 다시 잰다 — 간격(`column-gap`)은 모양 규칙이 정한다
    if (!el) return;
    measureFit(el);
    const ro = new ResizeObserver(() => measureFit(el));
    ro.observe(el);
    return () => ro.disconnect();
  });

  let moreMenu = $state<{ right: number; top: number } | null>(null);
  let moreButton = $state<HTMLButtonElement | null>(null);
  let moreMenuEl = $state<HTMLElement | null>(null);

  function toggleMoreMenu() {
    if (moreMenu !== null) {
      moreMenu = null;
      return;
    }
    ctxTab = null;
    wsMenu = null;
    const r = moreButton?.getBoundingClientRect();
    if (!r) return;
    moreMenu = { right: Math.max(8, window.innerWidth - r.right), top: menuTop(r) };
    void tick().then(() => menuRows(moreMenuEl)[0]?.focus());
  }

  /** 탭 줄의 아래 선에서 띄운다 — 붙이면 단추 · 줄 · 메뉴가 한 덩어리로 읽힌다 */
  const MENU_DROP = 6;
  function menuTop(button: DOMRect): number {
    const bar = strip?.closest(".tabs")?.getBoundingClientRect();
    return Math.max(button.bottom + 4, (bar?.bottom ?? button.bottom) + MENU_DROP);
  }

  function closeMoreMenu(back = false) {
    moreMenu = null;
    if (back) moreButton?.focus();
  }

  $effect(() => {
    if (moreMenu !== null && elidedTabs.length === 0) moreMenu = null;
  });

  // -------------------------------------------------------------------------
  // `+` 버튼 — 새 탭 하나 (docs/log/2026-09-25-plus-vs-shell-menu.md)
  //
  // 메뉴 · 우클릭 폴백은 두지 않는다 — 탭 바의 것은 탭을, 독의 실행 단추는 이 탭을 만진다는 자리 규칙이 흐려진다.
  // -------------------------------------------------------------------------

  const newTabTip = $derived.by(() => {
    const combo = effectiveCombo("new-tab", settings.current.keybindings);
    return shortcutTitle(t("app.tabs.new"), combo ? displayCombo(combo) : null);
  });

  const MENU_WIDTH = 220;

  function onWindowPointerDown(ev: PointerEvent) {
    const target = ev.target;
    const node = target instanceof Node ? target : null;
    if (ctxTab !== null && !(node && ctxEl?.contains(node))) ctxTab = null;
    // 단추 자신은 비켜 간다 — 여기서 먼저 닫으면 뒤따르는 click 이 도로 연다(`data-chrome-toggle` 과 같은 경쟁)
    // 줄의 우클릭 메뉴는 제 상자 밖이면 닫고, 목록은 목록 · 단추 · 그 우클릭 메뉴 밖이어야 닫는다
    if (wsCtx !== null && !(node && wsCtxEl?.contains(node))) wsCtx = null;
    if (wsMenu !== null && !(node && (wsMenuEl?.contains(node) || wsButton?.contains(node) || wsCtxEl?.contains(node)))) wsMenu = null;
    if (moreMenu !== null && !(node && (moreMenuEl?.contains(node) || moreButton?.contains(node)))) moreMenu = null;
  }

  /** 캡처 단계다 — 터미널에 포커스가 있어도 Escape 가 메뉴만 닫는다. 목록 안 · 끌기 중의 Escape 는 제 처리가 받는다 */
  function onWindowKeydown(ev: KeyboardEvent) {
    const close = menuEscape(ev, {
      ctx: ctxTab !== null,
      more: moreMenu !== null,
      moreEl: moreMenuEl,
      ws: wsMenu !== null && wsDrag === null,
      wsEls: [wsMenuEl, wsCtxEl],
    });
    if (!close.ctx && !close.more && !close.ws) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (close.ctx) ctxTab = null;
    if (close.more) moreMenu = null;
    if (close.ws) closeWsMenu();
  }

  // -------------------------------------------------------------------------
  // 지금 워크스페이스 단추
  //
  // 옆 알약은 다른 워크스페이스에서 기다리는 세션의 합이다(이 워크스페이스의 몫은 상태바 세션 칸).
  // 단추는 스트립 밖에 서므로 탭 폭 계산은 단추 폭을 이미 빼고 잰다.
  // -------------------------------------------------------------------------

  const wsCurrent = $derived(currentWorkspace());
  const wsBuckets = $derived(workspaceSheetBuckets(t, Date.now()));
  const wsOthersWaiting = $derived(
    [...wsBuckets].reduce((n, [id, b]) => n + (id === currentWorkspaceId() ? 0 : b.waiting.length), 0),
  );
  const wsTip = $derived.by(() => {
    if (!wsCurrent) return "";
    const find = isMainWindow ? comboText("switch-workspace") : null;
    const head = `${wsCurrent.name} — ${shortcutTitle(t("app.workspaces.button"), find)}`;
    return wsOthersWaiting > 0 ? `${head}\n${t("app.workspaces.othersWaiting", { n: wsOthersWaiting })}` : head;
  });
  function comboText(action: string): string | null {
    const combo = effectiveCombo(action, settings.current.keybindings);
    return combo ? displayCombo(combo) : null;
  }

  let wsMenu = $state<{ left: number; top: number } | null>(null);
  let wsButton = $state<HTMLButtonElement | null>(null);
  let wsMenuEl = $state<HTMLElement | null>(null);

  function toggleWsMenu() {
    if (wsMenu !== null) {
      wsMenu = null;
      return;
    }
    ctxTab = null;
    moreMenu = null;
    const r = wsButton?.getBoundingClientRect();
    if (!r) return;
    wsMenu = { left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)), top: menuTop(r) };
    void tick().then(() => {
      const rows = wsMenuRows();
      (rows.find((row) => row.getAttribute("aria-checked") === "true") ?? rows[0])?.focus();
    });
  }

  function closeWsMenu(back = false) {
    wsMenu = null;
    wsCtx = null;
    if (back) wsButton?.focus();
  }

  /** 끌어 놓은 손짓 뒤에 따라오는 클릭 하나는 무시한다 */
  function pickWsRow(id: string) {
    if (wsDrag || performance.now() - wsDragEndedAt < 250) return;
    runOnMenu(() => id, () => closeWsMenu(), openWorkspace);
  }

  // -------------------------------------------------------------------------
  // 줄의 우클릭 메뉴와 끌어서 순서 바꾸기
  //
  // 관리(편집 · 삭제 · 순서)는 주 창만 한다(`workspaceMainWindow`). 우클릭 메뉴는 목록 밖의 형제 상자다 —
  // 목록의 키 처리(`onListMenuKey`)가 메뉴의 ↑↓ · Escape 를 먹지 않게.
  // -------------------------------------------------------------------------

  let wsCtx = $state<{ id: string; x: number; y: number } | null>(null);
  let wsCtxEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (wsMenu === null) wsCtx = null;
  });

  // 끌기는 포인터로만 — 문턱(5px) 전에는 클릭(전환)을 그대로 둔다. `Esc` 는 끌기만 취소한다(목록은 남는다).
  let wsDrag = $state<{ id: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  let wsDropBefore = $state<string | null>(null);
  let wsDropEnd = $state(false);
  let wsDragEndedAt = -Infinity;

  $effect(() => {
    const el = wsMenuEl;
    if (!el || !workspaceMainWindow()) return;
    const clear = () => { wsDropBefore = null; wsDropEnd = false; };
    const finish = () => {
      const drag = wsDrag;
      if (drag?.moved) wsDragEndedAt = performance.now();
      wsDrag = null;
      if (drag && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
      clear();
    };
    const target = (x: number, y: number): string | null | undefined => {
      const rect = el.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
      const rows = [...el.querySelectorAll<HTMLElement>("[data-workspace-option]")].map((row) => {
        const r = row.getBoundingClientRect();
        return { id: row.dataset.workspaceOption!, top: r.top, height: r.height };
      });
      return workspaceDropBefore(rows, y);
    };
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || wsDrag) return;
      const row = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-workspace-option]") : null;
      if (!row || !el.contains(row)) return;
      wsCtx = null;
      wsDrag = { id: row.dataset.workspaceOption!, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
    };
    const move = (ev: PointerEvent) => {
      const drag = wsDrag;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.max(Math.abs(ev.clientX - drag.x), Math.abs(ev.clientY - drag.y)) < 5) return;
      if (!drag.moved && ev.isTrusted) el.setPointerCapture(ev.pointerId);
      drag.moved = true;
      ev.preventDefault();
      const before = target(ev.clientX, ev.clientY);
      const ids = workspaceList().map((w) => w.id);
      const changed = before !== undefined && reorderWorkspaceIds(ids, drag.id, before) !== ids;
      wsDropBefore = changed && before !== null ? before ?? null : null;
      wsDropEnd = changed && before === null;
    };
    const up = (ev: PointerEvent) => {
      const drag = wsDrag;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const before = drag.moved ? target(ev.clientX, ev.clientY) : undefined;
      finish();
      if (before !== undefined) void reorderWorkspaces(drag.id, before);
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === wsDrag?.pointerId) finish(); };
    const escape = (ev: KeyboardEvent) => {
      if (ev.code !== "Escape" || !wsDrag) return;
      ev.preventDefault();
      ev.stopPropagation();
      wsDragEndedAt = performance.now();
      finish();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", finish);
    window.addEventListener("keydown", escape, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", escape, true);
      finish();
    };
  });

  const wsMenuRows = (): HTMLElement[] => menuRows(wsMenuEl);
</script>

<!--
  `dragend` 를 창에서도 듣는다 — 패널 드래그의 시작점은 이 컴포넌트 밖(패널 헤더)이라 스트립에 건 dragend 가 오지 않는다.
-->
<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydowncapture={onWindowKeydown}
  ondragstart={drag.onWindowDragStart}
  ondragend={drag.finishTabDrag}
  onresize={() => (frozenWidth = null)}
/>

<!-- 끌기 속성 값 없음 = 이 상자를 직접 누를 때만 창 손잡이다 -->
<div class="tabs glass-band" role="tablist" data-tab-style={tabStyle} data-tauri-drag-region>
  {#if wsCurrent}
    <button
      type="button"
      class="ws-button"
      data-workspace-button
      bind:this={wsButton}
      aria-haspopup="menu"
      aria-expanded={wsMenu !== null}
      title={wsTip}
      aria-label={wsTip.split("\n")[0]}
      onclick={toggleWsMenu}
    >
      <!-- 아이콘을 고른 워크스페이스만 — 머리글자는 바로 옆 이름의 첫 글자라 같은 글자를 두 번 읽힌다 -->
      {#if wsCurrent.icon}<span class="ws-icon"><WorkspaceIcon workspace={wsCurrent} /></span>{/if}
      <span class="ws-name">{wsCurrent.name}</span>
      {#if wsOthersWaiting > 0}<span class="ws-pill" data-workspace-others-waiting aria-hidden="true">{wsOthersWaiting}</span>{/if}
    </button>
  {/if}
  <div
    class="strip"
    class:frozen={frozenWidth !== null}
    style:--tab-width={frozenWidth !== null ? `${frozenWidth}px` : undefined}
    bind:this={strip}
  >
    {#each tabs as tab (tab.id)}
      {@const lifted = drag.previewDraggedTab === tab.id && drag.followOffset !== null}
      {@const gone = drag.dragOutside && drag.previewDraggedTab === tab.id}
      {@const offset = lifted ? drag.followOffset : drag.dragOutside ? drag.collapsed.offsets[tab.id] : drag.preview.offsets[tab.id]}
      <div
        class="tab"
        class:active={tab.id === activeId}
        class:drag-over={drag.hoverTab === tab.id}
        class:dragging={draggingTab() === tab.id}
        class:lifted
        class:gone
        class:entering={enteringTabs[tab.id] === true}
        class:elided={elided.has(tab.id)}
        out:tabLeave={{ id: tab.id }}
        onanimationend={(ev) => { if (ev.target === ev.currentTarget) tabEntered(tab.id); }}
        style:transform={gone ? `translateX(${offset ?? 0}px) scale(0.9)` : offset ? `translateX(${offset}px)` : undefined}
        style:transition={drag.dropCommitting ? "none" : undefined}
        style:z-index={draggingTab() === tab.id ? 4 : undefined}
        class:renaming={renaming === tab.id}
        class:unseen={tabHasUnseen({ active: tab.id === activeId, agents: agents[tab.id] })}
        data-tab={elided.has(tab.id) ? undefined : tab.id}
        draggable={renaming !== tab.id}
      >
        {#if renaming === tab.id}
          <input
            class="rename"
            bind:this={renameInput}
            bind:value={renameValue}
            aria-label={t("app.tabs.rename.aria")}
            placeholder={t("app.tabs.rename.aria")}
            autocomplete="off"
            spellcheck="false"
            onkeydown={onRenameKey}
            onblur={commitRename}
            onpointerdown={(ev) => ev.stopPropagation()}
            ondragstart={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
            }}
          />
        {:else}
        <button
          type="button"
          class="label"
          role="tab"
          aria-selected={tab.id === activeId}
          title={displayTabTitle(tab)}
          onclick={(ev) => {
            // 에이전트 점 위의 클릭은 **그 타일로 가기**다 (탭 선택을 겸한다 — `focusTile`).
            // 점은 이 버튼 안의 글자일 뿐이라(버튼 안에 버튼을 둘 수 없다) 여기서 가른다.
            if (onagentdot && (ev.target as Element | null)?.closest?.("[data-agent-dot]")) {
              onagentdot(tab.id);
              return;
            }
            onselect(tab.id);
          }}
          ondblclick={() => startRename(tab)}
          oncontextmenu={(ev) => openTabMenu(ev, tab)}
        >
          <span class="kind">{#if tab.orch}<EqBars state={pulseOfRun(tab.orch.runId)} size={12} />{:else}<PaneIcon pane={tabIconPane(tab, dots[tab.id])} size={13} />{/if}</span>
          <span class="title">{displayTabTitle(tab)}</span>
          {#if unsavedTabs.has(tab.id)}
            <span class="unsaved" title={t("app.tabs.unsaved")} aria-label={t("app.tabs.unsaved")}>●</span>
          {/if}
          {#if syncing(tab.id)}
            <span class="syncmark" title={t("app.tabs.sync.on")} aria-label={t("app.tabs.sync.on")}>
              <UiIcon name="sync" size={13} />
            </span>
          {/if}
          {#if dots[tab.id]}
            <TabStatusGlyph dot={dots[tab.id]!} />
          {/if}
        </button>
        {/if}
        <button
          type="button"
          class="close"
          aria-label={t("app.tabs.close.aria", { name: displayTabTitle(tab) })}
          title={t("app.tabs.close")}
          onclick={(ev) => closeFromButton(ev, tab.id)}
          ><UiIcon name="close" size={13} /></button
        >
      </div>
    {/each}
    {#if drag.preview.ghost !== null}
      <div
        class="drop-ghost"
        style:left={`${drag.preview.ghost.left - (drag.dropSnapshot?.items.length ? drag.dropSnapshot.left : 0)}px`}
        style:top={`${drag.preview.ghost.top - (drag.dropSnapshot?.items.length ? drag.dropSnapshot.top : 0)}px`}
        style:width={`${drag.preview.ghost.width}px`}
        style:height={`${drag.preview.ghost.height}px`}
        aria-hidden="true"
      ></div>
    {/if}

    <button
      type="button"
      class="new"
      style:transform={drag.collapsed.newTabOffset ? `translateX(${drag.collapsed.newTabOffset}px)` : undefined}
      style:transition={drag.dropCommitting ? "none" : undefined}
      title={newTabTip}
      aria-label={newTabTip}
      onclick={() => onnewtab()}><UiIcon name="plus" size={14} /></button
    >

    <!-- `+` 뒤에 둔다 — 탭을 창 밖으로 끌면 `+` 가 왼쪽으로 당겨져(`collapsed.newTabOffset`) 앞이면 겹친다 -->
    {#if elidedTabs.length > 0}
      <button
        type="button"
        class="more"
        class:attention={elidedAttention}
        data-tabs-more
        bind:this={moreButton}
        aria-haspopup="menu"
        aria-expanded={moreMenu !== null}
        title={t("app.tabs.more", { n: elidedTabs.length })}
        aria-label={t("app.tabs.more", { n: elidedTabs.length })}
        onclick={toggleMoreMenu}
      >
        <span class="more-count">{elidedTabs.length}</span>
        <UiIcon name="chevron-down" size={12} />
      </button>
    {/if}

    <div class="dragspace" data-tauri-drag-region>
      {#if DEV_INSTANCE}<span class="dev-mark" aria-label="dev">dev</span>{/if}
    </div>
  </div>

  <!-- 타일 단위 조작 버튼은 두지 않는다 — 타일 헤더의 ⋯ 메뉴에 있다 (docs/log/2026-09-05-titlebar-cleanup.md) -->

  <WorkspacePicker
    {wsMenu}
    bind:wsCtx
    bind:wsMenuEl
    bind:wsCtxEl
    {wsBuckets}
    {wsDrag}
    {wsDropBefore}
    {wsDropEnd}
    {pickWsRow}
    {closeWsMenu}
  />

  {#if moreMenu}
    <TabOverflowMenu
      menu={moreMenu}
      {elidedTabs}
      {dots}
      {unsavedTabs}
      bind:el={moreMenuEl}
      onclose={closeMoreMenu}
      {onselect}
    />
  {/if}

  {#if ctxTarget}
    <TabContextMenu
      {ctxTarget}
      {ctxLeft}
      {ctxTop}
      {tabs}
      bind:el={ctxEl}
      {syncing}
      {startRename}
      {runTabMenu}
      {onsynctoggle}
      {onclose}
      {oncloseothers}
      {oncloseright}
    />
  {/if}
</div>

<style>
  .ws-button {
    flex: 0 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    height: var(--tab-h);
    min-width: 0;
    max-width: 200px;
    margin-bottom: var(--space-1);
    padding: 0 var(--space-3) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .ws-button:hover {
    background: var(--surface-hover);
  }
  .ws-button[aria-expanded="true"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .ws-button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .ws-button :global(svg) {
    flex: none;
  }
  .ws-icon {
    flex: none;
    display: inline-flex;
    font-weight: var(--fw-semibold);
    line-height: 1;
  }
  .ws-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-pill {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 15px;
    color: var(--on-accent);
    background: var(--accent);
  }
  .tabs {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) 0;
    background: var(--glass-band, var(--surface-raised));
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .strip {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    min-height: var(--tab-h);
    padding-bottom: var(--space-1);
    /* `hidden` 이 아니라 `clip` — 스크롤 상자가 아니라 포커스 · 스크립트로도 밀리지 않는다 */
    overflow: clip;
  }

  .dragspace {
    flex: 1 1 auto;
    min-width: 24px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: var(--space-2);
  }

  .dev-mark {
    pointer-events: none;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--warn);
    letter-spacing: 0.04em;
  }

  /* 폭은 제목과 무관하다(`--tab-width`) — 폭 배분은 flex 가, 몇 칸을 그릴지는 JS(`$lib/tab-overflow`)가 정한다 */
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 var(--tab-width);
    min-width: var(--tab-min-width);
    container-type: inline-size;
    height: var(--tab-h);
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    transition:
      background 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      flex-basis 120ms ease,
      transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  /* 얼리는 동안은 `flex-basis` 전이를 걷는다 — 남기면 얼린 폭으로 가는 동안 줄지 않는 탭이 잠깐 넘친다 */
  /* 선택자를 무겁게 둔 것은 모양 규칙(`.tabs[data-tab-style=…] .tab`)보다 늘 이기려는 것이다 */
  .tabs[data-tab-style] .strip.frozen .tab.tab {
    flex-shrink: 0;
    transition:
      background 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  @container (max-width: 119px) {
    .tab:not(.active):not(:hover):not(:focus-within):not(.renaming) .close {
      display: none;
    }
  }

  .tab.elided {
    display: none;
  }

  @container (max-width: 63px) {
    .tab:not(.renaming) .label {
      justify-content: center;
      padding: 0;
    }
    .tab:not(.renaming) :is(.title, .unsaved, .syncmark, .close),
    .tab:not(.renaming) :global(.subagents) {
      display: none;
    }
    .tab :global(.tab-glyph) {
      position: absolute;
      top: 3px;
      right: 3px;
    }
  }


  /*
    활성 면은 타일 면(`--surface-tile`)이 아니라 크롬 우물 면이다 — 타일 면이면 "라이트 크롬 + 어두운 터미널" 에서
    검은 판에 검은 글자가 된다(docs/log/2026-10-01-field-surface.md). 머리카락 선은 라이트 모드에서 우물이 보이게.
  */
  .tab {
    background: transparent;
  }

  /* HTML5 드래그 중 Chromium 은 :hover 를 갱신하지 않아, 머무는 탭에 같은 모양을 직접 준다. */
  .tab:hover,
  .tab.drag-over {
    background: var(--surface-hover);
  }

  .tab:hover .label,
  .tab.drag-over .label {
    color: var(--fg-2);
  }

  .tab.active {
    background: var(--glass-pick, var(--surface-field));
    border-color: var(--glass-border, var(--line));
  }

  .tab.unseen:not(:hover):not(.drag-over) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .tab.dragging {
    opacity: 0.6;
  }

  .tab.entering {
    overflow: hidden;
    animation: tab-unfold 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes tab-unfold {
    from {
      max-width: 0;
      min-width: 0;
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    to {
      max-width: var(--tab-width);
    }
  }

  .drop-ghost {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    border: 1px solid color-mix(in srgb, var(--fg) 22%, transparent);
    border-radius: var(--radius-sm);
    background:
      linear-gradient(135deg,
        color-mix(in srgb, white 14%, transparent),
        transparent 38%,
        transparent 62%,
        color-mix(in srgb, white 6%, transparent)),
      color-mix(in srgb, var(--tertiary) 7%, transparent);
    backdrop-filter: blur(10px) saturate(140%);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .tabs[data-tab-style] .strip.strip .tab.tab.tab,
    .tabs .strip .new {
      transition: none;
    }

    .tabs .strip .tab.entering {
      animation: none;
    }
  }

  .label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    align-self: stretch;
    min-width: 0;
    overflow: hidden;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-3);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  /* 호버 규칙(`.tab:hover .label`) 뒤에 둔다 — 같은 무게라 나중 것이 이긴다 */
  .tab.active .label {
    color: var(--fg-1);
  }

  .kind {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: inherit;
  }

  /* `text-align: left` — `.label` 은 `<button>` 이라 UA 기본값 `center` 를 물려받는다 */
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unsaved {
    flex: 0 0 auto;
    font-size: 9px;
    line-height: 1;
    color: var(--accent);
  }

  .rename {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
    box-sizing: border-box;
    height: 20px;
    margin: 0 var(--space-1) 0 var(--space-2);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    outline: none;
  }

  .tab.renaming {
    border-color: var(--line);
  }

  /* `display: block` 인 SVG 는 버튼 안에서 저절로 가운데 서지 않는다 — flex 로 잡는다 */
  .close {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    margin-left: auto;
    align-self: stretch;
    padding: 0 var(--space-2) 0 var(--space-1);
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .close:hover {
    color: var(--fg-1);
  }

  .new {
    flex: 0 0 auto;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--tab-h);
    height: var(--tab-h);
    margin-left: var(--space-1);
    padding: 0;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .new:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 폭은 스크립트의 `MORE_WIDTH` 와 같은 값 */
  .more {
    flex: 0 0 auto;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    box-sizing: border-box;
    width: 40px;
    height: var(--tab-h);
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .more:hover,
  .more[aria-expanded="true"] {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .more.attention:not(:hover) {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .syncmark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    line-height: 1;
    color: var(--warn);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     탭 바 모양 — pill(기본 — `DEFAULT_TAB_STYLE`, 위 바탕 규칙) · flat(아래).
     간격을 바꾸면 스크립트가 읽는 `column-gap` 계산도 따라간다.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── flat ─────────── */

  /*
    줄 높이는 pill 과 같다 — `.strip` 의 아래 여백(4px)을 걷고 탭 칸을 32px 로 키워, 모양을 바꿔도 아래 타일 영역이 움직이지 않는다.
    선택자를 `.strip .tab` 으로 무겁게 둔 것은 위 바탕 규칙(`.tab.unseen:not(:hover)…` 0,4,0)까지 이기려는 것이다.
  */
  .tabs[data-tab-style="flat"] .strip {
    min-height: 32px;
    padding-bottom: 0;
  }
  .tabs[data-tab-style="flat"] .strip .tab {
    height: 32px;
    background: transparent;
    border-color: transparent;
    border-radius: 0;
  }
  .tabs[data-tab-style="flat"] .label,
  .tabs[data-tab-style="flat"] .close {
    padding-bottom: var(--space-1);
  }
  .tabs[data-tab-style="flat"] .rename {
    margin-bottom: var(--space-1);
  }
  .tabs[data-tab-style="flat"] .strip :is(.new, .more) {
    align-self: flex-start;
  }

  /* 지시선은 탭 줄 아래 경계선에 붙인다 — 떠 있으면 어느 것에도 붙지 않은 금으로 읽힌다 */
  .tabs[data-tab-style="flat"] .tab::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -1px;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: transparent;
    pointer-events: none;
    transition: background 140ms ease;
  }

  .tabs[data-tab-style="flat"] .label {
    color: var(--fg-2);
  }

  .tabs[data-tab-style="flat"] .strip .tab:is(:hover, .drag-over):not(.active) {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border-radius: 6px 6px 0 0;
  }
  .tabs[data-tab-style="flat"] .tab:is(:hover, .drag-over) .label {
    color: var(--fg);
  }

  .tabs[data-tab-style="flat"] .tab.unseen:not(:hover):not(.drag-over) .label {
    color: var(--fg);
  }
  .tabs[data-tab-style="flat"] .tab.unseen:not(:hover):not(.drag-over)::after {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  /* 호버 규칙 뒤에 둔다 — 같은 무게라 나중 것이 이긴다 */
  .tabs[data-tab-style="flat"] .tab.active .label {
    color: var(--accent);
    font-weight: var(--fw-semibold);
  }
  .tabs[data-tab-style="flat"] .tab.active::after {
    background: var(--accent);
  }

  /* 얼린 폭 · 모양 규칙 · 안 봄 면보다 뒤에, 같은 무게 이상으로 둬 들어 올린 모양이 이긴다 */
  .tabs[data-tab-style] .strip .tab.lifted.lifted {
    transition: opacity 120ms ease;
    opacity: 1;
    z-index: 4;
    background: var(--surface-field);
    border-color: var(--line);
    box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
    cursor: grabbing;
  }

  .tabs[data-tab-style] .tab.lifted .label,
  .tabs[data-tab-style] .tab.lifted .close {
    color: var(--fg-1);
    cursor: grabbing;
  }

  .tabs[data-tab-style] .strip .tab.gone.gone {
    opacity: 0;
    transition: opacity 120ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
