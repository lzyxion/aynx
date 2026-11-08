import { describe, expect, it } from "vitest";
import {
  attachmentPaths,
  attachmentsReady,
  baseName,
  clipboardImageFiles,
  isImageName,
  removeAttachment,
  settleAttachment,
  tileAttachPastes,
  type ComposerAttachment,
} from "$lib/pane/composer-attachments";
import { shellQuoteAll } from "$lib/fs-drag";

const chip = (id: number, path: string | null = null): ComposerAttachment => ({ id, name: `f${id}.png`, path, url: null });

describe("대화 면 입력 칸의 첨부 칩", () => {
  it("준비 · 빼기 · 경로는 칩 차례대로", () => {
    let list = [chip(1), chip(2), chip(3)];
    expect(attachmentsReady(list)).toBe(false);
    list = settleAttachment(list, 2, "/b");
    list = settleAttachment(list, 1, "/a");
    expect(attachmentPaths(list)).toEqual(["/a", "/b"]);
    expect(attachmentsReady(list)).toBe(false);
    list = removeAttachment(list, 3);
    expect(attachmentsReady(list)).toBe(true);
    expect(settleAttachment(list, 99, "/x")).toEqual(list);
    expect(attachmentsReady([])).toBe(true);
  });

  it("AI 타일 보내기의 첨부 몫 = 경로 하나에 붙여넣기 하나(따옴표 친 경로 + 빈칸)", () => {
    const paths = ["C:\\Users\\me\\AppData\\aynx\\attachments\\ab\\그림 1.png", "/home/me/.aynx/attachments/x/a.png"];
    expect(tileAttachPastes(paths)).toEqual(paths.map((p) => `${shellQuoteAll([p])} `));
    expect(tileAttachPastes([])).toEqual([]);
  });

  it("그림 이름 · 경로의 이름", () => {
    for (const n of ["a.png", "B.JPG", "c.jpeg", "d.gif", "e.webp"]) expect(isImageName(n)).toBe(true);
    for (const n of ["a.svg", "a.txt", "png", "a.png.exe"]) expect(isImageName(n)).toBe(false);
    expect(baseName("C:\\x\\y\\z.png")).toBe("z.png");
    expect(baseName("/a/b/c.png")).toBe("c.png");
    expect(baseName("/a/b/")).toBe("b");
  });

  it("붙여넣기 — 글 없이 그림만 있을 때만 그림 파일", () => {
    const png = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    const txt = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    const dt = (text: string, items: { kind: string; type: string; file: File | null }[], files: File[] = []) => ({
      getData: (ty: string) => (ty === "text/plain" ? text : ""),
      items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })),
      files,
    });
    expect(clipboardImageFiles(dt("", [{ kind: "file", type: "image/png", file: png }]))).toEqual([png]);
    expect(clipboardImageFiles(dt("표 글", [{ kind: "file", type: "image/png", file: png }]))).toEqual([]);
    expect(clipboardImageFiles(dt("", [{ kind: "file", type: "text/plain", file: txt }]))).toEqual([]);
    expect(clipboardImageFiles(dt("", [{ kind: "string", type: "text/html", file: null }], [png, txt]))).toEqual([png]);
    expect(clipboardImageFiles(null)).toEqual([]);
  });
});
