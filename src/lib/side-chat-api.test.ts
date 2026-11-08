import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 사이드 채팅 v2 프런트 얼굴(3단계) — 봉투 모양 판정 · `seq` 갈래 · 채팅 id 로 나눠 주기 · 통로는 창마다 하나 · 창 이름을 싣지 않음.
 */

const mocks = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: (m: T) => void = () => {};
  }
  return { invoke: vi.fn(), FakeChannel };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.FakeChannel, convertFileSrc: (s: string) => s }));

import {
  dispatchSideChatEvent,
  isSideChatEvent,
  onSideChatEvent,
  seqStep,
  sideChatAttach,
  sideChatDecide,
  sideChatOpen,
  sideChatSetEffort,
  type SideChatEvent,
} from "./side-chat-api";

function env(chat: string, seq: number, ev: SideChatEvent["ev"] = { t: "text", item: null, text: "글" }): SideChatEvent {
  return { windows: ["main"], chat, epoch: 1, seq, ev };
}

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});

describe("isSideChatEvent", () => {
  it("봉투 모양만 받는다", () => {
    expect(isSideChatEvent(env("c1", 1))).toBe(true);
    expect(isSideChatEvent(env("c1", 1, { t: "exited", code: 0, reason: "closed" }))).toBe(true);
    for (const bad of [
      null,
      "x",
      {},
      { chat: "c1", epoch: 1, seq: "1", ev: { t: "text" } },
      { chat: "c1", epoch: 1, seq: 1 },
      { chat: "c1", epoch: 1, seq: 1, ev: { t: "nope" } },
      { chat: 1, epoch: 1, seq: 1, ev: { t: "text" } },
    ]) {
      expect(isSideChatEvent(bad)).toBe(false);
    }
  });
});

describe("seqStep", () => {
  it("다음 것은 반영 · 겹친 것은 버림 · 건너뛴 것은 다시 attach", () => {
    expect(seqStep(4, 5)).toBe("apply");
    expect(seqStep(4, 4)).toBe("drop");
    expect(seqStep(4, 2)).toBe("drop");
    expect(seqStep(4, 7)).toBe("gap");
    expect(seqStep(0, 1)).toBe("apply");
  });
});

describe("onSideChatEvent", () => {
  it("통로는 하나만 걸고 채팅 id 로 나눠 준다 · 그만 받으면 오지 않는다", async () => {
    const a: number[] = [];
    const b: number[] = [];
    const offA = await onSideChatEvent("a", (e) => a.push(e.seq));
    const offB = await onSideChatEvent("b", (e) => b.push(e.seq));
    const subs = mocks.invoke.mock.calls.filter(([cmd]) => cmd === "side_chat_subscribe");
    expect(subs.length).toBe(1);
    const channel = (subs[0][1] as { channel: { onmessage: (m: unknown) => void } }).channel;

    channel.onmessage(env("a", 1));
    channel.onmessage(env("b", 1));
    channel.onmessage(env("c", 1)); // 구독 없는 채팅 — 버린다
    channel.onmessage({ chat: "a", seq: 2 }); // 모양이 틀림 — 버린다
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);

    offA();
    dispatchSideChatEvent(env("a", 2));
    dispatchSideChatEvent(env("b", 2));
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
    offB();
  });
});

describe("명령 감싸개", () => {
  it("창 이름을 싣지 않는다(Rust 가 부른 웹뷰에서 채운다)", async () => {
    await sideChatOpen({ chat: "c1", cli: "claude", model: "sonnet", mode: { kind: "fresh" } });
    await sideChatAttach("c1");
    await sideChatDecide("c1", 2, "r1", "allow");
    await sideChatSetEffort("c1", 2, null);
    for (const [, args] of mocks.invoke.mock.calls) {
      expect(args).not.toHaveProperty("window");
    }
    expect(mocks.invoke).toHaveBeenCalledWith("side_chat_open", {
      chat: "c1",
      cli: "claude",
      model: "sonnet",
      effort: null,
      mode: { kind: "fresh" },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("side_chat_set_effort", { chat: "c1", epoch: 2, effort: null });
    expect(mocks.invoke).toHaveBeenCalledWith("side_chat_decide", {
      chat: "c1",
      epoch: 2,
      requestId: "r1",
      decision: "allow",
      message: null,
    });
  });
});
