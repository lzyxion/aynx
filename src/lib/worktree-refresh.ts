/**
 * **독이 보일 때의 워크트리 다시 읽기 — 누구를 읽을까** (docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md).
 *
 * 시계는 여전히 없다(주기 폴링 금지 — docs/log/2026-09-29-worktree-badges.md). 계기는 둘뿐이다: 프로젝트 독이 **보이게
 * 될 때**, 그리고 독이 보이는 채로 **창이 다시 앞에 올 때**(셸에서 squash 병합하고 돌아온 순간). 이 모듈은 그 계기에서
 * 어느 프로젝트를 읽을지만 정한다 — 순수 함수라 표 테스트를 받는다(부르는 쪽은 `app/worktrees.svelte.ts`).
 *
 * - 펼친 프로젝트만(접힌 줄은 목록을 보이지 않는다 — 펼치는 순간 어차피 읽는다).
 * - 원격은 그 호스트에 **이미 붙은 세션**이 있을 때만(목록과 같은 규칙 — 이것 때문에 접속을 열지 않는다. 세션이 없는데
 *   읽으면 목록이 `offline` 으로 바뀌어 깜박인다).
 * - 같은 프로젝트는 [`REFRESH_GAP_MS`] 안에 두 번 읽지 않고, 읽는 중이면 새로 시작하지 않는다.
 */

/** 같은 프로젝트를 다시 읽기까지의 최소 간격(ms) — 포커스가 빠르게 오가도 git 을 몰아 부르지 않게 */
export const REFRESH_GAP_MS = 3000;

/** 후보 프로젝트 하나 */
export interface RefreshCandidate {
  id: string;
  /** 원격 프로젝트인가 */
  remote: boolean;
  /** 원격이면 그 호스트에 붙은 세션이 있는가(로컬은 무시) */
  attached: boolean;
}

/**
 * 지금 다시 읽을 프로젝트 id 들. `lastAt` = 프로젝트마다 마지막으로 읽기를 **시작한** 시각(ms, 없으면 읽은 적 없음) ·
 * `inFlight` = 지금 읽는 중인 프로젝트.
 */
export function refreshTargets(
  candidates: readonly RefreshCandidate[],
  expanded: ReadonlySet<string>,
  lastAt: Readonly<Record<string, number>>,
  inFlight: ReadonlySet<string>,
  now: number,
  gap: number = REFRESH_GAP_MS,
): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!expanded.has(c.id)) continue;
    if (c.remote && !c.attached) continue;
    if (inFlight.has(c.id)) continue;
    const last = lastAt[c.id];
    if (last !== undefined && now - last < gap) continue;
    out.push(c.id);
  }
  return out;
}
