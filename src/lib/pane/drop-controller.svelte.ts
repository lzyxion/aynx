// 타일 캔버스의 끌어다 놓기 — 판정은 `pane/drop-rules.ts`, 여기는 DOM 에서 값을 캐고 계획을 실행한다.
// 불변식: 분할 판정은 첫 dragover 의 보이는 상자에 고정한다 — 접힌 DOM 을 재면 접힘·원복이 진동한다.
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
  readonly host: HTMLDivElement | null;
  readonly boxes: HostBox[];
  readonly kindById: Map<string, PaneKind>;
  closeTileMenu(): void;
}

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
  #snapshot: DropSnapshotItem[] | null = null;

  dropTarget = $state<{
    tabId: string;
    paneId: string;
    kind: PaneKind | null;
    zone: DropZone;
    dir: SplitDir;
    side: PaneSide;
    preview: "zone" | "all";
  } | null>(null);

  fileTarget = $state<{
    tabId: string;
    paneId: string;
    mode: "upload" | "paste" | "attach";
    label: DropLabelKind;
  } | null>(null);

  constructor(h: DropHost) {
    this.#h = h;
  }

  /** 탭 · 독에서 시작한 dragend 도 이 문을 쓴다 */
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
    if (kind === null) return;
    const splitDrag = kind === "hosts" || kind === "tab" || kind === "pane";
    if (splitDrag && this.#snapshot === null) this.#snapshot = this.#captureSnapshot();
    // 파일 타일 트리의 줄(`[data-inner-drop-files]`)은 놓인 파일을 그 줄의 폴더로 받는다 — 양보하지 않으면 하이라이트가 잔상으로 남는다
    // (docs/log/2026-09-25-file-tree-view.md)
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
        foreign: isForeignDrag(types, kind, { tab: draggingTab(), pane: draggingPane() }),
        sourceTabId: draggingTab(),
        sourcePaneId: draggingPane(),
      },
      target,
      zone,
    );
    if (!plan.accept) {
      // `preventDefault` 를 부르지 않는 것이 요점이다 — 그래야 안쪽 화면(파일 브라우저)이 그 드래그를 가져간다
      this.dropTarget = null;
      this.fileTarget = null;
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer && plan.effect) ev.dataTransfer.dropEffect = plan.effect;
    if (plan.split) {
      this.fileTarget = null;
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
    // `dragover` 에서는 `dataTransfer` 값을 못 읽어 같은 창의 활성 드래그(`fsDragActive`)에서 출처를 읽는다
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

  /** 자식 사이 이동도 dragleave 를 낸다 — 컨테이너 밖으로 나갔을 때만 지운다 */
  onDragLeave = (ev: DragEvent) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && this.#h.host?.contains(to)) return;
    // 접힌 상자에서 빈 슬롯으로 넘어가도 캔버스 안이다 — relatedTarget 이 없으면 좌표로 확인한다
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
    // 엔터를 붙이지 않는다 — 붙여넣기이지 실행이 아니다
    if (kind === "fsfiles") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!files || files.mode !== "paste") return;
      const payload = decodeFsDrag(ev.dataTransfer?.getData(FS_DRAG_TYPE) ?? "");
      if (fsDragEmpty(payload)) return;
      if (this.#h.onfspaste) this.#h.onfspaste(files.tabId, files.paneId, payload);
      else broadcastInput([files.paneId], shellQuoteAll(payload.paths));
      return;
    }

    // `preventDefault` 가 필수다 — 막지 않으면 웹뷰가 그 파일로 이동해 버린다
    if (kind === "files") {
      ev.preventDefault();
      ev.stopPropagation();
      const list = Array.from(ev.dataTransfer?.files ?? []);
      if (files && list.length > 0) this.#h.onfiledrop?.(files.tabId, files.paneId, list);
      return;
    }
    // 놓은 탭은 곧 목록에서 사라져 `dragend` 가 탭 바(정리 담당)까지 올라오지 않는다 — 여기서도 지운다
    setDraggingTab(null);
    setDraggingPane(null);
    ev.preventDefault();
    ev.stopPropagation(); // 빈 화면용 드랍(= 새 탭)이 뒤이어 또 처리하지 않게
    if (!target) return;

    // 다른 창에서 왔는가를 번호로 확정하고 끌린 id 도 `dataTransfer` 에서 읽어 같은 판정에 넘긴다 (docs/log/2026-09-04-tear-merge-fixes.md)
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
        const payload = decodeHostsDrag(ev.dataTransfer?.getData(HOSTS_DRAG_TYPE) ?? "");
        if (hostsDragEmpty(payload)) return;
        this.#h.ondrophosts?.(target.tabId, target.paneId, dir, side, payload);
        return;
      }
    }
  };

  /**
   * 헤더 안의 단추에서 시작한 드래그는 거절한다 — 누르려다 1px 흔들린 것을 드래그로 읽으면 타일이 엉뚱한 데로 날아간다.
   * 창 밖으로 나간 뒤에는 `dataTransfer` 를 못 건드리므로 tear 표식은 시작 때 미리 싣는다.
   */
  onDragStart = (ev: DragEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const head = t.closest<HTMLElement>("[data-pane-head]");
    const id = head?.dataset.paneHead;
    const dt = ev.dataTransfer;
    if (!id || !dt) return;
    // 머리줄 안의 제 끌기가 있는 칸(쿼리 타일의 스크립트 탭)은 그 칸의 끌기다
    if (t.closest('[draggable="true"]') !== head) return;
    if (t.closest("button, input, textarea, select, [contenteditable]")) {
      ev.preventDefault();
      return;
    }
    // 오케스트레이션 탭의 타일은 끌지 않는다 — 배치는 앱이 쥐고, 프로듀서가 탭 · 창 밖으로 나가면 앨범을 못 연다
    if (isOrchTab(tabOfPane(id))) {
      ev.preventDefault();
      return;
    }
    this.#h.closeTileMenu();
    setDraggingPane(id);
    dt.setData(PANE_DRAG_TYPE, id);
    const token = this.#h.ontearstart?.(id) ?? null;
    if (token !== null) dt.setData(TEAR_DRAG_TYPE, String(token));
    dt.effectAllowed = "move";
  };

  /**
   * 창 밖에서 아무 데도 안 놓였으면 그 타일만 새 창으로 (docs/log/2026-09-04-pane-tear-out.md).
   * 표시 정리는 판정보다 먼저 한다 — 티어아웃이 비동기라 안 지우면 창을 여는 동안 끌던 표시가 남는다. 그래서 끌던 id 는 먼저 손에 쥔다.
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
    // 이 타일의 예약이 없었다 = 시작에서 창 넘기기가 거절됐다(저장 안 한 문서 등)
    if (dragged !== null && p?.paneId !== dragged && ev.dataTransfer?.dropEffect === "none" && outsideWindow(ev)) {
      this.#h.ontearrefused?.();
    }
    endTear();
  };
}
