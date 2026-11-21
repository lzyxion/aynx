/** 문서 타일 본문 우클릭 메뉴의 항목 — 순수 층. 무리 순서는 다른 우클릭 메뉴와 같은 규칙(링크 → 클립보드 → 찾기 → 이 문서의 일). */

import { newDocItem, type PaneMenuItem, type PaneMenuRow } from "$lib/pane/pane-menu";
import type { DocFormat } from "$lib/doc-format";
import type { Tr } from "$lib/session";

/** `pane/pane-tools.svelte.ts` 의 `TOOL_ACTION_PREFIX` 와 같은 값(그 모듈은 룬 상태라 순수 층에서 부르지 않는다) */
const TOOL_ACTION_PREFIX = "tool:";

export type DocMenuKey =
  | "open-link"
  | "copy-link"
  | "copy"
  | "select-all"
  | "find"
  | "edit"
  | "undo"
  | "redo"
  | "cut"
  | "paste"
  | "save"
  | `fmt:${DocFormat}`;

export interface DocMenuCtx {
  mode: "read" | "edit";
  link: string | null;
  hasSelection: boolean;
  canFind: boolean;
  /** 편집 중 미리 보기에서는 거짓 */
  canEdit: boolean;
  markdown: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** `true` 눌림 · `false` 흐리게 · `null`/없음 줄 없음 */
  newDoc?: boolean | null;
}

const item = (key: DocMenuKey, label: string, icon: string | null, extra: Partial<PaneMenuItem> = {}): PaneMenuItem => ({
  action: `${TOOL_ACTION_PREFIX}${key}`,
  label,
  icon,
  ...extra,
});

const FORMAT_LABEL = {
  bold: "files.doc.menu.fmt.bold",
  italic: "files.doc.menu.fmt.italic",
  strike: "files.doc.menu.fmt.strike",
  code: "files.doc.menu.fmt.code",
  link: "files.doc.menu.fmt.link",
  h1: "files.doc.menu.fmt.h1",
  h2: "files.doc.menu.fmt.h2",
  h3: "files.doc.menu.fmt.h3",
  bullet: "files.doc.menu.fmt.bullet",
  ordered: "files.doc.menu.fmt.ordered",
  task: "files.doc.menu.fmt.task",
  quote: "files.doc.menu.fmt.quote",
  codeblock: "files.doc.menu.fmt.codeblock",
} as const satisfies Record<DocFormat, string>;

function fmt(tr: Tr, kind: DocFormat, icon: string, separator = false): PaneMenuItem {
  return item(`fmt:${kind}`, tr(FORMAT_LABEL[kind]), icon, separator ? { separator } : {});
}

function formatGroups(tr: Tr): PaneMenuRow[] {
  return [
    {
      flyout: "format",
      label: tr("files.doc.menu.format"),
      icon: "format",
      separator: true,
      children: [fmt(tr, "bold", "bold"), fmt(tr, "italic", "italic"), fmt(tr, "strike", "strikethrough"), fmt(tr, "code", "code")],
    },
    {
      flyout: "paragraph",
      label: tr("files.doc.menu.paragraph"),
      icon: "paragraph",
      children: [
        fmt(tr, "h1", "heading-1"),
        fmt(tr, "h2", "heading-2"),
        fmt(tr, "h3", "heading-3"),
        fmt(tr, "bullet", "list", true),
        fmt(tr, "ordered", "list-ordered"),
        fmt(tr, "task", "list-checks"),
        fmt(tr, "quote", "quote", true),
      ],
    },
    {
      flyout: "insert",
      label: tr("files.doc.menu.insert"),
      icon: "insert",
      children: [fmt(tr, "link", "link"), fmt(tr, "codeblock", "code-block")],
    },
  ];
}

/** `DocView` 의 `run` 이 같은 값으로 가른다 */
export const DOC_TOOL_EXTERNAL = "external";
export const DOC_TOOL_EDIT_EXTERNAL = "edit-external";

/** `fs-backend` 에서 `canOpenExternal` · `canEdit` 은 동시에 서지 않는다 */
export interface DocExternalCtx {
  canOpenExternal: boolean;
  canEdit: boolean;
  offline: boolean;
}

/** 본문 우클릭이 아니라 타일 ⋯ 메뉴의 [경로 복사] 위에 얹는 줄 */
export function docExternalItems(ctx: DocExternalCtx, tr: Tr): PaneMenuItem[] {
  if (ctx.canOpenExternal) {
    return [{ action: `${TOOL_ACTION_PREFIX}${DOC_TOOL_EXTERNAL}`, label: tr("files.menu.openexternal"), icon: "external" }];
  }
  if (ctx.canEdit) {
    return [
      {
        action: `${TOOL_ACTION_PREFIX}${DOC_TOOL_EDIT_EXTERNAL}`,
        label: tr("files.menu.edit.external"),
        icon: "external",
        ...(ctx.offline ? { disabled: true, title: tr("files.doc.edit.block.offline") } : {}),
      },
    ];
  }
  return [];
}

export function docMenuItems(ctx: DocMenuCtx, tr: Tr): PaneMenuRow[] {
  const rows: PaneMenuRow[] = [];
  const sep = () => rows.length > 0;
  if (ctx.mode === "read") {
    if (ctx.link !== null) {
      rows.push(
        item("open-link", tr("pane.menu.open_link"), "external", { title: ctx.link }),
        item("copy-link", tr("pane.menu.copy_link"), "copy", { title: ctx.link }),
      );
    }
    const s = sep();
    if (ctx.hasSelection) rows.push(item("copy", tr("pane.menu.copy"), "copy", { separator: s, hint: "Ctrl+C" }));
    rows.push(item("select-all", tr("pane.menu.select_all"), "select-all", { separator: s && !ctx.hasSelection, hint: "Ctrl+A" }));
    if (ctx.canFind) rows.push(item("find", tr("files.doc.menu.find"), "search", { separator: true, hint: "Ctrl+F" }));
    if (ctx.canEdit) rows.push(item("edit", tr("files.doc.edit"), "edit", { separator: true }));
    if (ctx.newDoc != null) rows.push(newDocItem(ctx.newDoc, tr));
    return rows;
  }
  rows.push(
    item("undo", tr("files.doc.menu.undo"), "undo", { disabled: !ctx.canUndo, hint: "Ctrl+Z" }),
    item("redo", tr("files.doc.menu.redo"), "redo", { disabled: !ctx.canRedo, hint: "Ctrl+Y" }),
  );
  if (ctx.hasSelection) {
    rows.push(
      item("cut", tr("files.doc.menu.cut"), "cut", { separator: true, hint: "Ctrl+X" }),
      item("copy", tr("pane.menu.copy"), "copy", { hint: "Ctrl+C" }),
    );
  }
  rows.push(
    item("paste", tr("pane.menu.paste"), "paste", { separator: !ctx.hasSelection, hint: "Ctrl+V" }),
    item("select-all", tr("pane.menu.select_all"), "select-all", { hint: "Ctrl+A" }),
  );
  if (ctx.markdown) rows.push(...formatGroups(tr));
  rows.push(
    item("find", tr("files.doc.menu.findReplace"), "search", { separator: true, hint: "Ctrl+F" }),
    item("save", tr("files.doc.menu.save"), "save", { separator: true, hint: "Ctrl+S" }),
  );
  return rows;
}
