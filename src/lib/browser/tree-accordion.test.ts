import { describe, expect, it } from "vitest";
import {
  createDeferredClick,
  createSpringLoad,
  createToggleMotion,
  cubicBezier,
  nestRows,
  plainClick,
  type Timers,
  type TreeNode,
} from "./tree-accordion";

/** 손으로 돌리는 시계 — `advance(ms)` 가 그때까지 걸린 것을 차례로 돌린다 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      const id = ++seq;
      jobs.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void jobs.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) {
      if (j.at <= now && jobs.has(id)) {
        jobs.delete(id);
        j.fn();
      }
    }
  };
  return { timers, advance, size: () => jobs.size };
}

const flat = <T>(nodes: TreeNode<T>[]): T[] => nodes.flatMap((n) => [n.row, ...flat(n.children)]);

describe("nestRows", () => {
  const rows = [
    { id: "a", d: 0 },
    { id: "a/b", d: 1 },
    { id: "a/b/x", d: 2 },
    { id: "a/y", d: 1 },
    { id: "c", d: 0 },
    { id: "z", d: 0 },
  ];

  it("접은 둥지를 다시 펴면 입력 순서 그대로", () => {
    const tree = nestRows(rows, (r) => r.d);
    expect(flat(tree).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("부모 = 앞쪽에서 가장 가까운 더 얕은 줄", () => {
    const tree = nestRows(rows, (r) => r.d);
    expect(tree.map((n) => n.row.id)).toEqual(["a", "c", "z"]);
    expect(tree[0].children.map((n) => n.row.id)).toEqual(["a/b", "a/y"]);
    expect(tree[0].children[0].children.map((n) => n.row.id)).toEqual(["a/b/x"]);
    expect(tree[1].children).toEqual([]);
  });

  it("빈 목록 · 깊이가 건너뛰는 줄도 받는다", () => {
    expect(nestRows([], () => 0)).toEqual([]);
    const tree = nestRows([{ d: 0 }, { d: 2 }, { d: 1 }], (r) => r.d);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((n) => n.row.d)).toEqual([2, 1]);
  });
});

describe("cubicBezier", () => {
  it("끝점은 0 · 1, 가운데는 단조 증가", () => {
    const e = cubicBezier(0.2, 0.8, 0.2, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    let prev = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const y = e(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    // 빨리 나가고 천천히 선다 — 절반 시간에 이미 대부분
    expect(e(0.5)).toBeGreaterThan(0.8);
  });

  it("직선 곡선은 직선", () => {
    const lin = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    expect(lin(0.3)).toBeCloseTo(0.3, 4);
  });
});

describe("createDeferredClick", () => {
  it("두 번 누르기가 없으면 미뤄 둔 뒤 돈다", () => {
    const c = fakeTimers();
    const d = createDeferredClick(250, c.timers);
    let n = 0;
    d.schedule(() => n++);
    c.advance(249);
    expect(n).toBe(0);
    c.advance(1);
    expect(n).toBe(1);
    expect(d.pending).toBe(0);
  });

  it("cancel(두 번 누르기) 은 걸린 것을 모두 거둔다", () => {
    const c = fakeTimers();
    const d = createDeferredClick(250, c.timers);
    let n = 0;
    d.schedule(() => n++);
    c.advance(100);
    d.schedule(() => n++);
    d.cancel();
    c.advance(1000);
    expect(n).toBe(0);
    expect(c.size()).toBe(0);
  });

  it("따로 누른 두 번은 두 번 다 돈다", () => {
    const c = fakeTimers();
    const d = createDeferredClick(250, c.timers);
    let n = 0;
    d.schedule(() => n++);
    c.advance(200);
    d.schedule(() => n++);
    c.advance(500);
    expect(n).toBe(2);
  });

  it("plainClick — Ctrl · Shift · Meta 는 고르기만", () => {
    expect(plainClick({ ctrlKey: false, shiftKey: false, metaKey: false })).toBe(true);
    expect(plainClick({ ctrlKey: true, shiftKey: false, metaKey: false })).toBe(false);
    expect(plainClick({ ctrlKey: false, shiftKey: true, metaKey: false })).toBe(false);
    expect(plainClick({ ctrlKey: false, shiftKey: false, metaKey: true })).toBe(false);
  });
});

describe("createSpringLoad", () => {
  it("한 자리에 머문 시간이 쌓여야 연다 — 다시 걸어도 시계를 새로 걸지 않는다", () => {
    const c = fakeTimers();
    const s = createSpringLoad(600, c.timers);
    const fired: string[] = [];
    s.arm("a", () => fired.push("a"));
    c.advance(300);
    s.arm("a", () => fired.push("a"));
    c.advance(300);
    expect(fired).toEqual(["a"]);
    expect(s.armed).toBeNull();
  });

  it("다른 자리로 옮기면 앞의 것을 거둔다", () => {
    const c = fakeTimers();
    const s = createSpringLoad(600, c.timers);
    const fired: string[] = [];
    s.arm("a", () => fired.push("a"));
    c.advance(500);
    s.arm("b", () => fired.push("b"));
    c.advance(500);
    expect(fired).toEqual([]);
    c.advance(100);
    expect(fired).toEqual(["b"]);
  });

  it("disarm(key) 는 그 자리일 때만 · disarm() 은 무엇이든", () => {
    const c = fakeTimers();
    const s = createSpringLoad(600, c.timers);
    const fired: string[] = [];
    s.arm("a", () => fired.push("a"));
    s.disarm("b");
    expect(s.armed).toBe("a");
    s.disarm("a");
    expect(s.armed).toBeNull();
    s.arm("c", () => fired.push("c"));
    s.disarm();
    c.advance(1000);
    expect(fired).toEqual([]);
  });
});

describe("createToggleMotion", () => {
  it("방금 사람이 바꾼 자리만 움직인다", () => {
    let t = 0;
    const m = createToggleMotion(400, () => t);
    expect(m.allows("host:a")).toBe(false);
    m.mark("host:a");
    expect(m.allows("host:a")).toBe(true);
    expect(m.allows("host:b")).toBe(false);
    t = 401;
    expect(m.allows("host:a")).toBe(false);
  });
});
