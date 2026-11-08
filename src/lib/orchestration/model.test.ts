import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import type { Key } from "$lib/i18n/keys";
import {
  reviewLine,
  reviewTurnLine,
  REVIEW_TURN_KEY,
  type TurnView,
  REVIEW_STATE_KEY,
  isReviewer,
  conflictHintKey,
  resolverOf,
  ORCH_REASONS,
  ORCH_REASON_KEY,
  changeAction,
  progressAction,
  resyncDue,
  resyncAction,
  RESYNC_MS,
  formatDuration,
  orchReasonOf,
  orchReasonText,
  runActions,
  runStatePhrase,
  taskActions,
  approveVerifyArgs,
  awaitingVerify,
  overridableVerify,
  VERIFY_OUTCOME_KEY,
  attemptActions,
  attemptChipText,
  noticeKey,
  cleanupAvailable,
  keptBranchCount,
  cleanupDefaults,
  CLEANUP_BLOCKER_KEY,
  tempRoleKey,
  tempWhyKey,
  type CleanupPreview,
  noticeText,
  noticeUrgent,
  commitRejectionHint,
  blockedCount,
  turnMayLive,
  attemptClosed,
  attemptOpen,
  isHeadless,
  attemptNeedsHuman,
  attentionKey,
  ATTEMPT_STATE_KEY,
  OUTCOME_KEY,
  actionLabel,
  driftedAttempts,
  lastRevoked,
  lateReports,
  reportDiffRange,
  reviewActions,
  reviewReport,
  shortOid,
  validAccepted,
  wantsDrift,
  activityLine,
  activityStatusKey,
  wantsActivity,
  ACTIVITY_WARN_KEY,
  acceptBlocker,
  fileStatusLetter,
  completeAction,
  holdBar,
  liveJob,
  integrationChip,
  conflictSummary,
  integrationAbortText,
  lastAbortedJob,
  needsMergeHint,
  JOB_PHASE_KEY,
  attemptCommits,
  keyOf,
  keyText,
  RUN_STATE_KEY,
  TASK_STATE_KEY,
  ACTOR_KEY,
  ACTION_KEY,
  NOTICE_KEY,
  HOLD_REASON_KEY,
  BLOCKER_KEY,
  KIND_KEY,
  TURN_OUTCOME_KEY,
  GRADE_KEY,
  VERDICT_KEY,
  workerLine,
  turnRows,
  turnArgsSummary,
  clipText,
  attemptBand,
  persistBand,
  PERSIST_REASON_KEY,
  roleSteps,
  judgmentRows,
  readinessLine,
  waiverNoteNeeded,
  waiverTexts,
  acceptedWaivers,
  reworkText,
  hasJudges,
  type AttemptView,
  type RunDetail,
  type TaskView,
  type AcceptedView,
  type ReportView,
} from "$lib/orchestration/model";
import { isCodexLine } from "$lib/session/open";
import { REASONS, stripReason } from "$lib/error-reason";

/**
 * **오케스트레이션 프런트 순수 층**(2026-10-15 · 2b) — 보드 상태 문구(설계 D) · 이벤트 seq 비교 갱신 · 이유 코드 표. (3차 6단계) 사람의
 * Run 시작 대화 검증은 대화와 함께 걷었다.
 */

const tr = (key: Key, params?: Record<string, string | number>) => translate("ko", key, params);
const trEn = (key: Key, params?: Record<string, string | number>) => translate("en", key, params);

describe("보드 상태 문구(설계 D)", () => {
  it("paused = 조율 멈춤 — 작업자는 계속 돎 · stopping = 중단 요청 중", () => {
    expect(runStatePhrase({ state: "paused", pauseReason: "human" }, tr)).toBe("조율 멈춤 — 아티스트는 계속 돎");
    expect(runStatePhrase({ state: "stopping" }, tr)).toBe("중단 요청 중");
    expect(runStatePhrase({ state: "running" }, tr)).toBeNull();
    expect(runStatePhrase({ state: "stopped" }, tr)).toBeNull();
  });

  it("멈춘 까닭(조정자 종료 · 시간 한도)을 덧붙인다 · orphaned 는 읽기 전용 안내", () => {
    expect(runStatePhrase({ state: "paused", pauseReason: "coordinator-exited" }, tr)).toContain("프로듀서가 끝났습니다");
    // (2단계 단계 6) 복구 길을 말한다 — 타일은 이어받지 못하고 라이브러리의 [새 프로듀서로 이어받기] 가 새 프로듀서 채팅을 세운다.
    expect(runStatePhrase({ state: "paused", pauseReason: "coordinator-exited" }, tr)).toContain("새 프로듀서로 이어받기");
    expect(runStatePhrase({ state: "paused", pauseReason: "coordinator-exited" }, trEn)).toContain("Take over with a new producer");
    expect(runStatePhrase({ state: "paused", pauseReason: "coordinator-exited" }, tr)).not.toContain("AI 타일");
    expect(runStatePhrase({ state: "paused", pauseReason: "coordination-limit" }, tr)).toContain("한도");
    expect(runStatePhrase({ state: "orphaned" }, tr)).toContain("읽기 전용");
    expect(runStatePhrase({ state: "paused", pauseReason: null }, trEn)).toBe("Coordination paused — artists keep running");
  });

  it("사람 동작의 표시 판정", () => {
    // (3차 6단계) [이어 가기] 는 없다.
    expect(runActions("running", true)).toEqual({ pause: true, resume: false, resumeBlocked: false, stop: true, archive: false });
    expect(runActions("paused", true)).toEqual({ pause: false, resume: true, resumeBlocked: false, stop: true, archive: false });
    expect(runActions("stopping", true)).toEqual({ pause: false, resume: false, resumeBlocked: false, stop: false, archive: false });
    // 조정자가 묶이지 않은 paused — [재개] 는 보이되 꺼진다(서버 `no-coordinator` — adopt_run 으로 이어받기).
    expect(runActions("paused", false)).toMatchObject({ resume: true, resumeBlocked: true, stop: true });
    expect(runActions("paused", true).resumeBlocked).toBe(false);
    expect(runActions("running", false).resumeBlocked).toBe(false);
    for (const ended of ["done", "stopped", "orphaned"] as const) expect(runActions(ended, false).archive).toBe(true);
    expect(taskActions({ state: "todo" }, "running")).toEqual({ cancel: true, reopen: false });
    expect(taskActions({ state: "cancelled" }, "paused")).toEqual({ cancel: false, reopen: true });
    expect(taskActions({ state: "rejected" }, "running")).toEqual({ cancel: true, reopen: true });
    expect(taskActions({ state: "accepted" }, "running")).toEqual({ cancel: false, reopen: false });
    expect(taskActions({ state: "todo" }, "orphaned")).toEqual({ cancel: false, reopen: false });
  });

  it("시간 표시", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(2 * 3600_000 + 3 * 60_000 + 9_000)).toBe("2:03:09");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("seq 비교 갱신", () => {
  it("보던 Run 은 seq 가 앞설 때만 다시 읽는다", () => {
    expect(changeAction({ runId: "r1", seq: 5 }, "r1", 5)).toBe("skip");
    expect(changeAction({ runId: "r1", seq: 4 }, "r1", 5)).toBe("skip");
    expect(changeAction({ runId: "r1", seq: 6 }, "r1", 5)).toBe("refetch");
    expect(changeAction({ runId: "r1", seq: 1 }, "r1", null)).toBe("refetch");
  });

  it("다른 Run 은 건너뛰고 · 목록은 늘 다시 읽고 · 닫힘은 closed", () => {
    expect(changeAction({ runId: "r2", seq: 9 }, "r1", 5)).toBe("skip");
    expect(changeAction({ runId: "r2", seq: 9 }, null, null)).toBe("refetch");
    expect(changeAction({ runId: "r1", seq: 5, closed: true }, "r1", 5)).toBe("closed");
    expect(changeAction({ runId: "r1", seq: 5, closed: true }, null, null)).toBe("refetch");
  });

  it("진행 이벤트(F4 — seq 그대로)는 보던 Run 의 상세만 다시 읽는다", () => {
    const ev = { runId: "r1", attemptId: "att-1", turn: 2 };
    expect(progressAction(ev, "r1")).toBe("refetch");
    expect(progressAction(ev, "r2")).toBe("skip");
    expect(progressAction(ev, null)).toBe("skip");
  });

  it("그물(F8)은 보일 때만 · 주기가 지났을 때만 확인한다", () => {
    expect(resyncDue(true, 1_000, 1_000 + RESYNC_MS)).toBe(true);
    expect(resyncDue(true, 1_000, 1_000 + RESYNC_MS - 1)).toBe(false);
    expect(resyncDue(false, 1_000, 1_000 + RESYNC_MS * 10)).toBe(false);
    // 아직 한 번도 읽지 않았다(첫 읽기가 도는 중) — 서지 않는다.
    expect(resyncDue(true, null, 1_000_000)).toBe(false);
  });

  it("그물(F8)은 목록의 seq 가 앞설 때만 상세를 다시 읽는다", () => {
    const list = [
      { runId: "r1", latestSeq: 7 },
      { runId: "r2", latestSeq: 2 },
    ];
    expect(resyncAction(list, "r1", 7)).toBe("skip");
    expect(resyncAction(list, "r1", 6)).toBe("refetch");
    expect(resyncAction(list, "r1", 9)).toBe("skip");
    expect(resyncAction(list, "r1", null)).toBe("refetch");
    // 목록에 없다(닫혔다 · 서버가 바뀌었다) — 다시 읽어 "없음" 을 정한다.
    expect(resyncAction(list, "r3", 1)).toBe("refetch");
  });
});

describe("이유 코드 표", () => {
  it("코드마다 ko · en 문구가 있다", () => {
    const expectedKeys = ORCH_REASONS.map((r) => `reason.${r}`).sort();
    for (const dict of [ko.orch, en.orch]) {
      expect(Object.keys(dict).filter((k) => k.startsWith("reason.")).sort()).toEqual(expectedKeys);
    }
    for (const r of ORCH_REASONS) {
      const key = ORCH_REASON_KEY[r];
      expect(key).toBe(`orch.reason.${r}`);
      const tail = key.slice("orch.".length) as keyof typeof ko.orch;
      expect(ko.orch[tail], r).toBeTruthy();
      expect(en.orch[tail], r).toBeTruthy();
    }
  });

  it("공용 표(error-reason)에도 있다 — 화면에 대괄호가 남지 않는다", () => {
    for (const r of ORCH_REASONS) expect(REASONS, r).toContain(r);
    expect(stripReason("[run-paused] 멈춤")).toBe("멈춤");
  });

  it("실패 글자 → 코드 · 사람 문구", () => {
    expect(orchReasonOf("[too-many-runs] 동시에 …")).toBe("too-many-runs");
    expect(orchReasonOf("[exists] x")).toBeNull();
    expect(orchReasonOf("plain")).toBeNull();
    // 서버가 표시 언어로 만든 문구가 있으면 그것(대괄호만 뗀다), 코드뿐이면 표의 문구
    expect(orchReasonText("[conflict] 그사이 바뀌었습니다", tr)).toBe("그사이 바뀌었습니다");
    expect(orchReasonText("[risk-not-confirmed]", tr)).toBe(ko.orch["reason.risk-not-confirmed"]);
    expect(orchReasonText("[risk-not-confirmed]", trEn)).toBe(en.orch["reason.risk-not-confirmed"]);
    expect(orchReasonText(" pipe closed ", tr)).toBe("pipe closed");
  });
});

describe("workers (stage 3)", () => {
  it("knows which (old PTY) attempts are live and what a person can do", () => {
    // 옛 파일의 PTY 작업자(kind · turns 없음) — 옛 `process_may_live` 그대로.
    expect(turnMayLive({ state: "working" })).toBe(true);
    expect(turnMayLive({ state: "stop-unconfirmed" })).toBe(true);
    expect(turnMayLive({ state: "stopped" })).toBe(false);
    expect(attemptActions({ id: "att-1", state: "working", stream: "orch-1", worktree: "C:/w" }, "running")).toEqual({
      stop: true,
      removeWorktree: false,
    });
    expect(attemptActions({ id: "att-1", state: "stopping", stream: "orch-1", worktree: "C:/w" }, "stopping").stop).toBe(false);
    expect(attemptActions({ id: "att-1", state: "exited", stream: "orch-1", worktree: "C:/w" }, "running")).toEqual({
      stop: false,
      removeWorktree: true,
    });
    expect(attemptActions({ id: "att-1", state: "working", stream: "orch-1", worktree: null }, "orphaned").stop).toBe(false);
  });

  it("orphaned runs judge by the leftover process, not the stale state (review F12)", () => {
    const a = { id: "att-1", state: "working" as const, stream: "orch-1", worktree: "C:/w" };
    // 남은 프로세스가 없다 — 옛 기록이 "작업 중" 이어도 worktree 를 정리할 수 있다.
    expect(attemptActions(a, "orphaned", [])).toEqual({ stop: false, removeWorktree: true });
    expect(attemptActions(a, "orphaned", [{ attemptId: "att-1", processAlive: false }]).removeWorktree).toBe(true);
    // 프로세스가 아직 산다 — 지우지 않는다.
    expect(attemptActions(a, "orphaned", [{ attemptId: "att-1", processAlive: true }]).removeWorktree).toBe(false);
    // 상태 칩 — orphaned 의 산 상태는 "모름".
    expect(attemptChipText(a, "orphaned", tr)).toBe(tr("orch.attempt.state.unknown"));
    expect(attemptChipText({ state: "exited" }, "orphaned", tr)).toBe(tr("orch.attempt.state.exited"));
    expect(attemptChipText(a, "running", tr)).toBe(tr("orch.attempt.state.working"));
  });

  it("exit-unconfirmed is live and needs a person (review F2)", () => {
    expect(turnMayLive({ state: "exit-unconfirmed" })).toBe(true);
    expect(attemptNeedsHuman({ state: "exit-unconfirmed" })).toBe(true);
    expect(attentionKey({ state: "exit-unconfirmed", attention: "exit-unconfirmed" })).toBe("orch.attention.exit-unconfirmed");
    expect(attemptActions({ id: "x", state: "exit-unconfirmed", stream: "orch-1", worktree: "C:/w" }, "running")).toEqual({
      stop: true,
      removeWorktree: false,
    });
  });

  it("highlights the attempts that need a person", () => {
    expect(attemptNeedsHuman({ state: "awaiting-human" })).toBe(true);
    expect(attemptNeedsHuman({ state: "stop-unconfirmed" })).toBe(true);
    expect(attemptNeedsHuman({ state: "working" })).toBe(false);
    // (3b) 옛 파일의 권한 · 첫 화면 · 멈춤 까닭은 보이지 않는다 — 그 타일이 없다.
    expect(attentionKey({ state: "awaiting-human", attention: "bootstrap" })).toBeNull();
    expect(attentionKey({ state: "awaiting-human", attention: "permission" })).toBeNull();
    expect(attentionKey({ state: "stop-unconfirmed", attention: null })).toBe("orch.attention.stop-unconfirmed");
    expect(attentionKey({ state: "working", attention: null })).toBeNull();
    for (const k of Object.values(ATTEMPT_STATE_KEY)) {
      expect(translate("ko", k)).not.toBe(k);
      expect(translate("en", k)).not.toBe(k);
    }
  });

  it("maps the new reasons", () => {
    expect(orchReasonOf("[branch-has-unmerged] x")).toBe("branch-has-unmerged");
    expect(orchReasonText("[worktree-dirty]", tr)).toContain("커밋");
  });

  it("recognizes a codex autorun line (tile PATH filtering)", () => {
    expect(isCodexLine("codex")).toBe(true);
    expect(isCodexLine("  Codex.exe --no-daemon")).toBe(true);
    expect(isCodexLine("claude")).toBe(false);
    expect(isCodexLine("npx codex")).toBe(false);
    expect(isCodexLine(undefined)).toBe(false);
  });
});

/**
 * **보고 · 수락**(4단계) — 보드의 보고 표시 재료(검토 대상 보고 · 늦은 보고 · 유효한 수락) · 수락 단추 상태(서버 `human_review` ·
 * `dirty-report` · `not-success` · `no-commit` 과 같은 판정) · "보고 뒤 변경" 을 물을 때.
 */
describe("reports and acceptance (stage 4)", () => {
  const rep = (over: Partial<ReportView> = {}): ReportView => ({
    reportId: "rep-1",
    attemptId: "att-1",
    taskId: "task-1",
    outcome: "success",
    summary: "done",
    commitOid: "2222222222222222222222222222222222222222",
    baseCommitOid: "1111111111111111111111111111111111111111",
    dirty: false,
    changedFiles: ["a.txt"],
    at: 1,
    late: false,
    ...over,
  });
  const acc = (over: Partial<AcceptedView> = {}): AcceptedView => ({
    taskId: "task-1",
    attemptId: "att-1",
    reportId: "rep-1",
    commitOid: "2222222222222222222222222222222222222222",
    reviewer: "coordinator",
    verification: null,
    acceptedAt: 5,
    ...over,
  });

  it("picks the report of the current attempt, not late ones or older attempts", () => {
    const run = {
      reports: [rep({ reportId: "old", attemptId: "att-0" }), rep(), rep({ reportId: "late", attemptId: "att-1", late: true })],
    };
    expect(reviewReport(run, { currentAttempt: "att-1" })?.reportId).toBe("rep-1");
    expect(reviewReport(run, { currentAttempt: "att-9" })).toBeNull();
    expect(reviewReport(run, { currentAttempt: null })).toBeNull();
    expect(lateReports({ reports: [rep({ late: true, reportId: "l" })] }, "task-1").map((r) => r.reportId)).toEqual(["l"]);
    expect(lateReports({ reports: [rep()] }, "task-1")).toEqual([]);
  });

  it("accept button: shown for reported/rejected with a report, disabled with the server's reason", () => {
    const r = rep();
    expect(reviewActions({ state: "reported" }, r, "running")).toEqual({
      accept: true,
      acceptFlip: false,
      blocked: null,
      reject: true,
      rejectFlip: false,
    });
    expect(reviewActions({ state: "reported" }, rep({ dirty: true }), "running").blocked).toBe("orch.review.blocked.dirty");
    expect(reviewActions({ state: "reported" }, rep({ outcome: "failure" }), "paused").blocked).toBe("orch.review.blocked.notSuccess");
    expect(reviewActions({ state: "reported" }, rep({ outcome: "blocked", dirty: true }), "running").blocked).toBe(
      "orch.review.blocked.notSuccess",
    );
    expect(reviewActions({ state: "reported" }, rep({ commitOid: null }), "running").blocked).toBe("orch.review.blocked.noCommit");
    // 뒤집기 — 반려된 것은 수락으로, 수락된 것은 반려로.
    const flipA = reviewActions({ state: "rejected" }, r, "running");
    expect([flipA.accept, flipA.acceptFlip, flipA.reject]).toEqual([true, true, false]);
    const flipR = reviewActions({ state: "accepted" }, r, "stopping");
    expect([flipR.accept, flipR.reject, flipR.rejectFlip]).toEqual([false, true, true]);
    // 이미 통합 ref 에 쌓인 수락은 뒤집지 않는다(서버 `already-integrated`) — [반려로 뒤집기] 를 숨긴다.
    expect(reviewActions({ state: "accepted" }, r, "running", true)).toMatchObject({ reject: false, rejectFlip: false });
    // 통합 전 짧은 틈에는 그대로 보인다.
    expect(reviewActions({ state: "accepted" }, r, "running", false)).toMatchObject({ reject: true, rejectFlip: true });
    // 보고가 없거나 · 아직 일하는 중 · 읽기 전용 Run 이면 없다.
    expect(reviewActions({ state: "reported" }, null, "running").accept).toBe(false);
    expect(reviewActions({ state: "active" }, r, "running")).toMatchObject({ accept: false, reject: false });
    expect(reviewActions({ state: "reported" }, r, "orphaned")).toMatchObject({ accept: false, reject: false });
    expect(reviewActions({ state: "reported" }, r, "stopped")).toMatchObject({ accept: false, reject: false });
  });

  it("valid accepted artifact ignores revoked ones; the revoked one stays visible", () => {
    const run = { accepted: [acc({ revokedAt: 9, revokedBy: "human" }), acc({ reviewer: "human", acceptedAt: 10 })] };
    expect(validAccepted(run, "task-1")?.acceptedAt).toBe(10);
    expect(lastRevoked(run, "task-1")?.revokedBy).toBe("human");
    expect(validAccepted({ accepted: [acc({ revokedAt: 9 })] }, "task-1")).toBeNull();
    expect(validAccepted({}, "task-1")).toBeNull();
  });

  it("drift is asked only when a reported attempt still has a worktree", () => {
    const attempts = [{ id: "att-1", worktree: "C:/wt/a" }] as never;
    expect(wantsDrift({ state: "running", reports: [rep()], attempts })).toBe(true);
    expect(wantsDrift({ state: "running", reports: [], attempts })).toBe(false);
    expect(wantsDrift({ state: "running", reports: [rep()], attempts: [{ id: "att-1", worktree: null }] as never })).toBe(false);
    expect(wantsDrift({ state: "orphaned", reports: [rep()], attempts })).toBe(false);
    expect([...driftedAttempts([
      { attemptId: "a", reportId: "r", changedSinceReport: true },
      { attemptId: "b", reportId: "s", changedSinceReport: false },
    ])]).toEqual(["a"]);
  });

  it("diff range needs both commits; short hashes and labels exist", () => {
    expect(reportDiffRange(rep())).toEqual({
      base: "1111111111111111111111111111111111111111",
      tip: "2222222222222222222222222222222222222222",
    });
    expect(reportDiffRange(rep({ baseCommitOid: null }))).toBeNull();
    expect(shortOid("2222222222")).toBe("2222222");
    expect(shortOid(null)).toBe("");
    for (const k of [...Object.values(OUTCOME_KEY), "orch.review.blocked.dirty", "orch.report.drift"] as Key[]) {
      expect(translate("ko", k)).not.toBe(k);
      expect(translate("en", k)).not.toBe(k);
    }
    expect(actionLabel("worker_reported", tr)).toBe(translate("ko", "orch.action.worker_reported"));
  });

  it("maps the stage-4 reasons", () => {
    for (const r of ["stale-attempt", "already-reported", "dirty-report", "not-success", "no-commit"]) {
      expect(orchReasonOf(`[${r}] x`)).toBe(r);
      expect(REASONS).toContain(r);
    }
    expect(stripReason("[dirty-report] 수락할 수 없습니다")).toBe("수락할 수 없습니다");
  });

  // ── 5단계 — 옛 붙여넣기 전달 기록(3a 부터는 옛 파일 읽기 전용) ─────────────────────────
  it("옛 사람 필요 상태 · 옛 전달 사건 이름(옛 파일의 타임라인 — 3차 6단계부터 전달 기록 칸은 보기에 없다)", () => {
    expect(attemptNeedsHuman({ state: "needs-recovery" })).toBe(true);
    expect(actionLabel("prompt_sent", tr)).toBe(translate("ko", "orch.action.prompt_sent"));
  });
});

describe("최근 활동(6단계)", () => {
  const live = { id: "att-1", state: "working" as const, conversationId: "c1" };
  it("마지막 말 · 최근 도구 셋 · 변경 파일 수 · [기록 보기]", () => {
    const line = activityLine(live, {
      status: "ok",
      recent: {
        lastText: "Fixed the parser",
        tools: [
          { name: "Read", summary: "a.rs", pending: false },
          { name: "Edit", summary: "b.rs", pending: false },
          { name: "Bash", summary: "cargo test", pending: true },
          { name: "Grep", summary: "x", pending: false },
        ],
      },
      changedCount: 3,
    }, { status: "ok", lagging: false })!;
    expect(line.lastText).toBe("Fixed the parser");
    expect(line.tools.map((x) => x.name)).toEqual(["Edit", "Bash", "Grep"]);
    expect(line.changedCount).toBe(3);
    expect(line.canView).toBe(true);
    expect(line.status).toBeNull();
    expect(line.warnings).toEqual([]);
  });

  it("경고 — 대화 바뀜(Attempt 칸) · 기록 지연(지켜보기 칸), 읽을 수 없는 까닭", () => {
    const line = activityLine({ ...live, conversationChanged: true }, null, { status: "pending", lagging: true })!;
    expect(line.warnings).toEqual(["conversation-changed", "lagging"]);
    expect(line.canView).toBe(false);
    expect(line.status).toBe("pending");
    expect(line.changedCount).toBeNull();
    expect(activityLine({ ...live, conversationId: null }, null, null)!.status).toBe("no-conversation");
    expect(activityLine({ ...live, state: "exited" }, null, null)).toBeNull();
    for (const w of ["conversation-changed", "lagging"] as const) {
      expect(tr(ACTIVITY_WARN_KEY[w].label)).not.toBe(ACTIVITY_WARN_KEY[w].label);
      expect(trEn(ACTIVITY_WARN_KEY[w].title)).not.toBe(ACTIVITY_WARN_KEY[w].title);
    }
    for (const s of ["pending", "no-conversation", "cwd-mismatch", "outside-cli-dir", "unreadable", "???"]) {
      expect(tr(activityStatusKey(s))).not.toBe(activityStatusKey(s));
    }
  });

  it("산 작업자가 있는 살아 있는 Run 만 묻는다", () => {
    expect(wantsActivity({ state: "running", attempts: [live as never] })).toBe(true);
    expect(wantsActivity({ state: "running", attempts: [{ ...live, state: "stopped" } as never] })).toBe(false);
    expect(wantsActivity({ state: "orphaned", attempts: [live as never] })).toBe(false);
  });
});

// 7단계 실기 — 세션 서버가 재시작되면 보드가 옛 서버의 "실행 중" 으로 멈춰 있었다. 보드는 서버 재연결 이벤트에도 다시 읽는다(소스 훑기).
// 구독은 2026-10-27 분할 5차에 보드의 조회 로더(`board/board-loader.svelte.ts` 의 `subscribe`)로 옮겼고, 보드는 보일 때 그것을 부른다.
describe("RunBoard — 세션 서버 재연결", () => {
  it("보드는 보일 때 로더의 구독을 건다", async () => {
    const { readFileSync } = await import("node:fs");
    const board = readFileSync("src/lib/orchestration/RunBoard.svelte", "utf8");
    expect(board.length).toBeGreaterThan(0);
    expect(board).toMatch(/if \(!visible\) return;\s*return loader\.subscribe\(\);/);
  });

  it("session-server-connected 를 듣고 아는 seq 를 버린 뒤 다시 읽는다", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/orchestration/board/board-loader.svelte.ts", "utf8");
    expect(src.length).toBeGreaterThan(0);
    const at = src.indexOf('listen("session-server-connected"');
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, at + 200);
    expect(body).toContain("knownSeq = null");
    expect(body).toContain("load()");
  });
});

describe("supervision notices (review F11)", () => {
  const tr = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
  it("maps kinds to text keys and unknown kinds to a generic line", () => {
    expect(noticeKey("worker-blocked")).toBe("orch.notice.worker-blocked");
    expect(noticeKey("run-ended")).toBe("orch.notice.run-ended");
    expect(noticeKey("weird")).toBe("orch.notice.other");
    // (3차 6단계) 2차 PTY 작업자의 종류(권한 · 첫 화면 · 멈춤 · 복구)는 걷었다 — 서버가 내지 않는다(모르는 종류 = 일반 줄).
    for (const gone of ["permission", "bootstrap", "stalled", "needs-recovery"]) expect(noticeKey(gone)).toBe("orch.notice.other");
    expect(noticeUrgent("worker-blocked")).toBe(true);
    expect(noticeUrgent("run-ended")).toBe(false);
  });
  it("names the run and the task (or attempt) in one line", () => {
    const line = noticeText({ kind: "worker-idle", runName: "R", taskTitle: "fix", attemptId: "att-1" }, tr as never);
    expect(line).toContain('orch.notice.prefix{"run":"R"}');
    expect(line).toContain('orch.notice.worker-idle{"task":"fix"}');
    expect(noticeText({ kind: "worker-idle", runName: "R", taskTitle: null, attemptId: "att-9" }, tr as never)).toContain('"task":"att-9"');
  });
  it("a reviewer that exits without a verdict is not called a worker (E2E 10-16)", () => {
    expect(noticeKey("reviewer-exited")).toBe("orch.notice.reviewer-exited");
    expect(noticeUrgent("reviewer-exited")).toBe(false);
    const ko = (k: Key, v?: Record<string, string | number>) => translate("ko", k, v);
    const en = (k: Key, v?: Record<string, string | number>) => translate("en", k, v);
    const n = { kind: "reviewer-exited", runName: "e2e", taskTitle: "README status", attemptId: "att-1" };
    expect(noticeText(n, ko)).toContain("검토자가 판정 없이 끝났습니다");
    expect(noticeText(n, ko)).not.toContain("작업자");
    expect(noticeText(n, en)).toContain("reviewer exited without a verdict");
  });
  it("commit refusals that need a person name the reason (10-15)", () => {
    expect(noticeKey("commit-rejected")).toBe("orch.notice.commit-rejected");
    expect(noticeUrgent("commit-rejected")).toBe(false);
    const line = noticeText({ kind: "commit-rejected", runName: "R", taskTitle: "fix", attemptId: "att-1", detail: "filters-configured" }, tr as never);
    expect(line).toContain('"reason":"filters-configured"');
    // 실제 문구에도 사유가 들어간다(두 언어).
    for (const lang of ["ko", "en"] as const) {
      const real = (k: Key, v?: Record<string, string | number>) => translate(lang, k, v);
      expect(noticeText({ kind: "commit-rejected", runName: "R", taskTitle: "fix", attemptId: "a", detail: "no-git-identity" }, real)).toContain("no-git-identity");
    }
  });
  it("only person-needed refusals get a hint; the timeline names both actions", () => {
    expect(commitRejectionHint({ reason: "filters-configured", needsHuman: true })).toBe("orch.commitRejected.hint.filters-configured");
    expect(commitRejectionHint({ reason: "weird", needsHuman: true })).toBe("orch.commitRejected.hint.other");
    expect(commitRejectionHint({ reason: "nothing-to-commit", needsHuman: false })).toBeNull();
    expect(actionLabel("commit_rejected", tr as never)).toBe("orch.action.commit_rejected");
    expect(actionLabel("worker_committed", tr as never)).toBe("orch.action.worker_committed");
  });
  it("the run list shows blocked workers (3b — needsHuman is gone)", () => {
    expect(blockedCount({})).toBe(0);
    expect(blockedCount({ blocked: 2 })).toBe(2);
    expect(blockedCount({ blocked: -1 })).toBe(0);
    expect(blockedCount({ blocked: Number.NaN })).toBe(0);
  });
  it("3a notice kinds have text in both languages and open the board", () => {
    for (const kind of ["worker-blocked", "worker-idle", "turn-timeout", "verify-needs-human", "repo-identity-changed"]) {
      expect(noticeKey(kind)).toBe(`orch.notice.${kind}`);
      for (const lang of ["ko", "en"] as const) {
        const real = (k: Key, v?: Record<string, string | number>) => translate(lang, k, v);
        expect(noticeText({ kind, runName: "R", taskTitle: "fix", attemptId: "a" }, real)).not.toContain("orch.notice");
      }
    }
    expect(noticeUrgent("worker-blocked")).toBe(true);
    expect(noticeUrgent("worker-idle")).toBe(false);
  });
});

describe("서버 커밋 · 보고 불일치(10-15)", () => {
  it("Attempt 의 서버 커밋만 · 오래된 것부터", () => {
    const commits = [
      { attemptId: "a", commitOid: "1".repeat(40), parentOid: "0".repeat(40), branch: "orch-a", subject: "one", files: 1, at: 1 },
      { attemptId: "b", commitOid: "2".repeat(40), parentOid: "0".repeat(40), branch: "orch-b", subject: "x", files: 2, at: 2 },
      { attemptId: "a", commitOid: "3".repeat(40), parentOid: "1".repeat(40), branch: "orch-a", subject: "two", files: 1, at: 3 },
    ];
    expect(attemptCommits({ commits }, "a").map((c) => c.subject)).toEqual(["one", "two"]);
    expect(attemptCommits({}, "a")).toEqual([]);
  });

  it("불일치 보고는 수락할 수 없다", () => {
    const ok = { outcome: "success" as const, dirty: false, commitOid: "1".repeat(40), mismatch: null };
    expect(acceptBlocker(ok)).toBeNull();
    expect(acceptBlocker({ ...ok, mismatch: "branch-changed" })).toBe("orch.review.blocked.mismatch");
  });
});

describe("파일 목록(통합 설계 1단계)", () => {
  it("파일 상태 글자는 git 관례", () => {
    expect(fileStatusLetter("added")).toBe("A");
    expect(fileStatusLetter("renamed")).toBe("R");
    expect(fileStatusLetter("type-changed")).toBe("T");
    expect(fileStatusLetter("unknown")).toBe("?");
  });
});

describe("보류 · Run 완료 · 통합 작업(통합 설계 2단계)", () => {
  it("보류 막대 — 의도 저장 실패 · 정리 대기 · 저장소 신원은 [보류 풀기], 통합 ref 어긋남은 [조정](3단계)", () => {
    expect(holdBar(null, tr)).toBeNull();
    expect(holdBar({ reason: "persist-failed", at: 0 }, tr)).toEqual({
      text: tr("orch.hold.persist-failed"),
      release: true,
      reconcile: false,
      delegation: false,
    });
    expect(holdBar({ reason: "cleanup-pending", at: 0 }, tr)?.release).toBe(true);
    expect(holdBar({ reason: "integration-diverged", at: 0 }, tr)).toEqual({
      text: tr("orch.hold.integration-diverged"),
      release: false,
      reconcile: true,
      delegation: false,
    });
    // 3a — 저장소 신원이 바뀜: [보류 풀기] + [맡기기 편집 ›]
    expect(holdBar({ reason: "repo-identity-changed", at: 0 }, tr)).toMatchObject({ release: true, delegation: true });
    // 모르는 사유 — 예외 없이 날 낱말
    expect(holdBar({ reason: "new-reason" as never, at: 0 }, tr)?.text).toBe("new-reason");
  });
  it("[Run 완료] — 살아 있는 Run 에만 · 서버가 막으면 꺼지고 막는 것을 사람 문구로", () => {
    expect(completeAction({ state: "running", completable: { ok: true, blockers: [] } }, tr)).toEqual({ show: true, enabled: true, why: null });
    const blocked = completeAction({ state: "paused", completable: { ok: false, blockers: ["tasks-open", "on-hold"] } }, tr);
    expect(blocked.show && !blocked.enabled).toBe(true);
    expect(blocked.why).toBe(tr("orch.complete.blocked", { list: `${tr("orch.complete.blocker.tasks-open")}, ${tr("orch.complete.blocker.on-hold")}` }));
    expect(completeAction({ state: "done", completable: { ok: false, blockers: ["run-state"] } }, tr).show).toBe(false);
    expect(completeAction({ state: "running" }, tr).show).toBe(false);
  });
  it("통합 중인 Task — 끝나지 않은 Job 만 · 일반 [취소] 는 숨긴다", () => {
    const jobs = [
      { jobId: "j1", taskId: "t", phase: "aborted" as const, startedAt: 0 },
      { jobId: "j2", taskId: "t", phase: "candidate" as const, startedAt: 1 },
    ];
    expect(liveJob({ jobs }, "t")?.jobId).toBe("j2");
    expect(liveJob({ jobs }, "other")).toBeNull();
    expect(liveJob({}, "t")).toBeNull();
    expect(taskActions({ state: "integrating" }, "running").cancel).toBe(false);
    expect(taskActions({ state: "conflict" }, "running").cancel).toBe(true);
  });
  it("새 이유 · 사건 · 상태에 문구가 있다", () => {
    for (const k of ["run-on-hold", "integration-busy", "integration-committing", "already-integrated", "integration-failed", "not-completable"]) {
      expect(orchReasonOf(`[${k}] x`)).toBe(k);
    }
    expect(noticeKey("persist-failed")).toBe("orch.notice.persist-failed");
    expect(noticeKey("integration-diverged")).toBe("orch.notice.integration-diverged");
    expect(runStatePhrase({ state: "paused", pauseReason: "hold" }, tr)).toBe(tr("orch.phrase.paused.hold"));
    // 프로듀서가 끝남 — 프로듀서 채팅이 연 앨범이면 "같은 채팅" 문구, 사람이 연 앨범이면 이어받기 문구만
    const exited = { state: "paused" as const, pauseReason: "coordinator-exited" };
    expect(runStatePhrase({ ...exited, origin: { by: "ai", producer: "pc-1" } }, tr)).toBe(tr("orch.phrase.paused.coordinatorChat"));
    expect(runStatePhrase(exited, tr)).toBe(tr("orch.phrase.paused.coordinator"));
  });
});

describe("통합(통합 설계 3단계)", () => {
  const H1 = "a".repeat(40);
  const H2 = "b".repeat(40);
  const integration = { workRef: "refs/aynx/orch/r/int", exportBranch: "orch-12345678-int", baseCommit: H1, expectedHead: H2 };
  it("통합 칩 — 통합된(거둬지지 않은) Task 수 · 내보내기 상태, 옛 Run 이면 없음", () => {
    const acc = (integrationCommit: string | null, revokedAt: number | null = null) =>
      ({ taskId: "t", attemptId: "a", reportId: "r", commitOid: H1, reviewer: "coordinator", verification: null, acceptedAt: 0, revokedAt, integrationCommit }) as AcceptedView;
    expect(integrationChip({ integration: null, accepted: [] })).toBeNull();
    const c = integrationChip({ integration, accepted: [acc(H2), acc(H1, 5), acc(null)] });
    expect(c).toEqual({ head: H2, integrated: 1, exported: "none" });
    expect(integrationChip({ integration: { ...integration, exportedHead: H2 }, accepted: [] })?.exported).toBe("current");
    expect(integrationChip({ integration: { ...integration, exportedHead: H1 }, accepted: [] })?.exported).toBe("stale");
  });
  it("충돌 한 줄 · 거둔 통합의 까닭 · 단계 낱말은 한국어", () => {
    const info = {
      jobId: "j", old: H1, reportCommit: H2, mergeBase: H1, entries: [
        { paths: ["a.txt"], kinds: ["contents"], stages: [] },
        { paths: ["b.bin"], kinds: ["binary", "contents"], stages: [] },
      ], more: 0, needsHuman: true, at: 0,
    };
    expect(conflictSummary(info, tr)).toBe(`${tr("orch.conflict.summary", { n: 2, kinds: "contents, binary" })} · ${tr("orch.conflict.needsHuman")}`);
    expect(integrationAbortText("git-unsupported:filters", tr)).toBe(tr("orch.integration.abort.git-unsupported", { detail: "filters" }));
    expect(integrationAbortText("moved", tr)).toBe(tr("orch.integration.abort.moved"));
    expect(integrationAbortText("weird", tr)).toBe("weird");
    const jobs = [
      { jobId: "j1", taskId: "t", phase: "integrated" as const, startedAt: 0 },
      { jobId: "j2", taskId: "t", phase: "aborted" as const, startedAt: 1, outcome: { reason: "cancelled", at: 2 } },
    ];
    expect(lastAbortedJob({ jobs }, "t")).toBe("cancelled");
    expect(lastAbortedJob({ jobs: jobs.slice(0, 1) }, "t")).toBeNull();
    expect(tr(JOB_PHASE_KEY.committing)).toBe("올리는 중");
    for (const k of Object.values(JOB_PHASE_KEY)) expect(tr(k)).not.toBe(k);
  });
  it("병합 안내는 통합 ref 가 없는 옛 Run 에만 · 충돌한 Task 는 반려로 나간다", () => {
    const tasks = [
      { id: "a", title: "A", goal: "", dependsOn: [], version: 1, state: "accepted" as const, createdAt: 0, updatedAt: 0 },
      { id: "b", title: "B", goal: "", dependsOn: [], version: 1, state: "accepted" as const, createdAt: 0, updatedAt: 0 },
    ];
    const x = { state: "todo" as const, dependsOn: ["a", "b"] };
    expect(needsMergeHint(x, { tasks, integration: null })).toBe(true);
    expect(needsMergeHint(x, { tasks, integration })).toBe(false);
    expect(reviewActions({ state: "conflict" }, null, "running").reject).toBe(true);
    expect(reviewActions({ state: "conflict" }, null, "running").accept).toBe(false);
  });
  it("새 이유 · 사건에 문구가 있다", () => {
    for (const k of ["git-too-old", "git-unsupported", "export-checked-out", "export-branch-moved"]) {
      expect(orchReasonOf(`[${k}] x`)).toBe(k);
    }
    expect(noticeKey("integration-conflict")).toBe("orch.notice.integration-conflict");
    expect(noticeKey("integration-unsupported")).toBe("orch.notice.integration-unsupported");
    expect(actionLabel("integration_conflict", tr)).toBe(tr("orch.action.integration_conflict"));
  });
});

describe("충돌 해결 Attempt(통합 설계 3b)", () => {
  it("충돌 안내 — 텍스트 충돌은 해결 작업자, 나머지는 사람(반려)", () => {
    expect(conflictHintKey({ needsHuman: false })).toBe("orch.conflict.hint.text");
    expect(conflictHintKey({ needsHuman: true })).toBe("orch.conflict.hint");
    expect(tr("orch.conflict.hint.text")).not.toBe("orch.conflict.hint.text");
  });
  it("해결 중 — Task 의 현재 Attempt 가 해결 Attempt 이고 Task 가 active 일 때만", () => {
    const attempts = [
      { id: "a1", resolves: null, state: "exited" as const },
      { id: "a2", resolves: "job-1", state: "working" as const },
    ];
    expect(resolverOf({ currentAttempt: "a2", state: "active" }, attempts)?.id).toBe("a2");
    expect(resolverOf({ currentAttempt: "a1", state: "active" }, attempts)).toBeNull();
    expect(resolverOf({ currentAttempt: "a2", state: "reported" }, attempts)).toBeNull();
    expect(resolverOf({ currentAttempt: null, state: "active" }, attempts)).toBeNull();
    expect(actionLabel("resolver_spawning", tr)).toBe(tr("orch.action.resolver_spawning"));
    for (const k of ["orch.attempt.resolves", "orch.report.resolved", "orch.conflict.resolving"] as const) expect(tr(k)).not.toBe(k);
  });
});

describe("수락 전 검증(통합 설계 4단계)", () => {
  // (3차 6단계) 시작 칸의 검증 글자 검사는 맡기기 폼(`delegation.test.ts` 의 `validateRepoForm`)이 한다 — 시작 대화는 걷었다.
  it("[검증 실행] 은 대기 Job · 후보 · 머리가 맞을 때만 — [실패인데 수락] 은 마지막 실패에만", () => {
    const run = {
      verify: { command: "x", commandSha: "s".repeat(64), timeoutMinutes: 10, autoRun: false },
      integration: { workRef: "r", exportBranch: "b", baseCommit: "o", expectedHead: "o".repeat(40) },
    } as Pick<RunDetail, "verify" | "integration">;
    const job = { jobId: "job-1", taskId: "t", phase: "awaiting-approval" as const, candidate: "c".repeat(40), old: "o".repeat(40), startedAt: 0 };
    expect(approveVerifyArgs(run, job)).toEqual({ jobId: "job-1", candidate: "c".repeat(40), commandSha: "s".repeat(64), old: "o".repeat(40) });
    expect(approveVerifyArgs(run, { ...job, old: "x".repeat(40) })).toBeNull();
    expect(approveVerifyArgs(run, { ...job, phase: "verifying" })).toBeNull();
    expect(awaitingVerify({ jobs: [job] }, "t")?.jobId).toBe("job-1");
    const failed = {
      ...job,
      phase: "aborted" as const,
      verify: { verifyId: "ver-1", jobId: "job-1", candidate: "c".repeat(40), commandSha: "s", envPolicy: "p", hermetic: true, exitCode: 3, outcome: "fail" as const, durationMs: 1, outBytes: 1, tailSha256: "h", approvedBy: "auto" as const, at: 0 },
    };
    const full = { ...run, jobs: [failed] };
    expect(overridableVerify(full, { id: "t", state: "reported" })?.verifyId).toBe("ver-1");
    expect(overridableVerify(full, { id: "t", state: "accepted" })).toBeNull();
    expect(overridableVerify({ ...full, jobs: [{ ...failed, verify: { ...failed.verify, outcome: "cancelled" as const } }] }, { id: "t", state: "reported" })).toBeNull();
    expect(overridableVerify({ ...full, jobs: [failed, { ...job, phase: "aborted" as const }] }, { id: "t", state: "reported" })).toBeNull();
  });

  it("문구 · 알림 · 이유 코드가 두 언어에 있다", () => {
    for (const o of Object.keys(VERIFY_OUTCOME_KEY) as (keyof typeof VERIFY_OUTCOME_KEY)[]) {
      expect(tr(VERIFY_OUTCOME_KEY[o])).not.toBe(VERIFY_OUTCOME_KEY[o]);
      expect(trEn(VERIFY_OUTCOME_KEY[o])).not.toBe(VERIFY_OUTCOME_KEY[o]);
    }
    expect(noticeKey("verify-approval")).toBe("orch.notice.verify-approval");
    expect(noticeUrgent("verify-approval")).toBe(true);
    expect(noticeText({ kind: "verify-failed", runName: "R", taskTitle: "t", attemptId: "a", detail: "fail" }, tr)).toContain("fail");
    expect(orchReasonOf("[approval-stale] x")).toBe("approval-stale");
    expect(actionLabel("verify_finished", tr)).toBe(tr("orch.action.verify_finished"));
  });
});

describe("검토자(통합 설계 5단계)", () => {
  it("보드 검토 줄 — 서버 reviewState 그대로 · 없으면 필수 · 보고됨일 때만", () => {
    const task = { id: "t", state: "reported" } as TaskView;
    const base = { remaining: { reviews: 2 } } as unknown as RunDetail;
    expect(reviewLine(base, task)).toBeNull();
    expect(reviewLine({ ...base, requireReview: true }, task)?.state).toBe("none");
    expect(reviewLine({ ...base, requireReview: true }, { ...task, state: "accepted" })).toBeNull();
    const pass = reviewLine({ ...base, reviewState: { t: { state: "pass", findings: ["f"], summary: "ok" } } }, task);
    expect(pass).toMatchObject({ state: "pass", findings: ["f"], summary: "ok", budgetLeft: 2, required: false });
    for (const k of Object.values(REVIEW_STATE_KEY)) {
      expect(tr(k)).not.toBe(k);
      expect(trEn(k)).not.toBe(k);
    }
    expect(isReviewer({ role: "reviewer" } as AttemptView)).toBe(true);
    expect(isReviewer({} as AttemptView)).toBe(false);
  });

  it("보드 검토 칸의 턴 줄(3차 2단계 — 헤드리스 검토자) — 도는 중 · 끝 · 실패 사유 낱말 · 실효 모델", () => {
    const task = { id: "t" } as TaskView;
    const rv = (over: Partial<AttemptView>): AttemptView =>
      ({
        id: "att-1",
        taskId: "t",
        cli: "claude",
        state: "working",
        startedAt: 10,
        role: "reviewer",
        reviewOf: { reportId: "rep-2", commitOid: "c" },
        ...over,
      }) as AttemptView;
    const turn = (outcome: string, extra: Partial<TurnView> = {}): TurnView => ({ n: 1, startedAt: 1, outcome, ...extra });
    const d = (attempts: AttemptView[], reportId: string | null = "rep-2") =>
      ({ attempts, reviewState: reportId ? { t: { state: "pending", reportId } } : {} }) as unknown as RunDetail;
    // 검토자가 없으면 줄이 없다 · 작업자는 세지 않는다.
    expect(reviewTurnLine(d([]), task)).toBeNull();
    expect(reviewTurnLine(d([rv({ role: "worker" })]), task)).toBeNull();
    // 턴 기록 전(막 생성) — 살아 있으면 도는 중, 끝났으면 줄 없음(옛 서버).
    expect(reviewTurnLine(d([rv({ state: "spawning" })]), task)).toMatchObject({ phase: "running", reason: null, model: null });
    expect(reviewTurnLine(d([rv({ state: "exited" })]), task)).toBeNull();
    // 도는 중 · 끝 · 실패(사유 낱말) · 실효 모델.
    expect(reviewTurnLine(d([rv({ turns: [turn("running")] })]), task)?.phase).toBe("running");
    expect(reviewTurnLine(d([rv({ state: "exited", turns: [turn("ok", { model: "claude-sonnet-5-5" })] })]), task)).toEqual({
      phase: "ended",
      reason: null,
      model: "claude-sonnet-5-5",
      attemptId: "att-1",
    });
    expect(reviewTurnLine(d([rv({ turns: [turn("failed", { reason: "no-result" })] })]), task)).toMatchObject({ phase: "failed", reason: "no-result" });
    expect(reviewTurnLine(d([rv({ turns: [turn("timeout")] })]), task)?.reason).toBe("timeout");
    expect(reviewTurnLine(d([rv({ turns: [turn("stop-unconfirmed", { reason: "ok" })] })]), task)?.reason).toBe("stop-unconfirmed:ok");
    // 현재 보고를 검토한 검토자 중 **마지막** 것 — 옛 보고의 검토자는 보지 않는다.
    const old = rv({ id: "att-0", startedAt: 5, reviewOf: { reportId: "rep-1", commitOid: "c" }, turns: [turn("ok")] });
    const later = rv({ id: "att-2", startedAt: 20, turns: [turn("failed", { reason: "mcp-unavailable" })] });
    const first = rv({ id: "att-1", startedAt: 10, turns: [turn("ok")] });
    expect(reviewTurnLine(d([old, later, first]), task)).toMatchObject({ attemptId: "att-2", reason: "mcp-unavailable" });
    expect(reviewTurnLine(d([old]), task)).toBeNull();
    // 문구가 두 언어에 있다.
    for (const k of Object.values(REVIEW_TURN_KEY)) {
      expect(tr(k)).not.toBe(k);
      expect(trEn(k)).not.toBe(k);
    }
    expect(tr("orch.reviewer.turn.failed", { reason: "no-result" })).toContain("no-result");
    expect(actionLabel("turn_ended", tr)).toBe(tr("orch.action.turn_ended"));
    expect(actionLabel("turn_started", trEn)).toBe("turn started");
  });

  it("이유 코드 · 알림 · 사건 문구가 두 언어에 있다", () => {
    for (const r of ["review-active", "review-pending", "review-required", "review-changes-requested", "review-budget-exhausted", "symlink-outside"]) {
      expect(orchReasonOf(`[${r}] x`)).toBe(r);
    }
    expect(noticeKey("review-changes-requested")).toBe("orch.notice.review-changes-requested");
    expect(actionLabel("reviewer_reported", tr)).toBe(tr("orch.action.reviewer_reported"));
    expect(trEn("orch.actor.reviewer")).toBe("Reviewer");
  });
});

describe("정리(통합 설계 6단계)", () => {
  it("[정리] 는 끝난 Run · orphaned 에서만 · 서버 판정이 있으면 그것", () => {
    expect(cleanupAvailable({ state: "done" })).toBe(true);
    expect(cleanupAvailable({ state: "stopped" })).toBe(true);
    expect(cleanupAvailable({ state: "orphaned" })).toBe(true);
    expect(cleanupAvailable({ state: "running" })).toBe(false);
    expect(cleanupAvailable({ state: "paused" })).toBe(false);
    expect(cleanupAvailable({ state: "done", cleanable: false })).toBe(false);
  });

  it("기본 고름 = 지울 수 있고 기본 체크인 것만(통합된 worktree · 남은 서버 임시 ref) — 보존 ref · 통합 ref 는 남김", () => {
    const p: Pick<CleanupPreview, "worktrees" | "refs"> = {
      worktrees: [
        { path: "a", attemptId: "1", taskId: "t1", taskTitle: "A", taskState: "accepted", exists: true, inUse: false, dirty: false, integrated: true, eligible: true, defaultChecked: true },
        { path: "b", attemptId: "2", taskId: "t2", taskTitle: "B", taskState: "rejected", exists: true, inUse: false, dirty: false, integrated: false, eligible: true, defaultChecked: false },
        { path: "c", attemptId: "3", taskId: "t3", taskTitle: "C", taskState: "accepted", exists: true, inUse: false, dirty: true, integrated: true, eligible: false, blocker: "dirty", defaultChecked: false },
      ],
      refs: [
        { name: "refs/aynx/orch/r/int", kind: "int", oid: "1".repeat(40), eligible: false, blocker: "not-exported", defaultChecked: false },
        { name: "refs/aynx/orch/r/accepted/t1", kind: "accepted", oid: "2".repeat(40), eligible: true, defaultChecked: false },
        { name: "refs/aynx/orch/r/candidate", kind: "candidate", oid: "3".repeat(40), eligible: true, defaultChecked: true },
      ],
    };
    expect(cleanupDefaults(p)).toEqual({ worktrees: ["a"], refs: ["refs/aynx/orch/r/candidate"] });
  });

  it("문구가 두 언어에 있다", () => {
    for (const r of ["cleanup-pending", "not-cleanable"]) {
      expect(orchReasonOf(`[${r}] x`)).toBe(r);
    }
    expect(noticeKey("cleanup-pending")).toBe("orch.notice.cleanup-pending");
    for (const k of [
      ...Object.values(CLEANUP_BLOCKER_KEY),
      ...["changed", "in-use", "remove-failed", "not-a-worktree", "unreadable", "x"].map(tempWhyKey),
      ...["verify", "review", "review-cwd", "temp"].map(tempRoleKey),
      "orch.action.server_temp_cleaned" as Key,
      "orch.action.run_cleaned" as Key,
    ]) {
      expect(tr(k)).not.toBe(k);
      expect(trEn(k)).not.toBe(k);
    }
    expect(tempWhyKey("weird")).toBe("orch.temp.why.changed");
    expect(actionLabel("run_cleaned", tr)).toBe(tr("orch.action.run_cleaned"));
  });

  it("[정리] 결과 — 남긴 브랜치는 실패와 따로 센다(E2E 10-16 #9)", () => {
    const r = {
      worktrees: [
        { path: "a", removed: true, branchDeleted: true, branchKept: null },
        { path: "b", removed: true, branchDeleted: false, branchKept: "unmerged" },
        { path: "c", removed: true, branchDeleted: false },
      ],
    };
    expect(keptBranchCount(r)).toBe(1);
    expect(tr("orch.cleanup.done.branchesKept", { n: 1 })).toContain("브랜치 1개");
    expect(trEn("orch.cleanup.done.branchesKept", { n: 1 })).toContain("1 branch");
  });
});

// ---------------------------------------------------------------------------
// 3차 3b — 번역 키 표가 서버(3a) 값 전부를 덮는다 · 모르는 값은 날 낱말(예외 없음)
// ---------------------------------------------------------------------------

/**
 * **Rust serde 이름 목록**(src-tauri/src/orchestration — 3a `0b17af47`). 서버에 값이 더해지면 여기와 표 둘 다에 더해야 시험이 선다 —
 * 하나라도 빠지면 실패한다(3a 실기의 보드 예외 `lookup(undefined)` 재발 방지).
 */
const RUST = {
  // model.rs `RunState`(camelCase)
  runState: ["running", "paused", "stopping", "stopped", "done", "orphaned"],
  // model.rs `TaskState`
  taskState: ["todo", "active", "reported", "accepted", "rejected", "cancelled", "integrating", "conflict"],
  // model.rs `AttemptState`(kebab-case) — 3a 의 여덟 + 옛 변이 여섯
  attemptState: [
    "spawning", "starting", "ready", "working", "awaiting-human", "needs-recovery", "running", "idle",
    "reported", "exited", "stopping", "stopped", "stop-unconfirmed", "exit-unconfirmed",
  ],
  // model.rs `ReportOutcome`
  reportOutcome: ["success", "failure", "blocked"],
  // model.rs `JobPhase`
  jobPhase: ["prepared", "candidate", "awaiting-approval", "verifying", "committing", "integrated", "conflict", "aborted"],
  // model.rs `VerifyOutcome`
  verifyOutcome: ["pass", "fail", "timeout", "cancelled", "modified-tracked", "spawn-failed", "symlink-outside", "stop-unconfirmed"],
  // model.rs `HoldReason`
  holdReason: ["integration-diverged", "persist-failed", "cleanup-pending", "repo-identity-changed"],
  // model.rs `Actor`
  actor: ["human", "coordinator", "worker", "server", "reviewer"],
  // (3차 6단계) model.rs `DeliveryState` 는 옛 파일 디코딩용으로만 남고 보기에 싣지 않는다 — 프런트 표가 없다.
  // model.rs `ReviewVerdict`
  verdict: ["pass", "changes-requested"],
  // review.rs `state_view` 의 state
  reviewState: ["none", "pending", "pass", "changes-requested"],
  // model.rs `AttemptKind`(lowercase)
  attemptKind: ["write", "judge"],
  // roles.rs `status_word`
  // turn.rs `turn_outcome` + 기록 중 `running`
  turnOutcome: ["running", "ok", "failed", "timeout", "stopped", "stop-unconfirmed"],
  // turn.rs `Grade`
  grade: ["edit", "full", "read-only"],
  // integrate.rs `completable` 의 막는 것
  completeBlocker: ["run-state", "tasks-open", "integration-running", "workers-alive", "verify-running", "review-active", "on-hold"],
  // notice.rs `kind_word` + `raise` 하는 종류(통합 · 정리)
  // (3차 6단계) 2차 PTY 작업자의 종류(permission · bootstrap · stalled · needs-recovery)는 걷었다.
  notice: [
    "worker-exited", "reviewer-exited", "exit-unconfirmed", "spawn-failed",
    "limit", "coordinator-exited", "run-ended", "commit-rejected", "verify-approval", "verify-failed", "worker-blocked", "worker-idle",
    "turn-timeout", "verify-needs-human", "repo-identity-changed", "persist-failed", "integration-diverged", "integration-conflict",
    "integration-unsupported", "integration-failed", "review-changes-requested", "cleanup-pending",
    // 3차 5단계
    "run-adopted",
    // 앨범 병합
    "auto-merge-stopped",
  ],
  // `Run::bump` 의 사건 낱말(3a 서버 — attempts · report · review · integrate · verify · cleanup · store)
  action: [
    "run_started", "task_created", "task_updated", "human_paused", "human_resumed", "human_stopped", "human_continued", "run_ended",
    "limit_reached", "coordinator_exited", "worker_spawning", "resolver_spawning", "worktree_created", "worker_started", "spawn_failed",
    "worker_stopping", "worker_stopped", "worker_closed", "stop_unconfirmed", "exit_unconfirmed", "worker_exited", "worker_idle",
    "worker_turn_ended", "reviewer_turn_ended", "worktree_removed", "worker_reported", "worker_blocked", "worker_committed",
    "commit_rejected", "task_accepted", "task_rejected", "task_integrating", "integration_candidate", "integration_committing",
    "task_integrated", "recovered_integrated", "integration_aborted", "integration_conflict", "integration_exported", "run_held",
    "hold_released", "run_done", "human_reconciled", "human_override_verify", "verify_awaiting_approval", "verify_approved",
    "verify_started", "verify_finished", "verify_needs_human", "reviewer_spawning", "review_place_created", "reviewer_reported",
    "review_invalidated", "review_ended", "turn_started", "turn_ended", "turn_requested", "server_temp_cleaned",
    "server_temp_discarded", "run_cleaned",
    // 3차 5단계 — adopt_run
    "run_adopted",
    // F7 — 영속 저장 실패 표지
    "persist_failed", "persist_recovered",
    // 앨범 우선(10-30) — 사람의 앨범 구성 · 이름 변경, 프로듀서 세대 · 깨움(실기 10-31 — 타임라인에 원문으로 나왔다)
    "album_changed", "album_renamed", "generation_bumped", "producer_woken",
    // 앨범 병합
    "integration_merged", "integration_auto_merged", "auto_merge_stopped",
  ],
} as const;

describe("번역 키 표 — 서버 enum 전부를 덮는다(3b)", () => {
  const tables: [string, Readonly<Record<string, Key>>, readonly string[]][] = [
    ["RUN_STATE_KEY", RUN_STATE_KEY, RUST.runState],
    ["TASK_STATE_KEY", TASK_STATE_KEY, RUST.taskState],
    ["ATTEMPT_STATE_KEY", ATTEMPT_STATE_KEY, RUST.attemptState],
    ["OUTCOME_KEY", OUTCOME_KEY, RUST.reportOutcome],
    ["JOB_PHASE_KEY", JOB_PHASE_KEY, RUST.jobPhase],
    ["VERIFY_OUTCOME_KEY", VERIFY_OUTCOME_KEY, RUST.verifyOutcome],
    ["HOLD_REASON_KEY", HOLD_REASON_KEY, RUST.holdReason],
    ["ACTOR_KEY", ACTOR_KEY, RUST.actor],
    ["VERDICT_KEY", VERDICT_KEY, RUST.verdict],
    ["REVIEW_STATE_KEY", REVIEW_STATE_KEY, RUST.reviewState],
    ["KIND_KEY", KIND_KEY, RUST.attemptKind],
    ["TURN_OUTCOME_KEY", TURN_OUTCOME_KEY, RUST.turnOutcome],
    ["GRADE_KEY", GRADE_KEY, RUST.grade],
    ["BLOCKER_KEY", BLOCKER_KEY, RUST.completeBlocker],
    ["NOTICE_KEY", NOTICE_KEY, RUST.notice],
    ["ACTION_KEY", ACTION_KEY, RUST.action],
  ];

  for (const [name, table, values] of tables) {
    it(`${name} — 서버 값마다 키가 있고 두 언어 문구가 있다`, () => {
      for (const v of values) {
        const key = keyOf(table, v);
        expect(key, `${name}[${v}]`).not.toBeNull();
        expect(translate("ko", key as Key), `${name}[${v}] ko`).not.toBe(key);
        expect(translate("en", key as Key), `${name}[${v}] en`).not.toBe(key);
      }
    });
  }

  it("모르는 값 · 빈 값은 예외 없이 날 낱말(빈 값은 ?)", () => {
    expect(keyText(ATTEMPT_STATE_KEY, "brand-new-state", tr)).toBe("brand-new-state");
    expect(keyText(ATTEMPT_STATE_KEY, undefined, tr)).toBe("?");
    expect(keyText(ATTEMPT_STATE_KEY, null, tr)).toBe("?");
    // 프로토타입 낱말을 표의 칸으로 읽지 않는다
    expect(keyOf(ATTEMPT_STATE_KEY, "constructor")).toBeNull();
    expect(keyText(ATTEMPT_STATE_KEY, "running", tr)).toBe(tr("orch.attempt.state.running"));
    expect(actionLabel("never_heard_of", tr)).toBe("never_heard_of");
    expect(noticeKey("toString")).toBe("orch.notice.other");
    // 사전의 마지막 그물 — 키가 undefined 로 와도 던지지 않는다(3a 실기의 예외)
    expect(() => translate("ko", undefined as unknown as Key)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3차 3b — 헤드리스 작업자 보기 모델
// ---------------------------------------------------------------------------

describe("헤드리스 작업자(3b — 턴 · blocked · 술어)", () => {
  const args = { cli: "claude", grade: "edit", settingsControl: "restricted", allowedRules: ["Bash(npm test:*)", "Bash(npm ci:*)"], resume: true };
  const turn = (n: number, outcome: string, extra: Partial<TurnView> = {}): TurnView => ({ n, startedAt: n * 1000, outcome, ...extra });
  const w = (over: Partial<AttemptView> = {}): AttemptView =>
    ({
      id: "att-1",
      taskId: "t",
      cli: "claude",
      gen: 1,
      state: "running",
      startedAt: 0,
      kind: "write",
      roleId: "role-a",
      roleName: "구현",
      turns: [turn(1, "ok", { endedAt: 1500, tools: 4 }), turn(2, "running", { lastTool: "Edit", denials: 1, model: "claude-sonnet-5-5", args })],
      ...over,
    }) as AttemptView;

  it("술어 넷 — idle 은 열려 있고 턴은 없다 · reported 는 닫혔다(헤드리스)", () => {
    expect(isHeadless(w())).toBe(true);
    expect(isHeadless({ role: "reviewer", stream: null })).toBe(true);
    expect(isHeadless({ stream: "orch-1" })).toBe(false);
    expect(turnMayLive(w({ state: "running" }))).toBe(true);
    expect(turnMayLive(w({ state: "idle" }))).toBe(false);
    expect(turnMayLive(w({ state: "reported" }))).toBe(false);
    expect(attemptClosed({ state: "idle" })).toBe(false);
    expect(attemptClosed({ state: "reported" })).toBe(true);
    expect(attemptOpen(w({ state: "idle" }))).toBe(true);
    expect(attemptOpen(w({ state: "stopped" }))).toBe(false);
    // 헤드리스 idle 은 [중단](곧바로 닫힘) · reported 는 [중단] 없음 + worktree 정리 가능
    expect(attemptActions(w({ state: "idle", worktree: "C:/w" }), "running")).toEqual({ stop: true, removeWorktree: false });
    expect(attemptActions(w({ state: "reported", worktree: "C:/w" }), "running")).toEqual({ stop: false, removeWorktree: true });
    // 옛 PTY 의 reported 는 CLI 가 아직 살 수 있다 — [중단] 이 선다
    expect(attemptActions({ id: "x", state: "reported", stream: "orch-1", worktree: "C:/w" }, "running")).toEqual({ stop: true, removeWorktree: false });
  });

  it("작업자 줄 — 역할 · 종류 · 턴 번호 · 도는 턴의 도구 · 거절 · 실효 인자 · 모델 · 경과", () => {
    const line = workerLine(w(), 2500, tr);
    expect(line).toMatchObject({
      roleName: "구현",
      kind: "write",
      cli: "claude",
      headless: true,
      turnNo: 2,
      turnRunning: true,
      lastTool: "Edit",
      denials: 1,
      model: "claude-sonnet-5-5",
      elapsedMs: 500,
    });
    expect(line.args).toBe(turnArgsSummary(args, tr));
    expect(line.args).toContain("restricted");
    expect(line.args).toContain(tr("orch.turn.args.rules", { n: 2 }));
    expect(line.args).toContain(tr("orch.turn.args.resume"));
    // 턴이 끝났으면 경과는 Attempt 전체 — idle 은 마지막 턴 끝에서 멈춘다(쉬는 동안 시계가 늘면 아직 일하는 것처럼 읽힌다)
    const idle = workerLine(w({ state: "idle", turns: [turn(1, "ok", { endedAt: 1500, lastTool: "Bash" })] }), 9000, tr);
    // 끝난 턴도 그 턴의 마지막 도구를 보인다(노트 위험 10 — 보고 끝난 턴 줄)
    expect(idle.lastTool).toBe("Bash");
    expect(idle.turnRunning).toBe(false);
    expect(idle.elapsedMs).toBe(1500 - w().startedAt);
    // 옛 검토자(역할 이름 없음) — "검토" · 판정형으로 짐작
    const old = workerLine({ id: "r", taskId: "t", cli: "codex", gen: 1, state: "exited", startedAt: 0, endedAt: 10, role: "reviewer" }, 99, tr);
    expect(old).toMatchObject({ roleName: tr("orch.attempt.role.reviewer"), kind: "judge", turnNo: 0, args: null });
    // 모르는 등급은 날 낱말
    expect(turnArgsSummary({ ...args, grade: "mystery" }, tr)).toContain("mystery");
  });

  it("턴 이력 — 새것이 위 · 결과 + 사유 · 시간 · 도구 · 거절", () => {
    const rows = turnRows(w({ turns: [turn(1, "failed", { reason: "no-result", endedAt: 4000, tools: 2, denials: 3, denialKinds: ["policy"] }), turn(2, "running")] }), tr);
    expect(rows.map((r) => r.n)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ outcome: "running", durationMs: null, bad: false });
    expect(rows[1]).toMatchObject({ text: `${tr("orch.turn.outcome.failed")} · no-result`, durationMs: 3000, tools: 2, denials: 3, bad: true });
    expect(turnRows({ turns: [turn(1, "weird")] }, tr)[0].text).toBe("weird");
  });

  it("blocked 띠 — idle + blocked 만 · 대화 끊김 · 닫힌 Attempt 는 없음 · 긴 need 는 줄인다", () => {
    expect(attemptBand(w({ state: "idle", blocked: { need: "need: cargo test", at: 5 } }))).toEqual({
      blocked: { need: "need: cargo test", at: 5 },
      broken: false,
    });
    expect(attemptBand(w({ state: "running", blocked: { need: "x", at: 5 } }))).toBeNull();
    expect(attemptBand(w({ state: "idle", conversationBroken: true }))).toEqual({ blocked: null, broken: true });
    expect(attemptBand(w({ state: "stopped", conversationBroken: true }))).toBeNull();
    expect(attemptNeedsHuman(w({ state: "idle", blocked: { need: "x", at: 1 } }))).toBe(true);
    expect(attemptNeedsHuman(w({ state: "idle" }))).toBe(false);
    const long = clipText("a ".repeat(200), 20);
    expect(long.clipped).toBe(true);
    expect([...long.short].length).toBe(20);
    expect(clipText("short")).toEqual({ short: "short", clipped: false });
  });
});

describe("저장 실패 띠(F7)", () => {
  it("실패 중일 때만 — 분류 낱말은 문구로, 모르는 낱말은 그대로 · 옛 서버(칸 없음)는 없음", () => {
    expect(persistBand(undefined, tr)).toBeNull();
    expect(persistBand({ ok: true, lastSavedSeq: 3, failing: null }, tr)).toBeNull();
    const b = persistBand({ ok: false, lastSavedSeq: 3, failing: { since: 1, reason: "disk-full", count: 2 } }, tr)!;
    expect(b.reason).toBe("disk-full");
    expect(b.text).toBe(tr("orch.persist.failing", { reason: tr("orch.persist.reason.disk-full") }));
    expect(persistBand({ ok: false, lastSavedSeq: null, failing: { since: 1, reason: "brand-new", count: 1 } }, tr)?.text).toContain("brand-new");
    for (const k of Object.keys(PERSIST_REASON_KEY)) {
      expect(translate("ko", PERSIST_REASON_KEY[k]), k).not.toBe(PERSIST_REASON_KEY[k]);
      expect(translate("en", PERSIST_REASON_KEY[k]), k).not.toBe(PERSIST_REASON_KEY[k]);
    }
  });
});

describe("맡기기 띠 · 역할 이력 · 수락 규칙 · 되돌림 · 면제(3b)", () => {
  const roles = [
    { id: "r-w", name: "구현", kind: "write" as const, cli: "claude" as const, usable: true },
    { id: "r-j", name: "검토", kind: "judge" as const, cli: "codex" as const, usable: true },
  ];



  it("거친 역할 — 이름 · 결과 문구 · 색", () => {
    const steps = roleSteps(
      {
        roleHistory: [
          { attemptId: "a1", role: "r-w", roleName: "구현", kind: "write", outcome: "success" },
          { attemptId: "a2", role: "r-j", roleName: "검토", kind: "judge", outcome: "changes-requested" },
          { attemptId: "a3", role: null, roleName: null, kind: "write", outcome: "idle" },
          { attemptId: "a4", role: "r-w", roleName: "구현", kind: "write", outcome: "blocked" },
        ],
      },
      tr,
    );
    expect(steps.map((s) => s.name)).toEqual(["구현", "검토", tr("orch.kind.write"), "구현"]);
    expect(steps.map((s) => s.tone)).toEqual(["good", "bad", "plain", "bad"]);
    expect(steps[1].text).toBe(tr("orch.verdict.changes-requested"));
    expect(steps[2].text).toBe(tr("orch.attempt.state.idle"));
    expect(roleSteps({}, tr)).toEqual([]);
  });

  it("판정 이력 — 역할 이름 · 시각순", () => {
    const d = {
      attempts: [{ id: "j1", roleName: "검토" }, { id: "j2" }] as AttemptView[],
      reviewReports: [
        { reviewId: "v2", attemptId: "j2", taskId: "t", reportId: "r", commitOid: "c", verdict: "pass" as const, findings: [], summary: "", at: 20, state: "current" as const },
        { reviewId: "v1", attemptId: "j1", taskId: "t", reportId: "r", commitOid: "c", verdict: "changes-requested" as const, findings: [], summary: "", at: 10, state: "stale" as const },
        { reviewId: "x", attemptId: "j1", taskId: "other", reportId: "r", commitOid: "c", verdict: "pass" as const, findings: [], summary: "", at: 5, state: "current" as const },
      ],
    };
    const rows = judgmentRows(d, "t", tr);
    expect(rows.map((r) => [r.reviewId, r.roleName, r.state])).toEqual([
      ["v1", "검토", "stale"],
      ["v2", tr("orch.attempt.role.reviewer"), "current"],
    ]);
  });

  it("수락 규칙 충족 — 규칙마다 have/need · 마지막 판정, 맡기기 없음 · 충족", () => {
    const unmet = readinessLine(
      { acceptReadiness: { ok: false, unmet: [{ rule: "judgment", role: "r-j", roleName: "검토", need: 2, have: 1, last: "changes-requested" }] } },
      tr,
    )!;
    expect(unmet.ok).toBe(false);
    expect(unmet.rules[0]).toMatchObject({ roleName: "검토", have: 1, need: 2, last: "changes-requested" });
    expect(unmet.rules[0].text).toBe(tr("orch.readiness.rule", { role: "검토", have: 1, need: 2, last: tr("orch.verdict.changes-requested") }));
    expect(readinessLine({ acceptReadiness: { ok: false, unmet: [{ rule: "judgment", role: "r-x", need: 1, have: 0, last: "none" }] } }, tr)!.rules[0].text).toContain(
      tr("orch.readiness.last.none"),
    );
    expect(readinessLine({ acceptReadiness: { ok: false, unmet: [], delegation: "not-active" } }, tr)).toMatchObject({ delegationOff: true });
    expect(readinessLine({ acceptReadiness: { ok: true, unmet: [] } }, tr)?.ok).toBe(true);
    expect(readinessLine({}, tr)).toBeNull();
  });

  it("사람 수락의 면제 문구 — 규칙 미충족 보고에만 · 수락된 산출물의 면제", () => {
    const unmetTask = { state: "reported" as const, acceptReadiness: { ok: false, unmet: [{ rule: "judgment", role: "r-j", need: 1, have: 0, last: "none" }] } };
    expect(waiverNoteNeeded(unmetTask)).toBe(true);
    expect(waiverNoteNeeded({ ...unmetTask, state: "accepted" })).toBe(false);
    expect(waiverNoteNeeded({ state: "reported", acceptReadiness: { ok: true, unmet: [] } })).toBe(false);
    expect(waiverNoteNeeded({ state: "reported", acceptReadiness: { ok: false, unmet: [], delegation: "not-active" } })).toBe(false);
    expect(waiverTexts([{ rule: "judgment", role: "r-j", roleName: "검토", need: 2, have: 1 }], tr)).toEqual([
      tr("orch.waived.rule", { role: "검토", have: 1, need: 2 }),
    ]);
    expect(waiverTexts([{ rule: "review", need: 1, have: 0 }], tr)).toEqual([tr("orch.reviewer.waived")]);
    // 원천 고르기 — Task 보기의 waived → 산출물의 waived → 옛 reviewWaivedBy
    const w1 = [{ rule: "judgment", role: "r-j", need: 1, have: 0 }];
    expect(acceptedWaivers({ waived: w1 }, { waived: [], reviewWaivedBy: null })).toBe(w1);
    expect(acceptedWaivers({}, { waived: w1 })).toBe(w1);
    expect(acceptedWaivers({}, { reviewWaivedBy: "human" })).toEqual([{ rule: "review", need: 1, have: 0 }]);
    expect(acceptedWaivers({}, null)).toEqual([]);
  });

  it("되돌림 used/max — 맡기기 없으면 —, 한도 넘음 표시", () => {
    expect(reworkText({ rework: { used: 1, max: 3 } }, tr)).toEqual({ text: tr("orch.rework", { used: 1, max: 3 }), atLimit: false });
    expect(reworkText({ rework: { used: 4, max: 3 } }, tr)?.atLimit).toBe(true);
    expect(reworkText({ rework: { used: 2, max: null } }, tr)?.text).toBe(tr("orch.rework", { used: 2, max: "—" }));
    expect(reworkText({ rework: { used: 0, max: null } }, tr)).toBeNull();
    expect(reworkText({}, tr)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3차 3b — 걷힌 것(작업자 타일 · 붙이기 · 손 놓기 · 돌려주기 · 복구 · 유지)을 부르는 글자가 프런트에 없다(소스 훑기)
// ---------------------------------------------------------------------------

describe("걷힌 것 참조 없음(3b)", () => {
  it("작업자 타일 · 붙이기 · 손 놓기 · 걷힌 Tauri 명령을 부르는 소스가 없다", async () => {
    const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    // 통째로 지운 파일
    for (const f of ["tile-release.ts", "tile-release.test.ts", "stream-roles.ts", "stream-roles.test.ts"]) {
      expect(existsSync(join("src/lib/orchestration", f)), f).toBe(false);
    }
    const banned = [
      "orchestration_return_control",
      "orchestration_recover",
      "orchestration_keep_worker",
      "WORKER_STARTED_EVENT",
      "isWorkerStream",
      "parseWorkerTag",
      "placeWorkerTile",
      "gotoWorkerTile",
      "gotoAttemptTile",
      "startOrchestrationWorkers",
      "adoptWorkerSessions",
      "noticeWorkerRelease",
      "confirmStopReleased",
      "handBackActions",
      "noteStreamCli",
      "runsNeedingHuman",
      "onPaneClosedByHuman",
      "stream-roles",
      "tile-release",
    ];
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte)$/.test(n) && !n.endsWith(".test.ts")) {
          const s = readFileSync(p, "utf8");
          for (const b of banned) if (s.includes(b)) hits.push(`${p}: ${b}`);
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});
