import { describe, expect, it, vi } from "vitest";
import { toggleWrite, writePill } from "./write-toggle";

describe("writePill — 위 띠 알약의 모양", () => {
  it("연결이 없으면 읽기 전용으로 보이고 누를 수 없다", () => {
    expect(writePill({ writable: null, running: false, switching: false })).toEqual({ writable: false, disabled: true });
  });
  it("서버가 준 writable 그대로 — 재부착이면 쓰기 켬도 그대로 보인다", () => {
    expect(writePill({ writable: true, running: false, switching: false })).toEqual({ writable: true, disabled: false });
    expect(writePill({ writable: false, running: false, switching: false })).toEqual({ writable: false, disabled: false });
  });
  it("도는 쿼리 · 전환 중에는 막힌다", () => {
    expect(writePill({ writable: false, running: true, switching: false }).disabled).toBe(true);
    expect(writePill({ writable: true, running: false, switching: true }).disabled).toBe(true);
  });
});

describe("toggleWrite — 켜기는 확인 뒤, 끄기는 바로", () => {
  it("읽기 전용 → 확인하면 켠다(서버의 답을 돌려준다)", async () => {
    const ask = vi.fn(async () => true);
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: false, ask, set })).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(true);
  });
  it("확인에서 물러서면 아무것도 보내지 않는다", async () => {
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: false, ask: async () => false, set })).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });
  it("쓰기 켬 → 묻지 않고 끈다", async () => {
    const ask = vi.fn(async () => true);
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: true, ask, set })).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(false);
  });
  it("서버의 실패는 그대로 던진다", async () => {
    await expect(
      toggleWrite({ writable: true, ask: async () => true, set: async () => Promise.reject(new Error("[stale-lease] x")) }),
    ).rejects.toThrow("[stale-lease]");
  });
});

describe("toggleWrite — 트랜잭션 작업 중 끄기(1단계)", () => {
  it("열린 작업이 있으면 되돌린다는 확인 뒤에만 끈다", async () => {
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    const askRollback = vi.fn(async () => true);
    expect(await toggleWrite({ writable: true, ask: async () => true, set, txOpen: true, askRollback })).toBe(false);
    expect(askRollback).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(false);
  });
  it("확인에서 물러서면 아무것도 보내지 않는다(작업은 그대로)", async () => {
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: true, ask: async () => true, set, txOpen: true, askRollback: async () => false })).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });
  it("확인 함수가 없으면 끄지 않는다(묻지 못한 채 버리지 않는다)", async () => {
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: true, ask: async () => true, set, txOpen: true })).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });
  it("작업이 없으면 지금처럼 묻지 않고 끈다", async () => {
    const askRollback = vi.fn(async () => true);
    const set = vi.fn(async (on: boolean) => ({ writable: on }));
    expect(await toggleWrite({ writable: true, ask: async () => true, set, txOpen: false, askRollback })).toBe(false);
    expect(askRollback).not.toHaveBeenCalled();
  });
});
