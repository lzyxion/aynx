/**
 * **앱이 스스로 그리는 고르개 목록의 순수 규칙** — 자리 계산 하나와 거르기 하나
 * (docs/log/2026-09-20-host-form-tabs.md 의 "네이티브 select · datalist → Dropdown · Combobox").
 *
 * 쓰는 곳은 둘이다: `Dropdown.svelte`(값 하나를 고른다 — 옛 `<select>`)와
 * `Combobox.svelte`(자유 입력 + 제안 — 옛 `<datalist>`). 둘이 서로 다른 셈으로 자리를
 * 잡으면 "같은 종류의 목록" 이라는 사실이 화면에서 사라지므로, 셈은 여기 한 벌만 둔다
 * (`menu-flyout.ts` 가 플라이아웃 둘에 대해 하는 일과 같은 결).
 *
 * 여기 있는 것은 **순수 함수와 상수뿐**이다 — 상태·DOM 측정·창 리스너는 두 컴포넌트가
 * 들고 있다. 이 저장소의 vitest 는 `environment: "node"` 라 `.svelte` 를 못 읽으므로,
 * 회귀 테스트를 받을 수 있는 자리가 순수 모듈뿐이기도 하다 (docs/log/2026-09-05-vitest.md).
 */

/** 자리를 잴 때 쓰는 최소한의 사각형 (`DOMRect` 를 그대로 넘겨도 된다) */
export interface TriggerRect {
  top: number;
  bottom: number;
}

/** 손잡이와 목록 사이 틈 — 두 상자의 테두리가 붙어 한 덩어리로 읽히지 않을 만큼만 */
export const DROPDOWN_GAP = 2;

/** 화면 경계에서 띄워 둘 여백 (`menu-flyout.ts` 의 `FLYOUT_MARGIN` 과 같은 값) */
export const DROPDOWN_MARGIN = 8;

/** 목록의 높이 상한 — 이보다 길면 목록 자신이 스크롤한다 */
export const DROPDOWN_MAX_HEIGHT = 240;

/** 자리가 아무리 좁아도 이만큼은 편다 (그 아래로는 줄이 한 줄도 안 보인다) */
export const DROPDOWN_MIN_HEIGHT = 96;

/** 자동완성이 한 번에 보여 주는 줄 수 */
export const SUGGEST_MAX = 8;

/**
 * **목록을 손잡이 아래에 놓을지 위로 뒤집을지.**
 *
 * 기본은 아래다 (네이티브 `<select>` 와 같은 몸짓). 아래가 모자라면 위로 뒤집고, 양쪽 다
 * 모자라면 **넓은 쪽**에 붙인다 — 넘치는 만큼은 목록 자신의 스크롤이 맡는다.
 *
 * 좌표가 `position: fixed` 기준(= 뷰포트)인 것이 요점이다: 이 목록이 뜨는 호스트 폼의
 * 패널(`.host-panel`)이 `overflow-y: auto` 라, `absolute` 로 두면 상자 밖으로 나가는 순간
 * **잘린다**. 그래서 여는 순간 손잡이의 `getBoundingClientRect()` 를 떠서 이리로 넘긴다.
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

  // 둘 다 모자란다 — 넓은 쪽에 붙이고 여백 안으로 민다
  const roomBelow = viewportHeight - DROPDOWN_MARGIN - belowTop;
  const roomAbove = trigger.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
  if (roomBelow >= roomAbove) return { top: belowTop, flipped: false };
  return { top: DROPDOWN_MARGIN, flipped: true };
}

/**
 * **목록이 펼 수 있는 최대 높이** — 위아래 중 넓은 쪽의 자리만큼, 상한·하한 안에서.
 *
 * 재기 **전에** 정해야 하는 값이라 따로 있다: 높이를 먼저 못 박아야 `offsetHeight` 가
 * 실제로 그려질 높이를 말하고, 그 값으로 [`placeBelowOrAbove`] 가 뒤집을지 정한다.
 */
export function dropdownMaxHeight(trigger: TriggerRect, viewportHeight: number): number {
  const roomBelow = viewportHeight - DROPDOWN_MARGIN - (trigger.bottom + DROPDOWN_GAP);
  const roomAbove = trigger.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
  const room = Math.max(roomBelow, roomAbove);
  return Math.max(DROPDOWN_MIN_HEIGHT, Math.min(DROPDOWN_MAX_HEIGHT, Math.floor(room)));
}

/**
 * **자동완성 거르기** — 친 글자를 **포함**하는 것들 (대소문자 무시).
 *
 * `<datalist>` 가 하던 일 그대로다. 빈 칸이면 전부(상한까지) — 그때 목록이 뜨는 길은
 * `↓` 하나뿐이고(포커스만으로는 뜨지 않는다), 그 몸짓의 뜻이 "뭐가 있는지 보여 달라" 다.
 *
 * "시작하는 것" 이 아니라 "포함하는 것" 인 이유: 값이 `prod/web` 같은 **경로**라 사람이
 * 기억하는 조각이 뒤쪽일 수 있다(`web` 을 치면 `prod/web` 이 나와야 한다).
 */
export function filterSuggestions(
  all: readonly string[],
  typed: string,
  max: number = SUGGEST_MAX,
): string[] {
  const needle = typed.trim().toLowerCase();
  const hit = needle === "" ? [...all] : all.filter((s) => s.toLowerCase().includes(needle));
  return hit.slice(0, Math.max(0, max));
}

/** 타이핑 점프에서 이 시간(ms) 넘게 쉬면 앞서 친 글자를 잊고 새로 찾는다 (네이티브 `<select>` 와 비슷한 값) */
export const TYPEAHEAD_RESET_MS = 700;

/**
 * **타이핑 점프** — 친 글자로 시작하는 줄의 번호(대소문자 무시). 없으면 `-1`.
 *
 * 네이티브 `<select>` 의 몸짓을 따른다:
 * - 글자 하나(또는 같은 글자만 거듭 친 것)면 **지금 줄 다음부터** 돌아가며 찾는다 — `p` 를 거듭 치면
 *   `PowerShell 7` → `Windows PowerShell`… 이 아니라 `p` 로 시작하는 줄들 사이를 돈다.
 * - 글자를 이어 쳤으면(`pow`) **지금 줄부터** 그 접두사로 찾는다 — 이미 맞는 줄에 머문다.
 */
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
