import { focusAuxTile } from "$lib/app/workspace-status.svelte.js";
import {
  bootWorkspaces, currentWorkspaceId, ensureWorkspaceKeys, flushWorkspaceSave,
  noteWorkspaceLastTab, scheduleWorkspaceSave, switchWorkspace, workspaceList,
} from "$lib/app/workspaces.svelte.js";
import { revealResidentPane } from "$lib/workspaces/runtime";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { clearBellMarks, hasBellMark } from "$lib/app/bell.svelte.js";
import { clearAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { bumpBlocks } from "$lib/app/console.svelte.js";
import { coverViewOpen, leaveCoverView } from "$lib/app/usage-view.svelte.js";
import { clearTabSlide, requestTabSlide } from "$lib/pane/tab-slide.svelte.js";
import { focusPaneBody } from "$lib/pane/focus";
import { isMainWindow, isRemote } from "$lib/app/window.svelte.js";
import type { LayoutRequest } from "$lib/mirror/request";
import { mirrorLayoutChange } from "$lib/mirror/layout-change";
import { settings } from "$lib/settings.svelte.js";
import { CLOSE_SLIDE_DELAY_MS, noteTileClosing, withLayoutAnim } from "$lib/layout-anim.svelte.js";
import { noteDocSwap } from "$lib/doc-swap";
import { displayCombo, effectiveCombo } from "$lib/keybindings";
import { isDocDirty, setDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { dropDocDraft } from "$lib/app/doc-drafts.svelte.js";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import { confirmDbTxClose, dbTxPanes, hasOpenDbTx } from "$lib/app/db-tx";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { chatTileBusy } from "$lib/app/chat-tile-busy";
import { unsavedVerdict } from "$lib/unsaved-guard";
import { autoSplitDir, computeLayout, neighborInDirection, type FocusDir } from "$lib/layout";
import { autoPlaceTarget, movePaneDwindle, resizePaneStep, type CanvasSize } from "$lib/tree-ops";
import { isOrchTab } from "$lib/orchestration/orch-tab";
import { aliasKeySet } from "$lib/host-remove";
import { connectStaggered, RECONNECT_STAGGER_MS, whenSettled } from "$lib/reconnect-registry";
import { foldStatus, paneBadgeInput, type PaneStatus } from "$lib/shell-integration";
import {
  clonePane,
  closePane,
  countPanes,
  deferredSshPaneIds,
  findFirstPane,
  findPane,
  hasSession,
  insertSubtree,
  leafOf,
  listPanes,
  moveTab,
  tabsToClose,
  newStartPane,
  paneName,
  loneTileTitle,
  newTab,
  replacePane,
  replacePaneWithNode,
  spiralInsert,
  splitPane,
  tabFromPane,
  usesHostAlias,
  type FileUiPatch,
  type FileView,
  type PaneNode,
  type PaneSide,
  type PaneSpec,
  type SplitDir,
  type TabSpec,
} from "$lib/session";

/**
 * 탭 층 — 이 창의 탭 목록 · 타일 트리와 그것을 건드리는 조작. 쓰기는 함수로만 — 밖에서 배열에 직접 손대는 길을 두지 않는다.
 * 룬 모듈이라 `$effect` 가 없다 — 효과가 필요한 자리는 몸통만 여기 두고(`scheduleTabSave`) 효과는 `+page.svelte` 가 건다.
 */

// ── 상태 ──

// 시작 탭은 동기 시점에 만들지 않는다 — 복원으로 곧 버려져 타일이 깜빡이고 탭 번호가 건너뛴다. 결정은 [`bootTabs`] 한 곳이다.
let tabs = $state<TabSpec[]>([]);
let activeId = $state<string | null>(null);

/** 탭 id → 그 탭에서 포커스를 가진 패널 id */
const activePane = $state<Record<string, string>>({});
const focusTimes = $state<Record<string, number>>({});
export function paneFocusedAt(id: string): number { return focusTimes[id] ?? 0; }

/** OSC 133 이 없는 세션에는 이 신호밖에 없다 */
export const hasActivity = $state<Record<string, boolean>>({});

/** 키가 없으면 OSC 133 이 없다 */
const paneStatus = $state<Record<string, PaneStatus>>({});
/** 안 보는 사이에 끝난 명령의 결과 — 그 탭을 보는 순간 지운다 */
const stickyStatus = $state<Record<string, PaneStatus>>({});

/**
 * 탭 id → 동시 입력에 포함된 패널 id. 키가 없으면 꺼짐, 빈 집합은 "켜져 있는데 대상이 없다" 는 다른 상태다.
 * 일반 `Map`/`Set` 은 `$state` 가 프록시하지 않아 반응형 컬렉션을 쓴다.
 */
export const syncPanes = new SvelteMap<string, SvelteSet<string>>();

/** 아직 안 붙었으면 `null` — 그때 [`autoDirFor`] 는 `"row"` 로 떨어진다 */
let measureCanvas: (() => { w: number; h: number }) | null = null;

export function setMeasureCanvas(measure: () => { w: number; h: number }): void {
  measureCanvas = measure;
}


// ── 읽기 ──

/** 탭 바 · 순환 · 새 탭 위치용 */
export function currentWorkspaceTabs(): TabSpec[] {
  return tabs.filter((tab) => tab.workspaceId === currentWorkspaceId());
}

/** 워크스페이스에 관계없이 이 창에 상주하는 탭 — 마운트 · 검색 · 세션 보호용 */
export function residentWindowTabs(): TabSpec[] {
  return tabs;
}

export function activeTabId(): string | null {
  return activeId;
}

export function activeTab(): TabSpec | null {
  return currentWorkspaceTabs().find((t) => t.id === activeId) ?? null;
}

/** 기록이 없거나 이미 닫힌 패널이면 첫 패널 */
export function paneOf(tab: TabSpec): string {
  const id = activePane[tab.id];
  if (id && findPane(tab.root, id)) return id;
  return findFirstPane(tab.root).id;
}

export function focusedPane(): PaneSpec | null {
  const tab = activeTab();
  if (!tab) return null;
  return findPane(tab.root, paneOf(tab));
}

export function tabOfPane(paneId: string): TabSpec | null {
  return residentWindowTabs().find((t) => findPane(t.root, paneId) !== null) ?? null;
}

export function findPaneAnywhere(paneId: string): PaneSpec | null {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (pane) return pane;
  }
  return null;
}

// ── 탭 상태 배지 ──

/**
 * 보고 있는 탭에서 끝난 명령은 sticky 에 적지 않는다 — 적으면 그 탭을 떠나는 순간 본 것이 배지로 켜진다.
 */
export function noteStatus(tabId: string, paneId: string, status: PaneStatus | null): void {
  bumpBlocks();
  if (status === null) {
    delete paneStatus[paneId];
    delete stickyStatus[paneId];
    return;
  }
  paneStatus[paneId] = status;
  if (status !== "running" && tabId !== activeId) stickyStatus[paneId] = status;
}

/** `null` = OSC 133 을 한 번도 못 봤다 */
export function statusOf(paneId: string): PaneStatus | null {
  return paneStatus[paneId] ?? null;
}

export function stickyOf(paneId: string): PaneStatus | null {
  return stickyStatus[paneId] ?? null;
}

/**
 * `agentLive` 는 인자로 받는다 — 판정이 있는 `app/agent-status.svelte.ts` 가 이 모듈을 가져오므로 되가져오면 순환이다.
 */
export interface TabCommandStatus {
  state: PaneStatus;
  paneId: string;
  others: number;
}

export function tabStatus(agentLive: (pane: PaneSpec) => boolean = () => false): Record<string, TabCommandStatus> {
  return commandStatuses(agentLive, false);
}

/** workspace 집계 전용: 활성 탭 포함, 라이브 종료 결과 포함, 실패 우선. */
export function rawTabStatus(agentLive: (pane: PaneSpec) => boolean = () => false): Record<string, TabCommandStatus> {
  return commandStatuses(agentLive, true);
}

function commandStatuses(agentLive: (pane: PaneSpec) => boolean, raw: boolean): Record<string, TabCommandStatus> {
  const out: Record<string, TabCommandStatus> = {};
  for (const tab of residentWindowTabs()) {
    if (!raw && tab.id === activeId) continue;
    const inputs = listPanes(tab.root).map((p) => ({
      id: p.id,
      s: raw
        ? (stickyStatus[p.id] ?? (paneStatus[p.id] === "running" && agentLive(p) ? null : paneStatus[p.id]) ?? null)
        : paneBadgeInput(paneStatus[p.id], stickyStatus[p.id], agentLive(p)),
    }));
    const folded = raw && inputs.some((i) => i.s === "fail")
      ? "fail" : foldStatus(inputs.map((i) => i.s));
    if (!folded) continue;
    const lead = inputs.find((i) => i.s === folded)!;
    const others = inputs.filter((i) => i.s !== null && i !== lead).length;
    out[tab.id] = { state: folded, paneId: lead.id, others };
  }
  return out;
}

export function tabBells(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const tab of residentWindowTabs()) {
    if (tab.id === activeId) continue;
    if (listPanes(tab.root).some((p) => hasBellMark(p.id))) out[tab.id] = true;
  }
  return out;
}

function clearSeenStatus(tabId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const panes = listPanes(tab.root);
  for (const pane of panes) delete stickyStatus[pane.id];
  const ids = panes.map((p) => p.id);
  clearBellMarks(ids);
  clearAgentUnseen(ids);
}

export function markActivity(tabId: string): void {
  if (tabId === activeId) return;
  hasActivity[tabId] = true;
}

// ── 탭 열기 · 전환 · 닫기 ──

/** 돌려주는 프록시를 써야 한다 — 인자로 받은 원본에 `root` 를 대입해도 반응하지 않는다 */
export function openTab(tab: TabSpec): TabSpec {
  if (isRemote) {
    queueRemoteNewTab(tab);
    return tab;
  }
  ensureWorkspaceKeys(tab);
  tabs.push(tab);
  activePane[tab.id] = findFirstPane(tab.root).id;
  selectTab(tab.id);
  return residentWindowTabs().find((t) => t.id === tab.id) ?? tab;
}

export function selectTab(id: string): void {
  const target = tabs.find((tab) => tab.id === id);
  if (target?.workspaceId !== currentWorkspaceId() && target?.workspaceId) {
    switchWorkspace(target.workspaceId, { tabId: id });
  }
  // 슬라이드는 [`pickTab`] 만 건다 — 닫기 · 새 탭 · 이관 · 복원으로 바뀌는 탭은 그 자리에서 선다
  clearTabSlide();
  activeId = id;
  if (isRemote && target?.workspaceId) remoteActiveByWs[target.workspaceId] = id;
  if (activePane[id]) focusTimes[activePane[id]] = Date.now();
  delete hasActivity[id];
  clearSeenStatus(id);
}

/**
 * 사람이 고른 탭 — 사용량 화면을 걷는 일은 `selectTab` 에 넣지 않는다: 그쪽은 탭이 닫혀 다음 탭을 고를 때도 불려,
 * 보던 화면이 뒤에서 걷힌다. 사용량 화면이 떠 있었으면 슬라이드를 걸지 않는다 — 판이 걷히는 움직임과 겹친다.
 */
export function pickTab(id: string): void {
  const from = activeId;
  const covered = coverViewOpen();
  selectTab(id);
  if (!covered && from !== null && from !== id) {
    const a = currentWorkspaceTabs().findIndex((t) => t.id === from);
    const b = currentWorkspaceTabs().findIndex((t) => t.id === id);
    if (a >= 0 && b >= 0) requestTabSlide(from, id, b > a ? 1 : -1);
  }
  revealTile(activePane[id]);
}

/**
 * 포커스는 잃었을 때만 옮긴다 — 누가 이미 가져갔으면 건드리지 않는다. 한 프레임 미루는 것은 판이 숨고 탭이 그려진 뒤여야 xterm 이 포커스를 받기 때문이다.
 */
function revealTile(paneId: string | undefined): void {
  const left = leaveCoverView();
  if (!left || paneId === undefined || typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const el = document.activeElement;
    const lost =
      el === null ||
      el === document.body ||
      (el instanceof HTMLElement && el.closest("[data-cover-view]") !== null);
    if (lost) focusPaneBody(paneId);
  });
}

export function focusPane(tabId: string, paneId: string): void {
  focusTimes[paneId] = Date.now();
  activePane[tabId] = paneId;
}

/**
 * 원격의 새 탭 요청 — 메인 PC 화면은 움직이지 않는다(고르지 않는다). 이번 실행에서 열린(materialized) 워크스페이스만 — cold 는 그 탭 객체가 아직 이 창에 없어 `false`.
 */
export function openTabInWorkspace(workspaceId: string, tab: TabSpec, pane: PaneSpec | null): boolean {
  if (isRemote || workspaceId === currentWorkspaceId()) return false;
  const ws = workspaceList().find((w) => w.id === workspaceId);
  if (!ws?.materialized) return false;
  if (pane) tab.root = leafOf(pane);
  ensureWorkspaceKeys(tab, workspaceId);
  tabs.push(tab);
  const first = findFirstPane(tab.root);
  activePane[tab.id] = first.id;
  noteWorkspaceLastTab(workspaceId, tab.tabKey, first.tileKey);
  return true;
}

/** 고르지 않는다 — 사람은 다른 데서 말하던 중이라 포커스를 빼앗지 않는다 */
export function addTabBehind(tab: TabSpec, afterId: string | null): boolean {
  if (isRemote || layoutLocked()) return false;
  const after = afterId === null ? -1 : residentWindowTabs().findIndex((x) => x.id === afterId);
  const ws = after >= 0 ? (residentWindowTabs()[after].workspaceId ?? currentWorkspaceId()) : currentWorkspaceId();
  ensureWorkspaceKeys(tab, ws);
  if (after < 0) tabs.push(tab);
  else tabs.splice(after + 1, 0, tab);
  activePane[tab.id] = findFirstPane(tab.root).id;
  return true;
}

/** `beforeId` 앞에 (null 이면 맨 뒤에) */
export function insertTab(tab: TabSpec, beforeId: string | null): void {
  if (layoutLocked()) return; // 창 넘기기 · 떼어 낸 창 — 원격에는 없다
  ensureWorkspaceKeys(tab, tab.workspaceId ?? currentWorkspaceId());
  const at = beforeId === null ? -1 : residentWindowTabs().findIndex((t) => t.id === beforeId);
  if (at < 0) tabs.push(tab);
  else tabs.splice(at, 0, tab);
  activePane[tab.id] = findFirstPane(tab.root).id;
  selectTab(tab.id);
}

function replaceCurrentTabs(ordered: TabSpec[]): void {
  let at = 0;
  tabs = tabs.map((tab) => tab.workspaceId === currentWorkspaceId() ? ordered[at++] : tab);
}

export function reorderTabs(dragId: string, beforeId: string | null): void {
  if (remoteLayout({ op: "reorderTab", tab: dragId, before: beforeId })) return;
  replaceCurrentTabs(moveTab(currentWorkspaceTabs(), dragId, beforeId));
}

export function moveTabBefore(tabId: string, beforeId: string): void {
  // 원격이 방금 요청한 새 탭(아직 거울에 없음)은 맨 뒤에 선다 — 순서는 거울에 선 뒤 끌어서.
  if (isRemote && [...pendingNewTabs.keys()].some((t) => t.id === tabId)) return;
  if (remoteLayout({ op: "reorderTab", tab: tabId, before: beforeId })) return;
  replaceCurrentTabs(moveTab(currentWorkspaceTabs(), tabId, beforeId));
}

export function closeTab(id: string): void {
  if (remoteLayout({ op: "closeTabs", tabs: [id] })) return;
  const i = residentWindowTabs().findIndex((t) => t.id === id);
  if (i < 0) return;
  const currentIndex = currentWorkspaceTabs().findIndex((t) => t.id === id);
  // 저장 안 한 문서는 여기 오기 전에 물었거나(`closeTabAsked`) 초안을 짐에 실어 창을 넘긴 것이다 — 표시 · 초안을 거둔다
  for (const p of listPanes(tabs[i].root)) {
    setDocDirty(p.id, false);
    dropDocDraft(p.id);
  }
  tabs.splice(i, 1);
  delete activePane[id];
  delete hasActivity[id];
  syncPanes.delete(id);
  if (activeId === id) {
    const shown = currentWorkspaceTabs();
    const next = (shown[currentIndex] ?? shown[currentIndex - 1] ?? null)?.id ?? null;
    if (next === null) activeId = null;
    else selectTab(next);
  }
}

/** 빈 문자열은 이름 지우기 — 자동 제목으로 되돌린다 */
export function renameTab(tabId: string, name: string): void {
  if (remoteLayout({ op: "renameTab", tab: tabId, name })) return;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const next = name.trim();
  if (next === "") delete tab.name;
  else tab.name = next;
}

export function cycleTab(dir: 1 | -1): void {
  const tabs = currentWorkspaceTabs();
  if (tabs.length === 0) return;
  const at = tabs.findIndex((t) => t.id === activeId);
  const base = at < 0 ? 0 : at;
  const next = (base + dir + tabs.length) % tabs.length;
  pickTab(tabs[next].id); // 탭 전환 키도 사람이 고른 것이다
}

/** 번호는 탭 바에 보이는 순서다 — id 가 아니다 */
export function selectTabAt(n: number): void {
  const tab = currentWorkspaceTabs()[n - 1];
  if (tab) pickTab(tab.id);
}

// ── 탭에 열어 넣기 ──

export function currentTab(): TabSpec {
  const tab = currentWorkspaceTabs().find((t) => t.id === activeId);
  return tab ?? openTab(newTab());
}

/** 그 타일의 긴 변을 자른다 */
export function autoDirFor(tab: TabSpec, paneId: string): SplitDir {
  const box = computeLayout(tab.root).panes.find((p) => p.pane.id === paneId);
  if (!box) return "row";
  const size = measureCanvas?.() ?? { w: 0, h: 0 };
  return autoSplitDir(box.rect, size.w, size.h);
}

/** 여는 것이 분할이 아니라 교체인 상태 */
export function isLoneStart(tab: TabSpec): boolean {
  return tab.root.type === "leaf" && tab.root.pane.kind === "start";
}

/** 여는 모든 경로의 공통 출구 — 시작 타일 하나뿐인 탭은 분할하지 않고 root 를 갈아 끼운다(교체에도 배치 애니메이션을 건다) */
export function placePane(
  tab: TabSpec,
  node: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): void {
  if (isRemote) {
    remotePlace(tab, node, () => (node.type === "leaf" ? { op: "openBeside", tile: targetPaneId, pane: node.pane, dir, side } : null));
    return;
  }
  unzoom(tab);
  if (isLoneStart(tab)) {
    if (node.type === "leaf") {
      const title = loneTileTitle(node.pane, t);
      if (title) tab.title = title;
    }
    withLayoutAnim(() => {
      tab.root = node;
    });
    return;
  }
  withLayoutAnim(() => {
    tab.root = insertSubtree(tab.root, targetPaneId, dir, node, side);
  });
}

/** `spiral`(기본)이면 `targetPaneId` 는 쓰이지 않는다 — 포커스가 어디 있든 결과가 같다 */
export function placeAuto(tab: TabSpec, pane: PaneSpec, targetPaneId: string): void {
  if (isRemote) {
    remotePlace(tab, leafOf(pane), () => ({ op: "openPane", tab: tab.id, near: targetPaneId, pane }));
    return;
  }
  unzoom(tab); // 새 타일이 숨은 채로 뜨지 않게
  if (isLoneStart(tab) || settings.tiling !== "spiral") {
    const target = autoPlaceTarget(tab.root, targetPaneId);
    placePane(tab, leafOf(pane), target, autoDirFor(tab, target), "after");
    return;
  }
  withLayoutAnim(() => {
    tab.root = spiralInsert(tab.root, pane);
  });
}

export function openPaneHere(pane: PaneSpec, title?: string, projectId?: string): void {
  if (remoteLayout({ op: "openPane", ...(activeId !== null ? { tab: activeId } : {}), pane, title, projectId })) return;
  const tab = currentTab();
  // 오케스트레이션 탭은 다른 타일을 받지 않는다 — 배치는 앱이 쥔다
  if (isOrchTab(tab)) {
    openInNewTab(pane, title, undefined, projectId);
    return;
  }
  // 빈 탭을 대신할 때만 탭 제목을 고친다 — 분할로 끼우는 경우는 남의 탭이다
  if (isLoneStart(tab)) {
    if (title) tab.title = title;
    if (projectId) tab.projectId = projectId;
  }
  placeAuto(tab, pane, paneOf(tab));
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  selectTab(tab.id);
}

/** 사용량 화면을 걷고 포커스를 주는 일은 부르는 쪽의 `focusTile` 이다 */
export function openPaneInTab(tabId: string, pane: PaneSpec, near?: string): void {
  if (isRemote) {
    const tab = residentWindowTabs().some((t) => t.id === tabId) ? tabId : activeId;
    remoteLayout({ op: "openPane", ...(tab !== null ? { tab } : {}), pane });
    return;
  }
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || isOrchTab(tab)) {
    openPaneHere(pane);
    return;
  }
  placeAuto(tab, pane, near !== undefined && findPane(tab.root, near) ? near : paneOf(tab));
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  selectTab(tab.id);
}

/** 나선 설정이어도 그 타일 옆이다 — 부른 사람이 "이 타일 옆에" 를 골랐다. 원격은 요청을 보냈으면 `true` */
export function openPaneBeside(tabId: string, paneId: string, pane: PaneSpec, dir?: SplitDir, activate = true): boolean {
  if (remoteLayout({ op: "openBeside", tile: paneId, pane, ...(dir ? { dir } : {}) })) return true;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, paneId)) return false;
  if (isOrchTab(tab)) {
    openInNewTab(pane);
    return true;
  }
  placePane(tab, leafOf(pane), paneId, dir ?? autoDirFor(tab, paneId), "after");
  adoptPane(tab.id, pane.id);
  // 사람이 부르지 않은 배치는 포커스를 빼앗지 않는다 — 다른 탭에서 치던 글자가 작업자의 권한 화면으로 가지 않게
  if (activate) {
    activePane[tab.id] = pane.id;
    selectTab(tab.id);
  }
  return true;
}

/**
 * 같은 칸 · 같은 비율로 갈아 끼운다. `keepZoom` 은 원격 창의 요청에 실리지 않는다(메인 PC 는 늘 최대화를 푼다).
 */
export function replaceTile(
  tabId: string,
  paneId: string,
  pane: PaneSpec,
  title?: string,
  opts?: { keepZoom?: boolean },
): boolean {
  if (remoteLayout({ op: "replaceTile", tile: paneId, pane, ...(title ? { title } : {}) })) return true;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const old = tab ? findPane(tab.root, paneId) : null;
  if (!tab || !old) return false;
  // 저장 안 한 문서는 갈아 끼우지 않는다 — `false` 를 받은 부르는 쪽은 옆 · 새 탭으로 연다
  if (unsavedVerdict("replace", [paneId], isDocDirty).kind !== "free") return false;
  if ((tab.zoomedPaneId ?? null) === paneId) tab.zoomedPaneId = opts?.keepZoom ? pane.id : null;
  if (old.kind === "doc" && pane.kind === "doc") {
    // 문서 → 문서는 배치 애니메이션을 켜지 않는다 — 타일 틀은 뚝 서고 본문만 떠오른다(`doc-swap.ts`).
    // 다른 조작 직후 260ms 안에 겹치면 그 조작의 플래그 때문에 등장이 돈다 — 드물어 그대로 둔다
    noteDocSwap(pane.id);
    tab.root = replacePane(tab.root, paneId, pane);
  } else {
    withLayoutAnim(() => {
      tab.root = replacePane(tab.root, paneId, pane);
    });
  }
  if (title) tab.title = title;
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  return true;
}

/** 원격 창은 여러 타일을 요청 하나로 옮기지 않는다(`queueRemoteNewTab` 과 같은 판단) */
export function replaceTileWithTree(tabId: string, paneId: string, node: PaneNode, loneName?: string): boolean {
  const found = residentWindowTabs().find((t) => t.id === tabId);
  const lone = found !== undefined && found.root.type === "leaf" && found.root.pane.id === paneId;
  if (node.type === "leaf") {
    const ok = replaceTile(tabId, paneId, node.pane);
    if (ok && lone && loneName && !isRemote && found) found.name = loneName;
    return ok;
  }
  if (remoteLayout(null)) return false;
  const tab = found;
  if (!tab || !findPane(tab.root, paneId)) return false;
  if (unsavedVerdict("replace", [paneId], isDocDirty).kind !== "free") return false;
  if ((tab.zoomedPaneId ?? null) === paneId) tab.zoomedPaneId = null;
  withLayoutAnim(() => {
    tab.root = replacePaneWithNode(tab.root, paneId, node);
  });
  if (lone && loneName) tab.name = loneName;
  const first = findFirstPane(node);
  activePane[tab.id] = first.id;
  for (const p of listPanes(node)) adoptPane(tab.id, p.id);
  return true;
}

/**
 * 워크트리는 새 탭이다 — 탭 상태 점이 탭 단위로 "어느 것이 손을 기다리나" 를 말하므로 한 탭에 에이전트 하나여야 점이 뭉개지지 않는다.
 * 여기 사는 이유: 프로젝트 층에 두면 지난 대화 저장소와 서로를 부른다.
 */
export function openInNewTab(pane: PaneSpec, title?: string, projectFolder?: string, projectId?: string): void {
  if (isRemote && remoteLayout({ op: "newTab", pane, title, projectFolder, projectId, ...remoteNewTabWorkspace() })) return;
  const ws = newTab();
  // 고정 제목(`pinnedTitle`)은 합성 제목에 밀리지 않고 사용자 이름(`name`)에는 진다. `title` 에도 같은 글자를 둔다 —
  // 고정 제목을 모르는 옛 판이 이 배치를 읽어도 같은 이름이 선다
  if (title) {
    ws.title = title;
    ws.pinnedTitle = title;
  }
  // 원격은 부르는 쪽이 폴더를 넘기지 않는다
  if (projectId) ws.projectId = projectId;
  const folder = projectFolder?.trim();
  if (folder) ws.projectFolder = folder;
  const tab = openTab(ws);
  placePane(tab, leafOf(pane), findFirstPane(tab.root).id, "row", "after");
  focusPane(tab.id, pane.id);
  adoptPane(tab.id, pane.id);
}

// ── 화면 분할 · 타일 조작 ──
// `PaneHost` 는 pane.id 로 키를 잡는다 — 트리를 통째로 새로 만들어도 살아 있는 터미널은 언마운트되지 않는다.

/** 나선 모드에서 `dir` 이 없으면 복제본은 포커스 옆이 아니라 나선의 다음 칸에 선다 — 한 탭에 두 규칙이 섞이지 않게 */
export function splitActive(dir?: SplitDir, customize?: (fresh: PaneSpec) => void): void {
  const tab = currentWorkspaceTabs().find((t) => t.id === activeId);
  if (!tab) return;
  const targetId = paneOf(tab);
  const src = findPane(tab.root, targetId);
  if (!src) return;
  if (orchLocked(tab)) return;
  if (isRemote && src.kind !== "start") {
    remoteLayout({ op: "split", tile: targetId, ...(dir ? { dir } : {}) });
    return;
  }
  if (src.kind === "start") {
    showNotice(t("app.tile.split.start"));
    return;
  }
  const fresh = clonePane(src);
  // 분할 갈래(나선 · 방향 · 자동) 앞에서 한 번 얹는다 — 갈래마다 뒤에서 고쳐 넣으면 하나가 빠진다
  customize?.(fresh);
  unzoom(tab);
  if (dir === undefined && settings.tiling === "spiral") {
    withLayoutAnim(() => {
      tab.root = spiralInsert(tab.root, fresh);
    });
  } else {
    const cut = dir ?? autoDirFor(tab, targetId);
    withLayoutAnim(() => {
      tab.root = splitPane(tab.root, targetId, cut, fresh);
    });
  }
  activePane[tab.id] = fresh.id;
  adoptPane(tab.id, fresh.id);
}

/** 다른 타일이 최대화 중이면 먼저 푼다 — 숨은 타일에 포커스만 주지 않게 */
export function revealPane(paneId: string): boolean {
  return revealResidentPane(residentWindowTabs(), paneId, {
    switchWorkspace,
    select: (tab, id) => {
      unzoomFor(tab, id);
      if (activeId !== tab.id) selectTab(tab.id);
      focusPane(tab.id, id);
      revealTile(id);
      if (typeof requestAnimationFrame !== "undefined") {
        // 포커스를 잃었거나 다른 타일에 남아 있을 때만 — 타일 밖이 일부러 가져간 포커스는 빼앗지 않는다.
        // 판(사용량 · 자원) 안의 포커스는 판이 걷혔을 때만 잃은 것이다 — 팔레트는 여기를 지난 뒤 판을 열어, 되가져가면 포커스가 body 로 떨어진다
        requestAnimationFrame(() => {
          const el = document.activeElement;
          const lost =
            el === null ||
            el === document.body ||
            (el instanceof HTMLElement &&
              ((el.closest("[data-cover-view]") !== null && !coverViewOpen()) ||
                (el.closest("[data-pane]") !== null &&
                  el.closest(`[data-pane="${CSS.escape(id)}"]`) === null)));
          if (lost) focusPaneBody(id);
        });
      }
    },
  });
}

export function focusTile(_tabId: string, paneId: string): void {
  if (focusAuxTile(paneId)) return;
  revealPane(paneId);
}

export function splitPaneIn(tabId: string, paneId: string, dir: SplitDir): void {
  if (remoteLayout({ op: "split", tile: paneId, dir })) return;
  focusTile(tabId, paneId);
  splitActive(dir);
}

/** `name` 이 `null` 이면 새 tmux 세션이다 — `clonePane` 이 원본의 이름을 이미 떨궈 두었다 */
export function openTmuxTileIn(tabId: string, paneId: string, name: string | null): void {
  if (remoteLayout({ op: "tmuxTile", tile: paneId, name })) return;
  focusTile(tabId, paneId);
  splitActive(undefined, (fresh) => {
    if (name !== null) fresh.tmux = name;
  });
}

/** 지금 트리에 있는 것만 — 표에 남은 옛 id 는 세지 않는다 */
export function unsavedDocPanesInWindow(): string[] {
  return residentWindowTabs().flatMap((tab) => listPanes(tab.root).map((p) => p.id)).filter(isDocDirty);
}

export function dbTxPanesInWindow(): string[] {
  return dbTxPanes(residentWindowTabs().flatMap((tab) => listPanes(tab.root).map((p) => p.id)));
}

/** 타일 닫기의 모든 입구(× · ⋯ · `close-tile` · `Ctrl+D`)가 지나는 한 곳 — 저장 안 한 문서 · 열린 트랜잭션 · 바쁜 채팅 타일 물음도 여기 하나다 */
export function closePaneIn(tabId: string, paneId: string): void {
  if (remoteLayout({ op: "closeTile", tile: paneId })) return;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  // 묻는 동안 그 타일이 이미 닫혔을 수 있어 닫기 몸통이 다시 찾는다
  const verdict = unsavedVerdict("close", [paneId], isDocDirty);
  if (verdict.kind === "ask") {
    void confirmUnsavedClose(verdict.paneIds, docNameOf).then((go) => {
      if (go) closePaneNow(tabId, paneId);
    });
    return;
  }
  // 열린 트랜잭션은 닫으면 서버가 되돌린다
  if (hasOpenDbTx(paneId)) {
    void confirmDbTxClose([paneId], docNameOf).then((go) => {
      if (go) closePaneNow(tabId, paneId);
    });
    return;
  }
  // 채팅 잎이 보낸 말을 처리하는 중(띄우는 중 포함) · 권한을 기다리는 중이면 닫기가 그 턴을 멈춘다
  if (chatTileBusy(paneId)) {
    const body = t("pane.chatTile.closeBusy.body");
    void askConfirm(body, { title: t("pane.chatTile.closeBusy.title"), kind: "warning", okLabel: t("pane.chatTile.closeBusy.ok") }).then((go) => {
      if (go) closePaneNow(tabId, paneId);
    });
    return;
  }
  closePaneNow(tabId, paneId);
}

/** 타일을 못 찾으면 빈 글자 — 대화가 그 줄을 뺀다 */
export function docNameOf(paneId: string): string {
  const pane = findPaneAnywhere(paneId);
  return pane ? paneName(pane, t) : "";
}

/** 물음이 끝난 뒤에 도는 자리라 탭 · 타일을 다시 찾는다 */
function closePaneNow(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, paneId)) return;
  setDocDirty(paneId, false);
  dropDocDraft(paneId);
  unzoom(tab);
  const next = closePane(tab.root, paneId);
  if (next === null) {
    closeTab(tabId);
    return;
  }
  // 유령은 DOM 이 아직 그대로인 지금 떠 둬야 한다
  const ghost = noteTileClosing(paneId);
  withLayoutAnim(
    () => {
      tab.root = next;
    },
    ghost ? CLOSE_SLIDE_DELAY_MS : 0,
  );
  if (activePane[tabId] === paneId) activePane[tabId] = findFirstPane(next).id;
  // 남겨 두면 배너 숫자와 실제 대상이 어긋난다
  syncPanes.get(tabId)?.delete(paneId);
}

export function closeFocusedTile(): void {
  const tab = activeTab();
  if (!tab) return;
  closePaneIn(tab.id, paneOf(tab));
}

/** 마지막 잎이면 원래 탭에 시작 타일을 남긴다 */
export function detachPane(paneId: string): PaneSpec | null {
  if (layoutLocked()) return null; // 원격의 옮기기는 아래 함수들이 통째로 요청한다
  const tab = tabOfPane(paneId);
  if (!tab) return null;
  const pane = findPane(tab.root, paneId);
  if (!pane) return null;
  detachPaneLeavingStart(tab, paneId);
  return pane;
}

export function promotePane(paneId: string, beforeId: string | null): void {
  if (remoteLayout({ op: "promoteTile", tile: paneId, before: beforeId })) return;
  // 떼기 전에 원래 탭을 잡아 둔다 — 새 탭이 그 제목을 이어받는다
  const from = tabOfPane(paneId);
  if (orchLocked(from)) return;
  // 원래 탭이 다른 워크스페이스의 마지막 탭이면 시작 타일로 남긴다 — 새 탭은 지금 워크스페이스에 선다
  const lone =
    from !== null && isLoneTile(from) && (from.workspaceId === currentWorkspaceId() || workspaceHasOtherTab(from));
  const pane = detachPane(paneId);
  if (!pane || !from) return;
  const tab = tabFromPane(pane, from); // 같은 패널 객체 — id 유지 = 세션 유지
  ensureWorkspaceKeys(tab);
  const at = beforeId === null ? -1 : residentWindowTabs().findIndex((t) => t.id === beforeId);
  if (at < 0) tabs.push(tab);
  else tabs.splice(at, 0, tab);
  if (lone) dropEmptiedTab(from.id);
  activePane[tab.id] = pane.id;
  selectTab(tab.id);
}

/** 오케스트레이션 탭은 앱이 쥔 고정 배치다 — 막을 수 없는 길로 무너진 탭은 `app/orch-tab-repair` 가 맞춘다 */
function orchLocked(tab: TabSpec | null | undefined): boolean {
  if (!isOrchTab(tab)) return false;
  showNotice(t("orch.tab.fixedLayout"));
  return true;
}

function isLoneTile(tab: TabSpec): boolean {
  return listPanes(tab.root).length === 1;
}

/** 마지막 탭을 없애면 그 워크스페이스가 빈 채로 남는다 — 그때는 떼기가 세운 시작 타일을 남긴다 */
function workspaceHasOtherTab(tab: TabSpec): boolean {
  return residentWindowTabs().some((t) => t.id !== tab.id && t.workspaceId === tab.workspaceId);
}

/** 남은 것은 떼기가 세운 시작 타일뿐이라 세션 · 저장 안 한 문서가 없다 */
function dropEmptiedTab(tabId: string): void {
  const i = residentWindowTabs().findIndex((t) => t.id === tabId);
  if (i >= 0) tabs.splice(i, 1);
  delete activePane[tabId];
  delete hasActivity[tabId];
  syncPanes.delete(tabId);
}

/**
 * 떼고 나서 넣는다 — 떼면서 형제가 승격해 트리 모양이 바뀌므로 삽입은 줄어든 트리 위에서 한다.
 * `stay` 면 보던 탭을 그대로 둔다(보던 탭이 이 이동으로 사라졌을 때만 받는 탭으로 간다).
 */
export function movePane(
  paneId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  opts?: { stay?: boolean },
): void {
  if (paneId === targetPaneId) return;
  const stay = opts?.stay === true;
  if (remoteLayout({ op: "moveTile", tile: paneId, target: targetPaneId, dir, side, ...(stay ? { stay: true as const } : {}) })) return;
  const target = tabOfPane(targetPaneId);
  if (!target) return;
  const from = tabOfPane(paneId);
  if (orchLocked(from) || orchLocked(target)) return;
  const lone = from !== null && from !== target && isLoneTile(from) && workspaceHasOtherTab(from);
  const viewedGone = lone && from.id === activeId;
  const pane = detachPane(paneId);
  if (!pane) return;
  if (lone) dropEmptiedTab(from.id);
  // 애니메이션 플래그는 같은 틱 안 어디서 켜도 그 틱의 DOM 갱신 전체에 걸린다 — 떼기와 붙이기가 한 번에 움직인다
  placePane(target, leafOf(pane), targetPaneId, dir, side);
  adoptPane(target.id, pane.id);
  activePane[target.id] = pane.id;
  if (!stay || viewedGone) selectTab(target.id);
}

/** 옮겨온 패널의 동시 입력 포함 여부는 대상 탭 기준으로 리셋한다 — 원래 탭의 집합은 버린다 */
export function mergeTab(
  sourceTabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): void {
  if (remoteLayout({ op: "mergeTab", tab: sourceTabId, target: targetPaneId, dir, side })) return;
  const source = residentWindowTabs().find((t) => t.id === sourceTabId);
  const target = residentWindowTabs().find((t) => findPane(t.root, targetPaneId) !== null);
  // 자기 탭 위 드롭은 트리를 제 안에 넣는 꼴이다
  if (!source || !target || source.id === target.id) return;
  if (orchLocked(source) || orchLocked(target)) return;

  const moved = listPanes(source.root).map((p) => p.id);
  const keepFocus = paneOf(source);
  placePane(target, source.root, targetPaneId, dir, side);

  const i = residentWindowTabs().findIndex((t) => t.id === sourceTabId);
  if (i >= 0) tabs.splice(i, 1);
  delete activePane[sourceTabId];
  delete hasActivity[sourceTabId];
  syncPanes.delete(sourceTabId);

  // 대상 탭이 동시 입력 ON 이면 옮겨온 패널은 기본 포함(adoptPane 과 같은 규칙)
  const set = syncPanes.get(target.id);
  if (set) for (const id of moved) set.add(id);

  activePane[target.id] = keepFocus;
  selectTab(target.id);
}

/** 가장자리에서는 감싸 돌지 않는다 */
export function moveFocus(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  unzoom(tab);
  const from = paneOf(tab);
  const next = neighborInDirection(computeLayout(tab.root).panes, from, dir);
  if (!next || next === from) return;
  activePane[tab.id] = next;
}

/** px — 키 반복으로 이어진다 */
const RESIZE_STEP_PX = 20;

/** 아직 못 재면 16:9 로 푼다 — 긴 변을 고를 값만 있으면 된다 */
function canvasSize(): CanvasSize {
  const size = measureCanvas?.();
  return size && size.w > 0 && size.h > 0 ? size : { w: 1600, h: 900 };
}

/** 원격 요청의 낱말 `swapTile` 은 그대로 둔다(프로토콜) */
export function moveTile(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  if (remoteLayout({ op: "swapTile", tile: paneOf(tab), dir })) return;
  const focused = paneOf(tab);
  unzoom(tab);
  const next = movePaneDwindle(tab.root, focused, dir, canvasSize());
  if (next === tab.root) return;
  withLayoutAnim(() => {
    tab.root = next;
  });
}

/**
 * 액션 id `expand-*` 와 원격 요청의 낱말 `expandTile` 은 그대로 둔다(id 는 `settings.toml` 키). 키 반복으로 이어지므로 움직임 효과 없이 바꾼다.
 */
export function resizeTile(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  if (remoteLayout({ op: "expandTile", tile: paneOf(tab), dir })) return;
  const focused = paneOf(tab);
  unzoom(tab);
  const next = resizePaneStep(tab.root, focused, dir, RESIZE_STEP_PX, canvasSize());
  if (next !== tab.root) tab.root = next;
}

// ── 타일 최대화 ──
// 트리를 건드리지 않는다 — 나머지 타일은 `display:none` 이라 세션이 안 끊기고, 되돌리면 분할선 비율까지 그대로다.

/** 구조 조작 · 포커스 이동 앞에 부른다 — 최대화 중이면 결과가 보이지 않는 곳에서 일어난다 */
export function unzoom(tab: TabSpec | null | undefined): void {
  if (!tab || (tab.zoomedPaneId ?? null) === null) return;
  withLayoutAnim(() => {
    tab.zoomedPaneId = null;
  });
}

/** 이미 있는 칸을 보이게 하는 열기 앞에 — [`placePane`] 을 지나지 않는 길이라 따로 푼다. 최대화된 그 타일 자신이면 그대로 */
export function unzoomFor(tab: TabSpec, paneId: string): void {
  if ((tab.zoomedPaneId ?? null) !== paneId) unzoom(tab);
}

/** 타일이 하나뿐이면 켜지 않는다 — 켜진 채 남으면 다음에 연 타일이 숨은 채로 뜬다 */
export function toggleZoom(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || countPanes(tab.root) < 2) return;
  const next = tab.zoomedPaneId === paneId ? null : paneId;
  withLayoutAnim(() => {
    tab.zoomedPaneId = next;
  });
  if (next !== null) activePane[tab.id] = paneId;
}

export function zoomFocusedTile(): void {
  const tab = activeTab();
  if (!tab) return;
  toggleZoom(tab.id, paneOf(tab));
}

/**
 * 세션은 건드리지 않는다 — 명세의 별칭만 고친다(안 고치면 다음 재연결이 "설정에 없는 별칭" 으로 실패한다).
 * 다른 창은 닿지 못한다 — 그쪽은 `host-renamed` 이벤트를 받아 스스로 부른다.
 */
export function renameHostInTabs(from: string, to: string): number {
  const alias = to.trim();
  if (alias === "") return 0;
  const was = from.trim().toLowerCase();
  let changed = 0;
  for (const tab of residentWindowTabs()) {
    let hit = false;
    for (const pane of listPanes(tab.root)) {
      if (!usesHostAlias(pane, from)) continue;
      pane.alias = alias;
      changed += 1;
      hit = true;
    }
    // 배치 파일에 남은 옛 제목이 별칭을 베껴 둔 것일 수 있다 — 글자가 옛 별칭과 똑같을 때만 바꾼다(사람 이름은 `name` 에 산다)
    if (hit && !tab.name?.trim() && tab.title.trim().toLowerCase() === was) tab.title = alias;
  }
  return changed;
}

/** 호스트 제거는 그 타일들을 닫지 않는다 — 살아 있는 연결은 `~/.ssh/config` 를 더 보지 않는다 */
export function countHostTilesInTabs(aliases: readonly string[]): number {
  const keys = [...aliasKeySet(aliases)];
  if (keys.length === 0) return 0;
  let n = 0;
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (keys.some((key) => usesHostAlias(pane, key))) n += 1;
    }
  }
  return n;
}

export async function closeTabAsked(id: string): Promise<void> {
  await closeTabsAsked([id]);
}

/** 모든 탭의 것을 한 대화로 묻고, 취소하면 하나도 닫지 않는다 — 반쯤 닫힌 채 멈추지 않게 */
export async function closeTabsAsked(ids: readonly string[]): Promise<boolean> {
  // 원격은 요청만 보낸다 — 닫혔는지는 거울이 알려 주므로 `false`
  if (remoteLayout({ op: "closeTabs", tabs: [...ids] })) return false;
  const alive = (): TabSpec[] => residentWindowTabs().filter((t) => ids.includes(t.id));
  const panesOf = (list: readonly TabSpec[]) => list.flatMap((t) => listPanes(t.root));
  const first = alive();
  if (first.length === 0) return false;
  const unsaved = unsavedVerdict(
    "close",
    panesOf(first).map((p) => p.id),
    isDocDirty,
  );
  if (unsaved.kind === "ask") {
    if (!(await confirmUnsavedClose(unsaved.paneIds, docNameOf))) return false;
  }
  if (!(await confirmDbTxClose(panesOf(alive()).map((p) => p.id), docNameOf))) return false;
  const targets = alive();
  if (targets.length === 0) return false;
  // 기다리는 동안 닫힌 탭은 건너뛴다
  let closed = false;
  for (const tab of targets) {
    if (!residentWindowTabs().some((x) => x.id === tab.id)) continue;
    closeTab(tab.id);
    closed = true;
  }
  return closed;
}

export async function closeOtherTabsAsked(targetId: string): Promise<void> {
  const ids = tabsToClose(currentWorkspaceTabs(), targetId, "others");
  if (ids.length === 0) return;
  if (!(await closeTabsAsked(ids))) return;
  if (residentWindowTabs().some((x) => x.id === targetId)) selectTab(targetId);
}

export async function closeTabsToRightAsked(targetId: string): Promise<void> {
  const ids = tabsToClose(currentWorkspaceTabs(), targetId, "right");
  if (ids.length === 0) return;
  const activeWasClosing = activeId !== null && ids.includes(activeId);
  if (!(await closeTabsAsked(ids))) return;
  const activeGone = activeId === null || !residentWindowTabs().some((x) => x.id === activeId);
  if ((activeWasClosing || activeGone) && residentWindowTabs().some((x) => x.id === targetId)) selectTab(targetId);
}

// ── 동시 입력 ──
// 되돌리기 어려운 동작이라 상태가 안 보이는 순간이 없어야 한다(⇶ 표식 · 테두리 · ✓ · 배너).

/** AI 타일(autorun)은 켤 때 뺀다 — 방송한 `ls -al` 이 AI 프롬프트에 타이핑되면 안 된다(넣으려면 명시적으로) */
export function toggleSync(tabId?: string): void {
  const tab = tabId === undefined ? activeTab() : (residentWindowTabs().find((t) => t.id === tabId) ?? null);
  if (!tab) return;
  if (syncPanes.delete(tab.id)) return;
  if (isOrchTab(tab)) return;
  syncPanes.set(
    tab.id,
    new SvelteSet(
      listPanes(tab.root)
        .filter((p) => !p.autorun && hasSession(p.kind))
        .map((p) => p.id),
    ),
  );
}

export function togglePaneSync(tabId: string, paneId: string): void {
  const set = syncPanes.get(tabId);
  if (!set) return;
  // 입력이 없는 타일은 Ctrl+클릭이 실수로 포함시키지 않게
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const kind = tab ? findPane(tab.root, paneId)?.kind : undefined;
  if (kind !== undefined && !hasSession(kind)) return;
  if (!set.delete(paneId)) set.add(paneId);
}

/** 새 패널은 기본 포함이다 — "방금 띄운 서버만 빠진" 상태가 조용히 생기지 않게. 빼는 것은 명시적 조작이어야 한다 */
export function adoptPane(tabId: string, paneId: string): void {
  syncPanes.get(tabId)?.add(paneId);
}

function activeSyncSet(): SvelteSet<string> | null {
  const tab = activeTab();
  return tab ? (syncPanes.get(tab.id) ?? null) : null;
}

export function syncActive(): boolean {
  return activeSyncSet() !== null;
}

export function syncTabs(): Set<string> {
  return new Set(syncPanes.keys());
}

export function activePaneCount(): number {
  const tab = activeTab();
  return tab ? countPanes(tab.root) : 0;
}

/** 트리를 훑어 센다 — 닫힌 패널 id 가 집합에 남아 있어도 숫자가 부풀지 않는다 */
export function syncPaneCount(): number {
  const set = activeSyncSet();
  const tab = activeTab();
  if (!set || !tab) return 0;
  return listPanes(tab.root).filter((p) => set.has(p.id)).length;
}

// ── 배치 저장 · 복원 ──
// 저장되는 것은 구조뿐이다(스크롤백 · 세션 id · 비밀번호는 아니다) — 근거는 `$lib/tabs` 첫머리.

/** 복원된 타일들이 마운트되어 연결 레지스트리에 접속 함수를 올릴 틈 */
const AUTO_RECONNECT_DELAY_MS = 400;

export function scheduleTabSave(): (() => void) | undefined {
  return scheduleWorkspaceSave();
}

export async function flushTabSave(): Promise<boolean> {
  return flushWorkspaceSave();
}

export async function initializeWorkspaceWindow(): Promise<boolean> {
  return bootWorkspaces(isMainWindow, {
    tabs: residentWindowTabs, active: activeTab, paneOf,
    append: (incoming) => {
      for (const tab of incoming) {
        tabs.push(tab);
        activePane[tab.id] = findFirstPane(tab.root).id;
      }
    },
    select: (tab, paneId) => {
      if (!tab) { activeId = null; return; }
      selectTab(tab.id);
      if (paneId) activePane[tab.id] = paneId;
      revealTile(paneId);
    },
  });
}

/** `loadSettings` 뒤에 부른다 — `settings.autoReconnect` 를 읽는다 */
export async function bootTabs(): Promise<void> {
  await initializeWorkspaceWindow();
  const restored = { tabs: currentWorkspaceTabs(), activeId };

  if (restored.tabs.length > 0) {
    // 연결 대기는 붙기 시도가 끝난 뒤에 센다 — 리로드 뒤의 SSH 타일은 먼저 살아 있는 세션에 붙어 본다.
    // 마운트 전에는 접속 함수 등록이 없어 계단에서 조용히 건너뛰어지므로 한 박자 먼저 기다린다
    void (async () => {
      await new Promise((r) => setTimeout(r, AUTO_RECONNECT_DELAY_MS));
      await whenSettled(deferredSshPaneIds(currentWorkspaceTabs(), activeId));
      const waiting = deferredSshPaneIds(currentWorkspaceTabs(), activeId);
      const notice = restoreNotice(restored.tabs.length, waiting.length, settings.autoReconnect);
      if (notice === "auto") connectStaggered(waiting);
      if (notice === "tabs") showNotice(t("app.restore.tabs", { count: restored.tabs.length }));
      else if (notice === "auto")
        showNotice(t("app.restore.tabs.auto", { count: restored.tabs.length, waiting: waiting.length }));
      else {
        const combo = displayCombo(effectiveCombo("reconnect-all", settings.current.keybindings));
        showNotice(
          t("app.restore.tabs.manual", { count: restored.tabs.length, waiting: waiting.length, combo }),
        );
      }
    })();
  } else {
    openTab(newTab());
  }

}

export function restoreNotice(tabCount: number, waiting: number, autoReconnect: boolean): "tabs" | "auto" | "manual" | null {
  if (tabCount <= 0) return null;
  if (waiting === 0) return "tabs";
  return autoReconnect ? "auto" : "manual";
}

/** 동시에 열지 않는다 — sshd `MaxStartups` */
export function reconnectAllDeferred(): void {
  const waiting = deferredSshPaneIds(currentWorkspaceTabs(), activeId);
  if (waiting.length === 0) {
    showNotice(t("app.restore.reconnect.none"));
    return;
  }
  connectStaggered(waiting);
  showNotice(
    t("app.restore.reconnect.go", { count: waiting.length, ms: RECONNECT_STAGGER_MS }),
  );
}

/** 세션은 죽이지 않는다 — 창 넘기기의 `markHandoff` 는 부르는 쪽이 트리를 빼기 전에 건다 */
export function detachPaneLeavingStart(tab: TabSpec, paneId: string): void {
  if (!findPane(tab.root, paneId)) return;
  unzoom(tab);
  const rest = closePane(tab.root, paneId) ?? leafOf(newStartPane());
  withLayoutAnim(() => {
    tab.root = rest;
  });
  if (activePane[tab.id] === paneId) activePane[tab.id] = findFirstPane(rest).id;
  // 남겨 두면 배너 숫자가 실제 대상과 어긋난다
  syncPanes.get(tab.id)?.delete(paneId);
}

// ── 원격 창의 메인 PC 화면 거울 ──
// 원격 창의 탭 목록을 쓰는 길은 [`applyMirrorTabs`] 하나다. 배치를 바꾸는 조작은 위 함수들의 첫 줄이 요청으로 바꿔 [`remoteLayout`] 에
// 넘기고, 메인 PC 주 창이 적용해 결과가 거울로 돌아온다. 고르는 일(탭 · 포커스 · 최대화)만 원격 창 몫이고, 원격 창은 저장하지 않는다.

/** 키를 연타해도 안내는 몇 초에 한 번 */
let lockedNoticeAt = 0;
const LOCKED_NOTICE_GAP_MS = 4000;

/** `app/mirror-requests` 가 건다 — 이 모듈이 그쪽을 부르면 순환이다 */
let layoutSink: ((req: LayoutRequest) => void) | null = null;

export function setRemoteLayoutSink(sink: ((req: LayoutRequest) => void) | null): void {
  layoutSink = sink;
}

function lockedNotice(): void {
  const now = Date.now();
  if (now - lockedNoticeAt > LOCKED_NOTICE_GAP_MS) {
    lockedNoticeAt = now;
    showNotice(t("app.mirror.locked"));
  }
}

/** 원격 창이면 배치를 바꾸지 않고 요청으로 보낸다 — 보냈거나 막았으면 `true`, 메인 PC 창은 늘 `false` */
function remoteLayout(req: LayoutRequest | null): boolean {
  if (!isRemote) return false;
  if (req && layoutSink) layoutSink(req);
  else lockedNotice();
  return true;
}

/** 슬라이더 · `Ctrl+휠` 연타는 끝값 하나로 — 메인 PC 저장을 흔들지 않게 */
const FILE_UI_DEBOUNCE_MS = 250;
const pendingFileUi = new Map<string, { change: { view?: FileView } & FileUiPatch; timer: ReturnType<typeof setTimeout> }>();

/** 원격 창의 트리는 거울 갱신에 통째로 갈리므로 파일 타일 보기 변경은 메인 PC 가 들고 있어야 산다 */
export function queueRemoteFileUi(paneId: string, change: { view?: FileView } & FileUiPatch): void {
  if (!isRemote) return;
  const prev = pendingFileUi.get(paneId);
  if (prev) clearTimeout(prev.timer);
  const merged = { ...prev?.change, ...change };
  const timer = setTimeout(() => {
    pendingFileUi.delete(paneId);
    layoutSink?.({ op: "fileUi", tile: paneId, ...merged });
  }, FILE_UI_DEBOUNCE_MS);
  pendingFileUi.set(paneId, { change: merged, timer });
}

/** 요청으로 옮길 수 없는 배치 조작(창 넘기기의 떼기 · 끼우기) */
function layoutLocked(): boolean {
  return remoteLayout(null);
}

/**
 * 원격이 방금 만든 새 탭(아직 거울에 없다) — 여는 길 몇은 `openTab(newTab())` 뒤 같은 틱에 타일을 놓으므로, 그 놓기를 모았다가 틱 끝에 요청 하나로 보낸다.
 */
const pendingNewTabs = new Map<TabSpec, true>();

function queueRemoteNewTab(tab: TabSpec): void {
  pendingNewTabs.set(tab, true);
  queueMicrotask(() => {
    pendingNewTabs.delete(tab);
    const leaves = listPanes(tab.root);
    if (leaves.length !== 1) {
      lockedNotice(); // 여러 타일을 한꺼번에 놓는 새 탭(호스트 묶음 끌어 놓기)은 요청 하나로 옮기지 않는다
      return;
    }
    const pane = leaves[0];
    const title = tab.pinnedTitle ?? tab.name;
    const ws = remoteNewTabWorkspace(tab.workspaceId);
    remoteLayout(
      pane.kind === "start" ? { op: "newTab", ...(title ? { title } : {}), ...ws } : { op: "newTab", pane, ...(title ? { title } : {}), ...ws },
    );
  });
}

function remotePlace(tab: TabSpec, node: PaneNode, make: () => LayoutRequest | null): void {
  if (pendingNewTabs.has(tab)) {
    if (isLoneStart(tab)) tab.root = node;
    else lockedNotice();
    return;
  }
  remoteLayout(make());
}

/** 배치 요청이다 — 새 Tauri 명령이 아니다 */
export function requestOrchTab(runId: string | null): boolean {
  if (!isRemote || !layoutSink) return false;
  layoutSink({ op: "openOrchTab", ...(runId ? { runId } : {}), ...remoteNewTabWorkspace() });
  return true;
}

/** 원격 창이 보는 워크스페이스는 메인 PC 가 보는 것과 다를 수 있다 — 메인 PC 는 탭을 넣되 화면을 옮기지 않는다 */
function remoteNewTabWorkspace(own?: string): { workspace?: string } {
  const ws = own ?? currentWorkspaceId();
  return ws ? { workspace: ws } : {};
}

const remoteActiveByWs: Record<string, string> = {};

/** 거울 환원이 "메인 PC 가 바꾸지 않았으면 원격의 고름을 둔다" 에 쓴다 */
export function mirrorLocalChoice(): {
  workspaceId: string | null;
  activeOf: (workspaceId: string) => string | null;
  activeId: string | null;
  focusOf: (tabId: string) => string | null;
  zoomOf: (tabId: string) => string | null;
} {
  return {
    workspaceId: currentWorkspaceId(),
    activeOf: (ws) => remoteActiveByWs[ws] ?? null,
    activeId,
    focusOf: (tabId) => activePane[tabId] ?? null,
    zoomOf: (tabId) => tabs.find((tab) => tab.id === tabId)?.zoomedPaneId ?? null,
  };
}

/**
 * 통째로 갈아 끼우되 같은 타일은 같은 id 라 터미널 시청자가 다시 붙지 않는다.
 * 구조가 바뀐 스냅숏만 배치 애니메이션 문을 지난다 — 비율 · 포커스까지 켜면 메인 PC 의 분할선 끌기가 원격에서 늘어진다.
 * `animate` 는 폰 배치면 부르는 쪽이 끈다(한 번에 타일 하나라 유령 · 등장 지연만 끼어든다) — 문서 본문 떠오르기는 그대로 둔다.
 */
export function applyMirrorTabs(next: TabSpec[], nextActive: string | null, focus: Record<string, string>, animate = true): void {
  if (!isRemote) return;
  const change = mirrorLayoutChange(tabs, next);
  for (const id of change.docSwaps) noteDocSwap(id);
  const swap = () => {
    tabs = next;
  };
  if (animate && change.animate) {
    // 유령은 DOM 이 아직 옛 배치인 지금 떠 둬야 한다
    const ghost = change.closed !== null && noteTileClosing(change.closed);
    withLayoutAnim(swap, ghost ? CLOSE_SLIDE_DELAY_MS : 0);
  } else swap();
  const alive = new Set(next.map((tab) => tab.id));
  for (const id of Object.keys(activePane)) if (!alive.has(id)) delete activePane[id];
  for (const id of Object.keys(hasActivity)) if (!alive.has(id)) delete hasActivity[id];
  for (const [ws, id] of Object.entries(remoteActiveByWs)) if (!alive.has(id)) delete remoteActiveByWs[ws];
  for (const [tabId, paneId] of Object.entries(focus)) activePane[tabId] = paneId;
  if (nextActive === null) activeId = null;
  else if (nextActive !== activeId) selectTab(nextActive);
}
