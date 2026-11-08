// 로컬 타일의 AI 권한(10-23) — 팝오버(`local-ai-menu.svelte.ts`)가 쓰는 **순수한 몫**(룬 없음 — 시험이 바로 부른다): 단계 줄 · 잠김 자리 ·
// 지금 단계 · 고르기. 저장은 예전 그대로 타일별 읽기 허용(`ai.svelte.ts` 의 공유 집합)이고, 원격 창에서 켤 때만 마스터를 다시 묻는다.
import type { PermStageRow } from "$lib/pane/ai-perm-menu.svelte.js";
import { isShared, setShared } from "$lib/ai.svelte.js";
import { confirmRemoteMaster, isRemote } from "$lib/ipc";
import { AI_STAGES, AI_STAGE_DESC, AI_STAGE_NAME, type AiStage } from "$lib/delegation";

/** 이 자리부터 잠긴다 — 로컬 타일은 Off(0) · Read(1)만 */
export const LOCAL_LOCKED_FROM = 2;

/** 로컬 타일의 단계 줄 — 이름은 원격과 같고, 고를 수 있는 둘(Off · Read)의 설명만 "이 타일" 의 말이다 */
export const LOCAL_STAGE_ROWS: readonly PermStageRow<AiStage>[] = AI_STAGES.map((id) => ({
  id,
  name: AI_STAGE_NAME[id],
  desc: id === "off" ? "pane.localaiperm.off.desc" : id === "read" ? "pane.localaiperm.read.desc" : AI_STAGE_DESC[id],
}));

/** 로컬 타일의 지금 단계 — 읽기 허용이 켜졌으면 Read, 아니면 Off. **로컬 타일만** 부른다 */
export function localAiStage(paneId: string): "off" | "read" {
  return isShared(paneId) ? "read" : "off";
}

/**
 * 단계 하나를 고른다 — Off · Read 만 뜻이 있다(잠긴 자리는 게이지가 애초에 올리지 않지만 여기서도 무시한다). 원격 창에서 켤 때만
 * 마스터를 다시 묻는다(예전 ⋯ 메뉴 토글과 같은 문 — `confirmRemoteMaster` · 끄기는 묻지 않는다).
 */
export function pickLocalAi(paneId: string, stage: AiStage): void {
  if (stage !== "off" && stage !== "read") return;
  const on = stage === "read";
  if (isShared(paneId) === on) return;
  if (!on || !isRemote) return setShared(paneId, on);
  void confirmRemoteMaster("set_session_ai_read").then((ok) => {
    if (ok && !isShared(paneId)) setShared(paneId, true);
  });
}
