import { describe, expect, it } from "vitest";
import {
  buildRows,
  COMMAND_MAX,
  shortenCommand,
  synthState,
  type ConsoleRowInput,
} from "$lib/console/console-rows";

// ---------------------------------------------------------------------------
// 4상태 합성 — 관제판의 핵심 판단이라 규칙 하나하나를 못 박는다.
// (docs/log/2026-09-09-management-view.md)
// ---------------------------------------------------------------------------
describe("synthState — 원 상태 + 연결 → 4상태", () => {
  it("세션이 없으면 언제나 끊김 — 남은 running 은 낡은 값이다", () => {
    expect(synthState("running", false)).toBe("disconnected");
    expect(synthState("ok", false)).toBe("disconnected");
    expect(synthState("fail", false)).toBe("disconnected");
    expect(synthState(null, false)).toBe("disconnected");
  });

  it("연결돼 있고 running 이면 작업중", () => {
    expect(synthState("running", true)).toBe("working");
  });

  it("연결돼 있고 fail 이면 실패", () => {
    expect(synthState("fail", true)).toBe("fail");
  });

  it("연결돼 있고 ok·null 이면 유휴 (연결·유휴를 유휴로 합친다)", () => {
    expect(synthState("ok", true)).toBe("idle");
    expect(synthState(null, true)).toBe("idle");
  });

  it("판정 순서: 끊김이 running/fail 보다 먼저다 (연결이 1차 축)", () => {
    // 연결이 끊긴 채 status 가 무엇이든 결과는 끊김 하나다.
    for (const s of ["running", "ok", "fail", null] as const) {
      expect(synthState(s, false)).toBe("disconnected");
    }
  });
});

// ---------------------------------------------------------------------------
// 명령문 자르기
// ---------------------------------------------------------------------------
describe("shortenCommand — 공백 접기 + 길이 상한", () => {
  it("null·빈 문자열은 빈 문자열", () => {
    expect(shortenCommand(null)).toBe("");
    expect(shortenCommand("")).toBe("");
    expect(shortenCommand("   ")).toBe("");
  });

  it("짧은 명령은 그대로 (앞뒤 공백만 턴다)", () => {
    expect(shortenCommand("  ls -al  ")).toBe("ls -al");
  });

  it("개행·연속 공백을 한 칸으로 접는다", () => {
    expect(shortenCommand("git\n  commit   -m\t'x'")).toBe("git commit -m 'x'");
  });

  it("상한을 넘으면 끝을 …로 자른다 (…를 포함해 정확히 max 글자)", () => {
    const long = "a".repeat(100);
    const out = shortenCommand(long, 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe(`${"a".repeat(9)}…`);
  });

  it("정확히 상한 길이면 자르지 않는다", () => {
    const exact = "a".repeat(COMMAND_MAX);
    expect(shortenCommand(exact)).toBe(exact);
  });
});

// ---------------------------------------------------------------------------
// 행 조립
// ---------------------------------------------------------------------------
describe("buildRows — 재료 → 행 (합성 + 자르기)", () => {
  const base: ConsoleRowInput = {
    streamId: "s1",
    tabId: "tab-1",
    paneId: "pane-1",
    attention: null,
    code: "p2",
    label: "web-01",
    status: null,
    connected: true,
    lastCommand: null,
    exit: null,
  };

  it("입력 순서를 그대로 지킨다 (화면 읽는 순서)", () => {
    const rows = buildRows([
      { ...base, streamId: "s1", code: "p1" },
      { ...base, streamId: "s2", code: "p2" },
      { ...base, streamId: "s3", code: "p3" },
    ]);
    expect(rows.map((r) => r.streamId)).toEqual(["s1", "s2", "s3"]);
  });

  it("각 행에 상태를 합성하고 명령을 자른다", () => {
    const rows = buildRows([
      { ...base, status: "running", lastCommand: "npm run build" },
      { ...base, status: "fail", exit: 1, lastCommand: "make all" },
      { ...base, status: "ok", connected: false, lastCommand: "old cmd" },
    ]);
    expect(rows[0].state).toBe("working");
    expect(rows[0].commandShort).toBe("npm run build");
    expect(rows[1].state).toBe("fail");
    expect(rows[1].exit).toBe(1);
    expect(rows[2].state).toBe("disconnected"); // 세션 없음 — status 무관
  });

  it("재료 필드(streamId·code·label·exit)를 그대로 실어 나른다", () => {
    const [row] = buildRows([
      { ...base, streamId: "abc", code: "t7·p2", label: "db-01", exit: 0 },
    ]);
    expect(row.streamId).toBe("abc");
    expect(row.code).toBe("t7·p2");
    expect(row.label).toBe("db-01");
    expect(row.exit).toBe(0);
  });

  it("빈 입력은 빈 배열 (세션 타일이 하나도 없는 창)", () => {
    expect(buildRows([])).toEqual([]);
  });

  // 주의 라우팅 2단계 — 클릭 점프 대상(tabId·paneId)과 안 본 결과(attention)를 실어 나른다.
  // (docs/log/2026-09-10-attention-routing.md)
  it("클릭 점프 대상(tabId·paneId)을 그대로 실어 나른다", () => {
    const [row] = buildRows([{ ...base, tabId: "tab-9", paneId: "pane-42" }]);
    expect(row.tabId).toBe("tab-9");
    expect(row.paneId).toBe("pane-42");
  });

  it("주의 값(attention)을 fail·ok·null 그대로 나른다 — 상태 합성과 별개 축", () => {
    const rows = buildRows([
      { ...base, attention: "fail" },
      { ...base, attention: "ok" },
      { ...base, attention: null },
    ]);
    expect(rows.map((r) => r.attention)).toEqual(["fail", "ok", null]);
  });

  it("attention 은 4상태 합성에 끼어들지 않는다 (state 는 status·연결만 본다)", () => {
    // 안 본 실패가 켜져 있어도 지금 상태가 유휴면 state 는 유휴다 — 두 축은 독립.
    const [row] = buildRows([{ ...base, attention: "fail", status: "ok", connected: true }]);
    expect(row.attention).toBe("fail");
    expect(row.state).toBe("idle");
  });
});
