import { projectOpenPlan } from "$lib/project-locations";
import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
import { projectLocations, revealProjectLocation, worktreeTabsOf } from "$lib/app/project-locations.svelte.js";
// `isRemote` 는 이 파일에서 **원격 프로젝트** 판정(`$lib/projects`)이다 — 원격 창 표식은 이름을 갈라 들인다
import { invoke, isRemote as isRemoteWindow } from "../ipc";
import { dropProjectLocal, projects as projectList, putProjectLocal } from "$lib/app/project-list.svelte.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { dropProjectTemplates, projectTemplateCount } from "$lib/app/tab-templates.svelte.js";
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
  canRevealProjectFolder,
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

/** 프로젝트 층 — 여는 길 · 삭제 · 추가 · 편집 폼(docs/log/2026-09-24-projects.md) */

const FOCUS_KEY = "project-form";
const REMOVE_FOCUS_KEY = "worktree-remove";

// 부르는 쪽이 한 문으로 들어오게 다시 내보낸다
export {
  mountProjects,
  projectById,
  projects,
  refreshProjects,
  PROJECTS_CHANGED_EVENT,
} from "$lib/app/project-list.svelte.js";
export { listProjectWorktrees, loadWorktrees, worktreesOf } from "$lib/app/worktrees.svelte.js";
export { openInNewTab } from "$lib/app/tabs.svelte.js";

// ── 여는 길 ──

async function paneFor(p: Project): Promise<PaneSpec> {
  if (isRemote(p)) return remotePaneFor(p, p.path);
  return localPaneFor(p, p.path);
}

async function remotePaneFor(p: Project & { host: string }, folder: string): Promise<PaneSpec> {
  const start = await projectStartPaneFor(p.id, folder, p.host).catch(() => null);
  if (start) return start;
  return paneForWorktree(p, folder, null, remoteScrollback(p));
}

async function localPaneFor(p: Project, folder: string): Promise<PaneSpec> {
  const start = await projectStartPaneFor(p.id, folder).catch(() => null);
  if (start) return start;
  // 새 셸 단축키와 같은 판정
  const fallback = p.shell ? null : await defaultShellId().catch(() => null);
  return paneForWorktree(p, folder, fallback);
}

export async function openProjectHere(p: Project): Promise<void> {
  openPaneHere(await paneFor(p), p.name, p.id);
  recordProjectFolderOpen(p, p.path);
}

/** 현재 워크스페이스의 같은 위치를 먼저 찾는다 — 없으면 새 탭, 빈 시작 탭 하나뿐이면 재사용 */
async function openProjectFolder(p: Project, folder: string, title: string): Promise<void> {
  const plan = () => {
    const tab = activeTab();
    const lone = !!tab && tab.root.type === "leaf" && tab.root.pane.kind === "start" && !tab.root.pane.startProject;
    return projectOpenPlan(projectLocations(p, folder), currentWorkspaceId(), lone);
  };
  let target = plan();
  if (target.kind === "focus") { await revealProjectLocation(target.location); return; }
  const pane = isRemote(p) ? await remotePaneFor(p, folder) : await localPaneFor(p, folder);
  target = plan(); // 비동기 명세 조회 사이에 열린 탭도 중복 생성하지 않는다
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

/** 지난 대화의 범위 이름(`scopeLabelOf`)과 같은 관례 — 재개로 연 탭과 프로젝트로 연 탭이 같은 이름을 쓴다 */
function projectTabTitle(p: Project, w: WorktreeInfo): string {
  if (sameFolder(w.path, p.path)) return p.name;
  return worktreeTabTitle(p.name, w.branch ?? projectTail(w.path));
}

/** 확인 대화를 못 띄우면 지우지 않는다. 폴더 · 워크트리 · 열린 타일은 그대로다 */
export async function confirmRemoveProject(p: Project): Promise<void> {
  let go = false;
  const lines = setupScriptLines(p.setupScript);
  const records = isRemote(p) ? 0 : await worktreeSetupCount(p.path);
  const templates = await projectTemplateCount(p.id);
  const items = [t("app.projects.remove.item.settings")];
  if (lines > 0) items.push(t("app.projects.remove.item.script", { n: lines }));
  if (records > 0) items.push(t("app.projects.remove.item.records", { n: records }));
  if (templates > 0) items.push(t("app.projects.remove.item.templates", { n: templates }));
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
    dropProjectLocal(p.id);
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
    return; // 프로젝트가 남았으면 그 템플릿도 그대로
  }
  // 템플릿은 프로젝트를 지운 뒤에만 뺀다(사용자 결정)
  await dropProjectTemplates(p.id);
}

// ── 추가 · 편집 폼 ──

interface FormState {
  open: boolean;
  mode: "add" | "edit";
  /** 편집은 늘 `existing` */
  kind: "existing" | "create";
  draft: ProjectDraft;
  /** 새로 만들기의 부모 폴더 */
  parent: string;
  check: RepoCheck;
  /** 경로를 만지면 다시 선다 */
  checkDismissed: boolean;
  problem: ProjectDraftProblem | null;
  error: string | null;
  /** `error` 가 git 신원 없음일 때만 — `error` 를 채우는 자리가 늘 함께 정한다([`formErrorOf`]) */
  identity: "local" | "remote" | null;
  saving: boolean;
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

export function projectForm(): FormState {
  return form;
}

export function projectFormOpen(): boolean {
  return form.open;
}

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
  if (p) void checkRepoNow();
}

export function closeProjectForm(): void {
  form.open = false;
  form.saving = false;
  clearTimeout(checkTimer);
  checkSeq++;
  returnFocus(FOCUS_KEY);
}

export function setProjectFormKind(kind: "existing" | "create"): void {
  if (form.mode === "edit" || form.kind === kind) return;
  form.kind = kind;
  form.problem = null;
  form.error = null;
  if (kind === "existing") scheduleRepoCheck(0);
}

export function setProjectParent(value: string): void {
  form.parent = value;
  if (form.problem === "parent" || form.problem === "parentRelative" || form.problem === "worktreeDir") {
    form.problem = null;
  }
  form.error = null;
}

// ── 경로 확인 — 기존 폴더의 저장소 판정 ──

/** 늦게 온 옛 답이 새 경로의 줄을 덮지 않게 */
let checkSeq = 0;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
const CHECK_DEBOUNCE_MS = 450;

function currentCheckKey(): string {
  const d = form.draft;
  return repoCheckKey(d.location, d.host, d.path);
}

export function scheduleRepoCheck(delay = CHECK_DEBOUNCE_MS): void {
  clearTimeout(checkTimer);
  if (!form.open || form.kind !== "existing") return;
  const key = currentCheckKey();
  if (form.check.state !== "idle" && form.check.key === key) return;
  checkTimer = setTimeout(() => void checkRepoNow(), delay);
}

/** 원격인데 붙은 세션이 없으면 `unknown` */
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

/** 경고 한 줄일 뿐 — 저장은 막지 않는다 */
export function duplicateOfForm(): Project | null {
  if (form.kind !== "existing") return null;
  return duplicateProjectOf(projectList(), form.draft);
}

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
  // initAndAdd · commitAndAdd — 실패하면 저장은 안 한다
  if (form.saving) return;
  const d = form.draft;
  form.saving = true;
  form.error = null;
  try {
    await initRepoAt(d.location === "remote" ? d.host.trim() : null, d.path.trim());
  } catch (e) {
    formErrorOf(e);
    form.saving = false;
    // 초기화는 됐는데 커밋만 실패했을 수 있다
    form.check = { state: "idle" };
    void checkRepoNow();
    return;
  }
  form.saving = false;
  form.check = { state: "idle" };
  await submitProjectForm();
}

export function setProjectField<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]): void {
  form.draft[key] = value;
  if (form.problem === key || (key === "location" && form.problem === "host")) form.problem = null;
  if (form.problem === "worktreeDir" && (key === "path" || key === "location")) form.problem = null;
  if (form.problem === "pathRelative" && (key === "path" || key === "location")) form.problem = null;
  if (form.problem === "pathMissing" && (key === "path" || key === "location")) form.problem = null;
  // 새로 만들기의 이름은 곧 폴더 이름이다
  if (form.problem === "folderName" && key === "name") form.problem = null;
  if (key === "path" || key === "location") form.checkDismissed = false;
  form.error = null;
}

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
      if (form.draft.name.trim() === "") {
        const tail = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
        form.draft.name = tail;
      }
      if (form.problem === "path" || form.problem === "pathRelative" || form.problem === "pathMissing") {
        form.problem = null;
      }
      form.checkDismissed = false;
      void checkRepoNow();
    }
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

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

/** 기본 자리(`<저장소>-wt`)는 아직 없을 수 있다 — 대화상자가 가장 가까운 있는 폴더로 내려간다(플러그인 동작) */
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

/** 로컬 기존 폴더는 없으면 막는다 — 저장소가 아니거나 하위 폴더인 것은 경고일 뿐이다 */
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

/** 만들기가 실패하면 프로젝트는 넣지 않는다 — 만든 폴더 · 저장소는 남는다 */
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
  if (await saveDraft()) {
    toast.success(t("app.projects.repo.created", { path: made.path, branch: made.branch || "main" }));
  }
}

function formErrorOf(e: unknown): void {
  form.error = e instanceof Error ? e.message : String(e);
  form.identity = e instanceof GitIdentityError ? e.where : null;
}

export function gitIdentityLines(): [string, string] {
  return gitIdentityCommands(t("app.projects.repo.identity.name"), t("app.projects.repo.identity.email"));
}

/** `quiet` — 폼의 코드 블록은 단추 자리의 체크 아이콘이 알린다 */
export async function copyGitIdentityLines(quiet = false): Promise<boolean> {
  const ok = await writeClipboard(gitIdentityLines().join("\n"));
  if (!ok) showNotice(t("app.projects.repo.identity.copyFailed"));
  else if (!quiet) toast.success(t("app.projects.repo.identity.copied"));
  return ok;
}

function repoFailureNotice(e: unknown): void {
  if (!(e instanceof GitIdentityError)) {
    showNotice(e instanceof Error ? e.message : String(e));
    return;
  }
  // 붙여 넣을 전체 두 줄은 [명령 복사] 로만 준다
  toast.error(t(`app.projects.repo.identity.toast.${e.where}`), {
    sub: t("app.projects.repo.identity.toast.hint"),
    ms: 15000,
    action: { label: t("app.projects.repo.identity.copy"), run: () => void copyGitIdentityLines() },
  });
}

/** 검증은 부르는 쪽이 이미 했다 */
async function saveDraft(): Promise<boolean> {
  if (form.saving) return false;
  form.saving = true;
  try {
    const saved = parseProjects([
      await invoke<unknown>("project_upsert", {
        project: projectOfDraft(form.draft),
      }),
    ])[0];
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

// ── 워크트리 (docs/log/2026-09-24-worktrees.md) ──


async function agentDisplayName(agent: string | null): Promise<string | null> {
  if (!agent) return null;
  const clis = await knownAiClis().catch(() => []);
  return clis.find((c) => c.id === agent)?.name ?? agent;
}

/** 시작 화면을 건너뛴다 */
async function setupPaneFor(p: Project, folder: string, withAgent: boolean): Promise<PaneSpec> {
  const name = withAgent ? await agentDisplayName(p.agent) : null;
  if (isRemote(p)) return paneForSetup(p, folder, withAgent, name, null, remoteScrollback(p));
  const fallback = p.shell ? null : await defaultShellId().catch(() => null);
  return paneForSetup(p, folder, withAgent, name, fallback);
}

export async function runProjectSetupScript(p: Project, w: WorktreeInfo): Promise<void> {
  if (!hasSetupScript(p)) {
    showNotice(t("app.projects.setup.none"));
    return;
  }
  openPaneHere(await setupPaneFor(p, w.path, false), projectTabTitle(p, w), p.id);
}

export function editProjectSetup(projectId: string): void {
  const p = projectList().find((x) => x.id === projectId);
  if (!p) {
    showNotice(t("app.projects.setup.gone"));
    return;
  }
  openProjectForm(p);
  form.focusScript = true;
}

/** 비밀번호 모달이 대상을 말할 수 있게 기억해 둔다 */
function remoteScrollback(p: Project): number | null | undefined {
  if (!isRemote(p)) return undefined;
  const host = lookupHost(p.host);
  if (host) rememberTarget(host);
  return host?.meta?.scrollback;
}

export function worktreeNameError(name: string): string | null {
  const problem = worktreeNameProblem(name);
  if (problem === "empty") return t("app.projects.worktree.error.empty");
  if (problem === "invalid") return t("app.projects.worktree.error.invalid");
  return null;
}

/**
 * 원격은 여기서 왕복하지 않는다 — 타일이 접속한 뒤 첫 입력 전에 Rust(`remote_worktree::prepare`)가 만든다.
 * 다른 세션을 빌려 앞에서 묻는 관문은 두지 않는다(docs/log/2026-09-29-remote-worktree-after-connect.md).
 */
export async function openProjectInNewWorktree(p: Project, name: string): Promise<void> {
  const bad = worktreeNameError(name);
  if (bad) {
    showNotice(bad);
    return;
  }
  // 커밋 없는 저장소에서 그냥 만들면 git 이 main 과 이어지지 않는 고아 브랜치를 만든다
  if (!isRemote(p) && !(await ensureFirstCommit(p))) return;
  const title = worktreeTabTitle(p.name, name.trim());
  if (isRemote(p)) {
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
    // 에이전트가 뜨기 전에 새 폴더에 지침을 쓴다 — 실패해도 워크트리 열기는 계속한다
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
    const pane = hasSetupScript(p)
      ? await setupPaneFor(p, added.path, true)
      : await localPaneFor(p, added.path);
    openInNewTab(pane, title, added.path, p.id);
    recordProjectFolderOpen(p, added.path, name.trim());
    if (worktreesOf(p.id)) void loadWorktrees(p);
    const where = added.path;
    const key = added.tracked
      ? "app.projects.worktree.tracked"
      : added.branch_created
        ? "app.projects.worktree.created"
        : "app.projects.worktree.checkedOut";
    const message = t(key, { branch: added.branch, remote: added.tracked ?? "", path: where });
    const text =
      instructionFiles > 0
        ? t("app.projects.worktree.instructionsApplied", { message, count: instructionFiles })
        : message;
    if (!canRevealWorktree(p)) toast.success(text);
    else
      toast.success(text, {
        action: {
          label: t("app.projects.worktree.reveal"),
          run: () => void revealItemInDir(where).catch(() => {}),
        },
      });
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

/** 모르면(판정 실패) `true` — 막을 근거가 없는 곳에서 막지 않는다. 확인 상자를 못 띄우면 멈춘다 */
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
    repoFailureNotice(e);
    return false;
  }
  if (worktreesOf(p.id)) void loadWorktrees(p);
  return true;
}

export async function initProjectRepo(p: Project): Promise<void> {
  try {
    const r = await initRepoAt(isRemote(p) ? p.host : null, p.path);
    toast.success(t("app.projects.repo.initialized", { name: p.name, branch: r.branch || "main" }));
  } catch (e) {
    repoFailureNotice(e);
  }
  void loadWorktrees(p);
}

export async function openProjectWorktreeHere(p: Project, w: WorktreeInfo): Promise<void> {
  const title = projectTabTitle(p, w);
  if (!isRemote(p)) openPaneHere(await localPaneFor(p, w.path), title, p.id);
  else openPaneHere(await remotePaneFor(p, w.path), title, p.id);
  recordProjectFolderOpen(p, w.path, w.branch);
}

/** 로컬 프로젝트 + 메인 PC 창만 */
export function canRevealWorktree(p: Project): boolean {
  return canRevealProjectFolder(p, isRemoteWindow);
}

export async function revealWorktree(p: Project, w: WorktreeInfo): Promise<void> {
  if (!canRevealWorktree(p)) return;
  try {
    await revealItemInDir(w.path);
  } catch (e) {
    showNotice(stripReason(e instanceof Error ? e.message : String(e)));
  }
}

export async function openProjectWorktree(p: Project, w: WorktreeInfo): Promise<void> {
  const title = projectTabTitle(p, w);
  await openProjectFolder(p, w.path, title);
  recordProjectFolderOpen(p, w.path, w.branch);
}

// ── 원격 에이전트 훅 ──

/** 설치하려고 새 접속을 열지 않는다 — 붙은 세션이 있어야 한다 */
export async function installRemoteHooks(p: Project, target: AgentHooksTarget): Promise<void> {
  if (!isRemote(p)) return;
  const id = liveSessionFor(p.host);
  if (id === null) {
    toast.info(t("app.projects.hooks.needSession"));
    return;
  }
  await installRemoteHooksOn(id, p.host, target);
}

/** 로컬 제거처럼 확인 없이 */
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

export type { WorktreeListing };


/** `askConfirm` 을 쓰지 않는다 — "브랜치도 삭제" 칸이 있어야 한다 */
interface RemoveDialog {
  project: Project;
  worktree: WorktreeInfo;
  option: BranchDeleteOption;
  deleteBranch: boolean;
  /** 원격이면 여는 순간 잡은 세션 — 제거는 그 전송로로 간다 */
  sessionId: number | null;
  closeTabs: boolean;
  busy: boolean;
}

let removeDialog = $state<RemoveDialog | null>(null);

export function worktreeRemoveDialog(): RemoveDialog | null {
  return removeDialog;
}

/** `mixed` = 다른 폴더 타일과 섞인 탭 — 남긴다 */
export function worktreeRemoveTabs(): { close: string[]; mixed: number } {
  const d = removeDialog;
  return d ? worktreeTabsOf(d.project, d.worktree.path) : { close: [], mixed: 0 };
}

export function setRemoveCloseTabs(on: boolean): void {
  if (removeDialog && !removeDialog.busy) removeDialog.closeTabs = on;
}

export function worktreeRemoveOpen(): boolean {
  return removeDialog !== null;
}

/** 원격은 지우려고 새 접속을 열지 않는다 — 붙은 세션이 있어야 한다. 지금 브랜치를 모르면 Rust 가 다시 가른다 */
export function confirmRemoveWorktree(p: Project, w: WorktreeInfo): void {
  const remote = isRemote(p);
  const sessionId = remote ? liveSessionFor(p.host) : null;
  if (remote && sessionId === null) {
    toast.info(t("app.projects.worktrees.remove.needSession"));
    return;
  }
  const listing = worktreesOf(p.id);
  const primaryBranch = listing?.state === "ok" ? (listing.list[0]?.branch ?? null) : null;
  // 아직 모르면 병합 안 됨으로 본다
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

export function setRemoveDeleteBranch(on: boolean): void {
  if (removeDialog && branchDeleteToggleable(removeDialog.option)) removeDialog.deleteBranch = on;
}

export function cancelRemoveWorktree(): void {
  if (removeDialog?.busy) return;
  removeDialog = null;
  returnFocus(REMOVE_FOCUS_KEY);
}

/**
 * 탭 닫기 순서가 갈린다 — 로컬은 닫고 나서 지운다(Windows 는 그 폴더에 선 셸이 살아 있으면 폴더를 못 지운다).
 * 원격은 지우고 나서 닫는다 — 제거가 가는 세션이 닫을 탭 안에 있을 수 있다(docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md).
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
      // 묻는 대화에서 취소했다 — 아무것도 지우지 않고 상자로 돌아온다
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

/** ConPTY 자식을 커널이 거두는 데 수십~수백 ms 가 든다 — 그 사이 `git worktree remove` 가 돌면 Windows 에서 폴더가 남는다 */
const TAB_CLOSE_SETTLE_MS = 500;

/** 묻는 대화에서 취소했으면 `null` — `closeTabsAsked` 가 `false` 여도 남은 탭이 없으면 취소가 아니다 */
async function closeTabs(ids: readonly string[]): Promise<number | null> {
  const resident = () => residentWindowTabs().filter((tab) => ids.includes(tab.id));
  const before = resident();
  const local = before.some((tab) => listPanes(tab.root).some((pane) => pane.kind === "local"));
  const ok = await closeTabsAsked(ids);
  if (!ok && resident().length > 0) return null;
  if (local && before.length > 0) await new Promise((r) => setTimeout(r, TAB_CLOSE_SETTLE_MS));
  return before.length;
}

function withClosedTabs(message: string, closed: number): string {
  return closed > 0 ? `${message} · ${t("app.projects.worktrees.remove.tabsClosedNote", { count: closed })}` : message;
}

// ── 독 트리 — 워크트리 사본과 펼침 ──


const EXPANDED_STORE_KEY = "aynx:projects:expanded";

let expanded = $state<Set<string>>(new Set());
let expandedRestored = false;

/** 마운트에서 부른다 — 임포트 순간 저장소를 만지지 않게, `$derived` 안에서 상태를 쓰지 않게 */
export function restoreExpandedProjects(): void {
  if (expandedRestored) return;
  expandedRestored = true;
  try {
    if (typeof localStorage !== "undefined") expanded = parseExpandedProjects(localStorage.getItem(EXPANDED_STORE_KEY));
  } catch {
    /* 못 읽어도 전부 접힌 채로 뜬다 */
  }
}

export function expandedProjects(): ReadonlySet<string> {
  return expanded;
}

/** 펼침 = 새로 보기 — 펼치는 순간 그 목록을 다시 읽는다 */
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

/** 시계로 다시 읽지 않는다 — 독이 보일 때 · 창이 돌아올 때만 부른다 */
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
