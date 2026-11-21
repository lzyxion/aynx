import { listenWorkspaceStatus, requestWorkspaceStatus } from "$lib/app/workspace-status.svelte.js";
import { invoke, listen } from "../ipc";
import { askChoice } from "$lib/app/confirm-dialog.svelte.js";
import { quitAll, type QuitChoice, type QuitIO, type UnsavedWindow } from "$lib/workspaces/quit";
import { listenWindowRequests, requestWindow } from "$lib/workspaces/window-events";
import { currentWindowLabel } from "$lib/context";
import { requestDocSave } from "$lib/app/doc-dirty.svelte.js";
import { choiceFromDialog } from "$lib/unsaved-guard";
import { listPanes } from "$lib/session";
import { currentWorkspace, switchWorkspace, noteWorkspaceHostAliases, noteWorkspaceName, noteWorkspaceStyle, pauseWorkspaceSave, resumeWorkspaceSave, returnAuxTabs } from "$lib/app/workspaces.svelte.js";
import { untrack } from "svelte";
import { toast } from "$lib/toast.svelte.js";
import { ACTIONS, displayCombo, effectiveCombo } from "$lib/keybindings";
import { showNotice } from "$lib/app/notice";
import { startAutoApprove } from "$lib/app/auto-approve.svelte.js";
import { startPendingPlans } from "$lib/app/pending-plans.svelte.js";
import { openPlans, openPlansAt, setPlansView } from "$lib/app/plans.svelte.js";
import { openRunInHistory } from "$lib/app/run-history.svelte.js";
import { loadUserTermThemes } from "$lib/app/term-themes.svelte.js";
import { refreshAvatars } from "$lib/avatars.svelte.js";
import { startOperationNotify } from "$lib/app/operation-notify.svelte.js";
import { startRemotePair } from "$lib/app/remote-pair.svelte.js";
import { installRemoteUi } from "$lib/app/remote-dialog.svelte.js";
import { startRemoteAccess } from "$lib/app/remote-access.svelte.js";
import { startUpdater } from "$lib/app/updater.svelte.js";
import { startOrchestrationNotify } from "$lib/app/orchestration-notify.svelte.js";
import { startOrchCoordinators } from "$lib/app/orch-coordinators.svelte.js";
import { startOrchTabRepair } from "$lib/app/orch-tab-repair.svelte.js";
import { refreshVault } from "$lib/app/vault.svelte.js";
import { listenVeilAcrossWindows, recheckVaultVeil } from "$lib/app/veil.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  closeThisWindow,
  isMainWindow,
  isRemote,
  onWindowClose,
  tearToken,
} from "$lib/app/window.svelte.js";
import {
  bootTabs,
  docNameOf,
  flushTabSave,
  unsavedDocPanesInWindow,
  dbTxPanesInWindow,
  residentWindowTabs,
  revealPane,
  renameHostInTabs,
} from "$lib/app/tabs.svelte.js";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import { confirmDbTxClose } from "$lib/app/db-tx";
import {
  closeWindowSessions,
  leaveWindowSessions,
  stashWindowCheckpoints,
  windowSessionStreams,
} from "$lib/app/sessions.svelte.js";
import { startMobile } from "$lib/app/mobile.svelte.js";
import { leaveViewers, reapWindowSessions, restoreDoneSessions } from "$lib/session";
import { bootMirror } from "$lib/app/mirror.svelte.js";
import { startMirrorRequests, startRemoteLayoutRequests } from "$lib/app/mirror-requests.svelte.js";
import { openDetachedList, refreshDetached, startDetached } from "$lib/app/detached.svelte.js";
import { bootSideChats, closeLegacySideChatSessions } from "$lib/app/side-chats.svelte.js";
import { bootTear, holdTearSource, releaseWorkspaceTear, thawTearSource } from "$lib/app/tear.svelte.js";
import {
  applyStoredLanguage,
  loadSettings,
  settings,
} from "$lib/settings.svelte.js";
import { listenSettingsSaved } from "$lib/settings-sync.svelte.js";
import { listenHostRenamed } from "$lib/app/host-rename";
import { mountHostHistory } from "$lib/app/host-history.svelte.js";
import { mountDbHistory } from "$lib/app/db-history.svelte.js";
import { mountKeepAwake } from "$lib/app/keep-awake.svelte.js";
import { listenRemoteHooksAuto, noticeLocalHookRefresh } from "$lib/app/remote-hooks-auto";
import { mountProjects } from "$lib/app/projects.svelte.js";
import { listenAgentSignals, syncAgentStates } from "$lib/app/agent-status.svelte.js";
import { mountAgentSeen } from "$lib/app/agent-seen.svelte.js";
import { watchAiFocus } from "$lib/app/ask-ai.svelte.js";
import { watchShellFocus } from "$lib/app/code-to-term.svelte.js";
import { listenDelegationChanged, orphanDelegationTargets, refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
import { refreshDbAi } from "$lib/app/db-ai.svelte.js";
import { ensureDbConns } from "$lib/app/db-conns.svelte.js";
import { openCredentialsSettings } from "$lib/app/overlays.svelte.js";
import { DELEGATION_ORPHANS_ANCHOR } from "$lib/settings/credentials-view";
import { refreshWallpaper, wallpaper } from "$lib/wallpaper.svelte.js";
import { adoptStoredMode, appMode } from "$lib/mode.svelte.js";
import { modeChanged, syncWallpaperTint } from "$lib/dynamic-theme.svelte.js";
import { loadSnippets } from "$lib/snippets.svelte.js";
import { ensureTabTemplates } from "$lib/app/tab-templates.svelte.js";
import { loadThemeProfiles } from "$lib/theme-profiles.svelte.js";
import { takeMcpNotice } from "$lib/context";
import { onUploadFailed, onUploaded } from "$lib/sftp";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { noticeOrphanedRuns } from "$lib/app/orchestration.svelte.js";

/**
 * 이 창이 켜지는 순서와 켜져 있는 동안 듣는 것들 — `$effect` 의 몸통도 여기 있고, 효과 자체는 `+page` 가 건다(룬 모듈에는 붙일 수명이 없다).
 */

/**
 * 설정이 먼저다 — `app.auto_reconnect` 판단이 타일이 뜨기 전에 끝나 있어야 한다(뜬 뒤에 정하면 대기 배너가 보였다 사라진다).
 * 월페이퍼는 설정 뒤 · 타일 앞이어야 배경이 한 박자 늦게 나타나지 않는다.
 */
export async function boot(): Promise<void> {
  // 폴리필이 볼 손잡이를 무엇보다 먼저 건다 — 부팅 중 묻는 것도 앱 모달로
  if (isRemote) installRemoteUi();
  // 타일이 뜨기 전에 — 첫 시청자 붙기가 크기 주인 자격을 싣는다
  if (isRemote) startMobile();
  // 가장 먼저 — 예전 페이지가 남긴 세션을 놓는다(닫지 않고 손만 놓는다 — 복원된 타일이 같은 스트림에 다시 붙는다).
  // 타일이 뜨기 전에 끝나야 한다 — 순서가 뒤집히면 방금 연 세션까지 거둔다(docs/log/2026-09-05-session-leak-on-reload.md).
  await reapWindowSessions();
  await loadSettings();
  // `user:` 테마 키를 푸는 목록 — 설정 바로 뒤 · 타일이 뜨기 전에
  await loadUserTermThemes();
  void refreshAvatars();
  // 월페이퍼보다 앞이어야 한다 — 모드가 확정되기 전에 동적 색 `$effect` 가 배경을 보면 사진을 한 번 더 디코딩한다
  adoptStoredMode();
  // 타일이 뜨기 전이어야 첫 프레임부터 제 언어로 그려진다
  applyStoredLanguage();
  if (isMainWindow) {
    const blocked = ACTIONS.filter((action) => action.def && effectiveCombo(action.id, settings.current.keybindings) === null);
    if (blocked.length) showNotice(t("app.workspaces.keyConflict", { combos: blocked.map((action) => displayCombo(action.def)).join(", ") }));
  }
  await refreshWallpaper();
  await loadSnippets();
  await ensureTabTemplates();
  // 목록만 읽고 아무것도 입히지 않는다 — 지금 걸린 모양은 이미 `settings.toml` 에 있다
  await loadThemeProfiles();
  // 호스트 삭제 확인이 "경유하는 DB 연결 N개" 를 동기로 센다
  void ensureDbConns();
  void refreshDelegationTargets().then(() => {
    if (isMainWindow) noticeOrphanDelegations();
  });
  // 안 읽으면 복원된 쿼리 타일 머리줄 칩이 서버가 Read 여도 Off 로 보인다
  void refreshDbAi();
  try {
    await bootTear();
    // 원격 창은 제 탭을 만들지 않는다 — 메인 PC 주 창의 화면을 비춘다
    if (isRemote) {
      startRemoteLayoutRequests();
      await bootMirror();
    }
    else if (tearToken === null) await bootTabs();
    if (isMainWindow || isRemote) await bootSideChats();
  } finally {
    // 아무 타일도 데려가지 않은 세션은 닫지 않고 떨어진 세션으로 남긴다 — 복원이 실패해도 돈다
    void restoreDoneSessions(windowSessionStreams()).then(async () => {
      if (!isMainWindow) return;
      // v1 사이드 채팅의 PTY 세션(`sidechat-*`)을 닫는다 — 떨어진 세션 안내에 세지 않게 그 전에
      await closeLegacySideChatSessions().catch(() => 0);
      void noticeDetached();
    });
  }
  startDetached();
  void syncAgentStates();
  if (isMainWindow) void noticeLocalHookRefresh();
  if (isMainWindow) void noticeOrphanedRuns();
  requestWorkspaceStatus();
  // 다음 셋은 주 창 · 원격 창에서만 — 분리 창까지 걸면 사유 · 알림이 창 수만큼 운다. 원격 창은 다른 기기의 사람 눈이라 건다(원격 승인)
  if (isMainWindow || isRemote) startAutoApprove();
  if (isMainWindow || isRemote) startPendingPlans();
  if (isMainWindow || isRemote) startOperationNotify({ remote: isRemote });
  // 원격 기기 페어링 [허용] 은 메인 PC 주 창의 사람만 — 관문은 주 창에만 이벤트를 보낸다
  if (isMainWindow) startRemotePair();
  if (isMainWindow) void startMirrorRequests();
  if (isMainWindow) startRemoteAccess();
  if (isMainWindow) startUpdater({ leave: quitForUpdate });
  if (isMainWindow) startOrchestrationNotify();
  // 원격 창은 탭 트리를 고치지 않는다 · 보조 창에도 오케스트레이션 탭이 있을 수 있다
  if (!isRemote) startOrchCoordinators();
  if (!isRemote) startOrchTabRepair();
  // 볼트 상태는 폴링하지 않는다 — 스스로 바뀌지 않으니 부팅 · 창 포커스에서만 다시 읽는다
  if (isMainWindow) {
    void refreshVault();
    window.addEventListener("focus", () => void refreshVault());
  }
  // 창 0개 잠금(`relock`)이 걸렸으면 가림막을 세운다(볼트를 다시 잠그지는 않는다) · 메인 PC 창은 마스터가 걸린 볼트가 잠겨 있을 때도 가린다
  void recheckVaultVeil(false, !isRemote);
}

/** 고아 위임(호스트 이름을 바꿔 남은 옛 블록 — 영영 붙지 않는다)을 앱 시작마다 한 번 알리고 고치는 자리로 데려간다 */
function noticeOrphanDelegations(): void {
  const n = orphanDelegationTargets().length;
  if (n === 0) return;
  toast.info(t("settings.credentials.delegation.notice", { n }), {
    ms: 12000,
    action: {
      label: t("settings.credentials.delegation.notice.action"),
      run: () => openCredentialsSettings(DELEGATION_ORPHANS_ANCHOR),
    },
  });
}

/** 복원된 타일이 붙을 틈 */
const DETACHED_NOTICE_SETTLE_MS = 3000;

async function noticeDetached(): Promise<void> {
  const intent = await invoke<string | null>("take_tray_intent").catch(() => null);
  if (intent === "detached") {
    openDetachedList();
    return;
  }
  // 한 박자 기다렸다 센다 — 아직 붙지 않은 복원 타일의 세션이 잠깐 "떨어진" 것으로 보인다
  await new Promise((r) => setTimeout(r, DETACHED_NOTICE_SETTLE_MS));
  const n = await refreshDetached();
  if (n === 0) return;
  toast.info(t("app.detached.notice", { n }), {
    ms: 12000,
    action: { label: t("app.detached.notice.action"), run: () => openDetachedList() },
  });
}

async function drainMcpNotice(): Promise<void> {
  const message = await takeMcpNotice();
  if (message) showNotice(message);
}

/** 이미 떠나기로 답했다 — 그 뒤 창이 부서지며 `beforeunload` 가 또 뜨더라도 두 번 묻지 않게 */
let leaveConfirmed = false;

/** 확인 대화가 떠 있는 동안 또 온 닫기 요청은 막는다 — 대화가 두 장 뜨지 않게 */
let closeAsking = false;

/** `mode` null 이면 Rust 가 `[app] tray_on_close` 를 보고 트레이로 남을지 끝낼지 정한다 */
async function runQuit(mode: "exit" | "endSessions" | "tray" | null): Promise<void> {
  if (closeAsking) return;
  closeAsking = true;
  try {
    const ok = await quitAll(
      quitIO(async () => {
        await leaveAllWindowSessions();
        await invoke("workspace_exit_app", { mode });
      }),
    );
    if (!ok) leaveConfirmed = false;
  } catch { showNotice(t("app.workspaces.saveFailed")); }
  finally { closeAsking = false; }
}

/** [`runQuit`] 과 같은 길이고 마지막만 `update_install` 이다 — 돌아오면 취소됐거나(`error: null`) 설치기를 못 띄운 것이다 */
export async function quitForUpdate(): Promise<{ ok: boolean; error: string | null }> {
  if (closeAsking) return { ok: false, error: null };
  closeAsking = true;
  let error: string | null = null;
  try {
    const ok = await quitAll(
      quitIO(async () => {
        await leaveAllWindowSessions();
        leaveConfirmed = true;
        try {
          await invoke("update_install");
        } catch (e) {
          error = String(e);
          throw e;
        }
      }),
    );
    if (!ok) leaveConfirmed = false;
    return { ok, error };
  } catch (e) {
    leaveConfirmed = false;
    return { ok: false, error: error ?? String(e) };
  } finally {
    closeAsking = false;
  }
}

/** 창당 3초 상한 — `pagehide` 의 detach 는 앱 종료에서 닿지 않는다 */
async function leaveAllWindowSessions(): Promise<void> {
  const labels = await invoke<string[]>("workspace_windows").catch(() => [] as string[]);
  await Promise.all(labels.map((label) => requestWindow(label, { kind: "leaveSessions" }, 3000)));
}

function quitIO(exit: () => Promise<void>): QuitIO {
  return {
    windows: () => invoke<string[]>("workspace_windows"),
    inspect: async (label) => {
      const reply = await requestWindow(label, { kind: "inspect" });
      return reply && typeof reply === "object" ? reply : null;
    },
    confirm: confirmQuitAll,
    save: async (label, ids) => await requestWindow(label, { kind: "saveDocs", ids }) === true,
    flush: async (label) => await requestWindow(label, { kind: "pause" }) === true,
    resume: async (label) => { await requestWindow(label, { kind: "resume" }); },
    exit,
  };
}

/** 이 창의 문서만 묻는다 — 창마다 웹뷰가 따로라 다른 창의 편집기는 그 창이 닫힐 때 제가 묻는다 */
function watchWindowClose(): Promise<() => void> {
  return onWindowClose(async (cancel) => {
    if (closeAsking) {
      cancel();
      return;
    }
    if (isMainWindow) {
      cancel();
      await runQuit(null);
      return;
    }
    const unsaved = unsavedDocPanesInWindow();
    if (unsaved.length > 0) {
      closeAsking = true;
      let go = false;
      try {
        go = await confirmUnsavedClose(unsaved, docNameOf);
      } finally {
        closeAsking = false;
      }
      if (!go) {
        cancel();
        return;
      }
      leaveConfirmed = true;
    }
    // 보조 창이 사라지면 연결이 닫혀 서버가 열린 트랜잭션을 되돌린다
    const txPanes = dbTxPanesInWindow();
    if (txPanes.length > 0) {
      closeAsking = true;
      let go = false;
      try {
        go = await confirmDbTxClose(txPanes, docNameOf);
      } finally {
        closeAsking = false;
      }
      if (!go) {
        leaveConfirmed = false;
        cancel();
        return;
      }
    }
    // 디바운스가 아직 안 터졌을 수 있으니 마지막 배치를 한 번 더 밀어 넣는다
    if (!await flushTabSave()) { leaveConfirmed = false; cancel(); return; }
    if (isMainWindow) return;
    if (!await returnAuxTabs()) { leaveConfirmed = false; cancel(); return; }
    closeWindowSessions();
  });
}

/**
 * `beforeunload` 가 아니라 `pagehide` 다 — 원하는 것은 확인이 아니라 떠난다는 사실뿐이다(docs/log/2026-09-05-session-leak-on-reload.md).
 * 언로드 중 invoke 는 닿지 못할 수 있다 — 떨어뜨리기를 실제로 보장하는 것은 백엔드다(부팅 첫 줄의 `reapWindowSessions` · Rust 페이지 로드 그물).
 * detach 를 먼저 던진다 — `flushTabSave` 를 기다리는 사이 문서가 사라지면 그 뒤의 invoke 는 나가지 못한다.
 */
function watchPageHide(): () => void {
  if (typeof window === "undefined") return () => {};
  const leaving = async () => {
    // 원격 창은 시청만 끝낸다 — 세션은 메인 PC 것
    if (isRemote) leaveViewers();
    void leaveWindowSessions();
    await flushTabSave();
  };
  window.addEventListener("pagehide", leaving);
  return () => window.removeEventListener("pagehide", leaving);
}

/** `pagehide` 의 체크포인트가 언로드 중에 못 나가도(웹뷰 크래시면 아예 없다) 마지막으로 맡긴 화면부터 복원된다 */
function watchCheckpoints(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onVisibility = () => {
    if (document.visibilityState === "hidden") stashWindowCheckpoints();
  };
  const onBeforeUnload = () => stashWindowCheckpoints();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}

/** 저장 안 한 문서가 있을 때 리로드를 웹뷰의 기본 확인으로 한 번 막는다 — 창 닫기는 [`watchWindowClose`] 가 앱 대화로 묻는다 */
function watchBeforeUnload(): () => void {
  if (typeof window === "undefined") return () => {};
  const guard = (ev: BeforeUnloadEvent) => {
    if (leaveConfirmed || unsavedDocPanesInWindow().length === 0) return;
    ev.preventDefault();
    // 옛 방식 — 일부 엔진은 preventDefault 만으로는 묻지 않는다(returnValue 에 무엇이든 넣어야 한다)
    ev.returnValue = "";
  };
  window.addEventListener("beforeunload", guard);
  return () => window.removeEventListener("beforeunload", guard);
}

export function mountAppListeners(): () => void {
  const workspaceRequests = listenWindowRequests(async (action) => {
    if (action.kind === "inspect") {
      const workspace = currentWorkspace();
      return {
        label: currentWindowLabel(), unknown: false,
        displayLabel: isMainWindow ? t("app.workspaces.mainWindow")
          : workspace ? t("app.workspaces.auxWindow", { name: workspace.name })
          : t("app.workspaces.anotherWindow"),
        docs: unsavedDocPanesInWindow().map((id) => ({ id, name: docNameOf(id) })),
      };
    }
    if (action.kind === "saveDocs") {
      for (const id of action.ids) if (!await requestDocSave(id)) return false;
      return true;
    }
    if (action.kind === "hostAliases") {
      if (action.to) for (const alias of action.aliases) renameHostInTabs(alias, action.to);
      noteWorkspaceHostAliases(action.aliases, action.to);
      return true;
    }
    if (action.kind === "pause") {
      // 창 이관이면 실은 초안이 낡지 않았는지 먼저 — 낡았으면 받는 창이 꺼내지 않는다
      if (!holdTearSource(action.token)) return false;
      const ok = await pauseWorkspaceSave();
      if (!ok) thawTearSource(action.token);
      return ok;
    }
    if (action.kind === "resume") { thawTearSource(action.token); resumeWorkspaceSave(); return true; }
    if (action.kind === "leaveSessions") { await leaveWindowSessions(); return true; }
    if (action.kind === "release") return releaseWorkspaceTear(action.token);
    // 작업안은 주 창의 채팅 독 갈래에만 있다
    if (action.kind === "plans") {
      if (!isMainWindow) return false;
      if (action.at) openPlansAt(action.at);
      else if (action.history) openRunInHistory(action.history);
      else {
        if (action.view) setPlansView(action.view);
        openPlans();
      }
      return true;
    }
    if (action.kind === "focus") {
      if (action.workspaceId) switchWorkspace(action.workspaceId);
      const pane = residentWindowTabs().flatMap((tab) => listPanes(tab.root)).find((pane) =>
        action.streamId ? pane.historyStreamId === action.streamId : action.tileKey ? pane.tileKey === action.tileKey : pane.id === action.paneId);
      if (!pane) return false;
      revealPane(pane.id);
      return true;
    }
    return false;
  }).catch(() => () => {});
  const renamedWorkspace = listen<{ id: string; name: string }>("workspace-renamed", (event) =>
    noteWorkspaceName(event.payload.id, event.payload.name)).catch(() => () => {});
  const styledWorkspace = listen<{ id: string; icon?: string; color?: string }>("workspace-style-changed", (event) =>
    noteWorkspaceStyle(event.payload.id, event.payload.icon, event.payload.color)).catch(() => () => {});
  const quitting = listen("workspace-quitting", () => { leaveConfirmed = true; }).catch(() => () => {});
  // DB AI 권한 사본도 다시 읽는다 — 부팅 때 서버가 없었으면 빈 사본(칩 Off)이고, 바뀐 서버는 판이 다를 수 있다
  const serverConnected = listen<{ replaced: boolean }>("session-server-connected", (event) => {
    void recheckVaultVeil(event.payload.replaced);
    void refreshDbAi();
  }).catch(() => () => {});
  // 가림막은 메인 PC 창 전체에 하나처럼 선다
  const veilAcross = listenVeilAcrossWindows().catch(() => () => {});
  // [떨어진 세션] 은 부팅 중이면 `take_tray_intent` 가 데려간다
  const trayQuit = isMainWindow
    ? listen<{ mode: "exit" | "endSessions" | "tray" }>("tray-quit", (event) => {
        const m = event.payload?.mode;
        void runQuit(m === "endSessions" || m === "tray" ? m : "exit");
      }).catch(() => () => {})
    : Promise.resolve(() => {});
  const trayIntent = isMainWindow
    ? listen<string>("tray-intent", (event) => {
        if (event.payload === "detached") openDetachedList();
      }).catch(() => () => {})
    : Promise.resolve(() => {});
  const workspaceStatus = listenWorkspaceStatus().catch(() => () => {});
  const closing = watchWindowClose().catch(() => () => {});
  const leaving = watchPageHide();
  const unloadGuard = watchBeforeUnload();
  const checkpoints = watchCheckpoints();

  // 되올리기 실패도 반드시 보여 준다 — 저장했는데 안 올라간 것을 모르면 서버가 바뀐 줄 안다
  const uploaded = onUploaded((ev) => {
    const text = t("app.upload.done", { path: ev.remote_path });
    toast.success(text);
    recordNotification({ kind: "transfer", text, level: "success" });
  }).catch(() => () => {});
  const uploadFail = onUploadFailed((ev) => {
    const text = t("app.upload.failed", {
      path: ev.remote_path,
      error: ev.message ?? t("app.error.unknown"),
    });
    toast.error(text);
    recordNotification({ kind: "transfer", text, level: "error" });
  }).catch(() => () => {});

  // 자동 재등록은 대개 이 마운트보다 늦게 끝나지만 빨리 끝나 이벤트를 놓칠 수도 있다 — 마운트 때 한 번 · 이벤트마다 가져온다
  void drainMcpNotice();
  const reregistered = listen<string>("mcp-reregistered", () => void drainMcpNotice()).catch(
    () => () => {},
  );

  const settingsSaved = listenSettingsSaved().catch(() => () => {});

  // 파일에 사는 스니펫 · 레이아웃은 이름을 바꾼 창이 이미 고쳤다 — 여기서 다시 쓰면 두 창이 같은 파일을 서로 덮어쓴다
  const hostRenamed = listenHostRenamed().catch(() => () => {});

  const unmountHistory = mountHostHistory();
  const unmountDbHistory = mountDbHistory();
  const unmountKeepAwake = mountKeepAwake();
  const unmountProjects = mountProjects();

  const agentSignals = listenAgentSignals().catch(() => () => {});
  const unmountAgentSeen = mountAgentSeen();
  const remoteHooksAuto = listenRemoteHooksAuto().catch(() => () => {});

  const delegationChanged = listenDelegationChanged().catch(() => () => {});

  const unwatchAiFocus = watchAiFocus();
  const unwatchShellFocus = watchShellFocus();

  return () => {
    void workspaceStatus.then((un) => un());
    void trayQuit.then((un) => un());
    void trayIntent.then((un) => un());
    void workspaceRequests.then((un) => un());
    void renamedWorkspace.then((un) => un());
    void styledWorkspace.then((un) => un());
    void quitting.then((un) => un());
    void serverConnected.then((un) => un());
    void veilAcross.then((un) => un());
    void closing.then((un) => un());
    leaving();
    unloadGuard();
    checkpoints();
    void uploaded.then((un) => un());
    void uploadFail.then((un) => un());
    void reregistered.then((un) => un());
    void settingsSaved.then((un) => un());
    void hostRenamed.then((un) => un());
    unmountHistory();
    unmountDbHistory();
    unmountKeepAwake();
    unmountProjects();
    void agentSignals.then((un) => un());
    unmountAgentSeen();
    void remoteHooksAuto.then((un) => un());
    void delegationChanged.then((un) => un());
    unwatchAiFocus();
    unwatchShellFocus();
  };
}

// ── `$effect` 들의 몸통 ──

/** 부팅 중의 "0개" 와 사용자가 다 비운 "0개" 를 가른다 */
let hadTab = false;

/** 분리 창만 — "탭 0개" 하나로 판정하지 않는다: 분리 창은 탭 0개로 태어나 짐을 받기도 전에 스스로 닫힌다 */
export function closeWhenEmptied(): void {
  // 원격 창은 브라우저 탭이다 — 비어도 스스로 닫지 않는다
  if (isMainWindow || isRemote) return;
  if (residentWindowTabs().length > 0) hadTab = true;
  else if (hadTab) closeThisWindow();
}

/**
 * 실제로 달라졌을 때만 사진을 다시 디코딩한다 — `settled` 전의 기본값을 첫 기준으로 잡으면 켤 때마다 모드 변경으로 오인한다.
 * `$state` 가 아니다 — 효과 안에서 읽고 쓰는 값이라 자기 쓰기가 자기를 다시 깨운다.
 */
let lastMode: "dark" | "light" | null = null;

export function syncDynamicColorToMode(): void {
  if (!appMode.settled) return;
  const next = appMode.resolved;
  if (lastMode === next) return;
  const changed = lastMode !== null;
  lastMode = next;
  if (changed) void modeChanged(wallpaper.src);
}

/**
 * 배경 · 단계가 바뀌는 모든 길을 이 효과 하나가 받는다 — 길마다 부르면 하나를 빠뜨리는 순간 틴트가 지난 사진의 색으로 남는다.
 * 추적은 두 값뿐이다 — 나머지를 `untrack` 밖에 두면 설정 전체가 의존으로 잡혀 슬라이더 한 칸에도 다시 돈다.
 */
export function syncWallpaperTintNow(): void {
  const src = wallpaper.src;
  const mode = settings.dynamicMode;
  untrack(() => void syncWallpaperTint(src, mode));
}

// ── 투명도 ──

export function applyChromeOpacity(): void {
  const pct = settings.opacity;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--chrome-pct", `${pct}%`);
  }
}

/** 0~1 로 넣는다 — `color-mix` 안에서 `calc(var(…) * 100%)` 로 쓴다 · `.pane-box` 와 xterm 캔버스가 같은 % 를 봐야 한 겹만 보인다 */
export function applyTermOpacity(): void {
  const pct = settings.termOpacity;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--term-opacity", String(pct / 100));
  }
}

async function confirmQuitAll(windows: UnsavedWindow[]): Promise<QuitChoice> {
  const labels = { save: t("app.unsaved.save"), discard: t("app.unsaved.discard") };
  const count = windows.reduce((n, w) => n + w.docs.length, 0);
  const body = [t("app.unsaved.confirm", { count }), "",
    ...windows.flatMap((w) => {
      const label = w.displayLabel ?? t("app.workspaces.anotherWindow");
      return w.unknown
        ? [t("app.workspaces.quitUnknown", { label })]
        : w.docs.map((d) => "· [" + label + "] " + d.name);
    })].join("\n");
  try {
    // 주 창에 뜬다 — 트레이 종료는 Rust 가 주 창을 먼저 띄운다(`tray.rs` `open_main`)
    return choiceFromDialog(await askChoice(body, {
      title: t("app.unsaved.title"), kind: "warning",
      yesLabel: labels.save, noLabel: labels.discard, cancelLabel: t("app.unsaved.cancel"),
    }), labels);
  } catch { showNotice(t("app.unsaved.noDialog")); return "cancel"; }
}
