/**
 * **세션 판 칸 끌기의 판정**(2026-11-04 — docs/log/2026-11-04-session-sheet-tile-drag.md).
 *
 * 놓는 자리의 판정은 새로 짓지 않는다 — 타일 위 드롭과 같은 표(`pane/drop-rules.ts` 의 `dropPlan`)에 칸의 잎을 넘길 뿐이다
 * (제자리 · 오케스트레이션 탭 · 시작 타일의 상자 전체 미리보기가 그대로 같다). 여기 있는 것은 판만의 규칙이다:
 *
 * - **끌 수 있는 칸** — 이 창의 탭에 있고(보조 창 탭은 이 창에 트리가 없다) 오케스트레이션 탭이 아니고(앱이 쥔 배치 — D11) 시작 타일이
 *   아니고(옮길 내용이 없다) 폰 배치가 아니다(터치에는 끌기가 없다).
 * - **놓을 수 있는 칸** — 이 창의 탭의 잎뿐. 보조 창 칸은 `leaf: null` 로 와서 받지 않는다.
 *
 * 룬도 DOM 도 없다 — node vitest 로 바로 테스트한다.
 */
import { isOrchTab } from "$lib/orchestration/orch-tab";
import { dropPlan, type DropPlan } from "$lib/pane/drop-rules";
import type { DropZone } from "$lib/layout";
import type { PaneKind, TabSpec } from "$lib/session";

/** 칸 하나의 사정 — 이 창의 탭의 잎이면 그 탭과 종류, 보조 창 칸이면 `null` */
export interface SheetLeaf {
  tab: Pick<TabSpec, "id" | "orch">;
  kind: PaneKind;
}

export function canDragCell(leaf: SheetLeaf | null, mobile: boolean): boolean {
  if (mobile || leaf === null) return false;
  return !isOrchTab(leaf.tab) && leaf.kind !== "start";
}

/** 칸 위에 놓으면 무슨 일이 일어나는가 — `dragover` 와 `drop` 이 같은 값을 받아 부른다. 보조 창 칸은 받지 않는다 */
export function cellDropPlan(sourcePaneId: string, paneId: string, leaf: SheetLeaf | null, zone: DropZone): DropPlan {
  const target = leaf === null
    ? { kind: null, tabId: "", paneId }
    : { kind: leaf.kind, orch: isOrchTab(leaf.tab), tabId: leaf.tab.id, paneId };
  return dropPlan({ kind: "pane", foreign: false, sourcePaneId }, target, zone);
}
