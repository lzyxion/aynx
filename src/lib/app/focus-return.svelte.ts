import { tick } from "svelte";
import {
  decideFocusReturn,
  dropFocusOrigin,
  openFocusOrigins,
  popFocusOrigin,
  pushFocusOrigin,
  type FocusOrigin,
} from "$lib/focus-return";
import { focusPaneBody } from "$lib/pane/focus";
import { activeTab, focusedPane, focusTile } from "$lib/app/tabs.svelte.js";
import { findPane } from "$lib/session";

/**
 * 모달을 닫으면 키보드는 원래 있던 자리로 돌아간다 — 모달이 언마운트되면 포커스가 `<body>` 로 떨어지기 때문이다.
 * 돌아갈 자리는 모달의 대상이 아니라 키보드가 있던 곳이다.
 */

/** 모달을 여는 함수에서 가장 먼저(타일을 옮기는 줄보다 앞) 부른다 */
export function rememberFocusOrigin(key: string): void {
  pushFocusOrigin(key, snapshotOrigin());
}

/** 닫는 상태 변경 뒤에 부른다 — `tick()` 전에 포커스를 주면 언마운트가 도로 빼앗는다 */
export function returnFocus(key: string): void {
  const origin = popFocusOrigin(key);
  if (origin === null) return;
  void tick().then(() => applyFocusReturn(origin));
}

/** 닫으면서 갈 곳을 스스로 정한 경로용 */
export function forgetFocusOrigin(key: string): void {
  dropFocusOrigin(key);
}

function snapshotOrigin(): FocusOrigin {
  if (typeof document === "undefined") return { paneId: null, element: null, inTile: false };
  const raw = document.activeElement;
  const element = raw instanceof HTMLElement && raw !== document.body ? raw : null;
  const inTileId = element?.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? null;
  return {
    // 메뉴 항목처럼 "닫으면서 실행" 하는 경로는 여는 시점에 이미 포커스를 놓친 뒤다 — 포커스 타일을 적는다
    paneId: inTileId ?? focusedPane()?.id ?? null,
    element,
    inTile: inTileId !== null,
  };
}

/** 누군가 포커스를 가져갔으면 되찾지 않는다 — 방금 간 곳에서 튕겨 나간다 */
function focusIsLost(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body || el === document.documentElement;
}

function applyFocusReturn(origin: FocusOrigin): void {
  if (typeof document === "undefined") return;
  // 그 사이에 다른 모달이 열렸으면 그쪽이 주인이다
  if (openFocusOrigins() > 0 || !focusIsLost()) return;
  const tab = activeTab();
  const plan = decideFocusReturn(origin, {
    paneVisible: (id) => tab !== null && findPane(tab.root, id) !== null,
    usable: (el) => el.isConnected,
  });
  if (plan === null) return;
  if (plan.kind === "element") {
    plan.el.focus({ preventScroll: true });
    return;
  }
  // 링과 키는 함께 간다 — DOM 포커스만 옮기면 테두리와 글자가 어긋난다
  if (tab !== null) focusTile(tab.id, plan.id);
  focusPaneBody(plan.id);
}
