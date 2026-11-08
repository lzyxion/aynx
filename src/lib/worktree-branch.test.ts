import { describe, expect, it } from "vitest";
import { nothingToDelete, parseBranchChoices } from "$lib/worktree-branch";

describe("worktree-branch", () => {
  it("parses choices defensively", () => {
    expect(parseBranchChoices(null)).toEqual({ deletable: [] });
    expect(parseBranchChoices({ deletable: ["a", 1, "b"], main: "main" })).toEqual({ deletable: ["a", "b"] });
  });

  it("nothing to delete closes before opening", () => {
    expect(nothingToDelete({ deletable: [] })).toBe(true);
    expect(nothingToDelete({ deletable: ["s"] })).toBe(false);
  });
});
