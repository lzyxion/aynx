import { newLocalPane, newSshPane, type PaneSpec } from "$lib/session";
import { historyOf, type HostHistory } from "$lib/host-history";
import { compareNames, compareRecent } from "$lib/list-order";
import type { Key } from "$lib/i18n/keys";
import { newProjectPath, projectFolderNameProblem } from "$lib/repo-status";

/**
 * **프로젝트** — 규칙만 담은 순수 모듈 (docs/log/2026-09-24-projects.md).
 *
 * 프로젝트는 저장소 폴더 하나다: 로컬이면 이 PC 의 경로, 원격이면 호스트 별칭 + 그 서버의
 * 경로. **에이전트**(기본 Claude Code — `null` 이면 셸)를 함께 적어 두고, "열면" 그 폴더에서 타일이 하나
 * 뜨며 그 에이전트가 뜬다(2026-09-28 — 옛 "시작 명령" 칸을 대신한다: docs/log/2026-09-28-project-agent-setup-script.md).
 * 새 워크트리에서는 **설정 스크립트**가 먼저 돈다. 새 **타일 종류가 아니다** — 로컬이면 AI 타일과 같은 로컬 셸(`autorun`·
 * `cwd`), 원격이면 여느 SSH 타일에 첫 입력 재료를 실은 것이다. 그래야 타일 트리·이관·관리뷰·
 * MCP 가 지금 종류 위에서 그대로 돈다.
 *
 * 값은 Rust 가 `<config_dir>/aynx/projects.json` 에 쓰고(`projects.rs`), 창마다 든 사본은
 * `app/projects.svelte.ts` 의 `$state` 하나다. 여기는 룬도 Tauri 왕복도 없다 (vitest 가
 * `environment: "node"` 라 `.svelte.ts` 를 못 들인다 — `favorites.ts` 와 같은 분담).
 */

/** Rust `projects::Project` 와 1:1 */
export interface Project {
  id: string;
  name: string;
  /** 원격이면 `~/.ssh/config` 별칭, 로컬이면 `null` */
  host: string | null;
  /** 저장소 폴더 — 로컬이면 이 PC 의 경로, 원격이면 그 서버의 경로(`~/…` 허용) */
  path: string;
  /** 로컬 전용 — 열 셸의 id. `null` 이면 기본 셸 */
  shell: string | null;
  /**
   * 열면 뜨는 에이전트 — Rust `agent_args::TARGETS` 의 id(`claude` · `codex`), `null` 이면 셸만 그 폴더에서 연다.
   * 띄우는 줄은 [`agentCommand`] — AI 타일과 같은 autorun 문을 지난다(추가 인자 · 장식은 설정 › AI).
   */
  agent: string | null;
  /**
   * 설정 스크립트 — 여러 줄, 빈 글자 = 없음. 새 워크트리를 만들 때 그 타일에서 에이전트보다 먼저 한 번 돈다.
   * 이 글자는 폼만 다룬다 — 돌리는 줄은 Rust 가 `projects.json` 에서 직접 읽어 짓는다(`PaneSpec.setup`).
   */
  setupScript: string;
  /** 옛 "시작 명령" 을 옮기며 남긴 안내 (Rust `projects::ProjectMigration`) — 폼을 저장하면 사라진다 */
  migration: ProjectMigration | null;
  /** 원격 전용 — 호스트가 tmux 호스트일 때 이 프로젝트 타일도 tmux 안에서 (둘 다 켜져야 tmux) */
  tmux: boolean;
  /**
   * 새 워크트리를 만들 **부모 폴더** — `null` 이면 기본 자리 `<저장소 부모>/<저장소명>-wt`
   * ([`defaultWorktreeDir`]). Rust `projects::Project.worktree_dir` 와 1:1 (JSON 칸은 이 이름).
   * 사용자 피드백(2026-09-24, "워크트리가 어디 생기는지 모르겠다")으로 폼에 드러난 칸이다.
   */
  worktreeDir: string | null;
  /**
   * 목록에 보일 아이콘 — 호스트 메타의 `icon` 과 같은 문자열(이모지 · `svg:…`). 없으면(`null`·빈 글자) 오늘의
   * 기본 그림 그대로다. Rust `projects::Project.icon` 과 1:1 (docs/log/2026-09-29-folder-project-icons.md).
   * 옛 사본·테스트 픽스처가 칸 없이 와도 되게 선택 칸이다 — [`parseProjects`] 는 늘 채운다.
   */
  icon?: string | null;
  /** 아이콘의 색 — 단색(선) 아이콘과 기본 그림이 입는다. 컬러 로고·이모지는 제 색 */
  color?: string | null;
}

/**
 * 이관 안내 — `args`(에이전트로 옮겼고 뒤의 인자 `text` 는 설정 › AI 추가 인자로) · `script`(명령 `text` 를 설정
 * 스크립트로 옮겼다) · `dropped`(설정 스크립트가 이미 있어 명령 `text` 를 옮기지 못했다).
 */
export interface ProjectMigration {
  kind: "args" | "script" | "dropped";
  text: string;
}

/** 새 프로젝트의 에이전트 기본값 — Claude Code */
export const DEFAULT_PROJECT_AGENT = "claude";

/** 옛 파일에 `command` 칸이 없던 줄의 시작 명령(그때의 기본값) — Rust `projects::LEGACY_DEFAULT_COMMAND` */
const LEGACY_DEFAULT_COMMAND = "claude";

/**
 * 에이전트 id → 띄울 명령(실행 파일 이름). id 가 곧 첫 실행 파일 이름이다 — Rust `agent_args` 의 테스트가 표의 모든
 * 줄에서 `exes[0] == id` 를 고정한다. 셋째 에이전트도 그 표 한 줄로 붙는다.
 */
export function agentCommand(agent: string): string {
  return agent;
}

/**
 * 이관의 실행 파일 표 — Rust `agent_args::TARGETS` 의 `exes` 와 같은 글자. Rust 가 파일을 읽을 때 이미 옮겨 주므로
 * 이 표는 **옛 모양이 그대로 온 경우**(옛 백엔드)의 방어일 뿐이다.
 */
const LEGACY_AGENT_EXES: Record<string, readonly string[]> = {
  claude: ["claude", "claude.exe", "claude.cmd"],
  codex: ["codex", "codex.exe", "codex.cmd"],
};

/**
 * 옛 "시작 명령" 한 줄 → 에이전트 · 설정 스크립트 · 안내 — Rust `projects::migrate_command` 와 **같은 표**
 * (docs/log/2026-09-28-project-agent-setup-script.md 의 이관 표 · 두 테스트가 같은 줄들을 본다).
 */
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

/** 설정 스크립트가 있는가 (빈 줄·공백뿐이면 없다) */
export function hasSetupScript(p: Pick<Project, "setupScript">): boolean {
  return p.setupScript.trim() !== "";
}

/** 설정 스크립트의 줄 수 — 빈 줄은 세지 않는다 (Rust `projects::script_lines` · 제거 확인 "N줄") */
export function setupScriptLines(script: string): number {
  return script.split(/\r?\n/).filter((l) => l.trim() !== "").length;
}

/**
 * 설정 스크립트가 도는 셸의 모양 — 폼의 힌트가 변수 표기(`$env:AYNX_ROOT_PATH` · `%AYNX_ROOT_PATH%` · `$AYNX_ROOT_PATH`)
 * 를 고른다. 원격은 언제나 POSIX(`sh`), 로컬은 셸 id 로(Rust `setup_script::shell_of` 와 같은 표 — 모르면 PowerShell).
 */
export type SetupShellKind = "powershell" | "cmd" | "posix";

export function setupShellKind(shellId: string | null, remote: boolean): SetupShellKind {
  if (remote) return "posix";
  if (shellId === "cmd") return "cmd";
  if (shellId === "gitbash" || shellId?.startsWith("wsl:")) return "posix";
  return "powershell";
}

/** 그 셸에서 `AYNX_ROOT_PATH` 를 읽는 표기 */
export function setupRootVar(kind: SetupShellKind): string {
  if (kind === "powershell") return "$env:AYNX_ROOT_PATH";
  if (kind === "cmd") return "%AYNX_ROOT_PATH%";
  return "$AYNX_ROOT_PATH";
}

/**
 * 독의 프로젝트 줄을 **즐겨찾기(하단 독)로** 끌 때의 짐 종류 — 값은 프로젝트 id 하나.
 *
 * 호스트 짐(`HOSTS_DRAG_TYPE`)에 칸을 더하지 않은 이유: 그 짐은 터미널 타일·탭 바·폴더 줄이
 * 전부 받아 **접속·이동**으로 읽는다. 프로젝트가 거기 섞이면 받는 곳마다 "이건 어떻게 여나" 를
 * 새로 물어야 한다. 종류가 다르면 그 자리들은 이 짐을 아예 보지 않는다.
 */
export const PROJECT_DRAG_TYPE = "application/x-aynx-project";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * 백엔드가 준 원시 값 → 믿을 수 있는 목록. **절대 throw 하지 않는다** — 모양이 어긋난 줄은
 * 버리고 나머지는 살린다(`parseHistory` 와 같은 판정). 같은 id 는 앞의 것이 이긴다.
 */
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

/** 원격 프로젝트인가 (호스트 별칭이 있다) */
export function isRemote<T extends Pick<Project, "host">>(p: T): p is T & { host: string } {
  return p.host !== null && p.host.trim() !== "";
}

/** 목록·팔레트·즐겨찾기가 부르는 이름 */
export function projectLabel(p: Project): string {
  return p.name;
}

/**
 * 폴더의 **꼬리** — 줄 끝에 옅게 붙는 마지막 한 조각(`C:\src\proj` → `proj`, `~/aynx` → `aynx`).
 * 구분자는 둘 다 받는다(원격은 `/`, 로컬 Windows 는 `\`). 끝이 구분자면 떼고 본다.
 */
export function projectTail(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (trimmed === "") return path.trim();
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i < 0 ? trimmed : trimmed.slice(i + 1) || trimmed;
}

/** 검색이 훑는 글자 — 이름 · 경로 · 호스트 별칭 (`hostSearchText` 와 같은 자리) */
export function projectSearchText(p: Project): string {
  return `${p.name} ${p.path} ${p.host ?? ""}`;
}

/**
 * 프로젝트를 여는 **타일 명세** — 여는 길(독·팔레트·즐겨찾기)이 전부 이것 하나를 지난다.
 *
 * - **로컬**: [`newLocalPane`] 에 `cwd`(시작 폴더)와 `autorun`(에이전트의 명령 — [`agentCommand`])을 싣고
 *   `injectMcpToken` 을 켠다 — AI 타일(`newAiPane`)과 **같은 칸**이라 같은 autorun 문(`agent_autorun_command` — 추가
 *   인자 · 장식)과 같은 MCP 토큰 규칙을 지난다. 에이전트가 없으면(`null`) 그 폴더에서 셸만 뜬다. 셸은 프로젝트에
 *   적힌 것, 없으면 `shellFallback`(지금의 기본 셸).
 * - **원격**: [`newSshPane`] 에 같은 두 칸을 싣는다 — 터미널이 **첫 접속**에만 백엔드로 보내고
 *   Rust 가 첫 입력 한 줄로 조립한다(`ssh::project_start_line`). tmux 는 **프로젝트의 토글 하나가
 *   정한다**(호스트 설정과 무관 — 2026-09-24 실기 ④): 켜면 `forceTmux`, 끄면 `noTmux`.
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
 * **설정 스크립트를 먼저 돌리는** 타일 명세 (docs/log/2026-09-28-project-agent-setup-script.md) — 그 워크트리 폴더에서
 * 스크립트 → (성공하면) 에이전트. `withAgent` 가 거짓이면 스크립트만 돌리고 셸에 머문다(독의 [설정 스크립트 실행]).
 *
 * - 로컬: `autorun` 없이 연다 — 에이전트는 스크립트의 끝 신호를 받은 터미널이 띄운다. MCP 토큰 표식은 세션을 열 때
 *   심어야 하므로 에이전트가 뜰 수 있으면 미리 켠다.
 * - 원격: 여는 길과 같은 SSH 명세(`autorun` = 에이전트) + `setup` — Rust 가 첫 입력을 `sh -c '<스크립트>' && <에이전트>`
 *   로 짓는다. 새 워크트리면 부르는 쪽이 `pane.worktree` 를 더한다([`paneForNewRemoteWorktree`]).
 *
 * `agentName` 은 오류 막대의 "<에이전트> 띄우기" 단추 이름이다(모르면 `null` — 단추는 id 를 쓴다).
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

/**
 * 프로젝트 독의 순서 — 정렬 버튼을 따른다. 버튼의 값은 호스트 독과 **같은 칸**(`[hosts] sort`)
 * 이다: 설정 칸을 하나 더 만들 만큼 두 목록의 뜻이 갈리지 않고(둘 다 "이름순 ↔ 최근 붙은 서버"),
 * 한쪽에서 바꾼 순서가 다른 쪽에서 다시 묻지 않는 편이 덜 놀랍다.
 *
 * - `name`: 이름순(`compareNames` — 대소문자 무시 · 숫자 자연순, 호스트 · DB 칸과 같은 비교).
 * - `recent`: **원격 프로젝트는 그 호스트의 마지막 성공 접속**이 늦은 순, 로컬과 이력 없는
 *   원격은 뒤에서 이름순. 프로젝트 자신의 "마지막으로 연 시각" 은 적지 않는다(이 조각의 범위
 *   밖이다 — 호스트 이력으로 충분히 "최근 붙은 서버의 프로젝트" 가 위로 온다).
 */
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

// ---------------------------------------------------------------------------
// 폼 — 추가·편집 모달이 쥐는 초안 (`ProjectForm.svelte`)
// ---------------------------------------------------------------------------

/** 폼의 칸들 — 로컬/원격 둘 다의 칸을 한 벌로 들고, 저장할 때 위치에 맞는 것만 남긴다 */
export interface ProjectDraft {
  /** 편집이면 그 id, 추가면 빈 글자(백엔드가 새로 뽑는다) */
  id: string;
  name: string;
  location: "local" | "remote";
  /** 원격일 때의 호스트 별칭 */
  host: string;
  path: string;
  /** 에이전트 id — `null` 이면 없음(셸) */
  agent: string | null;
  /** 로컬일 때의 셸 id — 빈 글자 = 기본 셸 */
  shell: string;
  tmux: boolean;
  /** 워크트리 폴더 — 빈 글자 = 기본 자리(폼은 그 자리를 자리표시로 보여 준다) */
  worktreeDir: string;
  /** 설정 스크립트 (여러 줄) */
  setupScript: string;
  /** 옛 시작 명령의 이관 안내 — 폼 위에 한 줄로 보일 뿐 저장하지 않는다(저장하면 사라진다) */
  migration: ProjectMigration | null;
  /** 아이콘 (빈 글자 = 기본 그림) — `IconColorFields` 가 묶는다 */
  icon: string;
  /** 아이콘 색 (빈 글자 = 기본 색) */
  color: string;
}

/** 새 프로젝트의 빈 초안 — 에이전트는 Claude Code, 원격이면 tmux 켬 */
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

/** 저장된 프로젝트 → 편집 초안 */
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

/**
 * 폼이 막는 문제 — 칸 이름이 곧 문구 키의 꼬리다 (`app.projects.form.error.<칸>`).
 * 2026-09-28(docs/log/2026-09-28-project-create.md): `folderName`·`parent`·`parentRelative` 는 **새로 만들기**
 * 의 칸, `pathMissing` 은 기존 폴더의 로컬 경로가 없을 때(판정이 막는다 — `repoCheckBlocks`).
 */
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

/**
 * 프로젝트 폼의 세 면 (2026-09-29 — docs/log/2026-09-29-folder-project-icons.md). 호스트 폼과 같은 왼쪽
 * 내비이고, id 는 화면에 보이지 않는 코드 식별자다. 순서가 곧 내비의 위에서 아래다.
 */
export type ProjectFormTab = "general" | "worktree" | "display";
export const PROJECT_FORM_TABS = ["general", "worktree", "display"] as const satisfies readonly ProjectFormTab[];

/**
 * 막힌 칸이 있는 면 — 저장이 걸리면 그 면으로 데려가고 내비에 점을 찍는다(호스트 폼의 `tabOfField` 와 같은 일).
 * 워크트리 폴더만 "워크트리" 면이고 나머지(이름·호스트·경로·만들 자리)는 전부 "일반" 이다. 표시 면에는 막는 칸이 없다.
 */
export function projectFormTabOf(problem: ProjectDraftProblem | null | undefined): ProjectFormTab | null {
  if (problem === null || problem === undefined) return null;
  return problem === "worktreeDir" ? "worktree" : "general";
}

/** 막힌 칸의 요소 id — 면을 옮긴 뒤 포커스를 줄 자리 (`ProjectForm.svelte` 의 id 그대로) */
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

/**
 * 저장해도 되는가 — 이름·경로는 비면 안 되고, 원격이면 호스트를 골라야 한다. 워크트리 폴더는
 * 비어도 되지만(기본 자리) 적었으면 [`worktreeDirProblem`] 을 지나야 한다.
 */
export function validateDraft(d: ProjectDraft): ProjectDraftProblem | null {
  if (d.name.trim() === "") return "name";
  if (d.location === "remote" && d.host.trim() === "") return "host";
  if (d.path.trim() === "") return "path";
  // 로컬은 절대 경로만 (2026-09-24 실기 ⑤ — 원격으로 바꾸기 전에 적은 `~/aynx-lab` 이 로컬 경로로
  // 저장됐다). `~`·상대 경로는 셸 없이 여는 로컬 타일에서 펴지지 않는다. Rust `normalize` 와 같은 표.
  if (d.location === "local" && !isAbsoluteLocalPath(d.path)) return "pathRelative";
  const wt = d.worktreeDir.trim();
  if (wt !== "" && worktreeDirProblem(d.path, wt, d.location === "remote") !== null) {
    return "worktreeDir";
  }
  return null;
}

/**
 * **새로 만들기** 로 저장해도 되는가 — 이름은 곧 폴더 이름이라 [`projectFolderNameProblem`] 을
 * 지나야 하고(`folderName`), 만들 자리(`parent`)는 비면 안 되며 로컬이면 절대 경로여야 한다. 워크트리
 * 폴더는 **만들어질 자리** 기준으로 본다(저장소 안이면 막는다).
 */
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

/**
 * 같은 폴더가 **이미 다른 프로젝트로** 있는가 — 폼의 경고 한 줄(저장은 막지 않는다). 같은 위치
 * (로컬끼리 · 같은 호스트끼리, 별칭은 대소문자 무시)에서 [`sameFolder`] 로 견준다. 편집 중인
 * 자기 자신(`d.id`)은 빼고 본다.
 */
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

/**
 * 초안 → 백엔드로 보낼 한 줄 (위치에 맞지 않는 칸은 비운다 — Rust `normalize` 와 같은 규칙). 이관 안내는 싣지 않는다 —
 * 폼으로 저장했다는 것이 곧 사람이 읽었다는 뜻이다(Rust 도 저장에서 지운다).
 */
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

// ---------------------------------------------------------------------------
// 워크트리 (docs/log/2026-09-24-worktrees.md)
// ---------------------------------------------------------------------------

/** Rust `worktree::WorktreeInfo` 와 1:1 — `git worktree list --porcelain` 의 한 덩어리 */
export interface WorktreeInfo {
  /** 워크트리 폴더 (git 이 적은 그대로 — Windows 에서도 `/` 구분자일 수 있다) */
  path: string;
  /** 체크아웃한 브랜치 (`refs/heads/` 를 뗀 이름). 분리된 HEAD 면 `null` */
  branch: string | null;
  head: string | null;
  /** bare 저장소 줄 — 작업 폴더가 없어 열 수 없다 (목록에서 빠진다) */
  bare: boolean;
  detached: boolean;
  /**
   * 지금 브랜치를 **앱이 `-b` 로 만들었나** (Rust 곁 파일 `worktrees.json` — 칸 `created_by_app`; 원격은 곁 파일의
   * `ssh://<별칭>…` 줄 — 2026-09-29). 모르면(셸에서 만든 것 · 옛 백엔드) `false` 와 같다 — 제거 확인의 "브랜치도
   * 삭제" 가 흐려지거나(로컬) 꺼진 채다(원격) — 모르면 지우지 않는 쪽.
   */
  createdByApp?: boolean;
}

/**
 * 백엔드가 준 원시 목록 → 열 수 있는 워크트리들. **throw 하지 않는다** — 모양이 어긋난 줄과
 * bare 줄은 버린다. 순서는 git 의 것 그대로다(주 작업 폴더가 맨 앞).
 */
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

// ---------------------------------------------------------------------------
// 워크트리 제거 — 브랜치는 같이 지운다 (docs/log/2026-09-24-worktrees.md "브랜치는 같이 지운다")
// ---------------------------------------------------------------------------

/** 브랜치를 남긴 까닭 — Rust `worktree::KeptReason` 과 같은 글자 */
export type BranchKeptReason = "unmerged" | "predates" | "not_requested" | "main";

/** Rust `worktree::WorktreeRemoved` 와 1:1 */
export interface WorktreeRemoved {
  /** `false` = git 이 워크트리 제거를 거절했다(커밋하지 않은 변경 등) — `message` 가 그 한 줄 */
  removed: boolean;
  branch: string | null;
  branchDeleted: boolean;
  branchKeptReason: BranchKeptReason | null;
  message: string | null;
}

const KEPT_REASONS: readonly BranchKeptReason[] = ["unmerged", "predates", "not_requested", "main"];

/** 백엔드의 답 → [`WorktreeRemoved`]. **throw 하지 않는다** — 모양이 어긋나면 "지웠다, 브랜치 모름" */
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
 * 제거 확인의 **"브랜치도 삭제" 칸** 모양 (**순수 함수**):
 *
 * - `hidden` — 분리된 HEAD(지울 브랜치가 없다) · 저장소의 지금 브랜치(`primaryBranch` — 주 작업
 *   폴더가 체크아웃한 것, git 이 어차피 안 지운다).
 * - `predates` — 앱이 만든 브랜치가 아니다(곁 파일에 없다) → 꺼진 채 흐리고 까닭 한 줄.
 * - `merged` — 앱이 만든 브랜치는 아니지만 **main 에 병합돼 있다**(독의 "병합됨" 칩과 같은 판정 —
 *   `$lib/worktree-changes` 의 `merged` — 조상 병합 `worktree_changes::is_merged` 또는 squash · rebase 병합
 *   `merge_detect`, docs/log/2026-10-05-squash-merge-detection.md) → 칸은 살아 있되 **꺼진 채**로 연다.
 *   사람이 켜야 지운다 — `develop` 같은 오래 사는 브랜치도 병합됨으로 보이기 때문이다(2026-10-05 사용자 결정,
 *   docs/log/2026-10-05-worktree-one-to-one.md "2026-10-05 추가"). 병합 여부를 모르면(아직 안 읽음) `predates`.
 * - `delete` — **켜진 채**가 기본이다(Orca 의 규칙 — 브랜치는 워크트리와 함께 간다).
 * - `remote` — 원격 워크트리인데 **앱이 만든 기록이 없다**(셸에서 만든 것 · 2026-09-29 전에 첫 입력이 만든 것 ·
 *   있던 브랜치를 체크아웃한 것) → 칸은 살아 있되 **꺼진 채**로 연다(모르면 지우지 않는다). 사람이 켜면 그것이
 *   동의이고, 그래도 `-d`(+ squash · rebase 병합을 Rust 가 다시 확인한 경우의 `update-ref -d`)뿐이라 병합된 브랜치만
 *   지워진다(docs/log/2026-09-24-worktrees.md "원격 제거").
 *   원격도 앱이 `-b` 로 만든 브랜치면(곁 파일의 원격 줄 — Rust 목록이 `created_by_app` 을 싣는다, 2026-09-29 B안)
 *   로컬처럼 `delete`(켜진 채)다.
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

/** 칸을 사람이 켜고 끌 수 있는가 — `delete`(기본 켜짐)·`remote`·`merged`(기본 꺼짐) */
export function branchDeleteToggleable(
  o: BranchDeleteOption,
): o is { kind: "delete" | "remote" | "merged"; branch: string } {
  return o.kind === "delete" || o.kind === "remote" || o.kind === "merged";
}

/** 칸이 처음 켜진 채인가 — 앱이 만든 브랜치(`delete`)만. 나머지는 사람이 켜야 한다 */
export function branchDeleteDefault(o: BranchDeleteOption): boolean {
  return o.kind === "delete";
}

/**
 * 제거한 뒤 알림 한 줄의 **문구 키와 자리** (**순수 함수** — 문장은 부르는 쪽이 `t()` 로 만든다).
 * `removed=false` 는 여기 오지 않는다(그건 git 의 한 줄을 그대로 알린다).
 */
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
      // 사람이 끈 것 · 지금 브랜치 — 까닭을 달 것 없이 "남겼다" 한 마디.
      return { key: "app.projects.worktrees.removed.kept", params: { branch } };
  }
}

/** 이름이 막히는 까닭 — 문구 키의 꼬리다 (`app.projects.worktree.error.<까닭>`) */
export type WorktreeNameProblem = "empty" | "invalid";

/**
 * 워크트리·브랜치 이름 검사 — Rust `worktree::valid_name` 과 **같은 규칙**이다(둘 중 하나만
 * 고치면 폼은 통과시키고 백엔드가 거절한다 — `projects.test.ts` 가 같은 표로 본다).
 *
 * `[A-Za-z0-9._/-]+` · `-` 로 시작하지 않는다 · `..` 이 없다 · `/` 로 시작·끝나지 않고 빈 조각·
 * `.` 조각이 없다. 셸 인용 없이도 안전한 글자뿐이라 원격 첫 입력에도 그대로 실린다.
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

/** 이 경로가 쓰는 구분자 — `\` 만 있으면 Windows 경로, 아니면 `/` */
function sepOf(path: string): "\\" | "/" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/**
 * **기본** 워크트리 폴더 — `<저장소 부모>/<저장소명>-wt` (프로젝트의 `worktreeDir` 이 비었을 때).
 * Rust `worktree::worktree_base` 의 기본 갈래와 같은 규칙이다. 폼은 이 값을 자리표시로 보여
 * 준다(비워 두면 어디에 생기는지가 칸 안에 보인다).
 *
 * 구분자는 **저장소 경로가 쓰는 것**을 따른다(`C:\src\proj` → `C:\src\proj-wt`,
 * `~/api` → `~/api-wt`). 부모가 없는 경로(`~`·`/`·`C:\`)면 `null`.
 */
export function defaultWorktreeDir(repo: string): string | null {
  const sep = sepOf(repo);
  const trimmed = repo.trim().replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (i < 0) return null; // `~`·`api` — 부모가 없다
  const parent = trimmed.slice(0, i);
  const base = trimmed.slice(i + 1);
  // `/api` 의 부모는 뿌리(빈 글자) — `/api-wt` 로 두면 된다. `C:` 는 드라이브 뿌리라 거절.
  if (base === "" || /^[A-Za-z]:$/.test(trimmed)) return null;
  return `${parent}${sep}${base}-wt`;
}

/** 프로젝트의 워크트리 폴더 — 칸이 있으면 그것(끝 구분자는 뗀다), 없으면 기본 자리 */
export function worktreeBaseOf(p: Pick<Project, "path" | "worktreeDir">): string | null {
  const dir = p.worktreeDir?.trim() ?? "";
  if (dir === "") return defaultWorktreeDir(p.path);
  const stripped = dir.replace(/[\\/]+$/, "");
  // 뿌리(`/`·`D:\`)는 떼면 뜻이 바뀐다 — 그대로 두고 [`worktreePathFor`] 가 구분자를 덧붙이지 않는다.
  return stripped === "" || /^[A-Za-z]:$/.test(stripped) ? dir : stripped;
}

/**
 * 로컬의 **절대 자리**인가 — `/`·`\\`(UNC)·`X:\`·`X:/`. `~` 는 아니다(셸을 거치지 않는 곳에서는
 * 펴지지 않는다). Rust `worktree::is_absolute_dir(_, false)` 와 **같은 표**다.
 */
export function isAbsoluteLocalPath(path: string): boolean {
  const d = path.trim();
  return d.startsWith("/") || d.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(d);
}

/** 워크트리 폴더 칸이 막히는 까닭 — `relative`(절대 자리가 아니다) · `inside`(저장소 안) */
export type WorktreeDirProblem = "relative" | "inside";

/** 비교용 글자 — 구분자를 `/` 로, 끝 구분자를 떼고, Windows 꼴이면 소문자로 (Rust `comparable`) */
function comparablePath(path: string): string {
  const p = path.trim();
  const windowsish = p.includes("\\") || p.charAt(1) === ":";
  let s = p.split("\\").join("/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return windowsish ? s.toLowerCase() : s;
}

/**
 * 워크트리 폴더 칸 검사 — Rust `worktree::check_worktree_dir` 와 **같은 표**다(한쪽만 고치면
 * 폼은 통과시키고 저장이 거절한다 — `projects.test.ts` 가 같은 표로 본다).
 *
 * - **절대 자리**: 로컬이면 `/`·`\\`·`X:\`, 원격이면 `/`·`~`. 로컬의 `~` 는 받지 않는다 —
 *   git 을 셸 없이 부르므로 펴지지 않고 저장소 안의 상대 경로가 된다.
 * - **저장소 밖**: 저장소 자신이나 그 안이면 막는다(워크트리가 상위 저장소의 `git status` 에
 *   통째로 잡힌다). 이름이 저장소 이름으로 시작할 뿐인 이웃(`proj-wt`)은 된다.
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

/**
 * 새 워크트리의 폴더 — `<워크트리 폴더>/<이름>` (워크트리 폴더 = [`worktreeBaseOf`]).
 *
 * 구분자는 **워크트리 폴더가 쓰는 것**을 따른다(`C:\src\proj-wt` → `C:\src\proj-wt\feat`,
 * `~/api-wt` → `~/api-wt/feat`). 이름의 `/` 도 그 구분자로 바뀐다. 자리가 없거나(부모 없는
 * 저장소에 칸도 비었다) 막힌 이름이면 `null`.
 *
 * 로컬은 Rust(`worktree::worktree_path`)가 실제 자리를 정하고(돌려준 `path` 가 알림에 쓰인다)
 * 이 값은 **미리 보여 주기**에만 쓴다. 원격은 이 값이 곧 첫 입력의 `cd` 대상이다(Rust 가 받아
 * 인용만 한다).
 */
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

/**
 * 이름을 치는 동안 보여 줄 **온전한 자리** — 이름이 비었으면 `<이름>` 자리표시를 끼운 꼴
 * (`C:\src\proj-wt\<이름>`), 이름이 막혔으면 `null`(그 자리는 오류 줄이 선다).
 */
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

/**
 * 워크트리로 연 탭의 제목 — `<프로젝트> · <워크트리 이름>` (탭이 "어디에서" 를 말하게).
 * 워크트리 이름은 새로 만든 것이면 친 이름, 목록에서 고른 것이면 브랜치(없으면 폴더 꼬리)다.
 */
export function worktreeTabTitle(projectName: string, worktreeName: string): string {
  return `${projectName} · ${worktreeName}`;
}

/** 워크트리 줄의 두 글자 — 브랜치(없으면 `null` = 분리된 HEAD) · 폴더 꼬리 */
export function worktreeLabel(w: WorktreeInfo): { branch: string | null; tail: string } {
  return { branch: w.branch, tail: projectTail(w.path) };
}

/**
 * **이미 있는 워크트리**를 여는 타일 명세 — 프로젝트를 그 폴더로 바꿔 [`paneForProject`] 를
 * 지난다(명령·셸·tmux·MCP 토큰 규칙이 전부 같다). 원격이면 첫 입력이 `cd -- <워크트리>` 다.
 */
export function paneForWorktree(
  p: Project,
  worktreePath: string,
  shellFallback?: string | null,
  scrollback?: number | null,
): PaneSpec {
  return paneForProject({ ...p, path: worktreePath }, shellFallback, scrollback);
}

/**
 * **원격 "새 워크트리에서 열기"** 의 타일 명세 — 워크트리 폴더를 `cwd` 로, 만들 재료를
 * `worktree` 로 싣는다. 만드는 일은 그 타일이 접속한 뒤 · 첫 입력 전에 Rust(`remote_worktree::prepare`)가
 * 그 전송로의 exec 로 한다(2026-09-29 B안). 이름이 막히거나 자리가 없으면 `null`.
 */
export function paneForNewRemoteWorktree(
  p: Project,
  name: string,
  scrollback?: number | null,
  agentName: string | null = null,
): PaneSpec | null {
  if (!isRemote(p)) return null;
  const dir = worktreePathFor(p, name);
  if (dir === null) return null;
  // 설정 스크립트가 있으면 워크트리를 만든 뒤 · 에이전트보다 먼저 돈다(`paneForSetup` — 2026-09-28).
  const pane = hasSetupScript(p)
    ? paneForSetup(p, dir, true, agentName, null, scrollback)
    : paneForWorktree(p, dir, null, scrollback);
  // `projectId` — 준비가 끝나면(`ready`) 타일이 그 프로젝트의 독 목록을 다시 읽는다
  pane.worktree = { repo: p.path, name: name.trim(), projectId: p.id };
  return pane;
}

// ---------------------------------------------------------------------------
// 독의 워크트리 트리 (docs/log/2026-09-24-worktrees.md "독의 트리")
// ---------------------------------------------------------------------------

/**
 * 한 프로젝트의 워크트리 목록이 지금 어떤 꼴인가 — 읽는 중 · 목록 · 접속 전(원격) · 실패.
 * 창 사본(`app/projects.svelte.ts` 의 `worktreesOf`)이 이 값을 프로젝트마다 든다.
 */
export type WorktreeListing =
  | { state: "loading" }
  | { state: "ok"; list: WorktreeInfo[] }
  | { state: "offline" }
  /** git 저장소가 아니다 — 독이 오류 대신 [git 저장소로 초기화] 를 세운다 (2026-09-28) */
  | { state: "notRepo" }
  | { state: "error"; message: string };

/**
 * 독의 한 줄 — 프로젝트 줄 · 그 아래 워크트리 줄 · 누를 수 없는 안내 한 줄(읽는 중·접속 전·실패).
 * `key` 는 선택·스크롤·하네스가 부르는 이름이다(프로젝트 줄은 프로젝트 id 그대로라 예전
 * `data-project-id` 가 산다). 새 워크트리는 줄이 아니라 **프로젝트 줄 오른쪽의 `+`** 다
 * (2026-09-25 — 마지막 "+ 새 워크트리…" 아이 줄을 뺐다, docs/log/2026-09-24-worktrees.md "독의 트리").
 */
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

/** 워크트리 줄의 키 — 프로젝트 id 와 경로를 **줄바꿈**으로 잇는다(둘 다 줄바꿈을 담지 않는다) */
export function worktreeRowKey(projectId: string, path: string): string {
  return `${projectId}\nwt\n${path}`;
}

/** 검색이 훑는 워크트리 글자 — 브랜치 · 경로 */
export function worktreeSearchText(w: WorktreeInfo): string {
  return `${w.branch ?? ""} ${w.path}`;
}

/**
 * **독 트리의 줄들** — 순서가 정해진 프로젝트 목록을 펼친 꼴로 편다. 순수 함수라 규칙이 여기
 * 한 곳이고 테스트가 이것을 본다.
 *
 * - 검색어가 없으면: 프로젝트 줄, 펼친 것이면 그 아래 워크트리 줄들(첫 줄 = git 의 주 작업 폴더
 *   = `primary`). 목록이 아직 없거나(`undefined`·`loading`) 접속 전이거나 실패면 워크트리 줄 대신
 *   안내 한 줄이다. (새 워크트리의 `+` 는 아이 줄이 아니라 프로젝트 줄 곁이라 이 줄 모델 밖이다.)
 * - 검색어가 있으면: 프로젝트 자신이 걸리거나 **이미 읽어 둔** 워크트리가 걸리는 것만 남는다.
 *   워크트리가 걸린 프로젝트는 저장된 펼침과 상관없이 **저절로 펼쳐** 걸린 줄만 보인다
 *   (`auto: true` — 사용자가 접어 둔 상태는 건드리지 않는다). 프로젝트만 걸리면 평소 모양이다.
 *
 * `match` 는 검색 규칙(`$lib/hosts` 의 `fuzzyMatch`)을 밖에서 받는다 — 이 모듈이 호스트 층을
 * 들이지 않게.
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
 * 두 폴더 글자가 **같은 자리**인가 — 끝 구분자를 떼고, Windows 꼴(`\` 이 있거나 `X:` 로 시작)이면
 * 구분자를 `/` 로 맞추고 대소문자를 무시한다. git 은 Windows 에서도 `C:/src/proj` 로 적고
 * `git_worktree_add` 는 `C:\src\proj-wt\x` 를 돌려주므로 글자 그대로는 같지 않다.
 * `~` 는 여기서 펴지 않는다 — 원격이면 부르는 쪽이 [`expandRemotePath`] 로 먼저 편다
 * ([`paneStartedIn`]). 펴지 않은 `~/api` 와 `/root/api` 는 다르다고 본다.
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

/**
/**
 * 원격 경로의 앞 `~` 를 그 서버의 홈으로 편다 — `~` → `home`, `~/x` → `home/x`. 다른 꼴(`/…`·
 * 상대 경로·`~user/…`)은 그대로다. `home` 을 모르면(`null`) 아무것도 바꾸지 않는다.
 *
 * 왜 필요한가: 사람은 프로젝트를 `~/api` 로 적고 git 은 `/root/api` 로 적는다(docs/log/
 * 2026-09-24-worktrees.md). 홈은 앱이 별칭마다 한 번 묻는다(`app/remote-home.svelte.ts`).
 * Rust 로 보내는 첫 입력은 여전히 `~` 그대로다 — 펴는 일은 서버의 셸이 한다(`ssh::sh_path`).
 * 이 함수는 **비교용**이다.
 */
export function expandRemotePath(path: string, home: string | null | undefined): string {
  if (!home) return path;
  const t = path.trim();
  if (t !== "~" && !t.startsWith("~/")) return path;
  const base = home.length > 1 ? home.replace(/\/+$/, "") : home;
  if (t === "~") return base;
  return base === "/" ? t.slice(1) : `${base}${t.slice(1)}`;
}

/**
 * 이 타일이 그 프로젝트의 그 워크트리 폴더에서 **시작한** 타일인가 — 독의 워크트리 줄에 탭과 같은
 * 에이전트 점을 찍을 짝을 찾는다. 로컬 프로젝트는 로컬 타일, 원격은 같은 별칭(대소문자 무시)의
 * SSH 타일만 본다(빠른 접속 타일은 별칭이 설정의 것이 아니라 뺀다). 판정은 시작 폴더(`cwd`)뿐이다
 * — 셸에서 `cd` 로 옮겨 간 것은 모른다.
 *
 * 원격은 `home`(그 서버의 `$HOME`, 모르면 `null`)으로 **양쪽을** 편 뒤 맞댄다 — 타일은 `~/api`
 * 에서 시작했고 git 의 줄은 `/root/api` 다. 모르면 예전처럼 글자 그대로 비교한다.
 */
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

/** 저장된 펼침 목록(`localStorage` 의 JSON) → 프로젝트 id 집합. 모양이 어긋나면 빈 집합 */
export function parseExpandedProjects(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
