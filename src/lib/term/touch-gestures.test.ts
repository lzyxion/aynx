import { describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, SELECT_SCROLL_MS, TouchGestures, wheelLines, type TouchClock } from "./touch-gestures";

/** `word` = 길게 누른 자리에 고를 낱말이 있다 */
function rig(row = 20, word = false) {
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
  const picked: [number, number][] = [];
  const order: string[] = [];
  /** `selectTo` 가 돌려줄 가장자리 방향 */
  const edge = { dir: 0 };
  const g = new TouchGestures(
    { rowHeight: () => row, scrollLines: (n, x, y) => {
        scrolled.push(n);
        at.push([x, y]);
      }, selectStart: (x, y) => {
        if (word) picked.push([x, y]);
        return word;
      }, selectTo: (x, y) => {
        picked.push([x, y]);
        return edge.dir;
      }, selectScroll: (dir) => order.push(`scroll${dir}`), selectEnd: (lifted) => order.push(lifted ? "lift" : "drop"), longPress: (x, y) => {
        pressed.push([x, y]);
        order.push("menu");
      } },
    clock,
  );
  const tick = (ms: number) => {
    now += ms;
    for (const t of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { g, scrolled, at, pressed, picked, order, edge, tick };
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

  it("낱말 위를 길게 누르면 고르기 — 끌면 늘어나고(스크롤 없음) 떼면 끝(메뉴는 없다)", () => {
    const { g, pressed, picked, scrolled, order, tick } = rig(20, true);
    g.start(50, 60);
    tick(LONG_PRESS_MS + 1);
    expect(picked).toEqual([[50, 60]]);
    expect(pressed).toEqual([]);
    expect(g.move(90, 140)).toBe(true);
    expect(picked).toEqual([[50, 60], [90, 140]]);
    expect(scrolled).toEqual([]);
    tick(2_000);
    expect(g.nativeLongPress()).toBe(true); // 고르는 동안 온 contextmenu 는 삼킨다
    expect(g.end()).toBe(true); // 뒤따르는 탭이 선택을 지우지 않게
    expect(pressed).toEqual([]);
    expect(order).toEqual(["lift"]);
    expect(g.move(10, 10)).toBe(false);
  });

  it("고르기의 끝은 한 번 — 뗀 것과 걷힌 것(손가락 둘)을 가른다", () => {
    const a = rig(20, true);
    a.g.start(50, 60);
    a.tick(LONG_PRESS_MS + 1);
    a.g.end();
    a.g.end();
    expect(a.order).toEqual(["lift"]);
    const b = rig(20, true);
    b.g.start(50, 60);
    b.tick(LONG_PRESS_MS + 1);
    b.g.cancel();
    expect(b.order).toEqual(["drop"]);
  });

  it("손잡이를 잡으면 길게 누르기 없이 곧바로 고르기 — 끌면 늘어나고 떼면 끝", () => {
    const { g, picked, pressed, order, tick } = rig(20, false);
    g.startSelecting(50, 60);
    expect(g.down()).toBe(true);
    expect(g.move(52, 62)).toBe(true); // 문턱 없이
    expect(picked).toEqual([[52, 62]]);
    tick(LONG_PRESS_MS + 1);
    expect(g.nativeLongPress()).toBe(true);
    expect(g.end()).toBe(true);
    expect(order).toEqual(["lift"]);
    expect(pressed).toEqual([]);
  });

  it("고르다 가장자리에 머물면 한 줄씩 넘기고 같은 자리로 다시 고른다 — 벗어나거나 떼면 멈춘다", () => {
    const { g, picked, order, edge, tick } = rig(20, true);
    g.start(50, 60);
    tick(LONG_PRESS_MS + 1);
    edge.dir = -1;
    g.move(50, 5);
    tick(SELECT_SCROLL_MS);
    tick(SELECT_SCROLL_MS);
    expect(order).toEqual(["scroll-1", "scroll-1"]);
    expect(picked.slice(-2)).toEqual([[50, 5], [50, 5]]);
    edge.dir = 0;
    g.move(50, 80);
    tick(SELECT_SCROLL_MS * 3);
    expect(order).toEqual(["scroll-1", "scroll-1"]);
    edge.dir = 1;
    g.move(50, 300);
    g.end();
    tick(SELECT_SCROLL_MS * 3);
    expect(order).toEqual(["scroll-1", "scroll-1", "lift"]);
  });

  it("`down` 은 닿은 동안 — 빈 자리에 메뉴를 낸 뒤에도 뗄 때까지", () => {
    const { g, pressed, tick } = rig();
    expect(g.down()).toBe(false);
    g.start(50, 60);
    tick(LONG_PRESS_MS + 1);
    expect(pressed.length).toBe(1);
    expect(g.down()).toBe(true);
    g.end();
    expect(g.down()).toBe(false);
  });

  it("우리 시계보다 이른 contextmenu(Android)가 길게 누르기가 된다 — 시계는 다시 내지 않는다", () => {
    const { g, pressed, picked, order, tick } = rig(20, true);
    g.start(50, 60);
    tick(400);
    expect(g.nativeLongPress()).toBe(true);
    tick(200);
    expect(picked).toEqual([[50, 60]]);
    g.end();
    expect(order).toEqual(["lift"]);
    expect(pressed).toEqual([]);
  });

  it("닿은 손가락이 없거나 끄는 중의 contextmenu 는 부르는 쪽 몫", () => {
    const { g, pressed } = rig();
    expect(g.nativeLongPress()).toBe(false);
    g.start(50, 60);
    g.move(50, 90);
    expect(g.nativeLongPress()).toBe(false);
    g.end();
    g.start(50, 60);
    expect(g.nativeLongPress()).toBe(true); // 빈 자리 — 곧바로 메뉴
    expect(pressed).toEqual([[50, 60]]);
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
