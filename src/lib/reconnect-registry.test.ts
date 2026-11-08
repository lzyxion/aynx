import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECONNECT_STAGGER_MS,
  awaitsConnect,
  connectPane,
  connectStaggered,
  registerConnect,
  registerSettling,
  whenSettled,
} from "$lib/reconnect-registry";

/** 연결 대기 타일 레지스트리 (docs/log/2026-09-03-workspace-restore.md) */

afterEach(() => {
  vi.useRealTimers();
});

describe("registerConnect · connectPane · awaitsConnect", () => {
  it("등록한 뒤에는 기다리는 상태이고, 부르면 그 함수가 돈다", () => {
    const fn = vi.fn();
    const off = registerConnect("pane-1", fn);
    expect(awaitsConnect("pane-1")).toBe(true);
    connectPane("pane-1");
    expect(fn).toHaveBeenCalledOnce();
    off();
    expect(awaitsConnect("pane-1")).toBe(false);
  });

  it("등록이 없으면 조용히 넘어간다 (이미 붙었거나 사라졌다)", () => {
    expect(awaitsConnect("없는패널")).toBe(false);
    expect(() => connectPane("없는패널")).not.toThrow();
  });

  it("해제는 **내가 넣은 그 함수일 때만** 지운다 — 늦게 도는 정리가 새 등록을 죽이지 않게", () => {
    const oldFn = vi.fn();
    const newFn = vi.fn();
    const offOld = registerConnect("pane-2", oldFn);
    const offNew = registerConnect("pane-2", newFn); // 새 인스턴스가 먼저 등록했다
    offOld(); // 옛 인스턴스의 정리가 늦게 돈다
    expect(awaitsConnect("pane-2")).toBe(true);
    connectPane("pane-2");
    expect(newFn).toHaveBeenCalledOnce();
    expect(oldFn).not.toHaveBeenCalled();
    offNew();
  });

  it("패널 id 가 키라 창·탭이 몇 개든 섞이지 않는다", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerConnect("pane-a", a);
    const offB = registerConnect("pane-b", b);
    connectPane("pane-a");
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });
});

describe("connectStaggered", () => {
  it("간격은 120ms 이고, 같은 프레임에 전부 시작하지 않는다", () => {
    expect(RECONNECT_STAGGER_MS).toBe(120);
    vi.useFakeTimers();
    const calls: string[] = [];
    const offs = ["p1", "p2", "p3"].map((id) => registerConnect(id, () => calls.push(id)));

    expect(connectStaggered(["p1", "p2", "p3"])).toBe(3);
    expect(calls).toEqual([]); // 첫 번째도 0ms 예약이라 아직 안 돌았다

    vi.advanceTimersByTime(0);
    expect(calls).toEqual(["p1"]);
    vi.advanceTimersByTime(RECONNECT_STAGGER_MS);
    expect(calls).toEqual(["p1", "p2"]);
    vi.advanceTimersByTime(RECONNECT_STAGGER_MS);
    expect(calls).toEqual(["p1", "p2", "p3"]);

    for (const off of offs) off();
  });

  it("그 사이 타일이 닫히면(등록이 사라지면) no-op 이다 — 예약을 취소할 필요가 없다", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const off = registerConnect("p9", fn);
    connectStaggered(["p9"]);
    off(); // 예약과 실행 사이에 닫혔다
    vi.advanceTimersByTime(RECONNECT_STAGGER_MS * 2);
    expect(fn).not.toHaveBeenCalled();
  });

  it("빈 목록이면 0 개를 예약한다", () => {
    expect(connectStaggered([])).toBe(0);
  });
});

describe("붙기 시도의 확정을 기다린다 (세션 코어 ②-2 — 복원 안내·자동 재접속)", () => {
  it("시도 중인 타일이 끝날 때까지 기다리고, 그 사이 등록한 접속 함수가 보인다", async () => {
    let finish!: () => void;
    const attempt = new Promise<void>((r) => (finish = r));
    registerSettling("pa", attempt.then(() => void registerConnect("pa", () => {})));
    let settled = false;
    const waiting = whenSettled(["pa", "other"]).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await waiting;
    expect(awaitsConnect("pa")).toBe(true);
  });

  it("시도가 없으면 곧바로, 실패해도 풀리고, 멈춘 시도는 상한에서 풀린다", async () => {
    await whenSettled(["none"]);
    registerSettling("pb", Promise.reject(new Error("x")));
    await whenSettled(["pb"]);
    registerSettling("pc", new Promise(() => {}));
    const t0 = Date.now();
    await whenSettled(["pc"], 20);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
