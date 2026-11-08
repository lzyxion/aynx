/**
 * **옆으로 뜨는 목록(플라이아웃)의 공통 규칙** — 자리와 여닫는 키 하나.
 *
 * 이 앱에서 `▸` 를 단 줄은 타일 ⋯ 메뉴의 묶음 줄(docs/log/2026-09-17-tile-menu-flyouts.md)이다.
 * 처음에는 탭 바 `+` 메뉴의 갈라진 줄(docs/log/2026-09-15-plus-menu-last-used-flyout.md)과
 * 둘이었고 — 그 메뉴는 2026-09-25 에 걷었다(docs/log/2026-09-25-plus-vs-shell-menu.md) — 둘째가 생기던 자리에서 첫째의 계산을
 * **베껴 가지 않고** 이리로 끌어올렸다 — 두 메뉴가 서로 다른 규칙으로 자리를 잡으면
 * "같은 종류의 목록" 이라는 사실이 화면에서 사라지고, 한쪽만 고쳐지는 버그가 생긴다.
 *
 * 여기 있는 것은 **순수 함수와 상수뿐**이다. 상태(`$state`)·DOM 측정·타이머는 각 컴포넌트가
 * 들고 있고(`pane/PaneMenu.svelte`), 이 모듈은 그들이 넘긴 사각형으로 좌표를
 * 셈하고 키 하나를 뜻으로 옮긴다. 이 저장소의 vitest 가 `environment: "node"` 라
 * `.svelte` 를 못 읽으므로, 회귀 테스트를 받을 수 있는 자리가 순수 모듈뿐이기도 하다
 * (docs/log/2026-09-05-vitest.md).
 */

/** 자리를 잴 때 쓰는 최소한의 사각형 (`DOMRect` 를 그대로 넘겨도 된다) */
export interface RectLike {
  left: number;
  right: number;
  top: number;
}

/** 화면 경계에서 띄워 둘 여백 — 메뉴 자신의 배치(`placeMenu`)와 같은 값이다 */
export const FLYOUT_MARGIN = 8;

/** 메뉴와 옆목록 사이 틈 — 두 상자의 테두리가 붙어 한 덩어리로 읽히지 않을 만큼만 */
export const FLYOUT_GAP = 2;

/**
 * 호버로 여는 데 드는 뜸(ms). 메뉴를 세로로 지나가기만 하는 손이 스쳐 지나는 줄마다
 * 목록을 띄우면 화면이 번쩍인다 — 이 정도면 "여기서 멈췄다" 와 "지나갔다" 가 갈린다. 다른 목록이 떠 있을 때 옆 줄로 옮겨도
 * 같은 뜸이다(10-25 사용자 — 250ms 는 짧아 줄을 누르려던 손의 클릭과 겹쳤다: 호버로 열린 목록을 그 클릭이 곧바로 닫았다).
 */
export const FLYOUT_OPEN_MS = 450;

/**
 * 포인터가 줄과 목록 **둘 다** 떠난 뒤 닫히기까지(ms). 줄에서 목록으로 가는 손은 그 사이의
 * 빈틈을 지나므로, 즉시 닫으면 목록이 손 앞에서 사라진다.
 */
export const FLYOUT_CLOSE_MS = 200;

/** 어림 크기 — 목록을 그리기 **전에** 자리를 잡을 때만 쓴다 (그린 뒤 실제 크기로 다시 잰다) */
export const FLYOUT_EST_WIDTH = 200;
export const FLYOUT_EST_ROW = 28;

/**
 * **옆으로 뜨는 목록의 화면 좌표**. 메뉴가 이미 `position: fixed` 로 좌표를 손수 잡고 있어
 * (탭 스트립의 `overflow-x`·타일 상자의 `isolation` 때문에 잘린다) 이쪽도 같은 방식으로 잰다.
 *
 * 가로: 기본은 **메뉴 오른쪽 바깥**이다. 거기서 창을 넘치면 메뉴 왼쪽 바깥으로 넘긴다.
 * 양쪽 다 안 되면(아주 좁은 창) 왼쪽 여백에 붙인다 — 넘치더라도 **왼쪽 끝**은 보여야
 * 항목 이름을 읽는다.
 *
 * 세로: 줄과 같은 높이에서 시작하되 아래가 넘치면 위로 끌어올린다 (목록이 창보다 길면
 * 위쪽 여백에 붙고, 넘치는 부분은 목록 자신의 스크롤이 맡는다).
 */
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
 * 키 하나 → 옆목록에 대한 뜻. **한 켜 들어가고 한 켜 나오는** 두 방향뿐이다.
 *
 * - `"row"`(줄 또는 `▸` 위): `→` 가 연다. Enter·Space 는 버튼의 click 이 이미 받으므로
 *   여기서 보지 않는다.
 * - `"flyout"`(목록 안): `←` 가 한 켜 나간다 (포커스는 연 줄로 돌아간다).
 *
 * **Escape 는 일부러 빠져 있다.** 메뉴마다 Escape 를 받는 자리가 다르기 때문이다 —
 * (걷어 낸 `+` 메뉴는 창 전역 핸들러에서 한 켜씩 닫았고) 타일 ⋯ 메뉴는 상자 자신의
 * `keydown` 에서 받아 **위로 올려 보내지 않는다**(뒤에 깔린 모달까지 닫히면 안 된다).
 * 그 갈래를 이 표에 넣으면 한쪽의 전파 규칙이 다른 쪽에서 조용히 깨진다.
 */
export function flyoutKeyAction(key: string, at: "row" | "flyout"): "open" | "close" | null {
  if (at === "row") return key === "ArrowRight" ? "open" : null;
  return key === "ArrowLeft" ? "close" : null;
}
