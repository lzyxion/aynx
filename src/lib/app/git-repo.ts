import { invoke } from "../ipc";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { hasReason, stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { parseRepoStatus, type RepoStatus } from "$lib/repo-status";

/**
 * **저장소 상태 · 초기화 · 새 프로젝트 폴더의 Tauri 왕복** (docs/log/2026-09-28-project-create.md).
 *
 * 로컬은 `git_repo_*`·`git_project_create`, 원격은 **그 호스트에 이미 붙은 세션**의 exec 왕복
 * (`ssh_git_repo_*`·`ssh_git_project_create` — 워크트리 목록·제거와 같은 관문: 이것 하나 하려고 새
 * 접속을 열지 않는다). 명령 글자는 Rust 가 짓고 여기서는 경로·이름만 넘긴다. 규칙(판정의 모양·문구)은
 * 순수 층 `$lib/repo-status` 에 있다.
 *
 * `host` 가 `null`(또는 빈 글자)이면 로컬이다.
 */

function isRemoteHost(host: string | null | undefined): host is string {
  return typeof host === "string" && host.trim() !== "";
}

/** 실패 → 사람이 읽을 한 줄 (이유 코드는 뗀다) */
function reasonOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

/**
 * 첫 커밋을 만들 **git 신원이 없어** 실패했다(Rust 이유 코드 `[git-identity]` — 로케일 무관). 폼 · 독이 git 의 한 줄 대신
 * "먼저 설정하세요" + `git config --global …` 두 줄을 그린다. `where` 는 설정할 자리 — 이 PC(`local`) · 그 서버(`remote`).
 */
export class GitIdentityError extends Error {
  readonly where: "local" | "remote";
  constructor(message: string, where: "local" | "remote") {
    super(message);
    this.name = "GitIdentityError";
    this.where = where;
  }
}

/** 초기화 · 만들기의 실패 → 던질 `Error` (신원 없음이면 [`GitIdentityError`]) */
function failureOf(e: unknown, remote: boolean): Error {
  const raw = e instanceof Error ? e.message : String(e);
  if (hasReason(raw, "git-identity")) return new GitIdentityError(stripReason(raw), remote ? "remote" : "local");
  return new Error(stripReason(raw));
}

/**
 * 폴더 하나의 저장소 상태 — 원격인데 붙은 세션이 없으면 `null`(**모른다**). 왕복 자체가 실패하면
 * (세션이 방금 끊겼다 등) `error` 갈래로 접는다 — 부르는 쪽은 throw 를 받지 않는다.
 */
export async function repoStatusOf(host: string | null, path: string): Promise<RepoStatus | null> {
  try {
    if (isRemoteHost(host)) {
      const id = liveSessionFor(host);
      if (id === null) return null;
      return parseRepoStatus(await invoke<unknown>("ssh_git_repo_status", { id, path }));
    }
    return parseRepoStatus(await invoke<unknown>("git_repo_status", { path }));
  } catch (e) {
    return { kind: "error", message: reasonOf(e) };
  }
}

/** Rust `git_repo::RepoInitialized` */
export interface RepoInitialized {
  branch: string;
  initialized: boolean;
  committed: boolean;
}

/**
 * 폴더를 저장소로 — 저장소가 아니면 `git init`, HEAD 가 없으면 빈 첫 커밋(둘 다 이미 됐으면 아무
 * 것도 안 한다). 실패는 **사람이 읽을 한 줄**을 담은 `Error` 로 던진다(원격인데 세션이 없으면 그 안내 · 신원이 없으면
 * [`GitIdentityError`]).
 */
export async function initRepoAt(host: string | null, path: string): Promise<RepoInitialized> {
  try {
    if (isRemoteHost(host)) {
      const id = liveSessionFor(host);
      if (id === null) throw new Error(t("app.projects.repo.needSession"));
      return await invoke<RepoInitialized>("ssh_git_repo_init", { id, path });
    }
    return await invoke<RepoInitialized>("git_repo_init", { path });
  } catch (e) {
    throw failureOf(e, isRemoteHost(host));
  }
}

/** Rust `git_repo::ProjectCreated` — `path` 가 프로젝트 경로로 저장될 글자다 */
export interface ProjectCreated {
  path: string;
  branch: string;
}

/**
 * 새 프로젝트 폴더 `<parent>/<name>` — 만들고 저장소로(빈 첫 커밋까지). 프로젝트 목록에 넣는 일은
 * 부르는 쪽(`project_upsert`)이 한다. 실패는 사람이 읽을 한 줄을 담은 `Error`.
 */
export async function createProjectFolder(
  host: string | null,
  parent: string,
  name: string,
): Promise<ProjectCreated> {
  try {
    if (isRemoteHost(host)) {
      const id = liveSessionFor(host);
      if (id === null) throw new Error(t("app.projects.repo.needSession"));
      return await invoke<ProjectCreated>("ssh_git_project_create", { id, parent, name });
    }
    return await invoke<ProjectCreated>("git_project_create", { parent, name });
  } catch (e) {
    throw failureOf(e, isRemoteHost(host));
  }
}
