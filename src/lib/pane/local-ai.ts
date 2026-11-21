// 로컬 타일(셸 · AI CLI 같은 규칙)의 "AI 읽기 허용"을 켜고 끄는 몸통 하나 — 원격 창에서 켤 때만 마스터를 다시 확인한다(끄기는 묻지 않는다).
import { isShared, setShared } from "$lib/ai.svelte.js";
import { confirmRemoteMaster, isRemote } from "$lib/ipc";

export function setLocalAiRead(paneId: string, on: boolean): void {
  if (isShared(paneId) === on) return;
  if (!on || !isRemote) return setShared(paneId, on);
  void confirmRemoteMaster("set_session_ai_read").then((ok) => {
    if (ok && !isShared(paneId)) setShared(paneId, true);
  });
}

export function toggleLocalAiRead(paneId: string): void {
  setLocalAiRead(paneId, !isShared(paneId));
}
