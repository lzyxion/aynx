import { describe, expect, it } from "vitest";
import { buildRows, type ConsoleRow, type ConsoleRowInput } from "$lib/console/console-rows";
import {
  elapsedLabel,
  groupSessions,
  worstState,
  LOCAL_GROUP_KEY,
  type GroupInput,
} from "$lib/console/host-groups";
import type { ConsoleSession } from "$lib/console/delegation-rows";
import type { DelegationGrants } from "$lib/delegation";
import type { HostMeta } from "$lib/hosts";

// ---------------------------------------------------------------------------
// 관제판 목록 모드 — **호스트로 묶은 한 벌** (docs/log/2026-09-21-console-host-groups.md).
// 묶는 축 · 중복 제거(이 창이 이긴다) · 거르개 · 최악 상태 · 경과 · 줄 없는 머리줄 둘.
// ---------------------------------------------------------------------------

/** 이 창의 타일 하나 — 관심 있는 칸만 덮어쓴다 */
function tile(over: Partial<ConsoleRowInput> & Pick<ConsoleRowInput, "streamId">): ConsoleRow {
  const input: ConsoleRowInput = {
    tabId: "t1",
    paneId: `pane-${over.streamId}`,
    attention: null,
    code: "p1",
    label: over.streamId,
    status: null,
    connected: true,
    lastCommand: null,
    exit: null,
    kind: "ssh",
    ...over,
  };
  return buildRows([input])[0];
}

/** 앱 전역 세션 하나 */
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

const ALL_GRANTS: DelegationGrants = { connect: true, read: true, propose: true, auto_execute: false, vault_passphrase: false };

function input(over: Partial<GroupInput> = {}): GroupInput {
  return {
    rows: [],
    sessions: [],
    delegations: new Map(),
    runningTargets: new Set(),
    commandByTarget: new Map(),
    metas: new Map(),
    users: new Map(),
    windowLabel: "main",
    localName: "로컬",
    ...over,
  };
}

describe("groupSessions — 묶는 축", () => {
  it("SSH 타일은 별칭으로, 로컬 셸은 한 묶음으로 모인다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", kind: "ssh", alias: "web-01", code: "p1" }),
          tile({ streamId: "s2", kind: "ssh", alias: "web-01", code: "p2" }),
          tile({ streamId: "s3", kind: "local", alias: null, label: "PowerShell 7", code: "p3" }),
        ],
      }),
    );
    const byKey = new Map(groups.map((g) => [g.key, g]));
    expect(byKey.get("web-01")?.rows.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(byKey.get(LOCAL_GROUP_KEY)?.name).toBe("로컬");
    expect(byKey.get(LOCAL_GROUP_KEY)?.rows.map((r) => r.id)).toEqual(["s3"]);
    // 로컬 묶음에는 호스트 메타도 위임도 없다.
    expect(byKey.get(LOCAL_GROUP_KEY)?.local).toBe(true);
    expect(byKey.get(LOCAL_GROUP_KEY)?.meta).toBe(null);
  });

  it("빠른 접속 타일은 자기 `user@host` 이름으로 묶이고 계정을 그 이름에서 읽는다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({
            streamId: "s1",
            kind: "ssh",
            alias: null,
            adhoc: "root@10.0.0.9:2222",
            label: "root@10.0.0.9:2222",
          }),
        ],
      }),
    );
    expect(groups[0].key).toBe("root@10.0.0.9:2222");
    expect(groups[0].rows[0].account).toBe("root");
  });

  it("별칭 타일의 계정은 `~/.ssh/config` 색인에서, 로컬은 셸 이름이 곧 계정이다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", kind: "ssh", alias: "web-01" }),
          tile({ streamId: "s2", kind: "local", alias: null, label: "Git Bash" }),
        ],
        users: new Map([["web-01", "deploy"]]),
      }),
    );
    const byKey = new Map(groups.map((g) => [g.key, g]));
    expect(byKey.get("web-01")?.rows[0].account).toBe("deploy");
    expect(byKey.get(LOCAL_GROUP_KEY)?.rows[0].account).toBe("Git Bash");
  });

  it("헤드리스 세션은 그 위임의 별칭으로 묶이고 주체가 AI 다", () => {
    const groups = groupSessions(
      input({ sessions: [session({ id: "delegated:bastion", code: "bastion", label: "bastion" })] }),
    );
    expect(groups[0].key).toBe("bastion");
    expect(groups[0].rows[0].actor).toBe("ai");
    expect(groups[0].rows[0].kind).toBe("headless");
    // 전역 목록에 실렸다는 것 자체가 "AI 가 본다" 다.
    expect(groups[0].rows[0].shared).toBe(true);
  });

  it("창 타일과 헤드리스가 같은 호스트면 **한 묶음 두 줄**이다", () => {
    const groups = groupSessions(
      input({
        rows: [tile({ streamId: "s1", kind: "ssh", alias: "bastion" })],
        sessions: [session({ id: "delegated:bastion", code: "bastion", label: "bastion" })],
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.actor)).toEqual(["human", "ai"]);
  });
});

describe("groupSessions — 중복 제거", () => {
  it("공유된 이 창 타일은 전역 목록에도 있지만 줄은 하나이고 **이 창 줄이 남는다**", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", kind: "ssh", alias: "web-01", tabId: "t7", paneId: "p-9" }),
        ],
        sessions: [
          session({ id: "s1", code: "p1", label: "web-01", windowLabel: "main" }),
          session({ id: "s2", code: "p4", label: "web-01", windowLabel: "win-2" }),
        ],
      }),
    );
    expect(groups[0].rows).toHaveLength(2);
    const mine = groups[0].rows.find((r) => r.id === "s1");
    // 점프 대상이 살아 있고(그쪽에만 있다) AI 에게 보인다는 표식이 붙는다.
    expect(mine?.tabId).toBe("t7");
    expect(mine?.paneId).toBe("p-9");
    expect(mine?.shared).toBe(true);
    expect(mine?.otherWindow).toBe(false);
    // 다른 창의 줄에는 점프가 없다.
    const other = groups[0].rows.find((r) => r.id === "s2");
    expect(other?.otherWindow).toBe(true);
    expect(other?.tabId).toBe(null);
  });
});

describe("groupSessions — 아직 안 붙은 위임", () => {
  it("붙은 적 없는 위임 대상은 **아예 나오지 않는다** (관제판은 돌고 있는 것만 보인다)", () => {
    const groups = groupSessions(
      input({
        sessions: [
          session({ id: "delegated:db-01", code: "db-01", label: "db-01", connected: false }),
          session({ id: "delegated:old-host", code: "old-host", connected: false, aliasKnown: false }),
        ],
        delegations: new Map([["db-01", ALL_GRANTS]]),
      }),
    );
    expect(groups).toHaveLength(0);
  });

  it("위임이 붙고 나면 보통 세션과 똑같이 줄이 된다", () => {
    const groups = groupSessions(
      input({
        sessions: [session({ id: "delegated:db-01", code: "db-01", label: "db-01" })],
        delegations: new Map([["db-01", ALL_GRANTS]]),
      }),
    );
    expect(groups.map((g) => [g.key, g.rows.length, g.delegated])).toEqual([["db-01", 1, true]]);
  });

  it("떨어진 헤드리스는 사라지지 않는다 — **끊김 줄**이다 (붙은 적이 있다)", () => {
    const groups = groupSessions(
      input({
        sessions: [
          session({
            id: "delegated:a",
            code: "a",
            connected: false,
            dropped: true,
            lastCommand: "uptime",
          }),
        ],
      }),
    );
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].state).toBe("disconnected");
    expect(groups[0].rows[0].command).toBe("uptime");
  });
});

describe("groupSessions — 상태·명령·정렬", () => {
  it("머리줄은 줄들의 최악이고, 묶음은 그 순서로 선다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "a1", alias: "aaa", status: "ok" }),
          tile({ streamId: "z1", alias: "zzz", status: "fail" }),
          tile({ streamId: "m1", alias: "mmm", status: "running" }),
        ],
      }),
    );
    expect(groups.map((g) => g.key)).toEqual(["zzz", "mmm", "aaa"]);
    expect(groups.map((g) => g.state)).toEqual(["fail", "working", "idle"]);
  });

  it("줄은 묶음 안에서 상태 → 코드 순이다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", alias: "web", code: "p9", status: "ok" }),
          tile({ streamId: "s2", alias: "web", code: "p2", status: "fail" }),
          tile({ streamId: "s3", alias: "web", code: "p1", status: "ok" }),
        ],
      }),
    );
    expect(groups[0].rows.map((r) => r.code)).toEqual(["p2", "p1", "p9"]);
  });

  it("실행 중 작업안의 대상이면 도는 명령이 마지막 명령을 이긴다", () => {
    const groups = groupSessions(
      input({
        sessions: [session({ id: "delegated:a", code: "a", lastCommand: "ls -al" })],
        runningTargets: new Set(["delegated:a"]),
        commandByTarget: new Map([["delegated:a", "npm test"]]),
      }),
    );
    expect(groups[0].rows[0].state).toBe("working");
    expect(groups[0].rows[0].command).toBe("npm test");
    expect(groups[0].rows[0].running).toBe(true);
  });

  it("경과 기준은 마지막 활동이고, 없으면 붙은 시각으로 떨어진다", () => {
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", alias: "a", connectedAt: 1_000, lastActivityAt: 9_000 }),
          tile({ streamId: "s2", alias: "b", connectedAt: 1_000 }),
          tile({ streamId: "s3", alias: "c" }),
        ],
      }),
    );
    const since = new Map(groups.flatMap((g) => g.rows.map((r) => [r.id, r.since])));
    expect(since.get("s1")).toBe(9_000);
    expect(since.get("s2")).toBe(1_000);
    expect(since.get("s3")).toBe(null);
  });

  it("위임 표식의 문지기는 `connect` 하나다 (목록 표식과 같은 규칙)", () => {
    const readOnly: DelegationGrants = { connect: false, read: true, propose: false, auto_execute: false, vault_passphrase: false };
    const groups = groupSessions(
      input({
        rows: [
          tile({ streamId: "s1", alias: "web-01" }),
          tile({ streamId: "s2", alias: "db-01" }),
        ],
        delegations: new Map([
          ["web-01", ALL_GRANTS],
          ["db-01", readOnly],
        ]),
      }),
    );
    const byKey = new Map(groups.map((g) => [g.key, g]));
    expect(byKey.get("web-01")?.delegated).toBe(true);
    expect(byKey.get("db-01")?.delegated).toBe(false);
    // 권한 넷 자체는 말풍선용으로 그대로 실린다.
    expect(byKey.get("db-01")?.grants).toEqual(readOnly);
  });

  it("호스트 메타는 소문자 별칭으로 붙는다 (목록·머리줄이 같은 아이콘을 쓴다)", () => {
    const meta: HostMeta = { icon: "svg:ubuntu", color: "#c25b4a", tags: [], forwards: [] };
    const groups = groupSessions(
      input({
        rows: [tile({ streamId: "s1", alias: "WEB-01" })],
        metas: new Map([["web-01", meta]]),
      }),
    );
    expect(groups[0].name).toBe("WEB-01");
    expect(groups[0].meta?.icon).toBe("svg:ubuntu");
  });
});

describe("worstState · elapsedLabel", () => {
  it("실패 > 작업중 > 유휴 > 끊김", () => {
    expect(worstState(["idle", "fail", "working"])).toBe("fail");
    expect(worstState(["disconnected", "idle"])).toBe("idle");
    expect(worstState([])).toBe(null);
  });

  it("경과는 단위를 둘까지만 쓴다", () => {
    expect(elapsedLabel(0)).toBe("0s");
    expect(elapsedLabel(-5_000)).toBe("0s");
    expect(elapsedLabel(12_400)).toBe("12s");
    expect(elapsedLabel(4 * 60_000)).toBe("4m");
    expect(elapsedLabel(60 * 60_000)).toBe("1h");
    expect(elapsedLabel(72 * 60_000)).toBe("1h 12m");
    expect(elapsedLabel(3 * 24 * 3_600_000)).toBe("3d");
    expect(elapsedLabel(Number.NaN)).toBe("0s");
  });
});
