/** 적는 곳은 이 창의 `localStorage` 하나 — 보는 사람의 편의다(잃어도 순서만 달라진다). 실제로 연 워크트리만 줄이 된다 */
import { pathKey } from "$lib/agent-sessions";
import { folderKeyFor, worktreeDotKey, type DockDot, type DockFolder, type ProjectDots } from "$lib/dock-dots";
import { agentFirst } from "$lib/launcher";
import { projectTail, worktreeTabTitle, type Project, type WorktreeListing } from "$lib/projects";

export const RECENT_OPENS_KEY = "aynx:projects:recentOpens";
export const RECENT_OPENS_CAP = 30;

export interface RecentOpen {
  projectId: string;
  /** `null` 이면 프로젝트의 주 폴더 */
  worktree: string | null;
  label: string | null;
  at: number;
}

export type OpenKeyOf = (projectId: string, path: string) => string;

const plainKey: OpenKeyOf = (_id, path) => pathKey(path);

function sameOpen(a: RecentOpen, b: RecentOpen, keyOf: OpenKeyOf): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.worktree === null || b.worktree === null) return a.worktree === b.worktree;
  return keyOf(a.projectId, a.worktree) === keyOf(b.projectId, b.worktree);
}

function normalize(list: readonly RecentOpen[], keyOf: OpenKeyOf): RecentOpen[] {
  const out: RecentOpen[] = [];
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    if (out.some((o) => sameOpen(o, e, keyOf))) continue;
    out.push(e);
    if (out.length >= RECENT_OPENS_CAP) break;
  }
  return out;
}

export function parseRecentOpens(raw: string | null): RecentOpen[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentOpen[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.projectId !== "string" || o.projectId === "") continue;
    if (typeof o.at !== "number" || !Number.isFinite(o.at)) continue;
    const worktree = typeof o.worktree === "string" && o.worktree.trim() !== "" ? o.worktree : null;
    const label = worktree !== null && typeof o.label === "string" && o.label.trim() !== "" ? o.label : null;
    out.push({ projectId: o.projectId, worktree, label, at: o.at });
  }
  return normalize(out, plainKey);
}

export function recordOpen(list: readonly RecentOpen[], entry: RecentOpen, keyOf: OpenKeyOf = plainKey): RecentOpen[] {
  return normalize([entry, ...list.filter((e) => !sameOpen(e, entry, keyOf))], keyOf);
}

export function forgetOpen(
  list: readonly RecentOpen[],
  projectId: string,
  worktree: string,
  keyOf: OpenKeyOf = plainKey,
): RecentOpen[] {
  const probe: RecentOpen = { projectId, worktree, label: null, at: 0 };
  return list.filter((e) => !sameOpen(e, probe, keyOf));
}

export function projectOpenedAt(list: readonly RecentOpen[], projectId: string): number | null {
  let best: number | null = null;
  for (const e of list) if (e.projectId === projectId && e.worktree === null && (best === null || e.at > best)) best = e.at;
  return best;
}

// ---------------------------------------------------------------------------
// launcher 의 프로젝트 단
// ---------------------------------------------------------------------------

export interface RecentWorktree {
  project: Project;
  path: string;
  name: string;
  at: number;
}

export function resolveRecentWorktrees(
  projects: readonly Project[],
  opens: readonly RecentOpen[],
  listingOf: (projectId: string) => WorktreeListing | undefined,
  homeOf: (alias: string) => string | null,
  isMissing: (projectId: string, path: string) => boolean = () => false,
): RecentWorktree[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: RecentWorktree[] = [];
  const seen = new Set<string>();
  for (const e of [...opens].sort((a, b) => b.at - a.at)) {
    if (e.worktree === null) continue;
    const p = byId.get(e.projectId);
    if (!p) continue;
    const host = p.host?.trim() ? p.host.trim() : null;
    const key = folderKeyFor(host, homeOf);
    const k = key(e.worktree);
    if (k === "" || k === key(p.path)) continue;
    const seenKey = `${p.id}\n${k}`;
    if (seen.has(seenKey)) continue;
    let path = e.worktree;
    let name = e.label ?? projectTail(e.worktree);
    const listing = listingOf(p.id);
    if (listing?.state === "ok") {
      const w = listing.list.find((x) => !x.bare && key(x.path) === k);
      if (!w) continue;
      path = w.path;
      name = w.branch ?? projectTail(w.path);
    }
    if (isMissing(p.id, e.worktree)) continue;
    seen.add(seenKey);
    out.push({ project: p, path, name, at: e.at });
  }
  return out;
}

/** 목록을 아직 안 읽은 프로젝트의 워크트리도 점 판정(`placeOf`)에 서게 — 독과 같은 폴더 표 · 같은 규칙으로 점을 모은다 */
export function withRecentWorktrees(
  folders: readonly DockFolder[],
  recent: readonly RecentWorktree[],
  homeOf: (alias: string) => string | null,
): DockFolder[] {
  const out = [...folders];
  for (const r of recent) {
    const host = r.project.host?.trim() ? r.project.host.trim() : null;
    const key = folderKeyFor(host, homeOf);
    const k = key(r.path);
    if (out.some((f) => f.projectId === r.project.id && f.worktree !== null && key(f.worktree) === k)) continue;
    out.push({ projectId: r.project.id, host, path: r.path, worktree: r.path, label: r.name, main: false });
  }
  return out;
}

export type LauncherProjectRow =
  | { kind: "project"; key: string; project: Project; dot: DockDot | null }
  | {
      kind: "worktree";
      key: string;
      project: Project;
      path: string;
      name: string;
      title: string;
      dot: DockDot | null;
    };

/** 프로젝트 줄의 점은 주 폴더 자리의 점이다(`dots.main`) — 워크트리들을 접지 않는다(독의 펼친 트리와 같은 뜻) */
export function launcherProjectRows(
  projects: readonly Project[],
  recent: readonly RecentWorktree[],
  projectTime: (p: Project) => number | null,
  dots: ProjectDots,
  folders: readonly DockFolder[],
  homeOf: (alias: string) => string | null,
  limit: number,
  isHere?: (row: LauncherProjectRow) => boolean,
): LauncherProjectRow[] {
  type Item = { row: LauncherProjectRow; at: number | null; order: number };
  const items: Item[] = projects.map((project, order) => ({
    row: { kind: "project", key: `project:${project.id}`, project, dot: dots.main[project.id] ?? null },
    at: projectTime(project),
    order,
  }));
  recent.forEach((r, i) => {
    const host = r.project.host?.trim() ? r.project.host.trim() : null;
    const key = folderKeyFor(host, homeOf);
    const k = key(r.path);
    const folder = folders.find((f) => f.projectId === r.project.id && f.worktree !== null && key(f.worktree) === k);
    const dot = folder?.worktree ? (dots.worktree[worktreeDotKey(r.project.id, folder.worktree)] ?? null) : null;
    items.push({
      row: {
        kind: "worktree",
        key: `worktree:${r.project.id}:${k}`,
        project: r.project,
        path: r.path,
        name: r.name,
        title: worktreeTabTitle(r.project.name, r.name),
        dot,
      },
      at: r.at,
      order: projects.length + i,
    });
  });
  items.sort((a, b) => {
    if (a.at !== b.at) {
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return b.at - a.at;
    }
    return a.order - b.order;
  });
  const seen = new Set<string>();
  const rows = items.map((x) => x.row).filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  const ranked = agentFirst(rows, (r) => r.dot?.state ?? null);
  return (isHere ? [...ranked.filter(isHere), ...ranked.filter((row) => !isHere(row))] : ranked).slice(0, limit);
}
