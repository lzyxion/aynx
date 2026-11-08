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

/**
 * **최근 연 프로젝트·워크트리의 창 사본** (docs/log/2026-09-27-launcher-worktrees.md).
 *
 * 저장은 `localStorage` 하나 — 창·세션을 건너 남는 **보는 사람의 편의**다(프로젝트 펼침과 같은 규칙). 다른 창이
 * 적으면 `storage` 이벤트로 따라간다. 모듈이 임포트되는 순간에는 저장소를 만지지 않는다 — 처음 읽는 것은
 * [`restoreRecentOpens`](launcher 마운트) 또는 첫 기록이다.
 */

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

/** 저장된 기록을 한 번 읽고 다른 창의 기록을 따라가게 건다 — `$derived` 밖(마운트 · 기록)에서만 부른다 */
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

/** 지금 기록 (반응형, 늦은 순) */
export function recentOpens(): readonly RecentOpen[] {
  return opens;
}

/** 프로젝트 안의 두 경로가 같은 자리인가 — 원격은 그 서버의 홈으로 `~` 를 편다 */
const keyOf: OpenKeyOf = (projectId, path) => {
  const p = projects().find((x) => x.id === projectId);
  const host = p && isRemote(p) ? p.host.trim() : null;
  return folderKeyFor(host, remoteHomeOf)(path);
};

/**
 * 프로젝트 폴더 하나를 **열었다** — 주 폴더면 프로젝트 자신, 아니면 워크트리 줄로 적는다.
 * `label` 은 워크트리 이름(브랜치 · 새로 만든 이름 · 없으면 폴더 꼬리).
 */
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

/**
 * 폴더 하나가 열렸다(대화 재개 · 갈래) — 그것이 등록된 프로젝트의 주 폴더이거나, **읽어 둔 목록**의 워크트리이거나,
 * 이미 적어 둔 워크트리면 적는다. 그 밖(프로젝트 밖 폴더 · 하위 폴더)은 적지 않는다.
 */
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

/** 이 창에서 이미 확인한 로컬 워크트리 폴더 — 한 번만 묻는다 */
const checked = new Set<string>();

/**
 * 적어 둔 **로컬** 워크트리 폴더가 아직 있는지 뒤에서 확인한다 — 없으면 기록에서 조용히 지운다(launcher 줄이
 * 사라진다). 그리기를 막지 않는다. 원격은 묻지 않는다(목록을 읽어 두었을 때만 걸러진다 — `resolveRecentWorktrees`).
 */
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
