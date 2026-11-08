import { describe, expect, it } from "vitest";
import { taskCharOf, taskMarkOf, toggleTaskLine } from "$lib/doc-task";
import { parseMarkdown, type MdBlock } from "$lib/markdown";

describe("taskMarkOf — 체크박스 항목 줄", () => {
  it("목록 표식 · 들여쓰기 · 인용 표식 뒤의 상태 글자", () => {
    expect(taskMarkOf("- [ ] a")).toEqual({ col: 3, checked: false });
    expect(taskMarkOf("  * [x] a")).toEqual({ col: 5, checked: true });
    expect(taskMarkOf("12. [X] a")).toEqual({ col: 5, checked: true });
    expect(taskMarkOf("> > - [ ] a")).toEqual({ col: 7, checked: false });
    expect(taskMarkOf("- [ ]")).toEqual({ col: 3, checked: false });
  });

  it("체크박스가 아니면 null", () => {
    expect(taskMarkOf("- plain")).toBeNull();
    expect(taskMarkOf("[ ] a")).toBeNull();
    expect(taskMarkOf("- [ ]a")).toBeNull();
    expect(taskMarkOf("- [y] a")).toBeNull();
    expect(taskMarkOf("text - [ ] a")).toBeNull();
  });

  it("상태 글자 — 켜면 x · 끄면 공백", () => {
    expect(taskCharOf(true)).toBe("x");
    expect(taskCharOf(false)).toBe(" ");
  });
});

describe("toggleTaskLine — 그 줄 한 글자만", () => {
  it("켜고 끈다 — 다른 줄 · 줄 끝은 그대로", () => {
    expect(toggleTaskLine("# T\n- [ ] a\n- [x] b\n", 1, false)).toBe("# T\n- [x] a\n- [x] b\n");
    expect(toggleTaskLine("# T\n- [ ] a\n- [x] b\n", 2, true)).toBe("# T\n- [ ] a\n- [ ] b\n");
    expect(toggleTaskLine("- [X] a", 0, true)).toBe("- [ ] a");
  });

  it("CRLF · 홀로 선 CR 을 지킨다", () => {
    expect(toggleTaskLine("a\r\n- [ ] b\r\nc\r\n", 1, false)).toBe("a\r\n- [x] b\r\nc\r\n");
    expect(toggleTaskLine("a\r- [ ] b\rc", 1, false)).toBe("a\r- [x] b\rc");
  });

  it("기대한 모양이 아니면 거절", () => {
    expect(toggleTaskLine("- [ ] a", 0, true)).toBeNull(); // 이미 꺼져 있다
    expect(toggleTaskLine("- plain", 0, false)).toBeNull();
    expect(toggleTaskLine("- [ ] a", 1, false)).toBeNull(); // 없는 줄
    expect(toggleTaskLine("- [ ] a", -1, false)).toBeNull();
  });

  it("파서의 줄 번호와 맞물린다 — 인용 · 알림 · CRLF", () => {
    const src = "# T\r\n\r\n> - [ ] q\r\n\r\n> [!TIP]\r\n> - [x] t\r\n\r\n- [ ] top\r\n";
    const lines: { line: number; checked: boolean }[] = [];
    const walk = (bs: MdBlock[]) => {
      for (const b of bs) {
        if (b.kind === "quote" || b.kind === "alert") walk(b.blocks);
        else if (b.kind === "list") for (const it of b.items) if (it.line !== undefined) lines.push({ line: it.line, checked: !!it.checked });
      }
    };
    walk(parseMarkdown(src));
    expect(lines).toEqual([
      { line: 2, checked: false },
      { line: 5, checked: true },
      { line: 7, checked: false },
    ]);
    let text = src;
    for (const l of lines) {
      const next = toggleTaskLine(text, l.line, l.checked);
      expect(next).not.toBeNull();
      text = next!;
    }
    expect(text).toBe("# T\r\n\r\n> - [x] q\r\n\r\n> [!TIP]\r\n> - [ ] t\r\n\r\n- [x] top\r\n");
  });
});
