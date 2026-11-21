/**
 * 터미널 입력의 출처 — 세션 서버 `write` op 가 싣는다. `keyboard` · `paste` 는 사람 개입(작업자 타일이면 서버가 개입 잠금을 건다),
 * `protocol` 은 xterm 이 스스로 내는 터미널 응답이라 개입이 아니다.
 * 내용만으로는 못 가르는 겹침이 있다(Ctrl+F3 = `ESC[1;5R` = 커서 위치 답) — 키 · 붙여넣기 이벤트 중에 나온 글은 사람 것으로 친다.
 * 모르면 사람(안전한 쪽 — 반대로 치면 사람이 치는 중에 AI 글이 섞인다).
 */

export type InputSource = "keyboard" | "paste" | "protocol";

/** 응답 하나의 모양 — 통째로 맞아야 한다(여러 응답이 이어 붙은 것도 받는다). */
const REPLY = new RegExp(
  [
    "\\x1b\\[\\?[0-9;]*(?:R|c|n|\\$y|u)",
    "\\x1b\\[>[0-9;]*c",
    "\\x1b\\[[0-9;]*(?:R|n|t|\\$y)",
    // 포커스 이벤트(키로는 나올 수 없다)
    "\\x1b\\[[IO]",
    "\\x1bP[0-9>]?[!-~][^\\x1b]*\\x1b\\\\",
    "\\x1b\\][0-9]+;[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",
  ].join("|"),
  "y",
);

export function isTerminalReply(data: string): boolean {
  if (data.length === 0) return false;
  let at = 0;
  while (at < data.length) {
    REPLY.lastIndex = at;
    const m = REPLY.exec(data);
    if (!m || m[0].length === 0) return false;
    at += m[0].length;
  }
  return true;
}

export interface InputContext {
  pasting: boolean;
  keyEvent: boolean;
}

export function classifyInput(data: string, ctx: InputContext): InputSource {
  if (ctx.pasting) return "paste";
  if (ctx.keyEvent) return "keyboard";
  return isTerminalReply(data) ? "protocol" : "keyboard";
}

/** 하나라도 사람 것이면 사람(`protocol` 은 모두가 응답일 때만) */
export function mergeSource(prev: InputSource | null, next: InputSource): InputSource {
  if (prev === null || prev === "protocol") return next;
  return prev;
}
