/**
 * **브랜치 삭제 — 순수 층** (docs/log/2026-10-01-worktree-branch-ops.md · docs/log/2026-10-05-worktree-one-to-one.md).
 *
 * 독의 워크트리 우클릭 메뉴 "브랜치 삭제…" 가 여는 상자의 재료다. 판정의 원본은 Rust `worktree_branch.rs` 이고(실행 때
 * 다시 읽어 다시 가른다), 여기는 답 읽기 · 열자마자 끝나는 갈래뿐이다. 슬롯 "새 브랜치…" 는 2026-10-05 에 뺐다
 * (워크트리 = 브랜치 1:1 이 기본).
 */

/** Rust `BranchChoices` */
export interface BranchChoices {
  deletable: string[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** `*_branch_choices` 의 답을 읽는다 — 모양이 어긋난 칸은 빈 값으로 */
export function parseBranchChoices(raw: unknown): BranchChoices {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { deletable: strings(o.deletable) };
}

/** 열자마자 끝나는 갈래 — 지울 것이 없으면 상자 대신 알림 한 줄(`true`) */
export function nothingToDelete(c: BranchChoices): boolean {
  return c.deletable.length === 0;
}
