<script lang="ts">
  // 앨범·트랙 경로의 조회와 사람 동작, 확인 대상 고정은 이 부모 하나가 쥔다.
  import { untrack, type Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { listPanes, type PaneSpec } from "$lib/session";
  import {
    persistBand,
    formatDuration,
    orchReasonText,
    reportDiffRange,
    runActions,
    runStatePhrase,
    pauseBand,
    wantsDrift,
    wantsActivity,
    completeAction,
    holdBar,
    integrationChip,
    currentTrackAttempt,
    trackRows,
    needsHuman,
    strayAttempts,
    mergeCommand,
    mergeRow,
    mergeWhyText,
    shortCommit,
    type ReconcilePreview,
    type CleanupPreview,
    cleanupAvailable,
    archiveGate,
    archiveBlockedText,
    keptBranchCount,
    cleanupDefaults,
    tempRoleKey,
    tempWhyKey,
    type ReportFilesView,
    type AttemptView,
    type ReportView,
    type TaskView,
  } from "$lib/orchestration/model";
  import {
    approveVerify,
    overrideVerify,
    cancelIntegration,
    cleanupPreview,
    cleanupRun,
    archiveRun,
    completeRun,
    discardTemp,
    exportBranch,
    reconcile,
    reconcilePreview,
    pauseRun,
    releaseHold,
    removeRunWorktree,
    reportFiles,
    resumeRun,
    reviewTask,
    setTaskState,
    stopRun,
    stopWorker,
  } from "$lib/orchestration/api";
  import { viewWorkerConversation } from "$lib/app/conversation-viewer.svelte.js";
  import { noteRunBoard, reattachAlbumProducer, navigateOrchTab, openOrchPathInNewTab, openReportDiff, openWorktreeDiff, albumProducerLog, openProducerLog, closeProducerLog } from "$lib/app/orchestration.svelte.js";
  import { albumEnded, endedByHuman } from "./model/producer";
  import ProducerFinale from "./player/ProducerFinale.svelte";
  import { residentWindowTabs, tabOfPane } from "$lib/app/tabs.svelte.js";
  import { adoptWithNewProducer } from "$lib/app/orch-start.svelte.js";
  import { runSummaryOf } from "$lib/app/orch-pulse.svelte.js";
  import { isRemote } from "$lib/ipc";
  import UiIcon from "$lib/UiIcon.svelte";
  import { showNotice } from "$lib/app/notice";
  import { writeClipboard } from "$lib/clipboard";
  import { overridePinValid, pinOverride, pinVerify, verifyPinValid, type OverridePin, type VerifyPin } from "./confirm-pin";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { albumParentPath, keepAlbumOrigin, producerLeafOf } from "./orch-tab";
  import { shortPath } from "./board/format";
  import Home from "./player/Home.svelte";
  import Artists from "./player/Artists.svelte";
  import NewAlbum from "./player/NewAlbum.svelte";
  import ProducerChat from "./player/ProducerChat.svelte";
  import { albumScreens, orchScreenPath } from "$lib/app/album-screen.svelte.js";
  import { observeProducer } from "$lib/app/producer-chat.svelte.js";
  import OrchBreadcrumb from "./player/OrchBreadcrumb.svelte";
  import ReconcilePanel from "./board/ReconcilePanel.svelte";
  import CleanupPanel from "./board/CleanupPanel.svelte";
  import RunTimeline from "./board/RunTimeline.svelte";
  import AlbumPermissions from "./player/AlbumPermissions.svelte";
  import MergeDialog from "./player/MergeDialog.svelte";
  import AlbumInfoDialog from "./player/AlbumInfoDialog.svelte";
  import AlbumHead, { type AlbumMenuItem } from "./player/AlbumHead.svelte";
  import TrackRow from "./player/TrackRow.svelte";
  import TrackPlayer from "./player/TrackPlayer.svelte";
  import ArtistCard from "./player/ArtistCard.svelte";
  import SegTabs from "./player/SegTabs.svelte";
  import { albumTabOf, setAlbumTab, type AlbumTab } from "./player/album-tab.svelte.js";
  import NotePopover from "$lib/settings/NotePopover.svelte";
  import { albumCleanupRequest } from "./player/album-focus.svelte.js";
  import { createBoardLoader } from "./board/board-loader.svelte.js";
  import { createArtistLoader } from "./artist-loader.svelte.js";

  let { pane, visible = true }: { pane: PaneSpec; visible?: boolean } = $props();

  const ownerTab = $derived(tabOfPane(pane.id));
  const path = $derived(ownerTab?.orch ? orchScreenPath(ownerTab) : { view: "album" as const, runId: pane.run?.runId });
  const remoteProducer = $derived(isRemote && ownerTab ? albumScreens[ownerTab.id]?.producer : undefined);
  $effect(() => {
    const target = remoteProducer;
    if (!visible || !target) return;
    return untrack(() => observeProducer(target));
  });
  const runId = $derived(path.runId ?? null);
  let permissionsOpen = $state(false);
  /** [병합] 확인 창 — 앨범을 떠나거나 탭이 가려지면 닫는다 */
  let mergeOpen = $state(false);
  $effect(() => { void runId; void path.view; void path.taskId; void visible; permissionsOpen = false; mergeOpen = false; infoOpen = false; });
  /** [앨범 보관]을 눌렀는데 worktree 가 남았다 — 안내 띠(정리하면 저절로 걷힌다) */
  let archiveBlocked = $state(false);
  $effect(() => { void runId; archiveBlocked = false; });
  // 같은 앨범도 거울 → 이 창의 경로로 바뀌면 다시 붙는다. 부팅 첫 조회에는 아직 앨범이 없을 수 있다.
  $effect(() => {
    const current = path;
    const id = current.runId;
    const tab = ownerTab;
    if (visible && id && tab) untrack(() => void reattachAlbumProducer(tab.id, id));
  });

  // 조회 상태 — `board/board-loader.svelte.ts`. 읽기는 아래 별칭(`$derived` — 로더의 게터를 그대로 따른다), 쓰기는 `loader.*`.
  /** 아티스트 목록(트랙 줄 · 트랙 화면의 이름 · 아이콘) — 보일 때만 읽고 듣는다 */
  const profiles = createArtistLoader();
  $effect(() => {
    if (visible) return profiles.subscribe();
  });

  const loader = createBoardLoader({
    get runId() {
      return runId;
    },
    get visible() {
      return visible;
    },
    get paneId() {
      return pane.id;
    },
    get detailAttempt() {
      return artistId;
    },
  });
  const detail = $derived(loader.detail);
  const selectedTask = $derived(path.view === "track" ? detail?.tasks.find((task) => task.id === path.taskId) ?? null : null);
  const artistId = $derived(detail && selectedTask ? currentTrackAttempt(detail, selectedTask.id, path.attemptId)?.id ?? null : null);
  // 막대·알림·기본 시도 변경도 선택한 작업 중 파일을 바로 읽는다.
  $effect(() => {
    const selected = artistId;
    if (visible && selected) untrack(() => void loader.checkActivity(true));
  });

  const list = $derived(loader.list);
  const loading = $derived(loader.loading);
  const missing = $derived(loader.missing);
  const error = $derived(loader.error);
  const drift = $derived(loader.drift);
  const activity = $derived(loader.activity);

  let busy = $state(false);
  let confirmStop = $state(false);
  /** [앨범 완료] 확인 중(되돌릴 수 없다) */
  let confirmDone = $state(false);
  /** [조정] 패널(통합 설계 4-5) — 열 때 서버에서 두 머리 · 통합된 Task 표를 읽는다 */
  let recOpen = $state(false);
  /**
   * [검증 실행] 확인 대화 · [검증 실패인데 수락] 확인(통합 설계 5-1 · 5-4) — **연 순간의 묶음을 고정**해 든다(리뷰 F3). 확인 단추는
   * 이 고정 값만 보내고, 갱신에서 그 Task 의 지금 값이 달라지면(Job 교체 · 새 후보 · 만료) 대화를 닫는다(다시 열어 새 값을 보게).
   */
  let verifyAsk = $state<VerifyPin | null>(null);
  let overrideAsk = $state<OverridePin | null>(null);
  let rec = $state<ReconcilePreview | null>(null);
  let recConfirm = $state(false);
  let recReject = $state<string[]>([]);
  /** [worktree 지우기] 확인 중인 Attempt */
  let confirmWt = $state<string | null>(null);
  /** [정리] 대화(통합 설계 6-3) — 열 때 서버에서 작업자 worktree · ref · 남긴 서버 임시 폴더를 읽는다 */
  let cleanOpen = $state(false);
  let clean = $state<CleanupPreview | null>(null);
  let cleanWt = $state<string[]>([]);
  let cleanRefs = $state<string[]>([]);
  let cleanBranches = $state(false);
  let now = $state(Date.now());
  /** 앨범 머리 [⋯] 메뉴의 [앨범 정보] — 머리의 보조 줄 */
  let infoOpen = $state(false);
  let scrollEl = $state<HTMLDivElement | null>(null);

  // 주소가 바뀌면(목록 ↔ 상세) 판을 비우고 다시 읽는다. 보일 때만 — 숨은 탭이 다시 보이게 될 때도 이 효과가 한 번 읽는다(`visible` 을 읽는다).
  $effect(() => {
    void runId;
    if (!visible) return;
    untrack(() => {
      loader.forgetSeq();
      // 숨은 동안 주소가 바뀌었다(이어받기 · 다른 앨범 — 실기 10-29) — 옛 앨범을 잠시라도 보이지 않게 먼저 비운다.
      if (loader.detail && loader.detail.runId !== runId) loader.detail = null;
      confirmStop = false;
      confirmDone = false;
      recOpen = false;
      rec = null;
      cleanOpen = false;
      clean = null;
      loader.error = null;
      void loader.load();
    });
  });

  // 목록 화면 — 창으로 돌아올 때 · 30초마다 요약을 다시 읽는다(앱 밖에서 지운 worktree 는 사건이 없다 · 간격은 `refreshList` 가 지킨다).
  $effect(() => {
    if (!visible || runId !== null) return;
    const refresh = () => {
      if (document.visibilityState === "visible") loader.refreshList();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const id = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(id);
    };
  });

  // 앨범이 바뀌면 펼침 · [앨범 정보] 를 접는다.
  $effect(() => {
    void runId;
    untrack(() => {
      infoOpen = false;
    });
  });

  // 확인 대화 무효화 — 판이 갱신될 때 고정 묶음과 지금 값을 맞춘다.
  $effect(() => {
    const d = detail;
    const va = verifyAsk;
    const oa = overrideAsk;
    if (va && !verifyPinValid(va, d)) verifyAsk = null;
    if (oa && !overridePinValid(oa, d, d?.tasks.find((x) => x.id === oa.taskId) ?? null)) overrideAsk = null;
  });

  // 변화 이벤트 — 보일 때만 듣는다(구독 · 세션 서버 재연결은 `loader.subscribe` — 정리는 그 해제 함수).
  $effect(() => {
    if (!visible) return;
    return loader.subscribe();
  });

  // 사건 때 한 번(새 판을 읽은 뒤) — 보일 때만.
  $effect(() => {
    if (!visible || !detail) return;
    void detail.latestSeq;
    untrack(() => {
      void loader.checkDrift();
      void loader.checkActivity();
    });
  });

  // 열려 있는 동안 15초마다 — 사건 없이 바뀐 worktree · 기록 지연을 잡는다. 산 작업자가 있을 때만.
  $effect(() => {
    if (!visible || !detail || !wantsActivity(detail)) return;
    const id = setInterval(() => void loader.checkActivity(true), 15_000);
    return () => {
      clearInterval(id);
      loader.cancelActivityLater();
    };
  });

  /** [기록 보기](6단계) — 기존 대화 기록 화면을 그 작업자의 고정 대화로(머리 정보는 보드가 짓는다) */
  function viewTranscript(a: AttemptView): void {
    if (!detail || !a.conversationId) return;
    viewWorkerConversation(
      {
        agent: a.cli,
        id: a.conversationId,
        cwd: a.worktree ?? "",
        branch: a.branch ?? null,
        title: titles.get(a.taskId) ?? a.taskId,
        titleSource: "custom",
        startedAt: a.startedAt,
        updatedAt: detail.transcripts?.[a.id]?.lastGrowthAt ?? a.startedAt,
        model: null,
        forkedFrom: null,
        cwdExists: true,
      },
      { runId: detail.runId, attemptId: a.id },
    );
  }

  // 열려 있는 동안 30초마다 한 번 — 사건 없이 작업자가 worktree 를 바꾼 것(보고 뒤 커밋 · 편집)을 잡는다.
  $effect(() => {
    if (!visible || !detail || !wantsDrift(detail)) return;
    const id = setInterval(() => void loader.checkDrift(true), 30_000);
    return () => clearInterval(id);
  });

  // 경과 시계 — 보일 때 · 살아 있는 Run 일 때만 1초마다. 그물(F8 — 30초에 한 번 seq 확인)도 이 틱에 얹는다(타이머를 늘리지 않는다).
  $effect(() => {
    if (!visible || !detail || detail.endedAt || detail.state === "orphaned") return;
    now = Date.now();
    const id = setInterval(() => {
      now = Date.now();
      void loader.resyncIfDue(now);
    }, 1000);
    return () => clearInterval(id);
  });

  // 라이브러리의 [정리] 요청만 받는다. 트랙 진입은 경로가 쥔다.
  let focusSeen = 0;
  $effect(() => {
    const r = albumCleanupRequest();
    if (!r || r.n === focusSeen || !visible || !detail || r.runId !== detail.runId) return;
    focusSeen = r.n;
    untrack(() => {
      if (cleanupAvailable(detail!)) void openCleanup();
    });
  });

  const actions = $derived(detail ? runActions(detail.state, detail.coordinatorAttached) : null);
  /** 조율 멈춤 띠(10-30 — 재생 막대 바로 위 한 줄). 멈춤이면 앨범 머리의 상태 문장 띠는 걷는다(같은 말 두 번 없음) */
  const pause = $derived(detail ? pauseBand(detail, t) : null);
  const pauseTrack = $derived(detail ? needsHuman(detail).find((need) => need.taskId !== null)?.taskId ?? null : null);
  const phrase = $derived(detail && !pause ? runStatePhrase(detail, t) : null);
  const hold = $derived(detail ? holdBar(detail.hold, t) : null);
  const persistWarn = $derived(detail ? persistBand(detail.persist, t) : null);
  const integ = $derived(detail ? integrationChip(detail) : null);
  const merge = $derived(detail ? mergeRow(detail) : null);
  const done = $derived(detail ? completeAction(detail, t) : null);
  const elapsed = $derived(detail ? formatDuration((detail.endedAt ?? now) - detail.createdAt) : "");
  const coordLimit = $derived(detail ? formatDuration(detail.limits.coordinationMinutes * 60_000) : "");
  const titles = $derived(new Map((detail?.tasks ?? []).map((x) => [x.id, x.title])));
  const timeline = $derived([...(detail?.log ?? [])].reverse());
  const rows = $derived(detail ? trackRows(detail, now) : []);
  const strays = $derived(detail ? strayAttempts(detail) : []);
  /**
   * 남은 한도 · 타임라인의 두 배치(목업 V3AlbumSide*) — 넓으면 오른쪽 세부 칸의 카드 둘, 좁으면 트랙 표 아래 한도 칩 + [타임라인 | 한도] 탭.
   * 둘 다 그려 두고 앨범 칸 폭의 컨테이너 쿼리(`album-body`)가 하나만 보인다 — 칸 내용은 아래 조각 · `RunTimeline` 을 같이 쓴다.
   * 트랙 표 아래 탭(목업 V3FoldA · 사용자 배치 — [타임라인 | 한도], 트랙 표는 탭 밖 위에 늘 보임). 고른 탭은 그 앨범에 창 메모리로 남는다
   */
  const limitsShown = $derived(!!detail && detail.state !== "orphaned");
  const albumTab = $derived.by((): AlbumTab => {
    const tab = albumTabOf(runId);
    return tab === "limits" && !limitsShown ? "timeline" : tab;
  });
  const albumTabs = $derived([
    { id: "timeline", label: t("orch.board.tab.timeline", { n: timeline.length }) },
    ...(limitsShown ? [{ id: "limits", label: t("orch.board.tab.limits") }] : []),
  ]);
  /** 트랙 표 아래 늘 보이는 한도 칩 셋 — 쓴 수 / 한도 · 조율 시간 남음 */
  const limitChips = $derived.by(() => {
    if (!detail) return null;
    const l = detail.limits, r = detail.remaining;
    return {
      concurrent: { used: Math.max(0, l.maxConcurrentWorkers - r.concurrentWorkers), max: l.maxConcurrentWorkers },
      total: { used: Math.max(0, l.maxTotalWorkers - r.totalWorkers), max: l.maxTotalWorkers },
      coordLeft: formatDuration(Math.max(0, detail.coordinationDeadlineAt - (detail.endedAt ?? now))),
    };
  });
  /** 이 플레이어가 든 탭(프로듀서 찾기) */
  const homeTab = $derived(residentWindowTabs().find((x) => listPanes(x.root).some((p) => p.id === pane.id)) ?? null);
  /** 이 탭의 프로듀서 채팅이 돌리는 CLI — 앨범 머리 "프로듀서 ‹캐릭터›"(연 채팅 잎이 없으면 `null` — 프로듀서 없음) */
  const producerCli = $derived.by(() => {
    if (remoteProducer) return remoteProducer.cli || null;
    const leaf = homeTab ? producerLeafOf(homeTab) : null;
    return leaf?.producer?.opened ? leaf.producer.cli || null : null;
  });
  /** 왼쪽에 프로듀서 채팅(또는 대화 기록) 칸이 섰다 — 앨범 판 오른쪽 세부 칸의 폭만 가른다(있으면 360 · 없으면 트랙 화면과 같은 400) */
  const hasChat = $derived(!!remoteProducer || !!(homeTab && producerLeafOf(homeTab)));

  /** 끝난 앨범(서버 이어받기 판정 — 중단 중 · 중단 · 완료): 머리 단추가 [프로듀서 대화 기록] + [⋯] 메뉴 · 머리 아래 프로듀서 마무리 카드(목업 V3AlbumDone) */
  const ended = $derived(albumEnded(runSummaryOf(runId)));
  /** 그 앨범 프로듀서의 대화(이 기기에서 아는 것만 — `albumProducerLog`) */
  const producerLog = $derived(ended && detail ? albumProducerLog(runId, detail.repo) : null);
  function openLog(): void {
    if (ownerTab && runId) openProducerLog(ownerTab.id, runId, detail?.repo ?? "");
  }

  /** 앨범 머리 [⋯] 메뉴 — 옛 보드 머리의 사람 동작 전부(일시정지 · 재개 · 완료 · 병합 명령 · 정리 · 닫기 · 중단). 위험한 줄은 맨 끝 */
  const menuItems = $derived.by<AlbumMenuItem[]>(() => {
    const d = detail;
    if (!d) return [];
    const items: AlbumMenuItem[] = [];
    if (producerLog) items.push({ key: "log", icon: "orchestra", label: t("orch.album.log.open"), run: openLog });
    if (ended && ownerTab?.orch) {
      items.push({
        key: "newtab",
        icon: "tab",
        label: t("orch.nav.newTab"),
        disabled: isRemote,
        title: isRemote ? t("orch.nav.remote") : undefined,
        run: () => openOrchPathInNewTab(path),
      });
    }
    if (actions?.pause) items.push({ key: "pause", icon: "pause", label: t("orch.btn.pause"), disabled: busy, run: () => void act(() => pauseRun(d.runId)) });
    if (actions?.resume) {
      items.push({
        key: "resume",
        icon: "play",
        label: t("orch.btn.resume"),
        disabled: busy || actions.resumeBlocked,
        title: actions.resumeBlocked ? t("orch.btn.resume.noCoordinator") : undefined,
        run: () => void act(() => resumeRun(d.runId)),
      });
    }
    if (done?.show) {
      items.push({
        key: "complete",
        icon: "check",
        label: t("orch.btn.complete"),
        disabled: busy || !done.enabled,
        title: done.why ?? t("orch.btn.complete.title"),
        run: () => (confirmDone = true),
      });
    }
    if (integ && integ.exported !== "none" && d.integration) {
      const branch = d.integration.exportBranch;
      items.push({ key: "merge", icon: "copy", label: t("orch.integration.merge.copy"), title: t("orch.integration.merge.hint", { branch }), run: () => void copyMerge(branch) });
    }
    items.push({ key: "info", icon: "info", label: t("orch.album.menu.info"), sep: items.length > 0, run: () => (infoOpen = true) });
    if (cleanupAvailable(d)) items.push({ key: "cleanup", icon: "cleanup", label: t("orch.album.menu.cleanup"), title: t("orch.cleanup.open.title"), disabled: busy, run: () => void openCleanup() });
    // 끝난 앨범만. worktree 가 남았으면 눌렀을 때 안내 + [정리](목업 AlbumMenu) — 최종 판정은 서버.
    if (actions?.archive) items.push({ key: "archive", icon: "archive", label: t("orch.archive.menu"), title: t("orch.archive.menu.title"), disabled: busy, run: () => { if (archiveGate(d) === "blocked") archiveBlocked = true; else archiveAlbum(d.runId); } });
    if (actions?.stop) items.push({ key: "stop", icon: "stop", label: t("orch.bar.stop"), danger: true, sep: true, disabled: busy, run: () => (confirmStop = true) });
    return items;
  });

  /** 멈춤 띠의 [새 프로듀서로 이어받기] — 프로듀서 없음(재개 막힘) · 이 탭에 프로듀서 잎이 없음 · 서버 판정이 되찾을 수 있다고 할 때만(막대의 [프로듀서 열기] 와 같은 조건) */
  const pauseAdopt = $derived(
    !!pause && !!actions?.resumeBlocked && !remoteProducer && !(homeTab && producerLeafOf(homeTab)) && (runSummaryOf(runId)?.adoptable.restore ?? true),
  );

  /** 시도 선택은 별도 화면이 아니라 같은 트랙 경로의 칸이다. */
  function openArtist(id: string): void {
    const taskId = detail?.attempts?.find((a) => a.id === id)?.taskId;
    if (taskId) openTrack(taskId, id);
  }

  function openTrack(taskId: string, attemptId?: string | null): void {
    if (!ownerTab?.orch || !runId || !detail) return;
    const selected = currentTrackAttempt(detail, taskId, attemptId);
    navigateOrchTab(ownerTab.id, { view: "track", runId, taskId, ...(selected ? { attemptId: selected.id } : {}), ...keepAlbumOrigin(path, runId) });
  }

  function closeArtist(): void {
    if (ownerTab?.orch && runId) navigateOrchTab(ownerTab.id, { view: "album", runId, ...keepAlbumOrigin(path, runId) });
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    loader.error = null;
    try {
      await fn();
      await loader.load();
    } catch (e) {
      loader.error = orchReasonText(String(e), t);
    } finally {
      busy = false;
    }
  }

  function setTask(task: TaskView, state: "cancelled" | "todo"): void {
    if (!detail) return;
    const id = detail.runId;
    void act(() => setTaskState(id, task.id, task.version, state));
  }

  // 사람이 필요한 작업자 알림(권한 대기 · 첫 화면 · 복구 필요 …)은 **서버가 사건 id 와 함께** 만들고 주 창 한 곳이 보인다
  // (`app/orchestration-notify` — 리뷰 F11). 판은 따로 알리지 않는다(창이 여럿이어도 · 창이 없던 동안의 사건도 한 번).

  /** [수락] · [반려] · 뒤집기(사람) — 버전은 지금 읽은 판의 것(그사이 바뀌면 서버가 `conflict`) */
  function review(task: TaskView, decision: "accept" | "reject"): void {
    if (!detail) return;
    const id = detail.runId;
    void act(() => reviewTask(id, task.id, task.version, decision));
  }

  /** [통합 취소](커밋 단계 전만 — 서버가 다시 판정) */
  function cancelTaskIntegration(task: TaskView): void {
    void act(() => cancelIntegration(detail!.runId, task.id));
  }

  /** [검증 실행] 확인 열기 — 연 순간의 묶음을 고정(리뷰 F3). 줄 머리의 단추에서 오면 그 트랙을 펼친다(확인 상자가 펼침 안에 있다) */
  function askVerify(taskId: string): void {
    verifyAsk = pinVerify(detail!, taskId);
    openTrack(taskId);
  }

  function cancelVerify(): void {
    verifyAsk = null;
  }

  function runVerify(pin: VerifyPin): void {
    // 고정 묶음만 보낸다 — 지금 판으로 다시 계산하지 않는다(리뷰 F3).
    const p = pin;
    verifyAsk = null;
    if (!verifyPinValid(p, detail)) return;
    void act(() => approveVerify(p.runId, { jobId: p.jobId, candidate: p.candidate, commandSha: p.commandSha, old: p.old }));
  }

  /** [검증 실패인데 수락] 확인 열기 — 연 순간의 묶음을 고정(리뷰 F3) */
  function askOverride(task: TaskView): void {
    overrideAsk = pinOverride(detail!, task);
  }

  function cancelOverride(): void {
    overrideAsk = null;
  }

  function confirmOverride(pin: OverridePin, task: TaskView): void {
    // 고정 묶음만 보낸다(리뷰 F3).
    const p = pin;
    overrideAsk = null;
    if (!overridePinValid(p, detail, task)) return;
    void act(() => overrideVerify(p.runId, p.jobId, p.verifyId, p.candidate));
  }

  /** [파일 목록](통합 설계 3-1) — 보고 id → 목록 · 읽는 중 · 오류. 고정 OID 라 한 번 읽으면 그대로 */
  let files = $state<Record<string, ReportFilesView | "loading" | { error: string }>>({});
  let filesOpen = $state<Set<string>>(new Set());

  function toggleFiles(task: TaskView, r: ReportView): void {
    if (!detail) return;
    const next = new Set(filesOpen);
    if (next.has(r.reportId)) {
      next.delete(r.reportId);
      filesOpen = next;
      return;
    }
    next.add(r.reportId);
    filesOpen = next;
    const have = files[r.reportId];
    if (have && have !== "loading" && !("error" in have)) return;
    files = { ...files, [r.reportId]: "loading" };
    const id = detail.runId;
    reportFiles(id, task.id, r.reportId)
      .then((v) => (files = { ...files, [r.reportId]: v }))
      .catch((e) => (files = { ...files, [r.reportId]: { error: orchReasonText(String(e), t) } }));
  }

  /** 보고 파일 목록을 한 번 읽어 둔다(작업자 상세의 곁 카드 — [파일 목록] 과 같은 캐시 · 펼침 상태는 건드리지 않는다) */
  function ensureFiles(taskId: string, reportId: string): void {
    if (!detail) return;
    const have = files[reportId];
    if (have && (have === "loading" || !("error" in have))) return;
    files = { ...files, [reportId]: "loading" };
    const id = detail.runId;
    reportFiles(id, taskId, reportId)
      .then((v) => (files = { ...files, [reportId]: v }))
      .catch((e) => (files = { ...files, [reportId]: { error: orchReasonText(String(e), t) } }));
  }

  /** [diff 보기](작업자 상세 — 보고 전) — 그 worktree 의 아직 커밋하지 않은 것 */
  function viewWipDiff(a: AttemptView): void {
    if (!detail || !a.worktree) return;
    void openWorktreeDiff(detail.repo, { worktree: a.worktree, branch: a.branch ?? null });
  }

  /** 권한은 앨범 패널에서만 바꾼다. 트랙에서 열어도 같은 앨범 구성을 편집한다. */
  function editDelegation(_role: string | null = null): void {
    if (!detail?.album) return;
    permissionsOpen = true;
  }

  /** [diff 보기] — 그 Attempt 의 worktree · 브랜치로, 기준 … 보고 커밋 */
  function viewDiff(r: ReportView): void {
    if (!detail) return;
    const range = reportDiffRange(r);
    if (!range) return;
    const a = (detail.attempts ?? []).find((x) => x.id === r.attemptId);
    void openReportDiff(detail.repo, { ...range, branch: a?.branch ?? null, worktree: a?.worktree ?? null });
  }

  /** [조정] 패널 열기 — 두 머리 · 통합된 Task 표를 읽는다(보류일 때만) */
  async function openReconcile(): Promise<void> {
    if (!detail) return;
    recOpen = true;
    rec = null;
    recConfirm = false;
    recReject = [];
    try {
      rec = await reconcilePreview(detail.runId);
    } catch (e) {
      recOpen = false;
      loader.error = orchReasonText(String(e), t);
    }
  }

  function doReconcile(mode: "revert" | "accept"): void {
    if (!detail) return;
    const id = detail.runId;
    const seen = rec?.currentHead ?? null;
    const rejects = mode === "accept" ? [...recReject] : [];
    recOpen = false;
    void act(() => reconcile(id, mode, mode === "accept" && recConfirm, seen, rejects));
  }

  function toggleRecReject(taskId: string, on: boolean): void {
    recReject = on ? [...recReject.filter((x) => x !== taskId), taskId] : recReject.filter((x) => x !== taskId);
  }

  /** 내보낸 브랜치의 병합 명령 복사 — 앱이 병합하지 못할 때(⋯ 메뉴 · 확인 창) */
  async function copyMerge(branch: string): Promise<void> {
    if (await writeClipboard(mergeCommand(branch))) showNotice(t("orch.integration.merge.hint", { branch }));
  }

  function stopAttempt(a: AttemptView): void {
    if (!detail) return;
    const id = detail.runId;
    void act(() => stopWorker(id, a.id));
  }

  function removeWorktree(a: AttemptView): void {
    if (!detail || !a.worktree) return;
    const id = detail.runId;
    const path = a.worktree;
    confirmWt = null;
    void act(async () => {
      await removeRunWorktree(id, path, true);
      showNotice(t("orch.worker.wtRemove.done"));
    });
  }

  // 주소는 명세(탭 상태)에 상태 모듈이 적는다 — 프롭 `pane` 을 직접 고치지 않는다(`noteRunBoard` 머리말)
  function backToList(): void {
    noteRunBoard(pane.id, null);
    loader.detail = null;
  }

  /** [정리] 대화 열기 — 재료를 읽고 기본 고름(통합된 Task 의 worktree · 남은 서버 임시 ref)을 세운다 */
  async function openCleanup(): Promise<void> {
    if (!detail) return;
    cleanOpen = true;
    clean = null;
    cleanBranches = false;
    try {
      const p = await cleanupPreview(detail.runId);
      clean = p;
      const d = cleanupDefaults(p);
      cleanWt = d.worktrees;
      cleanRefs = d.refs;
    } catch (e) {
      cleanOpen = false;
      loader.error = orchReasonText(String(e), t);
    }
  }

  function doCleanup(): void {
    if (!detail) return;
    const id = detail.runId;
    const wts = [...cleanWt];
    const rs = [...cleanRefs];
    const br = cleanBranches;
    cleanOpen = false;
    void act(async () => {
      const r = await cleanupRun(id, wts, rs, br);
      const kept = keptBranchCount(r);
      const failed =
        (kept > 0 ? t("orch.cleanup.done.branchesKept", { n: kept }) : "") +
        (r.failed.length > 0 ? t("orch.cleanup.done.failed", { n: r.failed.length }) : "");
      showNotice(t("orch.cleanup.done", { wt: r.worktrees.length, refs: r.refs.length, failed }));
    });
  }

  /** 남긴 서버 임시 폴더 [그래도 지우기](통합 설계 6-2 — 사람) */
  function discard(path: string): void {
    if (!detail) return;
    const id = detail.runId;
    void act(() => discardTemp(id, path));
  }

  /** 끝난 앨범 [보관] — 보던 앨범이면 그 위 화면(출발 스튜디오 또는 라이브러리)으로 돌아간다(오케스트레이션 탭은 경로로 · 원격 창도 같은 길) */
  function archiveAlbum(id: string): void {
    void act(async () => {
      await archiveRun(id);
      if (untrack(() => runId) !== id) return;
      if (ownerTab?.orch) navigateOrchTab(ownerTab.id, albumParentPath(untrack(() => path)));
      else backToList();
    });
  }
</script>

<!-- 조율 멈춤 띠 — 판 아래(= 재생 막대 바로 위) 한 줄 · 호박 · 짧은 문구 + 그 자리의 단추 · 긴 설명은 툴팁(10-30 실기) -->
{#snippet pauseStrip()}
  {#if pause && detail}
    <div class="pause-band" role="status" aria-label={t("orch.pauseBand.aria")} title={pause.title} data-run-pause-band={pause.reason}>
      <UiIcon name="warning" size={15} />
      <span class="pause-text">{pause.text}</span>
      {#if pauseTrack}<button type="button" class="btn btn-sm btn-ghost" data-run-pause-track={pauseTrack} onclick={() => openTrack(pauseTrack!)}>{t("orch.notice.open")}</button>{/if}
      {#if actions?.resume && !actions.resumeBlocked}
        <button type="button" class="btn btn-sm btn-secondary" data-run-pause-action="resume" disabled={busy}
          onclick={() => void act(() => resumeRun(detail!.runId))}>{t("orch.btn.resume")}</button>
      {:else if pauseAdopt}
        <button type="button" class="btn btn-sm btn-secondary" data-run-pause-action="adopt"
          onclick={() => void adoptWithNewProducer({ runId: detail!.runId, name: detail!.name, repo: detail!.repo, adoptable: runSummaryOf(detail!.runId)?.adoptable ?? null })}
          >{t("orch.home.adopt")}</button>
      {/if}
    </div>
  {/if}
{/snippet}

<!-- 판 맨 위 경로 줄(원형 ← 하나 · 오른쪽 끝 = 화면별 단추). 네 화면 모두 든 판의 왼쪽 위 같은 자리 — 여백 있는 판 안이면 `host` 로 그 여백을 걷는다 -->
{#snippet crumb(end?: Snippet)}
  {#if ownerTab?.orch}<OrchBreadcrumb {path} {detail} {end} host={path.view === "track" ? "[data-track-player]" : path.view === "artists" ? "[data-orch-artists] .panel" : path.view === "studio" ? "[data-orch-library]" : undefined}
      onnavigate={(next) => navigateOrchTab(ownerTab!.id, next)} />{/if}
{/snippet}

<!-- 남은 한도 칸 격자(이름 위 · 큰 숫자 아래) — 좁은 판의 [한도] 탭과 넓은 판의 오른쪽 "남은 한도" 카드가 같이 쓴다 -->
{#snippet limitsGrid()}
  {#if detail}
    {@const r = detail.remaining}
    <dl class="remaining">
      <div><dt>{t("orch.remaining.k.tasks")}</dt><dd>{r.tasks}</dd></div>
      <div><dt>{t("orch.remaining.k.calls")}</dt><dd>{r.callsThisMinute}</dd></div>
      <div><dt>{t("orch.remaining.k.concurrent")}</dt><dd>{r.concurrentWorkers}</dd></div>
      <div><dt>{t("orch.remaining.k.total")}</dt><dd>{r.totalWorkers}</dd></div>
      {#if typeof r.turns === "number"}<div><dt>{t("orch.remaining.k.turns")}</dt><dd data-run-turns-left={r.turns}>{r.turns}</dd></div>{/if}
      {#if typeof r.reviews === "number"}<div><dt>{t("orch.remaining.k.reviews")}</dt><dd>{r.reviews}</dd></div>{/if}
      <div><dt>{t("orch.remaining.k.coord")}</dt><dd class="mono">{limitChips?.coordLeft}</dd></div>
    </dl>
  {/if}
{/snippet}

{#snippet newTabPill()}
  <button type="button" class="crumb-pill" data-album-new-tab disabled={isRemote} title={isRemote ? t("orch.nav.remote") : undefined}
    onclick={() => openOrchPathInNewTab(path)}>{t("orch.nav.newTab")}</button>
{/snippet}

<div class="screen">
  {#if remoteProducer}<aside data-producer-leaf={remoteProducer.chat}><ProducerChat target={remoteProducer} {runId} onalbum={() => {}}
    onclose={ended && ownerTab ? () => closeProducerLog(ownerTab!.id) : undefined} /></aside>{/if}
<div class="board" data-run-board data-run-id={runId ?? ""}>
  <!-- 경로 줄 — 앨범 · 트랙은 제 칸 맨 위(오른쪽 패널 · 곁 칸이 판 높이 전체를 쓰게) · 새 앨범은 오른쪽 구성 카드 맨 위 · 아티스트 · 스튜디오는 판 안 맨 위(목업), 라이브러리 루트는 없음(제목과 겹친다) -->
  {#if ownerTab?.orch && path.view !== "library" && path.view !== "studio" && path.view !== "new" && path.view !== "artists" && !(detail && runId && !missing && (path.view === "album" || (path.view === "track" && selectedTask)))}{@render crumb()}{/if}
  {#if path.view === "artists"}
    <Artists {visible} crumb={ownerTab?.orch ? crumb : undefined} />
  {:else if path.view === "new" && ownerTab}
    {#key albumScreens[ownerTab.id]?.draftId ?? ownerTab.id}<NewAlbum tabId={ownerTab.id} {visible} crumb={ownerTab.orch ? crumb : undefined} />{/key}
  {:else if runId === null}
    <!-- (④) 홈 · 라이브러리 — 홈 모양이면 왼쪽에 새 앨범(프로듀서 · 저장소 · 첫 지시), 준비 중이면 라이브러리만(왼쪽은 프로듀서 타일) -->
    <Home {list} {loading} {error} {busy} {visible} archive={archiveAlbum} refresh={() => loader.refreshList()} studio={path.view === "studio" ? path.repo ?? null : null} crumb={ownerTab?.orch ? crumb : undefined} />
  {:else if missing}
    <div class="head-bare">
      <button type="button" class="btn btn-sm btn-ghost" title={t("orch.board.back.title")} onclick={backToList}>{t("orch.board.back")}</button>
    </div>
    <div class="body"><p class="empty">{t("orch.board.missing")}</p></div>
  {:else if !detail}
    <div class="body"><p class="empty">{error ?? t("orch.board.loading")}</p></div>
  {:else if path.view === "track"}
    {#if selectedTask}
      <TrackPlayer task={selectedTask} profiles={profiles.list} {detail} attemptId={path.attemptId} {activity} {now} {visible} {busy} {titles} {files} {ensureFiles}
        {drift} {filesOpen} {verifyAsk} {overrideAsk} {setTask} {review} {toggleFiles} {viewDiff} {cancelTaskIntegration}
        {askVerify} {cancelVerify} {runVerify} {askOverride} {cancelOverride} {confirmOverride}
        {crumb} onback={closeArtist} ontrack={openTrack} onpick={openArtist} onpermissions={() => editDelegation()} onreconcile={() => void openReconcile()}
        {stopAttempt} {removeWorktree} {viewTranscript} {viewWipDiff} />
    {:else}<div class="body"><p class="empty">{t("orch.player.missing")}</p><button type="button" class="btn btn-sm" onclick={closeArtist}>{t("orch.artist.back")}</button></div>{/if}
    {#if recOpen}<div class="track-panel" role="dialog" aria-label={t("orch.hold.reconcile")}><ReconcilePanel {rec} {recReject} bind:recConfirm {busy} {toggleRecReject} {doReconcile} oncancel={() => (recOpen = false)} /></div>{/if}
    {#if permissionsOpen && detail.album}<div class="track-panel" role="dialog" aria-label={t("orch.perm.title")}><AlbumPermissions {detail} oncancel={() => (permissionsOpen = false)} onapplied={() => { permissionsOpen = false; void loader.load(); }} /></div>{/if}
    {#if error}<p class="error artist-error" role="alert">{error}</p>{/if}
    {@render pauseStrip()}
  {:else}
    <!-- 넓으면(앨범 칸 폭 — 아래 `album-body` 컨테이너 쿼리) 경로 줄 아래 가운데 트랙 판 + 오른쪽 세부 칸(트랙 화면과 같은 결 — 판 12 여백 · 칸 사이 12),
         좁으면 트랙 판 하나(세부는 트랙 표 아래 칩 · 탭). 권한 패널이 열리면 세부 칸 자리를 패널이 대신 차지한다 -->
    <div class="album-body" class:chat={hasChat}>
    <div class="album-main">
    {@render crumb(newTabPill)}
    <div class="album-cols">
    <div class="scroll album-content" bind:this={scrollEl}>
      <AlbumHead {permissionsOpen} onpermissions={() => (permissionsOpen = !permissionsOpen)} {detail} {producerCli} {elapsed} {coordLimit} {busy} {menuItems}
        onback={ownerTab?.orch ? undefined : backToList}
        onnewtab={ownerTab?.orch ? undefined : () => openOrchPathInNewTab(path)}
        onexport={() => void act(() => exportBranch(detail!.runId))}
        {ended} onlog={producerLog ? openLog : undefined} />

      <div class="bands">
        {#if phrase}
          <p class="phrase" data-run-phrase>{phrase}</p>
        {/if}

        <!-- 저장 실패 띠(F7): 서버가 Run 상태를 디스크에 쓰지 못하는 중 — 다음 저장이 되면 사라진다(보류 막대와 같은 꼴 · 단추 없음) -->
        {#if persistWarn}
          <div class="hold" role="alert" data-run-persist-failing={persistWarn.reason}>
            <p class="hold-text">{persistWarn.text}</p>
          </div>
        {/if}

        <!-- 맡기기 띠(3b — 설계 2-4): 이 앨범의 지금 권한 상태. 문제가 있을 때만 띠로(정상이면 머리의 [앨범 권한]) -->

        {#if hold && detail.hold}
          <div class="hold" role="status" data-run-hold={detail.hold.reason}>
            <p class="hold-text">{hold.text}</p>
            {#if hold.delegation}
              <button type="button" class="btn btn-sm btn-ghost" data-run-action="edit-delegation" onclick={() => editDelegation()}
                >{t("orch.perm.title")}</button
              >
            {/if}
            {#if hold.release && detail.state !== "orphaned"}
              <button type="button" class="btn btn-sm btn-secondary" data-run-action="release-hold" title={t("orch.hold.release.title")} disabled={busy}
                onclick={() => void act(() => releaseHold(detail!.runId))}>{t("orch.hold.release")}</button>
            {/if}
            {#if hold.reconcile && detail.state !== "orphaned"}
              <button type="button" class="btn btn-sm btn-secondary" data-run-action="reconcile" title={t("orch.hold.reconcile.title")} disabled={busy}
                onclick={() => void openReconcile()}>{t("orch.hold.reconcile")}</button>
            {/if}
          </div>
        {/if}

        {#if recOpen}
          <ReconcilePanel {rec} {recReject} bind:recConfirm {busy} {toggleRecReject} {doReconcile} oncancel={() => (recOpen = false)} />
        {/if}

        <!-- 내보낸 브랜치(통합 칩의 나머지 — 머리 메타가 통합 머리를 보인다): 내보낸 · 뒤처진 브랜치 + [병합] · 병합한 뒤엔 결과(복사는 ⋯ 메뉴) -->
        {#if merge && merge.kind === "merged"}
          <div class="integration" data-run-integration data-merge-row="merged">
            <span class="chip ok" data-merge-done>{t(merge.auto ? "orch.merge.done.autoChip" : "orch.merge.done.chip", { branch: merge.target })}</span>
            {#if merge.commit}<span class="chip faint mono" data-merge-commit title={merge.commit}>{shortCommit(merge.commit)}</span>{/if}
          </div>
          <p class="meta merge-note" data-merge-note>{t("orch.merge.done.note")}{#if merge.auto && merge.commit}{" "}{t("orch.merge.done.revert", { commit: shortCommit(merge.commit) })}{/if}</p>
        {:else if merge && merge.kind !== "hidden" && detail.integration}
          {@const i = detail.integration}
          <div class="integration" data-run-integration data-merge-row={merge.kind}>
            {#if merge.kind === "waiting"}<span class="chip warn" data-merge-waiting>{t("orch.merge.waiting")}</span>{/if}
            {#if i.exportedHead}
              <span class="chip {merge.stale ? 'warn' : 'faint'} mono" data-integration-exported={merge.stale ? "stale" : "current"}
                title={merge.stale ? t("orch.integration.exported.stale") : undefined}>{t("orch.integration.exported", { branch: i.exportBranch })}</span>
            {/if}
            {#if merge.kind !== "waiting"}
              <span class="grow"></span>
              <button type="button" class="btn btn-sm btn-primary" data-run-action="merge" disabled={busy || !merge.canMerge}
                title={merge.stale ? t("orch.integration.exported.stale") : undefined} onclick={() => (mergeOpen = true)}>{t("orch.merge.btn")}</button>
            {/if}
          </div>
          {#if merge.kind === "no-target"}<p class="meta merge-note" data-merge-no-target>{t("orch.merge.noTarget")}</p>{/if}
          {#if merge.stop}
            <div class="hold" role="status" data-merge-stopped={merge.stop.reason}>
              <p class="hold-text">{t("orch.merge.stopped", { why: mergeWhyText(merge.stop.reason, merge.stop.detail, t) })}</p>
              <button type="button" class="btn btn-sm btn-primary" data-run-action="merge" disabled={busy || !merge.canMerge}
                onclick={() => (mergeOpen = true)}>{t("orch.merge.btn")}</button>
            </div>
          {/if}
        {/if}

        {#if confirmDone}
          <div class="confirm" role="alertdialog" aria-labelledby="run-done-title" data-run-done-confirm>
            <p class="confirm-title" id="run-done-title">{t("orch.complete.title")}</p>
            <p class="confirm-text">{t("orch.complete.text")}</p>
            <div class="confirm-actions">
              <button type="button" class="btn btn-sm btn-secondary" onclick={() => (confirmDone = false)}>{t("orch.complete.cancel")}</button>
              <button type="button" class="btn btn-sm btn-primary" data-run-done-ok disabled={busy}
                onclick={() => {
                  confirmDone = false;
                  void act(() => completeRun(detail!.runId));
                }}>{t("orch.complete.ok")}</button>
            </div>
          </div>
        {/if}

        {#if archiveBlocked && (detail.worktreesLeft ?? 0) > 0}
          <div class="hold" role="status" data-run-archive-blocked>
            <p class="hold-text">{archiveBlockedText(detail.worktreesLeft ?? 0, t)}</p>
            <button type="button" class="btn btn-sm btn-secondary" data-run-action="archive-cleanup" disabled={busy} onclick={() => void openCleanup()}>{t("orch.cleanup.open")}</button>
          </div>
        {/if}

        {#if (detail.tempPending ?? []).length > 0}
          <div class="hold" role="status" data-run-temp-pending>
            <p class="hold-text">{t("orch.temp.title")} — {t("orch.temp.text")}</p>
            <ul class="rec-list">
              {#each detail.tempPending ?? [] as p (p.path)}
                <li data-temp-pending={p.path} data-why={p.why}>
                  <span class="chip faint">{t(tempRoleKey(p.role))}</span>
                  <span class="meta mono" title={p.path}>{shortPath(p.path)}</span>
                  <span class="chip warn">{t(tempWhyKey(p.why))}</span>
                  <button type="button" class="btn btn-sm btn-ghost" data-temp-open onclick={() => void revealItemInDir(p.path).catch(() => {})}
                    >{t("orch.temp.open")}</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-temp-discard title={t("orch.temp.discard.title")} disabled={busy}
                    onclick={() => discard(p.path)}>{t("orch.temp.discard")}</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if confirmStop}
          <div class="confirm" role="alertdialog" aria-labelledby="run-stop-title" data-run-stop-confirm>
            <p class="confirm-title" id="run-stop-title">{t("orch.stop.title")}</p>
            <p class="confirm-text">{t("orch.stop.text")}</p>
            <div class="confirm-actions">
              <button type="button" class="btn btn-sm btn-secondary" onclick={() => (confirmStop = false)}>{t("orch.stop.cancel")}</button>
              <button type="button" class="btn btn-sm btn-primary" data-run-stop-ok disabled={busy}
                onclick={() => {
                  confirmStop = false;
                  void act(() => stopRun(detail!.runId));
                }}>{t("orch.stop.ok")}</button>
            </div>
          </div>
        {/if}

        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>

      <!-- 프로듀서 마무리 카드(끝난 앨범 — 마지막 어시스턴트 말 앞부분 · [전체 대화 →] = 왼쪽 대화 기록 잎) -->
      {#if producerLog?.conv}
        <ProducerFinale chat={producerLog.chat} cli={producerLog.cli} conv={producerLog.conv} runState={detail.state} byHuman={endedByHuman(detail.log)} onopen={openLog} />
      {/if}

      <!-- 트랙 목록 — Task 순서 고정 · 번호 = 화면 순번 -->
      <div class="cols" aria-hidden="true">
        <span class="c-no">#</span><span>{t("orch.track.col.track")}</span><span>{t("orch.track.col.status")}</span><span class="c-prog"
          >{t("orch.track.col.progress")}</span
        ><span class="c-time">{t("orch.track.col.time")}</span>
      </div>
      {#if rows.length === 0}
        <p class="empty pad">{t("orch.track.empty")}</p>
      {:else}
        <ul class="tracks" data-run-tracks>
          {#each rows as row (row.task.id)}
            <TrackRow {row} {detail} {busy} profiles={profiles.list} ontoggle={() => openTrack(row.task.id)}
              onverify={() => askVerify(row.task.id)} onpermissions={() => editDelegation()} onartist={openArtist} />
          {/each}
        </ul>
      {/if}

      <div class="tail">
        <!-- 그 밖의 아티스트 — Task 표에 없는 Attempt(옛 파일 · 지운 Task). 사람 동작을 잃지 않게 칸 그대로 -->
        {#if strays.length > 0}
          <section data-run-stray-workers>
            <h4>{t("orch.track.stray")}</h4>
            {#each strays as a (a.id)}
              <ArtistCard {a} {detail} {activity} {now} {titles} {busy} bind:confirmWt {stopAttempt} {removeWorktree} {editDelegation} {viewTranscript} openDetail={openArtist} />
            {/each}
          </section>
        {/if}

        {#if (detail.leftovers ?? []).length > 0}
          <section data-run-leftovers>
            <h4>{t("orch.leftovers.title")}</h4>
            <ul class="workers">
              {#each detail.leftovers ?? [] as l (l.attemptId)}
                <li class="worker" class:alert={l.processAlive}>
                  <span class="chip faint mono">{l.cli}</span>
                  {#if l.processAlive}<span class="meta">{t("orch.leftovers.process", { pid: l.pid ?? "?" })}</span>{/if}
                  {#if l.worktreeExists && l.worktree}
                    <span class="meta mono" title={l.worktree}>{t("orch.leftovers.worktree", { path: shortPath(l.worktree) })}</span>
                  {/if}
                  {#if l.halfMade}<span class="chip faint">{t("orch.leftovers.halfMade")}</span>{/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>

      <!-- 트랙 표 아래 — 남은 한도 칩 셋(늘 보임) · [타임라인 | 한도] 탭(목업 V3FoldA 를 사용자가 고친 배치: 트랙 표는 위에 늘 보이고,
           그 아래 한 자리를 탭으로 바꿔 보여 준다 — ▶ 펼침 없음 · 패널은 둘 다 그려 두고 `hidden` 으로 고른다) -->
      <!-- 좁을 때만 — 칩 · 탭 · 두 패널을 카드 한 장으로 감싸 트랙 표와 가른다(사용자 10-31) -->
      <section class="fold-card fold" data-album-fold-card>
      <div class="album-tabs">
        <!-- 남은 한도 요약 — 트랙 표 바로 아래 늘 보이는 칩 셋 + [한도] 탭(한도 탭으로) -->
        {#if limitsShown && limitChips}
          <div class="limit-chips" data-run-limit-chips>
            <span class="lchip" data-run-limit-chip="concurrent">{t("orch.remaining.chip.concurrent")} <b>{limitChips.concurrent.used} / {limitChips.concurrent.max}</b></span>
            <span class="lchip" data-run-limit-chip="total">{t("orch.remaining.chip.total")} <b>{limitChips.total.used} / {limitChips.total.max}</b></span>
            <span class="lchip" data-run-limit-chip="coord">{t("orch.remaining.chip.coord")} <b class="mono">{limitChips.coordLeft}</b> {t("orch.remaining.chip.left")}</span>
          </div>
        {/if}

        <SegTabs tabs={albumTabs} value={albumTab} label={t("orch.board.tabs.aria")} idBase="album-{detail.runId}" name="album"
          onpick={(id) => setAlbumTab(detail!.runId, id as AlbumTab)} />
      </div>

      <!-- 타임라인 탭 — 메타만(시각 · 주체 · 사건 · 대상 · 결과), 새것이 위 -->
      <div class="tab-panel tail" role="tabpanel" id="album-{detail.runId}-timeline" aria-labelledby="album-{detail.runId}-timeline-tab" hidden={albumTab !== "timeline"}
        data-album-panel="timeline" data-run-timeline>
        <RunTimeline {timeline} {titles} />
      </div>

      <!-- 한도 탭 — 남은 한도 전부(칸 격자) -->
      {#if limitsShown}
        <div class="tab-panel tail" role="tabpanel" id="album-{detail.runId}-limits" aria-labelledby="album-{detail.runId}-limits-tab" hidden={albumTab !== "limits"}
          data-album-panel="limits" data-run-remaining>
          <h4 class="sr-only">{t("orch.remaining.title")}</h4>
          {@render limitsGrid()}
          <p class="remaining-note">{t("orch.remaining.note")}</p>
        </div>
      {/if}
      </section>
    </div>
    <!-- 오른쪽 세부 칸(넓을 때만 보임 · 바탕 없이 카드 둘 — 남은 한도 · 타임라인(남은 높이를 차지하고 안쪽만 구른다)) -->
    {#if !(permissionsOpen && detail.album)}
      <aside class="album-side" data-album-side aria-label={t("orch.board.tabs.aria")}>
        {#if limitsShown}
          <section class="side-card" data-album-side-card="limits">
            <h3>{t("orch.remaining.title")}<span class="side-note">· {t("orch.remaining.fixed")}</span></h3>
            {@render limitsGrid()}
          </section>
        {/if}
        <section class="side-card fill" data-album-side-card="timeline">
          <h3>{t("orch.timeline.title")}<span class="side-note">· {t("orch.timeline.newest", { n: timeline.length })}</span></h3>
          <div class="side-scroll"><RunTimeline {timeline} {titles} /></div>
        </section>
      </aside>
    {/if}
    </div>
    </div>
    {#if permissionsOpen && detail.album}{#key detail.runId}<AlbumPermissions {detail} oncancel={() => (permissionsOpen = false)} onapplied={() => { permissionsOpen = false; void loader.load(); }} />{/key}{/if}
    </div>
    {@render pauseStrip()}
  {/if}
  {#if infoOpen && detail}
    <AlbumInfoDialog {detail} {producerCli} {elapsed} {coordLimit} why={done?.show && !done.enabled ? (done.why ?? null) : null} onclose={() => (infoOpen = false)} />
  {/if}
  {#if mergeOpen && detail}
    <MergeDialog {detail} onclose={() => (mergeOpen = false)} onmerged={() => void loader.load()} oncopy={(branch) => void copyMerge(branch)} />
  {/if}
  {#if cleanOpen && detail}
    <CleanupPanel repo={detail.repo} {clean} bind:cleanWt bind:cleanRefs bind:cleanBranches {busy} {doCleanup} oncancel={() => (cleanOpen = false)} />
  {/if}
  <!-- ⓘ 설명 팝오버 한 벌(설정 · 호스트 폼과 같은 `InfoNote` 짝) — 이 판 안의 ⓘ(위험 자세히 · 메모 · 막힘 전문 …)가 연 것만 그린다 -->
  <NotePopover active={visible} />
</div>
</div>

<style>
  .album-body { display: flex; flex: 1; min-height: 0; overflow: hidden; container: album-body / inline-size; --album-side: 400px; }
  /* 왼쪽에 채팅이 서 있으면 세부 칸 360(목업 V3AlbumSideLive), 없으면 트랙 화면과 같은 400(V3AlbumSideDone) */
  .album-body.chat { --album-side: 360px; }
  .album-main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .album-cols { flex: 1; min-height: 0; display: flex; }
  .album-cols > .album-content { min-width: 0; }
  /* 오른쪽 세부 칸 — 넓을 때만(아래 쿼리). 바탕 없이 카드 둘(카드 사이 10) · 타임라인 카드가 남은 높이를 차지하고 안쪽만 구른다 */
  .album-side { display: none; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; overflow: hidden; font-size: var(--t-sm); box-sizing: border-box; }
  .side-card { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; min-width: 0; margin: 0; padding: 14px 16px; box-sizing: border-box;
    border-radius: var(--radius-surface, 16px); background: var(--m3-surface-container-low, var(--bg-panel)); }
  .side-card.fill { flex: 1 1 auto; min-height: 0; }
  /* 좁을 때 트랙 표 아래 칩 · 탭 · 패널을 감싸는 카드 — 오른쪽 세부 칸 카드와 같은 면 */
  .fold-card { margin: var(--space-3, 12px) 16px var(--space-4, 16px); border-radius: var(--radius-surface, 16px); background: var(--m3-surface-container-low, var(--bg-panel)); }
  .fold-card .album-tabs { padding: 14px 16px 0; }
  .fold-card .tail { padding: var(--space-2) 16px 14px; }
  .side-card h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--fg-1); }
  .side-note { margin-left: 6px; font-size: var(--t-xs); font-weight: 400; color: var(--fg-3); }
  .side-scroll { flex: 1; min-height: 0; overflow: auto; }
  .side-card .remaining { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
  .side-card .remaining > div { padding: 7px 10px; border-radius: 10px; background: var(--m3-surface-container, var(--surface-hover)); }
  .side-card .remaining dt { font-size: 11px; line-height: 1.3; word-break: keep-all; }
  .side-card .remaining dd { font-size: 14px; }
  /*
   * 넓은 앨범 칸 = 가운데 트랙 판 + 오른쪽 세부 칸. 문턱 996 = 트랙 판 560 + 세부 칸 400 + 여백 12 × 2 + 칸 사이 12 — 트랙 판이 약 560 아래로
   * 줄기 전에 세부 칸이 트랙 표 아래 칩 · 탭으로 내려간다(채팅이 있으면 세부 칸이 360 이라 문턱에서 트랙 판은 600). 기준은 권한 패널까지 든 앨범 칸
   * 전체 폭이다 — 패널을 여닫아도 배치가 바뀌지 않는다(열리면 패널이 세부 칸 자리를 대신 차지한다).
   */
  @container album-body (min-width: 996px) {
    .album-cols { gap: 12px; padding: 12px; }
    .album-cols > .album-content { border-radius: var(--radius-lg, 16px); background: color-mix(in srgb, var(--accent) 5%, var(--m3-surface-container, var(--bg-panel))); }
    .album-side { display: flex; flex: 0 0 var(--album-side); width: var(--album-side); }
    .album-body .fold { display: none; }
  }
  /* 경로 줄 오른쪽 끝의 [새 탭으로 열기] — 작은 알약(목업) */
  .crumb-pill { font: inherit; font-size: var(--t-xs); color: var(--fg-1); background: var(--control-bg, var(--surface-hover)); border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
  .crumb-pill:hover:not(:disabled) { background: var(--control-bg-hover, var(--surface-hover)); }
  .crumb-pill:disabled { opacity: 0.5; cursor: default; }
  .crumb-pill:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
  /* 권한 패널이 차지한 폭을 뺀 실제 앨범 칸이 머리의 크기 기준이다. */
  .album-content { container: album-content / inline-size; }
  .album-body > :global(.panel) { flex: 0 0 min(380px, 46%); }
  @container (max-width: 560px) { .album-body { flex-direction: column; overflow: auto; } .album-body > :global(.panel) { width: 100%; flex: 1 0 65%; border-left: 0; border-top: 1px solid var(--line); } }
  .screen { display: flex; width: 100%; height: 100%; min-height: 0; }
  .screen > aside { flex: 0 0 35%; min-width: 220px; min-height: 0; display: flex; flex-direction: column; }
  @media (max-width: 620px) { .screen { flex-direction: column; } .screen > aside { min-width: 0; flex-basis: 42%; } }
  /* 플레이어 카드 — 크롬 타일은 판을 비워 두므로 바탕은 여기서 한 번. 판 너비가 좁으면 머리 · 트랙이 접힌다(크기 컨테이너) */
  .board {
    position: relative;
    min-width: 0;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    font-family: var(--font-ui);
    color: var(--fg-1);
    container-type: inline-size;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  /* 트랙 화면 위에 뜨는 앨범 권한 · 조정 패널 — 오른쪽 칸 자리를 덮는다 */
  .track-panel { position: absolute; z-index: 5; inset: 12px 12px 12px auto; width: 380px; max-width: calc(100% - 24px); overflow: auto; background: var(--bg-panel); border-radius: var(--radius-lg, 16px); box-shadow: -8px 0 24px #0003; }

  /* 조율 멈춤 띠 — 판 맨 아래(재생 막대 바로 위) 한 줄. 판이 좁아도 줄 하나(문구는 줄임표 · 단추는 줄지 않는다) */
  .pause-band {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    margin: 0 var(--space-3) var(--space-3);
    padding: 6px 8px 6px 14px;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--warn) 16%, var(--m3-surface-container, var(--bg-panel)));
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    border-radius: 999px;
  }

  .pause-band > :global(svg) {
    flex: 0 0 auto;
    color: var(--warn);
  }

  .pause-text {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pause-band .btn {
    flex: 0 0 auto;
  }

  .head-bare {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) 0;
  }

  .bands {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 28px 0;
  }

  .bands:empty {
    display: none;
  }

  .phrase {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: 999px;
    white-space: nowrap;
  }

  .chip.faint {
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
  }

  .chip.warn {
    background: var(--warn-soft);
    color: var(--fg-1);
  }

  .chip.ok {
    background: var(--ok-soft);
    color: var(--fg-1);
  }

  .grow {
    flex: 1 1 auto;
  }

  .merge-note {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .hold {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--warn-soft);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sm);
  }

  .hold-text {
    flex: 1 1 240px;
    margin: 0;
    font-size: var(--t-sm);
    color: var(--fg-1);
  }

  .integration {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .rec-list {
    list-style: none;
    margin: var(--space-1) 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rec-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
  }

  .confirm {
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
  }

  .confirm-title {
    margin: 0 0 var(--space-1);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .confirm-text {
    margin: 0 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .artist-error {
    margin: 0 12px 12px;
  }

  .error {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    user-select: text;
  }

  /* 트랙 목록의 열 머리 — `TrackRow` 의 격자와 같은 열 */
  .cols {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 150px 160px 60px;
    align-items: center;
    gap: var(--space-3, 12px);
    margin-top: var(--space-2);
    padding: 10px 28px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--line-faint, var(--line));
  }

  .c-no {
    text-align: center;
  }

  .c-time {
    text-align: right;
  }

  .tracks {
    margin: 0;
    padding: 6px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }


  .tail {
    padding: var(--space-2) 28px var(--space-4);
  }

  /* 트랙 표 위 탭 줄(목업 V3FoldA — [트랙 | 타임라인 | 한도]) */
  .album-tabs {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3, 12px) 28px 0;
  }

  /* 그 밖의 아티스트 · 남은 자원이 없으면 빈 꼬리의 여백도 없다 */
  .tail:not(.tab-panel):not(:has(section)) {
    display: none;
  }

  .tab-panel[hidden] {
    display: none;
  }

  /* 트랙 표 아래 늘 보이는 한도 칩 셋 + [한도] 탭 */
  .limit-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }

  .lchip {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background: var(--control-bg, var(--surface-hover));
    white-space: nowrap;
  }

  .lchip b {
    color: var(--fg-1);
    font-weight: 700;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2) var(--space-3) var(--space-4);
  }

  section {
    margin: 0 0 var(--space-3);
  }

  h4 {
    margin: var(--space-2) 0 var(--space-1);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .empty {
    margin: var(--space-2) 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  .empty.pad {
    padding: 0 28px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .worker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--t-sm);
  }

  /* 사람 필요(남은 프로세스) — 의미색 판(새 색 없음): 경고 바탕 띠 */
  .worker.alert {
    padding-left: var(--space-2);
    border-left: 3px solid var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }

  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* 한도 탭 — 남은 한도 칸 격자(이름 위 · 큰 숫자 아래) */
  .remaining {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    margin: var(--space-1) 0 0;
  }

  .remaining > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: var(--radius-surface-inner, 12px);
    background: var(--surface-hover);
  }

  .remaining dt {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .remaining dd {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--fg-1);
  }

  .remaining-note {
    margin: var(--space-2) 0 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 좁은 판 — 열 머리 · 띠의 옆 여백을 줄이고 진행 열을 걷는다(`TrackRow` 와 같은 문턱) */
  @container (max-width: 640px) {
    .bands,
    .album-tabs,
    .tail {
      padding-left: 16px;
      padding-right: 16px;
    }
    .cols {
      grid-template-columns: 28px minmax(0, 1fr) 110px 48px;
      padding: 8px 28px;
    }
    .c-prog {
      display: none;
    }
  }
</style>
