/**
 * **체크박스 되쓰기** — 순수 모듈. 문서 타일에서 누른 `- [ ]` · `- [x]` 를 원문의 **그 줄 한 글자**로 바꾼다.
 *
 * 줄은 파서가 싣는 `MdListItem.line`(0 기준 · `\r\n` · `\r` · `\n` 모두 한 줄 끝 — `parseMarkdown` 과 같은 셈)이다.
 * 바꾸는 것은 `[` 와 `]` 사이 한 글자뿐이고 줄 끝 글자는 그대로 둔다. 그 줄이 기대한 모양(체크박스 항목 · 누르기 전
 * 상태)이 아니면 **거절**한다(`null`) — 그린 뒤 디스크나 편집기 글이 바뀌었으면 엉뚱한 줄을 고치지 않는다.
 * 쓰기(파일 · 편집기)는 `DocView` 가 한다.
 */

/**
 * 체크박스 항목 줄 — 인용 표식(`>` 여럿) · 들여쓰기 · 목록 표식(`-` `*` `+` `1.` `1)`) · `[` 까지가 앞, 그다음 한 글자가
 * 상태다. `]` 뒤는 공백이나 줄 끝(`parseMarkdown` 의 `TASK` 는 뒤에 공백을 요구한다 — 이어짐 줄이 붙은 항목은 줄 끝이다)
 */
const TASK_LINE = /^((?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\](?=[ \t]|$)/;

/** 원문 한 줄(줄 끝 글자 없이)의 체크박스 — 상태 글자의 열과 지금 상태. 체크박스 항목 줄이 아니면 `null` */
export function taskMarkOf(line: string): { col: number; checked: boolean } | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  return { col: m[1].length, checked: m[2] !== " " };
}

/** 누른 뒤의 상태 글자 — 켜면 `x`, 끄면 공백(`X` 도 끄면 공백) */
export function taskCharOf(checked: boolean): string {
  return checked ? "x" : " ";
}

/**
 * 글 전체에서 `line` 줄(0 기준)의 체크박스를 뒤집은 새 글. 그 줄이 체크박스 항목이 아니거나 지금 상태가
 * `wasChecked` 와 다르면 `null`. 줄 끝(`\r\n` · `\n` · `\r`)과 다른 줄은 한 글자도 바꾸지 않는다.
 */
export function toggleTaskLine(text: string, line: number, wasChecked: boolean): string | null {
  if (!Number.isInteger(line) || line < 0) return null;
  // 홀수 자리가 줄 끝 글자다 — 그대로 다시 잇는다
  const parts = text.split(/(\r\n|\r|\n)/);
  const at = line * 2;
  if (at >= parts.length) return null;
  const mark = taskMarkOf(parts[at]);
  if (!mark || mark.checked !== wasChecked) return null;
  const s = parts[at];
  parts[at] = s.slice(0, mark.col) + taskCharOf(!wasChecked) + s.slice(mark.col + 1);
  return parts.join("");
}
