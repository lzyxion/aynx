/** 백틱 구간을 인라인 코드 조각으로 — `{@html}` 없이 그리려고. 짝이 없는 마지막 백틱은 글자 그대로 둔다 */
export interface CodeSpan {
  text: string;
  code: boolean;
}

export function codeSpans(s: string): CodeSpan[] {
  const parts = s.split("`");
  if (parts.length % 2 === 0) {
    const tail = parts.pop() ?? "";
    parts[parts.length - 1] += "`" + tail;
  }
  const out: CodeSpan[] = [];
  parts.forEach((text, i) => {
    if (text) out.push({ text, code: i % 2 === 1 });
  });
  return out;
}
