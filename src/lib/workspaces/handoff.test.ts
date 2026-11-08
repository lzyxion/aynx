import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { handoffWorkspaceAction, tearBootAction } from "./handoff";

describe("handoff workspace gate before mailbox consume", () => {
  it("refuses cross-workspace aux and tile merges without invoking take", async () => {
    for (const [main, tile] of [[false, false], [false, true], [true, true]]) {
      const take = vi.fn();
      if (handoffWorkspaceAction("A", "B", main, tile) !== "refuse") await take();
      expect(take).not.toHaveBeenCalled();
    }
  });
  it("main tab-bar return switches to the incoming workspace before adoption", () => {
    expect(handoffWorkspaceAction("A", "B", true, false)).toBe("switch");
    expect(handoffWorkspaceAction("A", "A", false, true)).toBe("adopt");
  });
});

// 실기 c — 보조 창 F5 에서 같은 탭이 둘(저장된 aux 복원이 두 번 돌았다). 다시 읽은 창은 사서함이 비어 있고 묶음이 있어 이미 되살렸다.
describe("tear window boot", () => {
  it("first boot adopts the parcel", () => {
    expect(tearBootAction({ restored: false, parcel: true })).toBe("adopt");
  });
  it("reload with a binding does not restore the aux tabs twice", () => {
    expect(tearBootAction({ restored: true, parcel: false })).toBe("restored");
  });
  it("no parcel and nothing restored is a lost parcel", () => {
    expect(tearBootAction({ restored: false, parcel: false })).toBe("missing");
  });
  it("bootTear uses the gate and never runs the saved aux restore a second time", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/tear.svelte.ts", import.meta.url)), "utf8");
    expect(src).toContain("tearBootAction({ restored, parcel: peek !== null })");
    expect(src).not.toContain("bootAuxWorkspace(undefined, true)");
  });
});
