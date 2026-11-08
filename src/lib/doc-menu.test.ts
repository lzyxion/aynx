import { describe, expect, it } from "vitest";
import { docMenuItems, type DocMenuCtx } from "./doc-menu";
import { isGroup, rowId, type PaneMenuRow } from "$lib/pane/pane-menu";
import { UI_ICONS } from "$lib/ui-icons.generated";

const tr = (key: string) => key;
const read: DocMenuCtx = {
  mode: "read",
  link: null,
  hasSelection: false,
  canFind: true,
  canEdit: true,
  markdown: false,
  canUndo: false,
  canRedo: false,
};
const edit: DocMenuCtx = { ...read, mode: "edit", canFind: true, canEdit: false, markdown: true, canUndo: true };

const ids = (rows: PaneMenuRow[]) => rows.map((r) => String(rowId(r)).replace("tool:", ""));
const seps = (rows: PaneMenuRow[]) => rows.filter((r) => r.separator).map((r) => String(rowId(r)).replace("tool:", ""));

describe("docMenuItems — 읽기", () => {
  it("링크 → 클립보드 → 찾기 → 편집, 첫 줄에는 구분선이 없다", () => {
    const rows = docMenuItems({ ...read, link: "https://x", hasSelection: true }, tr);
    expect(ids(rows)).toEqual(["open-link", "copy-link", "copy", "select-all", "find", "edit"]);
    expect(seps(rows)).toEqual(["copy", "find", "edit"]);
    expect(rows[0].separator).toBeFalsy();
  });

  it("고른 글 · 링크가 없으면 모두 선택부터 — 편집할 수 없으면 편집이 없다", () => {
    const rows = docMenuItems({ ...read, canEdit: false }, tr);
    expect(ids(rows)).toEqual(["select-all", "find"]);
    expect(rows[0].separator).toBeFalsy();
  });
});

describe("docMenuItems — 편집", () => {
  it("실행 취소 → 클립보드 → 서식 ▸ → 찾기 · 바꾸기 → 저장", () => {
    const rows = docMenuItems({ ...edit, hasSelection: true }, tr);
    expect(ids(rows)).toEqual(["undo", "redo", "cut", "copy", "paste", "select-all", "format", "paragraph", "insert", "find", "save"]);
    expect(seps(rows)).toEqual(["cut", "format", "find", "save"]);
    expect(rows.find((r) => rowId(r) === "tool:redo")?.disabled).toBe(true);
  });

  it("마크다운이 아니면 서식이 없고, 고른 글이 없으면 잘라내기 · 복사가 없다", () => {
    const rows = docMenuItems({ ...edit, markdown: false }, tr);
    expect(ids(rows)).toEqual(["undo", "redo", "paste", "select-all", "find", "save"]);
    expect(seps(rows)).toEqual(["paste", "find", "save"]);
  });

  it("옆목록 셋 — 서식(글자) · 단락(줄) · 삽입", () => {
    const groups = docMenuItems(edit, tr).filter(isGroup);
    const of = (id: string) => groups.find((g) => g.flyout === id)?.children.map((c) => c.action.replace("tool:fmt:", ""));
    expect(of("format")).toEqual(["bold", "italic", "strike", "code"]);
    expect(of("paragraph")).toEqual(["h1", "h2", "h3", "bullet", "ordered", "task", "quote"]);
    expect(of("insert")).toEqual(["link", "codeblock"]);
  });

  it("모든 그림 이름이 생성 목록에 있다", () => {
    const all = [...docMenuItems({ ...read, link: "x", hasSelection: true }, tr), ...docMenuItems({ ...edit, hasSelection: true }, tr)];
    const icons = all.flatMap((r) => (isGroup(r) ? [r.icon, ...r.children.map((c) => c.icon)] : [r.icon]));
    for (const icon of icons) expect(UI_ICONS).toHaveProperty(icon ?? "");
  });
});
