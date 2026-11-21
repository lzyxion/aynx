import { invoke } from "../ipc";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { hasReason, stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { parseRepoStatus, type RepoStatus } from "$lib/repo-status";

/**
 * 저장소 상태 · 초기화 · 새 프로젝트 폴더의 Tauri 왕복 (docs/log/2026-09-28-project-create.md).
 * 원격은 그 호스트에 이미 붙은 세션으로만 — 이것 하나 하려고 새 접속을 열지 않는다. 명령 글자는 Rust 가 짓는다.
 */

function isRemoteHost(host: string | null | undefined): host is string {
  return typeof host === "string" && host.trim() !== "";
}

function reasonOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

/** Rust 이유 코드 `[git-identity]` — 첫 커밋을 만들 git 신원이 없다 */
export class GitIdentityError extends Error {
  readonly where: "local" | "remote";
  constructor(message: string, where: "local" | "remote") {
    super(message);
    this.name = "GitIdentityError";
    this.where = where;
  }
}

function failureOf(e: unknown, remote: boolean): Error {
  const raw = e instanceof Error ? e.message : String(e);
  if (hasReason(raw, "git-identity")) return new GitIdentityError(stripReason(raw), remote ? "remote" : "local");
  return new Error(stripReason(raw));
}

/** 원격인데 붙은 세션이 없으면 `null`(모른다) — throw 하지 않는다 */
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
