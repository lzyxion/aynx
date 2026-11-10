import { describe, expect, it } from "vitest";
import { exportCsv, exportFileName, exportJson, exportMarkdown, exportSlice, jsonKeys, rangeCells } from "./export";
import type { Cell, DbColumn } from "./query-backend";

const cols: DbColumn[] = [
  { name: "id", type: "int4" },
  { name: "name", type: "text" },
  { name: "ok", type: "bool" },
];
const rows: Cell[][] = [
  [1, 'a,"b"', true],
  [2, null, false],
  ["9007199254740993", "x\ny|z", null],
];

describe("내보내기 변환", () => {
  it("CSV — RFC 4180 인용 · CRLF · NULL 빈 칸 · BOM 은 파일만", () => {
    const csv = exportCsv({ columns: cols, rows }, false);
    expect(csv).toBe('id,name,ok\r\n1,"a,""b""",true\r\n2,,false\r\n9007199254740993,"x\ny|z",\r\n');
    expect(exportCsv({ columns: cols, rows: [] }, true)).toBe("﻿id,name,ok\r\n");
  });

  it("JSON — 행 객체 · null · 숫자 · 불리언 · 큰 정수는 글자 · 바이트는 내보낼 글자", () => {
    const parsed = JSON.parse(exportJson({ columns: cols, rows }));
    expect(parsed).toEqual([
      { id: 1, name: 'a,"b"', ok: true },
      { id: 2, name: null, ok: false },
      { id: "9007199254740993", name: "x\ny|z", ok: null },
    ]);
    const b = JSON.parse(exportJson({ columns: [{ name: "b", type: "" }], rows: [[{ $bytes: 2, hex: "abcd" }], [{ $bytes: 9, hex: "00" }]] }));
    expect(b).toEqual([{ b: "0xabcd" }, { b: "‹bytes 9›" }]);
  });

  it("JSON 키 — 겹치면 _2 · _3(이미 있는 이름은 건너뛴다)", () => {
    const c = (name: string) => ({ name, type: "" });
    expect(jsonKeys([c("a"), c("a"), c("a")])).toEqual(["a", "a_2", "a_3"]);
    expect(jsonKeys([c("a"), c("a"), c("a_2")])).toEqual(["a", "a_3", "a_2"]);
  });

  it("Markdown — | 이스케이프 · 줄바꿈은 빈칸 · NULL", () => {
    expect(exportMarkdown({ columns: cols, rows: [rows[2]] })).toBe("| id | name | ok |\n| --- | --- | --- |\n| 9007199254740993 | x y\\|z | NULL |\n");
  });

  it("고른 범위만 — 사각형 · 밖으로 나간 모서리는 잘림 · 칸 수", () => {
    const s = exportSlice(cols, rows, { r0: 1, c0: 1, r1: 9, c1: 9 });
    expect(s.columns.map((c) => c.name)).toEqual(["name", "ok"]);
    expect(s.rows).toEqual([
      [null, false],
      ["x\ny|z", null],
    ]);
    expect(exportSlice(cols, rows, null).rows).toBe(rows);
    expect(rangeCells(null)).toBe(0);
    expect(rangeCells({ r0: 0, c0: 0, r1: 1, c1: 2 })).toBe(6);
  });

  it("파일 이름 — 이름-날짜.확장자", () => {
    const at = new Date(2026, 10, 10, 9, 5);
    expect(exportFileName("users", "json", at)).toBe("users-20261110-0905.json");
    expect(exportFileName("a/b", "csv", at)).toBe("a_b-20261110-0905.csv");
  });
});
