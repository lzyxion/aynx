/**
 * **독의 에이전트 점** — 프로젝트 · 워크트리 · 호스트 줄과 상태 표시줄 독 입구
 * (docs/log/2026-09-27-dock-agent-dots.md).
 *
 * 새 신호는 없다. 탭 점(`$lib/tab-dot`)이 쓰는 타일별 에이전트 상태를 **폴더·호스트로 묶기만**
 * 한다. 규칙은 탭 점과 같다: 권한 대기 > 완료(안 봄) > 실행 중, 점이 없는 타일(`null`)은 그리지 않는다
 * (docs/log/2026-10-01-agent-status-three.md). 말풍선은
 * 사실 전부를 우선순위 순으로 ` · ` 로 잇고, 같은 이름·같은 상태가 둘이면 `×2` 로 묶는다.
 *
 * ## 타일 하나는 한 자리에만
 *
 * 타일의 자리는 **지금 폴더**(셸이 알려 준 폴더 — OSC 7 · OSC 9;9)가 먼저이고, 그것이 어느 등록
 * 폴더에도 들지 않으면(또는 모르면) **시작 폴더**다. 폴더 판정은 경로 접두어(`pathKey` · `within`,
 * 새 터미널 시작 폴더와 같은 도구)이고, 겹친 폴더(주 저장소 안의 `.claude/worktrees/x`)는 **가장
 * 깊은 것**이 이긴다 — 한 타일이 두 줄에 서지 않는다. 로컬 폴더는 로컬 타일, 원격 폴더는 같은
 * 별칭(대소문자 무시)의 SSH 타일만 본다. 원격은 그 서버의 홈으로 `~` 를 양쪽 다 편다(모르면 글자
 * 그대로 — `paneStartedIn` 과 같다).
 *
 * 순수 모듈이다 — 타일 목록·홈·번역은 부르는 쪽(`app/dock-dots.svelte.ts`)이 넘긴다.
 */
import { AGENT_STATUS_RANK, type AgentStatus } from "$lib/agent-status";
import { pathKey, within } from "$lib/agent-sessions";
import { expandRemotePath, projectTail, type Project, type WorktreeListing } from "$lib/projects";
import type { Tr } from "$lib/session";

/** 독이 보는 AI 타일 하나 */
export interface DockAgentPane {
  id: string;
  /** 보여 줄 에이전트 이름 ("Claude Code") */
  name: string;
  /** 지금 점 — 없으면 `null`(`app/agent-status` 의 `agentStatusOf`) */
  state: AgentStatus | null;
  /** `null` = 로컬 타일 · 아니면 설정의 SSH 별칭(빠른 접속 타일은 부르는 쪽이 뺀다) */
  host: string | null;
  /** 시작 폴더 (`PaneSpec.cwd`) */
  start: string | null;
  /** 셸이 마지막으로 알려 준 폴더 — 로컬은 이 PC 의 경로로 옮긴 값 */
  current: string | null;
}

/** 등록된 폴더 하나 — 프로젝트의 워크트리 줄 또는(목록을 아직 안 읽었으면) 프로젝트의 주 폴더 */
export interface DockFolder {
  projectId: string;
  /** `null` = 로컬 프로젝트 · 아니면 별칭 */
  host: string | null;
  path: string;
  /** 워크트리 줄의 경로(`WorktreeInfo.path`) — 주 폴더 자리면 `null` */
  worktree: string | null;
  /** 접힌 프로젝트 줄 말풍선의 이름 — 브랜치(없으면 폴더 꼬리) */
  label: string;
  /**
   * 프로젝트의 **주 폴더 자리**인가 — `worktree: null` 줄, 그리고 주 폴더와 같은 자리의 워크트리 줄(주 워크트리).
   * 빈 탭 launcher 의 프로젝트 줄 점([`ProjectDots.main`])이 이것만 모은다. 모르면(옛 호출) `worktree === null` 로 본다.
   */
  main?: boolean;
}

/** 줄 하나의 점 — 모양은 `state`, 말풍선은 `label` */
export interface DockDot {
  state: AgentStatus;
  label: string;
}

/** 점에 모일 사실의 재료 — 에이전트 이름 · 점 · (있으면) 어느 자리의 말인가 */
export interface DockDotAgent {
  name: string;
  state: AgentStatus | null;
  place?: string | null;
}

const sameHost = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * 프로젝트들의 등록 폴더 — 목록을 읽어 둔(`ok`) 프로젝트는 워크트리 줄마다 하나(bare 제외), 그리고
 * **늘** 주 폴더 하나(`worktree: null`). 주 폴더가 주 워크트리와 같은 자리면 판정에서 워크트리 쪽이
 * 이긴다([`placeOf`] 의 동률 규칙).
 */
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

/**
 * 폴더 비교 열쇠 — 원격은 그 서버의 홈으로 `~` 를 편 뒤(모르면 글자 그대로), 로컬은 그대로 [`pathKey`].
 * 등록 폴더 판정([`placeOf`])과 같은 규칙이다.
 */
export function folderKeyFor(
  host: string | null,
  homeOf: (alias: string) => string | null,
): (path: string) => string {
  const home = host !== null ? homeOf(host) : null;
  return (s: string) => pathKey(host !== null ? expandRemotePath(s, home) : s);
}

/**
 * 타일의 **자리** — 지금 폴더 → 시작 폴더 순으로, 그 폴더를 품은 가장 깊은 등록 폴더. 없으면 `null`.
 * 같은 깊이(주 폴더 ≡ 주 워크트리)면 워크트리 줄이 이긴다.
 */
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

/**
 * 사실들을 점 하나로 — 점이 없는 것(`null`)은 버리고, (자리 · 상태 · 이름) 마다 한 사실로 묶어 우선순위
 * (`AGENT_STATUS_RANK` — 권한 대기 > 완료 > 실행 중) 순으로 잇는다. 보일 것이 없으면 `null`.
 */
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

/** 프로젝트 독의 점들 — 접힌 프로젝트 줄(`project`)과 워크트리 줄(`worktree`, 키 = [`worktreeDotKey`]) */
export interface ProjectDots {
  project: Record<string, DockDot>;
  worktree: Record<string, DockDot>;
  /** 프로젝트 id → **주 폴더 자리**(주 폴더 · 주 워크트리)의 타일만 접은 점 — 빈 탭 launcher 의 프로젝트 줄 */
  main: Record<string, DockDot>;
}

/** 워크트리 줄 점의 키 */
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

/** 호스트 줄의 점 — 별칭(소문자) → 점. 로컬 타일은 없다 */
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

/**
 * 접힌 호스트 폴더 줄의 점 — 그 폴더(하위 폴더 포함) 안 호스트들의 타일을 접는다. 말풍선의 자리는
 * 호스트 별칭이다. `hosts` 는 (별칭 · 그 호스트의 폴더 경로) — 폴더 경로 `""` 은 최상위.
 */
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

/**
 * 독 입구의 부름 — **권한 대기 · 완료(안 봄)** 인 에이전트가 있는가만(실행 중은 입구에 서지 않는다).
 * `hosts` = 설정 별칭의 SSH 타일, `projects` = 등록된 프로젝트 폴더 안의 타일.
 */
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
