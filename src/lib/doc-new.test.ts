import { describe, expect, it } from "vitest";
import { NEW_DOC_DEFAULT, exportDocName, newDocName, stemEnd } from "./doc-new";

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

describe("exportDocName — 에이전트 답 [문서로 내보내기]의 처음 이름", () => {
  it("첫 제목 · 꾸밈 걷기 · 금지 글자 · .md", () => {
    expect(exportDocName("서론\n\n# 배포 절차\n\n## 둘째")).toBe("배포 절차.md");
    expect(exportDocName("## **A/B** 시험: `run`?")).toBe("A B 시험 run.md");
    expect(exportDocName("# [링크](http://x) 정리 ##")).toBe("링크 정리.md");
    expect(exportDocName("# 끝에 점...")).toBe("끝에 점.md");
  });
  it("코드 울타리 안의 # 은 제목이 아니다 · 제목 없음 · 빈 제목 = 기본 이름", () => {
    expect(exportDocName("```sh\n# comment\n```\n# 진짜")).toBe("진짜.md");
    expect(exportDocName("그냥 글")).toBe(NEW_DOC_DEFAULT);
    expect(exportDocName("# ***")).toBe(NEW_DOC_DEFAULT);
  });
  it("긴 제목은 자른다", () => {
    expect(exportDocName("# " + "가".repeat(200))).toBe("가".repeat(80) + ".md");
  });
});
