import { describe, expect, it } from "vitest";
import { freshStartCwd, lastCwdToKeep } from "./last-cwd";

describe("셸 타일의 마지막 폴더 (lastCwd — 2026-11-12)", () => {
  it("자동 실행 없는 로컬 셸만 적는다 · 앞뒤 공백은 걷는다", () => {
    expect(lastCwdToKeep({ kind: "local" }, " C:/work/app ")).toBe("C:/work/app");
    expect(lastCwdToKeep({ kind: "local", shell: "pwsh" }, "C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(lastCwdToKeep({ kind: "local" }, "  ")).toBeNull();
    expect(lastCwdToKeep({ kind: "ssh" }, "/home/me")).toBeNull();
    expect(lastCwdToKeep({ kind: "local", autorun: "claude" }, "C:/work")).toBeNull();
    expect(lastCwdToKeep({ kind: "local", autorun: "npm run dev" }, "C:/work")).toBeNull();
    // 창 이관으로 넘어와 autorun 이 지워진 AI 타일 — 재시작 명세가 그 자리다
    expect(lastCwdToKeep({ kind: "local", restart: { autorun: "claude" } }, "C:/work")).toBeNull();
    expect(lastCwdToKeep({ kind: "local", restart: { cwd: "C:/p" } }, "C:/work")).toBe("C:/work");
  });
  it("WSL 셸의 POSIX 경로는 이 PC 의 경로로 옮겨 적는다", () => {
    expect(lastCwdToKeep({ kind: "local", shell: "wsl:Ubuntu" }, "/home/me/src")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\src");
    expect(lastCwdToKeep({ kind: "local", shell: "wsl:Ubuntu" }, "/mnt/c/work")).toBe("C:\\work");
  });
  it("새 셸을 여는 첫 열기는 적어 둔 폴더 · 자동 실행 타일은 시작 폴더 그대로", () => {
    expect(freshStartCwd({ kind: "local", lastCwd: "C:/work/app" })).toBe("C:/work/app");
    expect(freshStartCwd({ kind: "local" })).toBeUndefined();
    expect(freshStartCwd({ kind: "local", lastCwd: " " })).toBeUndefined();
    expect(freshStartCwd({ kind: "local", autorun: "claude", lastCwd: "C:/work" })).toBeUndefined();
    expect(freshStartCwd({ kind: "ssh", lastCwd: "/home/me" })).toBeUndefined();
  });
});
