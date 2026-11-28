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
  // 룬 모듈에는 붙일 컴포넌트 수명이 없다 — `$effect` 의 몸통은 `$lib/app/` 에 두고 효과는 여기서 건다.
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
  import TabTemplateSaveDialog from "$lib/TabTemplateSaveDialog.svelte";
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
  import SettingsTransferDialog from "$lib/dialogs/SettingsTransferDialog.svelte";
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
  import { openTabTemplate, templatePaletteEntries } from "$lib/app/tab-templates.svelte.js";
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
    noteDocFiles,
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
    switchDocHere,
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
    openTemplateSettings,
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

  // 저장된 모드는 `settings.toml` 에 있어 동기로 못 읽는다 — 여기서는 기본 모드로 걸고 `boot()` 이 `loadSettings` 뒤 입힌다.
  initAppMode();

  // ── 호스트 조작 통로 ──
  // 변하는 `refreshKey` 만 게터로 담는다 — 꺼내 쓰는 쪽의 `$effect` 가 그 읽기를 의존성으로 등록해야 목록을 다시 읽는다.
  setHostActions({
    onconnect: connect,
    onaddhost: openAdd,
    onedithost: openEdit,
    onnewsession: connect,
    onconnectnew: connectInNewTab,
    oninstallkey: (host) => void installKeyFor(host),
    onrenamehost: renameHost,
    onduplicatehost: (host) => void duplicateHost(host),
    onforgethostkey: (host) => void forgetHostKeyFor(host),
    onquickconnect: quickConnect,
    onremovehosts: (names) => void removeHostsAction(names),
    onhostrefs: describeHostRefs,
    onopenconfig: openConfig,
    onassigngroups: (names, group) => void assignGroupMany(names, group),
    onduplicatehosts: (items) => void duplicateHostsInto(items),
    onhosts: setHostCache,
    onopendb: openHostDb,
    onadddb: addHostDb,
    onnotice: showNotice,
    // 탭이 없으면 탭 바 드랍과 같은 길 — 대상 타일이 없다고 아무 일도 안 하면 메뉴 항목이 죽은 것처럼 보인다
    onopenhosts: (tabId, paneId, payload) => {
      if (currentWorkspaceTabs().length === 0) void dropHostsAsTab(payload, null);
      else void openHostsTiled(tabId, paneId, "row", "after", payload);
    },
    get refreshKey() {
      return hostsRefreshKey();
    },
  });

  // 에이전트가 살아 있는 타일의 `running` 은 접지 않는다 — 그 타일의 지금은 에이전트 점이 말한다
  const tabBadges = $derived(tabStatus(isLiveAgentPane));
  const bellBadges = $derived(tabBells());
  const agentBadges = $derived(tabAgents());
  const syncOnTabs = $derived(syncTabs());

  const barPos = $derived(mobileLayout() ? "top" : settings.statusBar);
  /** `--titlebar-h`(px) — 탭 모양마다 높이가 달라 CSS 로 셀 수 없다 */
  let titlebarH = $state(0);

  // ── 월페이퍼 ──
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

  // ── 효과 ──

  $effect(() => scheduleTabSave());
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
    const chatStreams = tabs.flatMap((tab) => listPanes(tab.root)).flatMap((pane) => pane.kind === "chat" && pane.chat ? [pane.chat.chatId] : []);
    publishWorkspaceStatus(dots, tiles, locations, chatStreams);
  });
  $effect(() => {
    if (paletteVisible()) untrack(ensureConversations);
  });
  $effect(() => closeWhenEmptied());
  $effect(() => applyChromeOpacity());
  $effect(() => applyTermOpacity());
  $effect(() => syncDynamicColorToMode());
  $effect(() => syncWallpaperTintNow());

  /** 호스트 폼만 여기서 — 나머지 모달은 자기 파일(`dialogs/*`)이 포커스를 건다 */
  $effect(() => {
    if (hostFormVisible()) focusHostForm();
  });

  $effect(() => closeForwardIfSessionGone());
  $effect(() => closeUploadIfSessionGone());
  $effect(() => closeRemoteEditIfSessionGone());

  // ── 시작 스플래시 ──
  // 메인 창은 `visible:false` 로 태어난다 — 첫 프레임이 칠해진 뒤에 띄워야 빈 사각형이 안 보인다. 분리 창은 이 층을 그리지 않는다.
  let booted = $state(false);
  let splashDone = $state(!isMainWindow);

  /** rAF 한 번은 "그리기 직전" 이라 아직 이르다 */
  function afterFirstPaint(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  async function startup(): Promise<void> {
    let shownAt = 0;
    if (isMainWindow) {
      await afterFirstPaint();
      await showThisWindow();
      shownAt = performance.now();
    }
    try {
      await boot();
    } catch (err) {
      // 스플래시는 절대 남지 않는다 — 부팅이 죽어도 `finally` 가 층을 걷는다
      console.error("[boot] 부팅 중 오류", err);
    } finally {
      booted = true;
      // 콜드 스타트를 CDP 로 읽는 한 줄 (docs/log/2026-09-17-splash.md)
      if (isMainWindow) {
        console.info("[boot] splash shown at", shownAt, "booted at", performance.now());
      }
    }
  }

  onMount(() => {
    void startup();
    void loadLimits();
    const unlistenApp = mountAppListeners();
    const unwatchMax = watchWindowMaximize();
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

<!-- `z-index: -1` — 창 바탕 위 · 모든 본문 아래라 `.titlebar` · `.body` 에 z-index 를 붙이지 않아도 순서가 맞는다 -->
{#if wallpaperOn}
  <div class="wallpaper" aria-hidden="true" style={wallpaperStyle}></div>
{:else if settings.material === "glass"}
  <!-- 유리 뒤가 단색이면 판이 회색으로만 읽힌다 — 월페이퍼와 같은 자리에 옅은 번짐을 깐다 -->
  <div class="glass-glow" aria-hidden="true"></div>
{/if}

<!-- 자리마다 DOM 부모가 달라 스니펫 하나를 한 자리에만 그린다 — 세로는 `.body` 안의 flex 자식이어야 `.pane` 이 그 폭만큼 줄어든다 -->
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
  {#if mobileLayout()}<MobileBar />{:else}
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

  {#if barPos === "top" && mobileLayout()}{@render statusbar()}{/if}

  <!-- `data-slide-bleed` — 둥근 패널이면 탭 전환 슬라이드가 캔버스 거터에서 잘리지 않고 패널 뒤로 창 끝까지 지나간다(`PaneHost` 의 `.sliding`) -->
  <div class="body" data-statusbar={barPos} data-statusbar-style={settings.statusBarStyle}
    data-slide-bleed={settings.statusBarStyle === "panel" && !mobileLayout() ? "" : undefined}>
    {#if barPos === "left"}{@render statusbar()}{/if}
    <!-- 독 · 배너 · 검토 카드는 `.body` 안이어야 한다 — 이 상자가 곧 "타이틀바 아래" 기준이라 탭 바 높이를 숫자로 적지 않는다 -->
    <!-- 채팅 독은 런처 독보다 앞 — 같은 z-index 라 뒤에 오는 설정 모달 · 배경막이 이것을 덮는다 -->
    {#if isMainWindow || (isRemote && !mobileLayout())}<ChatDock />{/if}
    <Dock />
    <AgentNotifyBanners />
    <ReviewCard />
    <!-- `data-tile-canvas` — 칸 없이 여는 팔레트가 이 상자 가운데에 선다(`tileCanvasRect`) -->
    <div class="pane" data-tile-canvas>
    <!-- 상태바 감싸기 — 아래 두 모서리 조각(위 두 모서리는 `.pane` 의 ::before · ::after) -->
    <span class="hug-c hug-c3" aria-hidden="true"></span><span class="hug-c hug-c4" aria-hidden="true"></span>
    <!-- 사용량 · 자원 화면은 `.pane` 안 — 상태바와 탭 바는 가리지 않고 타일은 밑에서 마운트된 채 돈다 -->
    <UsageView />
    <ResourceView />
    {#if sessionSheetOpen()}
      <SessionSheet blocked={anyModalOpen() || veilVisible()} />
    {/if}
    <ConversationViewer />
    <!-- 동시 입력 배너에는 닫기 버튼이 없다 — 위험한 모드를 켜 둔 채 표시만 지우면 경고의 의미가 없다 -->
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

    <!-- 여기는 탭이 없을 때의 빈 본문 드랍(→ 새 탭)만 — 타일 위 드랍은 `PaneHost` 가 받고 전파를 멈춘다 -->
    <main ondragover={mainDragOver} ondrop={mainDrop}>
      <!-- 모든 탭의 모든 타일이 한 keyed 목록이다 — 키(pane.id)가 같으면 탭을 옮겨도 세션이 안 끊긴다 -->
      <!-- 원격 창은 보는 워크스페이스의 탭만 세운다 — 숨은 워크스페이스까지 시청자로 붙으면 폰으로 오는 출력이 그 수만큼 는다 -->
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
        ondocfiles={noteDocFiles}
        ondocswitch={(tabId, paneId, path, files) => void switchDocHere(tabId, paneId, path, files)}
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
          // 원격 창의 시청자 타일(R2-B)은 남의 접속을 본다 — 호스트 저장 권유 · 저장해 둔 포워딩 열기는 그 세션을 연 메인 PC 의 일이다.
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
        <div class="tile-canvas">
          <div class="no-tab-start tile-frame chrome">
            <StartPage hosts={hostCache()} />
          </div>
        </div>
      {/if}
    </main>
  </div>
    {#if barPos === "right"}{@render statusbar()}{/if}
  </div>
  {#if barPos === "bottom"}{@render statusbar()}{/if}
  <!-- 띠 · 기둥보다 뒤 차례라 그 위에 선다 -->
  <span class="canvas-edge" aria-hidden="true"></span>
  <span class="canvas-corner" aria-hidden="true"></span>
  {#if mobileLayout()}<MobileKeys />{/if}
  <!-- 토스트는 앱에 한 벌 — `.app` 안이라야 상태바 폭(`--sb-inset-right`)을 받는다(`.app` 은 쌓임 맥락을 만들지 않는다) -->
  <Toasts />
</div>

<!-- 팔레트 콜백은 트리 · 메뉴와 같은 함수여야 한다 — 길이 갈리면 규칙(스크롤백 상속 · 그룹 확인 · 동시 입력 편입)이 조용히 갈린다 -->
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
    onopenconversationchat={settings.chatTile ? (agent, id) => openConversationById(agent, id, false, viewConversationById, true) : undefined}
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
    templates={templatePaletteEntries()}
    onopentemplate={(id) => void openTabTemplate(id, { kind: "newTab" })}
    onmanagetemplates={openTemplateSettings}
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

<!-- 팔레트 · 고르는 목록들은 `{#if}` 로 마운트/언마운트한다 — 질의 · 고른 줄이 지역 상태라 닫으면 저절로 비워진다 -->
{#if folderConversationsVisible()}
  <FolderConversations measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

{#if filePickerVisible()}
  <FilePicker measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

{#if profileSwitcherVisible()}
  <ProfileSwitcher measureCanvas={tileCanvasRect} keybindings={settings.current.keybindings} />
{/if}

{#if searchVisible()}
  <SearchOverlay seed={searchSeed()} onclose={closeSearch} />
{/if}

{#if cheatSheetVisible()}
  <CheatSheet
    keybindings={settings.current.keybindings}
    onclose={closeCheatSheet}
    onopensettings={openKeybindingSettings}
  />
{/if}

<!-- 가림막이 곧 관문이다 — 걷는 것이 볼트를 여는 것이고 걷는 문은 `Veil` 의 폼 하나다 → docs/invariants.md 전문 2 -->
{#if veilVisible()}
  <Veil />
{/if}

<!-- 아래 상자들은 언제나 마운트해 두고 열려 있을 때만 스스로 그린다(`{#if}` 가 컴포넌트 안에 있다) -->
<WorkspaceNameDialog />
<WorkspaceEditDialog />
<WorkspaceDeleteDialog />
{#if workspaceSwitcherVisible()}
  <WorkspaceSwitcher />
{/if}

<SnippetPrompt />

<AskAiPicker />
<CodeTermPicker />
<NewDocBox />
<AiLaunchPicker />

<SnippetSaveDialog />
<TabTemplateSaveDialog />
<ProjectForm />
<WorktreeRemoveDialog />
<WorktreeBranchDialog />

<!-- 순서가 곧 층위다 — 오버레이는 대개 같은 z-index 라 나중에 그려진 것이 위에 온다 -->
<HostKeyDialog />
<VaultUnlockDialog />
<QuitDialog />
<UpdateDialog />
<!-- 마스터 암호 · 앱 아이콘 자르기는 독(설정)보다 뒤여야 같은 z-index 에서 위에 온다 -->
<MasterPromptDialog />
<AppIconCropDialog />
<TermThemeDialog />
<SettingsTransferDialog />
<PasswordDialog />
<PassphraseDialog />
<KeyPickDialog />

<HostForm />

<ForwardDialog />
<DbPickerDialog />
<DbWriteDialog />
<UploadDialog />
<RemoteEditDialog />
<!-- 가림막이 떠 있으면 그리지 않는다 -->
<RemotePairDialog />
<!-- 다른 모달 안에서 물어도 그 위(z 120) -->
<RemoteDialog />
<!-- 다른 모달 안에서 물어도 그 위(z 114 · 가림막 아래) -->
<ConfirmDialog />
<!-- 새 키 만들기 — 여는 길 둘이 모두 이미 모달 위라 모든 오버레이보다 뒤여야 한다 -->
<KeygenDialog />

<!-- 툴팁은 창에 한 벌 — `title` 을 보고 스스로 띄우므로 프롭이 없다 -->
<Tooltip />

<!-- 스플래시는 마크업의 가장 마지막 · 화면의 가장 위(z 200) — 걷는 것은 `onhidden` 한 갈래뿐이다 -->
{#if isMainWindow && !splashDone}
  <Splash {booted} onhidden={() => (splashDone = true)} />
{/if}

<style>
  /* 월페이퍼 — 이미지(::before)와 덮개(::after) 두 겹: 한 요소에 두면 `blur()` 가 덮개까지 흐린다.
   * `--wp-scale` 은 블러의 뿌연 테두리 띠를 화면 밖으로 밀어낸다. */
  .wallpaper {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
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

  .glass-glow {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: var(--glass-glow, none);
  }

  .app {
    display: flex;
    flex-direction: column;
    height: calc(100vh / var(--css-zoom, 1)); /* 원격의 UI 크기(루트 CSS zoom)를 되돌린다 — 앱 창에는 이 변수가 없다 */
    overflow: hidden;
  }
  /* 원격의 UI 크기는 루트 CSS zoom 이라(`remote/polyfill.js`) `--app-h` 에도 곱해진다 — 계수로 나눠 화면 높이에 맞춘다 */
  .app.mobile {
    height: calc(var(--app-h, 100dvh) / var(--css-zoom, 1));
  }

  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    /* `hidden` 이 아니라 `clip` — `hidden` 은 포커스 · 스크립트로 밀려, 탭 슬라이드 중 앱 틀째 밀리면 닫힌 독이 드러나고 타일이 잘린다 */
    overflow: clip;
  }

  /* 독의 inset 은 `Dock` 이 읽는다 — 세로 기둥 폭만큼 밀어 상태바를 덮지 않는다 */
  .body[data-statusbar="left"] {
    --dock-inset-left: var(--sb-w);
  }
  /* panel 이면 기둥이 창 쪽 여백(`--space-2`, `StatusBar.svelte`)만큼 더 차지한다 */
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
  /* 슬라이드 중에만 패널이 타일 위 층에 선다 — 쉴 때 쌓임 맥락을 만들면 띠 안의 `position: fixed` 상자(원격 칩 상자 등)가 독 · 타일 밑으로 들어간다 */
  :global(.body[data-slide-bleed]:has(.host.sliding) > .statusbar) {
    position: relative;
    z-index: 1;
  }

  .pane {
    /* 사용량 · 자원 화면(`CoverPanel`)의 기준 상자 */
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* 판이 떠 있는 동안 밑의 타일을 `visibility` 로 감춘다(마운트된 채 출력 · 크기를 받는다).
     `visibility` 전환은 숨는 방향에만 건다 — 판을 닫으며 타일로 포커스를 돌려주려면 그 순간 보여야 한다(`usage-view` 의 `closeCoverView`).
     `opacity` 가 아니라 `--tile-in` 인 것은 글래스 타일의 흐림 판을 끊지 않으려고다(`PaneHost` 의 `.glass-tile` 페이드 절). */
  .pane > main {
    transition: --tile-in 200ms ease-out;
  }
  .pane:has(> :global([data-cover-view]:not([hidden], [data-closing]))) > main {
    visibility: hidden;
    --tile-in: 0;
    transition:
      --tile-in 200ms ease-out,
      visibility 200ms linear;
  }
  @media (prefers-reduced-motion: reduce) {
    .pane > main,
    .pane:has(> :global([data-cover-view]:not([hidden], [data-closing]))) > main {
      transition: none;
    }
  }

  /*
   * 상태바 감싸기(hug) — 모서리 조각이 곡선 바깥만 크롬 면 색으로 칠한다. 곡선은 바깥 타일 모서리와 같은 중심이라 타일에 겹치지 않는다.
   * 선은 덮어 가리지 말고 곡선 끝 ~ 곡선 끝 사이에만 긋는다 — 크롬 면이 반투명이라 덮으면 밑의 직선이 비쳐 직각 테두리가 남는다.
   * 조각은 캔버스 덮개 위에 선다(모서리가 덮개에 가려 각지지 않게). 모바일 배치는 감지 않는다.
   */
  .app[data-statusbar-style="hug"] {
    --hug-r: calc(var(--gap) + var(--radius-surface));
    --hug-x: calc(var(--hug-r) + 1px); /* 모서리 조각의 한 변 = 반지름 + 1px 선 */
    --hug-rim: 3px; /* 창 가장자리 쪽 변의 크롬 테두리 두께 */
  }
  .body[data-statusbar-style="hug"] .pane {
    --hug-face: var(--glass-band, var(--surface-raised));
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
  .app.mobile .body[data-statusbar-style="hug"] .pane {
    background-image: none;
  }
  .app.mobile .body[data-statusbar-style="hug"] .pane::before,
  .app.mobile .body[data-statusbar-style="hug"] .pane::after {
    display: none;
  }
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
    /* 조각 · 선 · 덮개(`inset: 0`)는 테두리 안쪽(패딩 상자)에 선다 */
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
   * 글래스 — 흐림 판을 창 전체 한 장으로 들고 캔버스 자리만 뚫는다. 자리마다 따로면 맞닿은 곳에 직선 이음매가 비친다.
   * 구멍의 모서리는 조각 곡선과 같은 원이라 사이로 바탕이 안 샌다. 자리마다의 판(`.glass-band::before`)은 끈다.
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
  /* 제목줄 쪽 짝 규칙은 `chrome/WindowTitlebar.svelte` 의 감싸기 절 */
  :global(:root[data-material="glass"]) .app[data-statusbar-style="hug"]:not(.mobile) :global(.statusbar)::before {
    display: none;
  }

  /*
   * 위 상태바 = 머리 한 덩어리 · 띠 두께 = 탭 줄 두께 — 숫자를 따로 적지 않고 탭 줄에서 셈한다(`Tabs.svelte` 의 `.tabs` · `.strip`).
   * 탭 줄도 같은 값으로 높이를 못 박는다(`WindowTitlebar` 의 `.tabs`) — 내용으로 정해지면 소수 배율에서 1px 선이 깎여 띠와 어긋난다.
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
    /* 위 상태바는 제목줄 안(`StatusBar` 의 `inline`)이라 머리 아래 상태바 줄이 없다 — 이 값을 쓰는 규칙(감싸기 구멍 등)이 남아 0 으로 둔다.
       아래 `.statusbar[data-pos="top"]` 규칙들은 폰이 아니면 걸리지 않는다(데스크톱은 `data-pos="inline"`) */
    --head-sb-h: 0px;
  }
  .app[data-statusbar="top"]:not(.mobile) :global(.statusbar[data-pos="top"]) {
    height: var(--head-sb-h);
    --sb-cell-h: 24px;
    padding: 0 calc(var(--space-2) + 1px);
  }
  /* 글래스 — 탭 줄 · 창 단추 · 상태바가 판을 따로 들면 맞닿은 곳마다 이음매가 비친다 */
  :global(:root[data-material="glass"]) .app[data-statusbar="top"]:not(.mobile)[data-statusbar-style="flat"] :global(.statusbar[data-pos="top"])::before {
    display: none;
  }

  /*
   * 캔버스 가장자리(`.canvas-edge`) — 탭 줄 아래 변을 탭 줄 · 창 단추의 테두리 대신 한 상자의 위 테두리로 긋는다(두 상자 경계의 소수 픽셀 이음매가 없다).
   * 기둥 선은 기둥 자신의 테두리 그대로 둔다 — 떠 있는 상자의 세로 테두리는 소수 배율에서 반 칸 번진다.
   * 층 1 — 탭 줄 메뉴(6 · 7) · 세션 판(95) · 독(100) 아래. `.app` 의 자식이라 `.body` 의 `overflow` 에 잘리지 않는다.
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
  /* L 의 위 변은 안쪽 모서리 곡선이 끝난 데서 시작한다 */
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"] .canvas-edge {
    left: calc(var(--sb-w) + var(--corner-r));
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"] .canvas-edge {
    right: calc(var(--sb-w) + var(--corner-r));
  }

  /*
   * 평면 L 의 안쪽 모서리(`.canvas-corner`) — 평면 띠가 왼쪽 · 오른쪽이면 그 한 모서리만 타일과 같은 중심의 곡선으로 돈다.
   * 선은 덮어 가리지 않고 곡선이 끝난 데서 잇는다(감싸기와 같은 까닭) — 기둥 선은 첫 `--corner-r` 만 비운다(`border-image`).
   * 세션 판의 자르는 상자도 이 모서리를 같은 곡률로 깎는다(`SessionSheet.svelte`).
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
  /* 면은 첫 줄 · 기둥 쪽 첫 칸을 뺀 안쪽만 — 그 칸은 이미 칠해져 있어 한 번 더 칠하면 반투명이 겹쳐 옅은 네모 테두리가 뜬다 */
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
  .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar.vertical) {
    border-image-source: linear-gradient(transparent var(--corner-r), var(--glass-border, var(--line)) var(--corner-r));
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"] :global(.statusbar.vertical) {
    border-image-slice: 0 1 0 0;
  }
  .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"] :global(.statusbar.vertical) {
    border-image-slice: 0 0 0 1;
  }
  /*
   * L + 글래스 — 흐림과 판 색을 창 전체 한 장이 든다. 상자마다 칠하면 소수 배율에서 상자 경계에 실금이 뜬다(제목줄 쪽은 `chrome/WindowTitlebar.svelte`).
   * 판은 창보다 사방 4px 크다 — 마스크를 건 흐림 판이 창 끝과 꼭 맞으면 1.25× 에서 창 네 끝 한 줄이 어둡게 뜬다.
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
      /* 안쪽 모서리의 곡선 바깥 — 기둥 · 탭 줄 쪽으로 3px 더 겹친다: 경계를 맞대면 소수 배율에서 두 층이 반씩 덮어 실금이 뜬다 */
      radial-gradient(circle at 100% 100%, transparent var(--corner-x), #000 var(--corner-x)) var(--sb-w) var(--titlebar-h) / calc(var(--corner-x) + 3px) calc(var(--corner-x) + 3px) no-repeat;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"]::before {
    mask:
      linear-gradient(#000 0 0) left top / 100% calc(var(--titlebar-h) + 3px) no-repeat,
      linear-gradient(#000 0 0) right top / calc(var(--sb-w) + 3px) 100% no-repeat,
      radial-gradient(circle at 0% 100%, transparent var(--corner-x), #000 var(--corner-x)) right var(--sb-w) top var(--titlebar-h) / calc(var(--corner-x) + 3px) calc(var(--corner-x) + 3px) no-repeat;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar)::before {
    display: none;
  }
  :global(:root[data-material="glass"]) .app:not(.mobile)[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.statusbar) {
    background: transparent;
  }

  /* 둥근 패널이면 탭 줄도 떠 있는 둥근 패널 — 제목줄 쪽은 `chrome/WindowTitlebar.svelte` 의 같은 절, 여기는 상태바 쪽 */
  /* 두 줄 패널의 아랫줄 — 아래 1px 칸(투명)이 패널 아래 테두리 자리 */
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

  /* 배경을 칠하지 않는다 — 거터는 월페이퍼 · 번짐이 그대로 보이는 자리다 */
  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .no-tab-start {
    inset: 0;
    /* 빈 탭과 같은 규칙(PaneHost `.bare`) */
    border-color: transparent;
  }

  /* 흐름 안에 둔다 — 겹쳐 띄우면 스크롤백을 가린다 */
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

  .sync-banner .mark {
    display: flex;
    align-items: center;
  }

  .sync-banner .hint {
    color: var(--fg-muted);
  }
</style>

<WorkspaceMigrationDialog />
