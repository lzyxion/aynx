import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLatestDebounce } from "$lib/start-board-sync";

/** 시작 화면 한 벌을 모양 프로필에 몰아 담는 시계 (2026-11-03) */

describe("createLatestDebounce — 마지막 값 하나만 몰아서", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("잇단 값은 마지막 하나만, 기다림은 새 값마다 처음부터", () => {
    const run = vi.fn();
    const d = createLatestDebounce<number>(400, run);
    d.push(1);
    vi.advanceTimersByTime(300);
    d.push(2);
    vi.advanceTimersByTime(300);
    expect(run).not.toHaveBeenCalled();
    d.push(3);
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(3);
    expect(d.pending()).toBe(false);
  });

  it("flush 는 기다리던 값을 지금 넘기고 타이머를 걷는다 — 빈 flush 는 아무 일도 없다", () => {
    const run = vi.fn();
    const d = createLatestDebounce<string>(400, run);
    d.flush();
    expect(run).not.toHaveBeenCalled();
    d.push("앞 프로필");
    d.flush();
    expect(run).toHaveBeenCalledWith("앞 프로필");
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancel 은 버린다", () => {
    const run = vi.fn();
    const d = createLatestDebounce<number>(400, run);
    d.push(1);
    expect(d.pending()).toBe(true);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
  });
});
