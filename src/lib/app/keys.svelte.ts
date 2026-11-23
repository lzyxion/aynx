import { closeWorkspaceSwitcher, openWorkspaceSwitcher, stepWorkspace, workspaceSwitcherVisible, workspaceMigrationProblems } from "$lib/app/workspaces.svelte.js";
import { closeWorkspaceDeletePrompt, workspaceDeletePrompt, closeWorkspaceNamePrompt, closeWorkspaceEditPrompt, deleteWorkspaceAsked, newWorkspacePrompt, editWorkspacePrompt, workspaceNamePrompt, workspaceEditPrompt } from "$lib/app/workspace-actions.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import {
  bypassesEditGuard,
  comboFromEvent,
  editorOwnsKey,
  effectiveCombo,
  isBrowserChromeCombo,
  isTerminalKeysInput,
  isInDocEditor,
  isControlOwnedKey,
  isEditableTarget,
  resolveBindings,
  shouldBlockNativeContextMenu,
  tabIndexOf,
} from "$lib/keybindings";
import { commandsOf, type CommandApi } from "$lib/shell-integration";
import { openTileFind } from "$lib/app/tile-find";
import { findPane, hasSession, newTab } from "$lib/session";
import {
  activeTab,
  activeTabId,
  closeFocusedTile,
  closePaneIn,
  closeTabAsked,
  cycleTab,
  moveFocus,
  moveTile,
  resizeTile,
  openTab,
  paneOf,
  reconnectAllDeferred,
  selectTabAt,
  splitActive,
  toggleSync,
  zoomFocusedTile,
} from "$lib/app/tabs.svelte.js";
import {
  openDefaultShell,
  openFilesHere,
  openLocalFsPaneHere,
} from "$lib/app/panes.svelte.js";
import { closeDock, dockKind, toggleDock } from "$lib/app/dock.svelte.js";
import { toggleChatDock } from "$lib/app/chat-dock.svelte.js";
import { closeSessionSheet, sessionSheetOpen, toggleSessionSheet } from "$lib/app/session-sheet.svelte.js";
import { togglePlans } from "$lib/app/plans.svelte.js";
import { handleOrchEscape, openOrchHome, startOrchestrationHere } from "$lib/app/orchestration.svelte.js";
import { closeCoverView, coverViewOpen } from "$lib/app/usage-view.svelte.js";
import { closeConversationView, conversationViewOpen } from "$lib/app/conversation-viewer.svelte.js";
import {
  closeFolderConversations,
  folderConversationsVisible,
  toggleFolderConversations,
} from "$lib/app/folder-conversations.svelte.js";
import { closeFilePicker, filePickerVisible, toggleFilePicker } from "$lib/app/file-picker.svelte.js";
import {
  closeProfileSwitcher,
  profileSwitcherVisible,
  toggleProfileSwitcher,
} from "$lib/app/profile-switcher.svelte.js";
import { raiseVeil } from "$lib/app/veil.svelte.js";
import { openQuitDialog, quitDialogOpen } from "$lib/app/quit-dialog.svelte.js";
import { updateCardOpen } from "$lib/app/updater.svelte.js";
import { isRemote } from "$lib/app/window.svelte.js";
import { handheld } from "$lib/app/mobile.svelte.js";
import { openNextAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { openBranchGraphHere } from "$lib/app/branch-graph.svelte.js";
import { closeDbWriteConfirm, dbPickerVisible, dbWriteConfirmVisible, escapeDbPicker, openDbPicker } from "$lib/app/query.svelte.js";
import { askAiAboutLastBlock, askPickerOpen, closeAskPicker } from "$lib/app/ask-ai.svelte.js";
import { closeCodeTermPicker, codeTermPickerOpen } from "$lib/app/code-to-term.svelte.js";
import { closeNewDoc, newDocBoxOpen } from "$lib/app/new-doc.svelte.js";
import { aiLaunchPickerOpen, closeAiLaunchPicker, openAiLaunchPicker } from "$lib/app/ai-launch.svelte.js";
import {
  cheatSheetVisible,
  closeCheatSheet,
  closePalette,
  closeSearch,
  openSearch,
  openSnippetPalette,
  paletteVisible,
  searchVisible,
  toggleCheatSheet,
  togglePalette,
} from "$lib/app/overlays.svelte.js";
import { snippetPromptOpen, snippetSaveOpen } from "$lib/app/snippets.svelte.js";
import { openTabTemplateSave, tabTemplateSaveOpen } from "$lib/app/tab-templates.svelte.js";
import { canFlipPane, toggleFlip } from "$lib/pane/ai-flip.svelte.js";
import { projectFormOpen, worktreeRemoveOpen } from "$lib/app/projects.svelte.js";
import { worktreeBranchOpen } from "$lib/app/worktree-branch.svelte.js";
import { disambiguateNames, searchTargets } from "$lib/search-registry";
import {
  closeForm,
  hostFormVisible,
} from "$lib/app/hosts.svelte.js";
import {
  closeForward,
  closeRemoteEdit,
  closeUpload,
  forwardVisible,
  openRemoteEdit,
  remoteEditVisible,
  uploadVisible,
} from "$lib/app/transfer.svelte.js";
import {
  answerHostKey,
  hostKeyPrompt,
  keyPickVisible,
  passphraseVisible,
  passwordVisible,
  resolveKeyPick,
  resolvePassphrase,
  resolvePassword,
  skipVaultUnlock,
  vaultUnlockVisible,
} from "$lib/app/prompts.svelte.js";
import { closeKeygen, keygenVisible } from "$lib/app/keygen.svelte.js";
import { closeMasterPrompt, masterPromptVisible } from "$lib/app/vault.svelte.js";
import { appIconCropVisible, closeAppIconCrop } from "$lib/app/app-icons.svelte.js";
import { closeTermThemeDialog, termThemeDialogVisible } from "$lib/app/term-themes.svelte.js";
import {
  closeTransferDialog,
  openSettingsExport,
  openSettingsImport,
  transferDialogVisible,
} from "$lib/app/settings-transfer.svelte.js";
import { remoteDialogOpen } from "$lib/app/remote-dialog.svelte.js";
import { confirmDialogOpen, dismissConfirm } from "$lib/app/confirm-dialog.svelte.js";

/**
 * 창 하나에 keydown 핸들러가 하나뿐이고, 그 하나가 여기 있다.
 * `Ctrl+D` · `?` 는 키바인딩 해석보다 먼저 본다 — 다시 묶었더라도 세션 없는 타일 위에서는 셸과 같은 뜻(닫기)이 먼저 읽혀야 한다.
 * 키와 팔레트는 `runAction` 몸통 하나를 지난다 — 둘로 나누면 한쪽만 고쳐 조용히 어긋난다.
 */

// ---------------------------------------------------------------------------
// 가드
// ---------------------------------------------------------------------------

/** 화면을 덮고 자기 키를 스스로 다루는 것들 — 하나라도 있으면 전역 키가 통째로 쉰다 */
export function anyModalOpen(): boolean {
  if (workspaceMigrationProblems().length > 0) return true;
  return (
    dockKind() === "settings" ||
    quitDialogOpen() ||
    updateCardOpen() ||
    paletteVisible() ||
    folderConversationsVisible() ||
    filePickerVisible() ||
    workspaceSwitcherVisible() ||
    workspaceNamePrompt.open ||
    workspaceEditPrompt.open ||
    workspaceDeletePrompt.open ||
    profileSwitcherVisible() ||
    askPickerOpen() ||
    codeTermPickerOpen() ||
    newDocBoxOpen() ||
    aiLaunchPickerOpen() ||
    // 검색 오버레이는 화면을 덮지 않지만 넣는다 — 빼면 검색어를 치는 동안 전역 단축키가 같이 돈다.
    searchVisible() ||
    cheatSheetVisible() ||
    hostKeyPrompt() !== null ||
    passwordVisible() ||
    passphraseVisible() ||
    keyPickVisible() ||
    forwardVisible() ||
    dbPickerVisible() ||
    dbWriteConfirmVisible() ||
    uploadVisible() ||
    remoteEditVisible() ||
    hostFormVisible() ||
    // Escape 는 그 모달이 자기 상자에서 잡아 끊으므로 아래 Escape 사슬에는 줄이 없다.
    snippetPromptOpen() ||
    snippetSaveOpen() ||
    tabTemplateSaveOpen() ||
    projectFormOpen() ||
    // 워크트리 제거 확인 — 화면을 덮는 상자다(뒤의 독이 Delete·Enter 를 다시 받으면 안 된다).
    worktreeRemoveOpen() ||
    worktreeBranchOpen() ||
    masterPromptVisible() ||
    appIconCropVisible() ||
    termThemeDialogVisible() ||
    transferDialogVisible() ||
    remoteDialogOpen() ||
    confirmDialogOpen()
  );
}

/** [`isEditableTarget`] 보다 좁다 — 검색 칸은 타일의 일부라 `Ctrl+D` 가 타일을 닫고, 이름 변경 칸은 키를 그 칸에 남긴다 */
export function isInlineEditTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("[data-inline-edit]") !== null;
}

function handleTileClose(ev: KeyboardEvent): boolean {
  if (ev.code !== "KeyD") return false;
  if (!ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return false;
  if (anyModalOpen() || isInlineEditTarget(ev.target)) return false;
  // 문서 편집기 안의 `Ctrl+D` 는 편집기의 것이다 — 문서 타일은 세션이 없어 아래로 가면 타일이 닫힌다.
  if (isInDocEditor(ev.target)) return false;
  const tab = activeTab();
  if (!tab) return false;
  const paneId = paneOf(tab);
  const pane = findPane(tab.root, paneId);
  if (!pane || hasSession(pane.kind)) return false;
  ev.preventDefault();
  closePaneIn(tab.id, paneId);
  return true;
}

/** `ev.key` 로 보지 않는다 — 한국어 IME 가 켜지면 모든 키가 `"Process"` 로 뭉개져 이 문이 조용히 닫힌다 */
function handleCheatSheetKey(ev: KeyboardEvent): boolean {
  if (ev.code !== "Slash" || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return false;
  if (anyModalOpen() || isEditableTarget(ev.target) || isInlineEditTarget(ev.target)) return false;
  if (isInDocEditor(ev.target)) return false;
  // `<select>` 의 `?` 는 글자 찾기다 — 그 칸의 것이다. 체크박스 위의 `?` 는 뜻이 없어 앱이 받는다.
  if (isControlOwnedKey(ev.target, ev)) return false;
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  if (pane && hasSession(pane.kind)) return false;
  ev.preventDefault();
  toggleCheatSheet();
  return true;
}

// ---------------------------------------------------------------------------
// 액션 실행
// ---------------------------------------------------------------------------

function activeCommands(): CommandApi | null {
  const tab = activeTab();
  const api = tab ? commandsOf(paneOf(tab)) : null;
  if (!api) showNotice(t("commands.keys.terminalRequired"));
  return api;
}

/**
 * 타일 이름이 아니라 레지스트리의 충돌 구분 라벨(`bash/2`)을 쓴다 — 이름이 같으면 `@bash` 는 늘 첫 타일을 가리킨다.
 * 따옴표로 감싸는 문법은 `search-chips.ts` 의 `composeQuery` 한 곳에만 둔다 — 라벨 그대로 돌려준다.
 */
function focusedTerminalLabel(): string | null {
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  if (!pane || !hasSession(pane.kind)) return null;
  const targets = searchTargets();
  const i = targets.findIndex((t) => t.paneId === pane.id);
  if (i === -1) return null;
  return disambiguateNames(targets.map((t) => t.name()))[i];
}

function focusedTileFind(): boolean {
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  return !!pane && openTileFind(pane.id);
}

/** 터미널 층 액션도 여기서 받는다 — 키로는 `Terminal.handleShortcut` 이 처리하지만, 팔레트 줄이 눌러도 아무 일이 없게 남지 않게 */
export function runAction(action: string): void {
  const nth = tabIndexOf(action);
  if (nth !== null) {
    selectTabAt(nth);
    return;
  }

  switch (action) {
    // id 는 `new-tab` 그대로다(사용자 오버라이드 호환) — 뜻은 새 탭이다.
    case "new-tab":
      openTab(newTab());
      break;
    case "close-tab": {
      const id = activeTabId();
      if (id) void closeTabAsked(id);
      break;
    }
    case "new-shell":
      void openDefaultShell();
      break;
    case "close-tile":
      closeFocusedTile();
      break;
    case "next-tab":
      cycleTab(1);
      break;
    case "prev-tab":
      cycleTab(-1);
      break;
    case "split":
      splitActive();
      break;
    case "open-settings":
      toggleDock("settings");
      break;
    case "open-hosts-dock":
      toggleDock("hosts");
      break;
    case "open-projects-dock":
      toggleDock("projects");
      break;
    case "open-db-dock":
      toggleDock("db");
      break;
    case "open-chat-dock":
      toggleChatDock();
      break;
    case "open-alerts-dock":
      toggleDock("alerts");
      break;
    // id 는 관리뷰 시절의 `open-console` 그대로다.
    case "open-console":
      toggleSessionSheet();
      break;
    case "open-plans":
      togglePlans();
      break;
    // id `orchestration-start` 는 그대로 둔다.
    case "orchestration-start":
      void startOrchestrationHere();
      break;
    case "orchestration-board":
      openOrchHome();
      break;
    case "folder-conversations":
      toggleFolderConversations();
      break;
    case "open-file":
      toggleFilePicker();
      break;
    case "branch-graph":
      openBranchGraphHere();
      break;
    case "open-db":
      void openDbPicker();
      break;
    case "save-tab-template":
      openTabTemplateSave(null);
      break;
    case "export-settings":
      void openSettingsExport();
      break;
    case "import-settings":
      void openSettingsImport();
      break;
    case "switch-workspace":
      openWorkspaceSwitcher();
      break;
    case "next-workspace":
      stepWorkspace(1);
      break;
    case "prev-workspace":
      stepWorkspace(-1);
      break;
    case "new-workspace":
      newWorkspacePrompt();
      break;
    case "rename-workspace":
      editWorkspacePrompt();
      break;
    case "delete-workspace":
      void deleteWorkspaceAsked();
      break;
    case "switch-profile":
      toggleProfileSwitcher();
      break;
    // 가림막은 볼트도 함께 잠근다 — 이 키는 켜기만 하고, 걷는 문은 가림막 위의 관문 하나뿐이다(`Veil.svelte`).
    // 액션 id 는 `settings.toml` 키라 `toggle-veil` 그대로다.
    case "toggle-veil":
      raiseVeil();
      break;
    // 독이 떠 있으면 먼저 닫는다 — 모달이 독 뒤에 숨지 않게.
    case "quit-app":
      if (isRemote) break;
      closeDock();
      if (dockKind() === "settings") break; // 설정의 미저장 변경을 묻는 중이다 — 그 답이 먼저다
      openQuitDialog();
      break;
    case "go-to-alert":
      openNextAgentBanner();
      break;
    case "open-sftp":
      openFilesHere();
      break;
    case "open-localfs":
      openLocalFsPaneHere();
      break;
    case "ai-panel":
      void openAiLaunchPicker();
      break;
    case "toggle-sync":
      toggleSync();
      break;
    case "reconnect-all":
      reconnectAllDeferred();
      break;
    case "focus-left":
      moveFocus("left");
      break;
    case "focus-right":
      moveFocus("right");
      break;
    case "focus-up":
      moveFocus("up");
      break;
    case "focus-down":
      moveFocus("down");
      break;
    case "move-left":
      moveTile("left");
      break;
    case "move-right":
      moveTile("right");
      break;
    case "move-up":
      moveTile("up");
      break;
    case "move-down":
      moveTile("down");
      break;
    case "expand-left":
      resizeTile("left");
      break;
    case "expand-right":
      resizeTile("right");
      break;
    case "expand-up":
      resizeTile("up");
      break;
    case "expand-down":
      resizeTile("down");
      break;
    case "zoom-tile":
      zoomFocusedTile();
      break;
    case "flip-convo": {
      const tab = activeTab();
      const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
      if (pane && canFlipPane(pane)) toggleFlip(pane.id);
      else showNotice(t("pane.flip.notAi"));
      break;
    }
    case "command-palette":
      togglePalette();
      break;
    case "cheat-sheet":
      toggleCheatSheet();
      break;
    case "insert-snippet":
      openSnippetPalette();
      break;
    case "find":
      if (focusedTileFind()) break;
      openSearch({ scopeChip: focusedTerminalLabel(), blockChip: null, text: "" });
      break;
    case "find-all":
      openSearch({ scopeChip: null, blockChip: null, text: "" });
      break;

    // ── 터미널 층 ──────
    case "jump-prev":
      activeCommands()?.jump(-1);
      break;
    case "jump-next":
      activeCommands()?.jump(1);
      break;
    case "copy-output":
      void activeCommands()?.copyOutput();
      break;
    case "edit-remote": {
      const tab = activeTab();
      if (!tab) showNotice(t("commands.keys.terminalRequired"));
      else openRemoteEdit(tab.id, paneOf(tab));
      break;
    }
    case "ask-ai-block":
      if (activeCommands()) askAiAboutLastBlock(paneOf(activeTab()!));
      break;
  }
}

/** 터미널은 같은 조합을 삼키기만 하고(셸로 새지 않게) 실제 동작은 [`runAction`] 한 곳에서 돈다 */
function handleGlobalShortcut(ev: KeyboardEvent): void {
  if (anyModalOpen()) return; // 모달은 언제나 먼저다 — 예외 없음
  const combo = comboFromEvent(ev);
  if (!combo) return;
  // 폼 컨트롤이 스스로 쓰는 맨 키면 기본 동작까지 그대로 둔다 — 아래 `preventDefault` 보다 먼저여야 한다.
  if (isControlOwnedKey(ev.target, ev)) return;
  const action = resolveBindings(settings.current.keybindings).global.get(combo);
  // 편집기(CodeMirror)는 이미 제 키를 처리했다 — 실행하지 않고, 앱 조합 · 브라우저 가속키의 기본 동작만 끊는다.
  if (editorOwnsKey(ev.target, combo, { bound: action !== undefined, paletteCombo: paletteCombo() })) {
    if (action !== undefined || isBrowserChromeCombo(combo)) ev.preventDefault();
    return;
  }
  if (!action) {
    // 묶이지 않은 조합도 브라우저 가속키면 기본 동작만 끊는다 — 아니면 `Ctrl+P` 에 인쇄 대화상자가 뜬다.
    if (isBrowserChromeCombo(combo)) ev.preventDefault();
    return;
  }

  // 묶인 조합은 실행 여부와 무관하게 기본 동작부터 끊는다 — 아래 가드에 걸려도 브라우저 기본 동작이 새지 않게.
  ev.preventDefault();

  // 인라인 편집기는 어느 액션에도 양보하지 않는다 — 조합 자체를 받아 적는 자리다.
  if (isInlineEditTarget(ev.target)) return;
  // 편집기 안에서 여기까지 온 키는 앱이 쥐는 계열이라 입력칸 가드를 지나간다.
  if (!isInDocEditor(ev.target) && !bypassesEditGuard(action) && isEditableTarget(ev.target) && !isTerminalKeysInput(ev.target)) return;

  runAction(action);
}

function paletteCombo(): string | null {
  return effectiveCombo("command-palette", settings.current.keybindings);
}

/**
 * 창 keydown 은 버블 단계라 편집기가 먼저 돈다 — 편집기 기본 키맵이 앱 키와 겹치면 둘 다 일어나므로, 여기서 기본 동작만 끊어
 * 편집기를 비켜 세운다(CodeMirror 는 `defaultPrevented` 키를 처리하지 않는다 · 전파는 끊지 않는다).
 * 편집기 밖에서는 모달과 무관하게 브라우저 기본 동작부터 끊는다 — `stopPropagation` 하는 입력칸은 버블 리스너에 닿지 않는다.
 */
export function onWindowKeydownCapture(ev: KeyboardEvent): void {
  const combo = comboFromEvent(ev);
  if (!combo) return;
  if (!isInDocEditor(ev.target)) {
    if (isBrowserChromeCombo(combo)) ev.preventDefault();
    return;
  }
  if (anyModalOpen()) return;
  const bound = resolveBindings(settings.current.keybindings).global.has(combo);
  if (!editorOwnsKey(ev.target, combo, { bound, paletteCombo: paletteCombo() })) ev.preventDefault();
}

// ---------------------------------------------------------------------------
// 창 이벤트
// ---------------------------------------------------------------------------

export function onWindowKeydown(ev: KeyboardEvent): void {
  if (workspaceMigrationProblems().length > 0) {
    if (ev.key === "Escape" || isBrowserChromeCombo(comboFromEvent(ev) ?? "")) ev.preventDefault();
    return;
  }
  if (ev.key === "Escape") {
    // 확인 · 알림 상자가 맨 위다(다른 모달 안에서도 물을 수 있다).
    if (confirmDialogOpen()) {
      ev.preventDefault();
      dismissConfirm();
      return;
    }
    if (workspaceDeletePrompt.open) {
      ev.preventDefault();
      closeWorkspaceDeletePrompt();
      return;
    }
    if (workspaceEditPrompt.open) {
      ev.preventDefault();
      closeWorkspaceEditPrompt();
      return;
    }
    if (workspaceNamePrompt.open) {
      ev.preventDefault();
      closeWorkspaceNamePrompt();
      return;
    }
    if (workspaceSwitcherVisible()) {
      ev.preventDefault();
      closeWorkspaceSwitcher();
      return;
    }
    // 팔레트는 다른 무엇 위에도 뜰 수 있어 사슬의 앞이다.
    if (paletteVisible()) {
      ev.preventDefault();
      closePalette();
      return;
    }
    if (folderConversationsVisible()) {
      ev.preventDefault();
      closeFolderConversations();
      return;
    }
    if (filePickerVisible()) {
      ev.preventDefault();
      closeFilePicker();
      return;
    }
    if (profileSwitcherVisible()) {
      ev.preventDefault();
      closeProfileSwitcher();
      return;
    }
    if (askPickerOpen()) {
      ev.preventDefault();
      closeAskPicker("source");
      return;
    }
    if (codeTermPickerOpen()) {
      ev.preventDefault();
      closeCodeTermPicker("source");
      return;
    }
    if (newDocBoxOpen()) {
      ev.preventDefault();
      closeNewDoc("source");
      return;
    }
    if (aiLaunchPickerOpen()) {
      ev.preventDefault();
      closeAiLaunchPicker(true);
      return;
    }
    // 검색 오버레이는 팔레트 다음 · 치트시트 앞이다 — 나머지 모달보다 나중에 열려 위에 있다.
    if (searchVisible()) {
      ev.preventDefault();
      closeSearch();
      return;
    }
    if (cheatSheetVisible()) {
      ev.preventDefault();
      closeCheatSheet();
      return;
    }
    if (masterPromptVisible()) {
      ev.preventDefault();
      closeMasterPrompt();
      return;
    }
    if (appIconCropVisible()) {
      ev.preventDefault();
      closeAppIconCrop();
      return;
    }
    if (termThemeDialogVisible()) {
      ev.preventDefault();
      closeTermThemeDialog();
      return;
    }
    if (transferDialogVisible()) {
      ev.preventDefault();
      closeTransferDialog();
      return;
    }
    // 새 키 만들기는 여는 길이 둘 다 이미 모달 위라 가장 나중에 열린 것이다.
    if (keygenVisible()) {
      ev.preventDefault();
      closeKeygen();
      return;
    }
    // Escape = [이번엔 건너뛰기] — 호스트 키와 달리 "이번 접속은 금고 없이" 라는 멀쩡한 답이다.
    if (vaultUnlockVisible()) {
      ev.preventDefault();
      skipVaultUnlock();
      return;
    }
    if (hostKeyPrompt()) {
      ev.preventDefault();
      // 모르는 채로 닫는 것은 **거부**다 (수락도, 이번만도 아니다).
      answerHostKey("reject");
      return;
    }
    if (passwordVisible()) {
      ev.preventDefault();
      resolvePassword(null);
      return;
    }
    if (passphraseVisible()) {
      ev.preventDefault();
      // 취소 = "이 키는 빼고 계속" — 세션 열기는 다음 후보(결국 비밀번호)로 이어진다.
      resolvePassphrase(null);
      return;
    }
    if (keyPickVisible()) {
      ev.preventDefault();
      resolveKeyPick(null);
      return;
    }
    if (forwardVisible()) {
      ev.preventDefault();
      closeForward();
      return;
    }
    if (dbPickerVisible()) {
      ev.preventDefault();
      escapeDbPicker();
      return;
    }
    if (dbWriteConfirmVisible()) {
      ev.preventDefault();
      closeDbWriteConfirm(false);
      return;
    }
    if (uploadVisible()) {
      ev.preventDefault();
      closeUpload();
      return;
    }
    if (remoteEditVisible()) {
      ev.preventDefault();
      closeRemoteEdit();
      return;
    }
    if (hostFormVisible()) {
      ev.preventDefault();
      closeForm();
      return;
    }
    // 기록 보기 시트는 사용량 화면 앞이다 — 그 위에 뜨는 층이다.
    if (conversationViewOpen() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      closeConversationView();
      return;
    }
    // 세션 목록 판도 사용량 화면 앞이다 — 그 위에 내려오는 덮개다.
    if (sessionSheetOpen() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      closeSessionSheet();
      return;
    }
    // 사용량 · 자원 화면이 사슬의 맨 끝이다 — 캔버스를 덮는 화면이라 위에 뜬 무엇이든 먼저 닫힌다.
    if (coverViewOpen() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      closeCoverView();
      return;
    }
    handleOrchEscape(ev);
    return;
  }

  // 타일 닫기(`Ctrl+D`)는 **키바인딩 해석보다 먼저**다.
  if (handleTileClose(ev)) return;

  if (handleCheatSheetKey(ev)) return;

  handleGlobalShortcut(ev);
}

/** 아무도 받지 않은 파일 드랍은 웹뷰가 그 파일로 이동해 앱 화면이 통째로 사라진다 — 창 전체에서 기본 동작만 끈다 */
export function blockStrayFileDrop(ev: DragEvent): void {
  if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
}

/**
 * WebView2 는 엄지 버튼(3·4)을 뒤로/앞으로로 읽는다 — SPA 라 돌아갈 자리가 없어 화면이 통째로 빈다.
 * `mouseup` · `auxclick` 둘 다 막는다 — 웹뷰 버전마다 내비게이션의 방아쇠가 다르다.
 */
export function blockStrayNavButton(ev: MouseEvent): void {
  if (ev.button === 3 || ev.button === 4) ev.preventDefault();
}

/**
 * 버블 단계로 달아야 한다 — 캡처로 달면 앱 메뉴의 `preventDefault` 보다 먼저 돌아 언제나 막는다. 예외 판정은 [`shouldBlockNativeContextMenu`] 한 곳이다.
 */
export function blockNativeContextMenu(ev: MouseEvent): void {
  if (shouldBlockNativeContextMenu(ev.target, ev.defaultPrevented, handheld())) ev.preventDefault();
}
