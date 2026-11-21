import { tick } from "svelte";
import { invoke, isRemote } from "../ipc";
import type { WorkspaceLoad } from "$lib/workspaces/schema";
import { t } from "$lib/i18n/i18n.svelte.js";
import { showNotice } from "$lib/app/notice";
import { closeTab, docNameOf, focusedPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { focusPaneBody } from "$lib/pane/focus";
import { isDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import { hasSession, listPanes, newTab } from "$lib/session";
import { isSavedSplit, type SavedNode } from "$lib/tabs";
import { requestWindow } from "$lib/workspaces/window-events";
import { auxWorkspaceWindow } from "$lib/app/workspace-status.svelte.js";
import {
  createWorkspace, currentWorkspaceId, flushWorkspaceSave, mutateWorkspace,
  prepareWorkspaceDelete, removeWorkspace, renameWorkspace, setWorkspaceStyle, switchWorkspace, workspaceList, workspaceMainWindow,
} from "$lib/app/workspaces.svelte.js";

export const workspaceNamePrompt = $state({ open: false, name: "", busy: false });
export const workspaceEditPrompt = $state({
  open: false, id: null as string | null, name: "", icon: "", color: "", busy: false, error: null as string | null,
});
let deleting = false;
export const workspaceDeletePrompt = $state({
  open: false, name: "", tabs: 0, sessions: 0,
});
let resolveDelete: ((confirmed: boolean) => void) | null = null;

export function closeWorkspaceDeletePrompt(): void {
  workspaceDeletePrompt.open = false;
  resolveDelete?.(false);
  resolveDelete = null;
  const pane = focusedPane();
  if (pane) void tick().then(() => focusPaneBody(pane.id));
}
export function submitWorkspaceDeletePrompt(): void {
  workspaceDeletePrompt.open = false;
  resolveDelete?.(true);
  resolveDelete = null;
}

/**
 * 주 창에 그 워크스페이스의 탭이 없고 보조 창이 쥐고 있으면 그 창을 앞으로 부른다 — 주 창에 빈 시작 화면을 만들지 않는다.
 * 보조 창은 제 워크스페이스 하나에만 묶여 있어 주 창에 전환을 청한다.
 */
export function openWorkspace(id: string): void {
  if (workspaceMainWindow()) {
    const workspace = workspaceList().find((w) => w.id === id);
    if (!workspace) return;
    const here = workspace.materialized
      ? residentWindowTabs().some((tab) => tab.workspaceId === id)
      : workspace.savedTabs.some((tab) => tab.placement.kind === "main");
    const label = here ? null : auxWorkspaceWindow(id);
    if (label !== null) {
      void invoke("focus_window", { label }).catch(() => {});
      return;
    }
    switchWorkspace(id);
    return;
  }
  // 원격 창은 이 창에서만 바꾼다 — 메인 PC 화면은 움직이지 않는다.
  if (isRemote) {
    switchWorkspace(id);
    return;
  }
  if (id === currentWorkspaceId()) return;
  void requestWindow("main", { kind: "focus", workspaceId: id })
    .then(() => invoke("focus_window", { label: "main" }))
    .catch(() => {});
}

export function newWorkspacePrompt(): void {
  if (!workspaceMainWindow()) return;
  workspaceNamePrompt.name = "";
  workspaceNamePrompt.open = true;
}
export function editWorkspacePrompt(id = currentWorkspaceId()): void {
  const workspace = workspaceList().find((w) => w.id === id);
  if (!workspace || !workspaceMainWindow() || workspaceEditPrompt.busy) return;
  Object.assign(workspaceEditPrompt, {
    open: true, id: workspace.id, name: workspace.name, icon: workspace.icon ?? "", color: workspace.color ?? "", error: null,
  });
}
function focusAfterEdit(): void {
  void tick().then(() => {
    const pane = focusedPane();
    if (pane) focusPaneBody(pane.id);
  });
}
export function closeWorkspaceEditPrompt(): void {
  if (workspaceEditPrompt.busy) return;
  workspaceEditPrompt.open = false;
  focusAfterEdit();
}
export async function submitWorkspaceEdit(): Promise<void> {
  const { id, name: rawName, icon: rawIcon, color: rawColor } = workspaceEditPrompt;
  const name = rawName.trim();
  const icon = rawIcon.trim() || undefined;
  const color = rawColor.trim() || undefined;
  const workspace = workspaceList().find((w) => w.id === id);
  if (!workspace || !name || workspaceEditPrompt.busy) return;
  workspaceEditPrompt.busy = true;
  workspaceEditPrompt.error = null;
  try {
    if (name !== workspace.name && !await renameWorkspace(workspace.id, name)) {
      workspaceEditPrompt.error = t("app.workspaces.changeFailed");
      return;
    }
    if ((icon !== workspace.icon || color !== workspace.color) && !await setWorkspaceStyle(workspace.id, icon, color)) {
      workspaceEditPrompt.error = t("app.workspaces.changeFailed");
      return;
    }
    workspaceEditPrompt.open = false;
    focusAfterEdit();
  } finally {
    workspaceEditPrompt.busy = false;
  }
}
export function closeWorkspaceNamePrompt(): void {
  if (!workspaceNamePrompt.busy) workspaceNamePrompt.open = false;
}
export async function submitWorkspaceName(): Promise<void> {
  const name = workspaceNamePrompt.name.trim();
  if (!name || workspaceNamePrompt.busy) return;
  workspaceNamePrompt.busy = true;
  try {
    const tab = newTab();
    if (!await createWorkspace(name, tab)) return;
    workspaceNamePrompt.open = false;
    const pane = focusedPane();
    if (pane) void tick().then(() => focusPaneBody(pane.id));
  } finally {
    workspaceNamePrompt.busy = false;
  }
}

function savedSessionCount(node: SavedNode): number {
  return isSavedSplit(node) ? savedSessionCount(node.a) + savedSessionCount(node.b) : Number(hasSession(node.kind));
}

export async function deleteWorkspaceAsked(id = currentWorkspaceId()): Promise<void> {
  if (!workspaceMainWindow() || deleting || id === null) return;
  const list = workspaceList();
  if (list.length <= 1) { showNotice(t("app.workspaces.lastRefused")); return; }
  const workspace = list.find((w) => w.id === id);
  const target = list.find((w) => w.id === currentWorkspaceId() && w.id !== id) ?? list.find((w) => w.id !== id);
  if (!workspace || !target) return;
  deleting = true;
  try {
    // 새 tear 뒤의 소속은 부팅 사본이 아니라 최신 파일에서 확인한다. 원본 탭을 닫기 전이다.
    if (!await flushWorkspaceSave()) return;
    const loaded = await invoke<WorkspaceLoad>("workspaces_load");
    if (loaded.state !== "v2") { showNotice(t("app.workspaces.changeFailed")); return; }
    if (loaded.file.workspaces.find((w) => w.id === id)?.tabs.some((tab) => tab.placement.kind === "aux")) {
      showNotice(t("app.workspaces.auxRefused"));
      return;
    }
    const tabs = residentWindowTabs().filter((tab) => tab.workspaceId === id);
    const dirty = tabs.flatMap((tab) => listPanes(tab.root).map((pane) => pane.id)).filter(isDocDirty);
    if (!await confirmUnsavedClose(dirty, docNameOf)) return;
    const tabCount = workspace.materialized ? tabs.length : workspace.savedTabs.length;
    const sessions = workspace.materialized
      ? tabs.flatMap((tab) => listPanes(tab.root)).filter((pane) => hasSession(pane.kind)).length
      : workspace.savedTabs.reduce((n, tab) => n + savedSessionCount(tab.root), 0);
    workspaceDeletePrompt.name = workspace.name;
    workspaceDeletePrompt.tabs = tabCount;
    workspaceDeletePrompt.sessions = sessions;
    workspaceDeletePrompt.open = true;
    const confirmed = await new Promise<boolean>((resolve) => { resolveDelete = resolve; });
    if (!confirmed) return;
    switchWorkspace(target.id);
    for (const tab of tabs) closeTab(tab.id);
    prepareWorkspaceDelete(id);
    await tick(); // PaneHost 제거 → 기존 Terminal cleanup이 세션을 닫는다.
    if (!await flushWorkspaceSave()) return;
    if (await mutateWorkspace({ op: "deleteWorkspace", id })) {
      removeWorkspace(id);
    }
  } catch {
    showNotice(t("app.workspaces.changeFailed"));
  } finally {
    deleting = false;
  }
}
