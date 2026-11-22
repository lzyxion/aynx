import { describe, expect, it } from "vitest";
import type { PaneNode, PaneSpec, SplitDir, TabSpec } from "$lib/session/spec";
import { mirrorLayoutChange } from "./layout-change";

// 원격 창의 배치 애니메이션 문 — 메인 PC 가 `withLayoutAnim` 을 지나는 구조 조작에만 켠다.

const term = (id: string): PaneSpec => ({ id, kind: "local" });
const doc = (id: string): PaneSpec => ({ id, kind: "doc", path: `C:/n/${id}.md` });
const start = (id: string): PaneSpec => ({ id, kind: "start" });

const leaf = (pane: PaneSpec): PaneNode => ({ type: "leaf", pane });
const split = (a: PaneNode, b: PaneNode, ratio = 0.5, dir: SplitDir = "row"): PaneNode => ({ type: "split", dir, ratio, a, b });

const tab = (id: string, root: PaneNode, zoom?: string): TabSpec => ({ id, title: id, root, ...(zoom ? { zoomedPaneId: zoom } : {}) });

const none = { animate: false, closed: null, docSwaps: [] };

describe("mirrorLayoutChange", () => {
  const two = [tab("t1", split(leaf(term("a")), leaf(term("b"))))];

  it("does nothing on the first snapshot", () => {
    expect(mirrorLayoutChange([], two)).toEqual(none);
  });

  it("does nothing when nothing changed", () => {
    expect(mirrorLayoutChange(two, [tab("t1", split(leaf(term("a")), leaf(term("b"))))])).toEqual(none);
  });

  it("ignores a ratio-only change (home dragged the divider)", () => {
    expect(mirrorLayoutChange(two, [tab("t1", split(leaf(term("a")), leaf(term("b")), 0.3))])).toEqual(none);
  });

  it("ignores title and focus-only changes", () => {
    expect(mirrorLayoutChange(two, [{ ...tab("t1", split(leaf(term("a")), leaf(term("b")))), title: "renamed" }])).toEqual(none);
  });

  it("animates a split that adds a tile, without a ghost", () => {
    const next = [tab("t1", split(leaf(term("a")), split(leaf(term("b")), leaf(term("c")), 0.5, "col")))];
    expect(mirrorLayoutChange(two, next)).toEqual({ animate: true, closed: null, docSwaps: [] });
  });

  it("animates a closed tile and names it for the ghost", () => {
    const three = [tab("t1", split(leaf(term("a")), split(leaf(term("b")), leaf(term("c")))))];
    expect(mirrorLayoutChange(three, two)).toEqual({ animate: true, closed: "c", docSwaps: [] });
  });

  it("does nothing when a whole tab disappears", () => {
    const prev = [...two, tab("t2", leaf(term("x")))];
    expect(mirrorLayoutChange(prev, two)).toEqual(none);
  });

  it("animates two tiles swapping places", () => {
    expect(mirrorLayoutChange(two, [tab("t1", split(leaf(term("b")), leaf(term("a"))))])).toEqual({
      animate: true,
      closed: null,
      docSwaps: [],
    });
  });

  it("animates a tile moved to another tab, but it is not a close", () => {
    const prev = [...two, tab("t2", leaf(term("x")))];
    const next = [tab("t1", leaf(term("a"))), tab("t2", split(leaf(term("x")), leaf(term("b"))))];
    expect(mirrorLayoutChange(prev, next)).toEqual({ animate: true, closed: null, docSwaps: [] });
  });

  it("swaps doc → doc without animating", () => {
    const prev = [tab("t1", split(leaf(term("a")), leaf(doc("d1"))))];
    const next = [tab("t1", split(leaf(term("a")), leaf(doc("d2")), 0.4))];
    expect(mirrorLayoutChange(prev, next)).toEqual({ animate: false, closed: null, docSwaps: ["d2"] });
  });

  it("animates replacing a doc with a terminal", () => {
    const prev = [tab("t1", split(leaf(term("a")), leaf(doc("d1"))))];
    const next = [tab("t1", split(leaf(term("a")), leaf(term("s1"))))];
    expect(mirrorLayoutChange(prev, next)).toEqual({ animate: true, closed: null, docSwaps: [] });
  });

  it("animates a new tab with a tile", () => {
    expect(mirrorLayoutChange(two, [...two, tab("t2", leaf(term("x")))]).animate).toBe(true);
  });

  it("does not animate a new tab that is a lone start tile", () => {
    expect(mirrorLayoutChange(two, [...two, tab("t2", leaf(start("s")))])).toEqual(none);
  });

  it("animates a zoom change (following home's maximise)", () => {
    expect(mirrorLayoutChange(two, [tab("t1", split(leaf(term("a")), leaf(term("b"))), "a")]).animate).toBe(true);
    expect(mirrorLayoutChange([tab("t1", split(leaf(term("a")), leaf(term("b"))), "a")], two).animate).toBe(true);
  });

  it("gives no ghost when two tiles closed at once", () => {
    const prev = [tab("t1", split(leaf(term("a")), split(leaf(term("b")), leaf(term("c"))))), tab("t2", split(leaf(term("x")), leaf(term("y"))))];
    const next = [tab("t1", split(leaf(term("a")), leaf(term("b")))), tab("t2", leaf(term("x")))];
    expect(mirrorLayoutChange(prev, next)).toEqual({ animate: true, closed: null, docSwaps: [] });
  });
});
