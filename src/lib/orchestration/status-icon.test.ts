// 상태 아이콘의 순수 층(`model/status-icon.ts` — 2026-10-30 실기 다듬기): 트랙 줄 · 앨범 머리 · 라이브러리 카드의 상태 낱말 앞 그림.
import { describe, expect, it } from "vitest";
import { statusTone } from "./model/status-icon";
import {
  albumStatusIcon,
  cardStatusIcon,
  detailStatusIcon,
  summaryStatusIcon,
  trackRows,
  trackStatusIcon,
  type AttemptView,
  type RunDetail,
  type RunSummary,
  type TaskView,
  type TurnView,
} from "./model";

const NOW = 1_000_000;

function task(id: string, state: TaskView["state"] = "active"): TaskView {
  return { id, title: `T ${id}`, goal: "", dependsOn: [], version: 1, state, createdAt: 0, updatedAt: 0 };
}
function turn(n: number, outcome: string): TurnView {
  return { n, startedAt: NOW - 60_000, outcome, endedAt: outcome === "running" ? null : NOW - 59_000 };
}
function att(id: string, taskId: string, extra: Partial<AttemptView> = {}): AttemptView {
  return { id, taskId, cli: "claude", gen: 1, state: "idle", startedAt: NOW - 120_000, kind: "write", roleName: "impl", turns: [], ...extra };
}
function detail(tasks: TaskView[], attempts: AttemptView[], extra: Partial<RunDetail> = {}): RunDetail {
  return {
    runId: "r",
    name: "앨범",
    state: "running",
    gen: 1,
    createdAt: 0,
    updatedAt: 0,
    repo: "C:/w",
    worktreeDir: "",
    limits: {
      maxTasks: 10,
      maxCallsPerMinute: 30,
      maxWaiters: 2,
      coordinationMinutes: 120,
      executionGraceMinutes: 30,
      maxConcurrentWorkers: 3,
      maxTotalWorkers: 6,
      maxDeliveries: 10,
      turnMinutes: 30,
    },
    coordinationDeadlineAt: 0,
    executionDeadlineAt: 0,
    tasks,
    attempts,
    remaining: { tasks: 1, callsThisMinute: 1, concurrentWorkers: 1, totalWorkers: 1, coordinationSeconds: 0, executionSeconds: 0 },
    latestSeq: 1,
    coordinatorAttached: true,
    coordinatorChat: null,
    origin: { by: "human" },
    ...extra,
  };
}
function summary(extra: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "r",
    name: "r",
    state: "running",
    orphaned: false,
    gen: 1,
    createdAt: 0,
    updatedAt: 0,
    repo: "C:/w",
    latestSeq: 1,
    taskCount: 0,
    taskStates: {},
    attemptCount: 0,
    coordinatorAttached: true,
    origin: { by: "ai", producer: "pc-1" },
    running: { write: 0, judge: 0 },
    hold: null,
    adoptable: { restore: false, autoResume: false, why: "running" },
    coordinatorChat: "pc-1",
    producers: ["pc-1"],
    wake: null,
    ...extra,
  };
}

describe("trackStatusIcon", () => {
  it("사람 필요 까닭이 먼저 — 막힘 = 경고 · 충돌 · 검증 실패 = 실패 · 검증 확인 = 시계", () => {
    const row = (need: string | null, glyph = "number", state = "active") => ({ need, glyph, task: { state } }) as Parameters<typeof trackStatusIcon>[0];
    expect(trackStatusIcon(row("blocked", "attention"))).toBe("attention");
    expect(trackStatusIcon(row("stuck", "attention"))).toBe("attention");
    expect(trackStatusIcon(row("conflict", "attention", "conflict"))).toBe("failed");
    expect(trackStatusIcon(row("verify-failed", "attention"))).toBe("failed");
    expect(trackStatusIcon(row("verify", "waiting", "reported"))).toBe("waiting");
  });

  it("도는 것 · Task 상태 — 재생 · 검토 · 수락 · 반려 · 취소 · 보고됨 · 할 일", () => {
    const row = (glyph: string, state: string) => ({ need: null, glyph, task: { state } }) as Parameters<typeof trackStatusIcon>[0];
    expect(trackStatusIcon(row("playing", "active"))).toBe("playing");
    expect(trackStatusIcon(row("reviewing", "reported"))).toBe("reviewing");
    expect(trackStatusIcon(row("number", "accepted"))).toBe("done");
    expect(trackStatusIcon(row("number", "rejected"))).toBe("failed");
    expect(trackStatusIcon(row("number", "cancelled"))).toBe("stopped");
    expect(trackStatusIcon(row("number", "reported"))).toBe("waiting");
    expect(trackStatusIcon(row("number", "integrating"))).toBe("waiting");
    expect(trackStatusIcon(row("number", "todo"))).toBe("idle");
    expect(trackStatusIcon(row("number", "active"))).toBe("idle");
  });

  it("trackRows 의 줄을 그대로 받는다(막힌 아티스트 · 도는 턴)", () => {
    const d = detail(
      [task("a"), task("b")],
      [att("w1", "a", { state: "running", turns: [turn(1, "running")] }), att("w2", "b", { blocked: { need: "curl", at: 0 } as AttemptView["blocked"] })],
    );
    expect(trackRows(d, NOW).map(trackStatusIcon)).toEqual(["playing", "attention"]);
  });
});

describe("albumStatusIcon", () => {
  const quiet = { write: 0, judge: 0, attention: false };
  it("끝 · 중단 · 읽기 전용 · 조율 멈춤은 상태 그대로", () => {
    expect(albumStatusIcon("done", quiet)).toBe("done");
    expect(albumStatusIcon("stopped", quiet)).toBe("stopped");
    expect(albumStatusIcon("stopping", { ...quiet, write: 2 })).toBe("stopped");
    expect(albumStatusIcon("orphaned", quiet)).toBe("stopped");
    // 조율 멈춤 — 아티스트가 계속 돌아도 · 사람이 필요해도 멈춤 그림
    expect(albumStatusIcon("paused", { write: 1, judge: 0, attention: true })).toBe("paused");
  });

  it("진행 중 — 사람 필요 → 쓰기형 → 판정형 → 쉼", () => {
    expect(albumStatusIcon("running", { write: 1, judge: 1, attention: true })).toBe("attention");
    expect(albumStatusIcon("running", { write: 1, judge: 1, attention: false })).toBe("playing");
    expect(albumStatusIcon("running", { write: 0, judge: 1, attention: false })).toBe("reviewing");
    expect(albumStatusIcon("running", quiet)).toBe("idle");
  });

  it("상세 · 요약 · 카드", () => {
    expect(detailStatusIcon(detail([task("a")], [att("w", "a", { state: "running", turns: [turn(1, "running")] })]))).toBe("playing");
    expect(detailStatusIcon(detail([task("a", "reported")], [att("j", "a", { kind: "judge", role: "reviewer", state: "running", turns: [turn(1, "running")] })]))).toBe(
      "reviewing",
    );
    expect(detailStatusIcon(detail([task("a")], [], { state: "paused" }))).toBe("paused");
    expect(summaryStatusIcon(summary({ running: { write: 1, judge: 0 }, blocked: 1 }))).toBe("attention");
    expect(summaryStatusIcon(summary({ running: { write: 0, judge: 1 } }))).toBe("reviewing");
    expect(cardStatusIcon("playing", summary({ running: { write: 2, judge: 0 } }))).toBe("playing");
    expect(cardStatusIcon("orphan", summary({ state: "paused" }))).toBe("paused");
    expect(cardStatusIcon("reattach", summary({ state: "paused" }))).toBe("paused");
  });
});

describe("표지 카드 상태 아이콘의 면 색", () => {
  it("그림의 색 갈래와 같다", () => {
    expect(statusTone("playing")).toBe("accent");
    expect(statusTone("reviewing")).toBe("accent");
    expect(statusTone("waiting")).toBe("accent");
    expect(statusTone("paused")).toBe("warn");
    expect(statusTone("attention")).toBe("warn");
    expect(statusTone("done")).toBe("ok");
    expect(statusTone("failed")).toBe("err");
    expect(statusTone("stopped")).toBe("mute");
    expect(statusTone("idle")).toBe("mute");
  });
});
