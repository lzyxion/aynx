/**
 * 선택된 타일(`focusedPane`)로 가르고 DOM 포커스로 가르지 않는다 — 결과 표의 빈 곳을 누르면 포커스가 `body` 로 빠져, 같은 키가 앱
 * 전체를 다시 읽게 된다. SQL 탭이면 스키마 트리만 새로 읽는다 — SQL 을 다시 실행하면 쓰기 문이 다시 돈다.
 */
export type TileRefresh = "data" | "tree";

export function tileRefreshOf(
  ev: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "defaultPrevented">,
  ctx: { selected: boolean; modal: boolean; dataTab: boolean },
): TileRefresh | null {
  if (ev.code !== "F5" || ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey || ev.defaultPrevented) return null;
  if (!ctx.selected || ctx.modal) return null;
  return ctx.dataTab ? "data" : "tree";
}
