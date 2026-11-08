import { describe, expect, it, vi } from "vitest";
import { createProducerObservers } from "./producer-observers";

describe("앨범 프로듀서 구독 수명", () => {
  it("탭 닫기·경로 이동·이관은 구독만 해제하고 같은 채팅에 다시 붙는다", () => {
    const join = vi.fn(); const leave = vi.fn();
    const observe = createProducerObservers(join, leave);
    const target = { chat: "pc-album" };
    observe(target)();
    expect(leave).toHaveBeenCalledWith("pc-album");
    const release = observe(target);
    expect(join.mock.calls.map(([t]) => t.chat)).toEqual(["pc-album", "pc-album"]);
    release(); release();
    expect(leave).toHaveBeenCalledTimes(2);
  });
  it("같은 창의 두 탭 중 하나를 닫아도 나머지 구독은 산다", () => {
    const leave = vi.fn(); const observe = createProducerObservers(vi.fn(), leave);
    const first = observe({ chat: "same" }); const second = observe({ chat: "same" });
    const other = observe({ chat: "other" });
    first(); expect(leave).not.toHaveBeenCalled();
    other(); expect(leave.mock.calls).toEqual([["other"]]);
    second(); expect(leave.mock.calls).toEqual([["other"], ["same"]]);
  });
});
