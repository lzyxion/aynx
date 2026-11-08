import { afterEach, describe, expect, it, vi } from "vitest";

// 원격 창이 집 PC 한 벌을 따른다(2026-11-04) — 받기는 귀(프로필 자동 저장)를 부르지 않고, 편집 판정은 한 곳이다.
vi.hoisted(() => { vi.stubGlobal("$state", <T>(value: T) => value); });

async function load(remote: boolean) {
  vi.resetModules();
  vi.stubGlobal("window", remote ? { __AYNX_REMOTE__: true } : {});
  return import("$lib/start-widgets.svelte.js");
}

const board = (size: number) => ({
  widgets: [{ kind: "clock" as const, x: -10, y: -20, w: 300, h: 120 }],
  clock: { hour12: false, seconds: false, date: true, size },
});

afterEach(() => vi.stubGlobal("window", undefined));

describe("startBoardEditable", () => {
  it("home windows edit, remote windows follow", async () => {
    expect((await load(false)).startBoardEditable()).toBe(true);
    expect((await load(true)).startBoardEditable()).toBe(false);
  });
});

describe("followHomeStartBoard", () => {
  it("takes the board without calling the profile listener", async () => {
    const m = await load(true);
    const heard = vi.fn();
    m.onStartBoardChange(heard);
    m.followHomeStartBoard(board(96));
    expect(m.startBoardSnapshot()).toEqual(board(96));
    expect(m.clockOptions().size).toBe(96);
    expect(heard).not.toHaveBeenCalled();
    expect(m.canUndoStartBoard()).toBe(false);
  });

  it("does not overwrite a local clock fit when the same board comes again", async () => {
    const m = await load(true);
    m.followHomeStartBoard(board(96));
    m.setStartWidgets([{ kind: "clock", x: -10, y: -20, w: 333, h: 130 }]); // 이 창의 언어로 다시 맞춘 시계 박스
    m.followHomeStartBoard(board(96));
    expect(m.startWidgets()[0].w).toBe(333);
    m.followHomeStartBoard(board(120));
    expect(m.startWidgets()[0].w).toBe(300);
    expect(m.clockOptions().size).toBe(120);
  });
});
