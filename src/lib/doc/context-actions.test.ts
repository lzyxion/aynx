import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/toast.svelte.js", () => ({ toast: { error: vi.fn() } }));
vi.mock("$lib/clipboard", () => ({ readClipboard: vi.fn(), writeClipboard: vi.fn() }));

import { runEditMenu, runReadMenu, type MenuEditor, type ReadMenuActions } from "./context-actions";

function readActions(editing: boolean) {
  const a = {
    editing: () => editing,
    openLink: vi.fn(),
    openDocLink: vi.fn(),
    openPreviewDocLink: vi.fn(),
    openFind: vi.fn(() => true),
    startEdit: vi.fn(),
  } satisfies ReadMenuActions;
  return a;
}

const box = {} as Element;

describe("runReadMenu", () => {
  it("웹 링크는 openLink, 문서 링크는 편집 중이면 미리 보기 쪽으로", () => {
    const a = readActions(false);
    runReadMenu("open-link", { box, link: "https://example.com", sel: "" }, a);
    expect(a.openLink).toHaveBeenCalledWith("https://example.com");
    runReadMenu("open-link", { box, link: "other.md", sel: "" }, a);
    expect(a.openDocLink).toHaveBeenCalledWith("other.md");
    const e = readActions(true);
    runReadMenu("open-link", { box, link: "other.md#x", sel: "" }, e);
    expect(e.openPreviewDocLink).toHaveBeenCalledWith("other.md#x");
    expect(e.openDocLink).not.toHaveBeenCalled();
  });

  it("링크 없는 열기는 아무것도 안 한다 · 찾기 · 편집", () => {
    const a = readActions(false);
    runReadMenu("open-link", { box, link: null, sel: "" }, a);
    expect(a.openLink).not.toHaveBeenCalled();
    expect(a.openDocLink).not.toHaveBeenCalled();
    runReadMenu("find", { box, link: null, sel: "" }, a);
    expect(a.openFind).toHaveBeenCalledOnce();
    runReadMenu("edit", { box, link: null, sel: "" }, a);
    expect(a.startEdit).toHaveBeenCalledOnce();
  });
});

describe("runEditMenu", () => {
  function editor() {
    return { format: vi.fn(), command: vi.fn(), insertText: vi.fn(), openSearch: vi.fn() } satisfies MenuEditor;
  }

  it("서식 · 되돌리기 · 다시 · 모두 선택 · 찾기 · 저장을 편집기 명령으로", () => {
    const ed = editor();
    const save = vi.fn(async () => true);
    runEditMenu(ed, "fmt:bold", "", save);
    expect(ed.format).toHaveBeenCalledWith("bold");
    runEditMenu(ed, "undo", "", save);
    runEditMenu(ed, "redo", "", save);
    runEditMenu(ed, "select-all", "", save);
    expect(ed.command.mock.calls).toEqual([["undo"], ["redo"], ["selectAll"]]);
    runEditMenu(ed, "find", "", save);
    expect(ed.openSearch).toHaveBeenCalledOnce();
    runEditMenu(ed, "save", "", save);
    expect(save).toHaveBeenCalledWith();
  });
});
