import { describe, expect, it } from "vitest";
import { currentTrackAttempt, trackAttempts, trackHumanGate, trackNeighbors, trackPresentation, trackReviewCount } from "./model/track-player";
import type { ReportView, ReviewReportView } from "./model/types";
import type { AttemptView, RunDetail, TaskView } from "./model/types";

function task(id: string, state: TaskView["state"] = "active"): TaskView {
  return { id, title: id, goal: "", dependsOn: [], version: 1, state, createdAt: 0, updatedAt: 0 };
}

function attempt(id: string, taskId: string, extra: Partial<AttemptView> = {}): AttemptView {
  return { id, taskId, cli: "claude", gen: 1, state: "idle", startedAt: 1, kind: "write", ...extra };
}

function run(tasks: TaskView[], attempts: AttemptView[] = [], extra: Partial<RunDetail> = {}): RunDetail {
  return {
    runId: "앨범", name: "앨범", state: "running", gen: 1, createdAt: 0, updatedAt: 0, repo: "C:/작업", worktreeDir: "",
    limits: { maxTasks: 10, maxCallsPerMinute: 30, maxWaiters: 2, coordinationMinutes: 120, executionGraceMinutes: 30, maxConcurrentWorkers: 3, maxTotalWorkers: 6, maxDeliveries: 10 },
    coordinationDeadlineAt: 0, executionDeadlineAt: 0, tasks, attempts,
    remaining: { tasks: 1, callsThisMinute: 1, concurrentWorkers: 1, totalWorkers: 1, coordinationSeconds: 0, executionSeconds: 0 },
    latestSeq: 1, coordinatorAttached: true, coordinatorChat: null, origin: { by: "human" }, ...extra,
  };
}

describe("트랙 시도 선택", () => {
  it("장부를 바꾸지 않고 시작 시각의 역순으로 시도와 검토를 섞는다", () => {
    const attempts = [attempt("과거", "가"), attempt("새작업", "가", { startedAt: 3 }), attempt("검토", "가", { startedAt: 3, kind: "judge" }), attempt("다른트랙", "나", { startedAt: 9 })];
    expect(trackAttempts({ attempts }, "가").map((a) => a.id)).toEqual(["검토", "새작업", "과거"]);
    expect(attempts.map((a) => a.id)).toEqual(["과거", "새작업", "검토", "다른트랙"]);
  });

  it("명시한 과거 시도는 고르되 다른 트랙의 id는 무시한다", () => {
    const detail = run([task("가"), task("나")], [attempt("과거", "가"), attempt("현재", "가", { state: "running", startedAt: 2 }), attempt("외부", "나", { state: "running" })]);
    expect(currentTrackAttempt(detail, "가", "과거")?.id).toBe("과거");
    expect(currentTrackAttempt(detail, "가", "외부")?.id).toBe("현재");
    expect(currentTrackAttempt(detail, "가", "없음")?.id).toBe("현재");
    expect(currentTrackAttempt(detail, "빈트랙", "외부")).toBeNull();
  });

  it("도는 쓰기형, 판정형, 막힘, 최신 기록 순으로 기본 선택한다", () => {
    const w = attempt("작업", "가", { state: "running" });
    const j = attempt("검토", "가", { kind: "judge", role: "reviewer", state: "running", startedAt: 5 });
    const b = attempt("막힘", "가", { blocked: { need: "권한", at: 2 }, startedAt: 2 });
    const recent = attempt("최근기록", "가", { startedAt: 8 });
    const detail = run([task("가")], [w, j, b, recent]);
    expect(currentTrackAttempt(detail, "가")?.id).toBe("작업");
    detail.attempts = [j, b, recent];
    expect(currentTrackAttempt(detail, "가")?.id).toBe("검토");
    detail.attempts = [b, recent];
    expect(currentTrackAttempt(detail, "가")?.id).toBe("막힘");
    detail.attempts = [recent];
    expect(currentTrackAttempt(detail, "가")?.id).toBe("최근기록");
    detail.attempts = [];
    expect(currentTrackAttempt(detail, "가")).toBeNull();
  });

  it("끝난 턴을 가진 시도와 기록만인 앨범을 도는 시도로 고르지 않는다", () => {
    const ended = attempt("끝난턴", "가", { state: "running", startedAt: 4, turns: [{ n: 1, startedAt: 4, outcome: "ok", endedAt: 5 }] });
    const live = attempt("검토", "가", { kind: "judge", state: "running", startedAt: 2 });
    const detail = run([task("가")], [ended, live]);
    expect(currentTrackAttempt(detail, "가")?.id).toBe("검토");
    expect(currentTrackAttempt({ ...detail, state: "orphaned" }, "가")?.id).toBe("끝난턴");
  });
});

describe("트랙의 이웃", () => {
  it("시도 없는 트랙도 포함하고 첫째·마지막은 순환하지 않는다", () => {
    const detail = run([task("첫째"), task("대기", "todo"), task("마지막")], [attempt("작업", "첫째")]);
    expect(trackNeighbors(detail, "대기")).toEqual({ prev: { task: detail.tasks[0], no: 1 }, next: { task: detail.tasks[2], no: 3 } });
    expect(trackNeighbors(detail, "첫째").prev).toBeNull();
    expect(trackNeighbors(detail, "마지막").next).toBeNull();
    expect(trackNeighbors(detail, "없음")).toEqual({ prev: null, next: null });
  });
});

describe("트랙 상태별 안내", () => {
  it.each(["accepted", "rejected", "cancelled", "conflict", "integrating", "reported"] as const)("%s 상태는 빈 화면 대신 해당 안내를 낸다", (state) => {
    const t = task("가", state);
    expect(trackPresentation(run([t]), t).key).toBe(`orch.player.state.${state}`);
  });

  it("대기·작업·판정형만 도는 트랙을 구분한다", () => {
    const t = task("가", "todo");
    expect(trackPresentation(run([t]), t).key).toBe("orch.player.state.waiting");
    expect(trackPresentation(run([t], [attempt("작업", "가", { state: "running" })]), t).key).toBe("orch.player.state.playing");
    expect(trackPresentation(run([t], [attempt("검토", "가", { kind: "judge", state: "running" })]), t).key).toBe("orch.player.state.reviewing");
  });

  it("사람 관문은 도는 시도보다 먼저, 종료 상태는 과거 막힘보다 먼저 보인다", () => {
    const t = task("가", "reported");
    const detail = run([t], [attempt("막힘", "가", { blocked: { need: "권한", at: 1 } }), attempt("작업", "가", { state: "running" })]);
    expect(trackPresentation(detail, t).key).toBe("orch.player.state.blocked");
    detail.jobs = [{ jobId: "검증", taskId: "가", phase: "awaiting-approval", startedAt: 1, candidate: "후보", old: "기준" }];
    expect(trackPresentation(detail, t).key).toBe("orch.player.state.verify");
    expect(trackPresentation(detail, { ...t, state: "conflict" }).key).toBe("orch.player.state.conflict");
    expect(trackPresentation(detail, { ...t, state: "accepted" }).key).toBe("orch.player.state.accepted");
  });

  it("다른 트랙의 막힘·검토·검증은 이 트랙 안내에 섞지 않는다", () => {
    const t = task("가", "todo");
    const detail = run([t, task("나")], [attempt("막힘", "나", { blocked: { need: "권한", at: 1 } }), attempt("검토", "나", { kind: "judge", state: "running" })], {
      jobs: [{ jobId: "검증", taskId: "나", phase: "awaiting-approval", startedAt: 1 }],
    });
    expect(trackPresentation(detail, t).key).toBe("orch.player.state.waiting");
    expect(trackPresentation(run([t], [attempt("작업", "가", { state: "running" })], { state: "orphaned" }), t).key).toBe("orch.player.state.waiting");
  });
});

describe("트랙 오른쪽 상태 카드", () => {
  const report = (attemptId: string): ReportView => ({
    reportId: `p-${attemptId}`, attemptId, taskId: "가", outcome: "success", summary: "", commitOid: "c0ffee", baseCommitOid: "a3f9c21", dirty: false, changedFiles: [], at: 1, late: false,
  });
  const verdict = (reviewId: string, v: ReviewReportView["verdict"], state: ReviewReportView["state"] = "current"): ReviewReportView => ({
    reviewId, attemptId: "검토", taskId: "가", reportId: "p-작업", commitOid: "c0ffee", verdict: v, findings: [], summary: "", at: 1, state,
  });

  it("사람 필요 까닭이 있거나 보고된 트랙을 수락할 수 있을 때만 사람 확인 카드다", () => {
    const working = task("가");
    expect(trackHumanGate(run([working]), working, null)).toBe(false);
    expect(trackHumanGate(run([working]), working, "blocked")).toBe(true);
    const reported = { ...task("가", "reported"), currentAttempt: "작업" };
    expect(trackHumanGate(run([reported], [attempt("작업", "가")], { reports: [report("작업")] }), reported, null)).toBe(true);
    // 보고가 없으면 수락 단추도 없다 · 끝난 앨범은 관문 없음
    expect(trackHumanGate(run([reported]), reported, null)).toBe(false);
    expect(trackHumanGate(run([reported], [attempt("작업", "가")], { reports: [report("작업")], state: "done" }), reported, null)).toBe(false);
    // 수락된 트랙의 [반려로 뒤집기] 는 기다리는 관문이 아니다
    const accepted = { ...task("가", "accepted"), currentAttempt: "작업" };
    expect(trackHumanGate(run([accepted], [attempt("작업", "가")], { reports: [report("작업")] }), accepted, null)).toBe(false);
  });

  it("검토 수 — 못 채운 규칙의 합, 없으면 지금 유효한 판정, 둘 다 없으면 칸 없음", () => {
    const t = { ...task("가", "reported"), acceptReadiness: { ok: false, unmet: [
      { rule: "judgment", role: "r1", need: 1, have: 0, last: "none" },
      { rule: "judgment", role: "r2", need: 2, have: 1, last: "pass" },
    ] } };
    expect(trackReviewCount(run([t]), t)).toEqual({ have: 1, need: 3 });
    const ok = { ...task("가", "reported"), acceptReadiness: { ok: true, unmet: [] } };
    expect(trackReviewCount(run([ok], [], { reviewReports: [verdict("v1", "pass"), verdict("v2", "changes-requested"), verdict("v3", "pass", "stale")] }), ok)).toEqual({ have: 1, need: 2 });
    expect(trackReviewCount(run([ok]), ok)).toBeNull();
  });
});
