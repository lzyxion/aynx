import { describe, expect, it } from "vitest";
import { EMPTY_RUNNING, isOpenHeadless, isRunningPlan, planName, summarizeRunning } from "./running-now";

describe("summarizeRunning", () => {
  it("모두 0 이면 total 0 · 세 줄은 그대로 선다", () => {
    expect(EMPTY_RUNNING.total).toBe(0);
    expect(EMPTY_RUNNING.sections.map((s) => [s.kind, s.count])).toEqual([
      ["agents", 0],
      ["headless", 0],
      ["plans", 0],
    ]);
  });

  it("합계는 세 줄의 합이고 넘치는 이름은 '외 N' 으로 접힌다", () => {
    const s = summarizeRunning(
      { agents: ["a", "b", "c", "d", "e", "f"], headless: ["web-01"], plans: [] },
      4,
    );
    expect(s.total).toBe(7);
    expect(s.sections[0]).toEqual({ kind: "agents", count: 6, shown: ["a", "b", "c", "d"], more: 2 });
    expect(s.sections[1]).toEqual({ kind: "headless", count: 1, shown: ["web-01"], more: 0 });
    expect(s.sections[2]).toEqual({ kind: "plans", count: 0, shown: [], more: 0 });
  });

  it("빈 이름도 센다(? 로 선다)", () => {
    const s = summarizeRunning({ agents: ["  "], headless: [], plans: [] });
    expect(s.total).toBe(1);
    expect(s.sections[0].shown).toEqual(["?"]);
  });
});

describe("isOpenHeadless", () => {
  it("위임 id · 붙음 · 안 떨어짐만", () => {
    expect(isOpenHeadless({ id: "delegated:web-01", connected: true, dropped: false })).toBe(true);
    expect(isOpenHeadless({ id: "delegated:web-01", connected: false, dropped: false })).toBe(false);
    expect(isOpenHeadless({ id: "delegated:web-01", connected: true, dropped: true })).toBe(false);
    expect(isOpenHeadless({ id: "p2", connected: true, dropped: false })).toBe(false);
  });
});

describe("isRunningPlan · planName", () => {
  it("approved · running 만 돈다(승인 대기는 🔔 몫)", () => {
    expect(isRunningPlan({ state: "approved" })).toBe(true);
    expect(isRunningPlan({ state: "running" })).toBe(true);
    expect(isRunningPlan({ state: "awaitingApproval" })).toBe(false);
    expect(isRunningPlan({ state: "succeeded" })).toBe(false);
  });

  it("제목 우선, 없으면 명령 첫 줄", () => {
    expect(planName({ title: " 재시작 ", command: "x" })).toBe("재시작");
    expect(planName({ title: null, command: "systemctl restart nginx\necho ok" })).toBe("systemctl restart nginx");
    expect(planName({ title: "", command: "uptime" })).toBe("uptime");
  });
});
