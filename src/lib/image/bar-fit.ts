// 이미지 타일 도구줄이 제 칸에 몇 개 들어가나 — 순수.
// - 폭 상수는 `ImageView.svelte` 의 `.bar` · `.btn` CSS(와 `PaneHeader` 의 `.head-btn`)에서 셈한 값이다 — CSS 를 바꾸면 함께 바꾼다.
// - 판정은 펼친 머리줄 · 이름이 최대 폭까지 가져간 폭으로 센다([`expandedSlot`]) — 잰 폭을 그대로 쓰면 접힘 · 펼침 · 이름 길이마다 판정이 바뀌어 이전/다음이 튄다.
// - 덜 중요한 것부터 뺀다(다시 읽기 → [맞춤 | 1:1] → 이전/다음) · 배율 단추는 늘 남는다 · 하나가 안 들어가면 그 뒤도 넣지 않는다.

export const BAR_GAP = 4;
/** 11px UI 글꼴 한 자(숫자 · `%` · `/`)의 넉넉한 어림 */
const CHAR = 6.6;
const ICO = 24;
/** [맞춤 | 1:1] 의 폭 — 한국어가 영어(`Fit`)보다 넓어 그 값 */
export const SEG_W = 4 + 38 + 2 + 31;
export const RELOAD_W = ICO;

/**
 * 같은 폴더에서 가장 넓은 `n / 12` — 판정은 지금 글자가 아니라 이것으로 센다(넘길 때 판정이 바뀌지 않게).
 * 화면의 `3 / 12` 칸도 같은 폭을 미리 잡는다([`counterMinCss`]).
 */
export function widestCounter(total: number): string {
  return `${total} / ${total}`;
}

/** `3 / 12` 칸(`.count`)의 최소 폭 — tabular-nums 라 한 자 = 1ch · 적어도 3.2em(CSS 의 기본값) */
export function counterMinCss(total: number): string {
  return `max(3.2em, calc(${2 * String(total).length}ch + 1em))`;
}

export function navWidth(counter: string): number {
  return ICO + 2 + Math.max(35.2, counter.length * CHAR) + 2 + ICO;
}

/**
 * 배율 단추 글자 칸의 폭 — `.pct-txt` 는 보이지 않는 `100%` 와 겹친 격자 칸이라 `100%` 까지는 늘 그 폭이다(넘길 때 단추 폭이 바뀌어 이전/다음이 움직이지 않게).
 * 1000% 이상만 한 자([`PCT_DIGIT`])씩 넓어진다.
 */
export const PCT_TEXT_MIN = 29.8;
const PCT_DIGIT = 6.8;

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
 * 판정용 도구줄 폭 — 머리줄 오른쪽 단추들이 지금 비운 폭(`24 − 폭 − 여백`)을 빼고, `name` 이 있으면 이름이 덜 가져간 폭(`최대 − 지금`)도 뺀다.
 * 이름이 짧은 그림에서는 실제 칸보다 좁게 세어 일찍 빠진다 — 사용자가 받아들인 한계다.
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
 * `slot` 0 이하 = 아직 모름(다 넣는다) · `counter` `null` = 이전/다음 없음, `""` = 이전/다음만(셀 자리가 없다) · 맨 앞 늘어나는 빈칸도 한 칸이라 칸마다 앞 간격이 붙는다.
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
