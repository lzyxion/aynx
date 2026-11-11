/**
 * **문서 타일 본문 우클릭 메뉴의 항목 — 순수 층** (2026-10-25). 그리는 것은 타일 메뉴(`pane/PaneMenu.svelte` — 터미널 본문 우클릭과 같은
 * 상자 · 같은 옆목록)이고, 누른 줄은 `tool:<열쇠>` 로 `PaneHost` 를 지나 그 문서 타일(`DocView` 의 `runDocMenu`)로 돌아온다.
 *
 * 두 모양 — 무리 순서는 다른 우클릭 메뉴와 같은 규칙(링크 → 클립보드 → 찾기 → 이 문서의 일):
 *
 * - **읽기**(그린 문서 · 원문 · 코드 파일 · 편집 중 미리 보기): 링크 열기 · 링크 주소 복사(링크 위) ─ 복사(고른 글) · 모두 선택 ─ 찾기 ─ 편집(편집할 수 있을 때)
 *   ─ 새 문서…(타일 ⋯ 와 같은 줄 `new-doc` — `tool:` 이 아니라 `tile-menu-controller` 의 배선 칸으로 간다)
 * - **편집**(편집기 안): 실행 취소 · 다시 실행 ─ 잘라내기 · 복사(고른 글) · 붙여넣기 · 모두 선택 ─ 서식 ▸ · 단락 ▸ · 삽입 ▸(마크다운만) ─ 찾기 · 바꾸기 ─ 저장
 *
 * 옆목록 셋(마크다운만 — 바꾸는 일은 `doc-format.ts`):
 * - **서식 ▸** 굵게 · 기울임 · 취소선 · 인라인 코드 — 고른 글을 감싼다
 * - **단락 ▸** 제목 1 · 2 · 3 ─ 글머리 목록 · 번호 목록 · 체크 목록 ─ 인용 — 걸친 줄 전부
 * - **삽입 ▸** 링크 · 코드 블록
 */

import { newDocItem, type PaneMenuItem, type PaneMenuRow } from "$lib/pane/pane-menu";
import type { DocFormat } from "$lib/doc-format";
import type { Tr } from "$lib/session";

/** 줄의 액션 머리 — `pane/pane-tools.svelte.ts` 의 `TOOL_ACTION_PREFIX` 와 같은 값(그 모듈은 룬 상태라 순수 층에서 부르지 않는다) */
const TOOL_ACTION_PREFIX = "tool:";

/** 누른 줄의 열쇠 — `fmt:<서식>` 은 서식 옆목록의 줄 */
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
  /** 우클릭한 자리의 링크(읽기만) */
  link: string | null;
  /** 고른 글이 있나 — 있을 때만 복사(편집이면 잘라내기도)가 선다 */
  hasSelection: boolean;
  /** 읽기: [찾기] — 찾을 글이 보일 때 */
  canFind: boolean;
  /** 읽기: [편집] — 이 문서를 편집으로 바꿀 수 있을 때(편집 중 미리 보기에서는 거짓) */
  canEdit: boolean;
  /** 편집: 마크다운 파일인가 — [서식 ▸] */
  markdown: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 읽기: [새 문서…] — `true` 눌림 · `false` 흐리게 · `null`/없음 줄 없음(`app/new-doc` 의 `newDocState` — 타일 ⋯ 와 같은 판정) */
  newDoc?: boolean | null;
}

const item = (key: DocMenuKey, label: string, icon: string | null, extra: Partial<PaneMenuItem> = {}): PaneMenuItem => ({
  action: `${TOOL_ACTION_PREFIX}${key}`,
  label,
  icon,
  ...extra,
});

/** 서식 옆목록의 줄들 */
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

/** 옆목록 셋 — 서식(글자) · 단락(줄) · 삽입 */
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

export function docMenuItems(ctx: DocMenuCtx, tr: Tr): PaneMenuRow[] {
  const rows: PaneMenuRow[] = [];
  /** 앞에 줄이 있을 때만 구분선 — 첫 줄은 긋지 않는다 */
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
