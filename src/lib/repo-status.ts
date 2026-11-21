import type { Key } from "$lib/i18n/keys";

/** 판정은 Rust(`git_repo.rs`)가 한다 — git 의 오류 문구가 아니라 `rev-parse` 가 서는가로 가른다(로케일을 타지 않는다). */

/** Rust `git_repo::RepoStatus` 와 1:1 (`kind` 로 갈린다) */
export type RepoStatus =
  | { kind: "ok"; branch: string | null; worktrees: number | null }
  | { kind: "notRepo" }
  | { kind: "subfolder"; root: string }
  | { kind: "noCommit"; branch: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** `done` 은 어느 경로의 답인지 `key` 로 든다 — 늦게 온 옛 답이 새 경로에 붙지 않게 */
export type RepoCheck =
  | { state: "idle" }
  | { state: "checking"; key: string }
  | { state: "unknown"; key: string }
  | { state: "done"; key: string; status: RepoStatus };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

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

export function repoCheckKey(location: "local" | "remote", host: string, path: string): string {
  return `${location}\n${location === "remote" ? host.trim().toLowerCase() : ""}\n${path.trim()}`;
}

/** 칸 이름이 곧 문구 키의 꼬리다(`app.projects.form.check.action.<이름>`) */
export type RepoCheckAction = "initAndAdd" | "addAsIs" | "useRoot" | "keepSub" | "commitAndAdd";

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

export function repoCheckActionKey(action: RepoCheckAction, edit: boolean): Key {
  if (edit && action === "initAndAdd") return "app.projects.form.check.action.initAndSave";
  if (edit && action === "commitAndAdd") return "app.projects.form.check.action.commitAndSave";
  return `app.projects.form.check.action.${action}`;
}

/** 로컬의 없는 폴더만 막는다(원격은 서버의 일이라 막지 않는다) */
export function repoCheckBlocks(check: RepoCheck, remote: boolean): boolean {
  return !remote && check.state === "done" && check.status.kind === "missing";
}

/** 문구 키의 꼬리다 */
export type FolderNameProblem = "empty" | "invalid";

/** Windows 가 장치로 읽는 이름 (Rust `git_repo::RESERVED` 와 같은 표) */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Rust `git_repo::valid_folder_name` 과 같은 표다 — 한쪽만 고치면 폼은 통과시키고 백엔드가 거절한다 */
export function projectFolderNameProblem(name: string): FolderNameProblem | null {
  const n = name.trim();
  if (n === "") return "empty";
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return "invalid";
  if (n.startsWith("-") || n.includes("..") || n.endsWith(".")) return "invalid";
  if (RESERVED.has((n.split(".")[0] ?? n).toLowerCase())) return "invalid";
  return null;
}

/** 원격은 `/` 다(Rust `remote_join` 과 같다) */
export function newProjectPath(parent: string, name: string, remote: boolean): string | null {
  const p = parent.trim();
  const n = name.trim();
  if (p === "" || n === "") return null;
  const sep = remote ? "/" : p.includes("\\") && !p.includes("/") ? "\\" : /^[A-Za-z]:$/.test(p) ? "\\" : "/";
  const base = p.replace(/[\\/]+$/, "");
  if (base === "") return `${sep}${n}`;
  return `${base}${sep}${n}`;
}

/** 앱은 git 신원을 대신 설정하지 않는다 — 사람이 그 자리(이 PC · 그 서버)에서 제 이름 · 메일로 고쳐 친다(Rust 이유 코드 `[git-identity]`) */
export function gitIdentityCommands(name: string, email: string): [string, string] {
  const q = (s: string) => `"${s.replace(/["\\$`]/g, "")}"`;
  return [`git config --global user.name ${q(name)}`, `git config --global user.email ${q(email)}`];
}

/** `git worktree list --porcelain` 이 커밋 없는 저장소에 적는 `0000…` */
export function isUnbornHead(head: string | null | undefined): boolean {
  return typeof head === "string" && /^0+$/.test(head);
}
