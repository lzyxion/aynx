import { describe, expect, it } from "vitest";
import { FS_DRAG_TYPE } from "$lib/fs-drag";
import { PANE_DRAG_TYPE, QUERY_SCRIPT_TITLE_MAX, TAB_DRAG_TYPE } from "$lib/session";
import { HOSTS_DRAG_TYPE } from "$lib/hosts";
import { TEAR_DRAG_TYPE } from "$lib/tear";
import { addTab } from "./script-tabs";
import { SQL_FILE_MAX_BYTES, fileBaseName, isSqlFileName, scriptTitleOf, sqlDropAccepts, sqlFileVerdict, sqlSaveName } from "./sql-file";

describe("받는 파일", () => {
  it("확장자 .sql · .txt 만 — 대소문자 무관 · 경로여도", () => {
    expect(isSqlFileName("a.sql")).toBe(true);
    expect(isSqlFileName("REPORT.SQL")).toBe(true);
    expect(isSqlFileName("notes.Txt")).toBe(true);
    expect(isSqlFileName("C:\\work\\q.sql")).toBe(true);
    expect(isSqlFileName("/home/u/q.sql")).toBe(true);
    expect(isSqlFileName("a.csv")).toBe(false);
    expect(isSqlFileName("a.sql.bak")).toBe(false);
    expect(isSqlFileName(".sql")).toBe(false);
    expect(isSqlFileName("sql")).toBe(false);
  });

  it("판정 — 확장자 · 1 MiB · 잘림 · 이진", () => {
    expect(sqlFileVerdict({ name: "a.sql", size: SQL_FILE_MAX_BYTES })).toBe("ok");
    expect(sqlFileVerdict({ name: "a.sql", size: SQL_FILE_MAX_BYTES + 1 })).toBe("large");
    expect(sqlFileVerdict({ name: "a.sql", size: 10, truncated: true })).toBe("large");
    expect(sqlFileVerdict({ name: "a.sql", size: 10, binary: true })).toBe("binary");
    expect(sqlFileVerdict({ name: "a.png", size: 10 })).toBe("type");
  });
});

describe("탭 이름", () => {
  it("확장자 뺀 파일 이름", () => {
    expect(scriptTitleOf("C:\\q\\monthly report.sql")).toBe("monthly report");
    expect(scriptTitleOf("a.b.txt")).toBe("a.b");
    expect(fileBaseName("/x/y/z.sql")).toBe("z.sql");
  });

  it("상한에서 자르고, 비면 기본 이름(`undefined`)", () => {
    expect(scriptTitleOf("x".repeat(100) + ".sql")).toHaveLength(QUERY_SCRIPT_TITLE_MAX);
    expect(scriptTitleOf("  .sql")).toBeUndefined();
  });

  it("새 탭이 이름을 받는다(데이터 탭이 아니면)", () => {
    const r = addTab([{ n: 1, text: "" }], { text: "SELECT 1", title: "  정산 " });
    expect(r?.tabs[1]).toEqual({ n: 2, title: "정산", text: "SELECT 1" });
    expect(addTab([{ n: 1, text: "" }], { text: "x", title: "  " })?.tabs[1]).toEqual({ n: 2, text: "x" });
  });
});

describe("끌기 받기", () => {
  it("OS 파일 · 파일 타일 짐만 받는다", () => {
    expect(sqlDropAccepts(["Files"])).toBe(true);
    expect(sqlDropAccepts([FS_DRAG_TYPE, "text/plain"])).toBe(true);
    expect(sqlDropAccepts(["text/plain"])).toBe(false);
    expect(sqlDropAccepts(null)).toBe(false);
  });

  it("앱의 다른 끌기는 `Files` 가 끼어 있어도 손대지 않는다", () => {
    expect(sqlDropAccepts([PANE_DRAG_TYPE, "Files"])).toBe(false);
    expect(sqlDropAccepts([TAB_DRAG_TYPE, TEAR_DRAG_TYPE])).toBe(false);
    expect(sqlDropAccepts([HOSTS_DRAG_TYPE])).toBe(false);
    expect(sqlDropAccepts(["application/x-aynx-query-tab"])).toBe(false);
    expect(sqlDropAccepts([FS_DRAG_TYPE, PANE_DRAG_TYPE])).toBe(false);
  });
});

describe("저장 이름", () => {
  it("<탭 이름>.sql — Windows 금지 글자는 _", () => {
    expect(sqlSaveName("쿼리 1")).toBe("쿼리 1.sql");
    expect(sqlSaveName('a/b:c*?"<>|')).toBe("a_b_c______.sql");
    expect(sqlSaveName("  ")).toBe("query.sql");
    expect(sqlSaveName("end. ")).toBe("end.sql");
  });
});
