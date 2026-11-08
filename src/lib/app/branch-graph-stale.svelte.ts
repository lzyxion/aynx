/**
 * **브랜치 그래프의 "새 변경 있음" 신호** — 프로젝트 id → 순번 (docs/log/2026-09-29-branch-graph.md).
 *
 * 그 프로젝트 폴더에 선 에이전트의 턴이 끝나면(훅 `stop` — 1단계 배지를 다시 읽는 같은 자리, `app/worktrees` 의
 * `refreshWorktreeChangesAfterTurn`) 순번이 하나 오른다. 열려 있는 브랜치 타일은 자기가 마지막으로 읽은 순번보다
 * 크면 **스스로 다시 읽는다** — 고른 줄은 그대로, 스크롤 자리도 건드리지 않는다(2026-11-02 사용자 — 예전엔 "새 변경 있음 ·
 * 새로 고침" 단추만 세우고 사람이 눌러야 했다).
 *
 * 잎 모듈이다 — `app/worktrees` 가 이것을 부르고, 그래프 쪽(`app/branch-graph`)은 `app/worktrees` 를 부르므로 둘 사이에
 * 두지 않으면 순환이 된다.
 */

const seqs = $state<Record<string, number>>({});

/** 그 프로젝트의 지금 순번(아직 신호가 없었으면 0) — 반응형 */
export function branchGraphStaleSeq(projectId: string): number {
  return seqs[projectId] ?? 0;
}

/** 그 프로젝트에 새 변경이 있을 수 있다 — 에이전트 턴이 끝났다 */
export function markBranchGraphStale(projectId: string): void {
  seqs[projectId] = (seqs[projectId] ?? 0) + 1;
}
