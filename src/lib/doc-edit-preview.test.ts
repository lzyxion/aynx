import { describe, expect, it } from "vitest";
import { headingLines, parseMarkdown } from "$lib/markdown";
import { headingSlugs } from "$lib/doc-links";
import { outlineOf } from "$lib/doc-outline";
import {
  DOC_SPLIT_DEFAULT,
  DOC_SPLIT_MAX,
  DOC_SPLIT_MIN,
  EDIT_WIDE_PX,
  clampDocSplit,
  isWideEdit,
  narrowTabOf,
  sectionAt,
  sectionLines,
  splitAt,
  syncTarget,
  visibleEditView,
} from "$lib/doc-edit-preview";

const sections = (src: string) => sectionLines(src, parseMarkdown(src));

describe("보이는 보기", () => {
  it("넓으면 고른 값 그대로, 좁으면 두 칸 탭의 값 — 고른 값은 건드리지 않는다", () => {
    expect(visibleEditView("split", EDIT_WIDE_PX, "source")).toBe("split");
    expect(visibleEditView("preview", 1200, "source")).toBe("preview");
    expect(visibleEditView("split", EDIT_WIDE_PX - 1, "source")).toBe("source");
    expect(visibleEditView("split", 500, "preview")).toBe("preview");
    expect(visibleEditView("source", 500, "preview")).toBe("preview");
  });

  it("폭을 못 쟀으면(0) 넓은 쪽", () => {
    expect(isWideEdit(0)).toBe(true);
    expect(isWideEdit(899)).toBe(false);
    expect(isWideEdit(900)).toBe(true);
  });

  it("좁은 탭의 처음 값 — 미리 보기만을 골랐으면 미리 보기, 아니면 원문", () => {
    expect(narrowTabOf("preview")).toBe("preview");
    expect(narrowTabOf("split")).toBe("source");
    expect(narrowTabOf("source")).toBe("source");
  });
});

describe("경계 비율", () => {
  it("20~80% 로 묶고 숫자가 아니면 반반", () => {
    expect(clampDocSplit(0.1)).toBe(DOC_SPLIT_MIN);
    expect(clampDocSplit(0.95)).toBe(DOC_SPLIT_MAX);
    expect(clampDocSplit(0.33)).toBe(0.33);
    expect(clampDocSplit(Number.NaN)).toBe(DOC_SPLIT_DEFAULT);
    expect(clampDocSplit("0.3")).toBe(DOC_SPLIT_DEFAULT);
  });

  it("손가락 자리 → 비율 · 폭을 못 쟀으면 반반", () => {
    expect(splitAt(400, 100, 1000)).toBeCloseTo(0.3);
    expect(splitAt(0, 100, 1000)).toBe(DOC_SPLIT_MIN);
    expect(splitAt(5000, 100, 1000)).toBe(DOC_SPLIT_MAX);
    expect(splitAt(400, 100, 0)).toBe(DOC_SPLIT_DEFAULT);
  });
});

describe("원문 줄 → 절", () => {
  it("ATX 제목 줄과 그린 제목의 이름이 짝지어진다", () => {
    const src = "# 하나\n\n본문\n\n## 둘\n본문\n";
    expect(sections(src)).toEqual([
      { line: 0, slug: "하나" },
      { line: 4, slug: "둘" },
    ]);
  });

  it("울타리 코드 안의 `#` 은 제목이 아니다 (``` 와 ~~~)", () => {
    const src = "# 위\n\n```sh\n# 주석\n```\n\n~~~\n## 아님\n~~~\n\n## 아래\n";
    expect(sections(src)).toEqual([
      { line: 0, slug: "위" },
      { line: 10, slug: "아래" },
    ]);
  });

  it("밑줄식 제목은 글 첫 줄이 자리다 · 목록 뒤 `---` 는 가로줄", () => {
    const src = "첫 제목\n===\n\n- 항목\n---\n\n둘째\n줄\n---\n";
    expect(sections(src)).toEqual([
      { line: 0, slug: "첫-제목" },
      { line: 6, slug: "둘째줄" },
    ]);
  });

  it("인용 속 제목은 절이 아니지만 겹침 번호는 먹는다 — 목차(`outlineOf`)와 같은 이름", () => {
    const src = "# 같음\n\n> # 같음\n\n# 같음\n";
    const blocks = parseMarkdown(src);
    const got = sectionLines(src, blocks);
    expect(got.map((s) => s.line)).toEqual([0, 4]);
    expect(got.map((s) => s.slug)).toEqual(outlineOf(blocks).map((o) => o.slug));
  });

  it("줄 훑기와 파서의 제목 수가 같다 — 표 · 목록 이어짐 · 참조 정의 · CRLF", () => {
    const src = [
      "제목 A",
      "---",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "---",
      "",
      "- 항목",
      "  # 이어짐(제목 아님)",
      "",
      "[r]: https://x",
      "---",
      "",
      "> 인용 글",
      "> ## 인용 제목",
      "",
      "#",
      "",
      "### 끝 ###",
    ].join("\r\n");
    const blocks = parseMarkdown(src);
    expect(headingLines(src).length).toBe(headingSlugs(blocks).size);
    expect(sectionLines(src, blocks).map((s) => s.line)).toEqual([0, 17, 19]);
  });

  it("알림 속 제목은 인용 속 제목과 같이 — 절이 아니고, 표식 줄 밑 `===` 는 밑줄식 제목이 아니다", () => {
    const src = "# 같음\n\n> [!NOTE]\n> # 같음\n\n> [!TIP]\n> ===\n\n# 같음\n";
    const blocks = parseMarkdown(src);
    expect(headingLines(src)).toEqual([
      { line: 0, quoted: false },
      { line: 3, quoted: true },
      { line: 8, quoted: false },
    ]);
    const got = sectionLines(src, blocks);
    expect(got.map((s) => s.line)).toEqual([0, 8]);
    expect(got.map((s) => s.slug)).toEqual(outlineOf(blocks).map((o) => o.slug));
  });

  it("다른 글의 블록을 주면(개수가 어긋나면) 빈 목록 — 엉뚱한 절로 가지 않는다", () => {
    expect(sectionLines("# 하나\n# 둘\n", parseMarkdown("# 하나\n"))).toEqual([]);
  });

  it("줄이 속한 절 — 바로 위 제목, 첫 제목 위면 null", () => {
    const s = sections("앞글\n\n# 하나\n본문\n\n## 둘\n");
    expect(sectionAt(s, 0)).toBeNull();
    expect(sectionAt(s, 2)).toBe("하나");
    expect(sectionAt(s, 4)).toBe("하나");
    expect(sectionAt(s, 5)).toBe("둘");
    expect(sectionAt(s, 99)).toBe("둘");
  });
});

describe("스크롤 맞추기의 대상", () => {
  const s = sections("# 하나\n\n\n\n# 둘\n\n\n\n# 셋\n");

  it("커서가 편집기 화면 안이면 커서의 절", () => {
    expect(syncTarget(s, 5, { top: 0, bottom: 10 })).toBe("둘");
  });

  it("커서를 두고 스크롤해 커서가 화면 밖이면 맨 위 줄의 절", () => {
    expect(syncTarget(s, 1, { top: 8, bottom: 20 })).toBe("셋");
  });

  it("아직 스크롤을 못 쟀으면(끝이 무한) 커서", () => {
    expect(syncTarget(s, 1, { top: 0, bottom: Number.POSITIVE_INFINITY })).toBe("하나");
  });
});
