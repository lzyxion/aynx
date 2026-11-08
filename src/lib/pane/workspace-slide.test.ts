import { describe, expect, it } from "vitest";
import { workspaceSlideDir, workspaceSlideFrom } from "./workspace-slide";

describe("workspaceSlideDir", () => {
  it("목록 뒤로 가면 1 · 앞으로 가면 -1", () => {
    expect(workspaceSlideDir(0, 2)).toBe(1);
    expect(workspaceSlideDir(3, 1)).toBe(-1);
  });
  it("같은 칸 · 모르는 칸이면 0 (걸지 않는다)", () => {
    expect(workspaceSlideDir(1, 1)).toBe(0);
    expect(workspaceSlideDir(-1, 2)).toBe(0);
    expect(workspaceSlideDir(2, -1)).toBe(0);
  });
});

describe("workspaceSlideFrom", () => {
  it("세로 상태바면 Y 축, 가로면 X 축 — 방향만큼 부호", () => {
    expect(workspaceSlideFrom(1, true)).toBe("translateY(12px)");
    expect(workspaceSlideFrom(-1, true)).toBe("translateY(-12px)");
    expect(workspaceSlideFrom(1, false)).toBe("translateX(12px)");
    expect(workspaceSlideFrom(-1, false)).toBe("translateX(-12px)");
  });
});
