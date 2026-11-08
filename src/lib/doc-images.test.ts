import { describe, expect, it } from "vitest";
import { DOC_IMAGE_MAX_BYTES, docImageMime, docImagePlan, imageSrcsOf, imageSrcsOfTexts, isImageLinkHref, isNetworkPath } from "$lib/doc-images";
import { parseMarkdown } from "$lib/markdown";

describe("docImageMime — 그릴 확장자", () => {
  it("그림 형식 — 대소문자 무시", () => {
    expect(docImageMime("a.png")).toBe("image/png");
    expect(docImageMime("a.JPG")).toBe("image/jpeg");
    expect(docImageMime("a.jpeg")).toBe("image/jpeg");
    expect(docImageMime("a.gif")).toBe("image/gif");
    expect(docImageMime("a.webp")).toBe("image/webp");
    expect(docImageMime("a.bmp")).toBe("image/bmp");
    expect(docImageMime("a.avif")).toBe("image/avif");
    expect(docImageMime("C:\\x\\logo.svg")).toBe("image/svg+xml");
  });

  it("그 밖 · 확장자 없음 · 점으로 시작하는 이름 · 폴더 이름의 점은 아니다", () => {
    expect(docImageMime("a.ico")).toBeNull();
    expect(docImageMime("a.html")).toBeNull();
    expect(docImageMime("a")).toBeNull();
    expect(docImageMime(".png")).toBeNull();
    expect(docImageMime("/x.png/readme")).toBeNull();
  });

  it("상한은 10MB", () => {
    expect(DOC_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("docImagePlan — 불러올지", () => {
  it("상대 · 절대 경로는 문서 기준으로 풀어 읽는다(로컬 윈도우)", () => {
    expect(docImagePlan("C:\\docs\\a.md", "img/x.png", false)).toEqual({ kind: "load", path: "C:\\docs\\img\\x.png", mime: "image/png" });
    expect(docImagePlan("C:\\docs\\a.md", "../x.svg", false)).toEqual({ kind: "load", path: "C:\\x.svg", mime: "image/svg+xml" });
    expect(docImagePlan("C:\\docs\\a.md", "/pics/x.gif", false)).toEqual({ kind: "load", path: "C:\\pics\\x.gif", mime: "image/gif" });
    expect(docImagePlan("C:\\docs\\a.md", "D:\\p\\x.jpg", false)).toEqual({ kind: "load", path: "D:\\p\\x.jpg", mime: "image/jpeg" });
  });

  it("원격 — POSIX 로 풀고, 윈도우 절대 경로는 풀 수 없다", () => {
    expect(docImagePlan("/home/u/r/README.md", "./docs/s.png", true)).toEqual({ kind: "load", path: "/home/u/r/docs/s.png", mime: "image/png" });
    expect(docImagePlan("/home/u/r/README.md", "/etc/x.png", true)).toEqual({ kind: "load", path: "/etc/x.png", mime: "image/png" });
    expect(docImagePlan("/home/u/r/README.md", "C:\\x.png", true)).toEqual({ kind: "skip", why: "path" });
  });

  it("퍼센트 인코딩 · 물음표 · 앵커는 떼고 푼다", () => {
    expect(docImagePlan("/r/a.md", "my%20pic.png?raw=1#x", true)).toEqual({ kind: "load", path: "/r/my pic.png", mime: "image/png" });
  });

  it("스킴 있는 주소 · 스킴 생략 주소는 불러오지 않는다(바깥 추적 방지)", () => {
    for (const src of [
      "https://img.shields.io/badge/x.svg",
      "http://x/y.png",
      "data:image/png;base64,AAAA",
      "file:///C:/x.png",
      "javascript:alert(1)",
      "//cdn.example.com/x.png",
    ]) {
      expect(docImagePlan("C:\\docs\\a.md", src, false)).toEqual({ kind: "skip", why: "scheme" });
    }
  });

  it("기준 폴더를 모르면(`docPath` 빈 글) 절대 경로만 풀고 상대 경로는 `path`", () => {
    expect(docImagePlan("", "C:/Users/u/out/a.png", false)).toEqual({ kind: "load", path: "C:\\Users\\u\\out\\a.png", mime: "image/png" });
    expect(docImagePlan("", "D:\\p\\x.svg", false)).toEqual({ kind: "load", path: "D:\\p\\x.svg", mime: "image/svg+xml" });
    expect(docImagePlan("", "img/x.png", false)).toEqual({ kind: "skip", why: "path" });
    expect(docImagePlan("", "/pics/x.png", false)).toEqual({ kind: "skip", why: "path" });
    expect(docImagePlan("", "/home/u/a/../x.png", true)).toEqual({ kind: "load", path: "/home/u/x.png", mime: "image/png" });
    expect(docImagePlan("", "./x.png", true)).toEqual({ kind: "skip", why: "path" });
    expect(docImagePlan("", "C:\\x.png", true)).toEqual({ kind: "skip", why: "path" });
    expect(docImagePlan("", "\\\\host\\share\\x.png", false, true)).toEqual({ kind: "skip", why: "scheme" });
  });

  it("그림 형식이 아니거나 경로가 없으면 불러오지 않는다", () => {
    expect(docImagePlan("C:\\docs\\a.md", "x.html", false)).toEqual({ kind: "skip", why: "ext" });
    expect(docImagePlan("C:\\docs\\a.md", "#top", false)).toEqual({ kind: "skip", why: "path" });
    expect(docImagePlan("C:\\docs\\a.md", "", false)).toEqual({ kind: "skip", why: "scheme" });
  });
});

describe("imageSrcsOf — 글 속 그림 주소", () => {
  it("문단 · 제목 · 목록 · 표 · 인용 속 그림 · 겹치면 하나 · 배지 링크는 빠진다", () => {
    const src = [
      "# ![h](h.png)",
      "",
      "para ![a](a.png) and ![a2](a.png)",
      "",
      "- ![l](l.png)",
      "",
      "| c |",
      "| - |",
      "| ![t](t.png) |",
      "",
      "> ![q](q.png)",
      "",
      "[![badge](https://img.shields.io/x.svg)](https://x)",
    ].join("\n");
    expect(imageSrcsOf(parseMarkdown(src))).toEqual(["h.png", "a.png", "l.png", "t.png", "q.png"]);
  });
});

describe("imageSrcsOfTexts — 사이드 채팅의 에이전트 말들", () => {
  it("글마다 그림 주소를 모으고 겹치면 하나", () => {
    expect(imageSrcsOfTexts(["no image", "![a](x.png) and ![b](y.png)", "again ![c](x.png)"])).toEqual(["x.png", "y.png"]);
    expect(imageSrcsOfTexts([])).toEqual([]);
  });

  it("Codex 그림 글(Rust `image_markdown`)의 경로가 그대로 풀린다 — 퍼센트 인코딩 · 역슬래시 드라이브 경로", () => {
    // Rust 가 짓는 꼴: 공백 · 괄호 · `#` · `?` 는 %XX, `\` 는 그대로
    const md = String.raw`![A red circle](C:\Users\me\.codex\generated_images\t\my%20pic%20%281%29%23%3F.png)`;
    const [src] = imageSrcsOfTexts([md]);
    expect(docImagePlan("C:/d/sidechat/aa/.chat", src, false)).toEqual({
      kind: "load",
      path: String.raw`C:\Users\me\.codex\generated_images\t\my pic (1)#?.png`,
      mime: "image/png",
    });
    // 네트워크 경로는 사이드 채팅(`noNetwork`)에서 바깥 주소처럼 — 문서 보기 타일(기본)은 그대로 읽는다
    const unc = String.raw`\\evil\share\a.png`;
    expect(docImagePlan("C:/d/sidechat/aa/.chat", unc, false, true)).toEqual({ kind: "skip", why: "scheme" });
    expect(docImagePlan("C:/d/sidechat/aa/.chat", unc, false).kind).toBe("load");
    expect(isNetworkPath("//h/s/a.png")).toBe(true);
    expect(isNetworkPath(String.raw`C:\a.png`)).toBe(false);
    // 상대 경로는 채팅 폴더 기준
    expect(docImagePlan("C:/d/sidechat/aa/.chat", "out/a.png", false)).toEqual({
      kind: "load",
      path: String.raw`C:\d\sidechat\aa\out\a.png`,
      mime: "image/png",
    });
  });
});

describe("링크 그림 — 사이드 채팅(그림 파일을 가리키는 여느 링크)", () => {
  it("스킴 없는 경로 + 그림 확장자만", () => {
    expect(isImageLinkHref("C:/Users/me/sidechat/aa/sunrise.svg")).toBe(true);
    expect(isImageLinkHref("out/a.PNG")).toBe(true);
    expect(isImageLinkHref("https://x.test/a.png")).toBe(false);
    expect(isImageLinkHref("notes.md")).toBe(false);
    expect(isImageLinkHref("#a")).toBe(false);
  });

  it("imageSrcsOfTexts 는 링크 그림까지 · imageSrcsOf 는 기본으로 빼고 links 면 넣는다", () => {
    // 2026-10-24 실기 — Codex 가 SVG 를 파일로 쓰고 링크로 답했다
    const md = "만들었습니다.\n\n[SVG 이미지 열기](C:/Users/me/sidechat/aa/sunrise.svg) · [문서](a.md) · [웹](https://x.test/b.png)";
    expect(imageSrcsOfTexts([md])).toEqual(["C:/Users/me/sidechat/aa/sunrise.svg"]);
    expect(imageSrcsOf(parseMarkdown(md))).toEqual([]);
    expect(imageSrcsOf(parseMarkdown(md), true)).toEqual(["C:/Users/me/sidechat/aa/sunrise.svg"]);
    // 배지 링크(`[![a](img)](url)`)는 대체 글자 그대로
    expect(imageSrcsOf(parseMarkdown("[![b](x.png)](y.png)"), true)).toEqual([]);
  });
});
