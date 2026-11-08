import { describe, expect, it } from "vitest";
import {
  EXIT_COLLAPSE_MS,
  EXIT_SLIDE_MS,
  EXIT_STAGGER_CAP_MS,
  EXIT_STAGGER_MS,
  exitDelay,
  exitDuration,
  exitFrame,
  exitSpan,
} from "$lib/dock-alert-exit";

describe("exitDelay", () => {
  it("staggers from the top row and stops at the cap", () => {
    expect(exitDelay(0, false)).toBe(0);
    expect(exitDelay(1, false)).toBe(EXIT_STAGGER_MS);
    expect(exitDelay(4, false)).toBe(4 * EXIT_STAGGER_MS);
    expect(exitDelay(100, false)).toBe(EXIT_STAGGER_CAP_MS);
  });

  it("the last row finishes sliding out within 0.4 s however many rows leave", () => {
    expect(exitDelay(1000, false) + EXIT_SLIDE_MS).toBeLessThanOrEqual(400);
  });

  it("no stagger under reduced motion", () => {
    expect(exitDelay(5, true)).toBe(0);
  });
});

describe("exitDuration / exitSpan", () => {
  it("slide then collapse, or fade only", () => {
    expect(exitDuration(false)).toBe(EXIT_SLIDE_MS + EXIT_COLLAPSE_MS);
    expect(exitDuration(true)).toBe(EXIT_SLIDE_MS);
  });

  it("span covers the last row's delay", () => {
    expect(exitSpan(0, false)).toBe(0);
    expect(exitSpan(1, false)).toBe(exitDuration(false));
    expect(exitSpan(3, false)).toBe(2 * EXIT_STAGGER_MS + exitDuration(false));
    expect(exitSpan(50, true)).toBe(EXIT_SLIDE_MS);
  });
});

describe("exitFrame", () => {
  const base = { height: 56, gap: 8, reduced: false } as const;

  it("starts in place and fully visible", () => {
    const f = exitFrame(0, { ...base, side: "left" });
    expect(f).toContain("translateX(0%)");
    expect(f).toContain("opacity: 1;");
    expect(f).toContain("height: 56px");
    expect(f).toContain("margin-bottom: 0px");
  });

  it("slides toward the dock's edge — left dock goes left, right dock goes right", () => {
    const split = EXIT_SLIDE_MS / (EXIT_SLIDE_MS + EXIT_COLLAPSE_MS);
    expect(exitFrame(split / 2, { ...base, side: "left" })).toMatch(/translateX\(-\d/);
    expect(exitFrame(split / 2, { ...base, side: "right" })).toMatch(/translateX\(\d/);
  });

  it("keeps its height while sliding, then folds height and the gap", () => {
    const split = EXIT_SLIDE_MS / (EXIT_SLIDE_MS + EXIT_COLLAPSE_MS);
    const mid = exitFrame(split, { ...base, side: "left" });
    expect(mid).toContain("opacity: 0;");
    expect(mid).toContain("height: 56px");
    const end = exitFrame(1, { ...base, side: "left" });
    expect(end).toContain("height: 0px");
    expect(end).toContain("margin-bottom: -8px");
  });

  it("reduced motion only fades", () => {
    const f = exitFrame(0.5, { ...base, side: "left", reduced: true });
    expect(f).toBe("opacity: 0.5;");
  });
});
