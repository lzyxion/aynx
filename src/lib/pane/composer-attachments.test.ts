import { describe, expect, it } from "vitest";
import {
  attachmentPaths,
  attachmentsReady,
  baseName,
  clipboardFiles,
  filesBesidePics,
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

  it("붙여넣기 — 글 없이 파일만 있을 때만 그 파일(그림 · 아무 파일)", () => {
    const png = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    const txt = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    const dt = (text: string, items: { kind: string; type: string; file: File | null }[], files: File[] = []) => ({
      getData: (ty: string) => (ty === "text/plain" ? text : ""),
      items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })),
      files,
    });
    expect(clipboardFiles(dt("", [{ kind: "file", type: "image/png", file: png }]))).toEqual([png]);
    expect(clipboardFiles(dt("표 글", [{ kind: "file", type: "image/png", file: png }]))).toEqual([]);
    expect(clipboardFiles(dt("", [{ kind: "file", type: "text/plain", file: txt }]))).toEqual([txt]);
    expect(clipboardFiles(dt("", [{ kind: "string", type: "text/html", file: null }], [png, txt]))).toEqual([png, txt]);
    expect(clipboardFiles(dt("", [{ kind: "string", type: "text/html", file: null }]))).toEqual([]);
    expect(clipboardFiles(null)).toEqual([]);
  });

  it("막 보낸 말풍선 — 그림으로 그린 이름은 칩에서 뺀다(같은 이름은 하나씩)", () => {
    const pic = (name: string) => ({ name, url: `blob:${name}` });
    expect(filesBesidePics(["a.png", "main.ts"], [pic("a.png")])).toEqual(["main.ts"]);
    expect(filesBesidePics(["image.png", "image.png"], [pic("image.png")])).toEqual(["image.png"]);
    expect(filesBesidePics(["main.ts"], [])).toEqual(["main.ts"]);
  });
});
