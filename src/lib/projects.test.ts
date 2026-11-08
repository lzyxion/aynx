import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_AGENT,
  hasSetupScript,
  migrateProjectCommand,
  paneForSetup,
  setupRootVar,
  setupScriptLines,
  setupShellKind,
  draftOf,
  emptyDraft,
  isRemote,
  paneForProject,
  parseProjects,
  projectOfDraft,
  projectSearchText,
  projectTail,
  sortProjects,
  validateDraft,
  paneForNewRemoteWorktree,
  paneForWorktree,
  parseWorktrees,
  worktreeLabel,
  worktreeNameProblem,
  worktreePathFor,
  worktreePreview,
  worktreeBaseOf,
  worktreeDirProblem,
  worktreeTabTitle,
  defaultWorktreeDir,
  paneStartedIn,
  expandRemotePath,
  parseExpandedProjects,
  projectTreeRows,
  sameFolder,
  worktreeRowKey,
  type Project,
  type WorktreeInfo,
  type WorktreeListing,
  branchDeleteDefault,
  branchDeleteOption,
  branchDeleteToggleable,
  parseWorktreeRemoved,
  worktreeRemovedToast,
  type WorktreeRemoved,
  PROJECT_FORM_TABS,
  projectFormTabOf,
  projectProblemFieldId,
  type ProjectDraftProblem,
} from "$lib/projects";
import { translate } from "$lib/i18n/dict";
import { fuzzyMatch } from "$lib/hosts";
import { newLocalPane, newSshPane } from "$lib/session";
import {
  favoriteKey,
  parseFavorites,
  resolveFavorites,
  serializeFavorites,
  withFavorite,
} from "$lib/favorites";

// docs/log/2026-09-24-projects.md

const local = (over: Partial<Project> = {}): Project => ({
  id: "L1",
  name: "aynx",
  host: null,
  path: "C:\\Users\\me\\projects\\proj",
  shell: null,
  agent: "claude",
  setupScript: "",
  migration: null,
  tmux: false,
  worktreeDir: null,
  ...over,
});

const remote = (over: Partial<Project> = {}): Project => ({
  id: "R1",
  name: "aynx (dev-01)",
  host: "dev-01",
  path: "~/aynx",
  shell: null,
  agent: "claude",
  setupScript: "",
  migration: null,
  tmux: true,
  worktreeDir: null,
  ...over,
});

describe("parseProjects — 백엔드 값 → 믿을 수 있는 목록", () => {
  it("모양이 성한 줄만 살리고, 같은 id 는 앞의 것이 이긴다", () => {
    const got = parseProjects([
      { id: "a", name: "하나", host: null, path: "/p", shell: "pwsh", agent: "codex", tmux: true },
      { id: "a", name: "중복", path: "/q" },
      { id: "", name: "id 없음", path: "/x" },
      { id: "b", name: "  ", path: "/x" },
      { id: "c", name: "경로 없음" },
      "쓰레기",
      null,
      { id: "d", name: "원격", host: "web", path: "/srv", shell: "pwsh" },
    ]);
    expect(got.map((p) => p.id)).toEqual(["a", "d"]);
    // 로컬에는 tmux 가 없다 · 원격에는 셸 칸이 없다 · 칸이 다 없으면 옛 기본 명령(claude) → 에이전트 claude · 원격 tmux 는 기본 켬
    expect(got[0]).toMatchObject({ tmux: false, shell: "pwsh", agent: "codex", setupScript: "", migration: null });
    expect(got[1]).toMatchObject({ host: "web", shell: null, agent: DEFAULT_PROJECT_AGENT, tmux: true });
    expect(parseProjects({ projects: [] })).toEqual([]);
  });

  it("agent 칸이 있으면(null 이어도) 새 모양 — 옛 command 는 버린다 · 설정 스크립트와 안내를 읽는다", () => {
    const [a, b] = parseProjects([
      { id: "a", name: "n", path: "/p", agent: null, command: "claude", setupScript: "npm ci" },
      { id: "b", name: "n", path: "/p", agent: "claude", migration: { kind: "args", text: "--model opus" } },
    ]);
    expect(a).toMatchObject({ agent: null, setupScript: "npm ci", migration: null });
    expect(b.migration).toEqual({ kind: "args", text: "--model opus" });
    // 모르는 안내 모양은 버린다
    expect(parseProjects([{ id: "c", name: "n", path: "/p", agent: null, migration: { kind: "x", text: "y" } }])[0].migration).toBeNull();
  });

  /** **이관 표** — Rust `projects::tests::legacy_command_migrates_by_the_table` 와 같은 줄들 */
  it("옛 시작 명령 → 에이전트 · 설정 스크립트 · 안내 (이관 표)", () => {
    const table: [string, string, string | null, string, { kind: string; text: string } | null][] = [
      ["claude", "", "claude", "", null],
      ["codex", "", "codex", "", null],
      ["  Claude.exe  ", "", "claude", "", null],
      ["claude --model opus", "", "claude", "", { kind: "args", text: "--model opus" }],
      ["", "", null, "", null],
      ["   ", "", null, "", null],
      ["npm ci", "", null, "npm ci", { kind: "script", text: "npm ci" }],
      ["npm ci", "pnpm i", null, "pnpm i", { kind: "dropped", text: "npm ci" }],
    ];
    for (const [cmd, script, agent, wantScript, note] of table) {
      expect(migrateProjectCommand(cmd, script), cmd).toEqual({ agent, setupScript: wantScript, migration: note });
    }
    // 옛 모양이 그대로 오면(옛 백엔드) parseProjects 도 같은 표를 지난다 — 빈 명령은 셸
    const [x, y] = parseProjects([
      { id: "x", name: "n", path: "/p", command: "" },
      { id: "y", name: "n", path: "/p", command: "npm ci" },
    ]);
    expect(x).toMatchObject({ agent: null, setupScript: "", migration: null });
    expect(y).toMatchObject({ agent: null, setupScript: "npm ci", migration: { kind: "script", text: "npm ci" } });
  });

  it("워크트리 폴더 칸 — 없거나 비면 null(기본 자리), 있으면 다듬은 글자", () => {
    const got = parseProjects([
      { id: "a", name: "n", path: "/p" },
      { id: "b", name: "n", path: "/p", worktreeDir: "  " },
      { id: "c", name: "n", path: "/p", worktreeDir: " /srv/wt " },
    ]);
    expect(got.map((p) => p.worktreeDir)).toEqual([null, null, "/srv/wt"]);
  });
});

describe("paneForProject — 여는 길이 모두 지나는 타일 명세", () => {
  it("로컬 + AI CLI → AI 타일과 같은 칸 (cwd · autorun · MCP 토큰 표식)", () => {
    const pane = paneForProject(local(), "pwsh");
    expect(pane.kind).toBe("local");
    expect(pane.cwd).toBe("C:\\Users\\me\\projects\\proj");
    expect(pane.autorun).toBe("claude");
    expect(pane.injectMcpToken).toBe(true);
    expect(pane.shell).toBe("pwsh"); // 프로젝트에 셸이 없으면 넘겨받은 기본 셸
    expect(pane.historyStreamId).toBeTruthy();
  });

  it("로컬 — 프로젝트의 셸이 기본 셸보다 앞선다 · 에이전트는 id 가 곧 명령(codex)", () => {
    const pane = paneForProject(local({ shell: "wsl:Ubuntu", agent: "codex" }), "pwsh");
    expect(pane.shell).toBe("wsl:Ubuntu");
    expect(pane.autorun).toBe("codex");
    expect(pane.injectMcpToken).toBe(true);
  });

  it("로컬 — 에이전트가 없으면(셸) 그 폴더에서 셸만 (autorun · 토큰 표식 없음)", () => {
    const pane = paneForProject(local({ agent: null }));
    expect(pane.cwd).toBe("C:\\Users\\me\\projects\\proj");
    expect(pane.autorun).toBeUndefined();
    expect(pane.injectMcpToken).toBeUndefined();
  });

  it("원격 → SSH 타일 + 첫 입력 재료(cwd·autorun), tmux 는 프로젝트 토글 하나 (켬 forceTmux · 끔 noTmux)", () => {
    const pane = paneForProject(remote(), "pwsh", 20000);
    expect(pane.kind).toBe("ssh");
    expect(pane.alias).toBe("dev-01");
    expect(pane.cwd).toBe("~/aynx");
    expect(pane.autorun).toBe("claude");
    expect(pane.noTmux).toBeUndefined();
    // 켬 = 호스트 설정과 무관하게 tmux (2026-09-24 실기 ④)
    expect(pane.forceTmux).toBe(true);
    expect(pane.scrollback).toBe(20000);
    expect(pane.shell).toBeUndefined(); // 원격에는 로컬 셸이 없다
    expect(pane.injectMcpToken).toBeUndefined(); // 토큰은 로컬 셸 환경에만 심는다

    expect(paneForProject(remote({ tmux: false })).noTmux).toBe(true);
    expect(paneForProject(remote({ tmux: false })).forceTmux).toBeUndefined();
  });
});

describe("표시·검색·정렬", () => {
  it("폴더 꼬리 — 구분자 둘 다, 끝 구분자는 뗀다", () => {
    expect(projectTail("C:\\src\\proj")).toBe("proj");
    expect(projectTail("~/aynx/")).toBe("aynx");
    expect(projectTail("/")).toBe("/");
    expect(projectTail("repo")).toBe("repo");
  });

  it("검색 글자에 이름·경로·호스트가 다 든다", () => {
    const s = projectSearchText(remote());
    expect(s).toContain("aynx (dev-01)");
    expect(s).toContain("~/aynx");
    expect(s).toContain("dev-01");
    expect(isRemote(remote())).toBe(true);
    expect(isRemote(local())).toBe(false);
  });

  it("이름순 · 최근순(원격은 그 호스트의 마지막 성공, 로컬·이력 없음은 뒤에서 이름순)", () => {
    const list = [
      local({ id: "1", name: "zeta" }),
      remote({ id: "2", name: "alpha", host: "old" }),
      remote({ id: "3", name: "beta", host: "new" }),
      local({ id: "4", name: "Gamma" }),
    ];
    expect(sortProjects(list, "name", {}).map((p) => p.name)).toEqual(["alpha", "beta", "Gamma", "zeta"]);
    // 숫자는 자연순 — 호스트 · DB 칸과 같은 비교(`compareNames`)
    const numbered = [local({ id: "a", name: "app-10" }), local({ id: "b", name: "app-2" })];
    expect(sortProjects(numbered, "name", {}).map((p) => p.name)).toEqual(["app-2", "app-10"]);
    const entry = (at: number) => ({
      last_ok_at: at,
      last_fail_at: null,
      last_fail_cause: null,
      last_fail_message: null,
      count: 1,
    });
    const recent = sortProjects(list, "recent", { OLD: entry(1), new: entry(2) });
    // 별칭 비교는 대소문자를 무시한다 (`OLD` 이력이 `old` 호스트의 것이다)
    expect(recent.map((p) => p.name)).toEqual(["beta", "alpha", "Gamma", "zeta"]);
    expect(recent[0].host).toBe("new");
  });
});

describe("폼 초안", () => {
  it("검증 — 이름 → (원격이면) 호스트 → 경로 순", () => {
    const d = emptyDraft();
    // 새 프로젝트의 기본값 — 에이전트 Claude Code · 설정 스크립트 없음
    expect(d.agent).toBe("claude");
    expect(d.setupScript).toBe("");
    expect(validateDraft(d)).toBe("name");
    d.name = "aynx";
    expect(validateDraft(d)).toBe("path");
    d.location = "remote";
    expect(validateDraft(d)).toBe("host");
    d.host = "dev-01";
    d.path = "~/aynx";
    expect(validateDraft(d)).toBeNull();
  });

  it("로컬 경로는 절대 경로만 — `~`·상대 경로는 막는다 (2026-09-24 실기 ⑤, Rust normalize 와 같은 표)", () => {
    const d = { ...emptyDraft(), name: "aynx" };
    for (const bad of ["~/aynx-lab", "~", "repo", "./repo", "..\\repo", "C:repo"]) {
      d.path = bad;
      expect(validateDraft(d), bad).toBe("pathRelative");
    }
    for (const ok of ["C:\\Users\\me\\repo", "c:/src/aynx", "\\\\srv\\share\\repo", "/home/me/repo"]) {
      d.path = ok;
      expect(validateDraft(d), ok).toBeNull();
    }
    // 원격은 `~` 가 그대로 된다 (셸이 편다)
    Object.assign(d, { location: "remote", host: "dev-01", path: "~/aynx-lab" });
    expect(validateDraft(d)).toBeNull();
  });

  it("초안 → 한 줄: 위치에 맞지 않는 칸은 비운다 · 왕복", () => {
    const d = { ...emptyDraft(), name: " n ", path: " /p ", shell: "pwsh", location: "remote" as const, host: "web" };
    expect(projectOfDraft(d)).toEqual({
      id: "",
      name: "n",
      host: "web",
      path: "/p",
      shell: null,
      agent: "claude",
      setupScript: "",
      migration: null,
      tmux: true,
      worktreeDir: null,
      icon: null,
      color: null,
    });
    const l = projectOfDraft({ ...d, location: "local" });
    expect(l).toMatchObject({ host: null, shell: "pwsh", tmux: false });
    expect(projectOfDraft(draftOf(remote()))).toEqual({ ...remote(), icon: null, color: null });
    expect(projectOfDraft(draftOf(local()))).toEqual({ ...local(), icon: null, color: null });
  });

  // docs/log/2026-09-29-folder-project-icons.md
  it("아이콘 · 색 — 읽기 · 초안 왕복 · 빈 칸은 없음", () => {
    const [p, old] = parseProjects([
      { id: "a", name: "n", path: "/p", agent: null, icon: " svg:lucide:folder-git-2 ", color: "#4a90d9" },
      { id: "b", name: "n", path: "/p", agent: null },
    ]);
    expect(p.icon).toBe("svg:lucide:folder-git-2");
    expect(p.color).toBe("#4a90d9");
    expect(old.icon).toBeNull();
    expect(old.color).toBeNull();
    const d = draftOf(p);
    expect(d.icon).toBe("svg:lucide:folder-git-2");
    expect(projectOfDraft(d)).toMatchObject({ icon: "svg:lucide:folder-git-2", color: "#4a90d9" });
    expect(projectOfDraft({ ...d, icon: "  ", color: "" })).toMatchObject({ icon: null, color: null });
    expect(emptyDraft()).toMatchObject({ icon: "", color: "" });
  });
});

describe("즐겨찾기의 프로젝트 칸", () => {
  it("저장 모양 왕복 · 키 접두사 · 해석", () => {
    const list = withFavorite(withFavorite([], { kind: "host", alias: "web" }), { kind: "project", id: "R1" });
    const raw = serializeFavorites(list);
    expect(raw).toBe('[{"kind":"host","alias":"web"},{"kind":"project","id":"R1"}]');
    expect(parseFavorites(raw)).toEqual(list);
    expect(favoriteKey({ kind: "project", id: "R1" })).toBe("project:R1");
    expect(favoriteKey({ kind: "host", alias: "R1" })).not.toBe(favoriteKey({ kind: "project", id: "R1" }));
    const resolved = resolveFavorites(list, [], [remote()]);
    expect(resolved.map((f) => f.key)).toEqual(["project:R1"]); // 호스트 web 은 목록에 없어 빠진다
    expect(resolveFavorites(list, [], []).length).toBe(0); // 지운 프로젝트의 칸은 그리지 않는다
  });
});

// docs/log/2026-09-24-worktrees.md

describe("워크트리 — 목록 파싱", () => {
  it("bare 줄과 모양이 어긋난 줄은 버리고 git 순서를 지킨다", () => {
    const got = parseWorktrees([
      { path: "/home/me/api", branch: "main", head: "a1", bare: false, detached: false },
      { path: "/home/me/api.git", branch: null, head: null, bare: true, detached: false },
      { path: "/home/me/api-wt/probe", branch: null, head: "b2", bare: false, detached: true },
      { branch: "orphan" },
      null,
      "x",
    ]);
    expect(got.map((w) => w.path)).toEqual(["/home/me/api", "/home/me/api-wt/probe"]);
    expect(got[1]).toEqual({
      path: "/home/me/api-wt/probe",
      branch: null,
      head: "b2",
      bare: false,
      detached: true,
      createdByApp: false,
    });
    // 곁 파일의 "앱이 만들었다" 는 Rust 칸 `created_by_app` 으로 온다.
    expect(parseWorktrees([{ path: "/a", branch: "x", created_by_app: true }])[0].createdByApp).toBe(true);
    expect(parseWorktrees(null)).toEqual([]);
  });

  it("줄의 글자 = 브랜치 · 폴더 꼬리", () => {
    expect(worktreeLabel({ path: "C:/src/proj-wt/feat-x", branch: "feat-x", head: null, bare: false, detached: false })).toEqual({
      branch: "feat-x",
      tail: "feat-x",
    });
  });
});

describe("워크트리 — 이름 규칙 (Rust valid_name 과 같은 표)", () => {
  it.each(["feat-x", "feat/x", "v1.2", "a_b", " spaced-trim "])("통과: %s", (n) => {
    expect(worktreeNameProblem(n)).toBeNull();
  });
  it.each(["-x", "--force", "a..b", "..", "/abs", "tail/", "a//b", "a/./b", ".", "has space", "semi;colon", "quote'", "dollar$", "back\\slash", "한글"])(
    "막힘: %s",
    (n) => {
      expect(worktreeNameProblem(n)).toBe("invalid");
    },
  );
  it("빈 이름은 따로 말한다", () => {
    expect(worktreeNameProblem("  ")).toBe("empty");
  });
});

describe("워크트리 — 기본 자리 <저장소 부모>/<저장소명>-wt/<이름>", () => {
  const at = (path: string, worktreeDir: string | null = null) => ({ path, worktreeDir });
  it("원격·유닉스 경로", () => {
    expect(worktreePathFor(at("~/api"), "feat-x")).toBe("~/api-wt/feat-x");
    expect(worktreePathFor(at("/srv/app/"), "feat/x")).toBe("/srv/app-wt/feat/x");
    expect(worktreePathFor(at("/api"), "x")).toBe("/api-wt/x");
  });
  it("Windows 경로는 역슬래시를 따른다 (이름의 / 도)", () => {
    expect(worktreePathFor(at("C:\\src\\proj"), "feat-x")).toBe("C:\\src\\proj-wt\\feat-x");
    expect(worktreePathFor(at("C:\\src\\proj"), "feat/x")).toBe("C:\\src\\proj-wt\\feat\\x");
    expect(defaultWorktreeDir("C:\\src\\proj\\")).toBe("C:\\src\\proj-wt");
  });
  it("부모가 없거나 이름이 막히면 null", () => {
    expect(worktreePathFor(at("~"), "x")).toBeNull();
    expect(worktreePathFor(at("C:\\"), "x")).toBeNull();
    expect(worktreePathFor(at("~/api"), "-x")).toBeNull();
    expect(defaultWorktreeDir("~")).toBeNull();
  });
});

describe("워크트리 — 폴더 칸(worktreeDir)", () => {
  const at = (path: string, worktreeDir: string | null = null) => ({ path, worktreeDir });
  it("칸이 있으면 그 폴더 아래 · 구분자는 그 폴더를 따른다 · 끝 구분자는 뗀다", () => {
    expect(worktreePathFor(at("C:\\src\\proj", "D:\\wt\\proj"), "feat/x")).toBe("D:\\wt\\proj\\feat\\x");
    expect(worktreePathFor(at("~/api", "/srv/wt/"), "feat-x")).toBe("/srv/wt/feat-x");
    expect(worktreeBaseOf(at("~/api", "/srv/wt//"))).toBe("/srv/wt");
    // 뿌리는 그대로 — 구분자를 겹쳐 쓰지 않는다
    expect(worktreePathFor(at("C:\\src\\proj", "D:\\"), "x")).toBe("D:\\x");
    // 부모가 없는 저장소라도 칸이 있으면 자리가 선다
    expect(worktreePathFor(at("~", "/srv/wt"), "x")).toBe("/srv/wt/x");
    // 빈 칸은 기본 자리
    expect(worktreeBaseOf(at("~/api", "  "))).toBe("~/api-wt");
  });

  it("미리 보기 — 이름이 비면 <이름> 자리표시, 막히면 null", () => {
    expect(worktreePreview(at("C:\\src\\proj"), "", "<이름>")).toBe("C:\\src\\proj-wt\\<이름>");
    expect(worktreePreview(at("~/api", "/srv/wt"), "feat-y", "<이름>")).toBe("/srv/wt/feat-y");
    expect(worktreePreview(at("~/api"), "a..b", "<이름>")).toBeNull();
    expect(worktreePreview(at("~"), "", "<이름>")).toBeNull();
  });

  // Rust `worktree::tests::worktree_dir_check_table` 과 **같은 표**다.
  it.each([
    ["C:\\src\\aynx", "D:\\wt", false, null],
    ["C:\\src\\aynx", "C:\\src\\aynx-wt", false, null],
    ["C:\\src\\aynx", "\\\\nas\\wt", false, null],
    ["C:\\src\\aynx", "C:\\src\\aynx", false, "inside"],
    ["C:\\src\\aynx", "c:/SRC/aynx/sub", false, "inside"],
    ["C:\\src\\aynx", "C:\\src\\aynx\\", false, "inside"],
    ["C:\\src\\aynx", "wt", false, "relative"],
    ["C:\\src\\aynx", "~/wt", false, "relative"],
    ["~/api", "~/wt", true, null],
    ["~/api", "/srv/wt", true, null],
    ["~/api", "~/api/wt", true, "inside"],
    ["~/api", "wt", true, "relative"],
    ["/srv/api", "/srv/Api/wt", true, null],
  ] as const)("%s + %s (원격 %s) → %s", (repo, dir, remote, want) => {
    expect(worktreeDirProblem(repo, dir, remote)).toBe(want);
  });

  it("폼 검증 — 칸이 막히면 worktreeDir, 비면 통과", () => {
    const d = { ...emptyDraft(), name: "aynx", path: "C:\\src\\aynx" };
    expect(validateDraft(d)).toBeNull();
    expect(validateDraft({ ...d, worktreeDir: "C:\\src\\aynx\\wt" })).toBe("worktreeDir");
    expect(validateDraft({ ...d, worktreeDir: "D:\\wt" })).toBeNull();
    expect(projectOfDraft({ ...d, worktreeDir: " D:\\wt " }).worktreeDir).toBe("D:\\wt");
    expect(projectOfDraft(d).worktreeDir).toBeNull();
  });

  it("탭 제목 — <프로젝트> · <워크트리>", () => {
    expect(worktreeTabTitle("aynx", "feat-x")).toBe("aynx · feat-x");
  });
});

describe("워크트리 — 타일 명세", () => {
  it("있는 워크트리 = 프로젝트를 그 폴더로 바꾼 명세 (로컬)", () => {
    const pane = paneForWorktree(local(), "C:/src/proj-wt/feat-x", "pwsh");
    expect(pane.kind).toBe("local");
    expect(pane.cwd).toBe("C:/src/proj-wt/feat-x");
    expect(pane.autorun).toBe("claude");
    expect(pane.injectMcpToken).toBe(true);
    expect(pane.worktree).toBeUndefined();
  });

  it("원격 새 워크트리 = cwd 는 워크트리, 만들 재료는 worktree", () => {
    // 폴더 칸이 있으면 그 아래 — 첫 입력의 `cd` 대상이 곧 이 값이다
    expect(paneForNewRemoteWorktree(remote({ path: "~/api", worktreeDir: "/srv/wt" }), "z")?.cwd).toBe(
      "/srv/wt/z",
    );
    const pane = paneForNewRemoteWorktree(remote({ path: "~/api", agent: "codex" }), " feat-x ");
    expect(pane?.kind).toBe("ssh");
    expect(pane?.cwd).toBe("~/api-wt/feat-x");
    expect(pane?.autorun).toBe("codex");
    expect(pane?.worktree).toEqual({ repo: "~/api", name: "feat-x", projectId: "R1" });
    // tmux 토글은 프로젝트 규칙 그대로
    expect(paneForNewRemoteWorktree(remote({ tmux: false }), "x")?.noTmux).toBe(true);
  });

  it("로컬 프로젝트·막힌 이름에는 원격 명세가 없다", () => {
    expect(paneForNewRemoteWorktree(local(), "x")).toBeNull();
    expect(paneForNewRemoteWorktree(remote(), "a..b")).toBeNull();
  });
});

// docs/log/2026-09-28-project-agent-setup-script.md
describe("설정 스크립트 — 타일 명세 · 폼 힌트", () => {
  it("로컬 — autorun 없이 열고(에이전트는 끝 신호 뒤) 스크립트 재료는 id 뿐 · 토큰 표식은 미리", () => {
    const p = local({ setupScript: "pnpm install" });
    const pane = paneForSetup(p, "C:/src/proj-wt/feat-x", true, "Claude Code", "pwsh");
    expect(pane.kind).toBe("local");
    expect(pane.cwd).toBe("C:/src/proj-wt/feat-x");
    expect(pane.autorun).toBeUndefined();
    expect(pane.injectMcpToken).toBe(true);
    expect(pane.shell).toBe("pwsh");
    expect(pane.setup).toEqual({ projectId: "L1", repo: p.path, agent: "claude", agentName: "Claude Code" });
    expect(JSON.stringify(pane)).not.toContain("pnpm install"); // 스크립트 글자는 싣지 않는다
    // 스크립트만(독의 [설정 스크립트 실행]) — 에이전트 없음 · 토큰 없음
    const only = paneForSetup(p, "C:/x", false, "Claude Code");
    expect(only.setup).toEqual({ projectId: "L1", repo: p.path, agent: null, agentName: null });
    expect(only.injectMcpToken).toBeUndefined();
  });

  it("원격 — 여는 길과 같은 SSH 명세(autorun = 에이전트) + setup · 새 워크트리면 worktree 도", () => {
    const p = remote({ path: "~/api", setupScript: "npm ci" });
    const pane = paneForNewRemoteWorktree(p, "feat-x", 5000, "Claude Code");
    expect(pane?.kind).toBe("ssh");
    expect(pane?.cwd).toBe("~/api-wt/feat-x");
    expect(pane?.autorun).toBe("claude");
    expect(pane?.setup).toEqual({ projectId: "R1", repo: "~/api", agent: "claude", agentName: "Claude Code" });
    expect(pane?.worktree).toEqual({ repo: "~/api", name: "feat-x", projectId: "R1" });
    // 스크립트가 없으면 예전 그대로
    expect(paneForNewRemoteWorktree(remote(), "feat-x")?.setup).toBeUndefined();
    // 스크립트만 — autorun 없음
    expect(paneForSetup(p, "~/api-wt/b", false, null).autorun).toBeUndefined();
  });

  it("줄 수 · 있음 판정 · 도는 셸과 변수 표기", () => {
    expect(setupScriptLines("a\n\n  \r\nb")).toBe(2);
    expect(hasSetupScript(local({ setupScript: " \n " }))).toBe(false);
    expect(hasSetupScript(local({ setupScript: "x" }))).toBe(true);
    expect(setupShellKind("pwsh", false)).toBe("powershell");
    expect(setupShellKind(null, false)).toBe("powershell");
    expect(setupShellKind("cmd", false)).toBe("cmd");
    expect(setupShellKind("gitbash", false)).toBe("posix");
    expect(setupShellKind("wsl:Ubuntu", false)).toBe("posix");
    expect(setupShellKind("cmd", true)).toBe("posix"); // 원격은 늘 sh
    expect(setupRootVar("powershell")).toBe("$env:AYNX_ROOT_PATH");
    expect(setupRootVar("cmd")).toBe("%AYNX_ROOT_PATH%");
    expect(setupRootVar("posix")).toBe("$AYNX_ROOT_PATH");
  });

  it("초안 — 이관 안내는 편집 초안에 실리지만 저장할 때는 싣지 않는다", () => {
    const p = local({ agent: null, setupScript: "npm ci", migration: { kind: "script", text: "npm ci" } });
    const d = draftOf(p);
    expect(d.migration).toEqual({ kind: "script", text: "npm ci" });
    expect(d.setupScript).toBe("npm ci");
    const back = projectOfDraft(d);
    expect(back.migration).toBeNull();
    expect(back.agent).toBeNull();
    expect(back.setupScript).toBe("npm ci");
    // 공백뿐인 스크립트는 없는 것
    expect(projectOfDraft({ ...d, setupScript: "  \n " }).setupScript).toBe("");
  });
});

// docs/log/2026-09-24-worktrees.md "브랜치는 같이 지운다"
describe("워크트리 제거 — 브랜치 칸과 알림 문구", () => {
  const w = (branch: string | null, createdByApp: boolean): WorktreeInfo => ({
    path: "C:/src/proj-wt/x",
    branch,
    head: null,
    bare: false,
    detached: branch === null,
    createdByApp,
  });

  it("칸 — 앱이 만든 브랜치는 켜진 채 · 먼저 있던 것은 흐리게 · 분리된 HEAD 와 지금 브랜치는 없음", () => {
    expect(branchDeleteOption(w("feat-x", true), "main")).toEqual({ kind: "delete", branch: "feat-x" });
    expect(branchDeleteOption(w("old-b", false), "main")).toEqual({ kind: "predates", branch: "old-b" });
    expect(branchDeleteOption(w(null, true), "main")).toEqual({ kind: "hidden" });
    expect(branchDeleteOption(w("main", true), "main")).toEqual({ kind: "hidden" });
    // 원격 — 앱이 만든 기록(곁 파일의 원격 줄)이 없으면 칸은 살되(`remote`) 꺼진 채로 연다(대화 상자 쪽).
    expect(branchDeleteOption(w("fix", false), "main", true)).toEqual({ kind: "remote", branch: "fix" });
    // 2026-09-29 B안 — 원격도 앱이 `-b` 로 만든 브랜치면 로컬처럼 켜진 채(`delete`).
    expect(branchDeleteOption(w("fix", true), "main", true)).toEqual({ kind: "delete", branch: "fix" });
    expect(branchDeleteOption(w("main", true), "main", true)).toEqual({ kind: "hidden" });
    expect(branchDeleteOption(w(null, false), "main", true)).toEqual({ kind: "hidden" });
    expect(branchDeleteOption(w("main", false), "main", true)).toEqual({ kind: "hidden" });
    expect(branchDeleteToggleable({ kind: "remote", branch: "fix" })).toBe(true);
    expect(branchDeleteToggleable({ kind: "delete", branch: "fix" })).toBe(true);
    expect(branchDeleteToggleable({ kind: "predates", branch: "fix" })).toBe(false);
    expect(branchDeleteToggleable({ kind: "hidden" })).toBe(false);
    // 곁 파일을 모르는 옛 답(칸 없음)은 먼저 있던 것으로 본다 — 모르면 지우지 않는다.
    expect(branchDeleteOption({ path: "/a", branch: "b", head: null, bare: false, detached: false }, null).kind).toBe(
      "predates",
    );
  });

  // 2026-10-05 — 먼저 있던 브랜치라도 main 에 병합됐으면 칸은 살되 꺼진 채(docs/log/2026-10-05-worktree-one-to-one.md)
  it.each([
    // [만든 이, 원격, 병합됨, 칸, 켜고 끌 수 있나, 처음 켜짐]
    ["앱이 만든 것", true, false, false, "delete", true, true],
    ["앱이 만든 것 · 병합됨", true, false, true, "delete", true, true],
    ["먼저 있던 것 · 병합됨", false, false, true, "merged", true, false],
    ["먼저 있던 것 · 병합 안 됨(모름)", false, false, false, "predates", false, false],
    ["원격 · 기록 없음 · 병합됨", false, true, true, "remote", true, false],
    ["원격 · 기록 없음", false, true, false, "remote", true, false],
  ] as const)("칸 표 — %s", (_name, created, remote, merged, kind, toggleable, checked) => {
    const o = branchDeleteOption(w("old-b", created), "main", remote, merged);
    expect(o).toEqual({ kind, branch: "old-b" });
    expect(branchDeleteToggleable(o)).toBe(toggleable);
    expect(branchDeleteDefault(o)).toBe(checked);
  });

  it("칸 표 — 병합됨이어도 분리된 HEAD · 지금 브랜치는 칸이 없다", () => {
    expect(branchDeleteOption(w(null, false), "main", false, true)).toEqual({ kind: "hidden" });
    expect(branchDeleteOption(w("main", false), "main", false, true)).toEqual({ kind: "hidden" });
    expect(branchDeleteDefault({ kind: "hidden" })).toBe(false);
  });

  it("답 파싱 — Rust 의 snake_case 칸, 모르는 까닭은 null", () => {
    expect(
      parseWorktreeRemoved({
        removed: true,
        branch: "feat-u",
        branch_deleted: false,
        branch_kept_reason: "unmerged",
        message: "error: the branch 'feat-u' is not fully merged",
      }),
    ).toEqual({
      removed: true,
      branch: "feat-u",
      branchDeleted: false,
      branchKeptReason: "unmerged",
      message: "error: the branch 'feat-u' is not fully merged",
    });
    expect(parseWorktreeRemoved({ removed: false, message: "fatal: contains modified files" }).removed).toBe(false);
    expect(parseWorktreeRemoved({ removed: true, branch_kept_reason: "weird" }).branchKeptReason).toBeNull();
  });

  it("알림 문구 — 지움 · 병합 안 됨 · 먼저 있던 것 · 끈 것 · 분리된 HEAD", () => {
    const text = (r: Partial<WorktreeRemoved>) => {
      const m = worktreeRemovedToast({
        removed: true,
        branch: null,
        branchDeleted: false,
        branchKeptReason: null,
        message: null,
        ...r,
      });
      return translate("ko", m.key, m.params);
    };
    expect(text({ branch: "feat-x", branchDeleted: true })).toBe("워크트리를 제거했습니다 · 브랜치 feat-x 삭제");
    expect(text({ branch: "feat-u", branchKeptReason: "unmerged" })).toBe(
      "워크트리를 제거했습니다 · 브랜치 feat-u 은 남겼습니다 (병합되지 않은 커밋)",
    );
    expect(text({ branch: "old-b", branchKeptReason: "predates" })).toBe(
      "워크트리를 제거했습니다 · 브랜치는 남겼습니다 (워크트리보다 먼저 있던 브랜치)",
    );
    expect(text({ branch: "feat-x", branchKeptReason: "not_requested" })).toBe(
      "워크트리를 제거했습니다 · 브랜치 feat-x 은 남겼습니다",
    );
    expect(text({ branch: "main", branchKeptReason: "main" })).toBe("워크트리를 제거했습니다 · 브랜치 main 은 남겼습니다");
    expect(text({})).toBe("워크트리를 제거했습니다");
  });
});

// docs/log/2026-09-24-worktrees.md "독의 트리"
describe("projectTreeRows — 독의 두 켜 트리", () => {
  const wt = (path: string, branch: string | null): WorktreeInfo => ({
    path,
    branch,
    head: null,
    bare: false,
    detached: branch === null,
  });
  const L = local({ id: "L1", name: "aynx", path: "C:\\src\\proj" });
  const R = remote({ id: "R1", name: "api", path: "~/api" });
  const listing: Record<string, WorktreeListing> = {
    L1: { state: "ok", list: [wt("C:/src/proj", "main"), wt("C:/src/proj-wt/feat-x", "feat-x")] },
    R1: { state: "offline" },
  };
  const of = (id: string) => listing[id];
  const shape = (rows: ReturnType<typeof projectTreeRows>) =>
    rows.map((r) =>
      r.kind === "project"
        ? `P:${r.project.id}${r.expanded ? (r.auto ? "+auto" : "+") : ""}`
        : r.kind === "worktree"
          ? `W:${r.worktree.branch}${r.primary ? "*" : ""}`
          : `N:${r.note}`,
    );

  it("접힌 것은 프로젝트 줄만 — 기본은 접힘", () => {
    expect(shape(projectTreeRows([R, L], "", new Set(), of, fuzzyMatch))).toEqual(["P:R1", "P:L1"]);
  });

  it("펼치면 워크트리 줄(첫 줄 = 주 폴더)만 — '+ 새 워크트리' 아이 줄은 없다(프로젝트 줄의 + 로 옮겼다)", () => {
    const rows = projectTreeRows([R, L], "", new Set(["L1"]), of, fuzzyMatch);
    expect(shape(rows)).toEqual(["P:R1", "P:L1+", "W:main*", "W:feat-x"]);
    expect(rows[3]?.key).toBe(worktreeRowKey("L1", "C:/src/proj-wt/feat-x"));
  });

  it("안 읽었거나 읽는 중·접속 전·실패는 안내 한 줄", () => {
    const none = projectTreeRows([L], "", new Set(["L1"]), () => undefined, fuzzyMatch);
    expect(shape(none)).toEqual(["P:L1+", "N:loading"]);
    expect(shape(projectTreeRows([R], "", new Set(["R1"]), of, fuzzyMatch))).toEqual(["P:R1+", "N:offline"]);
    const err = projectTreeRows([L], "", new Set(["L1"]), () => ({ state: "error", message: "fatal: x" }), fuzzyMatch);
    expect(err[1]).toMatchObject({ kind: "note", note: "error", message: "fatal: x" });
  });

  it("검색 — 워크트리가 걸리면 저절로 펼쳐 걸린 줄만", () => {
    const rows = projectTreeRows([R, L], "feat-x", new Set(), of, fuzzyMatch);
    expect(shape(rows)).toEqual(["P:L1+auto", "W:feat-x"]);
  });

  it("검색 — 프로젝트만 걸리면 평소 모양(저장된 펼침을 따른다), 아무것도 안 걸리면 빠진다", () => {
    expect(shape(projectTreeRows([R, L], "api", new Set(), of, fuzzyMatch))).toEqual(["P:R1"]);
    expect(shape(projectTreeRows([R, L], "aynx", new Set(["L1"]), of, fuzzyMatch))).toEqual([
      "P:L1+",
      "W:main*",
      "W:feat-x",
    ]);
    expect(projectTreeRows([R, L], "zzz", new Set(), of, fuzzyMatch)).toEqual([]);
  });
});

describe("sameFolder · paneStartedIn — 워크트리 줄의 에이전트 점 짝", () => {
  it("Windows 꼴은 구분자·대소문자·끝 구분자를 무시, 유닉스 꼴은 글자 그대로(끝 / 만 뗀다)", () => {
    expect(sameFolder("C:\\src\\proj-wt\\feat-x", "C:/src/proj-wt/feat-x")).toBe(true);
    expect(sameFolder("c:/SRC/proj/", "C:\\src\\proj")).toBe(true);
    expect(sameFolder("/root/api/", "/root/api")).toBe(true);
    expect(sameFolder("/root/Api", "/root/api")).toBe(false);
    // `~` 는 sameFolder 가 펴지 않는다 — 원격이면 부르는 쪽이 expandRemotePath 로 먼저 편다
    expect(sameFolder("~/api", "/root/api")).toBe(false);
    expect(sameFolder("", "")).toBe(false);
  });

  it("로컬 프로젝트는 로컬 타일, 원격은 같은 별칭의 SSH 타일만 — 시작 폴더(cwd)로", () => {
    const L = local({ path: "C:\\src\\proj" });
    const lp = newLocalPane("pwsh");
    lp.cwd = "C:\\src\\proj-wt\\feat-x";
    expect(paneStartedIn(lp, L, "C:/src/proj-wt/feat-x")).toBe(true);
    expect(paneStartedIn(lp, L, "C:/src/proj")).toBe(false);
    const R = remote({ host: "dev-01", path: "~/api" });
    expect(paneStartedIn(lp, R, "C:/src/proj-wt/feat-x")).toBe(false);
    const sp = newSshPane("DEV-01");
    sp.cwd = "/root/api-wt/fix";
    expect(paneStartedIn(sp, R, "/root/api-wt/fix")).toBe(true);
    expect(paneStartedIn(sp, L, "/root/api-wt/fix")).toBe(false);
    expect(paneStartedIn(newSshPane("web"), R, "/root/api-wt/fix")).toBe(false);
  });

  it("원격은 홈을 알면 양쪽을 펴고 맞댄다 — `~/api` 타일 ≡ git 의 `/root/api`", () => {
    const R = remote({ host: "dev-01", path: "~/api" });
    const sp = newSshPane("dev-01");
    sp.cwd = "~/api";
    expect(paneStartedIn(sp, R, "/root/api", "/root")).toBe(true);
    expect(paneStartedIn(sp, R, "/root/api-wt/x", "/root")).toBe(false);
    // 모르면 예전 그대로(글자 비교) — `~/api` 끼리만 같다
    expect(paneStartedIn(sp, R, "/root/api")).toBe(false);
    expect(paneStartedIn(sp, R, "~/api")).toBe(true);
    // 줄 쪽이 `~` 이고 타일이 절대 경로여도 같다 (양쪽을 편다)
    sp.cwd = "/home/me/api";
    expect(paneStartedIn(sp, R, "~/api", "/home/me")).toBe(true);
    // 로컬 프로젝트에는 홈이 쓰이지 않는다
    const lp = newLocalPane("pwsh");
    lp.cwd = "~/api";
    expect(paneStartedIn(lp, local({ path: "~/api" }), "/root/api", "/root")).toBe(false);
  });
});

describe("expandRemotePath — 원격 `~` 를 홈으로", () => {
  it("`~`·`~/x` 만 편다 — 다른 꼴과 모르는 홈은 그대로", () => {
    expect(expandRemotePath("~", "/root")).toBe("/root");
    expect(expandRemotePath("~/api", "/root")).toBe("/root/api");
    expect(expandRemotePath("~/api", "/home/me/")).toBe("/home/me/api");
    expect(expandRemotePath("~/api", "/")).toBe("/api");
    expect(expandRemotePath("~", "/")).toBe("/");
    expect(expandRemotePath("/srv/api", "/root")).toBe("/srv/api");
    expect(expandRemotePath("~bob/api", "/root")).toBe("~bob/api");
    expect(expandRemotePath("api", "/root")).toBe("api");
    expect(expandRemotePath("~/api", null)).toBe("~/api");
    expect(expandRemotePath("~/api", "")).toBe("~/api");
  });
});

describe("parseExpandedProjects — 저장된 펼침", () => {
  it("문자열 배열만 받고, 어긋나면 빈 집합", () => {
    expect([...parseExpandedProjects('["L1",3,"R1"]')]).toEqual(["L1", "R1"]);
    expect(parseExpandedProjects(null).size).toBe(0);
    expect(parseExpandedProjects("{").size).toBe(0);
    expect(parseExpandedProjects('{"a":1}').size).toBe(0);
  });
});

describe("프로젝트 폼의 면 — 막힌 칸이 있는 면", () => {
  const ALL: ProjectDraftProblem[] = [
    "name",
    "host",
    "path",
    "pathRelative",
    "pathMissing",
    "worktreeDir",
    "folderName",
    "parent",
    "parentRelative",
  ];
  it("워크트리 폴더만 워크트리 면, 나머지는 일반 면 — 표시 면에는 막는 칸이 없다", () => {
    for (const p of ALL) expect(projectFormTabOf(p)).toBe(p === "worktreeDir" ? "worktree" : "general");
    expect(projectFormTabOf(null)).toBe(null);
    expect(projectFormTabOf(undefined)).toBe(null);
    expect(PROJECT_FORM_TABS).toEqual(["general", "worktree", "display"]);
  });
  it("칸 id — 같은 칸을 가리키는 문제는 같은 id", () => {
    expect(projectProblemFieldId("name")).toBe("project-name");
    expect(projectProblemFieldId("folderName")).toBe("project-name");
    expect(projectProblemFieldId("pathMissing")).toBe("project-path");
    expect(projectProblemFieldId("parentRelative")).toBe("project-parent");
    expect(projectProblemFieldId("worktreeDir")).toBe("project-worktree-dir");
    for (const p of ALL) expect(projectProblemFieldId(p)).toMatch(/^project-/);
  });
});
