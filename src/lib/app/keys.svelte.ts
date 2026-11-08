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
import { isRemote } from "$lib/app/window.svelte.js";
import { openNextAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { openBranchGraphHere } from "$lib/app/branch-graph.svelte.js";
import { closeDbWriteConfirm, dbPickerVisible, dbWriteConfirmVisible, escapeDbPicker, openDbPicker } from "$lib/app/query.svelte.js";
import { askAiAboutLastBlock, askPickerOpen, closeAskPicker } from "$lib/app/ask-ai.svelte.js";
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
import { remoteDialogOpen } from "$lib/app/remote-dialog.svelte.js";
import { confirmDialogOpen, dismissConfirm } from "$lib/app/confirm-dialog.svelte.js";

/**
 * **키 라우팅** — 창 하나에 keydown 핸들러가 하나뿐이고, 그 하나가 여기 있다.
 *
 * 세 겹이 순서대로 걸러진다:
 *
 * 1. **Escape** — 위에 떠 있는 모달 **하나**만 닫는다 (팔레트 → 검색 → 치트시트 →
 *    새 키 만들기 → 호스트 키 → 비밀번호 → 키 암호구 → 키 선택 → 포워딩 → 업로드 →
 *    원격 편집 → 호스트 폼 → 기록 보기 시트 → 세션 목록 판 → 사용량 화면).
 * 2. **레지스트리에 담을 수 없는 두 문** — `Ctrl+D`(세션 없는 타일 닫기)와 `?`(치트시트).
 *    둘 다 키바인딩 해석보다 **먼저** 본다: 사용자가 그 조합을 다른 액션에 다시 묶었더라도
 *    세션 없는 타일 위에서는 셸과 같은 뜻(닫기)이 먼저 읽혀야 한다.
 * 3. **전역 단축키** — 조합 → 액션 id 로 풀어 [`runAction`] 한 곳으로 보낸다.
 *
 * ## `runAction` 이 몸통 하나인 이유
 *
 * 예전에는 이 switch 가 키 디스패처 안에 인라인으로 있었다. 팔레트가 생기면서 "액션을
 * 고르는 길" 이 둘이 됐고, 몸통을 그대로 두면 팔레트 쪽에 두 번째 switch 를 적게 된다 —
 * 그 순간부터 액션이 하나 늘 때마다 **두 곳**을 고쳐야 하고, 한쪽만 고치면 키로는 되는데
 * 팔레트로는 안 되는(또는 그 반대인) 조용한 어긋남이 생긴다.
 */

// ---------------------------------------------------------------------------
// 가드
// ---------------------------------------------------------------------------

/**
 * 위에 떠 있는 **모달·프롬프트**가 하나라도 있는가. 화면을 덮고 자기 키(Escape·Enter·폼
 * 입력)를 스스로 다루는 것들이라, 이럴 때는 전역 키가 통째로 쉰다. (Escape 처리 순서와 같은
 * 목록이다.)
 */
export function anyModalOpen(): boolean {
  if (workspaceMigrationProblems().length > 0) return true;
  return (
    dockKind() === "settings" ||
    // 끝내기 모달(독의 끝내기 단추 — 2026-10-28) — 판에 포커스를 쥐고 Esc 를 스스로 다룬다.
    quitDialogOpen() ||
    paletteVisible() ||
    // 이 폴더의 지난 대화 — 팔레트 자리에 뜨는 고르는 목록(입력칸에 포커스를 쥐고 자기 키를 스스로 다룬다 ·
    // docs/log/2026-09-27-folder-conversations.md).
    folderConversationsVisible() ||
    // 파일 열기 — 같은 자리에 뜨는 고르는 목록 (docs/log/2026-09-27-doc-tile.md "A — 여는 길")
    filePickerVisible() ||
    // 테마 프로필 전환 — 위에서 내려오는 카드 줄. 카드 줄이 포커스를 쥐고 제 키(←/→ · 숫자 · Enter · Esc)를 스스로
    // 다루므로 그동안 전역 키가 쉰다 (docs/log/2026-09-28-profile-switcher.md).
    workspaceSwitcherVisible() ||
    workspaceNamePrompt.open ||
    workspaceEditPrompt.open ||
    workspaceDeletePrompt.open ||
    profileSwitcherVisible() ||
    // 블록을 AI 타일에 넘기는 고르기 상자 — 포커스를 쥐고 제 키(↑↓ · Enter · Esc)를 스스로 다룬다
    // (docs/log/2026-09-28-ask-ai-block.md).
    askPickerOpen() ||
    // AI CLI 고르기 상자(`ai-panel`) — 같은 결(포커스를 쥐고 제 키 — 숫자 · ↑↓ · Enter · Esc · 같은 조합 — 를 스스로 다룬다).
    aiLaunchPickerOpen() ||
    // 검색 오버레이는 화면을 **덮지 않는다** — 범위 모드에서는 하이라이트된 타일이 보이도록
    // 일부러 작게 뜨고 배경도 투명하다. 그래도 목록에 들어가는 것이 맞다: 입력칸에 포커스를
    // 쥔 채 자기 키(Enter · F3 · Escape)를 스스로 다루므로, 빼 두면 검색어를 치는 동안
    // 전역 단축키가 **같이** 돌아 타일이 갈라지거나 탭이 바뀐다.
    searchVisible() ||
    cheatSheetVisible() ||
    hostKeyPrompt() !== null ||
    passwordVisible() ||
    passphraseVisible() ||
    keyPickVisible() ||
    forwardVisible() ||
    // DB 연결 고르기 — 칸에 글자를 치는 모달(직접 연결 폼). Escape 는 아래 사슬이 폼 → 목록 → 닫기로.
    dbPickerVisible() ||
    // 쿼리 타일 쓰기 켜기 확인 — [취소]에 포커스를 쥔 확인 상자.
    dbWriteConfirmVisible() ||
    uploadVisible() ||
    remoteEditVisible() ||
    hostFormVisible() ||
    // 스니펫 자리표시자를 묻는 작은 모달 — 칸에 글자를 치는 화면이라 전역 키가 쉬어야 한다
    // (docs/log/2026-09-16-snippets.md). Escape 는 그 모달이 자기 상자에서 잡아 전파를
    // 끊으므로 아래 Escape 사슬에는 줄이 없다.
    snippetPromptOpen() ||
    // 스니펫 저장 대화상자 — 같은 이유(글자를 치는 칸이 다섯이다)로 전역 키가 쉰다.
    snippetSaveOpen() ||
    // 프로젝트 추가·편집 — 같은 이유(글자를 치는 칸이 넷이다). Escape 는 모달이 스스로 끊는다.
    projectFormOpen() ||
    // 워크트리 제거 확인 — 화면을 덮는 상자다(뒤의 독이 Delete·Enter 를 다시 받으면 안 된다).
    worktreeRemoveOpen() ||
    // 워크트리의 브랜치 바꾸기 상자 — 같은 이유(이름 칸 · 화면을 덮는 상자).
    worktreeBranchOpen() ||
    // 볼트 마스터 암호 모달 — 설정에서 열리지만 화면을 덮고 칸에 암호를 치는 것은 다른
    // 모달과 같다 (docs/log/2026-09-19-vault.md ③).
    masterPromptVisible() ||
    appIconCropVisible() ||
    // 터미널 테마 가져오기 · 관리 — 같은 이유(붙여넣기 칸 · 이름 칸). Escape 는 모달이 스스로 끊는다.
    termThemeDialogVisible() ||
    // 원격 창의 묻기 · 마스터 재확인(R4) — 제 키(Esc · Enter · Tab 되감기)를 스스로 다루고 전파를 끊는다.
    remoteDialogOpen() ||
    // 확인 · 알림 상자(OS 기본 상자 대신 — 10-16) — 다른 모달 위에도 뜬다. 제 키를 스스로 다루고 전파를 끊는다.
    confirmDialogOpen()
  );
}

// 편집 필드 판정(`isEditableTarget`)은 `$lib/keybindings` 로 내려갔다 — 네이티브 우클릭
// 메뉴 규칙이 **같은 뜻의 예외**를 쓰기 때문이다 (아래 `blockNativeContextMenu`).

/**
 * 이 타깃이 **인라인 편집기**인가 — 이름 변경·새 폴더·원격 경로 칸·단축키 기록
 * (`data-inline-edit`).
 *
 * [`isEditableTarget`] 보다 좁다. 저쪽은 "글자를 치는 곳" 전부라 독의 검색 칸도
 * 포함하지만, 이쪽은 **한 번 열었다가 Enter/Escape 로 닫는 임시 편집기**만 가리킨다. 그
 * 차이가 `Ctrl+D` 의 뜻을 가른다: 검색 칸은 타일의 일부라 `Ctrl+D` 가 타일을 닫고, 이름
 * 변경 칸은 그 자체가 하나의 대화라 키를 그 칸에 그대로 남겨 둔다.
 */
export function isInlineEditTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("[data-inline-edit]") !== null;
}

/**
 * `Ctrl+D` — **세션 없는 타일(시작·SFTP·로컬 파일)을 닫는다.**
 *
 * 셸에서 `Ctrl+D` 는 "이 창에서 볼 일이 끝났다" 이고, 터미널 타일은 이미 그렇게 동작한다
 * (살아 있으면 EOF 를 셸로, 종료된 뒤에는 타일 닫기 — `Terminal.svelte`). 세션 없는
 * 타일에도 같은 닫기 키를 제공한다.
 *
 * 걸러 내는 자리는 셋뿐이다: **터미널 타일**(그 키는 셸의 것) · **모달** · **인라인
 * 편집기**. 검색 칸은 **타일의 일부**라 여기서 걸리지 않는다.
 *
 * 처리했으면 `true` — 부르는 쪽은 거기서 멈춘다.
 */
function handleTileClose(ev: KeyboardEvent): boolean {
  if (ev.code !== "KeyD") return false;
  if (!ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return false;
  if (anyModalOpen() || isInlineEditTarget(ev.target)) return false;
  // 문서 편집기 안의 `Ctrl+D` 는 편집기의 것이다(다음 같은 글자 고르기 — docs/log/2026-09-27-doc-edit.md "F2").
  // 문서 타일은 세션이 없어 아래로 가면 타일이 닫힌다.
  if (isInDocEditor(ev.target)) return false;
  const tab = activeTab();
  if (!tab) return false;
  const paneId = paneOf(tab);
  const pane = findPane(tab.root, paneId);
  if (!pane || hasSession(pane.kind)) return false; // 터미널은 자기 Ctrl+D 를 스스로 다룬다
  ev.preventDefault();
  closePaneIn(tab.id, paneId);
  return true;
}

/**
 * **`?` 한 글자로도 치트시트가 열린다** (`Shift+/`, 수식 키 없음) — 다만 자리가 좁다.
 *
 * 글자 키라서 "글자를 치는 곳" 에서는 절대 가로채면 안 된다. 걸러 내는 자리가 셋이다:
 * **터미널 타일**(`?` 는 셸의 글자다) · **입력칸·인라인 편집** · **모달**. 남는 곳이
 * 세션·파일·시작 타일이고, 거기서 `?` 는 다른 뜻이 없다.
 *
 * 키 판정은 이 앱의 규칙대로 **`ev.code`** 다 (`Shift+Slash`) — `ev.key` 로 `"?"` 를 보면
 * 한국어 IME 가 켜진 순간 모든 키가 `"Process"` 로 뭉개져 이 문이 조용히 닫힌다.
 */
function handleCheatSheetKey(ev: KeyboardEvent): boolean {
  if (ev.code !== "Slash" || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return false;
  if (anyModalOpen() || isEditableTarget(ev.target) || isInlineEditTarget(ev.target)) return false;
  if (isInDocEditor(ev.target)) return false; // 편집기의 글자다
  // `<select>` 의 `?` 는 글자 찾기다 — 그 칸의 것이다. 체크박스 위의 `?` 는 뜻이 없어 앱이 받는다.
  if (isControlOwnedKey(ev.target, ev)) return false;
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  if (pane && hasSession(pane.kind)) return false; // 터미널의 글자다
  ev.preventDefault();
  toggleCheatSheet();
  return true;
}

// ---------------------------------------------------------------------------
// 액션 실행
// ---------------------------------------------------------------------------

/**
 * 활성 타일의 **명령 창구** (`CommandApi`) — 없으면 안내를 띄우고 `null`.
 *
 * 창구는 터미널이 마운트하면서 스스로 등록한다(`registerCommands`). 그래서 호스트 트리·설정
 * 타일이 포커스면 여기서 `null` 이 나오고, 그것이 곧 "지금 이 액션은 뜻이 없다" 는 판정이다
 * — 패널 종류를 따로 검사할 필요가 없다.
 */
function activeCommands(): CommandApi | null {
  const tab = activeTab();
  const api = tab ? commandsOf(paneOf(tab)) : null;
  if (!api) showNotice(t("commands.keys.terminalRequired"));
  return api;
}

/**
 * `find` 액션이 검색 오버레이에 **범위 칩으로** 세워 줄 라벨 — 포커스가 터미널 타일이 아니면
 * `null`(= 전체 검색).
 *
 * ## 왜 `paneName(pane)` 이 아니라 **레지스트리 라벨**인가
 *
 * 타일 이름은 유일하지 않다 — `bash` 를 셋 열면 셋 다 `bash` 다. 그 이름을 그대로 넣으면
 * `@bash` 는 **언제나 첫 번째 타일**을 가리키므로, 두 번째 `bash` 에서 `Ctrl+F` 를 눌러도
 * 엉뚱한 타일이 잡힌다 — 게다가 그 사실이 화면에 드러나지 않는다(둘 다 이름이 같으니까).
 * 그래서 검색 레지스트리가 매기는 충돌 구분 라벨(`bash/2`)을 그대로 쓴다. 라벨은 **등록
 * 순서 전체** 기준이라 오버레이가 이름을 풀 때 쓰는 것과 정확히 같은 값이다.
 *
 * 돌려주는 것이 `@라벨 ` 토큰이 아니라 **라벨 그대로**인 것이 요점이다 — 공백이 든 이름을
 * 따옴표로 감싸는 문법은 `search-chips.ts` 의 `composeQuery` 한 곳에만 있다. 예전에는 그
 * 규칙이 여기와 오버레이 두 곳에 베껴져 있었고, 문법을 아는 자리가 늘수록 파서와 갈릴
 * 확률만 늘었다.
 */
function focusedTerminalLabel(): string | null {
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  if (!pane || !hasSession(pane.kind)) return null;
  const targets = searchTargets();
  const i = targets.findIndex((t) => t.paneId === pane.id);
  if (i === -1) return null; // 아직 등록 전(마운트 직후)이면 조용히 전체 검색으로
  return disambiguateNames(targets.map((t) => t.name()))[i];
}

/**
 * 포커스된 타일에 제 찾기가 있으면 연다 — 열었으면 `true`(아니면 터미널 검색으로). 무엇을 여는지는 타일이 정한다
 * (`app/tile-find.ts` — 문서 · AI 타일의 대화 면 · 파일 · diff · 쿼리).
 */
function focusedTileFind(): boolean {
  const tab = activeTab();
  const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
  return !!pane && openTileFind(pane.id);
}

/**
 * 액션 id 하나를 실행한다 — **전역 단축키와 명령 팔레트가 함께 쓰는 유일한 몸통**
 * (docs/log/2026-09-03-command-palette.md).
 *
 * **터미널 층(`terminal` scope) 액션도 여기서 받는다.** 키로 들어올 때는 xterm 안에서
 * `Terminal.handleShortcut` 이 직접 처리하므로 이 함수까지 오지 않지만, 팔레트에는 그 네
 * 줄도 목록에 보이므로 활성 타일의 `CommandApi` 로 돌려 준다 — 목록에 보이는데 눌러도 아무
 * 일이 없는 줄을 남기지 않기 위해서다.
 */
export function runAction(action: string): void {
  // 탭 직행(`workspace-1`…`workspace-9`)은 아홉 개의 case 대신 id 에서 번호를
  // 읽는다 — 레지스트리도 같은 형식으로 아홉 줄을 만들어 낸다 (keybindings.ts).
  const nth = tabIndexOf(action);
  if (nth !== null) {
    selectTabAt(nth);
    return;
  }

  switch (action) {
    // id 는 `new-tab` 그대로지만(사용자 오버라이드 호환 — keybindings.ts 주석) 뜻은
    // **새 탭**이다. 예전엔 로컬 셸 탭을 만들었는데, 셸은 이제 상태바 `>_` 메뉴·
    // `new-shell` 로 지금 탭 안에 연다 (`+` 는 곧장 이 액션과 같은 새 탭이다).
    case "new-tab":
      openTab(newTab());
      break;
    case "close-tab": {
      // 저장 안 한 문서가 있으면 한 번 묻는다 (`closeTabAsked`) — 없으면 즉시다.
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
      // 방향을 넘기지 않는다 = 타일의 **긴 변**으로 자른다 (`splitActive` 설명).
      splitActive();
      break;
    // 설정·호스트는 **떠 있는 층**이라 타일을 열지 않는다 — 같은 키로 열고 닫고, 다른
    // 종류가 떠 있으면 그 자리에서 내용만 바뀐다 (docs/log/2026-09-08-hosts-dock.md ·
    // docs/log/2026-09-08-settings-dock.md). 타일 형태("고정")로 여는 길은 독 머리줄의
    // ⇱ 와 (호스트는) 탭 ▾ 메뉴에 남아 있다.
    case "open-settings":
      toggleDock("settings");
      break;
    case "open-hosts-dock":
      toggleDock("hosts");
      break;
    // 프로젝트 독 — 같은 층의 다른 칸 (docs/log/2026-09-24-projects.md).
    case "open-projects-dock":
      toggleDock("projects");
      break;
    // DB 칸 — 같은 층의 셋째 칸(2026-10-12 · 2026-10-21 부터 `Ctrl+Shift+K` — 팔레트 전용 id 를 레지스트리로 올렸다).
    case "open-db-dock":
      toggleDock("db");
      break;
    // 채팅 독 — 런처의 반대쪽에 따로 서는 층(2026-10-23). 독이 없는 창(보조 창 · 원격 폰 배치)에서는 아무 일도 없다(`app/chat-dock`).
    case "open-chat-dock":
      toggleChatDock();
      break;
    // 알림 칸 — 같은 층의 맨 앞 칸(2026-10-18 통합 독 — 옛 상태바 종의 팝오버). 팔레트 전용 id 다(`dock.ts` 의 `paletteId`).
    case "open-alerts-dock":
      toggleDock("alerts");
      break;
    // 세션 목록 — 타일 캔버스 위쪽에서 내려오는 판을 토글한다(2026-10-07 — 전체 화면 대시보드의 세션 칸).
    // id 는 관리뷰 시절의 `open-console` 그대로다. 닫힘 규칙(Escape · 판 밖 클릭 · 창 비활성화 · 모달)은 판이 쥔다.
    case "open-console":
      toggleSessionSheet();
      break;
    // 작업안 — 채팅 독의 작업안 갈래를 열고, 이미 보이면 닫는다(기본 조합 없음 · 보조 창은 주 창에 넘긴다 · `app/plans`).
    case "open-plans":
      togglePlans();
      break;
    // 오케스트레이션(2b) — 팔레트에만 서는 두 줄(키바인딩 없음). (3차 6단계) id 는 그대로 — 맡긴 저장소면 그 저장소에서 AI 타일 열기,
    // 아니면 그 저장소 맡기기 폼(사람의 Run 시작 대화는 걷었다 — Run 은 AI 타일의 `start_run` 으로만). · Run 보드(목록 — orphaned 포함)
    case "orchestration-start":
      void startOrchestrationHere();
      break;
    case "orchestration-board":
      // (2026-10-29) 오케스트레이션 탭 — 홈(있으면 그리로 · 없으면 새로). 예전 "Run 보드 타일" 은 탭의 플레이어가 됐다.
      openOrchHome();
      break;
    // 이 폴더의 지난 대화 — 포커스된 타일의 폴더(워크트리)의 대화를 팔레트 자리에 불러 그 타일 옆에 분할로
    // 연다 (docs/log/2026-09-27-folder-conversations.md). 팔레트 줄에서 불려도 곧장 연다 — 팔레트가 닫히며
    // 예약한 포커스 돌려주기는 떠 있는 목록(포커스 복귀 이름표)을 보고 물러선다(`app/focus-return`).
    case "folder-conversations":
      toggleFolderConversations();
      break;
    // 파일 열기 — 포커스된 타일의 폴더를 훑어 고른 파일을 문서 보기로 (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
    // 팔레트 줄에서 불려도 곧장 연다 — 위 지난 대화 목록과 같은 포커스 복귀 규칙.
    case "open-file":
      toggleFilePicker();
      break;
    // 브랜치 그래프 — **팔레트 전용** 명령(단축키 없음 · `CommandPalette` 의 `PALETTE_ONLY`). 지금 타일의 프로젝트를 지금 탭에
    // 분할로 연다(docs/log/2026-09-29-branch-graph.md).
    case "branch-graph":
      openBranchGraphHere();
      break;
    // DB 연결 열기 — **팔레트 전용**(단축키 없음 · `PALETTE_ONLY`). 고르기 모달 → 지금 탭에 쿼리 타일(2026-10-12).
    case "open-db":
      void openDbPicker();
      break;
    // 테마 프로필 전환 — 위에서 내려오는 카드 줄을 연다 (docs/log/2026-09-28-profile-switcher.md). 팔레트 줄에서
    // 불려도 곧장 연다 — 위 두 목록과 같은 포커스 복귀 규칙.
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
    // 프라이버시 잠금(가림막) — 화면 전체를 흐리게 덮고 **볼트도 함께 잠근다**. 이 키는
    // 켜기만 한다: 걷는 문은 가림막 위의 관문 하나뿐이다(마스터 암호 · 없으면 Enter ·
    // `Veil.svelte`). 액션 id 는 `settings.toml` 키라 `toggle-veil` 그대로다.
    case "toggle-veil":
      raiseVeil();
      break;
    // 끝내기 모달 — 독의 끝내기 단추와 같은 몸통(독이 떠 있으면 먼저 닫는다 — 모달이 독 뒤에 숨지 않게). 원격 창은 아무 일도
    // 없다(단추가 없는 것과 같은 판단 · 세 명령도 집 PC 전용). 이미 떠 있으면 `openQuitDialog` 가 물러선다(키로는 `anyModalOpen` 이 먼저 막는다).
    case "quit-app":
      if (isRemote) break;
      closeDock();
      if (dockKind() === "settings") break; // 설정의 미저장 변경을 묻는 중이다 — 그 답이 먼저다
      openQuitDialog();
      break;
    // 남은 에이전트 알림 하나로 간다 — 배너의 [보기] 와 같은 길(`openAgentBanner`).
    case "go-to-alert":
      openNextAgentBanner();
      break;
    case "open-sftp":
      openFilesHere();
      break;
    case "open-localfs":
      openLocalFsPaneHere();
      break;
    // 켜 둔 AI CLI 고르기 상자 — 하나뿐이면 곧바로 연다(`app/ai-launch`). 팔레트의 같은 줄도 여기로 온다(팔레트가 닫힌 뒤).
    case "ai-panel":
      void openAiLaunchPicker();
      break;
    case "toggle-sync":
      toggleSync();
      break;
    // 복원된 SSH 타일을 한꺼번에 (계단식으로) 붙인다 — 배치 복원의 짝.
    case "reconnect-all":
      reconnectAllDeferred();
      break;
    // 지금 탭을 이름 붙여 저장한다 — 이름을 묻는 모달은 하나뿐이고, 탭 우클릭
    // 메뉴도 같은 모달을 연다.
    // 타일 사이 방향 이동 — 액션 id 의 접미사가 곧 방향이다.
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
    // 타일 이동·크기 조절도 접미사가 곧 방향이다 (`focus-*` 와 같은 형식).
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
    // 최대화는 **포커스 타일 하나**에 대한 토글이다 (타일이 하나뿐이면 no-op).
    case "zoom-tile":
      zoomFocusedTile();
      break;
    // AI 타일 [터미널 | 대화] — 포커스된 타일이 넘길 수 있는 AI 타일일 때만(`pane/ai-flip` 의 `canFlipPane`). 아니면 짧은 안내.
    case "flip-convo": {
      const tab = activeTab();
      const pane = tab ? findPane(tab.root, paneOf(tab)) : null;
      if (pane && canFlipPane(pane)) toggleFlip(pane.id);
      else showNotice(t("pane.flip.notAi"));
      break;
    }
    // 팔레트 자신 — 키로 들어오면 "열기", 팔레트 목록에서는 아예 빼 두었다.
    case "command-palette":
      togglePalette();
      break;
    // 치트시트도 토글이다 — 팔레트와 달리 목록에 남겨 둔다 (팔레트에서 "단축키" 를 찾다가
    // 여기로 오는 것이 자연스러운 길이다).
    case "cheat-sheet":
      toggleCheatSheet();
      break;
    // 찾기 두 짝 — **같은 오버레이**를 seed 만 달리해 연다 (keybindings.ts 의 `find` 주석).
    // `find` 는 눈앞의 터미널을 **범위 칩으로** 세운 채, `find-all` 은 언제나 전체·빈 질의로.
    // 스니펫 삽입 — **고르는 화면을 여는 문**이다 (액션 하나에 "어느 스니펫" 을 실을 수
    // 없다). 그 화면은 명령 팔레트이고, 스니펫 접두사(`;`)를 찍은 채 열린다 — 넣는 일은
    // 팔레트가 올려 보낸 id 로 `insertSnippet` 하나가 한다.
    case "insert-snippet":
      openSnippetPalette();
      break;
    // 포커스된 타일에 제 찾기가 있으면 **그 타일 안**에서 찾는다(`app/tile-find.ts` — 같은 키 id, 타일 종류로 가른다):
    // 문서 · AI 타일의 대화 면 · diff 패치는 찾기 띠, 파일 타일은 이름 거르기 줄, 쿼리 타일은 결과 표 찾기 또는 스키마 트리
    // 거르기 칸. 편집기 안의 `Ctrl+F` 는 애초에 편집기가 먼저 받는다(`editorOwnsKey` — 문서 편집 · SQL 편집기의 검색 패널).
    // 없으면 터미널 타일은 그 터미널 범위 칩으로, 그 밖은 모든 터미널에서 찾는다.
    case "find":
      if (focusedTileFind()) break;
      openSearch({ scopeChip: focusedTerminalLabel(), blockChip: null, text: "" });
      break;
    case "find-all":
      openSearch({ scopeChip: null, blockChip: null, text: "" });
      break;

    // ── 터미널 층 (팔레트로 들어왔을 때만 여기까지 온다 — 위 doc-comment) ──────
    //
    // 점프·복사는 활성 타일의 창구를 그대로 부른다: `Terminal.handleShortcut` 이 키로
    // 부르는 것과 **같은 메서드**라 동작이 갈릴 수 없다.
    case "jump-prev":
      activeCommands()?.jump(-1);
      break;
    case "jump-next":
      activeCommands()?.jump(1);
      break;
    case "copy-output":
      void activeCommands()?.copyOutput();
      break;
    // 원격 편집만 창구가 아니라 **기존 요청 경로**로 간다 — 모달을 여는 일은 터미널이
    // 아니라 코디네이터의 몫이고, 그 함수가 "SSH 가 아니다"·"아직 접속 중이다" 안내까지
    // 이미 들고 있다.
    case "edit-remote": {
      const tab = activeTab();
      if (!tab) showNotice(t("commands.keys.terminalRequired"));
      else openRemoteEdit(tab.id, paneOf(tab));
      break;
    }
    // 블록을 AI 타일에 넘기기 — 활성 타일의 마지막 끝난 블록 (docs/log/2026-09-28-ask-ai-block.md)
    case "ask-ai-block":
      if (activeCommands()) askAiAboutLastBlock(paneOf(activeTab()!));
      break;
  }
}

/**
 * 전역 단축키의 **유일한 진입점** (`$lib/keybindings`, docs/log/2026-09-02-keybindings.md).
 * 터미널은 같은 조합을 **삼키기만** 하고 (셸로 새지 않게) 실제 동작은 [`runAction`] 한 곳에서 돈다.
 *
 * `ev.code` 로만 조합을 만든다(`comboFromEvent`) — 한국어 IME 가 켜져 있어도 물리 키가 살아
 * 있어야 하기 때문이다.
 */
function handleGlobalShortcut(ev: KeyboardEvent): void {
  if (anyModalOpen()) return; // 모달은 언제나 먼저다 — 예외 없음
  const combo = comboFromEvent(ev);
  if (!combo) return;
  // 포커스된 폼 컨트롤(체크박스·`<select>` …)이 **스스로 쓰는 맨 키**면 기본 동작까지 그대로
  // 둔다 — 아래 `preventDefault` 보다 먼저여야 한다. 사용자가 맨 화살표·`Shift+글자` 를 전역
  // 조합으로 묶어 두었어도 체크박스의 Space·슬라이더의 화살표·목록의 글자 찾기는 살아야 한다
  // (`isControlOwnedKey` · docs/log/2026-09-25-editable-target.md). `Ctrl`/`Alt` 조합은
  // 여기 걸리지 않는다 — 그래서 스위치 위에서도 `Ctrl+Shift+P` 가 먹는다.
  if (isControlOwnedKey(ev.target, ev)) return;
  const action = resolveBindings(settings.current.keybindings).global.get(combo);
  /*
   * **문서 편집기 안이면 편집기가 먼저다** (docs/log/2026-09-27-doc-edit.md "F2" · `editorOwnsKey`).
   * 이 리스너는 버블 단계라 편집기(CodeMirror)는 이미 제 키를 처리했다. 여기서는 실행하지 않고, 앱이 뜻을 둔
   * 조합이거나 브라우저 가속키면 기본 동작만 끊는다(편집기가 그 키를 안 받았을 때 Edge 의 찾기 막대 ·
   * 페이지 저장이 새지 않게 — `isBrowserChromeCombo` 규칙 그대로).
   */
  if (editorOwnsKey(ev.target, combo, { bound: action !== undefined, paletteCombo: paletteCombo() })) {
    if (action !== undefined || isBrowserChromeCombo(combo)) ev.preventDefault();
    return;
  }
  if (!action) {
    /*
     * **묶이지 않은 조합이라도, 브라우저 가속키면 기본 동작만 끊고 돌아간다**
     * (docs/log/2026-09-08-browser-accelerators.md).
     *
     * 여기서 그냥 `return` 하면 그 자리는 Edge 의 것이 된다 — 팔레트가 `Ctrl+P` 에서
     * `Ctrl+Shift+P` 로 물러난 뒤(docs/log/2026-09-04-settings-cleanup.md) `Ctrl+P` 는 아무
     * 액션에도 묶이지 않았고, 포커스가 터미널 밖에 있으면 **인쇄 대화상자**가 떴다.
     * 실행할 것은 없으므로 `preventDefault` 하고 끝낸다.
     */
    if (isBrowserChromeCombo(combo)) ev.preventDefault();
    return;
  }

  /*
   * **묶여 있는 조합이면 실행 여부와 무관하게 기본 동작부터 끊는다.**
   *
   * 여기는 WebView2(Edge) 안이라 앱이 안 쓰는 조합은 브라우저의 것이 된다 —
   * `Ctrl+Shift+P` 는 인쇄 대화상자, `Ctrl+F` 는 찾기 막대다. 아래 편집 필드 가드에 걸려
   * 액션을 실행하지 않는 경우에도 `preventDefault` 를 안 하면 그 기본 동작이 그대로 새어
   * 나간다. 조합이 레지스트리에 있다는 것은 곧 "이 앱이 뜻을 정해 둔 키" 라는 뜻이므로,
   * 그 자리를 브라우저에 넘기지 않는다.
   */
  ev.preventDefault();

  // 인라인 편집기(이름 변경 칸·기록 중인 단축키 버튼)는 **어느 액션에도** 양보하지 않는다 —
  // 그 자리는 조합 자체를 받아 적는 임시 대화다. 나머지 입력칸을 지나가는 액션 목록은
  // `bypassesEditGuard` 가 든다 (근거도 거기 적혀 있다).
  if (isInlineEditTarget(ev.target)) return;
  // 편집기 안에서 여기까지 온 키는 앱이 쥐는 계열이다(`appKeepsInEditor`) — 입력칸 가드를 지나간다.
  // AI 타일 대화 면의 입력 칸은 단축키에서 터미널처럼(`isTerminalKeysInput` — 2026-11-02) — 가드에서 뺀다
  if (!isInDocEditor(ev.target) && !bypassesEditGuard(action) && isEditableTarget(ev.target) && !isTerminalKeysInput(ev.target)) return;

  runAction(action);
}

/** 지금 팔레트 조합(사용자가 다시 묶었을 수 있다 · 끄면 `null`) */
function paletteCombo(): string | null {
  return effectiveCombo("command-palette", settings.current.keybindings);
}

/**
 * **캡처 단계의 앞막이 — 모달 안의 브라우저 가속키와 편집기 안의 앱 전용 키를 막는다**
 * (docs/log/2026-09-27-doc-edit.md "F2").
 *
 * 창 keydown([`onWindowKeydown`])은 버블 단계라 편집기(CodeMirror)가 먼저 돈다. 그런데 편집기의 기본 키맵은
 * 앱의 작업면 키와 겹친다 — `Alt+↑/↓`(줄 옮기기) · `Ctrl+Shift+K`(줄 지우기) · `Ctrl+Shift+[`(접기) ·
 * `Ctrl+Shift+←/→`(낱말 고르기) · `Ctrl+Shift+L`(같은 글자 모두 고르기). 그대로 두면 한 번에 **둘 다** 일어난다.
 * CodeMirror 는 `defaultPrevented` 인 키를 처리하지 않으므로 여기서 기본 동작만 끊어 두면 편집기가 비켜 서고,
 * 실행은 버블 단계의 [`handleGlobalShortcut`] 이 예전처럼 한다(전파는 끊지 않는다).
 *
 * 편집기 밖에서는 모달 여부와 무관하게 브라우저 기본 동작부터 끊는다. 워크스페이스 선택기처럼
 * `stopPropagation` 하는 입력칸은 버블 리스너에 닿지 않기 때문이다. 전파는 그대로 두어 앱·터미널의
 * 키 처리는 계속된다. 편집기 검색·저장 키는 CodeMirror가 먼저 받아야 하므로 기존 버블 단계에 맡긴다.
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

/**
 * 창 keydown 하나로 ①Escape(모달 닫기) ②두 고정 키 ③전역 단축키를 함께 다룬다.
 * Escape 는 위에 떠 있는 모달 하나만 닫는다.
 */
export function onWindowKeydown(ev: KeyboardEvent): void {
  if (workspaceMigrationProblems().length > 0) {
    if (ev.key === "Escape" || isBrowserChromeCombo(comboFromEvent(ev) ?? "")) ev.preventDefault();
    return;
  }
  if (ev.key === "Escape") {
    // 확인 · 알림 상자가 맨 위다(다른 모달 안에서도 물을 수 있다) — 상자가 제 Escape 를 끊으므로 이 줄은 포커스가 밖일 때의 그물.
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
    // 팔레트가 사슬의 **맨 앞**이다 — 다른 무엇 위에도 뜰 수 있는 유일한 화면이라, 떠 있으면
    // Escape 는 언제나 팔레트부터 닫는다. (팔레트 입력칸 안에서 누른 Escape 는 팔레트가
    // 먼저 잡아 `stopPropagation` 하므로 여기까지 오지 않는다 — 이 줄은 포커스가 입력칸을
    // 벗어난 경우의 그물이다.)
    if (paletteVisible()) {
      ev.preventDefault();
      closePalette();
      return;
    }
    // 이 폴더의 지난 대화 — 팔레트와 같은 자리 · 같은 결(입력칸 안의 Escape 는 목록이 먼저 잡는다 — 그물이다).
    if (folderConversationsVisible()) {
      ev.preventDefault();
      closeFolderConversations();
      return;
    }
    // 파일 열기 — 같은 자리 · 같은 결(그물이다 — 입력칸 안의 Escape 는 목록이 먼저 잡는다).
    if (filePickerVisible()) {
      ev.preventDefault();
      closeFilePicker();
      return;
    }
    // 테마 프로필 전환 — 같은 결(그물이다 — 카드 줄 안의 Escape 는 줄이 먼저 잡는다).
    if (profileSwitcherVisible()) {
      ev.preventDefault();
      closeProfileSwitcher();
      return;
    }
    // 블록을 AI 에게 — 고르기 상자(그물이다 — 상자 안의 Escape 는 상자가 먼저 잡아 전파를 끊는다).
    if (askPickerOpen()) {
      ev.preventDefault();
      closeAskPicker("source");
      return;
    }
    // AI CLI 고르기 상자 — 같은 결(그물이다 — 상자 안의 Escape 는 상자가 먼저 잡아 전파를 끊는다).
    if (aiLaunchPickerOpen()) {
      ev.preventDefault();
      closeAiLaunchPicker(true);
      return;
    }
    // 검색 오버레이는 팔레트 다음, 치트시트 앞이다 — 팔레트 위에는 못 뜨지만 나머지 모달·
    // 프롬프트보다는 **나중에 열려 위에 있다**(사용자가 마지막으로 연 것부터 닫힌다는 사슬의
    // 뜻). 팔레트와 같은 결로, 여기까지는 잘 오지 않는 그물이다 — 오버레이 자신이 Escape 를
    // 먼저 잡아 `stopPropagation` 하므로 이 줄은 포커스가 입력칸을 벗어난 경우를 받는다.
    if (searchVisible()) {
      ev.preventDefault();
      closeSearch();
      return;
    }
    // 치트시트는 그다음이다. 실은 **여기까지 오지 않는다** — 그쪽은 캡처 단계에서
    // 키를 통째로 잡아 자기 Escape 를 스스로 처리하기 때문이다. 이 줄은 그 배선이 사라졌을
    // 때를 위한 그물이고, 사슬의 순서를 기록해 두는 자리다.
    if (cheatSheetVisible()) {
      ev.preventDefault();
      closeCheatSheet();
      return;
    }
    // 설정 모달은 자기 상자에서 Escape를 처리한다. 설정 밖에 뜬 볼트 마스터 암호
    // 모달은 여기서 먼저 닫는다 (docs/log/2026-09-19-vault.md ③).
    if (masterPromptVisible()) {
      ev.preventDefault();
      closeMasterPrompt();
      return;
    }
    // 사용자 앱 아이콘 자르기 — 설정 위에 뜬다(그물이다 — 모달 안의 Escape 는 모달이 먼저 잡는다).
    if (appIconCropVisible()) {
      ev.preventDefault();
      closeAppIconCrop();
      return;
    }
    // 터미널 테마 가져오기 · 관리 — 설정 위에 뜬다(그물 — 모달 안의 Escape 는 모달이 먼저 잡는다).
    if (termThemeDialogVisible()) {
      ev.preventDefault();
      closeTermThemeDialog();
      return;
    }
    // **새 키 만들기가 모달 사슬의 맨 앞이다.** 여는 길이 둘 다 이미 모달 위라(호스트 폼의
    // IdentityFile 줄 · 공개키 설치 고르개의 "새 키 만들기…"), 떠 있다면 가장 나중에 열린
    // 것이다 — 사슬의 뜻이 "마지막으로 연 것부터 닫는다" 이므로 여기여야 한다.
    // (만드는 중에는 `closeKeygen` 이 스스로 아무 일도 하지 않는다: `ssh-keygen` 은 이미
    //  돌고 있어서 지금 닫아도 파일은 생긴다.)
    if (keygenVisible()) {
      ev.preventDefault();
      closeKeygen();
      return;
    }
    // 금고 잠금 해제는 접속 대화 사슬의 **맨 앞**이다 — 접속을 시작하기 전에 지나는
    // 관문이라, 이것이 떠 있는 동안에는 뒤의 넷이 아직 존재하지 않는다.
    // Escape = [이번엔 건너뛰기] 다: **모르는 채로 닫는 것이 거부**인 호스트 키와 달리,
    // 여기서 닫는 것은 "이번 접속은 금고 없이" 라는 멀쩡한 답이다 (여는 일만 취소된다).
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
      resolvePassword(null); // 취소 = null → 세션 열기 중단
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
      resolveKeyPick(null); // 취소 = null → 공개키 설치 중단
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
      closeUpload(); // 올리는 중이면 아무 일도 하지 않는다
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
    // 기록 보기 시트는 사용량 화면 **앞**이다 — 그 위에 뜨는 층이라 먼저 닫힌다. 시트 안에서 누른
    // Escape 는 시트가 스스로 잡아 끊으므로 이 줄은 포커스가 밖에 있을 때의 그물이다.
    if (conversationViewOpen() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      closeConversationView();
      return;
    }
    // 세션 목록 판도 사용량 화면 **앞**이다 — 그 위(z 95)에 내려오는 덮개다. 판 안에서 누른 Escape 는 판이 스스로
    // 잡아 끊으므로 이 줄은 포커스가 밖에 있을 때의 그물이다.
    if (sessionSheetOpen() && !isEditableTarget(ev.target)) {
      ev.preventDefault();
      closeSessionSheet();
      return;
    }
    // **사용량 · 자원 화면이 사슬의 맨 끝이다** — 모달이 아니라 캔버스를 덮는 화면이라, 위에 뜬 무엇이든 먼저 닫힌다.
    // 입력칸의 Escape 는 그 칸의 것이다.
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

  // `?` 한 글자 — 레지스트리에 담을 수 없는 두 번째 문이라 여기서 따로 본다.
  if (handleCheatSheetKey(ev)) return;

  handleGlobalShortcut(ev);
}

/**
 * 파일이 패널 **밖**에 떨어지는 경우를 막는다.
 *
 * `dragDropEnabled: false` 라 파일 드랍은 웹 표준 DnD 로 들어오는데, 아무도 받지 않으면
 * 브라우저 기본 동작이 남는다 — 웹뷰가 그 파일로 **이동해** 앱 화면이 통째로 사라진다.
 * 그래서 창 전체에서 기본 동작만 끈다 (받는 곳은 여전히 `PaneHost` 한 곳뿐이다).
 */
export function blockStrayFileDrop(ev: DragEvent): void {
  if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
}

/**
 * **마우스 5버튼의 웹뷰 기본 내비게이션을 창 전역에서 막는다**
 * (docs/log/2026-09-04-nav-history.md).
 *
 * 이 앱은 SvelteKit 한 장짜리 SPA 라 웹뷰의 세션 이력에는 **돌아갈 자리가 없다**. 그런데
 * WebView2 는 엄지 버튼(`button` 3·4)을 그대로 뒤로/앞으로로 읽어, 타일 밖 아무 데서나 한
 * 번 누르면 화면이 통째로 비고 돌아올 길이 없다.
 *
 * 탐색기 타일들은 **자기 버블 단계에서 이미 이 버튼을 소비하고 전파를 끊는다** — 그래서
 * 여기까지 올라오는 것은 "탐색할 것이 없는 자리에서 눌린" 경우뿐이고, 그때는 아무 일도
 * 일어나지 않는 것이 맞다.
 *
 * `mouseup` 과 `auxclick` 둘 다 막는다 — 어느 쪽을 웹뷰가 내비게이션의 방아쇠로 삼는지는
 * 버전에 따라 다르고, 여기서는 둘 다 하는 일이 없으므로 겹쳐 막아도 잃을 것이 없다.
 */
export function blockStrayNavButton(ev: MouseEvent): void {
  if (ev.button === 3 || ev.button === 4) ev.preventDefault();
}

/**
 * **웹뷰의 기본 우클릭 메뉴를 창 전역에서 막는다**
 * (docs/log/2026-09-08-native-context-menu.md — 브라우저 가속키 목록의 형제 규칙이다).
 *
 * 앱이 자기 메뉴를 두지 않은 자리(시작 화면 · 타일의 빈 곳 · 독 머리줄 · 탭 바의 드래그
 * 공간 · 설정 본문)에서 오른쪽 버튼을 누르면 **뒤로/앞으로/새로 고침/인쇄/검사** 가 떴다.
 * 이 앱은 SPA 라 뒤로 갈 자리가 없고(`blockStrayNavButton` 과 같은 이야기다), 인쇄할 문서도
 * 없으며, 검사는 사용자를 웹뷰라는 사실 앞에 세운다 — 한 줄도 뜻이 없는 목록이다.
 *
 * 예외 판정은 [`shouldBlockNativeContextMenu`] 한 곳에 있다 (근거도 거기 적혀 있다):
 * 앱 메뉴가 이미 `preventDefault` 했으면 손대지 않고, **편집 필드**(input·textarea·
 * contenteditable — `.xterm` 은 제외)에서는 마우스만 쓰는 사용자의 잘라내기·복사·붙여넣기를
 * 남겨 둔다.
 *
 * **버블 단계로 달아야 한다.** 앱 메뉴들은 자기 요소에서 먼저 돌며 `preventDefault` 하므로,
 * 캡처로 달면 그 판정이 언제나 "막는다" 가 되어 예외 ①이 죽는다.
 */
export function blockNativeContextMenu(ev: MouseEvent): void {
  if (shouldBlockNativeContextMenu(ev.target, ev.defaultPrevented)) ev.preventDefault();
}
