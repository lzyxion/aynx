// 브랜치 삭제 상자의 순수 층 — 판정의 원본은 Rust `worktree_branch.rs` 이고 실행 때 다시 읽어 다시 가른다.

/** Rust `BranchChoices` */
export interface BranchChoices {
  deletable: string[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parseBranchChoices(raw: unknown): BranchChoices {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { deletable: strings(o.deletable) };
}

export function nothingToDelete(c: BranchChoices): boolean {
  return c.deletable.length === 0;
}
