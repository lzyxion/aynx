import { describe, expect, it } from "vitest";
import { isMarkdown, isTextLike, langOf } from "$lib/doc-lang";

describe("langOf", () => {
  it("확장자", () => {
    expect(langOf("a.sh")).toBe("bash");
    expect(langOf("a.ps1")).toBe("powershell");
    expect(langOf("run.CMD")).toBe("dos");
    expect(langOf("x.py")).toBe("python");
    expect(langOf("x.tsx")).toBe("typescript");
    expect(langOf("x.mjs")).toBe("javascript");
    expect(langOf("Cargo.toml")).toBe("ini");
    expect(langOf("x.yml")).toBe("yaml");
    expect(langOf("x.rs")).toBe("rust");
    expect(langOf("x.hpp")).toBe("cpp");
    expect(langOf("x.h")).toBe("c");
    expect(langOf("index.HTML")).toBe("xml");
    expect(langOf("fix.patch")).toBe("diff");
    expect(langOf("README.md")).toBe("markdown");
  });

  it("파일 이름 · 점 파일", () => {
    expect(langOf("Dockerfile")).toBe("dockerfile");
    expect(langOf("Dockerfile.dev")).toBe("dockerfile");
    expect(langOf("Makefile")).toBe("makefile");
    expect(langOf("GNUmakefile")).toBe("makefile");
    expect(langOf(".bashrc")).toBe("bash");
    expect(langOf(".zshrc")).toBe("bash");
    expect(langOf(".profile")).toBe("bash");
    expect(langOf(".gitconfig")).toBe("ini");
  });

  it("경로 (슬래시 · 역슬래시) · nginx 설정", () => {
    expect(langOf("/home/u/.bashrc")).toBe("bash");
    expect(langOf("C:\\x\\Makefile")).toBe("makefile");
    expect(langOf("/etc/nginx/sites-enabled/app.conf")).toBe("nginx");
    expect(langOf("/etc/nginx/nginx.conf")).toBe("nginx");
    expect(langOf("/etc/app.conf")).toBe("ini");
  });

  it("모르면 null", () => {
    expect(langOf("photo.png")).toBeNull();
    expect(langOf("notes.txt")).toBeNull();
    expect(langOf("LICENSE")).toBeNull();
    expect(langOf("")).toBeNull();
    expect(langOf("dir/")).toBeNull();
  });
});

describe("isTextLike", () => {
  it("언어 표에 있으면 참", () => {
    expect(isTextLike("deploy.sh")).toBe(true);
    expect(isTextLike("Dockerfile")).toBe(true);
  });

  it("텍스트 확장자 · 이름", () => {
    for (const n of ["a.txt", "app.LOG", ".env", ".env.local", "data.csv", "t.tsv", ".gitignore", ".editorconfig", "LICENSE", "README", "CHANGELOG", "README.old", "known_hosts", "id_ed25519.pub"]) {
      expect(isTextLike(n), n).toBe(true);
    }
  });

  it("모르는 확장자·이진은 거짓(보수적)", () => {
    for (const n of ["a.png", "a.exe", "a.zip", "a.pdf", "a.docx", "noext", "id_ed25519", "LICENSE.xyz"]) {
      expect(isTextLike(n), n).toBe(false);
    }
  });
});

describe("isMarkdown", () => {
  it(".md .markdown .mdx (대소문자 무관)", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("a.MARKDOWN")).toBe(true);
    expect(isMarkdown("/x/y.mdx")).toBe(true);
    expect(isMarkdown("a.txt")).toBe(false);
    expect(isMarkdown("md")).toBe(false);
  });
});
