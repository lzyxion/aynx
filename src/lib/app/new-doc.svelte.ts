import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { hasReason, stripReason } from "$lib/error-reason";
import { baseNameOf, localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import { tick } from "svelte";
import { NEW_DOC_DEFAULT, newDocName, stemEnd } from "$lib/doc-new";
import { beginInlineEdit, createInlineEdit, resetInlineEdit } from "$lib/browser/inline-edit.svelte";
import type { PaneSpec } from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { findPaneAnywhere, focusTile, tabOfPane } from "$lib/app/tabs.svelte.js";
import { docSourceOf, openDoc, type DocSource } from "$lib/app/panes.svelte.js";
import { setDocEdit } from "$lib/app/doc-anchors.svelte.js";

/**
 * 만들기는 `FsBackend.createFile` — 이미 있으면 백엔드가 `[exists]` 로 거절하고 덮어쓰지 않는다. 새 Tauri 명령은 없다.
 * 연 타일의 한 번짜리 "편집으로" 는 명세에 적지 않는다(`app/doc-anchors`).
 */

export interface NewDocBox {
  paneId: string;
  /** 백엔드는 만들 때 다시 짓는다 — 그사이 재연결로 세션이 바뀔 수 있다 */
  source: DocSource | undefined;
  dir: string;
  dirName: string;
  anchor: { x: number; y: number };
  busy: boolean;
}

let box = $state<NewDocBox | null>(null);

export const newDocEdit = createInlineEdit();

export function newDocBox(): NewDocBox | null {
  return box;
}

export function newDocBoxOpen(): boolean {
  return box !== null;
}

function backendOf(source: DocSource | undefined): FsBackend {
  return source ? remoteBackend(sessionOf(source.paneId)) : localBackend();
}

function targetOf(pane: PaneSpec | null): { source: DocSource | undefined; backend: FsBackend } | "blocked" | null {
  if (!pane || pane.kind !== "doc" || !pane.path) return null;
  const source = docSourceOf(pane);
  if (source === null) return "blocked";
  const backend = backendOf(source);
  return backend.canWrite && backend.online ? { source, backend } : "blocked";
}

/** `null` = 줄 없음 · `true` = 누를 수 있음 · `false` = 흐리게 */
export function newDocState(paneId: string): boolean | null {
  const target = targetOf(findPaneAnywhere(paneId));
  return target === null ? null : target !== "blocked";
}

/** 메뉴 통로(`runOnMenu`)가 메뉴를 닫은 뒤에 부른다 */
export function openNewDoc(paneId: string, anchor: { x: number; y: number } | null): void {
  const pane = findPaneAnywhere(paneId);
  const target = targetOf(pane);
  if (target === null || !pane?.path) return;
  if (target === "blocked") {
    showNotice(t("files.doc.edit.block.offline"));
    return;
  }
  const dir = target.backend.parentOf(pane.path);
  box = {
    paneId,
    source: target.source,
    dir,
    dirName: baseNameOf(dir) || dir,
    anchor: anchor ?? { x: Math.max(8, window.innerWidth / 2 - 160), y: Math.max(8, window.innerHeight / 3) },
    busy: false,
  };
  beginInlineEdit(newDocEdit, NEW_DOC_DEFAULT);
}

export function closeNewDoc(back: "source" | "none"): void {
  const b = box;
  box = null;
  resetInlineEdit(newDocEdit);
  if (back !== "source" || b === null) return;
  const tab = tabOfPane(b.paneId);
  if (tab) focusTile(tab.id, b.paneId);
}

export async function submitNewDoc(): Promise<void> {
  const b = box;
  if (b === null || b.busy) return;
  if (findPaneAnywhere(b.paneId) === null) {
    closeNewDoc("none");
    return;
  }
  const backend = backendOf(b.source);
  if (!backend.canWrite || !backend.online) {
    newDocEdit.error = t("files.doc.edit.block.offline");
    return;
  }
  const name = newDocName(newDocEdit.value, backend.sep);
  if (!name.ok) {
    newDocEdit.error = t(name.error, name.params);
    return;
  }
  b.busy = true;
  let made: string;
  try {
    made = await backend.createFile(backend.joinPath(b.dir, name.name));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (box === b) {
      b.busy = false;
      newDocEdit.error = hasReason(message, "exists") ? t("files.doc.new.exists") : stripReason(message);
      // 만드는 동안 `disabled` 라 포커스가 `<body>` 로 떨어졌다 — 칸이 다시 살아난 뒤(tick) 돌려준다
      void tick().then(() => {
        const input = newDocEdit.el;
        if (box !== b || !input) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(0, stemEnd(input.value));
      });
    }
    return;
  }
  if (box === b) closeNewDoc("none");
  const tab = tabOfPane(b.paneId);
  const opened = tab ? openDoc({ tabId: tab.id, nearPaneId: b.paneId, path: made, source: b.source }) : null;
  if (opened === null) {
    showNotice(t("files.doc.new.notOpened", { path: made }));
    return;
  }
  setDocEdit(opened);
}
