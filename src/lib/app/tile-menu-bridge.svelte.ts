// 폰 위 띠(`MobileBar`)의 ⋯ 가 타일 ⋯ 메뉴를 여는 문 — 폰 배치는 타일 머리줄을 그리지 않는다. 메뉴의 상태 · 실행은 `PaneHost` 가 쥔다.

let opener: ((trigger: HTMLElement) => void) | null = null;
let openPane = $state<string | null>(null);

export function registerTileMenuOpener(fn: (trigger: HTMLElement) => void): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

export function toggleFocusedTileMenu(trigger: HTMLElement): void {
  opener?.(trigger);
}

export function noteTileMenuPane(paneId: string | null): void {
  openPane = paneId;
}

export function tileMenuOpen(): boolean {
  return openPane !== null;
}
