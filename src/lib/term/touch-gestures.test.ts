import { describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, TouchGestures, wheelLines, type TouchClock } from "./touch-gestures";

function rig(row = 20) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: TouchClock = {
    now: () => now,
    set: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clear: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const scrolled: number[] = [];
  const at: [number, number][] = [];
  const pressed: [number, number][] = [];
  const g = new TouchGestures(
    { rowHeight: () => row, scrollLines: (n, x, y) => {
        scrolled.push(n);
        at.push([x, y]);
      }, longPress: (x, y) => pressed.push([x, y]) },
    clock,
  );
  const tick = (ms: number) => {
    now += ms;
    for (const t of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { g, scrolled, at, pressed, tick };
}

describe("TouchGestures — 터치 몸짓(원격 웹 R5)", () => {
  it("세로로 끌면 한 줄 높이마다 한 줄 · 아래로 끌면 위(지난 출력)로", () => {
    const { g, scrolled } = rig(20);
    g.start(100, 100);
    expect(g.move(101, 105)).toBe(false); // 아직 문턱 안
    expect(g.move(101, 130)).toBe(true);
    expect(g.move(101, 165)).toBe(true);
    g.end();
    expect(scrolled.reduce((a, b) => a + b, 0)).toBe(-3);
  });

  it("가로로 먼저 움직이면 손대지 않는다(브라우저의 가로 스크롤)", () => {
    const { g, scrolled } = rig();
    g.start(100, 100);
    expect(g.move(140, 105)).toBe(false);
    expect(g.move(180, 160)).toBe(false);
    expect(scrolled).toEqual([]);
  });

  it("길게 누르면 메뉴 한 번 · 곧이은 contextmenu 는 거른다", () => {
    const { g, pressed, tick } = rig();
    g.start(50, 60);
    tick(LONG_PRESS_MS + 1);
    expect(pressed).toEqual([[50, 60]]);
    expect(g.justLongPressed()).toBe(true);
    expect(g.end()).toBe(true); // 뗄 때 탭을 막으라고
    expect(g.end()).toBe(false);
    tick(1_500);
    expect(g.justLongPressed()).toBe(false);
  });

  it("움직이거나 떼면 길게 누르기가 아니다", () => {
    const { g, pressed, tick } = rig();
    g.start(50, 60);
    g.move(50, 90);
    tick(LONG_PRESS_MS + 1);
    g.start(50, 60);
    tick(100);
    expect(g.end()).toBe(false);
    tick(LONG_PRESS_MS);
    expect(pressed).toEqual([]);
  });

  it("스크롤은 끌기를 시작한 자리를 싣는다(휠 사건의 칸 자리)", () => {
    const { g, at } = rig(20);
    g.start(40, 100);
    g.move(42, 130);
    g.move(44, 170);
    expect(at.length).toBeGreaterThan(0);
    expect(at.every(([x, y]) => x === 40 && y === 100)).toBe(true);
  });
});

describe("wheelLines — 스크롤백 없는 화면의 끌기(10-26)", () => {
  it("한 줄에 휠 사건 하나 · 음수 = 위(deltaY -1) · 줄 단위 · 자리 그대로", () => {
    class FakeWheel {
      type: string;
      init: Record<string, unknown>;
      static DOM_DELTA_LINE = 1;
      constructor(type: string, init: Record<string, unknown>) {
        this.type = type;
        this.init = init;
      }
    }
    vi.stubGlobal("WheelEvent", FakeWheel);
    try {
      const got: FakeWheel[] = [];
      const el = { dispatchEvent: (ev: FakeWheel) => (got.push(ev), true) } as unknown as Element;
      wheelLines(el, -3, 10, 20);
      expect(got.length).toBe(3);
      expect(got.every((e) => e.type === "wheel" && e.init.deltaY === -1 && e.init.deltaMode === 1)).toBe(true);
      expect(got[0].init.clientX).toBe(10);
      expect(got[0].init.clientY).toBe(20);
      got.length = 0;
      wheelLines(el, 2, 0, 0);
      expect(got.map((e) => e.init.deltaY)).toEqual([1, 1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
