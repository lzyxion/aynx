import { toast } from "$lib/toast.svelte.js";
import { showNotice } from "$lib/app/notice";
import { isAgentPane } from "$lib/app/agent-status.svelte.js";
import { stageAgentFiles, stageFsPaths } from "$lib/agent-attachments";
import { flipViewOf } from "$lib/pane/ai-flip.svelte.js";
import { baseName } from "$lib/pane/composer-attachments";
import { stageComposerAttachments } from "$lib/pane/composer-attachments.svelte.js";
import { fsDragActive, shellQuoteAll, type FsDrag } from "$lib/fs-drag";
import { fsDropAction, sessionOfFsKey } from "$lib/fs-drop-route";
import { broadcastInput } from "$lib/sync.svelte.js";
import { termActionsOf } from "$lib/term-actions";
import { promptsBlocking } from "$lib/app/prompts.svelte.js";
import {
  forgetFocusOrigin,
  rememberFocusOrigin,
  returnFocus,
} from "$lib/app/focus-return.svelte.js";
import { hostFormOpen } from "$lib/app/hosts.svelte.js";
import { activeSessionId, fsDropRouteTo, liveSession, sessionOf } from "$lib/app/sessions.svelte.js";
import { bumpSftpRefresh, sftpDirOf } from "$lib/app/panes.svelte.js";
import { focusTile, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { localBackend, LOCAL_KEY } from "$lib/fs-backend";
import { notifyFsRefresh } from "$lib/fs-refresh.svelte";
import { setPaneForwards } from "$lib/app/forwards.svelte.js";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import {
  addForward,
  invalidPort,
  listForwards,
  type ForwardKind,
  type ForwardPreset,
} from "$lib/forward";
import {
  editRemoteFile,
  isAlreadyExists,
  uploadDirValue,
  uploadFile,
  uploadVerb,
  DEFAULT_REMOTE_DIR,
  type UploadTarget,
  type UploadState,
  type UploadVerb,
} from "$lib/sftp";
import { stripReason } from "$lib/error-reason";
import { isRemote } from "$lib/ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { findPane, hasSession, paneName, type SessionKind } from "$lib/session";

/**
 * 세션 하나에 매달린 모달 셋 — 포트 포워딩 · 파일 업로드/가져오기 · 원격 파일 편집.
 * 대상 세션이 사라지면 창을 닫는다 — 업로드만 전송 중에는 닫지 않는다(그 줄에 오류가 남아야 한다).
 * 모달 우선순위: 호스트 키 → 비밀번호 → 호스트 폼 → 포워딩 → 업로드 → 원격 편집.
 */

// ── 포트 포워딩 ──

const FOCUS_FORWARD = "forward";
const FOCUS_UPLOAD = "upload";
const FOCUS_REMOTE_EDIT = "remote-edit";

let forwardOpen = $state(false);
let forwardPane = $state<string | null>(null);

// 타일별 포워드 표는 `app/forwards.svelte.ts` 에 산다 — 이 파일은 `hostFormOpen` 으로 `app/hosts` 와 얽혀 있어 여기 두면 값 순환이 선다.

export const fw = $state<{
  /** 모달을 열 때마다 로컬로 돌아간다 — 지난번 종류가 남으면 다른 뜻의 칸에 치게 된다. */
  kind: ForwardKind;
  localPort: number | null;
  remoteHost: string;
  remotePort: number | null;
  error: string | null;
  busy: boolean;
  firstField: HTMLInputElement | null;
}>({
  kind: "local",
  localPort: null,
  remoteHost: "localhost",
  remotePort: null,
  error: null,
  busy: false,
  firstField: null,
});

export function forwardVisible(): boolean {
  return forwardOpen && !promptsBlocking() && !hostFormOpen();
}

async function refreshForwards(): Promise<void> {
  const sid = activeSessionId();
  if (sid === null || forwardPane === null) return;
  setPaneForwards(forwardPane, await listForwards(sid));
}

function openForward(): void {
  if (activeSessionId() === null) return;
  fw.error = null;
  fw.kind = "local";
  fw.localPort = null;
  fw.remoteHost = "localhost";
  fw.remotePort = null;
  forwardOpen = true;
}

/** 모달은 활성 패널의 세션만 본다 — 대상을 따로 두면 상태가 갈리므로 가리킨 타일을 먼저 활성으로 만든다. */
export function openForwardFor(tabId: string, paneId: string): void {
  // 타일을 옮기기 전에 적는다 — 돌아갈 자리는 방금까지 키보드를 쥐고 있던 타일이다.
  rememberFocusOrigin(FOCUS_FORWARD);
  focusTile(tabId, paneId);
  if (activeSessionId() === null) {
    forgetFocusOrigin(FOCUS_FORWARD);
    showNotice(t("files.transfer.connecting"));
    return;
  }
  forwardPane = paneId;
  openForward();
}

export function closeForward(): void {
  forwardOpen = false;
  fw.error = null;
  forwardPane = null;
  returnFocus(FOCUS_FORWARD);
}

export function closeForwardIfSessionGone(): void {
  if (!forwardVisible() || activeSessionId() !== null) return;
  forwardOpen = false;
  returnFocus(FOCUS_FORWARD);
}

export async function submitForward(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const sid = activeSessionId();
  if (sid === null || fw.busy) return;

  // 감춘 칸의 값은 보지도 보내지도 않는다 — `forward.ts` 의 `parseForwardRow` · Rust `port_forward::validate` 와 같은 규칙.
  if (invalidPort(fw.localPort)) {
    fw.error = t("files.transfer.forward.localport");
    return;
  }
  if (fw.kind !== "dynamic" && invalidPort(fw.remotePort)) {
    fw.error = t("files.transfer.forward.remoteport");
    return;
  }
  const host = fw.kind === "local" ? fw.remoteHost.trim() : "";
  if (fw.kind === "local" && host === "") {
    fw.error = t("files.transfer.forward.remotehost");
    return;
  }
  const preset: ForwardPreset = {
    kind: fw.kind,
    local_port: fw.localPort as number,
    remote_host: host,
    remote_port: fw.kind === "dynamic" ? 0 : (fw.remotePort as number),
  };

  fw.busy = true;
  fw.error = null;
  try {
    await addForward(sid, preset, t);
    await refreshForwards();
    closeForward();
  } catch (e) {
    fw.error = e instanceof Error ? e.message : String(e);
  } finally {
    fw.busy = false;
  }
}


// ── 업로드 / 가져오기 ──
// 한 번에 하나씩 올린다 — SFTP 채널이 세션당 하나이고 요청 파이프라이닝이 없어 동시에 밀어 넣어도 빨라지지 않는다(docs/verification/russh.md).

export interface UploadItem {
  file: File;
  state: UploadState;
  error: string | null;
  exists: boolean;
}

let uploadOpen = $state(false);
let target = $state<UploadTarget | null>(null);
let items = $state<UploadItem[]>([]);

export const up = $state<{
  pane: string;
  dir: string;
  busy: boolean;
  dirField: HTMLInputElement | null;
}>({ pane: "", dir: DEFAULT_REMOTE_DIR, busy: false, dirField: null });

export function uploadVisible(): boolean {
  return uploadOpen && !promptsBlocking() && !hostFormOpen() && !forwardVisible();
}

export function uploadTarget(): UploadTarget | null {
  return target;
}

export function uploadItems(): UploadItem[] {
  return items;
}

export function verb(): UploadVerb {
  return uploadVerb(target, isRemote);
}

export function uploadDone(): number {
  return items.filter((i) => i.state === "done").length;
}

export function uploadFailed(): number {
  return items.filter((i) => i.state === "error").length;
}

async function attachFiles(tabId: string, paneId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  await pasteAttachment(tabId, paneId, files.map((file) => ({ name: file.name, file })), (kind, sid) =>
    stageAgentFiles(kind, sid, files, t),
  );
}

async function pasteAttachment(
  tabId: string,
  paneId: string,
  shown: readonly { name: string; file?: File }[],
  stage: (kind: SessionKind, sid: number) => Promise<readonly string[]>,
): Promise<void> {
  const currentPane = () => {
    const tab = residentWindowTabs().find((tab) => tab.id === tabId);
    return tab ? findPane(tab.root, paneId) : null;
  };
  const pane = currentPane();
  const sid = sessionOf(paneId);
  const api = termActionsOf(paneId);
  if (!pane || !hasSession(pane.kind) || !isAgentPane(pane) || sid === null || !api?.bracketedPaste()) {
    showNotice(t("pane.drop.attach.notready"));
    return;
  }
  if (flipViewOf(paneId) === "convo") {
    const kind = pane.kind;
    focusTile(tabId, paneId);
    await stageComposerAttachments(paneId, shown, () => stage(kind, sid), () => {
      const now = currentPane();
      return !!now && isAgentPane(now) && sessionOf(paneId) === sid;
    });
    return;
  }
  try {
    const paths = await stage(pane.kind, sid);
    // 저장 중 닫히거나 재접속하거나 셸로 돌아온 타일에는 사본 경로를 보내지 않는다.
    const now = currentPane();
    if (!now || !isAgentPane(now) || sessionOf(paneId) !== sid || termActionsOf(paneId) !== api) {
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    if (api.insertText(`${shellQuoteAll(paths)} `) !== "ok") {
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    focusTile(tabId, paneId);
    api.focus();
  } catch (e) {
    showNotice(t("pane.drop.attach.failed", { message: stripReason(e instanceof Error ? e.message : String(e)) }));
  }
}

export function pasteFsDrag(tabId: string, paneId: string, drag: FsDrag): void {
  // 동기로 지금 읽는다 — 드롭이 끝나면 끌기 쪽이 그 값을 지운다.
  const sameWindow = fsDragActive() !== null;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane || !hasSession(pane.kind) || drag.paths.length === 0) return;
  const action = fsDropAction(fsDropRouteTo(pane, drag, sameWindow), isAgentPane(pane), pane.kind);
  const named = drag.paths.map((p) => ({ name: baseName(p) }));
  switch (action.kind) {
    case "notice":
      showNotice(t(action.key));
      return;
    case "broadcast":
      broadcastInput([paneId], shellQuoteAll(drag.paths));
      return;
    case "paste":
      void pasteAttachment(tabId, paneId, named, async () => drag.paths);
      return;
    case "upload":
      void pasteAttachment(tabId, paneId, named, (_, sid) => stageFsPaths("upload", sid, drag.paths, t));
      return;
    case "download": {
      const source = sessionOfFsKey(drag.backendKey);
      if (source === null) return;
      void pasteAttachment(tabId, paneId, named, () => stageFsPaths("download", source, drag.paths, t));
      return;
    }
  }
}

export function dropFiles(tabId: string, paneId: string, files: File[]): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane) return;

  if (hasSession(pane.kind) && isAgentPane(pane)) {
    void attachFiles(tabId, paneId, files);
    return;
  }

  if (pane.kind === "sftp") {
    const dir = sftpDirOf(paneId);
    if (!dir) {
      showNotice(t("files.transfer.drop.loading"));
      return;
    }
    openUploadTo(paneId, paneName(pane, t), dir, files);
    return;
  }

  if (pane.kind === "localfs") {
    // 비었으면 "내 PC"(합성 루트)를 보고 있다 — 놓을 자리가 없다.
    const dir = pane.path;
    if (!dir) {
      showNotice(t("files.transfer.drop.root"));
      return;
    }
    openUploadTo(paneId, dir, dir, files);
    return;
  }

  if (pane.kind !== "ssh") {
    showNotice(t("files.transfer.drop.sshonly"));
    return;
  }
  if (sessionOf(paneId) === null) {
    showNotice(t("files.transfer.drop.connecting"));
    return;
  }
  openUploadTo(paneId, paneName(pane, t), DEFAULT_REMOTE_DIR, files);
}

export function openUploadTo(paneId: string, label: string, dir: string, files: File[]): void {
  const tab = residentWindowTabs().find((t) => findPane(t.root, paneId) !== null);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (pane?.kind === "localfs") {
    target = { kind: "local" };
  } else {
    // SFTP 타일 자신은 세션 표에 없다 — 원본 터미널의 세션을 빌린다.
    const owner = pane?.kind === "sftp" ? (pane.sourcePaneId ?? "") : paneId;
    const sid = sessionOf(owner);
    if (sid === null) {
      showNotice(t("files.transfer.upload.offline"));
      return;
    }
    target = { kind: "remote", session: sid };
  }
  if (!uploadOpen) rememberFocusOrigin(FOCUS_UPLOAD);
  up.pane = label;
  up.dir = dir;
  items = files.map((file) => ({
    file,
    state: "waiting" as const,
    error: null,
    exists: false,
  }));
  up.busy = false;
  uploadOpen = true;
}

export function closeUpload(): void {
  if (up.busy) return; // 닫아도 전송은 계속된다
  uploadOpen = false;
  returnFocus(FOCUS_UPLOAD);
}

export function closeUploadIfSessionGone(): void {
  const dest = target;
  if (uploadVisible() && !up.busy && dest?.kind === "remote" && !liveSession(dest.session)) {
    uploadOpen = false;
    returnFocus(FOCUS_UPLOAD);
    showNotice(t("files.transfer.upload.sessiongone"));
  }
}

async function uploadOne(
  item: UploadItem,
  to: UploadTarget,
  dir: string,
  overwrite: boolean,
): Promise<void> {
  item.state = verb().ing;
  item.error = null;
  item.exists = false;
  try {
    if (to.kind === "local") {
      await localBackend().uploadBytes?.(dir, item.file, overwrite ? "overwrite" : "fail", t);
    } else {
      await uploadFile(to.session, dir, item.file, overwrite, t);
    }
    item.state = "done";
    if (to.kind === "local") notifyFsRefresh(LOCAL_KEY);
    else bumpSftpRefresh();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    item.state = "error";
    item.error = stripReason(message);
    item.exists = isAlreadyExists(message);
  }
}

export async function submitUpload(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const to = target;
  if (to === null || up.busy) return;
  const dir = uploadDirValue(up.dir, to);

  up.busy = true;
  for (const item of items) {
    if (item.state === "done") continue;
    await uploadOne(item, to, dir, false);
  }
  up.busy = false;

  if (uploadFailed() === 0 && items.length > 0) {
    const text = t(verb().done, { n: items.length, dir });
    toast.success(text);
    recordNotification({ kind: "transfer", text, level: "success" });
    uploadOpen = false;
    returnFocus(FOCUS_UPLOAD);
  }
}

export async function retryOverwrite(item: UploadItem): Promise<void> {
  const to = target;
  if (to === null || up.busy) return;
  up.busy = true;
  await uploadOne(item, to, uploadDirValue(up.dir, to), true);
  up.busy = false;
}

// ── 원격 파일 편집 ──

let editOpen = $state(false);
let editSession = $state<number | null>(null);

export const ed = $state<{
  pane: string;
  path: string;
  error: string | null;
  busy: boolean;
  field: HTMLInputElement | null;
}>({ pane: "", path: "", error: null, busy: false, field: null });

export function remoteEditVisible(): boolean {
  return (
    editOpen && !promptsBlocking() && !hostFormOpen() && !forwardVisible() && !uploadVisible()
  );
}

export function openRemoteEdit(tabId: string, paneId: string): void {
  // 원격 창에는 이 모달이 없다 — `edit_remote_file` 은 `remote/deny.rs` 가 거절한다. 남은 입구인 단축키도 여기서 막는다.
  if (isRemote) return;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane) return;
  if (pane.kind !== "ssh") {
    showNotice(t("files.transfer.edit.sshonly"));
    return;
  }
  const sid = sessionOf(paneId);
  if (sid === null) {
    showNotice(t("files.transfer.connecting"));
    return;
  }
  if (!editOpen) rememberFocusOrigin(FOCUS_REMOTE_EDIT);
  editSession = sid;
  ed.pane = paneName(pane, t);
  ed.path = "";
  ed.error = null;
  editOpen = true;
}

export function closeRemoteEdit(): void {
  editOpen = false;
  ed.error = null;
  returnFocus(FOCUS_REMOTE_EDIT);
}

export function closeRemoteEditIfSessionGone(): void {
  if (!remoteEditVisible() || editSession === null || liveSession(editSession)) return;
  editOpen = false;
  returnFocus(FOCUS_REMOTE_EDIT);
}

export async function submitRemoteEdit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const sid = editSession;
  if (sid === null || ed.busy) return;
  const path = ed.path.trim();
  if (path === "") {
    ed.error = t("files.transfer.edit.path");
    return;
  }
  ed.busy = true;
  ed.error = null;
  try {
    const info = await editRemoteFile(sid, path);
    editOpen = false;
    returnFocus(FOCUS_REMOTE_EDIT);
    showNotice(t("files.transfer.edit.opened", { name: info.file_name }));
  } catch (e) {
    ed.error = e instanceof Error ? e.message : String(e);
  } finally {
    ed.busy = false;
  }
}
