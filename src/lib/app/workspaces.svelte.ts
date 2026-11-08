// 워크스페이스의 도메인 상태. 효과는 +page/tabs가 건다.
// 아래 층은 app/tabs를 되부르지 않는다: 창 탭·선택 어댑터를 bootTabs에서 한 번 주입한다.
// cold 트리는 읽기만 하고 방문할 때만 materialize한다. resident 탭은 전환으로 제거하지 않는다.
import { emit, invoke } from "../ipc";
import { tick } from "svelte";
import { deserialize, serialize } from "$lib/tabs";
import { listPanes, newTab, type TabSpec } from "$lib/session";
import {
  assignTileKeys, newTabKey, newTileKey, newWorkspaceId,
  type Problem, type LastActive, type SavedWorkspaceTab, type Workspace, type WorkspaceLoad, type WorkspaceMutation, type WriterScope,
} from "$lib/workspaces/schema";
import { emptyHostTree, hostTreeCount, rewriteHostTree } from "$lib/workspaces/hosts";
import { switchResidentWorkspace } from "$lib/workspaces/runtime";
import { reorderWorkspaceIds, stepWorkspaceId } from "$lib/workspaces/sidebar";
import { WorkspaceSaveQueue, type WorkspaceSnapshot } from "$lib/workspaces/save-queue";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { loadWorkspaceBoot, migrationProblems } from "$lib/workspaces/boot";
import { focusPaneBody } from "$lib/pane/focus";
import { playWorkspaceSlide, workspaceSlideDir } from "$lib/pane/workspace-slide";
import { coverViewOpen } from "$lib/app/usage-view.svelte.js";

export interface RuntimeWorkspace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  lastActive: LastActive;
  materialized: boolean;
  savedTabs: SavedWorkspaceTab[];
}
export interface WorkspaceWindow {
  tabs: () => TabSpec[];
  append: (tabs: TabSpec[]) => void;
  active: () => TabSpec | null;
  paneOf: (tab: TabSpec) => string;
  select: (tab: TabSpec | null, paneId?: string) => void;
}
let migrationFailure = $state<Problem[]>([]);
let migrationBusy = $state(false);
let currentId = $state<string | null>(null);
let list = $state<RuntimeWorkspace[]>([]);
let switcher = $state(false);
let host: WorkspaceWindow | null = null;
let queue: WorkspaceSaveQueue | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let mainWindow = true;
/** 원격 창(집 PC 거울) — [`setMirrorWorkspaces`] 가 켠다 */
let mirrorMode = false;
let scope: WriterScope = { kind: "main" };
let paused = $state(false);
const removedHostTiles = new Set<string>();

export function workspaceList(): RuntimeWorkspace[] {
  return list;
}
export function currentWorkspaceId(): string | null {
  return currentId;
}
export function currentWorkspace(): RuntimeWorkspace | null {
  return list.find((w) => w.id === currentId) ?? null;
}

/** 없는 키만 UUID로 채운다. */
export function ensureWorkspaceKeys(tab: TabSpec, workspaceId = currentId): void {
  if (workspaceId === null) return;
  tab.workspaceId = workspaceId;
  tab.tabKey ??= newTabKey();
  for (const pane of listPanes(tab.root)) pane.tileKey ??= newTileKey();
}

function materialize(workspace: RuntimeWorkspace): void {
  if (workspace.materialized || !host) return;
  const saved = workspace.savedTabs.filter((tab) => tab.placement.kind === "main");
  const restored = deserialize({ version: 1, activeIndex: 0, workspaces: saved });
  // 빈 저장 workspace는 기존 새 탭과 같은 시작 화면으로 연다.
  if (restored.tabs.length === 0) restored.tabs.push(newTab());
  for (const tab of restored.tabs) ensureWorkspaceKeys(tab, workspace.id);
  host.append(restored.tabs);
  workspace.materialized = true;
  queue?.seed(workspace.id, {
    tabs: saved,
    lastActive: workspace.lastActive,
  });
}

function rememberCurrent(): void {
  const workspace = currentWorkspace();
  const tab = host?.active();
  if (!workspace || !tab || tab.workspaceId !== workspace.id || !host) return;
  ensureWorkspaceKeys(tab, workspace.id);
  const pane = listPanes(tab.root).find((p) => p.id === host!.paneOf(tab));
  workspace.lastActive = { ...workspace.lastActive, tabKey: tab.tabKey, tileKey: pane?.tileKey, at: Date.now() };
}

/**
 * 기록 → cold 복원 → current → 선택. 출력/Gate/channel에는 접근하지 않는다.
 * 원격 창(거울)에서는 이 창의 지금 워크스페이스만 바꾼다(`switchMirrorWorkspace` — 고르는 탭은 부르는 쪽 · 거울 환원이 정한다).
 */
export function switchWorkspace(id: string, selection?: { tabId: string; paneId?: string }, select = true): void {
  if (mirrorMode) return switchMirrorWorkspace(id);
  if (!mainWindow || !host) return;
  // 전환 움직임(`pane/workspace-slide.ts`) — 방향은 목록 순서. 고르지 않는 전환(`select` 거짓)과 캔버스를 덮은
  // 판(사용량 · 자원 화면)이 떠 있을 때는 걸지 않는다(탭 슬라이드 규칙과 같다). 새 탭 줄·캔버스가 그려진
  // 뒤(같은 프레임 — 마이크로태스크)에 건다.
  const dir = select && !coverViewOpen()
    ? workspaceSlideDir(list.findIndex((w) => w.id === currentId), list.findIndex((w) => w.id === id))
    : 0;
  const before = currentId;
  switchResidentWorkspace(id, currentId, list, {
    remember: rememberCurrent, materialize,
    setCurrent: (id) => currentId = id,
    restore: (target) => {
      if (select) restoreSelection(target, selection);
      void invoke("workspace_bind_window", { workspaceId: target.id, scope });
    },
  });
  if (dir !== 0 && currentId !== before) void tick().then(() => playWorkspaceSlide(dir));
}

function restoreSelection(workspace: RuntimeWorkspace, selection?: { tabId: string; paneId?: string }): void {
  if (!host) return;
  const tabs = host.tabs().filter((tab) => tab.workspaceId === workspace.id);
  const tab = tabs.find((tab) => tab.id === selection?.tabId)
    ?? tabs.find((tab) => tab.tabKey === workspace.lastActive.tabKey) ?? tabs[0] ?? null;
  const panes = tab ? listPanes(tab.root) : [];
  const pane = panes.find((p) => p.id === selection?.paneId) ?? panes.find((p) => p.tileKey === workspace.lastActive.tileKey) ?? (tab ? panes.find((p) => p.id === host!.paneOf(tab)) : null) ?? panes[0];
  host.select(tab, pane?.id);
  if (pane) void tick().then(() => focusPaneBody(pane.id));
}

export async function bootWorkspaces(main: boolean, window: WorkspaceWindow): Promise<boolean> {
  host = window;
  mainWindow = main;
  if (!main) return bootAuxWorkspace(undefined, true);
  try {
    const result = await loadWorkspaceBoot({
      load: () => invoke<WorkspaceLoad>("workspaces_load"),
      migrate: () => invoke("workspaces_migrate"),
    });
    if (result.problems) { bootMemoryDefault(result.problems); return true; }
    const generation = await invoke<number>("workspaces_claim_writer", { scope: { kind: "main" } });
    queue = new WorkspaceSaveQueue(
      generation,
      (mutation) => invoke<number>("workspaces_apply", { mutation }),
      () => invoke<number>("workspaces_claim_writer", { scope: { kind: "main" } }),
      () => showNotice(t("app.workspaces.saveFailed")),
    );
    // 새 프로세스의 부팅에서 복귀한다. 메인 F5 중 살아 있는 aux의 lease는 건드리지 않는다.
    const windows = await invoke<string[]>("workspace_windows");
    if (windows.every((label) => label === "main")) await queue.mutate({ op: "returnAuxTabsToMain" });
    const loaded = await invoke<WorkspaceLoad>("workspaces_load");
    if (loaded.state !== "v2") throw new Error("workspace-load");
    list = loaded.file.workspaces.map((w: Workspace) => ({
      id: w.id, name: w.name, icon: w.icon, color: w.color, lastActive: w.lastActive,
      savedTabs: w.tabs, materialized: false,
    }));
    migrationFailure = [];
    currentId = loaded.file.activeWorkspaceId;
    const workspace = currentWorkspace()!;
    materialize(workspace);
    restoreSelection(workspace);
    queue.seedActive(workspace.id);
    await invoke("workspace_bind_window", { workspaceId: workspace.id, scope });

    return true;
  } catch (error) {
    bootMemoryDefault(migrationProblems(error));
    return true;
  }
}

function savedTabsFor(tabs: TabSpec[]): SavedWorkspaceTab[] {
  return serialize(tabs, null).workspaces.map((tab): SavedWorkspaceTab => ({
    ...tab, tabKey: tab.tabKey!, placement: scope, root: rewriteHostTree(assignTileKeys(tab.root), new Set(), undefined, removedHostTiles) ?? emptyHostTree(assignTileKeys(tab.root)),
  }));
}

function snapshots(): [string, WorkspaceSnapshot][] {
  if (!host) return [];
  const resident = host.tabs();
  const active = host.active();
  return list.filter((w) => w.materialized).map((w) => {
    const tabs = resident.filter((tab) => tab.workspaceId === w.id);
    for (const tab of tabs) ensureWorkspaceKeys(tab, w.id);
    const saved = savedTabsFor(tabs);
    let lastActive = w.lastActive;
    if (active?.workspaceId === w.id) {
      const pane = listPanes(active.root).find((p) => p.id === host!.paneOf(active));
      lastActive = { ...lastActive, tabKey: active.tabKey, tileKey: pane?.tileKey };
    }
    return [w.id, { tabs: saved, lastActive }];
  });
}

function track(): void {
  for (const [id, value] of snapshots()) queue?.track(id, value);
  if (mainWindow && currentId) queue?.setActive(currentId);
}

export function scheduleWorkspaceSave(): (() => void) | undefined {
  if (currentId === null || !queue || paused) return;
  track(); // 반응형 읽기는 효과 안, ACK 상태는 평범한 queue 내부에만 둔다.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void queue?.flush(), 500);
  return () => clearTimeout(saveTimer);
}

/** 네이티브 close는 결과까지 기다린다. pagehide의 await는 웹뷰 수명으로 제한된다. */
export async function flushWorkspaceSave(): Promise<boolean> {
  if (!queue || paused) return true;
  return flushQueue();
}

async function flushQueue(): Promise<boolean> {
  clearTimeout(saveTimer);
  track();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      queue!.flush(),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function mutateWorkspace(mutation: WorkspaceMutation): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.mutate(mutation);
    return true;
  } catch {
    showNotice(t("app.workspaces.changeFailed"));
    return false;
  }
}

export async function createWorkspace(name: string, tab: TabSpec): Promise<boolean> {
  const id = newWorkspaceId();
  if (!await mutateWorkspace({ op: "createWorkspace", id, name })) return false;
  const workspace: RuntimeWorkspace = { id, name, lastActive: {}, materialized: true, savedTabs: [] };
  list.push(workspace);
  ensureWorkspaceKeys(tab, id);
  host?.append([tab]);
  switchWorkspace(id);
  return true;
}

/** 그 워크스페이스의 마지막 활성 탭 · 타일을 적는다(지금 보지 않는 워크스페이스에 원격이 새 탭을 넣었을 때 — `openTabInWorkspace`) */
export function noteWorkspaceLastTab(id: string, tabKey: string | undefined, tileKey: string | undefined): void {
  const workspace = list.find((w) => w.id === id);
  if (workspace) workspace.lastActive = { ...workspace.lastActive, tabKey, tileKey, at: Date.now() };
}

export function noteWorkspaceName(id: string, name: string): void {
  const workspace = list.find((w) => w.id === id);
  if (workspace) workspace.name = name;
}

export async function renameWorkspace(id: string, name: string): Promise<boolean> {
  if (!await mutateWorkspace({ op: "renameWorkspace", id, name })) return false;
  const workspace = list.find((w) => w.id === id);
  if (workspace) workspace.name = name;
  void emit("workspace-renamed", { id, name });
  return true;
}

export function noteWorkspaceStyle(id: string, icon?: string, color?: string): void {
  const workspace = list.find((w) => w.id === id);
  if (workspace) { workspace.icon = icon; workspace.color = color; }
}

export async function setWorkspaceStyle(id: string, icon?: string, color?: string): Promise<boolean> {
  if (!await mutateWorkspace({ op: "setWorkspaceStyle", id, icon, color })) return false;
  noteWorkspaceStyle(id, icon, color);
  void emit("workspace-style-changed", { id, icon, color });
  return true;
}

export async function reorderWorkspaces(id: string, before: string | null): Promise<void> {
  const current = list.map((w) => w.id);
  const ids = reorderWorkspaceIds(current, id, before);
  if (ids === current) return;
  if (await mutateWorkspace({ op: "reorderWorkspaces", ids })) list = ids.map((key) => list.find((w) => w.id === key)!);
}

/** 삭제할 cold 배치는 세션을 만들지 않고 빈 main scope로 비운다. */
export function prepareWorkspaceDelete(id: string): void {
  const workspace = list.find((w) => w.id === id);
  if (!workspace) return;
  workspace.materialized = true;
  workspace.lastActive = {};
}
export function removeWorkspace(id: string): void {
  queue?.forget(id);
  list = list.filter((w) => w.id !== id);
}

export function workspaceSwitcherVisible(): boolean {
  return switcher;
}
export function workspaceMainWindow(): boolean { return mainWindow && currentId !== null; }
export function openWorkspaceSwitcher(): void { if (mainWindow && currentId) switcher = true; }
/**
 * 이전·다음 워크스페이스로 곧장 옮긴다(`prev-workspace` · `next-workspace`) — 목록 순서 · 끝에서 처음으로 순환.
 * 전환기에서 고를 때와 같은 `switchWorkspace` 길(움직임 · 마지막 활성 타일 복원). 보조 창(워크스페이스 없음)에서는
 * 전환기처럼 아무것도 안 한다.
 */
export function stepWorkspace(step: 1 | -1): void {
  if (!mainWindow || !currentId) return;
  const id = stepWorkspaceId(list.map((w) => w.id), currentId, step);
  if (id) switchWorkspace(id);
}
export function closeWorkspaceSwitcher(): void {
  switcher = false;
  const tab = host?.active();
  if (tab && host) void tick().then(() => focusPaneBody(host!.paneOf(tab)));
}

/** 새 보조 창은 첫 짐의 소속만 갖는다. groupId는 창 라벨과 별개의 UUID다. */
export async function bootAuxWorkspace(id?: string, restoreSaved = false): Promise<boolean> {
  const binding = await invoke<{ workspaceId: string; scope: WriterScope } | null>("workspace_window_binding");
  id ??= binding?.workspaceId;
  if (!id) return false;
  const loaded = await invoke<WorkspaceLoad>("workspaces_load");
  if (loaded.state !== "v2") throw new Error("workspace-load");
  const workspace = loaded.file.workspaces.find((w) => w.id === id);
  if (!workspace) throw new Error("workspace-missing");
  mainWindow = false;
  scope = binding?.scope ?? { kind: "aux", groupId: newWorkspaceId() };
  const generation = await invoke<number>("workspaces_claim_writer", { scope });
  queue = new WorkspaceSaveQueue(generation,
    (mutation) => invoke<number>("workspaces_apply", { mutation }),
    () => invoke<number>("workspaces_claim_writer", { scope }),
    () => showNotice(t("app.workspaces.saveFailed")), scope);
  currentId = id;
  list = loaded.file.workspaces.map((w) => ({ id: w.id, name: w.name, icon: w.icon, color: w.color,
    lastActive: w.lastActive, savedTabs: w.tabs, materialized: w.id === id }));
  queue.seed(id, { tabs: [], lastActive: {} });
  migrationFailure = [];
  await invoke("workspace_bind_window", { workspaceId: id, scope });
  if (restoreSaved && scope.kind === "aux") {
    const groupId = scope.groupId;
    const saved = workspace.tabs.filter((tab) => tab.placement.kind === "aux" && tab.placement.groupId === groupId);
    const restored = deserialize({ version: 1, activeIndex: 0, workspaces: saved });
    for (const tab of restored.tabs) ensureWorkspaceKeys(tab, id);
    queue.seed(id, { tabs: saved, lastActive: {} });
    host?.append(restored.tabs);
    host?.select(restored.tabs[0] ?? null);
  }
  return true;
}

export function workspacePlacement(): WriterScope { return scope; }

/**
 * **원격 창의 워크스페이스**(원격 웹 R2-B · 10-20 워크스페이스 칩 — `app/mirror.svelte.ts`) — 집 PC 주 창의 워크스페이스 목록을 그대로
 * 비추되 **지금 볼 것은 원격 창 몫**이다(`current` — 거울 환원의 `pickMirrorWorkspace` 가 정한다 · 집 PC 화면은 움직이지 않는다).
 * 쓰기 범위 · 창 바인딩 · 저장 큐를 잡지 않는다(`queue` 없음 = 저장이 돌지 않는다 · 주 창이 아니라 관리 · 전환기도 없다).
 * cold(집 PC 가 아직 열지 않음)는 `materialized` 거짓 — [`switchWorkspace`] 가 그리로 가지 않는다.
 */
export function setMirrorWorkspaces(items: readonly { id: string; name: string; icon?: string; color?: string; cold?: boolean }[], current: string): void {
  mirrorMode = true;
  mainWindow = false;
  queue = null;
  clearTimeout(saveTimer);
  const next: RuntimeWorkspace[] = items.map((w) => ({
    id: w.id, name: w.name || t("app.workspaces.default"), icon: w.icon, color: w.color,
    lastActive: {}, savedTabs: [], materialized: !w.cold,
  }));
  const same = next.length === list.length && next.every((w, i) =>
    w.id === list[i].id && w.name === list[i].name && w.icon === list[i].icon && w.color === list[i].color && w.materialized === list[i].materialized);
  if (!same) list = next;
  if (currentId !== current) currentId = current;
}

/** 원격 창 — 워크스페이스를 바꾼 뒤 거울을 다시 환원하는 몸통(`app/mirror` 가 건다 — 이 모듈이 그쪽을 부르면 순환이라) */
let mirrorRepaint: (() => void) | null = null;
export function setMirrorRepaint(fn: (() => void) | null): void { mirrorRepaint = fn; }

/** 원격 창의 워크스페이스 바꾸기 — 이 창에서만(집 PC 에 요청하지 않는다). cold 는 안내만. */
function switchMirrorWorkspace(id: string): void {
  const target = list.find((w) => w.id === id);
  if (!target || id === currentId) return;
  if (!target.materialized) {
    showNotice(t("app.mirror.coldWorkspace"));
    return;
  }
  currentId = id;
  mirrorRepaint?.();
}

/** 이관/종료 동안 debounce와 pagehide가 옛 스냅숏을 쓰지 못하게 한다. */
export async function pauseWorkspaceSave(): Promise<boolean> {
  if (paused) return false;
  paused = true;
  clearTimeout(saveTimer);
  const ok = !queue || await flushQueue();
  if (!ok) paused = false;
  return ok;
}
export function resumeWorkspaceSave(): void { paused = false; scheduleWorkspaceSave(); }

/** 보조 X는 삭제 대신 위치를 돌린다. 큐는 닫힐 때까지 멈춘 채 둔다. */
export async function returnAuxTabs(): Promise<boolean> {
  if (mainWindow || !host) return true;
  if (!await pauseWorkspaceSave()) return false;
  if (scope.kind !== "aux" || !currentId) return false;
  if (!await mutateWorkspace({ op: "returnAuxGroup", workspaceId: currentId, groupId: scope.groupId })) {
    resumeWorkspaceSave();
    return false;
  }
  return true;
}

/** 원본에 쓰지 않는 복구 화면. Escape/백드롭으로 닫히지 않는다. */
export function workspaceMigrationProblems(): Problem[] { return migrationFailure; }
export function workspaceMigrationBusy(): boolean { return migrationBusy; }
export function workspaceSavingAvailable(): boolean { return queue !== null; }

function bootMemoryDefault(problems: Problem[]): void {
  queue = null;
  clearTimeout(saveTimer);
  migrationFailure = problems;
  currentId = newWorkspaceId();
  list = [{ id: currentId, name: t("app.workspaces.default"), icon: "svg:lucide:house", lastActive: {}, savedTabs: [], materialized: false }];
  materialize(list[0]);
  restoreSelection(list[0]);
}

export async function retryWorkspaceMigration(fresh = false): Promise<void> {
  if (migrationBusy || !host) return;
  migrationBusy = true;
  try {
    if (fresh) await invoke("workspaces_start_fresh");
    // 기본 화면도 실제 편집/세션을 담을 수 있으므로 부팅을 재시작해 이전 표시를 정리한다.
    if (fresh) window.location.reload();
    else {
      const result = await loadWorkspaceBoot({
        load: () => invoke<WorkspaceLoad>("workspaces_load"),
        migrate: () => invoke("workspaces_migrate"),
      });
      if (result.problems) migrationFailure = result.problems;
      else window.location.reload();
    }
  } catch (error) { migrationFailure = migrationProblems(error); }
  finally { migrationBusy = false; }
}

/** cold + 다른 창 저장 배치는 디스크와 같은 변환, live 타일은 종료하지 않는다. */
export function noteWorkspaceHostAliases(aliases: string[], to?: string): void {
  const keys = new Set(aliases.map((alias) => alias.trim().toLowerCase()));
  for (const workspace of list) {
    for (const tab of workspace.savedTabs) {
      tab.root = rewriteHostTree(tab.root, keys, to) ?? emptyHostTree(tab.root);
    }
  }
  for (const tab of host?.tabs() ?? []) {
    for (const pane of listPanes(tab.root)) {
      const alias = pane.adhoc ? null : pane.alias ?? pane.startProject?.host;
      if (!alias || !keys.has(alias.trim().toLowerCase())) continue;
      if (to) {
        if (pane.alias) pane.alias = to;
        if (pane.startProject?.host) pane.startProject.host = to;
      } else if (pane.tileKey) removedHostTiles.add(pane.tileKey);
    }
  }
}

export function countWorkspaceHostRefs(aliases: readonly string[]): number {
  const keys = new Set(aliases.map((alias) => alias.trim().toLowerCase()));
  return list.reduce((total, workspace) => total + workspace.savedTabs
    .filter((tab) => !workspace.materialized || tab.placement.kind !== scope.kind)
    .reduce((n, tab) => n + hostTreeCount(tab.root, keys), 0), 0);
}
