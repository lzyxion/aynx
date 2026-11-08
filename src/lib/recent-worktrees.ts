/**
 * **최근 연 워크트리** — 빈 탭 launcher 의 프로젝트 단에 끼는 줄 (docs/log/2026-09-27-launcher-worktrees.md).
 *
 * 프로젝트·워크트리 폴더를 **열 때마다**(독 · launcher · 새 워크트리 · 대화 재개) 한 줄을 적는다:
 * (프로젝트 id · 워크트리 경로 · 이름 · 시각). 주 폴더를 열면 `worktree: null` — 프로젝트 자신의 "마지막으로 연
 * 시각" 이다. 적는 곳은 이 창의 `localStorage` 하나(`app/recent-worktrees.svelte.ts`) — 펼침·즐겨찾기와 같은
 * **보는 사람의 편의**다(잃어도 순서만 달라진다). 목록 전체를 나열하지 않는다: **실제로 연 워크트리만** 줄이 된다.
 *
 * 순수 모듈이다 — 저장소·타일·홈·목록 사본은 부르는 쪽이 넘긴다.
 */
import { pathKey } from "$lib/agent-sessions";
import { folderKeyFor, worktreeDotKey, type DockDot, type DockFolder, type ProjectDots } from "$lib/dock-dots";
import { agentFirst } from "$lib/launcher";
import { projectTail, worktreeTabTitle, type Project, type WorktreeListing } from "$lib/projects";

/** 저장 이름 */
export const RECENT_OPENS_KEY = "aynx:projects:recentOpens";
/** 적어 두는 줄의 수 — launcher 단(여덟 줄 안팎)보다 넉넉히, 지운 워크트리가 쌓이지 않을 만큼 */
export const RECENT_OPENS_CAP = 30;

/** 연 기록 한 줄 */
export interface RecentOpen {
  projectId: string;
  /** 워크트리 폴더 — `null` 이면 프로젝트의 주 폴더 */
  worktree: string | null;
  /** 워크트리 이름(브랜치, 없으면 폴더 꼬리) — 주 폴더면 `null` */
  label: string | null;
  /** 연 시각 (ms) */
  at: number;
}

/** 폴더 열쇠 — 같은 프로젝트 안에서 두 경로가 같은 자리인가 (부르는 쪽이 원격 홈을 편다) */
export type OpenKeyOf = (projectId: string, path: string) => string;

const plainKey: OpenKeyOf = (_id, path) => pathKey(path);

function sameOpen(a: RecentOpen, b: RecentOpen, keyOf: OpenKeyOf): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.worktree === null || b.worktree === null) return a.worktree === b.worktree;
  return keyOf(a.projectId, a.worktree) === keyOf(b.projectId, b.worktree);
}

/** 늦은 순 · 같은 자리는 늦은 하나 · 상한 */
function normalize(list: readonly RecentOpen[], keyOf: OpenKeyOf): RecentOpen[] {
  const out: RecentOpen[] = [];
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    if (out.some((o) => sameOpen(o, e, keyOf))) continue;
    out.push(e);
    if (out.length >= RECENT_OPENS_CAP) break;
  }
  return out;
}

/** 저장된 글자 → 믿을 수 있는 목록. **던지지 않는다** — 모양이 어긋난 줄은 버린다 */
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

/** 한 줄을 적는다 — 같은 자리의 옛 줄은 새 줄이 대신한다(맨 앞으로) */
export function recordOpen(list: readonly RecentOpen[], entry: RecentOpen, keyOf: OpenKeyOf = plainKey): RecentOpen[] {
  return normalize([entry, ...list.filter((e) => !sameOpen(e, entry, keyOf))], keyOf);
}

/** 한 줄을 지운다 (없어진 워크트리) */
export function forgetOpen(
  list: readonly RecentOpen[],
  projectId: string,
  worktree: string,
  keyOf: OpenKeyOf = plainKey,
): RecentOpen[] {
  const probe: RecentOpen = { projectId, worktree, label: null, at: 0 };
  return list.filter((e) => !sameOpen(e, probe, keyOf));
}

/** 프로젝트 주 폴더를 마지막으로 연 시각 (없으면 `null`) */
export function projectOpenedAt(list: readonly RecentOpen[], projectId: string): number | null {
  let best: number | null = null;
  for (const e of list) if (e.projectId === projectId && e.worktree === null && (best === null || e.at > best)) best = e.at;
  return best;
}

// ---------------------------------------------------------------------------
// launcher 의 프로젝트 단
// ---------------------------------------------------------------------------

/** 아직 살아 있는(있다고 믿는) 최근 워크트리 하나 */
export interface RecentWorktree {
  project: Project;
  /** 여는 경로 — 목록을 읽어 두었으면 git 이 적은 경로, 아니면 적어 둔 경로 */
  path: string;
  /** 워크트리 이름 — 목록의 브랜치(분리된 HEAD 면 폴더 꼬리), 목록이 없으면 적어 둔 이름 */
  name: string;
  at: number;
}

/**
 * 적어 둔 워크트리 줄 → 보일 줄. 버리는 것: 프로젝트가 없어졌다 · 주 폴더 자리다(프로젝트 줄이 그 자리다) ·
 * 목록을 읽어 두었는데(`ok`) 그 안에 없다 · `isMissing`(로컬 폴더가 없다고 확인됐다) · 같은 자리가 이미 섰다.
 * 목록이 없으면(원격 접속 전 · 아직 안 읽음) 적어 둔 그대로 믿는다.
 */
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

/**
 * 독의 등록 폴더에 **최근 워크트리 자리**를 보탠다 — 목록을 아직 안 읽은 프로젝트의 워크트리도 점 판정(`placeOf`)에
 * 서게. 이미 같은 자리가 있으면(목록을 읽었다) 보태지 않는다 — 독과 **같은 폴더 표**에서 같은 규칙으로 점을 모은다.
 */
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

/** launcher 프로젝트 단의 한 줄 */
export type LauncherProjectRow =
  | { kind: "project"; key: string; project: Project; dot: DockDot | null }
  | {
      kind: "worktree";
      key: string;
      project: Project;
      path: string;
      /** 워크트리 이름(탭 제목의 뒤쪽) */
      name: string;
      /** 줄 글자 = 탭 제목 `<프로젝트> · <워크트리>` */
      title: string;
      dot: DockDot | null;
    };

/**
 * launcher 프로젝트 단 — 프로젝트 줄과 최근 워크트리 줄을 **시각 순으로 섞고**, 에이전트 점이 있는 줄을 위로, 상한까지.
 *
 * - 프로젝트 줄의 시각 = `projectTime`(원격 호스트의 마지막 성공 접속 · 주 폴더를 마지막으로 연 시각 중 늦은 것).
 *   시각이 없는 줄은 뒤에서 `projects` 가 들어온 순서(= `sortProjects` 의 "최근")대로.
 * - 프로젝트 줄의 점 = **주 폴더 자리**의 점(`dots.main`) — 워크트리들을 접지 않는다(그 워크트리가 제 줄이 있을
 *   수도, 없을 수도 있다 — 독의 펼친 트리와 같은 뜻). 워크트리 줄의 점 = 독 워크트리 줄과 같은 키.
 */
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
