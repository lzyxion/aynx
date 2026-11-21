import { invoke, listen } from "../ipc";
import { noteAutoRefusal, refreshPendingPlans } from "$lib/app/pending-plans.svelte.js";

/**
 * 자동 승인의 창 쪽 몫 — 판정은 세션 서버(`server/auto_approve.rs`)가 한다(docs/log/2026-09-10-auto-approval.md).
 * 사람이 확인 중인 작업안은 서버의 자동 승인이 손대지 않는다 — 자동이 사람의 손을 가로채면 안 된다.
 */

/** 위험 카드의 첫 [실행 승인] 뒤 사람이 확인 상태로 둔 작업안 */
let humanConfirming: string | null = null;
/** `undefined` = 아직 못 보냄 */
let sent: string | null | undefined = undefined;

let started = false;
let connectHooked = false;

function push(): void {
  if (sent === humanConfirming) return;
  sent = humanConfirming;
  const ids = humanConfirming ? [humanConfirming] : [];
  invoke("set_reviewing_operations", { ids }).catch(() => {
    sent = undefined;
  });
}

export function setHumanConfirming(id: string | null): void {
  humanConfirming = id;
  push();
  if (!connectHooked && typeof window !== "undefined") {
    connectHooked = true;
    // 검토 집합은 서버 메모리라 다시 붙으면 다시 알린다
    void listen("session-server-connected", () => {
      sent = undefined;
      push();
    }).catch(() => {});
  }
}

/** 메인 창에서만 부른다 — 분리 창까지 들으면 거부 사유가 창 수만큼 적힌다. */
export function startAutoApprove(): void {
  if (started) return;
  started = true;
  void listen<{ operationId?: string; reason?: string }>("operation-auto-refused", (e) => {
    const { operationId, reason } = e.payload ?? {};
    if (operationId && reason) noteAutoRefusal(operationId, reason);
    void refreshPendingPlans();
  }).catch(() => {});
}
