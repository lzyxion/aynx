// 드래그 중 탭 머무름 판정(순수) — 종류·커서 아래 탭·활성 탭으로 시계의 다음 동작을 정한다.
// 불변식: 같은 대상의 반복 dragover 는 시계를 유지하고, 대상이 달라지면 처음부터 센다. DOM·시계·전환은 Tabs 몫이다.
// 타일 드래그는 커서 아래 탭에, 이 창 탭 드래그는 끄는 탭이 많이 겹친 탭에 머문다(`tabOverlapTarget`) — 고르는 것은 Tabs 몫이다.

export type TabHoverDrag = "pane" | "tab" | null;

export function dragTabHoverAction({
  kind, overId, activeId, pendingId,
}: {
  kind: TabHoverDrag;
  overId: string | null;
  activeId: string | null;
  pendingId: string | null;
}): "arm" | "keep" | "clear" {
  if (kind === null || overId === null || overId === activeId) return "clear";
  return overId === pendingId ? "keep" : "arm";
}
