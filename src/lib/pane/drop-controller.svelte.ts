// 타일 캔버스의 끌어다 놓기 — 하이라이트 상태(`dropTarget`·`fileTarget`)와 dragstart/dragend/dragover/dragleave/drop 손잡이.
// 불변식: 분할 판정은 첫 dragover 의 보이는 상자에 고정한다 — 접힌 DOM 을 재면 접힘·원복이 진동한다.
// 판정은 `pane/drop-rules.ts` 의 순수 함수, 리스너를 거는 `$effect`(헤더 우클릭 `contextmenu` 와 한 벌)는 `PaneHost` 에 있다.
import { isAgentPane } from "$lib/app/agent-status.svelte.js";
import { fsDropRouteTo } from "$lib/app/sessions.svelte.js";
import { dragKind, dropPlan, fsPasteLabel, isForeignDrag, type DropLabelKind } from "$lib/pane/drop-rules";
import type { HostBox } from "$lib/pane/boxes";
import type { PaneHostProps } from "$lib/pane/props";
import { zoneOf, type DropZone } from "$lib/layout";
import { paneAtSnapshot, type DropSnapshotItem } from "./drop-snapshot";
import {
  draggingPane,
  draggingTab,
  setDraggingPane,
  setDraggingTab,
  PANE_DRAG_TYPE,
  TAB_DRAG_TYPE,
  type PaneKind,
  type PaneSide,
  type SplitDir,
} from "$lib/session";
import { decodeHostsDrag, hostsDragEmpty, HOSTS_DRAG_TYPE } from "$lib/hosts";
import { decodeFsDrag, fsDragActive, fsDragEmpty, shellQuoteAll, FS_DRAG_TYPE } from "$lib/fs-drag";
import { endTear, foreignTearToken, outsideWindow, pendingTear, TEAR_DRAG_TYPE } from "$lib/tear";
import { broadcastInput } from "$lib/sync.svelte.js";
import { tabOfPane } from "$lib/app/tabs.svelte.js";
import { isOrchTab } from "$lib/orchestration/orch-tab";

/** 컨트롤러가 `PaneHost` 에서 읽는 것 — 전부 게터라 그때그때의 값이다 */
export interface DropHost
  extends Pick<
    PaneHostProps,
    | "ondrophosts"
    | "ondroptab"
    | "onmovepane"
    | "onfiledrop"
    | "onfspaste"
    | "ontearstart"
    | "ontearoutpane"
    | "ontearrefused"
    | "ontearmergeinto"
  > {
  /** 타일 캔버스 (`dragleave` 가 컨테이너 밖으로 나갔는지 묻는다) */
  readonly host: HTMLDivElement | null;
  readonly boxes: HostBox[];
  /** 패널 id → 종류 (`PaneHost` 의 `kindById`) */
  readonly kindById: Map<string, PaneKind>;
  /** 헤더를 잡은 순간 열려 있던 ⋯ 메뉴를 닫는다 */
  closeTileMenu(): void;
}

// ---------------------------------------------------------------------------
// 드랍 — 판정은 전부 `pane/drop-rules.ts` 의 순수 함수가 든다 (표는 그 파일 머리말).
//
// 여기 남는 것은 **DOM 에서 값을 캐고, 판정이 낸 계획을 실행하는 일**뿐이다:
// 커서 아래 상자 찾기(분할은 시작 스냅숏 · 파일은 `paneUnder`) · 4분면 재기(`zoneOf`) · `preventDefault` 와
// `dropEffect` 걸기 · 하이라이트 상태 갱신 · 계획대로 상위 콜백 부르기.
//
// **같은 판정 함수를 `dragover` 와 `drop` 두 곳에서 부른다.** 미리보기가 받아 준 드래그를
// 놓았을 때 아무 일도 안 나는 어긋남이 그러면 생길 수 없다 — 다른 것은 넘기는 값의
// 확실성뿐이다 (`dragover` 에서는 종류만 보이고, `drop` 에서야 값을 읽을 수 있다).
// ---------------------------------------------------------------------------

/** 커서 아래의 패널 상자 (없으면 null — 분할선 위 등) */
function paneUnder(ev: DragEvent): { tabId: string; id: string; rect: DOMRect } | null {
  const t = ev.target;
  if (!(t instanceof Element)) return null;
  const owner = t.closest<HTMLElement>("[data-pane]");
  const id = owner?.dataset.pane;
  const tabId = owner?.dataset.tab;
  if (!owner || !id || !tabId) return null;
  return { tabId, id, rect: owner.getBoundingClientRect() };
}

export class DropController {
  #h: DropHost;
  // 접힌 DOM 을 다시 재면 타일 판정이 뒤집힌다 — 첫 dragover 의 보이는 상자를 끝까지 쓴다.
  #snapshot: DropSnapshotItem[] | null = null;

  /** 지금 드래그가 올라가 있는 곳 (하이라이트 = 드랍 미리보기). 드랍·이탈 시 지운다 */
  dropTarget = $state<{
    tabId: string;
    paneId: string;
    kind: PaneKind | null;
    zone: DropZone;
    dir: SplitDir;
    side: PaneSide;
    /** 분할 자리인가(`zone` — 접힘 또는 절반 하이라이트) 상자 전체인가(`all` — 시작 타일) */
    preview: "zone" | "all";
  } | null>(null);

  /**
   * 상자를 통째로 덮는 드래그가 올라가 있는 패널. 4분면이 없는 이유는 **뜻이 없기 때문**이다 —
   * 파일은 서버로 올라가거나(`upload`) AI 입력창에 첨부되고(`attach`), 경로 묶음은 그
   * 터미널 안으로 들어간다(`paste`). 무슨 일이 일어나는지는 오버레이의 문구가 말한다.
   */
  fileTarget = $state<{
    tabId: string;
    paneId: string;
    mode: "upload" | "paste" | "attach";
    /** 오버레이 문구 — 대개 `mode` 와 같고, 파일 타일 짐만 출처에 따라 갈린다 (`fsPasteLabel`) */
    label: DropLabelKind;
  } | null>(null);

  constructor(h: DropHost) {
    this.#h = h;
  }

  /** 캔버스 밖·드롭·취소에서 한꺼번에 거둔다. 탭/독에서 시작한 dragend 도 이 문을 쓴다. */
  clearTargets = () => {
    this.#snapshot = null;
    this.dropTarget = null;
    this.fileTarget = null;
  };

  #captureSnapshot(): DropSnapshotItem[] {
    const visible = new Set(this.#h.boxes.filter((b) => b.visible).map((b) => b.pane.id));
    const snapshot: DropSnapshotItem[] = [];
    for (const owner of this.#h.host?.querySelectorAll<HTMLElement>("[data-pane]") ?? []) {
      const id = owner.dataset.pane;
      const tabId = owner.dataset.tab;
      if (!id || !tabId || !visible.has(id)) continue;
      const rect = owner.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) snapshot.push({ id, tabId, rect });
    }
    return snapshot;
  }

  onDragOver = (ev: DragEvent) => {
    const types = ev.dataTransfer?.types;
    const kind = dragKind(types);
    if (kind === null) return; // 우리 것이 아니면 손대지 않는다 (= 드랍 거부)
    const splitDrag = kind === "hosts" || kind === "tab" || kind === "pane";
    if (splitDrag && this.#snapshot === null) this.#snapshot = this.#captureSnapshot();
    // **타일 안의 화면이 스스로 받는 자리에는 양보한다** — OS 파일은 파일 타일 트리의 줄에
    // (docs/log/2026-09-25-file-tree-view.md). 트리 보기의 줄(`[data-inner-drop-files]`)은 놓인 파일을
    // **그 줄의 폴더**로 받는다. 양보하지 않으면 두 가지가 어긋난다(줄 위에서도 타일 전체 하이라이트가
    // 뜬다 · 줄이 드롭을 가져가면 이쪽 하이라이트가 잔상으로 남는다). (시작 화면 즐겨찾기 줄의 호스트 드롭
    // 양보 `[data-inner-drop]` 는 그 줄과 함께 2026-10-23 에 걷었다.) 빈 바닥은 예전 그대로 여기서 받아 뿌리로 보낸다.
    if (kind === "files" && ev.target instanceof Element && ev.target.closest("[data-inner-drop-files]")) {
      this.dropTarget = null;
      this.fileTarget = null;
      return;
    }
    const at = splitDrag && this.#snapshot !== null
      ? paneAtSnapshot(this.#snapshot, ev.clientX, ev.clientY)
      : paneUnder(ev);
    if (!at) {
      this.dropTarget = null;
      this.fileTarget = null;
      return;
    }
    const target = {
      kind: this.#h.kindById.get(at.id) ?? null,
      agent: this.#h.boxes.some((b) => b.pane.id === at.id && isAgentPane(b.pane)),
      tabId: at.tabId,
      paneId: at.id,
      orch: this.#h.boxes.some((b) => b.tab.id === at.tabId && isOrchTab(b.tab)),
    };
    const zone = zoneOf(at.rect, ev.clientX, ev.clientY);
    const plan = dropPlan(
      {
        kind,
        // `dragover` 에서는 값을 못 읽으므로 **종류 + 이 창의 드래그 표시**로 추측한다.
        // 번호를 읽어 확인하는 것은 놓는 순간이다 (아래 `onDrop`).
        foreign: isForeignDrag(types, kind, { tab: draggingTab(), pane: draggingPane() }),
        sourceTabId: draggingTab(),
        sourcePaneId: draggingPane(),
      },
      target,
      zone,
    );
    if (!plan.accept) {
      // 무동작이든 양보든 `preventDefault` 를 부르지 않는 것이 요점이다 — 그래야 이 층이
      // 드롭 대상이 되지 않고, 안쪽 화면(파일 브라우저)이 그 드래그를 가져간다.
      this.dropTarget = null;
      this.fileTarget = null;
      return;
    }
    ev.preventDefault(); // preventDefault 가 곧 "여기 놓아도 된다" 는 신호다
    if (ev.dataTransfer && plan.effect) ev.dataTransfer.dropEffect = plan.effect;
    if (plan.split) {
      this.fileTarget = null;
      // 같은 칸이면 대입하지 않는다 — 매 dragover 마다 상태를 건드려 재렌더를 돌릴 이유가 없다
      if (
        this.dropTarget?.tabId !== at.tabId || this.dropTarget.paneId !== at.id ||
        this.dropTarget.zone !== zone || this.dropTarget.preview !== plan.preview
      ) {
        this.dropTarget = {
          tabId: at.tabId,
          paneId: at.id,
          kind: target.kind,
          zone,
          ...plan.split,
          preview: plan.preview === "all" ? "all" : "zone",
        };
      }
      return;
    }
    this.dropTarget = null;
    const mode = plan.outcome === "paste" || plan.outcome === "attach" ? plan.outcome : "upload";
    // 파일 타일 짐은 **같은 창의 활성 드래그**(`fsDragActive`)에서 출처를 읽어 문구를 맞춘다 — `dragover` 에서는
    // `dataTransfer` 값을 못 읽는다. 남의 창에서 온 짐이면 모르는 채로 예전 문구다(놓을 때 다시 판정한다).
    let label: DropLabelKind = mode;
    if (kind === "fsfiles" && mode === "paste") {
      const drag = fsDragActive();
      const pane = this.#h.boxes.find((b) => b.pane.id === at.id)?.pane;
      label = fsPasteLabel(drag && pane ? fsDropRouteTo(pane, drag, true) : null, target.agent);
    }
    if (this.fileTarget?.paneId !== at.id || this.fileTarget.mode !== mode || this.fileTarget.label !== label) {
      this.fileTarget = { tabId: at.tabId, paneId: at.id, mode, label };
    }
  };

  /** 컨테이너 **밖**으로 나갔을 때만 하이라이트를 지운다 (자식 사이 이동도 dragleave 를 낸다) */
  onDragLeave = (ev: DragEvent) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && this.#h.host?.contains(to)) return;
    // 접힌 상자에서 빈 슬롯으로 넘어가도 캔버스 안이다. relatedTarget 이 없으면 좌표로 확인한다.
    if (to === null && this.#snapshot !== null) {
      const rect = this.#h.host?.getBoundingClientRect();
      if (rect && ev.clientX >= rect.left && ev.clientX < rect.right &&
        ev.clientY >= rect.top && ev.clientY < rect.bottom) return;
    }
    this.clearTargets();
  };

  onDrop = (ev: DragEvent) => {
    const target = this.dropTarget;
    const files = this.fileTarget;
    this.clearTargets();
    const kind = dragKind(ev.dataTransfer?.types);
    if (kind === null) return;
    // 파일 타일에서 끌어온 경로 묶음 — **터미널에 붙여넣는다**. 여기까지 온 것은 커서
    // 아래가 터미널 타일일 때뿐이고(위 `dragover` 가 그때만 받았다), 파일 타일 위의 드롭은
    // 안쪽 브라우저가 이미 처리하고 전파를 끊었다.
    //
    // **엔터를 붙이지 않는다.** 붙여넣기이지 실행이 아니다 — 사람이 앞에 `scp` 든 `rm` 이든
    // 적어 넣을 자리를 남긴다 (경로 여럿을 끌어다 놓는 몸짓의 뜻이 대개 그것이다).
    if (kind === "fsfiles") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!files || files.mode !== "paste") return;
      const payload = decodeFsDrag(ev.dataTransfer?.getData(FS_DRAG_TYPE) ?? "");
      if (fsDragEmpty(payload)) return;
      // 같은 곳인지·AI 타일인지에 따라 갈리는 일은 상위가 맡는다 (`app/transfer` 의 `pasteFsDrag`).
      if (this.#h.onfspaste) this.#h.onfspaste(files.tabId, files.paneId, payload);
      else broadcastInput([files.paneId], shellQuoteAll(payload.paths));
      return;
    }

    // OS 파일 — AI 타일에는 첨부하고, 나머지는 업로드/복사 대상 판정을 상위가 맡는다.
    // `preventDefault` 가 여기서도 필수다: 막지 않으면 웹뷰가 그 파일로 이동해 버린다.
    if (kind === "files") {
      ev.preventDefault();
      ev.stopPropagation();
      const list = Array.from(ev.dataTransfer?.files ?? []);
      if (files && list.length > 0) this.#h.onfiledrop?.(files.tabId, files.paneId, list);
      return;
    }
    // 여기서 탭을 놓으면 그 탭은 곧 목록에서 사라진다 — 원소가 DOM 에서 빠지면 `dragend` 가
    // 탭 바까지 올라오지 않으므로(거기가 정리 담당이다) 끌던 탭 표시는 여기서도 지워 둔다.
    setDraggingTab(null);
    setDraggingPane(null);
    ev.preventDefault();
    ev.stopPropagation(); // 빈 화면용 드랍(= 새 탭)이 뒤이어 또 처리하지 않게
    if (!target) return;

    // 이제는 값을 읽을 수 있다 — **다른 창에서 왔는가**를 번호로 확정하고, 끌린 id 도
    // `dataTransfer` 에서 그대로 읽어 같은 판정 함수에 넘긴다
    // (docs/log/2026-09-04-tear-merge-fixes.md).
    const token = foreignTearToken(ev.dataTransfer);
    const sourceTabId = ev.dataTransfer?.getData(TAB_DRAG_TYPE) ?? "";
    const sourcePaneId = ev.dataTransfer?.getData(PANE_DRAG_TYPE) ?? "";
    const plan = dropPlan(
      { kind, foreign: token !== null, sourceTabId, sourcePaneId },
      {
        kind: target.kind,
        tabId: target.tabId,
        paneId: target.paneId,
        orch: this.#h.boxes.some((b) => b.tab.id === target.tabId && isOrchTab(b.tab)),
      },
      target.zone,
    );
    if (!plan.split) return;
    const { dir, side } = plan.split;
    switch (plan.outcome) {
      case "adopt":
        if (token !== null) this.#h.ontearmergeinto?.(token, target.tabId, target.paneId, dir, side);
        return;
      case "merge":
        this.#h.ondroptab?.(sourceTabId, target.paneId, dir, side);
        return;
      case "move":
        this.#h.onmovepane?.(sourcePaneId, target.paneId, dir, side);
        return;
      case "open": {
        // 짐을 펴는 것(폴더 → 그 아래 전부)도, 하나면 분할·여럿이면 격자로 넣는 것도
        // 받는 쪽의 몫이라 여기서는 그대로 올린다.
        const payload = decodeHostsDrag(ev.dataTransfer?.getData(HOSTS_DRAG_TYPE) ?? "");
        if (hostsDragEmpty(payload)) return;
        this.#h.ondrophosts?.(target.tabId, target.paneId, dir, side, payload);
        return;
      }
    }
  };

  /**
   * 패널 헤더에서 시작한 드래그 — 실어 나르는 것은 **패널 id 하나**다.
   * 헤더 안의 버튼에서 시작한 드래그는 거절한다: 누르려다 1px 흔들린 것을 드래그로 읽으면
   * 패널이 엉뚱한 데로 날아간다.
   *
   * 여기에 **창을 넘길 준비**가 하나 더 붙는다 (`x-aynx-tear` — 탭 드래그와 같은 방식).
   * 드래그가 창 밖으로 나간 뒤에는 `dataTransfer` 를 못 건드리므로 시작 시점에 미리 싣는다.
   * 창 안 판정(`dragKind`)은 내부 타입을 **먼저** 보고 `x-aynx-pane` 에서 멈추므로
   * (`Tabs` 의 `isPaneDrag` 도 같다) 이 한 종류가 늘어도 분할·이동·승격은 그대로다.
   */
  onDragStart = (ev: DragEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const head = t.closest<HTMLElement>("[data-pane-head]");
    const id = head?.dataset.paneHead;
    const dt = ev.dataTransfer;
    if (!id || !dt) return;
    // 머리줄 안의 **제 끌기가 있는 칸**(쿼리 타일의 스크립트 탭 — 머리줄로 올라온 도구줄 · 2026-10-20)은 그 칸의 끌기다 — 건드리지 않는다
    if (t.closest('[draggable="true"]') !== head) return;
    // 단추 · 입력 칸에서는 타일을 끌지 않는다(입력 칸은 글자를 고르는 자리다)
    if (t.closest("button, input, textarea, select, [contenteditable]")) {
      ev.preventDefault();
      return;
    }
    // 오케스트레이션 탭의 타일(프로듀서 · 플레이어)은 끌지 않는다(2026-10-29 — 노트 D11 · 0-3 Q1=B: 배치는 앱이 쥐고, 프로듀서가 탭 · 창
    // 밖으로 나가면 앨범을 못 연다). 분할선 끌기(비율)는 이 길이 아니라 그대로 된다.
    if (isOrchTab(tabOfPane(id))) {
      ev.preventDefault();
      return;
    }
    this.#h.closeTileMenu(); // 손잡이를 잡은 순간 열려 있던 ⋯ 메뉴는 뜻을 잃는다
    setDraggingPane(id);
    dt.setData(PANE_DRAG_TYPE, id);
    const token = this.#h.ontearstart?.(id) ?? null;
    if (token !== null) dt.setData(TEAR_DRAG_TYPE, String(token));
    dt.effectAllowed = "move";
  };

  /**
   * 드래그가 끝났다 — 창 **밖**에서 아무 데도 안 놓였으면 그 타일만 떼어 **새 창으로**
   * (docs/log/2026-09-04-pane-tear-out.md). 그 외에는 예약만 버린다.
   *
   * 표시 정리(`setDraggingPane(null)` · 하이라이트)는 **판정보다 먼저** 한다: 티어아웃은
   * 비동기로 이어지므로, 여기서 안 지우면 창을 여는 동안 끌던 표시가 화면에 남는다.
   * 그래서 끌던 타일 id 는 지우기 전에 손에 쥔다 — 예약이 **이번 드래그의 것**인지
   * 확인하는 데 쓴다 (탭 바에 놓아 승격된 경우는 `Tabs` 가 이미 지워 `null` 이고,
   * 그때는 판정이 자연히 빠진다).
   */
  onDragEnd = (ev: DragEvent) => {
    const dragged = draggingPane();
    setDraggingPane(null);
    this.clearTargets();
    const p = pendingTear();
    if (
      this.#h.ontearoutpane &&
      dragged !== null &&
      p?.paneId === dragged &&
      ev.dataTransfer?.dropEffect === "none" &&
      outsideWindow(ev)
    ) {
      this.#h.ontearoutpane(ev.screenX, ev.screenY); // 예약 정리는 그쪽이 (비동기라) 맡는다
      return;
    }
    // 창 밖에 놓았는데 이 타일의 예약이 없었다 = 시작에서 창 넘기기가 거절됐다(저장 안 한 문서 등 — 상위가 가린다)
    if (dragged !== null && p?.paneId !== dragged && ev.dataTransfer?.dropEffect === "none" && outsideWindow(ev)) {
      this.#h.ontearrefused?.();
    }
    endTear();
  };
}
