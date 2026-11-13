/**
 * **DB 타일의 F5**(2026-11-13 사용자 결정) — 판정만 하는 순수 함수.
 *
 * - **선택된 타일**(포커스 테두리 — `focusedPane`)이 이 DB 타일이면 F5 는 앱 새로고침이 아니라 그 타일의 새로고침이다. DOM 포커스로
 *   가르지 않는 까닭: 결과 표의 빈 곳 · 도구줄을 누르면 포커스가 `body` 로 빠져, 같은 키가 보이지 않는 조건에 따라 앱 전체를 다시 읽게 된다.
 * - 데이터 탭이면 그 탭의 ↻(걸린 조건 · 쪽 그대로), SQL 탭이면 스키마 트리의 ↻ — SQL 은 다시 실행하지 않는다(쓰기 문이 다시 돈다).
 * - 맨 `F5` 만 — `Ctrl+F5` 등 수식이 붙은 것 · 이미 누가 가져간 키(`defaultPrevented` — 떠 있는 목록의 F5 등) · 모달이 떠 있을 때는
 *   건드리지 않는다. `Ctrl+R` 와 독의 새로고침 단추는 늘 앱 새로고침이다.
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
