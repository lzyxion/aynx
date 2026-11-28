/**
 * 이 폴더의 지난 대화 — 순수 규칙. 폴더 판정은 시작 화면과 같다(`conversationsInFolder` — 하위 폴더에서 시작한 대화는 아니다).
 * 대화 제목은 사용자 글자일 수 있어(첫 프롬프트) 화면으로만 넘긴다 — 저장하지 않는다.
 */
import {
  conversationMatches,
  flatConversations,
  localProjects,
  pathKey,
  within,
  type AgentConversation,
  type ConversationList,
} from "$lib/agent-sessions";
import { conversationsInFolder } from "$lib/project-start";
import type { Project, WorktreeInfo } from "$lib/projects";

// ── 기준 폴더 ──

export interface FolderInput {
  /** 폴더가 없는 타일(SSH · 설정 · 파일 …)이면 `null` */
  focused: string | null;
  /** 같은 탭의 다른 타일들의 폴더 — 포커스된 타일에 폴더가 없을 때의 폴백 */
  tabFolders: readonly string[];
}

export type FolderSource = "tile" | "tab" | "none";

export interface FolderContext {
  /** `null` = 모든 대화 */
  folder: string | null;
  source: FolderSource;
  /** 칩 이름이 "이 워크트리" 냐 "이 폴더" 냐 */
  registered: boolean;
  project: { id: string; name: string; paths: string[] } | null;
}

function projectPaths(p: Project, worktreesOf: (projectId: string) => readonly WorktreeInfo[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of [p.path, ...(worktreesOf(p.id) ?? []).map((w) => w.path)]) {
    const k = pathKey(path);
    if (k === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(path);
  }
  return out;
}

function registeredRoot(
  dir: string,
  projects: readonly Project[],
  worktreesOf: (projectId: string) => readonly WorktreeInfo[] | null,
): { path: string; project: Project; paths: string[] } | null {
  const k = pathKey(dir);
  if (k === "") return null;
  let best: { path: string; project: Project; paths: string[] } | null = null;
  for (const p of localProjects(projects)) {
    const paths = projectPaths(p, worktreesOf);
    for (const path of paths) {
      const rk = pathKey(path);
      if (!within(k, rk)) continue;
      if (!best || rk.length > pathKey(best.path).length) best = { path, project: p, paths };
    }
  }
  return best;
}

/** 탭 폴백은 등록된 프로젝트 안 폴더만 본다 — 아무 셸의 홈 폴더가 기준이 되지 않게 */
export function resolveFolderContext(
  input: FolderInput,
  projects: readonly Project[],
  worktreesOf: (projectId: string) => readonly WorktreeInfo[] | null,
): FolderContext {
  const focused = input.focused?.trim() ?? "";
  if (focused !== "") {
    const r = registeredRoot(focused, projects, worktreesOf);
    if (r) {
      return {
        folder: r.path,
        source: "tile",
        registered: true,
        project: { id: r.project.id, name: r.project.name, paths: r.paths },
      };
    }
    return { folder: focused, source: "tile", registered: false, project: null };
  }
  for (const f of input.tabFolders) {
    const r = registeredRoot(f, projects, worktreesOf);
    if (r) {
      return {
        folder: r.path,
        source: "tab",
        registered: true,
        project: { id: r.project.id, name: r.project.name, paths: r.paths },
      };
    }
  }
  return { folder: null, source: "none", registered: false, project: null };
}

// ── 범위 ──

/** `host` 는 원격(SSH 타일 · 원격 프로젝트)의 "<호스트> 전체" */
export type FolderScope = "here" | "project" | "all" | "host";

export interface FolderLists {
  here: AgentConversation[];
  /** 프로젝트 밖이거나 폴더가 하나뿐이면 `null` — 그때는 칩을 세우지 않는다 */
  project: AgentConversation[] | null;
  all: AgentConversation[];
}

export function folderLists(list: ConversationList | null, ctx: FolderContext): FolderLists {
  const all = flatConversations(list);
  const here = ctx.folder ? conversationsInFolder(list, ctx.folder) : [];
  let project: AgentConversation[] | null = null;
  if (ctx.project && ctx.project.paths.length > 1) {
    const keys = new Set(ctx.project.paths.map(pathKey));
    project = all.filter((s) => keys.has(pathKey(s.cwd)));
  }
  return { here, project, all };
}

export interface ScopeChip {
  scope: FolderScope;
  count: number;
}

/** 첫 칩이 처음 골라진 범위다 */
export function scopeChips(ctx: FolderContext, lists: FolderLists, withAll = false): ScopeChip[] {
  if (ctx.folder === null) return [{ scope: "all", count: lists.all.length }];
  const out: ScopeChip[] = [{ scope: "here", count: lists.here.length }];
  if (lists.project) out.push({ scope: "project", count: lists.project.length });
  if (withAll) out.push({ scope: "all", count: lists.all.length });
  return out;
}

export function listForScope(lists: FolderLists, scope: FolderScope): AgentConversation[] {
  if (scope === "here") return lists.here;
  if (scope === "project") return lists.project ?? [];
  return lists.all; // "all" · "host"(원격 — 그 서버의 목록 전부)
}

export function effectiveScope(chips: readonly ScopeChip[], picked: FolderScope | null): FolderScope {
  if (picked !== null && chips.some((c) => c.scope === picked)) return picked;
  return chips[0]?.scope ?? "all";
}

export function nextScope(chips: readonly ScopeChip[], cur: FolderScope): FolderScope {
  if (chips.length === 0) return cur;
  const i = chips.findIndex((c) => c.scope === cur);
  return chips[(i + 1) % chips.length].scope;
}

/** 팔레트의 대화 찾기와 같은 규칙을 제목 하나에만 건다 */
export function filterByTitle(list: readonly AgentConversation[], query: string): AgentConversation[] {
  if (query.trim() === "") return [...list];
  return list.filter((s) => conversationMatches(query, { title: s.title, scope: "" }));
}

export function folderBranch(
  folder: string | null,
  worktrees: readonly WorktreeInfo[] | null,
  here: readonly AgentConversation[],
): string | null {
  if (folder === null) return null;
  const k = pathKey(folder);
  const hit = worktrees?.find((w) => pathKey(w.path) === k);
  if (hit) return hit.branch;
  return here.find((s) => s.branch)?.branch ?? null;
}

// ── 키 → 동작 ──

export type PickerAction = "up" | "down" | "resume" | "resumeChat" | "fork" | "forkHere" | "view" | "scope" | "close" | "refresh";

export interface PickerKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** IME 조합 중에는 아무것도 아니다 — 조합을 끝내는 Enter 가 재개가 되지 않게 */
export function pickerActionForKey(ev: PickerKeyEvent): PickerAction | null {
  if (ev.isComposing) return null;
  // Alt 조합 중 뜻이 있는 것은 Alt+Enter(채팅으로 열기) 하나뿐
  if ((ev.code === "Enter" || ev.code === "NumpadEnter") && ev.altKey && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey) return "resumeChat";
  if (ev.altKey || ev.metaKey) return null;
  if (ev.code === "Escape") return "close";
  if (ev.code === "ArrowUp" || ev.code === "ArrowDown") {
    if (ev.ctrlKey || ev.shiftKey) return null;
    return ev.code === "ArrowUp" ? "up" : "down";
  }
  if (ev.code === "Enter" || ev.code === "NumpadEnter") {
    if (ev.ctrlKey && ev.shiftKey) return "forkHere";
    if (ev.ctrlKey) return "view";
    return ev.shiftKey ? "fork" : "resume";
  }
  if (ev.code === "Tab" && !ev.ctrlKey) return "scope";
  if (ev.code === "F5" && !ev.ctrlKey && !ev.shiftKey) return "refresh";
  return null;
}

/** 기록된 폴더가 지워졌어도 된다(병합 뒤 지운 워크트리의 대화 — CLI 는 id 로 찾는다) */
export function canForkHere(s: Pick<AgentConversation, "cwd">, base: string | null): boolean {
  return base !== null && s.cwd !== "" && pathKey(s.cwd) !== pathKey(base);
}

export type RowState = "ok" | "open" | "missing" | "elsewhere";

export function resumeOutcome(state: RowState, confirmed: boolean): "focus" | "none" | "confirm" | "resume" {
  if (state === "open") return "focus";
  if (state === "missing") return "none";
  if (state === "elsewhere" && !confirmed) return "confirm";
  return "resume";
}

