<script lang="ts">
  import {
    agentKindOf,
    agentStatusOf,
    focusAgentIn,
    isLiveAgentPane,
    tabAgents,
  } from "$lib/app/agent-status.svelte.js";
  import {
    conversationsLoading,
    ensureConversations,
    openConversationById,
    paletteConversations,
  } from "$lib/app/agent-sessions.svelte.js";
  import { enabledAgentLimits, loadLimits, usageClock } from "$lib/app/agent-usage.svelte.js";
  import { usagePaletteEntries, usageRings } from "$lib/agent-usage";
  import { allAgentsDisabled } from "$lib/agent-enabled";
  import { aiDisplayName } from "$lib/pane-icons";
  // ---------------------------------------------------------------------
  // 이 파일은 **화면 한 장과 배선**이다 (docs/log/2026-09-05-refactor-page-split.md).
  //
  // 예전에는 여기에 5,900줄이 있었다 — 탭 트리 조작, 티어아웃, 호스트 CRUD,
  // 파일 전송, 키 라우팅, 부팅 순서가 전부 한 컴포넌트 안이었다. 지금은 그 전부가
  // `$lib/app/` 아래 룬 모듈로 내려갔고, 이 파일에 남은 것은 셋뿐이다:
  //
  //   1. **마크업** — 타이틀바·타일 캔버스·시작 화면과 모달 자리(모달 본체는 `$lib/dialogs/`).
  //   2. **효과** — 룬 모듈에는 붙일 컴포넌트 수명이 없다. 그래서 자동 저장·폴링·포커스처럼
  //      `$effect` 가 필요한 것들은 **몸통만 모듈에 두고 효과는 여기서 건다** (아래 한 줄짜리
  //      `$effect` 들이 전부 그 모양이다).
  //   3. **마운트** — `boot()` 과 이벤트 구독 한 벌.
  //
  // 의존 방향은 한 줄이다 (순환 없음):
  //   notice · window → tabs → sessions → panes → hosts → transfer/overlays → keys → boot
  // ---------------------------------------------------------------------
  import { paneProjectLocation } from "$lib/app/project-locations.svelte.js";
  import { paneFocusedAt } from "$lib/app/tabs.svelte.js";
  import { publishWorkspaceStatus } from "$lib/app/workspace-status.svelte.js";
  import { scheduleMirrorPublish } from "$lib/app/mirror-publish.svelte.js";
  import { workspaceDots } from "$lib/workspaces/status";
  import { rawTabStatus, statusOf } from "$lib/app/tabs.svelte.js";
  import { onMount, tick, untrack } from "svelte";
  import PaneHost from "$lib/PaneHost.svelte";
  import Splash from "$lib/Splash.svelte";
  import Tabs from "$lib/Tabs.svelte";
  import WindowTitlebar from "$lib/chrome/WindowTitlebar.svelte";
  import CommandPalette from "$lib/CommandPalette.svelte";
  import CheatSheet from "$lib/CheatSheet.svelte";
  import Dock from "$lib/Dock.svelte";
  import ChatDock from "$lib/ChatDock.svelte";
  import UsageView from "$lib/UsageView.svelte";
  import ResourceView from "$lib/ResourceView.svelte";
  import PlansCover from "$lib/PlansCover.svelte";
  import {
    openUsageView,
    resourceViewOpen,
    toggleResourceView,
    toggleUsageView,
    usageViewOpen,
  } from "$lib/app/usage-view.svelte.js";
  import ConversationViewer from "$lib/ConversationViewer.svelte";
  import { viewConversationById } from "$lib/app/conversation-viewer.svelte.js";
  import FolderConversations from "$lib/FolderConversations.svelte";
  import { folderConversationsVisible } from "$lib/app/folder-conversations.svelte.js";
  import FilePicker from "$lib/FilePicker.svelte";
  import WorkspaceMigrationDialog from "$lib/dialogs/WorkspaceMigrationDialog.svelte";
  import WorkspaceSwitcher from "$lib/WorkspaceSwitcher.svelte";
  import WorkspaceNameDialog from "$lib/dialogs/WorkspaceNameDialog.svelte";
  import WorkspaceEditDialog from "$lib/dialogs/WorkspaceEditDialog.svelte";
  import WorkspaceDeleteDialog from "$lib/dialogs/WorkspaceDeleteDialog.svelte";
  import { workspaceSwitcherVisible } from "$lib/app/workspaces.svelte.js";
  import ProfileSwitcher from "$lib/ProfileSwitcher.svelte";
  import AskAiPicker from "$lib/AskAiPicker.svelte";
  import CodeTermPicker from "$lib/CodeTermPicker.svelte";
  import NewDocBox from "$lib/doc/NewDocBox.svelte";
  import AiLaunchPicker from "$lib/AiLaunchPicker.svelte";
  import { profileSwitcherVisible } from "$lib/app/profile-switcher.svelte.js";
  import { filePickerVisible } from "$lib/app/file-picker.svelte.js";
  import Veil from "$lib/Veil.svelte";
  import SnippetPrompt from "$lib/SnippetPrompt.svelte";
  import SnippetSaveDialog from "$lib/SnippetSaveDialog.svelte";
  import ProjectForm from "$lib/ProjectForm.svelte";
  import WorktreeRemoveDialog from "$lib/WorktreeRemoveDialog.svelte";
  import WorktreeBranchDialog from "$lib/WorktreeBranchDialog.svelte";
  import { openProject, openProjectHere, projects } from "$lib/app/projects.svelte.js";
  import StatusBar from "$lib/StatusBar.svelte";
  import MobileBar from "$lib/mobile/MobileBar.svelte";
  import MobileKeys from "$lib/mobile/MobileKeys.svelte";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import { agentBannerBadge } from "$lib/app/agent-banners.svelte.js";
  import AgentNotifyBanners from "$lib/AgentNotifyBanners.svelte";
  import ReviewCard from "$lib/ReviewCard.svelte";
  import { dockKind, toggleDock, toggleLauncherDock } from "$lib/app/dock.svelte.js";
  import { openMobileAlerts, openMobileChat } from "$lib/app/mobile-sheets.svelte.js";
  import { sideChatsHeadDot } from "$lib/app/side-chat-surface.svelte.js";
  import { sessionSheetOpen } from "$lib/app/session-sheet.svelte.js";
  import SessionSheet from "$lib/SessionSheet.svelte";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { installIdleLock } from "$lib/app/idle-lock.svelte.js";
  import SearchOverlay from "$lib/SearchOverlay.svelte";
  import Toasts from "$lib/Toasts.svelte";
  import Tooltip from "$lib/Tooltip.svelte";
  import StartPage from "$lib/StartPage.svelte";
  import HostForm from "$lib/HostForm.svelte";
  import HostKeyDialog from "$lib/dialogs/HostKeyDialog.svelte";
  import VaultUnlockDialog from "$lib/dialogs/VaultUnlockDialog.svelte";
  import QuitDialog from "$lib/dialogs/QuitDialog.svelte";
  import UpdateDialog from "$lib/dialogs/UpdateDialog.svelte";
  import MasterPromptDialog from "$lib/dialogs/MasterPromptDialog.svelte";
  import AppIconCropDialog from "$lib/dialogs/AppIconCropDialog.svelte";
  import TermThemeDialog from "$lib/dialogs/TermThemeDialog.svelte";
  import PasswordDialog from "$lib/dialogs/PasswordDialog.svelte";
  import PassphraseDialog from "$lib/dialogs/PassphraseDialog.svelte";
  import KeyPickDialog from "$lib/dialogs/KeyPickDialog.svelte";
  import ForwardDialog from "$lib/dialogs/ForwardDialog.svelte";
  import DbPickerDialog from "$lib/dialogs/DbPickerDialog.svelte";
  import DbWriteDialog from "$lib/dialogs/DbWriteDialog.svelte";
  import { addHostDb, openHostDb } from "$lib/app/query.svelte.js";
  import UploadDialog from "$lib/dialogs/UploadDialog.svelte";
  import RemoteEditDialog from "$lib/dialogs/RemoteEditDialog.svelte";
  import KeygenDialog from "$lib/dialogs/KeygenDialog.svelte";
  import RemotePairDialog from "$lib/dialogs/RemotePairDialog.svelte";
  import RemoteDialog from "$lib/dialogs/RemoteDialog.svelte";
  import ConfirmDialog from "$lib/dialogs/ConfirmDialog.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { settings } from "$lib/settings.svelte.js";
  import { wallpaperLayer } from "$lib/wallpaper.svelte.js";
  import { initAppMode } from "$lib/mode.svelte.js";
  import { applyProfile, profileWallpaperSrc, themeProfiles } from "$lib/theme-profiles.svelte.js";
  import { revealOriginFrom, revealTheme } from "$lib/theme-reveal";
  import { snippetPaletteEntries } from "$lib/snippets";
  import { snippets } from "$lib/snippets.svelte.js";
  import { focusedHostAlias, insertSnippet, openSnippetSave } from "$lib/app/snippets.svelte.js";
  import { insertHistoryCommand, windowHistory } from "$lib/app/history.svelte.js";
  import { listPanes, newTab } from "$lib/session";
  import { agentKeyLabel, shortFingerprint } from "$lib/copyid";
  import { showNotice } from "$lib/app/notice";
  import { setHostActions } from "$lib/pane/host-actions";

  import {
    isMainWindow,
    isRemote,
    showThisWindow,
    watchWindowMaximize,
  } from "$lib/app/window.svelte.js";
  import {
    activePaneCount,
    activeTab,
    activeTabId,
    closePaneIn,
    closeOtherTabsAsked,
    closeTabAsked,
    closeTabsToRightAsked,
    findPaneAnywhere,
    focusPane,
    hasActivity,
    markActivity,
    mergeTab,
    movePane,
    noteStatus,
    openTab,
    openTmuxTileIn,
    paneOf,
    promotePane,
    renameTab,
    reorderTabs,
    pickTab,
    selectTab,
    scheduleTabSave,
    setMeasureCanvas,
    splitPaneIn,
    syncActive,
    syncPaneCount,
    syncPanes,
    syncTabs,
    tabBells,
    tabStatus,
    toggleSync,
    togglePaneSync,
    toggleZoom,
    currentWorkspaceTabs,
    residentWindowTabs,
  } from "$lib/app/tabs.svelte.js";
  import { noteSession, sessionOf } from "$lib/app/sessions.svelte.js";
  import { remoteSessionChanged } from "$lib/app/remote-home.svelte.js";
  import {
    reportOscTitle,
    reportResolvedShell,
    reportRunningCommand,
    clearPaneTitle,
  } from "$lib/app/titles.svelte.js";
  import {
    keepDoc,
    unkeepDoc,
    noteDocMode,
    noteDocOutline,
    noteDocEditView,
    noteDocSplit,
    noteDocZoom,
    noteFileView,
    noteFileUi,
    noteLocalFsDir,
    noteSftpDir,
    noteTmuxSession,
    openDocFrom,
    openPathFromTerminal,
    openDocLink,
    openFilesFor,
    sftpRefreshKey,
  } from "$lib/app/panes.svelte.js";
  import { confirmHostKey, promptPassphrase, promptPassword } from "$lib/app/prompts.svelte.js";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import {
    connect,
    connectInNewTab,
    duplicateHost,
    duplicateHostsInto,
    focusHostForm,
    hostCache,
    hostFormVisible,
    hostsRefreshKey,
    forgetHostKeyFor,
    installKeyFor,
    mainDragOver,
    mainDrop,
    offerSaveAdhocHost,
    onWindowFocus,
    openAdd,
    quickConnect,
    openConfig,
    openEdit,
    openGroupTiled,
    openHostsTiled,
    removeHostsAction,
    renameHost,
    setHostCache,
    assignGroupMany,
    dropHostsAsTab,
  } from "$lib/app/hosts.svelte.js";
  import { describeHostRefs } from "$lib/app/host-remove";
  import {
    clearPaneForwards,
    forwardsOf,
    openPresetForwards,
  } from "$lib/app/forwards.svelte.js";
  import {
    closeForwardIfSessionGone,
    closeRemoteEditIfSessionGone,
    closeUploadIfSessionGone,
    dropFiles,
    pasteFsDrag,
    openForwardFor,
    openRemoteEdit,
    openUploadTo,
  } from "$lib/app/transfer.svelte.js";
  import {
    cheatSheetVisible,
    closeCheatSheet,
    closePalette,
    groupMetaMap,
    openKeybindingSettings,
    openSnippetSettings,
    openSettingsAt,
    paletteSeed,
    paletteMirror,
    tileCanvasRect,
    paletteVisible,
    closeSearch,
    searchSeed,
    searchVisible,
  } from "$lib/app/overlays.svelte.js";
  import {
    detachPaneToWindow,
    mergeTearInto,
    mergeTearTab,
    noticeTearRefused,
    startPaneTear,
    startTear,
    tearOut,
    tearOutPane,
  } from "$lib/app/tear.svelte.js";
  import {
    blockNativeContextMenu,
    blockStrayFileDrop,
    blockStrayNavButton,
    onWindowKeydown,
    onWindowKeydownCapture,
    anyModalOpen,
    runAction,
  } from "$lib/app/keys.svelte.js";
  import {
    applyChromeOpacity,
    applyTermOpacity,
    boot,
    closeWhenEmptied,
    mountAppListeners,
    syncDynamicColorToMode,
    syncWallpaperTintNow,
  } from "$lib/app/boot.svelte.js";

  // 앱 모드(다크/라이트/시스템)를 건다 — `<html data-theme>` 이 정해지는 순간 theme.css 의
  // 팔레트가 확정된다. 두 걸음인 이유는 고른 값이 `settings.toml` 의 `[app] mode` 에 있어
  // **동기로 읽을 수 없기** 때문이다: 여기서는 기본 모드로 속성을 걸고 시스템 밝기만
  // 구독해 두고, 저장된 값은 `boot()` 이 `loadSettings` 직후 입힌다.
  initAppMode();

  // ── 호스트 조작 통로 (docs/log/2026-09-05-refactor-structure.md) ────────────
  //
  // 호스트 트리·시작 타일·우클릭 메뉴가 쓰는 콜백 묶음을 **여기서 한 번** 심는다. 예전에는
  // 같은 리터럴을 `<PaneHost hostActions={{…}}>` 로 넘겨 `PaneHost` → `Sidebar` →
  // `HostMenu` 가 차례로 프롭에 이름 열다섯 개씩을 늘어놓고 다시 흘려보냈다. 지금은 그
  // 셋 중 **실제로 부르는 컴포넌트만** `hostActions()` 로 꺼낸다.
  //
  // 초기화에서 한 번만 도는 자리라 값은 안정된 함수 참조들이고, 변하는 하나(`refreshKey`)만
  // **게터**로 담는다 — 꺼내 쓰는 쪽의 `$effect` 가 그 읽기를 의존성으로 등록해, 프롭이
  // 갈아 끼워지던 때와 같은 시점에 목록을 다시 읽는다.
  //
  // 티어아웃으로 뜬 창도 같은 `+page` 라 자기 것을 자기가 심는다 (창마다 한 벌).
  setHostActions({
    onconnect: connect,
    onaddhost: openAdd,
    onedithost: openEdit,
    onnewsession: connect,
    onconnectnew: connectInNewTab,
    // 비밀번호로 1회 접속해 공개키를 심는다 (그 뒤로는 무비밀번호). 로그인과 같은
    // TOFU·비밀번호 모달을 그대로 쓰므로 여기서는 흐름을 부르기만 한다.
    oninstallkey: (host) => void installKeyFor(host),
    onrenamehost: renameHost,
    onduplicatehost: (host) => void duplicateHost(host),
    // known_hosts 기록 지우기 (`ssh-keygen -R` 상당) — 확인은 그 함수가 `ask()` 로 받는다.
    onforgethostkey: (host) => void forgetHostKeyFor(host),
    // 검색이 아무것도 못 맞췄을 때의 "빠른 접속으로 연결" — 팔레트의 맨 윗줄과 **같은 함수**다.
    onquickconnect: quickConnect,
    onremovehosts: (names) => void removeHostsAction(names),
    // 제거 확인 문구의 "함께 정리됩니다" 한 줄 — 세는 것도 치우는 것도 `app/host-remove` 다.
    onhostrefs: describeHostRefs,
    onopenconfig: openConfig,
    onassigngroups: (names, group) => void assignGroupMany(names, group),
    onduplicatehosts: (items) => void duplicateHostsInto(items),
    onhosts: setHostCache,
    // 우클릭 "DB 열기 ›" — 그 호스트의 DB 연결 프리셋을 지금 탭에 쿼리 타일로 (쿼리 타일 6단계)
    onopendb: openHostDb,
    onadddb: addHostDb,
    onnotice: showNotice,
    // 우클릭 "전체 열기 (타일)" — 끌어다 놓을 터미널이 아직 없을 때의 진입점이다.
    // 대상은 **그 트리가 말한 타일**(= 지금 탭의 포커스된 타일)이고 방향은 오른쪽
    // 절반(row·after)으로 못 박는다.
    //
    // 탭이 하나도 없을 때(시작 화면 위에 독만 떠 있는 상태)는 **탭 바 드랍과 같은 길**로
    // 보낸다 — 대상 타일이 없다고 조용히 아무 일도 안 하면 메뉴 항목이 죽은 것처럼 보인다.
    onopenhosts: (tabId, paneId, payload) => {
      if (currentWorkspaceTabs().length === 0) void dropHostsAsTab(payload, null);
      else void openHostsTiled(tabId, paneId, "row", "after", payload);
    },
    get refreshKey() {
      return hostsRefreshKey();
    },
  });

  // 모듈의 읽기 함수 중 **한 번의 렌더에서 여러 번 읽히거나 훑는 비용이 있는 것**만
  // `$derived` 로 감싼다 — 모듈 쪽은 함수라 캐시가 없고(그 편이 순환 없이 단순하다),
  // 캐시가 필요한 자리는 그것을 쓰는 화면이 정하는 것이 맞다.
  // 에이전트가 살아 있는 타일의 `running` 은 접지 않는다 — 그 타일의 지금은 에이전트 점이 말한다
  const tabBadges = $derived(tabStatus(isLiveAgentPane));
  const bellBadges = $derived(tabBells());
  // 에이전트 상태 점 — 활성 탭도 포함한 **지금의 상태** (docs/log/2026-09-24-agent-status-dot.md)
  const agentBadges = $derived(tabAgents());
  const syncOnTabs = $derived(syncTabs());

  // 상태바 자리 — 원격 창의 모바일 배치(R5)면 늘 위 가로 줄(세로 기둥은 좁은 폭을 먹는다 · 설정은 그대로 둔다)
  const barPos = $derived(mobileLayout() ? "top" : settings.statusBar);
  /** 제목줄 높이(px · `--titlebar-h`) — 캔버스의 위 끝: 감싸기 + 글래스 흐림 판의 구멍 · `.canvas-edge` 의 선 자리 · L 판의 마스크.
      탭 모양마다 높이가 달라 CSS 로 셀 수 없다 */
  let titlebarH = $state(0);

  // ---------------------------------------------------------------------
  // 월페이퍼 — 창 **전체**를 덮는 배경 레이어 하나 (docs/log/2026-09-04-wallpaper.md).
  //
  // `--chrome-pct` 처럼 `documentElement` 에 인라인하지 않고 **자기 요소의 style 속성**에
  // 담는다: 이 값들은 그 레이어 하나만 쓰는 것이라, 전역 토큰으로 올리면 어디서 읽히는지
  // 알 수 없는 변수가 다섯 개 늘어난다.
  //
  // 배경이 없으면 요소 자체를 렌더하지 않는다 (`{#if}`) — 빈 레이어가 남아 있으면 합성
  // 레이어 하나를 공짜로 들고 다니는 셈이다.
  // ---------------------------------------------------------------------
  const wpLayer = $derived(wallpaperLayer());
  const wallpaperOn = $derived(wpLayer.image !== "none");
  const wallpaperStyle = $derived(
    [
      `--wp-image:${wpLayer.image}`,
      `--wp-size:${wpLayer.size}`,
      `--wp-repeat:${wpLayer.repeat}`,
      `--wp-position:${wpLayer.position}`,
      `--wp-blur:${wpLayer.blur}`,
      `--wp-scale:${wpLayer.scale}`,
      `--wp-dim:${wpLayer.dim}`,
    ].join(";"),
  );

  // ── 효과 (몸통은 전부 `$lib/app/` 안에 있다) ──────────────────────────────

  /** 구조가 바뀌면 배치를 저장한다 — 500ms 디바운스 */
  $effect(() => scheduleTabSave());
  /** 집 PC 주 창의 배치를 원격 창 거울에 올린다 — 100ms 디바운스(원격 웹 R2-B · `app/mirror-publish`) */
  $effect(() => scheduleMirrorPublish());
  $effect(() => {
    const tabs = residentWindowTabs();
    const commands = Object.fromEntries(Object.entries(rawTabStatus(isLiveAgentPane)).map(([id, status]) =>
      [id, { state: status.state, name: "", others: status.others }]));
    const dots = workspaceDots(tabs, commands, tabAgents(), hasActivity, t);
    const tiles = tabs.flatMap((tab) => listPanes(tab.root).filter((pane) => pane.historyStreamId).map((pane) => ({
      workspaceId: tab.workspaceId!, streamId: pane.historyStreamId!, tabId: tab.id, paneId: pane.id,
      folder: paneProjectLocation(pane, tab.projectFolder)?.folder, tileKey: pane.tileKey, tabKey: tab.tabKey,
      projectId: tab.projectId, focusedAt: paneFocusedAt(pane.id),
      status: statusOf(pane.id), connected: sessionOf(pane.id) !== null,
      kind: pane.kind === "ssh" ? "ssh" as const : "local" as const,
      alias: pane.kind === "ssh" ? pane.alias ?? null : null,
      agent: isLiveAgentPane(pane) ? { kind: agentKindOf(pane)!, status: agentStatusOf(pane) } : null,
    })));
    const locations = tabs.flatMap((tab) => listPanes(tab.root).flatMap((pane) => {
      const place = paneProjectLocation(pane, tab.projectFolder);
      return place && tab.workspaceId ? [{ ...place, workspaceId: tab.workspaceId, tabId: tab.id, paneId: pane.id,
        tabKey: tab.tabKey, tileKey: pane.tileKey, projectId: tab.projectId, focusedAt: paneFocusedAt(pane.id) }] : [];
    }));
    publishWorkspaceStatus(dots, tiles, locations);
  });
  // 팔레트를 처음 열면 지난 대화를 한 번 읽어 둔다 — `대화 ` 로 찾을 때 목록이 이미 있게
  // (docs/log/2026-09-26-agent-sessions.md). 이미 읽었으면 아무것도 하지 않는다.
  $effect(() => {
    if (paletteVisible()) untrack(ensureConversations);
  });
  /** 분리 창이 비면 스스로 닫힌다 (메인 창은 시작 화면을 그리며 남는다) */
  $effect(() => closeWhenEmptied());
  /** 창 크롬·터미널 투명도 — 설정이 바뀌면 그 자리에서 다시 건다 */
  $effect(() => applyChromeOpacity());
  $effect(() => applyTermOpacity());
  /** 앱 모드가 실제로 바뀌었을 때만 월페이퍼 팔레트를 다시 뽑는다 */
  $effect(() => syncDynamicColorToMode());
  /** 은은하게 — 배경이나 단계가 바뀌면 사진의 기운을 다시 읽는다 (파일에 적지 않는 값이다) */
  $effect(() => syncWallpaperTintNow());

  /** 모달이 뜨면 곧바로 고칠 칸에 커서를 둔다 — 호스트 폼. 나머지 모달은 자기 파일(`dialogs/*`)이 건다 */
  $effect(() => {
    if (hostFormVisible()) focusHostForm();
  });

  /** 세션이 사라지면 그 세션에 매달린 모달을 닫는다 (업로드는 전송 중이면 그대로 둔다) */
  $effect(() => closeForwardIfSessionGone());
  $effect(() => closeUploadIfSessionGone());
  $effect(() => closeRemoteEditIfSessionGone());

  // ---------------------------------------------------------------------
  // **시작 스플래시** (docs/log/2026-09-17-splash.md)
  //
  // 메인 창은 `visible:false` 로 태어난다. 순서가 전부다:
  //
  //   첫 렌더(스플래시) → 첫 프레임이 실제로 칠해짐 → `show()` → `boot()` → 걷힘
  //
  // 창을 띄우기 **전에** 한 프레임을 보내는 것이 요점이다. 마운트 직후에 띄우면 웹뷰가 아직
  // 아무것도 합성하지 않아 예전과 같은 빈 사각형이 한 번 보인다.
  //
  // 분리 창은 이 층을 **아예 그리지 않는다** — 보이는 채로 태어나고(Rust 의
  // `WebviewWindowBuilder`), 부팅도 짐을 받는 한 걸음이라 덮을 것이 없다.
  // ---------------------------------------------------------------------
  let booted = $state(false);
  /** 페이드까지 끝나 층을 걷었는가 (분리 창은 처음부터 걷힌 상태다) */
  let splashDone = $state(!isMainWindow);

  /** 다음 프레임이 **칠해진 뒤**로 미룬다 — rAF 한 번은 "그리기 직전" 이라 아직 이르다 */
  function afterFirstPaint(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  async function startup(): Promise<void> {
    let shownAt = 0;
    if (isMainWindow) {
      await afterFirstPaint();
      // 실패해도 부팅을 막지 않는다 (그 함수가 console.warn 한 줄로 삼킨다).
      await showThisWindow();
      shownAt = performance.now();
    }
    try {
      // 설정 → (분리 창이면) 이관 짐 → (메인 창이면) 배치 복원, 이 순서다 (`boot` 참고).
      await boot();
    } catch (err) {
      // **스플래시는 절대 남지 않는다** — 부팅이 죽어도 아래 `finally` 가 층을 걷는다.
      // 부팅의 각 단계는 스스로 실패를 삼키므로 여기 오는 것은 예상 밖의 예외뿐이다.
      console.error("[boot] 부팅 중 오류", err);
    } finally {
      booted = true;
      // 콜드 스타트를 CDP 로 읽는 한 줄 (docs/log/2026-09-17-splash.md 의 "재는 법").
      if (isMainWindow) {
        console.info("[boot] splash shown at", shownAt, "booted at", performance.now());
      }
    }
  }

  onMount(() => {
    void startup();
    // 사용 한도 % — 상태바 경고용으로 한 번(싸다 — docs/log/2026-09-26-agent-usage.md)
    void loadLimits();
    const unlistenApp = mountAppListeners();
    const unwatchMax = watchWindowMaximize();
    // 무입력 자동 잠금 — 설정이 켜져 있을 때만 실효(모듈이 매 틱 설정을 다시 읽는다).
    const unwatchIdle = installIdleLock();
    return () => {
      unlistenApp();
      unwatchMax();
      unwatchIdle();
    };
  });
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  onkeydowncapture={onWindowKeydownCapture}
  onfocus={onWindowFocus}
  ondragover={blockStrayFileDrop}
  ondrop={blockStrayFileDrop}
  onmouseup={blockStrayNavButton}
  onauxclick={blockStrayNavButton}
  oncontextmenu={blockNativeContextMenu}
/>

<!--
  월페이퍼 — 타이틀바·타일 캔버스·시작 화면 **전부의 뒤**에 깔리는 고정 레이어 하나.

  `z-index: -1` 이 요점이다. html 의 불투명한 `background: var(--bg-base)` 는 캔버스 배경이라 가장 먼저
  칠해지고, 음수 z-index 요소는 그 **위·모든 본문 아래**에 온다 — 그래서 `.titlebar`·`.body`
  에 z-index 를 새로 붙이지 않아도 순서가 맞는다.

  그 위에 얹히는 `--bg`/`--bg-panel` 은 투명도 슬라이더로 합성된 반투명 색이므로, 슬라이더는
  **"이미지 위에 크롬 · 타일을 얼마나 진하게 덮나"** 로 읽힌다(창 밖은 비치지 않는다 — 10-22).
  터미널 타일에는 **자기 슬라이더**가 있어 같은 이야기를 한 겹 더 한다.
-->
{#if wallpaperOn}
  <div class="wallpaper" aria-hidden="true" style={wallpaperStyle}></div>
{:else if settings.material === "glass"}
  <!--
    재질 글래스 + 월페이퍼 없음 — 유리 뒤가 단색이면 판이 회색으로만 읽힌다(2026-10-11). 월페이퍼와 같은 자리
    (`z-index: -1`, 창 바탕 위·모든 본문 아래)에 크롬 토큰에서 만든 옅은 번짐(`--glass-glow`)을 한 겹 깐다.
    월페이퍼가 있으면 그것이 이 역할이라 깔지 않는다. 평면이면 요소 자체가 없다.
  -->
  <div class="glass-glow" aria-hidden="true"></div>
{/if}

<!--
  **상태바** — 자리(위·아래·왼쪽·오른쪽)마다 DOM 부모가 달라 한 벌의 마크업을 스니펫으로
  빼 두고 `{#if}` 로 **딱 하나만** 그린다 (기본 = 위).
  - 가로(위·아래)는 앱 열(`.app`)의 전폭 행이라 `.body` 바깥에 선다.
  - 세로(왼쪽·오른쪽)는 본문 높이만 차지해야 하므로 `.body` **안의 진짜 flex 자식**으로
    넣는다 (그래야 `.pane` 이 그 폭만큼 줄어든다). 왼쪽은 독과 겹치므로 아래 CSS 가 독을 민다.
-->
{#snippet statusbar()}
  <StatusBar
    position={barPos}
    inline={barPos === "top" && !mobileLayout()}
    barStyle={settings.statusBarStyle}
    blocked={anyModalOpen() || veilVisible()}
    dockOpen={dockKind()}
    usageOpen={usageViewOpen()}
    resourcesOpen={resourceViewOpen()}
    resources={settings.resourceRings}
    pendingPlans={pendingCount()}
    agentAlerts={agentBannerBadge()}
    autoApprove={settings.automationPrefs.auto_approve}
    usageRings={settings.usageRings
      ? usageRings(enabledAgentLimits(), usageClock(), t, locale(), (a) => aiDisplayName(a) ?? a)
      : []}
    onusage={() => toggleUsageView()}
    onresources={() => toggleResourceView()}
    keybindings={settings.current.keybindings}
    onalerts={() => (mobileLayout() ? openMobileAlerts() : toggleDock("alerts"))}
    onchat={isRemote && mobileLayout() ? openMobileChat : undefined}
    chatDot={isRemote && mobileLayout() ? sideChatsHeadDot() : null}
    onlauncher={toggleLauncherDock}
  />
{/snippet}

<div
  class="app"
  class:mobile={mobileLayout()}
  data-statusbar={barPos}
  data-statusbar-style={settings.statusBarStyle}
  style:--titlebar-h={`${titlebarH}px`}
>
  <!--
    원격 창의 모바일 배치(R5 — 폭 < 720px): 탭 바 자리에 위 띠(고른 타일 알약 → 탭 · 타일 고르기 화면 · 크기 맞추기), 맨 아래에 키 띠 · 입력 칸.
    타일은 고른 하나만 그린다(`PaneHost` 의 `solo`). 상태바는 위 가로 줄로(세로 기둥은 좁은 폭을 먹는다).
  -->
  {#if mobileLayout()}<MobileBar />{:else}
  <!--
    커스텀 타이틀바 — 탭 바가 곧 창 제목줄이다 (decorations:false). 창 제어 · 제목줄 CSS 는 `chrome/WindowTitlebar.svelte`,
    탭 바 배선은 여기(부모의 상태)다. 높이는 `--titlebar-h` 로 쓴다.
  -->
  <!-- 위 상태바는 이 줄 **안**이다(2026-10-28 — 탭 뒤 · 창 단추 앞, 오른쪽 끝 기준 · `StatusBar` 의 `inline`) -->
  <WindowTitlebar position={barPos} barStyle={settings.statusBarStyle} bind:height={titlebarH}
    status={barPos === "top" ? statusbar : undefined}>
    <Tabs
      tabs={currentWorkspaceTabs()}
      activeId={activeTabId()}
      {hasActivity}
      tabStatus={tabBadges}
      tabBells={bellBadges}
      agents={agentBadges}
      onagentdot={focusAgentIn}
      tabStyle={settings.tabStyle}
      onselect={pickTab}
      ondragselect={selectTab}
      onclose={(id) => void closeTabAsked(id)}
      oncloseothers={(id) => void closeOtherTabsAsked(id)}
      oncloseright={(id) => void closeTabsToRightAsked(id)}
      onnewtab={() => openTab(newTab())}
      onrename={renameTab}
      onreorder={reorderTabs}
      onpromotepane={promotePane}
      ondrophosts={(payload, beforeId) => void dropHostsAsTab(payload, beforeId)}
      ontearstart={startTear}
      ontearout={(x, y) => tearOut(x, y)}
      ontearrefused={noticeTearRefused}
      ontearmerge={(token, before) => void mergeTearTab(token, before)}
      syncTabs={syncOnTabs}
      onsynctoggle={toggleSync}
    />
  </WindowTitlebar>
  {/if}

  <!-- 위: 데스크톱은 제목줄 안(위). 폰 배치(`MobileBar` — 제목줄 없음)만 예전처럼 위 띠 아래 전폭 행 -->
  {#if barPos === "top" && mobileLayout()}{@render statusbar()}{/if}

  <!--
    본문 — 타일 캔버스와, 그 위에 뜨는 **독** 하나.

    2026-09-03 에 왼쪽 고정 칼럼을 없애고 호스트 트리를 `kind:"hosts"` 타일로 옮겼고,
    9/8 에 그 타일을 다시 지웠다 — 호스트 목록은 이제 타일 트리 밖의 떠 있는 층 하나뿐이다
    (docs/log/2026-09-08-hosts-dock.md · docs/log/2026-09-08-remove-hosts-tile.md).
    설정은 그 층과 타일 형태를 함께 갖는다 (docs/log/2026-09-08-settings-dock.md).
  -->
  <!-- `data-slide-bleed` — 둥근 패널이면 탭 전환 슬라이드가 캔버스 거터에서 잘리지 않고 패널 뒤로 창 끝까지 지나간다(`PaneHost` 의 `.sliding`) -->
  <div class="body" data-statusbar={barPos} data-statusbar-style={settings.statusBarStyle}
    data-slide-bleed={settings.statusBarStyle === "panel" && !mobileLayout() ? "" : undefined}>
    <!--
      왼쪽: 본문 높이만큼의 세로 기둥. 진짜 flex 자식이라 `.pane` 이 그 폭만큼 줄어든다.
      독은 `.body` 왼쪽 가장자리에서 뜨므로 겹친다 — `data-statusbar="left"` 가 아래 CSS 에서
      독의 `left` 를 기둥 폭만큼 밀어 둘이 나란히 서게 한다.
    -->
    {#if barPos === "left"}{@render statusbar()}{/if}
    <!--
      **독** — 창마다 하나이고 **내용만 갈아 끼운다**(호스트 `Ctrl+Shift+H` · 설정
      `Ctrl+,`). 탭 트리에 들어가지 않고 배치에도 저장되지 않는다. `.body` 안에 두는 것이
      요점이다: 이 요소가 곧 "타이틀바 아래" 를 뜻하는 기준 상자라, 탭 바 높이를 숫자로
      적을 자리가 없다 (탭 모양마다 그 높이가 다르다).
    -->
    <!--
      **채팅 독**(2026-10-23) — 런처 독의 반대쪽 창 끝(`[dock] layout`). 사람 창의 데스크톱 폭에 선다 — 집 PC 주 창 · 원격 웹 창
      (2026-11-01 — 원격 폰 배치는 독 대신 `MobileBar` 의 폰 덮개 · 보조 창에는 없다).
      런처 독보다 **앞**에 둔다 — 같은 z-index 라 뒤에 오는 설정 모달 · 배경막이 이것을 덮는다.
    -->
    {#if isMainWindow || (isRemote && !mobileLayout())}<ChatDock />{/if}
    <Dock />
    <!--
      **에이전트 알림 배너** — 턴 끝 · 권한 물음이 이 상자의 위 가운데에 쌓인다
      (docs/log/2026-09-27-agent-banners.md). `.body` 안이라 탭 바와 위 상태바 **아래**에 선다.
    -->
    <AgentNotifyBanners />
    <!--
      **검토 대기 카드** — AI 작업안이 사람을 기다리는 동안 이 상자의 **아래 가운데**에 선다
      (docs/log/2026-09-27-review-popup-card.md). 배너와 같은 이유로 `.body` 안이다: 아래
      상태바가 서면 `.body` 가 그 위에서 끝나 카드가 저절로 띠 바로 위에 앉는다. 대기가 없으면
      아무것도 그리지 않는다(분리 창에서는 목록이 영영 비어 있다 — 메인 창 전용).
    -->
    <ReviewCard />
    <!-- `data-tile-canvas` — 칸 없이 여는 팔레트가 이 상자 가운데에 선다(`tileCanvasRect`) -->
    <div class="pane" data-tile-canvas>
    <!-- 상태바 감싸기 — 아래 두 모서리 조각(위 두 모서리는 `.pane` 의 ::before · ::after). 감싸기가 아니면 그리지 않는다 -->
    <span class="hug-c hug-c3" aria-hidden="true"></span><span class="hug-c hug-c4" aria-hidden="true"></span>
    <!--
      **사용량 화면** — 타일 캔버스(`.pane`)를 통째로 덮는 불투명한 판(상태바 사용량 고리로 여닫는다 ·
      `app/usage-view.svelte.ts`). `.pane` 안에 두는 것이 요점이다: 옆·아래에 선 상태바와 탭 바는 가려지지 않고,
      타일은 그 밑에서 마운트된 채 돈다. (같은 자리에 서던 전체 화면 대시보드는 2026-10-07 에 세션 목록 판과
      작업안 타일로 나뉘어 없어졌다.)
    -->
    <UsageView />
    <!--
      **자원 화면** — 사용량 화면과 같은 급 · 같은 자리의 둘째 판(상태바 자원 고리 · 타일 자원 칩으로 연다). 한 번에 하나만 선다
      (`app/usage-view.svelte.ts`).
    -->
    <ResourceView />
    <!--
      **원격 창의 작업안 판**(2026-10-25) — 작업안은 집 PC 주 창의 채팅 독 갈래에 산다. 원격 창(데스크톱 폭)은 집 PC 레이아웃을 바꾸지 않고
      이 판으로 본다(폰 배치는 `MobileBar` 의 폰 덮개) — 작업안 몸통이 한 창에 둘 서지 않게 여기서만 마운트한다.
    -->
    {#if isRemote && !mobileLayout()}
      <PlansCover />
    {/if}
    <!--
      **세션 목록 판** — 캔버스 위쪽 가장자리에서 내려오는 덮개(`open-console` · 상태바 세션 칸 ·
      `app/session-sheet.svelte.ts`). 타일 크기를 바꾸지 않는다. 모달 · 가림막이 서면 스스로 접힌다.
    -->
    {#if sessionSheetOpen()}
      <SessionSheet blocked={anyModalOpen() || veilVisible()} />
    {/if}
    <!--
      **기록 보기** — 지난 대화 하나를 읽기 전용으로 펼치는 시트. 캔버스 오른쪽에 뜬다(사용량 화면 위 ·
      독 옆). 떠 있지 않으면 아무것도 그리지 않는다 (docs/log/2026-09-27-conversation-viewer.md).
    -->
    <ConversationViewer />
    <!--
      동시 입력 배너 — **닫기 버튼이 없다.** 위험한 모드를 켜 둔 채 표시만 지울 수 있으면
      경고의 의미가 없다. 끄는 방법은 탭 메뉴의 토글 하나뿐이다.
    -->
    {#if syncActive()}
      <p class="sync-banner" role="status">
        <span class="mark"><UiIcon name="sync" size={13} /></span>
        {t("app.sync.banner", { on: syncPaneCount(), total: activePaneCount() })}
        {#if syncPaneCount() === 0}
          <span class="hint">{t("app.sync.hint.none")}</span>
        {:else if activePaneCount() < 2}
          <span class="hint">{t("app.sync.hint.single")}</span>
        {:else if syncPaneCount() < activePaneCount()}
          <span class="hint">{t("app.sync.hint.partial")}</span>
        {/if}
      </p>
    {/if}

    <!--
      드랍은 두 곳에서 받는다: 패널 위(→ 그 자리에 분할·병합)는 `PaneHost`, **탭이
      하나도 없을 때의 빈 본문**(→ 새 탭)은 여기. 있으면 아래 핸들러는 즉시 빠지므로
      둘이 겹치지 않는다 (게다가 `PaneHost` 의 drop 은 전파를 멈춘다).
    -->
    <main ondragover={mainDragOver} ondrop={mainDrop}>
      <!--
        **앱 전역 패널 호스트** — 모든 탭의 모든 패널이 여기 한 keyed 목록에 있다.
        비활성 탭의 패널도 인스턴스를 유지한다 (display:none — 스크롤백 보존).
        탭을 옮겨도 키(pane.id)가 같으므로 style 만 바뀐다 = 세션이 안 끊긴다.
        docs/log/2026-09-02-pane-host.md · docs/log/2026-09-03-hosts-tile.md
      -->
      <!--
        원격 창(집 PC 거울)은 **원격이 보는 워크스페이스의 탭만** 세운다 — 거울에는 집 PC 의 워크스페이스가 전부 실려 오지만(10-20 워크스페이스
        칩) 숨은 워크스페이스의 터미널까지 시청자로 붙으면 폰으로 오는 출력이 워크스페이스 수만큼 는다. 워크스페이스를 바꾸면 그쪽 타일이
        새로 붙는다(타일 id 는 그대로라 돌아오면 같은 상자).
      -->
      <PaneHost
        tabs={isRemote ? currentWorkspaceTabs() : residentWindowTabs()}
        activeId={activeTabId()}
        focusedPaneOf={paneOf}
        {syncPanes}
        hosts={hostCache()}
        keybindings={settings.current.keybindings}
        onfocuspane={focusPane}
        onclosepane={closePaneIn}
        onzoompane={toggleZoom}
        onsyncpane={togglePaneSync}
        onsplitpane={splitPaneIn}
        onforwardpane={openForwardFor}
        ondetachpane={(tabId, paneId) => void detachPaneToWindow(tabId, paneId)}
        ondrophosts={(tabId, targetPaneId, dir, side, payload) =>
          void openHostsTiled(tabId, targetPaneId, dir, side, payload)}
        ondroptab={mergeTab}
        onmovepane={movePane}
        ontearstart={startPaneTear}
        ontearoutpane={(x, y) => void tearOutPane(x, y)}
        ontearrefused={noticeTearRefused}
        ontearmergeinto={(token, tabId, paneId, dir, side) =>
          void mergeTearInto(token, tabId, paneId, dir, side)}
        onfiledrop={dropFiles}
        onfspaste={pasteFsDrag}
        oneditremote={openRemoteEdit}
        {sessionOf}
        {forwardsOf}
        onopenfiles={openFilesFor}
        onsftpupload={(paneId, dir, files) =>
          openUploadTo(paneId, t("app.upload.paneLabel", { dir }), dir, files)}
        onlocalupload={(paneId, dir, files) => openUploadTo(paneId, dir, dir, files)}
        onsftpcwd={noteSftpDir}
        onlocalcwd={noteLocalFsDir}
        onfileview={noteFileView}
        onfileui={noteFileUi}
        onopendoc={openDocFrom}
        onopenpath={(tabId, paneId, target, line) => void openPathFromTerminal(tabId, paneId, target, line)}
        ondocmode={noteDocMode}
        ondocoutline={noteDocOutline}
        ondoceditview={noteDocEditView}
        ondocsplit={noteDocSplit}
        ondoczoom={noteDocZoom}
        ondockeep={keepDoc}
        ondocunkeep={unkeepDoc}
        ondoclink={(tabId, paneId, link, anchor) => void openDocLink(tabId, paneId, link, anchor)}
        sftpRefreshKey={sftpRefreshKey()}
        onactivity={markActivity}
        onstatus={noteStatus}
        onsession={(id, sid) => {
          noteSession(id, sid);
          // 원격 `$HOME` 사본 — `~` 에서 연 타일이면 붙는 순간 한 번 묻고, 그 별칭의 마지막 세션이
          // 사라지면 버린다(`noteSession` **뒤**여야 사라진 세션이 "아직 산다" 로 잡히지 않는다).
          remoteSessionChanged(id, sid, sid !== null ? findPaneAnywhere(id) : null);
          // **빠른 접속 타일이 실제로 붙은 순간** — "호스트로 저장" 을 한 번 권한다
          // (docs/log/2026-09-16-quick-connect-and-host-keys.md). 세션 id 가 붙는 이 자리가
          // 접속 성공의 유일한 증거다 (`openSession` 은 순수 모듈이라 토스트를 모른다).
          // 원격 창의 시청자 타일(R2-B)은 남의 접속을 본다 — 호스트 저장 권유 · 저장해 둔 포워딩 열기는 그 세션을 연 집 PC 의 일이다.
          if (sid !== null && !isRemote) {
            const pane = findPaneAnywhere(id);
            if (pane) {
              offerSaveAdhocHost(pane);
              // **호스트에 저장해 둔 포워딩을 여는 유일한 자리.** 첫 접속도 자동 재연결도
              // `Terminal.startSession` 한 곳을 지나 여기로 오므로 두 길이 한 번에 덮인다.
              // 기다리지 않는다 — 접속은 이미 끝났고, 실패해도 그 안에서 토스트 한 줄로
              // 끝난다 (docs/log/2026-09-17-forward-presets.md).
              void openPresetForwards(pane, sid);
            }
          }
          // 세션이 사라졌다(종료·닫힘·이관 언마운트) = 표시 제목도 거둔다 — 재사용된 타일
          // id 가 옛 OSC 제목·셸을 물려받지 않게 한다 (표시 전용 저장소 `app/titles`).
          if (sid === null) {
            clearPaneTitle(id);
            // 세션과 함께 그 세션의 포워드도 백엔드가 이미 거뒀다 — 칩도 그 자리에서 내린다.
            clearPaneForwards(id);
          }
        }}
        ontitle={(id, title) => reportOscTitle(id, title)}
        onshell={(id, shell) => reportResolvedShell(id, shell)}
        ontmux={(id, name) => noteTmuxSession(id, name)}
        onopentmux={openTmuxTileIn}
        oncommand={(id, command) => reportRunningCommand(id, command)}
        onmeasure={setMeasureCanvas}
        {confirmHostKey}
        {promptPassword}
        {promptPassphrase}
      />

      {#if currentWorkspaceTabs().length === 0}
        <!--
          탭을 **전부 닫았을 때** — 시작 타일과 **같은 화면**을 본문에 그대로 그린다
          (docs/log/2026-09-04-start-page.md). 사용자가 있는 상태가 사실 같기 때문이다:
          "아직 아무것도 열지 않았다".

          줄은 여느 때와 **같은 함수**로 들어가고(`connect`·`openProject`), 그
          함수들이 `currentTab()` 에서 탭을 하나 만든다. 새 탭은
          시작 타일 하나라 곧바로 교체되므로 사용자는 깜빡임 없이 결과 타일만 본다.
        -->
        <div class="tile-canvas">
          <div class="no-tab-start tile-frame chrome">
            <StartPage hosts={hostCache()} />
          </div>
        </div>
      {/if}
    </main>
  </div>
    <!-- 오른쪽: 본문 오른쪽 가장자리의 세로 기둥. `.pane` 뒤 flex 자식이라 오른쪽 끝에 선다 (독 충돌 없음). -->
    {#if barPos === "right"}{@render statusbar()}{/if}
  </div>
  <!-- 아래: 모든 것 아래의 전폭 행. `.app` 의 마지막 자식이라 `.body` 는 flex:1 그대로다. -->
  {#if barPos === "bottom"}{@render statusbar()}{/if}
  <!-- 캔버스 가장자리 — 평면 띠 왼쪽 · 오른쪽이면 탭 줄 아래 선과 기둥 안쪽 선을 한 L 로, 글래스면 탭 줄 아래 변의 선.
       띠 · 기둥보다 뒤 차례라 그 위에 선다 -->
  <span class="canvas-edge" aria-hidden="true"></span>
  <!-- 평면 띠 왼쪽 · 오른쪽 — L 이 꺾이는 안쪽 모서리 하나를 타일과 같은 곡률로(2026-11-03 · 아래 `.canvas-corner` 절) -->
  <span class="canvas-corner" aria-hidden="true"></span>
  {#if mobileLayout()}<MobileKeys />{/if}
  <!--
    토스트 — **앱에 한 벌**이다 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
    큐는 `$lib/toast.svelte` 가 들고 있어 타일 안에서 밀어 넣은 알림도 여기 한 자리에 뜬다.
    `.app` 안에 두는 까닭은 상태바 폭(`--sb-inset-right`)을 받기 위해서다 — `.app` 은 쌓임 맥락 · 고정 기준 상자를 만들지 않아 `position: fixed` · `z-index` 는 그대로다.
  -->
  <Toasts />
</div>

<!--
  명령 팔레트 — `{#if}` 로 **마운트/언마운트**한다. 질의 문자열이 컴포넌트의 지역 상태라
  닫으면 저절로 비워지고, 열면 마운트 `$effect` 가 입력에 포커스를 준다.

  콜백은 전부 **이미 있던 함수 그대로**다 — 팔레트로 여는 것과 트리에서 여는 것이 같은
  코드로 가야 규칙(스크롤백 상속·그룹 6개 확인·동시 입력 편입)이 갈리지 않는다.

  스니펫 줄은 **여기서 걸러 내려 준다** (docs/log/2026-09-16-snippets.md): 범위 판정은 순수
  규칙(`snippetPaletteEntries`)이고 "지금 어느 호스트가 포커스인가" 는 앱 상태라, 팔레트는
  둘 중 어느 것도 알지 않는다. 포커스가 옮겨 가면 이 식이 다시 돌아 목록이 따라간다.
-->
{#if paletteVisible()}
  <CommandPalette
    hosts={hostCache()}
    groupMeta={groupMetaMap()}
    tabs={currentWorkspaceTabs()}
    themeProfiles={themeProfiles()}
    snippets={snippetPaletteEntries(snippets(), focusedHostAlias())}
    history={windowHistory()}
    hostHistory={hostHistory()}
    projects={projects()}
    conversations={paletteConversations()}
    conversationsLoading={conversationsLoading()}
    onopenconversation={(agent, id, fork) => openConversationById(agent, id, fork, viewConversationById)}
    onviewconversation={viewConversationById}
    noAgents={allAgentsDisabled(settings.disabledAgents)}
    usage={usagePaletteEntries(enabledAgentLimits(), usageClock(), t, (a) => aiDisplayName(a) ?? a)}
    onopenusage={() => {
      // 팔레트가 닫히며 다음 틱에 포커스를 타일로 돌려준다 — 그 길(`focusTile`)이 사용량 화면을 걷으므로 그 뒤에 연다
      void tick().then(() => openUsageView());
    }}
    onopenproject={(p) => void openProject(p)}
    onopenprojectnew={(p) => void openProjectHere(p)}
    seed={paletteSeed()}
    mirror={paletteMirror()}
    measureCanvas={tileCanvasRect}
    activeTabId={activeTabId()}
    keybindings={settings.current.keybindings}
    onclose={closePalette}
    onconnect={connect}
    onconnectnew={connectInNewTab}
    onquickconnect={quickConnect}
    onapplythemeprofile={(id) =>
      // 팔레트는 고른 줄의 자리를 넘기지 않는다 — 창 가운데에서 퍼진다(`theme-reveal.ts`)
      void revealTheme(revealOriginFrom(null), () => applyProfile(id), { preload: profileWallpaperSrc(id) })}
    oninsertsnippet={(id) => void insertSnippet(id)}
    onsavesnippet={(command) => openSnippetSave(command, focusedHostAlias())}
    onmanagesnippets={openSnippetSettings}
    oninserthistory={(command, run) => void insertHistoryCommand(command, run)}
    onselecttab={pickTab}
    onrunaction={runAction}
    onopensetting={openSettingsAt}
    onopengroup={(path) => {
      // 그룹 우클릭 "전체 열기 (타일)" 와 **같은 자리·같은 함수**다: 활성 타일의 오른쪽에
      // 격자를 세운다 (확인 임계값·계단 지연도 그 함수 안에 하나뿐이다).
      const tab = activeTab();
      if (!tab) return;
      openGroupTiled(tab.id, paneOf(tab), "row", "after", path);
    }}
  />
{/if}

<!--
  **이 폴더의 지난 대화** — 팔레트 자리에 뜨는 고르는 목록 (docs/log/2026-09-27-folder-conversations.md).
  팔레트와 같이 `{#if}` 로 마운트/언마운트한다(거르는 글자 · 고른 줄은 컴포넌트의 지역 상태).
-->
{#if folderConversationsVisible()}
  <FolderConversations measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

<!--
  **파일 열기…** — 팔레트 자리에 뜨는 고르는 목록 (docs/log/2026-09-27-doc-tile.md "A — 여는 길"). 같은 결로
  `{#if}` 로 마운트/언마운트한다(거르는 글자 · 고른 줄은 컴포넌트의 지역 상태).
-->
{#if filePickerVisible()}
  <FilePicker measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

<!--
  **테마 프로필 전환** — 타일 캔버스 위 가장자리에서 내려오는 프로필 카드 줄 (docs/log/2026-09-28-profile-switcher.md).
  같은 결로 `{#if}` 로 마운트/언마운트한다(고른 카드는 컴포넌트의 지역 상태 — 열 때마다 지금 쓰는 프로필부터).
-->
{#if profileSwitcherVisible()}
  <ProfileSwitcher measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

<!--
  터미널 찾기 — 팔레트와 **같은 형태**다. 질의는 컴포넌트의 지역 상태라 닫으면 저절로
  비워지고, 여기서 넘기는 것은 열 때의 `seed`(범위 칩 + 검색어) 뿐이다 (`find` 액션이
  포커스된 터미널의 라벨을 **칩으로** 넣어 준다 — `keys.svelte.ts`).
-->
{#if searchVisible()}
  <SearchOverlay seed={searchSeed()} onclose={closeSearch} />
{/if}

<!--
  단축키 치트시트 — 팔레트와 같은 이유로 `{#if}` 로 마운트/언마운트한다. 조합은 컴포넌트가
  레지스트리에서 직접 읽으므로 여기서는 지금 걸린 오버라이드만 넘긴다.
-->
{#if cheatSheetVisible()}
  <CheatSheet
    keybindings={settings.current.keybindings}
    onclose={closeCheatSheet}
    onopensettings={openKeybindingSettings}
  />
{/if}

<!--
  프라이버시 잠금(가림막) — 화면 전체를 흐리게 덮는 순수 시각 층. 보안 잠금이 아니라 시선
  가림이고, 아무 키·클릭에 스스로 닫힌다(`Veil.svelte` 의 캡처 리스너). 팔레트들처럼 `{#if}`
  로 마운트/언마운트한다.
-->
{#if veilVisible()}
  <Veil />
{/if}

<!--
  **스니펫 자리표시자 묻기** (docs/log/2026-09-16-snippets.md) — 언제나 마운트해 두고,
  물어볼 것이 있을 때만 스스로 상자를 그린다 (`{#if}` 가 컴포넌트 안에 있다). 다른 모달들과
  달리 여기 조건을 두지 않는 이유는 모듈 상태가 이 컴포넌트의 유일한 프롭이라 넘길 것이
  없어서다 — 닫혀 있는 동안 그리는 것도 없다.
-->
<WorkspaceNameDialog />
<WorkspaceEditDialog />
<WorkspaceDeleteDialog />
{#if workspaceSwitcherVisible()}
  <WorkspaceSwitcher />
{/if}

<SnippetPrompt />

<!--
  **블록을 AI 타일에 넘기기 — 고르기 상자** (docs/log/2026-09-28-ask-ai-block.md). 위와 같은 규약이다: 언제나
  마운트해 두고, 고를 것이 있을 때만 스스로 상자를 그린다(상태는 `app/ask-ai.svelte.ts` 에 있다).
-->
<AskAiPicker />
<!-- 문서 코드 블록 [터미널에 넣기]의 셸 타일 고르기 상자 — 같은 규약(상태는 `app/code-to-term.svelte.ts`) -->
<CodeTermPicker />
<!-- 문서 타일 [새 문서…]의 이름 상자 — 같은 규약(상태는 `app/new-doc.svelte.ts`) -->
<NewDocBox />
<!-- AI CLI 고르기 상자(`Ctrl+Shift+A` · `ai-panel`) — 같은 규약(상태는 `app/ai-launch.svelte.ts`) -->
<AiLaunchPicker />

<!--
  **명령 하나를 스니펫으로 저장** (docs/log/2026-09-16-snippets.md) — 위와 **같은 규약**이다:
  언제나 마운트해 두고, 열려 있을 때만 스스로 상자를 그린다. 여는 길은 둘이고(터미널 우클릭
  메뉴 · 팔레트의 저장 줄) 둘 다 `openSnippetSave` 한 문을 지나므로 여기 넘길 프롭이 없다.
-->
<SnippetSaveDialog />
<!-- 프로젝트 추가·편집 (docs/log/2026-09-24-projects.md) — 독의 `+`·프로젝트 우클릭 "편집…" 이 연다 -->
<ProjectForm />
<!-- 워크트리 제거 확인 — "브랜치도 삭제" 칸이 있는 상자 (docs/log/2026-09-24-worktrees.md "브랜치는 같이 지운다") -->
<WorktreeRemoveDialog />
<WorktreeBranchDialog />

<!--
  **모달 열두 장** — 마크업·포커스 `$effect`·스코프 CSS 는 `src/lib/dialogs/*.svelte` 에, 상태·대기열은
  `app/*`(prompts · vault · overlays · transfer · keygen)에 있다. 언제나 마운트해 두고 떠 있을 때만 스스로
  상자를 그린다(`{#if}` 가 컴포넌트 안에 있다). **순서가 곧 층위다** — 오버레이는 전부 같은 z-index 라
  나중에 그려진 것이 위에 온다(옮기기 전 인라인 순서 그대로).
-->
<HostKeyDialog />
<VaultUnlockDialog />
<!-- 끝내기 모달 — 독의 끝내기 단추(2026-10-28) -->
<QuitDialog />
<!-- 업데이트 카드 — 상태바 업데이트 칩 · 새 판 알림이 연다(2026-11-12 · 주 창에서만 상태가 선다) -->
<UpdateDialog />
<!-- 마스터 암호 — 독(설정)보다 **나중에 그려지므로** 같은 z-index 에서도 위에 온다 -->
<MasterPromptDialog />
<!-- 사용자 앱 아이콘 자르기 — 설정 › 앱 테마 의 [＋] 가 연다. 마스터 암호 모달과 같은 까닭으로 독보다 뒤 -->
<AppIconCropDialog />
<TermThemeDialog />
<PasswordDialog />
<PassphraseDialog />
<KeyPickDialog />

<HostForm />

<ForwardDialog />
<DbPickerDialog />
<!-- 쿼리 타일 쓰기 켜기 확인 — 위 띠 알약이 연다(그 타일 위에 뜨는 모달) -->
<DbWriteDialog />
<UploadDialog />
<RemoteEditDialog />
<!-- 원격 기기 페어링 확인(R1a-2) — 주 창에서만 상태가 선다 · 가림막이 떠 있으면 그리지 않는다 -->
<RemotePairDialog />
<!-- 원격 창의 묻기 · 마스터 재확인(R4) — 원격 창에서만 줄이 찬다. 다른 모달 안에서 물어도 그 위(z 120) -->
<RemoteDialog />
<!-- 확인 · 알림 상자(10-16 — OS 기본 상자 대신 · `app/confirm-dialog`) — 다른 모달 안에서 물어도 그 위(z 114 · 가림막 아래) -->
<ConfirmDialog />
<!-- 새 키 만들기 — 여는 길 둘이 모두 이미 모달 위라 **모든 오버레이보다 뒤**여야 한다 (그 파일 머리말) -->
<KeygenDialog />

<!--
  툴팁 — 토스트와 같은 결의 **창에 한 벌인 층**이다
  (docs/log/2026-09-16-themed-tooltips.md). 프롭이 없다: 무엇을 띄울지는 이 컴포넌트가
  `document` 에 거는 위임 리스너가 `title` 을 보고 스스로 정한다. 그래서 툴팁을 달려고
  이 파일이나 다른 컴포넌트를 고칠 일이 없다 — `title` 을 적으면 그것이 곧 툴팁이다.
-->
<Tooltip />

<!--
  **시작 스플래시** — 마크업의 가장 마지막이자 화면의 가장 위(z 200)다
  (docs/log/2026-09-17-splash.md). 메인 창에서만, `boot()` 이 끝나고 페이드가 끝날 때까지만.
  걷는 것은 `onhidden` 한 갈래뿐이라 "언제 사라지는가" 의 답이 한 곳에 있다.
-->
{#if isMainWindow && !splashDone}
  <Splash {booted} onhidden={() => (splashDone = true)} />
{/if}

<style>
  /* 월페이퍼 — 이미지(::before)와 그 위의 검정 덮개(::after) 두 겹. 요소는 하나다.
   *
   * 겹을 나누는 이유는 **블러가 자식에게 전파되기** 때문이다. 한 요소에 이미지와 덮개를
   * 같이 두면 `filter: blur()` 가 덮개까지 흐려 가장자리 농도가 달라진다. 이미지 겹에만
   * 필터를 걸고 덮개는 선명한 채로 위에 얹는다.
   *
   * 확대(`--wp-scale`)는 블러가 있을 때만 1.04 다 — `blur()` 는 요소 바깥을 투명으로 보고
   * 섞어서 테두리에 뿌연 띠를 남기는데, 살짝 키워 그 띠를 화면 밖으로 밀어낸다.
   * `will-change` 는 두지 않는다: 이 레이어는 애니메이션하지 않고 값이 바뀌는 것은
   * 설정을 만지는 순간뿐이라, 상시 합성 레이어로 승격시킬 이유가 없다. */
  .wallpaper {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden; /* 확대된 이미지 겹이 스크롤을 만들지 않게 */
    pointer-events: none; /* 배경일 뿐이다 — 클릭·드래그는 전부 통과한다 */
  }

  .wallpaper::before,
  .wallpaper::after {
    content: "";
    position: absolute;
    inset: 0;
  }

  .wallpaper::before {
    background-image: var(--wp-image);
    background-size: var(--wp-size);
    background-repeat: var(--wp-repeat);
    background-position: var(--wp-position);
    filter: blur(var(--wp-blur));
    transform: scale(var(--wp-scale));
  }

  .wallpaper::after {
    background: var(--wp-dim);
  }

  /* 번짐 바탕 — 그림은 토큰 하나(`theme.css` 의 `--glass-glow`)라 색 테마·월페이퍼 추출·라이트/다크를 따른다.
     월페이퍼가 없을 때의 앱 배경이라 투명도 슬라이더와 상관없이 그대로 깔린다(슬라이더는 이 층이 판에 얼마나 비치나) */
  .glass-glow {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: var(--glass-glow, none);
  }

  .app {
    display: flex;
    flex-direction: column; /* 타이틀바(위) + 본문(아래) */
    height: calc(100vh / var(--css-zoom, 1)); /* 원격의 UI 크기(루트 CSS zoom)를 되돌린다 — 앱 창에는 이 변수가 없다 */
    overflow: hidden;
  }
  /* 폰(R5): 브라우저 주소 줄 · 화면 키보드를 뺀 높이(`app/mobile` 이 `visualViewport` 로 `--app-h` 를 잰다 · 없으면 dvh).
     원격의 UI 크기는 루트 CSS zoom 이라(`remote/polyfill.js`) 이 높이에도 곱해진다 — 계수로 나눠 화면 높이에 맞춘다 */
  .app.mobile {
    height: calc(var(--app-h, 100dvh) / var(--css-zoom, 1));
  }

  /* 본문 행 — 오버레이 사이드바·hot-edge 의 기준 상자 (타이틀바 아래 영역만 덮는다) */
  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    /* 화면 밖으로 밀린 오버레이(닫힌 채팅 독)가 스크롤 거리를 만들지 않게 — `hidden` 이 아니라 `clip` 이다: `hidden` 은 스크롤바만 없을 뿐
       포커스 · 스크립트로는 밀린다. 탭 슬라이드 중 들어오는 탭에 스크롤 동반 포커스가 닿으면 앱 틀째 밀려, 닫힌 독이 고정된 듯 드러나고 타일이 그만큼 잘렸다(2026-11-06) */
    overflow: clip;
  }

  /*
   * 세로 상태바 쪽에서 독을 연다. 기둥 폭과 패널 여백만큼 안쪽으로 밀어
   * 상태바를 덮지 않고 타일 가장자리와 맞춘다. 각 방향의 inset은 Dock이 읽는다.
   */
  .body[data-statusbar="left"] {
    --dock-inset-left: var(--sb-w);
  }
  /* panel(둥근 패널)이면 기둥이 창 쪽 여백(`--space-2`, `StatusBar.svelte` — 캔버스 쪽은 0)만큼
     더 차지한다 — 그 바깥 폭만큼 밀어야 독이 평면일 때처럼 타일 왼쪽 끝과 맞는다
     (docs/log/2026-09-29-statusbar-panel-vertical.md). */
  .body[data-statusbar="left"][data-statusbar-style="panel"] {
    --dock-inset-left: calc(var(--sb-w) + var(--space-2));
  }
  /* 오른쪽 기둥이 창에서 차지하는 폭 — 독(`--dock-inset-right`)과 토스트(`Toasts.svelte`)가 같은 값으로 비킨다 */
  .app[data-statusbar="right"] {
    --sb-inset-right: var(--sb-w);
  }
  .app[data-statusbar="right"][data-statusbar-style="panel"] {
    --sb-inset-right: calc(var(--sb-w) + var(--space-2));
  }
  .body[data-statusbar="right"] {
    --dock-inset-right: var(--sb-inset-right);
  }
  /* 탭 전환 슬라이드가 도는 동안(`.host.sliding` — 가로로 창 끝까지 열린다) 패널이 타일 **위** 층에 선다 — 타일이 패널 뒤로
     지나가 가려진다(글래스면 흐림 판이 그 타일을 흐린다). 쉴 때는 쌓임 맥락을 만들지 않는다: 띠 안의 `position: fixed`
     상자(원격 칩 상자 등)가 띠의 층에 갇히면 독 · 타일 밑으로 들어간다(theme.css 재질 절의 띠 주석). */
  :global(.body[data-slide-bleed]:has(.host.sliding) > .statusbar) {
    position: relative;
    z-index: 1;
  }

  .pane {
    /* 사용량 · 자원 화면(`CoverPanel`)의 기준 상자 — 그 판이 이 상자 안쪽 `--gap` 에 타일 한 장처럼 선다 */
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* 그 판은 크롬 투명도를 타 비친다 — 떠 있는 동안(닫히며 내려가는 동안은 빼고) 밑의 타일을 감춘다. `visibility` 라 타일은
     마운트된 채 출력 · 크기를 그대로 받는다(10-27 사용자: 판도 다른 창처럼 투명도를 타게).
     **판과 엇갈려 페이드한다**(10-29 사용자 — 타일이 순간 사라지고 판만 400ms 차올라, 그 사이 빈 캔버스가 깜빡였다). 타일은
     `--tile-in`(theme.css `@property`)이 1 ↔ 0 으로 200ms 에 흐려지고 · 돌아오며, `visibility` 는 그 끝에서 바뀐다(`visibility` 전환은
     한쪽 끝이 `visible` 이면 도는 동안 내내 보인다 — 여닫기 모두 그 시간 동안 보인다). 상자의 `opacity` 가 아니라 `--tile-in` 인 것은
     글래스 타일의 흐림 판을 끊지 않으려고다(`PaneHost` 의 `.glass-tile` 페이드 절 — 그 밖의 상자 · 분할선은 같은 값을 `opacity` 로 받는다).
     판을 다른 판으로 바꿀 때는 새 판이 곧바로 서므로 타일은 숨은 채다. */
  .pane > main {
    transition:
      --tile-in 200ms ease-out,
      visibility 200ms linear;
  }
  .pane:has(> :global([data-cover-view]:not([hidden], [data-closing]))) > main {
    visibility: hidden;
    --tile-in: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .pane > main {
      transition: none;
    }
  }

  /*
   * **상태바 감싸기(hug)** — 평면 그대로에 캔버스(`.pane`)의 모서리를 둥글게 파서 크롬 면(제목줄 · 상태바)이 타일 무리를
   * 감싸 안는다(2026-10-16 사용자 결정). 타일의 자리 · 틈은 건드리지 않는다: 모서리 조각(`::before` · `::after` · `.hug-c3` ·
   * `.hug-c4`)이 곡선 **바깥**만 크롬 면 색으로 칠하고, 곡선은 바깥 타일 모서리와 **같은 중심**이라(반지름 = 캔버스 틈 `--gap` +
   * 타일 모서리 `--radius-surface`) 타일에 겹치지 않는다.
   *
   * **네 모서리 모두 감는다**(10-17): 상태바 · 제목줄과 맞닿지 않는 변(창 가장자리 쪽)에는 크롬 면을 `--hug-rim`(3px) 두께로
   * 둘러(캔버스의 테두리 — 그 변만 두께가 있다) 캔버스가 네 모서리 둥근 한 장이 된다. 최대화해도 남는다. 모바일 배치(`.app.mobile`)는
   * 감지 않는다(10-20): 타일 하나가 가장자리까지 차서(`PaneHost` 의 `.host.edge`) 감을 곡선이 없다 — 조각 · 캔버스 선을 끄고 위 상태바의
   * 아래 선이 평면처럼 돌아온다(`StatusBar`).
   *
   * **선은 덮어 가리지 않고 곡선이 끝난 데서부터 긋는다**: 크롬 면은 재질 투명도를 받는 반투명이라, 직선 위에 조각을 덮으면 그
   * 밑의 직선이 비쳐 직각 테두리가 남는다(10-16 실기). 그래서 감싸는 쪽의 상태바 테두리 · 제목줄 아래 선은 지우고, 캔버스가
   * 배경 그림으로 곡선 끝 ~ 곡선 끝 사이만 1px 선을 긋는다 — 곡선(조각의 1px 고리)과 한 줄이다.
   * 조각은 사용량 화면 · 세션 판 같은 캔버스 덮개 위에 선다(모서리가 덮개에 가려 각지지 않게) · 누르기는 통과한다.
   */
  .app[data-statusbar-style="hug"] {
    --hug-r: calc(var(--gap) + var(--radius-surface));
    --hug-x: calc(var(--hug-r) + 1px); /* 모서리 조각의 한 변 = 반지름 + 1px 선 */
    --hug-rim: 3px; /* 창 가장자리 쪽 변의 크롬 테두리 두께 */
  }
  .body[data-statusbar-style="hug"] .pane {
    --hug-face: var(--glass-band, var(--surface-raised));
    /* 캔버스 둘레 선 — 글래스면 뜬 면의 흰 선(`--glass-rim`), 평면이면 예전 `--line` 그대로 */
    --hug-line: var(--glass-rim, var(--line));
    --hug-run: calc(100% - 2 * var(--hug-r) - 2px); /* 두 곡선 끝 사이 */
    background-image: linear-gradient(var(--hug-line), var(--hug-line));
    background-size: var(--hug-run) 1px;
    background-position: center top;
    background-repeat: no-repeat;
  }
  .hug-c {
    display: none;
  }
  .body[data-statusbar-style="hug"] .pane::before,
  .body[data-statusbar-style="hug"] .pane::after,
  .body[data-statusbar-style="hug"] .hug-c {
    content: "";
    position: absolute;
    z-index: 30;
    width: var(--hug-x);
    height: var(--hug-x);
    pointer-events: none;
  }
  /* 위 두 모서리(`::before` 왼쪽 · `::after` 오른쪽) — 데스크톱 배치 어느 자리든(모바일은 아래에서 끈다) */
  .body[data-statusbar-style="hug"] .pane::before {
    left: 0;
    top: 0;
    background: radial-gradient(circle at 100% 100%, transparent var(--hug-r), var(--hug-line) var(--hug-r), var(--hug-line) calc(var(--hug-r) + 1px), var(--hug-face) calc(var(--hug-r) + 1px));
  }
  .body[data-statusbar-style="hug"] .pane::after {
    right: 0;
    top: 0;
    background: radial-gradient(circle at 0% 100%, transparent var(--hug-r), var(--hug-line) var(--hug-r), var(--hug-line) calc(var(--hug-r) + 1px), var(--hug-face) calc(var(--hug-r) + 1px));
  }
  /* 모바일 배치 — 가장자리까지 찬 타일 하나라 감을 모서리도 곡선 끝 사이의 선도 없다 */
  .app.mobile .body[data-statusbar-style="hug"] .pane {
    background-image: none;
  }
  .app.mobile .body[data-statusbar-style="hug"] .pane::before,
  .app.mobile .body[data-statusbar-style="hug"] .pane::after {
    display: none;
  }
  /* 아래 두 모서리(`.hug-c3` 왼쪽 · `.hug-c4` 오른쪽) · 네 변의 선 — 데스크톱 배치 */
  .app:not(.mobile) .body[data-statusbar-style="hug"] .hug-c3 {
    display: block;
    left: 0;
    bottom: 0;
    background: radial-gradient(circle at 100% 0%, transparent var(--hug-r), var(--hug-line) var(--hug-r), var(--hug-line) calc(var(--hug-r) + 1px), var(--hug-face) calc(var(--hug-r) + 1px));
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"] .hug-c4 {
    display: block;
    right: 0;
    bottom: 0;
    background: radial-gradient(circle at 0% 0%, transparent var(--hug-r), var(--hug-line) var(--hug-r), var(--hug-line) calc(var(--hug-r) + 1px), var(--hug-face) calc(var(--hug-r) + 1px));
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"] .pane {
    background-image:
      linear-gradient(var(--hug-line), var(--hug-line)), linear-gradient(var(--hug-line), var(--hug-line)), linear-gradient(var(--hug-line), var(--hug-line)),
      linear-gradient(var(--hug-line), var(--hug-line));
    background-size: var(--hug-run) 1px, var(--hug-run) 1px, 1px var(--hug-run), 1px var(--hug-run);
    background-position: center top, center bottom, left center, right center;
    /* 창 가장자리 쪽 테두리 — 두께는 아래 자리별 규칙이 준다. 조각 · 선 · 덮개(`inset: 0`)는 테두리 안쪽(패딩 상자)에 선다 */
    border: 0 solid var(--hug-face);
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="left"]) .pane {
    border-left-width: var(--hug-rim);
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="right"]) .pane {
    border-right-width: var(--hug-rim);
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="bottom"]) .pane {
    border-bottom-width: var(--hug-rim);
  }
  /* 독도 테두리 안쪽에서 뜬다 — 타일 가장자리와 같은 거리(상태바 쪽은 위의 `--dock-inset-*` 그대로) */
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="left"]) {
    --dock-inset-left: var(--hug-rim);
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="right"]) {
    --dock-inset-right: var(--hug-rim);
  }
  .app:not(.mobile) .body[data-statusbar-style="hug"]:not([data-statusbar="bottom"]) {
    --dock-inset-bottom: var(--hug-rim);
  }
  /*
   * 글래스 — 크롬의 흐림 판을 **창 전체 한 장**으로 들고 캔버스 자리만 둥근 사각형으로 뚫는다(10-17). 판이 자리마다 따로면(탭 줄 ·
   * 창 단추 · 상태바 · 테두리) 각자 제 상자 가장자리에서 바탕을 달리 흐려 맞닿은 곳에 직선 이음매가 비쳤고(10-16 실기), 3px
   * 테두리는 제 상자로 흐리면 3px 안에서만 번져 줄무늬가 그대로 남는다. 한 장이면 어느 변이든 같은 흐림이다.
   * 구멍 = 제목줄 높이(`--titlebar-h` — 스크립트가 잰다) + 위 상태바 · 기둥 폭 · 아래 띠 · 테두리. 모서리는 조각 곡선과 같은 원
   * (중심 = 조각의 안쪽 모서리)이라 사이로 바탕이 안 샌다. 자리마다의 판(`.glass-band::before`)은 끈다. 모바일 배치는 제외.
   */
  :global(:root[data-material="glass"]) .app[data-statusbar-style="hug"]:not(.mobile) {
    --hole-t: var(--titlebar-h);
    --hole-l: var(--hug-rim);
    --hole-r: var(--hug-rim);
    --hole-b: var(--hug-rim);
  }
  :global(:root[data-material="glass"]) .app[data-statusbar="top"][data-statusbar-style="hug"]:not(.mobile) {
    --hole-t: calc(var(--titlebar-h) + var(--head-sb-h));
  }
  :global(:root[data-material="glass"]) .app[data-statusbar="left"][data-statusbar-style="hug"]:not(.mobile) {
    --hole-l: var(--sb-w);
  }
  :global(:root[data-material="glass"]) .app[data-statusbar="right"][data-statusbar-style="hug"]:not(.mobile) {
    --hole-r: var(--sb-w);
  }
  :global(:root[data-material="glass"]) .app[data-statusbar="bottom"][data-statusbar-style="hug"]:not(.mobile) {
    --hole-b: var(--sb-h);
  }
  :global(:root[data-material="glass"]) .app[data-statusbar-style="hug"]:not(.mobile)::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    box-shadow: var(--glass-edge);
    backdrop-filter: var(--glass-filter-band);
    mask-image:
      linear-gradient(#000, #000), linear-gradient(#000, #000), linear-gradient(#000, #000), linear-gradient(#000, #000),
      radial-gradient(circle at 100% 100%, transparent var(--hug-r), #000 var(--hug-r)),
      radial-gradient(circle at 0% 100%, transparent var(--hug-r), #000 var(--hug-r)),
      radial-gradient(circle at 100% 0%, transparent var(--hug-r), #000 var(--hug-r)),
      radial-gradient(circle at 0% 0%, transparent var(--hug-r), #000 var(--hug-r));
    mask-size:
      100% var(--hole-t),
      100% var(--hole-b),
      var(--hole-l) 100%,
      var(--hole-r) 100%,
      var(--hug-x) var(--hug-x),
      var(--hug-x) var(--hug-x),
      var(--hug-x) var(--hug-x),
      var(--hug-x) var(--hug-x);
    mask-position:
      left top,
      left bottom,
      left top,
      right top,
      left var(--hole-l) top var(--hole-t),
      right var(--hole-r) top var(--hole-t),
      left var(--hole-l) bottom var(--hole-b),
      right var(--hole-r) bottom var(--hole-b);
    mask-repeat: no-repeat;
  }
  /* 감싸기 + 글래스의 가장자리는 위 조각 · 캔버스 선(`--hug-line` = `--glass-rim`) 하나다(10-22 의 안쪽 빛 띠 고리는 10-29 에 걷었다).
     자리마다의 판은 끈다 — 제목줄(탭 줄 · 창 단추)의 판 · 아래 선은 `chrome/WindowTitlebar.svelte` 의 감싸기 절 */
  :global(:root[data-material="glass"]) .app[data-statusbar-style="hug"]:not(.mobile) :global(.statusbar)::before {
    display: none;
  }

  /*
   * **위 상태바 = 머리 한 덩어리**(10-17) — 위 배치면 제목줄과 상태바가 색이 같은 띠 두 줄이라, 사이 선으로 나뉘면 겹쳐 보였다.
   * 평면 · 감싸기(hug)에서는 사이 선을 없애고(선은 상태바 아래 — 캔버스와 맞닿는 곳 — 하나), 띠를 26px 로 낮춘다.
   * 둥근 패널(panel)도 같다 — 탭 줄 패널이 상태바 줄까지 내려간 두 줄 패널 하나이고 두 줄 사이에 선이 없다(아래 탭 패널 절 · 10-22).
   * 모바일 배치(제목줄 대신 `MobileBar`)는 건드리지 않는다(`:not(.mobile)`). 다른 위치는 이 절에 들지 않는다.
   */
  /*
   * **띠 두께 = 탭 줄 두께**(2026-10-28 사용자 — 위 상태바가 탭 줄 안이 되며 위 · 아래 · 왼쪽 · 오른쪽이 같은 두께로 읽히게). 숫자를 따로
   * 적지 않고 탭 줄에서 셈한다 — 탭 줄 안쪽 = 위 여백(`--space-1`) + 탭(`--tab-h`) + 아래 여백(`--space-1`)(`Tabs.svelte` 의 `.tabs` · `.strip`).
   * 그 바깥은 모양마다 다르다(판 바깥 기준):
   *  - 평면: 탭 줄 아래 선 1px 이 안에 든다 → 안쪽 + 1. 아래 띠(위 선 1px) · 기둥(안쪽 선 1px)도 선이 상자 안이라 같은 값이다.
   *  - 감싸기: 탭 줄 · 띠 · 기둥 모두 선을 지운다 → 안쪽 그대로.
   *  - 둥근 패널: 탭 줄 패널 = 안쪽 + 위아래 테두리 2px. 아래 띠 · 기둥 패널도 테두리가 상자 안(`box-sizing`)이라 같은 값이다.
   * 아래 띠 높이(`--sb-h`)와 기둥 폭(`--sb-w`)이 이 값을 따르고, 그 둘에 기대는 자리(독 비키기 · 감싸기 구멍 · 캔버스 가장자리 선 · 글래스
   * 판 · 즐겨찾기 독 높이)가 함께 따라온다. 폰 배치의 위 띠는 예전 값(`theme.css`) 그대로.
   *
   * 탭 줄도 같은 값으로 **높이를 못 박는다**(`--tab-line` = 탭 줄 아래 선 — `WindowTitlebar` 의 `.tabs` 높이). 내용으로 높이가 정해지면
   * 화면 배율(예: 175%)에서 1px 선이 기기 픽셀로 깎여 탭 줄이 36.57px 로 서고 37px 띠와 0.4px 어긋났다(2026-10-28 실측). 두 상자가 같은
   * 높이 안에 선을 품으면 깎여도 바깥 두께가 같다.
   */
  .app:not(.mobile) {
    --tab-row: calc(var(--tab-h) + 2 * var(--space-1));
    --tab-line: 1px;
    --tab-band: calc(var(--tab-row) + var(--tab-line));
    --sb-h: var(--tab-band);
    --sb-w: var(--tab-band);
  }
  .app[data-statusbar-style="hug"]:not(.mobile) {
    --tab-line: 0px;
  }
  .app[data-statusbar-style="panel"]:not(.mobile) {
    --tab-line: 0px;
    --tab-band: calc(var(--tab-row) + 2px);
  }
  .app[data-statusbar="top"]:not(.mobile) {
    /* 2026-10-28 — 위 상태바는 제목줄 안(`StatusBar` 의 `inline`)이라 머리 아래 상태바 줄이 없다. 이 값을 쓰는 규칙(감싸기 구멍 등)이
       남아 있어 0 으로 둔다. 아래 `.statusbar[data-pos="top"]` 규칙들은 폰이 아니면 걸리지 않는다(데스크톱은 `data-pos="inline"`) */
    --head-sb-h: 0px;
  }
  /* 제목줄(탭 줄 · 창 단추)의 아래 선 · 흐림 판은 `chrome/WindowTitlebar.svelte` 의 같은 절 */
  .app[data-statusbar="top"]:not(.mobile) :global(.statusbar[data-pos="top"]) {
    height: var(--head-sb-h);
    --sb-cell-h: 24px; /* 띠 안쪽(아래 선을 뺀 25px)에 글리프 칸이 넘치지 않게 — 이 띠 안에서만 */
    /* 양끝 9px: 왼쪽은 첫 아이콘의 획이 제목줄 워크스페이스 단추의 글자(탭 줄 여백 8 + 테두리 1 + 안쪽 여백 8 = 17px)와
       같은 x 에서 시작하게(칸 28 · 아이콘 17 이라 칸 안 5.5px + 아이콘 안 여백), 오른쪽은 마지막 칸(종)의 가운데가
       창 닫기 단추(46px)의 가운데와 같은 세로줄에 서게((46 − 28) / 2) */
    padding: 0 calc(var(--space-2) + 1px);
  }
  /* 사용량 고리 묶음은 아래 띠와 같은 자리(28% 지점 — `StatusBar` 의 `--status-middle-start`)에 그대로 선다(10-22 사용자) */
  /* 글래스 — 흐림 판을 **한 장**으로. 탭 줄 · 창 단추 · 상태바가 판을 따로 들면 맞닿은 곳마다 바탕을 달리 흐려 이음매가 비친다.
     제목줄이 상태바 높이만큼 아래로 늘어난 판 하나를 들고 세 자리의 판은 끈다. 상태바 위 가장자리 빛 선(`--glass-edge`)도 함께
     사라진다. 감싸기(hug)는 창 전체 판 한 장이 따로 든다(위 감싸기 절) */
  :global(:root[data-material="glass"]) .app[data-statusbar="top"]:not(.mobile)[data-statusbar-style="flat"] :global(.statusbar[data-pos="top"])::before {
    display: none;
  }

  /*
   * **캔버스 가장자리**(`.canvas-edge` — 10-22) — 탭 줄 아래 변을 탭 줄 · 창 단추의 테두리 대신 **한 상자의 위 테두리**로 긋는다.
   * 탭 줄 · 창 단추의 아래 테두리는 색만 투명으로 둔다(자리 1px 그대로 — 배치가 안 움직인다 · 두 상자 경계의 소수 픽셀 이음매도 없다).
   *  - 평면 띠가 왼쪽 · 오른쪽이면(두 재질): 선이 기둥 안쪽 선이 서는 칸(`--sb-w` − 1px)에서 시작한다 — 기둥 위를 지나던 탭 줄 선이
   *    사라져 탭 줄 · 기둥이 한 면이 되고, 두 선은 캔버스 모서리에서 곡선 하나로 이어진다(11-03 — 예전엔 직각 L ·
   *    곡선 · 선의 시작 자리는 아래 `.canvas-corner` 절). 기둥 선은 기둥 자신의 테두리 그대로 둔다 — 흐름 안 상자의 테두리라 소수 배율(1.25 · 1.5×)에서
   *    장치 픽셀에 맞춰 스냅되는데, 떠 있는 상자의 세로 테두리는 같은 자리에서 반 칸 번져 평면 재질 픽셀이 바뀌었다.
   *  - 글래스면 아래 평면 띠에서도 탭 줄 아래 변을 여기서 긋는다(선 하나 — 만나는 변이 없다). 평면 재질은 탭 줄 테두리 그대로.
   *  - 위 띠(머리 한 덩어리) · 감싸기는 탭 줄 아래 선이 없으니 그리지 않는다. 둥근 패널은 탭 줄이 제 가장자리를 두른 패널이라
   *    그리지 않는다(아래 탭 패널 절).
   * 선 색은 글래스 `--glass-rim`(상태바 · 뜬 면과 같은 선) · 평면 `--line`. 글래스 아래 띠면 탭 줄 · 창 단추의 판을 테두리 안쪽만
   * 칠해(상태바와 같이) 선이 판 위에 한 번 더 겹치지 않는다(L 이면 판 색은 아래 창 전체 판 한 장이 든다).
   * L + 글래스면 흐림 판도 **창 전체 한 장**(감싸기와 같은 이유 — 탭 줄 · 기둥이 판을 따로 들면 이제 선 없이 맞닿는 곳에 흐림 이음매가
   * 비친다 · 판 색까지 한 장 — 아래 판 절)이고 구멍 = 캔버스 + 선(선은 상태바처럼 흐리지 않은 바탕 위). 기둥 위의 탭 줄 테두리 칸(투명)도 그 판이 덮는다.
   * 층 1 — 띠 판(층 없음) 위, 탭 줄 메뉴(6 · 7) · 세션 판(95) · 독(100) 아래. 자리는 `--titlebar-h`(스크립트가 잰다) · `--sb-w`.
   * `.app` 의 마지막 자식 · `position: absolute`(창 기준) — `.body` 의 `overflow` 에 잘리지 않고 띠 · 기둥보다 뒤 차례다.
   */
  .canvas-edge {
    display: none;
  }
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .canvas-edge,
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="bottom"] .canvas-edge {
    display: block;
    position: absolute;
    z-index: 1;
    top: calc(var(--titlebar-h) - 1px);
    right: 0;
    left: 0;
    border-top: 1px solid var(--glass-rim, var(--line));
    pointer-events: none;
  }
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .canvas-edge {
    bottom: 0;
  }
  /* L 의 위 변은 안쪽 모서리 곡선이 끝난 데서 시작한다(아래 `.canvas-corner` 절) */
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"] .canvas-edge {
    left: calc(var(--sb-w) + var(--corner-r));
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"] .canvas-edge {
    right: calc(var(--sb-w) + var(--corner-r));
  }

  /*
   * **평면 L 의 안쪽 모서리**(2026-11-03 사용자 — 목업 4bVhL4TJhyyo3rx3ti74iK A안) — 평면 띠가 왼쪽 · 오른쪽이면 탭 줄 아래 선과 기둥 안쪽
   * 선이 캔버스 모서리에서 만나는데, 그 안의 타일은 모두 둥글어 그 한 자리만 직각이 걸렸다. 그 **한 모서리만** 타일과 같은 중심의 곡선
   * (반지름 `--corner-r` = 캔버스 틈 + 타일 모서리 — 감싸기의 `--hug-r` 와 같은 값)으로 돈다. 감싸기와 다른 점은 상태바 쪽 두 면만
   * 쓴다는 것이다 — 창 가장자리 쪽 세 모서리 · 테두리는 없다.
   *  - 조각(`.canvas-corner`)은 L 선의 꼭짓점 자리(제목줄 높이 − 1px · 기둥 선 칸)에서 한 변 `--corner-r` + 1px — 곡선 바깥만 칠하고
   *    곡선은 1px 고리. 곡선 바깥은 크롬 면: 평면 재질은 조각이 띠 판 색(`--surface-raised`)으로 칠하고, 글래스는 창 전체 판이 그 자리까지
   *    마스크를 넓혀 흐림 · 판 색을 들고(아래 판 절) 조각은 고리만 긋는다.
   *  - 선은 덮어 가리지 않고 곡선이 끝난 데서 잇는다(감싸기와 같은 까닭 — 반투명 면 밑의 직선이 비친다): 위 변은 `.canvas-edge` 의 시작을
   *    옮기고, 기둥 선은 기둥 테두리 그대로 두되 첫 `--corner-r` 만 비운다(`border-image` — 흐름 안 상자의 테두리라 장치 픽셀 스냅은 그대로).
   *  - 세션 판의 자르는 상자도 이 모서리를 같은 곡률로 깎는다(`SessionSheet.svelte`).
   * 층은 `.canvas-edge` 와 같다(1). `.app` 의 자식이라 `.body` 의 `overflow` 에 잘리지 않는다 — 조각의 첫 줄은 제목줄의 마지막 줄이다.
   */
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) {
    --corner-r: calc(var(--gap) + var(--radius-surface));
    --corner-x: calc(var(--corner-r) + 1px);
    --corner-line: var(--glass-rim, var(--line));
  }
  .canvas-corner {
    display: none;
  }
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .canvas-corner {
    --corner-face: var(--surface-raised);
    display: block;
    position: absolute;
    z-index: 1;
    top: calc(var(--titlebar-h) - 1px);
    width: var(--corner-x);
    height: var(--corner-x);
    pointer-events: none;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .canvas-corner {
    --corner-face: transparent;
  }
  /* 두 층 — 고리(조각 전체)와 면(첫 줄 · 기둥 쪽 첫 칸을 뺀 안쪽만). 그 줄 · 칸은 탭 줄 · 기둥의 테두리 칸이라 그 판이 이미 칠해져,
     면을 한 번 더 칠하면 반투명이 겹쳐 곡선 바깥에 옅은 네모 테두리가 떴다(11-03 헤드리스 확대 실측 · 평면 재질) */
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .canvas-corner {
    box-sizing: border-box;
    background-origin: border-box, border-box;
    background-clip: border-box, content-box;
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"] .canvas-corner {
    left: calc(var(--sb-w) - 1px);
    padding: 1px 0 0 1px;
    background-image:
      radial-gradient(circle at 100% 100%, transparent var(--corner-r), var(--corner-line) var(--corner-r), var(--corner-line) var(--corner-x), transparent var(--corner-x)),
      radial-gradient(circle at 100% 100%, transparent var(--corner-x), var(--corner-face) var(--corner-x));
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"] .canvas-corner {
    right: calc(var(--sb-w) - 1px);
    padding: 1px 1px 0 0;
    background-image:
      radial-gradient(circle at 0% 100%, transparent var(--corner-r), var(--corner-line) var(--corner-r), var(--corner-line) var(--corner-x), transparent var(--corner-x)),
      radial-gradient(circle at 0% 100%, transparent var(--corner-x), var(--corner-face) var(--corner-x));
  }
  /* 기둥 안쪽 선 — 첫 `--corner-r` 은 곡선 자리라 비운다. 색은 지금 테두리 색 그대로(글래스 `--glass-border` · 평면 `--line`) */
  /* 조각 값은 선이 선 변 하나만(위아래 조각 0 — 높이 그대로 늘이지 않는다) */
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar.vertical) {
    border-image-source: linear-gradient(transparent var(--corner-r), var(--glass-border, var(--line)) var(--corner-r));
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"] :global(.statusbar.vertical) {
    border-image-slice: 0 1 0 0;
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"] :global(.statusbar.vertical) {
    border-image-slice: 0 0 0 1;
  }
  /* 탭 줄 · 창 단추의 아래 테두리 투명 · 판 칠 범위는 `chrome/WindowTitlebar.svelte` 의 같은 절 */
  /*
   * L + 글래스 — 흐림 **과 판 색**을 창 전체 한 장이 든다(구멍 = 캔버스 + 선). 탭 줄 · 창 단추 · 기둥은 판 색 · 흐림 판을 끈다 —
   * 상자마다 칠하면 상자 경계가 소수 장치 픽셀(1.25 · 1.5×)에 걸리는 곳에서 두 반투명 칠이 안티에일리어싱으로 덜 덮여 실금이 떴다
   * (선이 없어진 기둥 머리 · 탭 줄과 창 단추 사이). 구멍의 위 변(제목줄 높이 − 1px)은 선 줄 바로 위다. 판은 창보다 사방 4px 크다 —
   * 마스크를 건 흐림 판이 창 끝과 꼭 맞으면 1.25× 에서 창 네 끝 한 줄이 어둡게 떴다(마스크 · clip-path 모두 — 판 끝이 창 밖이면 없다).
   */
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"])::before {
    content: "";
    position: fixed;
    inset: -4px;
    z-index: -1;
    pointer-events: none;
    background: var(--glass-band);
    backdrop-filter: var(--glass-filter-band);
    mask:
      linear-gradient(#000 0 0) left top / 100% calc(var(--titlebar-h) + 3px) no-repeat,
      linear-gradient(#000 0 0) left top / calc(var(--sb-w) + 3px) 100% no-repeat,
      /* 안쪽 모서리의 곡선 바깥(`.canvas-corner` 절) — 판이 창보다 4px 크니 조각 자리(기둥 선 칸 · 제목줄 마지막 줄)는 +3px.
         층은 기둥 · 탭 줄 쪽으로 3px 더 겹친다(곡선 중심 = 층의 오른쪽 아래 그대로) — 경계를 맞대면 소수 배율에서 두 층이 반씩 덮어
         실금이 떴다(11-03 헤드리스 1.25× 실측 · 오른쪽) */
      radial-gradient(circle at 100% 100%, transparent var(--corner-x), #000 var(--corner-x)) var(--sb-w) var(--titlebar-h) / calc(var(--corner-x) + 3px) calc(var(--corner-x) + 3px) no-repeat;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"]::before {
    mask:
      linear-gradient(#000 0 0) left top / 100% calc(var(--titlebar-h) + 3px) no-repeat,
      linear-gradient(#000 0 0) right top / calc(var(--sb-w) + 3px) 100% no-repeat,
      radial-gradient(circle at 0% 100%, transparent var(--corner-x), #000 var(--corner-x)) right var(--sb-w) top var(--titlebar-h) / calc(var(--corner-x) + 3px) calc(var(--corner-x) + 3px) no-repeat;
  }
  /* 판의 위 빛 선(`--glass-edge`)은 제목줄이 진다 — 그 규칙과 탭 줄 · 창 단추의 판 끄기는 `chrome/WindowTitlebar.svelte` 의 같은 절 */
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar)::before {
    display: none;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar) {
    background: transparent;
  }

  /*
   * **둥근 패널이면 탭 줄도 떠 있는 둥근 패널**(10-22 사용자 결정 — 목업 A). 상태바 패널과 같은 여백(`--space-2`) · 반지름 ·
   * 가장자리(글래스 = `--glass-rim` 선 · 평면 재질 = `--line` 테두리)이고 창 단추는 패널 안 오른쪽 끝이다.
   *  - DOM 은 그대로 — 판은 제목줄의 `::before`(테두리 · 판 색 · 흐림)가 진다. 제목줄은 여백 + 테두리 1px
   *    만큼 안쪽 여백을 두고, 탭 줄 · 창 단추는 판 · 흐림 · 아래 선을 끈다(두 상자가 판을 따로 들면 맞닿은 곳에 이음매가 비친다).
   *    `z-index: -1` — 제목줄은 쌓임 맥락이 없어 위 머리 절의 흐림 판처럼 탭 줄 글자 밑 · 창 바탕 위에 선다.
   *  - 창 끌기: 패널 둘레 여백(창 위 · 양옆)은 제목줄 자신이라 그 `data-tauri-drag-region` 이 받는다(더블클릭 = 최대화 그대로).
   *    패널 안 빈 곳은 탭 뒤 `.dragspace` 와 탭 줄 자신의 여백(`Tabs` 루트의 같은 속성). 창 단추는 창 끝에서 9px 안이라
   *    프레임 없는 창의 크기 조절 띠(가장자리 몇 px)와 겹치지 않는다.
   *  - 최대화해도 여백은 남는다 — 상태바 패널 · 감싸기 테두리와 같다.
   *  - 아래 · 왼쪽 · 오른쪽 상태바 패널은 따로 뜬 판이다 — 탭 패널 아래 변에서 `--space-2` 뒤에 상태바 · 타일이 같은 줄로 시작한다.
   *  - 위 상태바면 **두 줄 패널 하나**: 판이 상태바 줄(`--head-sb-h`)까지 내려가고 상태바는 테두리 · 판 · 반지름 · 여백을 끈다.
   *    두 줄 사이 선은 없다(위 머리 절). 첫 아이콘 · 마지막 칸의 세로줄 맞춤도 그 절 그대로다(상태바 여백 = 탭 줄과 같은 안쪽 가장자리).
   *  - 모바일 배치(`MobileBar`)는 건드리지 않는다.
   */
  /* 제목줄 쪽(패널 판 · 여백 · 탭 줄 · 창 단추 · 닫기 모서리)은 `chrome/WindowTitlebar.svelte` 의 같은 절 — 여기는 상태바 쪽 */
  /* 두 줄 패널의 아랫줄 — 상태바는 판 · 테두리 · 반지름을 끄고 탭 줄과 같은 안쪽 가장자리에 선다. 아래 1px 칸(투명)이 패널 아래 테두리 자리 */
  .app[data-statusbar="top"][data-statusbar-style="panel"]:not(.mobile) :global(.statusbar[data-pos="top"]) {
    margin: 0 calc(var(--space-2) + 1px);
    border: none;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    background: transparent;
  }
  :global(:root[data-material="glass"]) .app[data-statusbar="top"][data-statusbar-style="panel"]:not(.mobile) :global(.statusbar[data-pos="top"])::before,
  :global(:root[data-material="glass"]) .app[data-statusbar="top"][data-statusbar-style="panel"]:not(.mobile) :global(.statusbar[data-pos="top"])::after {
    display: none;
  }

  /* 타일링 캔버스의 바탕 —터미널 색이 아니라 **앱 배경**이라야 타일 사이 거터가 빈 공간으로 읽힌다.
   *
   * 배경을 **직접 칠하지 않는다**: 거터는 html 의 불투명 바탕 위에 깔린 월페이퍼 · 번짐이 그대로 보이는
   * 자리다 — 여기서 칠하면 그 앱 배경을 덮는다. */
  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .no-tab-start {
    inset: 0;
    /* 탭이 하나도 없는 워크스페이스 — 빈 탭과 같은 화면이라 같은 규칙으로 테두리를 그리지 않는다(PaneHost `.bare`, 2026-10-07) */
    border-color: transparent;
  }

  /* 동시 입력 배너 — 탭 바 바로 아래 한 줄. 레이아웃 흐름에 들어가므로 터미널을 밀어 준다
     (겹치지 않는다 = 스크롤백을 가리지 않는다). 켜져 있는 동안 계속 보인다 */
  .sync-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--warn);
    background: var(--warn-soft);
    border-bottom: 1px solid var(--warn);
  }

  /* `UiIcon` 은 `display:block` 이라 자리 상자에 flex 가운데잡기가 필요하다 */
  .sync-banner .mark {
    display: flex;
    align-items: center;
  }

  .sync-banner .hint {
    color: var(--fg-muted);
  }

  /* 모달(`.overlay`·`.modal`·`.lead`·`.fields`·`.actions` …)의 스코프 규칙은 각 모달 파일(`src/lib/dialogs/*`)이 갖는다 */

  /* 예전의 `.toast` 한 줄은 `Toasts.svelte` 로 옮겨 갔다 (큐가 생겼다 — 위 마크업 주석) */
</style>

<WorkspaceMigrationDialog />
