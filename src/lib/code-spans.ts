/**
 * 백틱 구간을 인라인 코드 조각으로 — 토스트의 보조 줄(`ToastOpts.sub`)이 쓴다.
 *
 * `{@html}` 없이 그리려고 문자열을 **조각 배열**로 나눈다: 백틱 사이는 `code: true`,
 * 나머지는 맨 글자. 짝이 없는 마지막 백틱은 글자 그대로 둔다(말없이 삼키지 않는다).
 * 빈 조각은 싣지 않는다.
 */
export interface CodeSpan {
  text: string;
  code: boolean;
}

export function codeSpans(s: string): CodeSpan[] {
  const parts = s.split("`");
  // 조각 수가 짝수면 마지막 백틱이 짝이 없다 — 그 뒤 조각을 앞 글자에 백틱째 되붙인다
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
