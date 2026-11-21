/**
 * 확인 대화는 연 순간의 값을 고정해 그것만 보낸다(지금 `detail` 로 다시 계산하지 않는다) — 지금 값이 하나라도 다르면 대화는 무효다.
 * 서버의 `approval-stale` 은 "지금 값" 과만 비교하므로 사람이 본 것과 보낸 것이 같다는 보장은 여기서만 선다.
 */
import { approveVerifyArgs, awaitingVerify, overridableVerify, type RunDetail, type TaskView } from "./model";

export interface VerifyPin {
  runId: string;
  taskId: string;
  jobId: string;
  candidate: string;
  commandSha: string;
  old: string;
}

export interface OverridePin {
  runId: string;
  taskId: string;
  jobId: string;
  verifyId: string;
  candidate: string;
  old: string | null;
  commandSha: string | null;
}

type PinRun = Pick<RunDetail, "runId" | "jobs" | "verify" | "integration">;

export function pinVerify(run: PinRun, taskId: string): VerifyPin | null {
  const job = awaitingVerify(run, taskId);
  const args = job ? approveVerifyArgs(run, job) : null;
  return args ? { runId: run.runId, taskId, ...args } : null;
}

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

export function verifyPinValid(pin: VerifyPin, run: PinRun | null): boolean {
  return !!run && same(pin, pinVerify(run, pin.taskId));
}

export function overridePinValid(pin: OverridePin, run: PinRun | null, task: Pick<TaskView, "id" | "state"> | null): boolean {
  return !!run && !!task && task.id === pin.taskId && same(pin, pinOverride(run, task));
}
