import { projectOpenPlan } from "$lib/project-locations";
import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
import { projectLocations, revealProjectLocation, worktreeTabsOf } from "$lib/app/project-locations.svelte.js";
import { invoke } from "../ipc";
import { dropProjectLocal, projects as projectList, putProjectLocal } from "$lib/app/project-list.svelte.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import { lookupHost } from "$lib/app/hosts.svelte.js";
import { defaultShellId, knownAiClis } from "$lib/app/panes.svelte.js";
import { instructionsApplyWorktree, worktreeSetupCount } from "$lib/context";
import { activeTab, closeTabsAsked, openInNewTab, openPaneHere, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { listPanes, type PaneSpec } from "$lib/session";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { loadWorktrees, worktreeReadState, worktreesOf } from "$lib/app/worktrees.svelte.js";
import { refreshTargets } from "$lib/worktree-refresh";
import { worktreeChangesOf } from "$lib/app/worktree-changes.svelte.js";
import { projectStartPaneFor } from "$lib/app/agent-sessions.svelte.js";
import { setAgentHooksRemote, type AgentHooksTarget } from "$lib/context";
import { installRemoteHooksOn } from "$lib/app/remote-hooks";
import { toast } from "$lib/toast.svelte.js";
import { recordProjectFolderOpen } from "$lib/app/recent-worktrees.svelte.js";
import {
  draftOf,
  emptyDraft,
  hasSetupScript,
  isRemote,
  paneForNewRemoteWorktree,
  paneForSetup,
  setupScriptLines,
  paneForWorktree,
  parseProjects,
  projectTail,
  sameFolder,
  worktreeBaseOf,
  worktreeNameProblem,
  worktreeTabTitle,
  parseExpandedProjects,
  type WorktreeInfo,
  type WorktreeListing,
  branchDeleteDefault,
  branchDeleteOption,
  branchDeleteToggleable,
  parseWorktreeRemoved,
  worktreeRemovedToast,
  type BranchDeleteOption,
  projectOfDraft,
  validateDraft,
  validateCreateDraft,
  duplicateProjectOf,
  isAbsoluteLocalPath,
  type Project,
  type ProjectDraft,
  type ProjectDraftProblem,
} from "$lib/projects";
import {
  gitIdentityCommands,
  repoCheckBlocks,
  repoCheckKey,
  type RepoCheck,
  type RepoCheckAction,
} from "$lib/repo-status";
import { createProjectFolder, GitIdentityError, initRepoAt, repoStatusOf } from "$lib/app/git-repo";
import { writeClipboard } from "$lib/clipboard";

/**
 * **프로젝트 층** — 여는 길 · 삭제 · 추가·편집 폼 (docs/log/2026-09-24-projects.md).
 *
 * 목록 사본(읽기·이벤트·포커스 재로드)은 `app/project-list.svelte.ts` 에 따로 산다 — 호스트
 * 팬아웃과의 순환을 끊으려고 갈랐다(그 파일 머리말). 여기서는 다시 내보내기만 한다.
 *
 * "열기" 는 현재 워크스페이스의 같은 위치를 먼저 찾아 포커스하고, 없으면 새 탭으로 연다.
 * 빈 시작 타일 하나뿐인 탭은 재사용한다. "지금 탭에 열기" 는 활성 타일 옆(`openPaneHere`)이다.
 */

/** 폼이 닫힐 때 포커스를 돌려줄 이름표 (`app/focus-return.svelte.ts`) */
const FOCUS_KEY = "project-form";
/** 워크트리 제거 확인이 닫힐 때 포커스를 돌려줄 이름표 */
const REMOVE_FOCUS_KEY = "worktree-remove";

// 목록 사본은 `app/project-list.svelte.ts` 에 산다 (그 파일 머리말의 "왜 갈라 두었나").
// 부르는 쪽이 한 문으로 들어오게 여기서 다시 내보낸다.
export {
  mountProjects,
  projectById,
  projects,
  refreshProjects,
  PROJECTS_CHANGED_EVENT,
} from "$lib/app/project-list.svelte.js";
// 워크트리 사본(`app/worktrees.svelte.ts`)과 새 탭 열기(`app/tabs.svelte.ts`)도 2026-09-26 에 여기서
// 떼어 냈다 — 이 층이 지난 대화 저장소를 부르게 되어(시작 화면), 그 저장소가 부르는 둘이 여기 있으면
// 서로를 부른다. 부르는 쪽은 여전히 이 문으로 들어온다.
export { listProjectWorktrees, loadWorktrees, worktreesOf } from "$lib/app/worktrees.svelte.js";
export { openInNewTab } from "$lib/app/tabs.svelte.js";

// ---------------------------------------------------------------------------
// 여는 길
// ---------------------------------------------------------------------------

/**
 * 타일 명세를 만든다 — 원격이면 그 호스트의 스크롤백을 물려주고 비밀번호 모달이 "어디에
 * 붙는 중인지" 를 말할 수 있게 대상 문구를 기억해 둔다(호스트 `connect` 와 같은 준비).
 */
async function paneFor(p: Project): Promise<PaneSpec> {
  if (isRemote(p)) return remotePaneFor(p, p.path);
  return localPaneFor(p, p.path);
}

/**
 * 원격 프로젝트·워크트리 폴더 하나를 여는 타일 — 설정 `[projects] start_screen` 이 `auto`(기본)면 로컬과 같은 **시작 화면**
 * (2026-09-27 — docs/log/2026-09-27-remote-conversations.md: 그 서버의 지난 대화를 붙은 세션으로 읽는다), `off` 면 지금까지처럼
 * 그 폴더의 SSH 타일(시작 명령). 시작 화면에서 무엇을 고르면 그 자리에서 이 SSH 타일로 바뀐다.
 */
async function remotePaneFor(p: Project & { host: string }, folder: string): Promise<PaneSpec> {
  const start = await projectStartPaneFor(p.id, folder, p.host).catch(() => null);
  if (start) return start;
  return paneForWorktree(p, folder, null, remoteScrollback(p));
}

/**
 * 로컬 프로젝트·워크트리 폴더 하나를 여는 타일 — 설정 `[projects] start_screen` 이 `auto`(기본)면 셸 대신 **프로젝트
 * 시작 화면**(docs/log/2026-09-26-project-start-screen.md — 2026-09-27 부터는 지난 대화가 없는 폴더도,
 * docs/log/2026-09-27-folder-conversations.md), `off` 면 지금까지처럼 그 폴더의 셸·시작 명령. 시작 화면에서 무엇을 고르면 그 자리에서 이 셸·명령 타일로 바뀐다.
 * 원격은 [`remotePaneFor`] 가 같은 일을 한다(그 서버의 대화 — 2026-09-27).
 */
async function localPaneFor(p: Project, folder: string): Promise<PaneSpec> {
  const start = await projectStartPaneFor(p.id, folder).catch(() => null);
  if (start) return start;
  // 프로젝트에 셸이 적혀 있지 않으면 **지금의 기본 셸**(새 셸 단축키와 같은 판정).
  const fallback = p.shell ? null : await defaultShellId().catch(() => null);
  return paneForWorktree(p, folder, fallback);
}

/** **열기** — 지금 탭의 활성 타일 옆에 (호스트 더블클릭과 같은 자리) */
export async function openProjectHere(p: Project): Promise<void> {
  openPaneHere(await paneFor(p), p.name, p.id);
  recordProjectFolderOpen(p, p.path);
}

/** 열기는 현재 workspace의 위치를 먼저 찾는다. 없으면 탭 하나, 빈 plain 시작 탭이면 재사용한다. */
async function openProjectFolder(p: Project, folder: string, title: string): Promise<void> {
  const plan = () => {
    const tab = activeTab();
    const lone = !!tab && tab.root.type === "leaf" && tab.root.pane.kind === "start" && !tab.root.pane.startProject;
    return projectOpenPlan(projectLocations(p, folder), currentWorkspaceId(), lone);
  };
  let target = plan();
  if (target.kind === "focus") { await revealProjectLocation(target.location); return; }
  const pane = isRemote(p) ? await remotePaneFor(p, folder) : await localPaneFor(p, folder);
  target = plan(); // 비동기 명세 조회 사이에 열린 탭도 중복 생성하지 않는다.
  if (target.kind === "focus") { await revealProjectLocation(target.location); return; }
  if (target.kind === "reuse") {
    const tab = activeTab()!;
    tab.title = title;
    tab.pinnedTitle = title;
    tab.projectId = p.id;
    if (!isRemote(p)) tab.projectFolder = folder;
    openPaneHere(pane, title, p.id);
  } else openInNewTab(pane, title, isRemote(p) ? undefined : folder, p.id);
}
export async function openProject(p: Project): Promise<void> {
  await openProjectFolder(p, p.path, p.name);
  recordProjectFolderOpen(p, p.path);
}
export const openProjectInNewTab = openProject;

/**
 * 프로젝트·워크트리 탭의 제목 — **주 폴더면 프로젝트 이름**, 워크트리면 `<프로젝트> · <워크트리>`(브랜치, 분리된 HEAD 면
 * 폴더 꼬리). 지난 대화의 범위 이름(`scopeLabelOf`)과 같은 관례다 — 재개로 연 탭과 프로젝트로 연 탭이 같은 이름을 쓴다.
 */
function projectTabTitle(p: Project, w: WorktreeInfo): string {
  if (sameFolder(w.path, p.path)) return p.name;
  return worktreeTabTitle(p.name, w.branch ?? projectTail(w.path));
}

/**
 * **삭제** — 확인 상자를 한 번 거친다(호스트 제거와 같은 규칙: 다이얼로그를 못 띄우면
 * 지우지 않는다). 지우는 것은 목록의 한 줄뿐이다 — 폴더도, 워크트리도, 열려 있는 타일도 그대로다.
 *
 * 확인 글에 **함께 지워지는 것**을 적는다(2026-09-28 — docs/log/2026-09-28-project-agent-setup-script.md): 에이전트 ·
 * 셸 · 워크트리 폴더 설정, 설정 스크립트 N줄(있으면), 워크트리별 스크립트 실행 기록 N개(로컬 · 있으면 — Rust 가 곁
 * 파일에서 센다). 기록은 `project_remove` 가 함께 걷는다.
 */
export async function confirmRemoveProject(p: Project): Promise<void> {
  let go = false;
  const lines = setupScriptLines(p.setupScript);
  const records = isRemote(p) ? 0 : await worktreeSetupCount(p.path);
  const items = [t("app.projects.remove.item.settings")];
  if (lines > 0) items.push(t("app.projects.remove.item.script", { n: lines }));
  if (records > 0) items.push(t("app.projects.remove.item.records", { n: records }));
  const message = t("app.projects.remove.confirm", {
    name: p.name,
    items: items.map((i) => `· ${i}`).join("\n"),
  });
  try {
    go = await askConfirm(message, {
      title: t("app.projects.remove.title", { name: p.name }),
      kind: "warning",
      okLabel: t("app.projects.remove.ok"),
      cancelLabel: t("app.actions.cancel"),
      danger: true,
    });
  } catch {
    showNotice(t("app.hosts.remove.noDialog"));
    return;
  }
  if (!go) return;
  try {
    await invoke("project_remove", { id: p.id });
    dropProjectLocal(p.id); // 이벤트를 기다리지 않고 곧바로 화면에서 뺀다
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

// ---------------------------------------------------------------------------
// 추가·편집 폼 (모달은 `ProjectForm.svelte`)
// ---------------------------------------------------------------------------

interface FormState {
  open: boolean;
  mode: "add" | "edit";
  /**
   * 추가 방식 (2026-09-28 — docs/log/2026-09-28-project-create.md): 있는 폴더를 등록하나(`existing`),
   * `<만들 자리>/<이름>` 을 새로 만들어 저장소로 초기화하나(`create`). 편집은 늘 `existing` 이다.
   */
  kind: "existing" | "create";
  draft: ProjectDraft;
  /** 새로 만들기의 "만들 자리"(부모 폴더) */
  parent: string;
  /** 경로 칸 아래 한 줄의 재료 — 저장소 판정(`$lib/repo-status` 의 `RepoCheck`) */
  check: RepoCheck;
  /** "이대로 두기" 로 하위 폴더 경고를 걷었나 — 경로를 만지면 다시 선다 */
  checkDismissed: boolean;
  /** 막힌 칸 (칸 옆에 한 줄) */
  problem: ProjectDraftProblem | null;
  /** 백엔드가 거절한 사유 (폼 아래 한 줄) */
  error: string | null;
  /**
   * `error` 가 **git 신원 없음**이면 설정할 자리(이 PC · 그 서버) — 폼이 "먼저 설정하세요" + `git config` 두 줄을 그린다.
   * `error` 를 채우는 자리가 늘 함께 정한다([`formErrorOf`]) — `error` 가 비면 보지 않는다.
   */
  identity: "local" | "remote" | null;
  saving: boolean;
  /** 열 때 설정 스크립트 칸에 포커스를 줄까 — 터미널 오류 막대의 [스크립트 편집] 이 켠다 */
  focusScript: boolean;
}

const form = $state<FormState>({
  open: false,
  mode: "add",
  kind: "existing",
  draft: emptyDraft(),
  parent: "",
  check: { state: "idle" },
  checkDismissed: false,
  problem: null,
  error: null,
  identity: null,
  saving: false,
  focusScript: false,
});

/** 모달이 그리는 값 전부 (반응형) */
export function projectForm(): FormState {
  return form;
}

/** 전역 키가 쉬어야 하는가 — 칸에 글자를 치는 모달이다 (`app/keys.svelte.ts` 의 목록) */
export function projectFormOpen(): boolean {
  return form.open;
}

/**
 * 폼을 연다 — `p` 가 있으면 편집, 없으면 추가. `host` 는 추가에서 원격으로 미리 고를 별칭
 * (호스트 줄 메뉴에서 여는 길이 생기면 쓴다 — 지금은 비어 온다).
 */
export function openProjectForm(p?: Project, host?: string): void {
  rememberFocusOrigin(FOCUS_KEY);
  form.mode = p ? "edit" : "add";
  form.kind = "existing";
  form.draft = p ? draftOf(p) : emptyDraft();
  if (!p && host) {
    form.draft.location = "remote";
    form.draft.host = host;
  }
  form.parent = "";
  form.check = { state: "idle" };
  form.checkDismissed = false;
  checkSeq++;
  form.problem = null;
  form.error = null;
  form.saving = false;
  form.focusScript = false;
  form.open = true;
  // 편집은 곧바로 지금 경로를 본다(저장소가 아니게 된 폴더·지워진 폴더를 여는 순간 알린다).
  if (p) void checkRepoNow();
}

export function closeProjectForm(): void {
  form.open = false;
  form.saving = false;
  clearTimeout(checkTimer);
  checkSeq++;
  returnFocus(FOCUS_KEY);
}

/** [기존 폴더 | 새로 만들기] — 추가에서만 (편집은 늘 기존 폴더) */
export function setProjectFormKind(kind: "existing" | "create"): void {
  if (form.mode === "edit" || form.kind === kind) return;
  form.kind = kind;
  form.problem = null;
  form.error = null;
  if (kind === "existing") scheduleRepoCheck(0);
}

/** 새로 만들기의 "만들 자리" 칸 */
export function setProjectParent(value: string): void {
  form.parent = value;
  if (form.problem === "parent" || form.problem === "parentRelative" || form.problem === "worktreeDir") {
    form.problem = null;
  }
  form.error = null;
}

// ---------------------------------------------------------------------------
// 경로 확인 — 기존 폴더의 저장소 판정 (docs/log/2026-09-28-project-create.md)
// ---------------------------------------------------------------------------

/** 판정 순번 — 늦게 온 옛 답이 새 경로의 줄을 덮지 않게 */
let checkSeq = 0;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
/** 입력 칸을 치는 동안 기다리는 시간 — 멈추면 한 번 본다(blur 는 곧바로) */
const CHECK_DEBOUNCE_MS = 450;

/** 지금 초안의 판정 열쇠 */
function currentCheckKey(): string {
  const d = form.draft;
  return repoCheckKey(d.location, d.host, d.path);
}

/**
 * 경로가 바뀌었다 — `delay` 뒤에 한 번 본다(치는 동안은 기다린다). 폼이 닫혔거나 새로 만들기면
 * 아무것도 안 한다. 폼의 `$effect` 가 위치·호스트·경로가 바뀔 때마다 부른다.
 */
export function scheduleRepoCheck(delay = CHECK_DEBOUNCE_MS): void {
  clearTimeout(checkTimer);
  if (!form.open || form.kind !== "existing") return;
  // 이미 이 열쇠의 답이 있거나 보는 중이면 다시 묻지 않는다.
  const key = currentCheckKey();
  if (form.check.state !== "idle" && form.check.key === key) return;
  checkTimer = setTimeout(() => void checkRepoNow(), delay);
}

/**
 * 지금 경로를 **곧바로** 본다 — [찾아보기] 로 고른 직후 · 경로 칸을 떠날 때 · 저장 직전. 이미 그
 * 경로의 답이 있으면 그것을 돌려준다. 원격인데 붙은 세션이 없으면 `unknown`(모른다).
 */
export async function checkRepoNow(): Promise<RepoCheck> {
  clearTimeout(checkTimer);
  const d = form.draft;
  const key = currentCheckKey();
  if (form.check.state === "done" && form.check.key === key) return form.check;
  const path = d.path.trim();
  const remote = d.location === "remote";
  if (form.kind !== "existing" || path === "" || (remote ? d.host.trim() === "" : !isAbsoluteLocalPath(path))) {
    checkSeq++; // 날아가던 옛 답이 돌아와도 버린다
    if (form.check.state !== "idle") form.check = { state: "idle" };
    return form.check;
  }
  const seq = ++checkSeq;
  form.check = { state: "checking", key };
  const status = await repoStatusOf(remote ? d.host.trim() : null, path);
  if (seq !== checkSeq) return form.check;
  form.check = status ? { state: "done", key, status } : { state: "unknown", key };
  return form.check;
}

/** 같은 폴더를 이미 쓰는 **다른** 프로젝트 (폼의 경고 한 줄 — 저장은 막지 않는다) */
export function duplicateOfForm(): Project | null {
  if (form.kind !== "existing") return null;
  return duplicateProjectOf(projectList(), form.draft);
}

/**
 * 경로 확인 줄의 단추 — [초기화하고 추가] · [첫 커밋 만들고 추가] 는 저장소로 만든 뒤 저장하고,
 * [그대로 추가] 는 그냥 저장, [루트로 바꾸기] 는 경로를 저장소 루트로 바꿔 다시 보고, [이대로 두기] 는
 * 그 경고를 걷는다.
 */
export async function runRepoCheckAction(action: RepoCheckAction): Promise<void> {
  const check = form.check;
  if (action === "keepSub") {
    form.checkDismissed = true;
    return;
  }
  if (action === "useRoot") {
    if (check.state === "done" && check.status.kind === "subfolder") {
      form.draft.path = check.status.root;
      form.checkDismissed = false;
      await checkRepoNow();
    }
    return;
  }
  if (action === "addAsIs") {
    await submitProjectForm();
    return;
  }
  // initAndAdd · commitAndAdd — 저장소로 만든 뒤 저장한다. 실패하면 폼 아래 git 의 한 줄, 저장은 안 한다.
  if (form.saving) return;
  const d = form.draft;
  form.saving = true;
  form.error = null;
  try {
    await initRepoAt(d.location === "remote" ? d.host.trim() : null, d.path.trim());
  } catch (e) {
    formErrorOf(e);
    form.saving = false;
    // 초기화는 됐는데 커밋만 실패했을 수 있다 — 줄을 새로 본다.
    form.check = { state: "idle" };
    void checkRepoNow();
    return;
  }
  form.saving = false;
  form.check = { state: "idle" };
  await submitProjectForm();
}

/** 칸 하나를 고친다 — 막힌 표시는 그 칸을 만지는 순간 거둔다 */
export function setProjectField<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]): void {
  form.draft[key] = value;
  if (form.problem === key || (key === "location" && form.problem === "host")) form.problem = null;
  // 워크트리 폴더의 판정은 저장소 경로·위치에 기대므로 그 칸들을 만져도 거둔다(저장 때 다시 본다).
  if (form.problem === "worktreeDir" && (key === "path" || key === "location")) form.problem = null;
  // 로컬 경로의 "절대 경로여야" 도 경로·위치를 만지면 거둔다 (원격으로 바꾸면 `~` 가 된다).
  if (form.problem === "pathRelative" && (key === "path" || key === "location")) form.problem = null;
  // 경로 확인(없는 폴더)도 경로·위치를 만지면 거둔다 — 판정은 폼의 `$effect` 가 다시 부른다.
  if (form.problem === "pathMissing" && (key === "path" || key === "location")) form.problem = null;
  // 새로 만들기의 이름은 곧 폴더 이름이다.
  if (form.problem === "folderName" && key === "name") form.problem = null;
  if (key === "path" || key === "location") form.checkDismissed = false;
  form.error = null;
}

/** [찾아보기…] — 로컬 폴더 고르기 (파일 대화상자 플러그인, 폴더 모드) */
export async function browseProjectFolder(): Promise<void> {
  try {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: form.draft.path.trim() || undefined,
      title: t("app.projects.form.browse.title"),
    });
    if (typeof picked === "string" && picked !== "") {
      form.draft.path = picked;
      // 이름이 비어 있으면 폴더 이름을 제안한다 — 대개 그대로 쓴다.
      if (form.draft.name.trim() === "") {
        const tail = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
        form.draft.name = tail;
      }
      if (form.problem === "path" || form.problem === "pathRelative" || form.problem === "pathMissing") {
        form.problem = null;
      }
      form.checkDismissed = false;
      // 고른 직후 곧바로 본다 — 대화상자로 고른 경로는 다 친 것이다(디바운스를 기다릴 까닭이 없다).
      void checkRepoNow();
    }
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/** 새로 만들기의 [찾아보기…] — "만들 자리"(부모 폴더) 고르기 (로컬만) */
export async function browseProjectParent(): Promise<void> {
  try {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: form.parent.trim() || undefined,
      title: t("app.projects.form.parent.browse.title"),
    });
    if (typeof picked === "string" && picked !== "") setProjectParent(picked);
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * 워크트리 폴더의 [찾아보기…] — 로컬 폴더 고르기. 대화상자는 지금 칸의 값, 비었으면 기본 자리
 * (`<저장소>-wt`), 그것도 없으면 저장소 폴더에서 연다 — 기본 자리는 아직 없을 수 있으므로
 * 대화상자가 가장 가까운 있는 폴더로 내려간다(플러그인의 동작).
 */
export async function browseWorktreeFolder(): Promise<void> {
  const d = form.draft;
  const start =
    d.worktreeDir.trim() ||
    worktreeBaseOf({ path: d.path, worktreeDir: null }) ||
    d.path.trim() ||
    undefined;
  try {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: start,
      title: t("app.projects.form.worktreeDir.browse.title"),
    });
    if (typeof picked === "string" && picked !== "") {
      form.draft.worktreeDir = picked;
      if (form.problem === "worktreeDir") form.problem = null;
    }
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * 저장 — 검증을 지나면 백엔드에 한 줄을 넣고(`project_upsert`) 닫는다.
 *
 * - **기존 폴더**: 로컬이면 저장 직전에 경로를 한 번 더 본다(아직 판정 전에 Enter 를 친 경우) —
 *   폴더가 없으면 막는다(`pathMissing`). 저장소가 아니거나 하위 폴더인 것은 경고일 뿐 막지 않는다.
 * - **새로 만들기**: `<만들 자리>/<이름>` 을 만들고 저장소로 초기화한 뒤(빈 첫 커밋까지) 그 경로로
 *   저장한다. 만들기가 실패하면(폴더가 비어 있지 않다 · 신원이 없어 커밋 실패 …) git 의 한 줄을 폼
 *   아래에 두고 **프로젝트는 넣지 않는다**(만든 폴더·저장소는 남는다 — 고친 뒤 같은 단추를 다시 누르면
 *   커밋만 한다).
 */
export async function submitProjectForm(): Promise<void> {
  if (form.saving) return;
  if (form.kind === "create" && form.mode === "add") {
    await submitCreate();
    return;
  }
  const problem = validateDraft(form.draft);
  if (problem) {
    form.problem = problem;
    return;
  }
  if (form.draft.location === "local") {
    const check = await checkRepoNow();
    if (repoCheckBlocks(check, false)) {
      form.problem = "pathMissing";
      return;
    }
  }
  await saveDraft();
}

/** 새로 만들기 — 폴더·저장소를 만들고 그 경로로 저장한다([`submitProjectForm`] 머리말) */
async function submitCreate(): Promise<void> {
  const d = form.draft;
  const problem = validateCreateDraft(d, form.parent);
  if (problem) {
    form.problem = problem;
    return;
  }
  form.saving = true;
  form.error = null;
  let made: { path: string; branch: string };
  try {
    const remote = d.location === "remote";
    made = await createProjectFolder(remote ? d.host.trim() : null, form.parent.trim(), d.name.trim());
    form.draft.path = made.path;
  } catch (e) {
    formErrorOf(e);
    form.saving = false;
    return;
  }
  form.saving = false;
  // 어디에 무엇이 생겼는지 말한다(워크트리 알림과 같은 원칙 — 실제 브랜치 이름은 여기서 처음 보인다).
  if (await saveDraft()) {
    toast.success(t("app.projects.repo.created", { path: made.path, branch: made.branch || "main" }));
  }
}

/** 초기화 · 만들기의 실패를 폼 아래 한 줄로 — 신원 없음이면 설정할 자리까지 적는다 */
function formErrorOf(e: unknown): void {
  form.error = e instanceof Error ? e.message : String(e);
  form.identity = e instanceof GitIdentityError ? e.where : null;
}

/** 신원 안내의 두 줄 — 자리표시는 지금 언어의 "이름" · "메일" */
export function gitIdentityLines(): [string, string] {
  return gitIdentityCommands(t("app.projects.repo.identity.name"), t("app.projects.repo.identity.email"));
}

/**
 * 신원 안내의 [명령 복사] — 두 줄을 줄바꿈으로 이어 클립보드에. 성공하면 `true`.
 * `quiet` 면 성공 토스트를 띄우지 않는다 — 폼의 코드 블록은 단추 자리의 체크 아이콘이 그 몫이다
 * (`CommandBlock.svelte`). 독 토스트의 [명령 복사] 는 보이는 자리가 없어 토스트로 알린다.
 */
export async function copyGitIdentityLines(quiet = false): Promise<boolean> {
  const ok = await writeClipboard(gitIdentityLines().join("\n"));
  if (!ok) showNotice(t("app.projects.repo.identity.copyFailed"));
  else if (!quiet) toast.success(t("app.projects.repo.identity.copied"));
  return ok;
}

/**
 * 독 쪽(새 워크트리 관문 · [git 저장소로 초기화]) 실패 알림 — 신원 없음이면 두 줄(무엇이 없는지 ·
 * 흐린 보조 줄에 설정할 명령 조각) + [명령 복사](전체 두 줄을 클립보드로),
 * 아니면 예전 그대로 git 의 한 줄.
 */
function repoFailureNotice(e: unknown): void {
  if (!(e instanceof GitIdentityError)) {
    showNotice(e instanceof Error ? e.message : String(e));
    return;
  }
  // 두 줄: 무엇이 없는지 + 무엇을 설정할지(명령 조각만). 붙여 넣을 전체 두 줄은 [명령 복사] 로만 준다.
  toast.error(t(`app.projects.repo.identity.toast.${e.where}`), {
    sub: t("app.projects.repo.identity.toast.hint"),
    ms: 15000,
    action: { label: t("app.projects.repo.identity.copy"), run: () => void copyGitIdentityLines() },
  });
}

/** 초안을 그대로 저장한다 (검증은 부르는 쪽이 이미 했다) — 저장했으면 `true` */
async function saveDraft(): Promise<boolean> {
  if (form.saving) return false;
  form.saving = true;
  try {
    const saved = parseProjects([
      await invoke<unknown>("project_upsert", {
        project: projectOfDraft(form.draft),
      }),
    ])[0];
    // 이벤트를 기다리지 않고 사본에 곧바로 반영한다 (이벤트가 오면 같은 값으로 다시 읽힌다).
    if (saved) putProjectLocal(saved);
    form.open = false;
    returnFocus(FOCUS_KEY);
    return true;
  } catch (e) {
    form.error = stripReason(e instanceof Error ? e.message : String(e));
    form.identity = null;
    return false;
  } finally {
    form.saving = false;
  }
}

// ---------------------------------------------------------------------------
// 워크트리 (docs/log/2026-09-24-worktrees.md)
// ---------------------------------------------------------------------------


/** 에이전트의 제품 이름 — 감지 목록(`list_ai_clis`)에서, 모르면 id 그대로. 에이전트가 없으면 `null` */
async function agentDisplayName(agent: string | null): Promise<string | null> {
  if (!agent) return null;
  const clis = await knownAiClis().catch(() => []);
  return clis.find((c) => c.id === agent)?.name ?? agent;
}

/**
 * 설정 스크립트를 먼저 돌리는 타일 — 그 폴더에서 스크립트, `withAgent` 면 성공한 뒤 프로젝트의 에이전트
 * (`paneForSetup` — docs/log/2026-09-28-project-agent-setup-script.md). 시작 화면을 건너뛴다.
 */
async function setupPaneFor(p: Project, folder: string, withAgent: boolean): Promise<PaneSpec> {
  const name = withAgent ? await agentDisplayName(p.agent) : null;
  if (isRemote(p)) return paneForSetup(p, folder, withAgent, name, null, remoteScrollback(p));
  const fallback = p.shell ? null : await defaultShellId().catch(() => null);
  return paneForSetup(p, folder, withAgent, name, fallback);
}

/**
 * 독 워크트리 줄의 **[설정 스크립트 실행]** — 그 워크트리에서 새 타일(지금 탭 옆)로 스크립트만 돌리고 셸에 머문다.
 * 이미 있는 워크트리 · 실패한 뒤 다시 돌릴 때 쓴다. 스크립트가 비면 메뉴 항목이 흐려 여기 오지 않지만, 와도 알림 한 줄.
 */
export async function runProjectSetupScript(p: Project, w: WorktreeInfo): Promise<void> {
  if (!hasSetupScript(p)) {
    showNotice(t("app.projects.setup.none"));
    return;
  }
  openPaneHere(await setupPaneFor(p, w.path, false), projectTabTitle(p, w), p.id);
}

/** 오류 막대의 [스크립트 편집] — 그 프로젝트의 편집 폼을 연다(설정 스크립트 칸에 포커스) */
export function editProjectSetup(projectId: string): void {
  const p = projectList().find((x) => x.id === projectId);
  if (!p) {
    showNotice(t("app.projects.setup.gone"));
    return;
  }
  openProjectForm(p);
  form.focusScript = true;
}

/** 원격이면 비밀번호 모달이 "어디에 붙는 중인지" 말하도록 대상을 기억하고 스크롤백을 꺼낸다 */
function remoteScrollback(p: Project): number | null | undefined {
  if (!isRemote(p)) return undefined;
  const host = lookupHost(p.host);
  if (host) rememberTarget(host);
  return host?.meta?.scrollback;
}

/** 이름 검사 결과 → 사람이 읽을 한 줄 (없으면 `null` = 통과) */
export function worktreeNameError(name: string): string | null {
  const problem = worktreeNameProblem(name);
  if (problem === "empty") return t("app.projects.worktree.error.empty");
  if (problem === "invalid") return t("app.projects.worktree.error.invalid");
  return null;
}

/**
 * **새 워크트리에서 열기** — 이름 하나로 워크트리를 만들고 그 폴더에서 에이전트 타일을 연다.
 *
 * - **로컬**: `git_worktree_add` 가 만들고(자리·브랜치 판정은 Rust) 돌려준 폴더로 타일을 연다.
 *   실패(이름·git 없음·같은 브랜치가 이미 다른 워크트리에 있음)는 git 의 한 줄을 알림으로.
 * - **원격**: 여기서는 왕복하지 않는다 — 워크트리 재료(`PaneSpec.worktree`)를 실은 SSH 타일을 열고, 그 타일이
 *   접속한 뒤 · 첫 입력 전에 Rust(`remote_worktree::prepare`)가 그 전송로의 exec 로 판정 → (첫 커밋이 없으면 **그 타일의
 *   위쪽 막대**로 묻고) → `git worktree add` 한다. 이미 붙은 다른 세션을 빌려 앞에서 묻는 관문은 없다 — 다른 타일이
 *   붙어 있든 없든 늘 같은 흐름이다(2026-09-29 B안, docs/log/2026-09-29-remote-worktree-after-connect.md).
 *
 * **어디에 생겼는지를 말한다**(사용자 피드백 2026-09-24): 로컬은 Rust 가 돌려준 **실제 자리**
 * 를 알림에 그대로 적고 [폴더 열기](탐색기에서 그 폴더를 고른 채)를 붙인다. 원격은 아직 만들지
 * 않았으므로(타일이 접속한 뒤 만든다) "만듭니다" 로 적고 버튼이 없다 — 이 PC 의 탐색기가 열 수 없는
 * 자리다. 탭 제목은 `<프로젝트> · <이름>` 이다.
 */
export async function openProjectInNewWorktree(p: Project, name: string): Promise<void> {
  const bad = worktreeNameError(name);
  if (bad) {
    showNotice(bad);
    return;
  }
  // 로컬 · 커밋 없는 저장소면 첫 커밋부터 — 그냥 만들면 git 이 main 과 이어지지 않는 고아 브랜치를 만든다.
  // 원격은 타일이 접속한 뒤 그 타일의 막대로 묻는다(위 머리말).
  if (!isRemote(p) && !(await ensureFirstCommit(p))) return;
  const title = worktreeTabTitle(p.name, name.trim());
  if (isRemote(p)) {
    // 원격 지침 반영은 2단계 이후.
    // 설정 스크립트가 있으면 첫 입력이 워크트리 → 스크립트 → (성공하면) 에이전트 순서로 돈다(`paneForSetup`).
    const pane = paneForNewRemoteWorktree(p, name, remoteScrollback(p), await agentDisplayName(p.agent));
    if (!pane) {
      showNotice(t("app.projects.worktree.error.nowhere"));
      return;
    }
    openInNewTab(pane, title, undefined, p.id);
    if (pane.cwd) recordProjectFolderOpen(p, pane.cwd, name.trim());
    toast.info(t("app.projects.worktree.remoteCreating", { path: pane.cwd ?? "" }));
    return;
  }
  try {
    const added = await invoke<{ path: string; branch: string; branch_created: boolean; tracked?: string | null }>(
      "git_worktree_add",
      { repo: p.path, name: name.trim(), dir: p.worktreeDir },
    );
    // 에이전트가 뜨기 전에 새 폴더에 지침을 쓴다. 실패해도 워크트리 열기는 계속한다.
    let instructionFiles = 0;
    try {
      const changes = await instructionsApplyWorktree(p.id, added.path);
      instructionFiles = changes.filter((change) => change.action === "create" || change.action === "update").length;
      const failed = changes.find((change) => change.action === "error" || (change.action === "skipped" && change.reason));
      if (failed?.reason) {
        toast.info(t("app.projects.worktree.instructionsFailed", { reason: stripReason(failed.reason) }));
      }
    } catch (e) {
      toast.info(t("app.projects.worktree.instructionsFailed", { reason: stripReason(e instanceof Error ? e.message : String(e)) }));
    }
    // 설정 스크립트가 있으면 시작 화면을 건너뛰고 그 타일에서 스크립트 → (성공하면) 에이전트(2026-09-28). 없으면 여는
    // 길과 같다 — 설정이 `auto` 면 시작 화면(대화가 아직 없는 폴더도 — 2026-09-27).
    const pane = hasSetupScript(p)
      ? await setupPaneFor(p, added.path, true)
      : await localPaneFor(p, added.path);
    openInNewTab(pane, title, added.path, p.id);
    recordProjectFolderOpen(p, added.path, name.trim());
    // 독 트리가 이 프로젝트를 읽어 둔 적이 있으면 새 줄이 곧바로 서게 다시 읽는다(한 번 — 폴링 아님).
    if (worktreesOf(p.id)) void loadWorktrees(p);
    const where = added.path;
    // 있던 브랜치 · 원격 추적에서 받은 브랜치 · 새 브랜치 — 판정은 Rust `worktree_branch::plan_add`(2026-10-05).
    const key = added.tracked
      ? "app.projects.worktree.tracked"
      : added.branch_created
        ? "app.projects.worktree.created"
        : "app.projects.worktree.checkedOut";
    const message = t(key, { branch: added.branch, remote: added.tracked ?? "", path: where });
    toast.success(
      instructionFiles > 0
        ? t("app.projects.worktree.instructionsApplied", { message, count: instructionFiles })
        : message,
      {
        action: {
          label: t("app.projects.worktree.reveal"),
          run: () => void revealItemInDir(where).catch(() => {}),
        },
      },
    );
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * **로컬** 새 워크트리 앞의 관문 — 저장소에 **커밋이 없으면** 확인 상자("첫 커밋이 없습니다 … [첫 커밋 만들고
 * 계속]")를 띄우고, 누르면 빈 첫 커밋을 만든다(docs/log/2026-09-28-project-create.md). 계속해도 되면
 * `true`. 커밋이 이미 있거나 · 모르면(판정 실패) 그대로 `true` 다 — 막을 근거가 없는 곳에서 막지 않는다. 확인 상자를
 * 못 띄우면 멈춘다(호스트 제거와 같은 규칙). 원격은 이 관문을 지나지 않는다 — 새 타일이 접속한 뒤 그 타일의 막대로
 * 묻는다(2026-09-29 B안 · `Terminal.svelte` 의 `wtPrep`).
 */
async function ensureFirstCommit(p: Project): Promise<boolean> {
  const host = null;
  const status = await repoStatusOf(host, p.path);
  if (status?.kind !== "noCommit") return true;
  let go = false;
  try {
    go = await askConfirm(t("app.projects.worktree.noCommit.confirm", { name: p.name }), {
      title: t("app.projects.worktree.noCommit.title"),
      kind: "warning",
      okLabel: t("app.projects.worktree.noCommit.ok"),
      cancelLabel: t("app.actions.cancel"),
    });
  } catch {
    showNotice(t("app.hosts.remove.noDialog"));
    return false;
  }
  if (!go) return false;
  try {
    await initRepoAt(host, p.path);
  } catch (e) {
    // 신원(`user.name`·`user.email`)이 없어 커밋하지 못하면 설정할 두 줄을 안내하고 멈춘다.
    repoFailureNotice(e);
    return false;
  }
  if (worktreesOf(p.id)) void loadWorktrees(p);
  return true;
}

/**
 * 독의 [git 저장소로 초기화] — 저장소가 아닌 프로젝트 폴더를 `git init` + 빈 첫 커밋으로 만들고
 * 워크트리 목록을 다시 읽는다(주 폴더 줄이 곧바로 선다). 실패는 git 의 한 줄을 알림으로.
 */
export async function initProjectRepo(p: Project): Promise<void> {
  try {
    const r = await initRepoAt(isRemote(p) ? p.host : null, p.path);
    toast.success(t("app.projects.repo.initialized", { name: p.name, branch: r.branch || "main" }));
  } catch (e) {
    repoFailureNotice(e);
  }
  void loadWorktrees(p);
}

/**
 * 이미 있는 워크트리를 **지금 탭**에 연다 — 독 트리의 줄 메뉴 "열기"(프로젝트 "열기" 와 같은 자리
 * 잡기). Enter·더블클릭·"열기" 는 아래 [`openProjectWorktree`] 다.
 */
export async function openProjectWorktreeHere(p: Project, w: WorktreeInfo): Promise<void> {
  const title = projectTabTitle(p, w);
  if (!isRemote(p)) openPaneHere(await localPaneFor(p, w.path), title, p.id);
  else openPaneHere(await remotePaneFor(p, w.path), title, p.id);
  recordProjectFolderOpen(p, w.path, w.branch);
}

/** 워크트리 폴더를 탐색기에서 고른 채 연다 (로컬만 — 새 워크트리 알림의 [폴더 열기] 와 같은 길) */
export async function revealWorktree(p: Project, w: WorktreeInfo): Promise<void> {
  if (isRemote(p)) return;
  try {
    await revealItemInDir(w.path);
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/** 이미 있는 워크트리를 연다 — 새 탭, 그 폴더에서 프로젝트의 시작 명령 */
export async function openProjectWorktree(p: Project, w: WorktreeInfo): Promise<void> {
  // 탭 제목 — 주 폴더면 프로젝트 이름, 워크트리면 브랜치(사람이 부르는 이름 · 분리된 HEAD 면 폴더 꼬리)
  const title = projectTabTitle(p, w);
  await openProjectFolder(p, w.path, title);
  recordProjectFolderOpen(p, w.path, w.branch);
}

// ---------------------------------------------------------------------------
// 원격 에이전트 훅 (docs/log/2026-09-24-remote-agent-signals.md "원격 훅 설치" ·
// docs/log/2026-09-26-codex-hooks.md — 에이전트는 `target` 하나로 갈린다)
// ---------------------------------------------------------------------------

/**
 * **원격에 <에이전트> 훅 설치** — 그 호스트에 붙은 세션이 있어야 한다(워크트리 목록과 같은 관문 —
 * 설치하려고 새 접속을 열지 않는다). 확인 창·쓰기·완료 알림은 옛 판 훅 알림의 [다시 설치…] 와 같은
 * 몸통([`installRemoteHooksOn`] · `remote-hooks.ts`)이다.
 */
export async function installRemoteHooks(p: Project, target: AgentHooksTarget): Promise<void> {
  if (!isRemote(p)) return;
  const id = liveSessionFor(p.host);
  if (id === null) {
    toast.info(t("app.projects.hooks.needSession"));
    return;
  }
  await installRemoteHooksOn(id, p.host, target);
}

/**
 * **원격 <에이전트> 훅 제거** — 우리 항목만 빼고, 다른 에이전트가 쓰지 않으면 스크립트도 지운다(로컬
 * 제거처럼 확인 없이).
 */
export async function removeRemoteHooks(p: Project, target: AgentHooksTarget): Promise<void> {
  if (!isRemote(p)) return;
  const id = liveSessionFor(p.host);
  if (id === null) {
    toast.info(t("app.projects.hooks.needSession"));
    return;
  }
  try {
    await setAgentHooksRemote(id, target.id, false);
    toast.success(t("app.projects.hooks.done.remove", { alias: p.host, agent: target.display }));
  } catch (e) {
    showNotice(t("app.projects.hooks.failed", { reason: stripReason(e instanceof Error ? e.message : String(e)) }));
  }
}

/** 독 트리가 그리는 것 — 규칙은 순수 층(`$lib/projects`)에 있고 여기서는 다시 내보낸다 */
export type { WorktreeListing };


/**
 * 제거 확인 상자의 상태 (모달은 `WorktreeRemoveDialog.svelte`) — 열려 있지 않으면 `null`.
 *
 * 확인 상자(`askConfirm`)를 쓰지 않는 이유: "브랜치도 삭제" **칸**이 있어야 한다(docs/log/
 * 2026-09-24-worktrees.md "브랜치는 같이 지운다"). 칸의 모양은 순수 층 [`branchDeleteOption`] 이 정한다.
 */
interface RemoveDialog {
  project: Project;
  worktree: WorktreeInfo;
  option: BranchDeleteOption;
  /** 칸의 값 — `delete` 면 켜진 채로 연다(기본), `remote`·`merged` 는 꺼진 채로, 나머지는 늘 `false` */
  deleteBranch: boolean;
  /** 원격이면 여는 순간 잡은 세션 — 제거는 그 전송로로 간다 */
  sessionId: number | null;
  /**
   * "이 워크트리에 열린 탭 N개도 닫기" 칸의 값 — **기본 켬**(docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md).
   * 칸은 닫을 탭이 있을 때만 보이고([`worktreeRemoveTabs`]), 탭 목록은 그리는 순간·누르는 순간마다 다시 센다.
   */
  closeTabs: boolean;
  busy: boolean;
}

let removeDialog = $state<RemoveDialog | null>(null);

/** 제거 확인 상자가 그리는 값 (반응형) */
export function worktreeRemoveDialog(): RemoveDialog | null {
  return removeDialog;
}

/**
 * 제거 상자가 그리는 탭 수 — 이 창에서 **모든 타일이** 그 워크트리 안인 탭(`close`)과, 그 워크트리 타일이 다른
 * 폴더 타일과 섞인 탭의 수(`mixed` — 남긴다). 상자가 열려 있지 않으면 0 · 0. 반응형
 */
export function worktreeRemoveTabs(): { close: string[]; mixed: number } {
  const d = removeDialog;
  return d ? worktreeTabsOf(d.project, d.worktree.path) : { close: [], mixed: 0 };
}

/** "열린 탭도 닫기" 칸 */
export function setRemoveCloseTabs(on: boolean): void {
  if (removeDialog && !removeDialog.busy) removeDialog.closeTabs = on;
}

/** 전역 키가 쉬어야 하는가 — 화면을 덮는 확인 상자다 (`app/keys.svelte.ts` 의 목록) */
export function worktreeRemoveOpen(): boolean {
  return removeDialog !== null;
}

/**
 * **워크트리 제거** — 확인 상자를 연다. 저장소의 지금 브랜치는 트리 사본의 첫 줄(git 의 첫 덩어리
 * = 주 작업 폴더)에서 읽는다 — 사본이 없으면 모르는 채로 두고 Rust 가 다시 가른다(`main`).
 *
 * **원격**은 그 호스트에 붙은 세션이 있어야 한다(목록과 같은 길 — 지우려고 새 접속을 열지 않는다).
 * 없으면 알림 한 줄로 끝이다. 칸은 앱이 만든 브랜치(곁 파일의 원격 줄 — 2026-09-29 B안)면 로컬처럼 **켜진 채**,
 * 기록이 없으면 **꺼진 채**로 연다(`remote` — docs/log/2026-09-24-worktrees.md "원격 제거").
 */
export function confirmRemoveWorktree(p: Project, w: WorktreeInfo): void {
  const remote = isRemote(p);
  const sessionId = remote ? liveSessionFor(p.host) : null;
  if (remote && sessionId === null) {
    toast.info(t("app.projects.worktrees.remove.needSession"));
    return;
  }
  const listing = worktreesOf(p.id);
  const primaryBranch = listing?.state === "ok" ? (listing.list[0]?.branch ?? null) : null;
  // 병합됨 = 독의 칩과 같은 사본(`worktreeChangesOf`) — 아직 모르면 병합 안 됨으로 본다(칸은 흐린 채).
  const merged = worktreeChangesOf(p.id, w.path)?.merged === true;
  const option = branchDeleteOption(w, primaryBranch, remote, merged);
  rememberFocusOrigin(REMOVE_FOCUS_KEY);
  removeDialog = {
    project: p,
    worktree: w,
    option,
    deleteBranch: branchDeleteDefault(option),
    sessionId,
    closeTabs: true,
    busy: false,
  };
}

/** "브랜치도 삭제" 칸 — 흐린 칸(`predates`)·숨은 칸은 바뀌지 않는다(`merged` 는 바뀐다) */
export function setRemoveDeleteBranch(on: boolean): void {
  if (removeDialog && branchDeleteToggleable(removeDialog.option)) removeDialog.deleteBranch = on;
}

export function cancelRemoveWorktree(): void {
  if (removeDialog?.busy) return;
  removeDialog = null;
  returnFocus(REMOVE_FOCUS_KEY);
}

/**
 * [제거] — 로컬은 `git_worktree_remove(repo, path, deleteBranch)`, 원격은 연 순간 잡은 세션으로
 * `ssh_git_worktree_remove(id, repo, path, deleteBranch)`(명령 글자는 Rust 가 짓는다). 둘 다
 * `--force` 없이, 브랜치는 `-d` 로만. git 이 거절하면(커밋하지 않은 변경) 그 한 줄이 알림으로
 * 뜨고 브랜치는 그대로다. 지웠으면 브랜치 갈래를 한 줄로 말하고([`worktreeRemovedToast`]) 트리를
 * 다시 읽는다.
 *
 * **"열린 탭도 닫기" 칸이 켜져 있으면** 그 탭들을 평소 탭 닫기 길([`closeTabsAsked`] — 저장 안 한 문서 · 잠긴
 * 타일은 거기서 그대로 묻는다)로 닫는다(docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md). 순서가 갈린다:
 * - **로컬은 닫고 나서 지운다** — Windows 에서는 그 폴더 안에 선 셸이 살아 있으면 `git worktree remove` 가 폴더를
 *   못 지운다. 닫은 셸의 종료(ConPTY)는 즉시가 아니라 잠깐([`TAB_CLOSE_SETTLE_MS`]) 기다린다. 묻는 대화에서 취소하면
 *   아무것도 지우지 않고 상자로 돌아온다. 그 뒤 제거가 실패하면 알림에 "탭은 닫았다" 를 덧붙인다.
 * - **원격은 지우고 나서 닫는다** — 제거가 그 호스트에 붙은 세션으로 가는데, 그 세션이 닫을 탭 안에 있을 수 있다.
 *   원격(리눅스)은 셸이 서 있어도 폴더가 지워진다. 실패하면 탭은 그대로 둔다. 닫기는 평소 탭 닫기와 같아 tmux 세션은
 *   죽이지 않는다(붙어 있던 것만 떨어진다).
 */
export async function submitRemoveWorktree(): Promise<void> {
  const d = removeDialog;
  if (!d || d.busy) return;
  d.busy = true;
  const { project: p, worktree: w } = d;
  const deleteBranch = branchDeleteToggleable(d.option) && d.deleteBranch;
  const tabIds = d.closeTabs ? worktreeTabsOf(p, w.path).close : [];
  const remote = d.sessionId !== null;
  let closedTabs = 0;
  if (!remote && tabIds.length > 0) {
    const closed = await closeTabs(tabIds);
    if (closed === null) {
      // 묻는 대화에서 취소했다 — 아무것도 지우지 않고 상자로 돌아온다(칸을 끄고 다시 누를 수 있게).
      if (removeDialog === d) d.busy = false;
      return;
    }
    closedTabs = closed;
  }
  try {
    const raw = remote
      ? await invoke<unknown>("ssh_git_worktree_remove", {
          id: d.sessionId,
          repo: p.path,
          path: w.path,
          deleteBranch,
        })
      : await invoke<unknown>("git_worktree_remove", { repo: p.path, path: w.path, deleteBranch });
    const r = parseWorktreeRemoved(raw);
    removeDialog = null;
    returnFocus(REMOVE_FOCUS_KEY);
    if (!r.removed) {
      showNotice(withClosedTabs(r.message ?? t("app.projects.worktrees.remove.title"), closedTabs));
      return;
    }
    if (remote && tabIds.length > 0) await closeTabs(tabIds);
    const msg = worktreeRemovedToast(r);
    toast.success(t(msg.key, msg.params));
    void loadWorktrees(p);
  } catch (e) {
    removeDialog = null;
    returnFocus(REMOVE_FOCUS_KEY);
    showNotice(withClosedTabs(stripReason(e instanceof Error ? e.message : String(e)), closedTabs));
  }
}

/**
 * 닫은 셸이 실제로 끝나기를 기다리는 짧은 틈(ms) — `close_session` 은 ConPTY 자식을 죽이지만 커널이 거두는 데
 * 수십~수백 ms 가 든다(`pty.rs` 의 `close_session` 주석). 그 사이에 `git worktree remove` 가 돌면 Windows 에서 폴더가
 * 남는다. 로컬 세션 타일을 닫았을 때만 기다린다.
 */
const TAB_CLOSE_SETTLE_MS = 500;

/**
 * 그 탭들을 평소 탭 닫기 길로 닫는다 — 닫은 수, 묻는 대화에서 취소했으면 `null`. 기다리는 동안 이미 사라진 탭은
 * 닫힌 것으로 본다(`closeTabsAsked` 가 `false` 여도 남은 탭이 없으면 취소가 아니다).
 */
async function closeTabs(ids: readonly string[]): Promise<number | null> {
  const resident = () => residentWindowTabs().filter((tab) => ids.includes(tab.id));
  const before = resident();
  const local = before.some((tab) => listPanes(tab.root).some((pane) => pane.kind === "local"));
  const ok = await closeTabsAsked(ids);
  if (!ok && resident().length > 0) return null;
  if (local && before.length > 0) await new Promise((r) => setTimeout(r, TAB_CLOSE_SETTLE_MS));
  return before.length;
}

/** 실패 알림 — 탭을 이미 닫았으면 그 사실을 한 줄 덧붙인다 */
function withClosedTabs(message: string, closed: number): string {
  return closed > 0 ? `${message} · ${t("app.projects.worktrees.remove.tabsClosedNote", { count: closed })}` : message;
}

// ---------------------------------------------------------------------------
// 독 트리 — 워크트리 사본과 펼침 (docs/log/2026-09-24-worktrees.md "독의 트리")
// ---------------------------------------------------------------------------


/** 펼침 상태의 저장 이름 — 창·세션을 건너 남는 **보는 사람의 편의**라 `localStorage` 다 */
const EXPANDED_STORE_KEY = "aynx:projects:expanded";

let expanded = $state<Set<string>>(new Set());
let expandedRestored = false;

/**
 * 저장된 펼침을 한 번 읽어 온다 — 독이 마운트에서 부른다(모듈이 임포트되는 순간 저장소를 만지지
 * 않게, 그리고 `$derived` 안에서 상태를 쓰지 않게). 기본은 **접힘**이다. `localStorage` 는 언제든
 * 던진다(사생활 모드·저장소 차단) — 못 읽으면 전부 접힌 채로 뜬다.
 */
export function restoreExpandedProjects(): void {
  if (expandedRestored) return;
  expandedRestored = true;
  try {
    if (typeof localStorage !== "undefined") expanded = parseExpandedProjects(localStorage.getItem(EXPANDED_STORE_KEY));
  } catch {
    /* 못 읽어도 전부 접힌 채로 뜬다 */
  }
}

/** 펼친 프로젝트 id 들 (반응형) */
export function expandedProjects(): ReadonlySet<string> {
  return expanded;
}

/** 펼치거나 접는다 — 펼치는 순간 그 목록을 다시 읽는다(펼침 = 새로 보기) */
export function setProjectExpanded(p: Project, open: boolean): void {
  restoreExpandedProjects();
  const cur = expanded;
  if (cur.has(p.id) === open) {
    if (open) void loadWorktrees(p);
    return;
  }
  const next = new Set(cur);
  if (open) next.add(p.id);
  else next.delete(p.id);
  expanded = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(EXPANDED_STORE_KEY, JSON.stringify([...next]));
  } catch {
    /* 저장 못 해도 이번 창의 펼침은 산다 */
  }
  if (open) void loadWorktrees(p);
}

/**
 * **독이 보일 때 · 창이 돌아올 때 다시 읽기** (docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md) — 펼친 프로젝트들의
 * 워크트리 목록(과 그 뒤를 잇는 변경 배지)을 한 번 다시 읽는다. 셸에서 squash 병합한 뒤 독이 옛 `+N ↑N` 을 그대로
 * 보이던 일을 막는다. 시계는 없다 — 부르는 곳은 둘뿐이다(`ProjectList.svelte`: 프로젝트 칸이 보이게 될 때, 그 칸이 보이는
 * 채로 창이 `focus` 를 받을 때). 누구를 읽을지는 순수 층 [`refreshTargets`] 가 정한다: 로컬은 늘 · 원격은 붙은 세션이
 * 있을 때만 · 프로젝트마다 3초에 한 번 · 읽는 중이면 건너뜀. 읽기는 옛 목록을 지우지 않고 새 답으로 갈아 끼운다
 * ([`loadWorktrees`]) — 펼침 · 선택은 그대로다.
 */
export function refreshShownWorktrees(now: number = Date.now()): void {
  restoreExpandedProjects();
  const list = projectList();
  const { lastAt, inFlight } = worktreeReadState();
  const ids = refreshTargets(
    list.map((p) => ({ id: p.id, remote: isRemote(p), attached: isRemote(p) && liveSessionFor(p.host) !== null })),
    expanded,
    lastAt,
    inFlight,
    now,
  );
  for (const id of ids) {
    const p = list.find((x) => x.id === id);
    if (p) void loadWorktrees(p);
  }
}
