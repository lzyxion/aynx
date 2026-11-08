// 소비 전에 실행하는 UX 판정. Rust의 실제 창 binding 검사가 최종 권한이다.
export function handoffWorkspaceAction(
  incoming: string, target: string | null, main: boolean, intoTile: boolean,
): "adopt" | "switch" | "refuse" {
  if (incoming === target) return "adopt";
  return main && !intoTile ? "switch" : "refuse";
}

/**
 * 분리 창 부팅의 갈래(`bootTear`) — `restored` = 창 묶음이 이미 있어 `initializeWorkspaceWindow` 가 저장된 aux 탭을 **이미 되살렸다**,
 * `parcel` = 사서함에 아직 짐이 있다. 짐이 있으면 받는다(처음 뜬 창). 짐이 없으면 이미 되살린 것으로 끝이다 — 같은 aux 복원을 한 번 더 돌리면
 * 탭이 둘이 된다(실기 c — 보조 창 F5 · 초기화 스크립트의 `__TEAR_TOKEN__` 이 다시 심겨 매번 여기를 지난다). 둘 다 아니면 짐을 잃었다. 순수.
 */
export function tearBootAction(s: { restored: boolean; parcel: boolean }): "adopt" | "restored" | "missing" {
  if (s.parcel) return "adopt";
  return s.restored ? "restored" : "missing";
}
