/**
 * 독의 에이전트 점 — 탭 점(`$lib/tab-dot`)의 타일별 상태를 폴더 · 호스트로 묶기만 하는 순수 모듈(docs/log/2026-09-27-dock-agent-dots.md).
 * 타일 하나는 한 자리에만 선다 — 겹친 폴더는 가장 깊은 것이 이긴다.
 */
import { AGENT_STATUS_RANK, type AgentStatus } from "$lib/agent-status";
import { pathKey, within } from "$lib/agent-sessions";
import { expandRemotePath, projectTail, type Project, type WorktreeListing } from "$lib/projects";
import type { Tr } from "$lib/session";

export interface DockAgentPane {
  id: string;
  name: string;
  state: AgentStatus | null;
  /** `null` = 로컬 타일 · 아니면 설정의 SSH 별칭(빠른 접속 타일은 부르는 쪽이 뺀다) */
  host: string | null;
  start: string | null;
  /** 셸이 마지막으로 알려 준 폴더 — 로컬은 이 PC 의 경로로 옮긴 값 */
  current: string | null;
}

export interface DockFolder {
  projectId: string;
  host: string | null;
  path: string;
  /** 주 폴더 자리면 `null` */
  worktree: string | null;
  label: string;
  /** 주 폴더 또는 주 워크트리 줄 — 없으면 `worktree === null` 로 본다 */
  main?: boolean;
}

export interface DockDot {
  state: AgentStatus;
  label: string;
}

export interface DockDotAgent {
  name: string;
  state: AgentStatus | null;
  place?: string | null;
}

const sameHost = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : a.trim().toLowerCase() === b.trim().toLowerCase();

export function projectFolders(
  projects: readonly Project[],
  listingOf: (projectId: string) => WorktreeListing | undefined,
  homeOf: (alias: string) => string | null = () => null,
): DockFolder[] {
  const out: DockFolder[] = [];
  for (const p of projects) {
    const host = p.host?.trim() ? p.host.trim() : null;
    const listing = listingOf(p.id);
    const key = folderKeyFor(host, homeOf);
    const mainKey = key(p.path);
    if (listing?.state === "ok") {
      for (const w of listing.list) {
        if (w.bare) continue;
        const main = mainKey !== "" && key(w.path) === mainKey;
        out.push({ projectId: p.id, host, path: w.path, worktree: w.path, label: w.branch ?? projectTail(w.path), main });
      }
    }
    out.push({ projectId: p.id, host, path: p.path, worktree: null, label: projectTail(p.path), main: true });
  }
  return out;
}

/** [`placeOf`] 의 열쇠와 같은 규칙이어야 한다 */
export function folderKeyFor(
  host: string | null,
  homeOf: (alias: string) => string | null,
): (path: string) => string {
  const home = host !== null ? homeOf(host) : null;
  return (s: string) => pathKey(host !== null ? expandRemotePath(s, home) : s);
}

/** 같은 깊이(주 폴더 ≡ 주 워크트리)면 워크트리 줄이 이긴다 */
export function placeOf(
  pane: Pick<DockAgentPane, "host" | "start" | "current">,
  folders: readonly DockFolder[],
  homeOf: (alias: string) => string | null,
): DockFolder | null {
  const side = folders.filter((f) => sameHost(f.host, pane.host));
  if (side.length === 0) return null;
  const home = pane.host !== null ? homeOf(pane.host) : null;
  const keyOf = (s: string) => pathKey(pane.host !== null ? expandRemotePath(s, home) : s);
  for (const at of [pane.current, pane.start]) {
    if (!at?.trim()) continue;
    const k = keyOf(at);
    let best: DockFolder | null = null;
    let bestLen = -1;
    for (const f of side) {
      const fk = keyOf(f.path);
      if (fk === "" || !within(k, fk)) continue;
      if (fk.length > bestLen || (fk.length === bestLen && best?.worktree === null && f.worktree !== null)) {
        best = f;
        bestLen = fk.length;
      }
    }
    if (best) return best;
  }
  return null;
}

export function dockDot(agents: readonly DockDotAgent[], tr: Tr): DockDot | null {
  const facts = new Map<string, { state: AgentStatus; name: string; place: string | null; count: number; order: number }>();
  for (const a of agents) {
    if (a.state === null) continue;
    const place = a.place ?? null;
    const key = JSON.stringify([place, a.state, a.name]);
    const cur = facts.get(key);
    if (cur) cur.count++;
    else facts.set(key, { state: a.state, name: a.name, place, count: 1, order: facts.size });
  }
  if (facts.size === 0) return null;
  const list = [...facts.values()].sort(
    (a, b) => AGENT_STATUS_RANK[a.state] - AGENT_STATUS_RANK[b.state] || a.order - b.order,
  );
  const label = list
    .map((f) => {
      const name = f.count > 1 ? `${f.name} ×${f.count}` : f.name;
      const fact = tr(`app.tabs.dot.agent.${f.state}`, { name });
      return f.place ? tr("app.dock.dot.place", { place: f.place, fact }) : fact;
    })
    .join(" · ");
  return { state: list[0].state, label };
}

export interface ProjectDots {
  project: Record<string, DockDot>;
  /** 키 = [`worktreeDotKey`] */
  worktree: Record<string, DockDot>;
  /** 주 폴더 자리의 타일만 — 빈 탭 launcher 의 프로젝트 줄 */
  main: Record<string, DockDot>;
}

export const worktreeDotKey = (projectId: string, worktreePath: string) => `${projectId}\n${worktreePath}`;

export function projectDots(
  panes: readonly DockAgentPane[],
  folders: readonly DockFolder[],
  homeOf: (alias: string) => string | null,
  tr: Tr,
): ProjectDots {
  const byProject = new Map<string, DockDotAgent[]>();
  const byWorktree = new Map<string, DockDotAgent[]>();
  const byMain = new Map<string, DockDotAgent[]>();
  for (const pane of panes) {
    if (pane.state === null) continue;
    const f = placeOf(pane, folders, homeOf);
    if (!f) continue;
    const list = byProject.get(f.projectId) ?? [];
    list.push({ name: pane.name, state: pane.state, place: f.label });
    byProject.set(f.projectId, list);
    if (f.main ?? f.worktree === null) {
      const ml = byMain.get(f.projectId) ?? [];
      ml.push({ name: pane.name, state: pane.state });
      byMain.set(f.projectId, ml);
    }
    if (f.worktree !== null) {
      const key = worktreeDotKey(f.projectId, f.worktree);
      const wl = byWorktree.get(key) ?? [];
      wl.push({ name: pane.name, state: pane.state });
      byWorktree.set(key, wl);
    }
  }
  const out: ProjectDots = { project: {}, worktree: {}, main: {} };
  for (const [k, v] of byProject) {
    const d = dockDot(v, tr);
    if (d) out.project[k] = d;
  }
  for (const [k, v] of byWorktree) {
    const d = dockDot(v, tr);
    if (d) out.worktree[k] = d;
  }
  for (const [k, v] of byMain) {
    const d = dockDot(v, tr);
    if (d) out.main[k] = d;
  }
  return out;
}

/** 열쇠는 소문자 별칭 */
export function hostDots(panes: readonly DockAgentPane[], tr: Tr): Record<string, DockDot> {
  const by = new Map<string, DockDotAgent[]>();
  for (const pane of panes) {
    if (pane.host === null) continue;
    const key = pane.host.trim().toLowerCase();
    const list = by.get(key) ?? [];
    list.push({ name: pane.name, state: pane.state });
    by.set(key, list);
  }
  const out: Record<string, DockDot> = {};
  for (const [k, v] of by) {
    const d = dockDot(v, tr);
    if (d) out[k] = d;
  }
  return out;
}

/** 접힌 호스트 폴더 줄의 점 — `group` 은 호스트의 폴더 경로(`""` = 최상위) */
export function groupDot(
  folderPath: string,
  hosts: readonly { name: string; group: string }[],
  panes: readonly DockAgentPane[],
  tr: Tr,
): DockDot | null {
  if (folderPath === "") return null;
  const inside = new Map<string, string>();
  for (const h of hosts) {
    if (h.group === folderPath || h.group.startsWith(`${folderPath}/`)) inside.set(h.name.trim().toLowerCase(), h.name);
  }
  const agents: DockDotAgent[] = [];
  for (const pane of panes) {
    if (pane.host === null) continue;
    const name = inside.get(pane.host.trim().toLowerCase());
    if (name !== undefined) agents.push({ name: pane.name, state: pane.state, place: name });
  }
  return dockDot(agents, tr);
}

export function dockWaiting(
  panes: readonly DockAgentPane[],
  folders: readonly DockFolder[],
  homeOf: (alias: string) => string | null,
): { hosts: boolean; projects: boolean } {
  let hosts = false;
  let projects = false;
  for (const pane of panes) {
    if (pane.state !== "permission" && pane.state !== "finished") continue;
    if (pane.host !== null) hosts = true;
    if (!projects && placeOf(pane, folders, homeOf) !== null) projects = true;
  }
  return { hosts, projects };
}
