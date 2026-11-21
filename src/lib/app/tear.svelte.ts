import { handoffWorkspaceAction, tearBootAction } from "$lib/workspaces/handoff";
import { currentWindowLabel } from "$lib/context";
import { requestWindow } from "$lib/workspaces/window-events";
import { bootAuxWorkspace, currentWorkspace, currentWorkspaceId, ensureWorkspaceKeys, pauseWorkspaceSave, resumeWorkspaceSave, switchWorkspace, workspacePlacement } from "$lib/app/workspaces.svelte.js";
import { initializeWorkspaceWindow } from "$lib/app/tabs.svelte.js";
import { invoke, isRemote } from "../ipc";
import { tick } from "svelte";
import { toast } from "$lib/toast.svelte.js";
import { isShared, setShared } from "$lib/ai.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { paneMarkerDistances } from "$lib/shell-integration";
import { tearToken } from "$lib/app/window.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { adoptAgentLink, agentLinkOf } from "$lib/app/agent-sessions.svelte.js";
import { isDocDirty, setDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { captureDocDraft, dropDocDraft, holdDocDraft, type DraftCapture } from "$lib/app/doc-drafts.svelte.js";
import {
  oscTitleOf,
  reportOscTitle,
  reportResolvedShell,
  reportRunningCommand,
  resolvedShellOf,
  runningCommandOf,
} from "$lib/app/titles.svelte.js";
import { unsavedVerdict } from "$lib/unsaved-guard";
import {
  closeTab,
  detachPaneLeavingStart,
  focusPane,
  insertTab,
  placePane,
  selectTab,
  syncPanes,
  tabOfPane,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import {
  beginPaneTear,
  beginTear,
  claimTear,
  discardStash,
  endTear,
  markHandoff,
  openTearWindow,
  pendingTear,
  releaseHandoff,
  restoreTab,
  takeHandoff,
  type PaneTitleSignals,
  peekHandoff,
  type TearMerge,
  type TearPayload,
} from "$lib/tear";
import {
  borrowsSession,
  findFirstPane,
  findPane,
  listPanes,
  tabFromPane,
  type PaneSide,
  type PaneSpec,
  type SplitDir,
  type TabSpec,
} from "$lib/session";

/**
 * 창을 넘는 조작의 탭 목록 쪽 — 웹뷰가 갈려 객체를 옮길 수 없어 짐을 사서함(token)에 맡긴다(`$lib/tear`).
 * 짐은 탭이든 타일이든 언제나 "탭 한 개" 다 — 원본에서 무엇을 빼느냐만 다르다.
 */

/** px */
const DETACH_OFFSET = 48;

// ── 타일 이름 신호 ──

/** 패널 id 는 창을 건너며 새로 매겨진다 — 짐에 싣지 않으면 받는 창에서 로컬 타일이 전부 "로컬" 이 된다 */
function titlesOf(paneId: string): PaneTitleSignals | null {
  const s: PaneTitleSignals = {};
  const osc = oscTitleOf(paneId);
  const shell = resolvedShellOf(paneId);
  const cmd = runningCommandOf(paneId);
  if (osc !== undefined) s.oscTitle = osc;
  if (shell !== undefined) s.resolvedShell = shell;
  if (cmd !== undefined) s.runningCommand = cmd;
  return Object.keys(s).length > 0 ? s : null;
}

/** 타일이 마운트되기 전에 심어야 첫 그림부터 같은 이름이다 */
function adoptTitles(paneId: string, s: PaneTitleSignals): void {
  if (s.oscTitle !== undefined) reportOscTitle(paneId, s.oscTitle);
  if (s.resolvedShell !== undefined) reportResolvedShell(paneId, s.resolvedShell);
  if (s.runningCommand !== undefined) reportRunningCommand(paneId, s.runningCommand);
}

function restore(payload: TearPayload): TabSpec {
  return restoreTab(payload, setShared, adoptAgentLink, adoptTitles, holdDocDraft);
}

// ── 저장 안 한 문서는 초안을 싣고 창을 넘는다 ──
// 원본(= 글의 유일한 사본)은 받는 창의 release ACK 뒤에만 내린다. 그 사이 원본을 고치면 초안이 낡으므로 두 번 본다 —
// 꺼내기 직전(`pause`)에 바뀌었으면 거절하고 아니면 원본 편집기를 잠근다 · 내리기 직전(release)에 바뀌었으면 원본을 내리지 않는다
// (두 창에 다 남는 쪽이 글을 잃는 쪽보다 낫다). 거절 안내는 드래그 시작이 아니라 창 밖에 놓았을 때만 — 탭 순서만 바꾸려던 사람에게 뜨지 않게.

let refusedForUnsaved = false;

/** 글 자체는 쥐지 않는다(짐에 있다) */
const carried = new Map<number, { at: number; caps: DraftCapture[]; thaw?: ReturnType<typeof setTimeout> }>();
/** 사서함 시한(5분)과 같다 */
const CARRIED_TTL_MS = 300_000;
/** 받는 창이 죽어 release · resume 이 오지 않아도 풀리는 상한 */
const FREEZE_MS = 15_000;

/** 하나라도 못 뜨면 `null` — 창 넘기기 거절 */
function carryDrafts(paneIds: readonly string[]): Map<string, DraftCapture> | null {
  const caps = new Map<string, DraftCapture>();
  const verdict = unsavedVerdict("move-window", paneIds, isDocDirty, (id) => {
    const cap = captureDocDraft(id);
    if (cap) caps.set(id, cap);
    return cap !== null;
  });
  return verdict.kind === "refuse" ? null : caps;
}

function forgetCarried(token: number): void {
  const c = carried.get(token);
  if (!c) return;
  // 이 기록이 잠근 편집기만 푼다(같은 타일의 다른 짐이 잠근 것은 건드리지 않는다)
  if (c.thaw !== undefined) thawTearSource(token);
  carried.delete(token);
}

function rememberCarried(token: number, caps: Map<string, DraftCapture>): void {
  const now = Date.now();
  for (const [t, c] of carried) if (now - c.at >= CARRIED_TTL_MS) forgetCarried(t);
  if (caps.size > 0) carried.set(token, { at: now, caps: [...caps.values()] });
}

function carriedStill(token: number): boolean {
  return carried.get(token)?.caps.every((cap) => cap.still()) ?? true;
}

/** `false` 면 받는 창이 꺼내지 않는다 */
export function holdTearSource(token: number | undefined): boolean {
  if (token === undefined) return true;
  const c = carried.get(token);
  if (!c) return true;
  if (!carriedStill(token)) {
    showNotice(t("app.unsaved.tearChanged"));
    return false;
  }
  for (const cap of c.caps) cap.freeze(true);
  clearTimeout(c.thaw);
  c.thaw = setTimeout(() => thawTearSource(token), FREEZE_MS);
  return true;
}

/** 기록은 남긴다 — 다시 시도할 수 있다 */
export function thawTearSource(token: number | undefined): void {
  if (token === undefined) return;
  const c = carried.get(token);
  if (!c) return;
  clearTimeout(c.thaw);
  c.thaw = undefined;
  for (const cap of c.caps) cap.freeze(false);
}

/** 다른 거절(원격 문서 · 시작 타일)은 조용하다 */
export function noticeTearRefused(): void {
  if (!refusedForUnsaved) return;
  refusedForUnsaved = false;
  showNotice(t("app.unsaved.tear"));
}

// ── 내보내기 — 페이로드 만들기 ──

/**
 * 동기여야 한다 — 창 밖으로 나갈지 알게 될 때는 이미 `dataTransfer` 를 못 건드리므로 시작 시점에 미리 만든다(버려지면 사서함이 5분 뒤 치운다).
 */
export function startTear(tabId: string): number | null {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  refusedForUnsaved = false;
  // 원격 창 — `open_tear_window` 는 `remote/deny.rs` 가 거절한다. 예약을 만들지 않고 창 안 이동만 된다
  if (!tab || isRemote) return null;
  const drafts = carryDrafts(listPanes(tab.root).map((p) => p.id));
  if (!drafts) {
    refusedForUnsaved = true;
    return null;
  }
  ensureWorkspaceKeys(tab, tab.workspaceId ?? currentWorkspaceId());
  const snap = $state.snapshot(tab) as TabSpec;
  const token = beginTear(
    snap,
    listPanes(snap.root),
    (paneId) => sessionOf(paneId),
    // 안 실으면 뜯어낸 타일의 AI 공유 옵트인이 말없이 꺼진다
    (paneId) => isShared(paneId),
    // 안 실으면 새 창에서 `#` 검색의 점프와 실패 거터 표시가 죽는다
    (paneId) => paneMarkerDistances(paneId),
    agentLinkOf,
    titlesOf,
    { workspaceId: tab.workspaceId!, workspaceName: currentWorkspace()?.name ?? "", sourceWindow: currentWindowLabel(), sourceTabKey: tab.tabKey! },
    (paneId) => drafts.get(paneId)?.draft ?? null,
  );
  rememberCarried(token, drafts);
  return token;
}

/**
 * [`startTear`] 와 같은 계약(동기). 세션을 빌리는 타일(SFTP · 원격 문서 — `borrowsSession`)은 혼자 가면 원본을 잃어 창을 넘지 않는다 —
 * 원본과 함께 가는 탭 티어아웃을 쓴다.
 */
export function startPaneTear(paneId: string): number | null {
  const tab = tabOfPane(paneId);
  refusedForUnsaved = false;
  if (!tab || isRemote) return null;
  const pane = findPane(tab.root, paneId);
  if (!pane || borrowsSession(pane) || pane.kind === "start") return null;
  const drafts = carryDrafts([pane.id]);
  if (!drafts) {
    refusedForUnsaved = true;
    return null;
  }
  ensureWorkspaceKeys(tab, tab.workspaceId ?? currentWorkspaceId());
  const snap = $state.snapshot(pane) as PaneSpec;
  const incoming = tabFromPane(snap, tab);
  ensureWorkspaceKeys(incoming, tab.workspaceId);
  incoming.projectId = tab.projectId;
  const token = beginPaneTear(
    incoming,
    snap,
    (id) => sessionOf(id),
    (id) => isShared(id),
    (id) => paneMarkerDistances(id),
    agentLinkOf,
    titlesOf,
    { workspaceId: tab.workspaceId!, workspaceName: currentWorkspace()?.name ?? "", sourceWindow: currentWindowLabel(), sourceTabKey: tab.tabKey! },
    (id) => drafts.get(id)?.draft ?? null,
  );
  rememberCarried(token, drafts);
  return token;
}

// ── 내보내기 — 원본에서 빼기 ──

/**
 * `markHandoff` 를 탭을 지우기 전에 걸어야 `Terminal` 언마운트가 `close` 대신 `detach` 로 빠진다 — 뒤집으면 넘긴 세션이 죽는다.
 * 표시는 DOM 정리(`tick`) 뒤에 푼다.
 */
async function releaseTab(tabId: string): Promise<void> {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const ids = listPanes(tab.root).map((p) => p.id);
  markHandoff(ids);
  closeTab(tabId);
  await tick();
  releaseHandoff(ids);
}

/** [`releaseTab`] 과 같은 순서 규칙 */
async function releasePane(paneId: string): Promise<void> {
  const tab = tabOfPane(paneId);
  if (!tab) return;
  markHandoff([paneId]);
  detachPaneLeavingStart(tab, paneId);
  // 초안은 이미 짐에 실려 받는 창에 있다
  setDocDirty(paneId, false);
  dropDocDraft(paneId);
  await tick();
  releaseHandoff([paneId]);
}

/** 창을 먼저 열고 받는 창의 ACK 뒤에 탭을 뺀다. 원본이 남는 실패면 `false` */
export async function tearOut(screenX: number, screenY: number): Promise<boolean> {
  const p = pendingTear();
  if (!p) return false;
  // 예약 기록은 남긴다 — release ACK 이 늦게 와도 자기 것을 알아보게. 지우는 것은 `claimTear` 뿐이다
  endTear();
  try {
    if (!(await p.stashed)) {
      claimTear(p.token);
      forgetCarried(p.token);
      toast.error(t("app.tear.tab.stashFailed"));
      return false;
    }
    await openTearWindow(p.token, screenX, screenY);
    return true;
  } catch (e) {
    // 실패가 아닐 수 있다 — 다른 창의 드롭과 겹치면 사서함이 이미 비어 거절되지만 짐은 그쪽에 잘 도착했다(곧 release ACK 이 온다)
    if (!(await discardStash(p.token))) return true;
    claimTear(p.token);
    forgetCarried(p.token);
    toast.error(
      t("app.tear.tab.failed", { error: e instanceof Error ? e.message : String(e) }),
    );
    return false;
  }
}

/** [`tearOut`] 과 같은 순서 — 창을 먼저 열고 그다음에 뗀다 */
export async function tearOutPane(screenX: number, screenY: number): Promise<void> {
  const p = pendingTear();
  if (!p || p.paneId === undefined) return;
  endTear(); // 기록은 남긴다 — `tearOut` 과 같은 이유다
  try {
    if (!(await p.stashed)) {
      claimTear(p.token);
      forgetCarried(p.token);
      toast.error(t("app.tear.pane.stashFailed"));
      return;
    }
    await openTearWindow(p.token, screenX, screenY);
  } catch (e) {
    if (!(await discardStash(p.token))) return; // 다른 창이 가져갔다 = 실패가 아니다
    claimTear(p.token);
    forgetCarried(p.token);
    toast.error(
      t("app.tear.pane.failed", { error: e instanceof Error ? e.message : String(e) }),
    );
  }
}

/** 드래그 경로와 같은 몸통 — 겹쳐 뜨면 어느 것이 새 창인지 알 수 없어 조금 어긋나게 놓는다 */
export async function detachPaneToWindow(_tabId: string, paneId: string): Promise<void> {
  if (startPaneTear(paneId) === null) {
    const unsaved = refusedForUnsaved;
    refusedForUnsaved = false;
    showNotice(t(unsaved ? "app.unsaved.tear" : "app.tear.pane.refused"));
    return;
  }
  await tearOutPane(window.screenX + DETACH_OFFSET, window.screenY + DETACH_OFFSET);
}

// ── 받기 ──

/** 사서함은 1회용 — 꺼낸 짐은 이 창이 반드시 꽂아야 한다 */
async function adoptTear(token: number, merge?: TearMerge): Promise<TabSpec | null> {
  const peek = await peekHandoff(token);
  if (!peek?.workspace || !peek.workspaceId) return null;
  const workspaceId = peek.workspaceId;
  const previousWorkspaceId = currentWorkspaceId();
  // 탭 바의 메인 복귀는 소속부터 전환한다. 타일 드롭/aux는 다른 소속을 소비하지 않는다.
  const action = handoffWorkspaceAction(workspaceId, currentWorkspaceId(), workspacePlacement().kind === "main", merge !== undefined);
  if (action !== "adopt") {
    if (action === "refuse") {
      showNotice(t("app.workspaces.tearMismatch"));
      return null;
    }
    switchWorkspace(workspaceId, undefined, false);
  }
  await invoke("workspace_bind_window", { workspaceId: currentWorkspaceId(), scope: workspacePlacement() });
  if (!await pauseWorkspaceSave()) return null;
  const source = peek.workspace.sourceWindow;
  let consumed = false;
  try {
    // 번호를 싣는다 — 보낸 창이 실은 초안이 그사이 낡았으면 거절하고, 아니면 꺼내는 동안 원본 편집기를 잠근다(`holdTearSource`)
    if (source !== currentWindowLabel() && await requestWindow(source, { kind: "pause", token }) !== true) return null;
    const payload = await takeHandoff(token, workspaceId, merge);
    if (!payload) { showNotice(t("app.workspaces.changeFailed")); return null; }
    consumed = true;
    const incoming = restore(payload);
    // 저장은 이미 원자적으로 옮겨졌다. 소스 화면 제거 ACK 뒤 큐를 재개한다.
    if (await requestWindow(source, { kind: "release", token }) !== true) {
      showNotice(t("app.workspaces.changeFailed"));
    }
    return incoming;
  } finally {
    if (!consumed && source !== currentWindowLabel()) await requestWindow(source, { kind: "resume", token });
    // caller가 동기 insert/place를 끝내기 전에는 대상 스냅숏을 쓰지 않는다.
    if (!consumed) {
      if (action === "switch" && previousWorkspaceId) switchWorkspace(previousWorkspaceId);
      resumeWorkspaceSave();
    }
  }
}

export async function mergeTearTab(token: number, beforeId: string | null): Promise<void> {
  const tab = await adoptTear(token);
  if (!tab) return;
  insertTab(tab, beforeId);
  resumeWorkspaceSave();
}

/** 창 안의 탭 병합(`mergeTab`)과 같은 규칙 — 동시 입력 포함 여부는 대상 탭 기준이다 */
export async function mergeTearInto(
  token: number,
  targetTabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): Promise<void> {
  // 짐을 꺼내기 전에 확인한다 — 1회용 사서함을 연 뒤 꽂을 데가 없으면 그 탭은 어느 창에도 없이 사라진다
  if (!residentWindowTabs().some((t) => t.id === targetTabId && findPane(t.root, targetPaneId) !== null)) {
    return;
  }
  const targetBefore = residentWindowTabs().find((tab) => tab.id === targetTabId)!;
  const targetPane = findPane(targetBefore.root, targetPaneId)!;
  const incoming = await adoptTear(token, { tabKey: targetBefore.tabKey!, tileKey: targetPane.tileKey!, dir, side });
  if (!incoming) return;
  // await 사이에 대상이 닫혔으면 탭 바 합치기로 떨어뜨린다 — 짐은 이미 이 창의 것이라 버릴 수 없다
  const target = residentWindowTabs().find((t) => t.id === targetTabId);
  if (!target || findPane(target.root, targetPaneId) === null) {
    insertTab(incoming, null);
    resumeWorkspaceSave();
    return;
  }
  const moved = listPanes(incoming.root).map((p) => p.id);
  placePane(target, incoming.root, targetPaneId, dir, side);
  const set = syncPanes.get(target.id);
  if (set) for (const id of moved) set.add(id);
  focusPane(target.id, findFirstPane(incoming.root).id);
  selectTab(target.id);
  resumeWorkspaceSave();
}

export async function bootTear(): Promise<void> {
  if (tearToken === null) return;
  // 다시 읽은 창(F5 · 렌더러 크래시)은 여기서 저장된 aux 탭이 이미 선다 — 같은 복원을 다시 돌리면 탭이 둘이 된다
  const restored = await initializeWorkspaceWindow();
  const peek = await peekHandoff(tearToken);
  const action = tearBootAction({ restored, parcel: peek !== null });
  if (action === "restored") return;
  if (action === "missing" || !peek) {
    toast.error(t("app.tear.boot.missing"));
    return;
  }
  if (peek.workspaceId) await bootAuxWorkspace(peek.workspaceId);
  const incoming = await adoptTear(tearToken);
  if (incoming) { insertTab(incoming, null); resumeWorkspaceSave(); }
  else toast.error(t("app.tear.boot.missing"));
}

export async function releaseWorkspaceTear(token: number): Promise<boolean> {
  // 넘어간 초안보다 새 글이 원본에 있다 — 원본을 내리지 않는다(두 창에 다 남는 쪽이 글을 잃는 쪽보다 낫다)
  if (!carriedStill(token)) {
    forgetCarried(token);
    claimTear(token);
    showNotice(t("app.unsaved.tearKept"));
    resumeWorkspaceSave();
    return false;
  }
  forgetCarried(token);
  const p = claimTear(token);
  if (!p) return false;
  if (p.paneId !== undefined) await releasePane(p.paneId);
  else await releaseTab(p.tabId);
  resumeWorkspaceSave();
  return true;
}
