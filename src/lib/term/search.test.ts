import { beforeEach, describe, expect, it, vi } from "vitest";

// addon-search 모형 — `findNext` 가 부를 때의 선택 · 캐시 비움을 적어 둔다(진짜 애드온은 선택이 있으면 그 자리부터 찾는다)
const calls: string[] = [];
/** 모형이 `findNext` 에서 고를 범위(진짜 애드온은 찾은 매치를 `select` 한 뒤 결과를 알린다) — `null` 이면 고르지 않는다 */
let addonPick: { col: number; row: number; len: number } | null = null;
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    term: { select(c: number, r: number, l: number): void } | null = null;
    cb: ((e: { resultIndex: number; resultCount: number }) => void) | null = null;
    activate(t: { select(c: number, r: number, l: number): void }) {
      this.term = t;
    }
    onDidChangeResults(cb: (e: { resultIndex: number; resultCount: number }) => void) {
      this.cb = cb;
      return { dispose() {} };
    }
    clearDecorations() {
      calls.push("clearDecorations");
    }
    findNext(term: string) {
      calls.push(`findNext ${term}`);
      if (addonPick) this.term?.select(addonPick.col, addonPick.row, addonPick.len);
      this.cb?.({ resultIndex: addonPick ? 0 : -1, resultCount: addonPick ? 1 : 0 });
      return true;
    }
    findPrevious() {
      return true;
    }
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { TermSearch } = await import("$lib/term/search");

/** 셀 배열로 만든 버퍼 줄 — 넓은 글자는 뒤에 폭 0 칸을 둔다(`cellColumns` 가 읽는 모양만) */
function fakeLine(cells: Array<{ ch: string; w: number }>) {
  return {
    length: cells.length,
    translateToString: () => cells.map((c) => c.ch).join(""),
    getCell(x: number, into?: { at: number }) {
      if (x < 0 || x >= cells.length) return undefined;
      const cell = into ?? { at: 0 };
      cell.at = x;
      return Object.assign(cell, {
        getWidth: () => cells[cell.at].w,
        getChars: () => cells[cell.at].ch,
      });
    },
  };
}
const ascii = (s: string) => [...s].map((ch) => ({ ch, w: 1 }));

function setup(lines: ReturnType<typeof fakeLine>[]) {
  // 선택은 한 줄짜리만 흉내 낸다(`getSelectionPosition` 의 0-기반 · 끝 미포함 모양)
  let sel: { start: { x: number; y: number }; end: { x: number; y: number } } | undefined;
  const select = vi.fn((col: number, row: number, len: number) => {
    calls.push(`select ${col},${row},${len}`);
    sel = { start: { x: col, y: row }, end: { x: col + len, y: row } };
  });
  const clearSelection = vi.fn(() => {
    sel = undefined;
  });
  const decorations: Array<Record<string, unknown> & { disposed: boolean }> = [];
  const term = {
    cols: 80,
    options: {},
    buffer: { active: { length: lines.length, baseY: 0, cursorY: 0, getLine: (i: number) => lines[i] } },
    loadAddon: (a: { activate?: (t: unknown) => void }) => a.activate?.(term),
    select,
    clearSelection,
    getSelectionPosition: () => sel,
    /** 사람이 마우스로 고른 것 — 애드온을 거치지 않는다 */
    mouseSelect: (x: number, y: number, len: number) => {
      sel = { start: { x, y }, end: { x: x + len, y } };
    },
    registerMarker: (line: number) => ({ line, dispose() {} }),
    registerDecoration: (o: Record<string, unknown>) => {
      const d = { ...o, disposed: false, dispose() { d.disposed = true; } };
      decorations.push(d);
      return d;
    },
    scrollToLine: vi.fn(),
  };
  const s = new TermSearch({ term: term as never, disposed: false, shell: null });
  s.attach(term as never);
  const target = s.target({ paneId: "p", name: () => "p", screenOnly: () => false });
  return { target, select, clearSelection, decorations, term, sel: () => sel };
}

beforeEach(() => {
  calls.length = 0;
  addonPick = null;
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("document", { documentElement: {} });
});

describe("TermSearch.highlight — 결과 점프는 고른 그 매치에서", () => {
  it("`at` 이 없으면 예전 그대로 — 선택 없이 맨 위부터(범위 모드 · Ctrl+F)", () => {
    const { target, select } = setup([fakeLine(ascii("PS> echo ALPHA")), fakeLine(ascii("ALPHA"))]);
    target.highlight(/ALPHA/);
    expect(select).not.toHaveBeenCalled();
    expect(calls).toEqual(["findNext ALPHA"]);
  });

  it("`at` 이면 캐시를 비우고 그 매치의 첫 칸을 선택한 뒤 찾는다 — 명령 줄이 아니라 출력 줄", () => {
    const { target } = setup([fakeLine(ascii("PS> echo ALPHA")), fakeLine(ascii("ALPHA"))]);
    const [, out] = target.scan(/ALPHA/, 10);
    expect(out).toMatchObject({ line: 1, col: 0 });
    target.highlight(/ALPHA/, out);
    expect(calls).toEqual(["clearDecorations", "select 0,1,1", "findNext ALPHA"]);
  });

  it("문자 인덱스를 셀 좌표로 옮긴다 — 넓은 글자 뒤", () => {
    // "한" 은 두 칸(뒷칸 폭 0) — 문자 인덱스 2 의 "A" 는 셀 3
    const cells = [{ ch: "한", w: 2 }, { ch: "", w: 0 }, { ch: " ", w: 1 }, ...ascii("ALPHA")];
    const { target } = setup([fakeLine(cells)]);
    const [hit] = target.scan(/ALPHA/, 10);
    expect(hit.col).toBe(2);
    target.highlight(/ALPHA/, hit);
    expect(calls).toContain("select 3,0,1");
  });

  it("그 줄이 이제 없으면 고르지 않고 맨 위부터", () => {
    const { target, select } = setup([fakeLine(ascii("ALPHA"))]);
    target.highlight(/ALPHA/, { line: 5, col: 0 });
    expect(select).not.toHaveBeenCalled();
    expect(calls).toEqual(["findNext ALPHA"]);
  });
});

describe("TermSearch — 현재 매치는 위층에 · 지울 때 검색이 만든 선택도", () => {
  it("애드온이 고른 범위에 위층(top) 데코레이션을 그린다 — 선택이 아래층을 덮으므로", () => {
    addonPick = { col: 4, row: 1, len: 5 };
    const { target, decorations } = setup([fakeLine(ascii("PS> echo ALPHA")), fakeLine(ascii("out ALPHA"))]);
    target.highlight(/ALPHA/);
    expect(decorations).toHaveLength(1);
    expect(decorations[0]).toMatchObject({ x: 4, width: 5, layer: "top" });
    expect(decorations[0].backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(decorations[0].foregroundColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("지우면 위층을 걷고 검색이 만든 선택도 푼다", () => {
    addonPick = { col: 0, row: 0, len: 5 };
    const { target, decorations, clearSelection, sel } = setup([fakeLine(ascii("ALPHA"))]);
    target.highlight(/ALPHA/);
    target.clear();
    expect(decorations[0].disposed).toBe(true);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(sel()).toBeUndefined();
  });

  it("사람이 그 뒤 다른 곳을 마우스로 골랐으면 그 선택은 건드리지 않는다", () => {
    addonPick = { col: 0, row: 0, len: 5 };
    const { target, clearSelection, term, sel } = setup([fakeLine(ascii("ALPHA beta"))]);
    target.highlight(/ALPHA/);
    term.mouseSelect(6, 0, 4);
    target.clear();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(sel()).toEqual({ start: { x: 6, y: 0 }, end: { x: 10, y: 0 } });
  });

  it("매치가 없어 애드온이 고르지 않았으면 지울 때도 선택에 손대지 않는다", () => {
    const { target, clearSelection, decorations, term } = setup([fakeLine(ascii("beta"))]);
    term.mouseSelect(0, 0, 4);
    target.highlight(/ALPHA/);
    target.clear();
    expect(decorations).toHaveLength(0);
    expect(clearSelection).not.toHaveBeenCalled();
  });
});
