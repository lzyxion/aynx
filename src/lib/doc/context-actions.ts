/**
 * **문서 타일 본문 우클릭 메뉴의 동작** — `DocView.svelte` 에서 그대로 옮겼다(2026-10-26 분할 3차). 줄(모양 · 열쇠)은 `doc-menu.ts`, 메뉴를 띄우는 일과
 * 링크 · 고른 글의 **누른 순간 스냅숏**(`onBodyContextMenu`)은 `DocView` 가 쥐고, 여기는 그 스냅숏을 받아 DOM 선택 · OS 클립보드 · 편집기 명령으로 옮기는
 * 어댑터다. 메뉴 실행은 `PaneHost` 의 메뉴 통로(스냅숏 → 닫기 → 실행)를 그대로 지난다. 상태 · 리스너는 없다.
 */
import type { DocFormat } from "$lib/doc-format";
import type { DocMenuKey } from "$lib/doc-menu";
import { classifyDocHref } from "$lib/doc-links";
import { readClipboard, writeClipboard } from "$lib/clipboard";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 그 상자 안의 고른 글 — 선택이 밖에 걸쳤으면 없음 */
export function selectionIn(box: Element): string {
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return "";
  return box.contains(s.getRangeAt(0).commonAncestorContainer) ? s.toString() : "";
}

/** 읽기의 모두 선택 — 그 글 상자의 내용 전부 */
export function selectAllIn(box: Element) {
  const s = window.getSelection();
  if (!s) return;
  const r = document.createRange();
  r.selectNodeContents(box);
  s.removeAllRanges();
  s.addRange(r);
}

export function copyText(text: string) {
  void writeClipboard(text).then((ok) => {
    if (!ok) toast.error(t("files.doc.menu.copy.fail"));
  });
}

/** 읽기 모양 줄이 부르는 `DocView` 의 동작 — `editing` 은 **실행 순간**의 값을 읽는다(예전 그대로) */
export interface ReadMenuActions {
  editing(): boolean;
  openLink(href: string): void;
  openDocLink(href: string): void;
  openPreviewDocLink(href: string): void;
  openFind(): boolean;
  startEdit(): void;
}

/** 읽기 모양의 줄 — 열쇠는 `doc-menu.ts` 의 것 */
export function runReadMenu(key: string, at: { box: Element; link: string | null; sel: string }, a: ReadMenuActions) {
  switch (key as DocMenuKey) {
    case "open-link": {
      if (at.link === null) return;
      const c = classifyDocHref(at.link);
      if (c.kind === "web") return a.openLink(at.link);
      return a.editing() ? a.openPreviewDocLink(at.link) : a.openDocLink(at.link);
    }
    case "copy-link":
      return at.link === null ? undefined : copyText(at.link);
    case "copy":
      return copyText(at.sel);
    case "select-all":
      return selectAllIn(at.box);
    case "find":
      return void a.openFind();
    case "edit":
      return a.startEdit();
  }
}

/** 편집 모양 줄이 부르는 편집기 명령(`DocEditor` 의 내보낸 함수 — 키와 같은 명령) */
export interface MenuEditor {
  format(kind: DocFormat): void;
  command(cmd: "undo" | "redo" | "selectAll"): void;
  insertText(text: string): void;
  openSearch(): void;
}

/** 편집 모양의 줄 — 편집기 명령(키와 같은 명령)으로 */
export function runEditMenu(ed: MenuEditor, key: string, sel: string, save: () => Promise<boolean>) {
  if (key.startsWith("fmt:")) return ed.format(key.slice(4) as DocFormat);
  switch (key as DocMenuKey) {
    case "undo":
      return ed.command("undo");
    case "redo":
      return ed.command("redo");
    case "select-all":
      return ed.command("selectAll");
    case "copy":
      return copyText(sel);
    case "cut":
      return void writeClipboard(sel).then((ok) => (ok ? ed.insertText("") : toast.error(t("files.doc.menu.copy.fail"))));
    case "paste":
      return void readClipboard().then((text) => {
        if (text === null) toast.error(t("files.doc.menu.paste.fail"));
        else if (text !== "") ed.insertText(text);
      });
    case "find":
      return ed.openSearch();
    case "save":
      return void save();
  }
}
