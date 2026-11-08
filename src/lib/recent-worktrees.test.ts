import { describe, expect, it } from "vitest";
import type { Project, WorktreeListing } from "$lib/projects";
import type { Tr } from "$lib/session";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import { projectDots, projectFolders, type DockAgentPane } from "$lib/dock-dots";
import {
  forgetOpen,
  launcherProjectRows,
  parseRecentOpens,
  projectOpenedAt,
  recordOpen,
  resolveRecentWorktrees,
  withRecentWorktrees,
  RECENT_OPENS_CAP,
  type RecentOpen,
} from "$lib/recent-worktrees";

const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

const LOCAL: Project = { id: "L", name: "aynx", host: null, path: "C:\\src\\proj", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };
const INFRA: Project = { id: "I", name: "infra", host: null, path: "C:\\src\\infra", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };
const REMOTE: Project = { id: "R", name: "api", host: "dev-01", path: "~/api", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };
const PROJECTS = [LOCAL, INFRA, REMOTE];
const HOME = (alias: string) => (alias.toLowerCase() === "dev-01" ? "/root" : null);
const wt = (path: string, branch: string | null) => ({ path, branch, head: null, bare: false, detached: false });
const open = (projectId: string, worktree: string | null, at: number, label: string | null = null): RecentOpen => ({
  projectId,
  worktree,
  label,
  at,
});
const NO_DOTS = { project: {}, worktree: {}, main: {} };

describe("기록 — 적기 · 읽기 · 지우기", () => {
  it("같은 자리는 늦은 하나만 · 늦은 순 · 상한", () => {
    let list: RecentOpen[] = [];
    list = recordOpen(list, open("L", "C:\\src\\proj-wt\\feat", 1, "feat"));
    list = recordOpen(list, open("L", null, 2));
    list = recordOpen(list, open("L", "c:/src/proj-wt/feat", 3, "feat")); // 같은 자리(구분자·대소문자)
    expect(list.map((e) => [e.worktree, e.at])).toEqual([
      ["c:/src/proj-wt/feat", 3],
      [null, 2],
    ]);
    for (let i = 0; i < RECENT_OPENS_CAP + 5; i++) list = recordOpen(list, open("L", `C:\\w\\${i}`, 10 + i));
    expect(list).toHaveLength(RECENT_OPENS_CAP);
    expect(list[0].worktree).toBe(`C:\\w\\${RECENT_OPENS_CAP + 4}`);
  });

  it("원격은 부르는 쪽의 열쇠(홈을 편 것)로 같은 자리를 안다", () => {
    const keyOf = (_id: string, p: string) => p.replace(/^~/, "/root");
    let list = recordOpen([], open("R", "~/api-wt/fix", 1, "fix"), keyOf);
    list = recordOpen(list, open("R", "/root/api-wt/fix", 2, "fix"), keyOf);
    expect(list).toHaveLength(1);
    expect(forgetOpen(list, "R", "~/api-wt/fix", keyOf)).toEqual([]);
  });

  it("parse 는 던지지 않고 어긋난 줄을 버린다", () => {
    expect(parseRecentOpens(null)).toEqual([]);
    expect(parseRecentOpens("{bad")).toEqual([]);
    expect(parseRecentOpens(JSON.stringify({}))).toEqual([]);
    const raw = JSON.stringify([
      { projectId: "L", worktree: "C:\\a", label: "a", at: 5 },
      { projectId: "", worktree: null, at: 1 },
      { projectId: "L", worktree: null, label: "x", at: 7 },
      { projectId: "L", at: "nope" },
    ]);
    expect(parseRecentOpens(raw)).toEqual([open("L", null, 7), open("L", "C:\\a", 5, "a")]);
  });

  it("projectOpenedAt = 주 폴더를 연 시각만", () => {
    const list = [open("L", "C:\\a", 9, "a"), open("L", null, 4)];
    expect(projectOpenedAt(list, "L")).toBe(4);
    expect(projectOpenedAt(list, "R")).toBeNull();
  });
});

describe("resolveRecentWorktrees — 버릴 것", () => {
  it("없는 프로젝트 · 주 폴더 자리 · 읽어 둔 목록에 없는 것 · 없어진 로컬 폴더 · 겹침", () => {
    const opens = [
      open("GONE", "C:\\x", 10, "x"),
      open("L", "C:/src/proj", 9, "main"), // 주 폴더 자리 = 프로젝트 줄
      open("L", "C:\\src\\proj-wt\\feat", 8, "feat"),
      open("L", "C:\\src\\proj-wt\\old", 7, "old"), // 목록에 없다(지워졌다)
      open("I", "C:\\src\\infra-wt\\gone", 6, "gone"), // 로컬 폴더 없음
      open("I", "C:\\src\\infra-wt\\ok", 5, "ok"), // 목록 없음 → 믿는다
      open("R", "~/api-wt/fix", 4, "fix"),
      open("R", "~/api", 3), // 원격 주 폴더(홈을 편 자리)
    ];
    const listings: Record<string, WorktreeListing> = {
      L: { state: "ok", list: [wt("C:/src/proj", "main"), wt("C:/src/proj-wt/feat", "feat-renamed")] },
      R: { state: "offline" },
    };
    const got = resolveRecentWorktrees(PROJECTS, opens, (id) => listings[id], HOME, (_id, p) => p.includes("gone"));
    expect(got.map((r) => [r.project.id, r.path, r.name])).toEqual([
      ["L", "C:/src/proj-wt/feat", "feat-renamed"], // 목록의 경로·브랜치를 쓴다
      ["I", "C:\\src\\infra-wt\\ok", "ok"],
      ["R", "~/api-wt/fix", "fix"], // 접속 전 원격 — 적은 그대로
    ]);
  });
});

describe("launcherProjectRows — 섞기 · 상한 · 점", () => {
  const recent = resolveRecentWorktrees(
    PROJECTS,
    [open("L", "C:\\src\\proj-wt\\feat", 50, "feat"), open("R", "~/api-wt/fix", 20, "fix")],
    () => undefined,
    HOME,
  );
  const times: Record<string, number | null> = { L: 10, I: null, R: 30 };

  it("시각 순으로 섞이고, 시각 없는 프로젝트는 뒤에 들어온 순서대로", () => {
    const rows = launcherProjectRows(PROJECTS, recent, (p) => times[p.id], NO_DOTS, [], HOME, 8);
    expect(rows.map((r) => (r.kind === "worktree" ? r.title : r.project.name))).toEqual([
      "aynx · feat",
      "api",
      "api · fix",
      "aynx",
      "infra",
    ]);
    expect(rows.filter((r) => r.kind === "worktree").map((r) => r.key)).toEqual([
      "worktree:L:c:/src/proj-wt/feat",
      "worktree:R:/root/api-wt/fix",
    ]);
  });

  it("상한까지만", () => {
    const rows = launcherProjectRows(PROJECTS, recent, (p) => times[p.id], NO_DOTS, [], HOME, 3);
    expect(rows).toHaveLength(3);
  });

  it("점 — 워크트리 줄은 그 워크트리, 프로젝트 줄은 주 폴더 자리만(접지 않는다), 점이 있는 줄이 먼저", () => {
    const listing: Record<string, WorktreeListing> = { L: { state: "ok", list: [wt("C:/src/proj", "main")] } };
    const base = projectFolders(PROJECTS, (id) => listing[id], HOME);
    const folders = withRecentWorktrees(base, recent, HOME);
    const pane = (p: Partial<DockAgentPane>): DockAgentPane => ({
      id: Math.random().toString(36),
      name: "Claude Code",
      state: "running",
      host: null,
      start: null,
      current: null,
      ...p,
    });
    const panes = [
      pane({ start: "C:\\src\\proj-wt\\feat", state: "permission" }), // 목록에 없는 최근 워크트리
      pane({ start: "C:\\src\\proj", state: "running" }), // 주 폴더 ≡ 주 워크트리
      pane({ host: "dev-01", start: "/root/api-wt/fix", state: "finished" }),
    ];
    const dots = projectDots(panes, folders, HOME, koTr);
    expect(dots.main.L?.state).toBe("running");
    expect(dots.project.L?.state).toBe("permission"); // 독의 접힌 줄은 여전히 접는다
    const rows = launcherProjectRows(PROJECTS, recent, (p) => times[p.id], dots, folders, HOME, 8);
    expect(rows.map((r) => [r.key, r.dot?.state ?? null])).toEqual([
      ["worktree:L:c:/src/proj-wt/feat", "permission"],
      ["worktree:R:/root/api-wt/fix", "finished"],
      ["project:L", "running"],
      ["project:R", null],
      ["project:I", null],
    ]);
  });
});
