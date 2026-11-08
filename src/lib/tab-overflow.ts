/**
 * 탭 줄의 **생략** — 아이콘 폭(`--tab-min-width`)까지 줄어도 넘치는 탭은 그리지 않고 `+N` 목록으로 보낸다
 * (docs/log/2026-09-29-tab-width-shrink.md 의 뒤 단계 — 스크롤은 없앴다).
 *
 * 폭 배분은 여전히 CSS flex 가 한다. 여기서 정하는 것은 **몇 칸을 그리나** 하나다 — 스트립 폭은 탭 수와
 * 무관하게(`.tabs` 안의 `flex: 1`) 정해지므로 잰 값이 다시 탭 수를 바꾸는 되먹임이 없다.
 */

export interface TabFit {
  /** 스트립 안쪽 폭(px) — 0 이면 아직 재지 못했다 */
  width: number;
  /** 아이콘만 남은 탭 한 칸이 차지하는 폭(최소 폭 + 탭 사이 간격) */
  slot: number;
  /** 탭 말고 늘 서는 것(`+` · 끌기 손잡이 최소 폭 · 간격)의 폭 */
  reserve: number;
  /** 넘칠 때만 서는 `+N` 단추의 폭(간격 포함) */
  more: number;
}

/** 그릴 수 있는 탭 수 — 다 들어가면 `count`, 넘치면 `+N` 단추 자리를 빼고 최소 1 */
export function tabCapacity(fit: TabFit, count: number): number {
  if (fit.width <= 0 || fit.slot <= 0) return count;
  if (count * fit.slot + fit.reserve <= fit.width) return count;
  return Math.max(1, Math.floor((fit.width - fit.reserve - fit.more) / fit.slot));
}

/**
 * 접히는 탭 id — 순서대로 앞에서부터 `capacity` 칸을 그리되, **활성 탭은 늘 보인다**:
 * 활성 탭이 뒤에 있으면 마지막 칸을 내준다(그 칸의 탭이 대신 접힌다).
 */
export function elidedTabIds(ids: readonly string[], activeId: string | null, capacity: number): Set<string> {
  if (capacity >= ids.length) return new Set();
  const shown = ids.slice(0, Math.max(1, capacity));
  if (activeId !== null && ids.includes(activeId) && !shown.includes(activeId)) shown[shown.length - 1] = activeId;
  const keep = new Set(shown);
  return new Set(ids.filter((id) => !keep.has(id)));
}
