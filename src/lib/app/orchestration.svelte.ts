/**
 * **오케스트레이션 — 창의 여는 길**(2026-10-15 · 2b, docs/log/2026-10-14-orchestration-design.md D · E-1 · 3차 6단계 —
 * docs/log/2026-10-16-orchestration-headless-design.md 3-5 · 6-2).
 *
 * 여기 사는 것: 팔레트 · 상태바 · 프로젝트 메뉴의 **"이 스튜디오로 새 앨범"(맡긴 저장소 — ④ 부터 홈을 그 스튜디오로 · 옛 "이 저장소에서 AI 타일 열기") / "이 저장소 맡기기…"(아니면)** 한 갈래 ·
 * **오케스트레이션 탭 여는 길**(홈 · 앨범 · 프로듀서 열기 · [오케스트레이션으로 이어 가기] — 2026-10-29 · 노트
 * docs/log/2026-10-29-orchestration-player-tab.md D1 · D2 · D3 · 0-3 Q1=B — 예전 "지금 탭 오른쪽 45% 보드 타일" 은 걷었다) ·
 * 그 Run 저장소의 맡기기 화면 · 앱 시작 때 orphaned Run 알림 한 번.
 *
 * F2의 새 앨범은 사람이 초안을 제출한 `producer_album_start`로 열린다. 초안에는 서버 채팅이 없고, 성공 답의 채팅을 왼쪽 잎에 단다.
 * 타일의 이어 가기는 `producer_fork_probe` 뒤 저장소가 잠긴 초안으로 들어간다. 옛 맡기기 편집 손잡이는 R1 정리까지 남는다.
 * 프로듀서가 끝나 멈춘 앨범은 라이브러리의 [새 프로듀서로 이어받기] 가 새 프로듀서 채팅을 세워 `adopt_run` 으로 잇는다.
 *
 * 불변식:
 * - **MCP 토큰은 여기 없다** — 프로듀서 채팅의 토큰은 세션 서버가 쥐고, 조정자 묶음도 서버가 `start_run` · `adopt_run` 잠금 안에서 세운다.
 * - 키바인딩은 없다(id 결정은 사용자 몫) — 여는 길은 명령 팔레트 줄 둘 · 상태바 칸 하나 · 프로젝트 독 우클릭이다. 팔레트 · 상태바 id
 *   `orchestration-start` 는 그대로 두고(사용자의 상태바 순서 저장값) 이름 · 동작만 바뀐다.
 * - Run 상태의 주인은 세션 서버다. 이 모듈은 보드를 다시 그리라는 신호만 받는다(`orchestration-changed` — 보드가 듣는다).
 */

import { newProducerPane, newRunPane, newTab, type OrchMark, type PaneSpec, type ProducerSpec, type TabSpec } from "$lib/session";
import {
  activeTab,
  currentWorkspaceTabs,
  findPaneAnywhere,
  focusTile,
  openTab,
  openTabInWorkspace,
  pickTab,
  requestOrchTab,
  residentWindowTabs,
  tabOfPane,
} from "$lib/app/tabs.svelte.js";
import { startedAlbumPath,
  albumRunId,
  findAlbumTab,
  findHomeTab,
  isOrchTab,
  newProducerChatId,
  orchRoot,
  orchShape,
  orchPath,
  orchNavigationTab,
  parentOrchPath,
  orchEscapeAllowed,
  orchEscapeTargetBlocked,
  keepAlbumOrigin,
  playerPaneOf,
  producerLeafOf,
  tabOfProducerChat,
} from "$lib/orchestration/orch-tab";
import { producerErrorText, reasonIs, setProducerConvHook } from "$lib/app/producer-chat.svelte.js";
import { sideChatForkSource } from "$lib/side-chat";
import type { SideChatCli } from "$lib/side-chat-api";
import { agentLinkOf } from "$lib/app/agent-sessions.svelte.js";
import { projects } from "$lib/app/project-list.svelte.js";
import { isRemote, type Project } from "$lib/projects";
import { t } from "$lib/i18n/i18n.svelte.js";
import { showNotice } from "$lib/app/notice";
import { runDetail, runSnapshot } from "$lib/orchestration/api";
import { interruptedAlbums } from "$lib/orchestration/model/library";
import { studioLabel } from "$lib/app/studio-projects.svelte.js";
import type { OrchNotice } from "$lib/orchestration/model/types";
import { invoke, isRemote as isRemoteWindow } from "../ipc";
import { openDiff } from "$lib/app/diff-view.svelte.js";
import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";
import { runSummaryOf } from "$lib/app/orch-pulse.svelte.js";
import { albumScreens, orchScreenPath } from "./album-screen.svelte.js";
import type { AlbumFork, AlbumDraft, AlbumStartResult } from "$lib/orchestration/album-draft";
import { fillProducer, rememberAlbumFirst, type ProducerTarget } from "./producer-chat.svelte.js";
import { producerChatStatus } from "$lib/orchestration/producer-api";
import { albumEnded } from "$lib/orchestration/model/producer";
import { lastProducerOf, rememberProducer } from "./producer-record";

/** 이 페이지에서 이미 한 번 맞춘 (탭, 앨범) — 끝난 앨범의 채팅 잎은 처음 열 때만 걷는다(아래 `reattachAlbumProducer`) */
const albumSettled = new Set<string>();

/**
 * 앨범으로 돌아오면 서버가 보존한 같은 채팅을 찾는다. 새 채팅이나 새 턴을 만들지 않는다.
 *
 * **끝난 앨범**(서버 이어받기 판정 `adoptable.why === "ended"` — 중단 중 · 중단 · 완료)은 붙이지 않는다 — 플레이어 전체 폭, 대화 기록은 사람이
 * [프로듀서 대화 기록]으로 연다. 이 페이지에서 그 탭이 그 앨범을 처음 볼 때(복원 · F5) 남아 있던 채팅 잎도 걷는다. 앨범을 보고 있는 동안 끝나면
 * 걷지 않는다(프로듀서의 마무리 말을 읽는 중일 수 있다) — 다른 경로로 갔다 오면 `navigateOrchTab` 이 잎을 놓고 여기서 다시 세우지 않는다.
 */
export async function reattachAlbumProducer(tabId: string, runId: string): Promise<void> {
  const here = () => {
    const tab = residentWindowTabs().find((t) => t.id === tabId);
    return tab && orchScreenPath(tab).runId === runId ? tab : null;
  };
  const tab = here();
  const key = `${tabId}\u0000${runId}`;
  const first = !albumSettled.has(key);
  albumSettled.add(key);
  const placed = !isRemoteWindow && !!tab && !!producerLeafOf(tab);
  if (!tab || (placed && !first) || (isRemoteWindow && albumScreens[tabId]?.producer)) return;
  try {
    const summary = (await runSnapshot()).find((r) => r.runId === runId);
    if (!summary || !here()) return;
    if (albumEnded(summary)) {
      if (placed) closeProducerLog(tabId);
      return;
    }
    if (placed) return;
    // 지금 조정자 또는 가장 최근 이어받기 자리 하나만 본다. 앞 세대의 살아 있는 채팅으로 되돌아가지 않는다.
    const chatId = summary.coordinatorChat ?? summary.producers?.[summary.producers.length - 1];
    const chats = chatId ? [chatId] : [];
    for (const chat of chats) {
      const status = await producerChatStatus(chat);
      if (!here()) return;
      if (!status.open) continue;
      const s = status.snapshot;
      const target = { chat, cli: s.cli, model: s.model, effort: s.effort ?? "", studio: s.repo, conv: s.conversationId, adoptRun: runId };
      if (isRemoteWindow) albumScreens[tabId] = { ...albumScreens[tabId], producer: target };
      else {
        const leaf = placeProducerLeaf(tabId, target, chat);
        if (leaf?.producer) leaf.producer.conv = s.conversationId ?? undefined;
      }
      return;
    }
  } catch (e) { if (here()) showNotice(producerErrorText(e)); }
}

/** 고를 수 있는 프로젝트 — 로컬만(원격 저장소의 작업자는 범위 밖) */
export function localProjects(): Project[] {
  return projects().filter((p) => !isRemote(p));
}

// ---------------------------------------------------------------------------
// "이 저장소에서 AI 타일 열기" / "이 저장소 맡기기…"(3차 6단계 — 설계 3-5 · Q2)
// ---------------------------------------------------------------------------

/** 겨냥하는 로컬 프로젝트 — 준 id(프로젝트 메뉴) → 지금 탭의 프로젝트(로컬일 때). 없으면 `null`. */
function targetProject(projectId?: string): Project | null {
  const locals = localProjects();
  const tabProject = activeTab()?.projectId;
  return locals.find((p) => p.id === projectId) ?? locals.find((p) => p.id === tabProject) ?? null;
}

/** 팔레트·상태바·프로젝트 메뉴의 새 앨범 진입. 프로젝트가 없으면 초안에서 저장소를 고른다. */
export async function startOrchestrationHere(projectId?: string): Promise<void> {
  const p = targetProject(projectId);
  openNewAlbum(p?.path, undefined, !!p);
}

// ---------------------------------------------------------------------------
// 오케스트레이션 탭 여는 길(2026-10-29 — 노트 D1 · D2 · D3 · 0-3 Q1=B)
// ---------------------------------------------------------------------------

/**
 * 플레이어의 주소(`PaneSpec.run` — Run id · 머리줄 이름의 화면용 사본)를 명세에 적는다. `null` 이면 지운다(Run 목록 · 홈으로).
 * 명세는 탭 상태의 것이라 보드(`RunBoard` · `board/board-loader`)가 프롭으로 받은 객체를 고치지 않고 여기서 id 로 찾아 고친다
 * (`diff-view` 의 `noteDiff` · `agent-sessions` 의 `persistLink` 와 같은 길 — 프롭을 고치면 Svelte 개발 경고
 * `ownership_invalid_mutation`). 객체는 통째로 새로 단다(분할 복제가 같은 객체를 나눠 들지 않게). 같은 값이면 손대지 않는다.
 * 그 타일이 이 창에 없으면(닫혔다 · 떠났다) 아무것도 하지 않는다.
 *
 * 플레이어가 오케스트레이션 탭에 있으면 **탭의 표지(`orch.runId`)와 고정 제목도 같이** 맞춘다 — 탭의 앨범은 플레이어가 보는 앨범이다
 * (목록에서 다른 앨범을 고르면 탭도 그 앨범의 탭이 된다). 제목 = 앨범 이름 · 홈 = "오케스트레이션" · 준비 중 = "새 앨범".
 */
export function noteRunBoard(paneId: string, run: { runId: string; name?: string } | null): void {
  if (isRemoteWindow) return;
  const pane = findPaneAnywhere(paneId);
  if (!pane || pane.kind !== "run") return;
  if (run === null) {
    if (pane.run) delete pane.run;
  } else if (pane.run?.runId !== run.runId || pane.run?.name !== run.name) {
    pane.run = run.name === undefined ? { runId: run.runId } : { runId: run.runId, name: run.name };
  }
  const tab = tabOfPane(paneId);
  if (tab && isOrchTab(tab)) markAlbum(tab, run?.runId ?? null, run?.name);
}

/** 오케스트레이션 탭의 표지 · 고정 제목을 그 앨범으로(같은 값이면 손대지 않는다) */
function markAlbum(tab: TabSpec, runId: string | null, name?: string): void {
  if (albumRunId(tab) !== runId) tab.orch = runId === null ? { view: "library" } : { view: "album", runId };
  const title = runId !== null ? name?.trim() || t("orch.tab.album") : orchShape(tab) === "preparing" ? t("orch.tab.preparing") : t("orch.tab.home");
  if (tab.pinnedTitle !== title) {
    tab.pinnedTitle = title;
    tab.title = title;
  }
}

/** 아직 안 연 프로듀서 채팅 잎(홈의 "새 앨범" 칸 — 2단계 단계 3). 고른 값은 칸이 보낼 때 적는다 */
export function newProducerLeaf(p: Partial<ProducerSpec> = {}): PaneSpec {
  return newProducerPane({ chatId: newProducerChatId(), cli: "", model: "", effort: "", studio: "", ...p });
}

/**
 * 새 오케스트레이션 탭. 라이브러리는 플레이어 한 잎, 명시적인 초안만 왼쪽 프로듀서 잎을 세운다.
 */
function newOrchTab(runId: string | null, producer: PaneSpec | null = null): TabSpec {
  const tab = newTab();
  const player = newRunPane(runId ?? undefined);
  tab.orch = runId === null ? { view: producer ? "new" : "library" } : { view: "album", runId };
  tab.root = orchRoot(producer, player);
  const title = runId !== null ? t("orch.tab.album") : producer ? t("orch.tab.preparing") : t("orch.tab.home");
  tab.title = title;
  tab.pinnedTitle = title;
  return tab;
}

/** 원격 창 — 탭을 만들지 않는다(집 PC 창이 쥔다 · 1단계는 배치 요청을 두지 않았다). 있는 탭으로 가거나 한 줄 알린다. */
function remoteGo(tab: TabSpec | null, runId: string | null = null): void {
  if (tab) pickTab(tab.id);
  else if (!requestOrchTab(runId)) showNotice(t("orch.tab.remoteOpen"));
}

/**
 * 지금 워크스페이스의 오케스트레이션 탭을 라이브러리로 옮긴다. 없으면 하나 만든다.
 */
export function openOrchHome(): void {
  navigationSeq += 1;
  const tabs = currentWorkspaceTabs();
  const found = orchNavigationTab(tabs, activeTab()?.id ?? null);
  if (isRemoteWindow) {
    if (found) { navigateOrchTab(found.id, { view: "library" }); pickTab(found.id); }
    else remoteGo(findHomeTab(tabs));
    return;
  }
  if (found) {
    navigateOrchTab(found.id, { view: "library" });
    pickTab(found.id);
    return;
  }
  openTab(newOrchTab(null));
}

/** 스튜디오 화면으로(라이브러리 카드) — 부르는 화면이 오케스트레이션 탭 안이라 탭은 늘 있다. */
export function openStudio(repo: string): void {
  navigationSeq += 1;
  const found = orchNavigationTab(currentWorkspaceTabs(), activeTab()?.id ?? null);
  if (!found) return openOrchHome();
  navigateOrchTab(found.id, { view: "studio", repo });
  pickTab(found.id);
}

/**
 * 앨범을 현재 워크스페이스의 탭 안에서 연다. 현재 오케스트레이션 탭 우선, 없으면 첫 탭, 하나도 없으면 생성.
 * 같은 앨범이 다른 탭에 있어도 현재 경로에서 연다. 복제는 openOrchPathInNewTab을 쓴다.
 * `fromRepo` = 스튜디오 화면에서 들어왔다(← · Esc 가 그리로 돌아간다). 안 주면 바로 가는 길 — 이미 그 앨범을 보던 탭의 출발 스튜디오만 잇는다.
 */
export function openAlbumTab(runId?: string | null, fromRepo?: string | null): void {
  navigationSeq += 1;
  const id = runId?.trim();
  if (!id) return openOrchHome();
  const tabs = currentWorkspaceTabs();
  const found = orchNavigationTab(tabs, activeTab()?.id ?? null);
  const path = (tab: TabSpec): OrchMark => ({ view: "album", runId: id, ...(fromRepo ? { fromRepo } : keepAlbumOrigin(orchScreenPath(tab), id)) });
  if (isRemoteWindow) {
    if (found) { navigateOrchTab(found.id, path(found)); pickTab(found.id); }
    else remoteGo(findAlbumTab(tabs, id), id);
    return;
  }
  if (found) {
    navigateOrchTab(found.id, path(found));
    pickTab(found.id);
    const player = playerPaneOf(found);
    if (player) focusTile(found.id, player.id);
    return;
  }
  openTab(newOrchTab(id));
}

// 늦게 도착한 알림 조회나 원격 거울이 사람이 뒤에 고른 경로를 덮지 않게 한다.
let navigationSeq = 0;

/** 트랙 진입도 현재 워크스페이스의 오케스트레이션 탭을 쓴다. 원격 거울에는 쓰지 않는다. */
export async function openTrackTab(runId: string, taskId: string, attemptId?: string | null): Promise<void> {
  const seq = ++navigationSeq;
  const path: OrchMark = { view: "track", runId, taskId, ...(attemptId ? { attemptId } : {}) };
  let tab = orchNavigationTab(currentWorkspaceTabs(), activeTab()?.id ?? null);
  if (!tab && !isRemoteWindow) {
    const created = newOrchTab(runId);
    created.orch = path;
    openTab(created);
    return;
  }
  if (!tab) {
    // 배치 요청은 기존 runId 계약만 보낸다. 거울이 오면 이 창의 보기 경로를 이어 붙인다.
    const workspace = currentWorkspaceId();
    const active = activeTab()?.id ?? null;
    if (!requestOrchTab(runId)) { showNotice(t("orch.tab.remoteOpen")); return; }
    for (let n = 0; n < 50 && !tab; n += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (seq !== navigationSeq || currentWorkspaceId() !== workspace) return;
      tab = findAlbumTab(currentWorkspaceTabs(), runId);
      const nowActive = activeTab()?.id ?? null;
      if (nowActive !== active && nowActive !== tab?.id) return;
    }
    if (!tab) return;
  }
  navigateOrchTab(tab.id, { ...path, ...keepAlbumOrigin(orchScreenPath(tab), runId) });
  pickTab(tab.id);
  if (!isRemoteWindow) {
    const player = playerPaneOf(tab);
    if (player) focusTile(tab.id, player.id);
  }
}

/** 사건의 시도가 아직 트랙에 속하면 그 시도로 연다. 앨범 사건·없어진 시도·조회 실패는 앨범으로 간다. */
export async function openOrchNotice(notice: Pick<OrchNotice, "runId" | "attemptId">): Promise<void> {
  const seq = ++navigationSeq;
  if (notice.attemptId) {
    try {
      const detail = await runDetail(notice.runId);
      if (seq !== navigationSeq) return;
      const attempt = detail.attempts?.find((a) => a.id === notice.attemptId);
      if (attempt && detail.tasks.some((task) => task.id === attempt.taskId)) {
        await openTrackTab(notice.runId, attempt.taskId, attempt.id);
        return;
      }
    } catch {
      if (seq !== navigationSeq) return;
    }
  }
  openAlbumTab(notice.runId);
}

/** 경로를 명세에 한 번에 적는다. F2는 new 경로의 오른쪽 초안을 이어받는다. */
export function navigateOrchTab(tabId: string, path: OrchMark): void {
  navigationSeq += 1;
  const next = orchPath({ orch: path });
  // 원격 배치 계약은 runId만 받는다. 거울 명세를 직접 고치거나 모르는 칸을 보내지 않는다.
  if (isRemoteWindow) {
    const current = albumScreens[tabId];
    albumScreens[tabId] = { ...(next.view === "new" || (next.runId && next.runId === current?.path?.runId) ? current : {}), path: next };
    return;
  }
  const tab = residentWindowTabs().find((x) => x.id === tabId);
  if (!tab?.orch) return;
  const player = playerPaneOf(tab);
  if (!player) return;
  const previous = albumRunId(tab);
  const producer = producerLeafOf(tab);
  if (next.view !== "new") delete albumScreens[tabId];
  tab.orch = next;
  if (next.runId) player.run = { runId: next.runId, ...(previous === next.runId && player.run?.name ? { name: player.run.name } : {}) };
  else delete player.run;
  // 라이브러리·스튜디오·아티스트는 한 잎. 기존 채팅은 경로를 떠났다는 이유로 끝내지 않는다.
  tab.root = orchRoot(next.runId && previous === next.runId ? producer : null, player);
  const title = next.view === "artists" ? t("orch.nav.artists") : next.view === "new" ? t("orch.tab.preparing") : next.view === "studio" && next.repo ? studioLabel(next.repo) : next.runId ? player.run?.name || t("orch.tab.album") : t("orch.home.library");
  tab.title = title;
  tab.pinnedTitle = title;
}

/** 초안은 창 메모리에만 둔다. fork 저장소는 서버 probe의 답으로 고정한다. */
export function openNewAlbum(repo = "", fork?: AlbumFork, repoLocked = false, fromRepo?: string): void {
  navigationSeq += 1;
  let tab = orchNavigationTab(currentWorkspaceTabs(), activeTab()?.id ?? null);
  if (!tab && !isRemoteWindow) { openOrchHome(); tab = activeTab(); }
  if (!tab) { remoteGo(null); return; }
  albumScreens[tab.id] = { repo, fork, repoLocked, draftId: crypto.randomUUID() };
  navigateOrchTab(tab.id, { view: "new", ...(fromRepo ? { fromRepo } : {}) });
  pickTab(tab.id);
}

/** 확정된 시작 답의 채팅 주소를 그대로 왼쪽에 단다. 앨범 시작을 다시 호출하지 않는다. */
export function finishAlbumDraft(tabId: string, draft: AlbumDraft, result: AlbumStartResult, clientId: string, fork?: AlbumFork): void {
  const target = { chat: result.chat, cli: draft.cli, model: draft.model, effort: draft.effort, studio: draft.repo, conv: null, adoptRun: result.runId };
  rememberAlbumFirst(target, clientId, draft.text, result.sent);
  if (!result.sent) { fillProducer(result.chat, draft.text); showNotice(t("orch.new.notSent")); }
  const draftTab = currentWorkspaceTabs().find((t) => t.id === tabId);
  const path = startedAlbumPath(draftTab ? orchScreenPath(draftTab) : { view: "library" }, result.runId, draft.repo);
  if (isRemoteWindow) {
    albumScreens[tabId] = { path, producer: target };
    return;
  }
  navigateOrchTab(tabId, path);
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const player = tab ? playerPaneOf(tab) : null;
  if (!tab || !player) return;
  const leaf = newProducerLeaf({ chatId: result.chat, cli: draft.cli, model: draft.model, effort: draft.effort, studio: draft.repo, opened: true, ...(fork ? { forkFrom: fork } : {}) });
  tab.root = orchRoot(leaf, player);
  focusTile(tab.id, leaf.id);
}

/** 앨범 머리의 명시적인 복제 — 같은 앨범 탭도 허용한다. */
export function openOrchPathInNewTab(path: OrchMark): void {
  const next = orchPath({ orch: path });
  if (isRemoteWindow) { showNotice(t("orch.nav.remote")); return; }
  const tab = newOrchTab(next.runId ?? null);
  tab.orch = next;
  openTab(tab);
}

export function openArtists(): void {
  if (isRemoteWindow) { showNotice(t("orch.nav.remote")); return; }
  openOrchHome();
  const tab = activeTab();
  if (tab?.orch) navigateOrchTab(tab.id, { view: "artists" });
}

/** 전역 Esc 사슬의 맨 끝에서만 호출한다(모달·메뉴가 먼저 처리). */
export function handleOrchEscape(e: KeyboardEvent): boolean {
  const tab = activeTab();
  if (!tab?.orch || orchScreenPath(tab).view === "library" || !orchEscapeAllowed(e, orchEscapeTargetBlocked(e.target))) return false;
  e.preventDefault();
  // 끝난 앨범의 대화 기록 잎 안이면 먼저 그 잎을 걷는다(덮개처럼 연 읽기 화면 — 경로는 그대로). 진행 중 앨범의 채팅은 경로를 올린다(예전 그대로).
  const leaf = isRemoteWindow ? null : producerLeafOf(tab);
  const inLeaf = e.target instanceof Element &&
    (!!e.target.closest("[data-producer-leaf]") || (!!leaf && !!e.target.closest(`[data-pane="${CSS.escape(leaf.id)}"]`)));
  if (inLeaf && (leaf || albumScreens[tab.id]?.producer) && showsEndedAlbum(tab)) {
    closeProducerLog(tab.id);
    return true;
  }
  navigateOrchTab(tab.id, parentOrchPath(orchScreenPath(tab)));
  return true;
}

/**
 * (집 PC 주 창 — 원격 배치 요청 `openOrchTab`) 원격 창이 청한 오케스트레이션 탭을 연다 — 같은 여는 길(`openAlbumTab` · `openOrchHome`).
 * 원격이 다른 워크스페이스를 보고 있으면 그 워크스페이스에 **넣기만** 한다(이미 있으면 그대로 — 화면을 옮기지 않는다 · 새 탭 요청과 같은 규칙).
 * 그 워크스페이스가 없거나 아직 열리지 않았으면 거절 낱말(`missing` · `cold`).
 */
export function openOrchTabForRemote(runId: string | null, workspace: string | null): "ok" | "cold" | "missing" {
  if (workspace && workspace !== currentWorkspaceId()) {
    const there = residentWindowTabs().filter((x) => x.workspaceId === workspace);
    if (runId ? findAlbumTab(there, runId) : findHomeTab(there)) return "ok";
    if (openTabInWorkspace(workspace, newOrchTab(runId), null)) return "ok";
    return workspaceList().some((w) => w.id === workspace) ? "cold" : "missing";
  }
  if (runId) openAlbumTab(runId);
  else openOrchHome();
  return "ok";
}

/**
 * **프로듀서 채팅 잎의 주소를 고친다**(2단계 단계 3) — 칸이 보낼 때 고른 값 · `opened`, 턴이 선 대화 id. 잎이 받은 프롭을 고치지 않고 id 로 찾아
 * 객체째 새로 단다([`noteRunBoard`] 와 같은 까닭). 오케스트레이션 탭이면 고정 제목도 맞춘다(홈 → "새 앨범").
 */
export function noteProducerSpec(paneId: string, patch: Partial<ProducerSpec>): void {
  const pane = findPaneAnywhere(paneId);
  if (!pane || pane.kind !== "producer" || !pane.producer) return;
  const next: ProducerSpec = { ...pane.producer, ...patch };
  if (JSON.stringify(next) !== JSON.stringify(pane.producer)) pane.producer = next;
  const tab = tabOfPane(paneId);
  if (tab && isOrchTab(tab)) markAlbum(tab, albumRunId(tab), playerPaneOf(tab)?.run?.name);
}

// 턴이 선 대화 id — 그 채팅의 잎에 적는다(서버 표를 잃었을 때 resume 의 열쇠 · 저장된다)
setProducerConvHook((chat, conv) => {
  const tab = tabOfProducerChat(residentWindowTabs(), chat);
  const leaf = tab ? producerLeafOf(tab) : null;
  if (leaf) noteProducerSpec(leaf.id, { conv });
});

/**
 * **앨범 탭에 새 프로듀서 채팅 잎을 세운다**(2단계 단계 3 — [새 프로듀서로 이어받기] · [프로듀서 다시 붙이기] · 막대의 [프로듀서 열기]) — 프로듀서가
 * 없는 오케스트레이션 탭 왼쪽에 연 채팅 잎(`opened`)을 세운다. 채팅을 서버에 여는 것(띄우지 않는다)과 입력 칸 채우기는 부르는 쪽(`app/orch-start`).
 * 세웠으면 그 잎.
 */
export function placeProducerLeaf(tabId: string, p: Pick<ProducerSpec, "cli" | "model" | "effort" | "studio">, chatId?: string): PaneSpec | null {
  if (isRemoteWindow) return null;
  const tab = residentWindowTabs().find((x) => x.id === tabId);
  if (!tab || !isOrchTab(tab) || producerLeafOf(tab)) return null;
  const player = playerPaneOf(tab);
  if (!player) return null;
  const leaf = newProducerLeaf({ ...p, ...(chatId ? { chatId } : {}), opened: true });
  // 고정 앨범 배치는 한 번에 붙인다. 플레이어가 먼저 비켜나고 채팅은 투명하게 대기하지 않는다.
  tab.root = orchRoot(leaf, player);
  markAlbum(tab, albumRunId(tab), player.run?.name);
  focusTile(tab.id, leaf.id);
  return leaf;
}

// ---------------------------------------------------------------------------
// 끝난 앨범의 프로듀서 대화 기록(10-31 — 목업 V3AlbumDone · 채팅은 진행 중 앨범과 같은 왼쪽 자리)
// ---------------------------------------------------------------------------

/** 잎 주소 → 기록용 묶음(대화 id 가 있을 때만) */
function logOfSpec(p: ProducerSpec | undefined, runId: string): ProducerTarget | null {
  if (!p?.opened || !p.conv) return null;
  return { chat: p.chatId, cli: p.cli === "codex" ? "codex" : "claude", model: p.model, effort: p.effort, studio: p.studio, conv: p.conv, adoptRun: runId };
}

/**
 * 그 앨범의 마지막 프로듀서 대화 — 이 창의 탭이 든 잎(대화 id 가 적혀 있다) → 이 브라우저의 기록(`app/producer-record`). 채팅이 그 앨범의
 * 귀속 목록(`producers`)에 없으면 버린다(목록을 아직 못 읽었으면 믿는다). 없으면 `null` — 카드 · 단추가 서지 않는다.
 */
export function albumProducerLog(runId: string | null | undefined, studio = ""): ProducerTarget | null {
  if (!runId) return null;
  const owned = (chat: string) => runSummaryOf(runId)?.producers?.includes(chat) ?? true;
  for (const tab of residentWindowTabs()) {
    if (albumRunId(tab) !== runId) continue;
    const log = logOfSpec(producerLeafOf(tab)?.producer, runId);
    if (log && owned(log.chat)) return log;
  }
  const last = lastProducerOf(runId);
  if (!last?.chat || !last.conv || !owned(last.chat)) return null;
  return { chat: last.chat, cli: last.cli === "codex" ? "codex" : "claude", model: last.model, effort: last.effort, studio, conv: last.conv, adoptRun: runId };
}

/**
 * **[프로듀서 대화 기록]** — 끝난 앨범 탭 왼쪽에 그 프로듀서 채팅 잎을 진행 중 앨범과 같은 폭으로 세운다(읽기만). 잎은 구독만 건다 — 서버 표에
 * 없으면 `producer_chat_status` 로 끝난 이유를 그린다. `producer_chat_open`(resume · adopt)은 부르지 않는다(새 채팅 · 새 프로세스 없음).
 * 이미 잎이 있으면 그리로 포커스. 세웠으면 참.
 */
export function openProducerLog(tabId: string, runId: string, studio = ""): boolean {
  const log = albumProducerLog(runId, studio);
  if (!log) {
    showNotice(t("orch.album.log.none"));
    return false;
  }
  if (isRemoteWindow) {
    albumScreens[tabId] = { ...albumScreens[tabId], producer: log };
    return true;
  }
  const tab = residentWindowTabs().find((x) => x.id === tabId);
  const have = tab ? producerLeafOf(tab) : null;
  if (tab && have) {
    focusTile(tab.id, have.id);
    return true;
  }
  const leaf = placeProducerLeaf(tabId, { cli: log.cli, model: log.model, effort: log.effort, studio: log.studio }, log.chat);
  if (leaf?.producer && log.conv) leaf.producer.conv = log.conv;
  return !!leaf;
}

/** 대화 기록 잎을 걷는다(✕ · Esc · 끝난 앨범을 다시 열 때) — 채팅을 닫지 않는다(구독만 풀린다). 걷기 전에 그 대화를 기록해 둔다. */
export function closeProducerLog(tabId: string): void {
  if (isRemoteWindow) {
    const s = albumScreens[tabId];
    if (s?.producer) albumScreens[tabId] = { ...s, producer: undefined };
    return;
  }
  const tab = residentWindowTabs().find((x) => x.id === tabId);
  const player = tab ? playerPaneOf(tab) : null;
  const leaf = tab ? producerLeafOf(tab) : null;
  if (!tab || !player || !leaf) return;
  const runId = albumRunId(tab);
  const p = leaf.producer;
  if (runId && p?.opened) rememberProducer(runId, { cli: p.cli, model: p.model, effort: p.effort, chat: p.chatId, ...(p.conv ? { conv: p.conv } : {}) });
  tab.root = orchRoot(null, player);
  focusTile(tab.id, player.id);
}

/** 그 탭이 끝난 앨범을 보고 있나(목록 요약의 서버 판정) */
function showsEndedAlbum(tab: TabSpec): boolean {
  return albumEnded(runSummaryOf(albumRunId(tab)));
}

/** 그 타일에서 갈라 올 원본(로컬 · 대화 연결을 안다 · claude | codex — 사이드 채팅의 순수 판정과 같다 · 주 창이 아니어도 된다) */
export function orchForkSource(pane: PaneSpec): { agent: SideChatCli; conv: string } | null {
  return sideChatForkSource(pane.kind, true, agentLinkOf(pane.id));
}

/** [오케스트레이션으로 이어 가기]를 세울 타일인가 — 원격이 아닌 창의 로컬 AI 타일 · 그 대화를 안다 · 오케스트레이션 탭 밖(메뉴 줄과 누른 뒤가 같은 판정) */


/** 타일 메뉴의 이어 가기: 서버가 원본 대화의 저장소를 확인한 뒤, 저장소·CLI를 고정한 새 초안으로 간다. 제출 전에는 채팅을 열지 않는다. */
export async function forkIntoOrchestration(paneId: string): Promise<void> {
  if (isRemoteWindow) return;
  const pane = findPaneAnywhere(paneId);
  const src = pane ? orchForkSource(pane) : null;
  if (!pane || !src) {
    showNotice(t("orch.fork.unknown"));
    return;
  }
  try {
    const { repo } = await invoke<{ repo: string }>("producer_fork_probe", { agent: src.agent, conv: src.conv });
    openNewAlbum(repo, src);
  } catch (e) {
    showNotice(t(reasonIs(e, "not-a-repo") ? "orch.new.forkNotRepo" : "orch.fork.failed", { e: producerErrorText(e) }));
    return;
  }
}

/**
 * [diff 보기](보드 — 4단계) — 보고의 `기준 커밋 … 보고 커밋` 을 기존 diff 타일(`range` 범위)로 연다. diff 타일은 프로젝트에 묶이므로
 * Run 저장소와 같은 자리의 로컬 프로젝트를 찾는다(없으면 안내 한 줄).
 */
export async function openReportDiff(
  repo: string,
  at: { base: string; tip: string; branch?: string | null; worktree?: string | null },
): Promise<boolean> {
  const p = await projectAtRepo(repo);
  if (!p) {
    showNotice(t("orch.report.diff.noProject"));
    return false;
  }
  openDiff(p, {
    scope: "range",
    base: at.base,
    tip: at.tip,
    ...(at.branch ? { branch: at.branch } : {}),
    ...(at.worktree ? { worktreePath: at.worktree } : {}),
  });
  return true;
}

/**
 * [diff 보기](작업자 상세 — 오케스트레이션 탭 ③) — 보고 전 아티스트의 worktree 에서 **아직 커밋하지 않은 것**을 기존 diff 타일(`wip` 범위)로
 * 연다. 프로젝트 찾기는 [`openReportDiff`] 와 같다(없으면 안내 한 줄 · 오케스트레이션 탭이면 D11 대로 새 탭).
 */
export async function openWorktreeDiff(repo: string, at: { worktree: string; branch?: string | null }): Promise<boolean> {
  const p = await projectAtRepo(repo);
  if (!p) {
    showNotice(t("orch.report.diff.noProject"));
    return false;
  }
  openDiff(p, { scope: "wip", worktreePath: at.worktree, ...(at.branch ? { branch: at.branch } : {}) });
  return true;
}

/**
 * Run 저장소와 같은 자리의 로컬 프로젝트 — 경로 동일성은 Rust 의 OS 함수 하나가 정한다(리뷰 F14 — 대소문자를 가리는 파일 시스템에서
 * `/repo/A` 와 `/repo/a` 를 같은 프로젝트로 보지 않게 — 프런트는 OS 를 모른다). 서버에 묻지 못하면 `null`.
 */
export async function projectAtRepo(repo: string): Promise<Project | null> {
  const list = localProjects();
  let found: number | null = null;
  try {
    found = await invoke<number | null>("orchestration_same_dir_index", { path: repo, candidates: list.map((x) => x.path) });
  } catch {
    found = null;
  }
  return found === null ? null : (list[found] ?? null);
}

// ---------------------------------------------------------------------------
// 앱 시작 — 돌던 중 멈춘 앨범 알림 한 번
// ---------------------------------------------------------------------------

let orphanChecked = false;

/**
 * 앱 시작 때 한 번(주 창) — 돌던 중 세션 서버 재시작으로 멈춘 앨범이 있으면 안내 한 줄(기존 알림 길 `showNotice`). 끝난 앨범은 세지 않는다
 * (`interruptedAlbums`). 서버에 닿지 못하면 조용히 넘어간다.
 */
export async function noticeOrphanedRuns(): Promise<void> {
  if (orphanChecked) return;
  orphanChecked = true;
  try {
    const n = interruptedAlbums(await runSnapshot()).length;
    if (n > 0) showNotice(t("orch.orphan.notice", { n }));
  } catch {
    // 서버가 없거나 옛 판 — 알림 없음
  }
}

/** 로컬 AI 타일의 알려진 대화만 새 앨범 초안으로 이어 간다. */
export function canContinueInOrch(pane: PaneSpec): boolean {
  if (isRemoteWindow || orchForkSource(pane) === null) return false;
  const tab = tabOfPane(pane.id);
  return tab !== null && !isOrchTab(tab);
}
