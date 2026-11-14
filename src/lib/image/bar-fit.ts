// 이미지 타일 도구줄이 제 칸에 몇 개 들어가나 — 순수.
//
// - 도구줄은 머리줄 가운데 칸(`pane/PaneHeader` 의 `.pane-tools` — 남는 폭, 넘치면 오른쪽부터 잘린다)에 선다. 그 폭은 타일 폭만으로는 모른다 —
//   이름 묶음이 제 글자 폭만큼(최대 머리줄의 40%) 먼저 가져가기 때문이다(`grok.png` 와 `Screenshot 2026-11-14 093012.png` 는 같은 타일에서 150px 넘게 다르다).
//   그래서 `ImageView` 가 도구줄 상자의 폭을 재서(`flex: 1 1 0` 이라 안의 단추와 상관없이 칸의 폭이다 — 빼도 다시 재지 않는다) 여기 넘긴다.
// - 덜 중요한 것부터 뺀다: 다시 읽기 → [맞춤 | 1:1] → 이전/다음. **배율 단추는 늘 남는다.** 하나가 안 들어가면 그 뒤도 넣지 않는다(순서를 지킨다).
// - 뺀 것의 다른 길: 다시 읽기 = 저절로 다시 읽기(`doc-refresh`) · 무대 빈 화면의 [다시 읽기], 맞춤 · 1:1 = 배율 목록 · 본문 우클릭 · 더블클릭 · `0`/`1`,
//   이전/다음 = 그림 위 양옆 단추(좁은 타일과 같은 길) · ← →.
// - 폭은 `ImageView.svelte` 의 `.bar` · `.btn` CSS 에서 셈한 값이다(단추 상자는 content-box — 24px + 테두리 2). CSS 를 바꾸면 함께 바꾼다.
// - 판정은 **펼친(포커스) 머리줄의 폭**으로 한다([`expandedSlot`]). 포커스 밖 머리줄은 오른쪽 `⋯ ⤢ ×`(`.head-btn`)를 폭 0 · 앞 간격 음수로
//   접어(120ms 움직임) 그만큼 가운데 칸이 넓어진다 — 잰 폭을 그대로 쓰면 접힘 · 펼침마다(움직이는 동안 매 프레임) 판정이 바뀌어 이전/다음이
//   머리줄 ↔ 그림 위로 튀었다. 그래서 그 단추들이 지금 비운 폭을 빼서 늘 펼친 때의 폭으로 센다.

/** 도구줄 칸 사이(`.bar` 의 `gap`) */
export const BAR_GAP = 4;
/** 11px UI 글꼴 한 자(숫자 · `%` · `/`)의 넉넉한 어림 */
const CHAR = 6.6;
/** 아이콘 단추(`.btn.ico` — 24 + 테두리 2) */
const ICO = 26;
/** [맞춤 | 1:1] — 앞 여백 4 · `맞춤`(안쪽 14 + 테두리 2 + 글자 22) · 사이 2 · `1:1`(16 + 15). 한국어가 영어(`Fit`)보다 넓어 그 값 */
export const SEG_W = 4 + 38 + 2 + 31;
/** 다시 읽기 */
export const RELOAD_W = ICO;

/** 이전 · `3 / 12` · 다음 — 칸 사이 2 · 가운데 글자는 최소 3.2em(35.2px) */
export function navWidth(counter: string): number {
  return ICO + 2 + Math.max(35.2, counter.length * CHAR) + 2 + ICO;
}

/**
 * 배율 `42% ▾` — 안쪽 6 + 4 · 테두리 2 · 글자 · 사이 2 · 아래 화살표 12. 그림이 없을 때의 `—`(`view-math` 의 `NO_ZOOM_LABEL` — 한 자지만
 * 숫자보다 넓다)도 들어가게 글자는 적어도 두 자로 센다.
 */
export function pctWidth(pct: string): number {
  return 10 + 2 + Math.max(2, pct.length) * CHAR + 2 + 12;
}

/** 머리줄 오른쪽 단추(`pane/PaneHeader.svelte` 의 `.head-btn` — border-box 24px)의 펼친 폭. 그 CSS 를 바꾸면 함께 바꾼다 */
export const HEAD_BTN_W = 24;

/**
 * 펼친 머리줄에서의 도구줄 폭 — `measured` = 지금 잰 폭, `heads` = 머리줄 오른쪽 단추들의 지금 폭 · 왼쪽 여백(접히면 0 · 음수 간격,
 * 펼치면 24 · 0 — 움직이는 중이면 그 사이). 단추마다 비운 폭(`24 − 폭 − 여백`)을 뺀다 — 펼친 단추는 0 이라 빼지 않는다.
 */
export function expandedSlot(measured: number, heads: readonly { width: number; marginLeft: number }[]): number {
  let freed = 0;
  for (const h of heads) freed += Math.max(0, HEAD_BTN_W - h.width - h.marginLeft);
  return Math.max(0, Math.round(measured - freed));
}

export interface BarFit {
  nav: boolean;
  seg: boolean;
  reload: boolean;
}

/**
 * `slot` = 도구줄 상자의 안쪽 폭(px — 안쪽 여백을 뺀 값, 0 이하 = 아직 모름 → 다 넣는다) · `counter` = `3 / 12`(없으면 `null` — 이전/다음 없음 ·
 * `""` = 이전/다음만, 지금 그림이 없어져 셀 자리가 없다) ·
 * `pct` = 배율 글자(`42%`). 맨 앞 늘어나는 빈칸도 한 칸이라 칸마다 앞 간격이 붙는다.
 */
export function fitBar(slot: number, counter: string | null, pct: string): BarFit {
  if (!(slot > 0)) return { nav: counter !== null, seg: true, reload: true };
  let left = slot - (BAR_GAP + pctWidth(pct));
  const take = (w: number): boolean => {
    if (left < BAR_GAP + w) return false;
    left -= BAR_GAP + w;
    return true;
  };
  const nav = counter !== null && take(navWidth(counter));
  const seg = (counter === null || nav) && take(SEG_W);
  const reload = seg && take(RELOAD_W);
  return { nav, seg, reload };
}
