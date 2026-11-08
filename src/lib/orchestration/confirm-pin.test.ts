import { describe, expect, it } from "vitest";
import { overridePinValid, pinOverride, pinVerify, verifyPinValid } from "./confirm-pin";
import type { RunDetail } from "./model";

// 리뷰 F3 — 확인 대화는 연 순간의 묶음에 고정되고, 갱신에서 달라지면 무효다.
const C = "c".repeat(40);
const C2 = "d".repeat(40);
const O = "o".repeat(40);
const SHA = "s".repeat(64);

type R = Pick<RunDetail, "runId" | "jobs" | "verify" | "integration">;

function run(jobs: R["jobs"], sha = SHA): R {
  return {
    runId: "run-1",
    jobs,
    verify: { command: "x", commandSha: sha, timeoutMinutes: 10, autoRun: false },
    integration: { workRef: "r", exportBranch: "b", baseCommit: "o", expectedHead: O },
  } as R;
}

const awaiting = { jobId: "job-1", taskId: "t", phase: "awaiting-approval" as const, candidate: C, old: O, startedAt: 0 };
const verdict = (jobId: string, verifyId: string, candidate: string) => ({
  verifyId, jobId, candidate, commandSha: SHA, envPolicy: "p", hermetic: true, exitCode: 1, outcome: "fail" as const,
  durationMs: 1, outBytes: 1, tailSha256: "h", approvedBy: "human" as const, at: 0,
});

describe("확인 대화 고정 묶음(F3)", () => {
  it("[검증 실행] 은 연 순간의 runId · jobId · 후보 · 명령 해시 · 머리를 든다", () => {
    expect(pinVerify(run([awaiting]), "t")).toEqual({ runId: "run-1", taskId: "t", jobId: "job-1", candidate: C, commandSha: SHA, old: O });
    expect(pinVerify(run([awaiting]), "other")).toBeNull();
  });

  it("대화가 열린 사이 Job 이 새 Job · 새 후보로 바뀌면 무효 — 새 묶음으로 넘어가지 않는다", () => {
    const pin = pinVerify(run([awaiting]), "t")!;
    expect(verifyPinValid(pin, run([awaiting]))).toBe(true);
    // 옛 Job 취소 · 같은 Task 재수락으로 후보 B 대기.
    const replaced = run([{ ...awaiting, phase: "aborted" as const }, { ...awaiting, jobId: "job-2", candidate: C2 }]);
    expect(verifyPinValid(pin, replaced)).toBe(false);
    // 같은 jobId 인데 후보만 달라도 · 명령 해시가 달라도 · Job 이 사라져도 · Run 이 달라도 무효.
    expect(verifyPinValid(pin, run([{ ...awaiting, candidate: C2 }]))).toBe(false);
    expect(verifyPinValid(pin, run([awaiting], "t".repeat(64)))).toBe(false);
    expect(verifyPinValid(pin, run([]))).toBe(false);
    expect(verifyPinValid(pin, { ...run([awaiting]), runId: "run-2" })).toBe(false);
    expect(verifyPinValid(pin, null)).toBe(false);
  });

  it("[검증 실패인데 수락] 은 verifyId 까지 고정 — 새 실패 Job 이 서면 무효", () => {
    const failed = { ...awaiting, phase: "aborted" as const, verify: verdict("job-1", "ver-1", C) };
    const task = { id: "t", state: "reported" as const };
    const pin = pinOverride(run([failed]), task)!;
    expect(pin).toMatchObject({ runId: "run-1", jobId: "job-1", verifyId: "ver-1", candidate: C, old: O, commandSha: SHA });
    expect(overridePinValid(pin, run([failed]), task)).toBe(true);
    const failed2 = { ...awaiting, jobId: "job-2", candidate: C2, phase: "aborted" as const, verify: verdict("job-2", "ver-2", C2) };
    expect(overridePinValid(pin, run([failed, failed2]), task)).toBe(false);
    expect(overridePinValid(pin, run([{ ...failed, verify: verdict("job-1", "ver-9", C) }]), task)).toBe(false);
    expect(overridePinValid(pin, run([failed]), { id: "t", state: "accepted" })).toBe(false);
    expect(overridePinValid(pin, run([failed]), null)).toBe(false);
  });
});
