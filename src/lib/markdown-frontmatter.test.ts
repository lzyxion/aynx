import { describe, expect, it } from "vitest";
import { headingLines, parseMarkdown, type MdBlock } from "$lib/markdown";
import { headingSlugs } from "$lib/doc-links";
import { outlineOf } from "$lib/doc-outline";
import { sectionLines } from "$lib/doc-edit-preview";

const FM = { frontmatter: true };
type Fm = Extract<MdBlock, { kind: "frontmatter" }>;

describe("parseMarkdown — 머리말", () => {
  it("맨 첫 줄 --- … --- 는 머리말 블록 — 단순 키: 값이면 항목", () => {
    const b = parseMarkdown("---\ntitle: Hello\ntags: [a, b]\nurl: https://x.y/z\n---\n# Body", FM);
    expect(b[0]).toEqual({
      kind: "frontmatter",
      format: "yaml",
      text: "title: Hello\ntags: [a, b]\nurl: https://x.y/z",
      count: 3,
      entries: [
        { key: "title", value: "Hello" },
        { key: "tags", value: "[a, b]" },
        { key: "url", value: "https://x.y/z" },
      ],
    });
    expect(b[1]).toMatchObject({ kind: "h", level: 1 });
    expect(b).toHaveLength(2);
  });

  it("닫는 줄은 ... 도 된다 · 따옴표 값은 한 겹 뗀다 · 주석과 빈 줄은 건너뛴다 · CRLF", () => {
    const b = parseMarkdown("---\r\n# 주석\r\n\r\nname: \"x y\"\r\n...\r\ntext", FM);
    const fm = b[0] as Fm;
    expect(fm.entries).toEqual([{ key: "name", value: "x y" }]);
    expect(fm.count).toBe(1);
    expect(b[1]).toMatchObject({ kind: "p" });
  });

  it("중첩 · 목록 · 여러 줄 값이면 항목 없이 원문만", () => {
    for (const body of ["a: 1\nnested:\n  b: 2", "list:\n- x\n- y", "desc: |\n  long\n  text"]) {
      const fm = parseMarkdown(`---\n${body}\n---`, FM)[0] as Fm;
      expect(fm.kind).toBe("frontmatter");
      expect(fm.text).toBe(body);
      expect(fm.entries).toBeUndefined();
    }
  });

  it("TOML +++ … +++", () => {
    const fm = parseMarkdown('+++\ntitle = "T"\ndraft = false\n+++\nbody', FM)[0] as Fm;
    expect(fm).toMatchObject({ format: "toml", count: 2, entries: [{ key: "title", value: "T" }, { key: "draft", value: "false" }] });
    const nested = parseMarkdown("+++\n[params]\nx = 1\n+++", FM)[0] as Fm;
    expect(nested.entries).toBeUndefined();
  });

  it("맨 앞이 아니거나 닫지 않았으면 예전 그대로(가로줄 · 밑줄식 제목)", () => {
    expect(parseMarkdown("\n---\na: 1\n---", FM)[0]).toEqual({ kind: "hr" });
    expect(parseMarkdown("---\na: 1\nno close", FM)[0]).toEqual({ kind: "hr" });
    expect(parseMarkdown("text\n---\na: 1\n---", FM)[0]).toMatchObject({ kind: "h", level: 2 });
  });

  it("선택을 켜지 않으면(기록 보기) 머리말을 떼지 않는다", () => {
    expect(parseMarkdown("---\na: 1\n---")[0]).toEqual({ kind: "hr" });
  });

  it("BOM 이 앞에 있어도 머리말", () => {
    expect(parseMarkdown("﻿---\na: 1\n---\n", FM)[0]).toMatchObject({ kind: "frontmatter", count: 1 });
  });
});

describe("머리말 속 # 줄은 제목이 아니다 — 목차 · 앵커 · 줄↔절이 같이", () => {
  const src = "---\ntitle: x\n# not a heading\n---\n\n# Real\n\n## Two\n";

  it("블록 · 목차 · 앵커", () => {
    const b = parseMarkdown(src, FM);
    expect(b.filter((x) => x.kind === "h")).toHaveLength(2);
    expect(outlineOf(b).map((o) => o.slug)).toEqual(["real", "two"]);
    expect([...headingSlugs(b).values()]).toEqual(["real", "two"]);
  });

  it("headingLines — 같은 선택이면 머리말을 건너뛰고 원문 줄 번호는 그대로", () => {
    expect(headingLines(src, FM)).toEqual([
      { line: 5, quoted: false },
      { line: 7, quoted: false },
    ]);
  });

  it("sectionLines — 머리말을 뗀 블록이면 원문 쪽도 떼어 짝이 맞는다", () => {
    const b = parseMarkdown(src, FM);
    expect(sectionLines(src, b)).toEqual([
      { line: 5, slug: "real" },
      { line: 7, slug: "two" },
    ]);
  });

  it("체크박스 줄 번호도 원문 기준", () => {
    const b = parseMarkdown("---\na: 1\n---\n- [ ] t", FM);
    const list = b[1] as Extract<MdBlock, { kind: "list" }>;
    expect(list.items[0].line).toBe(3);
  });
});
