// 소비 전에 실행하는 UX 판정. Rust의 실제 창 binding 검사가 최종 권한이다.
export function handoffWorkspaceAction(
  incoming: string, target: string | null, main: boolean, intoTile: boolean,
): "adopt" | "switch" | "refuse" {
  if (incoming === target) return "adopt";
  return main && !intoTile ? "switch" : "refuse";
}

/**
 * `restored` = 창 묶음이 이미 있어 저장된 aux 탭을 되살렸다 · `parcel` = 사서함에 짐이 남았다. 보조 창 F5 도 매번 여기를 지나므로
 * 짐이 없을 때 aux 복원을 한 번 더 돌리면 탭이 둘이 된다.
 */
export function tearBootAction(s: { restored: boolean; parcel: boolean }): "adopt" | "restored" | "missing" {
  if (s.parcel) return "adopt";
  return s.restored ? "restored" : "missing";
}
