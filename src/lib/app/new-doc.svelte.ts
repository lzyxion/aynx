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
 * **문서 타일의 [새 문서…]** (2026-11-11) — 타일 ⋯ 와 본문 우클릭(읽기 모양)의 같은 줄(`new-doc` — 배선은 `pane/tile-menu-controller` 의 한 칸)이
 * 지금 보는 문서와 **같은 폴더 · 같은 백엔드**(로컬이면 이 컴퓨터, 원격 문서면 그 문서가 빌리던 터미널의 SFTP)에 빈 파일을 만들고 곧바로 편집으로 연다.
 *
 * - 이름 규칙은 순수 층 `$lib/doc-new`(파일 타일의 새 파일과 같은 금지 글자 검사 · `.md` 붙이기 · 텍스트로 열 수 없는 이름 거절).
 * - 만들기는 파일 타일의 [새 파일…]과 같은 `FsBackend.createFile` — 이미 있으면 백엔드가 `[exists]` 로 거절하고 **덮어쓰지 않는다**. 그 거절과 다른
 *   실패는 상자 안에 적고 상자를 닫지 않는다(파일 타일 인라인 폼과 같은 방식 — 이유 코드는 떼고 적는다). 새 Tauri 명령은 없다.
 * - 여는 것은 여는 문 하나(`app/panes` 의 `openDoc`) — 자리 규칙(같은 파일이면 포커스 · 저장 안 한 변경이 없는 미리 보기면 갈아 끼움 · 아니면 옆)도
 *   그대로다. 편집 중인 문서는 편집하는 동안 고정이라(`dc.startEdit`) 갈아 끼워지지 않는다. 연 타일에는 한 번짜리 "편집으로" 를 건다(`app/doc-anchors`
 *   — 명세에 적지 않는다).
 * - 상자(`doc/NewDocBox.svelte`)는 `+page` 에 늘 마운트돼 이 상태가 있을 때만 그린다 — 메뉴가 서 있던 자리에 뜬다(AI 권한 · tmux 세션의 "메뉴를
 *   닫고 상자를 연다" 몸짓). 모양은 파일 타일 메뉴의 인라인 폼(전역 `.menu-*` · `inline-edit`)이다. 전역 키 가드(`anyModalOpen`) · Escape 사슬에 든다.
 *
 * 줄이 서는 때: 문서 타일이 파일을 보여 주고(`path`) 그 백엔드에 쓸 수 있을 때 — 끊긴 원격 · 원본 터미널을 잃은 원격은 흐리게(까닭은 편집 단추와
 * 같은 `files.doc.edit.block.offline`).
 */

/** 상자의 상태 — 있으면 상자가 뜬다 */
export interface NewDocBox {
  /** [새 문서…]를 누른 문서 타일 — 새 문서가 이 곁에 선다 · Esc 로 포커스가 돌아온다 */
  paneId: string;
  /** 그 문서의 백엔드 출처(`docSourceOf` — 없으면 로컬). 백엔드는 만들 때 다시 짓는다(그사이 재연결로 세션이 바뀔 수 있다) */
  source: DocSource | undefined;
  /** 만들 폴더(지금 문서의 폴더) */
  dir: string;
  /** 라벨에 보일 폴더 이름(마지막 조각) */
  dirName: string;
  /** 상자의 왼쪽 위(화면 좌표) */
  anchor: { x: number; y: number };
  /** 만드는 중 — 두 번 눌러 둘을 만들지 않게 */
  busy: boolean;
}

let box = $state<NewDocBox | null>(null);

/** 이름 칸 — 파일 타일 인라인 폼과 같은 한 칸(`inline-edit`) */
export const newDocEdit = createInlineEdit();

/** 떠 있는 상자 (없으면 `null`) — `NewDocBox.svelte` 가 읽는다 */
export function newDocBox(): NewDocBox | null {
  return box;
}

/** 상자가 떠 있는가 — 전역 키 가드(`anyModalOpen`)가 본다 */
export function newDocBoxOpen(): boolean {
  return box !== null;
}

function backendOf(source: DocSource | undefined): FsBackend {
  return source ? remoteBackend(sessionOf(source.paneId)) : localBackend();
}

/** 그 타일에서 새 문서를 만들 자리 — 파일을 보이지 않는 타일이면 `null`, 쓸 수 없으면(끊김 · 원본 없음) `"blocked"` */
function targetOf(pane: PaneSpec | null): { source: DocSource | undefined; backend: FsBackend } | "blocked" | null {
  if (!pane || pane.kind !== "doc" || !pane.path) return null;
  const source = docSourceOf(pane);
  if (source === null) return "blocked";
  const backend = backendOf(source);
  return backend.canWrite && backend.online ? { source, backend } : "blocked";
}

/** 메뉴 줄의 상태 — `null` = 줄 없음 · `true` = 누를 수 있음 · `false` = 흐리게(반응형으로 읽힌다) */
export function newDocState(paneId: string): boolean | null {
  const target = targetOf(findPaneAnywhere(paneId));
  return target === null ? null : target !== "blocked";
}

/** 상자를 연다 — 메뉴 통로(`runOnMenu`)가 메뉴를 닫은 **뒤에** 부른다. `anchor` 는 메뉴가 서 있던 자리 */
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

/** 상자를 닫는다. `"source"` 면 포커스를 그 문서 타일로 돌려준다(Esc) */
export function closeNewDoc(back: "source" | "none"): void {
  const b = box;
  box = null;
  resetInlineEdit(newDocEdit);
  if (back !== "source" || b === null) return;
  const tab = tabOfPane(b.paneId);
  if (tab) focusTile(tab.id, b.paneId);
}

/** [만들기] · Enter — 거절 · 실패는 상자 안에 적고 닫지 않는다. 되면 닫고 그 파일을 문서 타일로 열어 한 번 편집으로 */
export async function submitNewDoc(): Promise<void> {
  const b = box;
  if (b === null || b.busy) return;
  // 그사이 그 문서 타일이 닫혔다 — 곁에 열 자리가 없으니 만들지 않는다
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
      // 만드는 동안 칸 · 단추가 `disabled` 라 포커스가 `<body>` 로 떨어졌다 — 칸이 다시 살아난 뒤(tick) 돌려주고 이름 부분을 고른다(곧바로 고쳐 친다)
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
