import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { leafOf, listPanes, newLocalFsPane } from "$lib/session";
import { restoreNode, saveNode } from "$lib/tabs";
import { forgetLastFileView, rememberFileUi, rememberFileView, withLastFileUi } from "./file-ui-last.svelte.js";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("사람이 바꾼 값을 다음 새 타일이 받는다", () => {
  rememberFileView("icons");
  rememberFileUi({ hidden: true });
  rememberFileUi({ preview: true });
  rememberFileUi({ places: false });
  rememberFileUi({ zoom: 3 });
  expect(withLastFileUi(newLocalFsPane("C:/w"))).toMatchObject({
    fileView: "icons", fileHidden: true, filePreview: true, filePlaces: false, fileZoom: 3,
  });
  rememberFileUi({ hidden: false });
  expect(withLastFileUi(newLocalFsPane("C:/w")).fileHidden).toBeUndefined();
});

it("설정에서 기본 보기를 고르면 보기 칸만 지운다", () => {
  rememberFileView("icons");
  rememberFileUi({ hidden: true });
  forgetLastFileView();
  const pane = withLastFileUi(newLocalFsPane("C:/w"));
  expect(pane.fileView).toBeUndefined();
  expect(pane.fileHidden).toBe(true);
});

it("복원은 마지막 값을 쓰지 않는다 — 사람이 끈 타일이 켜지지 않는다", () => {
  rememberFileUi({ hidden: true });
  rememberFileUi({ preview: true });
  const saved = saveNode(leafOf(newLocalFsPane("C:/w")));
  const back = listPanes(restoreNode(JSON.parse(JSON.stringify(saved))))[0];
  expect(back.fileHidden).toBeUndefined();
  expect(back.filePreview).toBeUndefined();
});

it("막힌 저장소에서도 던지지 않는다", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => { throw new Error("막힘"); },
    setItem: () => { throw new Error("막힘"); },
    removeItem: () => { throw new Error("막힘"); },
  });
  rememberFileUi({ hidden: true });
  forgetLastFileView();
  expect(withLastFileUi(newLocalFsPane("C:/w")).fileHidden).toBeUndefined();
});
