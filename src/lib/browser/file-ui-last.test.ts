import { describe, expect, it } from "vitest";
import { newDocPane, newLocalFsPane, newSftpPane } from "$lib/session";
import { applyLastFileUi, mergeLastFileUi, parseLastFileUi, serializeLastFileUi } from "./file-ui-last";

describe("parseLastFileUi", () => {
  it("없거나 망가지면 빈 값", () => {
    for (const raw of [null, "", "{나쁜", "3", "null", "[]"]) expect(parseLastFileUi(raw)).toEqual({});
  });

  it("다섯 칸을 읽고 모양이 틀린 칸만 버린다", () => {
    expect(parseLastFileUi(JSON.stringify({ view: "icons", hidden: true, preview: true, places: false, zoom: 3 }))).toEqual({
      view: "icons", hidden: true, preview: true, places: false, zoom: 3,
    });
    expect(parseLastFileUi(JSON.stringify({ view: "없음", hidden: "1", preview: 1, places: true, zoom: 99 }))).toEqual({});
    // 기본 크기 · 옛 보기 값
    expect(parseLastFileUi(JSON.stringify({ zoom: 1, view: "tree" }))).toEqual({ view: "details" });
  });
});

describe("mergeLastFileUi", () => {
  it("기본값이면 칸을 지운다", () => {
    let last = mergeLastFileUi({}, { hidden: true, preview: true, places: false, zoom: 3 });
    expect(last).toEqual({ hidden: true, preview: true, places: false, zoom: 3 });
    last = mergeLastFileUi(last, { hidden: false, preview: false, places: true, zoom: 1 });
    expect(last).toEqual({});
    expect(serializeLastFileUi(last)).toBeNull();
  });

  it("바꾸지 않은 칸은 그대로", () => {
    expect(mergeLastFileUi({ view: "compact", hidden: true }, { zoom: 2 })).toEqual({ view: "compact", hidden: true, zoom: 2 });
  });
});

describe("applyLastFileUi", () => {
  const last = { view: "icons", hidden: true, preview: true, places: false, zoom: 3 } as const;

  it("로컬 · 원격 파일 타일에 얹는다", () => {
    for (const pane of [newLocalFsPane("C:/w"), newSftpPane("src", "web", "/srv")]) {
      expect(applyLastFileUi(pane, last)).toMatchObject({
        fileView: "icons", fileHidden: true, filePreview: true, filePlaces: false, fileZoom: 3,
      });
    }
  });

  it("빈 값이면 칸을 만들지 않는다 — 설정의 기본 보기를 따른다", () => {
    const pane = applyLastFileUi(newLocalFsPane("C:/w"), {});
    for (const key of ["fileView", "fileHidden", "filePreview", "filePlaces", "fileZoom"]) expect(key in pane).toBe(false);
  });

  it("파일 타일이 아니면 건드리지 않는다", () => {
    const doc = newDocPane("C:/a.md");
    expect("fileHidden" in applyLastFileUi(doc, last)).toBe(false);
  });
});
