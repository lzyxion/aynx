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
 * **모달을 닫으면 키보드는 원래 있던 자리로 돌아간다** — 규칙 하나, 배선 두 줄.
 *
 * 증상은 모달마다 같았다: 비밀번호·포워딩·호스트 키·스니펫 자리표시자·레이아웃 저장·호스트 폼
 * 무엇이든 [저장]·[취소]·Escape 로 닫으면 **그 뒤로 타이핑이 아무 데도 닿지 않았다.** 모달은
 * `{#if}` 로 마운트되므로 닫는 순간 포커스를 쥐고 있던 요소가 문서에서 사라지고, 브라우저는
 * 포커스를 `<body>` 로 떨어뜨린다 — 타일을 한 번 클릭해야 셸이 다시 키를 받았다.
 *
 * 쓰는 법은 모달마다 두 줄이다:
 *
 * ```ts
 * export function openThing(): void { rememberFocusOrigin("thing"); thingOpen = true; }
 * export function closeThing(): void { thingOpen = false; returnFocus("thing"); }
 * ```
 *
 * ## 돌아갈 자리는 **키보드가 있던 타일**이지 모달의 대상이 아니다
 *
 * 포트 포워딩 대화상자는 타일 B 의 ⋯ 메뉴에서 열리지만(`openForwardFor` 가 그 타일을 활성으로
 * 만든다), 열리기 **직전에** 키보드를 쥐고 있던 것이 타일 A 라면 닫은 뒤 다시 칠 곳도 A 다.
 * 그래서 [`rememberFocusOrigin`] 은 대상이 아니라 그 순간의 `document.activeElement` 를 보고,
 * 모달을 여는 함수에서 **가장 먼저** 불린다 (타일을 옮기는 줄보다 앞이다).
 *
 * ## 판정과 겹침 규칙은 [`$lib/focus-return`] 에 있다
 *
 * 열린 모달 표(이름표 → 자리)와 "어디로 돌려줄까" 는 DOM 도 룬도 모르는 순수 모듈이라 통째로
 * 테스트된다. 여기 남은 것은 **스냅샷을 찍고 실제로 `.focus()` 를 부르는 일**뿐이다.
 *
 * ## 이 규칙을 타지 않는 것들 (각자 이미 돌려준다)
 *
 * - **런처 독·설정 모달** — `app/dock.svelte.ts` 가 자기 `returnFocusTo` 를 쥐고 있고,
 *   런처 바깥 클릭처럼 **갈 곳을 스스로 정한** 닫기는 일부러 돌려주지 않는다.
 * - **붙여넣기 확인** — `Terminal.svelte` 안의 타일 지역 모달이라 `if (active) term?.focus()`
 *   한 줄이 이미 그 타일로 돌려준다.
 */

/**
 * 이 모달이 열린다 — 지금 포커스가 어디 있는지 적어 둔다.
 *
 * `key` 는 모달마다 하나인 이름표다. 같은 이름표로 두 번 열면 덮어쓴다 (겹쳐 쌓이지 않는다).
 */
export function rememberFocusOrigin(key: string): void {
  pushFocusOrigin(key, snapshotOrigin());
}

/**
 * 이 모달이 닫혔다 — **마지막 하나였으면** 적어 둔 자리로 포커스를 돌려준다.
 *
 * 닫는 상태 변경 **뒤에** 부른다. 실제로 옮기는 것은 `tick()` 다음이다 — 그 전에는 모달의 DOM 이
 * 아직 붙어 있어, 포커스를 줘 봐야 언마운트가 곧바로 도로 빼앗는다.
 */
export function returnFocus(key: string): void {
  const origin = popFocusOrigin(key);
  if (origin === null) return;
  void tick().then(() => applyFocusReturn(origin));
}

/**
 * 돌려주지 않고 **잊는다** — 닫으면서 갈 곳을 스스로 정한 경로용
 * (검색 결과 점프: 포커스는 방금 간 타일의 것이다).
 */
export function forgetFocusOrigin(key: string): void {
  dropFocusOrigin(key);
}

/** 지금 이 순간의 포커스 자리 */
function snapshotOrigin(): FocusOrigin {
  if (typeof document === "undefined") return { paneId: null, element: null, inTile: false };
  const raw = document.activeElement;
  // `<body>` 는 "아무 데도 없다" 와 같은 뜻이다 — 적어 둬 봐야 돌려줄 때 쓸모가 없다.
  const element = raw instanceof HTMLElement && raw !== document.body ? raw : null;
  const inTileId = element?.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? null;
  return {
    // 타일 밖이거나 이미 `<body>` 였으면 **앱이 포커스 타일로 치고 있는 것**을 적어 둔다
    // (메뉴 항목처럼 "닫으면서 실행" 하는 경로는 여는 시점에 이미 포커스를 놓친 뒤다).
    paneId: inTileId ?? focusedPane()?.id ?? null,
    element,
    inTile: inTileId !== null,
  };
}

/**
 * **포커스를 되찾는 것은 아무도 가져가지 않았을 때뿐이다.**
 *
 * 닫으면서 **다음 자리를 스스로 정하는** 경로가 여럿 있다 — 팔레트의 한 줄은 닫고 나서 타일을
 * 열거나 다른 모달을 띄우고, 세션이 죽어 저절로 닫힌 대화상자 뒤에서 사람은 이미 다른 타일을
 * 치고 있다. 그 자리들에서 옛 자리로 한 번 더 옮기면 방금 간 곳에서 튕겨 나간다.
 *
 * 판정은 한 줄이면 된다: `tick()` 시점에 포커스가 여전히 `<body>`(= 언마운트가 떨어뜨린 그
 * 자리)면 잃어버린 것이고, 실제 요소에 있으면 누군가 가져간 것이다.
 */
function focusIsLost(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body || el === document.documentElement;
}

function applyFocusReturn(origin: FocusOrigin): void {
  if (typeof document === "undefined") return;
  // 그 사이에 다른 모달이 열렸으면 그쪽이 주인이다 (닫히면 그쪽이 자기 자리로 돌려준다).
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
  // 링과 키는 함께 간다 — DOM 포커스만 옮기면 테두리는 저기 있는데 글자는 여기로 들어간다
  // (`pane/focus.ts` 의 `routeTileFocus` 주석이 말하는 그 어긋남).
  if (tab !== null) focusTile(tab.id, plan.id);
  focusPaneBody(plan.id);
}
