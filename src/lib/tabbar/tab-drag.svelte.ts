// 탭 바의 **탭 끌기** 상태와 핸들러 — `Tabs.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 5차).
// `Tabs` 가 하나 만들고(`createTabDrag` — 값 · 프롭 콜백은 게터로) 마크업은 게터로 읽는다.
//
// **`$effect` 는 여기 없다** — 목록 변경 정리(`$effect.pre`) · 머무름 시계 거두기 · 스트립 리스너 등록 효과는 `Tabs` 에
// 원래 자리 · 원래 순서 그대로 남아 이 컨트롤러의 메서드(`pruneHover` · `finishIfGone` · `attach`)를 부른다.
// 스트립 리스너는 `attach(el)` 가 원래 순서대로 걸고, 돌려주는 해제 함수가 같은 순서로 걷는다(먼저 `clearTabDrag`).
//
// 모듈 수준 드래그 그림(`invisibleDragImage`)은 이 모듈에 **하나** 산다 — 인스턴스마다 만들지 않는다.
//
// -------------------------------------------------------------------------
// 탭 드래그 (docs/log/2026-09-02-pane-host.md)
//
// 한 종류의 드래그가 두 가지 뜻을 낸다 — **어디에 놓느냐**로 갈린다:
//   · 터미널 영역에 놓으면 = 그 패널 옆으로 **탭 병합** (`PaneHost` 가 받는다)
//   · 탭 바 안에 놓으면    = **순서 바꾸기** (여기)
// 탭 바 안에서는 순서 바꾸기뿐이다 — 머무름 전환이 없고, 자리는 따라오는 탭의 가운데가 이웃의
// 가운데를 넘었는가로 정한다(크롬식). 머무름(가운데 50%·500ms)은 타일 드래그에만 남는다.
// 실어 나르는 것은 탭 id 하나뿐이고, 다른 드래그와는 데이터 종류로 구분된다.
//
// 스트립은 **패널 드래그**(`PANE_DRAG_TYPE`, 패널 헤더가 손잡이)도 받는다 — 그쪽은
// "이 패널만 떼어 **새 탭으로**" 다 (docs/log/2026-09-02-pane-identity.md). 놓는 자리의
// 뜻이 순서 바꾸기와 같으므로 미리보기와 위치 계산을 그대로 공유한다.
//
// 그리고 **독의 호스트·폴더 드래그**(`HOSTS_DRAG_TYPE`)도 받는다 — 그쪽은 "이것들만
// 든 **새 탭**" 이다 (docs/log/2026-09-04-hosts-multiselect.md). 셋 다 결국 "여기에
// 탭 하나" 라는 같은 뜻이라 미리보기를 함께 쓰고, 갈리는 것은 놓는 순간뿐이다.
//
// 세 이벤트는 스트립 한 곳에서 **위임**으로 받는다 (`dragstart` 도 버블한다) — 마크업에
// 직접 달면 `<div>` 가 정적 요소 상호작용으로 잡힌다. `SplitView`/`PaneHost` 와 같은 방식이다.
// -------------------------------------------------------------------------
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

// 타일·탭을 끌다 탭을 스쳐 갈 때는 그대로 두고, 내려놓을 탭을 고를 만큼 머물면 연다(탭은 걸쳐 머문 탭).
const DRAG_TAB_HOVER_MS = 500;

/**
 * `Tabs` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). 프롭 콜백도 같다 —
 * 이벤트가 온 순간의 프롭을 읽는다(원래 `Tabs` 안에서 프롭을 직접 읽던 것과 같다).
 */
export interface TabDragHost {
  readonly tabs: TabSpec[];
  readonly activeId: string | null;
  /** 탭 스트립(`bind:this`) */
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

/** 탭 끌기 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createTabDrag(h: TabDragHost) {
  /** 지금 드래그가 가리키는 삽입 자리 — 드롭 분기도 같은 값을 읽는다. */
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

  /** 처음 찍은 client 좌표와 스트립 원점 — 탭이 움직여도 다음 dragover 는 이 상자만 겨눈다. */
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

  /** 머무는 탭과 시계는 한 벌이다 — 전환·이탈·드롭·취소·정리에서 함께 거둔다. */
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

  /** 다른 경로로 탭을 골랐거나 닫았으면 남은 시계도 뜻을 잃는다 — `Tabs` 의 `$effect` 가 부른다. */
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
      h.strip?.getBoundingClientRect(); // 전이 없는 배치를 반영한 뒤 다음 미리보기의 전이를 돌려준다.
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

  /** 캔버스 병합·창 넘기기는 목록 변경과 같은 틱에 이동량을 걷는다 — `Tabs` 의 `$effect.pre` 가 부른다. */
  function finishIfGone() {
    if (previewDraggedTab !== null && !h.tabs.some((tab) => tab.id === previewDraggedTab)) finishTabDrag();
  }

  function onWindowDrop() {
    const source = previewDraggedTab;
    if (source === null) return;
    // 캔버스의 drop 핸들러가 목록을 바꾼 다음 정리한다 — 제자리·거절이면 남은 탭이 다시 나타난다.
    // **마이크로태스크(tick)가 아니라 setTimeout** 이다: 브라우저는 리스너 하나가 끝날 때마다 마이크로태스크를 비우므로,
    // 창 캡처 단계의 이 리스너가 tick 으로 미루면 정리가 탭 바·캔버스의 drop 처리기보다 **먼저** 돌아 판정을 지운다(탭 순서 바꾸기가 죽었다).
    setTimeout(() => {
      if (previewDraggedTab === source) finishTabDrag();
    }, 0);
  }

  /** 커서 아래 탭의 id (탭 밖이면 null) */
  function tabUnder(ev: DragEvent): string | null {
    const t = ev.target;
    if (!(t instanceof Element)) return null;
    return t.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null;
  }

  const isTabDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(TAB_DRAG_TYPE) ?? false;
  /**
   * 패널 헤더에서 시작한 드래그 (`PaneHost`). 여기 놓으면 **새 탭으로 승격**이다.
   * 탭 드래그와 달리 "자기 자신" 을 걸러 낼 것이 없다 — 패널은 아직 탭이 아니므로
   * 어느 탭 앞에 놓든 뜻이 있다.
   */
  const isPaneDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(PANE_DRAG_TYPE) ?? false;
  /**
   * 독에서 끌어온 호스트·폴더 묶음. 여기 놓으면 **새 탭**이다 — 탭 바는
   * "탭이 늘어서는 줄" 이므로, 그 줄에 무언가를 놓는 뜻은 언제나 하나뿐이다.
   */
  const isHostsDrag = (ev: DragEvent) => ev.dataTransfer?.types.includes(HOSTS_DRAG_TYPE) ?? false;

  // 창 밖 판정(`outsideWindow`)은 `$lib/tear` 에 있다 — 타일 헤더(`PaneHost`)가 같은
  // 판정으로 티어아웃하므로, 두 손잡이가 창 경계를 다르게 읽지 않도록 한 곳에 둔다.

  /**
   * 스트립에 끌기 리스너를 건다 — `Tabs` 의 등록 `$effect` 가 부르고, 돌려준 함수가 그 효과의 정리다.
   * 등록 · 해제 순서는 옮기기 전 그대로다(해제는 `clearTabDrag` 먼저).
   */
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
      // 창을 넘길 준비도 **여기서** 한다 — 드래그가 창 밖으로 나간 뒤에는 `dataTransfer`
      // 를 건드릴 수 없기 때문이다. 버퍼 직렬화 비용이 그대로 드래그 시작 지연이 된다
      // (docs/log/2026-09-02-tear-out.md 의 "비용" 절).
      const token = h.ontearstart?.(id) ?? null;
      if (token !== null) dt.setData(TEAR_DRAG_TYPE, String(token));
      dt.effectAllowed = "move";
      // 끌기 시작한 탭이 곧 보고 있는 탭이다 — 터미널 위로 끌고 갈 때 대상(활성 탭)이
      // 눈앞에 있어야 하므로 **선택은 바꾸지 않는다** (선택하면 자기 자신 위가 되어 버린다).
    };

    const onEnd = (ev: DragEvent) => {
      const dragged = draggingTab();
      setDraggingTab(null);
      // 아무 데도 안 놓였고(`none`) 커서가 창 밖이면 = **새 창으로 분리**.
      // 그 외(창 안 실패·순서 바꾸기·병합)는 예약만 버린다 — 사서함은 5분 뒤 자동 폐기라
      // 남겨 둬도 무해하다.
      //
      // 예약이 **이번 탭 드래그의 것**인지도 확인한다 (`tabId` 일치 · `paneId` 없음):
      // 타일 헤더 티어아웃이 같은 예약 자리를 쓰는데, 그쪽이 남긴 예약을 여기서 집으면
      // 끌지도 않은 탭이 통째로 새 창에 떨어진다.
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
      // 창 밖에 놓았는데 예약이 없었다 = 시작에서 창 넘기기가 거절됐다(저장 안 한 문서 등 — 상위가 가린다)
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
      // 이 창 탭은 따라오는 탭의 가운데로, 나머지(타일·호스트·다른 창 탭)는 커서로 자리를 고른다.
      const target = offset !== null
        ? tabReorderTarget({ snapshot: dropSnapshot!.items, draggedTabId: self, offset })
        : tabDropTarget({
          snapshot: dropSnapshot!.items, clientX: ev.clientX, kind, activeId: h.activeId, draggedTabId: self,
        });
      // 이 창 탭은 끄는 탭이 다른 탭 위에 걸쳐 머물면 그 탭으로 넘어간다 — 그다음 캔버스에 놓으면 그 탭에 합쳐진다.
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
      // 여는 조작(호스트)은 copy, 옮기는 조작(탭·타일)은 move — 원래 드롭 계약 그대로다.
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
      // 이동량 제거와 실제 순서 변경은 같은 틱이다. 전이를 한 번 걷어 이전 transform 에서 되튀지 않게 한다.
      if (before !== null || end) {
        commitDropLayout();
      }
      clearTabDrag();
      if (before === null && !end) return; // 놓을 자리를 못 정했다 (표시도 없었다)

      // **다른 창에서 왔는가** 를 제일 먼저 묻는다 — 탭 id·타일 id 로는 못 가르기 때문이다
      // (`tab-1`·`pane-1` 카운터가 창마다 따로 돌아 남의 id 가 내 id 와 같은 글자다).
      // 그래서 아래 두 분기의 "자기 자신인가" 검사보다 **앞에** 서야 한다: 뒤에 두면 번호가
      // 겹친 날에만 조용히 아무 일도 안 하는 어긋남이 된다.
      //
      // 탭이든 타일이든 같은 길이다 — 짐의 모양이 언제나 "탭 한 개" 라서 받는 쪽은 무엇이
      // 떨어져 나왔는지 알 필요가 없다 (docs/log/2026-09-04-tear-merge-fixes.md).
      const foreign = foreignTearToken(ev.dataTransfer);
      if (foreign !== null && (isTabDrag(ev) || isPaneDrag(ev))) {
        ev.preventDefault();
        ev.stopPropagation();
        // 이 창의 드래그 표시는 어차피 비어 있지만(그 상태는 창마다 별개다) 규칙을 맞춘다.
        setDraggingPane(null);
        h.ontearmerge?.(foreign, before);
        return;
      }

      // 호스트·폴더 묶음 = 새 탭. 이관(창 넘기기)과 겹칠 일이 없어 여기 둔다.
      const ondrophosts = h.ondrophosts;
      if (ondrophosts && isHostsDrag(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        const payload = decodeHostsDrag(ev.dataTransfer?.getData(HOSTS_DRAG_TYPE) ?? "");
        if (!hostsDragEmpty(payload)) ondrophosts(payload, before);
        return;
      }

      // 패널 승격이 먼저다 — 두 종류가 한 번에 실릴 일은 없지만 분기는 한 방향이어야 한다.
      const onpromotepane = h.onpromotepane;
      if (onpromotepane && isPaneDrag(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        // 승격되면 원래 탭의 패널이 1개로 줄어 **헤더(= 드래그 시작 원소)가 사라질 수 있다.**
        // 그러면 `dragend` 가 오지 않으므로 끌던 패널 표시는 여기서도 지워 둔다.
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
      // 창을 넘어온 경우는 위에서 이미 갈렸다 — 여기 오는 것은 이 창 안의 순서 바꾸기뿐이다.
      h.onreorder?.(id, before);
    };

    const onScroll = () => {
      const snapshot = dropSnapshot;
      if (snapshot === null) return;
      const shift = snapshot.scrollLeft - el.scrollLeft;
      if (shift === 0) return;
      if (followOffset !== null) followOffset -= shift;
      // 스크롤은 client 좌표만 옮긴다 — 전이 중인 DOM 을 다시 찍어 피치를 바꾸지 않는다.
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

  /** 창의 `dragstart` — ACK 를 기다리던 탭 끌기가 남아 있으면 걷는다(새 끌기가 시작됐다) */
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
    /** 끄는 탭이 스트립을 벗어났을 때 남은 탭 · `+` 의 이동량(`tabDragCollapse`) */
    get collapsed() {
      return collapsed;
    },
    get preview() {
      return preview;
    },
    /** 머무는 탭 — 시계가 걸려 있는 탭 */
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
