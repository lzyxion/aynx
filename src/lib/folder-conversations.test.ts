import { describe, expect, it } from "vitest";
import type { AgentConversation, ConversationList } from "$lib/agent-sessions";
import type { Project, WorktreeInfo } from "$lib/projects";
import {
  effectiveScope,
  filterByTitle,
  folderBranch,
  folderLists,
  listForScope,
  nextScope,
  pickerActionForKey,
  canForkHere,
  resolveFolderContext,
  resumeOutcome,
  scopeChips,
  type FolderContext,
  type PickerKeyEvent,
} from "$lib/folder-conversations";

/**
 * 이 폴더의 지난 대화 — 순수 규칙 (docs/log/2026-09-27-folder-conversations.md).
 * 기준 폴더(등록 뿌리로 올림 · 탭 폴백 · 모든 대화) · 범위 칩과 수 · 거르기 · 키 → 동작.
 */

let n = 0;
const C = (cwd: string, updatedAt: number, extra: Partial<AgentConversation> = {}): AgentConversation => ({
  agent: "claude",
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  cwd,
  branch: "main",
  title: `t${n}`,
  titleSource: "ai",
  startedAt: null,
  updatedAt,
  model: null,
  forkedFrom: null,
  cwdExists: true,
  ...extra,
});

const P = (id: string, path: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  host: null,
  path,
  shell: null,
  agent: null, setupScript: "", migration: null,
  tmux: false,
  worktreeDir: null,
  ...extra,
});
const W = (path: string, branch: string | null): WorktreeInfo => ({
  path,
  branch,
  head: null,
  bare: false,
  detached: branch === null,
});

const MAIN = "C:\\src\\proj";
const FEAT = "C:/src/proj-wt/feat-y";
const QUIET = "C:\\src\\quiet";
const projects = [P("aynx", MAIN), P("quiet", QUIET), P("api", "~/api", { host: "dev-01" })];
const trees: Record<string, WorktreeInfo[]> = { aynx: [W("C:/src/proj", "main"), W(FEAT, "feat-y")] };
const worktreesOf = (id: string) => trees[id] ?? null;

describe("resolveFolderContext — 기준 폴더", () => {
  it("포커스된 타일이 워크트리 안 하위 폴더에 있으면 그 워크트리 뿌리로 올린다", () => {
    const c = resolveFolderContext({ focused: "C:\\src\\proj-wt\\feat-y\\src\\lib", tabFolders: [] }, projects, worktreesOf);
    expect(c.folder).toBe(FEAT);
    expect(c.source).toBe("tile");
    expect(c.registered).toBe(true);
    expect(c.project?.id).toBe("aynx");
    expect(c.project?.paths).toEqual([MAIN, FEAT]); // 주 폴더가 먼저 · git 의 주 폴더 줄은 겹쳐 빠진다
  });

  it("가장 깊은 등록 경로가 이긴다 — 주 폴더 안에 워크트리가 있어도", () => {
    const nested = "C:\\src\\proj\\.wt\\x";
    const t2 = { aynx: [W(nested, "x")] };
    const c = resolveFolderContext({ focused: `${nested}\\deep`, tabFolders: [] }, projects, (id) => t2[id as "aynx"] ?? null);
    expect(c.folder).toBe(nested);
  });

  it("주 폴더 그대로면 주 폴더 — 구분자 · 대소문자를 가리지 않는다", () => {
    const c = resolveFolderContext({ focused: "c:/SRC/proj/", tabFolders: [] }, projects, worktreesOf);
    expect(c.folder).toBe(MAIN);
  });

  it("등록 경로 밖이면 받은 폴더 **그대로**(정확히 같은 폴더) — 프로젝트 없음", () => {
    const c = resolveFolderContext({ focused: "C:\\Users\\me\\scratch", tabFolders: [MAIN] }, projects, worktreesOf);
    expect(c).toEqual({ folder: "C:\\Users\\me\\scratch", source: "tile", registered: false, project: null });
  });

  it("폴더가 없는 타일(SSH 등) → 그 탭의 프로젝트 폴더", () => {
    const c = resolveFolderContext({ focused: null, tabFolders: ["C:\\Users\\me", `${QUIET}\\docs`] }, projects, worktreesOf);
    expect(c.folder).toBe(QUIET);
    expect(c.source).toBe("tab");
    expect(c.project?.paths).toEqual([QUIET]);
  });

  it("탭에도 프로젝트 폴더가 없으면 모든 대화", () => {
    const c = resolveFolderContext({ focused: "  ", tabFolders: ["C:\\Users\\me"] }, projects, worktreesOf);
    expect(c).toEqual({ folder: null, source: "none", registered: false, project: null });
  });

  it("원격 프로젝트는 등록 경로가 아니다 (대화는 이 PC 의 파일만)", () => {
    const c = resolveFolderContext({ focused: "~/api", tabFolders: [] }, projects, worktreesOf);
    expect(c.registered).toBe(false);
    expect(c.project).toBeNull();
  });
});

describe("folderLists · scopeChips — 범위와 수", () => {
  const a = C(MAIN, 50);
  const b = C(FEAT, 40);
  const b2 = C(FEAT, 30);
  const sub = C(`${FEAT}/src`, 35); // 하위 폴더에서 시작 — 시작 화면과 같이 "이 워크트리" 가 아니다
  const q = C(QUIET, 20);
  const o = C("C:\\Users\\me\\scratch", 10);
  const list: ConversationList = {
    groups: [
      { cwd: MAIN, exists: true, sessions: [a], more: false },
      { cwd: FEAT, exists: true, sessions: [b, b2], more: false },
      { cwd: QUIET, exists: true, sessions: [q], more: false },
    ],
    others: [sub, o],
    othersMore: false,
  };
  const ctxOf = (focused: string | null, tabFolders: string[] = []) =>
    resolveFolderContext({ focused, tabFolders }, projects, worktreesOf);

  it("이 워크트리 = 그 폴더에서 **시작한** 대화 · 이 프로젝트 전체 = 모든 폴더 · 모든 대화", () => {
    const ctx = ctxOf(FEAT);
    const l = folderLists(list, ctx);
    expect(l.here.map((s) => s.id)).toEqual([b.id, b2.id]);
    expect(l.project?.map((s) => s.id)).toEqual([a.id, b.id, b2.id]);
    expect(l.all).toHaveLength(6);
    expect(scopeChips(ctx, l)).toEqual([
      { scope: "here", count: 2 },
      { scope: "project", count: 3 },
    ]);
  });

  it("폴더가 하나뿐인 프로젝트는 '이 프로젝트 전체' 칩이 없다 (같은 목록이다)", () => {
    const ctx = ctxOf(QUIET);
    const l = folderLists(list, ctx);
    expect(l.project).toBeNull();
    expect(scopeChips(ctx, l)).toEqual([{ scope: "here", count: 1 }]);
  });

  it("프로젝트 밖 폴더는 칩 하나(이 폴더)", () => {
    const ctx = ctxOf("C:\\Users\\me\\scratch");
    expect(scopeChips(ctx, folderLists(list, ctx))).toEqual([{ scope: "here", count: 1 }]);
  });

  it("기준 폴더가 없으면 '모든 대화' 하나", () => {
    const ctx = ctxOf(null);
    const l = folderLists(list, ctx);
    expect(l.here).toEqual([]);
    expect(scopeChips(ctx, l)).toEqual([{ scope: "all", count: 6 }]);
    expect(listForScope(l, "all")).toHaveLength(6);
  });

  it("상태줄 지난 대화(withAll)는 끝에 '모든 대화' 를 단다 — 기준 폴더가 없으면 그것 하나", () => {
    const ctx = ctxOf(FEAT);
    expect(scopeChips(ctx, folderLists(list, ctx), true)).toEqual([
      { scope: "here", count: 2 },
      { scope: "project", count: 3 },
      { scope: "all", count: 6 },
    ]);
    const quiet = ctxOf(QUIET);
    expect(scopeChips(quiet, folderLists(list, quiet), true)).toEqual([
      { scope: "here", count: 1 },
      { scope: "all", count: 6 },
    ]);
    const none = ctxOf(null);
    expect(scopeChips(none, folderLists(list, none), true)).toEqual([{ scope: "all", count: 6 }]);
  });

  it("목록을 아직 안 읽었으면 전부 0", () => {
    const ctx = ctxOf(FEAT);
    expect(scopeChips(ctx, folderLists(null, ctx))).toEqual([
      { scope: "here", count: 0 },
      { scope: "project", count: 0 },
    ]);
  });

  it("빈 워크트리 — 이 워크트리 0 · 이 프로젝트 전체 M (시작 화면의 '이 프로젝트 전체 보기' 단추)", () => {
    const empty = "C:/src/proj-wt/empty";
    const t2 = { aynx: [...trees.aynx, W(empty, "empty")] };
    const ctx = resolveFolderContext({ focused: empty, tabFolders: [] }, projects, (id) => t2[id as "aynx"] ?? null);
    const l = folderLists(list, ctx);
    expect(scopeChips(ctx, l)).toEqual([
      { scope: "here", count: 0 },
      { scope: "project", count: 3 },
    ]);
  });
});

describe("범위 고르기 — Tab", () => {
  const two = [
    { scope: "here" as const, count: 2 },
    { scope: "project" as const, count: 5 },
  ];
  it("첫 칩이 처음 골라진 범위 · 사라진 범위는 첫 칩으로", () => {
    expect(effectiveScope(two, null)).toBe("here");
    expect(effectiveScope(two, "project")).toBe("project");
    expect(effectiveScope([{ scope: "all", count: 1 }], "project")).toBe("all");
    expect(effectiveScope([], null)).toBe("all");
  });
  it("Tab 은 다음 칩으로 돌고 끝에서 처음으로 · 칩 하나면 제자리", () => {
    expect(nextScope(two, "here")).toBe("project");
    expect(nextScope(two, "project")).toBe("here");
    expect(nextScope([{ scope: "all", count: 3 }], "all")).toBe("all");
  });
});

describe("filterByTitle — 팔레트와 같은 규칙", () => {
  const rows = [
    C(MAIN, 3, { title: "Fix the flaky build script" }),
    C(MAIN, 2, { title: "알림 센터 두 칸으로 나누기" }),
    C(MAIN, 1, { title: "Build cache" }),
  ];
  it("빈 질의는 그대로(최신순)", () => {
    expect(filterByTitle(rows, "  ")).toEqual(rows);
  });
  it("낱말이 모두 부분 글자로 — 대소문자 무관 · 순서 무관", () => {
    expect(filterByTitle(rows, "build").map((s) => s.title)).toEqual(["Fix the flaky build script", "Build cache"]);
    expect(filterByTitle(rows, "script BUILD").map((s) => s.title)).toEqual(["Fix the flaky build script"]);
    expect(filterByTitle(rows, "알림 칸").map((s) => s.title)).toEqual(["알림 센터 두 칸으로 나누기"]);
  });
  it("흩어진 글자(부분수열)는 맞지 않는다 — 긴 제목이 다 걸리지 않게", () => {
    expect(filterByTitle(rows, "fbs")).toEqual([]);
  });
});

describe("folderBranch", () => {
  it("워크트리 목록의 브랜치 → 없으면 가장 최근 대화의 브랜치 → 없으면 null", () => {
    expect(folderBranch(FEAT, trees.aynx, [])).toBe("feat-y");
    expect(folderBranch(QUIET, null, [C(QUIET, 1, { branch: "dev" })])).toBe("dev");
    expect(folderBranch(QUIET, null, [C(QUIET, 1, { branch: null })])).toBeNull();
    expect(folderBranch(null, trees.aynx, [])).toBeNull();
  });
});

describe("pickerActionForKey — 키 → 동작", () => {
  const ev = (code: string, mods: Partial<PickerKeyEvent> = {}): PickerKeyEvent => ({
    code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });
  it("↑↓ · Enter 재개 · Shift+Enter 새 대화로 계속 · Ctrl+Enter 기록 보기 · Tab 범위 · Esc 닫기", () => {
    expect(pickerActionForKey(ev("ArrowUp"))).toBe("up");
    expect(pickerActionForKey(ev("ArrowDown"))).toBe("down");
    expect(pickerActionForKey(ev("Enter"))).toBe("resume");
    expect(pickerActionForKey(ev("NumpadEnter"))).toBe("resume");
    expect(pickerActionForKey(ev("Enter", { shiftKey: true }))).toBe("fork");
    expect(pickerActionForKey(ev("Enter", { ctrlKey: true }))).toBe("view");
    expect(pickerActionForKey(ev("Enter", { ctrlKey: true, shiftKey: true }))).toBe("forkHere");
    expect(pickerActionForKey(ev("Tab"))).toBe("scope");
    expect(pickerActionForKey(ev("Tab", { shiftKey: true }))).toBe("scope");
    expect(pickerActionForKey(ev("Escape"))).toBe("close");
  });
  it("IME 조합 중 · Alt/Meta · 뜻 없는 조합 · 글자는 입력칸의 것", () => {
    expect(pickerActionForKey(ev("Enter", { isComposing: true }))).toBeNull();
    expect(pickerActionForKey(ev("Enter", { altKey: true }))).toBeNull();
    expect(pickerActionForKey(ev("ArrowDown", { shiftKey: true }))).toBeNull();
    expect(pickerActionForKey(ev("Tab", { ctrlKey: true }))).toBeNull();
    expect(pickerActionForKey(ev("KeyA"))).toBeNull();
  });
});

describe("canForkHere — 여기로 가져와 계속", () => {
  it("기준 폴더가 있고 다른 폴더의 대화일 때만 (대소문자 · 구분자 차이는 같은 폴더)", () => {
    expect(canForkHere({ cwd: "C:\\src\\proj-wt\\a" }, "C:/src/proj-wt/b")).toBe(true);
    expect(canForkHere({ cwd: "C:\\src\\proj-wt\\a" }, "c:/src/proj-wt/a")).toBe(false);
    expect(canForkHere({ cwd: "C:\\src\\proj-wt\\a" }, null)).toBe(false);
    expect(canForkHere({ cwd: "" }, "C:/src/proj-wt/b")).toBe(false);
  });
});

describe("resumeOutcome — Enter 가 그 줄에서 하는 일", () => {
  it("열린 타일 → 그 타일로 · 폴더 없음 → 아무것도 · 밖에서 열림 → 한 번 묻고 두 번째에 재개 · 보통 → 재개", () => {
    expect(resumeOutcome("open", false)).toBe("focus");
    expect(resumeOutcome("missing", false)).toBe("none");
    expect(resumeOutcome("elsewhere", false)).toBe("confirm");
    expect(resumeOutcome("elsewhere", true)).toBe("resume");
    expect(resumeOutcome("ok", false)).toBe("resume");
  });
});


// 타입만 쓰는 import 가 사라지지 않게 (컨텍스트 모양이 바뀌면 여기서 먼저 걸린다)
const _shape: FolderContext = { folder: null, source: "none", registered: false, project: null };
void _shape;
