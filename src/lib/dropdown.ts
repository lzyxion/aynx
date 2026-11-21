/** 앱이 그리는 고르개 목록(`Dropdown` · `Combobox`)의 자리 · 거르기 셈 — 둘이 같은 셈을 쓰도록 한 벌만 둔다 */

export interface TriggerRect {
  top: number;
  bottom: number;
}

export const DROPDOWN_GAP = 2;

/** `menu-flyout.ts` 의 `FLYOUT_MARGIN` 과 같은 값 */
export const DROPDOWN_MARGIN = 8;

export const DROPDOWN_MAX_HEIGHT = 240;

export const DROPDOWN_MIN_HEIGHT = 96;

export const SUGGEST_MAX = 8;

/**
 * 좌표는 `position: fixed`(뷰포트) 기준이다 — 호스트 폼 패널(`.host-panel`)이 `overflow-y: auto` 라 `absolute` 면 상자 밖에서 잘린다.
 */
export function placeBelowOrAbove(
  trigger: TriggerRect,
  listHeight: number,
  viewportHeight: number,
): { top: number; flipped: boolean } {
  const belowTop = trigger.bottom + DROPDOWN_GAP;
  const aboveTop = trigger.top - DROPDOWN_GAP - listHeight;
  if (belowTop + listHeight <= viewportHeight - DROPDOWN_MARGIN) {
    return { top: belowTop, flipped: false };
  }
  if (aboveTop >= DROPDOWN_MARGIN) return { top: aboveTop, flipped: true };

  const roomBelow = viewportHeight - DROPDOWN_MARGIN - belowTop;
  const roomAbove = trigger.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
  if (roomBelow >= roomAbove) return { top: belowTop, flipped: false };
  return { top: DROPDOWN_MARGIN, flipped: true };
}

/** 재기 전에 높이를 먼저 못 박아야 `offsetHeight` 가 실제 높이를 말하고 [`placeBelowOrAbove`] 가 뒤집을지 정한다 */
export function dropdownMaxHeight(trigger: TriggerRect, viewportHeight: number): number {
  const roomBelow = viewportHeight - DROPDOWN_MARGIN - (trigger.bottom + DROPDOWN_GAP);
  const roomAbove = trigger.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
  const room = Math.max(roomBelow, roomAbove);
  return Math.max(DROPDOWN_MIN_HEIGHT, Math.min(DROPDOWN_MAX_HEIGHT, Math.floor(room)));
}

/** 친 글자를 "포함" 하는 것 — 값이 `prod/web` 같은 경로라 기억하는 조각이 뒤쪽일 수 있다 */
export function filterSuggestions(
  all: readonly string[],
  typed: string,
  max: number = SUGGEST_MAX,
): string[] {
  const needle = typed.trim().toLowerCase();
  const hit = needle === "" ? [...all] : all.filter((s) => s.toLowerCase().includes(needle));
  return hit.slice(0, Math.max(0, max));
}

export const TYPEAHEAD_RESET_MS = 700;

/** 글자 하나(또는 같은 글자 거듭)면 지금 줄 다음부터 돌아가며, 이어 친 접두사면 지금 줄부터 찾는다(네이티브 `<select>` 몸짓). 없으면 `-1` */
export function typeaheadIndex(labels: readonly string[], typed: string, from: number): number {
  const n = labels.length;
  if (n === 0 || typed === "") return -1;
  const q = typed.toLowerCase();
  const repeat = [...q].every((c) => c === q[0]);
  const needle = repeat ? q[0] : q;
  const start = repeat ? from + 1 : from;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (labels[i].toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
