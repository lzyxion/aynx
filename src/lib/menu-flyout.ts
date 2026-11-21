/** 옆으로 뜨는 목록(플라이아웃)의 공통 규칙 — 메뉴마다 따로 셈하면 한쪽만 고쳐지는 버그가 생긴다 (docs/log/2026-09-17-tile-menu-flyouts.md) */

export interface RectLike {
  left: number;
  right: number;
  top: number;
}

/** 메뉴 자신의 배치(`placeMenu`)와 같은 값이다 */
export const FLYOUT_MARGIN = 8;

export const FLYOUT_GAP = 2;

/** 250ms 는 짧아 줄을 누르려던 클릭과 겹쳤다 — 호버로 열린 목록을 그 클릭이 곧바로 닫았다 */
export const FLYOUT_OPEN_MS = 450;

/** 줄에서 목록으로 가는 손은 그 사이 빈틈을 지난다 — 즉시 닫으면 목록이 손 앞에서 사라진다 */
export const FLYOUT_CLOSE_MS = 200;

/** 그리기 전에 자리를 잡을 때만 쓴다 — 그린 뒤 실제 크기로 다시 잰다 */
export const FLYOUT_EST_WIDTH = 200;
export const FLYOUT_EST_ROW = 28;

/** 아주 좁은 창이면 왼쪽 여백에 붙인다 — 넘치더라도 왼쪽 끝은 보여야 항목 이름을 읽는다 */
export function placeFlyout(
  row: RectLike,
  menu: RectLike,
  size: { width: number; height: number },
  win: { width: number; height: number },
): { left: number; top: number } {
  const rightSide = menu.right + FLYOUT_GAP;
  const leftSide = menu.left - FLYOUT_GAP - size.width;
  const fitsRight = rightSide + size.width <= win.width - FLYOUT_MARGIN;
  const left = fitsRight ? rightSide : Math.max(FLYOUT_MARGIN, leftSide);
  const top = Math.max(FLYOUT_MARGIN, Math.min(row.top, win.height - FLYOUT_MARGIN - size.height));
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * Enter · Space 는 버튼의 click 이 받는다. Escape 는 일부러 빠져 있다 — 타일 ⋯ 메뉴는 상자 자신의 `keydown` 에서 받아
 * 위로 올려 보내지 않는다(뒤에 깔린 모달까지 닫히면 안 된다). 이 표에 넣으면 그 전파 규칙이 조용히 깨진다.
 */
export function flyoutKeyAction(key: string, at: "row" | "flyout"): "open" | "close" | null {
  if (at === "row") return key === "ArrowRight" ? "open" : null;
  return key === "ArrowLeft" ? "close" : null;
}
