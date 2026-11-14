// 이미지 타일 도구줄이 제 칸에 몇 개 들어가나 — 순수.
//
// - 도구줄은 머리줄 가운데 칸(`pane/PaneHeader` 의 `.pane-tools` — 남는 폭, 넘치면 오른쪽부터 잘린다)에 선다. 그 폭은 타일 폭만으로는 모른다 —
//   이름 묶음이 제 글자 폭만큼(최대 머리줄의 40%) 먼저 가져가기 때문이다(`grok.png` 와 `Screenshot 2026-11-14 093012.png` 는 같은 타일에서 150px 넘게 다르다).
//   그래서 `ImageView` 가 도구줄 상자의 폭을 재서(`flex: 1 1 0` 이라 안의 단추와 상관없이 칸의 폭이다 — 빼도 다시 재지 않는다) 여기 넘긴다.
//   판정은 그 폭에서 **이름이 최대 폭까지 가져갔다고 치고** 센다([`expandedSlot`] 의 `name`) — 같은 타일에서 넘겨도 판정이 바뀌지 않는다.
// - 덜 중요한 것부터 뺀다: 다시 읽기 → [맞춤 | 1:1] → 이전/다음. **배율 단추는 늘 남는다.** 하나가 안 들어가면 그 뒤도 넣지 않는다(순서를 지킨다).
// - 뺀 것의 다른 길: 다시 읽기 = 저절로 다시 읽기(`doc-refresh`) · 무대 빈 화면의 [다시 읽기], 맞춤 · 1:1 = 배율 목록 · 본문 우클릭 · 더블클릭 · `0`/`1`,
//   이전/다음 = 그림 위 양옆 단추(좁은 타일과 같은 길) · ← →.
// - 폭은 `ImageView.svelte` 의 `.bar` · `.btn` CSS 에서 셈한 값이다(단추는 UA 기본 border-box — `.btn.ico` 는 테두리까지 24px). 하네스로 잰 렌더 폭과
//   맞췄다(11-15). CSS 를 바꾸면 함께 바꾼다.
// - 판정은 **펼친(포커스) 머리줄의 폭**으로 한다([`expandedSlot`]). 포커스 밖 머리줄은 오른쪽 `⋯ ⤢ ×`(`.head-btn`)를 폭 0 · 앞 간격 음수로
//   접어(120ms 움직임) 그만큼 가운데 칸이 넓어진다 — 잰 폭을 그대로 쓰면 접힘 · 펼침마다(움직이는 동안 매 프레임) 판정이 바뀌어 이전/다음이
//   머리줄 ↔ 그림 위로 튀었다. 그래서 그 단추들이 지금 비운 폭을 빼서 늘 펼친 때의 폭으로 센다.

/** 도구줄 칸 사이(`.bar` 의 `gap`) */
export const BAR_GAP = 4;
/** 11px UI 글꼴 한 자(숫자 · `%` · `/`)의 넉넉한 어림 */
const CHAR = 6.6;
/** 아이콘 단추(`.btn.ico` — border-box 라 테두리까지 24) */
const ICO = 24;
/** [맞춤 | 1:1] — 앞 여백 4 · `맞춤`(안쪽 14 + 테두리 2 + 글자 22) · 사이 2 · `1:1`(16 + 15). 한국어가 영어(`Fit`)보다 넓어 그 값 */
export const SEG_W = 4 + 38 + 2 + 31;
/** 다시 읽기 */
export const RELOAD_W = ICO;

/**
 * 같은 폴더에서 가장 넓은 `n / 12` — 판정은 지금 글자가 아니라 이것으로 센다(`9 / 12` → `10 / 12` 로 넘길 때 판정이 바뀌지 않게).
 * 화면의 `3 / 12` 칸도 같은 폭을 미리 잡는다([`counterMinCss`]).
 */
export function widestCounter(total: number): string {
  return `${total} / ${total}`;
}

/** `3 / 12` 칸(`ImageView` 의 `.count`)의 최소 폭 — 숫자는 tabular-nums 라 한 자 = 1ch, ` / ` ≈ 1em. 적어도 3.2em(CSS 의 기본값) */
export function counterMinCss(total: number): string {
  return `max(3.2em, calc(${2 * String(total).length}ch + 1em))`;
}

/** 이전 · `3 / 12` · 다음 — 칸 사이 2 · 가운데 글자는 최소 3.2em(35.2px) */
export function navWidth(counter: string): number {
  return ICO + 2 + Math.max(35.2, counter.length * CHAR) + 2 + ICO;
}

/**
 * 배율 단추 글자 칸의 폭 — `ImageView.svelte` 의 `.pct-txt` 는 보이지 않는 `100%` 와 겹친 격자 칸이라 `100%` 까지(그리고 그림이 없을 때의
 * `—`)는 늘 `100%` 의 글자 폭이다(11px UI 글꼴 · tabular-nums 로 잰 값 29.77 — 단추 55.77). 넘길 때마다 `42%` ↔ `100%` 로 단추가 넓어졌다
 * 줄어 그 왼쪽의 이전/다음이 좌우로 움직였다. 1000% 이상(다섯 자)만 한 자([`PCT_DIGIT`])씩 넓어진다.
 */
export const PCT_TEXT_MIN = 29.8;
/** 배율 글자의 숫자 한 자(tabular-nums — `1000%` 가 `100%` 보다 6.75 넓다) */
const PCT_DIGIT = 6.8;

/** 배율 `42% ▾` — 안쪽 6 + 4 · 테두리 2 · 글자(적어도 [`PCT_TEXT_MIN`]) · 사이 2 · 아래 화살표 12 */
export function pctWidth(pct: string): number {
  return 10 + 2 + PCT_TEXT_MIN + Math.max(0, pct.length - 4) * PCT_DIGIT + 2 + 12;
}

/** 머리줄 오른쪽 단추(`pane/PaneHeader.svelte` 의 `.head-btn` — border-box 24px)의 펼친 폭. 그 CSS 를 바꾸면 함께 바꾼다 */
export const HEAD_BTN_W = 24;

/** 머리줄 이름 묶음(`pane/PaneHeader` 의 `.pane-ident`)의 지금 폭 · 가질 수 있는 최대 폭(도구줄이 선 머리줄은 머리줄 안쪽 폭의 40%) */
export interface NameBox {
  width: number;
  maxWidth: number;
}

/**
 * 판정용 도구줄 폭 — `measured` = 지금 잰 폭, `heads` = 머리줄 오른쪽 단추들의 지금 폭 · 왼쪽 여백(접히면 0 · 음수 간격,
 * 펼치면 24 · 0 — 움직이는 중이면 그 사이). 단추마다 비운 폭(`24 − 폭 − 여백`)을 뺀다 — 펼친 단추는 0 이라 빼지 않는다.
 *
 * `name` 이 있으면 **이름 묶음이 최대 폭까지 가져갔다고 치고** 센다 — 이름이 덜 가져간 폭(`최대 − 지금`)을 뺀다. 도구줄 칸 + 이름 묶음은
 * 같은 머리줄에서 늘 같은 합이라, 이렇게 세면 판정은 타일 폭에만 따른다: 이름 길이가 다른 그림으로 넘겨도 다시 읽기 · [맞춤 | 1:1] 이
 * 들어갔다 빠지며 이전/다음을 좌우로 밀지 않는다(이름이 짧은 그림에서는 실제 칸보다 좁게 세어 일찍 빠진다 — 사용자가 받아들임).
 *
 * 0 = 아직 모름(`fitBar` 가 다 넣는다)이므로 잰 폭이 있으면 깎은 결과는 적어도 1 이다.
 */
export function expandedSlot(
  measured: number,
  heads: readonly { width: number; marginLeft: number }[],
  name: NameBox | null = null,
): number {
  if (!(measured > 0)) return 0;
  let freed = 0;
  for (const h of heads) freed += Math.max(0, HEAD_BTN_W - h.width - h.marginLeft);
  const unclaimed = name ? Math.max(0, name.maxWidth - name.width) : 0;
  return Math.max(1, Math.round(measured - freed - unclaimed));
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
    // 소수 폭(6.6 · 30.8 …)을 거듭 빼면 꼭 맞는 칸이 1e-14 모자라게 나온다 — 그 찌꺼기는 들어간 것으로 본다
    if (left + 1e-6 < BAR_GAP + w) return false;
    left -= BAR_GAP + w;
    return true;
  };
  const nav = counter !== null && take(navWidth(counter));
  const seg = (counter === null || nav) && take(SEG_W);
  const reload = seg && take(RELOAD_W);
  return { nav, seg, reload };
}
