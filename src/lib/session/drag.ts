// 탭·패널 드래그 상태와 탭 바 순서 조작.
// 끄는 id 를 모듈 변수에 두는 이유: `dragover` 에서는 값을 못 읽고 종류만 볼 수 있어(브라우저 보안 규칙) "자기 자신 위에는 못
// 놓는다" 를 미리보기 단계에서 판정할 방법이 이것뿐이다. `$state` 가 아니다 — 이벤트 핸들러만 읽는다(드랍은 `getData` 가 진실).

import type { TabSpec } from "./spec";

// ── 탭 드래그 ── 호스트 드래그(`HOST_DRAG_TYPE`)와 데이터 종류로만 구분한다.

export const TAB_DRAG_TYPE = "application/x-aynx-tab";

let draggingTabId: string | null = null;

export function setDraggingTab(id: string | null): void {
  draggingTabId = id;
}

export function draggingTab(): string | null {
  return draggingTabId;
}

// ── 패널 드래그 ──

export const PANE_DRAG_TYPE = "application/x-aynx-pane";

let draggingPaneId: string | null = null;

export function setDraggingPane(id: string | null): void {
  draggingPaneId = id;
}

export function draggingPane(): string | null {
  return draggingPaneId;
}

/** `beforeId` 가 `null` 이면 맨 뒤로 */
export function moveTab(
  tabs: readonly TabSpec[],
  dragId: string,
  beforeId: string | null,
): TabSpec[] {
  const moved = tabs.find((t) => t.id === dragId);
  if (!moved || beforeId === dragId) return [...tabs];
  const rest = tabs.filter((t) => t.id !== dragId);
  if (beforeId === null) return [...rest, moved];
  const at = rest.findIndex((t) => t.id === beforeId);
  if (at < 0) return [...rest, moved];
  rest.splice(at, 0, moved);
  return rest;
}

/** 대상이 목록에 없으면 빈 배열 — 메뉴가 뜬 사이 그 탭이 닫혔으면 아무것도 닫지 않는다 */
export function tabsToClose(
  tabs: readonly Pick<TabSpec, "id">[],
  targetId: string,
  which: "others" | "right",
): string[] {
  const at = tabs.findIndex((t) => t.id === targetId);
  if (at < 0) return [];
  const picked = which === "right" ? tabs.slice(at + 1) : tabs.filter((t) => t.id !== targetId);
  return picked.map((t) => t.id);
}
