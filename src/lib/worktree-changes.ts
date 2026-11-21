// 워크트리 변경 배지(`+84 −19 ↑2` · `병합됨`) — 세는 규칙은 Rust `worktree_changes.rs` 머리말. 커밋 안 한 변경은 세지 않는다.
import type { WorktreeInfo } from "$lib/projects";
import type { Tr } from "$lib/session";

/** Rust `WorktreeChanges` */
export interface WorktreeChanges {
  path: string;
  ahead: number | null;
  addedLines: number;
  deletedLines: number;
  /** squash · rebase 병합이면 `ahead` 는 N 그대로지만 배지는 숨긴다 */
  merged: boolean;
  mergedKind: MergedKind | null;
}

/** Rust `merge_detect::MergeKind` */
export type MergedKind = "ancestry" | "squash" | "rebase";

export function mergedKindOf(v: unknown): MergedKind | null {
  return v === "ancestry" || v === "squash" || v === "rebase" ? v : null;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** throw 하지 않는다 — 모양이 어긋난 줄은 버린다 */
export function parseWorktreeChanges(raw: unknown): WorktreeChanges[] {
  if (!Array.isArray(raw)) return [];
  const out: WorktreeChanges[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== "string" || o.path === "") continue;
    out.push({
      path: o.path,
      ahead: typeof o.ahead === "number" && Number.isFinite(o.ahead) && o.ahead >= 0 ? Math.floor(o.ahead) : null,
      addedLines: count(o.added_lines),
      deletedLines: count(o.deleted_lines),
      merged: o.merged === true,
      mergedKind: o.merged === true ? mergedKindOf(o.merged_kind) : null,
    });
  }
  return out;
}

/** 소수 한 자리는 내림이다 — 반올림하면 `999950` 이 `1000.0k` 가 된다 */
export function compactCount(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);
  const unit = v < 1_000_000 ? { d: 1000, s: "k" } : { d: 1_000_000, s: "M" };
  const x = v / unit.d;
  const shown = x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x);
  return `${shown}${unit.s}`;
}

export interface ChangeBadgePart {
  kind: "plus" | "minus" | "up";
  sym: "+" | "−" | "↑";
  n: string;
}

export function changeBadgeParts(c: WorktreeChanges | null | undefined): ChangeBadgePart[] {
  if (!c || c.merged) return [];
  const out: ChangeBadgePart[] = [];
  if (c.addedLines > 0) out.push({ kind: "plus", sym: "+", n: compactCount(c.addedLines) });
  if (c.deletedLines > 0) out.push({ kind: "minus", sym: "−", n: compactCount(c.deletedLines) });
  if (c.ahead !== null && c.ahead > 0) out.push({ kind: "up", sym: "↑", n: compactCount(c.ahead) });
  return out;
}

export function changeBadgeMerged(c: WorktreeChanges | null | undefined): boolean {
  return c?.merged === true;
}

export function changeBadgeText(parts: readonly ChangeBadgePart[]): string {
  return parts.map((p) => `${p.sym}${p.n}`).join(" ");
}

export function changeBadgeTitle(c: WorktreeChanges | null | undefined, tr: Tr): string {
  if (!c) return "";
  if (c.merged) {
    if (c.mergedKind === "squash") return tr("app.projects.worktrees.changes.mergedTitleSquash");
    if (c.mergedKind === "rebase") return tr("app.projects.worktrees.changes.mergedTitleRebase");
    return tr("app.projects.worktrees.changes.mergedTitle");
  }
  const lines: string[] = [];
  if (c.addedLines > 0 || c.deletedLines > 0) {
    lines.push(tr("app.projects.worktrees.changes.lines", { added: c.addedLines, deleted: c.deletedLines }));
  }
  if (c.ahead !== null && c.ahead > 0) lines.push(tr("app.projects.worktrees.changes.ahead", { n: c.ahead }));
  return lines.join("\n");
}

/** git 목록의 첫 덩어리는 저장소 자신(주 폴더)이라 뺀다 */
export function changePathsOf(list: readonly WorktreeInfo[]): string[] {
  return list.slice(1).filter((w) => !w.bare).map((w) => w.path);
}

export function changesKey(projectId: string, path: string): string {
  return `${projectId}\n${path}`;
}
