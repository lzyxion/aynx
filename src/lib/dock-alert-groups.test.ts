import { describe, expect, it } from "vitest";
import { agentAlertGroup, groupAlertRows, operationAlertGroup, tileAlertGroup, type AlertGroup } from "$lib/dock-alert-groups";

const row = (key: string, group?: AlertGroup) => (group ? { key, group } : { key });

describe("묶음 열쇠", () => {
  it("명령 끝남 · 프로그램 알림 — 원격은 호스트, 로컬은 타일", () => {
    expect(tileAlertGroup({ paneId: "p1", host: "web-01", tileLabel: "탭" })).toEqual({
      key: "tile:host:web-01",
      label: "web-01",
    });
    expect(tileAlertGroup({ paneId: "p1", host: null, tileLabel: "PowerShell" })).toEqual({
      key: "tile:pane:p1",
      label: "PowerShell",
    });
  });

  it("AI 알림 — 같은 로고 + 범위, 범위가 없으면 호스트 · 타일", () => {
    const base = { paneId: "p1", host: null, tileLabel: "탭", logo: "claude" };
    expect(agentAlertGroup({ ...base, scope: "aynx · main" })).toEqual({
      key: "ai:claude|scope:aynx · main",
      label: "aynx · main",
    });
    expect(agentAlertGroup({ ...base, host: "dev-01", scope: null }).key).toBe("ai:claude|host:dev-01");
    expect(agentAlertGroup({ ...base, scope: null }).key).toBe("ai:claude|pane:p1");
    // 로고가 다르면 같은 범위라도 다른 묶음
    expect(agentAlertGroup({ ...base, logo: "codex", scope: "aynx · main" }).key).not.toBe(
      agentAlertGroup({ ...base, scope: "aynx · main" }).key,
    );
  });

  it("AI 알림과 타일 알림은 섞이지 않는다", () => {
    const src = { paneId: "p1", host: "web-01", tileLabel: "탭" };
    expect(agentAlertGroup({ ...src, logo: null, scope: null }).key).not.toBe(tileAlertGroup(src).key);
  });
});

describe("groupAlertRows", () => {
  const A: AlertGroup = { key: "a", label: "A" };
  const B: AlertGroup = { key: "b", label: "B" };

  it("연속이 아니어도 같은 열쇠는 한 묶음 — 자리는 가장 최근 줄, 안 순서도 새것이 앞", () => {
    const out = groupAlertRows([row("1", A), row("2", B), row("3"), row("4", A), row("5", B)]);
    expect(out.map((v) => v.key)).toEqual(["grp:a", "grp:b", "3"]);
    expect(out[0].rows.map((r) => r.key)).toEqual(["1", "4"]);
    expect(out[1].rows.map((r) => r.key)).toEqual(["2", "5"]);
    expect(out[2].group).toBe(null);
  });

  it("열쇠 없는 줄은 낱줄, 열쇠 있는 한 줄도 같은 키의 칸(둘째 줄이 와도 칸이 바뀌지 않는다)", () => {
    const one = groupAlertRows([row("1", A), row("2")]);
    expect(one.map((v) => [v.key, v.rows.length])).toEqual([
      ["grp:a", 1],
      ["2", 1],
    ]);
    const two = groupAlertRows([row("0", A), row("1", A), row("2")]);
    expect(two[0].key).toBe(one[0].key);
    expect(two[0].rows.map((r) => r.key)).toEqual(["0", "1"]);
  });

  it("빈 목록", () => {
    expect(groupAlertRows([])).toEqual([]);
  });
});

describe("operationAlertGroup — 작업안 실행은 같은 대상 묶음끼리", () => {
  const label = (first: string, rest: number) => (rest > 0 ? `${first} +${rest}` : first);

  it("대상 이름의 집합이 같으면 순서 · 중복 · 앞뒤 공백과 무관하게 같은 열쇠", () => {
    const a = operationAlertGroup(["web-02", "web-01"], label);
    const b = operationAlertGroup([" web-01", "web-02", "web-01"], label);
    expect(a?.key).toBe(b?.key);
    expect(a?.label).toBe("web-01 +1");
  });

  it("대상이 다르면 다른 묶음 · 다른 갈래(tile)와 섞이지 않는다", () => {
    const a = operationAlertGroup(["web-01"], label);
    const b = operationAlertGroup(["web-01", "web-02"], label);
    expect(a?.key).not.toBe(b?.key);
    expect(a?.label).toBe("web-01");
    expect(a?.key.startsWith("op:")).toBe(true);
  });

  it("대상을 모르면 낱줄(null)", () => {
    expect(operationAlertGroup([], label)).toBeNull();
    expect(operationAlertGroup(["  "], label)).toBeNull();
  });
});
