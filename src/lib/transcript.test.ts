import { describe, expect, it } from "vitest";
import { hiddenImageCount, pictureKey, userPictures, isViewKey, linkChip, mergeLatestPage, runningToolIndexes, parseInline, parseMarkdown, prependItems, toolFlag, toolHeadline, unwrapPasted } from "$lib/transcript";
import type { TranscriptItem } from "$lib/context";

describe("parseInline", () => {
  it("인라인 코드 · 굵게 · 글자", () => {
    expect(parseInline("run `git status` then **stop** now")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "git status" },
      { kind: "text", text: " then " },
      { kind: "strong", text: "stop" },
      { kind: "text", text: " now" },
    ]);
  });

  it("짝 없는 표식은 글자 그대로", () => {
    expect(parseInline("a ` b ** c")).toEqual([{ kind: "text", text: "a ` b ** c" }]);
  });

  it("긴 백틱 짝은 안의 백틱을 품는다", () => {
    expect(parseInline("x ``a ` b`` y")).toEqual([
      { kind: "text", text: "x " },
      { kind: "code", text: "a ` b" },
      { kind: "text", text: " y" },
    ]);
  });

  it("HTML 은 해석하지 않고 글자로 남긴다", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("parseMarkdown", () => {
  it("문단 · 제목 · 코드 블록 · 목록 · 인용 · 표 · 가로줄", () => {
    const md = [
      "# Plan",
      "",
      "First line",
      "second line with `code`",
      "",
      "```ts",
      "const a = 1;",
      "",
      "const b = `x`;",
      "```",
      "- one",
      "- two",
      "  continued",
      "  - nested",
      "",
      "3. three",
      "4. four",
      "",
      "> quoted",
      "> more",
      "",
      "| a | b |",
      "|---|---|",
      "",
      "---",
      "tail",
    ].join("\n");
    const b = parseMarkdown(md);
    expect(b.map((x) => x.kind)).toEqual(["h", "p", "code", "list", "list", "quote", "table", "hr", "p"]);
    expect(b[0]).toEqual({ kind: "h", level: 1, inlines: [{ kind: "text", text: "Plan" }] });
    expect(b[1]).toEqual({
      kind: "p",
      inlines: [
        { kind: "text", text: "First line\nsecond line with " },
        { kind: "code", text: "code" },
      ],
    });
    expect(b[2]).toEqual({ kind: "code", lang: "ts", text: "const a = 1;\n\nconst b = `x`;" });
    const list = b[3];
    expect(list.kind === "list" && list.items.map((i) => [i.depth, i.inlines.map((x) => x.text).join("")])).toEqual([
      [0, "one"],
      [0, "two\ncontinued"],
      [1, "nested"],
    ]);
    const ol = b[4];
    expect(ol.kind === "list" && [ol.ordered, ol.start, ol.items.length]).toEqual([true, 3, 2]);
    expect(b[5]).toEqual({ kind: "quote", blocks: [{ kind: "p", inlines: [{ kind: "text", text: "quoted\nmore" }] }] });
    // 구분 줄이 맞는 표는 격자로 (예전에는 고정폭 원문이었다)
    expect(b[6]).toEqual({
      kind: "table",
      align: [null, null],
      header: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]],
      rows: [],
    });
  });

  it("닫히지 않은 코드 블록은 끝까지", () => {
    expect(parseMarkdown("```\nabc\ndef")).toEqual([{ kind: "code", lang: "", text: "abc\ndef" }]);
  });

  it("CRLF · 빈 글", () => {
    expect(parseMarkdown("a\r\nb")).toEqual([{ kind: "p", inlines: [{ kind: "text", text: "a\nb" }] }]);
    expect(parseMarkdown("  \n\n")).toEqual([]);
  });
});

describe("toolHeadline · prependItems", () => {
  const tool = { summary: "git status", input: null, inputTruncated: false, output: null, outputTruncated: false, error: false };
  it("이름이 없으면 결과만의 항목", () => {
    expect(toolHeadline({ ...tool, name: "Bash" })).toEqual({ name: "Bash", summary: "git status" });
    expect(toolHeadline({ ...tool, name: "" })).toEqual({ name: null, summary: "git status" });
    // MCP 도구는 `서버 · 도구`(첫 `__` 에서 가른다)
    expect(toolHeadline({ ...tool, name: "mcp__tavily__search" }).name).toBe("tavily · search");
    expect(toolHeadline({ ...tool, name: "mcp__aynx-sessions__get_scrollback" }).name).toBe("aynx-sessions · get_scrollback");
    expect(toolHeadline({ ...tool, name: "mcp__odd" }).name).toBe("mcp__odd");
  });
  it("더 오래된 쪽이 앞에", () => {
    const it = (text: string): TranscriptItem => ({ role: "user", text, truncated: false, images: 0, tool: null, at: null });
    expect(prependItems([it("a")], [it("b"), it("c")]).map((x) => x.text)).toEqual(["a", "b", "c"]);
  });
});

describe("isViewKey", () => {
  const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing", boolean>> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });
  it("수식 없는 물리 V 만", () => {
    expect(isViewKey(ev("KeyV"))).toBe(true);
    expect(isViewKey(ev("KeyV", { ctrlKey: true }))).toBe(false);
    expect(isViewKey(ev("KeyV", { shiftKey: true }))).toBe(false);
    expect(isViewKey(ev("KeyV", { isComposing: true }))).toBe(false);
    expect(isViewKey(ev("KeyS"))).toBe(false);
  });
});

describe("mergeLatestPage (따라가기)", () => {
  const u = (text: string, at: number): TranscriptItem => ({ role: "user", text, truncated: false, images: 0, tool: null, at });
  const tool = (summary: string, at: number, output: string | null = null): TranscriptItem => ({
    role: "tool",
    text: null,
    truncated: false,
    images: 0,
    at,
    tool: { name: "Bash", summary, input: summary, inputTruncated: false, output, outputTruncated: false, error: false },
  });
  it("비었으면 그대로 받는다", () => {
    expect(mergeLatestPage([], [u("a", 1)])).toEqual({ at: 0, skip: 0 });
  });
  it("꼬리가 최신 쪽 앞과 겹치면 그 자리부터 갈아 끼운다", () => {
    expect(mergeLatestPage([u("a", 1), u("b", 2), u("c", 3)], [u("b", 2), u("c", 3), u("d", 4)])).toEqual({ at: 1, skip: 0 });
  });
  it("늦게 붙은 도구 결과도 같은 사건이다", () => {
    expect(mergeLatestPage([u("a", 1), tool("ls", 2)], [u("a", 1), tool("ls", 2, "x"), u("d", 4)])).toEqual({ at: 0, skip: 0 });
  });
  it("쪽 경계의 고아 결과는 건너뛴다", () => {
    const orphan: TranscriptItem = { ...tool("", 0), tool: { ...tool("", 0).tool!, name: "", input: null } };
    expect(mergeLatestPage([u("a", 1), u("b", 2)], [orphan, u("b", 2), u("c", 3)])).toEqual({ at: 1, skip: 1 });
  });
  it("같은 글이 되풀이돼도 가장 긴 겹침", () => {
    const cur = [u("a", 1), u("x", 2), u("b", 3), u("x", 2)];
    expect(mergeLatestPage(cur, [u("x", 2), u("b", 3), u("x", 2), u("d", 5)])).toEqual({ at: 1, skip: 0 });
  });
  it("겹침이 없으면 null (갈아 끼운다)", () => {
    expect(mergeLatestPage([u("a", 1)], [u("z", 9)])).toBeNull();
    expect(mergeLatestPage([u("a", 1)], [])).toBeNull();
  });
});

describe("runningToolIndexes (도는 도구)", () => {
  const u = (text: string): TranscriptItem => ({ role: "user", text, truncated: false, images: 0, tool: null, at: null });
  const tool = (output: string | null): TranscriptItem => ({
    role: "tool",
    text: null,
    truncated: false,
    images: 0,
    at: null,
    tool: { name: "Bash", summary: "x", input: "x", inputTruncated: false, output, outputTruncated: false, error: false },
  });
  it("끝의 도구 묶음에서 결과 없는 것만", () => {
    expect(runningToolIndexes([u("a"), tool("ok"), tool(null)])).toEqual([2]);
    expect(runningToolIndexes([u("a"), tool(null), tool(null)])).toEqual([1, 2]);
    expect(runningToolIndexes([u("a"), tool(null), tool("ok")])).toEqual([1]);
  });
  it("뒤에 말이 이어졌으면 끝난 것", () => {
    expect(runningToolIndexes([tool(null), u("b")])).toEqual([]);
    expect(runningToolIndexes([])).toEqual([]);
  });
});

describe("unwrapPasted", () => {
  it("짝 맞는 꼬리표와 안쪽 줄바꿈만 걷는다", () => {
    const w = '<pasted_content id="8d1c">\ntest\n줄넘김 테스트\n</pasted_content id="8d1c">';
    expect(unwrapPasted(w)).toBe("test\n줄넘김 테스트");
    expect(unwrapPasted(`앞 ${w} 뒤`)).toBe("앞 test\n줄넘김 테스트 뒤");
    expect(unwrapPasted('<pasted_content id="a">x</pasted_content id="b">')).toBe('<pasted_content id="a">x</pasted_content id="b">');
    expect(unwrapPasted("그냥 글")).toBe("그냥 글");
  });
});

describe("toolFlag · linkChip — 기록에서 다시 세운 표지(사이드 채팅)", () => {
  const tool = (over: Partial<TranscriptItem["tool"] & object> = {}) => ({
    name: "WebFetch",
    summary: "https://example.com",
    input: null,
    inputTruncated: false,
    output: "사용자가 거절했습니다",
    outputTruncated: false,
    error: true,
    ...over,
  });

  it("거절됨이 실패보다 앞선다 · 잘 끝났거나 결과가 없으면 표지 없음 · 옛 답(denied 칸 없음)은 예전 그대로", () => {
    expect(toolFlag(tool({ denied: true }))).toBe("denied");
    expect(toolFlag(tool({ denied: true, error: false }))).toBe("denied");
    expect(toolFlag(tool())).toBe("error");
    expect(toolFlag(tool({ denied: false, error: false }))).toBeNull();
    expect(toolFlag(tool({ error: false, output: null }))).toBeNull();
  });

  it("연결 칩 — 이름 · 이름 없음 · 끊음 · 머리글 없음(칩 없음) — 세션 id 는 문구에 없다", () => {
    expect(linkChip({ label: "p2 PowerShell 7" })).toEqual({ key: "board.viewer.link", label: "p2 PowerShell 7" });
    expect(linkChip({ label: "  " })).toEqual({ key: "board.viewer.link.bare", label: "" });
    expect(linkChip({ unlinked: true })).toEqual({ key: "board.viewer.unlinked", label: "" });
    expect(linkChip(null)).toBeNull();
    expect(linkChip(undefined)).toBeNull();
    expect(linkChip({})).toBeNull();
  });
});

describe("사람 말의 그림 자리", () => {
  const pic = (at: number, n: number) => ({ at, len: 50, n, mime: "image/png" });
  const user = (images: number, pictures?: ReturnType<typeof pic>[]): TranscriptItem => ({
    role: "user",
    text: "[Image #1]",
    truncated: false,
    images,
    pictures,
    tool: null,
    at: 1,
  });

  it("칩 = 자리 없는 그림 + 못 읽은 그림 · 그림을 그리지 않는 화면(시트)은 전부 칩", () => {
    const it2 = user(3, [pic(10, 0), pic(10, 2)]);
    expect(hiddenImageCount(it2, true, () => false)).toBe(1);
    expect(hiddenImageCount(it2, true, (p) => p.n === 2)).toBe(2);
    expect(hiddenImageCount(it2, false, () => false)).toBe(3);
    expect(hiddenImageCount(user(1), true, () => false)).toBe(1);
    expect(hiddenImageCount(user(0), true, () => false)).toBe(0);
  });

  it("보이는 사람 말의 자리만 · 겹치면 하나 · 열쇠는 줄 시작 · 길이 · 차례", () => {
    const a: TranscriptItem = { ...user(1, [pic(10, 0)]), role: "assistant" };
    expect(userPictures([user(2, [pic(10, 0), pic(10, 1)]), user(1, [pic(10, 0)]), a, user(1)])).toEqual([pic(10, 0), pic(10, 1)]);
    expect(pictureKey(pic(10, 1))).toBe("10:50:1");
  });
});
