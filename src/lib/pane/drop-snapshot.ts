/** 판정은 드래그 시작 때 찍은 client rect 에 고정한다 — 접힌 DOM 을 다시 겨누면 커서 아래 타일이 바뀌어 접힘 · 원복이 반복된다 */
export interface DropSnapshotItem {
  id: string;
  tabId: string;
  rect: DOMRect;
}

export function paneAtSnapshot(
  snapshot: readonly DropSnapshotItem[],
  clientX: number,
  clientY: number,
): DropSnapshotItem | null {
  return snapshot.find(({ rect }) =>
    rect.width > 0 && rect.height > 0 &&
    clientX >= rect.left && clientX < rect.right &&
    clientY >= rect.top && clientY < rect.bottom,
  ) ?? null;
}
