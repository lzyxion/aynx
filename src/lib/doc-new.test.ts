import { describe, expect, it } from "vitest";
import { NEW_DOC_DEFAULT, newDocName, stemEnd } from "./doc-new";

const ok = (name: string) => ({ ok: true, name });

describe("newDocName — 문서 타일 [새 문서…] 이름 규칙", () => {
  it("앞뒤 공백을 떼고 · 비면 거절", () => {
    expect(newDocName("  notes.md  ", "\\")).toEqual(ok("notes.md"));
    expect(newDocName("   ", "\\")).toEqual({ ok: false, error: "files.browser.newfile.empty" });
    expect(newDocName("", "/")).toEqual({ ok: false, error: "files.browser.newfile.empty" });
  });

  it("경로 구분자 · `..` 는 백엔드와 상관없이 거절", () => {
    for (const sep of ["\\", "/"]) {
      expect(newDocName("a/b.md", sep)).toEqual({ ok: false, error: "files.doc.new.path" });
      expect(newDocName("a\\b.md", sep)).toEqual({ ok: false, error: "files.doc.new.path" });
      expect(newDocName("..", sep)).toEqual({ ok: false, error: "files.doc.new.path" });
      expect(newDocName("x..md", sep)).toEqual({ ok: false, error: "files.doc.new.path" });
    }
  });

  it("금지 글자는 파일 타일과 같은 검사(`nameError`) — 로컬 윈도우만 `:` 등을 막는다", () => {
    expect(newDocName("a:b.md", "\\")).toEqual({ ok: false, error: "files.ops.name.windows" });
    expect(newDocName('what?.md', "\\")).toEqual({ ok: false, error: "files.ops.name.windows" });
    expect(newDocName("a:b.md", "/")).toEqual(ok("a:b.md"));
  });

  it("확장자가 없으면 `.md` 를 붙인다 — 점으로 시작하는 이름은 그대로", () => {
    expect(newDocName("plan", "\\")).toEqual(ok("plan.md"));
    expect(newDocName("README", "/")).toEqual(ok("README.md"));
    expect(newDocName(".gitignore", "/")).toEqual(ok(".gitignore"));
    expect(newDocName("todo.txt", "\\")).toEqual(ok("todo.txt"));
    expect(newDocName("main.rs", "/")).toEqual(ok("main.rs"));
  });

  it("텍스트로 열 수 없는 확장자는 거절", () => {
    expect(newDocName("logo.png", "\\")).toEqual({ ok: false, error: "files.doc.new.notText", params: { name: "logo.png" } });
    expect(newDocName("a.zip", "/")).toEqual({ ok: false, error: "files.doc.new.notText", params: { name: "a.zip" } });
  });
});

describe("stemEnd — 처음 고를 끝", () => {
  it("확장자 앞까지 · 없으면 전부 · 점으로 시작하면 전부", () => {
    expect(stemEnd(NEW_DOC_DEFAULT)).toBe("untitled".length);
    expect(stemEnd("plan")).toBe(4);
    expect(stemEnd(".env")).toBe(4);
  });
});
