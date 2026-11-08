/**
 * 정리 — [정리] 창의 처음 고름 · 작업 폴더 묶음 · 쉬운 ref 이름 · 바닥 문장 · 앨범 그래프 범위 · 지울 수 없는 까닭 · 남긴 서버 임시 자리 문구.
 * 무엇을 지울 수 있고 무엇이 기본 선택인지는 서버(`orchestration/cleanup.rs`)가 정한다 — 여기는 보기만 짓는다.
 */

import type { CommitGraph, GraphRow, GraphWorktree } from "$lib/branch-graph";
import type { Key } from "$lib/i18n/keys";
import { sameFolder } from "$lib/projects";
import { keyText, type Tr } from "./text";
import type { CleanupPreview, CleanupResult, CleanupWorktreeRow, RunDetail } from "./types";

/** [정리] 결과에서 worktree 는 지웠지만 브랜치를 남긴 수(E2E 10-16 #9 — 실패와 따로 센다) */
export function keptBranchCount(r: Pick<CleanupResult, "worktrees">): number {
  return r.worktrees.filter((w) => w.branchKept != null).length;
}

/** [정리] 를 열 수 있는 상태(서버가 다시 판정한다) */
export function cleanupAvailable(d: Pick<RunDetail, "state" | "cleanable">): boolean {
  return d.cleanable ?? (d.state === "done" || d.state === "stopped" || d.state === "orphaned");
}

/** [정리] 대화의 처음 고름 — 지울 수 있고 기본 체크인 것만(통합된 Task 의 worktree · 남은 서버 임시 ref). 보존 ref · 통합 ref 는 기본 남김 */
export function cleanupDefaults(p: Pick<CleanupPreview, "worktrees" | "refs">): { worktrees: string[]; refs: string[] } {
  return {
    worktrees: p.worktrees.filter((w) => w.eligible && w.defaultChecked).map((w) => w.path),
    refs: p.refs.filter((r) => r.eligible && r.defaultChecked).map((r) => r.name),
  };
}

/** 지울 수 없는 까닭 → 문구 키 */
export const CLEANUP_BLOCKER_KEY: Record<string, Key> = {
  missing: "orch.cleanup.blocker.missing",
  "in-use": "orch.cleanup.blocker.in-use",
  dirty: "orch.cleanup.blocker.dirty",
  unreadable: "orch.cleanup.blocker.unreadable",
  "task-open": "orch.cleanup.blocker.task-open",
  "not-exported": "orch.cleanup.blocker.not-exported",
  "export-behind": "orch.cleanup.blocker.export-behind",
};

/** 작업 폴더 묶음 — 지워도 되는 것(기본 선택) · 확인하고 고르기 · 지울 수 없음 */
export type CleanupGroupId = "safe" | "review" | "blocked";

/** 작업 폴더를 묶는다 — 차례 고정 · 없는 묶음은 뺀다 */
export function cleanupGroups(rows: readonly CleanupWorktreeRow[]): { id: CleanupGroupId; rows: CleanupWorktreeRow[] }[] {
  const of = (id: CleanupGroupId) => rows.filter((w) => (!w.eligible ? "blocked" : w.defaultChecked ? "safe" : "review") === id);
  return (["safe", "review", "blocked"] as const).map((id) => ({ id, rows: of(id) })).filter((g) => g.rows.length > 0);
}

/** 작업 폴더 줄의 칩 — 지울 수 없으면 그 까닭, 아니면 `integrated` 값을 따른다(묶음이 아니라 서버 값) */
export function cleanupWorktreeChip(w: CleanupWorktreeRow, tr: Tr): { text: string; tone: "ok" | "warn" | "line" } {
  if (!w.eligible) return { text: keyText(CLEANUP_BLOCKER_KEY, w.blocker, tr), tone: "warn" };
  return w.integrated ? { text: tr("orch.cleanup.integrated"), tone: "ok" } : { text: tr("orch.cleanup.notIntegrated"), tone: "line" };
}

/** ref 종류 → 쉬운 이름(모르는 종류는 날 낱말 — `keyText`). `candidate` · `conflict` 는 서버가 쓰다 남긴 임시 ref */
export const CLEANUP_REF_KEY: Record<string, Key> = {
  int: "orch.cleanup.ref.int",
  done: "orch.cleanup.ref.done",
  accepted: "orch.cleanup.ref.accepted",
  diverged: "orch.cleanup.ref.diverged",
  candidate: "orch.cleanup.ref.candidate",
  conflict: "orch.cleanup.ref.conflict",
};

/** 복구용 기록 줄의 말풍선 — 그 기록이 무엇인가(모르는 종류는 없음) */
export const CLEANUP_REF_TIP: Record<string, Key> = {
  int: "orch.cleanup.ref.int.tip",
  done: "orch.cleanup.ref.done.tip",
  accepted: "orch.cleanup.ref.accepted.tip",
  diverged: "orch.cleanup.ref.diverged.tip",
  candidate: "orch.cleanup.ref.candidate.tip",
  conflict: "orch.cleanup.ref.conflict.tip",
};

/** ref 의 원래 이름 — 앞의 `refs/<뿌리>/orch/<run16>/` 을 뗀 것 */
export function cleanupRefShort(name: string): string {
  return name.split("/").slice(4).join("/");
}

/** 처음 보일 탭 — 작업 폴더가 없고 복구용 기록만 남았으면 그쪽 */
export function cleanupFirstTab(p: Pick<CleanupPreview, "worktrees" | "refs">): "worktrees" | "refs" {
  return p.worktrees.length === 0 && p.refs.length > 0 ? "refs" : "worktrees";
}

/** [{n}개 지우기] 의 n */
export function cleanupCount(picked: { worktrees: readonly string[]; refs: readonly string[] }): number {
  return picked.worktrees.length + picked.refs.length;
}

/** 바닥 문장 — 지금 고른 것. 브랜치는 작업 폴더를 지울 때만 함께 지워지므로 그때만 적는다 */
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

// ---------------------------------------------------------------------------
// 앨범 그래프 — 브랜치 타일과 같은 그림(`buildRows`)을 이 앨범의 브랜치만으로
// ---------------------------------------------------------------------------

/** 앨범 그래프의 주 줄 길이 — 합쳐진 앨범의 병합 커밋이 앞쪽에 없으면 접힘이 빠진다(읽은 뒤 [`albumGraph`] 가 줄인다) */
export const ALBUM_GRAPH_MAIN_LIMIT = 50;

/** 이 앨범의 브랜치 — 내보낸 브랜치 + 작업 폴더들의 브랜치 */
export function albumBranches(p: Pick<CleanupPreview, "worktrees" | "exportBranch">): string[] {
  const out = new Set<string>();
  if (p.exportBranch) out.add(p.exportBranch);
  for (const w of p.worktrees) if (w.branch) out.add(w.branch);
  return [...out];
}

/**
 * 그래프 답을 **이 앨범의 것만** 남긴 답으로 — 브랜치 · 접힘 · 워크트리를 거르고, main 줄은 이 앨범이 닿는 줄만 남겨 사이를
 * "⋯ 커밋 N개"(`skippedBefore`)로 합친다. 남기는 줄: 맨 위 · 브랜치가 갈라진 곳 · 접힘이 달린 병합 커밋과 그 갈라진 곳(없으면
 * 바로 아래 줄 — 곡선이 허공에서 끝나지 않게) · 커밋 안 한 것이 있는 작업 폴더의 HEAD. 마지막으로 남긴 줄 아래는 그리지 않는다.
 * 주 폴더는 main 줄의 표시에 쓰이니 남기되 **커밋 안 한 줄은 뺀다**(앨범의 것이 아니다).
 *
 * **커밋이 없는 브랜치에는 머리 한 줄을 세운다**: 트랙은 통합 브랜치에 스쿼시로 들어가 main 과 내용이 같아지므로 재료에서 `merged` · 커밋 0개로 온다
 * (접힘도 없다) — 그대로면 그릴 줄이 없어, 고른 작업 폴더가 어느 줄인지 보일 수 없다(2026-11-07 실기). 글은 `labels`(재료에 없는 커밋만).
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

/** 지금 고른 작업 폴더 — 그 브랜치 · 경로 (`cleanWt` = 경로 목록) */
export function pickedScope(rows: readonly CleanupWorktreeRow[], picked: readonly string[]): { branches: Set<string>; paths: string[] } {
  const chosen = rows.filter((w) => picked.includes(w.path));
  return { branches: new Set(chosen.flatMap((w) => (w.branch ? [w.branch] : []))), paths: chosen.map((w) => w.path) };
}

/** 그래프 줄이 고른 작업 폴더의 것인가 — 브랜치 줄기(단 1)만. main 줄은 절대 아니다 */
export function albumRowPicked(r: GraphRow, picked: { branches: ReadonlySet<string>; paths: readonly string[] }): boolean {
  if (r.lane !== 1) return false;
  if (r.branch !== null && picked.branches.has(r.branch)) return true;
  return r.worktree !== null && picked.paths.some((p) => sameFolder(p, r.worktree ?? ""));
}

/** 남긴 까닭 → 문구 키(모르는 것은 `changed` 로) */
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

/** 서버 임시 자리 역할 → 문구 키 */
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
