import { describe, expect, it } from "vitest";
import { classifyDocHref, headingSlugs, matchAnchor, resolveDocLink, slugify } from "$lib/doc-links";
import { parseMarkdown } from "$lib/markdown";

describe("classifyDocHref", () => {
  it("http/https 는 web", () => {
    expect(classifyDocHref("https://example.com/a.md")).toEqual({ kind: "web", url: "https://example.com/a.md" });
    expect(classifyDocHref("http://x.org")).toEqual({ kind: "web", url: "http://x.org" });
  });

  it("다른 스킴 · 스킴 생략 · 빈 주소는 other", () => {
    for (const h of ["mailto:a@b.c", "javascript:alert(1)", "file:///C:/a.md", "ftp://x/y", "//host/a.md", "", "  ", "#"]) {
      expect(classifyDocHref(h)).toEqual({ kind: "other" });
    }
  });

  it("#절 만은 anchor (퍼센트 인코딩을 푼다)", () => {
    expect(classifyDocHref("#setup")).toEqual({ kind: "anchor", anchor: "setup" });
    expect(classifyDocHref("#%EC%84%A4%EC%B9%98")).toEqual({ kind: "anchor", anchor: "설치" });
  });

  it("경로 + 선택적 앵커 · 쿼리는 버린다", () => {
    expect(classifyDocHref("other.md")).toEqual({ kind: "path", path: "other.md" });
    expect(classifyDocHref("./docs/a.md#sec")).toEqual({ kind: "path", path: "./docs/a.md", anchor: "sec" });
    expect(classifyDocHref("../x.md?raw=1")).toEqual({ kind: "path", path: "../x.md" });
    expect(classifyDocHref("/abs/path.md")).toEqual({ kind: "path", path: "/abs/path.md" });
    expect(classifyDocHref("my%20file.md")).toEqual({ kind: "path", path: "my file.md" });
  });

  it("윈도우 드라이브 경로는 스킴이 아니다", () => {
    expect(classifyDocHref("C:\\a\\b.md")).toEqual({ kind: "path", path: "C:\\a\\b.md" });
    expect(classifyDocHref("C:/a/b.md#x")).toEqual({ kind: "path", path: "C:/a/b.md", anchor: "x" });
  });

  it("경로 없이 쿼리 + 앵커만이면 anchor", () => {
    expect(classifyDocHref("?x#y")).toEqual({ kind: "anchor", anchor: "y" });
  });
});

describe("resolveDocLink", () => {
  it("로컬 윈도우 — 문서의 폴더 기준 · 구분자는 \\", () => {
    expect(resolveDocLink("C:\\p\\docs\\README.md", "other.md", false)).toBe("C:\\p\\docs\\other.md");
    expect(resolveDocLink("C:\\p\\docs\\README.md", "./a/b.md", false)).toBe("C:\\p\\docs\\a\\b.md");
    expect(resolveDocLink("C:\\p\\docs\\README.md", "../x.md", false)).toBe("C:\\p\\x.md");
    expect(resolveDocLink("C:/p/README.md", "a.md", false)).toBe("C:\\p\\a.md");
  });

  it("로컬 윈도우 — 뿌리 위로 오르지 않는다", () => {
    expect(resolveDocLink("C:\\README.md", "../../x.md", false)).toBe("C:\\x.md");
  });

  it("로컬 윈도우 — /로 시작하면 그 드라이브 · UNC 공유의 뿌리 기준", () => {
    expect(resolveDocLink("D:\\p\\README.md", "/abs/path.md", false)).toBe("D:\\abs\\path.md");
    expect(resolveDocLink("\\\\srv\\share\\p\\a.md", "/b.md", false)).toBe("\\\\srv\\share\\b.md");
  });

  it("로컬 — 윈도우 절대 링크는 그대로(정규화)", () => {
    expect(resolveDocLink("C:\\p\\a.md", "E:/x/../y.md", false)).toBe("E:\\y.md");
  });

  it("UNC 문서의 상대 링크", () => {
    expect(resolveDocLink("\\\\srv\\share\\p\\a.md", "../b.md", false)).toBe("\\\\srv\\share\\b.md");
  });

  it("원격 — POSIX", () => {
    expect(resolveDocLink("/home/u/p/README.md", "docs/a.md", true)).toBe("/home/u/p/docs/a.md");
    expect(resolveDocLink("/home/u/p/README.md", "../x.md", true)).toBe("/home/u/x.md");
    expect(resolveDocLink("/home/u/p/README.md", "/etc/x.conf", true)).toBe("/etc/x.conf");
    expect(resolveDocLink("/README.md", "a.md", true)).toBe("/a.md");
    expect(resolveDocLink("/home/u/README.md", "docs\\a.md", true)).toBe("/home/u/docs/a.md");
  });

  it("원격 — 윈도우 모양은 열 수 없다", () => {
    expect(resolveDocLink("/home/u/README.md", "C:\\x.md", true)).toBeNull();
  });

  it("로컬 POSIX(다른 OS)", () => {
    expect(resolveDocLink("/Users/u/p/README.md", "../x.md", false)).toBe("/Users/u/x.md");
    expect(resolveDocLink("/Users/u/p/README.md", "/etc/a.md", false)).toBe("/etc/a.md");
  });
});

describe("slugify", () => {
  it("GitHub 식", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("B7 — 상대 링크")).toBe("b7--상대-링크");
    expect(slugify("What's new? (v2.0)")).toBe("whats-new-v20");
    expect(slugify("snake_case & kebab-case")).toBe("snake_case--kebab-case");
    expect(slugify("  설치 방법  ")).toBe("설치-방법");
  });
});

describe("headingSlugs", () => {
  it("문서 순서 · 인용 속 제목 포함 · 겹치면 -1 · -2", () => {
    const blocks = parseMarkdown("# A\n\ntext\n\n## A\n\n> ### A\n\n## A-1\n\n## 설치\n");
    const slugs = [...headingSlugs(blocks).values()];
    expect(slugs).toEqual(["a", "a-1", "a-2", "a-1-1", "설치"]);
  });

  it("링크 · 코드가 든 제목은 보이는 글자로", () => {
    const blocks = parseMarkdown("## Use `openDoc` with [links](x.md)\n");
    expect([...headingSlugs(blocks).values()]).toEqual(["use-opendoc-with-links"]);
  });
});

describe("matchAnchor", () => {
  const slugs = ["setup-guide", "설치"];
  it("그대로 · 한 번 더 slugify", () => {
    expect(matchAnchor("setup-guide", slugs)).toBe("setup-guide");
    expect(matchAnchor("Setup Guide", slugs)).toBe("setup-guide");
    expect(matchAnchor("설치", slugs)).toBe("설치");
    expect(matchAnchor("nope", slugs)).toBeNull();
  });
});
