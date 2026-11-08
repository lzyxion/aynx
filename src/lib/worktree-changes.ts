/**
 * **워크트리 변경 배지** — 독 워크트리 줄의 `+84 −19 ↑2` 또는 `병합됨` (docs/log/2026-09-29-worktree-badges.md, 소스 컨트롤
 * 1단계).
 *
 * 순수 모듈이다: 백엔드 답 읽기 · 배지 조각 · 줄 수 줄여 쓰기 · 툴팁 조립 · 물을 경로 고르기. 읽는 때와 창 사본은
 * `app/worktree-changes.svelte.ts`, 세는 규칙(기준 = 주 폴더 브랜치와의 merge-base · 커밋한 줄만 · 병합됨 판정)은 Rust
 * `worktree_changes.rs` 머리말. 커밋 안 한 변경은 여기서 세지 않는다 — 브랜치 그래프의 ✎ 줄이 보여 준다.
 */
import type { WorktreeInfo } from "$lib/projects";
import type { Tr } from "$lib/session";

/** 워크트리 하나의 변경 상태 — Rust `WorktreeChanges` */
export interface WorktreeChanges {
  /** 물은 경로 그대로(워크트리 목록의 `path`) */
  path: string;
  /** 주 폴더 브랜치(main)보다 앞선 커밋 수 — 모르면 `null` */
  ahead: number | null;
  /** main 과의 merge-base 부터 `HEAD` 까지 더한 줄 수(커밋한 것만, 바이너리 제외) — 답의 `added_lines` */
  addedLines: number;
  /** main 과의 merge-base 부터 `HEAD` 까지 뺀 줄 수 — 답의 `deleted_lines` */
  deletedLines: number;
  /**
   * 커밋이 모두 main 에 들어갔다 — 조상(main 아님 · 앞선 커밋 0 · 커밋 기록이 있는 브랜치) 또는 내용 기준(squash · rebase
   * 병합, Rust `merge_detect` — 이때 `ahead` 는 N 그대로지만 배지는 숨긴다)
   */
  merged: boolean;
  /** 무엇으로 병합됐나 — `merged` 일 때만(모르는 값 · 없음은 `null`). 칩은 같고 툴팁만 다르다 */
  mergedKind: MergedKind | null;
}

/** 병합의 종류 — Rust `merge_detect::MergeKind` */
export type MergedKind = "ancestry" | "squash" | "rebase";

/** 답의 `merged_kind` → 종류(모르는 값은 `null`) */
export function mergedKindOf(v: unknown): MergedKind | null {
  return v === "ancestry" || v === "squash" || v === "rebase" ? v : null;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** 백엔드의 답 → 목록. **throw 하지 않는다** — 모양이 어긋난 줄은 버린다(줄 수 칸이 없으면 0, 병합됨 칸이 없으면 아님) */
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

/**
 * 줄 수를 배지 폭에 맞게 줄여 쓴다 — `999` · `1.2k` · `12k` · `1.2M`. 소수 한 자리는 **내림**이다(`1999` → `1.9k` —
 * 반올림하면 `999950` 이 `1000.0k` 가 된다). 10 이상의 단위는 정수만.
 */
export function compactCount(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);
  const unit = v < 1_000_000 ? { d: 1000, s: "k" } : { d: 1_000_000, s: "M" };
  const x = v / unit.d;
  const shown = x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x);
  return `${shown}${unit.s}`;
}

/**
 * 배지 조각 하나 — 기호(`+` 더한 줄 · `−` 뺀 줄 · `↑` 앞선 커밋)와 줄여 쓴 숫자. 색은 조각 종류로 CSS 가 입힌다
 * (`+` 연한 초록 · `−` 연한 빨강 · `↑` 회색 — 사용자 결정, 로그 참고).
 */
export interface ChangeBadgePart {
  kind: "plus" | "minus" | "up";
  sym: "+" | "−" | "↑";
  /** 줄여 쓴 숫자(`1.2k`) */
  n: string;
}

/**
 * 배지 조각들 — `+A` · `−D` · `↑N`. 0 인 조각은 빠지고, 모두 0(또는 모름)이면 빈 배열(배지 없음). 병합됨이면 빈 배열이다 —
 * 숫자 대신 "병합됨" 칩이 선다(`changeBadgeMerged`).
 */
export function changeBadgeParts(c: WorktreeChanges | null | undefined): ChangeBadgePart[] {
  if (!c || c.merged) return [];
  const out: ChangeBadgePart[] = [];
  if (c.addedLines > 0) out.push({ kind: "plus", sym: "+", n: compactCount(c.addedLines) });
  if (c.deletedLines > 0) out.push({ kind: "minus", sym: "−", n: compactCount(c.deletedLines) });
  if (c.ahead !== null && c.ahead > 0) out.push({ kind: "up", sym: "↑", n: compactCount(c.ahead) });
  return out;
}

/** "병합됨" 칩을 세우나 — 커밋이 모두 main 에 들어간 워크트리 */
export function changeBadgeMerged(c: WorktreeChanges | null | undefined): boolean {
  return c?.merged === true;
}

/** 배지의 표시 글자 — `+84 −19 ↑2` (배지 없으면 빈 글자) */
export function changeBadgeText(parts: readonly ChangeBadgePart[]): string {
  return parts.map((p) => `${p.sym}${p.n}`).join(" ");
}

/**
 * 배지 툴팁 — 두 줄: "main 이후 커밋: +84 −19 줄" · "main 보다 커밋 3개 앞섬". 병합됨이면 한 줄 "커밋이 모두 main 에
 * 들어갔습니다 — …". 없는 줄은 빠진다(툴팁의 줄 수는 줄여 쓰지 않는다). 모두 없으면 빈 글자.
 */
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

/**
 * 배지를 물을 워크트리 경로들 — 주 폴더(git 의 첫 덩어리 = 저장소 자신)와 bare 줄은 뺀다(검토 대상은 워크트리다).
 */
export function changePathsOf(list: readonly WorktreeInfo[]): string[] {
  return list.slice(1).filter((w) => !w.bare).map((w) => w.path);
}

/** 창 사본의 열쇠 — 프로젝트 id + 워크트리 경로 */
export function changesKey(projectId: string, path: string): string {
  return `${projectId}\n${path}`;
}
