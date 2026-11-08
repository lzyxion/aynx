import { describe, expect, it } from "vitest";
import {
  cellStyle,
  coalesceRow,
  isBlankSnapshot,
  paletteColor,
  rgbHex,
  snapshotScreen,
  thumbTail,
  blockPreview,
  previewLines,
  stripAnsi,
  PREVIEW_LINES,
  DEFAULT_BG,
  DEFAULT_FG,
  SNAPSHOT_MAX_COLS,
  SNAPSHOT_MAX_ROWS,
  type CellStyle,
  type ThumbBuffer,
  type ThumbCell,
  type ThumbTheme,
} from "$lib/screen-thumb";

// ---------------------------------------------------------------------------
// 화면 축소판 (docs/log/2026-09-29-session-chips.md 의 "미리 보기: 화면 축소판" · 2026-09-29-dashboard-thumbs.md)
// ---------------------------------------------------------------------------

interface FakeSpec {
  ch?: string;
  width?: number;
  fg?: ["rgb" | "pal", number];
  bg?: ["rgb" | "pal", number];
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
  invisible?: boolean;
}

function cell(spec: FakeSpec = {}): ThumbCell {
  return {
    getChars: () => spec.ch ?? "",
    getWidth: () => spec.width ?? 1,
    getFgColor: () => spec.fg?.[1] ?? 0,
    getBgColor: () => spec.bg?.[1] ?? 0,
    isFgRGB: () => spec.fg?.[0] === "rgb",
    isFgPalette: () => spec.fg?.[0] === "pal",
    isBgRGB: () => spec.bg?.[0] === "rgb",
    isBgPalette: () => spec.bg?.[0] === "pal",
    isBold: () => (spec.bold ? 1 : 0),
    isDim: () => (spec.dim ? 1 : 0),
    isInverse: () => (spec.inverse ? 1 : 0),
    isInvisible: () => (spec.invisible ? 1 : 0),
  };
}

/** 줄마다 칸 명세 → 가짜 버퍼 */
function buffer(lines: FakeSpec[][], viewportY = 0): ThumbBuffer {
  return {
    viewportY,
    length: lines.length,
    getLine: (y) => {
      const row = lines[y];
      if (!row) return undefined;
      return { length: row.length, getCell: (x) => (row[x] ? cell(row[x]) : undefined) };
    },
    getNullCell: () => cell(),
  };
}

const text = (s: string, over: FakeSpec = {}): FakeSpec[] => [...s].map((ch) => ({ ch, ...over }));

const THEME: ThumbTheme = {
  foreground: "#c0c0c0",
  background: "#101010",
  red: "#ff0000",
  brightRed: "#ff8080",
  green: "#00ff00",
};
const DEF = { fg: "#c0c0c0", bg: "#101010" };
const plain: CellStyle = { fg: null, bg: null, bold: false, dim: false };

describe("paletteColor · rgbHex — 색 풀기", () => {
  it("0–15 는 테마의 16색, 비워 둔 칸은 xterm 기본", () => {
    expect(paletteColor(1, THEME)).toBe("#ff0000");
    expect(paletteColor(9, THEME)).toBe("#ff8080");
    expect(paletteColor(4, THEME)).toBe("#3465a4");
    expect(paletteColor(15, {})).toBe("#eeeeec");
  });
  it("16–231 은 6×6×6 정육면체, 232–255 는 회색, extendedAnsi 가 있으면 그것", () => {
    expect(paletteColor(16, {})).toBe("#000000");
    expect(paletteColor(196, {})).toBe("#ff0000");
    expect(paletteColor(21, {})).toBe("#0000ff");
    expect(paletteColor(231, {})).toBe("#ffffff");
    expect(paletteColor(232, {})).toBe("#080808");
    expect(paletteColor(255, {})).toBe("#eeeeee");
    expect(paletteColor(16, { extendedAnsi: ["#123456"] })).toBe("#123456");
  });
  it("RGB 는 #rrggbb", () => {
    expect(rgbHex(0x0a0b0c)).toBe("#0a0b0c");
    expect(rgbHex(0xff8800)).toBe("#ff8800");
  });
});

describe("cellStyle — 칸 모양", () => {
  it("기본색은 null, 팔레트 · RGB 는 색 글자", () => {
    expect(cellStyle(cell({ ch: "a" }), THEME, DEF)).toEqual(plain);
    expect(cellStyle(cell({ fg: ["pal", 2], bg: ["rgb", 0x112233] }), THEME, DEF)).toEqual({
      fg: "#00ff00",
      bg: "#112233",
      bold: false,
      dim: false,
    });
  });
  it("굵게 + 0–7 은 밝은 색으로 · 흐림도 싣는다", () => {
    expect(cellStyle(cell({ fg: ["pal", 1], bold: true }), THEME, DEF)).toEqual({
      fg: "#ff8080",
      bg: null,
      bold: true,
      dim: false,
    });
    expect(cellStyle(cell({ dim: true }), THEME, DEF).dim).toBe(true);
  });
  it("반전은 글자색과 바탕색을 맞바꾼다 — 기본색이면 판의 기본색을 적어서", () => {
    expect(cellStyle(cell({ inverse: true }), THEME, DEF)).toEqual({ fg: "#101010", bg: "#c0c0c0", bold: false, dim: false });
    expect(cellStyle(cell({ inverse: true, fg: ["pal", 1] }), THEME, DEF)).toEqual({
      fg: "#101010",
      bg: "#ff0000",
      bold: false,
      dim: false,
    });
    expect(cellStyle(cell({ inverse: true, bg: ["rgb", 0x000080] }), THEME, DEF)).toEqual({
      fg: "#000080",
      bg: "#c0c0c0",
      bold: false,
      dim: false,
    });
  });
});

describe("coalesceRow — 토막 잇기", () => {
  const red: CellStyle = { ...plain, fg: "#ff0000" };
  const barBg: CellStyle = { ...plain, bg: "#333333" };
  it("이웃한 같은 모양을 잇는다", () => {
    const row = [..."ab"].map((ch) => ({ ch, style: plain })).concat([..."cd"].map((ch) => ({ ch, style: red })));
    expect(coalesceRow(row)).toEqual([
      { text: "ab", fg: null, bg: null, bold: false, dim: false },
      { text: "cd", fg: "#ff0000", bg: null, bold: false, dim: false },
    ]);
  });
  it("줄 끝의 기본 바탕 공백은 떼고, 색 바탕 공백은 둔다", () => {
    const tail = [..."x   "].map((ch) => ({ ch, style: plain }));
    expect(coalesceRow(tail).map((r) => r.text)).toEqual(["x"]);
    const colored = [{ ch: "x", style: plain }, ...[..."  "].map((ch) => ({ ch, style: barBg }))];
    expect(coalesceRow(colored).map((r) => [r.text, r.bg])).toEqual([
      ["x", null],
      ["  ", "#333333"],
    ]);
    // 빨간 글자색의 공백도 바탕이 기본이면 그릴 것이 없다
    const redTail = [{ ch: "y", style: plain }, { ch: " ", style: red }, { ch: " ", style: plain }];
    expect(coalesceRow(redTail).map((r) => r.text)).toEqual(["y"]);
    expect(coalesceRow([{ ch: " ", style: plain }])).toEqual([]);
  });
});

describe("snapshotScreen — 보이는 화면 한 장", () => {
  it("viewportY 부터 rows 줄 · 빈 칸은 공백 · 넓은 글자의 뒤 칸은 건너뛴다", () => {
    const buf = buffer(
      [
        text("old"),
        [...text("$ "), ...text("ls", { fg: ["pal", 2] })],
        [{ ch: "한", width: 2 }, { ch: "", width: 0 }, { ch: "" }, { ch: "b" }],
        [],
      ],
      1,
    );
    const snap = snapshotScreen(buf, { cols: 80, rows: 3 }, THEME);
    expect([snap.cols, snap.rows, snap.fg, snap.bg]).toEqual([80, 3, "#c0c0c0", "#101010"]);
    expect(snap.lines.map((runs) => runs.map((r) => [r.text, r.fg]))).toEqual([
      [
        ["$ ", null],
        ["ls", "#00ff00"],
      ],
      [["한 b", null]],
      [],
    ]);
  });
  it("버퍼 끝을 넘는 줄은 빈 줄 · 숨김 글자는 공백", () => {
    const snap = snapshotScreen(buffer([[{ ch: "s", invisible: true }, { ch: "!" }]]), { cols: 10, rows: 2 }, {});
    expect(snap.lines.map((runs) => runs.map((r) => r.text))).toEqual([[" !"], []]);
    expect([snap.fg, snap.bg]).toEqual([DEFAULT_FG, DEFAULT_BG]);
  });
  it("상한 — 칸은 왼쪽부터, 줄은 아래쪽(최근)부터", () => {
    const tall = Array.from({ length: 100 }, (_, i) => text(`${i}`.padEnd(250, "x")));
    const snap = snapshotScreen(buffer(tall), { cols: 250, rows: 100 }, {});
    expect([snap.cols, snap.rows]).toEqual([SNAPSHOT_MAX_COLS, SNAPSHOT_MAX_ROWS]);
    expect(snap.lines[0][0].text.startsWith("40x")).toBe(true);
    expect(snap.lines.at(-1)?.[0].text.length).toBe(SNAPSHOT_MAX_COLS);
  });
  it("isBlankSnapshot — 글자도 색 바탕도 없으면 비었다", () => {
    expect(isBlankSnapshot(snapshotScreen(buffer([text("   "), []]), { cols: 5, rows: 2 }, {}))).toBe(true);
    expect(isBlankSnapshot(snapshotScreen(buffer([[{ ch: " ", bg: ["pal", 4] }]]), { cols: 5, rows: 1 }, {}))).toBe(false);
    expect(isBlankSnapshot(snapshotScreen(buffer([text("a")]), { cols: 5, rows: 1 }, {}))).toBe(false);
  });
});

describe("thumbTail — 카드 높이에 들 줄들", () => {
  it("꼬리의 빈 줄을 떼고 마지막 max 줄 — 짧은 화면은 위에서부터", () => {
    const shot = snapshotScreen(buffer([text("a"), text("b"), text("c"), [], text("  ")]), { cols: 5, rows: 6 }, {});
    expect(thumbTail(shot, 10).map((r) => r.map((x) => x.text).join(""))).toEqual(["a", "b", "c"]);
    expect(thumbTail(shot, 2).map((r) => r.map((x) => x.text).join(""))).toEqual(["b", "c"]);
  });
  it("색 바탕 공백 줄은 그림이라 남긴다 · 가운데 빈 줄도 남긴다", () => {
    const shot = snapshotScreen(buffer([text("a"), [], [{ ch: " ", bg: ["pal", 4] }]]), { cols: 5, rows: 3 }, {});
    expect(thumbTail(shot, 10).length).toBe(3);
  });
  it("빈 화면이면 빈 배열", () => {
    expect(thumbTail(snapshotScreen(buffer([[], []]), { cols: 5, rows: 2 }, {}), 10)).toEqual([]);
  });
});

describe("stripAnsi · previewLines — 마지막 화면 줄", () => {
  it("CSI · OSC · 문자 집합 · 제어 문자를 걷고 탭은 공백", () => {
    expect(stripAnsi("\x1b[1;32mok\x1b[0m done")).toBe("ok done");
    expect(stripAnsi("\x1b]0;title\x07$ ls\x1b]133;B\x1b\\")).toBe("$ ls");
    expect(stripAnsi("\x1b(Bplain\x1b=\x07\x08")).toBe("plain");
    expect(stripAnsi("a\tb")).toBe("a b");
    expect(stripAnsi("한글 그대로")).toBe("한글 그대로");
  });

  it("꼬리 빈 줄을 떼고 마지막 다섯 줄만, 오른쪽 여백도 뗀다", () => {
    const lines = ["1", "2", "3", "4", "5", "6", "7   ", "", "", ""];
    expect(previewLines(lines)).toEqual(["3", "4", "5", "6", "7"]);
    expect(PREVIEW_LINES).toBe(5);
  });

  it("가운데 빈 줄은 두고, 잘린 앞머리의 빈 줄은 뗀다", () => {
    expect(previewLines(["a", "", "b", "", "c", "d", "e"], 5)).toEqual(["b", "", "c", "d", "e"]);
    expect(previewLines(["x", "", "y", "z"], 3)).toEqual(["y", "z"]);
  });

  it("한 항목 안의 줄바꿈도 줄로 센다 · 비었으면 빈 배열", () => {
    expect(previewLines(["a\r\nb\nc"])).toEqual(["a", "b", "c"]);
    expect(previewLines(["", "  ", ""])).toEqual([]);
  });

  it("blockPreview — `$ 명령` + 발췌 머리 · 꼬리, 블록이 없으면 빈 배열", () => {
    expect(blockPreview({ commandLine: "make", excerpt: { head: ["h1"], tail: ["t1", "t2"] } })).toEqual([
      "$ make",
      "h1",
      "t1",
      "t2",
    ]);
    expect(blockPreview({ commandLine: " ", excerpt: { head: [], tail: ["x"] } })).toEqual(["x"]);
    expect(blockPreview(null)).toEqual([]);
  });
});
