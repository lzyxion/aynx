import { describe, expect, it } from "vitest";
import { REFRESH_GAP_MS, refreshTargets, type RefreshCandidate } from "./worktree-refresh";

const local = (id: string): RefreshCandidate => ({ id, remote: false, attached: false });
const remote = (id: string, attached: boolean): RefreshCandidate => ({ id, remote: true, attached });

describe("refreshTargets — dock visible / window focus re-read", () => {
  const now = 100_000;
  it("only expanded projects", () => {
    expect(refreshTargets([local("a"), local("b")], new Set(["b"]), {}, new Set(), now)).toEqual(["b"]);
  });
  it("remote only with an attached session; local always", () => {
    const all = new Set(["l", "r1", "r2"]);
    expect(refreshTargets([local("l"), remote("r1", true), remote("r2", false)], all, {}, new Set(), now)).toEqual(["l", "r1"]);
  });
  it("throttled per project within the gap (boundary is inclusive of the gap)", () => {
    const all = new Set(["a", "b", "c"]);
    const lastAt = { a: now - 1000, b: now - REFRESH_GAP_MS, c: now - REFRESH_GAP_MS + 1 };
    expect(refreshTargets([local("a"), local("b"), local("c")], all, lastAt, new Set(), now)).toEqual(["b"]);
  });
  it("never starts a second read while one is in flight", () => {
    const all = new Set(["a", "b"]);
    expect(refreshTargets([local("a"), local("b")], all, { a: 0 }, new Set(["a"]), now)).toEqual(["b"]);
  });
  it("custom gap", () => {
    expect(refreshTargets([local("a")], new Set(["a"]), { a: now - 50 }, new Set(), now, 10)).toEqual(["a"]);
  });
});
