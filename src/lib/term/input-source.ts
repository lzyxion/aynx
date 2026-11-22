/**
 * 터미널 입력의 출처 — 세션 서버 `write` op 가 싣는다(크기 주인 판정). `keyboard` · `paste` 는 사람 입력이라 그 쪽이 크기 주인이 되고,
 * `mouse`(마우스 보고 · 휠이 바뀐 방향키)는 사람 입력이지만 주인을 바꾸지 않는다 — 다른 창 위를 스치기만 해도 크기가 뒤집히면 안 된다.
 * `protocol` 은 xterm 이 스스로 내는 터미널 응답이다.
 * 내용만으로는 못 가르는 겹침이 있다(Ctrl+F3 = `ESC[1;5R` = 커서 위치 답 · 휠 = `ESC[A`) — 키 · 붙여넣기 · 포인터 이벤트 중에 나온 글은 그 출처로 친다.
 * 모르면 키(안전한 쪽 — 반대로 치면 사람이 치는 중에 AI 글이 섞인다).
 */

export type InputSource = "keyboard" | "paste" | "mouse" | "protocol";

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

/** 마우스 보고 하나 — SGR · SGR 픽셀 · urxvt · X10. X10 은 xterm 이 `onBinary` 로 내지만 모양은 받아 둔다. */
const MOUSE = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\d+;\d+;\d+M|\x1b\[M[\x20-\xff]{3}/y;

function wholly(re: RegExp, data: string): boolean {
  if (data.length === 0) return false;
  let at = 0;
  while (at < data.length) {
    re.lastIndex = at;
    const m = re.exec(data);
    if (!m || m[0].length === 0) return false;
    at += m[0].length;
  }
  return true;
}

export function isTerminalReply(data: string): boolean {
  return wholly(REPLY, data);
}

export function isMouseReport(data: string): boolean {
  return wholly(MOUSE, data);
}

export interface InputContext {
  pasting: boolean;
  keyEvent: boolean;
  /** 휠 · 마우스 처리기 안 — 마우스 추적이 없는 대체 화면에서 xterm 이 휠을 방향키로 바꿔 낸다 */
  pointer: boolean;
}

export function classifyInput(data: string, ctx: InputContext): InputSource {
  if (ctx.pasting) return "paste";
  if (ctx.keyEvent) return "keyboard";
  if (isTerminalReply(data)) return "protocol";
  if (ctx.pointer || isMouseReport(data)) return "mouse";
  return "keyboard";
}

const RANK: Record<InputSource, number> = { keyboard: 2, paste: 2, mouse: 1, protocol: 0 };

/** 묶음의 출처 — 키 · 붙여넣기가 하나라도 있으면 그것(주인이 된다), 아니면 마우스, 모두 응답일 때만 `protocol`. 같은 단이면 먼저 온 것. */
export function mergeSource(prev: InputSource | null, next: InputSource): InputSource {
  if (prev === null || RANK[next] > RANK[prev]) return next;
  return prev;
}
