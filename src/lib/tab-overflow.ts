/**
 * 탭 줄의 생략 — 몇 칸을 그리나 하나만 정한다(폭 배분은 CSS flex) (docs/log/2026-09-29-tab-width-shrink.md).
 * 스트립 폭은 탭 수와 무관하게(`.tabs` 안의 `flex: 1`) 정해져야 한다 — 그래야 잰 값이 다시 탭 수를 바꾸는 되먹임이 없다.
 */

export interface TabFit {
  /** 0 이면 아직 재지 못했다 */
  width: number;
  /** 최소 폭 + 탭 사이 간격 */
  slot: number;
  /** 탭 말고 늘 서는 것(`+` · 끌기 손잡이 최소 폭 · 간격) */
  reserve: number;
  /** 넘칠 때만 서는 `+N` 단추(간격 포함) */
  more: number;
}

export function tabCapacity(fit: TabFit, count: number): number {
  if (fit.width <= 0 || fit.slot <= 0) return count;
  if (count * fit.slot + fit.reserve <= fit.width) return count;
  return Math.max(1, Math.floor((fit.width - fit.reserve - fit.more) / fit.slot));
}

/** 활성 탭은 늘 보인다 — 뒤에 있으면 마지막 칸을 내준다 */
export function elidedTabIds(ids: readonly string[], activeId: string | null, capacity: number): Set<string> {
  if (capacity >= ids.length) return new Set();
  const shown = ids.slice(0, Math.max(1, capacity));
  if (activeId !== null && ids.includes(activeId) && !shown.includes(activeId)) shown[shown.length - 1] = activeId;
  const keep = new Set(shown);
  return new Set(ids.filter((id) => !keep.has(id)));
}
