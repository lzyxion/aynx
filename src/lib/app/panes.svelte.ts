import { invoke } from "../ipc";
import { showNotice } from "$lib/app/notice";
import { noticeNoAiCli } from "$lib/app/ai-none-notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import {
  effectiveDefaultShellId,
  borrowsSession,
  planDocOpen,
  findPane,
  listAiClis,
  listShells,
  newAiPane,
  newDocPane,
  newLocalFsPane,
  newLocalPane,
  newSftpPane,
  offeredAiClis,
  type AiCli,
  type DocMode,
  type DocEditView,
  type FileUiPatch,
  type FileView,
  DEFAULT_FILE_ZOOM,
  type PaneSpec,
  type ShellInfo,
  type ShellList,
  type TabSpec,
} from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { rememberFileUi, rememberFileView, withLastFileUi } from "$lib/app/file-ui-last.svelte.js";
import { reportOscTitle } from "$lib/app/titles.svelte.js";
import { paneCwd, wslCwdToWindows } from "$lib/shell-integration";
import { startDirFor } from "$lib/start-dir";
import { localBackend, remoteBackend } from "$lib/fs-backend";
import { joinHome } from "$lib/path-links";
import { resolveDocLink } from "$lib/doc-links";
import { DOC_SPLIT_DEFAULT, clampDocSplit } from "$lib/doc-edit-preview";
import { DOC_ZOOM_DEFAULT, clampDocZoom } from "$lib/doc-zoom";
import { isTextLike } from "$lib/doc-lang";
import { setDocAnchor, setDocLine } from "$lib/app/doc-anchors.svelte.js";
import { isDocDirty } from "$lib/app/doc-dirty.svelte.js";
import {
  activeTab,
  adoptPane,
  focusPane,
  openInNewTab,
  openPaneBeside,
  replaceTile,
  openPaneHere,
  paneOf,
  placeAuto,
  queueRemoteFileUi,
  selectTab,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";

/**
 * **타일 한 칸을 여는 길들** — 셸 · AI · 설정 · 로컬 파일 · 원격 파일(SFTP).
 *
 * 다섯 종류가 한 파일에 있는 이유는 규칙이 **하나**뿐이기 때문이다: **언제나 새로 연다.**
 * 상태바 `>_` 메뉴("이 탭에 열기")의 항목들·셸·로컬 파일의 단축키(`open-localfs`)·상태바·팔레트
 * 모두 그렇다. (2026-09-25 — 전에는 `open-localfs` 만 "있으면 포커스, 없으면 연다" 였다.
 * 사용자 결정: 여는 길마다 결과가 다르면 헷갈린다 — "언제나 새로 열기로 통일감있게".
 * docs/log/2026-09-25-localfs-always-new.md)
 *
 * **설정은 이 규칙 밖이다** — `Ctrl+,` 는 타일이 아니라 **떠 있는 층**을 토글한다
 * (`app/dock.svelte.ts`). 설정 모달을 타일로 고정하는 진입점은 제거했다
 * (docs/log/2026-10-02-settings-modal.md).
 *
 * **터미널 옆에 여는 파일 브라우저만 어느 쪽도 아니다** ([`openFilesFor`]) — "어느 터미널의
 * 것인가" 가 정체성의 일부라, web-01 의 브라우저가 열려 있다고 db-01 의 요청을 거기로 보낼
 * 수 없다. 로컬 셸의 "현재 폴더 열기" 도 같은 이유로 같은 길을 탄다.
 */

// ---------------------------------------------------------------------------
// 로컬 셸
// ---------------------------------------------------------------------------

/**
 * 독 실행 단추의 셸 ▾ 목록(`DockLaunch.svelte` — 옛 상태바 `>_` 메뉴)과 launcher 의 셸 줄 — **지금 탭에** 로컬 셸 타일을 하나 연다.
 * `shell` 이 없으면(감지가 비어 줄이 셸을 못 가리킨다) 백엔드 폴백(pwsh → powershell)이다.
 * 시작 폴더는 [`startDirHere`] (docs/log/2026-09-27-new-terminal-cwd.md).
 */
export async function addLocal(shell?: ShellInfo): Promise<void> {
  const here = focusHere();
  openPaneHere(withCwd(newLocalPane(shell?.id), await startDirHere("shell", here)));
}

/**
 * 여는 순간의 **지금 탭과 포커스된 타일** — 시작 폴더의 대상이다. 여는 길마다 `await` 이 끼므로(셸 감지 ·
 * `local_cwd` 왕복) 그 앞에서 스냅샷한다: 뒤에 읽으면 그 사이 포커스가 옮겨 갔을 수 있다.
 */
export interface FocusSnapshot {
  tab: TabSpec | null;
  focused: PaneSpec | null;
}
export function focusHere(): FocusSnapshot {
  const tab = activeTab();
  return { tab, focused: tab ? findPane(tab.root, paneOf(tab)) : null };
}

/** 갓 만든 명세에 시작 폴더를 싣는다(없으면 키도 두지 않는다 — 홈) */
function withCwd(pane: PaneSpec, cwd: string | undefined): PaneSpec {
  return cwd ? { ...pane, cwd } : pane;
}

/**
 * **새로 여는 셸·AI 타일이 뜰 폴더** — 규칙은 순수 층의 [`startDirFor`] 하나다(포커스된 타일의 폴더 →
 * 프로젝트 탭의 폴더 → 셸은 홈 · AI 는 설정 `[ai] start_dir`). 여기서는 느린 부분만 푼다: 포커스된 로컬
 * 셸의 지금 폴더([`resolveLocalCwd`] — OSC 7 → `local_cwd` → 모름).
 *
 * 실패는 전부 조용하다 — 폴더 하나 덜 맞는 것과 타일이 안 열리는 것은 무게가 다르다
 * ([`resolveLocalCwd`] 가 오류를 삼키고, 없는 폴더는 백엔드가 홈으로 떨어뜨린다).
 */
async function startDirHere(purpose: "shell" | "ai", at: FocusSnapshot): Promise<string | undefined> {
  const focusedCwd = at.focused?.kind === "local" ? await resolveLocalCwd(at.focused) : undefined;
  return startDirFor({
    focused: at.focused,
    focusedCwd,
    tab: at.tab,
    purpose,
    aiStartDir: settings.aiStartDir,
  });
}

/**
 * 이 기기의 셸 목록 + OS 초기 기본 — **한 번만 묻고 캐시한다**.
 *
 * `listShells()` 는 값싸지 않다: WSL 배포판을 훑고 pwsh 존재 여부를 프로세스 하나를 띄워
 * 확인한다. 부팅 때 미리 부르지 않는 이유가 그것이고(앱 시작이 그만큼 늦어진다),
 * `new-shell` 을 누를 때마다 다시 묻지 않는 이유도 같다. 셸이 설치되거나 지워지는 일은 앱이
 * 떠 있는 동안 거의 없고, 있어도 앱을 다시 켜면 반영된다.
 */
let knownShells: Promise<ShellList> | null = null;
export function knownShellList(): Promise<ShellList> {
  knownShells ??= listShells();
  return knownShells;
}

/**
 * 설치된 AI CLI 감지 — **창마다 한 번만** 묻는다. 셸 목록([`knownShellList`])과 같은 이유다: 감지는
 * 프로세스를 띄워 알아내는 값이라 느리고, 앱이 떠 있는 동안 거의 변하지 않는다. 상태바 `>_` 메뉴와
 * 프로젝트 시작 화면이 같은 캐시를 쓴다(2026-09-26 — 전에는 옛 `ShellMenu` 의 모듈 변수였다 · 지금은 독 실행 단추 `DockLaunch` 도 같은 캐시).
 */
let knownAis: Promise<AiCli[]> | null = null;
/** 마지막 감지 값 — 독 · 설정이 같이 그린다(한쪽에서 다시 본 값이 다른 쪽에도 곧장 보인다) · 아직 없으면 `null` */
let aiClisNow = $state<AiCli[] | null>(null);
let aiCliSeq = 0;
function detectAiClis(): Promise<AiCli[]> {
  const seq = ++aiCliSeq;
  knownAis = listAiClis();
  void knownAis.then((list) => {
    if (seq === aiCliSeq) aiClisNow = list; // 늦게 온 옛 감지가 새 값을 덮지 않게
  });
  return knownAis;
}
export function knownAiClis(): Promise<AiCli[]> {
  return knownAis ?? detectAiClis();
}

/** 캐시를 버리고 다시 감지한다 — 앱을 켜 둔 채 CLI 를 깔거나 지운 뒤(2026-11-03). 다음 `knownAiClis` 도 이 값 */
export function refreshKnownAiClis(): Promise<AiCli[]> {
  return detectAiClis();
}

/** 지금 아는 감지 값(반응형) — 감지를 시작하지는 않는다 */
export function detectedAiClis(): AiCli[] | null {
  return aiClisNow;
}

/**
 * `new-shell` 단축키·팔레트·상태바·시작 화면 — **지금의 기본 셸**을 이 탭에 연다.
 *
 * 판정은 `>_` 메뉴·launcher·설정 화면과 **같은 규칙 하나**다 ([`effectiveDefaultShellId`]): 설정의
 * `[shell] default` 가 이 기기에 있으면 그것, 아니면 OS 초기값(Rust `os_default_shell_id`).
 * 그래서 아무것도 고르지 않은 새 기기에서도 **구체적인 셸**(Windows 는 PowerShell 7)이 열리고
 * 타일 이름에 그 이름이 뜬다.
 *
 * 저장된 id 가 지금 기기에 없어도(지운 WSL 배포판·다른 PC 에서 가져온 설정) **설정값은
 * 건드리지 않는다** — 그 배포판을 다시 깔면 아무것도 안 해도 원래 셸로 돌아온다.
 * 감지 자체가 실패했으면 id 없이 열어 백엔드 폴백에 맡긴다 (단축키가 죽지 않는 그물).
 */
export async function openDefaultShell(): Promise<void> {
  const here = focusHere();
  const shell = (await defaultShellId()) ?? undefined;
  openPaneHere(withCwd(newLocalPane(shell), await startDirHere("shell", here)));
}

// ---------------------------------------------------------------------------
// **새 탭에 열기** — 폰의 "새 탭에 열기" 시트(원격 웹 R5 · 10-20 · `mobile/MobileSheet`). 폰은 타일 하나만 그려서 분할로 끼우면 새
// 타일이 보이지 않는다 — 그래서 언제나 **그것 하나뿐인 새 탭**이다. 명세 · 시작 폴더 규칙은 "이 탭에" 길과 같다(포커스된 타일이
// 없으니 셸은 홈 · AI 는 `[ai] start_dir`). 원격 창에서는 `openInNewTab` 이 집 PC 에 새 탭 요청을 보낸다(R3 의 그 길).
// ---------------------------------------------------------------------------

const NO_FOCUS: FocusSnapshot = { tab: null, focused: null };

/** 셸 하나만 든 새 탭 — `shell` 이 없으면 백엔드 폴백 */
export async function openShellInNewTab(shell?: string): Promise<void> {
  openInNewTab(withCwd(newLocalPane(shell), await startDirHere("shell", NO_FOCUS)));
}

/** AI CLI 하나만 든 새 탭 — 연 뒤 설치 여부만 안내([`openAiPaneHere`] 와 같은 규칙) */
export async function openAiInNewTab(cli: { command: string; id: string }): Promise<void> {
  noteShellMenuAi(cli.id);
  openInNewTab(newAiPane(cli.command, await startDirHere("ai", NO_FOCUS)));
  await ensureAiCliReady(cli);
}

/** 로컬 파일 타일 하나만 든 새 탭 */
export function openLocalFsInNewTab(): void {
  openInNewTab(withLastFileUi(newLocalFsPane()));
}

/** [`openDefaultShell`]·[`openAutorunPaneHere`] 의 공통 판정 — 지금의 기본 셸 id */
export async function defaultShellId(): Promise<string | null> {
  const { shells, default_id } = await knownShellList();
  return effectiveDefaultShellId(shells, settings.defaultShell, default_id);
}

/**
 * **명령 한 줄을 자동 실행하는 로컬 타일**을 지금 탭에 연다 — 돌려주는 것은 그 타일의 id.
 *
 * 쓰는 자리는 "앱이 대신 칠 수 없는 명령" 이다. 지금은 하나뿐이다 — `ssh-add`
 * (docs/log/2026-09-17-keygen.md). 그 명령은 **암호구를 터미널에서 묻는다**: 앱이 받아
 * 넘기는 길을 만들면 이 앱이 지켜 온 선(개인키·암호구가 우리 프로세스를 지나지 않는다)이
 * 그 자리에서 깨진다. 그래서 명령만 심고 대화는 사람과 셸 사이에 남긴다.
 *
 * [`newAiPane`] 과 달리 `injectMcpToken` 을 켜지 않는다 — AI 타일이 아니다. 셸은
 * [`openDefaultShell`] 과 **같은 규칙**으로 고른다(사용자가 정한 기본 셸).
 *
 * `title` 은 표시 전용 이름이다 (`app/titles` 의 OSC 제목 자리에 미리 적어 둔다) —
 * `PaneSpec` 에 칸을 새로 만들지 않는 이유는, 이 이름이 **지속되면 안 되는 값**이기
 * 때문이다. 셸이 자기 제목을 올리면 그때부터는 그쪽이 맞다.
 */
export async function openAutorunPaneHere(command: string, title?: string): Promise<string> {
  const here = focusHere();
  const shell = await defaultShellId();
  const cwd = await startDirHere("shell", here);
  // 갓 만든 명세라 여기서 한 칸 더 적는 것이 안전하다 (아직 아무도 보지 않았다).
  const pane: PaneSpec = { ...withCwd(newLocalPane(shell ?? undefined), cwd), autorun: command };
  openPaneHere(pane);
  if (title) reportOscTitle(pane.id, title);
  return pane.id;
}

// ---------------------------------------------------------------------------
// AI 패널 (6단계 — docs/log/2026-09-02-mcp-frontend.md)
// ---------------------------------------------------------------------------

/**
 * 이 패널의 쓸모가 애초에 "옆에 띄워 두고 다른 타일의 맥락을 읽게 하는 것" 이라 **지금
 * 탭의 타일**로 연다 (혼자 떨어진 탭에 있으면 뜻이 반쯤 사라진다).
 *
 * `cli` 는 열 AI CLI(독 실행 단추 · 키바인딩 `ai-panel` 의 고르기 상자가 고른 것). 생략하면 **설치된 첫 AI CLI**,
 * 그것도 없으면 claude 로 떨어진다 — 그래야 아무것도 설치 안 된 기기에서도 타일이 뜨고
 * 아래 안내가 "설치·로그인 필요" 를 말해 준다.
 *
 * 연 뒤에 CLI 설치 여부만 확인한다. MCP는 autorun이 다음 실행 설정에 싣고,
 * 토큰은 타일의 `injectMcpToken`이 세션 열 때 Rust로 전달한다.
 *
 * **셸은 프로젝트 폴더에서 띄운다** ([`startDirHere`] — 새 셸과 같은 규칙) — 홈에서 뜬 Claude Code 는
 * 폴더 안전 확인만 반복하고 맥락이 없다.
 */
export async function openAiPaneHere(
  cli?: { command: string; id: string },
  at?: FocusSnapshot,
): Promise<void> {
  // 시작 폴더의 대상은 **지금 포커스된 타일**이다 — 아래 await 뒤에 읽으면 그 사이 포커스가
  // 옮겨 갔을 수 있으므로 여기서 스냅샷하고, 느린 부분(`local_cwd` 왕복)만 기다린다. 고르기 상자
  // (`app/ai-launch`)처럼 여는 순간이 앞선 길은 그때 찍어 둔 스냅샷(`at`)을 넘긴다.
  const here = at ?? focusHere();

  // 키바인딩 기본값 — 설치된 첫 AI CLI(감지 실패면 claude). 설정에서 끈 에이전트는 건너뛴다(`offeredAiClis` 한 규칙) —
  // 하나도 안 깔렸거나 모두 껐으면 타일을 열지 않고 한 줄로 알린다(`noticeNoAiCli` — 2026-11-03).
  let chosen = cli;
  if (!chosen) {
    const detected = await listAiClis();
    const first = offeredAiClis(detected, settings.disabledAgents)[0];
    if (!first) {
      noticeNoAiCli(detected); // 안 깔림 → 설치 안내 · 모두 끔 → 예전 한 줄
      return;
    }
    chosen = { command: first.command, id: first.id };
  }

  const cwd = await startDirHere("ai", here);
  // 자리를 잡는 것은 **답을 받은 뒤**다. `openPaneHere` 는 그때의 활성 탭을 다시 읽으므로
  // (`currentTab`) 그 사이 탭이 닫혔어도 낡은 탭 객체에 타일을 끼워 넣지 않는다 —
  // 로컬 파일 타일이 [`place`] 에서 하는 재확인과 같은 뜻이다.
  openPaneHere(newAiPane(chosen.command, cwd));
  await ensureAiCliReady(chosen);
}

/** 타일은 바로 열고 CLI 설치 실패만 안내한다. MCP 전역 등록은 만들지 않는다. */
async function ensureAiCliReady(chosen: { command: string; id: string }): Promise<void> {
  try {
    const cli = (await listAiClis()).find((c) => c.id === chosen.id);
    if (!cli?.installed) {
      showNotice(t("app.ai.notInstalled", { name: cli?.name ?? chosen.command, command: chosen.command }));
    }
  } catch {
    /* 확인 실패는 패널을 막지 않는다 */
  }
}

/**
 * **그 타일 오른쪽에** AI 타일을 연다 — 블록을 AI 타일에 넘기는 길의 "옆에 새로 열어 넘기기"
 * (docs/log/2026-09-28-ask-ai-block.md). [`openAiPaneHere`] 와 같은 명세·같은 시작 폴더 규칙인데 자리만
 * 사람이 가리킨 셸 타일 옆(좌우 분할)이다. 돌려주는 것은 새 타일의 id — 탭이나 타일이 사라졌으면 `null`.
 */
export async function openAiPaneBeside(
  tabId: string,
  paneId: string,
  cli: { command: string; id: string },
): Promise<string | null> {
  const tab = residentWindowTabs().find((x) => x.id === tabId) ?? null;
  const cwd = await startDirHere("ai", { tab, focused: tab ? findPane(tab.root, paneId) : null });
  const pane = newAiPane(cli.command, cwd);
  if (!openPaneBeside(tabId, paneId, pane, "row")) return null;
  void ensureAiCliReady(cli);
  return pane.id;
}

/**
 * **그 타일 오른쪽에** 이 창의 기본 셸 타일을 연다 — 문서 코드 블록 [터미널에 넣기]의 "새 터미널 열기"(`app/code-to-term`).
 * [`openDefaultShell`] 과 같은 셸 · 같은 시작 폴더 규칙인데 자리만 사람이 누른 타일 옆(좌우 분할)이다([`openAiPaneBeside`] 와 같은 결).
 * 돌려주는 것은 새 타일의 id — 탭이나 타일이 사라졌으면 `null`.
 */
export async function openShellPaneBeside(tabId: string, paneId: string): Promise<string | null> {
  const tab = residentWindowTabs().find((x) => x.id === tabId) ?? null;
  const shell = (await defaultShellId()) ?? undefined;
  const cwd = await startDirHere("shell", { tab, focused: tab ? findPane(tab.root, paneId) : null });
  const pane = withCwd(newLocalPane(shell), cwd);
  if (!openPaneBeside(tabId, paneId, pane, "row")) return null;
  return pane.id;
}

/**
 * 상태바 `>_` 메뉴에서 **마지막에 연 AI CLI** — 블록 넘기기의 "새로 열기" 줄이 이것을 기본으로 올린다.
 * 창·재시작을 건너 남는 **보는 사람의 편의**라 `localStorage` 다(없거나 막혀 있으면 모른다 = Claude Code).
 */
const LAST_SHELL_MENU_AI_KEY = "aynx.shellmenu.lastAi";
let lastShellMenuAiId: string | null = null;

export function noteShellMenuAi(id: string): void {
  lastShellMenuAiId = id;
  try {
    localStorage.setItem(LAST_SHELL_MENU_AI_KEY, id);
  } catch {
    /* 저장이 막힌 창 — 이번 실행 동안만 기억한다 */
  }
}

export function lastShellMenuAi(): string | null {
  if (lastShellMenuAiId !== null) return lastShellMenuAiId;
  try {
    return localStorage.getItem(LAST_SHELL_MENU_AI_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 설정 · 로컬 파일 — 둘 다 **탭 안의 평범한 타일**이다 (docs/log/2026-09-03-local-fs-tile.md).
// 설정은 이제 독의 "고정" 형태이기도 하다 (docs/log/2026-09-08-settings-dock.md).
// ---------------------------------------------------------------------------

/**
 * 로컬 파일 타일을 지금 탭에 **언제나 새로** 연다 — `open-localfs` 단축키 ·
 * 상태바 칸 · 팔레트가 모두 이 하나를 탄다 (2026-09-25 통일 — 이전의 "있으면 포커스" 는 없앴다).
 */
export function openLocalFsPaneHere(): void {
  openPaneHere(withLastFileUi(newLocalFsPane()));
}

/**
 * 파일 브라우저가 폴더를 옮겼다 — 그 자리를 **패널 명세에 적는다**
 * (로컬 타일의 `onlocalcwd` 와 SFTP 타일의 [`noteSftpDir`] 이 함께 쓴다).
 *
 * `sftpDirs` 같은 곁 표를 두지 않는 이유는 이 값의 쓰임이 다르기 때문이다: 드롭 목적지가
 * 아니라 **배치 파일에 저장될 값**이라 (`SavedLeaf.path`) 패널 자신이 들고 있어야 자동
 * 저장·창 이관·복제가 전부 공짜로 따라온다.
 *
 * 같은 값이면 쓰지 않는다 — 새로고침마다 대입하면 저장 디바운스가 헛되이 돈다.
 */
export function noteLocalFsDir(paneId: string, dir: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    // 합성 루트("내 PC")는 키 자체를 지운다 — "정해진 자리가 없다 = 홈" 규칙 하나로
    // 저장·복원이 끝난다 (`tabs.ts` 의 `SavedLeaf.path`).
    if (dir === "") {
      if (pane.path !== undefined) delete pane.path;
    } else if (pane.path !== dir) {
      pane.path = dir;
    }
    return;
  }
}

/**
 * 파일 타일의 명세에 **보기 값을 적는다** — 적기만 한다(기록 · 요청 없음). 사람의 변경은 [`noteFileView`] · [`noteFileUi`] 가, 원격 창의 요청은 집 PC 주 창이
 * (`app/mirror-requests`) 부른다 — 그래서 원격의 고름이 집 PC 의 마지막 값(`app/file-ui-last` — 기기별)을 바꾸지 않는다. 파일 타일이 아니거나 없으면 `false`.
 *
 * **기본값이면 칸을 지운다** — 크기 `1` · 장소 패널 켬 · 미리 보기 끔 · 숨김 끔은 따로 적을 뜻이 없다. 보기(`view`)는 설정의 기본과 같아도 적는다.
 */
export function applyFileUiChange(paneId: string, change: { view?: FileView } & FileUiPatch): boolean {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "localfs" && pane.kind !== "sftp") return false;
    if (change.view !== undefined && pane.fileView !== change.view) pane.fileView = change.view;
    if (change.zoom !== undefined) {
      if (change.zoom === DEFAULT_FILE_ZOOM) delete pane.fileZoom;
      else if (pane.fileZoom !== change.zoom) pane.fileZoom = change.zoom;
    }
    if (change.places !== undefined) {
      if (change.places) delete pane.filePlaces;
      else if (pane.filePlaces !== false) pane.filePlaces = false;
    }
    if (change.preview !== undefined) {
      if (!change.preview) delete pane.filePreview;
      else if (pane.filePreview !== true) pane.filePreview = true;
    }
    if (change.hidden !== undefined) {
      if (!change.hidden) delete pane.fileHidden;
      else if (pane.fileHidden !== true) pane.fileHidden = true;
    }
    return true;
  }
  return false;
}

/**
 * 파일 타일의 **보기 곁 상태**를 바꿨다 — 아이콘 크기 단계 · 장소 패널 · 미리 보기 · 숨김 (docs/log/2026-10-07-file-tile-dolphin.md).
 * [`noteFileView`] 와 같은 규칙(패널 자신이 들고 있어야 저장·이관·복제가 따라온다). 원격 창이면 집 PC 배치에도 적게 요청한다(`queueRemoteFileUi`).
 */
export function noteFileUi(paneId: string, patch: FileUiPatch): void {
  if (!applyFileUiChange(paneId, patch)) return;
  rememberFileUi(patch); // 사람의 변경이다(부르는 곳은 타일의 툴바 · 키 · 슬라이더) — 다음 새 타일이 물려받는다
  queueRemoteFileUi(paneId, patch);
}

/**
 * 파일 타일의 **보기를 바꿨다**(툴바 단추) — 패널 명세에 적는다 (docs/log/2026-09-25-file-tree-view.md).
 *
 * [`noteLocalFsDir`] 과 **같은 규칙**이다: 곁 표가 아니라 패널 자신이 들고 있어야 자동 저장
 * (`SavedLeaf.fileView`)·창 이관·복제가 공짜로 따라온다. 설정의 기본 보기와 같은 값이어도 **적는다** —
 * 사람이 이 타일에서 고른 것이라, 나중에 기본을 바꿔도 이 타일은 고른 그대로 남아야 한다.
 */
export function noteFileView(paneId: string, view: FileView): void {
  if (!applyFileUiChange(paneId, { view })) return;
  rememberFileView(view); // 다음 새 타일이 물려받는다(복원 · 이관 · 복제는 그 타일 값 그대로)
  queueRemoteFileUi(paneId, { view });
}

/**
 * 터미널이 **tmux 세션에 붙었다** — 그 이름을 패널 명세에 적는다
 * (docs/log/2026-09-16-tmux-toggle.md).
 *
 * [`noteLocalFsDir`] 과 **같은 규칙**이다: 곁 표가 아니라 패널 자신이 들고 있어야 자동
 * 저장(`SavedLeaf.tmux`)·창 이관이 공짜로 따라온다. 이 값이 살아남아야 다음 접속이
 * **같은 tmux 세션으로 돌아간다**(백엔드에 힌트로 되돌아간다 — `-A -D`).
 *
 * 같은 값이면 쓰지 않는다 (재접속은 보낸 값과 같은 값을 되돌려 준다 — 저장 디바운스가
 * 헛되이 돌지 않게).
 */
export function noteTmuxSession(paneId: string, name: string): void {
  if (name === "") return;
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.tmux !== name) pane.tmux = name;
    return;
  }
}

// ---------------------------------------------------------------------------
// SFTP 브라우저 타일 (docs/log/2026-09-03-sftp-browser-tile.md)
// ---------------------------------------------------------------------------

/**
 * SFTP 타일 id → 그 브라우저가 지금 보고 있는 원격 폴더.
 *
 * 브라우저의 내부 상태를 여기 한 벌 더 두는 이유는 **파일 드롭** 때문이다. 드롭은
 * `PaneHost` 의 드래그 기계장치를 지나 `dropFiles` 로 들어오는데, 그 길에는 브라우저의 cwd
 * 가 실려 있지 않다. 타일이 폴더를 옮길 때마다 보고하게 해서 드롭이 그 값을 목적지로 쓴다.
 * 타일이 닫히면 키가 남지만 무해하다 — 다음에 같은 번호를 받는 패널은 없다.
 */
const sftpDirs = $state<Record<string, string>>({});

/**
 * SFTP 타일이 폴더를 옮겼다 (`onsftpcwd`) — **두 곳에 적는다**.
 *
 * 곁 표(`sftpDirs`)는 드롭 목적지고, 패널 명세의 `path` 는 배치에 저장될 값이다
 * ([`noteLocalFsDir`] 과 같은 규칙). 타일이 열릴 때 넣어 둔 시작 폴더가
 * (`newSftpPane` 의 셋째 인자 — 원본 셸의 OSC 7) 사용자가 옮긴 뒤에도 그대로 남으면,
 * 저장된 값이 화면과 어긋난다.
 */
export function noteSftpDir(paneId: string, dir: string): void {
  sftpDirs[paneId] = dir;
  noteLocalFsDir(paneId, dir);
}

/** 그 SFTP 타일이 지금 보고 있는 폴더 (아직 못 읽었으면 빈 문자열) */
export function sftpDirOf(paneId: string): string {
  return sftpDirs[paneId] ?? "";
}

/**
 * 올릴 때마다 하나씩 오른다 — 열려 있는 SFTP 타일들이 목록을 다시 읽는 신호다.
 *
 * 업로드는 브라우저를 떠나 모달로 가므로 브라우저는 끝난 순간을 알 수 없는데, 방금 올린
 * 파일이 목록에 없으면 사용자는 업로드가 실패했다고 읽는다. 어느 타일이 그 폴더를 보고
 * 있는지 따지지 않고 **전부** 새로 읽게 두는 것은, 같은 서버를 두 타일이 다른 깊이에서
 * 보고 있을 때(흔하다) 어느 쪽이 영향을 받는지가 경로 비교만으로는 안 갈리기 때문이다 —
 * readdir 한 번은 싸고, 틀리게 안 보이는 것보다 헛되이 한 번 읽는 편이 낫다.
 */
let refreshKey = $state(0);

export function sftpRefreshKey(): number {
  return refreshKey;
}

export function bumpSftpRefresh(): void {
  refreshKey += 1;
}

/**
 * **파일 브라우저 열기** — 헤더의 📂 와 `open-sftp`(기본 `Ctrl+Shift+O`) 의 공통 몸통.
 *
 * 터미널 타일 **두 종류 모두**의 길이다. 대칭이 요점이다: SSH 타일에서 📂 는 그 세션의
 * 원격 파일(SFTP)을 열고, 로컬 타일에서 📂 는 **그 셸이 지금 있는 폴더**를 이 컴퓨터의
 * 파일 브라우저로 연다. 사용자가 배우는 것은 "터미널 옆에 그 터미널의 폴더를 연다" 하나다
 * (docs/log/2026-09-08-local-cwd-folder.md).
 *
 * 로컬 파일 타일을 여는 다른 길들(`open-localfs` · 상태바 칸 · 팔레트)처럼 **언제나 새로 연다** —
 * 다만 여기서 열리는 타일은 "어느 터미널의 것인가" 가 정체성의 일부라, 자리도 폴더도 **그
 * 터미널 옆 · 그 터미널의 폴더**다. (2026-09-25 전에는 `open-localfs` 가 "있으면 포커스" 여서
 * 이 함수가 그 규칙의 예외였다 — 지금은 모두가 "새로" 라 대비가 아니라 같은 규칙이다.)
 *
 * 세션이 아직 없어도(접속 중·연결 대기) **연다** — SFTP 브라우저가 대기 배너를 띄우고 붙는
 * 순간 이어받기 때문이다. 여기서 막으면 사용자는 접속이 끝나기를 기다렸다가 키를 다시
 * 눌러야 한다. (로컬은 세션이 없으면 폴더를 모를 뿐이라 홈으로 열린다.)
 */
export function openFilesFor(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!tab || !pane) return;
  if (pane.kind === "ssh") {
    // 원격도 **셸이 스스로 말해 준 폴더**에서 연다 (OSC 7 — 스니펫의 `__aynx_cwd`).
    // 왕복이 없다: 이미 받아 둔 값이라 그 자리에서 읽는다. 모르면(훅이 없는 서버·아직 첫
    // 프롬프트 전) `undefined` 고 브라우저가 홈에서 시작한다 — 이 기능이 생기기 전과 같다.
    //
    // **tmux 타일만 예외다** — 거기엔 OSC 7 이 아예 없으므로(셸 통합을 심지 않는다) 물어볼
    // 값이 없다. 로컬 쪽이 `local_cwd` 로 한 겹 더 묻는 것과 **같은 모양**으로, tmux 에게
    // 직접 묻는 짧은 왕복을 하나 넣는다 ([`resolveSshCwd`]).
    if (pane.tmux) {
      void resolveSshCwd(pane).then((path) =>
        place(tabId, paneId, withLastFileUi(newSftpPane(paneId, pane.alias ?? "", path))),
      );
      return;
    }
    place(tabId, pane.id, withLastFileUi(newSftpPane(pane.id, pane.alias ?? "", paneCwd(pane.id) ?? undefined)));
    return;
  }
  if (pane.kind === "local") {
    // 폴더를 알아내는 데 **왕복이 하나 낄 수 있다** (`local_cwd`). 그래서 타일을 여는 것은
    // 그 답을 받은 뒤이고, 그때 탭·타일이 아직 있는지 다시 확인한다 (`place` 안에서).
    void resolveLocalCwd(pane).then((path) => place(tabId, paneId, withLastFileUi(newLocalFsPane(path))));
    return;
  }
  showNotice(t("app.pane.needTerminalFocus"));
}

/** 원격 문서가 빌릴 세션의 주인 — **ssh 터미널 타일**의 id 와 그 별칭 (docs/log/2026-09-27-doc-tile.md) */
export interface DocSource {
  paneId: string;
  alias: string;
}

/**
 * **문서 보기 타일을 여는 문 하나** — 파일 타일 · 터미널의 경로 Ctrl+클릭 · 팔레트 "파일 열기…" 가 모두 이리로 온다
 * (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
 *
 * - `source` 가 있으면 원격이다 — 세션을 가진 **ssh 터미널 타일**과 그 별칭(파일 타일에서 왔으면 그 타일이 빌리던
 *   터미널이다: 브라우저를 닫아도 문서는 살아야 한다). 없으면 로컬.
 * - 새 문서는 **미리 보기**(`docPreview`)로 선다. 자리는 [`planDocOpen`] 이 정한다:
 *   같은 파일을 보는 문서 타일이 있으면 그리로 포커스(더블클릭 두 번에 같은 글이 두 칸을 차지하면 안 된다) ·
 *   없고 이 탭에 미리 보기 문서가 있으면 **그 칸을 갈아 끼운다**([`replaceTile`] — 보기(`docMode`)는 새 파일이라
 *   기본으로) · 둘 다 없으면 `nearPaneId` **옆**([`openPaneBeside`]). 파일을 서너 개 훑을 때마다 여는 자리가 반씩 쪼개져 손톱만 해지던 것을 막는다
 *   (docs/log/2026-09-27-doc-tile.md "미리 보기 타일 재사용").
 *
 * 탭이나 `nearPaneId` 가 사라졌으면 아무 일도 하지 않는다(고르는 사이 닫힌 경우). 돌려주는 값은 그 문서가 선
 * 타일의 id(포커스만 옮겼으면 그 타일) — 문서 안 링크의 `#절` 을 거기 걸려고([`openDocLink`]). 못 열었으면 `null`.
 */
export function openDoc(o: { tabId: string; nearPaneId: string; path: string; source?: DocSource }): string | null {
  const tab = residentWindowTabs().find((t) => t.id === o.tabId);
  if (!tab || o.path === "" || !findPane(tab.root, o.nearPaneId)) return null;
  const plan = planDocOpen(tab.root, o.path, o.source, isDocDirty);
  if (plan.kind === "focus") {
    focusPane(tab.id, plan.paneId);
    selectTab(tab.id);
    return plan.paneId;
  }
  const pane = newDocPane(o.path, o.source);
  pane.docPreview = true;
  // 갈아 끼우는 칸의 목차 패널은 남긴다 — 보기(`docMode`)는 파일의 것이지만, 목차는 "이 칸에서 훑어보는 방식" 이다
  // 편집 중 보기 · 나란히 비율 · 글자 크기도 같은 까닭으로 남긴다
  const old = plan.kind === "replace" ? findPane(tab.root, plan.paneId) : null;
  if (old?.docOutline === true) pane.docOutline = true;
  if (old?.docEditView) pane.docEditView = old.docEditView;
  if (old?.docSplit !== undefined) pane.docSplit = old.docSplit;
  if (old?.docZoom !== undefined) pane.docZoom = old.docZoom;
  if (plan.kind === "replace" && replaceTile(tab.id, plan.paneId, pane)) {
    selectTab(tab.id);
    return pane.id;
  }
  return openPaneBeside(tab.id, o.nearPaneId, pane) ? pane.id : null;
}

/**
 * 타일 하나가 **어디의 파일을 보는가** — 그 타일 곁에서 여는 문서의 [`DocSource`]. `undefined` = 로컬,
 * `null` = 열 곳이 없다(원본을 잃은 SFTP 타일).
 *
 * ssh 터미널은 자기 자신 · SFTP 타일은 빌리던 터미널 · 원격 문서는 그 문서가 빌리던 터미널(같은 서버의 다른 파일) ·
 * 그 밖(로컬 셸 · 로컬 파일 · 로컬 문서 · 시작 화면 …)은 로컬.
 */
export function docSourceOf(pane: PaneSpec): DocSource | undefined | null {
  if (pane.kind === "ssh") return { paneId: pane.id, alias: pane.alias ?? "" };
  if (pane.kind === "sftp" || (pane.kind === "doc" && borrowsSession(pane))) {
    return pane.sourcePaneId ? { paneId: pane.sourcePaneId, alias: pane.alias ?? "" } : null;
  }
  return undefined;
}

/**
 * 파일 타일에서 고른 파일을 문서로 — 우클릭 "미리 보기" · 텍스트 파일의 더블클릭/Enter (A3: 여는 문 [`openDoc`] 으로
 * 옮기기만 했다 · 동작은 1단계 그대로). 파일 타일 셋 중 `sftp`·`localfs` 만 이 길을 연다.
 */
export function openDocFrom(tabId: string, browserPaneId: string, path: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const browser = tab ? findPane(tab.root, browserPaneId) : null;
  if (!browser || (browser.kind !== "sftp" && browser.kind !== "localfs")) return;
  const source = docSourceOf(browser);
  if (source === null) return;
  openDoc({ tabId, nearPaneId: browserPaneId, path, source });
}

/**
 * **터미널의 경로 Ctrl+클릭** — 그 타일의 곁에 문서를 연다 (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
 *
 * 경로는 이미 풀려 온다(`path-links.ts` — 셸 폴더 기준 · WSL 옮김). `home` 갈래면 여기서 그 백엔드의 홈을 물어 잇는다.
 * 여는 것은 **파일이 확인될 때만**이다(`stat`): 터미널 글자는 무엇이든 될 수 있어서, 없는 파일 · 폴더면 토스트 한 줄로
 * 물러선다(빈 문서 타일을 세워 오류를 보이는 것보다 덜 시끄럽다). 로컬 셸은 이 컴퓨터, ssh 셸은 그 세션(SFTP)으로 본다.
 * `line`(꼬리 `:12` — 1 기준)이 있으면 연(또는 포커스만 옮긴) 타일에 한 번짜리 "이 줄로" 를 건다(`doc-anchors` — 저장되지 않는다).
 */
export async function openPathFromTerminal(
  tabId: string,
  paneId: string,
  target: { path: string } | { home: string },
  line?: number,
): Promise<void> {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane || (pane.kind !== "local" && pane.kind !== "ssh")) return;
  const remote = pane.kind === "ssh";
  const backend = remote ? remoteBackend(sessionOf(pane.id)) : localBackend();
  if (!backend.online) {
    showNotice(t("app.doc.open.offline"));
    return;
  }
  let path: string;
  try {
    path = "home" in target ? joinHome(await backend.home(), target.home) : target.path;
  } catch {
    showNotice(t("app.doc.open.missing", { path: "~/" + ("home" in target ? target.home : "") }));
    return;
  }
  try {
    const st = await backend.stat(path);
    if (st.kind === "dir" || (st.kind === "symlink" && st.linkIsDir)) {
      showNotice(t("app.doc.open.folder", { path }));
      return;
    }
  } catch {
    showNotice(t("app.doc.open.missing", { path }));
    return;
  }
  const opened = openDoc({ tabId, nearPaneId: paneId, path, source: remote ? { paneId: pane.id, alias: pane.alias ?? "" } : undefined });
  if (opened !== null && line !== undefined) setDocLine(opened, line);
}

/**
 * **문서 안의 경로 링크 Ctrl+클릭** — `[x](other.md)` · `./docs/a.md#절` · `../x.md` · `/abs/x.md`
 * (docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크").
 *
 * 경로는 그 문서의 폴더 기준으로 푼다(`resolveDocLink` — 로컬 윈도우 · 원격 POSIX). 원격 문서면 같은 터미널의 세션을
 * 빌려(`docSourceOf`) 같은 서버의 파일을 연다. 여는 것은 여는 문 [`openDoc`] 하나 — 지금 문서가 **미리 보기**면 그
 * 칸을 갈아 끼우고, **고정**이면 옆에 선다(`planDocOpen`). 이미 열린 파일(자기 자신 포함)이면 그리로 포커스만.
 * 텍스트로 보이지 않는 이름 · 없는 파일 · 폴더면 토스트 한 줄(터미널 경로와 같은 문구). `anchor` 가 있으면 그 타일에
 * 한 번짜리 앵커를 건다(`doc-anchors` — 저장되지 않는다).
 */
export async function openDocLink(tabId: string, paneId: string, link: string, anchor?: string): Promise<void> {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane || pane.kind !== "doc" || !pane.path) return;
  const source = docSourceOf(pane);
  if (source === null) {
    showNotice(t("app.doc.open.offline"));
    return;
  }
  const remote = source !== undefined;
  const path = resolveDocLink(pane.path, link, remote);
  if (path === null) {
    showNotice(t("app.doc.open.missing", { path: link }));
    return;
  }
  if (path !== pane.path) {
    if (!isTextLike(path)) {
      showNotice(t("app.doc.open.notText", { path }));
      return;
    }
    const backend = remote ? remoteBackend(sessionOf(source.paneId)) : localBackend();
    if (!backend.online) {
      showNotice(t("app.doc.open.offline"));
      return;
    }
    try {
      const st = await backend.stat(path);
      if (st.kind === "dir" || (st.kind === "symlink" && st.linkIsDir)) {
        showNotice(t("app.doc.open.folder", { path }));
        return;
      }
    } catch {
      showNotice(t("app.doc.open.missing", { path }));
      return;
    }
  }
  const opened = openDoc({ tabId, nearPaneId: paneId, path, source });
  if (opened !== null && anchor) setDocAnchor(opened, anchor);
}

/**
 * 미리 보기 문서를 **붙박이로** — 툴바의 [고정] (docs/log/2026-09-27-doc-tile.md "미리 보기 타일 재사용").
 * 표식 키를 지운다(붙박이가 기본이라 키가 없다). 다음에 여는 파일은 이 타일을 갈아 끼우지 않고 옆에 선다.
 */
export function keepDoc(paneId: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.docPreview !== undefined) delete pane.docPreview;
    return;
  }
}

/**
 * 문서를 **다시 미리 보기로** — 툴바의 [고정 해제], 그리고 [편집]이 고정했던 것을 [편집 종료]이 되돌릴 때(타일링이라
 * 편집이 끝난 문서가 칸을 계속 차지하지 않게). 탭에 미리 보기가 여럿이 될 수 있다 — 다음 파일은 그중 하나를
 * 갈아 끼운다([`planDocOpen`]). 하나만 남기려고 고정으로 두면, 다른 미리 보기를 닫은 뒤 새 파일이 옆에 선다.
 */
export function unkeepDoc(paneId: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind === "doc") pane.docPreview = true;
    return;
  }
}

/**
 * 문서 타일의 **보기를 바꿨다**([원문]/[보기]) — 패널 명세에 적는다. [`noteFileView`] 와 같은 규칙이되,
 * 기본(`rendered`)이면 **키를 지운다**: 배치 파일에 기본값이 적히지 않는다는 규칙이 저장 쪽 한 곳이 아니라
 * 명세에서부터 선다(복제·이관된 타일도 같은 모양).
 */
export function noteDocMode(paneId: string, mode: DocMode): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    // 보기를 바꾼 것은 **이 문서를 두고 한 명시적인 손길**이다 — 미리 보기였다면 붙박이가 된다(VS Code 의
    // 미리 보기 탭이 편집 한 번에 고정되는 것과 같은 뜻). 다음에 여는 파일이 이 글을 몰래 치우지 않는다.
    if (pane.docPreview !== undefined) delete pane.docPreview;
    if (mode === "rendered") {
      if (pane.docMode !== undefined) delete pane.docMode;
    } else if (pane.docMode !== mode) {
      pane.docMode = mode;
    }
    return;
  }
}

/**
 * 문서 타일의 **목차 패널을 켰다/껐다** — 패널 명세에 적는다. 끄면 키를 지운다(기본 꺼짐 — 배치 파일에 적히지 않는다).
 * [`noteDocMode`] 와 달리 **미리 보기를 고정하지 않는다** — 목차는 읽기 편의라 이 문서를 두고 한 결정이 아니다.
 */
export function noteDocOutline(paneId: string, open: boolean): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "doc") return;
    if (open) {
      if (pane.docOutline !== true) pane.docOutline = true;
    } else if (pane.docOutline !== undefined) {
      delete pane.docOutline;
    }
    return;
  }
}

/**
 * 문서 타일의 **편집 중 보기를 골랐다**(마크다운 — 원문만 · 나란히 · 미리 보기만) — 패널 명세에 적는다. 기본(나란히)이면
 * 키를 지운다. [`noteDocOutline`] 과 같이 **미리 보기를 고정하지 않는다**(편집이 이미 고정했고, [편집 종료]가 되돌린다).
 */
export function noteDocEditView(paneId: string, view: DocEditView): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "doc") return;
    if (view === "split") {
      if (pane.docEditView !== undefined) delete pane.docEditView;
    } else if (pane.docEditView !== view) {
      pane.docEditView = view;
    }
    return;
  }
}

/** 문서 타일의 **나란히 경계를 옮겼다** — 20~80% 로 묶어 적고, 기본(반반)이면 키를 지운다. 미리 보기는 그대로 */
export function noteDocSplit(paneId: string, ratio: number): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "doc") return;
    const r = clampDocSplit(ratio);
    if (r === DOC_SPLIT_DEFAULT) {
      if (pane.docSplit !== undefined) delete pane.docSplit;
    } else if (pane.docSplit !== r) {
      pane.docSplit = r;
    }
    return;
  }
}

/** 문서 타일의 **글자 크기를 바꿨다**(%) — 단계로 맞춰 적고, 기본(100)이면 키를 지운다. 미리 보기는 그대로 */
export function noteDocZoom(paneId: string, zoom: number): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "doc") return;
    const z = clampDocZoom(zoom);
    if (z === null || z === DOC_ZOOM_DEFAULT) {
      if (pane.docZoom !== undefined) delete pane.docZoom;
    } else if (pane.docZoom !== z) {
      pane.docZoom = z;
    }
    return;
  }
}

/**
 * 새 브라우저 타일을 **원본 터미널 옆에** 세우고 포커스한다 (SFTP·로컬 공통 출구).
 *
 * `openPaneHere` 를 쓰지 않고 **대상을 직접 준다** — 그쪽은 활성 패널을 대상으로 삼지만,
 * 헤더의 📂 는 활성이 아닌 타일에서도 눌릴 수 있고 그때 브라우저는 자기를 연 그 터미널
 * 옆에 서야 한다 (묶인 상대와 화면에서도 붙어 있어야 짝이 읽힌다).
 * 자리 규칙 자체는 `openPaneHere` 와 **같은 출구**를 쓴다 (`placeAuto`).
 *
 * 탭·원본 타일을 여기서 **다시 찾는다**: 로컬 쪽은 사이에 `await` 가 있어 그동안 타일이
 * 닫혔을 수 있다 (그러면 아무 일도 일어나지 않는다).
 */
function place(tabId: string, sourcePaneId: string, browser: PaneSpec): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, sourcePaneId)) return;
  placeAuto(tab, browser, sourcePaneId);
  focusPane(tab.id, browser.id);
  adoptPane(tab.id, browser.id);
  selectTab(tab.id);
}

/**
 * **tmux 타일**(간이 모드)이 지금 있는 폴더. 모르면 `undefined` — 홈에서 열린다.
 *
 * 보통 SSH 타일은 스니펫이 붙인 OSC 7 을 그 자리에서 읽지만(왕복 없음), tmux 타일에는
 * 그 스니펫이 아예 없다 (docs/log/2026-09-16-tmux-toggle.md). 대신 **tmux 에게 직접 묻는다** —
 * `tmux display -p '#{pane_current_path}'` 를 비-PTY exec 채널로 한 번. 화면(PTY)에는 아무것도
 * 찍히지 않고, 시한은 백엔드가 3초로 묶는다.
 *
 * [`resolveLocalCwd`] 의 2단계(`local_cwd`)와 **같은 자리, 같은 규칙**이다: 실패는 전부
 * 조용하고 "모름"으로 떨어진다 — 폴더 하나 덜 맞는 것과 버튼이 죽는 것은 무게가 다르다.
 */
export async function resolveSshCwd(pane: PaneSpec): Promise<string | undefined> {
  const name = pane.tmux?.trim();
  const id = sessionOf(pane.id);
  if (!name || id === null) return undefined;
  try {
    const path = (await invoke<string | null>("ssh_tmux_cwd", { id, name }))?.trim();
    return path === "" ? undefined : (path ?? undefined);
  } catch {
    return undefined;
  }
}

/**
 * 로컬 셸 타일이 **지금 있는 폴더**. 모르면 `undefined` — 브라우저의 기본값(홈)으로 열린다.
 *
 * 세 단계이고 **순서에 뜻이 있다**.
 *
 * 1. **셸이 스스로 알려 준 값** (OSC 7 · OSC 9;9 — `shell-integration.ts`). 셸이 자기
 *    상태를 말한 것이라 가장 정확하고, OS 를 가리지 않는다. **PowerShell 이 이 길로
 *    답한다** — 앱이 띄울 때 `<config_dir>/aynx/integration.ps1` 을 점 소싱해 프롬프트마다
 *    OSC 7 을 붙인다 (docs/log/2026-09-08-local-shell-hook-osc7.md). 그쪽에는 2단계가
 *    아예 통하지 않는다: `Set-Location` 은 프로세스의 cwd 를 바꾸지 않는다.
 *    **WSL(bash) 도 이 길로 답한다** — `wsl.exe` 를 `sh -c 'exec bash --rcfile …'` 로 띄워
 *    원격과 **같은 스니펫**을 읽히기 때문이다 (docs/log/2026-09-08-wsl-cwd-hook.md). 다만
 *    그 값은 배포판 안의 POSIX 경로라 [`wslCwdToWindows`] 로 옮겨야 이 컴퓨터에서 열린다.
 * 2. **OS 에게 묻는다** (`local_cwd` → `src-tauri/src/cwd.rs`). Windows 는 자식 프로세스의
 *    PEB 를 읽고, 리눅스는 `/proc/<pid>/cwd` 를, macOS 는 아직 `None` 이다. 여기서 답이
 *    나오는 것은 **cmd.exe 와 Git Bash**(둘은 `cd` 로 프로세스 cwd 를 진짜로 바꾼다),
 *    그리고 훅 파일을 못 쓴 PowerShell 의 폴백이다. **WSL 셸은 백엔드가 곧바로 `None` 을
 *    준다** — pid 는 `wsl.exe` 의 것이고 그 Windows 쪽 폴더는 배포판 안의 셸이 있는
 *    자리와 아무 상관이 없다 (bash 가 아닌 배포판·훅 실패가 여기로 떨어진다).
 * 3. 둘 다 없으면 **묻지 않는다** — 홈("내 PC")으로 여는 것이 이 기능이 없던 때와 같다.
 *
 * 실패는 전부 조용하다. 명령이 없거나(낡은 백엔드) 오류를 내도 버튼은 그대로 동작해야 한다 —
 * 폴더 하나 덜 맞는 것과 버튼이 죽는 것은 무게가 다르다.
 */
export async function resolveLocalCwd(pane: PaneSpec): Promise<string | undefined> {
  const paneId = pane.id;
  const reported = paneCwd(paneId)?.trim();
  if (reported) {
    // WSL 타일만 한 겹 더 옮긴다. 다른 셸이 준 값은 이미 윈도우 경로다 (구분자는 그대로 둔다 —
    // 백엔드가 `/` 를 받아 준다).
    const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
    if (distro && reported.startsWith("/")) return wslCwdToWindows(distro, reported) ?? undefined;
    return reported;
  }
  const id = sessionOf(paneId);
  if (id === null) return undefined;
  try {
    const path = (await invoke<string | null>("local_cwd", { id }))?.trim();
    return path === "" ? undefined : (path ?? undefined);
  } catch {
    return undefined;
  }
}

/** `open-sftp` 단축키·팔레트 — 활성 탭의 **포커스된 타일**을 대상으로 삼는다 */
export function openFilesHere(): void {
  const tab = activeTab();
  if (!tab) {
    showNotice(t("app.pane.needTerminalFocus"));
    return;
  }
  openFilesFor(tab.id, paneOf(tab));
}
