/** 문서 타일의 "이 줄로" 한 번(터미널의 `파일:12` 링크). 값은 `app/doc-anchors` 의 한 번짜리 — 명세에 적지 않는다. */

export const LINE_FLASH_MS = 2000;

/** 끝의 줄바꿈 하나는 빈 줄로 세지 않는다 — `CodeView` 와 같은 규칙 */
export function viewLineCount(text: string): number {
  const shown = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (shown === "") return 0;
  let n = 1;
  for (let i = shown.indexOf("\n"); i >= 0; i = shown.indexOf("\n", i + 1)) n++;
  return n;
}

/** 넘치면 마지막 줄 — 다만 잘린 보기면 그 줄이 잘린 뒤쪽일 수 있어 엉뚱한 끝으로 데려가지 않고 `null` */
export function jumpLineIndex(line: number, text: string, truncated: boolean): number | null {
  if (!Number.isFinite(line)) return null;
  const count = viewLineCount(text);
  if (count === 0) return null;
  const n = Math.max(1, Math.floor(line));
  if (n > count) return truncated ? null : count - 1;
  return n - 1;
}

/** 시작 줄이 `null` 인 블록(글 끝 각주 구역)은 고르지 않는다 */
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
