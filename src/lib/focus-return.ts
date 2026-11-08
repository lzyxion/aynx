/**
 * **모달이 닫히면 포커스는 원래 자리로 돌아간다** — 그 규칙의 순수 부분(열린 모달 표 + 판정).
 *
 * 앱의 모달은 전부 `{#if}` 로 마운트된다. 닫는 순간 그 안에 있던 요소가 문서에서 사라지고,
 * 브라우저는 포커스를 **`<body>` 로 떨어뜨린다** — 사용자가 보기에는 "저장을 눌렀더니 키보드가
 * 죽었다" 이고, 타일을 한 번 클릭해야 다시 칠 수 있다. 모달마다 각자 돌려주는 코드를 적으면
 * 모달이 늘 때마다 그 자리가 다시 생기므로 규칙을 **한 곳**에 못 박는다.
 *
 * ## 돌아갈 자리는 "모달의 대상" 이 아니라 **키보드가 있던 자리**다
 *
 * 포트 포워딩 대화상자는 타일 B 의 ⋯ 메뉴에서 열 수 있지만, 그때 **키보드를 쥐고 있던 것이**
 * 타일 A 라면 닫은 뒤 다시 칠 곳도 A 다. 그래서 여는 쪽은 대상이 아니라 그 순간의
 * `document.activeElement`(와 그것이 속한 타일)를 적어 둔다.
 *
 * ## 표는 스택이 아니라 **키가 붙은 표**다
 *
 * 모달은 겹쳐 뜰 수 있고(호스트 키 위에 비밀번호), 닫히는 순서가 열린 순서의 역이라는 보장이
 * 없다(세션이 죽으면 아래 깔린 것이 먼저 닫힌다). 그래서 모달마다 이름표 하나를 들고 들어오고,
 * **표가 비는 순간에만** 그 마지막 항목이 포커스를 돌려받는다 — 아직 다른 모달이 떠 있는데
 * 포커스를 터미널로 보내면 그 모달이 키를 못 받는다.
 *
 * 같은 이름표로 두 번 열면 **덮어쓴다**(항목이 쌓이지 않는다). 표에 없는 이름표를 닫는 것은
 * 아무 일도 아니다 — 열린 적 없는 모달의 닫기 경로가 그냥 지나간다.
 *
 * 이 파일은 **아무것도 import 하지 않는다**(DOM 도 만지지 않는다). 배선은
 * `app/focus-return.svelte.ts` 가 맡고, 여기 있는 것은 표와 판정뿐이라 통째로 테스트된다.
 */

/** 모달이 열리던 순간의 포커스 자리 */
export interface FocusOrigin {
  /**
   * 그때 키보드 포커스가 있던 **타일 id** (`null` = 알 수 없다).
   *
   * 포커스가 타일 안에 있었으면 그 타일이고, 밖(독·상태 표시줄)이거나 이미 `<body>` 로
   * 떨어진 뒤였으면 **앱이 포커스 타일로 치고 있는 것**을 대신 적는다.
   */
  paneId: string | null;
  /** 그때의 `document.activeElement` (`<body>`·없음은 `null` 로 적는다) */
  element: HTMLElement | null;
  /** 그 요소가 **타일 안**에 있었는가 — 밖이었으면 타일보다 그 요소가 먼저다 */
  inTile: boolean;
}

/** 돌려줄 자리 (`null` = 돌려줄 곳이 없다 — 아무것도 하지 않는다) */
export type FocusReturn =
  | { kind: "pane"; id: string }
  | { kind: "element"; el: HTMLElement }
  | null;

/** 판정이 바깥에 묻는 두 가지 — 테스트가 이 둘만 가짜로 세우면 된다 */
export interface FocusWorld {
  /** 그 타일이 **지금 보고 있는 탭에** 아직 있는가 */
  paneVisible(paneId: string): boolean;
  /** 그 요소가 아직 문서에 붙어 있고 포커스를 받을 수 있는가 */
  usable(el: HTMLElement): boolean;
}

/**
 * 어디로 돌려줄지 정한다.
 *
 * 순서에 뜻이 있다.
 *
 * 1. **타일 밖에서 열었으면 그 요소가 먼저다.** 독의 검색 칸에서 호스트 폼을 열었다면 돌아갈
 *    곳은 터미널이 아니라 그 칸이다 — 여기서 타일을 먼저 보면 사용자가 쓰던 화면에서 포커스가
 *    튕겨 나간다.
 * 2. **타일**. 그 타일이 아직 지금 탭에 있을 때만이다 (닫혔거나 다른 탭으로 옮겨 갔으면
 *    돌려주는 것이 오히려 화면을 끌고 간다).
 * 3. **남은 요소**. 타일이 사라졌어도 적어 둔 요소가 살아 있으면 그쪽이라도 준다.
 */
export function decideFocusReturn(origin: FocusOrigin | null, world: FocusWorld): FocusReturn {
  if (origin === null) return null;
  const { element, paneId, inTile } = origin;
  if (element !== null && !inTile && world.usable(element)) return { kind: "element", el: element };
  if (paneId !== null && world.paneVisible(paneId)) return { kind: "pane", id: paneId };
  if (element !== null && world.usable(element)) return { kind: "element", el: element };
  return null;
}

// ---------------------------------------------------------------------------
// 열려 있는 모달 표
// ---------------------------------------------------------------------------

/** 이름표 → 그 모달이 열리던 순간의 자리. 삽입 순서를 그대로 지키는 평범한 `Map` 이다 */
const open = new Map<string, FocusOrigin>();

/** 모달이 열렸다 — 같은 이름표가 이미 있으면 덮어쓴다 */
export function pushFocusOrigin(key: string, origin: FocusOrigin): void {
  open.set(key, origin);
}

/**
 * 모달이 닫혔다 — **마지막 하나였을 때만** 돌려줄 자리를 내놓는다.
 *
 * 아직 다른 모달이 떠 있으면 `null` 이다: 그때 포커스를 옮기면 위에 남은 모달이 키를 못 받는다.
 */
export function popFocusOrigin(key: string): FocusOrigin | null {
  const origin = open.get(key);
  if (origin === undefined) return null;
  open.delete(key);
  return open.size === 0 ? origin : null;
}

/**
 * 표에서 **빼기만** 한다 (돌려주지 않는다).
 *
 * 닫으면서 **갈 곳을 스스로 정한** 경로를 위한 문이다 — 검색 결과에서 한 줄을 고르면 오버레이는
 * 닫히지만 포커스는 점프한 타일의 것이다. 여기서 옛 자리로 한 번 더 옮기면 방금 간 곳에서
 * 튕겨 나간다 (독의 `closeDock(false)` 와 같은 사정).
 */
export function dropFocusOrigin(key: string): void {
  open.delete(key);
}

/** 지금 표에 들어 있는 모달 수 (테스트·진단용) */
export function openFocusOrigins(): number {
  return open.size;
}

/** 표를 통째로 비운다 (테스트용 — 앱은 부르지 않는다) */
export function resetFocusOrigins(): void {
  open.clear();
}
