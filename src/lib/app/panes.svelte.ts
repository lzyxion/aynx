import { invoke } from "../ipc";
import { showNotice } from "$lib/app/notice";
import { noticeNoAiCli } from "$lib/app/ai-none-notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import {
  effectiveDefaultShellId,
  borrowsSession,
  isFileLeafKind,
  planDocOpen,
  planDocSwitch,
  carryDocTileView,
  findNewDocPane,
  planFileOpen,
  findPane,
  listPanes,
  listAiClis,
  listShells,
  newAiPane,
  newDocPane,
  newImagePane,
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
import { localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import { joinHome } from "$lib/path-links";
import { resolveDocLink } from "$lib/doc-links";
import { DOC_SPLIT_DEFAULT, clampDocSplit } from "$lib/doc-edit-preview";
import { DOC_ZOOM_DEFAULT, clampDocZoom } from "$lib/doc-zoom";
import { isTextLike } from "$lib/doc-lang";
import type { DocFilesSeed } from "$lib/doc-files";
import { noteDocSwap } from "$lib/doc-swap";
import { imageMime } from "$lib/browser/preview";
import { setDocAnchor, setDocLine } from "$lib/app/doc-anchors.svelte.js";
import { isDocDirty, setDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { dropDocDraft } from "$lib/app/doc-drafts.svelte.js";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import { focusPaneBody } from "$lib/pane/focus";
import { isRemote } from "$lib/app/window.svelte.js";
import {
  activeTab,
  adoptPane,
  docNameOf,
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
  unzoomFor,
} from "$lib/app/tabs.svelte.js";

/**
 * 타일 한 칸을 여는 길들 — 언제나 새로 연다(사용자 결정 — 여는 길마다 결과가 다르면 헷갈린다 · docs/log/2026-09-25-localfs-always-new.md).
 * 터미널 옆에 여는 파일 브라우저([`openFilesFor`])는 자리 · 폴더가 그 터미널의 것이다 — 다른 호스트의 브라우저로 보낼 수 없다.
 */

// ── 로컬 셸 ──

export async function addLocal(shell?: ShellInfo): Promise<void> {
  const here = focusHere();
  openPaneHere(withCwd(newLocalPane(shell?.id), await startDirHere("shell", here)));
}

/** `await` 앞에서 찍는다 — 뒤에 읽으면 그 사이 포커스가 옮겨 갔을 수 있다 */
export interface FocusSnapshot {
  tab: TabSpec | null;
  focused: PaneSpec | null;
}
export function focusHere(): FocusSnapshot {
  const tab = activeTab();
  return { tab, focused: tab ? findPane(tab.root, paneOf(tab)) : null };
}

function withCwd(pane: PaneSpec, cwd: string | undefined): PaneSpec {
  return cwd ? { ...pane, cwd } : pane;
}

/** 실패는 전부 조용하다 — 폴더 하나 덜 맞는 것과 타일이 안 열리는 것은 무게가 다르다 */
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

/** 한 번만 묻고 캐시한다 — WSL 배포판을 훑고 프로세스를 띄워 확인해 값싸지 않다(부팅 때도 미리 부르지 않는다) */
let knownShells: Promise<ShellList> | null = null;
export function knownShellList(): Promise<ShellList> {
  knownShells ??= listShells();
  return knownShells;
}

/** 창마다 한 번만 묻는다 — 셸 목록과 같은 이유 */
let knownAis: Promise<AiCli[]> | null = null;
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

/** 앱을 켜 둔 채 CLI 를 깔거나 지운 뒤 — 캐시를 버린다 */
export function refreshKnownAiClis(): Promise<AiCli[]> {
  return detectAiClis();
}

/** 감지를 시작하지는 않는다 */
export function detectedAiClis(): AiCli[] | null {
  return aiClisNow;
}

/** 저장된 id 가 이 기기에 없어도 설정값은 건드리지 않는다 — 그 셸을 다시 깔면 원래대로 돌아온다 */
export async function openDefaultShell(): Promise<void> {
  const here = focusHere();
  const shell = (await defaultShellId()) ?? undefined;
  openPaneHere(withCwd(newLocalPane(shell), await startDirHere("shell", here)));
}

// ── 새 탭에 열기 — 그것 하나뿐인 새 탭 ──

const NO_FOCUS: FocusSnapshot = { tab: null, focused: null };

export async function openShellInNewTab(shell?: string): Promise<void> {
  openInNewTab(withCwd(newLocalPane(shell), await startDirHere("shell", NO_FOCUS)));
}

/** 원격 창은 메인 PC 가 새 id 로 세운다 — 돌려준 id 는 그 창에서만 맞다 */
export async function openDefaultShellInNewTab(): Promise<string> {
  const pane = withCwd(newLocalPane((await defaultShellId()) ?? undefined), await startDirHere("shell", NO_FOCUS));
  openInNewTab(pane);
  return pane.id;
}

export async function openAiInNewTab(cli: { command: string; id: string }): Promise<void> {
  noteShellMenuAi(cli.id);
  openInNewTab(newAiPane(cli.command, await startDirHere("ai", NO_FOCUS)));
  await ensureAiCliReady(cli);
}

export function openLocalFsInNewTab(): void {
  openInNewTab(withLastFileUi(newLocalFsPane()));
}

export async function defaultShellId(): Promise<string | null> {
  const { shells, default_id } = await knownShellList();
  return effectiveDefaultShellId(shells, settings.defaultShell, default_id);
}

/**
 * 앱이 대신 칠 수 없는 명령(`ssh-add`)을 심는 로컬 타일 — 암호구는 터미널이 묻는다.
 * 앱이 받아 넘기는 길을 만들면 "개인키 · 암호구가 우리 프로세스를 지나지 않는다" 가 깨진다.
 * AI 타일이 아니라 `injectMcpToken` 을 켜지 않는다. `title` 을 `PaneSpec` 칸으로 두지 않는다 — 지속되면 안 되는 값이다.
 */
export async function openAutorunPaneHere(command: string, title?: string): Promise<string> {
  const here = focusHere();
  const shell = await defaultShellId();
  const cwd = await startDirHere("shell", here);
  const pane: PaneSpec = { ...withCwd(newLocalPane(shell ?? undefined), cwd), autorun: command };
  openPaneHere(pane);
  if (title) reportOscTitle(pane.id, title);
  return pane.id;
}

// ── AI 타일 ──

/**
 * MCP 토큰은 타일의 `injectMcpToken` 이 세션 열 때 Rust 로 넘긴다 — 전역 등록은 만들지 않는다(→ docs/invariants.md 전문 1).
 * 프로젝트 폴더에서 띄운다 — 홈에서 뜬 Claude Code 는 폴더 안전 확인만 반복하고 맥락이 없다.
 */
export async function openAiPaneHere(
  cli?: { command: string; id: string },
  at?: FocusSnapshot,
): Promise<void> {
  // 아래 await 뒤에 읽으면 그 사이 포커스가 옮겨 갔을 수 있다
  const here = at ?? focusHere();

  let chosen = cli;
  if (!chosen) {
    const detected = await listAiClis();
    const first = offeredAiClis(detected, settings.disabledAgents)[0];
    if (!first) {
      noticeNoAiCli(detected);
      return;
    }
    chosen = { command: first.command, id: first.id };
  }

  const cwd = await startDirHere("ai", here);
  // 자리는 답을 받은 뒤에 잡는다 — 그 사이 탭이 닫혔어도 낡은 탭 객체에 끼워 넣지 않게
  openPaneHere(newAiPane(chosen.command, cwd));
  await ensureAiCliReady(chosen);
}

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

export async function openShellPaneBeside(tabId: string, paneId: string): Promise<string | null> {
  const tab = residentWindowTabs().find((x) => x.id === tabId) ?? null;
  const shell = (await defaultShellId()) ?? undefined;
  const cwd = await startDirHere("shell", { tab, focused: tab ? findPane(tab.root, paneId) : null });
  const pane = withCwd(newLocalPane(shell), cwd);
  if (!openPaneBeside(tabId, paneId, pane, "row")) return null;
  return pane.id;
}

/** 마지막에 연 AI CLI — `localStorage` 편의(없거나 막혀 있으면 모른다) */
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

// ── 로컬 파일 ──

export function openLocalFsPaneHere(): void {
  openPaneHere(withLastFileUi(newLocalFsPane()));
}

/**
 * 곁 표가 아니라 패널 명세에 적는다 — 배치 파일에 저장될 값(`SavedLeaf.path`)이라 저장 · 이관 · 복제가 따라온다.
 * 같은 값이면 쓰지 않는다 — 새로고침마다 대입하면 저장 디바운스가 헛되이 돈다.
 */
export function noteLocalFsDir(paneId: string, dir: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    // 합성 루트("내 PC")는 키 자체를 지운다 — "정해진 자리가 없다 = 홈"
    if (dir === "") {
      if (pane.path !== undefined) delete pane.path;
    } else if (pane.path !== dir) {
      pane.path = dir;
    }
    return;
  }
}

/**
 * 적기만 한다(기록 · 요청 없음) — 원격 창의 요청이 이 길을 타므로 메인 PC 의 마지막 값(`app/file-ui-last`)을 바꾸지 않는다.
 * 기본값이면 칸을 지운다. 보기(`view`)는 설정의 기본과 같아도 적는다 — 기본을 바꿔도 이 타일은 고른 그대로 남아야 한다.
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

/** 사람의 변경만 이 길을 탄다 */
export function noteFileUi(paneId: string, patch: FileUiPatch): void {
  if (!applyFileUiChange(paneId, patch)) return;
  rememberFileUi(patch);
  queueRemoteFileUi(paneId, patch);
}

export function noteFileView(paneId: string, view: FileView): void {
  if (!applyFileUiChange(paneId, { view })) return;
  rememberFileView(view);
  queueRemoteFileUi(paneId, { view });
}

/** 이 값이 살아남아야 다음 접속이 같은 tmux 세션으로 돌아간다(`-A -D` 힌트) */
export function noteTmuxSession(paneId: string, name: string): void {
  if (name === "") return;
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.tmux !== name) pane.tmux = name;
    return;
  }
}

// ── SFTP 브라우저 타일 ──

/** 드롭 목적지 — 드롭 길(`dropFiles`)에는 브라우저의 cwd 가 실려 있지 않다 */
const sftpDirs = $state<Record<string, string>>({});

/** 두 곳에 적는다 — 드롭 목적지와 배치에 저장될 `path` */
export function noteSftpDir(paneId: string, dir: string): void {
  sftpDirs[paneId] = dir;
  noteLocalFsDir(paneId, dir);
}

export function sftpDirOf(paneId: string): string {
  return sftpDirs[paneId] ?? "";
}

/** 업로드 뒤 열린 SFTP 타일 전부가 다시 읽는다 — 어느 타일이 영향을 받는지는 경로 비교만으로 안 갈린다 */
let refreshKey = $state(0);

export function sftpRefreshKey(): number {
  return refreshKey;
}

export function bumpSftpRefresh(): void {
  refreshKey += 1;
}

/** 세션이 아직 없어도 연다 — SFTP 브라우저가 대기 배너를 띄우고 붙는 순간 이어받는다 */
export function openFilesFor(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!tab || !pane) return;
  if (pane.kind === "ssh") {
    // tmux 타일에는 OSC 7 이 없다(셸 통합을 심지 않는다) — tmux 에게 직접 묻는다
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
    // 왕복 뒤에 연다 — 그때 탭 · 타일이 아직 있는지 `place` 가 다시 확인한다
    void resolveLocalCwd(pane).then((path) => place(tabId, paneId, withLastFileUi(newLocalFsPane(path))));
    return;
  }
  showNotice(t("app.pane.needTerminalFocus"));
}

/** 원격 문서가 빌릴 세션의 주인 — ssh 터미널 타일 */
export interface DocSource {
  paneId: string;
  alias: string;
}

/**
 * 문서 보기 타일을 여는 문 하나. 미리 보기 문서 칸은 갈아 끼운다 — 파일을 훑을 때마다 자리가 반씩 쪼개지지 않게
 * (docs/log/2026-09-27-doc-tile.md). 파일 타일에서 왔으면 `source` 는 그 타일이 빌리던 터미널이다 — 브라우저를 닫아도 문서는 살아야 한다.
 */
export function openDoc(o: FileOpenRequest): string | null {
  const tab = fileOpenTab(o);
  if (!tab) return null;
  const plan = planDocOpen(tab.root, o.path, o.source, isDocDirty);
  if (plan.kind === "focus") return focusOpened(tab, plan.paneId);
  const pane = newDocPane(o.path, o.source);
  pane.docPreview = true;
  // 보기(`docMode`)는 파일의 것이지만 곁 패널 · 편집 보기 · 비율 · 글자 크기는 "이 칸에서 훑는 방식" 이라 남긴다
  carryDocTileView(plan.kind === "replace" ? findPane(tab.root, plan.paneId) : null, pane);
  // 갈아 끼운 칸이 최대화된 다른 타일 밑에 숨은 채로 남지 않게
  if (plan.kind === "replace") unzoomFor(tab, plan.paneId);
  if (plan.kind === "replace" && replaceTile(tab.id, plan.paneId, pane)) {
    selectTab(tab.id);
    return pane.id;
  }
  return openPaneBeside(tab.id, o.nearPaneId, pane) ? pane.id : null;
}

export interface FileOpenRequest {
  tabId: string;
  nearPaneId: string;
  path: string;
  source?: DocSource;
}

function fileOpenTab(o: FileOpenRequest): TabSpec | null {
  const tab = residentWindowTabs().find((t) => t.id === o.tabId);
  return !tab || o.path === "" || !findPane(tab.root, o.nearPaneId) ? null : tab;
}

/** 최대화를 먼저 푼다 — 숨은 타일에 포커스 · 줄 이동이 가지 않게 */
function focusOpened(tab: TabSpec, paneId: string): string {
  unzoomFor(tab, paneId);
  focusPane(tab.id, paneId);
  selectTab(tab.id);
  return paneId;
}

/** [`openDoc`] 과 같은 판이되 미리 보기 갈아 끼우기는 없다 — 이전/다음으로 같은 칸에서 훑는다 */
export function openImage(o: FileOpenRequest): string | null {
  const tab = fileOpenTab(o);
  if (!tab) return null;
  const plan = planFileOpen(tab.root, "image", o.path, o.source);
  if (plan.kind === "focus") return focusOpened(tab, plan.paneId);
  const pane = newImagePane(o.path, o.source);
  return openPaneBeside(tab.id, o.nearPaneId, pane) ? pane.id : null;
}

export function noteImagePath(paneId: string, path: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind === "image" && path !== "" && pane.path !== path) pane.path = path;
    return;
  }
}

/** `undefined` = 로컬, `null` = 열 곳이 없다(원본을 잃은 SFTP 타일) */
export function docSourceOf(pane: PaneSpec): DocSource | undefined | null {
  if (pane.kind === "ssh") return { paneId: pane.id, alias: pane.alias ?? "" };
  if (pane.kind === "sftp" || (isFileLeafKind(pane.kind) && borrowsSession(pane))) {
    return pane.sourcePaneId ? { paneId: pane.sourcePaneId, alias: pane.alias ?? "" } : null;
  }
  return undefined;
}

export function openDocFrom(tabId: string, browserPaneId: string, path: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const browser = tab ? findPane(tab.root, browserPaneId) : null;
  if (!browser || (browser.kind !== "sftp" && browser.kind !== "localfs")) return;
  const source = docSourceOf(browser);
  if (source === null) return;
  if (imageMime(path) !== null) openImage({ tabId, nearPaneId: browserPaneId, path, source });
  else openDoc({ tabId, nearPaneId: browserPaneId, path, source });
}

/** 파일이 확인될 때만 연다 — 터미널 글자는 무엇이든 될 수 있다. `line` 은 1 기준이고 저장되지 않는다 */
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
  const path = await openableFile(remote ? remoteBackend(sessionOf(pane.id)) : localBackend(), target);
  if (path === null) return;
  const source = remote ? { paneId: pane.id, alias: pane.alias ?? "" } : undefined;
  if (imageMime(path) !== null) {
    openImage({ tabId, nearPaneId: paneId, path, source });
    return;
  }
  const before = paneIdsNow();
  const opened = openDoc({ tabId, nearPaneId: paneId, path, source });
  if (opened !== null && line !== undefined) setLineOnOpened({ opened, before, path, source, line });
}

/** 넘기면 조용히 그만둔다 — 파일은 이미 열렸다 */
const REMOTE_DOC_WAIT_MS = 8_000;
const REMOTE_DOC_POLL_MS = 100;

function paneIdsNow(): Set<string> {
  return new Set(residentWindowTabs().flatMap((x) => listPanes(x.root).map((p) => p.id)));
}

/**
 * 원격 창은 메인 PC 가 새 id 로 세우므로(`app/mirror-requests` 의 `fresh`) `opened` 가 거울에 서지 않는다 —
 * 요청 전 타일(`before`) 뒤 새로 나타난 같은 파일의 문서 타일을 짧게 살펴 건다.
 * 그사이 같은 파일 문서가 또 새로 서면 그쪽을 집을 수 있다 — 알고 받은 한계.
 */
function setLineOnOpened(o: {
  opened: string;
  before: ReadonlySet<string>;
  path: string;
  source?: DocSource;
  line: number;
}): void {
  if (!isRemote || o.before.has(o.opened)) {
    setDocLine(o.opened, o.line);
    return;
  }
  const started = Date.now();
  const tick = (): void => {
    const found = findNewDocPane(
      residentWindowTabs().flatMap((x) => listPanes(x.root)),
      o.before,
      o.path,
      o.source,
    );
    if (found) {
      setDocLine(found.id, o.line);
      return;
    }
    if (Date.now() - started < REMOTE_DOC_WAIT_MS) setTimeout(tick, REMOTE_DOC_POLL_MS);
  };
  tick();
}

async function openableFile(backend: FsBackend, target: { path: string } | { home: string }): Promise<string | null> {
  if (!backend.online) {
    showNotice(t("app.doc.open.offline"));
    return null;
  }
  let path: string;
  try {
    path = "home" in target ? joinHome(await backend.home(), target.home) : target.path;
  } catch {
    showNotice(t("app.doc.open.missing", { path: "~/" + ("home" in target ? target.home : "") }));
    return null;
  }
  try {
    const st = await backend.stat(path);
    if (st.kind === "dir" || (st.kind === "symlink" && st.linkIsDir)) {
      showNotice(t("app.doc.open.folder", { path }));
      return null;
    }
  } catch {
    showNotice(t("app.doc.open.missing", { path }));
    return null;
  }
  return path;
}

/** 채팅 프로세스는 늘 이 PC 라 경로는 로컬이다 */
export async function openPathFromChat(target: { path: string } | { home: string }, line?: number): Promise<boolean> {
  const path = await openableFile(localBackend(), target);
  if (path === null) return false;
  const tab = activeTab();
  if (imageMime(path) !== null) {
    if ((tab ? openImage({ tabId: tab.id, nearPaneId: paneOf(tab), path }) : null) === null) openInNewTab(newImagePane(path));
    return true;
  }
  const before = paneIdsNow();
  let opened = tab ? openDoc({ tabId: tab.id, nearPaneId: paneOf(tab), path }) : null;
  if (opened === null) {
    const pane = newDocPane(path);
    pane.docPreview = true;
    openInNewTab(pane);
    opened = pane.id;
  }
  if (line !== undefined) setLineOnOpened({ opened, before, path, line });
  return true;
}

/** 원격 문서면 같은 터미널의 세션을 빌려 같은 서버의 파일을 연다. `anchor` 는 저장되지 않는다 */
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
  const image = imageMime(path) !== null;
  if (path !== pane.path) {
    if (!image && !isTextLike(path)) {
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
  if (image) {
    openImage({ tabId, nearPaneId: paneId, path, source });
    return;
  }
  const opened = openDoc({ tabId, nearPaneId: paneId, path, source });
  if (opened !== null && anchor) setDocAnchor(opened, anchor);
}

function sameDocSource(a: DocSource | undefined, b: DocSource | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.paneId === b.paneId && a.alias === b.alias;
}

/**
 * `path` 만 바꾸지 않고 새 명세로 칸을 갈아 끼운다 — 같은 id 로 남으면 편집 · 띠 · 초안 · 캐시가 옛 파일 것으로 남는다.
 * 물음 뒤에는 탭 · 타일 · 경로 · 원본을 다시 찾고 계획도 다시 세운다 — 그사이 같은 파일이 다른 타일에 섰을 수 있다.
 * 원격 창은 요청에 `keepZoom` 이 실리지 않아 최대화가 풀린다.
 */
export async function switchDocHere(tabId: string, paneId: string, path: string, files?: DocFilesSeed): Promise<void> {
  const find = (): { tab: TabSpec; pane: PaneSpec } | null => {
    const tab = residentWindowTabs().find((t) => t.id === tabId);
    const pane = tab ? findPane(tab.root, paneId) : null;
    return tab && pane && pane.kind === "doc" ? { tab, pane } : null;
  };
  const first = find();
  if (!first || path === "") return;
  const oldPath = first.pane.path ?? "";
  const src = docSourceOf(first.pane);
  if (src === null || (src !== undefined && !remoteBackend(sessionOf(src.paneId)).online)) {
    showNotice(t("app.doc.open.offline"));
    return;
  }
  const source = src;
  let at = first;
  let plan = planDocSwitch(at.tab.root, paneId, path, source);
  if (plan.kind === "replace" && isDocDirty(paneId)) {
    if (!(await confirmUnsavedClose([paneId], docNameOf, "switch"))) return;
    const again = find();
    if (!again || (again.pane.path ?? "") !== oldPath || !sameDocSource(docSourceOf(again.pane) ?? undefined, source)) return;
    at = again;
    plan = planDocSwitch(at.tab.root, paneId, path, source);
    // 버렸으면 여기서 거둔다 — `replaceTile` 이 저장 안 한 문서를 한 번 더 거절하므로 그 앞에서, 갈아 끼울 때만
    if (plan.kind === "replace") {
      setDocDirty(paneId, false);
      dropDocDraft(paneId);
    }
  }
  if (plan.kind === "same") {
    focusPane(at.tab.id, paneId);
    focusPaneBody(paneId);
    return;
  }
  if (plan.kind === "focus") {
    focusOpened(at.tab, plan.paneId);
    return;
  }
  const pane = carryDocTileView(at.pane, newDocPane(path, source), { keepPreview: true });
  unzoomFor(at.tab, paneId);
  // 갈아 끼우기 바로 앞에서만 싣는다 — 취소 · `same` · `focus` 로 끝난 바꾸기는 위에서 돌아간다
  if (files) noteDocSwap(pane.id, files);
  if (replaceTile(at.tab.id, paneId, pane, undefined, { keepZoom: true })) selectTab(at.tab.id);
}

/** 붙박이가 기본이라 키를 지운다 */
export function keepDoc(paneId: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.docPreview !== undefined) delete pane.docPreview;
    return;
  }
}

export function unkeepDoc(paneId: string): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind === "doc") pane.docPreview = true;
    return;
  }
}

/** 기본(`rendered`)이면 키를 지운다 — 배치 파일에 기본값이 적히지 않는 규칙이 명세에서부터 선다 */
export function noteDocMode(paneId: string, mode: DocMode): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    // 보기를 바꾼 것은 명시적인 손길이라 미리 보기를 고정한다 — 다음에 여는 파일이 이 글을 몰래 치우지 않게
    if (pane.docPreview !== undefined) delete pane.docPreview;
    if (mode === "rendered") {
      if (pane.docMode !== undefined) delete pane.docMode;
    } else if (pane.docMode !== mode) {
      pane.docMode = mode;
    }
    return;
  }
}

/** 미리 보기를 고정하지 않는다 — 읽기 편의라 이 문서를 두고 한 결정이 아니다 */
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

/** 미리 보기를 고정하지 않는다 */
export function noteDocFiles(paneId: string, open: boolean): void {
  for (const tab of residentWindowTabs()) {
    const pane = findPane(tab.root, paneId);
    if (!pane) continue;
    if (pane.kind !== "doc") return;
    if (open) {
      if (pane.docFiles !== true) pane.docFiles = true;
    } else if (pane.docFiles !== undefined) {
      delete pane.docFiles;
    }
    return;
  }
}

/** 미리 보기를 고정하지 않는다 — 편집이 이미 고정했고 [편집 종료]가 되돌린다 */
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
 * `openPaneHere` 를 쓰지 않는다 — 헤더의 📂 는 활성이 아닌 타일에서도 눌리고, 브라우저는 자기를 연 그 터미널 옆에 서야 한다.
 * 탭 · 원본 타일을 다시 찾는다 — 사이에 `await` 가 있어 그동안 닫혔을 수 있다.
 */
function place(tabId: string, sourcePaneId: string, browser: PaneSpec): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, sourcePaneId)) return;
  placeAuto(tab, browser, sourcePaneId);
  focusPane(tab.id, browser.id);
  adoptPane(tab.id, browser.id);
  selectTab(tab.id);
}

/** 비-PTY exec 채널로 tmux 에게 묻는다 — 화면에는 아무것도 찍히지 않는다. 실패는 조용히 "모름" */
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
 * 순서에 뜻이 있다 — 셸이 알려 준 값(OSC 7)이 먼저, OS 조회(`local_cwd`)는 폴백이다.
 * PowerShell 은 `Set-Location` 이 프로세스 cwd 를 바꾸지 않아 OS 조회가 통하지 않는다. WSL 은 백엔드가 늘 `None` 을 준다(pid 가 `wsl.exe` 의 것).
 * 실패는 전부 조용하다 — 폴더 하나 덜 맞는 것과 버튼이 죽는 것은 무게가 다르다.
 */
export async function resolveLocalCwd(pane: PaneSpec): Promise<string | undefined> {
  const paneId = pane.id;
  const reported = paneCwd(paneId)?.trim();
  if (reported) {
    // WSL 의 값만 배포판 안 POSIX 경로라 옮긴다 — 다른 셸의 값은 이미 윈도우 경로다
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

export function openFilesHere(): void {
  const tab = activeTab();
  if (!tab) {
    showNotice(t("app.pane.needTerminalFocus"));
    return;
  }
  openFilesFor(tab.id, paneOf(tab));
}
