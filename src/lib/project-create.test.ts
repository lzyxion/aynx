import { describe, expect, it } from "vitest";
import {
  duplicateProjectOf,
  emptyDraft,
  projectTreeRows,
  validateCreateDraft,
  type Project,
  type WorktreeInfo,
} from "$lib/projects";
import { hasReason, stripReason } from "$lib/error-reason";
import {
  gitIdentityCommands,
  isUnbornHead,
  newProjectPath,
  parseRepoStatus,
  projectFolderNameProblem,
  repoCheckActionKey,
  repoCheckBlocks,
  repoCheckKey,
  repoCheckLine,
  type RepoCheck,
  type RepoStatus,
} from "$lib/repo-status";
import { fuzzyMatch } from "$lib/hosts";

// docs/log/2026-09-28-project-create.md

const local = (over: Partial<Project> = {}): Project => ({
  id: "L1",
  name: "api",
  host: null,
  path: "C:\\src\\api",
  shell: null,
  agent: "claude", setupScript: "", migration: null,
  tmux: false,
  worktreeDir: null,
  ...over,
});

const done = (status: RepoStatus): RepoCheck => ({ state: "done", key: "k", status });

describe("parseRepoStatus — Rust RepoStatus 의 모양", () => {
  it("여섯 갈래를 그대로 받는다", () => {
    expect(parseRepoStatus({ kind: "ok", branch: "main", worktrees: 2 })).toEqual({
      kind: "ok",
      branch: "main",
      worktrees: 2,
    });
    expect(parseRepoStatus({ kind: "ok", branch: null, worktrees: null })).toEqual({
      kind: "ok",
      branch: null,
      worktrees: null,
    });
    expect(parseRepoStatus({ kind: "notRepo" })).toEqual({ kind: "notRepo" });
    expect(parseRepoStatus({ kind: "missing" })).toEqual({ kind: "missing" });
    expect(parseRepoStatus({ kind: "noCommit", branch: "trunk" })).toEqual({ kind: "noCommit", branch: "trunk" });
    expect(parseRepoStatus({ kind: "subfolder", root: "C:\\src\\api" })).toEqual({
      kind: "subfolder",
      root: "C:\\src\\api",
    });
    expect(parseRepoStatus({ kind: "error", message: "fatal: x" })).toEqual({ kind: "error", message: "fatal: x" });
  });

  it("모양이 어긋나면 throw 하지 않고 error", () => {
    expect(parseRepoStatus(null)).toEqual({ kind: "error", message: "" });
    expect(parseRepoStatus({ kind: "subfolder" })).toEqual({ kind: "error", message: "" });
    expect(parseRepoStatus({ kind: "weird" })).toEqual({ kind: "error", message: "" });
  });
});

describe("repoCheckLine — 경로 칸 아래 한 줄", () => {
  it("아직 안 봤거나 보는 중이면 세우지 않는다", () => {
    expect(repoCheckLine({ state: "idle" }, false, false, false)).toBeNull();
    expect(repoCheckLine({ state: "checking", key: "k" }, false, false, false)).toBeNull();
  });

  it("ok — 초록 점 한 줄, 워크트리가 둘 이상이면 수를 붙인다", () => {
    expect(repoCheckLine(done({ kind: "ok", branch: "main", worktrees: 1 }), false, false, false)).toEqual({
      tone: "ok",
      key: "app.projects.form.check.ok",
      params: { branch: "main" },
      actions: [],
    });
    expect(repoCheckLine(done({ kind: "ok", branch: "main", worktrees: 3 }), false, false, false)?.key).toBe(
      "app.projects.form.check.okWorktrees",
    );
  });

  it("저장소 아님 — [초기화하고 추가] [그대로 추가], 편집에서는 초기화만", () => {
    expect(repoCheckLine(done({ kind: "notRepo" }), false, false, false)?.actions).toEqual(["initAndAdd", "addAsIs"]);
    expect(repoCheckLine(done({ kind: "notRepo" }), false, true, false)?.actions).toEqual(["initAndAdd"]);
    expect(repoCheckActionKey("initAndAdd", true)).toBe("app.projects.form.check.action.initAndSave");
    expect(repoCheckActionKey("commitAndAdd", true)).toBe("app.projects.form.check.action.commitAndSave");
    expect(repoCheckActionKey("addAsIs", false)).toBe("app.projects.form.check.action.addAsIs");
  });

  it("하위 폴더 — [루트로 바꾸기] [이대로 두기], 걷으면 사라진다", () => {
    const sub = done({ kind: "subfolder", root: "C:\\src\\api" });
    expect(repoCheckLine(sub, false, false, false)).toMatchObject({
      tone: "warn",
      params: { root: "C:\\src\\api" },
      actions: ["useRoot", "keepSub"],
    });
    expect(repoCheckLine(sub, false, false, true)).toBeNull();
  });

  it("커밋 없음 — [첫 커밋 만들고 추가]", () => {
    expect(repoCheckLine(done({ kind: "noCommit", branch: null }), false, false, false)).toMatchObject({
      tone: "warn",
      params: { branch: "main" },
      actions: ["commitAndAdd"],
    });
  });

  it("없는 폴더 — 로컬은 오류(저장을 막는다), 원격은 경고(막지 않는다)", () => {
    const missing = done({ kind: "missing" });
    expect(repoCheckLine(missing, false, false, false)?.tone).toBe("err");
    expect(repoCheckLine(missing, false, true, false)?.key).toBe("app.projects.form.check.missingEdit");
    expect(repoCheckLine(missing, true, false, false)?.tone).toBe("warn");
    expect(repoCheckBlocks(missing, false)).toBe(true);
    expect(repoCheckBlocks(missing, true)).toBe(false);
    expect(repoCheckBlocks(done({ kind: "notRepo" }), false)).toBe(false);
    expect(repoCheckBlocks({ state: "unknown", key: "k" }, false)).toBe(false);
  });

  it("원격인데 붙은 세션이 없다 — 옅은 한 줄", () => {
    expect(repoCheckLine({ state: "unknown", key: "k" }, true, false, false)?.tone).toBe("muted");
  });

  it("판정 열쇠 — 로컬은 호스트를 보지 않고, 원격 별칭은 대소문자 무시", () => {
    expect(repoCheckKey("local", "web", " C:\\a ")).toBe(repoCheckKey("local", "", "C:\\a"));
    expect(repoCheckKey("remote", "Web", "~/a")).toBe(repoCheckKey("remote", "web", "~/a"));
    expect(repoCheckKey("remote", "web", "~/a")).not.toBe(repoCheckKey("local", "web", "~/a"));
  });
});

describe("projectFolderNameProblem — Rust valid_folder_name 과 같은 표", () => {
  it("통과", () => {
    for (const ok of ["api", "api-server", "v1.2", "a_b", " trim ", "console", "con-x"]) {
      expect(projectFolderNameProblem(ok), ok).toBeNull();
    }
  });
  it("막힘", () => {
    expect(projectFolderNameProblem("  ")).toBe("empty");
    for (const bad of ["-x", "a/b", "..", ".", "a.", "has space", "한글", "a\nb", "con", "NUL", "nul.txt", "Com1", "lpt9.md"]) {
      expect(projectFolderNameProblem(bad), bad).toBe("invalid");
    }
  });
});

describe("newProjectPath — 새로 만들 자리의 미리 보기", () => {
  it("로컬은 부모의 구분자를 따른다", () => {
    expect(newProjectPath("C:\\src", "api", false)).toBe("C:\\src\\api");
    expect(newProjectPath("C:\\src\\", "api", false)).toBe("C:\\src\\api");
    expect(newProjectPath("C:/src", "api", false)).toBe("C:/src/api");
    expect(newProjectPath("/home/me", "api", false)).toBe("/home/me/api");
  });
  it("원격은 / — Rust remote_join 과 같다", () => {
    expect(newProjectPath("~/src/", "api", true)).toBe("~/src/api");
    expect(newProjectPath("~", "api", true)).toBe("~/api");
    expect(newProjectPath("/", "api", true)).toBe("/api");
  });
  it("비었으면 null", () => {
    expect(newProjectPath("", "api", false)).toBeNull();
    expect(newProjectPath("C:\\src", " ", false)).toBeNull();
  });
});

describe("validateCreateDraft — 새로 만들기의 칸", () => {
  const d = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => ({ ...emptyDraft(), name: "api", ...over });
  it("이름 · 폴더 이름 · 호스트 · 만들 자리 순으로 막는다", () => {
    expect(validateCreateDraft(d({ name: "" }), "C:\\src")).toBe("name");
    expect(validateCreateDraft(d({ name: "my app" }), "C:\\src")).toBe("folderName");
    expect(validateCreateDraft(d({ location: "remote", host: "" }), "~/src")).toBe("host");
    expect(validateCreateDraft(d(), " ")).toBe("parent");
    expect(validateCreateDraft(d(), "src")).toBe("parentRelative");
    expect(validateCreateDraft(d(), "~/src")).toBe("parentRelative");
    expect(validateCreateDraft(d({ location: "remote", host: "web" }), "src")).toBe("parentRelative");
    expect(validateCreateDraft(d(), "C:\\src")).toBeNull();
    expect(validateCreateDraft(d({ location: "remote", host: "web" }), "~/src")).toBeNull();
  });
  it("워크트리 폴더는 만들어질 자리 기준 — 그 안이면 막는다", () => {
    expect(validateCreateDraft(d({ worktreeDir: "C:\\src\\api\\wt" }), "C:\\src")).toBe("worktreeDir");
    expect(validateCreateDraft(d({ worktreeDir: "C:\\src\\api-wt" }), "C:\\src")).toBeNull();
  });
});

describe("duplicateProjectOf — 같은 폴더 경고", () => {
  const list = [
    local({ id: "A", name: "api", path: "C:\\src\\api" }),
    local({ id: "R", name: "api@web", host: "web", path: "~/api" }),
  ];
  it("같은 위치에서 sameFolder 로 견준다 — 자기 자신은 뺀다", () => {
    const draft = { ...emptyDraft(), path: "c:/SRC/api/" };
    expect(duplicateProjectOf(list, draft)?.id).toBe("A");
    expect(duplicateProjectOf(list, { ...draft, id: "A" })).toBeNull();
    expect(duplicateProjectOf(list, { ...emptyDraft(), location: "remote", host: "WEB", path: "~/api" })?.id).toBe("R");
    expect(duplicateProjectOf(list, { ...emptyDraft(), location: "remote", host: "db", path: "~/api" })).toBeNull();
    expect(duplicateProjectOf(list, { ...emptyDraft(), path: " " })).toBeNull();
  });
});

describe("독 — 저장소 아님 · 커밋 없음", () => {
  const wt = (path: string, branch: string | null, head: string | null): WorktreeInfo => ({
    path,
    branch,
    head,
    bare: false,
    detached: false,
  });
  it("notRepo 목록은 오류가 아니라 notRepo 안내 한 줄", () => {
    const L = local();
    const rows = projectTreeRows([L], "", new Set(["L1"]), () => ({ state: "notRepo" }), fuzzyMatch);
    expect(rows[1]).toMatchObject({ kind: "note", note: "notRepo", message: null });
  });
  it("주 폴더의 HEAD 가 0000… 이면 커밋 없음", () => {
    const zeros = "0".repeat(40);
    expect(isUnbornHead(zeros)).toBe(true);
    expect(isUnbornHead("0".repeat(64))).toBe(true);
    expect(isUnbornHead("1111")).toBe(false);
    expect(isUnbornHead(null)).toBe(false);
    // 독은 주 줄(첫 줄)의 HEAD 로 가른다 — 커밋 없는 저장소의 porcelain 은 브랜치와 0000… 을 함께 준다.
    const rows = projectTreeRows(
      [local()],
      "",
      new Set(["L1"]),
      () => ({ state: "ok", list: [wt("C:/src/api", "main", zeros)] }),
      fuzzyMatch,
    );
    expect(rows[1]).toMatchObject({ kind: "worktree", primary: true });
    expect(rows[1]?.kind === "worktree" && isUnbornHead(rows[1].worktree.head)).toBe(true);
  });
});

describe("git 신원 없음 안내 (2026-09-29)", () => {
  it("두 줄 — 전역 user.name · user.email, 자리표시는 큰따옴표 한 겹", () => {
    expect(gitIdentityCommands("이름", "메일")).toEqual([
      'git config --global user.name "이름"',
      'git config --global user.email "메일"',
    ]);
    // 자리표시에 셸이 건드릴 글자가 섞여도 인용이 깨지지 않는다(문구는 사전에서 오지만 방어).
    expect(gitIdentityCommands('a"b$c', "x`y")[0]).toBe('git config --global user.name "abc"');
  });
  it("이유 코드로 가른다 — 문구(로케일)가 아니라 [git-identity]", () => {
    const ko = "[git-identity] 저장소는 만들었지만 첫 커밋을 만들지 못했습니다 — git 사용자 이름·이메일이 설정되어 있지 않습니다";
    const en = "[git-identity] The repository was created but the first commit failed — the git user name and email are not set";
    for (const m of [ko, en]) {
      expect(hasReason(m, "git-identity")).toBe(true);
      expect(stripReason(m).startsWith("[")).toBe(false);
    }
    expect(hasReason("저장소는 만들었지만 첫 커밋을 만들지 못했습니다: fatal: x", "git-identity")).toBe(false);
  });
});
