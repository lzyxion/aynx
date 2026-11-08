import { describe, expect, it } from "vitest";
import { parseMarkdown } from "$lib/markdown";
import { headingSlugs } from "$lib/doc-links";
import {
  OUTLINE_BASELINE_PX,
  OUTLINE_NARROW_PX,
  currentSection,
  filterOutline,
  isNarrowOutline,
  outlineOf,
  revealScrollTop,
  type ScrollView,
} from "$lib/doc-outline";

describe("outlineOf", () => {
  it("최상위 제목만 · 수준 · 인라인을 평문으로", () => {
    const blocks = parseMarkdown("# 시작 **굵게**\n\n본문\n\n## [링크](https://x) `code`\n\n### 셋\n");
    expect(outlineOf(blocks)).toEqual([
      { slug: "시작-굵게", level: 1, text: "시작 굵게", index: 0 },
      { slug: "링크-code", level: 2, text: "링크 code", index: 1 },
      { slug: "셋", level: 3, text: "셋", index: 2 },
    ]);
  });

  it("인용 속 제목은 빼되, 이름은 그린 제목의 `data-slug`(문서 전체 번호)와 같다", () => {
    const blocks = parseMarkdown("# 같음\n\n> # 같음\n\n# 같음\n");
    const items = outlineOf(blocks);
    expect(items.map((i) => i.slug)).toEqual(["같음", "같음-2"]);
    const all = [...headingSlugs(blocks).values()];
    for (const it of items) expect(all).toContain(it.slug);
  });

  it("알림 속 제목도 인용 속 제목처럼 — 목차에서 빠지고 겹침 번호는 먹는다", () => {
    const blocks = parseMarkdown("# 같음\n\n> [!NOTE]\n> # 같음\n\n# 같음\n");
    expect(outlineOf(blocks).map((i) => i.slug)).toEqual(["같음", "같음-2"]);
  });

  it("제목이 없으면 빈 목차", () => {
    expect(outlineOf(parseMarkdown("그냥 글\n\n- 목록\n"))).toEqual([]);
  });
});

describe("filterOutline", () => {
  const items = outlineOf(parseMarkdown("# Setup Guide\n\n## 설치\n\n## Usage\n"));

  it("대소문자 무시 부분 일치 · 원래 자리(index)를 지킨다", () => {
    expect(filterOutline(items, "usa").map((i) => i.index)).toEqual([2]);
    expect(filterOutline(items, "GUIDE").map((i) => i.text)).toEqual(["Setup Guide"]);
    expect(filterOutline(items, "설")).toHaveLength(1);
  });

  it("빈 질의 · 공백만이면 전부", () => {
    expect(filterOutline(items, "")).toEqual(items);
    expect(filterOutline(items, "   ")).toEqual(items);
  });

  it("없으면 빈 목록", () => {
    expect(filterOutline(items, "zzz")).toEqual([]);
  });
});

describe("currentSection", () => {
  const view = (over: Partial<ScrollView> = {}): ScrollView => ({
    tops: [0, 500, 1000, 1500],
    scrollTop: 0,
    clientHeight: 400,
    scrollHeight: 3000,
    ...over,
  });

  it("기준선을 지난 마지막 제목", () => {
    expect(currentSection(view())).toBe(0);
    expect(currentSection(view({ scrollTop: 500 - OUTLINE_BASELINE_PX }))).toBe(1);
    expect(currentSection(view({ scrollTop: 500 - OUTLINE_BASELINE_PX - 1 }))).toBe(0);
    expect(currentSection(view({ scrollTop: 1200 }))).toBe(2);
  });

  it("첫 제목 위면 -1 · 제목이 없으면 -1", () => {
    expect(currentSection(view({ tops: [300, 800] }))).toBe(-1);
    expect(currentSection(view({ tops: [] }))).toBe(-1);
  });

  it("맨 아래면 화면 안의 마지막 제목", () => {
    // 2600 + 400 = 3000 = scrollHeight — 1500 은 기준선(2624) 위지만, 끝 절이 화면 안에 있으면 그것
    expect(currentSection(view({ tops: [0, 500, 2700, 2900], scrollTop: 2600 }))).toBe(3);
  });

  it("방금 고른 자리는 화면 안에 있는 동안 우선한다", () => {
    const v = view({ tops: [0, 500, 2700, 2900], scrollTop: 2600 });
    expect(currentSection(v, 2)).toBe(2);
    // 화면 밖이면 무시
    expect(currentSection(view({ scrollTop: 0 }), 3)).toBe(0);
    // 범위 밖 숫자는 무시
    expect(currentSection(view(), 9)).toBe(0);
  });
});

describe("isNarrowOutline", () => {
  it(`${OUTLINE_NARROW_PX}px 미만이면 좁다 · 아직 못 쟀으면(0) 넓다`, () => {
    expect(isNarrowOutline(OUTLINE_NARROW_PX - 1)).toBe(true);
    expect(isNarrowOutline(OUTLINE_NARROW_PX)).toBe(false);
    expect(isNarrowOutline(0)).toBe(false);
  });
});

describe("revealScrollTop", () => {
  it("안에 있으면 그대로 · 위로 넘치면 줄 위로 · 아래로 넘치면 줄 끝이 바닥에", () => {
    expect(revealScrollTop(100, 200, 150, 20)).toBe(100);
    expect(revealScrollTop(100, 200, 40, 20)).toBe(40);
    expect(revealScrollTop(100, 200, 300, 20)).toBe(120);
  });
});
