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
import { settings } from "$lib/settings.svelte.js";
import { CLOSE_SLIDE_DELAY_MS, noteTileClosing, withLayoutAnim } from "$lib/layout-anim.svelte.js";
import { displayCombo, effectiveCombo } from "$lib/keybindings";
import { isDocDirty, setDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { dropDocDraft } from "$lib/app/doc-drafts.svelte.js";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import { confirmDbTxClose, dbTxPanes, hasOpenDbTx } from "$lib/app/db-tx";
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
 * **탭 층** — 이 창이 들고 있는 탭 목록과 그 안의 타일 트리, 그리고 그 둘을
 * 건드리는 모든 조작 (docs/log/2026-09-05-refactor-page-split.md).
 *
 * `+page.svelte` 가 5,900줄이던 시절 그 파일의 절반이 여기 있었다. 옮기면서 **동작은 한
 * 줄도 바꾸지 않았다** — 이름도 시그니처도 그대로다. 달라진 것은 상태가 컴포넌트 안이
 * 아니라 **모듈 하나**에 산다는 것뿐이고, 그 덕에 세션·티어아웃·호스트·파일 전송 층이
 * `+page` 를 거치지 않고 직접 이 함수들을 부른다.
 *
 * ## 왜 모듈 상태인가 (창 하나 = 웹뷰 하나)
 *
 * 이 창에 `+page` 는 하나뿐이고, 탭 목록도 하나뿐이다. 나눠 들 이유가 없는
 * 값이라 `favorites.svelte.ts`·`workspaces.svelte.ts` 와 같은 모양의 모듈 상태로 둔다
 * (읽기는 함수, 쓰기도 함수 — 밖에서 배열에 직접 손대는 길을 두지 않는다).
 *
 * ## 여기 없는 것
 *
 * `$effect` 는 **하나도 없다**. 룬 모듈은 효과를 붙일 컴포넌트 수명이 없으므로, 저장
 * 디바운스처럼 효과가 필요한 자리는 몸통만 여기 두고([`scheduleTabSave`]) 효과 자체는
 * `+page.svelte` 가 건다.
 */

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

// 앱을 새로 켜면 **"탭 1"** 하나로 시작한다 (docs/log/2026-09-03-workspaces-v1.md).
// 그 안에는 시작 타일이 하나 서 있다 — 탭은 "여기에 무엇이든 열어 넣는 작업 공간" 이고,
// 호스트를 더블클릭하면 새 탭이 아니라 그 자리에 세션이 선다.
//
// **시작 탭은 동기 시점에 만들지 않는다** (docs/log/2026-09-03-workspace-restore.md).
// 메인 창은 마운트 직후에 저장된 배치를 읽어 복원할 수 있는데, 미리 하나 만들어 두면 그것이
// 곧바로 버려져 ①타일이 한 번 깜빡이고 ②탭 번호가 하나 건너뛴다. 그래서 "무엇으로
// 시작하는가" 의 결정은 전부 [`bootTabs`] 한 곳이다.
let tabs = $state<TabSpec[]>([]);
let activeId = $state<string | null>(null);

/**
 * 탭 id → 그 탭에서 포커스를 가진 패널 id.
 * 탭마다 따로 기억한다 — 탭을 오갈 때 마지막으로 보던 패널로 돌아오게.
 */
const activePane = $state<Record<string, string>>({});
const focusTimes = $state<Record<string, number>>({});
export function paneFocusedAt(id: string): number { return focusTimes[id] ?? 0; }

/**
 * 탭 id → 안 보는 동안 새 출력이 있었는가 (탭 바의 작은 점).
 *
 * 2단계의 **단순 활동 표시**이자 5단계 배지의 **폴백**이다 — OSC 133 이 없는 세션
 * (스니펫이 안 들어간 tmux 안·로컬 PowerShell)에는 이 신호밖에 없다.
 */
export const hasActivity = $state<Record<string, boolean>>({});

/** 패널 id → 지금 상태 (`Terminal` 이 보고한 마지막 값). 키가 없으면 OSC 133 이 없다 */
const paneStatus = $state<Record<string, PaneStatus>>({});
/** 패널 id → 안 보는 사이에 끝난 명령의 결과. 그 탭을 보는 순간 지운다 */
const stickyStatus = $state<Record<string, PaneStatus>>({});

/**
 * 탭 id → 그 탭에서 동시 입력에 **포함된** 패널 id 집합
 * (docs/log/2026-09-01-sync-input.md · 2026-09-01-drag-split-sync-select.md).
 *
 * v1 은 탭 단위 boolean 이었다 — 켜면 그 탭의 **모든** 패널이 강제로 끼었다. 지금은 탭마다
 * 포함 집합을 든다: 토글을 켜면 그 시점의 전 패널로 시작하고, 그 뒤 패널 단위로 빼고 넣는다.
 * 집합이 없으면(= 키가 없으면) 그 탭은 동시 입력이 꺼진 것이고, 빈 집합은 "켜져 있는데
 * 대상이 없다" 는 다른 상태다. 일반 `Map`/`Set` 은 `$state` 가 프록시하지 않아 반응형
 * 컬렉션을 쓴다.
 */
export const syncPanes = new SvelteMap<string, SvelteSet<string>>();

/**
 * 타일링 캔버스(`PaneHost` 의 `.host`)의 픽셀 크기를 읽는 함수 — 그쪽이 마운트에서
 * 건네준다 (`onmeasure`). 아직 안 붙었으면 `null` 이고, 그때는 [`autoDirFor`] 가
 * 지금까지의 기본값 `"row"` 로 떨어진다.
 */
let measureCanvas: (() => { w: number; h: number }) | null = null;

/** `PaneHost` 가 마운트에서 캔버스 측정 함수를 건네준다 */
export function setMeasureCanvas(measure: () => { w: number; h: number }): void {
  measureCanvas = measure;
}


// ---------------------------------------------------------------------------
// 읽기 (렌더가 보는 값)
// ---------------------------------------------------------------------------

/** 현재 작업공간의 표시 탭 — 탭 바·순환·새 탭 위치용 (「워크스페이스 도입 설계」). */
export function currentWorkspaceTabs(): TabSpec[] {
  return tabs.filter((tab) => tab.workspaceId === currentWorkspaceId());
}

/** 작업공간에 관계없이 이 창에 상주하는 탭 — 마운트·검색·세션 보호용 (「워크스페이스 도입 설계」). */
export function residentWindowTabs(): TabSpec[] {
  return tabs;
}

/** 지금 보고 있는 탭의 id (`null` = 하나도 없다) */
export function activeTabId(): string | null {
  return activeId;
}

/** 배너·버튼이 보는 활성 탭 (없으면 null) */
export function activeTab(): TabSpec | null {
  return currentWorkspaceTabs().find((t) => t.id === activeId) ?? null;
}

/** 그 탭의 활성 패널 (기록이 없거나 이미 닫힌 패널이면 첫 패널로 되돌린다) */
export function paneOf(tab: TabSpec): string {
  const id = activePane[tab.id];
  if (id && findPane(tab.root, id)) return id;
  return findFirstPane(tab.root).id;
}

/**
 * **지금 포커스된 타일** — 활성 탭의 활성 패널 (탭이 하나도 없으면 `null`).
 *
 * [`activeTab`] + [`paneOf`] + `findPane` 세 줄을 부르는 쪽마다 다시 적던 자리다
 * (`app/snippets.svelte.ts` · `app/history.svelte.ts` — "이 조작이 터미널에서 뜻이 있나" 를
 * 묻는 길이 늘수록 그 세 줄도 는다). 여기 사는 이유는 두 항이 전부 이 모듈의 값이기
 * 때문이다 — 탭 목록도 탭별 활성 패널도 여기 있다.
 */
export function focusedPane(): PaneSpec | null {
  const tab = activeTab();
  if (!tab) return null;
  return findPane(tab.root, paneOf(tab));
}

/** 패널이 속한 탭 (없으면 null) */
export function tabOfPane(paneId: string): TabSpec | null {
  return residentWindowTabs().find((t) => findPane(t.root, paneId) !== null) ?? null;
}

/** 열려 있는 어느 탭에든 있는 패널을 id 로 찾는다 (없으면 `null`) */
export function findPaneAnywhere(paneId: string): PaneSpec | null {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (pane) return pane;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 탭 상태 배지 (5단계 — docs/log/2026-09-02-osc133.md)
//
// `Terminal` 이 OSC 133 으로 읽어 올린 패널 단위 상태를 **탭 단위로 접는다**. 상태에는
// 성질이 다른 두 겹이 있다:
//
//   · 실행 중  — **살아 있는** 값. 명령이 끝나면 그 자리에서 사라진다.
//   · 성공/실패 — **사건**. 안 보는 사이에 일어났다면 사용자가 그 탭을 볼 때까지 남아야
//                 한다 (지나가 버리면 알림의 뜻이 없다).
//
// 둘 다 **패널 id 키**라 패널이 탭 사이를 옮겨 다녀도 손댈 것이 없다.
// ---------------------------------------------------------------------------

/**
 * `Terminal` → `PaneHost` 를 거쳐 올라온 상태 보고.
 *
 * 끝난 명령(성공·실패)이 **안 보는 탭**에서 일어났으면 sticky 에도 적어 둔다. 보고 있는
 * 탭에서 끝난 것은 적지 않는다 — 눈앞에서 이미 봤으니 표시를 남길 이유가 없고, 남기면 그
 * 탭을 떠나는 순간 배지가 켜진다 (본 것을 못 본 것처럼).
 */
export function noteStatus(tabId: string, paneId: string, status: PaneStatus | null): void {
  // 관제판(관리뷰)의 블록 재조회 앵커 — status 전이(OSC 133 C/D)는 블록이 열리고 닫히는
  // 바로 그 시점이라, 여기서 카운터를 한 칸 올리면 관제판 derived 가 마지막 명령·종료 코드를
  // 같은 프레임에 다시 읽는다 (docs/log/2026-09-09-management-view.md · `app/console.svelte.ts`).
  bumpBlocks();
  if (status === null) {
    delete paneStatus[paneId];
    delete stickyStatus[paneId];
    return;
  }
  paneStatus[paneId] = status;
  if (status !== "running" && tabId !== activeId) stickyStatus[paneId] = status;
}

/**
 * 한 패널의 지금 상태를 **반응형으로** 노출한다 (`null` = OSC 133 을 한 번도 못 봤다).
 *
 * private `$state`(`paneStatus`)를 밖에서 읽는 유일한 창구다 — 관제판(`Console.svelte`)의
 * `$derived` 가 이 게터를 지나 읽으면 status 가 바뀔 때 저절로 재렌더된다.
 */
export function statusOf(paneId: string): PaneStatus | null {
  return paneStatus[paneId] ?? null;
}

/**
 * 한 패널의 **안 본 결과**를 반응형으로 노출한다 — 비활성 탭에서 명령이 끝났으면(`ok`·`fail`)
 * 켜지고, 그 탭을 보는 순간 [`clearSeenStatus`] 로 거둔다 (`null` = 안 본 결과가 없다).
 *
 * private `$state`(`stickyStatus`)를 밖에서 읽는 유일한 창구다 (`statusOf` 와 같은 패턴).
 * 관제판(`Console.svelte`)이 이 값으로 **세션 단위 주의 배지**를 켠다 — 배지는 라이브고,
 * 클릭 점프 뒤 그 탭이 활성화되면 sticky 가 거둬지며 저절로 사라진다.
 */
export function stickyOf(paneId: string): PaneStatus | null {
  return stickyStatus[paneId] ?? null;
}

/**
 * 탭 하나의 배지 — 그 탭의 살아 있는 패널들을 **가장 급한 것 하나**로 접는다
 * (실행 중 > 실패 > 성공, `foldStatus`). 활성 탭은 아예 계산하지 않는다 — 배지는 안 보는
 * 탭에만 뜬다.
 *
 * `agentLive` — 에이전트가 살아 있는 타일(세션이 끝나지 않은 AI 타일 — 점이 없어도)은 `running` 을 내지 않는다
 * ([`paneBadgeInput`]). 판정은 `app/agent-status.svelte.ts` 에 있는데 그 모듈이 이 모듈을
 * 가져오므로 되가져오지 않고 **인자로** 받는다(부르는 쪽 `+page` 가 `isLiveAgentPane` 을 넘긴다).
 *
 * 접힌 값과 함께 **그 값을 정한 타일**(`paneId` — 같은 값의 타일이 여럿이면 화면 순서로 첫째)과
 * 값을 낸 **다른** 타일 수(`others`)를 싣는다 — 탭 점의 말풍선이 "PowerShell 7 외 1 명령 실패" 로
 * 어느 타일인지 밝힌다(docs/log/2026-09-26-tab-single-dot.md).
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

/**
 * 탭 하나의 **벨 표식** — 안 보는 사이에 벨이 울린 타일이 하나라도 있는가
 * (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * [`tabStatus`] 와 같은 모양·같은 수명이다: 벨 표식도 타일 id 로 들고 있고
 * (`app/bell.svelte.ts`), 여기서 탭 단위로 접으며, **활성 탭은 아예 계산하지 않는다**.
 * 상태 배지와 **따로** 그리는 이유는 둘이 다른 말을 하기 때문이다 — 점은 "명령이 이렇게
 * 끝났다", 종은 "무언가 삐 소리를 냈다"(입력 대기·완성 실패·`\a`).
 */
export function tabBells(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const tab of residentWindowTabs()) {
    if (tab.id === activeId) continue;
    if (listPanes(tab.root).some((p) => hasBellMark(p.id))) out[tab.id] = true;
  }
  return out;
}

/** 그 탭을 봤다 — 볼 때까지 남기기로 한 결과들을 여기서 거둔다 (안 본 결과 · 벨 · 에이전트 안 봄) */
function clearSeenStatus(tabId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const panes = listPanes(tab.root);
  for (const pane of panes) delete stickyStatus[pane.id];
  const ids = panes.map((p) => p.id);
  clearBellMarks(ids);
  clearAgentUnseen(ids); // docs/log/2026-10-01-signal-grid.md — 벨과 같은 수명
}

/** 안 보이는 탭의 패널에서 출력이 왔다 (Terminal 이 500ms 스로틀해 올려 준다) */
export function markActivity(tabId: string): void {
  if (tabId === activeId) return;
  hasActivity[tabId] = true;
}

// ---------------------------------------------------------------------------
// 탭 열기·전환·닫기
// ---------------------------------------------------------------------------

/**
 * 탭을 목록에 넣고 활성화한다.
 *
 * **돌려주는 것은 목록에 들어간 프록시**다 (`tabs.push` 가 감싼 그것). 인자로 받은 원본
 * 객체에 `root` 를 대입해 봐야 반응하지 않으므로, 넣자마자 트리를 고칠 호출부는 반드시
 * 이 반환값을 써야 한다.
 */
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

/**
 * 탭 전환 — 보는 순간 그 탭의 활동 점과 상태 배지를 지운다.
 * 설정 탭도 여느 탭과 똑같이 이 경로로 활성화된다 (설정은 이제 평범한 탭이다).
 */
export function selectTab(id: string): void {
  const target = tabs.find((tab) => tab.id === id);
  if (target?.workspaceId !== currentWorkspaceId() && target?.workspaceId) {
    switchWorkspace(target.workspaceId, { tabId: id });
  }
  // 슬라이드는 [`pickTab`] 만 건다 — 닫기·새 탭·이관·복원으로 바뀌는 탭은 그 자리에서 선다
  // (docs/log/2026-09-29-tab-slide.md). 도는 중이던 것도 여기서 거둔다.
  clearTabSlide();
  activeId = id;
  if (isRemote && target?.workspaceId) remoteActiveByWs[target.workspaceId] = id;
  if (activePane[id]) focusTimes[activePane[id]] = Date.now();
  delete hasActivity[id];
  clearSeenStatus(id);
}

/**
 * **사람이 고른 탭** — 탭 바 클릭 · 팔레트의 탭 항목. [`selectTab`] 에 더해 **사용량 화면을
 * 걷는다**: 그 화면은 캔버스를 덮으므로, 탭을 골랐는데 그대로 두면 고른 것이 보이지 않는다.
 *
 * `selectTab` 자체에 넣지 않은 것은 일부러다 — 그 함수는 탭을 닫았을 때 다음 탭 고르기·새
 * 탭 열기·이관처럼 **사람이 탭을 고른 것이 아닌** 자리에서도 불린다. 사용량 화면을 보는 중에
 * 뒤에서 세션이 끝나 탭이 닫혔다고 화면이 걷히면 안 된다.
 *
 * **탭 전환 슬라이드도 여기서만 건다** (docs/log/2026-09-29-tab-slide.md) — 방향은 탭 바의 순서
 * 비교다. 사용량 화면이 떠 있었으면 걸지 않는다: 판이 흐려지며 걷히는 동안 밑에서 캔버스까지
 * 미끄러지면 두 움직임이 겹친다. 고른 탭이 그 자리에 서 있고 판만 걷힌다. (캔버스를 덮던 전체 화면
 * 대시보드도 같은 규칙이었다 — 2026-10-07 에 세션 시트 · 작업안 타일로 나뉘어 없어졌다. 세션 시트는
 * 덮개라 슬라이드를 막지 않는다.)
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
 * 사용량 · 자원 화면이 떠 있으면 걷고, 키보드를 그 타일에 준다 (앞선 판은 전체 화면 대시보드도 걷었다 —
 * docs/log/2026-09-25-dashboard.md).
 *
 * 포커스는 **잃어버렸을 때만** 옮긴다 — 판 안에 있던 포커스는 판이 숨는 순간 갈 곳이 없어진다
 * (`<body>`). 누가 이미 가져갔으면(검색 칸 등) 건드리지 않는다. 한 프레임 미루는 것은 판이 실제로
 * 숨고 탭이 그려진 뒤여야 xterm 이 포커스를 받기 때문이다.
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

/** 그 탭의 포커스를 이 패널로 옮긴다 (`PaneHost` 의 `onfocuspane`) */
export function focusPane(tabId: string, paneId: string): void {
  focusTimes[paneId] = Date.now();
  activePane[tabId] = paneId;
}

/**
 * **집 PC 주 창 — 지금 보지 않는 워크스페이스에 새 탭을 넣는다**(원격의 새 탭 요청 · 10-20 워크스페이스 칩 — `app/mirror-requests`).
 * 화면은 움직이지 않는다: 고르지 않고(`selectTab` 없음) 그 워크스페이스의 마지막 활성 탭만 새 탭으로 적는다 — 거울이 그 워크스페이스의
 * 활성 탭 바뀜을 원격에 알리고, 집 PC 가 나중에 그 워크스페이스로 가면 새 탭에 선다. 이번 실행에서 열린(materialized) 워크스페이스만 —
 * cold 는 `false`(그 탭 객체가 아직 이 창에 없다).
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

/**
 * **뒤에서 탭 하나를 더한다** — `afterId` 탭 바로 뒤(없으면 맨 뒤) · 그 탭의 워크스페이스에 넣고 **고르지 않는다**(2026-10-29 — 오케스트레이션의
 * 앨범 탭 자동 배치 `create` 갈래: 사람은 다른 데서 말하던 중이라 포커스를 빼앗지 않는다). 원격 창은 하지 않는다(`false`).
 */
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

/** 넘어온 탭을 목록의 `beforeId` **앞에** (null 이면 맨 뒤에) 꽂고 활성화한다 */
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

/** 탭 바 안 드랍 — `dragId` 를 `beforeId` 앞으로 (null 이면 맨 뒤로) */
export function reorderTabs(dragId: string, beforeId: string | null): void {
  if (remoteLayout({ op: "reorderTab", tab: dragId, before: beforeId })) return;
  replaceCurrentTabs(moveTab(currentWorkspaceTabs(), dragId, beforeId));
}

/** 새 탭을 목록의 `beforeId` 앞으로 옮긴다 (탭 바 드롭이 보여 준 삽입선 그대로) */
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
  // 탭이 빠지면 전역 패널 목록에서 그 탭의 패널들만 사라지고(keyed each 의 항목 제거),
  // 각 Terminal 이 close invoke + dispose 를 돈다. 다른 탭의 패널은 키가 그대로다.
  // 저장 안 한 문서 표시와 걸어 둔 초안(`app/doc-drafts`)도 함께 거둔다 — 여기 오기 전에 물었거나(`closeTabAsked`) 창을 넘긴
  // 것이다(넘기기는 초안을 짐에 실었을 때만 된다 — `startTear` · 실을 수 없으면 거절).
  for (const p of listPanes(tabs[i].root)) {
    setDocDirty(p.id, false);
    dropDocDraft(p.id);
  }
  tabs.splice(i, 1);
  delete activePane[id];
  delete hasActivity[id];
  // 같은 id 가 다시 나올 일은 없지만(카운터는 단조 증가) 상태를 남겨 두지 않는다
  syncPanes.delete(id);
  if (activeId === id) {
    const shown = currentWorkspaceTabs();
    const next = (shown[currentIndex] ?? shown[currentIndex - 1] ?? null)?.id ?? null;
    if (next === null) activeId = null;
    else selectTab(next);
  }
}

/**
 * 탭 더블클릭·우클릭 메뉴의 "이름 변경" — 탭에 **사람이 부르는 이름**을 붙인다.
 *
 * 빈 문자열은 "이름 지우기" 다 (키를 지워 자동 제목으로 되돌린다 — `tabDisplayTitle`).
 * v1 은 여기까지다: 이름은 창이 사는 동안만 남고 파일에 저장되지 않는다.
 */
export function renameTab(tabId: string, name: string): void {
  if (remoteLayout({ op: "renameTab", tab: tabId, name })) return;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const next = name.trim();
  if (next === "") delete tab.name;
  else tab.name = next;
}

/** 다음 탭으로 감싸며 이동 (`dir === 1` 다음 · `-1` 이전) */
export function cycleTab(dir: 1 | -1): void {
  const tabs = currentWorkspaceTabs();
  if (tabs.length === 0) return;
  const at = tabs.findIndex((t) => t.id === activeId);
  const base = at < 0 ? 0 : at;
  const next = (base + dir + tabs.length) % tabs.length;
  pickTab(tabs[next].id); // 탭 전환 키도 사람이 고른 것이다
}

/**
 * `Alt+1`…`Alt+9` — n번째 탭으로 **직접** 간다 (없으면 아무 일도 하지 않는다).
 *
 * 번호는 탭 바에 보이는 **순서**이지 탭의 id 가 아니다 (끌어서 순서를 바꾸면
 * 번호도 따라 바뀐다) — 탭 바가 그리는 것과 같은 배열을 그대로 센다.
 */
export function selectTabAt(n: number): void {
  const tab = currentWorkspaceTabs()[n - 1];
  if (tab) pickTab(tab.id);
}

// ---------------------------------------------------------------------------
// 탭에 **열어 넣기** (docs/log/2026-09-03-workspaces-v1.md)
//
// 이 배치의 개념 전환이 여기 몇 함수에 다 들어 있다. 예전 모델은 **호스트 중심**이었다 —
// 호스트를 더블클릭하면 그 이름의 탭이 하나 생겼다. 새 모델에서 탭 하나는 **이름 붙인 타일
// 배치 = 탭**이다. 그러면 "무엇을 여는가" 와 "어디에 여는가" 가 갈라지고, 여는
// 것들은 전부 **지금 보고 있는 탭 안**으로 들어간다.
//
// 트리 조작은 여는 경로 전부가 같은 출구 하나를 지난다 ([`placePane`]).
// ---------------------------------------------------------------------------

/**
 * 지금 열어 넣을 탭 — 없으면 하나 만든다.
 *
 * "없다" 는 두 경우다: 사용자가 전부 닫았거나, 분리 창이 아직 비어 있거나. 둘 다 "열어
 * 달라" 는 요청을 거절할 이유가 아니므로 조용히 새 탭을 세운다.
 */
export function currentTab(): TabSpec {
  const tab = currentWorkspaceTabs().find((t) => t.id === activeId);
  return tab ?? openTab(newTab());
}

/**
 * `paneId` 타일을 다시 나눌 **방향** — 그 타일의 **긴 변**을 자른다
 * (docs/log/2026-09-04-tiling-move-resize.md).
 *
 * 예전에는 여는 경로가 전부 `"row"` 로 못 박혀 있었다. 그래서 세로로 긴 타일에서 SFTP·로컬
 * 브라우저를 열면 폭이 반으로 접힌 띠 두 개가 나왔다. 긴 변 기준이면 그 자리에서는 위아래로
 * 갈라지고, 가로로 넓은 타일에서는 지금까지처럼 좌우로 갈라진다.
 *
 * 방향을 **명시한** 길(⋯ 메뉴의 분할, 드롭 4분면)은 이 함수를 지나지 않는다. 설정이
 * **나선**(기본)이면 자동 경로도 지나지 않는다 — 그때 자리를 정하는 것은 `spiralInsert` 다.
 */
export function autoDirFor(tab: TabSpec, paneId: string): SplitDir {
  const box = computeLayout(tab.root).panes.find((p) => p.pane.id === paneId);
  if (!box) return "row";
  const size = measureCanvas?.() ?? { w: 0, h: 0 };
  return autoSplitDir(box.rect, size.w, size.h);
}

/** 이 탭이 **시작 타일 하나**인가 (= 여는 것이 분할이 아니라 교체인 상태) */
export function isLoneStart(tab: TabSpec): boolean {
  return tab.root.type === "leaf" && tab.root.pane.kind === "start";
}

/**
 * 서브트리 하나를 탭에 **놓는다** — 여는 모든 경로의 공통 출구다
 * (docs/log/2026-09-04-start-page.md).
 *
 * 보통은 [`insertSubtree`] 그대로다. 탭이 **시작 타일 하나**뿐이면 대신 root 를
 * 통째로 갈아 끼운다: 새 탭은 안내 화면 하나로 뜨는데 거기서 평소처럼 분할하면
 * 쓸모를 다한 안내가 결과 타일 옆에 절반을 차지한 채 남는다.
 *
 * 배치 애니메이션도 여기서 건다 — **교체에도 건다.** 예전에는 "깜빡임" 으로 읽힌다며
 * 교체만 뺐지만, 2026-09-25 사용자 요청으로 뒤집었다: 첫 타일도 살짝 떠오르는 등장을
 * 받는다(미끄러질 타일은 없으니 보이는 것은 새 타일의 `tileIn` 하나뿐이다).
 */
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
  unzoom(tab); // 여는 모든 경로의 공통 출구 = 최대화를 푸는 공통 자리이기도 하다
  if (isLoneStart(tab)) {
    // 빈 탭을 대신하는 타일이 주소가 곧 이름인 종류(브랜치 그래프 · diff · 파일 · 문서)면 탭의 자동 제목도 그 이름으로
    // (`loneTileTitle` — 적어 두면 나중에 타일이 바뀌어도 그 이름이 남는다). 사용자 이름은 `tabDisplayTitle` 에서 늘 앞선다.
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

/**
 * **자동 배치**의 공통 출구 — 방향도 자리도 사람이 고르지 않은 모든 열기 경로가 여기로 온다
 * (docs/log/2026-09-04-spiral-tiling.md).
 *
 * 설정 `app.tiling` 이 둘 중 하나를 고른다:
 *
 * - **`spiral`(기본)** — `spiralInsert`. **가장 최근에 놓인 칸**을 시계 방향으로 쪼갠다.
 *   `targetPaneId` 는 쓰이지 않는다 (그래서 포커스가 어디 있든 결과가 같다).
 * - **`focus`** — 지금까지의 규칙. `targetPaneId` 타일을 [`autoDirFor`](긴 변)로 쪼갠다.
 *
 * 시작 타일 하나짜리 탭은 **어느 쪽에서도 교체**다 ([`placePane`]).
 */
export function placeAuto(tab: TabSpec, pane: PaneSpec, targetPaneId: string): void {
  if (isRemote) {
    remotePlace(tab, leafOf(pane), () => ({ op: "openPane", tab: tab.id, near: targetPaneId, pane }));
    return;
  }
  unzoom(tab); // 최대화 중이면 먼저 원래 배치로 (새 타일이 숨은 채로 뜨지 않게)
  if (isLoneStart(tab) || settings.tiling !== "spiral") {
    const target = autoPlaceTarget(tab.root, targetPaneId);
    placePane(tab, leafOf(pane), target, autoDirFor(tab, target), "after");
    return;
  }
  withLayoutAnim(() => {
    tab.root = spiralInsert(tab.root, pane);
  });
}

/**
 * 패널 하나를 **지금 탭에** 연다 — 자리는 설정이 정한다 ([`placeAuto`]).
 *
 * 자리를 **직접** 고르고 싶으면 지금까지처럼 **끌어다 놓으면** 된다 (4분면이 방향과 좌우를
 * 정한다). 이 경로로 들어오는 것은 전부 "하나 더 띄운다" 라서 물을 자리가 없다.
 *
 * 새 타일이 곧바로 포커스를 갖고, 동시 입력이 켜진 탭이면 기본 포함이다.
 */
export function openPaneHere(pane: PaneSpec, title?: string, projectId?: string): void {
  if (remoteLayout({ op: "openPane", ...(activeId !== null ? { tab: activeId } : {}), pane, title, projectId })) return;
  const tab = currentTab();
  // 오케스트레이션 탭은 다른 타일을 받지 않는다(D11 — 배치는 앱이 쥔다) — 그 탭이 지금 탭이면 새 탭으로.
  if (isOrchTab(tab)) {
    openInNewTab(pane, title, undefined, projectId);
    return;
  }
  // 빈 탭(launcher 하나)을 **대신하는** 경우에만 탭의 자동 제목을 고친다 — 그 탭은 이제 이 타일의 탭이다
  // (프로젝트·워크트리를 launcher 에서 열 때 — 워크트리 탭 제목 관례). 분할로 끼우는 경우는 남의 탭이라 두지 않는다.
  if (isLoneStart(tab)) {
    if (title) tab.title = title;
    if (projectId) tab.projectId = projectId;
  }
  placeAuto(tab, pane, paneOf(tab));
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  selectTab(tab.id);
}

/**
 * 패널 하나를 **그 탭에** 연다 — [`openPaneHere`] 와 같은 자동 배치인데 탭을 부르는 쪽이 고른다
 * (지난 대화의 재개가 "그 워크트리의 탭" 을 찾았을 때 — docs/log/2026-09-26-project-start-screen.md).
 * 탭이 사라졌으면 지금 탭에 연다. 그 탭을 고르지만 사용량 화면을 걷고 포커스를 주는 일은 부르는 쪽의
 * `focusTile` 이다.
 */
export function openPaneInTab(tabId: string, pane: PaneSpec, near?: string): void {
  if (isRemote) {
    const tab = residentWindowTabs().some((t) => t.id === tabId) ? tabId : activeId;
    remoteLayout({ op: "openPane", ...(tab !== null ? { tab } : {}), pane });
    return;
  }
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || isOrchTab(tab)) {
    openPaneHere(pane); // 오케스트레이션 탭이면 그쪽이 새 탭으로 돌린다(D11)
    return;
  }
  // `near` — 그 타일 옆에서 자동 배치(원격의 요청이 원본 타일을 실어 올 때 — R3). 없거나 사라졌으면 그 탭의 포커스 타일.
  placeAuto(tab, pane, near !== undefined && findPane(tab.root, near) ? near : paneOf(tab));
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  selectTab(tab.id);
}

/**
 * 패널 하나를 **그 타일 옆에** 연다 — 방향은 새 타일 규칙(긴 변 · [`autoDirFor`]). 레이아웃 열기와 같은 자리 잡기다
 * (같은 탭의 트리를 여는 호출). 나선 설정이어도 **그 타일 옆**이다 — 부른 사람이 "이 타일 옆에" 를 골랐기 때문이다
 * (이 폴더의 지난 대화 — docs/log/2026-09-27-folder-conversations.md). 새 타일이 곧바로 포커스를 갖고 그 탭을
 * 고른다(사용량 화면을 걷는 일은 부르는 쪽의 `focusTile`). 탭이나 타일이 사라졌으면 `false`.
 */
export function openPaneBeside(tabId: string, paneId: string, pane: PaneSpec, dir?: SplitDir, activate = true): boolean {
  // 원격은 요청을 보냈으면 `true` — 결과(집 PC 의 거절 포함)는 요청이 따로 알린다.
  if (remoteLayout({ op: "openBeside", tile: paneId, pane, ...(dir ? { dir } : {}) })) return true;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, paneId)) return false;
  // 오케스트레이션 탭의 타일 옆 = 새 탭(D11 — 보고의 [diff 보기] · 이 폴더의 지난 대화 등)
  if (isOrchTab(tab)) {
    openInNewTab(pane);
    return true;
  }
  // `dir` 을 주면 그 방향이다 — 블록 넘기기의 새 AI 타일은 셸 타일 **오른쪽**(`row`)에 선다.
  placePane(tab, leafOf(pane), paneId, dir ?? autoDirFor(tab, paneId), "after");
  adoptPane(tab.id, pane.id);
  // `activate: false` — 사람이 부르지 않은 배치(오케스트레이션 작업자 자동 붙이기)는 탭 · 포커스를 빼앗지 않는다(사람이 다른 탭에서
  // 치던 글자가 작업자의 권한 화면으로 가지 않게).
  if (activate) {
    activePane[tab.id] = pane.id;
    selectTab(tab.id);
  }
  return true;
}

/**
 * 타일 하나를 **그 자리에서 갈아 끼운다** — 같은 탭 · 같은 칸 · 분할 비율 그대로
 * (docs/log/2026-09-26-project-start-screen.md). 프로젝트 시작 화면이 고른 것(셸 · AI · 재개 …)으로
 * 바뀌는 길이고, 빈 탭의 launcher 자리에 재개가 들어가는 길이기도 하다.
 *
 * launcher 의 교체(`placePane` — 탭에 시작 타일 하나뿐이면 root 를 통째로)와 **같은 뜻을 분할 안까지**
 * 넓힌 것이다: 시작 화면은 프로젝트 "열기"(지금 탭의 활성 타일 옆)로 분할 안에도 서기 때문이다.
 * `title` 을 주면 탭의 자동 제목도 고친다(launcher 탭에 재개가 들어갈 때 — 워크트리 탭의 관례).
 * 새 타일이 곧바로 포커스를 갖는다. 대상이 없으면 `false`.
 */
export function replaceTile(tabId: string, paneId: string, pane: PaneSpec, title?: string): boolean {
  if (remoteLayout({ op: "replaceTile", tile: paneId, pane, ...(title ? { title } : {}) })) return true;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const old = tab ? findPane(tab.root, paneId) : null;
  if (!tab || !old) return false;
  // 저장 안 한 문서는 **갈아 끼우지 않는다** (docs/log/2026-09-27-doc-edit.md "F2" — `planDocOpen` 이 이미
  // 고르지 않지만 한 번 더). `false` 를 받은 부르는 쪽은 옆 · 새 탭으로 연다.
  if (unsavedVerdict("replace", [paneId], isDocDirty).kind !== "free") return false;
  if ((tab.zoomedPaneId ?? null) === paneId) tab.zoomedPaneId = null;
  withLayoutAnim(() => {
    tab.root = replacePane(tab.root, paneId, pane);
  });
  if (title) tab.title = title;
  activePane[tab.id] = pane.id;
  adoptPane(tab.id, pane.id);
  return true;
}

/**
 * 타일 하나를 **새 탭 하나**로 연다 — "새 탭에서 열기" 와 같은 자리 잡기.
 *
 * 프로젝트의 "열기" 는 지금 탭에 타일을 더하지만 워크트리는 새 탭이다: 워크트리마다 에이전트
 * 하나를 병렬로 돌리는 것이 이 기능의 쓰임이고, 탭 상태 점(docs/log/2026-09-24-agent-status-dot.md)
 * 이 **탭 단위**로 "어느 것이 손을 기다리나" 를 말하므로 한 탭에 하나씩이어야 점이 뭉개지지 않는다.
 * 지난 대화의 재개·새 대화로 계속도 갈 탭이 따로 없으면 이 길을 쓴다(`app/agent-sessions.svelte.ts`).
 *
 * `app/projects.svelte.ts` 에 살다가 2026-09-26 이리로 왔다 — 지난 대화 저장소가 이 함수를 부르고
 * 프로젝트 층이 지난 대화 저장소를 부르게 되어, 프로젝트 층에 두면 둘이 서로를 부른다(그쪽이 다시 내보낸다).
 */
export function openInNewTab(pane: PaneSpec, title?: string, projectFolder?: string, projectId?: string): void {
  if (isRemote && remoteLayout({ op: "newTab", pane, title, projectFolder, projectId, ...remoteNewTabWorkspace() })) return;
  const ws = newTab();
  // 프로젝트·워크트리 탭은 **제목이 곧 자리**다(`<프로젝트>` · `<프로젝트> · <워크트리>`). 고정 제목 칸
  // (`pinnedTitle`)에 적는다 — 타일이 몇 개로 늘어도 합성 제목에 밀리지 않고(사용자 요청 2026-09-27), 사용자가
  // 붙이는 이름(`name`)이 아니라서 이름을 붙이면 그쪽이 이기고 비우면 이 제목으로 돌아온다(`tabFixedTitle`).
  // 자동 제목(`title`)에도 같은 글자를 둔다 — 고정 제목을 모르는 옛 판이 이 배치를 읽어도 같은 이름이 선다.
  // 새 탭의 제목을 정하는 자리는 이 함수 하나다.
  if (title) {
    ws.title = title;
    ws.pinnedTitle = title;
  }
  // **로컬** 프로젝트·워크트리 탭이면 그 폴더도 적는다 — 이 탭에 새로 여는 셸·AI 타일이 그 폴더에서 뜬다
  // (`start-dir.ts` — docs/log/2026-09-27-new-terminal-cwd.md). 원격은 부르는 쪽이 넘기지 않는다.
  if (projectId) ws.projectId = projectId;
  const folder = projectFolder?.trim();
  if (folder) ws.projectFolder = folder;
  const tab = openTab(ws);
  placePane(tab, leafOf(pane), findFirstPane(tab.root).id, "row", "after");
  focusPane(tab.id, pane.id);
  adoptPane(tab.id, pane.id);
}

// ---------------------------------------------------------------------------
// 화면 분할 · 타일 조작
//
// 트리 조작은 전부 `session.ts` 의 순수 함수다. 여기서는 "어느 탭의 어느 패널" 만 정하고
// 새 트리를 대입한다 — 렌더(`PaneHost`)는 pane.id 로 키를 잡으므로 트리가 통째로 새로
// 만들어져도 살아 있는 터미널은 언마운트되지 않는다.
// ---------------------------------------------------------------------------

/**
 * 활성 탭의 활성 패널을 같은 종류의 새 세션과 나눠 쓴다.
 *
 * `dir` 을 주면 그 방향으로 — 타일 헤더 ⋯ 메뉴의 "좌우/상하로 분할" 이 그 길이다.
 * **생략하면 자동 배치 규칙**을 따른다 (`split` 단축키·명령 팔레트). 키에는 고를 여지가
 * 없으니 설정과 화면 모양이 대신 정하고, 메뉴는 두 줄이 나란히 있으니 사람이 고른다.
 *
 * **나선 모드에서는 복제본이 포커스 타일 옆이 아니라 나선의 다음 칸에 선다** — 자리를
 * 정하는 것이 나선이기 때문이다 (포커스 옆에만 예외를 파면 한 탭에서 두 규칙이
 * 섞인다).
 */
export function splitActive(dir?: SplitDir, customize?: (fresh: PaneSpec) => void): void {
  const tab = currentWorkspaceTabs().find((t) => t.id === activeId);
  if (!tab) return;
  const targetId = paneOf(tab);
  const src = findPane(tab.root, targetId);
  if (!src) return;
  // 오케스트레이션 탭은 나누지 않는다(D11 — 배치는 앱이 쥔다)
  if (orchLocked(tab)) return;
  if (isRemote && src.kind !== "start") {
    remoteLayout({ op: "split", tile: targetId, ...(dir ? { dir } : {}) });
    return;
  }
  // 시작 타일은 **복제할 것이 없다** — 세션도 상태도 없어 하나 더 만들어 봐야 같은 안내
  // 화면이 둘이다. 분할 대신 바로가기를 쓰라고 말한다.
  if (src.kind === "start") {
    showNotice(t("app.tile.split.start"));
    return;
  }
  // 새 패널의 id 를 미리 알아야 곧바로 포커스를 옮길 수 있다
  // (clonePane 은 얕은 전개라 프록시에서 값만 뽑아 온다.)
  const fresh = clonePane(src);
  // 복제본에 한 마디 더 얹을 자리 — **지금은 tmux 세션 힌트 하나뿐이다**
  // (docs/log/2026-09-16-tmux-toggle.md의 "새 타일로 열기"). `clonePane` 이 떨군 값을 부르는
  // 쪽이 골라서 되심는 모양이라, 분할의 갈래(나선·방향·자동) 어디로 가든
  // 새 타일은 같은 값을 들고 선다 — 갈래마다 뒤에서 고쳐 넣으면 하나가 빠진다.
  customize?.(fresh);
  unzoom(tab); // 최대화 중이었으면 원래 배치로 돌아간 뒤 나눈다
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

/**
 * **가리킨 타일을 활성으로 만든다** — 타일 헤더 ⋯ 메뉴의 항목들이 공유하는 앞부분이다
 * (docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 메뉴에서 부르는 조작 중 몇은 몸통이 여전히 "활성 타일" 을 본다 ([`splitActive`] ·
 * 포워딩 모달의 `activeSessionId`). 그 몸통들을 인자 받는 형태로 전부 갈아엎는 대신,
 * **가리킨 것이 곧 활성** 이라는 사실을 여기서 한 줄로 못 박는다 — 헤더를 누르면 포커스가
 * 그 타일로 옮기지만, 그 위임을 타지 않는 경로(키보드로 연 메뉴 등)에서도 어긋나지 않게.
 */
/** 창 전체 타일 reveal의 공통 입구. 숨긴 workspace부터 전환한다. */
export function revealPane(paneId: string): boolean {
  return revealResidentPane(residentWindowTabs(), paneId, {
    switchWorkspace,
    select: (tab, id) => {
      if (activeId !== tab.id) selectTab(tab.id);
      focusPane(tab.id, id);
      revealTile(id);
      if (typeof requestAnimationFrame !== "undefined") {
        // 다음 프레임에 키보드를 그 타일로 — 단 포커스를 **잃었거나 다른 타일에 남아 있을 때만**.
        // 그 사이 타일 밖(기록 보기 시트·팔레트 등)이 일부러 가져간 포커스는 빼앗지 않는다.
        requestAnimationFrame(() => {
          const el = document.activeElement;
          const lost =
            el === null ||
            el === document.body ||
            (el instanceof HTMLElement &&
              (el.closest("[data-cover-view]") !== null ||
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

/** 타일 헤더 ⋯ 메뉴의 "좌우로 분할" · "상하로 분할" */
export function splitPaneIn(tabId: string, paneId: string, dir: SplitDir): void {
  if (remoteLayout({ op: "split", tile: paneId, dir })) return;
  focusTile(tabId, paneId);
  splitActive(dir);
}

/**
 * tmux 세션 팝오버의 **"새 타일로 열기" · "새 세션"**
 * (docs/log/2026-09-16-tmux-toggle.md).
 *
 * 같은 호스트의 타일을 하나 더 연다 — **분할과 완전히 같은 길**이다(자리도 자동 배치 규칙이
 * 정한다). 다른 것은 새 타일이 들고 서는 `PaneSpec.tmux` 한 칸뿐이다:
 *
 * - `name` 이 있으면 그것이 **접속 힌트**가 된다. 백엔드는 이미 이 앱의 다른 타일이 물고 있는
 *   이름이면 `-D` 를 붙이지 않으므로, 두 타일이 **같은 화면을 함께 본다**(빼앗지 않는다).
 * - `null` 이면 힌트가 없다 = 백엔드가 비어 있는 다음 번호를 골라 **새 세션**을 만든다.
 *   (`clonePane` 이 원본의 이름을 이미 떨궈 두었으므로 아무것도 안 해도 그 뜻이 된다.)
 */
export function openTmuxTileIn(tabId: string, paneId: string, name: string | null): void {
  if (remoteLayout({ op: "tmuxTile", tile: paneId, name })) return;
  focusTile(tabId, paneId);
  splitActive(undefined, (fresh) => {
    if (name !== null) fresh.tmux = name;
  });
}

/**
 * 이 창에서 **저장 안 한 문서 타일** id 들 — 창 닫기 · 페이지 떠나기의 물음이 읽는다(지금 트리에 있는 것만 —
 * 표에 남은 옛 id 는 세지 않는다).
 */
export function unsavedDocPanesInWindow(): string[] {
  return residentWindowTabs().flatMap((tab) => listPanes(tab.root).map((p) => p.id)).filter(isDocDirty);
}

/**
 * 이 창에서 **열린 트랜잭션 작업이 있는 쿼리 타일** id 들 — 보조 창 닫기의 물음이 읽는다(`app/db-tx` — 쿼리 타일 1단계).
 */
export function dbTxPanesInWindow(): string[] {
  return dbTxPanes(residentWindowTabs().flatMap((tab) => listPanes(tab.root).map((p) => p.id)));
}

/**
 * 패널 닫기 — 마지막 하나였으면 탭이 닫힌다.
 *
 * **닫기의 길이 여기 하나로 모인다** — 헤더 `×` · ⋯ 메뉴의 "닫기" · `close-tile` 단축키 ·
 * 세션 없는 타일의 `Ctrl+D` · 종료된 터미널의 `Ctrl+D` 가 전부 이 함수를 지난다.
 */
export function closePaneIn(tabId: string, paneId: string): void {
  if (remoteLayout({ op: "closeTile", tile: paneId })) return;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  // **저장 안 한 문서면 한 번 묻는다** (docs/log/2026-09-27-doc-edit.md "F2") — 닫기의 다섯 입구가 여기
  // 한 곳을 지나므로 판정도 여기 한 줄이다. 묻는 동안 그 타일이 이미 닫혔을 수 있어 닫기 몸통이 다시 찾는다.
  const verdict = unsavedVerdict("close", [paneId], isDocDirty);
  if (verdict.kind === "ask") {
    void confirmUnsavedClose(verdict.paneIds, docNameOf).then((go) => {
      if (go) closePaneNow(tabId, paneId);
    });
    return;
  }
  // **열린 트랜잭션 작업이면 한 번 묻는다**(쿼리 타일 1단계 — 닫으면 서버가 되돌린다 · `app/db-tx`).
  if (hasOpenDbTx(paneId)) {
    void confirmDbTxClose([paneId], docNameOf).then((go) => {
      if (go) closePaneNow(tabId, paneId);
    });
    return;
  }
  closePaneNow(tabId, paneId);
}

/**
 * 저장 안 한 문서 확인 대화에 적을 이름 — 문서 타일의 이름(`paneName` — 파일 이름, 원격이면 `· 별칭`).
 * 타일을 못 찾으면 빈 글자(대화가 그 줄을 뺀다).
 */
export function docNameOf(paneId: string): string {
  const pane = findPaneAnywhere(paneId);
  return pane ? paneName(pane, t) : "";
}

/** [`closePaneIn`] 의 몸통 — 물음이 끝난 뒤에 도는 자리라 탭 · 타일을 다시 찾는다. */
function closePaneNow(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, paneId)) return;
  setDocDirty(paneId, false);
  dropDocDraft(paneId);
  unzoom(tab); // 최대화 중이었으면 남는 타일들이 보이는 상태에서 자리를 채운다
  const next = closePane(tab.root, paneId);
  if (next === null) {
    closeTab(tabId);
    return;
  }
  // 닫히는 상자의 반대 등장(유령) — DOM 이 아직 그대로인 지금 떠 둔다. 유령이 섰으면 옆 타일은 뒤이어(차례 닫기).
  const ghost = noteTileClosing(paneId);
  withLayoutAnim(
    () => {
      tab.root = next;
    },
    ghost ? CLOSE_SLIDE_DELAY_MS : 0,
  );
  // 닫은 패널이 포커스였으면 남은 트리의 첫 패널로 옮긴다
  if (activePane[tabId] === paneId) activePane[tabId] = findFirstPane(next).id;
  // 포함 집합에서도 뺀다 — 남겨 두면 나중에 배너 숫자와 실제 대상이 어긋난다
  syncPanes.get(tabId)?.delete(paneId);
}

/**
 * `close-tile` 단축키 — **포커스된 타일 하나를 닫는다**. 헤더 `×` 와 같은 경로다
 * (docs/log/2026-09-04-default-shell-close-tile.md).
 *
 * 종류를 가리지 않는다: 로컬 셸·SSH·호스트·설정·브라우저 전부. 그래서 `Ctrl+D`(세션 없는
 * 타일 전용)가 닿지 못하는 **살아 있는 터미널**까지 키보드로 닫을 수 있다. 확인창은 없다 —
 * `×` 도 안 묻는다. (예외 하나: 저장 안 한 문서 타일은 `closePaneIn` 이 묻는다.)
 */
export function closeFocusedTile(): void {
  const tab = activeTab();
  if (!tab) return;
  closePaneIn(tab.id, paneOf(tab));
}

/**
 * 타일을 트리에서 떼어 명세를 돌려준다 — 마지막 잎이면 원래 탭에 시작 타일을 남긴다.
 * 창 안 이동·탭 승격도 창 넘기기와 같은 정리를 거친다.
 */
export function detachPane(paneId: string): PaneSpec | null {
  if (layoutLocked()) return null; // 떼기만 하는 길(창 넘기기) — 원격의 옮기기는 아래 함수들이 통째로 요청한다
  const tab = tabOfPane(paneId);
  if (!tab) return null;
  const pane = findPane(tab.root, paneId);
  if (!pane) return null;
  detachPaneLeavingStart(tab, paneId);
  return pane;
}

/**
 * 패널 → **새 탭** 승격. 탭 바의 `beforeId` 탭 앞에 (null 이면 맨 뒤에) 꽂는다.
 *
 * 새 탭이므로 **동시 입력은 꺼진 채로 시작**하고 **활동 점도 없다**(탭에 붙는 상태라 물려
 * 받을 것이 없다). `paneSessions` 는 패널 id 키라 무손실이다.
 */
export function promotePane(paneId: string, beforeId: string | null): void {
  if (remoteLayout({ op: "promoteTile", tile: paneId, before: beforeId })) return;
  // 떼기 **전에** 원래 탭을 잡아 둔다 — 새 탭이 그 제목을 이어받는다(`tabFromPane`).
  const from = tabOfPane(paneId);
  if (orchLocked(from)) return;
  // 새 탭은 지금 워크스페이스에 선다(`ensureWorkspaceKeys`) — 원래 탭이 다른 워크스페이스의 마지막 탭이면 시작 타일로 남긴다
  const lone =
    from !== null && isLoneTile(from) && (from.workspaceId === currentWorkspaceId() || workspaceHasOtherTab(from));
  const pane = detachPane(paneId);
  if (!pane || !from) return;
  const tab = tabFromPane(pane, from); // 같은 패널 객체를 그대로 담는다 (id 유지 = 세션 유지)
  ensureWorkspaceKeys(tab);
  const at = beforeId === null ? -1 : residentWindowTabs().findIndex((t) => t.id === beforeId);
  if (at < 0) tabs.push(tab);
  else tabs.splice(at, 0, tab);
  if (lone) dropEmptiedTab(from.id);
  activePane[tab.id] = pane.id;
  selectTab(tab.id);
}

/**
 * 오케스트레이션 탭이면 배치 조작(분할 · 타일 옮기기 · 탭 병합 · 승격)을 거절하고 한 줄 알린다(D11 — 앱이 쥔 고정 배치. 막을 수 없는 길로
 * 무너진 탭은 `app/orch-tab-repair` 가 맞춘다).
 */
function orchLocked(tab: TabSpec | null | undefined): boolean {
  if (!isOrchTab(tab)) return false;
  showNotice(t("orch.tab.fixedLayout"));
  return true;
}

/** 타일이 하나뿐인 탭 — 그 타일을 끌어 옮기면 탭째 사라진다(10-27 사용자 — 예전엔 빈 시작 타일이 남았다) */
function isLoneTile(tab: TabSpec): boolean {
  return listPanes(tab.root).length === 1;
}

/**
 * 같은 워크스페이스에 이 탭 말고 다른 탭이 있는가 — 세션 판에서는 다른 워크스페이스의 타일도 끌 수 있어(2026-11-04), 마지막 탭을 없애면
 * 그 워크스페이스가 빈 채로 남는다. 그때는 탭을 없애지 않고 떼기가 세운 시작 타일을 남긴다.
 */
function workspaceHasOtherTab(tab: TabSpec): boolean {
  return residentWindowTabs().some((t) => t.id !== tab.id && t.workspaceId === tab.workspaceId);
}

/**
 * 마지막 타일을 끌어 옮겨 비게 된 탭을 목록에서 뺀다 — [`mergeTab`] 의 원래 탭 정리와 같다. 남은 것은 떼기가 세운
 * 시작 타일뿐이라 세션 · 저장 안 한 문서가 없다. 고르는 탭은 부르는 쪽이 곧바로 정한다.
 */
function dropEmptiedTab(tabId: string): void {
  const i = residentWindowTabs().findIndex((t) => t.id === tabId);
  if (i >= 0) tabs.splice(i, 1);
  delete activePane[tabId];
  delete hasActivity[tabId];
  syncPanes.delete(tabId);
}

/**
 * 패널을 **다른 패널 옆으로** 옮긴다 (탭 안 이동 — 4분면 미리보기가 자리를 정한다).
 *
 * 먼저 떼고 나서 넣는 순서가 중요하다 — 떼면서 형제가 승격해 트리 모양이 바뀌므로, 삽입은
 * **줄어든 트리** 위에서 해야 한다 (`targetPaneId` 는 id 로 찾으므로 모양이 바뀌어도 찾힌다).
 *
 * `stay` — 보던 탭을 그대로 둔다(세션 판 안의 끌기 · 2026-11-04). 옮긴 타일은 받는 탭의 포커스가 되지만 그 탭을 고르지는 않는다.
 * 보던 탭이 이 이동으로 사라졌을 때만 받는 탭으로 간다.
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
  // `detachPane` 이 이미 원래 탭의 트리를 줄였지만, 플래그는 **같은 틱 안 어디서 켜도**
  // 그 틱의 DOM 갱신 전체에 걸린다 — 떼기와 붙이기가 한 번에 애니메이션된다.
  placePane(target, leafOf(pane), targetPaneId, dir, side);
  // 대상 탭이 동시 입력 ON 이면 옮겨온 패널은 **기본 포함** (탭 병합·새 패널과 같은 규칙)
  adoptPane(target.id, pane.id);
  activePane[target.id] = pane.id;
  if (!stay || viewedGone) selectTab(target.id);
}

/**
 * 탭 병합 — `sourceTabId` 의 root 서브트리를 `targetPaneId` 의 `dir`·`side` 쪽에 끼운다
 * (docs/log/2026-09-02-pane-host.md 4절).
 *
 * **부속 상태 규칙**:
 * - 옮겨온 패널의 **동시 입력 포함 여부는 대상 탭 기준으로 리셋**한다 — 대상 탭이 켜져
 *   있으면 기본 포함, 꺼져 있으면 아무 집합에도 들어가지 않는다. 원래 탭의 집합은 통째로
 *   버린다 (탭이 사라지므로 남겨 둘 자리도 없다).
 * - 활동 점(`hasActivity`)은 **탭에 붙은 상태**라 원래 탭과 함께 사라진다.
 * - `paneSessions` 와 상태 배지는 **패널 id 키**라 소속 탭이 바뀌어도 손댈 것이 없다.
 */
export function mergeTab(
  sourceTabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): void {
  if (remoteLayout({ op: "mergeTab", tab: sourceTabId, target: targetPaneId, dir, side })) return;
  const source = residentWindowTabs().find((t) => t.id === sourceTabId);
  const target = residentWindowTabs().find((t) => findPane(t.root, targetPaneId) !== null);
  // 자기 자신 탭 위 드랍은 무시한다 (트리를 제 안에 넣는 꼴이다)
  if (!source || !target || source.id === target.id) return;
  if (orchLocked(source) || orchLocked(target)) return;

  const moved = listPanes(source.root).map((p) => p.id);
  const keepFocus = paneOf(source); // 끌기 전 그 탭에서 보던 패널
  // 대상이 시작 타일 하나뿐인 탭이면 끌려온 트리가 그 자리를 대신한다.
  placePane(target, source.root, targetPaneId, dir, side);

  const i = residentWindowTabs().findIndex((t) => t.id === sourceTabId);
  if (i >= 0) tabs.splice(i, 1);
  delete activePane[sourceTabId];
  delete hasActivity[sourceTabId];
  syncPanes.delete(sourceTabId);

  // 대상 탭이 동시 입력 ON 이면 옮겨온 패널은 **기본 포함** (adoptPane 과 같은 규칙)
  const set = syncPanes.get(target.id);
  if (set) for (const id of moved) set.add(id);

  activePane[target.id] = keepFocus;
  selectTab(target.id);
}

/**
 * `Alt+화살표` — 지금 탭에서 **그쪽 이웃 타일로 포커스**를 옮긴다
 * (docs/log/2026-09-03-keys-ended-focus.md).
 *
 * 이웃을 고르는 일은 전부 `neighborInDirection` 이 한다 — 트리가 아니라 **화면 사각형**으로
 * 푼다. 이웃이 없으면(가장자리) **아무 일도 하지 않는다** — 감싸 돌지 않는 것이 방향 이동의
 * 관례다.
 */
export function moveFocus(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  // 최대화 중에는 이웃이 화면에 없다 — 먼저 원래 배치로 돌아가고 그 위에서 옮긴다.
  unzoom(tab);
  const from = paneOf(tab);
  const next = neighborInDirection(computeLayout(tab.root).panes, from, dir);
  if (!next || next === from) return;
  activePane[tab.id] = next;
}

/** 키보드 크기 조절 한 번의 거리 (px) — 키를 누르고 있으면 키 반복으로 이어진다 */
const RESIZE_STEP_PX = 20;

/** 실제 캔버스 크기. 아직 못 재면(창이 숨음 · 마운트 전) 흔한 16:9 로 푼다 — 긴 변을 고를 값만 있으면 된다 */
function canvasSize(): CanvasSize {
  const size = measureCanvas?.();
  return size && size.w > 0 && size.h > 0 ? size : { w: 1600, h: 900 };
}

/**
 * `Alt+Shift+화살표` — 포커스된 타일을 그쪽으로 옮긴다. Hyprland `movewindow` 와 같다 — 떼었다가 그쪽 칸을 쪼개 다시
 * 끼운다(`movePaneDwindle` · docs/log/2026-11-05-hyprland-tiling.md). 원격 요청의 낱말 `swapTile` 은 그대로 둔다.
 *
 * 포커스는 손대지 않는다 — 라우팅이 **잎 id** 기준이고 이동은 그 id 를 바꾸지 않는다.
 */
export function moveTile(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  if (remoteLayout({ op: "swapTile", tile: paneOf(tab), dir })) return;
  const focused = paneOf(tab);
  unzoom(tab); // 옮겨 가는 모습이 보여야 뜻이 읽힌다
  const next = movePaneDwindle(tab.root, focused, dir, canvasSize());
  if (next === tab.root) return; // 단일 타일 — no-op
  withLayoutAnim(() => {
    tab.root = next;
  });
}

/**
 * `Ctrl+Alt+화살표` — 그 축의 가장 가까운 분할선을 방향키 쪽으로 민다. Hyprland `resizeactive` 와 같다
 * (`resizePaneStep` · docs/log/2026-11-05-hyprland-tiling.md). 키 반복으로 이어지므로 분할선 끌기처럼 움직임 효과 없이 바꾼다.
 * 액션 id `expand-*` · 원격 요청의 낱말 `expandTile` 은 그대로 둔다(id 는 `settings.toml` 키).
 */
export function resizeTile(dir: FocusDir): void {
  const tab = activeTab();
  if (!tab) return;
  if (remoteLayout({ op: "expandTile", tile: paneOf(tab), dir })) return;
  const focused = paneOf(tab);
  unzoom(tab); // 크기가 바뀌는 모습이 보여야 뜻이 읽힌다
  const next = resizePaneStep(tab.root, focused, dir, RESIZE_STEP_PX, canvasSize());
  if (next !== tab.root) tab.root = next;
}

// ---------------------------------------------------------------------------
// 타일 최대화 (zoom) — docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md
//
// **트리를 건드리지 않는다.** 탭이 `zoomedPaneId` 하나를 들고, `PaneHost` 가 그
// 타일만 캔버스 전체로 그리고 나머지를 숨긴다 (숨김은 비활성 탭과 같은
// `display:none` 이라 세션이 안 끊긴다). 되돌리면 분할선 비율까지 그대로다.
// ---------------------------------------------------------------------------

/**
 * **최대화를 푼다** — 구조 조작·포커스 이동 앞에 부른다.
 *
 * 최대화 중에는 화면에 타일이 하나뿐이라, 그 상태로 타일을 열거나 닫거나 옮기면 결과가
 * 보이지 않는 곳에서 일어난다 ("분할했는데 아무 일도 안 일어났다"). 부르는 자리를 한 함수로
 * 모아 둔 덕에, 새 조작이 이 줄을 빠뜨려도 화면이 깨지지는 않는다 — `PaneHost` 가 그리는
 * 자리에서 한 번 더 거른다.
 */
export function unzoom(tab: TabSpec | null | undefined): void {
  if (!tab || (tab.zoomedPaneId ?? null) === null) return;
  withLayoutAnim(() => {
    tab.zoomedPaneId = null;
  });
}

/**
 * `zoom-tile`(기본 `Ctrl+Shift+Z`) · 헤더 ⤢ — 포커스 타일을 **캔버스 전체로** 키웠다가
 * 같은 조작으로 원래 배치로 되돌린다.
 *
 * 타일이 하나뿐이면 **아무 일도 하지 않는다** — 이미 화면 전체라 켜고 끄는 것이 눈에 보이지
 * 않고, 켜진 채로 남으면 다음에 타일을 하나 열었을 때 그것이 숨은 채로 뜬다.
 */
export function toggleZoom(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || countPanes(tab.root) < 2) return;
  const next = tab.zoomedPaneId === paneId ? null : paneId;
  withLayoutAnim(() => {
    tab.zoomedPaneId = next;
  });
  // 버튼으로 켠 경우를 위해 포커스도 그 타일로 옮긴다 (키로 왔으면 이미 그 타일이다).
  if (next !== null) activePane[tab.id] = paneId;
}

/** 단축키·팔레트에서 오는 길 — 대상은 언제나 **지금 탭의 포커스 타일**이다 */
export function zoomFocusedTile(): void {
  const tab = activeTab();
  if (!tab) return;
  toggleZoom(tab.id, paneOf(tab));
}

/**
 * 호스트 별칭이 바뀌었다 — **이 창에 열려 있는 탭들**의 SSH 타일 명세를 새 이름으로 고친다.
 * 고친 타일 수를 돌려준다 (docs/log/2026-09-17-host-rename-fanout.md).
 *
 * **세션은 건드리지 않는다.** 살아 있는 연결은 이름과 무관하게 그대로 돌아가고, 여기서
 * 바뀌는 것은 명세 한 칸뿐이다 — 머리줄 이름·색·툴팁과 **다음 재연결이 찾을 별칭**.
 * 안 고치면 그 타일은 끊긴 뒤 "설정에 없는 별칭" 으로 붙으려다 실패한다.
 *
 * 트리를 새로 짓지 않고 [`PaneSpec`] 을 **제자리에서** 고친다 — `tabs` 가 `$state` 라 이 쓰기가
 * 그대로 화면과 자동 저장(`scheduleTabSave` 의 `$effect`)을 깨운다. 파일에 실리는
 * 사본은 그래서 **평소 저장 경로**로 따라온다 (여기서 따로 쓰지 않는다).
 *
 * **다른 창은 이 함수가 닿지 못한다** — 창마다 자기 탭 목록을 들고 있기 때문이다. 그쪽은
 * `app/host-rename.svelte.ts` 가 쏘는 `host-renamed` 이벤트를 받아 같은 함수를 스스로 부른다.
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
    // 탭 이름표도 별칭을 **베껴 둔** 자리다: 타일이 하나뿐인 탭은 `displayTabTitle` 이
    // 저장된 [`TabSpec.title`] 로 떨어지므로(여럿이면 지금 이름을 접어 만든다), 안 고치면
    // 타일 머리줄은 새 이름인데 탭만 옛 이름으로 남는다. **글자가 옛 별칭과 똑같을 때만**
    // 바꾼다 — 그 제목은 예전 `tabFromPane` 이 별칭에서 지은 것이고(배치 파일에 남아 있을 수 있다), 사람이 손수 붙인 이름은
    // `title` 이 아니라 `name` 에 산다(그쪽은 건드리지 않는다).
    if (hit && !tab.name?.trim() && tab.title.trim().toLowerCase() === was) tab.title = alias;
  }
  return changed;
}

/**
 * 이 별칭들로 붙어 있는 SSH 타일이 **이 창에** 몇 개인가 (모든 탭을 훑는다).
 *
 * 호스트 제거 확인 문구가 읽는 값이다 — 그리고 **제거는 그 타일들을 닫지 않는다**
 * (docs/log/2026-09-17-host-remove-fanout.md): 세션은 살아 있고, 살아 있는 연결은
 * `~/.ssh/config` 를 더 보지 않는다. 사라지는 것은 **다음 재연결이 찾을 자리**뿐이라,
 * 지금 화면에서 일하고 있는 터미널을 설정 파일 편집이 끊어 버리는 일은 없다.
 *
 * 판정은 [`usesHostAlias`] — 이름 변경([`renameHostInTabs`])과 같은 함수다.
 */
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

/** **탭 닫기 — 저장 안 한 문서가 있으면 한 번 묻는다** ([`closeTabsAsked`] 에 id 하나를 넘긴다). */
export async function closeTabAsked(id: string): Promise<void> {
  await closeTabsAsked([id]);
}

/**
 * **탭 여러 개를 한 번에 닫기 — 묻는 것도 한 번씩** (docs/log/2026-09-28-tab-close-others.md).
 *
 * 저장 안 한 문서는 **모든 탭의 문서 타일을 한 대화**로 묻는다. 취소하면 **하나도 닫지 않는다** — 반쯤 닫힌 채
 * 멈추지 않게. 대화를 기다리는 동안 사라진 탭은
 * 건너뛴다(닫기 직전에 하나씩 다시 확인한다).
 *
 * 닫았으면 `true` — 탭 우클릭 메뉴가 그 뒤 활성 탭을 정한다([`closeOtherTabsAsked`]·[`closeTabsToRightAsked`]).
 */
export async function closeTabsAsked(ids: readonly string[]): Promise<boolean> {
  // 원격은 요청만 보낸다(묻기는 요청 쪽이 — `app/mirror-requests`) — 닫혔는지는 거울이 알려 주므로 `false`.
  if (remoteLayout({ op: "closeTabs", tabs: [...ids] })) return false;
  const alive = (): TabSpec[] => residentWindowTabs().filter((t) => ids.includes(t.id));
  const panesOf = (list: readonly TabSpec[]) => list.flatMap((t) => listPanes(t.root));
  const first = alive();
  if (first.length === 0) return false;
  // 저장 안 한 문서 (docs/log/2026-09-27-doc-edit.md "F2").
  const unsaved = unsavedVerdict(
    "close",
    panesOf(first).map((p) => p.id),
    isDocDirty,
  );
  if (unsaved.kind === "ask") {
    if (!(await confirmUnsavedClose(unsaved.paneIds, docNameOf))) return false;
  }
  // 열린 트랜잭션 작업(쿼리 타일 1단계) — 모든 탭의 것을 한 대화로.
  if (!(await confirmDbTxClose(panesOf(alive()).map((p) => p.id), docNameOf))) return false;
  const targets = alive();
  if (targets.length === 0) return false;
  // 기다리는 동안 닫힌 탭은 건너뛴다 (다른 비동기 조작과 같은 재확인 — `closeTab` 이 모르는 id 를 무시한다).
  let closed = false;
  for (const tab of targets) {
    if (!residentWindowTabs().some((x) => x.id === tab.id)) continue;
    closeTab(tab.id);
    closed = true;
  }
  return closed;
}

/**
 * 탭 우클릭 메뉴 **"다른 탭 닫기"** — 가리킨 탭만 남기고 닫는다. 닫았으면 그 탭이 활성 탭이 된다
 * (브라우저와 같다). 취소하면 아무것도 바뀌지 않는다.
 */
export async function closeOtherTabsAsked(targetId: string): Promise<void> {
  const ids = tabsToClose(currentWorkspaceTabs(), targetId, "others");
  if (ids.length === 0) return;
  if (!(await closeTabsAsked(ids))) return;
  if (residentWindowTabs().some((x) => x.id === targetId)) selectTab(targetId);
}

/**
 * 탭 우클릭 메뉴 **"오른쪽 탭 닫기"** — 탭 바에서 가리킨 탭 뒤의 탭들을 닫는다. 활성 탭이 그 안에 있었으면
 * 가리킨 탭이 활성 탭이 되고, 아니면 활성 탭은 그대로다.
 */
export async function closeTabsToRightAsked(targetId: string): Promise<void> {
  const ids = tabsToClose(currentWorkspaceTabs(), targetId, "right");
  if (ids.length === 0) return;
  const activeWasClosing = activeId !== null && ids.includes(activeId);
  if (!(await closeTabsAsked(ids))) return;
  const activeGone = activeId === null || !residentWindowTabs().some((x) => x.id === activeId);
  if ((activeWasClosing || activeGone) && residentWindowTabs().some((x) => x.id === targetId)) selectTab(targetId);
}

// ---------------------------------------------------------------------------
// 동시 입력
//
// 되돌리기 어려운 동작이라 **상태가 안 보이는 순간이 없어야 한다**: 탭 바의 ⇶ 표식 +
// **포함된** 패널의 경고색 테두리 + 좌상단 ✓ + 탭 바 아래 배너 (닫기 버튼 없음).
// ---------------------------------------------------------------------------

/**
 * 한 **탭**의 동시 입력을 켜고 끈다 (켤 때는 **전 패널 포함**으로 시작).
 *
 * `tabId` 를 생략하면 활성 탭이다 — 단축키와 명령 팔레트가 그쪽이고, 탭 우클릭
 * 메뉴는 **가리킨 탭**을 넘긴다 (docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 단 **AI 패널(autorun claude)은 뺀다** — 명령을 함께 실행할 서버가 아니라 로컬 보조라,
 * `ls -al` 같은 방송이 claude 프롬프트에 타이핑되면 안 된다. 진짜로 넣고 싶으면 타일 헤더의
 * ⋯ 메뉴나 Ctrl+클릭으로 명시적으로 넣을 수 있다.
 */
export function toggleSync(tabId?: string): void {
  const tab = tabId === undefined ? activeTab() : (residentWindowTabs().find((t) => t.id === tabId) ?? null);
  if (!tab) return;
  if (syncPanes.delete(tab.id)) return;
  if (isOrchTab(tab)) return; // 오케스트레이션 탭은 동시 입력 대상이 아니다(프로듀서 하나뿐 — 노트 1-3)
  syncPanes.set(
    tab.id,
    new SvelteSet(
      listPanes(tab.root)
        // AI 패널(autorun)과 세션 없는 타일(설정·호스트)은 뺀다 — 셋 다 명령을 함께
        // 실행할 대상이 아니다 (설정·파일 타일은 아예 입력이 없다).
        .filter((p) => !p.autorun && hasSession(p.kind))
        .map((p) => p.id),
    ),
  );
}

/** 패널 하나의 포함/제외를 뒤집는다 (좌상단 ✓ · Ctrl+클릭) */
export function togglePaneSync(tabId: string, paneId: string): void {
  const set = syncPanes.get(tabId);
  if (!set) return; // 꺼진 탭에서는 부를 일이 없다 (PaneHost 가 켜졌을 때만 부른다)
  // 설정·파일 타일은 입력이 없다 — Ctrl+클릭이 실수로 포함시키지 않게 막는다.
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const kind = tab ? findPane(tab.root, paneId)?.kind : undefined;
  if (kind !== undefined && !hasSession(kind)) return;
  if (!set.delete(paneId)) set.add(paneId);
}

/**
 * 새로 생긴 패널은 **기본 포함**이다 (분할·드랍 공통).
 * "방금 띄운 서버만 빠져 있는" 상태가 조용히 만들어지지 않게 — 빼는 것은 명시적 조작이어야 한다.
 */
export function adoptPane(tabId: string, paneId: string): void {
  syncPanes.get(tabId)?.add(paneId);
}

/** 활성 탭의 포함 집합 (`null` = 이 탭은 동시 입력 OFF) */
function activeSyncSet(): SvelteSet<string> | null {
  const tab = activeTab();
  return tab ? (syncPanes.get(tab.id) ?? null) : null;
}

/** 활성 탭이 동시 입력 중인가 (배너를 그릴지) */
export function syncActive(): boolean {
  return activeSyncSet() !== null;
}

/**
 * 동시 입력이 켜져 있는 **탭들** — 탭 바의 ⇶ 표식과 탭 우클릭 메뉴의 ✓ 가 함께
 * 읽는다. `SvelteMap` 의 키를 읽으므로 켜고 끌 때 저절로 다시 계산된다.
 */
export function syncTabs(): Set<string> {
  return new Set(syncPanes.keys());
}

/** 배너 문구용 — 활성 탭의 패널 수 (M) */
export function activePaneCount(): number {
  const tab = activeTab();
  return tab ? countPanes(tab.root) : 0;
}

/**
 * 배너 문구용 — 그중 **지금 살아 있고 포함된** 패널 수 (N).
 * 트리를 훑어 세므로 이미 닫힌 패널 id 가 집합에 남아 있어도 숫자가 부풀지 않는다.
 */
export function syncPaneCount(): number {
  const set = activeSyncSet();
  const tab = activeTab();
  if (!set || !tab) return 0;
  return listPanes(tab.root).filter((p) => set.has(p.id)).length;
}

// ---------------------------------------------------------------------------
// 배치 저장·복원 (docs/log/2026-09-03-workspace-restore.md)
//
// **메인·보조 창이 자기 범위만** 저장하고 복원한다 (각 창의 scope). 저장되는 것은 **구조뿐**이고
// (스크롤백·세션 id·비밀번호는 아니다), 복원된 SSH 타일은 붙지 않은 채 뜬다 — 근거는
// `$lib/tabs` 첫머리에 있다.
// ---------------------------------------------------------------------------

/**
 * 자동 저장 디바운스 (ms). 분할선을 끄는 동안 비율이 초당 수십 번 바뀌므로 그 조작이 끝나고
 * 한 번만 쓰게 한다. 짧게 잡은 것은 "쓰기 직후 강제 종료" 로 잃는 창이 좁아야 하기
 * 때문이다 — 창을 X 로 닫는 정상 경로는 [`flushTabSave`] 가 따로 받는다.
 */

/**
 * 시작 시 자동 재접속(`app.auto_reconnect`)을 시작하기 전에 기다리는 시간 (ms).
 * 복원된 타일들이 마운트되어 연결 레지스트리에 자기 접속 함수를 올릴 틈이다.
 */
const AUTO_RECONNECT_DELAY_MS = 400;

/** 자동 저장은 현재 창의 workspace scope만 쓰며 성공 ACK를 기다린다. */
export function scheduleTabSave(): (() => void) | undefined {
  return scheduleWorkspaceSave();
}

export async function flushTabSave(): Promise<boolean> {
  return flushWorkspaceSave();
}

/**
 * 시작할 때 한 번 — 저장된 배치가 있으면 그것으로, 없으면 지금까지처럼 탭 하나로
 * 시작한다. **`loadSettings` 뒤에** 불러야 한다 (`settings.autoReconnect` 를 읽는다).
 */
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

export async function bootTabs(): Promise<void> {
  await initializeWorkspaceWindow();
  const restored = { tabs: currentWorkspaceTabs(), activeId };

  if (restored.tabs.length > 0) {
    // 안내·자동 재접속은 **연결 대기 타일의 붙기 시도가 끝난 뒤**에 센다(세션 코어 ②-2). 페이지 리로드 뒤의 SSH
    // 타일은 먼저 살아 있는 세션에 붙어 보고 — 붙으면 연결 대기가 아니다(`pane.deferred` 가 지워진다), 못 붙으면 그때
    // 접속 함수를 레지스트리에 올린다. 그래서 ① 한 박자(타일 마운트 — 이 시점엔 아직 마운트 전이라 등록이 없고, 등록이
    // 없는 id 는 계단에서 조용히 건너뛰어진다) ② 붙기 시도의 확정(`whenSettled`)을 기다린 뒤 **그때 센다**.
    void (async () => {
      await new Promise((r) => setTimeout(r, AUTO_RECONNECT_DELAY_MS));
      await whenSettled(deferredSshPaneIds(currentWorkspaceTabs(), activeId));
      const waiting = deferredSshPaneIds(currentWorkspaceTabs(), activeId);
      const notice = restoreNotice(restored.tabs.length, waiting.length, settings.autoReconnect);
      // 설정이 켜져 있으면 사람이 부른 것과 **같은 계단식**으로 자동으로 붙인다.
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

/**
 * 복원 안내의 갈래 — **순수 함수**. 연결을 기다리는 SSH 타일(붙기 시도가 끝난 뒤에도 연결 대기인 것)이 없으면 탭 수만,
 * 있으면 자동 재접속 설정에 따라 "자동으로 붙인다" / "Ctrl+Shift+R 로 재연결하세요". 페이지 리로드 뒤 세션에 다시 붙은
 * 타일은 `waiting` 에 들지 않는다(세션 코어 ②-2).
 */
export function restoreNotice(tabCount: number, waiting: number, autoReconnect: boolean): "tabs" | "auto" | "manual" | null {
  if (tabCount <= 0) return null;
  if (waiting === 0) return "tabs";
  return autoReconnect ? "auto" : "manual";
}

/**
 * `reconnect-all` (기본 `Ctrl+Shift+R`) — 복원된 SSH 타일을 **한꺼번에, 계단식으로** 붙인다.
 *
 * 동시에 열지 않는 이유는 그룹 전체 열기와 같다 (sshd `MaxStartups`). 붙일 것이 없으면 그
 * 사실을 한 줄로 알려 준다 — 키를 눌렀는데 아무 일도 안 일어나면 고장으로 읽힌다.
 */
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

/**
 * 타일 하나를 빼고 마지막 잎이면 시작 타일을 남긴다 — 이동·승격·창 넘기기의 공통 정리다.
 * 세션은 죽이지 않는다. 창 넘기기의 표시(`markHandoff`)는 부르는 쪽이 트리를 빼기 전에 건다.
 */
export function detachPaneLeavingStart(tab: TabSpec, paneId: string): void {
  if (!findPane(tab.root, paneId)) return;
  unzoom(tab); // 남은 타일·시작 타일이 원래 배치로 보이게 한다
  const rest = closePane(tab.root, paneId) ?? leafOf(newStartPane());
  withLayoutAnim(() => {
    tab.root = rest;
  });
  // 넘겨 준 타일이 포커스였으면 남은 트리의 첫 타일로 (닫기와 같은 규칙)
  if (activePane[tab.id] === paneId) activePane[tab.id] = findFirstPane(rest).id;
  // 동시 입력 포함 집합에서도 뺀다 — 남겨 두면 배너 숫자가 실제 대상과 어긋난다
  syncPanes.get(tab.id)?.delete(paneId);
}

// ---------------------------------------------------------------------------
// 원격 창의 집 PC 화면 거울 (원격 웹 R2-B · R3 — `app/mirror.svelte.ts` · `app/mirror-requests.svelte.ts` · `$lib/mirror/*`)
//
// 원격 창의 탭 목록은 **집 PC 주 창의 워크스페이스들을 비춘 것**이다(10-20 — 전부 · 소속을 단 채 · 원격이 보는 워크스페이스로
// `currentWorkspaceTabs` 가 거른다) — 쓰는 길은 [`applyMirrorTabs`] 하나(거울 환원 결과)이고,
// 배치를 바꾸는 조작(새 탭 · 분할 · 타일 열기 · 닫기 · 옮기기 · 이름 바꾸기)은 위 함수들의 첫 줄이 **요청**으로 바꿔 [`remoteLayout`] 에
// 넘긴다(R3) — 집 PC 주 창이 제 함수로 적용하고 결과는 거울로 돌아온다. 요청을 보내는 몸통(대상 id → 집 PC 열쇠 · 닫기 확인 · 거절
// 안내)은 `app/mirror-requests` 가 [`setRemoteLayoutSink`] 로 건다(이 모듈이 그쪽을 부르면 순환이라). 고르는 일(탭 · 포커스 ·
// 최대화)은 원격 창 몫이라 그대로 된다. 저장도 하지 않는다(원격 창은 쓰기 범위를 잡지 않는다).
// ---------------------------------------------------------------------------

/** 마지막 막힘 안내 시각 — 키를 연타해도 안내는 몇 초에 한 번 */
let lockedNoticeAt = 0;
const LOCKED_NOTICE_GAP_MS = 4000;

/** 원격 창의 배치 요청을 받아 보내는 몸통(`app/mirror-requests` 가 건다) */
let layoutSink: ((req: LayoutRequest) => void) | null = null;

/** 원격 창 부팅이 요청 몸통을 건다(R3). */
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

/**
 * **원격 창이면 배치를 바꾸지 않고 요청으로 보낸다**(R3) — 보냈거나 막았으면 `true`. 집 PC 창은 늘 `false`(그대로 적용).
 * 요청 몸통이 아직 없거나 요청으로 옮길 수 없는 조작(`null`)이면 안내 한 줄.
 */
function remoteLayout(req: LayoutRequest | null): boolean {
  if (!isRemote) return false;
  if (req && layoutSink) layoutSink(req);
  else lockedNotice();
  return true;
}

/** 파일 타일 보기 요청의 묶음 시간 — 슬라이더 · `Ctrl+휠` 의 연타는 끝값 하나로(GUI 빈도 상한 · 집 PC 저장을 흔들지 않게) */
const FILE_UI_DEBOUNCE_MS = 250;
const pendingFileUi = new Map<string, { change: { view?: FileView } & FileUiPatch; timer: ReturnType<typeof setTimeout> }>();

/**
 * **원격 창의 파일 타일 보기 변경을 집 PC 배치에도 적게 한다**(2026-11-04) — 원격 창의 트리는 거울 갱신에 통째로 갈리므로(`applyMirrorTabs`) 집 PC 가 들고 있어야 산다.
 * 타일마다 묶어 끝값 하나를 보낸다. 요청 몸통이 없으면 조용히 버린다(안내 없음). 집 PC 창은 아무것도 하지 않는다.
 */
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

/** 요청으로 옮길 수 없는 배치 조작(창 넘기기의 떼기 · 끼우기) — 원격이면 막고 안내. */
function layoutLocked(): boolean {
  return remoteLayout(null);
}

/**
 * 원격이 방금 만든 새 탭 — 아직 거울에 없다. 여는 길 몇은 `openTab(newTab())` 뒤 **같은 틱에** 그 탭에 타일을 놓으므로
 * (`hosts/open` 의 새 탭에 열기), 그 사이의 놓기를 이 탭에 모았다가 틱 끝에 요청 하나(`newTab` + 그 타일)로 보낸다.
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

/** 원격의 놓기 — 방금 만든 새 탭이면 그 탭에 모으고(시작 타일 자리를 대신), 아니면 요청(`make` 가 `null` 이면 안내). */
function remotePlace(tab: TabSpec, node: PaneNode, make: () => LayoutRequest | null): void {
  if (pendingNewTabs.has(tab)) {
    if (isLoneStart(tab)) tab.root = node;
    else lockedNotice();
    return;
  }
  remoteLayout(make());
}

/**
 * 원격의 새 탭이 설 워크스페이스 — 탭에 소속이 있으면 그것, 없으면 원격 창이 지금 보는 것(집 PC 가 보는 것과 다를 수 있다 — 집 PC 는
 * 그 워크스페이스에 탭을 넣되 화면을 옮기지 않는다 · `app/mirror-requests`).
 */
/**
 * (오케스트레이션 탭) **원격 창에서 오케스트레이션 탭을 청한다** — 원격 창에 그 탭(앨범 · 홈)이 없을 때 집 PC 가 같은 여는 길
 * (`openAlbumTab` · `openOrchHome`)을 돈다(배치 요청 `openOrchTab` — 새 Tauri 명령 아님). 원격 창이 아니거나 요청 길이 없으면 `false`.
 */
export function requestOrchTab(runId: string | null): boolean {
  if (!isRemote || !layoutSink) return false;
  layoutSink({ op: "openOrchTab", ...(runId ? { runId } : {}), ...remoteNewTabWorkspace() });
  return true;
}

function remoteNewTabWorkspace(own?: string): { workspace?: string } {
  const ws = own ?? currentWorkspaceId();
  return ws ? { workspace: ws } : {};
}

/** 원격 창 — 워크스페이스마다 마지막으로 고른 탭(워크스페이스를 바꿨다 돌아오면 그 탭으로 · 거울 환원의 `activeOf`) */
const remoteActiveByWs: Record<string, string> = {};

/** 원격 창의 지금 고름 — 거울 환원이 "집 PC 가 바꾸지 않았으면 원격의 고름을 둔다" 에 쓴다 */
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
 * **거울 환원 결과를 이 창의 탭으로**(원격 창만 — `app/mirror.svelte.ts`). 탭 목록을 통째로 갈아 끼우되 같은 타일은 같은 id 라
 * `PaneHost` 의 상자(터미널 시청자)가 다시 붙지 않는다. 사라진 탭의 활동 · 포커스 기록도 거둔다.
 */
export function applyMirrorTabs(next: TabSpec[], nextActive: string | null, focus: Record<string, string>): void {
  if (!isRemote) return;
  tabs = next;
  const alive = new Set(next.map((tab) => tab.id));
  for (const id of Object.keys(activePane)) if (!alive.has(id)) delete activePane[id];
  for (const id of Object.keys(hasActivity)) if (!alive.has(id)) delete hasActivity[id];
  for (const [ws, id] of Object.entries(remoteActiveByWs)) if (!alive.has(id)) delete remoteActiveByWs[ws];
  for (const [tabId, paneId] of Object.entries(focus)) activePane[tabId] = paneId;
  if (nextActive === null) activeId = null;
  else if (nextActive !== activeId) selectTab(nextActive);
}
