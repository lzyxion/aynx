import { describe, expect, it } from "vitest";
import { buildRows, type ConsoleRow, type ConsoleRowInput } from "$lib/console/console-rows";
import { groupSessions, type GroupInput } from "$lib/console/host-groups";
import { buildSessionCards, cardStateOf, type SessionCardInput } from "$lib/console/session-cards";
import type { ConsoleSession } from "$lib/console/delegation-rows";
import type { AgentTileInput } from "$lib/agent-board";
import { emptyAgentSignals, type AgentSignals, type AgentStatus } from "$lib/agent-status";
import type { DelegationGrants } from "$lib/delegation";

// ---------------------------------------------------------------------------
// 대시보드 세션 칸 — **타일마다 카드 한 장** (docs/log/2026-09-28-dashboard-session-cards.md).
// AI · 셸 합치기 · 묶음 안 순서 · 로컬 먼저 · 헤드리스 점선 카드 · 다른 창 빼기 · 요약 수.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const NOW = 1_000 * MIN;

function tile(over: Partial<ConsoleRowInput> & Pick<ConsoleRowInput, "streamId">): ConsoleRow {
  const input: ConsoleRowInput = {
    tabId: "t1",
    paneId: `pane-${over.streamId}`,
    attention: null,
    code: over.streamId,
    label: over.streamId,
    status: null,
    connected: true,
    lastCommand: null,
    exit: null,
    kind: "local",
    ...over,
  };
  return buildRows([input])[0];
}

function session(over: Partial<ConsoleSession> & Pick<ConsoleSession, "id">): ConsoleSession {
  return {
    code: over.id,
    label: over.id,
    kind: "ssh",
    status: null,
    running: false,
    lastExit: null,
    commands: 0,
    connected: true,
    dropped: false,
    lastCommand: null,
    ...over,
  };
}

const sig = (over: Partial<AgentSignals> = {}): AgentSignals => ({ ...emptyAgentSignals(), ...over });

function agent(paneId: string, status: AgentStatus | null, over: Partial<AgentTileInput> = {}): [string, AgentTileInput] {
  return [
    paneId,
    {
      paneId,
      status,
      signals: null,
      turnStartedAt: null,
      place: { project: null, worktree: null },
      tabTitle: "탭",
      ai: "claude",
      ...over,
    },
  ];
}

const GRANTS: DelegationGrants = { connect: true, read: true, propose: true, auto_execute: false, vault_passphrase: false };

function board(
  group: Partial<GroupInput>,
  rest: Partial<Omit<SessionCardInput, "groups">> = {},
) {
  const groups = groupSessions({
    rows: [],
    sessions: [],
    delegations: new Map(),
    runningTargets: new Set(),
    commandByTarget: new Map(),
    metas: new Map(),
    users: new Map(),
    windowLabel: "main",
    localName: "로컬",
    ...group,
  });
  const rows = group.rows ?? [];
  return buildSessionCards({
    groups,
    agents: new Map(),
    order: new Map(rows.map((r, i) => [r.paneId, i])),
    cwds: new Map(),
    addresses: new Map(),
    ...rest,
  });
}

describe("buildSessionCards — AI 타일과 셸 타일이 한 틀", () => {
  it("AI 타일은 AI 카드(프로젝트 · 워크트리 · 로고), 셸은 셸 이름 · 폴더", () => {
    const b = board(
      { rows: [tile({ streamId: "a", label: "PowerShell" }), tile({ streamId: "s", label: "PowerShell" })] },
      {
        agents: new Map([agent("pane-a", "running", { place: { project: "aynx", worktree: "feat-design" }, ai: "codex" })]),
        cwds: new Map([["pane-s", "~/src/dotfiles"]]),
      },
    );
    expect(b.groups).toHaveLength(1);
    const [ai, sh] = b.groups[0].cards;
    expect([ai.kind, ai.title, ai.sub, ai.ai, ai.state]).toEqual(["ai", "aynx", "feat-design", "codex", "running"]);
    expect([sh.kind, sh.title, sh.sub, sh.ai, sh.agentStatus]).toEqual(["local", "PowerShell", "~/src/dotfiles", null, null]);
  });

  it("AI 상태 → 카드 상태: 대기=입력 대기 · 끝남+실패=실패 · 미상=유휴 · 끊김이 이긴다", () => {
    const b = board(
      {
        rows: [
          tile({ streamId: "w" }),
          tile({ streamId: "d", status: "fail" }),
          tile({ streamId: "u", status: "running" }),
          tile({ streamId: "x", connected: false }),
        ],
      },
      {
        agents: new Map([
          agent("pane-w", "permission"),
          agent("pane-d", "finished"),
          agent("pane-u", null),
          agent("pane-x", "permission"),
        ]),
      },
    );
    const state = Object.fromEntries(b.groups[0].cards.map((c) => [c.key, c.state]));
    // 점이 없는 AI 타일은 셸의 상태(실패 · 작업 중)를 빌리지 않고 유휴다 — 셸에게 `claude` 는 늘 도는 명령이다
    expect(state).toEqual({ w: "input", d: "input", u: "idle", x: "off" });
    const status = Object.fromEntries(b.groups[0].cards.map((c) => [c.key, c.agentStatus]));
    expect(status).toEqual({ w: "permission", d: "finished", u: null, x: null });
  });

  it("SSH 셸은 `계정@호스트`, 계정을 모르면 별칭 · 머리줄에 주소", () => {
    const b = board(
      {
        rows: [tile({ streamId: "s1", kind: "ssh", alias: "dev-01", label: "dev-01" })],
        users: new Map([["dev-01", "deploy"]]),
      },
      { addresses: new Map([["dev-01", "deploy@dev-01.internal"]]) },
    );
    expect(b.groups[0].cards[0].title).toBe("deploy@dev-01");
    expect(b.groups[0].address).toBe("deploy@dev-01.internal");
    const bare = board({ rows: [tile({ streamId: "s1", kind: "ssh", alias: "dev-01", label: "dev-01" })] });
    expect(bare.groups[0].cards[0].title).toBe("dev-01");
  });

  it("AI 카드의 시각은 상태에 맞는 신호, 셸은 마지막 활동", () => {
    const b = board(
      { rows: [tile({ streamId: "a", lastActivityAt: NOW - 50 * MIN }), tile({ streamId: "s", lastActivityAt: NOW - 7 * MIN })] },
      { agents: new Map([agent("pane-a", "permission", { signals: sig({ signalPermissionAt: NOW - 3 * MIN }) })]) },
    );
    const [a, s] = b.groups[0].cards;
    expect(a.since).toBe(NOW - 3 * MIN);
    expect(a.agentTime).toEqual({ kind: "asked", at: NOW - 3 * MIN });
    expect(s.since).toBe(NOW - 7 * MIN);
  });
});

describe("buildSessionCards — 순서", () => {
  it("묶음 안: 입력 대기 → 실패·안 봄 → 작업 중 → 유휴 → 끊김, 같은 단은 화면 순서", () => {
    const rows = [
      tile({ streamId: "idle1" }),
      tile({ streamId: "off", connected: false, attention: "fail" }),
      tile({ streamId: "run", status: "running" }),
      tile({ streamId: "seen-ok", attention: "ok" }),
      tile({ streamId: "fail", status: "fail" }),
      tile({ streamId: "idle2" }),
      tile({ streamId: "ai" }),
    ];
    const b = board({ rows }, { agents: new Map([agent("pane-ai", "permission")]) });
    expect(b.groups[0].cards.map((c) => c.key)).toEqual(["ai", "seen-ok", "fail", "run", "idle1", "idle2", "off"]);
    expect(b.groups[0].cards.find((c) => c.key === "seen-ok")?.unseen).toBe("ok");
  });

  it("묶음: 로컬 먼저, 그다음 가장 급한 카드 → 이름", () => {
    const b = board({
      rows: [
        tile({ streamId: "z", kind: "ssh", alias: "zeta", status: "fail" }),
        tile({ streamId: "a", kind: "ssh", alias: "alpha" }),
        tile({ streamId: "b", kind: "ssh", alias: "beta" }),
        tile({ streamId: "l" }),
      ],
    });
    expect(b.groups.map((g) => g.name)).toEqual(["로컬", "zeta", "alpha", "beta"]);
  });
});

describe("buildSessionCards — 헤드리스 · 다른 창", () => {
  it("헤드리스 위임 세션은 제 호스트 묶음의 카드(누를 곳 없음), 다른 창의 타일은 빠진다", () => {
    const b = board({
      rows: [tile({ streamId: "s1", kind: "ssh", alias: "dev-01" })],
      sessions: [
        session({ id: "delegated:dev-01", code: "dev-01", label: "dev-01", lastCommand: "df -h", lastExit: 0 }),
        session({ id: "other", code: "t9·p1", label: "dev-01", windowLabel: "win-2" }),
        session({ id: "gone", code: "t9·p2", label: "prod", windowLabel: "win-2" }),
      ],
      delegations: new Map([["dev-01", GRANTS]]),
    });
    expect(b.groups.map((g) => g.key)).toEqual(["dev-01"]); // prod 는 다른 창 타일뿐이라 묶음째 빠진다
    const g = b.groups[0];
    expect(g.delegated).toBe(true);
    expect(g.cards.map((c) => c.key)).toEqual(["s1", "delegated:dev-01"]);
    const h = g.cards[1];
    expect([h.kind, h.tabId, h.paneId, h.title, h.code, h.commandShort, h.exit]).toEqual([
      "headless",
      null,
      null,
      null,
      null,
      "df -h",
      0,
    ]);
    expect(b.total).toBe(2);
  });
});

describe("buildSessionCards — 요약", () => {
  it("상태마다 카드 수 (헤드리스 포함) · 비었으면 전부 0", () => {
    const b = board(
      {
        rows: [
          tile({ streamId: "a" }),
          tile({ streamId: "b", status: "fail" }),
          tile({ streamId: "c", status: "running" }),
          tile({ streamId: "d", connected: false }),
        ],
        sessions: [session({ id: "delegated:h", code: "h", label: "h" })],
      },
      { agents: new Map([agent("pane-a", "finished")]) },
    );
    expect(b.summary).toEqual({ input: 1, fail: 1, running: 1, idle: 1, off: 1 });
    expect(b.total).toBe(5);
    expect(board({}).summary).toEqual({ input: 0, fail: 0, running: 0, idle: 0, off: 0 });
    expect(board({}).groups).toEqual([]);
  });
});

describe("cardStateOf — 점 셋 → 카드 상태 (docs/log/2026-10-01-agent-status-three.md)", () => {
  it("AI 타일: 권한 대기 · 완료 = 입력 대기, 실행 중 = 작업 중, 점 없음 = 유휴, 끊김은 off", () => {
    expect(cardStateOf("idle", "permission")).toBe("input");
    expect(cardStateOf("idle", "finished")).toBe("input");
    expect(cardStateOf("working", "running")).toBe("running");
    expect(cardStateOf("working", null, true)).toBe("idle");
    expect(cardStateOf("fail", null, true)).toBe("idle");
    expect(cardStateOf("disconnected", "permission")).toBe("off");
  });

  it("셸 타일: 줄의 상태 그대로", () => {
    expect(cardStateOf("working", null)).toBe("running");
    expect(cardStateOf("fail", null)).toBe("fail");
    expect(cardStateOf("idle", null)).toBe("idle");
  });
});

describe("buildSessionCards — 진행 중 서브 에이전트 수 (docs/log/2026-10-04-subagent-signals.md)", () => {
  it("AI 카드는 점이 있을 때만 수를 든다 — 점이 없거나 끊겼거나 셸 카드면 0", () => {
    const busy = sig({ signalRunningAt: 1, subagents: ["a", "b"], mainStopped: true });
    const b = board(
      {
        rows: [
          tile({ streamId: "r" }),
          tile({ streamId: "n" }),
          tile({ streamId: "x", connected: false }),
          tile({ streamId: "s" }),
        ],
      },
      {
        agents: new Map([
          agent("pane-r", "running", { signals: busy }),
          agent("pane-n", null, { signals: busy }),
          agent("pane-x", "running", { signals: busy }),
        ]),
      },
    );
    const by = new Map(b.groups.flatMap((g) => g.cards).map((c) => [c.paneId, c.subagents]));
    expect(by.get("pane-r")).toBe(2);
    expect(by.get("pane-n")).toBe(0);
    expect(by.get("pane-x")).toBe(0);
    expect(by.get("pane-s")).toBe(0);
  });
});
