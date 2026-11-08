// 탭·패널 드래그 상태(`DataTransfer` 종류 + 지금 끄는 id)와 탭 바 순서 조작(`moveTab`·`tabsToClose`).
// 불변식: 끄는 id 는 이 파일의 모듈 변수 둘에만 산다(`$state` 아님 — 이벤트 핸들러만 읽는다).

import type { TabSpec } from "./spec";

// ---------------------------------------------------------------------------
// 탭 드래그 (docs/log/2026-09-02-pane-host.md)
//
// 호스트 드래그(`HOST_DRAG_TYPE`)와 **데이터 종류로만** 구분한다. 받는 쪽은 `dragover`
// 에서 값을 못 읽고 종류만 볼 수 있으므로(브라우저 보안 규칙), 종류가 곧 분기점이다.
// ---------------------------------------------------------------------------

/** 탭을 끌 때 `DataTransfer` 에 싣는 종류 — 값은 탭 id 하나다 */
export const TAB_DRAG_TYPE = "application/x-aynx-tab";

/**
 * 지금 끌고 있는 탭의 id (`dragstart`~`dragend` 사이에만 값이 있다).
 *
 * `dragover` 에서는 **값을 읽을 수 없어** 종류만 알 수 있는데, "자기 자신 탭 위에는 못
 * 놓는다" 를 미리보기 단계에서 판정하려면 어느 탭인지가 필요하다. 드래그가 앱 안에서만
 * 일어나므로 모듈 변수 하나로 충분하다 (드랍은 여전히 `getData` 를 진실로 삼는다).
 * `$state` 가 아니다 — 렌더가 아니라 이벤트 핸들러 안에서만 읽힌다.
 */
let draggingTabId: string | null = null;

export function setDraggingTab(id: string | null): void {
  draggingTabId = id;
}

export function draggingTab(): string | null {
  return draggingTabId;
}

// ---------------------------------------------------------------------------
// 패널 드래그 (docs/log/2026-09-02-pane-identity.md)
//
// 손잡이는 **패널 헤더**다 (패널이 2개 이상인 탭에만 있다). 탭 드래그와 마찬가지로
// **놓는 곳이 뜻을 정한다**: 탭 바 = 새 탭으로 승격, 다른 패널 위 = 그 자리로 이동.
// 종류가 셋이 되었어도 판별은 그대로 `dataTransfer.types` 한 줄이다.
// ---------------------------------------------------------------------------

/** 패널을 끌 때 `DataTransfer` 에 싣는 종류 — 값은 패널 id 하나다 */
export const PANE_DRAG_TYPE = "application/x-aynx-pane";

/**
 * 지금 끌고 있는 패널의 id (`dragstart`~`dragend` 사이에만 값이 있다).
 * `draggingTab` 과 같은 이유로 존재한다 — `dragover` 에서는 값을 못 읽으므로
 * "자기 자신 위에는 못 놓는다" 를 미리보기 단계에서 판정할 방법이 이것뿐이다.
 */
let draggingPaneId: string | null = null;

export function setDraggingPane(id: string | null): void {
  draggingPaneId = id;
}

export function draggingPane(): string | null {
  return draggingPaneId;
}

/**
 * 탭 순서 바꾸기 — **순수 함수**. `dragId` 탭을 `beforeId` 탭 **앞으로** 옮긴 새 배열을 준다.
 * `beforeId` 가 `null` 이면 맨 뒤로. 대상이 없거나 자기 자신이면 순서가 그대로인 사본이다.
 */
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

/**
 * 탭 우클릭 메뉴의 "다른 탭 닫기"·"오른쪽 탭 닫기" 가 닫을 탭 id — **순수 함수**, 탭 바 순서 그대로.
 * `others` 는 대상만 빼고 전부, `right` 는 탭 바에서 대상 **뒤**의 탭들이다. 대상이 목록에 없으면
 * 빈 배열이다(메뉴가 뜬 사이 그 탭이 닫혔으면 아무것도 닫지 않는다) — 빈 배열이면 메뉴 항목은 꺼진다.
 * (docs/log/2026-09-28-tab-close-others.md)
 */
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
