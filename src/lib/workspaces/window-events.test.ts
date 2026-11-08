import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentWindowLabel } from "$lib/context";
import { listenWindowRequests, requestWindow, type WindowAction } from "./window-events";
import { quitAll, type QuitChoice, type QuitIO } from "./quit";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emitTo: vi.fn(async () => {}) }));
vi.mock("$lib/context", () => ({ currentWindowLabel: vi.fn(() => "main") }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(currentWindowLabel).mockReturnValue("main"); });
afterEach(() => { vi.useRealTimers(); });

it("waits for the listener before sending and removes it after a save ACK", async () => {
  const un = vi.fn();
  // Reply after emit, as with the real event round trip.
  vi.mocked(listen).mockImplementation(async (event, handle) => {
    vi.mocked(emitTo).mockImplementationOnce(async () => { handle({ event, id: 1, payload: true }); });
    return un;
  });
  expect(await requestWindow("tear-1", { kind: "pause" })).toBe(true);
  expect(listen).toHaveBeenCalledWith(expect.stringMatching(/^workspace-reply-/), expect.any(Function), { target: { kind: "WebviewWindow", label: "main" } });
  expect(emitTo).toHaveBeenCalledWith("tear-1", "workspace-request", expect.objectContaining({ sender: "main", action: { kind: "pause" } }));
  expect(un).toHaveBeenCalledTimes(1);
});

it("bounds unanswered requests and unregisters the listener", async () => {
  const un = vi.fn();
  vi.mocked(listen).mockResolvedValue(un);
  const pending = requestWindow("tear-1", { kind: "inspect" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBeNull();
  expect(un).toHaveBeenCalledTimes(1);
});

it("does not send a late pause after listener registration times out", async () => {
  const un = vi.fn();
  let ready!: (un: () => void) => void;
  vi.mocked(listen).mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
  const pending = requestWindow("tear-1", { kind: "pause" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBeNull();
  ready(un);
  await Promise.resolve();
  expect(emitTo).not.toHaveBeenCalled();
  expect(un).toHaveBeenCalledTimes(1);
});

it.each(["main", "tear-1"])("scopes requests to %s and ignores self-sent requests", async (label) => {
  vi.mocked(currentWindowLabel).mockReturnValue(label);
  const un = vi.fn();
  vi.mocked(listen).mockResolvedValue(un);
  const handle = vi.fn(async () => true);
  const stop = await listenWindowRequests(handle);
  expect(listen).toHaveBeenCalledWith("workspace-request", expect.any(Function), { target: { kind: "WebviewWindow", label } });
  const onRequest = vi.mocked(listen).mock.calls[0][1];
  onRequest({ event: "workspace-request", id: 1, payload: { id: "self", sender: label, action: { kind: "pause" } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(handle).not.toHaveBeenCalled();
  expect(emitTo).not.toHaveBeenCalled();
  const sender = label === "main" ? "tear-1" : "main";
  onRequest({ event: "workspace-request", id: 2, payload: { id: "remote", sender, action: { kind: "pause" } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(handle).toHaveBeenCalledExactlyOnceWith({ kind: "pause" });
  expect(emitTo).toHaveBeenCalledExactlyOnceWith(sender, "workspace-reply-remote", true);
  stop();
  expect(un).toHaveBeenCalledTimes(1);
});

it.each(["main", "tear-1"])("calls the local handler for self requests in %s without events", async (label) => {
  vi.mocked(currentWindowLabel).mockReturnValue(label);
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const reply = { label, displayLabel: label === "main" ? "Main window" : "Separate window · Work", docs: [] };
  const handle = vi.fn(async (action: WindowAction) => action.kind === "inspect" ? reply : true);
  const stop = await listenWindowRequests(handle);
  vi.clearAllMocks();
  try {
    expect(await requestWindow(label, { kind: "inspect" })).toEqual(reply);
    const actions: WindowAction[] = [{ kind: "saveDocs", ids: [] }, { kind: "pause" }, { kind: "release", token: 1 }, { kind: "resume" }, { kind: "focus", paneId: "pane-1" }];
    for (const action of actions) {
      expect(await requestWindow(label, action)).toBe(true);
      expect(handle).toHaveBeenLastCalledWith(action);
    }
    expect(listen).not.toHaveBeenCalled();
    expect(emitTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { stop(); }
  expect(await requestWindow(label, { kind: "inspect" })).toBeNull();
});

it.each(["throw", "reject", "timeout"])("bounds a local handler failure: %s", async (failure) => {
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const stop = await listenWindowRequests(() => {
    if (failure === "throw") throw new Error("failed");
    if (failure === "reject") return Promise.reject(new Error("failed"));
    return new Promise(() => {});
  });
  try {
    const pending = requestWindow("main", { kind: "pause" }, 25);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toBe(failure === "timeout" ? null : false);
    expect(vi.getTimerCount()).toBe(0);
    expect(emitTo).not.toHaveBeenCalled();
  } finally { stop(); }
});

function quitIO(choice: QuitChoice = "discard"): QuitIO {
  return {
    windows: vi.fn(async () => ["main", "tear-1"]),
    inspect: async (label) => {
      const reply = await requestWindow(label, { kind: "inspect" });
      return reply && typeof reply === "object" ? reply : null;
    },
    confirm: vi.fn(async () => choice),
    save: async (label, ids) => await requestWindow(label, { kind: "saveDocs", ids }) === true,
    flush: async (label) => await requestWindow(label, { kind: "pause" }) === true,
    resume: vi.fn(async (label) => { await requestWindow(label, { kind: "resume" }); }),
    exit: vi.fn(async () => {}),
  };
}

it.each([false, true])("quits with self (dirty=%s) and a doc-less aux after both flush ACKs", async (dirty) => {
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const docs = dirty ? [{ id: "main-doc", name: "main.md" }] : [];
  const handle = vi.fn(async (action: WindowAction) => action.kind === "inspect" ? { label: "main", displayLabel: "Main window", docs } : true);
  const stop = await listenWindowRequests(handle);
  vi.mocked(listen).mockImplementation(async (event, onReply) => {
    vi.mocked(emitTo).mockImplementationOnce(async (_label, _event, payload) => {
      const action = (payload as { action: { kind: string } }).action;
      onReply({ event, id: 1, payload: action.kind === "inspect" ? { label: "tear-1", displayLabel: "Separate window · Work", docs: [] } : true });
    });
    return vi.fn(() => {});
  });
  const io = quitIO("save");
  try {
    expect(await quitAll(io)).toBe(true);
    expect(handle.mock.calls.map(([action]) => action.kind)).toEqual(dirty ? ["inspect", "saveDocs", "pause"] : ["inspect", "pause"]);
    expect(emitTo).toHaveBeenCalledTimes(dirty ? 3 : 2);
    expect(emitTo).toHaveBeenLastCalledWith("tear-1", "workspace-request", expect.objectContaining({ action: { kind: "pause" } }));
    if (dirty) expect(io.confirm).toHaveBeenCalledExactlyOnceWith([{ label: "main", displayLabel: "Main window", docs }, { label: "tear-1", displayLabel: "Separate window · Work", docs: [] }]);
    else expect(io.confirm).not.toHaveBeenCalled();
    expect(io.resume).not.toHaveBeenCalled();
    expect(io.exit).toHaveBeenCalledTimes(1);
  } finally { stop(); }
});

it("calls confirmation for an unknown aux even when self has no documents", async () => {
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(emitTo).mockResolvedValue(undefined);
  const stop = await listenWindowRequests(async () => ({ label: "main", displayLabel: "Main window", docs: [] }));
  const io = quitIO("cancel");
  try {
    const pending = quitAll(io);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe(false);
    expect(io.confirm).toHaveBeenCalledExactlyOnceWith([
      { label: "main", displayLabel: "Main window", docs: [] }, { label: "tear-1", docs: [], unknown: true },
    ]);
    expect(io.exit).not.toHaveBeenCalled();
  } finally { stop(); }
});
