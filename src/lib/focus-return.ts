/**
 * 모달이 닫히면 포커스를 원래 자리로 돌린다 — 열린 모달 표 + 판정(순수). 배선은 `app/focus-return.svelte.ts`.
 * 돌아갈 자리는 모달의 대상이 아니라 열 때 키보드가 있던 자리다.
 * 표는 스택이 아니라 이름표 표다 — 닫히는 순서가 열린 순서의 역이라는 보장이 없고, 다른 모달이 떠 있는데 포커스를 옮기면 그 모달이 키를 못 받는다.
 */

export interface FocusOrigin {
  /** 타일 밖이었거나 `<body>` 로 떨어진 뒤였으면 앱이 포커스 타일로 치는 것. `null` = 알 수 없다 */
  paneId: string | null;
  /** `<body>` · 없음은 `null` */
  element: HTMLElement | null;
  inTile: boolean;
}

export type FocusReturn =
  | { kind: "pane"; id: string }
  | { kind: "element"; el: HTMLElement }
  | null;

export interface FocusWorld {
  /** 지금 보고 있는 탭에 아직 있는가 */
  paneVisible(paneId: string): boolean;
  usable(el: HTMLElement): boolean;
}

/** 순서에 뜻이 있다 — 타일 밖에서 열었으면 그 요소가 타일보다 먼저다(독 검색 칸에서 연 폼이 터미널로 튕기지 않게) */
export function decideFocusReturn(origin: FocusOrigin | null, world: FocusWorld): FocusReturn {
  if (origin === null) return null;
  const { element, paneId, inTile } = origin;
  if (element !== null && !inTile && world.usable(element)) return { kind: "element", el: element };
  if (paneId !== null && world.paneVisible(paneId)) return { kind: "pane", id: paneId };
  if (element !== null && world.usable(element)) return { kind: "element", el: element };
  return null;
}

// ── 열려 있는 모달 표 ──

const open = new Map<string, FocusOrigin>();

export function pushFocusOrigin(key: string, origin: FocusOrigin): void {
  open.set(key, origin);
}

/** 마지막 하나였을 때만 돌려줄 자리를 내놓는다 */
export function popFocusOrigin(key: string): FocusOrigin | null {
  const origin = open.get(key);
  if (origin === undefined) return null;
  open.delete(key);
  return open.size === 0 ? origin : null;
}

/** 빼기만 한다 — 닫으면서 갈 곳을 스스로 정한 경로용(옛 자리로 또 옮기면 방금 간 곳에서 튕겨 나간다) */
export function dropFocusOrigin(key: string): void {
  open.delete(key);
}

export function openFocusOrigins(): number {
  return open.size;
}

/** 테스트용 — 앱은 부르지 않는다 */
export function resetFocusOrigins(): void {
  open.clear();
}
