import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { branchChipText, chipFolder, folderNameOf, folderUnknownTipKey, gitHeadKey, parseGitHead, shouldReadHead } from "./pane-chips";
import { pane as en } from "./i18n/en/pane";
import { pane as ko } from "./i18n/ko/pane";

describe("folderNameOf — 폴더 칩 글자", () => {
  it("마지막 폴더 이름만", () => {
    expect(folderNameOf("C:\\Users\\me\\src\\aynx")).toBe("aynx");
    expect(folderNameOf("/home/me/src/api")).toBe("api");
    expect(folderNameOf("~/src/api/")).toBe("api");
    expect(folderNameOf("C:/Users/me/proj\\sub")).toBe("sub");
    expect(folderNameOf("\\\\wsl.localhost\\Ubuntu\\home\\me")).toBe("me");
  });
  it("뿌리만 남으면 뿌리", () => {
    expect(folderNameOf("/")).toBe("/");
    expect(folderNameOf("~")).toBe("~");
    expect(folderNameOf("C:\\")).toBe("C:");
  });
  it("모르면 빈 글자", () => {
    expect(folderNameOf(null)).toBe("");
    expect(folderNameOf("  ")).toBe("");
  });
});

describe("chipFolder — 기준 폴더", () => {
  it("지금 폴더 → 시작 폴더 → 모름", () => {
    expect(chipFolder({ reported: "/a/b", start: "/a" })).toBe("/a/b");
    expect(chipFolder({ reported: " ", start: "/a" })).toBe("/a");
    expect(chipFolder({ reported: null, start: undefined })).toBeNull();
  });
  it("tmux 타일은 모른다 — 시작 폴더가 있어도", () => {
    expect(chipFolder({ reported: null, start: "~/api", tmux: true })).toBeNull();
  });
});

describe("parseGitHead · branchChipText — 브랜치 칩", () => {
  it("브랜치 · detached · 없음", () => {
    expect(parseGitHead({ kind: "branch", name: "main" })).toEqual({ kind: "branch", name: "main" });
    expect(parseGitHead({ kind: "detached", sha: "1a2b3c4" })).toEqual({ kind: "detached", sha: "1a2b3c4" });
    expect(parseGitHead({ kind: "none" })).toEqual({ kind: "none" });
    expect(branchChipText({ kind: "branch", name: "feat/x" })).toBe("feat/x");
    expect(branchChipText({ kind: "detached", sha: "1a2b3c4" })).toBe("1a2b3c4");
    expect(branchChipText({ kind: "none" })).toBeNull();
    expect(branchChipText(null)).toBeNull();
  });
  it("모양이 어긋나면 없음 — 칩을 그리지 않는다", () => {
    expect(parseGitHead(null)).toEqual({ kind: "none" });
    expect(parseGitHead({ kind: "branch", name: "" })).toEqual({ kind: "none" });
    expect(parseGitHead({ kind: "branch", name: "a b" })).toEqual({ kind: "none" });
    expect(parseGitHead({ kind: "detached" })).toEqual({ kind: "none" });
    expect(parseGitHead("main")).toEqual({ kind: "none" });
  });
});

describe("gitHeadKey · shouldReadHead — 묶기", () => {
  it("열쇠는 호스트(대소문자 무시) + 경로", () => {
    expect(gitHeadKey(null, " C:\\a ")).toBe("\nC:\\a");
    expect(gitHeadKey("Web-01", "~/api")).toBe(gitHeadKey("web-01", "~/api"));
    expect(gitHeadKey("web-01", "~/api")).not.toBe(gitHeadKey(null, "~/api"));
  });
  it("왕복이 떠 있거나 간격 안이면 다시 읽지 않는다", () => {
    expect(shouldReadHead({ now: 10, lastAt: undefined, inflight: false, gapMs: 2000 })).toBe(true);
    expect(shouldReadHead({ now: 10, lastAt: undefined, inflight: true, gapMs: 2000 })).toBe(false);
    expect(shouldReadHead({ now: 1500, lastAt: 0, inflight: false, gapMs: 2000 })).toBe(false);
    expect(shouldReadHead({ now: 2000, lastAt: 0, inflight: false, gapMs: 2000 })).toBe(true);
  });
});

describe("폴더를 모를 때 — 흐린 Folder · 까닭 말풍선 (10-23)", () => {
  it("까닭 열쇠 — tmux 와 그 밖", () => {
    expect(folderUnknownTipKey({ tmux: true })).toBe("pane.header.folder.unknown.tmux");
    expect(folderUnknownTipKey({ tmux: false })).toBe("pane.header.folder.unknown.shell");
  });
  it("칩 글자는 모든 언어에서 영어 낱말 folder · 말풍선은 언어마다 있고 폴더 열기로 끝난다", () => {
    expect(ko["header.folder.unknown.chip"]).toBe("Folder");
    expect(en["header.folder.unknown.chip"]).toBe("Folder");
    for (const d of [ko, en] as Record<string, string>[]) {
      expect(d["header.folder.unknown.tmux"]).toBeTruthy();
      expect(d["header.folder.unknown.shell"]).toBeTruthy();
    }
    expect(ko["header.folder.unknown.tmux"]).toMatch(/폴더 열기$/);
    expect(ko["header.folder.unknown.shell"]).toMatch(/셸 통합/);
  });
  it("칩은 모를 때도 글자 꼴을 가진다(이름처럼 접힌다) · +N 줄도 같은 글자", () => {
    const src = readFileSync(fileURLToPath(new URL("./pane/HeaderChips.svelte", import.meta.url)), "utf8");
    expect(src).toContain('fitAttrs("folder", 2)');
    expect(src).not.toContain('fitAttrs("folder", folderName === "" ? 1 : 2)');
    expect(src).toContain('class:muted={folderName === ""} data-fold="1">{folderLabel}</span>');
    expect(src).toContain('label: folderLabel, title: folderTip, muted: folderName === "", action: "files"');
  });
});
