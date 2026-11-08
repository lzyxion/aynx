import { describe, expect, it, vi } from "vitest";
import { WorkspaceSaveQueue, type WorkspaceSnapshot } from "./save-queue";
import type { WorkspaceMutation } from "./schema";

const empty = (tabKey: string): WorkspaceSnapshot => ({ tabs: [], lastActive: { tabKey } });

describe("workspace ACK queue", () => {
  it("seeds actual loaded values and ignores JSON object property order", async () => {
    const apply = vi.fn(async () => 2);
    const queue = new WorkspaceSaveQueue(1, apply, async () => 2, () => {});
    queue.seed("A", { lastActive: { tabKey: "one", tileKey: "tile" }, tabs: [] });
    queue.track("A", { tabs: [], lastActive: { tileKey: "tile", tabKey: "one" } });
    expect(await queue.flush()).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    queue.track("A", { tabs: [], lastActive: { tabKey: "two", tileKey: "tile" } });
    expect(queue.dirty("A")).toBe(true);
  });
  it("marks only the acknowledged snapshot saved; an in-flight edit remains dirty", async () => {
    let resolve!: (revision: number) => void;
    const apply = vi.fn(() => new Promise<number>((done) => resolve = done));
    const queue = new WorkspaceSaveQueue(1, apply, async () => 2, () => {});
    queue.track("A", empty("one"));
    const saving = queue.flush();
    await Promise.resolve();
    queue.track("A", empty("two"));
    resolve(3);
    expect(await saving).toBe(true);
    expect(queue.dirty("A")).toBe(true);
  });
  it("Err stays dirty, reports once and retries on the next change/flush", async () => {
    const apply = vi.fn().mockRejectedValueOnce({ code: "failed" }).mockRejectedValueOnce({ code: "failed" }).mockResolvedValue(3);
    const notice = vi.fn();
    const queue = new WorkspaceSaveQueue(1, apply, async () => 2, notice);
    queue.track("A", empty("one"));
    expect(await queue.flush()).toBe(false);
    expect(queue.dirty("A")).toBe(true);
    expect(await queue.flush()).toBe(false);
    expect(notice).toHaveBeenCalledTimes(1);
    queue.track("A", empty("two"));
    expect(await queue.flush()).toBe(true);
    expect(queue.dirty("A")).toBe(false);
  });
  it("Stale reclaims once and retries with the new generation", async () => {
    const calls: WorkspaceMutation[] = [];
    const apply = vi.fn(async (mutation: WorkspaceMutation) => {
      calls.push(mutation);
      if (calls.length === 1) throw { code: "stale" };
      return 3;
    });
    const claim = vi.fn(async () => 7);
    const queue = new WorkspaceSaveQueue(1, apply, claim, () => {});
    queue.track("A", empty("one"));
    expect(await queue.flush()).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(calls.map((m) => m.op === "putTabs" ? m.generation : null)).toEqual([1, 7]);
    expect(queue.dirty("A")).toBe(false);
  });
  it("a second Stale stops with dirty state and no reclaim loop", async () => {
    const claim = vi.fn(async () => 7);
    const apply = vi.fn(async () => { throw { code: "stale" }; });
    const queue = new WorkspaceSaveQueue(1, apply, claim, () => {});
    queue.track("A", empty("one"));
    expect(await queue.flush()).toBe(false);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(queue.dirty("A")).toBe(true);
  });
  it("writes only tracked workspaces and ACKs the active workspace after tabs", async () => {
    const calls: WorkspaceMutation[] = [];
    const queue = new WorkspaceSaveQueue(1, async (m) => { calls.push(m); return 2; }, async () => 2, () => {});
    queue.seed("A", empty("one"));
    queue.seedActive("A");
    queue.track("A", empty("one"));
    queue.track("B", empty("two"));
    queue.setActive("B");
    expect(await queue.flush()).toBe(true);
    expect(calls.map((m) => m.op)).toEqual(["putTabs", "setActiveWorkspace"]);
    expect(calls[0]).toMatchObject({ workspaceId: "B", scope: { kind: "main" } });
  });
});

describe("aux ACK queue", () => {
  it("claims/reclaims the supplied aux scope without writing app active workspace", async () => {
    const scope = { kind: "aux" as const, groupId: "fresh-group-id" };
    const calls: WorkspaceMutation[] = [];
    const queue = new WorkspaceSaveQueue(1, async (mutation) => {
      calls.push(mutation);
      if (calls.length === 1) throw { code: "stale" };
      return 3;
    }, async () => 2, () => {}, scope);
    queue.track("A", empty("last"));
    expect(await queue.flush()).toBe(true);
    expect(calls).toEqual([
      { op: "putTabs", workspaceId: "A", scope, generation: 1, ...empty("last") },
      { op: "putTabs", workspaceId: "A", scope, generation: 2, ...empty("last") },
    ]);
    expect(queue.dirty("A")).toBe(false);
  });
});
