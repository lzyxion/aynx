import { invoke, listen } from "../ipc";
import { noteAutoRefusal, refreshPendingPlans } from "$lib/app/pending-plans.svelte.js";

/**
 * **제한적 자동 승인 — 창 쪽 몫** (단계 10b · docs/log/2026-09-10-auto-approval.md · ③-4 세션 서버 이전).
 *
 * ## 판정은 세션 서버가 한다 (③-4)
 *
 * 예전에는 이 모듈이 주 창에서 2초마다 검토 대기를 훑어 `approve_operation(id, "auto")` 를 불렀다. 그래서 **창이
 * 하나도 없으면**(트레이·GUI 종료) 사전 정책 자동 승인도 멈췄다. ③-4 부터 그 훑기는 세션 서버 안의 타이머다
 * (`src-tauri/src/server/auto_approve.rs`) — 서버 내부 호출이라 파이프의 승인 프레임이 아니고, 진입점은
 * `approve_in(method: auto)` 하나다. 조건은 그대로 옮겼다: 같은 작업안은 **한 번만** 시도(`attempted`) ·
 * 사람이 확인 상태로 둔 위험 카드는 건너뜀 · 검토 대기 만료(TTL) · 빈도 한도 · 대상별 자동 실행 권한 재검사 · 감사(`method:auto`).
 *
 * ## 여기 남은 것 둘
 *
 * 1. **"사람이 지금 이 카드를 검토 중"** 을 서버에 알린다 — [`setHumanConfirming`] → `set_reviewing_operations`.
 *    Rust 가 창별 값을 모아 합집합을 서버에 보낸다(GUI 가 없으면 빈 집합). 자동이 사람의 손을 가로채면 안 된다.
 *    서버가 다시 떴거나 다시 붙으면(`session-server-connected`) 같은 값을 다시 보낸다.
 * 2. **거부 사유를 카드에 적는다** — 서버의 `operation-auto-refused` 를 받아 `noteAutoRefusal`(주 창에서만 —
 *    [`startAutoApprove`]). 서버가 GUI 없이 거부한 사유는 목록의 `autoRefusals` 로 온다(`pending-plans`).
 */

/** 지금 이 창에서 사람이 확인 상태로 둔 작업안(위험 카드의 첫 [실행 승인] 뒤 — 없으면 `null`) */
let humanConfirming: string | null = null;
/** 서버에 마지막으로 보낸 값 — 같은 값을 거듭 보내지 않는다(`undefined` = 아직 못 보냄) */
let sent: string | null | undefined = undefined;

/** 두 번 걸리지 않게 하는 빗장 */
let started = false;
let connectHooked = false;

function push(): void {
  if (sent === humanConfirming) return;
  sent = humanConfirming;
  const ids = humanConfirming ? [humanConfirming] : [];
  invoke("set_reviewing_operations", { ids }).catch(() => {
    // 실패하면 다음 기회에 다시 보낸다(서버가 아직 안 붙었다)
    sent = undefined;
  });
}

/**
 * 작업안(`PlansView`)이 "사람이 지금 이 카드를 확인 중" 이라고 알려 오는 자리 — 그 작업안은 서버의 자동 승인이
 * 손대지 않는다. `PlansView` 가 `confirming` 이 바뀔 때마다 `$effect` 로 부른다.
 */
export function setHumanConfirming(id: string | null): void {
  humanConfirming = id;
  push();
  if (!connectHooked && typeof window !== "undefined") {
    connectHooked = true;
    // 서버가 바뀌었거나 다시 붙었다 — 검토 집합은 서버 메모리라 다시 알린다.
    void listen("session-server-connected", () => {
      sent = undefined;
      push();
    }).catch(() => {});
  }
}

/**
 * 훅을 건다 — **부팅에서 딱 한 번**, 메인 창에서만(`boot()` 이 가른다 — 분리 창까지 들으면 사유가 창 수만큼 적힌다).
 * 서버 자동 승인의 거부 사유를 검토 카드 곁에 적고 대기 목록을 곧바로 다시 읽는다.
 */
export function startAutoApprove(): void {
  if (started) return;
  started = true;
  void listen<{ operationId?: string; reason?: string }>("operation-auto-refused", (e) => {
    const { operationId, reason } = e.payload ?? {};
    if (operationId && reason) noteAutoRefusal(operationId, reason);
    void refreshPendingPlans();
  }).catch(() => {});
}
