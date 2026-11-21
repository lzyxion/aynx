/**
 * 체크박스 되쓰기 — 원문의 그 줄 한 글자만 바꾼다. 줄 셈은 `parseMarkdown` 의 `MdListItem.line` 과 같다(`\r\n` · `\r` · `\n` 모두 한 줄 끝).
 * 그 줄이 기대한 모양이 아니면 거절한다 — 그린 뒤 디스크나 편집기 글이 바뀌었으면 엉뚱한 줄을 고치지 않는다.
 */

/** `parseMarkdown` 의 `TASK` 와 달리 `]` 뒤 줄 끝도 받는다 — 이어짐 줄이 붙은 항목은 줄 끝이다 */
const TASK_LINE = /^((?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\](?=[ \t]|$)/;

export function taskMarkOf(line: string): { col: number; checked: boolean } | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  return { col: m[1].length, checked: m[2] !== " " };
}

export function taskCharOf(checked: boolean): string {
  return checked ? "x" : " ";
}

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
