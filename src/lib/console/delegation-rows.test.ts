import { describe, expect, it } from "vitest";
import { delegationRows, delegationSummary, type ConsoleSession } from "$lib/console/delegation-rows";

// ---------------------------------------------------------------------------
// 위임 로스터 — 4상태 합성·명령 선택·주의-우선 정렬(A3b-1).
// 창 행(console-rows)과 스코프가 다르고, 헤드리스 세션은 status 가 늘 null 이라
// 작업중/유휴는 연결 + 실행 중 작업안으로 정한다.
// ---------------------------------------------------------------------------

/** 기본값을 채운 헤드리스 세션 하나 — 테스트가 관심 있는 필드만 덮어쓴다. */
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

describe("delegationRows — 상태 합성", () => {
  it("안 붙어 있으면 미접속 (끊김 아님 — 붙은 적 없음)", () => {
    const rows = delegationRows([session({ id: "delegated:a", connected: false })], new Set());
    expect(rows[0].state).toBe("unconnected");
  });

  it("떨어진 위임(dropped)는 끊김 — 미접속과 구별 (SessionLifecycle)", () => {
    // 살아 있다가 떨어진 세션: connected:false + dropped:true → 끊김.
    const rows = delegationRows(
      [session({ id: "delegated:a", connected: false, dropped: true, lastCommand: "uptime" })],
      new Set(),
    );
    expect(rows[0].state).toBe("disconnected");
    // 끊김도 명령문은 유지한다(마지막에 무엇을 했나).
    expect(rows[0].command).toBe("uptime");
  });

  it("붙은 적 없는 위임(connected:false, dropped:false)는 여전히 미접속", () => {
    const rows = delegationRows(
      [session({ id: "delegated:a", connected: false, dropped: false })],
      new Set(),
    );
    expect(rows[0].state).toBe("unconnected");
  });

  it("접속 + 실행 중 작업안 대상이면 작업중 — 명령은 작업안의 것", () => {
    const rows = delegationRows(
      [session({ id: "delegated:a", connected: true, lastCommand: "옛 명령" })],
      new Set(["delegated:a"]),
      new Map([["delegated:a", "systemctl restart nginx"]]),
    );
    expect(rows[0].state).toBe("working");
    expect(rows[0].command).toBe("systemctl restart nginx");
    expect(rows[0].commandShort).toBe("systemctl restart nginx");
  });

  it("접속 + 작업안 없음(헤드리스 null status) → 유휴, 명령은 lastCommand", () => {
    const rows = delegationRows(
      [session({ id: "delegated:a", connected: true, status: null, lastCommand: "uptime" })],
      new Set(),
    );
    expect(rows[0].state).toBe("idle");
    expect(rows[0].command).toBe("uptime");
  });

  it("거울이 fail 을 보고하면 작업안이 없어도 실패로 살린다", () => {
    const rows = delegationRows(
      [session({ id: "delegated:a", connected: true, status: "fail" })],
      new Set(),
    );
    expect(rows[0].state).toBe("fail");
  });

  // 고아 위임 (docs/log/2026-09-21-fleet-delegation-ui.md) — 미접속의 부분집합이다.
  it("미접속인데 설정에 없는 별칭이면 고아 — 붙을 수 있는 날이 오지 않는다", () => {
    const rows = delegationRows(
      [session({ id: "delegated:gone", connected: false, aliasKnown: false })],
      new Set(),
    );
    expect(rows[0].state).toBe("orphan");
  });

  it("aliasKnown 이 true 거나 없으면 그냥 미접속 (옛 백엔드는 이 칸을 안 보낸다)", () => {
    expect(
      delegationRows([session({ id: "a", connected: false, aliasKnown: true })], new Set())[0].state,
    ).toBe("unconnected");
    expect(delegationRows([session({ id: "a", connected: false })], new Set())[0].state).toBe(
      "unconnected",
    );
  });

  it("붙어 있으면 aliasKnown:false 라도 고아가 아니다 (판정은 미접속 안에서만)", () => {
    const rows = delegationRows(
      [session({ id: "a", connected: true, aliasKnown: false, lastCommand: "ls" })],
      new Set(),
    );
    expect(rows[0].state).toBe("idle");
  });

  it("떨어진 세션(dropped)이 고아 판정보다 앞선다 — 붙은 적이 있다", () => {
    const rows = delegationRows(
      [session({ id: "a", connected: false, dropped: true, aliasKnown: false })],
      new Set(),
    );
    expect(rows[0].state).toBe("disconnected");
  });
});

describe("delegationRows — 주의-우선 정렬", () => {
  it("fail → working → idle → unconnected 순서 (미접속이 맨 뒤)", () => {
    const sessions = [
      session({ id: "u", connected: false }), // unconnected — 맨 뒤
      session({ id: "i", connected: true, lastCommand: "ls" }), // idle
      session({ id: "w", connected: true }), // working (작업안 대상)
      session({ id: "f", connected: true, status: "fail" }), // fail
    ];
    const rows = delegationRows(sessions, new Set(["w"]));
    expect(rows.map((r) => r.id)).toEqual(["f", "w", "i", "u"]);
    expect(rows.map((r) => r.state)).toEqual(["fail", "working", "idle", "unconnected"]);
  });

  it("고아는 미접속보다도 뒤 — 목록 바닥에 모인다", () => {
    const sessions = [
      session({ id: "o", connected: false, aliasKnown: false }), // orphan — 맨 뒤
      session({ id: "u", connected: false }), // unconnected
      session({ id: "d", connected: false, dropped: true }), // disconnected
      session({ id: "i", connected: true, lastCommand: "ls" }), // idle
    ];
    const rows = delegationRows(sessions, new Set());
    expect(rows.map((r) => r.id)).toEqual(["i", "d", "u", "o"]);
    expect(rows.map((r) => r.state)).toEqual([
      "idle",
      "disconnected",
      "unconnected",
      "orphan",
    ]);
  });

  it("동순위는 label 다음 id 로 가른다 (안정)", () => {
    const sessions = [
      session({ id: "z", label: "beta", connected: true, lastCommand: "x" }),
      session({ id: "a", label: "alpha", connected: true, lastCommand: "x" }),
    ];
    const rows = delegationRows(sessions, new Set());
    expect(rows.map((r) => r.id)).toEqual(["a", "z"]); // 둘 다 idle → label 로 alpha 먼저
  });
});

describe("delegationSummary — 요약 카운트", () => {
  it("총계·접속·작업중·실패를 센다", () => {
    const sessions = [
      session({ id: "f", connected: true, status: "fail" }),
      session({ id: "w", connected: true }),
      session({ id: "i", connected: true }),
      session({ id: "d", connected: false }),
    ];
    const rows = delegationRows(sessions, new Set(["w"]));
    expect(delegationSummary(rows)).toEqual({ total: 4, connected: 3, working: 1, fail: 1 });
  });

  it("고아도 총계에는 든다 — 요약의 세는 규칙은 바뀌지 않았다", () => {
    const rows = delegationRows(
      [
        session({ id: "i", connected: true }),
        session({ id: "o", connected: false, aliasKnown: false }),
      ],
      new Set(),
    );
    expect(delegationSummary(rows)).toEqual({ total: 2, connected: 1, working: 0, fail: 0 });
  });
});
