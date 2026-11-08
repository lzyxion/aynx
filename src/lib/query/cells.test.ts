import { describe, expect, it } from "vitest";
import {
  cellDisplay,
  cellExport,
  cellKind,
  csvField,
  csvFileName,
  normRange,
  rangeTsv,
  toCsv,
  tsvField,
  windowRange,
} from "./cells";
import type { Cell, DbColumn } from "./query-backend";

describe("칸 글자 — 표 · 내보내기", () => {
  it("표: NULL · 참거짓 · 숫자 · 큰 정수(문자열) · 바이트", () => {
    expect(cellDisplay(null)).toBe("NULL");
    expect(cellKind(null)).toBe("null");
    expect(cellDisplay(true)).toBe("true");
    expect(cellDisplay(1.5)).toBe("1.5");
    expect(cellDisplay("9007199254740993")).toBe("9007199254740993");
    expect(cellDisplay({ $bytes: 3, hex: "616263" })).toBe("‹bytes 3›");
    expect(cellKind({ $bytes: 0, hex: "" })).toBe("bytes");
  });

  it("내보내기: NULL 은 null · 다 온 바이트는 0x16진 · 잘린 바이트는 ‹bytes N›", () => {
    expect(cellExport(null)).toBeNull();
    expect(cellExport({ $bytes: 2, hex: "beef" })).toBe("0xbeef");
    expect(cellExport({ $bytes: 100, hex: "00".repeat(64) })).toBe("‹bytes 100›");
    expect(cellExport(false)).toBe("false");
  });
});

describe("CSV — RFC 4180 · BOM · NULL", () => {
  it("쉼표 · 따옴표 · 줄바꿈이 든 칸만 감싸고, 빈 글자는 \"\" · NULL 은 빈 칸", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("a\rb")).toBe('"a\rb"');
    expect(csvField("")).toBe('""');
    expect(csvField(null)).toBe("");
  });

  it("BOM + 머리줄 + CRLF + 끝 줄바꿈", () => {
    const cols: DbColumn[] = [
      { name: "id", type: "integer" },
      { name: "na,me", type: "text" },
      { name: "b", type: "blob" },
    ];
    const rows: Cell[][] = [
      [1, "x", null],
      [2, null, { $bytes: 1, hex: "ff" }],
    ];
    expect(toCsv(cols, rows)).toBe('﻿id,"na,me",b\r\n1,x,\r\n2,,0xff\r\n');
  });
});

describe("TSV — 고른 사각형 복사", () => {
  const cols: DbColumn[] = [
    { name: "a", type: "" },
    { name: "b", type: "" },
    { name: "c", type: "" },
  ];
  const rows: Cell[][] = [
    [1, "x\ty", null],
    [2, 'q"', true],
    [3, "z", false],
  ];
  it("탭 · 줄바꿈 · 따옴표가 든 칸만 감싼다", () => {
    expect(tsvField("a\tb")).toBe('"a\tb"');
    expect(tsvField(null)).toBe("");
    expect(tsvField("ok")).toBe("ok");
  });
  it("사각형(역방향 모서리도 정렬) · 머리줄 선택 · 표 밖은 자른다", () => {
    const r = normRange({ r: 1, c: 2 }, { r: 0, c: 1 });
    expect(r).toEqual({ r0: 0, c0: 1, r1: 1, c1: 2 });
    expect(rangeTsv(cols, rows, r)).toBe('"x\ty"\t\r\n"q"""\ttrue');
    expect(rangeTsv(cols, rows, { r0: 2, c0: 0, r1: 9, c1: 9 }, true)).toBe("a\tb\tc\r\n3\tz\tfalse");
  });
});

describe("이름 · 가상 스크롤", () => {
  it("CSV 파일 이름 — 금지 글자는 _ · 비면 query", () => {
    const at = new Date(2026, 9, 12, 9, 5);
    expect(csvFileName("app.db · 내 PC", at)).toBe("app.db · 내 PC-20261012-0905.csv");
    expect(csvFileName('a/b:c"', at)).toBe("a_b_c_-20261012-0905.csv");
    expect(csvFileName("  ", at)).toBe("query-20261012-0905.csv");
  });

  it("windowRange — 보이는 줄 ± overscan, 끝에서 자른다", () => {
    expect(windowRange(0, 100, 20, 10_000, 2)).toEqual({ first: 0, last: 7 });
    expect(windowRange(2000, 100, 20, 10_000, 2)).toEqual({ first: 98, last: 107 });
    expect(windowRange(199_900, 200, 20, 10_000, 8)).toEqual({ first: 9987, last: 10_000 });
    expect(windowRange(0, 100, 20, 0)).toEqual({ first: 0, last: 0 });
  });
});
