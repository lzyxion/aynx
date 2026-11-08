import { invoke } from "../ipc";
import { forgetFocusOrigin, rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { openDoc, resolveLocalCwd, resolveSshCwd, sftpDirOf } from "$lib/app/panes.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { activeTab, paneOf } from "$lib/app/tabs.svelte.js";
import { localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import {
  filePickerRoot,
  listRemoteShallow,
  textEntries,
  type FilePickerRoot,
  type PickerFile,
} from "$lib/file-picker";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { paneCwd } from "$lib/shell-integration";
import { findPane, type PaneSpec } from "$lib/session";

/**
 * **팔레트 "파일 열기…" — 저장소** (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
 *
 * 포커스된 타일의 폴더(로컬이면 재귀 목록 `list_text_files`, 원격이면 두 층까지 SFTP)를 훑어 고르는 목록
 * (`FilePicker.svelte` — 팔레트 자리에 뜬다)에 내리고, 고른 파일은 **여는 문 하나**([`openDoc`] — 미리 보기 규칙)로
 * 연다. 규칙(뿌리 · 거르기 · 순위 · 원격 두 층)은 순수 층 `$lib/file-picker`.
 *
 * 입구는 단축키 `open-file` 하나이고 팔레트의 "파일 열기…" 줄도 그 액션이다. 열 때마다 새로 훑는다(목록을 들고
 * 있지 않는다 — 디스크가 바뀌었을 수 있고, 한 번의 훑기는 상한이 있어 짧다).
 */

const FOCUS_KEY = "file-picker";

/** 지금 목록의 상태 — 읽는 중 · 실패 · 다 읽음 */
export type PickerLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; files: PickerFile[]; truncated: boolean };

let open = $state(false);
/** 연 타일 — 곁에 열 자리 · 뿌리의 주인 */
let anchor = $state<{ tabId: string; paneId: string } | null>(null);
/** 훑은 뿌리(보일 모양) · 원격인가 · 원격이면 별칭 */
let where = $state<{ root: string; remote: boolean; alias: string } | null>(null);
let load = $state<PickerLoad>({ state: "loading" });
/** 문을 열 때 정한 원본(원격이면 빌릴 터미널) — 고른 파일이 이것으로 열린다 */
let source: FilePickerRoot | null = null;
/** 늦게 온 옛 훑기를 버리는 번호 */
let seq = 0;

/** 떠 있나 — 반응형(창의 키 가드 · Escape 사슬이 본다) */
export function filePickerVisible(): boolean {
  return open;
}

export function filePickerWhere(): { root: string; remote: boolean; alias: string } | null {
  return where;
}

export function filePickerLoad(): PickerLoad {
  return load;
}

/** 포커스된 터미널의 지금 폴더(느린 부분 — 로컬은 `local_cwd` 왕복, tmux 는 tmux 에게 묻는다) */
async function focusedCwdOf(pane: PaneSpec | null): Promise<string | null> {
  if (!pane) return null;
  if (pane.kind === "local") return (await resolveLocalCwd(pane)) ?? null;
  if (pane.kind === "ssh") return pane.tmux ? ((await resolveSshCwd(pane)) ?? null) : paneCwd(pane.id);
  return null;
}

/** 여는 순간의 탭 · 포커스된 타일을 보고 뿌리를 정해 훑는다 */
async function scan(my: number): Promise<void> {
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  const root = filePickerRoot({
    focused: pane,
    focusedCwd: await focusedCwdOf(pane),
    sftpDir: pane?.kind === "sftp" ? sftpDirOf(pane.id) : null,
    tab,
  });
  if (my !== seq) return;
  source = root;
  if (root === null) {
    load = { state: "error", message: t("app.filePicker.noSource") };
    return;
  }
  const backend: FsBackend =
    root.where === "remote" ? remoteBackend(sessionOf(root.source.paneId)) : localBackend();
  if (!backend.online) {
    load = { state: "error", message: t("app.filePicker.offline") };
    return;
  }
  try {
    const base = root.root ?? (await backend.home());
    if (my !== seq) return;
    where = { root: base, remote: root.where === "remote", alias: root.where === "remote" ? root.source.alias : "" };
    if (root.where === "local") {
      const idx = await invoke<{ root: string; files: PickerFile[]; truncated: boolean }>("list_text_files", {
        root: base,
        limit: 20000,
      });
      if (my !== seq) return;
      where = { root: idx.root, remote: false, alias: "" };
      load = { state: "ready", files: textEntries(idx.files), truncated: idx.truncated };
    } else {
      const got = await listRemoteShallow((p) => backend.list(p), base);
      if (my !== seq) return;
      load = { state: "ready", files: textEntries(got.files), truncated: got.truncated };
    }
  } catch (e) {
    if (my !== seq) return;
    load = { state: "error", message: stripReason(e instanceof Error ? e.message : String(e)) };
  }
}

/** 연다 — 지금 탭의 포커스된 타일 기준(단축키 · 팔레트 줄). 열 때마다 새로 훑는다 */
export function openFilePicker(): void {
  const tab = activeTab();
  if (!open) rememberFocusOrigin(FOCUS_KEY);
  anchor = tab ? { tabId: tab.id, paneId: paneOf(tab) } : null;
  where = null;
  load = { state: "loading" };
  source = null;
  open = true;
  seq += 1;
  void scan(seq);
}

/** 닫는다 — 포커스는 연 자리로 */
export function closeFilePicker(): void {
  if (!open) return;
  open = false;
  seq += 1;
  returnFocus(FOCUS_KEY);
}

/** 단축키는 토글이다 — 같은 키로 열고 닫는다 */
export function toggleFilePicker(): void {
  if (open) closeFilePicker();
  else openFilePicker();
}

/**
 * 파일 하나를 골랐다 — 연 타일 곁에 문서로(미리 보기 규칙 · [`openDoc`]). 갈 곳을 이 동작이 정하므로 닫으며 포커스를
 * 돌려주지 않는다(새 문서 · 갈아 끼운 미리 보기 · 이미 있던 문서가 포커스를 갖는다).
 */
export function pickFile(f: PickerFile): void {
  const at = anchor;
  const root = source;
  open = false;
  seq += 1;
  forgetFocusOrigin(FOCUS_KEY);
  if (!at || !root) return;
  openDoc({
    tabId: at.tabId,
    nearPaneId: at.paneId,
    path: f.path,
    source: root.where === "remote" ? root.source : undefined,
  });
}
