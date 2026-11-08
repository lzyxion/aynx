// 오케스트레이션 탭 ③ 작업자 상세의 순수 층(`model/lyrics.ts`) — 끝 쪽 이어 붙임 · 같은 줄 건너뜀 · 거절 · 사람(프로듀서) 말 · 턴/보고 줄 끼우기 ·
// 필터 · 지금 하는 일 · 턴 목록 · 턴 시한 · 파일 줄 · 이웃 아티스트 · 부제 — 노트 2026-10-29-orchestration-player-tab 3-3 · 8절 단계 3.
import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import type { TranscriptItem } from "$lib/context";
import {
  artistNeighbors,
  artistQueue,
  artistSubline,
  fileRows,
  filterLyrics,
  lyricLines,
  lyricStep,
  mergeTail,
  nowDoing,
  turnClock,
  turnList,
  workerLine,
  type AttemptView,
  type ReportView,
  type RunDetail,
  type TaskView,
  type TurnView,
} from "./model";

const tr = (key: Key, params?: Record<string, string | number>) => translate("ko", key, params);
const NOW = 10_000_000;

function say(text: string, at: number): TranscriptItem {
  return { role: "assistant", text, truncated: false, images: 0, tool: null, at };
}
function ask(text: string, at: number): TranscriptItem {
  return { role: "user", text, truncated: false, images: 0, tool: null, at };
}
function tool(name: string, summary: string, at: number, extra: Partial<NonNullable<TranscriptItem["tool"]>> = {}): TranscriptItem {
  return {
    role: "tool",
    text: null,
    truncated: false,
    images: 0,
    at,
    tool: { name, summary, input: `{"x":"${summary}"}`, inputTruncated: false, output: "ok", outputTruncated: false, error: false, ...extra },
  };
}
function turn(n: number, outcome: string, startedAt: number, extra: Partial<TurnView> = {}): TurnView {
  return { n, startedAt, outcome, endedAt: outcome === "running" ? null : startedAt + 60_000, ...extra };
}
function att(id: string, taskId: string, extra: Partial<AttemptView> = {}): AttemptView {
  return { id, taskId, cli: "claude", gen: 1, state: "idle", startedAt: NOW - 600_000, kind: "write", roleName: "impl", turns: [], ...extra };
}
function task(id: string, extra: Partial<TaskView> = {}): TaskView {
  return { id, title: `T ${id}`, goal: "", dependsOn: [], version: 1, state: "active", createdAt: 0, updatedAt: 0, ...extra };
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

describe("끝 쪽 이어 붙임(mergeTail)", () => {
  const a = say("a", 1);
  const b = tool("Read", "x.rs", 2, { output: null });
  const c = say("c", 3);
  const d = tool("Edit", "x.rs", 4);

  it("겹치는 구간은 새 쪽으로 갈아 끼우고 같은 줄을 두 번 싣지 않는다(진행 중 도구가 결과를 받아도 한 줄)", () => {
    const done = { ...b, tool: { ...b.tool!, output: "done" } };
    const m = mergeTail([a, b], [done, c]);
    expect(m.map((x) => x.text ?? x.tool?.name)).toEqual(["a", "Read", "c"]);
    expect(m[1].tool?.output).toBe("done");
  });

  it("쪽이 앞으로 밀려도(옛 줄이 새 쪽 밖) 옛 머리를 지킨다", () => {
    expect(mergeTail([a, b, c], [c, d]).map((x) => x.at)).toEqual([1, 2, 3, 4]);
  });

  it("겹침이 없으면 — 새 쪽이 뒤면 이어 붙이고, 앞이면(파일이 바뀜) 새 쪽만", () => {
    expect(mergeTail([a, b], [c, d]).map((x) => x.at)).toEqual([1, 2, 3, 4]);
    expect(mergeTail([c, d], [a, b]).map((x) => x.at)).toEqual([1, 2]);
  });

  it("빈 새 쪽은 옛 줄 그대로 · 상한은 끝에서", () => {
    expect(mergeTail([a, b], [])).toEqual([a, b]);
    const many = Array.from({ length: 10 }, (_, i) => say(`s${i}`, i));
    expect(mergeTail([], many, 4).map((x) => x.text)).toEqual(["s6", "s7", "s8", "s9"]);
  });

  it("같은 열쇠가 두 번 있어도 겹침 전체가 맞는 자리에서만 잇는다", () => {
    const r1 = say("ok", 5);
    const r2 = say("ok", 5);
    const m = mergeTail([r1, a, r2, c], [r2, c, d]);
    expect(m.map((x) => x.text ?? x.tool?.name)).toEqual(["ok", "a", "ok", "c", "Edit"]);
  });
});

describe("가사 줄(lyricLines)", () => {
  const T0 = NOW - 300_000;
  const items = [
    ask("[aynx] 로그 회전을 추가해 주세요", T0 + 1_000),
    tool("Read", "src/log.rs", T0 + 10_000),
    say("회전은 크기 기준으로 하겠습니다.", T0 + 20_000),
    tool("Bash", "cargo fmt", T0 + 30_000, { denied: true, output: null }),
    tool("Edit", "src/log.rs", T0 + 40_000, { error: true }),
    { role: "interrupted", text: null, truncated: false, images: 0, tool: null, at: null } as TranscriptItem,
  ];
  const a = att("w", "t", { turns: [turn(1, "ok", T0, { endedAt: T0 + 100_000 })], blocked: { need: "네트워크 필요", at: T0 + 110_000 } });
  const reports: ReportView[] = [
    { reportId: "p", attemptId: "w", taskId: "t", outcome: "success", summary: "끝냈습니다", dirty: false, changedFiles: [], at: T0 + 90_000, late: false },
    { reportId: "q", attemptId: "other", taskId: "t", outcome: "success", summary: "남의 보고", dirty: false, changedFiles: [], at: T0 + 95_000, late: false },
  ];
  const lines = lyricLines(items, a, reports, tr);

  it("턴 시작 → 지시 → 도구 · 말 · 거절 · 오류 → 보고 → 턴 끝 → 막힘 — 시각 순 · 남의 보고는 없다", () => {
    expect(lines.map((l) => l.kind)).toEqual(["turn", "prompt", "tool", "say", "denied", "tool", "interrupted", "report", "end", "report"]);
    expect(lines[0].text).toBe(tr("orch.lyric.turnStart", { n: 1 }));
    expect(lines[1].text).toContain("로그 회전");
    expect(lines[2].text).toBe("Read src/log.rs");
    expect(lines[3].text).toBe("“회전은 크기 기준으로 하겠습니다.”");
    expect(lines[4].text).toBe(tr("orch.lyric.denied", { tool: "Bash cargo fmt" }));
    expect(lines[5].error).toBe(true);
    expect(lines[6].at).toBe(T0 + 40_000);
    expect(lines[7].text).toContain("끝냈습니다");
    expect(lines.some((l) => l.text.includes("남의 보고"))).toBe(false);
    expect(lines[9].text).toContain("네트워크 필요");
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("필터 — 도구만(도구 · 거절) · 말만(말 · 지시)", () => {
    expect(filterLyrics(lines, "tools").map((l) => l.kind)).toEqual(["tool", "denied", "tool"]);
    expect(filterLyrics(lines, "says").map((l) => l.kind)).toEqual(["prompt", "say"]);
    expect(filterLyrics(lines, "all")).toHaveLength(lines.length);
  });

  it("계단 — 마지막 줄 0 · 멀수록 커지고 4에서 멈춘다", () => {
    expect([0, 5, 6, 7, 8, 9].map((i) => lyricStep(i, 10))).toEqual([4, 4, 3, 2, 1, 0]);
  });

  it("해석 숫자를 짓지 않는다 — 도구 줄은 이름 + 대상 요약뿐", () => {
    expect(lines.filter((l) => l.kind === "tool").every((l) => !/[+−-]\d/.test(l.text))).toBe(true);
  });
});

describe("지금 하는 일 · 턴 목록 · 턴 시한", () => {
  const T0 = NOW - 120_000;
  const running = att("w", "t", {
    state: "running",
    turns: [turn(1, "ok", NOW - 900_000), turn(2, "running", T0, { lastTool: "Edit", tools: 5, args: { cli: "claude", grade: "edit", settingsControl: "restricted", turnMinutes: 20 } })],
  });
  const items = [ask("첫 일", NOW - 899_000), ask("이어서 시험을 더해 주세요", T0 + 500), tool("Edit", "src/a.rs", NOW - 14_000, { output: null })];
  const lines = lyricLines(items, running, [], tr);

  it("결과를 기다리는 도구와 경과 — 없으면 턴 기록의 마지막 도구", () => {
    expect(nowDoing(lines, running, NOW)).toEqual({ text: "Edit src/a.rs", sinceMs: 14_000 });
    const noTool = lyricLines(items.slice(0, 2), running, [], tr);
    expect(nowDoing(noTool, running, NOW)).toEqual({ text: "Edit", sinceMs: null });
    expect(nowDoing(lines, att("i", "t", { turns: [turn(1, "ok", T0)] }), NOW)).toBeNull();
  });

  it("턴 목록 — 그 턴 무렵의 지시 요약 · 도는 턴은 지금까지 · 지시가 없으면 첫/이어지는 지시", () => {
    const rows = turnList(running, items, NOW, tr);
    expect(rows.map((r) => [r.n, r.prompt, r.running])).toEqual([
      [1, "첫 일", false],
      [2, "이어서 시험을 더해 주세요", true],
    ]);
    expect(rows[1].durationMs).toBe(120_000);
    expect(turnList(running, [], NOW, tr).map((r) => r.prompt)).toEqual([tr("orch.artist.turn.first"), tr("orch.artist.turn.next")]);
  });

  it("턴 시한 = 그 턴이 받은 실효 시한(없으면 Run 한도)", () => {
    const d = run([task("t")], [running]);
    expect(turnClock(running, d, NOW)).toEqual({ elapsedMs: 120_000, limitMs: 20 * 60_000, ratio: 0.1 });
    const old = att("o", "t", { state: "running", turns: [turn(1, "running", T0)] });
    expect(turnClock(old, d, NOW)?.limitMs).toBe(30 * 60_000);
    expect(turnClock(att("i", "t"), d, NOW)).toBeNull();
  });

  it("끝난 턴 줄에도 마지막 도구가 보인다(노트 위험 10)", () => {
    const reported = att("r", "t", { state: "reported", turns: [turn(1, "ok", T0, { lastTool: "Bash" })] });
    expect(workerLine(reported, NOW, tr).lastTool).toBe("Bash");
  });
});

describe("파일 줄 · 이웃 · 부제", () => {
  it("상태 글자 · +/− · 미커밋 · 새 파일 · 바이너리", () => {
    const rows = fileRows([
      { path: "a.rs", status: "modified", adds: 3, dels: 1, binary: false, uncommitted: true },
      { path: "n.rs", status: "added", adds: null, dels: null, binary: false, uncommitted: true, untracked: true },
      { path: "b.png", status: "added", adds: null, dels: null, binary: true },
      { path: "g.rs", status: "deleted", adds: 0, dels: 9, binary: false },
      { path: "w", status: "unknown", adds: null, dels: null, binary: false },
    ]);
    expect(rows.map((r) => [r.letter, r.adds, r.dels, r.uncommitted, r.untracked, r.binary])).toEqual([
      ["M", 3, 1, true, false, false],
      ["A", null, null, true, true, false],
      ["A", null, null, false, false, true],
      ["D", 0, 9, false, false, false],
      ["?", null, null, false, false, false],
    ]);
  });

  it("아티스트 줄 — 트랙 순서의 쓰기형 · 판정형, 끝에서 이웃 없음, 옛 시도는 같은 트랙 자리", () => {
    const d = run(
      [task("t1", { currentAttempt: "w1" }), task("t2", { currentAttempt: "w2" })],
      [
        att("old", "t1"),
        att("w1", "t1"),
        att("j1", "t1", { cli: "codex", kind: "judge", role: "reviewer", roleName: "review", state: "running", turns: [turn(1, "running", NOW)] }),
        att("w2", "t2", { cli: "codex", roleName: "fixer" }),
      ],
    );
    expect(artistQueue(d).map((x) => [x.attempt.id, x.no])).toEqual([
      ["w1", 1],
      ["j1", 1],
      ["w2", 2],
    ]);
    const mid = artistNeighbors(d, "j1");
    expect([mid.prev?.attempt.id, mid.next?.attempt.id]).toEqual(["w1", "w2"]);
    expect(artistNeighbors(d, "w1").prev).toBeNull();
    expect(artistNeighbors(d, "w2").next).toBeNull();
    expect(artistNeighbors(d, "old").next?.attempt.id).toBe("w1");
  });

  it("부제 — 종류 · 모델 · 강도 · 권한 · 턴(서버 칸만)", () => {
    const a = att("w", "t", { turns: [turn(2, "running", NOW, { model: "sonnet", args: { cli: "claude", grade: "edit", settingsControl: "restricted", effort: "high" } })] });
    expect(artistSubline(a, { roles: [] }, tr)).toEqual([
      tr("orch.kind.write"),
      "sonnet",
      tr("orch.artist.effort", { effort: "high" }),
      tr("orch.artist.grade", { grade: tr("orch.grade.edit") }),
      tr("orch.turn.no", { n: 2 }),
    ]);
    const judge = att("j", "t", { kind: "judge", role: "reviewer", roleId: "review", turns: [] });
    expect(artistSubline(judge, { roles: [{ id: "review", name: "review", kind: "judge", cli: "codex", model: "gpt", usable: true, permission: "read-only" }] }, tr)).toEqual([
      tr("orch.kind.judge"),
      "gpt",
      tr("orch.artist.grade", { grade: "read-only" }),
    ]);
  });
});
