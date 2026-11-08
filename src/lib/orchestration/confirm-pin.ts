/**
 * 보드 확인 대화의 **고정 묶음**(리뷰 F3) — [검증 실행] · [검증 실패인데 수락] 대화는 **연 순간**의 값(runId · jobId · 후보 ·
 * 명령 해시 · 통합 머리, 덮어쓰기는 verifyId 까지)을 복사해 들고, 확인 단추는 그 고정 값만 보낸다(지금 `detail` 로 다시 계산하지 않는다).
 * 갱신에서 그 Task 의 지금 값이 고정 값과 하나라도 다르면(Job 이 사라짐 · 대기 아님 · 새 Job/후보) 대화는 무효 — 닫고 다시 열게 한다.
 * 서버의 `approval-stale` 은 "지금 값" 과만 비교하므로, 사람이 본 것과 보낸 것이 같다는 보장은 여기서만 선다. 순수.
 */
import { approveVerifyArgs, awaitingVerify, overridableVerify, type RunDetail, type TaskView } from "./model";

/** [검증 실행] 대화가 연 순간의 묶음 */
export interface VerifyPin {
  runId: string;
  taskId: string;
  jobId: string;
  candidate: string;
  commandSha: string;
  old: string;
}

/** [검증 실패인데 수락] 대화가 연 순간의 묶음 */
export interface OverridePin {
  runId: string;
  taskId: string;
  jobId: string;
  verifyId: string;
  candidate: string;
  /** 실패한 Job 의 그때 통합 머리(없으면 null) */
  old: string | null;
  commandSha: string | null;
}

type PinRun = Pick<RunDetail, "runId" | "jobs" | "verify" | "integration">;

/** 지금 [검증 실행] 묶음(없으면 null) */
export function pinVerify(run: PinRun, taskId: string): VerifyPin | null {
  const job = awaitingVerify(run, taskId);
  const args = job ? approveVerifyArgs(run, job) : null;
  return args ? { runId: run.runId, taskId, ...args } : null;
}

/** 지금 [검증 실패인데 수락] 묶음(없으면 null) */
export function pinOverride(run: PinRun, task: Pick<TaskView, "id" | "state">): OverridePin | null {
  const o = overridableVerify(run, task);
  if (!o) return null;
  const job = (run.jobs ?? []).find((j) => j.jobId === o.jobId);
  return {
    runId: run.runId,
    taskId: task.id,
    jobId: o.jobId,
    verifyId: o.verifyId,
    candidate: o.candidate,
    old: job?.old ?? null,
    commandSha: run.verify?.commandSha ?? null,
  };
}

function same<T extends object>(a: T, b: T | null): boolean {
  if (!b) return false;
  return (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);
}

/** 열린 [검증 실행] 대화가 아직 유효한가 — 지금 묶음이 고정 묶음과 모두 같을 때만 */
export function verifyPinValid(pin: VerifyPin, run: PinRun | null): boolean {
  return !!run && same(pin, pinVerify(run, pin.taskId));
}

/** 열린 [검증 실패인데 수락] 대화가 아직 유효한가 */
export function overridePinValid(pin: OverridePin, run: PinRun | null, task: Pick<TaskView, "id" | "state"> | null): boolean {
  return !!run && !!task && task.id === pin.taskId && same(pin, pinOverride(run, task));
}
