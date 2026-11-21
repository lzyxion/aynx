/** 브랜치 그래프의 "새 변경 있음" 순번(프로젝트 id → 순번) — 열린 브랜치 타일은 마지막으로 읽은 순번보다 크면 다시 읽는다. */

const seqs = $state<Record<string, number>>({});

export function branchGraphStaleSeq(projectId: string): number {
  return seqs[projectId] ?? 0;
}

export function markBranchGraphStale(projectId: string): void {
  seqs[projectId] = (seqs[projectId] ?? 0) + 1;
}
