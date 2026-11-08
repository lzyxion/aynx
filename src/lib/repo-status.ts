import type { Key } from "$lib/i18n/keys";

/**
 * **저장소 상태 · 새 프로젝트 폴더** — 규칙만 담은 순수 모듈 (docs/log/2026-09-28-project-create.md).
 *
 * 판정은 Rust(`git_repo.rs`)가 한다 — git 의 오류 **문구**가 아니라 `rev-parse` 가 서는가로
 * 가르므로(로케일을 타지 않는다) 여기서는 그 답을 믿을 수 있는 모양으로 받고, 폼의 한 줄과 독의
 * 표시가 어떤 문구·어떤 단추를 세울지만 정한다. Tauri 왕복은 `app/git-repo.ts` 에 있다.
 */

/** Rust `git_repo::RepoStatus` 와 1:1 (`kind` 로 갈린다) */
export type RepoStatus =
  | { kind: "ok"; branch: string | null; worktrees: number | null }
  | { kind: "notRepo" }
  | { kind: "subfolder"; root: string }
  | { kind: "noCommit"; branch: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * 폼이 든 판정 한 벌 — 아직 안 봤다(`idle`) · 보는 중 · 원격인데 붙은 세션이 없어 **모른다** ·
 * 답(`done` — 그 답이 어느 경로의 것인지 `key` 로 든다: 늦게 온 옛 답이 새 경로에 붙지 않게).
 */
export type RepoCheck =
  | { state: "idle" }
  | { state: "checking"; key: string }
  | { state: "unknown"; key: string }
  | { state: "done"; key: string; status: RepoStatus };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** 백엔드의 원시 값 → [`RepoStatus`]. **throw 하지 않는다** — 모양이 어긋나면 `error` */
export function parseRepoStatus(raw: unknown): RepoStatus {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  switch (o.kind) {
    case "ok":
      return {
        kind: "ok",
        branch: str(o.branch),
        worktrees: typeof o.worktrees === "number" ? o.worktrees : null,
      };
    case "notRepo":
      return { kind: "notRepo" };
    case "missing":
      return { kind: "missing" };
    case "noCommit":
      return { kind: "noCommit", branch: str(o.branch) };
    case "subfolder": {
      const root = str(o.root);
      return root ? { kind: "subfolder", root } : { kind: "error", message: "" };
    }
    default:
      return { kind: "error", message: str(o.message) ?? "" };
  }
}

/** 판정 열쇠 — 위치·호스트·경로가 같으면 같은 판정이다 */
export function repoCheckKey(location: "local" | "remote", host: string, path: string): string {
  return `${location}\n${location === "remote" ? host.trim().toLowerCase() : ""}\n${path.trim()}`;
}

/** 폼 한 줄에 서는 단추 — 칸 이름이 곧 문구 키의 꼬리다 (`app.projects.form.check.action.<이름>`) */
export type RepoCheckAction = "initAndAdd" | "addAsIs" | "useRoot" | "keepSub" | "commitAndAdd";

/**
 * 폼의 경로 칸 아래 **한 줄** (**순수 함수**) — 어떤 모양(`tone`) · 어떤 문구(`key`·`params`) ·
 * 어떤 단추. `null` 이면 아무것도 세우지 않는다(아직 안 봤다 · 사람이 "이대로 두기" 로 걷었다).
 *
 * - `ok` — 초록 점 "git 저장소 · 브랜치 main (· 워크트리 N개)"
 * - `notRepo` — 경고 + [초기화하고 추가] [그대로 추가]
 * - `subfolder` — 경고 + [루트로 바꾸기] [이대로 두기]
 * - `noCommit` — 경고 + [첫 커밋 만들고 추가]
 * - `missing` — 로컬은 오류(저장을 막는다 — [`repoCheckBlocks`]), 원격은 경고(서버의 일이라 막지 않는다)
 * - `error` — 경고 + git 의 첫 줄
 * - 원격인데 붙은 세션이 없다(`unknown`) — 옅은 한 줄 "접속 후 확인할 수 있습니다"
 *
 * 편집(`edit`)에서는 "추가" 대신 "저장" 문구를 쓰고 [그대로 추가] 는 없다(저장 단추가 그 일이다).
 */
export interface RepoCheckLine {
  tone: "ok" | "warn" | "err" | "muted";
  key: Key;
  params: Record<string, string>;
  actions: RepoCheckAction[];
}

export function repoCheckLine(
  check: RepoCheck,
  remote: boolean,
  edit: boolean,
  dismissed: boolean,
): RepoCheckLine | null {
  if (check.state === "idle" || check.state === "checking") return null;
  if (check.state === "unknown") {
    return { tone: "muted", key: "app.projects.form.check.unknown", params: {}, actions: [] };
  }
  const s = check.status;
  switch (s.kind) {
    case "ok": {
      const branch = s.branch ?? "";
      if (s.worktrees !== null && s.worktrees > 1) {
        return {
          tone: "ok",
          key: "app.projects.form.check.okWorktrees",
          params: { branch, count: String(s.worktrees) },
          actions: [],
        };
      }
      return { tone: "ok", key: "app.projects.form.check.ok", params: { branch }, actions: [] };
    }
    case "notRepo":
      return {
        tone: "warn",
        key: "app.projects.form.check.notRepo",
        params: {},
        actions: edit ? ["initAndAdd"] : ["initAndAdd", "addAsIs"],
      };
    case "subfolder":
      if (dismissed) return null;
      return { tone: "warn", key: "app.projects.form.check.subfolder", params: { root: s.root }, actions: ["useRoot", "keepSub"] };
    case "noCommit":
      return {
        tone: "warn",
        key: "app.projects.form.check.noCommit",
        params: { branch: s.branch ?? "main" },
        actions: ["commitAndAdd"],
      };
    case "missing":
      if (remote) return { tone: "warn", key: "app.projects.form.check.missingRemote", params: {}, actions: [] };
      // 편집에는 [새로 만들기] 고르개가 없다 — 그 안내를 빼고 사실만.
      return {
        tone: "err",
        key: edit ? "app.projects.form.check.missingEdit" : "app.projects.form.check.missing",
        params: {},
        actions: [],
      };
    case "error":
      return { tone: "warn", key: "app.projects.form.check.error", params: { message: s.message }, actions: [] };
  }
}

/** 단추의 문구 키 — 편집에서는 "…추가" 가 "…저장" 이 된다 */
export function repoCheckActionKey(action: RepoCheckAction, edit: boolean): Key {
  if (edit && action === "initAndAdd") return "app.projects.form.check.action.initAndSave";
  if (edit && action === "commitAndAdd") return "app.projects.form.check.action.commitAndSave";
  return `app.projects.form.check.action.${action}`;
}

/** 이 판정이 저장을 막는가 — **로컬의 없는 폴더**만 (원격은 서버의 일이라 막지 않는다) */
export function repoCheckBlocks(check: RepoCheck, remote: boolean): boolean {
  return !remote && check.state === "done" && check.status.kind === "missing";
}

/** 새 프로젝트 폴더 이름이 막히는 까닭 — 문구 키의 꼬리다 */
export type FolderNameProblem = "empty" | "invalid";

/** Windows 가 장치로 읽는 이름 (Rust `git_repo::RESERVED` 와 같은 표) */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * 새 프로젝트 **폴더 이름** 검사 — Rust `git_repo::valid_folder_name` 과 **같은 표**다(한쪽만
 * 고치면 폼은 통과시키고 백엔드가 거절한다). 워크트리 이름 규칙에서 `/` 를 뺀 것 + 끝의 `.` 금지 +
 * Windows 장치 이름 금지: `[A-Za-z0-9._-]+` · `-` 로 시작하지 않는다 · `..` 이 없다 · `.` 로 끝나지 않는다.
 */
export function projectFolderNameProblem(name: string): FolderNameProblem | null {
  const n = name.trim();
  if (n === "") return "empty";
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return "invalid";
  if (n.startsWith("-") || n.includes("..") || n.endsWith(".")) return "invalid";
  if (RESERVED.has((n.split(".")[0] ?? n).toLowerCase())) return "invalid";
  return null;
}

/**
 * 새로 만들 폴더의 **미리 보기 자리** — `<부모>/<이름>`. 로컬은 부모가 쓰는 구분자를 따르고
 * (`C:\src` → `C:\src\api`), 원격은 `/` 다(`~/src` → `~/src/api` — Rust `remote_join` 과 같다).
 * 부모나 이름이 비었으면 `null`.
 */
export function newProjectPath(parent: string, name: string, remote: boolean): string | null {
  const p = parent.trim();
  const n = name.trim();
  if (p === "" || n === "") return null;
  const sep = remote ? "/" : p.includes("\\") && !p.includes("/") ? "\\" : /^[A-Za-z]:$/.test(p) ? "\\" : "/";
  const base = p.replace(/[\\/]+$/, "");
  if (base === "") return `${sep}${n}`;
  return `${base}${sep}${n}`;
}

/**
 * 첫 커밋을 만들 git 신원이 없을 때 안내하는 **두 줄**(2026-09-29 — Rust 이유 코드 `[git-identity]`). 앱은 대신 설정하지
 * 않는다 — 사람이 그 자리(이 PC · 그 서버)에서 이 두 줄을 제 이름·메일로 고쳐 친다. `name`·`email` 은 자리표시 글자다.
 */
export function gitIdentityCommands(name: string, email: string): [string, string] {
  const q = (s: string) => `"${s.replace(/["\\$`]/g, "")}"`;
  return [`git config --global user.name ${q(name)}`, `git config --global user.email ${q(email)}`];
}

/** HEAD 가 **아직 태어나지 않았나** — `git worktree list --porcelain` 이 커밋 없는 저장소에 적는 `0000…` */
export function isUnbornHead(head: string | null | undefined): boolean {
  return typeof head === "string" && /^0+$/.test(head);
}
