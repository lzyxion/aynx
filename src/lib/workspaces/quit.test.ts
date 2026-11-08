import { describe, expect, it, vi } from "vitest";
import { quitAll, type QuitChoice, type QuitIO } from "./quit";

function fixture(choice: QuitChoice = "discard") {
  const io: QuitIO = {
    windows: vi.fn(async () => ["main", "tear-1"]),
    inspect: vi.fn(async (label) => ({ label, displayLabel: label === "main" ? "Main window" : "Separate window · Work", docs: [{ id: label + "-doc", name: label + ".md" }] })),
    confirm: vi.fn(async () => choice),
    save: vi.fn(async () => true),
    flush: vi.fn(async () => true),
    resume: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
  };
  return io;
}
describe("quit all state machine", () => {
  it("cancel leaves every window and queue untouched", async () => {
    const io = fixture("cancel");
    expect(await quitAll(io)).toBe(false);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.flush).not.toHaveBeenCalled();
    expect(io.exit).not.toHaveBeenCalled();
  });
  it("collects all windows, saves each document, then waits for every flush ACK before exit", async () => {
    const io = fixture("save");
    const order: string[] = [];
    io.save = vi.fn(async (label, ids) => { order.push("save:" + label); expect(ids).toEqual([label + "-doc"]); return true; });
    io.flush = vi.fn(async (label) => { order.push("flush:" + label); return true; });
    io.exit = vi.fn(async () => { order.push("exit"); });
    expect(await quitAll(io)).toBe(true);
    expect(order).toEqual(["save:main", "save:tear-1", "flush:main", "flush:tear-1", "exit"]);
    expect(io.confirm).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: "tear-1", displayLabel: "Separate window · Work" })]));
  });
  it("inspection timeout is shown as unknown and still requires a flush ACK", async () => {
    const io = fixture();
    io.inspect = vi.fn(async () => null);
    io.flush = vi.fn(async () => false);
    expect(await quitAll(io)).toBe(false);
    expect(io.confirm).toHaveBeenCalledWith([
      { label: "main", docs: [], unknown: true }, { label: "tear-1", docs: [], unknown: true },
    ]);
    expect(io.resume).toHaveBeenCalledTimes(2);
    expect(io.exit).not.toHaveBeenCalled();
  });
  it("save choice cannot silently discard an unknown window", async () => {
    const io = fixture("save");
    io.inspect = vi.fn(async () => null);
    expect(await quitAll(io)).toBe(false);
    expect(io.flush).not.toHaveBeenCalled();
    expect(io.exit).not.toHaveBeenCalled();
  });
  it("failed document save and a changed window set both cancel exit", async () => {
    const failed = fixture("save");
    failed.save = vi.fn(async () => false);
    expect(await quitAll(failed)).toBe(false);
    expect(failed.exit).not.toHaveBeenCalled();
    const changed = fixture();
    changed.windows = vi.fn().mockResolvedValueOnce(["main", "tear-1"]).mockResolvedValueOnce(["main", "tear-1", "tear-2"]);
    expect(await quitAll(changed)).toBe(false);
    expect(changed.exit).not.toHaveBeenCalled();
    expect(changed.resume).toHaveBeenCalledTimes(2);
  });
});
