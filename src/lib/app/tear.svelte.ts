import { handoffWorkspaceAction, tearBootAction } from "$lib/workspaces/handoff";
import { currentWindowLabel } from "$lib/context";
import { requestWindow } from "$lib/workspaces/window-events";
import { bootAuxWorkspace, currentWorkspace, currentWorkspaceId, ensureWorkspaceKeys, pauseWorkspaceSave, resumeWorkspaceSave, switchWorkspace, workspacePlacement } from "$lib/app/workspaces.svelte.js";
import { initializeWorkspaceWindow } from "$lib/app/tabs.svelte.js";
import { invoke } from "../ipc";
import { tick } from "svelte";
import { toast } from "$lib/toast.svelte.js";
import { isShared, setShared } from "$lib/ai.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { paneMarkerDistances } from "$lib/shell-integration";
import { tearToken } from "$lib/app/window.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { adoptAgentLink, agentLinkOf } from "$lib/app/agent-sessions.svelte.js";
import { isDocDirty } from "$lib/app/doc-dirty.svelte.js";
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
 * **창을 넘는 조작** — 탭·타일을 새 창으로 떼어내고, 다른 창의 것을 받아 합친다
 * (docs/log/2026-09-02-tear-out.md · 2026-09-04-pane-tear-out.md · 2026-09-04-tear-merge-fixes.md).
 *
 * 배치 모델의 마지막 겹이다 — 패널 ⊂ 탭 ⊂ **창**. 앞의 두 겹과 결정적으로 다른 점은
 * **웹뷰가 갈린다**는 것이다: 세션은 Rust 전역이라 그대로 살아 있지만 xterm 버퍼와 탭 상태는
 * 창마다 별개라 "객체를 그대로 옮겨" 가 성립하지 않는다. 그래서 창을 넘는 조작은 ①버퍼
 * 직렬화 ②사서함(token) ③출력 재부착 세 단계를 거친다 (`$lib/tear`).
 *
 * 여기 있는 것은 그 절차의 **탭 목록 쪽 반쪽**이다: 언제 페이로드를 만들고, 언제 탭·타일을
 * 빼고, 넘어온 탭을 어디에 꽂는가.
 *
 * ## 탭이든 타일이든 **짐의 모양은 같다**
 *
 * 새 창 쪽은 한 줄도 달라지지 않는다 — 사서함에 실리는 것이 언제나 "탭 한 개" 이기
 * 때문이다 (타일 티어아웃은 `tabFromPane` 으로 그 타일만 담은 임시 탭을 지어 싣는다).
 * 달라지는 것은 원본에서 무엇을 빼느냐뿐이다: 탭이면 [`releaseTab`], 타일이면 [`releasePane`].
 */

/** 메뉴로 분리한 새 창을 지금 창에서 어긋나게 놓는 거리 (px) */
const DETACH_OFFSET = 48;

// ---------------------------------------------------------------------------
// 타일 이름 신호 (docs/log/2026-09-30-tear-title-and-agent-handoff.md)
//
// 로컬 타일의 이름(과 여러 타일 탭의 합성 제목)은 `app/titles` 가 패널 id 로 쥔 런타임 신호로 정해진다. 패널
// id 는 창을 건너며 새로 매겨지므로 짐에 실어 옮겨 심지 않으면 받는 창에서는 전부 "로컬" 이 된다.
// ---------------------------------------------------------------------------

/** 이 타일의 이름 신호 — 짐에 싣는다 (셋 다 없으면 `null`) */
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

/** 넘어온 이름 신호를 새 패널 id 로 심는다 — 타일이 마운트되기 **전**이라 첫 그림부터 같은 이름이다 */
function adoptTitles(paneId: string, s: PaneTitleSignals): void {
  if (s.oscTitle !== undefined) reportOscTitle(paneId, s.oscTitle);
  if (s.resolvedShell !== undefined) reportResolvedShell(paneId, s.resolvedShell);
  if (s.runningCommand !== undefined) reportRunningCommand(paneId, s.runningCommand);
}

/** 짐 → 이 창의 탭 — 부속 상태(공유 · 대화 연결 · 이름 신호)를 함께 심는 한 문 */
function restore(payload: TearPayload): TabSpec {
  return restoreTab(payload, setShared, adoptAgentLink, adoptTitles);
}

// ---------------------------------------------------------------------------
// 저장 안 한 문서는 창을 넘지 않는다 (docs/log/2026-09-27-doc-edit.md "F2")
//
// 편집 중인 글은 그 타일의 편집기 메모리에만 있다 — 짐(사서함)에 실리지 않고, 받는 창의 문서 타일은 파일을
// **다시 읽는다**. 그래서 넘기면 글이 말없이 사라진다. 묻지 않고 거절한다(`unsavedVerdict("move-window")`).
//
// 거절은 드래그 **시작**에서 한다(`startTear`·`startPaneTear` 가 `null` — 창 안 이동은 그대로 된다). 그 순간에
// 안내를 띄우면 탭 순서만 바꾸려던 사람에게도 뜨므로, 안내는 **창 밖에 놓았을 때**([`noticeTearRefused`])와
// ⋯ 메뉴의 "새 창으로 분리" 에서만 한다.
// ---------------------------------------------------------------------------

/** 마지막 드래그 시작이 저장 안 한 문서 때문에 창 넘기기를 거절했는가 (다음 시작이 덮는다) */
let refusedForUnsaved = false;

function refusesMove(paneIds: readonly string[]): boolean {
  return unsavedVerdict("move-window", paneIds, isDocDirty).kind === "refuse";
}

/**
 * 창 밖에 놓았는데 창을 넘기지 못한 드래그가 끝났다 — 그 거절이 저장 안 한 문서 때문이었으면 한 줄 알린다
 * (다른 거절 — 원격 문서 · 시작 타일 — 은 예전처럼 조용하다).
 */
export function noticeTearRefused(): void {
  if (!refusedForUnsaved) return;
  refusedForUnsaved = false;
  showNotice(t("app.unsaved.tear"));
}

// ---------------------------------------------------------------------------
// 내보내기 — 페이로드 만들기
// ---------------------------------------------------------------------------

/**
 * 탭 드래그가 시작됐다 — 페이로드를 만들어 사서함에 맡기고 번호를 돌려준다 (**동기**).
 *
 * 순서 바꾸기용 드래그와 **같은 한 번의 드래그**다. 창 밖으로 나갈지는 그때 가서야 알 수
 * 있는데 그때는 이미 `dataTransfer` 를 못 건드리므로, 비용을 알면서도 시작 시점에 한 번
 * 미리 만들어 둔다 (버려지면 5분 뒤 사서함이 알아서 치운다).
 *
 * `$state.snapshot` 으로 프록시를 벗겨 넘긴다 — 페이로드는 이 창을 떠나는 값이라 살아 있는
 * 상태와 확실히 끊어 두는 편이 안전하다.
 */
export function startTear(tabId: string): number | null {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  refusedForUnsaved = false;
  if (!tab) return null;
  if (refusesMove(listPanes(tab.root).map((p) => p.id))) {
    refusedForUnsaved = true;
    return null;
  }
  ensureWorkspaceKeys(tab, tab.workspaceId ?? currentWorkspaceId());
  const snap = $state.snapshot(tab) as TabSpec;
  return beginTear(
    snap,
    listPanes(snap.root),
    (paneId) => sessionOf(paneId),
    // 블록 이력과 함께 **AI 공유 옵트인**도 실어 보낸다 — 안 실으면 뜯어낸 타일의 공유가
    // 말없이 꺼진다 (docs/log/2026-09-08-block-history-store.md).
    (paneId) => isShared(paneId),
    // 마커 자리(거리)까지 실어야 새 창에서 `#` 검색의 점프와 실패 거터 표시가 산다.
    (paneId) => paneMarkerDistances(paneId),
    // 대화 연결 — 받는 창의 지난 대화 목록이 그 대화를 "열림" 으로 본다(docs/log/2026-09-26-agent-sessions.md).
    agentLinkOf,
    // 타일 이름 신호 — 안 실으면 받는 창에서 로컬 타일이 전부 "로컬" 이 된다(위 절).
    titlesOf,
    { workspaceId: tab.workspaceId!, workspaceName: currentWorkspace()?.name ?? "", sourceWindow: currentWindowLabel(), sourceTabKey: tab.tabKey! },
  );
}

/**
 * 타일 헤더 드래그가 시작됐다 — 그 타일 하나짜리 페이로드를 맡기고 번호를 돌려준다
 * (**동기** — [`startTear`] 와 같은 계약이다).
 *
 * **`null` 을 돌려주면 그 드래그는 창을 넘지 않는다** (창 안 이동·분할·승격만). 두 종류가
 * 그렇다.
 *
 * - **SFTP 타일** — 자기 세션이 없다. 옆 터미널의 세션을 `sourcePaneId` 로 **빌려** 쓰므로
 *   혼자 새 창에 가면 그 자리에서 원본을 잃는다. 창을 넘으려면 원본과 **함께** 가야 하고,
 *   그 조작의 이름은 이미 탭 티어아웃이다.
 * - **원격 문서 타일** — SFTP 타일과 같은 이유다(원본 터미널의 세션을 빌린다 · 판정은
 *   `borrowsSession` 하나 — 타일 ⋯ 메뉴의 "새 창으로 분리" 와 같은 규칙). 로컬 문서는 매인 데가
 *   없어 혼자 떠나도 된다.
 * - **시작 타일** — 옮겨 봐야 같은 안내 화면이다. 애초에 헤더가 붙지 않지만, 판정은
 *   손잡이가 아니라 뜻에 걸어 둔다.
 */
export function startPaneTear(paneId: string): number | null {
  const tab = tabOfPane(paneId);
  refusedForUnsaved = false;
  if (!tab) return null;
  const pane = findPane(tab.root, paneId);
  if (pane && refusesMove([pane.id])) {
    refusedForUnsaved = true;
    return null;
  }
  if (!pane || borrowsSession(pane) || pane.kind === "start") return null;
  // `startTear` 와 같은 이유로 프록시를 벗긴다 — 이 창을 떠나는 값이다.
  ensureWorkspaceKeys(tab, tab.workspaceId ?? currentWorkspaceId());
  const snap = $state.snapshot(pane) as PaneSpec;
  const incoming = tabFromPane(snap, tab);
  ensureWorkspaceKeys(incoming, tab.workspaceId);
  incoming.projectId = tab.projectId;
  // 새 창에서는 이 타일 하나가 탭이 된다. 제목은 **떼어 낸 탭의 것을 이어받는다**(`tabFromPane` —
  // 같은 창의 새 탭 승격과 같은 규칙 · docs/log/2026-09-30-tear-title-and-agent-handoff.md).
  return beginPaneTear(
    incoming,
    snap,
    (id) => sessionOf(id),
    (id) => isShared(id),
    (id) => paneMarkerDistances(id),
    agentLinkOf,
    titlesOf,
    { workspaceId: tab.workspaceId!, workspaceName: currentWorkspace()?.name ?? "", sourceWindow: currentWindowLabel(), sourceTabKey: tab.tabKey! },
  );
}

// ---------------------------------------------------------------------------
// 내보내기 — 원본에서 빼기
// ---------------------------------------------------------------------------

/**
 * 이 창에서 탭을 **넘겨 준다** — 세션을 죽이지 않고 뺀다.
 *
 * 표시(`markHandoff`)를 걸고 나서 탭을 지우는 순서가 전부다. 그 표시가 있어야 `Terminal` 의
 * 언마운트 정리가 `close` 대신 `detach` 로 빠진다. 표시는 DOM 정리가 끝난 뒤(`tick`)
 * 되돌린다.
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

/**
 * 이 창에서 **타일 하나를 넘겨 준다** — 세션을 죽이지 않고 뺀다.
 *
 * [`releaseTab`] 과 같은 규칙이다: `markHandoff` 를 **트리에서 빼기 전에** 걸어야
 * `Terminal` 의 언마운트 정리가 `close` 대신 `detach` 로 빠지고, DOM 정리가 끝난 뒤(`tick`)
 * 푼다. 마지막 잎이었으면 탭을 닫지 않고 **시작 타일**을 남긴다
 * (`detachPaneLeavingStart`).
 */
async function releasePane(paneId: string): Promise<void> {
  const tab = tabOfPane(paneId);
  if (!tab) return;
  markHandoff([paneId]);
  detachPaneLeavingStart(tab, paneId);
  await tick();
  releaseHandoff([paneId]);
}

/**
 * 드래그가 창 밖에서 끝났다 → **새 창으로 분리**.
 *
 * 창을 먼저 열고 받는 창의 ACK 뒤 탭을 뺀다. 곧 빠질 탭이면 true, 원본이 남는 실패면
 * false 다 — 탭 바는 그동안 빠짐을 유지하고, 실패한 경우에만 제자리로 돌려놓는다.
 */
export async function tearOut(screenX: number, screenY: number): Promise<boolean> {
  const p = pendingTear();
  if (!p) return false;
  // 드래그 한 판은 여기서 끝이다 — 예약 **기록**은 남는다 (workspace release ACK 이 늦게 와도 자기
  // 것을 알아보게). 지우는 것은 아래 `claimTear` 뿐이다.
  endTear();
  try {
    if (!(await p.stashed)) {
      claimTear(p.token);
      toast.error(t("app.tear.tab.stashFailed"));
      return false;
    }
    await openTearWindow(p.token, screenX, screenY);
    // 받는 창의 저장/소비 ACK 뒤 releaseWorkspaceTear가 원본을 뺀다.
    return true;
  } catch (e) {
    // **실패가 아닐 수 있다**: 창 밖 판정과 다른 창의 드랍이 겹치면 사서함이 이미 비어
    // `open_tear_window` 가 거절한다. 그 경우 짐은 그쪽 화면에 잘 도착했고 곧 workspace release ACK
    // 이 와서 이 탭을 뺀다 — 안내를 띄우면 거짓말이 된다.
    if (!(await discardStash(p.token))) return true;
    claimTear(p.token);
    toast.error(
      t("app.tear.tab.failed", { error: e instanceof Error ? e.message : String(e) }),
    );
    return false;
  }
}

/**
 * 타일 드래그가 창 밖에서 끝났다 → **그 타일 하나짜리 새 창**.
 *
 * 순서는 탭 티어아웃과 같다 — **창을 먼저 열고 그다음에 뗀다.** 사서함이 비었거나 창 생성이
 * 실패하면 타일은 **제자리에 그대로 남는다**(아직 아무것도 건드리지 않았다).
 */
export async function tearOutPane(screenX: number, screenY: number): Promise<void> {
  const p = pendingTear();
  if (!p || p.paneId === undefined) return;
  endTear(); // 기록은 남긴다 — `tearOut` 과 같은 이유다
  try {
    if (!(await p.stashed)) {
      claimTear(p.token);
      toast.error(t("app.tear.pane.stashFailed"));
      return;
    }
    await openTearWindow(p.token, screenX, screenY);
    // 받는 창의 저장/소비 ACK 뒤 원본을 뺀다.
  } catch (e) {
    if (!(await discardStash(p.token))) return; // 다른 창이 가져갔다 = 실패가 아니다
    claimTear(p.token);
    toast.error(
      t("app.tear.pane.failed", { error: e instanceof Error ? e.message : String(e) }),
    );
  }
}

/**
 * 타일 헤더 ⋯ 메뉴의 **"새 창으로 분리"** — 헤더를 창 밖으로 끄는 몸짓과 **같은 몸통**이다
 * (docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 예약을 만드는 것도 창을 열고 원본을 빼는 것도 드래그 경로 그대로다 — 다른 것은 **놓은
 * 자리가 없다**는 것뿐이라, 새 창 좌표를 지금 창에서 조금 어긋나게 잡아 준다 (겹쳐 뜨면
 * 어느 것이 새 창인지 알 수 없다).
 */
export async function detachPaneToWindow(_tabId: string, paneId: string): Promise<void> {
  if (startPaneTear(paneId) === null) {
    const unsaved = refusedForUnsaved;
    refusedForUnsaved = false;
    showNotice(t(unsaved ? "app.unsaved.tear" : "app.tear.pane.refused"));
    return;
  }
  await tearOutPane(window.screenX + DETACH_OFFSET, window.screenY + DETACH_OFFSET);
}

// ---------------------------------------------------------------------------
// 받기
// ---------------------------------------------------------------------------

/**
 * 사서함의 짐을 꺼내(1회용) **이 창의 id 체계로 되살린다** — 창을 넘어오는 두 경로(탭 바
 * 합치기·타일 4분면 합치기)가 공유하는 앞부분이다.
 *
 * 돌려주는 것은 언제나 **탭 하나**다. 원본이 타일 하나였어도 짐의 모양은 같기 때문이고,
 * 그래서 받는 쪽은 무엇이 떨어져 나왔는지 알 필요가 없다.
 */
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
    if (source !== currentWindowLabel() && await requestWindow(source, { kind: "pause" }) !== true) return null;
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
    if (!consumed && source !== currentWindowLabel()) await requestWindow(source, { kind: "resume" });
    // caller가 동기 insert/place를 끝내기 전에는 대상 스냅숏을 쓰지 않는다.
    if (!consumed) {
      if (action === "switch" && previousWorkspaceId) switchWorkspace(previousWorkspaceId);
      resumeWorkspaceSave();
    }
  }
}

/** 다른 창의 탭·타일이 이 창의 **탭 바**에 떨어졌다 → 탭으로 합치기 */
export async function mergeTearTab(token: number, beforeId: string | null): Promise<void> {
  const tab = await adoptTear(token);
  if (!tab) return;
  insertTab(tab, beforeId);
  resumeWorkspaceSave();
}

/**
 * 다른 창의 탭·타일이 이 창의 **타일 위**(4분면)에 떨어졌다 → 그 자리에
 * **분할로 합치기** (docs/log/2026-09-04-tear-merge-fixes.md).
 *
 * 창 안의 탭 병합(`mergeTab`)과 뜻이 같다 — 다른 것은 트리를 어디서 가져오느냐뿐이다.
 * 그래서 부속 상태 규칙도 그대로 따른다: 옮겨온 타일의 **동시 입력 포함 여부는 대상
 * 탭 기준으로** 정하고, 포커스는 옮겨온 첫 타일로 준다.
 */
export async function mergeTearInto(
  token: number,
  targetTabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): Promise<void> {
  // 대상은 **짐을 꺼내기 전에** 확인한다 — 1회용 사서함을 열고 나서 꽂을 데가 없으면 그
  // 탭은 어느 창에도 없이 사라진다.
  if (!residentWindowTabs().some((t) => t.id === targetTabId && findPane(t.root, targetPaneId) !== null)) {
    return;
  }
  const targetBefore = residentWindowTabs().find((tab) => tab.id === targetTabId)!;
  const targetPane = findPane(targetBefore.root, targetPaneId)!;
  const incoming = await adoptTear(token, { tabKey: targetBefore.tabKey!, tileKey: targetPane.tileKey!, dir, side });
  if (!incoming) return;
  // await 사이에 대상이 닫혔을 수 있다. 그때는 탭 바 합치기와 같은 결과로 떨어뜨린다 —
  // 짐은 이미 이 창의 것이므로 버릴 수 없다.
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

/** 이 창이 분리로 태어났다면 사서함에서 탭을 찾아 온다 */
export async function bootTear(): Promise<void> {
  if (tearToken === null) return;
  // 창 묶음이 있으면(다시 읽기 — F5 · 렌더러 크래시 재부착) 여기서 저장된 aux 탭이 이미 선다. 짐이 없을 때 같은 복원을 다시 돌리면 탭이 둘이
  // 된다(실기 c) — 갈래는 순수 `tearBootAction`.
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
  const p = claimTear(token);
  if (!p) return false;
  if (p.paneId !== undefined) await releasePane(p.paneId);
  else await releaseTab(p.tabId);
  resumeWorkspaceSave();
  return true;
}
