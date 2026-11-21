/** [정리] 창의 보기 — 무엇을 지울 수 있고 무엇이 기본 선택인지는 서버(`orchestration/cleanup.rs`)가 정한다. */

import type { CommitGraph, GraphRow, GraphWorktree } from "$lib/branch-graph";
import type { Key } from "$lib/i18n/keys";
import { sameFolder } from "$lib/projects";
import { keyText, type Tr } from "./text";
import type { CleanupPreview, CleanupResult, CleanupWorktreeRow, RunDetail } from "./types";

/** worktree 는 지웠지만 브랜치를 남긴 수 — 실패와 따로 센다 */
export function keptBranchCount(r: Pick<CleanupResult, "worktrees">): number {
  return r.worktrees.filter((w) => w.branchKept != null).length;
}

/** 서버가 다시 판정한다 */
export function cleanupAvailable(d: Pick<RunDetail, "state" | "cleanable">): boolean {
  return d.cleanable ?? (d.state === "done" || d.state === "stopped" || d.state === "orphaned");
}

export function cleanupDefaults(p: Pick<CleanupPreview, "worktrees" | "refs">): { worktrees: string[]; refs: string[] } {
  return {
    worktrees: p.worktrees.filter((w) => w.eligible && w.defaultChecked).map((w) => w.path),
    refs: p.refs.filter((r) => r.eligible && r.defaultChecked).map((r) => r.name),
  };
}

export const CLEANUP_BLOCKER_KEY: Record<string, Key> = {
  missing: "orch.cleanup.blocker.missing",
  "in-use": "orch.cleanup.blocker.in-use",
  dirty: "orch.cleanup.blocker.dirty",
  unreadable: "orch.cleanup.blocker.unreadable",
  "task-open": "orch.cleanup.blocker.task-open",
  "not-exported": "orch.cleanup.blocker.not-exported",
  "export-behind": "orch.cleanup.blocker.export-behind",
};

export type CleanupGroupId = "safe" | "review" | "blocked";

export function cleanupGroups(rows: readonly CleanupWorktreeRow[]): { id: CleanupGroupId; rows: CleanupWorktreeRow[] }[] {
  const of = (id: CleanupGroupId) => rows.filter((w) => (!w.eligible ? "blocked" : w.defaultChecked ? "safe" : "review") === id);
  return (["safe", "review", "blocked"] as const).map((id) => ({ id, rows: of(id) })).filter((g) => g.rows.length > 0);
}

/** 묶음이 아니라 서버의 `integrated` 값을 따른다 */
export function cleanupWorktreeChip(w: CleanupWorktreeRow, tr: Tr): { text: string; tone: "ok" | "warn" | "line" } {
  if (!w.eligible) return { text: keyText(CLEANUP_BLOCKER_KEY, w.blocker, tr), tone: "warn" };
  return w.integrated ? { text: tr("orch.cleanup.integrated"), tone: "ok" } : { text: tr("orch.cleanup.notIntegrated"), tone: "line" };
}

export const CLEANUP_REF_KEY: Record<string, Key> = {
  int: "orch.cleanup.ref.int",
  done: "orch.cleanup.ref.done",
  accepted: "orch.cleanup.ref.accepted",
  diverged: "orch.cleanup.ref.diverged",
  candidate: "orch.cleanup.ref.candidate",
  conflict: "orch.cleanup.ref.conflict",
};

export const CLEANUP_REF_TIP: Record<string, Key> = {
  int: "orch.cleanup.ref.int.tip",
  done: "orch.cleanup.ref.done.tip",
  accepted: "orch.cleanup.ref.accepted.tip",
  diverged: "orch.cleanup.ref.diverged.tip",
  candidate: "orch.cleanup.ref.candidate.tip",
  conflict: "orch.cleanup.ref.conflict.tip",
};

/** 앞의 `refs/<뿌리>/orch/<run16>/` 을 뗀다 */
export function cleanupRefShort(name: string): string {
  return name.split("/").slice(4).join("/");
}

export function cleanupFirstTab(p: Pick<CleanupPreview, "worktrees" | "refs">): "worktrees" | "refs" {
  return p.worktrees.length === 0 && p.refs.length > 0 ? "refs" : "worktrees";
}

export function cleanupCount(picked: { worktrees: readonly string[]; refs: readonly string[] }): number {
  return picked.worktrees.length + picked.refs.length;
}

/** 브랜치는 작업 폴더를 지울 때만 함께 지워지므로 그때만 적는다 */
export function cleanupFootText(picked: { worktrees: readonly string[]; refs: readonly string[]; branches: boolean }, tr: Tr): string {
  const wt = picked.worktrees.length;
  const refs = picked.refs.length;
  if (wt === 0) return refs === 0 ? tr("orch.cleanup.foot.none") : tr("orch.cleanup.foot.refsOnly", { n: refs });
  return (
    tr("orch.cleanup.foot.worktrees", { n: wt }) +
    (refs > 0 ? tr("orch.cleanup.foot.plusRefs", { n: refs }) : "") +
    (picked.branches ? tr("orch.cleanup.foot.plusBranches") : "")
  );
}

// ── 앨범 그래프 ──

/** 합쳐진 앨범의 병합 커밋이 이 안에 없으면 접힘이 빠진다 */
export const ALBUM_GRAPH_MAIN_LIMIT = 50;

export function albumBranches(p: Pick<CleanupPreview, "worktrees" | "exportBranch">): string[] {
  const out = new Set<string>();
  if (p.exportBranch) out.add(p.exportBranch);
  for (const w of p.worktrees) if (w.branch) out.add(w.branch);
  return [...out];
}

/**
 * 접힘의 갈라진 곳이 없으면 바로 아래 줄을 남긴다 — 곡선이 허공에서 끝나지 않게.
 * 커밋 없는 브랜치에는 머리 한 줄을 세운다 — 스쿼시로 들어간 트랙은 `merged` · 커밋 0개로 와서 그대로면 고른 작업 폴더의 줄이 없다.
 */
export function albumGraph(
  g: CommitGraph,
  scope: { branches: readonly string[]; worktrees: readonly string[]; labels?: { merged: string; empty: string } },
): CommitGraph {
  const names = new Set(scope.branches);
  const inScope = (w: GraphWorktree) => (w.branch !== null && names.has(w.branch)) || scope.worktrees.some((p) => sameFolder(p, w.path));
  const folds = g.folds.filter((f) => f.name !== null && names.has(f.name));
  const commits = new Map(g.commits);
  const branches = g.branches.filter((b) => names.has(b.name)).map((b) => {
    if (b.commits.length > 0 || !b.head || folds.some((f) => f.name === b.name)) return b;
    if (!commits.has(b.head)) {
      const subject = (b.merged ? scope.labels?.merged : scope.labels?.empty) ?? "";
      commits.set(b.head, { hash: b.head, parents: [], subject, time: 0, added: null, deleted: null });
    }
    return { ...b, commits: [b.head] };
  });
  const worktrees = g.worktrees.flatMap((w) => (inScope(w) ? [w] : w.primary ? [{ ...w, dirty: null }] : []));

  const line = g.mainLine.map((r) => r.hash);
  const keep = new Set<string>(line.slice(0, 1));
  for (const b of branches) if (b.base && b.commits.length > 0) keep.add(b.base);
  for (const f of folds) {
    keep.add(f.merge);
    const at = line.indexOf(f.merge);
    const below = f.base && line.includes(f.base) ? f.base : at >= 0 ? line[at + 1] : undefined;
    if (below) keep.add(below);
  }
  for (const w of worktrees) if (w.dirty && w.head) keep.add(w.head);

  const mainLine: CommitGraph["mainLine"] = [];
  let skipped = 0;
  for (const r of g.mainLine) {
    if (keep.has(r.hash)) {
      mainLine.push({ hash: r.hash, skippedBefore: skipped + r.skippedBefore });
      skipped = 0;
    } else {
      skipped += r.skippedBefore + 1;
    }
  }
  return { ...g, commits, mainLine, mainMore: false, branches, folds, worktrees };
}

export function pickedScope(rows: readonly CleanupWorktreeRow[], picked: readonly string[]): { branches: Set<string>; paths: string[] } {
  const chosen = rows.filter((w) => picked.includes(w.path));
  return { branches: new Set(chosen.flatMap((w) => (w.branch ? [w.branch] : []))), paths: chosen.map((w) => w.path) };
}

/** 브랜치 줄기(단 1)만 — main 줄은 절대 아니다 */
export function albumRowPicked(r: GraphRow, picked: { branches: ReadonlySet<string>; paths: readonly string[] }): boolean {
  if (r.lane !== 1) return false;
  if (r.branch !== null && picked.branches.has(r.branch)) return true;
  return r.worktree !== null && picked.paths.some((p) => sameFolder(p, r.worktree ?? ""));
}

export function tempWhyKey(why: string): Key {
  switch (why) {
    case "in-use":
      return "orch.temp.why.in-use";
    case "remove-failed":
      return "orch.temp.why.remove-failed";
    case "not-a-worktree":
      return "orch.temp.why.not-a-worktree";
    case "unreadable":
      return "orch.temp.why.unreadable";
    default:
      return "orch.temp.why.changed";
  }
}

export function tempRoleKey(role: string): Key {
  switch (role) {
    case "verify":
      return "orch.temp.role.verify";
    case "review":
      return "orch.temp.role.review";
    case "review-cwd":
      return "orch.temp.role.review-cwd";
    default:
      return "orch.temp.role.temp";
  }
}
