// 채팅 잎이 보낸 말을 처리하는 중(띄우는 중 · 턴이 서기 전 포함)이거나 권한을 기다리는가 — 타일 닫기 물음이 읽는다.
// 값 import 를 두지 않는다: `app/tabs.svelte.ts` 가 store 를 부르면 tabs → store → agent-sessions → tabs 순환이 된다.

const busy = new Set<string>();

export function setChatTileBusy(paneId: string, on: boolean): void {
  if (on) busy.add(paneId);
  else busy.delete(paneId);
}

export function chatTileBusy(paneId: string): boolean {
  return busy.has(paneId);
}
