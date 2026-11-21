/**
 * 하단 가운데 독의 호버 띠 판정 — 끌기(`dragover`)도 이 함수를 지난다(HTML5 끌기 중에는 `pointermove` 가 오지 않는다).
 */

export const DOCK_HOT_HALF_WIDTH = 90;

export interface DockBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** `zone` = 독 뿌리 상자, `panel` = 보이는 동안의 판 상자(숨어 있으면 `null`) — 판과 띠 사이 틈에서 접히지 않게 판 위도 친다 */
export function inDockHover(
  x: number,
  y: number,
  viewportWidth: number,
  zone: DockBox | null,
  panel: DockBox | null,
): boolean {
  if (!zone) return false;
  const hot = Math.abs(x - viewportWidth / 2) <= DOCK_HOT_HALF_WIDTH && y >= zone.top && y <= zone.bottom;
  if (hot) return true;
  return !!panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= zone.bottom;
}
