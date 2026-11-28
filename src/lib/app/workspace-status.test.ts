import { beforeEach, describe, expect, it, vi } from "vitest";

// 보조 창 보고 → 주 창의 [타일로 가기] — 채팅 잎의 `ct-` 는 `chatStreams` 로만 실린다.
const state = vi.hoisted(() => {
  vi.stubGlobal("$state", <T>(value: T) => value);
  return {
    main: true,
    handlers: new Map<string, (event: { payload: unknown }) => void>(),
    emitted: [] as { target: string; event: string; payload: unknown }[],
  };
});
vi.mock("../ipc", () => ({
  isRemote: false,
  invoke: vi.fn(() => Promise.resolve()),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn((target: string, event: string, payload: unknown) => {
    state.emitted.push({ target, event, payload });
    return Promise.resolve();
  }),
  listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
    state.handlers.set(event, handler);
    return Promise.resolve(() => {});
  }),
}));
vi.mock("$lib/context", () => ({ currentWindowLabel: () => "aux-1", tileCode: (label: string, paneId: string) => `${label}:${paneId}` }));
vi.mock("./workspaces.svelte.js", () => ({ workspaceList: () => [], workspaceMainWindow: () => state.main }));
vi.mock("$lib/workspaces/status", () => ({ rawWorkspaceDots: () => ({}) }));
vi.mock("$lib/workspaces/window-events", () => ({ requestWindow: vi.fn(() => Promise.resolve(null)) }));

import { invoke } from "../ipc";
import { requestWindow } from "$lib/workspaces/window-events";
import { auxWindowRows, focusAuxStream, listenWorkspaceStatus, publishWorkspaceStatus } from "./workspace-status.svelte.js";

const tile = { workspaceId: "w1", streamId: "s-1", tabId: "t1", paneId: "p1", status: null, connected: true };

async function report(payload: unknown): Promise<void> {
  await listenWorkspaceStatus();
  state.handlers.get("workspace-status")!({ payload });
}

describe("workspace-status — 채팅 잎 찾기", () => {
  beforeEach(() => {
    state.main = true;
    state.emitted.length = 0;
    vi.mocked(invoke).mockClear();
    vi.mocked(requestWindow).mockClear();
  });

  it("chatStreams 를 실은 보고 → focusAuxStream 참 · focus_window 를 부른다", async () => {
    await report({ label: "aux-1", dots: {}, tiles: [tile], chatStreams: ["ct-abc"] });
    expect(focusAuxStream("ct-abc")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "aux-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(requestWindow).toHaveBeenCalledWith("aux-1", { kind: "focus", streamId: "ct-abc" });
    // 콘솔 줄에는 터미널 잎만
    expect(auxWindowRows().map((r) => r.streamId)).toEqual(["s-1"]);
  });

  it("chatStreams 없는 옛 보고 → 거짓", async () => {
    await report({ label: "aux-2", dots: {}, tiles: [tile] });
    expect(focusAuxStream("ct-old")).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("보조 창의 보고 — 채팅 잎은 tiles 가 아니라 chatStreams 에", () => {
    state.main = false;
    publishWorkspaceStatus({}, [tile], [], ["ct-xyz"]);
    const sent = state.emitted.at(-1)!;
    expect(sent.event).toBe("workspace-status");
    const p = sent.payload as { tiles: { streamId: string }[]; chatStreams: string[] };
    expect(p.chatStreams).toEqual(["ct-xyz"]);
    expect(p.tiles.map((t) => t.streamId)).toEqual(["s-1"]);
  });
});
