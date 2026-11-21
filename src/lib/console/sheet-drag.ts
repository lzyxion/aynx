/** 세션 판 칸 끌기의 판정 — 놓는 자리는 타일 위 드롭과 같은 `dropPlan` 을 쓴다. 보조 창 칸은 이 창에 트리가 없어 `leaf: null` 이다. */
import { isOrchTab } from "$lib/orchestration/orch-tab";
import { dropPlan, type DropPlan } from "$lib/pane/drop-rules";
import type { DropZone } from "$lib/layout";
import type { PaneKind, TabSpec } from "$lib/session";

export interface SheetLeaf {
  tab: Pick<TabSpec, "id" | "orch">;
  kind: PaneKind;
}

/** 오케스트레이션 탭은 앱이 쥔 배치라 끌지 않는다 */
export function canDragCell(leaf: SheetLeaf | null, mobile: boolean): boolean {
  if (mobile || leaf === null) return false;
  return !isOrchTab(leaf.tab) && leaf.kind !== "start";
}

/** `dragover` 와 `drop` 이 같은 값을 받아 부른다 */
export function cellDropPlan(sourcePaneId: string, paneId: string, leaf: SheetLeaf | null, zone: DropZone): DropPlan {
  const target = leaf === null
    ? { kind: null, tabId: "", paneId }
    : { kind: leaf.kind, orch: isOrchTab(leaf.tab), tabId: leaf.tab.id, paneId };
  return dropPlan({ kind: "pane", foreign: false, sourcePaneId }, target, zone);
}
