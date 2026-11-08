/**
 * **이 폴더의 지난 대화** — 순수 규칙 (docs/log/2026-09-27-folder-conversations.md).
 *
 * 타일에서 일하다가 그 타일이 있는 폴더(워크트리)에서 나눈 Claude · Codex 대화를 불러 **지금 타일 옆에 분할로**
 * 여는 기능의 판정들이다: 어느 폴더를 기준으로 삼나 · 범위 칩(이 워크트리 · 이 프로젝트 전체 · 모든 대화) ·
 * 제목 거르기 · 키 → 동작. 저장소는 `app/folder-conversations.svelte.ts`, 그림은
 * `FolderConversations.svelte`(고르는 목록)와 `ProjectStart.svelte`(시작 화면의 같은 칩)이다.
 *
 * ## 폴더 판정 = 시작 화면과 같다
 *
 * 한 폴더의 대화는 **기록된 시작 폴더가 그 폴더와 같은 것**이다(`conversationsInFolder` — 하위 폴더에서 시작한
 * 대화는 아니다). 그래서 두 화면의 목록이 같다. 다만 타일의 **지금 폴더**는 워크트리 안의 아무 하위 폴더일 수
 * 있으므로(`cd src/lib`) 먼저 **등록된 뿌리**로 올린다 — 로컬 프로젝트의 주 폴더와 워크트리 폴더 중 그 폴더를
 * 품은 **가장 깊은** 것. 등록 경로 밖이면 받은 폴더 그대로(정확히 같은 폴더) 본다.
 *
 * 대화 제목은 사용자 글자일 수 있어(첫 프롬프트) 이 모듈도 화면으로만 넘긴다 — 저장하지 않는다.
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

// ---------------------------------------------------------------------------
// 기준 폴더
// ---------------------------------------------------------------------------

/** 판정의 재료 — 앱 상태에서 뽑아 온 폴더 글자들 */
export interface FolderInput {
  /**
   * 포커스된 타일의 **지금 폴더** — 셸이 알려 준 폴더(OSC 7 · OSC 9;9) → 그 타일의 시작 폴더(로컬 · AI 타일) →
   * 프로젝트 시작 화면의 폴더. 폴더가 없는 타일(SSH · 설정 · 파일 …)이면 `null`.
   */
  focused: string | null;
  /** 같은 탭의 **다른** 타일들의 폴더(위와 같은 규칙) — 포커스된 타일에 폴더가 없을 때의 폴백 */
  tabFolders: readonly string[];
}

/** 기준 폴더를 어디서 얻었나 — 포커스된 타일 · 그 탭의 프로젝트 폴더 · 없음(모든 대화) */
export type FolderSource = "tile" | "tab" | "none";

/** 판정 결과 */
export interface FolderContext {
  /** 목록의 기준 폴더 — 없으면 `null`(= 모든 대화) */
  folder: string | null;
  source: FolderSource;
  /** 기준 폴더가 로컬 프로젝트의 주 폴더나 워크트리인가 — 칩 이름이 "이 워크트리" 냐 "이 폴더" 냐 */
  registered: boolean;
  /** 그 폴더가 속한 로컬 프로젝트와 그 모든 폴더(주 폴더 + 워크트리들, 겹침 없음) — 등록 경로 밖이면 `null` */
  project: { id: string; name: string; paths: string[] } | null;
}

/** 로컬 프로젝트 하나의 폴더들 — 주 폴더가 먼저, 겹침 없음 */
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

/** 그 폴더를 품은 **가장 깊은** 등록 경로와 그 프로젝트 — 없으면 `null` */
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

/**
 * **기준 폴더를 정한다** — 포커스된 타일의 폴더(등록 뿌리로 올림, 밖이면 그대로) → 그 탭의 다른 타일 중
 * **등록된 프로젝트 안**에 있는 첫 폴더의 뿌리 → 없음(모든 대화). 탭 폴백이 등록 경로만 보는 이유: 폴더가 없는
 * 타일(SSH 등)에서 부른 사람이 원하는 것은 "이 탭이 일하는 프로젝트" 이고, 아무 셸의 홈 폴더가 아니다.
 */
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

// ---------------------------------------------------------------------------
// 범위 — 이 워크트리 · 이 프로젝트 전체 · 모든 대화
// ---------------------------------------------------------------------------

/** 범위 칩 하나의 뜻 — `host` 는 원격(SSH 타일 · 원격 프로젝트)의 "<호스트> 전체"(docs/log/2026-09-27-remote-conversations.md) */
export type FolderScope = "here" | "project" | "all" | "host";

/** 범위별 대화 — 모두 최신순 · 같은 대화는 한 번 */
export interface FolderLists {
  /** 기준 폴더에서 시작한 대화(기준 폴더가 없으면 빈 목록) */
  here: AgentConversation[];
  /**
   * 그 프로젝트의 **모든 폴더**(주 폴더 + 워크트리)에서 시작한 대화 — 프로젝트 밖이거나 프로젝트의 폴더가 하나뿐이면
   * `null`(그때는 "이 워크트리" 와 같은 목록이라 칩을 세우지 않는다).
   */
  project: AgentConversation[] | null;
  /** 목록 전체(묶음 + 기타) */
  all: AgentConversation[];
}

/** 판정 결과 → 범위별 대화 */
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

/** 범위 칩 하나 — 뜻과 그 범위의 대화 수 */
export interface ScopeChip {
  scope: FolderScope;
  count: number;
}

/**
 * 머리에 설 칩들 — 기준 폴더가 있으면 "이 워크트리(폴더)" 와(프로젝트가 여러 폴더면) "이 프로젝트 전체",
 * 없으면 "모든 대화" 하나. 첫 칩이 처음 골라진 범위다. `withAll` 이면 기준 폴더가 있어도 끝에 "모든 대화" 를 단다
 * (상태줄 지난 대화 — 다른 프로젝트의 대화도 거기서 고르게. 프로젝트 시작 화면은 그 프로젝트 것만이라 달지 않는다).
 */
export function scopeChips(ctx: FolderContext, lists: FolderLists, withAll = false): ScopeChip[] {
  if (ctx.folder === null) return [{ scope: "all", count: lists.all.length }];
  const out: ScopeChip[] = [{ scope: "here", count: lists.here.length }];
  if (lists.project) out.push({ scope: "project", count: lists.project.length });
  if (withAll) out.push({ scope: "all", count: lists.all.length });
  return out;
}

/** 그 범위의 목록 — 없는 범위면 빈 목록 */
export function listForScope(lists: FolderLists, scope: FolderScope): AgentConversation[] {
  if (scope === "here") return lists.here;
  if (scope === "project") return lists.project ?? [];
  return lists.all; // "all" · "host"(원격 — 그 서버의 목록 전부)
}

/** 칩에 있는 범위면 그대로, 아니면(사라졌다) 첫 칩 */
export function effectiveScope(chips: readonly ScopeChip[], picked: FolderScope | null): FolderScope {
  if (picked !== null && chips.some((c) => c.scope === picked)) return picked;
  return chips[0]?.scope ?? "all";
}

/** `Tab` — 다음 칩으로(끝이면 처음으로). 칩이 하나뿐이면 제자리 */
export function nextScope(chips: readonly ScopeChip[], cur: FolderScope): FolderScope {
  if (chips.length === 0) return cur;
  const i = chips.findIndex((c) => c.scope === cur);
  return chips[(i + 1) % chips.length].scope;
}

/**
 * 제목 거르기 — 팔레트의 대화 찾기와 **같은 규칙**(`conversationMatches` — 빈칸으로 가른 낱말이 모두 부분 글자로,
 * 대소문자 무관)을 제목 하나에만 건다. 범위는 칩이 이미 정했으니 범위 이름은 보지 않는다.
 */
export function filterByTitle(list: readonly AgentConversation[], query: string): AgentConversation[] {
  if (query.trim() === "") return [...list];
  return list.filter((s) => conversationMatches(query, { title: s.title, scope: "" }));
}

/**
 * 머리의 브랜치 — 기준 폴더가 워크트리 목록에 있으면 그 브랜치, 없으면 그 폴더의 가장 최근 대화가 적어 둔 것
 * (시작 화면과 같은 규칙).
 */
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

// ---------------------------------------------------------------------------
// 키 → 동작
// ---------------------------------------------------------------------------

/** 고르는 목록이 다루는 동작 */
export type PickerAction = "up" | "down" | "resume" | "fork" | "forkHere" | "view" | "scope" | "close" | "refresh";

/** 이 판정이 보는 `KeyboardEvent` 의 칸들 */
export interface PickerKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/**
 * 키 → 동작 (`ev.code` — 한글 자판에서도 같다). ↑↓ 고르기 · `Enter` 재개(옆에 분할) · `Shift+Enter` 새 대화로
 * 계속 · `Ctrl+Shift+Enter` 여기로 가져와 계속 · `Ctrl+Enter` 기록 보기(팔레트와 같은 조합) · `Tab`(`Shift+Tab` 도) 범위 · `F5` 다시 읽기 · `Escape` 닫기. IME 조합 중에는
 * 아무것도 아니다(조합을 끝내는 Enter 가 재개가 되지 않게). 나머지는 입력칸의 글자다.
 */
export function pickerActionForKey(ev: PickerKeyEvent): PickerAction | null {
  if (ev.isComposing) return null;
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
  // F5 — 다시 읽기(원격은 1분 캐시를 건너뛴다). 떠 있는 동안에는 페이지 새로고침이 아니다
  if (ev.code === "F5" && !ev.ctrlKey && !ev.shiftKey) return "refresh";
  return null;
}

/**
 * **여기로 가져와 계속**이 되는 줄인가 — 기준 폴더가 있고 그 대화가 **다른 폴더**에서 시작했을 때(같은 폴더면 보통의 새
 * 대화로 계속과 같다). 기록된 폴더가 지워졌어도 된다(병합 뒤 지운 워크트리의 대화 — CLI 는 id 로 찾는다).
 */
export function canForkHere(s: Pick<AgentConversation, "cwd">, base: string | null): boolean {
  return base !== null && s.cwd !== "" && pathKey(s.cwd) !== pathKey(base);
}

/** 줄의 상태 — `openElsewhere` · 연결된 타일 · 폴더 유무에서 온다(팔레트 줄과 같은 네 갈래) */
export type RowState = "ok" | "open" | "missing" | "elsewhere";

/**
 * `Enter`(재개)가 이 줄에서 무엇을 하나 — `open` 이면 그 타일로 가기만 · `missing` 이면 아무것도(폴더가 없다) ·
 * `elsewhere` 면 한 번 묻고(두 번째 `Enter` 에 그래도 재개 — 시작 화면과 같은 규칙) · 아니면 재개.
 */
export function resumeOutcome(state: RowState, confirmed: boolean): "focus" | "none" | "confirm" | "resume" {
  if (state === "open") return "focus";
  if (state === "missing") return "none";
  if (state === "elsewhere" && !confirmed) return "confirm";
  return "resume";
}

