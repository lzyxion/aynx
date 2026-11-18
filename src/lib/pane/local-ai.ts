// 로컬 타일의 "AI 읽기 허용"(11-18) — 켜고 끄는 **몸통 하나**. 로컬 셸 타일과 로컬 AI CLI 타일(Claude · Codex)이 같은 규칙이다.
// ⋯ 메뉴(와 터미널 우클릭)의 체크 줄 "AI 읽기 허용"이 켜고 끄고, 켜졌을 때만 서는 머리줄 눈 칩이 끈다.
// 저장은 타일별 공유 집합(`ai.svelte.ts` → `Terminal.svelte` 가 세션 메타 `set_session_ai_read` 로 메아리)이다 — 새 저장 길 · 새 명령은 없다.
// 원격 창에서 켤 때만 마스터를 다시 확인한다(R1a-4 — `confirmRemoteMaster` · 끄기는 묻지 않는다).
import { isShared, setShared } from "$lib/ai.svelte.js";
import { confirmRemoteMaster, isRemote } from "$lib/ipc";

/** 읽기 허용을 `on` 으로 — 이미 그 값이면 아무 일도 없다. 원격 창에서 켤 때는 마스터 재확인을 통과해야 켠다 */
export function setLocalAiRead(paneId: string, on: boolean): void {
  if (isShared(paneId) === on) return;
  if (!on || !isRemote) return setShared(paneId, on);
  void confirmRemoteMaster("set_session_ai_read").then((ok) => {
    if (ok && !isShared(paneId)) setShared(paneId, true);
  });
}

/** 읽기 허용을 뒤집는다(⋯ 메뉴의 체크 줄) — 켜는 쪽이면 위 문(원격 창 마스터 재확인)을 지난다 */
export function toggleLocalAiRead(paneId: string): void {
  setLocalAiRead(paneId, !isShared(paneId));
}
