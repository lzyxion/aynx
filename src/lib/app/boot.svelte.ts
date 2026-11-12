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
import { loadThemeProfiles } from "$lib/theme-profiles.svelte.js";
import { takeMcpNotice } from "$lib/context";
import { onUploadFailed, onUploaded } from "$lib/sftp";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { noticeOrphanedRuns } from "$lib/app/orchestration.svelte.js";

/**
 * **이 창이 켜지는 순서와, 켜져 있는 동안 듣는 것들.**
 *
 * `+page.svelte` 의 `onMount` 가 부르는 두 함수([`boot`]·[`mountAppListeners`])와, 컴포넌트
 * 수명이 있어야만 걸 수 있는 `$effect` 들의 **몸통**이 여기 모여 있다 (효과 자체는 여전히
 * `+page` 가 건다 — 룬 모듈에는 붙일 수명이 없다).
 */

/**
 * 이 창의 부팅 순서 — **설정이 먼저**다.
 *
 * `app.auto_reconnect` 를 읽어야 복원된 SSH 타일을 자동으로 붙일지 정할 수 있고, 그 판단은
 * 타일이 뜨기 전에 끝나 있어야 한다 (뜬 뒤에 정하면 잠깐 대기 배너가 보였다 사라진다).
 * `loadSettings` 는 실패를 삼키므로 이 await 가 부팅을 막을 일은 없다.
 *
 * 월페이퍼 경로 조회도 여기 붙는다 — 설정이 채워진 **뒤**라야 걸린 사본의 이름을 알고,
 * 타일이 뜨기 **전**이라야 배경이 한 박자 늦게 나타나지 않는다.
 */
export async function boot(): Promise<void> {
  // 원격 창(R4)은 묻기 · 마스터 재확인을 앱 모달로 — 폴리필이 볼 손잡이를 **무엇보다 먼저** 건다(부팅 중 묻는 것도 모달로).
  if (isRemote) installRemoteUi();
  // 원격 창의 폭 · 터치 · 페이지 보임(R5 — 모바일 배치 · 크기 주인 자격 · 시청 구독). 타일이 뜨기 전에 — 첫 시청자 붙기가 자격을 싣는다.
  if (isRemote) startMobile();
  // **가장 먼저** — 이 창이 *예전 페이지에서* 남긴 세션을 거둔다
  // (docs/log/2026-09-05-session-leak-on-reload.md).
  //
  // 새로고침·개발 서버 전체 리로드는 프런트의 정리 경로를 하나도 태우지 않은 채 새 페이지를
  // 띄운다. 그 페이지가 타일을 다시 마운트하면 세션이 한 벌 더 열리고, 이전 벌은 영영
  // 남는다 (실측: 리로드 여섯 번에 pwsh 24개). 그 정리를 여기서, **타일이 뜨기 전에**
  // 끝낸다 — 순서가 뒤집히면 방금 연 세션을 스스로 죽인다.
  //
  // 이 창(라벨)이 연 세션만 대상이고 이관 중인 것은 빠진다. 분리 창에서도 그대로 부른다:
  // 그 라벨의 세션은 아직 하나도 없어(짐은 소스 창 소유다) 아무 일도 하지 않는다.
  //
  // **세션은 닫지 않는다**(2026-10-08 세션 코어 ②-1 로컬 · ②-2 SSH) — 손만 놓고(Detached) 아래 복원된 타일이 같은
  // 스트림에 다시 붙는다(`Terminal` 의 붙기 — SSH 연결 대기 타일도 먼저 붙어 본다). 아무 타일도 데려가지 않은 것은
  // 닫지 않고 "떨어진 세션" 으로 남는다(③-4 — 복원 뒤 `restoreDoneSessions` 가 표시만 한다 · `app/detached`).
  await reapWindowSessions();
  await loadSettings();
  // 사용자 터미널 테마(`<설정 루트>/terminal-themes/`) — `user:` 키를 푸는 목록이라 설정 바로 뒤 · 타일이 뜨기 전에(실패는 삼킨다 —
  // 그동안 같은 모드의 Aynx 로 그려진다).
  await loadUserTermThemes();
  // 아바타 라이브러리(사용자 그림의 썸네일 — 원격도 읽는다) — 탭 · 머리줄 · 아티스트가 `user-<12hex>` 를 풀 목록이라 타일이 뜨기 전에.
  // 기다리지 않는다(실패 · 늦음이면 그동안 기본 그림 — docs/log/2026-10-31-avatars.md).
  void refreshAvatars();
  // 앱 모드는 `[app] mode` 에 산다 — 설정이 도착하는 **바로 이 자리**가 고른 값을 화면에
  // 입힐 수 있는 가장 이른 지점이다 (docs/log/2026-09-04-light-theme.md). 월페이퍼보다
  // 앞이어야 한다: 동적 색을 다시 뽑는 `$effect` 가 배경 이미지를 보기 전에 모드가 확정돼
  // 있어야 시작하자마자 사진을 한 번 더 디코딩하지 않는다.
  adoptStoredMode();
  // 화면 언어도 `[app] language` 에 산다 — 모드와 **같은 사건**이라 바로 옆에 붙인다
  // (docs/log/2026-09-17-i18n.md). 타일이 뜨기 전이어야 첫 프레임부터 제 언어로 그려지고,
  // 값이 없으면 OS 를 따른다. 기본(한국어)으로 시작하는 사람에게는 아무 일도 없다.
  applyStoredLanguage();
  if (isMainWindow) {
    const blocked = ACTIONS.filter((action) => action.def && effectiveCombo(action.id, settings.current.keybindings) === null);
    if (blocked.length) showNotice(t("app.workspaces.keyConflict", { combos: blocked.map((action) => displayCombo(action.def)).join(", ") }));
  }
  await refreshWallpaper();
  // 저장해 둔 **스니펫** — 명령 팔레트와 설정 섹션이 목록을 그린다. 프리셋과 같은 관례라
  // (자기 파일 · 실패를 삼킴) 바로 옆에 둔다 (docs/log/2026-09-16-snippets.md).
  await loadSnippets();
  // 저장해 둔 **모양 프로필** — 설정 화면과 명령 팔레트가 목록을 그린다. 여기서 읽는 것은
  // 목록뿐이고 **아무것도 입히지 않는다**: 지금 걸린 모양은 이미 `settings.toml` 에 있다
  // (docs/log/2026-09-15-theme-profiles.md).
  await loadThemeProfiles();
  // **AI 위임 표** — 호스트 목록의 줄 끝 표식과 제거 확인 문구가 동기로 읽는 사본이라,
  // 목록이 처음 그려지기 전에 한 번 채워 둔다 (그 뒤로는 `refreshHosts` 가 같은 박자로
  // 맞춘다 — `app/delegation.svelte.ts` 머리말). 기다리지 않는다: 표식 하나가 한 박자 늦게
  // 뜨는 것과 부팅이 늦어지는 것은 무게가 다르다. 읽기가 끝나면 **고아 위임 한 줄**을
  // 알린다 (메인 창에서만 · 앱 시작마다 한 번 — [`noticeOrphanDelegations`]).
  // DB 연결 목록 사본 — 호스트 삭제 확인이 "경유하는 DB 연결 N개" 를 동기로 센다(`app/host-remove`).
  void ensureDbConns();
  void refreshDelegationTargets().then(() => {
    if (isMainWindow) noticeOrphanDelegations();
  });
  // DB 연결의 AI 권한 사본 — 복원된 쿼리 타일 머리줄 칩이 동기로 읽는다(안 읽으면 서버가 Read 여도 Off 로 보인다 · 2026-11-09 실기).
  void refreshDbAi();
  try {
    await bootTear();
    // 원격 창(R2-B)은 제 탭을 만들지 않는다 — 집 PC 주 창의 화면을 비춘다(`app/mirror`).
    if (isRemote) {
      // 배치 바꾸기는 요청으로 집 PC 주 창에(R3 — `app/mirror-requests`).
      startRemoteLayoutRequests();
      await bootMirror();
    }
    else if (tearToken === null) await bootTabs();
    // 사이드 채팅 목록(사람 창 — 주 창 · 원격 웹 창, `app/side-chats`). v2 부터 채팅은 PTY 세션이 아니다 — v1 이 남긴 세션은 아래 복원
    // 알림 뒤에 닫는다(주 창만). 원격 창은 거울을 받은 뒤라 연결 칩의 타일 후보가 곧바로 선다.
    if (isMainWindow || isRemote) await bootSideChats();
  } finally {
    // **복원이 끝났다** — 이 창이 지금 그리는 세션 타일의 스트림을 알린다. 예전 페이지·지난 실행이 남긴 떨어진 세션 중
    // 아무 타일도 데려가지 않은 것은 **닫지 않고** 떨어진 세션 목록에 남긴다(③-4 · 설계 4.5 — 0c 전의 "복원이 데려가지
    // 않은 세션 닫기" 임시 정책을 걷었다). 끝난 잔해만 Rust 가 닫는다. 복원이 실패해도 돈다. 주 창이면 그 뒤 수를 세어
    // 한 줄 알린다(사람이 붙이거나 닫는다).
    void restoreDoneSessions(windowSessionStreams()).then(async () => {
      if (!isMainWindow) return;
      // v1 사이드 채팅의 PTY 세션(`sidechat-*`)을 한 번 닫는다 — 떨어진 세션 안내에 세지 않게 그 전에(설계 6절 · 몇 번 불려도 같다)
      await closeLegacySideChatSessions().catch(() => 0);
      void noticeDetached();
    });
  }
  startDetached();
  // 에이전트 상태 점 — 권위는 Rust 표다(`app/agent-status` 머리말). 탭이 선 뒤 한 번 받아 채운다(기다리지 않는다).
  void syncAgentStates();
  // 이 PC 의 훅 우리 항목을 앱이 새 판으로 갈아 썼으면(Codex 는 `/hooks` 다시 승인) 한 번 알린다 — 주 창만.
  if (isMainWindow) void noticeLocalHookRefresh();
  // 세션 서버가 다시 떠 읽기 전용으로 남은 오케스트레이션 Run 이 있으면 한 번 알린다(2b) — 주 창만.
  if (isMainWindow) void noticeOrphanedRuns();
  requestWorkspaceStatus();
  // **자동 승인은 화면이 아니라 앱의 일이다** (docs/log/2026-09-20-console-fixes.md ③) — ③-4 부터는 세션 서버의 타이머다
  // (창이 하나도 없어도 돈다). 창 쪽은 거부 사유를 검토 카드에 적는 일만 남았다 — **메인 창에서만**(분리 창까지 들으면
  // 사유가 창 수만큼 적힌다 · `app/auto-approve` 머리말).
  //
  // **원격 창도**(R4 — 원격 승인) 이 묶음 셋을 건다: 원격 창은 집 PC 와 다른 기기의 다른 사람 눈이라(분리 창처럼 같은
  // 화면의 둘째 벌이 아니다) 대기 카드 · 상태바 배지 · 알림 센터의 승인 줄 · 실행 결과 토스트가 거기서도 보여야 원격에서
  // 승인할 수 있다. 이벤트(`operation-state` · `operation-auto-refused`)는 원격 브리지의 `listen` 이 이미 받는다(값·비밀 없음 —
  // id · 상태 · 사유 한 줄). 결과 알림의 메신저 · "그동안 끝난 실행" 꺼내기는 집 PC 주 창만(`remote` — 두 번 보내지 않게).
  if (isMainWindow || isRemote) startAutoApprove();
  // 승인 대기 배지도 같은 자리에 산다 — 관제판을 열어야만 "기다리는 게 있다" 를 알 수 있던
  // 것을 상태바로 끌어낸다 (docs/log/2026-09-21-approval-ttl.md). 자동 승인과 마찬가지로
  // **메인 창에서만**: 분리 창이 같은 수를 각자 폴링할 이유가 없다.
  if (isMainWindow || isRemote) startPendingPlans();
  // 작업안 **실행 결과** 알림 — 끝났다는 사실과 결과를 토스트·알림 센터·OS 알림에 뿌린다
  // (docs/log/2026-09-28-run-result-notify.md). 같은 이유로 **메인 창에서만**: `operation-state` 는
  // 모든 창에 방송되므로 분리 창까지 걸면 창 수만큼 운다.
  if (isMainWindow || isRemote) startOperationNotify({ remote: isRemote });
  // 원격 기기 페어링 확인(R1a-2) — 집 PC 주 창의 사람만 [허용] 한다(관문은 주 창에만 이벤트를 보낸다).
  if (isMainWindow) startRemotePair();
  // 원격 창의 배치 바꾸기 요청(R3) — GUI 가 주 창에만 여는 채널로 받아 제 함수로 적용한다.
  if (isMainWindow) void startMirrorRequests();
  // 원격 접속 중 표시(R1a-5 — 상태바 원격 칩 · 끌 수 없다) — 주 창만(`remote-sessions` 는 주 창 대상)
  if (isMainWindow) startRemoteAccess();
  // 앱 안 업데이트(2026-11-12) — 상태바 칩 · 알림 · 카드는 주 창 한 곳(원격 창은 명령이 모두 거절된다 — `remote/deny.rs`).
  if (isMainWindow) startUpdater({ leave: quitForUpdate });
  // 오케스트레이션 감독 사건(리뷰 F11) — 서버가 사건 id 와 함께 만든 것을 주 창 한 곳이 한 번 보인다.
  if (isMainWindow) startOrchestrationNotify();
  // 오케스트레이션 — 앨범 목록 요약(탭 · 독 막대의 재료) · AI 가 연 앨범의 탭 자동 배치(Q3 — 그 프로듀서 채팅의 탭을 가진 창 하나가 서버 장부로
  // 가져간다). 집 PC 의 모든 창(보조 창에도 오케스트레이션 탭이 있을 수 있다) — 원격 창은 탭 트리를 고치지 않는다.
  if (!isRemote) startOrchCoordinators();
  // 오케스트레이션 탭 모양 맞추기(2026-10-29 · 2단계 단계 6) — 무너진 탭 · 프로듀서 잎 없는 홈 · 1단계 터미널 프로듀서 탭(→ 보통 탭)을 고친다.
  if (!isRemote) startOrchTabRepair();
  // 상태바 후미의 전역 신호 (docs/log/2026-09-21-statusbar-signals.md) — 같은 조건(메인 창)이다.
  // (`✦ AI 연결`·`▶ 실행 중` 은 2026-10-05 상태바에서 뺐다 — docs/log/2026-10-05-statusbar-trim.md)
  //
  // **`🔒 볼트`** 는 이미 있는 상태(`app/vault`)를 읽는데, 그 상태는 지금까지 **설정 › 보안을
  // 열어야만** 채워졌다. 부팅에서 한 번 읽고, 돌아온 순간(창 포커스)에 다시 읽는다 — 가림막이
  // 걷히거나 다른 창에서 잠겼을 수 있다. 폴링은 두지 않는다: 볼트는 스스로 상태를 바꾸지
  // 않고(시계는 가림막 쪽 하나뿐이다 — `app/veil`), 이 창에서 바꾼 것은 `refreshVault` 가
  // 그 자리에서 되읽는다.
  if (isMainWindow) {
    void refreshVault();
    window.addEventListener("focus", () => void refreshVault());
  }
  // 볼트는 세션 서버에 산다(③-3b1) — 보는 창이 하나도 없던 동안 서버가 **창 0개 잠금**을 걸었으면(`relock`) 이 창이
  // 관문(가림막)을 세운다. 볼트를 다시 잠그지는 않는다(그 잠금은 HTTP MCP 티켓을 정지만 했다 — `app/veil`). 모든 창.
  // 집 PC 창이면 마스터가 걸린 볼트가 잠겨 있을 때도 가림막이다(2026-10-28 — 마스터를 걸었으면 앱을 다시 켤 때 무조건 가린다 ·
  // 보조 창도 — 가림막이 선 동안 새로 뜬 창이 맨 화면을 보이지 않게).
  void recheckVaultVeil(false, !isRemote);
}

/**
 * **설정에 없는 AI 위임**이 있으면 부팅에 한 줄 알린다
 * (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * 고아 위임은 호스트 이름을 바꿨을 때 `~/.aynx/delegation.toml` 에 남는 옛 블록이고, **영영
 * 붙지 않는다**. 앞선 판에서는 관제판 목록이 그것을 `미접속` 으로 그렸는데, 그 글자는
 * "아직 안 붙었다" 로 읽혀 알아챌 길이 파일을 열어 보는 것뿐이었다. 목록이 관제판에서
 * 설정으로 옮겨 가면서(위임은 돌고 있는 것이 아니라 설정이다) 화면에서 마주칠 일이 더
 * 줄었으므로, **앱이 먼저 한 번 말한다.**
 *
 * 한 줄뿐이고 **앱을 켤 때 한 번**이다(창마다가 아니라 메인 창에서만 — 부르는 자리가 그
 * 조건을 건다). 개수만 말하고 고치는 자리로 데려가는 단추 하나를 단다 — 여기서 고칠 수
 * 있는 것이 없으므로 알림이 그 자체로 끝나면 안 된다.
 */
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

/**
 * **떨어진 세션**이 있으면 부팅에 한 줄 알린다(③-4 — 주 창 · 앱 시작마다 한 번). [보기] 는 세션 목록 판의 그 묶음으로.
 * 트레이 메뉴의 [떨어진 세션] 으로 창을 연 것이면(`take_tray_intent`) 알림 대신 곧바로 목록을 연다.
 */
/** 부팅 안내가 떨어진 세션을 세기 전에 기다리는 시간 — 복원된 타일이 붙을 틈 */
const DETACHED_NOTICE_SETTLE_MS = 3000;

async function noticeDetached(): Promise<void> {
  const intent = await invoke<string | null>("take_tray_intent").catch(() => null);
  if (intent === "detached") {
    openDetachedList();
    return;
  }
  // 한 박자 기다렸다 센다 — 복원된 탭 중 아직 붙지 않은 타일(돌려받은 분리 창 탭 등)의 세션이 잠깐 "떨어진" 것으로 보인다
  // (실기 10-10: 안내가 1개라 했는데 곧 0). 그 사이 붙은 것은 목록에서 빠진다(이벤트).
  await new Promise((r) => setTimeout(r, DETACHED_NOTICE_SETTLE_MS));
  const n = await refreshDetached();
  if (n === 0) return;
  toast.info(t("app.detached.notice", { n }), {
    ms: 12000,
    action: { label: t("app.detached.notice.action"), run: () => openDetachedList() },
  });
}

/** 백엔드에 남아 있는 MCP 자동 재등록 한 줄을 가져와 토스트로 보여 준다 */
async function drainMcpNotice(): Promise<void> {
  const message = await takeMcpNotice();
  if (message) showNotice(message);
}

/**
 * 사람이 "버리고 닫기"/"저장하고 닫기" 로 이 창을 떠나기로 이미 답했는가 — 그 뒤 창이 부서지며 `beforeunload`
 * 가 또 뜨더라도 두 번 묻지 않게([`watchBeforeUnload`]).
 */
let leaveConfirmed = false;

/** 창 닫기 확인 대화가 떠 있는 동안 또 온 닫기 요청(× 연타)은 그냥 막는다 — 대화가 두 장 뜨지 않게. */
let closeAsking = false;

/**
 * **앱 전체를 떠나는 흐름** — 주 창의 X(`mode` null)와 트레이 메뉴의 [GUI 종료]·[모든 세션 종료] · 독의 종료 단추
 * (`app_end_all_sessions` — 트레이 [모든 세션 종료] 와 같은 길)(`tray-quit` — 확인은 Rust 대화상자가 이미 받았다)가 같이 쓴다. 저장 안 한 문서를 묻고(`quitAll`), 창마다 세션을 체크포인트와 함께 놓은 뒤
 * `workspace_exit_app({ mode })` 를 부른다. `mode` null 이면 Rust 가 설정 `[app] tray_on_close`(기본 켬)를 보고 트레이로
 * 남을지(창 전부 파괴 · 세션 생존) 끝낼지 정한다. 대화가 떠 있는 동안 또 온 요청은 버린다.
 */
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

/**
 * **업데이트를 위해 떠나기**(2026-11-12 — `app/updater` 의 [다시 시작]) — [`runQuit`] 과 같은 길(저장 안 한 문서 묻기 · 창마다 세션을
 * 체크포인트와 함께 놓기)을 지나 마지막만 `update_install` 이다(세션 서버를 끝내고 설치기를 띄운 뒤 GUI 가 끝난다 — Rust
 * `updater.rs`). 돌아오면 취소됐거나(`error: null`) 설치기를 못 띄운 것이다(창들은 다시 저장을 잇는다 — `quitAll`).
 */
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

/** 끊기 전에 창마다 세션을 체크포인트와 함께 놓는다(③-2 — 세션은 서버에 살고, 다시 켜면 그 화면부터 붙는다). 창당 3초 상한 —
 * `pagehide` 의 detach 는 앱 종료에서 닿지 않는다(실기 10-09). */
async function leaveAllWindowSessions(): Promise<void> {
  const labels = await invoke<string[]>("workspace_windows").catch(() => [] as string[]);
  await Promise.all(labels.map((label) => requestWindow(label, { kind: "leaveSessions" }, 3000)));
}

/** [`quitAll`] 의 IO — 마지막 한 걸음(`exit`)만 부르는 쪽이 고른다 */
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

/**
 * 창이 닫힐 때 — 메인 창은 마지막 배치를 밀어 넣고, 분리 창은 자기 세션을 정리한다.
 *
 * **저장 안 한 문서가 있으면 먼저 묻는다** (docs/log/2026-09-27-doc-edit.md "F2") — 타일 닫기와 같은 대화
 * (`confirmUnsavedClose`). 취소 · 저장 실패면 창을 닫지 않는다. 이 창의 문서만 본다 — 창마다 웹뷰가 따로라
 * 다른 창의 편집기는 그 창이 닫힐 때 제가 묻는다(메인 창을 닫아도 분리 창은 살아 있다 — 앱은 마지막 창이
 * 닫힐 때 끝난다).
 */
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
    // 보조 창의 열린 트랜잭션 작업(쿼리 타일 1단계) — 창이 사라지면 연결이 닫혀 서버가 되돌린다. 메인 창은 위에서 이미 떠났다
    // (트레이로 남거나 GUI 가 끝나도 연결은 떼어질 뿐 — 작업은 서버에 남는다).
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
    // 메인 창: 디바운스가 아직 안 터졌을 수 있으니 마지막 배치를 한 번 더 밀어 넣는다.
    // 세션 정리는 필요 없다 — 프로세스 자체가 끝난다 (아래는 분리 창 전용이다).
    if (!await flushTabSave()) { leaveConfirmed = false; cancel(); return; }
    if (isMainWindow) return;
    if (!await returnAuxTabs()) { leaveConfirmed = false; cancel(); return; }
    closeWindowSessions();
  });
}

/**
 * **페이지가 떠나는 순간** 이 창의 세션을 놓는다 — 로컬은 손만 놓고(+ 화면 체크포인트), SSH 는 닫는다.
 * (docs/log/2026-09-05-session-leak-on-reload.md · 세션 코어 ② docs/internal/session-server-design-2026-10-08.md 4.3)
 *
 * `pagehide` 는 F5·Ctrl+R·개발 서버의 전체 리로드·창 닫힘에 모두 뜬다. `beforeunload` 가
 * 아닌 이유는 그쪽이 "떠날까요?" 대화상자용 훅이라 브라우저마다 억제 규칙이 다르고,
 * 우리가 원하는 것은 확인이 아니라 **떠난다는 사실**뿐이기 때문이다. 창 **닫힘**은 이보다 먼저
 * `watchWindowClose` 가 `closeWindowSessions`(종료)를 부른다 — 그 뒤 여기서 detach 가 엇갈려도 무해하다.
 *
 * 던지는 `invoke` 는 **fire-and-forget** 이다 — 언로드 중에는 `await` 할 수 없고, Tauri IPC
 * 는 비동기라 문서가 죽으면서 함께 취소될 수 있다. 그래서 이 훅은 "닿으면 체크포인트까지 맡기는"
 * 빠른 길일 뿐이고, **떨어뜨리기를 실제로 보장하는 것은 백엔드**다 (부팅 첫 줄의
 * `reapWindowSessions` 와 Rust 의 페이지 로드 그물). 셋 다 멱등이라 겹쳐 돌아도 무해하다.
 * **detach 를 먼저 던진다** — `flushTabSave` 를 기다리는 사이 문서가 사라지면 그 뒤의 invoke 는 나가지 못한다.
 */
function watchPageHide(): () => void {
  if (typeof window === "undefined") return () => {};
  const leaving = async () => {
    // 원격 창의 시청자 타일(R2-B) — 시청만 끝낸다(세션은 집 PC 것).
    if (isRemote) leaveViewers();
    void leaveWindowSessions();
    await flushTabSave();
  };
  window.addEventListener("pagehide", leaving);
  return () => window.removeEventListener("pagehide", leaving);
}

/**
 * **화면 체크포인트를 맡기는 때** 둘 — 창이 가려질 때(`visibilitychange` → hidden)와 `beforeunload`
 * (설계 4.3 "맡기는 때": 이관·pagehide·창 가려질 때·출력이 있었으면 30초마다 — 30초 주기는 `Terminal` 이 건다).
 * `pagehide` 의 체크포인트가 언로드 중에 못 나가도(웹뷰 크래시면 아예 없다) 마지막으로 맡긴 화면부터 복원된다.
 * 세션은 건드리지 않는다(맡기기만 한다).
 */
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

/**
 * **페이지 리로드(F5 · Ctrl+R · 개발 서버의 전체 리로드)를 저장 안 한 문서가 있을 때 한 번 막는다**
 * (docs/log/2026-09-27-doc-edit.md "F2").
 *
 * 위 `pagehide` 가 "떠난다는 사실" 만 받는 것과 달리, 이쪽은 브라우저의 **"떠날까요?" 기본 확인**을 부르는 유일한
 * 훅이다. 할 수 있는 것은 거기까지다: 문구도 단추도 웹뷰(WebView2)의 것이고(저장 단추는 없다 — 머물러서
 * 저장하라는 뜻뿐), 비동기 일(저장)을 할 수 없으며, 떠나기를 고르면 글은 사라진다. 창 닫기는 이 길이 아니라
 * [`watchWindowClose`] 가 앱 대화로 묻는다 — 그쪽에서 이미 답했으면(`leaveConfirmed`) 여기서 다시 묻지 않는다.
 */
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

/**
 * 창이 사는 동안 듣는 것들을 전부 건다 — 돌려주는 정리 함수를 `onMount` 가 그대로 쓴다.
 *
 * 모든 구독이 `.catch(() => () => {})` 로 실패를 삼킨다: 리스너 하나를 못 걸었다고 앱이
 * 뜨지 않을 이유가 없고, 정리 시점에도 같은 모양(빈 함수)이라 분기가 생기지 않는다.
 */
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
      // 창 이관이면 실은 초안이 낡지 않았는지 먼저 — 낡았으면 받는 창이 꺼내지 않는다(원본 그대로)
      if (!holdTearSource(action.token)) return false;
      const ok = await pauseWorkspaceSave();
      if (!ok) thawTearSource(action.token);
      return ok;
    }
    if (action.kind === "resume") { thawTearSource(action.token); resumeWorkspaceSave(); return true; }
    if (action.kind === "leaveSessions") { await leaveWindowSessions(); return true; }
    if (action.kind === "release") return releaseWorkspaceTear(action.token);
    // 보조 창의 작업안 부탁(2026-10-25 — 작업안은 주 창의 채팅 독 갈래 · `app/plans.svelte.ts` 머리말)
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
  // 세션 서버에 **다시 붙었다** — 끊긴 사이 창 0개 잠금(`relock`)이거나 서버가 바뀌었으면 가림막(③-3b1 · `app/veil`).
  // DB AI 권한 사본도 다시 읽는다 — 부팅 때 서버가 아직 없었으면 빈 사본(칩 Off)이고, 바뀐 서버는 판(작업안 · 연결 테스트)이 다를 수 있다.
  const serverConnected = listen<{ replaced: boolean }>("session-server-connected", (event) => {
    void recheckVaultVeil(event.payload.replaced);
    void refreshDbAi();
  }).catch(() => () => {});
  // 가림막은 집 PC 창 전체에 하나처럼 선다 — 다른 창이 세우면 서고, 관문을 지나면 같이 걷힌다(2026-10-28 · `app/veil`).
  const veilAcross = listenVeilAcrossWindows().catch(() => () => {});
  // 트레이 메뉴(③-4) — [GUI 종료]·[모든 세션 종료] 를 창이 열려 있을 때 주 창이 받아 X 와 같은 흐름을 돈다 · [떨어진 세션]
  // 은 이미 부팅된 주 창에 이벤트로 온다(부팅 중이면 `take_tray_intent` 가 데려간다).
  const trayQuit = isMainWindow
    ? listen<{ mode: "exit" | "endSessions" | "tray" }>("tray-quit", (event) => {
        const m = event.payload?.mode;
        // `tray` — 끝내기 모달의 [트레이로 숨기기](2026-10-28 · Rust `tray::app_hide_to_tray`)
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

  // 편집 왕복의 **뒷반쪽** — 로컬 편집기에서 저장하면 백엔드가 되올리고 여기로 알린다.
  // 실패(대개 세션이 끊긴 뒤의 저장)도 반드시 보여 준다: 저장했는데 안 올라간 것을 모르면
  // 사용자는 서버가 바뀐 줄 안다 (docs/log/2026-09-02-sftp.md).
  // 둘 다 알림 센터의 지난 알림에도 남긴다 — 편집기에서 저장하는 순간 이 창을 보고 있지
  // 않으므로 토스트만으로는 놓치기 쉽다 (docs/log/2026-09-25-notification-center.md).
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

  // MCP 우편함 (docs/log/2026-09-05-mcp-stable-port.md).
  //
  // **보내는 쪽은 하나다** — 자동 재등록(`mcp-reregistered`). 백엔드가 시작 직후 등록된 URL 의
  // 포트가 어긋났는지 보고 조용히 다시 등록하는데, `claude` 를 스폰하느라 수초가 걸려 **대개
  // 이 마운트보다 늦게** 끝나지만 빠르게 끝나 이벤트를 놓칠 수도 있다. 그래서 마운트 때 한 번
  // 가져오고 이벤트가 오면 또 가져온다 — 가져가는 쪽에서 지우므로 토스트는 한 번만 뜬다.
  //
  // 한때 **검토 요청**(`mcp-notice`)이 두 번째 주인이었지만 2026-09-22 에 걷었다: 같은 말을
  // 화면 위 검토 대기 카드(`$lib/ReviewCard.svelte`)가 대기가 0 이 될 때까지 하고 있어 6초짜리
  // 토스트가 순수한 중복이었다 (docs/log/2026-09-22-review-card.md).
  void drainMcpNotice();
  const reregistered = listen<string>("mcp-reregistered", () => void drainMcpNotice()).catch(
    () => () => {},
  );

  // 다른 창에서 설정이 저장되면 이 창도 따라간다 (docs/log/2026-09-05-settings-sync.md).
  // 몸통은 `$lib/settings-sync.svelte.ts` 에 있다 — 다시 읽고 다시 입히려면 `mode`·
  // `wallpaper` 가 필요한데 그 둘이 이미 `settings` 를 부르고 있어, 설정 모듈 안에 두면
  // 순환이 된다. 이 창에 미저장 편집이 있으면 덮지 않고 설정 화면에 배너만 세운다.
  const settingsSaved = listenSettingsSaved().catch(() => () => {});

  // 다른 창에서 호스트 이름이 바뀌면 이 창의 즐겨찾기·열린 타일도 따라간다
  // (docs/log/2026-09-17-host-rename-fanout.md). 창마다 자기 목록을 들고 있어서, 안 걸면
  // 이름을 바꾼 창만 새 이름을 보인다. 파일에 사는 스니펫·레이아웃은 **그쪽 창이 이미**
  // 고쳤으므로 여기서 다시 쓰지 않는다 (두 창이 같은 파일을 서로 덮어쓴다).
  const hostRenamed = listenHostRenamed().catch(() => () => {});

  // 접속 이력 사본 — 부팅 때 읽고, Rust 가 쓸 때마다·창이 포커스를 얻을 때마다 다시 읽는다
  // (docs/log/2026-09-23-host-history.md). 떼어 낸 창도 이 길을 지나므로 둘 다 같은 값을 본다.
  const unmountHistory = mountHostHistory();
  // DB 접속 기록 사본 — 같은 모양(세션 서버가 사람 쿼리 타일의 접속 성공마다 적는다). 독 DB 칸의 "최근" 정렬이 읽는다.
  const unmountDbHistory = mountDbHistory();
  // 잠자기 방지 사본 — 부팅 · `keep-awake` 이벤트 · 포커스마다 읽는다(독 ☕ 칸 · 상태바 ☕ — `app/keep-awake`).
  const unmountKeepAwake = mountKeepAwake();
  // 프로젝트 목록 사본 — 같은 모양 (docs/log/2026-09-24-projects.md). 독·팔레트·즐겨찾기가 읽는다.
  const unmountProjects = mountProjects();

  // Claude Code 훅 신호 — 탭의 에이전트 상태 점이 추정 대신 쓰는 정확한 신호
  // (docs/log/2026-09-24-agent-hook-signals.md). 방송이라 창마다 걸고, 이 창의 타일이 아니면 버린다.
  const agentSignals = listenAgentSignals().catch(() => () => {});
  // 완료 확인 공유 — 이 창에서 사람이 본 턴 끝을 알리고, 다른 창이 본 것을 받아 표식을 거둔다(`app/agent-seen`).
  const unmountAgentSeen = mountAgentSeen();
  // 원격 Claude Code 훅 자동 설치의 알림 — 같은 방송 규칙(이 창의 타일일 때만 띄운다 · `app/remote-hooks-auto`).
  const remoteHooksAuto = listenRemoteHooksAuto().catch(() => () => {});

  // AI 권한(`delegation.toml`)이 어느 창에서든 바뀌면 이 창도 표를 다시 읽는다 — 원격 타일의 읽기 허용과
  // 머리줄 칩이 그 표 하나를 따른다 (`app/delegation.svelte.ts` 머리말).
  const delegationChanged = listenDelegationChanged().catch(() => () => {});

  // 블록을 AI 타일에 넘기는 고르기 상자의 "마지막에 씀" — 포커스된 AI 타일의 시각을 적어 둔다
  // (docs/log/2026-09-28-ask-ai-block.md).
  const unwatchAiFocus = watchAiFocus();
  // 문서 코드 블록 [터미널에 넣기] 상자의 "마지막에 씀" — 포커스된 셸 타일의 시각(같은 결 — `app/code-to-term.svelte.ts`).
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

// ---------------------------------------------------------------------------
// `$effect` 들의 몸통 (효과는 `+page.svelte` 가 건다)
// ---------------------------------------------------------------------------

/**
 * 이 창이 **한 번이라도** 탭을 가진 적이 있는가 — 부팅 중의 "0개" 와 사용자가 다
 * 비운 "0개" 를 가르는 표시다. `$state` 가 아니다 (렌더가 읽지 않는다).
 */
let hadTab = false;

/**
 * 마지막 탭이 사라지면 창도 닫는다 — **분리 창만**.
 *
 * "사라진다" 는 두 경우다: 사용자가 닫았거나, **다른 창으로 넘어갔거나**(병합·재분리).
 * 둘 다 이 창에 남을 것이 없다. 메인 창은 그때 시작 화면을 그리며 남는다 — 앱의 본체라
 * 사라지면 안 되고, 거기서 무엇이든 다시 열 수 있다.
 *
 * 판정을 "탭 0개" 하나로 두지 않는 이유는 분리 창이 **탭 0개로 태어나기** 때문이다 —
 * 그러면 짐을 받기도 전에 스스로 닫힌다. 그래서 한 번 차야 켜진다. 짐을 못 받고 빈 채로 뜬
 * 창(사서함 만료 등)도 그대로 열려 있다: 빈 화면 안내가 보여야 사용자가 상황을 알고,
 * 거기서 무언가를 열면 그때부터 이 규칙이 붙는다.
 */
export function closeWhenEmptied(): void {
  // 원격 창은 브라우저 탭이다 — 비어도 스스로 닫지 않는다(주 창처럼 빈 화면으로 남는다).
  if (isMainWindow || isRemote) return;
  if (residentWindowTabs().length > 0) hadTab = true;
  else if (hadTab) closeThisWindow();
}

/**
 * 앱 모드가 바뀌면 **동적 색을 다시 뽑는다** (docs/log/2026-09-04-light-theme.md).
 *
 * 크롬 팔레트(theme.css)와 터미널 프리셋은 `mode.svelte.ts` 가 그 자리에서 갈아 끼우지만,
 * 월페이퍼에서 뽑은 팔레트만은 **사진을 다시 읽어야** 새 밝기가 나온다 — 그 일은 캔버스
 * 디코딩이라 비동기고, 이 창의 코디네이터가 붙잡는 편이 맞다.
 *
 * `lastMode` 로 **실제로 달라졌을 때만** 도는 이유는 이 효과가 마운트에서도 한 번 돌기
 * 때문이다. 시작할 때는 이미 저장된 팔레트가 걸려 있어 사진을 다시 디코딩할 이유가 없다.
 *
 * `appMode.settled` 를 먼저 보는 것이 그 방어의 나머지 반쪽이다. 모드는 설정 파일에서
 * 오므로 마운트 시점에는 아직 기본값(시스템 — OS 밝기)이고, 그 값을 첫 기준으로 잡아 두면 곧이어
 * 도착하는 저장된 "라이트" 가 사용자의 모드 변경처럼 보인다 — 켤 때마다 사진을 한 번씩 다시
 * 디코딩하게 된다. 읽어 온 뒤부터 세면 그 오인이 없다.
 *
 * 룬이 아닌 **평범한 `let`** 이다 — 효과 안에서 읽고 쓰는 값이라 `$state` 로 두면 자기
 * 쓰기가 자기를 다시 깨우는 고리가 된다.
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
 * **은은하게**의 소스색을 배경·단계에 맞춘다 (docs/log/2026-09-25-wallpaper-tint.md).
 *
 * 전체 모드와 달리 결과를 파일에 적지 않으므로, 배경 URL 이 바뀌는 모든 길(부팅 ·
 * 창 사이 전파의 `refreshWallpaper` · 고르기/지우기)과 단계가 바뀌는 길(설정 select ·
 * 프로필 적용 · 색을 직접 고쳐 전체가 내려감)을 **이 효과 하나**가 받는다 — 길마다 부르는
 * 줄을 심으면 하나를 빠뜨리는 순간 틴트가 지난 사진의 색으로 남는다.
 *
 * 추적하는 것은 두 값뿐이다 — 나머지는 `untrack` 안이다. 소스색을 들이면 `applySettings` 가
 * 설정 전체를 읽는데, 그 읽기가 이 효과의 의존으로 잡히면 슬라이더 한 칸에도 다시 돈다.
 */
export function syncWallpaperTintNow(): void {
  const src = wallpaper.src;
  const mode = settings.dynamicMode;
  untrack(() => void syncWallpaperTint(src, mode));
}

// ---------------------------------------------------------------------------
// 투명도 — `settings.opacity` → `--chrome-pct` 를 인라인하면 theme.css 가 `--bg`/`--bg-panel` ·
// 글래스 판 진하기를 이 값으로 합성한다. **언제나** 건다. 낮출수록 앱 배경(월페이퍼 · 없으면 번짐)이
// 크롬 · 타일에 비친다 — 창 자체는 늘 불투명이다(10-22, theme.css 의 `html`).
// ---------------------------------------------------------------------------

export function applyChromeOpacity(): void {
  const pct = settings.opacity;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--chrome-pct", `${pct}%`);
  }
}

/**
 * 터미널 칸의 투명도 — 위 (1)과 **같은 배관, 다른 칸**이다 (`[terminal] opacity`).
 * 타일의 배경판(`.pane-box`)이 이 값으로 합성되고, xterm 캔버스 자신의 배경은
 * `Terminal.svelte` 가 팔레트를 다시 걸며 맞춘다 — 두 층이 같은 % 를 봐야 한 겹만 보인다.
 * 0~1 로 넣는 이유는 `color-mix` 안에서 `calc(var(…) * 100%)` 로 쓰기 때문이다.
 */
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
    // 앱 확인 상자(10-16) — 주 창에 뜬다: 주 창의 X 는 보이는 창이고, 트레이 종료는 Rust 가 주 창을 먼저 띄운다(`tray.rs` `open_main`).
    return choiceFromDialog(await askChoice(body, {
      title: t("app.unsaved.title"), kind: "warning",
      yesLabel: labels.save, noLabel: labels.discard, cancelLabel: t("app.unsaved.cancel"),
    }), labels);
  } catch { showNotice(t("app.unsaved.noDialog")); return "cancel"; }
}
