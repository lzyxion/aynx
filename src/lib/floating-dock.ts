/**
 * **하단 가운데 호버 독의 호버 띠** — 순수 판정(`FloatingStatusDock.svelte`). 포인터 이동과 끌기(`dragover` — HTML5 끌기 중에는
 * `pointermove` 가 오지 않는다, 2026-10-23)가 같은 함수를 지난다.
 *
 * 띠 = 창 아래 가운데 ±[`DOCK_HOT_HALF_WIDTH`] px · 독 뿌리(닫힌 투명 영역)의 높이. 독이 보이는 동안에는 판의 가로 폭 안 ·
 * 판 위끝부터 뿌리 아래끝까지도 독 위로 친다(판과 띠 사이 틈에서 접히지 않게).
 */

/** 띠의 가로 반폭(px) — 창 가운데에서 이만큼 */
export const DOCK_HOT_HALF_WIDTH = 90;

/** 창 좌표의 상자(`getBoundingClientRect` 의 부분) */
export interface DockBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 창 좌표 `(x, y)` 가 독을 올려 두는 자리인가. `zone` = 독 뿌리 상자(없으면 언제나 거짓), `panel` = **보이는 동안의** 판 상자
 * (숨어 있으면 `null` — 숨은 판의 자리는 띠가 아니다).
 */
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
