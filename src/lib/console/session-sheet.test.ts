import { describe, expect, it } from "vitest";
import type { SessionBoard, SessionCard } from "$lib/console/session-cards";
import { LONG_RUNNING_MS, runningSince, sheetBadge, sheetBuckets, sheetBucketsBy, sheetCounts } from "$lib/console/session-sheet";

// ---------------------------------------------------------------------------
// 세션 시트의 세 묶음 — 기다리는 것 · 오래 도는 것 · 조용함 (2026-10-07 대시보드 나누기).
// ---------------------------------------------------------------------------

const MIN = 60_000;
const NOW = 1_000 * MIN;

function card(over: Partial<SessionCard> & Pick<SessionCard, "key">): SessionCard {
  return {
    kind: "local",
    tabId: "t1",
    paneId: `pane-${over.key}`,
    state: "idle",
    agentStatus: null,
    subagents: 0,
    unseen: null,
    title: over.key,
    sub: null,
    code: over.key,
    ai: null,
    since: null,
    agentTime: null,
    command: "",
    commandShort: "",
    exit: null,
    running: false,
    ...over,
  };
}

function board(...cards: SessionCard[]): SessionBoard {
  return {
    groups: [
      { key: "local:", name: "로컬", local: true, address: null, meta: null, delegated: false, grants: null, cards },
    ],
    summary: { input: 0, fail: 0, running: 0, idle: 0, off: 0 },
    total: cards.length,
  };
}

const keys = (list: SessionCard[]) => list.map((c) => c.key);

describe("sheetBuckets — 무게 순서 세 묶음", () => {
  it("입력 대기 · 실패는 기다리는 것, 입력 대기가 먼저다", () => {
    const b = sheetBuckets(
      board(
        card({ key: "f", state: "fail", exit: 1 }),
        card({ key: "a", kind: "ai", state: "input", agentStatus: "permission" }),
        card({ key: "i", state: "idle" }),
      ),
      NOW,
    );
    expect(keys(b.waiting)).toEqual(["a", "f"]);
    expect(keys(b.quiet)).toEqual(["i"]);
    expect(b.total).toBe(3);
  });

  it("셸은 지금 블록이 10분을 넘겨 돌면 오래 도는 것, 짧으면 조용함", () => {
    const long = card({ key: "l", state: "running", running: true, since: NOW - LONG_RUNNING_MS - MIN });
    const short = card({ key: "s", state: "running", running: true, since: NOW - 2 * MIN });
    const b = sheetBuckets(board(long, short), NOW);
    expect(keys(b.long)).toEqual(["l"]);
    expect(keys(b.quiet)).toEqual(["s"]);
  });

  it("AI 는 지금 턴의 시작만 믿는다 — 턴 시각이 없으면 오래 돌아도 조용함", () => {
    const turn = card({
      key: "t",
      kind: "ai",
      state: "running",
      agentStatus: "running",
      since: NOW - 60 * MIN,
      agentTime: { kind: "turn", at: NOW - 15 * MIN },
    });
    const noTurn = card({
      key: "n",
      kind: "ai",
      state: "running",
      agentStatus: "running",
      since: NOW - 60 * MIN,
      agentTime: { kind: "active", at: NOW - MIN },
    });
    expect(runningSince(turn)).toBe(NOW - 15 * MIN);
    expect(runningSince(noTurn)).toBeNull();
    const b = sheetBuckets(board(turn, noTurn), NOW);
    expect(keys(b.long)).toEqual(["t"]);
    expect(keys(b.quiet)).toEqual(["n"]);
  });

  it("끊김 · 유휴는 조용함, 헤드리스(누를 타일이 없다)는 뺀다", () => {
    const b = sheetBuckets(
      board(
        card({ key: "o", state: "off" }),
        card({ key: "h", kind: "headless", tabId: null, paneId: null, state: "running", running: true, since: 0 }),
      ),
      NOW,
    );
    expect(keys(b.quiet)).toEqual(["o"]);
    expect(b.long).toEqual([]);
    expect(b.total).toBe(1);
  });

  it("묶음마다 에이전트 카드가 셸 카드보다 앞 — 같은 단은 판의 순서, 조용함도 접지 않고 다 든다", () => {
    const turnAt = NOW - LONG_RUNNING_MS - MIN;
    const b = sheetBuckets(
      board(
        card({ key: "s1", state: "idle" }),
        card({ key: "a1", kind: "ai", state: "idle" }),
        card({ key: "s2", state: "off" }),
        card({ key: "a2", kind: "ai", state: "running", agentStatus: "running", agentTime: { kind: "turn", at: NOW - MIN } }),
        card({ key: "ls", state: "running", running: true, since: turnAt }),
        card({ key: "la", kind: "ai", state: "running", agentStatus: "running", agentTime: { kind: "turn", at: turnAt } }),
        card({ key: "f", state: "fail", exit: 2 }),
        card({ key: "w", kind: "ai", state: "input", agentStatus: "finished" }),
      ),
      NOW,
    );
    expect(keys(b.waiting)).toEqual(["w", "f"]);
    expect(keys(b.long)).toEqual(["la", "ls"]);
    expect(keys(b.quiet)).toEqual(["a1", "a2", "s1", "s2"]);
    expect(b.total).toBe(8);
  });

  it("비어 있으면 셋 다 비고 수는 0", () => {
    expect(sheetBuckets(board(), NOW)).toEqual({ waiting: [], long: [], quiet: [], total: 0 });
  });
});

describe("sheetBucketsBy — 워크스페이스마다 세 묶음 (탭 줄 단추 · 목록)", () => {
  it("열쇠마다 같은 규칙으로 나누고, 열쇠가 없는 카드는 어디에도 들지 않는다", () => {
    const owner: Record<string, string> = { a: "ws1", f: "ws1", r: "ws2" };
    const by = sheetBucketsBy(
      board(
        card({ key: "a", kind: "ai", state: "input", agentStatus: "permission" }),
        card({ key: "f", state: "fail", exit: 1 }),
        card({ key: "r", state: "running", running: true, since: NOW - MIN }),
        card({ key: "x", state: "fail", exit: 1 }),
      ),
      (c) => owner[c.key] ?? null,
      NOW,
    );
    expect([...by.keys()].sort()).toEqual(["ws1", "ws2"]);
    expect(keys(by.get("ws1")!.waiting)).toEqual(["a", "f"]);
    expect(keys(by.get("ws2")!.quiet)).toEqual(["r"]);
    expect(by.get("ws2")!.total).toBe(1);
  });
});

describe("sheetBadge — 가장 급한 것 하나", () => {
  it("입력 대기가 하나라도 있으면 input, 수는 기다리는 것 전부(실패 포함)", () => {
    const b = sheetBuckets(
      board(card({ key: "a", kind: "ai", state: "input", agentStatus: "finished" }), card({ key: "f", state: "fail" })),
      NOW,
    );
    expect(sheetBadge(b)).toEqual({ kind: "input", n: 2 });
  });

  it("실패뿐이면 fail", () => {
    expect(sheetBadge(sheetBuckets(board(card({ key: "f", state: "fail" }), card({ key: "r", state: "running" })), NOW))).toEqual({
      kind: "fail",
      n: 1,
    });
  });

  it("기다리는 것이 없으면 도는 타일 수(오래 도는 것 포함)", () => {
    const b = sheetBuckets(
      board(
        card({ key: "r", state: "running", running: true, since: NOW - MIN }),
        card({ key: "l", state: "running", running: true, since: NOW - LONG_RUNNING_MS - MIN }),
        card({ key: "i", state: "idle" }),
      ),
      NOW,
    );
    expect(sheetBadge(b)).toEqual({ kind: "running", n: 2 });
  });

  it("유휴 · 끊김만 있으면 배지 없음", () => {
    expect(sheetBadge(sheetBuckets(board(card({ key: "i", state: "idle" }), card({ key: "o", state: "off" })), NOW))).toBeNull();
    expect(sheetBadge(sheetBuckets(board(), NOW))).toBeNull();
  });
});

describe("sheetCounts — 독 알림 칸의 세션 요약 줄 (2026-10-18)", () => {
  it("도는 것(오래 도는 것 포함)과 기다리는 것을 둘 다 센다", () => {
    const b = sheetBuckets(
      board(
        card({ key: "r", state: "running", running: true, since: NOW - MIN }),
        card({ key: "l", state: "running", running: true, since: NOW - LONG_RUNNING_MS - MIN }),
        card({ key: "f", state: "fail" }),
        card({ key: "i", state: "idle" }),
      ),
      NOW,
    );
    expect(sheetCounts(b)).toEqual({ running: 2, waiting: 1 });
  });

  it("빈 판은 둘 다 0", () => {
    expect(sheetCounts(sheetBuckets(board(), NOW))).toEqual({ running: 0, waiting: 0 });
  });
});
