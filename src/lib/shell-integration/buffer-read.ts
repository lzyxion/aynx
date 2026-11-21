// **내부 전용** — xterm 버퍼의 `[start, end)` 를 논리 줄로 읽는 한 곳. 출력 복사 · 블록 발췌 · 명령문 · `tail` 이 같은 줄 나누기를 본다.
// Rust `screen_mirror/vt.rs` 의 줄 읽기와 같은 의미여야 한다.

import type { Terminal } from "@xterm/xterm";

/** 오른쪽 공백은 다음 줄이 이어지지 않을 때만 자른다 — 이어지는 줄을 trim 하면 폭에 딱 맞은 공백이 사라진다 (docs/verification/xterm.md). */
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

/** 블록 이력은 `readLineArray` 를 그대로 쓴다 — 이어 붙인 것을 다시 쪼개면 "출력만 복사" 와 다른 값이 나올 수 있다. */
export function readLines(term: Terminal, start: number, end: number): string {
  return readLineArray(term, start, end).join("\n");
}
