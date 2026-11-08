import { describe, expect, it } from "vitest";
import {
  buildRows,
  commitsTotal,
  filesTotal,
  folderTail,
  joinWorktreeFile,
  MAIN_LIMIT,
  nextMainLimit,
  parseCommitFiles,
  parseCommitGraph,
  parseWipFiles,
  pickRow,
  revealScrollTop,
  rowCommit,
  rowIsMerge,
  rowMessage,
  type CommitGraph,
  type GraphBranch,
  type GraphCommit,
  type GraphRow,
} from "$lib/branch-graph";

const c = (hash: string, time: number, parents: string[] = ["p"], added = 1, deleted = 0): GraphCommit => ({
  hash,
  parents,
  subject: `s-${hash}`,
  time,
  added: parents.length >= 2 ? null : added,
  deleted: parents.length >= 2 ? null : deleted,
});

const br = (name: string, commits: string[], base: string | null, o: Partial<GraphBranch> = {}): GraphBranch => ({
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
  ...o,
});

describe("줄 가운데 글 — rowMessage", () => {
  const tr = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;
  const rowOf = (key: string) => {
    const r = buildRows(sample(), new Set()).find((x) => x.key === key);
    if (!r) throw new Error(key);
    return r;
  };

  it("커밋 줄은 제목 · 병합 커밋만 빈 점", () => {
    expect(rowMessage(sample(), rowOf("m:m6"), tr)).toBe("s-m6");
    expect(rowIsMerge(sample(), rowOf("m:m6"))).toBe(false);
    expect(rowIsMerge(sample(), rowOf("m:m5"))).toBe(true);
    expect(rowCommit(null, rowOf("m:m6"))).toBeNull();
  });

  it("접힘 줄은 수와 갈라진 곳", () => {
    expect(rowMessage(sample(), rowOf("f:m5"), tr)).toBe(`app.branches.row.fold{"n":2,"base":"m3"}`);
  });
});

/**
 * 목업의 "병합 전" 모양 — main 줄 m6 · m5(feat-design-k 병합) · m4 · m3. fix-token(3, m4 에서) · feat-shell-picker(2, m4 에서)
 * · spike-cache(2, m3 에서). dolphin(fix-token)에 커밋 안 한 것.
 */
function sample(): CommitGraph {
  const list = [
    c("m6", 600),
    c("m5", 500, ["m4", "dk2"]),
    c("m4", 400),
    c("m3", 300),
    c("fix3", 590, ["fix2"], 40, 12),
    c("fix2", 580, ["fix1"], 30, 5),
    c("fix1", 570),
    c("sp2", 560),
    c("sp1", 550),
    c("sc2", 450),
    c("sc1", 440),
    c("dk2", 420, ["dk1"], 26, 9),
    c("dk1", 410, ["m3"], 31, 7),
  ];
  return {
    main: "main",
    mainHead: "m6",
    mainLine: ["m6", "m5", "m4", "m3"].map((hash) => ({ hash, skippedBefore: 0 })),
    mainMore: false,
    commits: new Map(list.map((x) => [x.hash, x])),
    branches: [
      br("feat-shell-picker", ["sp2", "sp1"], "m4"),
      br("fix-token", ["fix3", "fix2", "fix1"], "m4"),
      br("spike-cache", ["sc2", "sc1"], "m3"),
    ],
    folds: [{ merge: "m5", name: "feat-design-k", commits: ["dk2", "dk1"], commitsTruncated: false, base: "m3", kind: "merge" }],
    worktrees: [
      { path: "/r", branch: "main", head: "m6", primary: true, dirty: null },
      { path: "/wt/dolphin", branch: "fix-token", head: "fix3", primary: false, dirty: { files: 1, added: 9, deleted: 3 } },
      { path: "/wt/otter", branch: "feat-shell-picker", head: "sp2", primary: false, dirty: null },
    ],
    truncated: false,
  };
}

const keys = (rows: GraphRow[]) => rows.map((r) => r.key);
const row = (rows: GraphRow[], key: string) => {
  const r = rows.find((x) => x.key === key);
  if (!r) throw new Error(`no row ${key}: ${keys(rows).join(",")}`);
  return r;
};

describe("buildRows — 줄 차례", () => {
  it("main 줄 · 그 base 바로 위의 덩어리 · 병합 커밋 바로 아래 접힘 · ✎ 줄은 덩어리 맨 위", () => {
    expect(keys(buildRows(sample(), new Set()))).toEqual([
      "m:m6",
      "m:m5",
      "f:m5",
      "w:/wt/dolphin",
      "c:b:fix-token:fix3",
      "c:b:fix-token:fix2",
      "c:b:fix-token:fix1",
      "c:b:feat-shell-picker:sp2",
      "c:b:feat-shell-picker:sp1",
      "m:m4",
      "c:b:spike-cache:sc2",
      "c:b:spike-cache:sc1",
      "m:m3",
    ]);
  });

  it("같은 base 는 끝 커밋이 최신인 덩어리가 위", () => {
    const g = sample();
    g.commits.set("sp2", c("sp2", 999));
    const order = keys(buildRows(g, new Set())).filter((k) => k.startsWith("c:b:fix") || k.startsWith("c:b:feat"));
    expect(order[0]).toBe("c:b:feat-shell-picker:sp2");
  });

  it("base 가 main 줄에 없으면 맨 아래 — 갈라짐 곡선은 없다", () => {
    const g = sample();
    g.branches.push(br("ancient", ["an1"], "zzz"));
    g.commits.set("an1", c("an1", 100));
    const rows = buildRows(g, new Set());
    expect(rows.at(-1)?.key).toBe("c:b:ancient:an1");
    expect(rows.at(-1)?.links.forkOut).toBeNull();
    expect(rows.at(-1)?.links.trunkUp).toBeNull();
    // 커밋이 빈 브랜치는 덩어리가 없다
    g.branches.push(br("fresh", [], "m6", { ahead: 0 }));
    expect(keys(buildRows(g, new Set())).some((k) => k.includes("fresh"))).toBe(false);
  });

  it("건너뛴 커밋 — 그 main 줄 앞(덩어리보다 위)에 ⋯ 줄, 줄기만 이어진다", () => {
    const g = sample();
    g.mainLine[3] = { hash: "m3", skippedBefore: 4 };
    const rows = buildRows(g, new Set());
    const i = keys(rows).indexOf("s:3");
    expect(keys(rows).slice(i, i + 4)).toEqual(["s:3", "c:b:spike-cache:sc2", "c:b:spike-cache:sc1", "m:m3"]);
    expect(row(rows, "s:3")).toMatchObject({ kind: "skip", n: 4, lane: 0 });
    expect(row(rows, "s:3").links).toMatchObject({ trunkUp: "solid", trunkDown: "solid" });
  });

  it("접힘을 펴면 그 자리에 덩어리 — 첫 줄은 ▾ 이름(병합됨), 끝 줄은 갈라진 곳", () => {
    const rows = buildRows(sample(), new Set(["m5"]));
    expect(keys(rows).slice(1, 4)).toEqual(["m:m5", "c:f:m5:dk2", "c:f:m5:dk1"]);
    expect(row(rows, "c:f:m5:dk2").label).toEqual({ kind: "head", name: "feat-design-k", worktree: null, primary: false, merged: true });
    expect(row(rows, "c:f:m5:dk1").label).toEqual({ kind: "fork", base: "m3" });
    expect(row(rows, "c:f:m5:dk2").links.mergeIn).toBe(true);
    expect(row(rows, "c:f:m5:dk1").links.forkOut).toBe("solid");
    expect(row(rows, "c:f:m5:dk2").links.laneDown).toBe("solid");
  });
});

describe("buildRows — 이름 칸 · 색 막대 · 연결선", () => {
  it("덩어리 첫 줄 = 이름 · 워크트리, 마지막 줄 = 갈라진 곳, main 은 맨 위 줄에만", () => {
    const rows = buildRows(sample(), new Set());
    expect(row(rows, "m:m6").label).toEqual({ kind: "main", name: "main" });
    expect(row(rows, "m:m5").label).toBeNull();
    expect(row(rows, "w:/wt/dolphin")).toMatchObject({
      kind: "wip",
      lane: 1,
      first: true,
      last: false,
      label: { kind: "head", name: "fix-token", worktree: "/wt/dolphin" },
    });
    expect(row(rows, "c:b:fix-token:fix3").label).toBeNull();
    expect(row(rows, "c:b:fix-token:fix1")).toMatchObject({ last: true, label: { kind: "fork", base: "m4" } });
    expect(row(rows, "c:b:feat-shell-picker:sp2").label).toMatchObject({ kind: "head", name: "feat-shell-picker", worktree: "/wt/otter" });
    expect(row(rows, "c:b:spike-cache:sc2").label).toMatchObject({ kind: "head", worktree: null });
    expect(row(rows, "f:m5")).toMatchObject({ kind: "fold", n: 2, first: true, last: true, label: { kind: "fold", name: "feat-design-k" } });
  });

  it("main 줄기는 첫~마지막 main 줄 사이에서 이어지고, 브랜치 줄기는 덩어리끼리 끊긴다", () => {
    const rows = buildRows(sample(), new Set());
    expect(row(rows, "m:m6").links).toMatchObject({ trunkUp: null, trunkDown: "solid" });
    expect(row(rows, "m:m3").links).toMatchObject({ trunkUp: "solid", trunkDown: null });
    expect(row(rows, "c:b:fix-token:fix2").links).toMatchObject({ trunkUp: "solid", trunkDown: "solid", laneUp: "solid", laneDown: "solid" });
    // ✎ 줄에 닿는 선은 점선
    expect(row(rows, "w:/wt/dolphin").links.laneDown).toBe("dash");
    expect(row(rows, "c:b:fix-token:fix3").links.laneUp).toBe("dash");
    // 덩어리 끝 → 갈라짐, 다음 덩어리 첫 줄은 위로 잇지 않는다
    expect(row(rows, "c:b:fix-token:fix1").links).toMatchObject({ forkOut: "solid", laneDown: null });
    expect(row(rows, "c:b:feat-shell-picker:sp2").links.laneUp).toBeNull();
    // 접힌 줄 — 병합으로 들어오고 갈라짐으로 나간다
    expect(row(rows, "f:m5").links).toMatchObject({ mergeIn: true, forkOut: "solid" });
  });

  it("main 맨 위 줄에 걸린 덩어리 — 줄기가 그 덩어리 아래부터 시작한다", () => {
    const g = sample();
    g.branches.push(br("tip", ["t1"], "m6"));
    g.commits.set("t1", c("t1", 700));
    const rows = buildRows(g, new Set());
    expect(keys(rows).slice(0, 2)).toEqual(["c:b:tip:t1", "m:m6"]);
    expect(row(rows, "c:b:tip:t1").links).toMatchObject({ forkOut: "solid", trunkUp: null, trunkDown: null });
    expect(row(rows, "m:m6").links.trunkUp).toBe("solid");
  });

  it("톤 — 줄 차례에서 처음 나오는 순서로 돌려 쓰고(이웃 덩어리는 다른 색) main 은 0 · 펴도 그대로", () => {
    const g = sample();
    const rows = buildRows(g, new Set());
    expect(row(rows, "m:m4").tone).toBe(0);
    const firstSeen: string[] = [];
    for (const r of rows) if (r.tone !== 0 && r.branch && !firstSeen.includes(r.branch)) firstSeen.push(r.branch);
    firstSeen.forEach((name, i) => {
      for (const r of rows.filter((x) => x.branch === name && x.tone !== 0)) expect(r.tone).toBe((i % 8) + 1);
    });
    // 같은 브랜치의 ✎ 줄과 덩어리는 한 색
    expect(row(rows, "w:/wt/dolphin").tone).toBe(row(rows, "c:b:fix-token:fix1").tone);
    // 위아래로 이웃한 서로 다른 브랜치 줄은 다른 색
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.tone && b.tone && a.branch !== b.branch) expect(a.tone).not.toBe(b.tone);
    }
    // 펴도 색이 바뀌지 않는다
    const fold = g.folds[0];
    const opened = buildRows(g, new Set([fold.merge]));
    const tonesOf = (rs: typeof rows) => Object.fromEntries(rs.filter((r) => r.branch).map((r) => [r.branch, r.tone]));
    expect(tonesOf(opened)).toEqual(tonesOf(rows));
  });
});

describe("buildRows — squash · rebase 병합 (2026-10-05)", () => {
  it("맞은 main 커밋(squash 커밋) 바로 아래 접힘 · 덩어리는 없다 · ✎ 줄은 접힘 줄 위 · 펼치면 그 자리에 덩어리", () => {
    const g = sample();
    // fix-token 이 squash 로 m6 에 들어갔다 — 백엔드는 브랜치 덩어리를 비우고 m6 아래 접힘을 싣는다.
    g.branches = g.branches.map((b) => (b.name === "fix-token" ? { ...b, commits: [], merged: true, mergedKind: "squash" as const } : b));
    g.folds.push({ merge: "m6", name: "fix-token", commits: ["fix3", "fix2", "fix1"], commitsTruncated: false, base: "m4", kind: "squash" });
    const rows = buildRows(g, new Set());
    expect(keys(rows)).toEqual([
      "m:m6",
      "w:/wt/dolphin",
      "f:m6",
      "m:m5",
      "f:m5",
      "c:b:feat-shell-picker:sp2",
      "c:b:feat-shell-picker:sp1",
      "m:m4",
      "c:b:spike-cache:sc2",
      "c:b:spike-cache:sc1",
      "m:m3",
    ]);
    expect(row(rows, "f:m6")).toMatchObject({ kind: "fold", lane: 1, n: 3, branch: "fix-token", label: { kind: "fold", name: "fix-token" } });
    expect(row(rows, "f:m6").links.laneUp).toBe("dash");
    expect(row(rows, "w:/wt/dolphin").links.laneDown).toBe("dash");
    const open = buildRows(g, new Set(["m6"]));
    expect(keys(open).slice(0, 6)).toEqual(["m:m6", "w:/wt/dolphin", "c:f:m6:fix3", "c:f:m6:fix2", "c:f:m6:fix1", "m:m5"]);
    expect(row(open, "c:f:m6:fix3").label).toEqual({ kind: "head", name: "fix-token", worktree: "/wt/dolphin", primary: false, merged: true });
    expect(row(open, "c:f:m6:fix1").label).toEqual({ kind: "fork", base: "m4" });
  });
});

describe("buildRows — ✎ 줄 세 경우", () => {
  it("병합된 브랜치(덩어리 없음) — HEAD 가 접힘 안이면 접힘 줄 위, 편 뒤에는 덩어리 위, 점선으로 잇는다", () => {
    const g = sample();
    g.branches.push(br("feat-design-k", [], "dk2", { ahead: 0, merged: true }));
    g.worktrees.push({ path: "/wt/heron", branch: "feat-design-k", head: "dk2", primary: false, dirty: { files: 2, added: 3, deleted: 1 } });
    const rows = buildRows(g, new Set());
    expect(keys(rows).slice(1, 4)).toEqual(["m:m5", "w:/wt/heron", "f:m5"]);
    expect(row(rows, "w:/wt/heron")).toMatchObject({ first: true, last: true, lane: 1, label: { kind: "head", name: "feat-design-k" } });
    expect(row(rows, "w:/wt/heron").links).toMatchObject({ laneDown: "dash", forkOut: null });
    expect(row(rows, "f:m5").links.laneUp).toBe("dash");
    const open = buildRows(g, new Set(["m5"]));
    expect(keys(open).slice(1, 4)).toEqual(["m:m5", "w:/wt/heron", "c:f:m5:dk2"]);
  });

  it("갓 만든 브랜치 — HEAD 가 main 줄이면 그 줄 바로 위, 점선으로 main 줄기에 합류", () => {
    const g = sample();
    g.worktrees.push({ path: "/wt/new", branch: "chore", head: "m4", primary: false, dirty: { files: 1, added: 1, deleted: 0 } });
    const rows = buildRows(g, new Set());
    const i = keys(rows).indexOf("m:m4");
    expect(keys(rows)[i - 1]).toBe("w:/wt/new");
    expect(row(rows, "w:/wt/new").links.forkOut).toBe("dash");
  });

  it("HEAD 를 못 찾으면(분리 HEAD · 오래된 커밋) 맨 위, 잇지 않는다 · 이름은 짧은 해시", () => {
    const g = sample();
    g.worktrees.push({ path: "/wt/lost", branch: null, head: "abcdef0123456789", primary: false, dirty: { files: 1, added: 0, deleted: 0 } });
    const rows = buildRows(g, new Set());
    expect(rows[0]).toMatchObject({ key: "w:/wt/lost", label: { kind: "head", name: "abcdef0" } });
    expect(rows[0].links).toMatchObject({ forkOut: null, laneDown: null });
  });

  it("주 폴더의 ✎ 줄 — main 줄기 위(단 0), 맨 위 main 줄 바로 위에 점선", () => {
    const g = sample();
    g.worktrees[0].dirty = { files: 3, added: 5, deleted: 2 };
    const rows = buildRows(g, new Set());
    expect(rows[0]).toMatchObject({ key: "w:/r", lane: 0, tone: 0, label: { kind: "head", name: "main", primary: true } });
    expect(rows[0].links.trunkDown).toBe("dash");
    expect(row(rows, "m:m6").links.trunkUp).toBe("dash");
  });
});

describe("고르기 · 작은 도구", () => {
  it("pickRow — 전에 고른 줄 → 바라는 브랜치(첫 커밋 · 없으면 ✎ 줄) → 첫 브랜치 커밋", () => {
    const rows = buildRows(sample(), new Set());
    expect(pickRow(rows, "spike-cache", null)).toBe("c:b:spike-cache:sc2");
    expect(pickRow(rows, "fix-token", "m:m4")).toBe("m:m4");
    expect(pickRow(rows, "fix-token", "gone")).toBe("c:b:fix-token:fix3");
    expect(pickRow(rows, null, "f:m5")).toBe("c:b:fix-token:fix3"); // 접힘 줄은 고르지 않는다
    expect(pickRow([], "x", null)).toBeNull();
  });

  it("pickRow — 병합된 브랜치(덩어리 없음)는 그 접힘 줄 · 펼쳤으면 첫 커밋 (다른 브랜치로 새지 않는다)", () => {
    const rows = buildRows(sample(), new Set());
    expect(pickRow(rows, "feat-design-k", null)).toBe("f:m5");
    expect(pickRow(buildRows(sample(), new Set(["m5"])), "feat-design-k", null)).toBe("c:f:m5:dk2");
    // squash 병합 — 맞은 main 커밋 아래 접힘
    const g = sample();
    g.branches = g.branches.filter((b) => b.name !== "spike-cache");
    g.folds.push({ merge: "m4", name: "spike-cache", commits: ["sc2", "sc1"], commitsTruncated: false, base: "m3", kind: "squash" });
    expect(pickRow(buildRows(g, new Set()), "spike-cache", null)).toBe("f:m4");
    // 덩어리 · ✎ 줄이 먼저
    expect(pickRow(rows, "fix-token", null)).toBe("c:b:fix-token:fix3");
  });

  it("합계 · 더 보기 · 경로 · 스크롤", () => {
    expect(commitsTotal(sample(), ["dk2", "dk1", "m5", "nope"])).toEqual({ added: 57, deleted: 16 });
    expect(nextMainLimit(MAIN_LIMIT.initial)).toBe(62);
    expect(nextMainLimit(480)).toBe(500);
    expect(nextMainLimit(500)).toBeNull();
    expect(folderTail("C:\\src\\wt\\x\\")).toBe("x");
    expect(joinWorktreeFile("C:/src/proj-wt/feat", "src/a.ts")).toBe("C:\\src\\proj-wt\\feat\\src\\a.ts");
    expect(joinWorktreeFile("/root/api-wt/x/", "/docs/a.md")).toBe("/root/api-wt/x/docs/a.md");
    expect(
      filesTotal([
        { path: "a", oldPath: null, status: "M", added: 3, deleted: 1 },
        { path: "b", oldPath: null, status: "A", added: null, deleted: null },
      ]),
    ).toEqual({ added: 3, deleted: 1 });
    expect(revealScrollTop({ scrollTop: 0, viewH: 100, top: 34, height: 34 })).toBe(0);
    expect(revealScrollTop({ scrollTop: 0, viewH: 100, top: 170, height: 34 })).toBe(104);
    expect(revealScrollTop({ scrollTop: 200, viewH: 100, top: 68, height: 34 })).toBe(68);
  });
});

describe("파서 — 던지지 않는다", () => {
  it("그래프 답(snake_case)을 읽고 어긋난 항목은 버린다", () => {
    const g = parseCommitGraph({
      main: "main",
      main_head: "m1",
      main_line: [{ hash: "m1", skipped_before: 0 }, { hash: "m2", skipped_before: 3 }, { nope: 1 }, "junk"],
      main_more: true,
      commits: [
        { hash: "m1", parents: ["m2"], subject: "s", time: 10, added: 2, deleted: 1 },
        { hash: "m2", parents: ["a", "b", 3], subject: 4, time: 5, added: null, deleted: null },
        { hash: "", time: 1 },
        { hash: "x" },
      ],
      branches: [
        { name: "fix", head: "f1", base: "m2", ahead: 1, behind: 2, commits: ["f1", 7], commits_truncated: true, merged: false, created_from: "main", created_at: 3 },
        { name: "sq", head: "s1", base: "m2", ahead: 2, behind: 1, commits: [], merged: true, merged_kind: "squash" },
        { head: "nope" },
      ],
      folds: [
        { merge: "m1", name: null, commits: ["c1"], commits_truncated: false, base: "m2" },
        { merge: "m2", name: "sq", commits: ["s1"], commits_truncated: false, base: "m3", kind: "squash" },
        { merge: "m3", name: "x", commits: [], kind: "nope" },
        {},
      ],
      worktrees: [{ path: "/r", branch: "main", head: "m1", primary: true, dirty: null }, { path: "/w", branch: null, head: "f1", primary: false, dirty: { files: 2, added: 3, deleted: 0 } }, {}],
      truncated: true,
    });
    expect(g?.mainLine).toEqual([
      { hash: "m1", skippedBefore: 0 },
      { hash: "m2", skippedBefore: 3 },
    ]);
    expect([...(g?.commits.keys() ?? [])]).toEqual(["m1", "m2"]);
    expect(g?.commits.get("m2")).toEqual({ hash: "m2", parents: ["a", "b"], subject: "", time: 5, added: null, deleted: null });
    expect(g?.branches).toHaveLength(2);
    expect(g?.branches[0]).toMatchObject({ commits: ["f1"], commitsTruncated: true, createdFrom: "main", createdAt: 3, mergedKind: null });
    expect(g?.branches[1]).toMatchObject({ merged: true, mergedKind: "squash", commits: [] });
    expect(g?.folds).toEqual([
      { merge: "m1", name: null, commits: ["c1"], commitsTruncated: false, base: "m2", kind: "merge" },
      { merge: "m2", name: "sq", commits: ["s1"], commitsTruncated: false, base: "m3", kind: "squash" },
      { merge: "m3", name: "x", commits: [], commitsTruncated: false, base: null, kind: "merge" },
    ]);
    expect(g?.worktrees.map((w) => w.dirty)).toEqual([null, { files: 2, added: 3, deleted: 0 }]);
    expect(g?.mainMore && g.truncated).toBe(true);
    expect(parseCommitGraph(null)).toBeNull();
    expect(parseCommitGraph({ main_line: "x", commits: [] })).toBeNull();
    expect(parseCommitGraph([])).toBeNull();
  });

  it("파일 답 — 모르는 상태 글자는 버리고, 병합 커밋은 목록 없음", () => {
    const f = parseCommitFiles({
      hash: "h",
      merge: false,
      files: [
        { path: "a", old_path: null, status: "M", added: 3, deleted: 1 },
        { path: "b", old_path: "o", status: "R", added: null, deleted: null },
        { path: "c", status: "Z" },
      ],
      truncated: false,
    });
    expect(f?.files.map((x) => [x.path, x.status, x.added, x.oldPath])).toEqual([
      ["a", "M", 3, null],
      ["b", "R", null, "o"],
    ]);
    expect(parseCommitFiles({ hash: "h", merge: true, files: [{ path: "a", status: "M" }] })?.files).toEqual([]);
    expect(parseCommitFiles({ merge: true })).toBeNull();
    const w = parseWipFiles({ path: "/w", head: null, files: "nope", truncated: true });
    expect(w).toEqual({ path: "/w", head: null, files: [], truncated: true });
    expect(parseWipFiles(3)).toBeNull();
  });
});
