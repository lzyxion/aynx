import { newLocalPane, newSshPane, type PaneSpec } from "$lib/session";
import { historyOf, type HostHistory } from "$lib/host-history";
import { compareNames, compareRecent } from "$lib/list-order";
import type { Key } from "$lib/i18n/keys";
import { newProjectPath, projectFolderNameProblem } from "$lib/repo-status";

/**
 * 프로젝트를 열어도 새 타일 종류가 아니다 — 로컬이면 AI 타일과 같은 로컬 셸, 원격이면 여느 SSH 타일에 첫 입력 재료를 실은 것이다.
 * 룬 · Tauri 왕복이 없는 순수 모듈이다 — vitest 가 `environment: "node"` 라 `.svelte.ts` 를 못 들인다.
 */

/** Rust `projects::Project` 와 1:1 */
export interface Project {
  id: string;
  name: string;
  host: string | null;
  /** 원격이면 그 서버의 경로(`~/…` 허용) */
  path: string;
  shell: string | null;
  /** Rust `agent_args::TARGETS` 의 id, `null` 이면 셸만 */
  agent: string | null;
  /** 이 글자는 폼만 다룬다 — 돌리는 줄은 Rust 가 `projects.json` 에서 직접 읽어 짓는다 */
  setupScript: string;
  /** Rust `projects::ProjectMigration` — 폼을 저장하면 사라진다 */
  migration: ProjectMigration | null;
  tmux: boolean;
  /** `null` 이면 [`defaultWorktreeDir`]. Rust `projects::Project.worktree_dir` 와 1:1 */
  worktreeDir: string | null;
  /** 옛 사본 · 테스트 픽스처가 칸 없이 와도 되게 선택 칸이다 — [`parseProjects`] 는 늘 채운다 */
  icon?: string | null;
  color?: string | null;
}

/** `args` 남은 인자는 설정 › AI 추가 인자로 · `script` 명령을 설정 스크립트로 옮김 · `dropped` 설정 스크립트가 이미 있어 못 옮김 */
export interface ProjectMigration {
  kind: "args" | "script" | "dropped";
  text: string;
}

export const DEFAULT_PROJECT_AGENT = "claude";

/** 옛 파일에 `command` 칸이 없던 줄의 기본값 — Rust `projects::LEGACY_DEFAULT_COMMAND` */
const LEGACY_DEFAULT_COMMAND = "claude";

/** id 가 곧 첫 실행 파일 이름이다 — Rust `agent_args` 의 테스트가 표의 모든 줄에서 `exes[0] == id` 를 고정한다 */
export function agentCommand(agent: string): string {
  return agent;
}

/** Rust `agent_args::TARGETS` 의 `exes` 와 같은 글자 — Rust 가 읽을 때 이미 옮겨 주므로 옛 백엔드 대비 방어일 뿐이다 */
const LEGACY_AGENT_EXES: Record<string, readonly string[]> = {
  claude: ["claude", "claude.exe", "claude.cmd"],
  codex: ["codex", "codex.exe", "codex.cmd"],
};

/** Rust `projects::migrate_command` 와 같은 표 — 두 테스트가 같은 줄들을 본다 */
export function migrateProjectCommand(
  command: string,
  setupScript: string,
): { agent: string | null; setupScript: string; migration: ProjectMigration | null } {
  const cmd = command.trim();
  if (cmd === "") return { agent: null, setupScript, migration: null };
  const first = cmd.split(/\s+/)[0].toLowerCase();
  const agent = Object.keys(LEGACY_AGENT_EXES).find((id) => LEGACY_AGENT_EXES[id].includes(first)) ?? null;
  if (agent) {
    const rest = cmd.slice(cmd.split(/\s+/)[0].length).trim();
    return { agent, setupScript, migration: rest ? { kind: "args", text: rest } : null };
  }
  if (setupScript.trim() === "") return { agent: null, setupScript: cmd, migration: { kind: "script", text: cmd } };
  return { agent: null, setupScript, migration: { kind: "dropped", text: cmd } };
}

function parseMigration(v: unknown): ProjectMigration | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if ((kind === "args" || kind === "script" || kind === "dropped") && typeof o.text === "string") {
    return { kind, text: o.text };
  }
  return null;
}

export function hasSetupScript(p: Pick<Project, "setupScript">): boolean {
  return p.setupScript.trim() !== "";
}

/** Rust `projects::script_lines` 와 같다 — 빈 줄은 세지 않는다 */
export function setupScriptLines(script: string): number {
  return script.split(/\r?\n/).filter((l) => l.trim() !== "").length;
}

/** 로컬은 셸 id 로 — Rust `setup_script::shell_of` 와 같은 표(모르면 PowerShell) */
export type SetupShellKind = "powershell" | "cmd" | "posix";

export function setupShellKind(shellId: string | null, remote: boolean): SetupShellKind {
  if (remote) return "posix";
  if (shellId === "cmd") return "cmd";
  if (shellId === "gitbash" || shellId?.startsWith("wsl:")) return "posix";
  return "powershell";
}

export function setupRootVar(kind: SetupShellKind): string {
  if (kind === "powershell") return "$env:AYNX_ROOT_PATH";
  if (kind === "cmd") return "%AYNX_ROOT_PATH%";
  return "$AYNX_ROOT_PATH";
}

/** 호스트 짐(`HOSTS_DRAG_TYPE`)에 칸을 더하지 않는다 — 그 짐을 받는 곳은 전부 접속 · 이동으로 읽는다 */
export const PROJECT_DRAG_TYPE = "application/x-aynx-project";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** 절대 throw 하지 않는다 — 모양이 어긋난 줄만 버린다. 같은 id 는 앞의 것이 이긴다 */
export function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id);
    const name = str(o.name);
    const path = str(o.path);
    if (!id || !name || !path || seen.has(id)) continue;
    seen.add(id);
    const host = str(o.host);
    const script = typeof o.setupScript === "string" ? o.setupScript : "";
    // `agent` 칸이 있으면(값이 null 이어도) 새 모양 — 없으면 옛 `command` 를 옮긴다(Rust 가 이미 옮겨 주지만 방어).
    const moved =
      "agent" in o
        ? { agent: str(o.agent), setupScript: script, migration: parseMigration(o.migration) }
        : migrateProjectCommand(typeof o.command === "string" ? o.command : LEGACY_DEFAULT_COMMAND, script);
    out.push({
      id,
      name,
      host,
      path,
      shell: host ? null : str(o.shell),
      agent: moved.agent,
      setupScript: moved.setupScript,
      migration: moved.migration,
      tmux: host ? o.tmux !== false : false,
      worktreeDir: str(o.worktreeDir),
      icon: str(o.icon),
      color: str(o.color),
    });
  }
  return out;
}

export function isRemote<T extends Pick<Project, "host">>(p: T): p is T & { host: string } {
  return p.host !== null && p.host.trim() !== "";
}

/** 원격 창은 메인 PC 의 탐색기를 띄우지 못한다(폴리필이 `opener|reveal_item_in_dir` 를 거절) */
export function canRevealProjectFolder(p: Pick<Project, "host">, remoteWindow: boolean): boolean {
  return !isRemote(p) && !remoteWindow;
}

export function projectLabel(p: Project): string {
  return p.name;
}

export function projectTail(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (trimmed === "") return path.trim();
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i < 0 ? trimmed : trimmed.slice(i + 1) || trimmed;
}

export function projectSearchText(p: Project): string {
  return `${p.name} ${p.path} ${p.host ?? ""}`;
}

/**
 * 여는 길(독 · 팔레트 · 즐겨찾기)이 전부 이것을 지난다. 로컬은 AI 타일(`newAiPane`)과 같은 칸이라 같은 autorun 문 · MCP 토큰 규칙을 지난다.
 * 원격 tmux 는 프로젝트의 토글 하나가 정한다(호스트 설정과 무관): 켜면 `forceTmux`, 끄면 `noTmux`.
 */
export function paneForProject(
  p: Project,
  shellFallback?: string | null,
  scrollback?: number | null,
): PaneSpec {
  const command = p.agent ? agentCommand(p.agent) : "";
  if (isRemote(p)) {
    const pane = newSshPane(p.host, scrollback);
    pane.cwd = p.path;
    if (command !== "") pane.autorun = command;
    if (p.tmux) pane.forceTmux = true;
    else pane.noTmux = true;
    return pane;
  }
  const pane = newLocalPane(p.shell ?? shellFallback ?? undefined);
  pane.cwd = p.path;
  if (command !== "") {
    pane.autorun = command;
    pane.injectMcpToken = true;
  }
  return pane;
}

/**
 * 로컬은 `autorun` 없이 연다 — 에이전트는 스크립트의 끝 신호를 받은 터미널이 띄운다.
 * MCP 토큰 표식은 세션을 열 때 심어야 하므로 에이전트가 뜰 수 있으면 미리 켠다.
 */
export function paneForSetup(
  p: Project,
  folder: string,
  withAgent: boolean,
  agentName: string | null,
  shellFallback?: string | null,
  scrollback?: number | null,
): PaneSpec {
  const agent = withAgent ? p.agent : null;
  const setup = { projectId: p.id, repo: p.path, agent, agentName: agent ? agentName : null };
  if (isRemote(p)) {
    const pane = paneForProject({ ...p, path: folder, agent }, null, scrollback);
    pane.setup = setup;
    return pane;
  }
  const pane = newLocalPane(p.shell ?? shellFallback ?? undefined);
  pane.cwd = folder;
  if (agent) pane.injectMcpToken = true;
  pane.setup = setup;
  return pane;
}

/** 정렬 값은 호스트 독과 같은 칸(`[hosts] sort`)이다 — `recent` 는 원격의 그 호스트 마지막 성공 접속 순(프로젝트 자신의 연 시각은 적지 않는다) */
export function sortProjects(
  list: readonly Project[],
  mode: "name" | "recent",
  history: HostHistory,
): Project[] {
  const byName = (a: Project, b: Project) => compareNames(a.name, b.name);
  if (mode === "name") return [...list].sort(byName);
  const at = (p: Project) => (isRemote(p) ? (historyOf(history, p.host)?.last_ok_at ?? null) : null);
  return [...list].sort((a, b) => compareRecent(at(a), at(b)) || byName(a, b));
}

// ── 폼 — 추가 · 편집 모달이 쥐는 초안 ──

export interface ProjectDraft {
  /** 추가면 빈 글자(백엔드가 새로 뽑는다) */
  id: string;
  name: string;
  location: "local" | "remote";
  host: string;
  path: string;
  agent: string | null;
  shell: string;
  tmux: boolean;
  worktreeDir: string;
  setupScript: string;
  migration: ProjectMigration | null;
  icon: string;
  color: string;
}

export function emptyDraft(): ProjectDraft {
  return {
    id: "",
    name: "",
    location: "local",
    host: "",
    path: "",
    agent: DEFAULT_PROJECT_AGENT,
    shell: "",
    tmux: true,
    worktreeDir: "",
    setupScript: "",
    migration: null,
    icon: "",
    color: "",
  };
}

export function draftOf(p: Project): ProjectDraft {
  return {
    id: p.id,
    name: p.name,
    location: isRemote(p) ? "remote" : "local",
    host: p.host ?? "",
    path: p.path,
    agent: p.agent,
    shell: p.shell ?? "",
    // 로컬에는 tmux 가 없지만 초안에서는 켠 채로 둔다 — 원격으로 바꾸면 기본값(켬)이 맞다.
    tmux: isRemote(p) ? p.tmux : true,
    worktreeDir: p.worktreeDir ?? "",
    setupScript: p.setupScript,
    migration: p.migration,
    icon: p.icon ?? "",
    color: p.color ?? "",
  };
}

/** 칸 이름이 곧 문구 키의 꼬리다(`app.projects.form.error.<칸>`) */
export type ProjectDraftProblem =
  | "name"
  | "host"
  | "path"
  | "pathRelative"
  | "pathMissing"
  | "worktreeDir"
  | "folderName"
  | "parent"
  | "parentRelative";

/** 순서가 곧 내비의 위에서 아래다 */
export type ProjectFormTab = "general" | "worktree" | "display";
export const PROJECT_FORM_TABS = ["general", "worktree", "display"] as const satisfies readonly ProjectFormTab[];

export function projectFormTabOf(problem: ProjectDraftProblem | null | undefined): ProjectFormTab | null {
  if (problem === null || problem === undefined) return null;
  return problem === "worktreeDir" ? "worktree" : "general";
}

/** `ProjectForm.svelte` 의 id 그대로 */
export function projectProblemFieldId(problem: ProjectDraftProblem): string {
  switch (problem) {
    case "name":
    case "folderName":
      return "project-name";
    case "host":
      return "project-host";
    case "path":
    case "pathRelative":
    case "pathMissing":
      return "project-path";
    case "parent":
    case "parentRelative":
      return "project-parent";
    case "worktreeDir":
      return "project-worktree-dir";
  }
}

export function validateDraft(d: ProjectDraft): ProjectDraftProblem | null {
  if (d.name.trim() === "") return "name";
  if (d.location === "remote" && d.host.trim() === "") return "host";
  if (d.path.trim() === "") return "path";
  // 로컬은 절대 경로만 — `~`·상대 경로는 셸 없이 여는 로컬 타일에서 펴지지 않는다. Rust `normalize` 와 같은 표.
  if (d.location === "local" && !isAbsoluteLocalPath(d.path)) return "pathRelative";
  const wt = d.worktreeDir.trim();
  if (wt !== "" && worktreeDirProblem(d.path, wt, d.location === "remote") !== null) {
    return "worktreeDir";
  }
  return null;
}

export function validateCreateDraft(d: ProjectDraft, parent: string): ProjectDraftProblem | null {
  if (d.name.trim() === "") return "name";
  if (projectFolderNameProblem(d.name) !== null) return "folderName";
  if (d.location === "remote" && d.host.trim() === "") return "host";
  const par = parent.trim();
  if (par === "") return "parent";
  const remote = d.location === "remote";
  if (remote ? !(par.startsWith("/") || par === "~" || par.startsWith("~/")) : !isAbsoluteLocalPath(par)) {
    return "parentRelative";
  }
  const wt = d.worktreeDir.trim();
  const target = newProjectPath(par, d.name, remote) ?? "";
  if (wt !== "" && worktreeDirProblem(target, wt, remote) !== null) return "worktreeDir";
  return null;
}

/** 폼의 경고 한 줄일 뿐 저장은 막지 않는다 */
export function duplicateProjectOf(list: readonly Project[], d: ProjectDraft): Project | null {
  if (d.path.trim() === "") return null;
  const remote = d.location === "remote";
  const host = d.host.trim().toLowerCase();
  return (
    list.find(
      (p) =>
        p.id !== d.id &&
        isRemote(p) === remote &&
        (!remote || p.host?.trim().toLowerCase() === host) &&
        sameFolder(p.path, d.path),
    ) ?? null
  );
}

/** Rust `normalize` 와 같은 규칙 — 이관 안내는 싣지 않는다(폼으로 저장한 것이 곧 사람이 읽었다는 뜻 · Rust 도 저장에서 지운다) */
export function projectOfDraft(d: ProjectDraft): Project {
  const remote = d.location === "remote";
  return {
    id: d.id,
    name: d.name.trim(),
    host: remote ? d.host.trim() : null,
    path: d.path.trim(),
    shell: remote ? null : d.shell.trim() || null,
    agent: d.agent,
    setupScript: d.setupScript.trim() === "" ? "" : d.setupScript,
    migration: null,
    tmux: remote ? d.tmux : false,
    worktreeDir: d.worktreeDir.trim() || null,
    icon: d.icon.trim() || null,
    color: d.color.trim() || null,
  };
}

// ── 워크트리 ──

/** Rust `worktree::WorktreeInfo` 와 1:1 */
export interface WorktreeInfo {
  /** git 이 적은 그대로 — Windows 에서도 `/` 구분자일 수 있다 */
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
  detached: boolean;
  /** Rust 곁 파일 `worktrees.json` 의 `created_by_app` — 모르면(셸에서 만든 것 · 옛 백엔드) `false`: 모르면 지우지 않는 쪽 */
  createdByApp?: boolean;
}

export function parseWorktrees(raw: unknown): WorktreeInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: WorktreeInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const path = str(o.path);
    if (!path || o.bare === true) continue;
    out.push({
      path,
      branch: str(o.branch),
      head: str(o.head),
      bare: false,
      detached: o.detached === true,
      createdByApp: o.created_by_app === true,
    });
  }
  return out;
}

// ── 워크트리 제거 ──

/** Rust `worktree::KeptReason` 과 같은 글자 */
export type BranchKeptReason = "unmerged" | "predates" | "not_requested" | "main";

/** Rust `worktree::WorktreeRemoved` 와 1:1 */
export interface WorktreeRemoved {
  /** `false` = git 이 워크트리 제거를 거절했다 — `message` 가 그 한 줄 */
  removed: boolean;
  branch: string | null;
  branchDeleted: boolean;
  branchKeptReason: BranchKeptReason | null;
  message: string | null;
}

const KEPT_REASONS: readonly BranchKeptReason[] = ["unmerged", "predates", "not_requested", "main"];

export function parseWorktreeRemoved(raw: unknown): WorktreeRemoved {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reason = o.branch_kept_reason;
  return {
    removed: o.removed !== false,
    branch: str(o.branch),
    branchDeleted: o.branch_deleted === true,
    branchKeptReason: KEPT_REASONS.includes(reason as BranchKeptReason) ? (reason as BranchKeptReason) : null,
    message: str(o.message),
  };
}

/**
 * `merged` 는 꺼진 채로 연다 — `develop` 같은 오래 사는 브랜치도 병합됨으로 보인다. 병합 여부를 모르면 `predates`.
 * `remote`(앱이 만든 기록 없음)도 꺼진 채다 — 켜도 `-d`(+ Rust 가 다시 확인한 squash · rebase 병합의 `update-ref -d`)뿐이라 병합된 브랜치만 지워진다.
 */
export type BranchDeleteOption =
  | { kind: "hidden" }
  | { kind: "predates"; branch: string }
  | { kind: "merged"; branch: string }
  | { kind: "delete"; branch: string }
  | { kind: "remote"; branch: string };

export function branchDeleteOption(
  w: WorktreeInfo,
  primaryBranch: string | null,
  remote = false,
  merged = false,
): BranchDeleteOption {
  if (!w.branch || w.detached || w.branch === primaryBranch) return { kind: "hidden" };
  if (w.createdByApp) return { kind: "delete", branch: w.branch };
  if (remote) return { kind: "remote", branch: w.branch };
  return merged ? { kind: "merged", branch: w.branch } : { kind: "predates", branch: w.branch };
}

export function branchDeleteToggleable(
  o: BranchDeleteOption,
): o is { kind: "delete" | "remote" | "merged"; branch: string } {
  return o.kind === "delete" || o.kind === "remote" || o.kind === "merged";
}

export function branchDeleteDefault(o: BranchDeleteOption): boolean {
  return o.kind === "delete";
}

/** `removed=false` 는 여기 오지 않는다(git 의 한 줄을 그대로 알린다) */
export function worktreeRemovedToast(r: WorktreeRemoved): { key: Key; params: Record<string, string> } {
  const branch = r.branch ?? "";
  if (!r.branch) return { key: "app.projects.worktrees.removed", params: {} };
  if (r.branchDeleted) return { key: "app.projects.worktrees.removed.branchDeleted", params: { branch } };
  switch (r.branchKeptReason) {
    case "unmerged":
      return { key: "app.projects.worktrees.removed.keptUnmerged", params: { branch } };
    case "predates":
      return { key: "app.projects.worktrees.removed.keptPredates", params: {} };
    default:
      return { key: "app.projects.worktrees.removed.kept", params: { branch } };
  }
}

/** 문구 키의 꼬리다(`app.projects.worktree.error.<까닭>`) */
export type WorktreeNameProblem = "empty" | "invalid";

/**
 * Rust `worktree::valid_name` 과 같은 규칙 — 한쪽만 고치면 폼은 통과시키고 백엔드가 거절한다(`projects.test.ts` 가 같은 표로 본다).
 * 셸 인용 없이도 안전한 글자뿐이라 원격 첫 입력에도 그대로 실린다.
 */
export function worktreeNameProblem(name: string): WorktreeNameProblem | null {
  const n = name.trim();
  if (n === "") return "empty";
  if (!/^[A-Za-z0-9._/-]+$/.test(n)) return "invalid";
  if (n.startsWith("-") || n.includes("..")) return "invalid";
  if (n.startsWith("/") || n.endsWith("/")) return "invalid";
  if (n.split("/").some((seg) => seg === "" || seg === ".")) return "invalid";
  return null;
}

function sepOf(path: string): "\\" | "/" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/** Rust `worktree::worktree_base` 의 기본 갈래와 같은 규칙. 부모가 없는 경로(`~`·`/`·`C:\`)면 `null` */
export function defaultWorktreeDir(repo: string): string | null {
  const sep = sepOf(repo);
  const trimmed = repo.trim().replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (i < 0) return null;
  const parent = trimmed.slice(0, i);
  const base = trimmed.slice(i + 1);
  // `C:` 는 드라이브 뿌리라 거절.
  if (base === "" || /^[A-Za-z]:$/.test(trimmed)) return null;
  return `${parent}${sep}${base}-wt`;
}

export function worktreeBaseOf(p: Pick<Project, "path" | "worktreeDir">): string | null {
  const dir = p.worktreeDir?.trim() ?? "";
  if (dir === "") return defaultWorktreeDir(p.path);
  const stripped = dir.replace(/[\\/]+$/, "");
  // 뿌리(`/`·`D:\`)는 떼면 뜻이 바뀐다 — 그대로 두고 [`worktreePathFor`] 가 구분자를 덧붙이지 않는다.
  return stripped === "" || /^[A-Za-z]:$/.test(stripped) ? dir : stripped;
}

/** `~` 는 아니다 — 셸을 거치지 않는 곳에서는 펴지지 않는다. Rust `worktree::is_absolute_dir(_, false)` 와 같은 표 */
export function isAbsoluteLocalPath(path: string): boolean {
  const d = path.trim();
  return d.startsWith("/") || d.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(d);
}

export type WorktreeDirProblem = "relative" | "inside";

/** Rust `comparable` */
function comparablePath(path: string): string {
  const p = path.trim();
  const windowsish = p.includes("\\") || p.charAt(1) === ":";
  let s = p.split("\\").join("/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return windowsish ? s.toLowerCase() : s;
}

/**
 * Rust `worktree::check_worktree_dir` 와 같은 표 — 한쪽만 고치면 폼은 통과시키고 저장이 거절한다(`projects.test.ts` 가 같은 표로 본다).
 * 로컬의 `~` 는 받지 않는다 — git 을 셸 없이 불러 저장소 안의 상대 경로가 된다. 저장소 안이면 막는다 — 상위 저장소의 `git status` 에 통째로 잡힌다.
 */
export function worktreeDirProblem(
  repo: string,
  dir: string,
  remote: boolean,
): WorktreeDirProblem | null {
  const d = dir.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(d)) return "relative";
  const absolute = remote
    ? d.startsWith("/") || d === "~" || d.startsWith("~/")
    : isAbsoluteLocalPath(d);
  if (!absolute) return "relative";
  const r = comparablePath(repo);
  const c = comparablePath(d);
  if (r !== "" && (c === r || c.startsWith(`${r}/`))) return "inside";
  return null;
}

/** 로컬은 Rust(`worktree::worktree_path`)가 실제 자리를 정하고 이 값은 미리 보기용이다 — 원격은 이 값이 곧 첫 입력의 `cd` 대상이다 */
export function worktreePathFor(
  p: Pick<Project, "path" | "worktreeDir">,
  name: string,
): string | null {
  if (worktreeNameProblem(name) !== null) return null;
  const base = worktreeBaseOf(p);
  if (base === null) return null;
  const sep = sepOf(base);
  const tail = name.trim().split("/").join(sep);
  return base.endsWith(sep) ? `${base}${tail}` : `${base}${sep}${tail}`;
}

export function worktreePreview(
  p: Pick<Project, "path" | "worktreeDir">,
  name: string,
  placeholder: string,
): string | null {
  if (name.trim() === "") {
    const base = worktreeBaseOf(p);
    if (base === null) return null;
    const sep = sepOf(base);
    return base.endsWith(sep) ? `${base}${placeholder}` : `${base}${sep}${placeholder}`;
  }
  return worktreePathFor(p, name);
}

export function worktreeTabTitle(projectName: string, worktreeName: string): string {
  return `${projectName} · ${worktreeName}`;
}

export function worktreeLabel(w: WorktreeInfo): { branch: string | null; tail: string } {
  return { branch: w.branch, tail: projectTail(w.path) };
}

export function paneForWorktree(
  p: Project,
  worktreePath: string,
  shellFallback?: string | null,
  scrollback?: number | null,
): PaneSpec {
  return paneForProject({ ...p, path: worktreePath }, shellFallback, scrollback);
}

/** 만드는 일은 그 타일이 접속한 뒤 · 첫 입력 전에 Rust(`remote_worktree::prepare`)가 한다 */
export function paneForNewRemoteWorktree(
  p: Project,
  name: string,
  scrollback?: number | null,
  agentName: string | null = null,
): PaneSpec | null {
  if (!isRemote(p)) return null;
  const dir = worktreePathFor(p, name);
  if (dir === null) return null;
  const pane = hasSetupScript(p)
    ? paneForSetup(p, dir, true, agentName, null, scrollback)
    : paneForWorktree(p, dir, null, scrollback);
  // `projectId` — 준비가 끝나면 타일이 그 프로젝트의 독 목록을 다시 읽는다
  pane.worktree = { repo: p.path, name: name.trim(), projectId: p.id };
  return pane;
}

// ── 독의 워크트리 트리 ──

export type WorktreeListing =
  | { state: "loading" }
  | { state: "ok"; list: WorktreeInfo[] }
  | { state: "offline" }
  | { state: "notRepo" }
  | { state: "error"; message: string };

/** `key` 는 선택 · 스크롤 · 하네스가 부르는 이름이다 — 프로젝트 줄은 프로젝트 id 그대로라 `data-project-id` 가 산다 */
export type ProjectTreeRow =
  | { kind: "project"; key: string; project: Project; expanded: boolean; auto: boolean }
  | { kind: "worktree"; key: string; project: Project; worktree: WorktreeInfo; primary: boolean }
  | {
      kind: "note";
      key: string;
      project: Project;
      note: "loading" | "offline" | "notRepo" | "error";
      message: string | null;
    };

/** 줄바꿈으로 잇는다 — 둘 다 줄바꿈을 담지 않는다 */
export function worktreeRowKey(projectId: string, path: string): string {
  return `${projectId}\nwt\n${path}`;
}

export function worktreeSearchText(w: WorktreeInfo): string {
  return `${w.branch ?? ""} ${w.path}`;
}

/**
 * 검색에 워크트리가 걸린 프로젝트는 저절로 펼친다(`auto: true` — 사용자가 접어 둔 상태는 건드리지 않는다).
 * `match` 는 밖에서 받는다 — 이 모듈이 호스트 층을 들이지 않게.
 */
export function projectTreeRows(
  list: readonly Project[],
  query: string,
  expanded: ReadonlySet<string>,
  listingOf: (id: string) => WorktreeListing | undefined,
  match: (query: string, text: string) => boolean,
): ProjectTreeRow[] {
  const q = query.trim();
  const out: ProjectTreeRow[] = [];
  const children = (p: Project, listing: WorktreeListing | undefined, only: WorktreeInfo[] | null) => {
    if (!listing || listing.state === "loading") {
      out.push({ kind: "note", key: `${p.id}\nnote`, project: p, note: "loading", message: null });
    } else if (listing.state === "offline") {
      out.push({ kind: "note", key: `${p.id}\nnote`, project: p, note: "offline", message: null });
    } else if (listing.state === "notRepo") {
      out.push({ kind: "note", key: `${p.id}\nnote`, project: p, note: "notRepo", message: null });
    } else if (listing.state === "error") {
      out.push({ kind: "note", key: `${p.id}\nnote`, project: p, note: "error", message: listing.message });
    } else {
      listing.list.forEach((w, i) => {
        if (only && !only.includes(w)) return;
        out.push({ kind: "worktree", key: worktreeRowKey(p.id, w.path), project: p, worktree: w, primary: i === 0 });
      });
    }
  };
  for (const p of list) {
    const listing = listingOf(p.id);
    if (q === "") {
      const open = expanded.has(p.id);
      out.push({ kind: "project", key: p.id, project: p, expanded: open, auto: false });
      if (open) children(p, listing, null);
      continue;
    }
    const hits = listing?.state === "ok" ? listing.list.filter((w) => match(q, worktreeSearchText(w))) : [];
    if (hits.length > 0) {
      out.push({ kind: "project", key: p.id, project: p, expanded: true, auto: true });
      children(p, listing, hits);
    } else if (match(q, projectSearchText(p))) {
      const open = expanded.has(p.id);
      out.push({ kind: "project", key: p.id, project: p, expanded: open, auto: false });
      if (open) children(p, listing, null);
    }
  }
  return out;
}

/**
 * git 은 Windows 에서도 `C:/src/proj` 로 적고 `git_worktree_add` 는 `C:\src\proj-wt\x` 를 돌려주므로 글자 그대로는 같지 않다.
 * `~` 는 여기서 펴지 않는다 — 원격이면 부르는 쪽이 [`expandRemotePath`] 로 먼저 편다.
 */
export function sameFolder(a: string, b: string): boolean {
  const norm = (s: string) => {
    const t = s.trim();
    const windows = t.includes("\\") || /^[A-Za-z]:/.test(t);
    const u = windows ? t.replace(/\\/g, "/").toLowerCase() : t;
    return u.length > 1 ? u.replace(/\/+$/, "") || u : u;
  };
  const x = norm(a);
  return x !== "" && x === norm(b);
}

/** 비교용이다 — Rust 로 보내는 첫 입력은 `~` 그대로이고 펴는 일은 서버의 셸이 한다(`ssh::sh_path`) */
export function expandRemotePath(path: string, home: string | null | undefined): string {
  if (!home) return path;
  const t = path.trim();
  if (t !== "~" && !t.startsWith("~/")) return path;
  const base = home.length > 1 ? home.replace(/\/+$/, "") : home;
  if (t === "~") return base;
  return base === "/" ? t.slice(1) : `${base}${t.slice(1)}`;
}

/** 판정은 시작 폴더(`cwd`)뿐이다 — 셸에서 `cd` 로 옮겨 간 것은 모른다. 빠른 접속 타일은 별칭이 설정의 것이 아니라 뺀다 */
export function paneStartedIn(
  pane: PaneSpec,
  p: Project,
  path: string,
  home: string | null = null,
): boolean {
  if (!pane.cwd) return false;
  if (isRemote(p)) {
    if (pane.kind !== "ssh" || pane.adhoc) return false;
    if (pane.alias?.trim().toLowerCase() !== p.host.trim().toLowerCase()) return false;
    return sameFolder(expandRemotePath(pane.cwd, home), expandRemotePath(path, home));
  }
  if (pane.kind !== "local") return false;
  return sameFolder(pane.cwd, path);
}

export function parseExpandedProjects(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
