import { describe, expect, it } from "vitest";
import { isFinalPrepPhase, parsePrepEvent, prepEndsInPlainShell } from "$lib/remote-worktree";

// docs/log/2026-09-29-remote-worktree-after-connect.md

describe("원격 새 워크트리 준비 이벤트", () => {
  it("Rust PrepEvent 의 camelCase 칸을 읽는다", () => {
    expect(
      parsePrepEvent({
        ticket: "ab12",
        phase: "ask",
        repo: "~/api",
        path: "~/api-wt/feat-x",
        branch: "main",
        message: null,
        branchCreated: null,
      }),
    ).toEqual({
      ticket: "ab12",
      phase: "ask",
      repo: "~/api",
      path: "~/api-wt/feat-x",
      branch: "main",
      message: null,
      branchCreated: null,
    });
    expect(parsePrepEvent({ ticket: "ab12", phase: "ready", branchCreated: true })?.branchCreated).toBe(true);
    expect(parsePrepEvent({ ticket: "ab12", phase: "failed", message: "fatal: x" })?.message).toBe("fatal: x");
  });

  it("모양이 어긋나면 null — throw 하지 않는다", () => {
    expect(parsePrepEvent(null)).toBeNull();
    expect(parsePrepEvent("ask")).toBeNull();
    expect(parsePrepEvent({ phase: "ask" })).toBeNull();
    expect(parsePrepEvent({ ticket: "a", phase: "unknown" })).toBeNull();
    expect(parsePrepEvent({ ticket: "", phase: "ask" })).toBeNull();
  });

  it("끝 단계 — ready 만 워크트리에서 시작, 나머지는 평범한 셸", () => {
    for (const p of ["preparing", "ask", "committing"] as const) {
      expect(isFinalPrepPhase(p)).toBe(false);
      expect(prepEndsInPlainShell(p)).toBe(false);
    }
    expect(isFinalPrepPhase("ready")).toBe(true);
    expect(prepEndsInPlainShell("ready")).toBe(false);
    for (const p of ["shell", "failed", "identity"] as const) {
      expect(isFinalPrepPhase(p)).toBe(true);
      expect(prepEndsInPlainShell(p)).toBe(true);
    }
  });
});
