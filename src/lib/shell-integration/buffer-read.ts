// **내부 전용** — xterm 버퍼의 `[start, end)` 를 논리 줄로 읽는 한 곳(`readLineArray` · `readLines`).
// 출력 복사 · 블록 발췌 · 명령문 · `tail` 이 모두 여기를 지나 같은 줄 나누기를 본다.

import type { Terminal } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// 버퍼에서 텍스트 꺼내기
// ---------------------------------------------------------------------------

/**
 * 버퍼의 `[start, end)` 구간을 **논리 줄**로 읽는다 (docs/verification/xterm.md 방식).
 *
 * xterm 의 한 줄은 화면 줄이라, 폭보다 긴 출력은 여러 줄에 걸쳐 있고 이어지는 줄에
 * `isWrapped` 가 서 있다. 그 줄들은 개행 없이 앞줄에 이어 붙여야 원래 텍스트가 된다.
 *
 * 오른쪽 공백은 **다음 줄이 이어지지 않을 때만** 잘라 낸다 — 이어지는 줄을 trim 하면
 * 줄이 정확히 폭에 맞아떨어졌을 때 잘려선 안 될 공백까지 사라진다.
 */
export function readLineArray(term: Terminal, start: number, end: number): string[] {
  const buf = term.buffer.active;
  const out: string[] = [];
  const from = Math.max(0, start);
  const to = Math.min(end, buf.length);
  for (let y = from; y < to; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const continues = buf.getLine(y + 1)?.isWrapped ?? false;
    const text = line.translateToString(!continues);
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  // 출력 끝의 빈 줄은 프롬프트 직전의 개행이라 사용자가 복사하려던 것이 아니다.
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

/**
 * 같은 구간을 **한 덩어리 문자열**로 (클립보드·`CommandSnapshot.output` 용).
 *
 * 블록 이력은 [`readLineArray`] 쪽을 그대로 쓴다 — 발췌가 **논리 줄 배열**이라 여기서 이어
 * 붙인 것을 다시 쪼개면 "출력만 복사" 와 미세하게 다른 값이 나올 수 있다 (같은 함수에서
 * 갈라지므로 둘은 언제나 같은 줄 나누기를 본다).
 */
export function readLines(term: Terminal, start: number, end: number): string {
  return readLineArray(term, start, end).join("\n");
}
