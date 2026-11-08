import { describe, expect, it } from "vitest";
import { mostUrgentAgent, positionChip, tileLabel, tileParts, workspaceChips } from "./labels";

describe("모바일 라벨(10-16 · 고르기 화면 10-20)", () => {
  it("AI 타일은 에이전트 이름이 굵은 토막, 폴더가 덧말", () => {
    expect(tileParts("Claude Code", { ai: "claude", agent: "running", folder: "proj" })).toEqual({ name: "Claude Code", sub: "proj" });
    expect(tileLabel("Codex", { ai: "codex", agent: "finished", folder: "api" })).toBe("Codex · api");
  });

  it("일반 셸은 셸 이름(+폴더) — 보이는 모습이 없으면 덧말도 없다", () => {
    expect(tileLabel("PowerShell 7", { folder: "proj" })).toBe("PowerShell 7 · proj");
    expect(tileParts("PowerShell 7", null)).toEqual({ name: "PowerShell 7", sub: "" });
  });

  it("원격 AI 타일은 호스트가 덧말 앞 — 폴더만 덧붙이고 같은 낱말은 겹치지 않는다", () => {
    expect(tileParts("Claude Code · dev-01", { ai: "claude", folder: "src" })).toEqual({ name: "Claude Code", sub: "dev-01 · src" });
    expect(tileLabel("dev-01", { folder: "dev-01" })).toBe("dev-01");
  });

  it("위치 칩 — 타일이 하나면 탭 번호만, 둘 이상이면 탭 · 타일/수", () => {
    expect(positionChip(2, 1, 1)).toBe("2");
    expect(positionChip(1, 2, 3)).toBe("1 · 2/3");
    expect(positionChip(0, 1, 1)).toBe("");
  });
});

describe("워크스페이스 칩(10-20)", () => {
  it("가장 급한 에이전트 상태 — 권한 대기 > 안 본 끝 > 실행 중", () => {
    expect(mostUrgentAgent(["running", "finished", undefined])).toBe("finished");
    expect(mostUrgentAgent(["running", "permission", "finished"])).toBe("permission");
    expect(mostUrgentAgent([null, undefined])).toBeNull();
    expect(mostUrgentAgent([])).toBeNull();
  });

  it("순서 그대로 · 탭 수 · 점 · 고른 칩 — cold 는 저장된 탭 수 · 점 없음", () => {
    const rows = [
      { id: "w1", name: "Home" },
      { id: "w2", name: "회사" },
      { id: "w3", name: "개인", cold: true, tabCount: 2 },
    ];
    const tabs = [
      { workspaceId: "w1", paneIds: ["a", "b"] },
      { workspaceId: "w2", paneIds: ["c"] },
      { workspaceId: "w2", paneIds: ["d"] },
      { workspaceId: "w3", paneIds: ["e"] }, // cold 의 탭은 세지 않는다(오면 안 되지만)
    ];
    const agents: Record<string, "running" | "permission"> = { a: "running", d: "permission", e: "permission" };
    expect(workspaceChips(rows, tabs, (id) => agents[id], "w2")).toEqual([
      { id: "w1", name: "Home", tabs: 1, cold: false, agent: "running", selected: false },
      { id: "w2", name: "회사", tabs: 2, cold: false, agent: "permission", selected: true },
      { id: "w3", name: "개인", tabs: 2, cold: true, agent: null, selected: false },
    ]);
  });
});
