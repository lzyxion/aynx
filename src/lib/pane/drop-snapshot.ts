/**
 * 드래그 시작 때 보이던 상자의 **좌표 판정** — DOM 을 읽지 않는 순수 모듈.
 *
 * 접힌 DOM 을 다시 겨누면 커서 아래 타일이 바뀌어 접힘·원복이 반복된다. 판정은 처음
 * 찍은 client rect 에 고정하고, 움직인 타일·고스트 위에서도 같은 좌표는 같은 답을 낸다.
 * 스냅숏의 채집·수명은 DropController 가 쥐고, 파일·경로 드롭은 기존 DOM 판정을 쓴다.
 */
export interface DropSnapshotItem {
  id: string;
  tabId: string;
  rect: DOMRect;
}

/** 거터·캔버스 밖은 null. 오른쪽·아래 경계는 다음 상자의 시작에 양보한다. */
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
