// 탭 바의 탭 끌기 상태와 핸들러 (docs/log/2026-09-02-pane-host.md).
// `$effect` 는 여기 두지 않는다 — 등록 효과는 `Tabs` 에 원래 순서대로 남아 `pruneHover` · `finishIfGone` · `attach` 를 부른다.
// 이벤트는 스트립 한 곳에서 위임으로 받는다 — 마크업에 직접 달면 `<div>` 가 정적 요소 상호작용으로 잡힌다.
import { tick } from "svelte";
import { dragTabHoverAction, type TabHoverDrag } from "$lib/tab-hover";
import { tabDropTarget, tabReorderTarget, tabDropPreview, tabDragOffset, tabDragCollapse, tabOverlapTarget, type TabDropSnapshotItem } from "$lib/tab-drop-preview";
import {
  draggingTab,
  setDraggingPane,
  setDraggingTab,
  PANE_DRAG_TYPE,
  TAB_DRAG_TYPE,
  type TabSpec,
} from "$lib/session";
import {
  decodeHostsDrag,
  hostsDragEmpty,
  HOSTS_DRAG_TYPE,
  type HostsDrag,
} from "$lib/hosts";
import { endTear, foreignTearToken, outsideWindow, pendingTear, TEAR_DRAG_TYPE } from "$lib/tear";

// dragstart 에서 만들면 아직 디코딩되지 않아 기본 끌기 그림이 뜬다 — 모듈을 읽을 때 한 번 로드한다.
const invisibleDragImage = typeof Image === "undefined" ? null : new Image(1, 1);
if (invisibleDragImage) invisibleDragImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const DRAG_TAB_HOVER_MS = 500;

/** 게터라 그때그때의 값이다 — 생성 시점 사본으로 바꾸면 이벤트가 낡은 프롭을 읽는다 */
export interface TabDragHost {
  readonly tabs: TabSpec[];
  readonly activeId: string | null;
  readonly strip: HTMLDivElement | null;
  readonly ondragselect: ((id: string) => void) | undefined;
  readonly onreorder: ((dragId: string, beforeId: string | null) => void) | undefined;
  readonly onpromotepane: ((paneId: string, beforeId: string | null) => void) | undefined;
  readonly ondrophosts: ((payload: HostsDrag, beforeId: string | null) => void) | undefined;
  readonly ontearstart: ((tabId: string) => number | null) | undefined;
  readonly ontearout: ((screenX: number, screenY: number) => Promise<boolean> | void) | undefined;
  readonly ontearrefused: (() => void) | undefined;
  readonly ontearmerge: ((token: number, beforeId: string | null) => void) | undefined;
}

export function createTabDrag(h: TabDragHost) {
  let dropBefore = $state<string | null>(null);
  let dropEnd = $state(false);
  let dropSnapshot = $state.raw<{
    items: TabDropSnapshotItem[];
    left: number;
    top: number;
    bounds: Pick<DOMRect, "left" | "right">;
    scrollLeft: number;
    gap: number;
    width: number;
  } | null>(null);
  let previewDraggedTab = $state<string | null>(null);
  let dragGrab: number | null = null;
  let followOffset = $state<number | null>(null);
  let dropCommitting = $state(false);
  let dragOutside = $state(false);
  let tearWaiting: { timer: ReturnType<typeof setTimeout> | null } | null = null;
  const collapsed = $derived(tabDragCollapse({
    snapshot: dropSnapshot?.items ?? [],
    draggedTabId: dragOutside ? previewDraggedTab : null,
    gap: dropSnapshot?.gap,
  }));
  const preview = $derived(tabDropPreview({
    snapshot: dropSnapshot?.items ?? [],
    target: dropBefore !== null ? { kind: "insert", beforeId: dropBefore }
      : dropEnd ? { kind: "insert", end: true } : null,
    draggedTabId: previewDraggedTab,
    gap: dropSnapshot?.gap,
    fallbackWidth: dropSnapshot?.width,
  }));

  /** 탭이 움직여도 다음 dragover 는 처음 찍은 이 상자만 겨눈다 */
  function captureDropSnapshot(el: HTMLDivElement) {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    dropSnapshot = {
      items: Array.from(el.querySelectorAll<HTMLElement>("[data-tab]"), (tab) => ({
        id: tab.dataset.tab!, rect: snapshotRect(tab),
      })),
      left: rect.left + el.clientLeft - el.scrollLeft,
      top: rect.top + el.clientTop - el.scrollTop,
      bounds: { left: rect.left + el.clientLeft, right: rect.left + el.clientLeft + el.clientWidth },
      scrollLeft: el.scrollLeft,
      gap: parseFloat(css.columnGap) || 0,
      width: parseFloat(css.getPropertyValue("--tab-width")) || 200,
    };
  }

  // 이탈 뒤 돌아오는 전이 도중 재진입해도, 새 스냅숏은 이동 전 배치에서 시작한다.
  function snapshotRect(tab: HTMLElement): TabDropSnapshotItem["rect"] {
    const rect = tab.getBoundingClientRect();
    const transform = getComputedStyle(tab).transform;
    const matrix = transform === "none" ? null : new DOMMatrixReadOnly(transform);
    const width = rect.width / (matrix?.m11 ?? 1);
    const height = rect.height / (matrix?.m22 ?? 1);
    const left = rect.left - (matrix?.m41 ?? 0) - (width - rect.width) / 2;
    const top = rect.top - (matrix?.m42 ?? 0) - (height - rect.height) / 2;
    return { left, right: left + width, top, width, height };
  }

  /** 머무는 탭과 시계는 한 벌이다 — 함께 거둔다 */
  let hoverTab = $state<string | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHover() {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverTab = null;
  }

  function updateHover(kind: TabHoverDrag, overId: string | null) {
    const action = dragTabHoverAction({ kind, overId, activeId: h.activeId, pendingId: hoverTab });
    if (action === "keep" && h.ondragselect) return;
    clearHover();
    if (action !== "arm" || !h.ondragselect || overId === null) return;
    hoverTab = overId;
    hoverTimer = setTimeout(() => {
      const eligible = dragTabHoverAction({ kind, overId, activeId: h.activeId, pendingId: null }) === "arm" &&
        h.tabs.some((tab) => tab.id === overId);
      clearHover();
      if (eligible) h.ondragselect?.(overId);
    }, DRAG_TAB_HOVER_MS);
  }

  function pruneHover() {
    if (hoverTab !== null && (hoverTab === h.activeId || !h.tabs.some((tab) => tab.id === hoverTab))) {
      clearHover();
    }
  }

  function clearDrop() {
    clearHover();
    dropBefore = null;
    dropEnd = false;
    // 이 창 탭의 원래 배치는 이탈·재진입 사이에도 살아 있다.
    if (draggingTab() === null && tearWaiting === null) {
      dropSnapshot = null;
      previewDraggedTab = null;
      followOffset = null;
    }
  }

  function clearTabDrag() {
    if (tearWaiting && tearWaiting.timer !== null) clearTimeout(tearWaiting.timer);
    tearWaiting = null;
    clearDrop();
    dropSnapshot = null;
    previewDraggedTab = null;
    followOffset = null;
    dragOutside = false;
    dragGrab = null;
  }

  function commitDropLayout() {
    dropCommitting = true;
    void tick().then(() => {
      h.strip?.getBoundingClientRect(); // 전이 없는 배치를 반영한 뒤 전이를 돌려준다
      dropCommitting = false;
    });
  }

  function finishTabDrag() {
    // 창의 dragend 도 여기 온다 — ACK 를 기다리는 탭은 아직 목록에 있어도 빠짐을 유지한다.
    if (tearWaiting !== null && h.tabs.some((tab) => tab.id === previewDraggedTab)) return;
    if (previewDraggedTab !== null && !h.tabs.some((tab) => tab.id === previewDraggedTab)) commitDropLayout();
    clearTabDrag();
  }

  async function waitForTearOut(screenX: number, screenY: number) {
    const waiting: NonNullable<typeof tearWaiting> = { timer: null };
    tearWaiting = waiting;
    clearDrop();
    dragOutside = true;
    // ACK 가 오지 않아도 탭이 영원히 숨으면 안 된다 — 안전 시계는 이 한 벌만 둔다.
    const restore = () => {
      if (tearWaiting !== waiting) return;
      if (waiting.timer !== null) clearTimeout(waiting.timer);
      tearWaiting = null;
      finishTabDrag();
    };
    waiting.timer = setTimeout(restore, 5000);
    try {
      if (await h.ontearout?.(screenX, screenY) === false) restore();
    } catch {
      restore();
    }
  }

  /** 캔버스 병합 · 창 넘기기는 목록 변경과 같은 틱에 이동량을 걷는다 */
  function finishIfGone() {
    if (previewDraggedTab !== null && !h.tabs.some((tab) => tab.id === previewDraggedTab)) finishTabDrag();
  }

  function onWindowDrop() {
    const source = previewDraggedTab;
    if (source === null) return;
    // tick 이 아니라 setTimeout 이다 — 리스너마다 마이크로태스크가 비워져 tick 이면 정리가 탭 바 · 캔버스의 drop 처리기보다
    // 먼저 돌아 판정을 지운다(탭 순서 바꾸기가 죽는다).
    setTimeout(() => {
      if (previewDraggedTab === source) finishTabDrag();
    }, 0);
  }

  function tabUnder(ev: DragEvent): string | null {
    const t = ev.target;
    if (!(t instanceof Element)) return null;
    return t.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null;
  }

  const isTabDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(TAB_DRAG_TYPE) ?? false;
  const isPaneDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(PANE_DRAG_TYPE) ?? false;
  const isHostsDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(HOSTS_DRAG_TYPE) ?? false;

  /** 해제는 `clearTabDrag` 먼저 */
  function attach(el: HTMLDivElement): () => void {
    const onStart = (ev: DragEvent) => {
      clearTabDrag();
      const id = tabUnder(ev);
      const dt = ev.dataTransfer;
      if (!id || !dt) return;
      const tab = el.querySelector<HTMLElement>(`[data-tab="${id}"]`)!;
      dragGrab = ev.clientX - snapshotRect(tab).left;
      setDraggingTab(id);
      captureDropSnapshot(el);
      previewDraggedTab = id;
      followOffset = 0;
      dt.setData(TAB_DRAG_TYPE, id);
      if (invisibleDragImage) dt.setDragImage(invisibleDragImage, 0, 0);
      // 창을 넘길 준비는 여기서 한다 — 창 밖으로 나간 뒤에는 `dataTransfer` 를 건드릴 수 없다
      // (docs/log/2026-09-02-tear-out.md 의 "비용" 절).
      const token = h.ontearstart?.(id) ?? null;
      if (token !== null) dt.setData(TEAR_DRAG_TYPE, String(token));
      dt.effectAllowed = "move";
      // 선택은 바꾸지 않는다 — 바꾸면 터미널 위로 끌 때 자기 자신 위가 된다.
    };

    const onEnd = (ev: DragEvent) => {
      const dragged = draggingTab();
      setDraggingTab(null);
      // 예약이 이번 탭 드래그의 것인지 확인한다 — 타일 헤더 티어아웃이 같은 예약 자리를 써서, 그쪽 예약을 집으면
      // 끌지도 않은 탭이 새 창에 떨어진다.
      const p = pendingTear();
      if (
        h.ontearout &&
        p &&
        p.paneId === undefined &&
        p.tabId === dragged &&
        ev.dataTransfer?.dropEffect === "none" &&
        outsideWindow(ev)
      ) {
        void waitForTearOut(ev.screenX, ev.screenY); // 예약 정리는 그쪽이 (비동기라) 맡는다
        return;
      }
      finishTabDrag();
      // 창 밖에 놓았는데 예약이 없었다 = 시작에서 창 넘기기가 거절됐다
      if (!p && ev.dataTransfer?.dropEffect === "none" && outsideWindow(ev)) h.ontearrefused?.();
      endTear();
    };

    const onOver = (ev: DragEvent) => {
      const kind = isPaneDrag(ev) ? "pane" : isTabDrag(ev) ? "tab" : isHostsDrag(ev) ? "hosts" : null;
      if (tearWaiting !== null) clearTabDrag();
      if (kind === null) {
        clearDrop();
        return;
      }
      if (dropSnapshot === null) captureDropSnapshot(el);
      const self = kind === "tab" ? draggingTab() : null;
      const offset = tabDragOffset({
        snapshot: dropSnapshot!.items, bounds: dropSnapshot!.bounds, clientX: ev.clientX, grab: dragGrab, draggedTabId: self,
      });
      if (dragOutside) dragOutside = false;
      if (followOffset !== offset) followOffset = offset;
      if (previewDraggedTab !== self) previewDraggedTab = self;
      const target = offset !== null
        ? tabReorderTarget({ snapshot: dropSnapshot!.items, draggedTabId: self, offset })
        : tabDropTarget({
          snapshot: dropSnapshot!.items, clientX: ev.clientX, kind, activeId: h.activeId, draggedTabId: self,
        });
      const overId = offset !== null
        ? tabOverlapTarget({
          snapshot: dropSnapshot!.items, draggedTabId: self, offset,
          offsets: tabDropPreview({
            snapshot: dropSnapshot!.items, target, draggedTabId: self, gap: dropSnapshot!.gap,
          }).offsets,
        })
        : target?.kind === "dwell" ? target.tabId : null;
      updateHover(kind === "hosts" ? null : kind, overId);
      const pane = h.onpromotepane && kind === "pane";
      const hosts = !!h.ondrophosts && kind === "hosts";
      if (!pane && !hosts && !((h.onreorder || h.ontearmerge) && kind === "tab")) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = hosts ? "copy" : "move";
      const before = target?.kind === "insert" ? target.beforeId ?? null : null;
      const end = target?.kind === "insert" && target.end === true;
      if (dropBefore !== before) dropBefore = before;
      if (dropEnd !== end) dropEnd = end;
    };

    const onLeave = (ev: DragEvent) => {
      const to = ev.relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      // WebView2 가 자식 사이에서도 relatedTarget 을 비울 수 있다 — 스트립 안이면 이탈이 아니다.
      if (to === null) {
        const rect = el.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX < rect.right &&
          ev.clientY >= rect.top && ev.clientY < rect.bottom) return;
      }
      if (draggingTab() !== null) dragOutside = true;
      clearDrop();
    };

    const onDrop = (ev: DragEvent) => {
      const before = dropBefore;
      const end = dropEnd;
      // 전이를 한 번 걷어 이전 transform 에서 되튀지 않게 한다
      if (before !== null || end) {
        commitDropLayout();
      }
      clearTabDrag();
      if (before === null && !end) return;

      // 다른 창에서 왔는가를 제일 먼저 묻는다 — id 카운터가 창마다 따로 돌아 남의 id 가 내 id 와 같을 수 있다.
      // 아래 "자기 자신인가" 검사 뒤로 옮기면 번호가 겹친 날에만 조용히 아무 일도 안 한다 (docs/log/2026-09-04-tear-merge-fixes.md).
      const foreign = foreignTearToken(ev.dataTransfer);
      if (foreign !== null && (isTabDrag(ev) || isPaneDrag(ev))) {
        ev.preventDefault();
        ev.stopPropagation();
        setDraggingPane(null);
        h.ontearmerge?.(foreign, before);
        return;
      }

      const ondrophosts = h.ondrophosts;
      if (ondrophosts && isHostsDrag(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        const payload = decodeHostsDrag(ev.dataTransfer?.getData(HOSTS_DRAG_TYPE) ?? "");
        if (!hostsDragEmpty(payload)) ondrophosts(payload, before);
        return;
      }

      const onpromotepane = h.onpromotepane;
      if (onpromotepane && isPaneDrag(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        // 승격되면 드래그 시작 원소(헤더)가 사라져 `dragend` 가 오지 않을 수 있다 — 여기서도 지운다
        setDraggingPane(null);
        const paneId = ev.dataTransfer?.getData(PANE_DRAG_TYPE) ?? "";
        if (paneId !== "") onpromotepane(paneId, before);
        return;
      }

      if (!isTabDrag(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const id = ev.dataTransfer?.getData(TAB_DRAG_TYPE) ?? "";
      if (id === "") return;
      h.onreorder?.(id, before);
    };

    const onScroll = () => {
      const snapshot = dropSnapshot;
      if (snapshot === null) return;
      const shift = snapshot.scrollLeft - el.scrollLeft;
      if (shift === 0) return;
      if (followOffset !== null) followOffset -= shift;
      // 전이 중인 DOM 을 다시 찍지 않는다 — 피치가 바뀐다
      dropSnapshot = {
        ...snapshot, left: snapshot.left + shift, scrollLeft: el.scrollLeft,
        items: snapshot.items.map((tab) => ({ ...tab, rect: {
          ...tab.rect, left: tab.rect.left + shift, right: tab.rect.right + shift,
        } })),
      };
    };

    el.addEventListener("scroll", onScroll);
    window.addEventListener("drop", onWindowDrop, true);
    el.addEventListener("dragenter", onOver);
    el.addEventListener("dragstart", onStart);
    el.addEventListener("dragend", onEnd);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      clearTabDrag();
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("drop", onWindowDrop, true);
      el.removeEventListener("dragenter", onOver);
      el.removeEventListener("dragstart", onStart);
      el.removeEventListener("dragend", onEnd);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }

  function onWindowDragStart() {
    if (tearWaiting !== null) clearTabDrag();
  }

  return {
    get dropSnapshot() {
      return dropSnapshot;
    },
    get previewDraggedTab() {
      return previewDraggedTab;
    },
    get followOffset() {
      return followOffset;
    },
    get dropCommitting() {
      return dropCommitting;
    },
    get dragOutside() {
      return dragOutside;
    },
    get collapsed() {
      return collapsed;
    },
    get preview() {
      return preview;
    },
    get hoverTab() {
      return hoverTab;
    },
    attach,
    pruneHover,
    finishIfGone,
    finishTabDrag,
    onWindowDragStart,
  };
}

export type TabDragController = ReturnType<typeof createTabDrag>;
