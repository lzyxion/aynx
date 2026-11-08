import { describe, expect, it } from "vitest";
import { imageMime, PREVIEW_MAX_BYTES, previewPlan, previewSubject } from "$lib/browser/preview";
import type { SftpEntry } from "$lib/sftp-browser";

function e(name: string, kind: SftpEntry["kind"] = "file", size = 10, extra: Partial<SftpEntry> = {}): SftpEntry {
  return { name, path: `/p/${name}`, kind, size, mtime: null, mode: null, symlinkTarget: null, linkIsDir: false, hidden: null, ...extra };
}

describe("미리 보기 — 그림 판정 · 상한", () => {
  it("그림 확장자(대소문자 무시)만 MIME 이 있다 · 점으로 시작하는 이름은 확장자가 아니다", () => {
    expect(imageMime("a.PNG")).toBe("image/png");
    expect(imageMime("logo.svg")).toBe("image/svg+xml");
    expect(imageMime("photo.jpeg")).toBe("image/jpeg");
    expect(imageMime("favicon.ico")).toBe("image/x-icon");
    expect(imageMime("notes.txt")).toBeNull();
    expect(imageMime(".png")).toBeNull();
    expect(imageMime("png")).toBeNull();
  });

  it("폴더 · 그림 아닌 파일은 글리프, 상한을 넘은 그림은 too-large(경계는 포함)", () => {
    expect(previewPlan(e("pics.png", "dir"))).toBe("glyph");
    expect(previewPlan(e("a.txt"))).toBe("glyph");
    expect(previewPlan(e("a.png", "file", PREVIEW_MAX_BYTES))).toBe("image");
    expect(previewPlan(e("a.png", "file", PREVIEW_MAX_BYTES + 1))).toBe("too-large");
    // 폴더를 가리키는 링크는 폴더다
    expect(previewPlan(e("x.png", "symlink", 0, { linkIsDir: true }))).toBe("glyph");
  });

  it("패널 상태 — 없음 · 하나 · 여럿(파일 크기만 더한다)", () => {
    expect(previewSubject([])).toEqual({ kind: "folder" });
    expect(previewSubject([e("a.png")])).toMatchObject({ kind: "one", plan: "image" });
    expect(previewSubject([e("a.png", "file", 5), e("b.txt", "file", 7), e("d", "dir", 99)])).toEqual({
      kind: "many",
      count: 3,
      bytes: 12,
    });
  });
});
