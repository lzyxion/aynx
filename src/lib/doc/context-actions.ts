/** 문서 타일 본문 우클릭 메뉴의 동작 — 누른 순간의 스냅숏(`DocView`)을 받아 실행한다. */
import type { DocFormat } from "$lib/doc-format";
import type { DocMenuKey } from "$lib/doc-menu";
import { classifyDocHref } from "$lib/doc-links";
import { readClipboard, writeClipboard } from "$lib/clipboard";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 선택이 상자 밖에 걸쳤으면 빈 글 */
export function selectionIn(box: Element): string {
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return "";
  return box.contains(s.getRangeAt(0).commonAncestorContainer) ? s.toString() : "";
}

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

/** `editing` 은 메뉴를 띄운 때가 아니라 실행 순간의 값을 읽는다 */
export interface ReadMenuActions {
  editing(): boolean;
  openLink(href: string): void;
  openDocLink(href: string): void;
  openPreviewDocLink(href: string): void;
  openFind(): boolean;
  startEdit(): void;
}

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

export interface MenuEditor {
  format(kind: DocFormat): void;
  command(cmd: "undo" | "redo" | "selectAll"): void;
  insertText(text: string): void;
  openSearch(): void;
}

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
