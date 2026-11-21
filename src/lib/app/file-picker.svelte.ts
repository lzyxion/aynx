import { forgetFocusOrigin, rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { openDoc, resolveLocalCwd, resolveSshCwd, sftpDirOf } from "$lib/app/panes.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { activeTab, paneOf } from "$lib/app/tabs.svelte.js";
import { localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import {
  filePickerRoot,
  scanTextFiles,
  type FilePickerRoot,
  type PickerFile,
} from "$lib/file-picker";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { paneCwd } from "$lib/shell-integration";
import { findPane, type PaneSpec } from "$lib/session";

/** 팔레트 "파일 열기…" 의 저장소 (docs/log/2026-09-27-doc-tile.md) */

const FOCUS_KEY = "file-picker";

export type PickerLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; files: PickerFile[]; truncated: boolean };

let open = $state(false);
let anchor = $state<{ tabId: string; paneId: string } | null>(null);
let where = $state<{ root: string; remote: boolean; alias: string } | null>(null);
let load = $state<PickerLoad>({ state: "loading" });
/** 원격이면 빌릴 터미널 — 고른 파일이 이것으로 열린다 */
let source: FilePickerRoot | null = null;
/** 늦게 온 옛 훑기를 버리는 번호 */
let seq = 0;

export function filePickerVisible(): boolean {
  return open;
}

export function filePickerWhere(): { root: string; remote: boolean; alias: string } | null {
  return where;
}

export function filePickerLoad(): PickerLoad {
  return load;
}

async function focusedCwdOf(pane: PaneSpec | null): Promise<string | null> {
  if (!pane) return null;
  if (pane.kind === "local") return (await resolveLocalCwd(pane)) ?? null;
  if (pane.kind === "ssh") return pane.tmux ? ((await resolveSshCwd(pane)) ?? null) : paneCwd(pane.id);
  return null;
}

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
    const got = await scanTextFiles(backend, base);
    if (my !== seq) return;
    if (root.where === "local") where = { root: got.root, remote: false, alias: "" };
    load = { state: "ready", files: got.files, truncated: got.truncated };
  } catch (e) {
    if (my !== seq) return;
    load = { state: "error", message: stripReason(e instanceof Error ? e.message : String(e)) };
  }
}

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

export function closeFilePicker(): void {
  if (!open) return;
  open = false;
  seq += 1;
  returnFocus(FOCUS_KEY);
}

export function toggleFilePicker(): void {
  if (open) closeFilePicker();
  else openFilePicker();
}

/** 닫으며 포커스를 돌려주지 않는다 — 연 문서가 포커스를 갖는다 */
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
