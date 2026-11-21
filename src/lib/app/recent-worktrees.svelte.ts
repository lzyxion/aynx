import { invoke } from "../ipc";
import { projects } from "$lib/app/project-list.svelte.js";
import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { worktreesOf } from "$lib/app/worktrees.svelte.js";
import { folderKeyFor } from "$lib/dock-dots";
import { isRemote, projectTail, type Project } from "$lib/projects";
import {
  forgetOpen,
  parseRecentOpens,
  recordOpen,
  RECENT_OPENS_KEY,
  type OpenKeyOf,
  type RecentOpen,
} from "$lib/recent-worktrees";

/** 최근 연 프로젝트 · 워크트리의 창 사본(`localStorage` 편의) — 임포트 순간에는 저장소를 만지지 않는다 */

let opens = $state<RecentOpen[]>([]);
let restored = false;

function readStore(): RecentOpen[] {
  try {
    return typeof localStorage !== "undefined" ? parseRecentOpens(localStorage.getItem(RECENT_OPENS_KEY)) : [];
  } catch {
    return []; // 사생활 모드 · 저장소 차단 — 순서만 달라진다
  }
}

function writeStore(next: RecentOpen[]): void {
  opens = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RECENT_OPENS_KEY, JSON.stringify(next));
  } catch {
    /* 저장 못 해도 이번 창의 순서는 산다 */
  }
}

/** `$derived` 밖(마운트 · 기록)에서만 부른다 */
export function restoreRecentOpens(): void {
  if (restored) return;
  restored = true;
  opens = readStore();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (ev) => {
      if (ev.key === RECENT_OPENS_KEY || ev.key === null) opens = readStore();
    });
  }
}

/** 늦은 순 */
export function recentOpens(): readonly RecentOpen[] {
  return opens;
}

const keyOf: OpenKeyOf = (projectId, path) => {
  const p = projects().find((x) => x.id === projectId);
  const host = p && isRemote(p) ? p.host.trim() : null;
  return folderKeyFor(host, remoteHomeOf)(path);
};

export function recordProjectFolderOpen(p: Project, folder: string, label?: string | null): void {
  restoreRecentOpens();
  const host = isRemote(p) ? p.host.trim() : null;
  const key = folderKeyFor(host, remoteHomeOf);
  const main = key(folder) === key(p.path);
  const entry: RecentOpen = main
    ? { projectId: p.id, worktree: null, label: null, at: Date.now() }
    : { projectId: p.id, worktree: folder, label: label?.trim() || projectTail(folder), at: Date.now() };
  writeStore(recordOpen(opens, entry, keyOf));
}

export function noteFolderOpened(host: string | null, folder: string): void {
  if (!folder.trim()) return;
  restoreRecentOpens();
  const h = host?.trim() ? host.trim().toLowerCase() : null;
  for (const p of projects()) {
    const ph = isRemote(p) ? p.host.trim().toLowerCase() : null;
    if (ph !== h) continue;
    const key = folderKeyFor(isRemote(p) ? p.host.trim() : null, remoteHomeOf);
    const k = key(folder);
    if (k === key(p.path)) {
      recordProjectFolderOpen(p, p.path);
      return;
    }
    const listing = worktreesOf(p.id);
    const w = listing?.state === "ok" ? listing.list.find((x) => !x.bare && key(x.path) === k) : undefined;
    if (w) {
      recordProjectFolderOpen(p, w.path, w.branch);
      return;
    }
    const known = opens.find((e) => e.projectId === p.id && e.worktree !== null && key(e.worktree) === k);
    if (known?.worktree) {
      recordProjectFolderOpen(p, known.worktree, known.label);
      return;
    }
  }
}

const checked = new Set<string>();

export function checkLocalRecentWorktrees(list: readonly { project: Project; path: string }[]): void {
  for (const { project, path } of list) {
    if (isRemote(project)) continue;
    const id = `${project.id}\n${path}`;
    if (checked.has(id)) continue;
    checked.add(id);
    invoke("local_stat", { path }).catch(() => {
      writeStore(forgetOpen(opens, project.id, path, keyOf));
    });
  }
}
