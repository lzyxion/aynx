/**
 * **문서 타일의 "이 줄로" 한 번** — 순수 모듈 (터미널의 `파일:12` · `파일:12:3` 링크 — `path-links.ts`).
 *
 * 터미널에서 줄 번호가 붙은 경로를 Ctrl+클릭하면 문서 타일이 글을 그린 뒤 **한 번** 그 줄로 스크롤하고 그 자리를 잠깐
 * 강조한다(값은 `app/doc-anchors` 의 한 번짜리 — 명세에 적지 않는다). 여기는 줄 번호 → 보이는 줄 · 블록을 고르는 셈뿐이고
 * 스크롤 · 강조는 `DocView` 가 한다.
 *
 * - 코드 보기(텍스트 파일 · 마크다운의 원문 보기): 정확히 그 줄([`jumpLineIndex`]).
 * - 그린 마크다운: 그 줄이 든 **최상위 블록**([`blockAtLine`] — 시작 줄은 `markdown.ts` 의 `blockStartLines`).
 *
 * 줄이 파일보다 길면 마지막 줄(블록)로 간다. 다만 보기가 **잘렸으면**(큰 파일의 앞부분만 읽음) 그 줄이 잘린 뒤쪽일 수
 * 있어 엉뚱한 끝으로 데려가지 않고 버린다. 열은 쓰지 않는다(줄만).
 */

/** 강조가 머무는 시간(ms) — 이 사이 서서히 사라진다(움직임 줄이기면 전환 없이 있다가 사라진다) */
export const LINE_FLASH_MS = 2000;

/** 코드 보기에 보이는 줄 수 — 끝의 줄바꿈 하나는 빈 줄로 세지 않는다(`CodeView` 와 같은 규칙). 빈 글이면 0 */
export function viewLineCount(text: string): number {
  const shown = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (shown === "") return 0;
  let n = 1;
  for (let i = shown.indexOf("\n"); i >= 0; i = shown.indexOf("\n", i + 1)) n++;
  return n;
}

/**
 * 1 기준 줄 번호 → 보이는 줄의 0 기준 자리. 1 보다 작으면(`:0`) 첫 줄, 넘치면 마지막 줄 — 잘린 보기에서 넘치면 `null`.
 * 보일 줄이 없거나 줄 번호가 숫자가 아니어도 `null`.
 */
export function jumpLineIndex(line: number, text: string, truncated: boolean): number | null {
  if (!Number.isFinite(line)) return null;
  const count = viewLineCount(text);
  if (count === 0) return null;
  const n = Math.max(1, Math.floor(line));
  if (n > count) return truncated ? null : count - 1;
  return n - 1;
}

/**
 * 그 줄(0 기준)이 든 최상위 블록의 번호 — 시작 줄이 그 줄 이하인 마지막 블록. 첫 블록 위(빈 줄)면 첫 블록, 블록 사이 빈
 * 줄 · 정의 줄(참조 · 각주 — 화면에서 빠진다)은 앞 블록이다. 시작 줄이 없는 블록(`null` — 글 끝 각주 구역)은 고르지 않는다.
 * 고를 블록이 없으면 `null`.
 */
export function blockAtLine(starts: readonly (number | null)[], line: number): number | null {
  let hit: number | null = null;
  let first: number | null = null;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    if (s === null) continue;
    if (first === null) first = k;
    if (s <= line) hit = k;
    else break;
  }
  return hit ?? first;
}
