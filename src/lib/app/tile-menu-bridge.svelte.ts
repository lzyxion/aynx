// **폰 위 띠의 ⋯ → 타일 ⋯ 메뉴**(원격 웹 R5 · 10-20). 폰 배치는 타일 머리줄을 그리지 않으므로(`PaneHost` 의 `headed`) 머리줄 ⋯ 가 열던
// 메뉴를 위 띠(`MobileBar`)의 ⋯ 가 연다. 메뉴의 상태 · 항목 · 실행(menu-runner 통로)은 그대로 `PaneHost` 가 쥐고, 여기는 둘을 잇는 문 하나다 —
// `PaneHost` 가 여는 함수를 걸고(창마다 하나), 위 띠가 부른다. 걸려 있지 않으면 아무 일도 없다.

let opener: ((trigger: HTMLElement) => void) | null = null;
let openPane = $state<string | null>(null);

/** `PaneHost` 가 건다 — 지금 보이는 타일의 ⋯ 메뉴를 `trigger` 아래에 연다(이미 열려 있으면 닫는다). 돌려준 함수로 푼다. */
export function registerTileMenuOpener(fn: (trigger: HTMLElement) => void): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

/** 위 띠의 ⋯ — 지금 보이는 타일의 ⋯ 메뉴를 연다 · 닫는다 */
export function toggleFocusedTileMenu(trigger: HTMLElement): void {
  opener?.(trigger);
}

/** `PaneHost` 가 알린다 — ⋯ 메뉴가 열린 타일(없으면 `null`) */
export function noteTileMenuPane(paneId: string | null): void {
  openPane = paneId;
}

/** ⋯ 메뉴가 열려 있는가(위 띠 ⋯ 의 `aria-expanded`) */
export function tileMenuOpen(): boolean {
  return openPane !== null;
}
