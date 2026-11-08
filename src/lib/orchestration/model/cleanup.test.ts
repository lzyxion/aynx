import { describe, expect, it } from "vitest";
import { buildRows, type CommitGraph, type GraphBranch, type GraphCommit, type GraphWorktree } from "$lib/branch-graph";
import { translate } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import {
  albumBranches,
  albumGraph,
  albumRowPicked,
  CLEANUP_REF_KEY,
  cleanupCount,
  cleanupFootText,
  cleanupGroups,
  cleanupRefShort,
  CLEANUP_REF_TIP,
  cleanupFirstTab,
  cleanupWorktreeChip,
  keyText,
  pickedScope,
  type CleanupRefRow,
  type CleanupWorktreeRow,
} from "$lib/orchestration/model";

const tr = (key: Key, params?: Record<string, string | number>) => translate("ko", key, params);
const trEn = (key: Key, params?: Record<string, string | number>) => translate("en", key, params);

const wt = (path: string, o: Partial<CleanupWorktreeRow> = {}): CleanupWorktreeRow => ({
  path,
  attemptId: "a",
  taskId: "t",
  taskTitle: `제목-${path}`,
  taskState: "accepted",
  branch: `b-${path}`,
  exists: true,
  inUse: false,
  dirty: false,
  integrated: false,
  eligible: true,
  defaultChecked: false,
  ...o,
});

const ref = (kind: string, o: Partial<CleanupRefRow> = {}): CleanupRefRow => ({
  name: `refs/aynx/orch/r16/${kind}`,
  kind,
  oid: "1234567890",
  eligible: true,
  defaultChecked: false,
  ...o,
});

describe("작업 폴더 묶음", () => {
  it("차례 고정 · 없는 묶음은 없다", () => {
    const groups = cleanupGroups([
      wt("blocked", { eligible: false, blocker: "dirty" }),
      wt("review"),
      wt("safe", { integrated: true, defaultChecked: true }),
    ]);
    expect(groups.map((g) => [g.id, g.rows.map((w) => w.path)])).toEqual([
      ["safe", ["safe"]],
      ["review", ["review"]],
      ["blocked", ["blocked"]],
    ]);
    expect(cleanupGroups([wt("x")]).map((g) => g.id)).toEqual(["review"]);
    expect(cleanupGroups([])).toEqual([]);
  });

  it("칩 — 지울 수 없으면 까닭, 아니면 묶음이 아니라 integrated 값", () => {
    expect(cleanupWorktreeChip(wt("a", { integrated: true, defaultChecked: true }), tr)).toEqual({ text: "통합됨", tone: "ok" });
    expect(cleanupWorktreeChip(wt("a"), tr)).toEqual({ text: "통합 안 됨", tone: "line" });
    // 서버가 지금은 내지 않는 조합 — 묶음은 '확인하고 고르기' 여도 칩은 사실을 따른다
    expect(cleanupWorktreeChip(wt("a", { integrated: true, defaultChecked: false }), tr).text).toBe("통합됨");
    expect(cleanupWorktreeChip(wt("a", { eligible: false, blocker: "dirty", integrated: true }), tr)).toEqual({ text: "커밋 안 한 변경 있음", tone: "warn" });
    expect(cleanupWorktreeChip(wt("a", { eligible: false, blocker: "dirty" }), trEn).text).toBe("uncommitted changes");
  });
});

describe("복구용 기록", () => {
  it("서버의 ref 종류 전부에 쉬운 이름 · 모르는 종류는 날 낱말", () => {
    for (const kind of ["int", "done", "accepted", "diverged", "candidate", "conflict"]) {
      for (const t of [tr, trEn]) expect(keyText(CLEANUP_REF_KEY, kind, t)).not.toBe(kind);
    }
    expect(keyText(CLEANUP_REF_KEY, "int", tr)).toBe("통합 기록");
    expect(keyText(CLEANUP_REF_KEY, "새종류", tr)).toBe("새종류");
  });

  it("원래 이름은 앞 뿌리를 뗀 것", () => {
    expect(cleanupRefShort("refs/aynx/orch/r16/int")).toBe("int");
    expect(cleanupRefShort("refs/aynx/orch/r16/done/task-1")).toBe("done/task-1");
  });

  it("쉬운 이름이 있는 기록은 모두 말풍선도 있다", () => {
    expect(Object.keys(CLEANUP_REF_TIP).sort()).toEqual(Object.keys(CLEANUP_REF_KEY).sort());
  });

  it("처음 탭은 작업 폴더 · 작업 폴더 없이 기록만 남았으면 복구용 기록", () => {
    expect(cleanupFirstTab({ worktrees: [{} as never], refs: [ref("int")] })).toBe("worktrees");
    expect(cleanupFirstTab({ worktrees: [], refs: [ref("int")] })).toBe("refs");
    expect(cleanupFirstTab({ worktrees: [], refs: [] })).toBe("worktrees");
  });
});

describe("바닥 문장 · 개수", () => {
  const foot = (worktrees: string[], refs: string[], branches = false) => cleanupFootText({ worktrees, refs, branches }, tr);

  it("지금 고른 것을 그대로", () => {
    expect(foot([], [])).toBe("고른 것이 없습니다");
    expect(foot(["a"], [])).toBe("작업 폴더 1개를 지웁니다");
    expect(foot(["a", "b"], ["r"])).toBe("작업 폴더 2개를 지웁니다 · 복구용 기록 1개");
    expect(foot(["a"], ["r", "s"], true)).toBe("작업 폴더 1개를 지웁니다 · 복구용 기록 2개 · 브랜치 포함");
    expect(foot([], ["r"])).toBe("복구용 기록 1개를 지웁니다");
  });

  it("브랜치는 작업 폴더를 지울 때만 함께 지워진다", () => {
    expect(foot([], [], true)).toBe("고른 것이 없습니다");
    expect(foot([], ["r"], true)).toBe("복구용 기록 1개를 지웁니다");
  });

  it("n = 작업 폴더 + 복구용 기록", () => {
    expect(cleanupCount({ worktrees: ["a", "b"], refs: ["r"] })).toBe(3);
    expect(cleanupCount({ worktrees: [], refs: [] })).toBe(0);
    expect(tr("orch.cleanup.ok", { n: 3 })).toBe("3개 지우기");
    expect(trEn("orch.cleanup.ok", { n: 3 })).toBe("Delete 3");
  });
});

// ---------------------------------------------------------------------------
// 앨범 그래프
// ---------------------------------------------------------------------------

const c = (hash: string, parents: string[] = ["p"]): GraphCommit => ({ hash, parents, subject: `s-${hash}`, time: 1, added: 1, deleted: 0 });
const br = (name: string, commits: string[], base: string | null): GraphBranch => ({
  name,
  head: commits[0] ?? "",
  base,
  ahead: commits.length,
  behind: 0,
  commits,
  commitsTruncated: false,
  merged: false,
  mergedKind: null,
  createdFrom: null,
  createdAt: null,
});
const gw = (path: string, branch: string | null, o: Partial<GraphWorktree> = {}): GraphWorktree => ({ path, branch, head: null, primary: false, dirty: null, ...o });

/**
 * main 줄 m7(위) … m1(아래). 앨범 브랜치 = orch-a(m5 에서) · 합쳐진 orch-int(m3 병합 · m2 에서) · 커밋 안 한 것이 있는 orch-b(m6 위 · 앞선 커밋 없음).
 * 다른 브랜치 = other(m7 에서) · 다른 병합(m4) · 다른 워크트리(더러움).
 */
function sample(): CommitGraph {
  const list = [c("m7"), c("m6"), c("m5"), c("m4", ["m3", "o2"]), c("m3", ["m2", "i2"]), c("m2"), c("m1"), c("a2", ["a1"]), c("a1", ["m5"]), c("x1", ["m7"]), c("i2", ["i1"]), c("i1", ["m2"]), c("o2")];
  return {
    main: "main",
    mainHead: "m7",
    mainLine: ["m7", "m6", "m5", "m4", "m3", "m2", "m1"].map((hash) => ({ hash, skippedBefore: 0 })),
    mainMore: true,
    commits: new Map(list.map((x) => [x.hash, x])),
    branches: [br("orch-a", ["a2", "a1"], "m5"), br("other", ["x1"], "m7"), br("orch-b", [], "m6")],
    folds: [
      { merge: "m4", name: "other-merged", commits: ["o2"], commitsTruncated: false, base: "m3", kind: "merge" },
      { merge: "m3", name: "orch-int", commits: ["i2", "i1"], commitsTruncated: false, base: "m2", kind: "merge" },
    ],
    worktrees: [
      gw("C:/repo", "main", { primary: true, head: "m7", dirty: { files: 3, added: 1, deleted: 1 } }),
      gw("C:/repo-wt/a", "orch-a", { head: "a2" }),
      gw("C:/repo-wt/b", "orch-b", { head: "m6", dirty: { files: 1, added: 1, deleted: 0 } }),
      gw("C:/repo-wt/o", "other", { head: "x1", dirty: { files: 1, added: 1, deleted: 0 } }),
    ],
    truncated: false,
  };
}

const scope = { branches: ["orch-a", "orch-b", "orch-int"], worktrees: ["C:\\repo-wt\\a", "C:\\repo-wt\\b"] };

describe("albumGraph — 이 앨범의 브랜치만", () => {
  it("이 앨범의 브랜치 = 내보낸 브랜치 + 작업 폴더의 브랜치(중복 · 빈 값 없이)", () => {
    expect(albumBranches({ exportBranch: "int", worktrees: [wt("a", { branch: "x" }), wt("b", { branch: "x" }), wt("c", { branch: null })] })).toEqual(["int", "x"]);
    expect(albumBranches({ exportBranch: null, worktrees: [] })).toEqual([]);
  });

  it("다른 브랜치 · 접힘 · 워크트리는 빠지고 주 폴더는 커밋 안 한 줄 없이 남는다", () => {
    const g = albumGraph(sample(), scope);
    expect(g.branches.map((b) => b.name)).toEqual(["orch-a", "orch-b"]);
    expect(g.folds.map((f) => f.name)).toEqual(["orch-int"]);
    expect(g.worktrees.map((w) => w.path)).toEqual(["C:/repo", "C:/repo-wt/a", "C:/repo-wt/b"]);
    expect(g.worktrees[0].dirty).toBeNull();
    expect(g.mainMore).toBe(false);
  });

  it("main 줄 = 앨범이 닿는 줄 + 사이는 건너뜀 · 원본을 바꾸지 않는다", () => {
    const src = sample();
    const g = albumGraph(src, scope);
    // m7 맨 위 · m6 orch-b 의 HEAD · m5 orch-a 갈라짐 · m3 병합 · m2 그 갈라짐. m4 건너뜀 · m1 아래는 그리지 않음.
    expect(g.mainLine).toEqual([
      { hash: "m7", skippedBefore: 0 },
      { hash: "m6", skippedBefore: 0 },
      { hash: "m5", skippedBefore: 0 },
      { hash: "m3", skippedBefore: 1 },
      { hash: "m2", skippedBefore: 0 },
    ]);
    expect(src.mainLine).toHaveLength(7);
  });

  it("이미 건너뛴 수는 합친다", () => {
    const src = sample();
    src.mainLine = [
      { hash: "m7", skippedBefore: 0 },
      { hash: "m6", skippedBefore: 2 },
      { hash: "m5", skippedBefore: 3 },
    ];
    src.branches = [br("orch-a", ["a2", "a1"], "m5")];
    src.folds = [];
    src.worktrees = [];
    expect(albumGraph(src, { branches: ["orch-a"], worktrees: [] }).mainLine).toEqual([
      { hash: "m7", skippedBefore: 0 },
      { hash: "m5", skippedBefore: 6 },
    ]);
  });

  it("줄을 그리면 앨범 것만 · main 줄기가 끊기지 않는다", () => {
    const rows = buildRows(albumGraph(sample(), scope), new Set());
    expect(rows.map((r) => r.key)).toEqual([
      "m:m7",
      "w:C:/repo-wt/b",
      "m:m6",
      "c:b:orch-a:a2",
      "c:b:orch-a:a1",
      "m:m5",
      "s:3",
      "m:m3",
      "f:m3",
      "m:m2",
    ]);
    const last = rows.length - 1;
    rows.forEach((r, i) => {
      if (i > 0) expect(r.links.trunkUp, `${r.key} 위`).toBeTruthy();
      if (i < last) expect(r.links.trunkDown, `${r.key} 아래`).toBeTruthy();
    });
    // 접힘 곡선은 허공에서 끝나지 않는다 — 바로 아래에 main 줄
    expect(rows[rows.findIndex((r) => r.kind === "fold") + 1].kind).toBe("main");
  });

  it("접힘의 갈라진 곳이 main 줄 위에 없으면 바로 아래 줄을 남긴다", () => {
    const src = sample();
    src.folds = [{ merge: "m3", name: "orch-int", commits: ["i2"], commitsTruncated: false, base: "저 아래", kind: "merge" }];
    const g = albumGraph(src, { branches: ["orch-int"], worktrees: [] });
    expect(g.mainLine.map((r) => r.hash)).toEqual(["m7", "m3", "m2"]);
  });

  it("앨범 브랜치가 재료에 없으면 브랜치 줄기가 없다(이미 정리된 앨범 — 창이 안내로 바꾼다)", () => {
    const rows = buildRows(albumGraph(sample(), { branches: ["orch-gone"], worktrees: [] }), new Set());
    expect(rows.map((r) => r.key)).toEqual(["m:m7"]);
    expect(rows.some((r) => r.lane === 1)).toBe(false);
  });
});

describe("고른 작업 폴더 표시", () => {
  const rows = buildRows(albumGraph(sample(), scope), new Set());
  const row = (key: string) => {
    const r = rows.find((x) => x.key === key);
    if (!r) throw new Error(key);
    return r;
  };
  const list = [wt("C:\\repo-wt\\a", { branch: "orch-a" }), wt("C:\\repo-wt\\b", { branch: "orch-b" }), wt("C:\\repo-wt\\d", { branch: null })];

  it("고른 브랜치의 줄만 — 끄면 되돌아간다", () => {
    const on = pickedScope(list, ["C:\\repo-wt\\a"]);
    expect(albumRowPicked(row("c:b:orch-a:a2"), on)).toBe(true);
    expect(albumRowPicked(row("c:b:orch-a:a1"), on)).toBe(true);
    expect(albumRowPicked(row("w:C:/repo-wt/b"), on)).toBe(false);
    const off = pickedScope(list, []);
    expect(albumRowPicked(row("c:b:orch-a:a2"), off)).toBe(false);
  });

  it("커밋 안 한 줄은 경로로도 맞는다 · main 줄 · 내보낸 브랜치는 아니다", () => {
    const on = pickedScope(list, ["C:\\repo-wt\\b", "C:\\repo-wt\\a"]);
    expect(albumRowPicked(row("w:C:/repo-wt/b"), { branches: new Set(), paths: on.paths })).toBe(true);
    expect(albumRowPicked(row("m:m7"), on)).toBe(false);
    expect(albumRowPicked(row("f:m3"), on)).toBe(false);
  });

  it("합쳐진 브랜치(접힘 줄)도 고르면 표시 · 브랜치 없는 작업 폴더는 경로만", () => {
    expect(albumRowPicked(row("f:m3"), { branches: new Set(["orch-int"]), paths: [] })).toBe(true);
    const on = pickedScope(list, ["C:\\repo-wt\\d"]);
    expect(on.branches.size).toBe(0);
    expect(on.paths).toEqual(["C:\\repo-wt\\d"]);
  });
});

describe("커밋이 없는 트랙 브랜치도 그래프에 한 줄(2026-11-07 실기 — 통합된 앨범에서 점선이 보이지 않았다)", () => {
  const base = (): CommitGraph => ({
    main: "main",
    mainHead: "m1",
    mainLine: [{ hash: "m1", skippedBefore: 0 }],
    mainMore: false,
    commits: new Map([["m1", { hash: "m1", parents: [], subject: "init", time: 1, added: null, deleted: null }]]),
    branches: [
      { name: "orch-t", head: "h1", base: "m1", ahead: 0, behind: 0, commits: [], commitsTruncated: false, merged: true, mergedKind: null, createdFrom: null, createdAt: null } as CommitGraph["branches"][number],
      { name: "orch-new", head: "h2", base: "m1", ahead: 0, behind: 0, commits: [], commitsTruncated: false, merged: false, mergedKind: null, createdFrom: null, createdAt: null } as CommitGraph["branches"][number],
    ],
    folds: [],
    worktrees: [],
    truncated: false,
  });
  const labels = { merged: "통합됨", empty: "커밋 없음" };

  it("통합된 브랜치 · 커밋 없는 브랜치 모두 머리 줄이 서고 글은 labels", () => {
    const g = albumGraph(base(), { branches: ["orch-t", "orch-new"], worktrees: [], labels });
    const rows = buildRows(g, new Set());
    const picked = rows.filter((r) => r.lane === 1).map((r) => r.branch);
    expect(picked.sort()).toEqual(["orch-new", "orch-t"]);
    expect(g.commits.get("h1")?.subject).toBe("통합됨");
    expect(g.commits.get("h2")?.subject).toBe("커밋 없음");
    const row = rows.find((r) => r.branch === "orch-t")!;
    expect(albumRowPicked(row, { branches: new Set(["orch-t"]), paths: [] })).toBe(true);
  });

  it("재료에 그 커밋이 있으면 진짜 제목을 쓴다 · 입력을 고치지 않는다", () => {
    const src = base();
    src.commits.set("h1", { hash: "h1", parents: [], subject: "진짜 제목", time: 2, added: 1, deleted: 0 });
    const g = albumGraph(src, { branches: ["orch-t"], worktrees: [], labels });
    expect(g.commits.get("h1")?.subject).toBe("진짜 제목");
    expect(src.branches[0].commits).toEqual([]);
    expect(src.commits.has("h2")).toBe(false);
  });

  it("같은 이름의 접힘이 있으면 줄을 더하지 않는다", () => {
    const src = base();
    src.folds = [{ merge: "m1", name: "orch-t", kind: "squash", base: "m1", commits: ["x"] } as CommitGraph["folds"][number]];
    const g = albumGraph(src, { branches: ["orch-t"], worktrees: [], labels });
    expect(g.branches[0].commits).toEqual([]);
  });
});
