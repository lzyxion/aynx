// 오케스트레이션 탭 ② 앨범 판의 순수 층(`model/album.ts`) — 트랙 글리프 · 지금 곡 · 사람 필요 사유 순서 · 참여 아티스트 ·
// 프로듀서 끝남 알림 문구(이미 멈춘 앨범) — 노트 2026-10-29-orchestration-player-tab 3-2 · 8절 단계 2.
import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import {
  albumArtists,
  needsHuman,
  noticeText,
  nowPlaying,
  toolWordKey,
  trackGlyph,
  trackRows,
  type AttemptView,
  type IntegrationJobView,
  type RunDetail,
  type TaskView,
  type TurnView,
} from "./model";

const tr = (key: Key, params?: Record<string, string | number>) => translate("ko", key, params);
const NOW = 1_000_000;

function task(id: string, state: TaskView["state"] = "active", extra: Partial<TaskView> = {}): TaskView {
  return { id, title: `T ${id}`, goal: "", dependsOn: [], version: 1, state, createdAt: 0, updatedAt: 0, ...extra };
}

function turn(n: number, outcome: string, startedAt = NOW - 60_000, extra: Partial<TurnView> = {}): TurnView {
  return { n, startedAt, outcome, endedAt: outcome === "running" ? null : startedAt + 1000, ...extra };
}

function att(id: string, taskId: string, extra: Partial<AttemptView> = {}): AttemptView {
  return { id, taskId, cli: "claude", gen: 1, state: "idle", startedAt: NOW - 120_000, kind: "write", roleName: "impl", turns: [], ...extra };
}

function run(tasks: TaskView[], attempts: AttemptView[], extra: Partial<RunDetail> = {}): RunDetail {
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

const awaiting = (taskId: string): IntegrationJobView => ({ jobId: "j", taskId, phase: "awaiting-approval", startedAt: 0, candidate: "c", old: "o" });

describe("트랙 글리프", () => {
  it("쓰기형 턴이 돌면 이퀄라이저 · 판정형만 돌면 보라 · 쉬면 번호", () => {
    const d = run(
      [task("a"), task("b", "reported"), task("c", "todo")],
      [
        att("w1", "a", { state: "running", turns: [turn(1, "running")] }),
        att("w2", "b", { state: "reported", turns: [turn(1, "ok")] }),
        att("j1", "b", { cli: "codex", kind: "judge", role: "reviewer", roleName: "review", state: "running", turns: [turn(1, "running")] }),
      ],
    );
    expect(d.tasks.map((x) => trackGlyph(d, x))).toEqual(["playing", "reviewing", "number"]);
  });

  it("막힘 · 충돌(사람) · 검증 실패는 ⏸, 검증 확인 대기는 시계 — 사람 필요가 도는 것보다 먼저", () => {
    const d = run(
      [
        task("a"),
        task("b", "conflict", { conflict: { jobId: "j", old: "o", reportCommit: "r", mergeBase: "m", entries: [], more: 0, needsHuman: true, at: 0 } }),
        task("c", "reported"),
      ],
      [
        att("w1", "a", { blocked: { need: "curl", at: 0 } }),
        att("w2", "c", { state: "reported" }),
        att("j", "c", { kind: "judge", role: "reviewer", state: "running", turns: [turn(1, "running")] }),
      ],
      { jobs: [awaiting("c")], verify: { command: "npm test", commandSha: "s", timeoutMinutes: 5, autoRun: false } },
    );
    expect(d.tasks.map((x) => trackGlyph(d, x))).toEqual(["attention", "attention", "waiting"]);
  });

  it("orphaned 는 도는 것으로 보지 않는다(번호)", () => {
    const d = run([task("a")], [att("w1", "a", { state: "running", turns: [turn(1, "running")] })], { state: "orphaned" });
    expect(trackGlyph(d, d.tasks[0])).toBe("number");
  });
});

describe("트랙 줄", () => {
  it("번호는 Task 순서 그대로 · 관문 단추 · 진행 단계 · 시간", () => {
    const d = run(
      [task("a"), task("b"), task("c", "accepted"), task("d", "reported")],
      [
        att("w1", "a", { state: "running", turns: [turn(2, "running", NOW - 15 * 60_000, { lastTool: "Edit", model: "sonnet" })] }),
        att("w2", "b", { blocked: { need: "net", at: 0 } }),
        att("w3", "c", { state: "reported", endedAt: NOW - 1000 }),
        att("w4", "d", { state: "reported" }),
      ],
      {
        accepted: [{ taskId: "c", attemptId: "w3", reportId: "r", commitOid: "abc", reviewer: "human", verification: null, acceptedAt: 0 }],
        jobs: [awaiting("d")],
        verify: { command: "npm test", commandSha: "s", timeoutMinutes: 5, autoRun: false },
      },
    );
    const rows = trackRows(d, NOW);
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.gate)).toEqual([null, "permissions", null, "verify"]);
    expect(rows.map((r) => r.tone)).toEqual(["playing", "attention", "done", "waiting"]);
    expect(rows[0].statusKey).toBe("orch.track.status.playing");
    expect([rows[0].turnNo, rows[0].lastTool, rows[0].model]).toEqual([2, "Edit", "sonnet"]);
    // 턴 시한 30분의 절반 — 작업 칸(0.15 ~ 0.55)의 가운데
    expect(rows[0].progress).toBeCloseTo(0.35, 5);
    expect(rows[2].progress).toBe(1);
    expect(rows[1].blockedNeed).toBe("net");
    expect(rows[2].timeMs).toBe(120_000 - 1000);
    // 할 일(Attempt 없음)은 시간이 없다
    expect(trackRows(run([task("x", "todo")], []), NOW)[0].timeMs).toBeNull();
  });
});

describe("지금 곡", () => {
  it("도는 쓰기형 중 마지막으로 시작한 턴 · 없으면 판정형 · 없으면 null", () => {
    const d = run(
      [task("a"), task("b")],
      [
        att("w1", "a", { state: "running", turns: [turn(1, "running", NOW - 100)] }),
        att("w2", "b", { state: "running", turns: [turn(3, "running", NOW - 10, { lastTool: "Bash" })] }),
      ],
    );
    const p = nowPlaying(d);
    expect([p?.attempt.id, p?.no, p?.kind, p?.tool]).toEqual(["w2", 2, "write", "Bash"]);
    const j = run([task("a")], [att("j", "a", { kind: "judge", role: "reviewer", state: "running", turns: [turn(1, "running")] })]);
    expect(nowPlaying(j)?.kind).toBe("judge");
    expect(nowPlaying(run([task("a")], [att("w", "a")]))).toBeNull();
  });
});

describe("사람 필요", () => {
  it("앨범 단위(보류 → 프로듀서 없음) 먼저, 그다음 트랙 순서", () => {
    const d = run(
      [task("a"), task("b"), task("c", "reported")],
      [att("w1", "b", { blocked: { need: "x", at: 0 } }), att("w2", "c", { state: "reported" })],
      {
        state: "paused",
        coordinatorAttached: false,
        jobs: [awaiting("c")],
        verify: { command: "t", commandSha: "s", timeoutMinutes: 5, autoRun: false },
      },
    );
    expect(needsHuman(d)).toEqual([
      { kind: "no-producer", taskId: null },
      { kind: "blocked", taskId: "b" },
      { kind: "verify", taskId: "c" },
    ]);
    const held = { ...d, hold: { reason: "persist-failed" as const, at: 0 } };
    expect(needsHuman(held)[0]).toEqual({ kind: "hold", taskId: null });
    expect(needsHuman(held).some((n) => n.kind === "no-producer")).toBe(false);
  });

  it("끝난 앨범은 없음 · orphaned 는 기록만 하나", () => {
    expect(needsHuman(run([task("a")], [att("w", "a", { blocked: { need: "x", at: 0 } })], { state: "done" }))).toEqual([]);
    expect(needsHuman(run([task("a")], [], { state: "orphaned" }))).toEqual([{ kind: "orphaned", taskId: null }]);
  });
});

describe("참여 아티스트", () => {
  it("Attempt 의 CLI 마다 역할(등장 순서 · 겹침 없음), 없으면 라인업", () => {
    const d = run(
      [task("a")],
      [
        att("1", "a", { cli: "claude", roleName: "impl" }),
        att("2", "a", { cli: "codex", roleName: "fixer" }),
        att("3", "a", { cli: "codex", kind: "judge", role: "reviewer", roleName: "review" }),
        att("4", "a", { cli: "claude", roleName: "impl" }),
      ],
    );
    expect(albumArtists(d)).toEqual([
      { cli: "claude", roles: ["impl"] },
      { cli: "codex", roles: ["fixer", "review"] },
    ]);
    const lineup = run([], [], { roles: [{ id: "i", name: "impl", kind: "write", cli: "codex", usable: true }] });
    expect(albumArtists(lineup)).toEqual([{ cli: "codex", roles: ["impl"] }]);
  });
});

describe("프로듀서 끝남 알림", () => {
  it("이미 멈춘 앨범이면 '이미 멈춰 있었다' 문구", () => {
    const base = { kind: "coordinator-exited", runName: "앨범", taskTitle: null, attemptId: null };
    expect(noticeText(base, tr)).toContain("멈췄습니다");
    const paused = noticeText({ ...base, detail: "already-paused" }, tr);
    expect(paused).toContain("이미 멈춰");
    expect(paused).not.toContain("멈췄습니다");
  });
});

describe("재생 막대 · 트랙 줄의 도구 낱말(실기 10-31)", () => {
  it("Codex 항목 종류 넷은 두 언어 사람 낱말, 그 밖(Claude 도구)은 원문", () => {
    for (const tool of ["command_execution", "file_change", "mcp_tool_call", "web_search"]) {
      const key = toolWordKey(tool);
      expect(key, tool).not.toBeNull();
      expect(translate("ko", key as Key)).not.toBe(key);
      expect(translate("en", key as Key)).not.toBe(key);
      expect(translate("ko", key as Key)).not.toContain("_");
    }
    expect(toolWordKey("Edit src/log.rs")).toBeNull();
  });
});
