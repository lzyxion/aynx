// 드래그 중 탭 머무름 판정(순수) — 같은 대상의 반복 dragover 는 시계를 유지하고, 대상이 달라지면 처음부터 센다.

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
