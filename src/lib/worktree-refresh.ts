// 독이 보일 때 어느 프로젝트의 워크트리를 다시 읽을지 — 주기 폴링은 하지 않는다(docs/log/2026-09-29-worktree-badges.md).
// 원격은 이미 붙은 세션이 있을 때만 — 이것 때문에 접속을 열지 않고, 세션 없이 읽으면 목록이 `offline` 으로 깜박인다.

/** 포커스가 빠르게 오가도 git 을 몰아 부르지 않게 */
export const REFRESH_GAP_MS = 3000;

export interface RefreshCandidate {
  id: string;
  remote: boolean;
  /** 원격이면 그 호스트에 붙은 세션이 있는가(로컬은 무시) */
  attached: boolean;
}

/** `lastAt` = 마지막으로 읽기를 시작한 시각(ms) */
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
