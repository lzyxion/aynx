/**
 * **터미널 입력의 출처** — 세션 서버의 `write` op 가 싣는다(오케스트레이션 5단계 · 설계 C-4 ③).
 *
 * - `keyboard` — 사람이 친 키(기본값). `paste` — 사람이 붙여넣은 글(Ctrl+V · 우클릭 · 블록 넘기기). 둘 다 **사람 개입**이다:
 *   그 타일이 오케스트레이션 작업자면 서버가 개입 잠금(60초) · 초안 표시를 건다.
 * - `protocol` — xterm 이 **스스로** 내보내는 터미널 응답(DSR 커서 위치 · DA · DECRQM 답 · XTVERSION · OSC 색 답 · 포커스 이벤트).
 *   사람 개입이 아니다 — 창이 작업자 타일을 보여 주기만 해도 CLI 의 질의에 xterm 이 답한다.
 *
 * 판정은 **순수 함수**([`classifyInput`])다. 내용만으로는 가를 수 없는 겹침이 있다(Ctrl+F3 = `ESC[1;5R` 는 커서 위치 답과 같은
 * 모양) — 그래서 키 이벤트 · 붙여넣기 이벤트가 도는 중에 나온 글은 내용과 상관없이 사람 것으로 친다(`ctx`). 모르면 사람(안전한 쪽 —
 * 개입으로 잘못 치면 자동 전달이 멈출 뿐이고, 반대는 사람이 치는 중에 AI 글이 섞인다). 마우스 보고(`ESC[<…M`)도 사람이다.
 */

export type InputSource = "keyboard" | "paste" | "protocol";

/** 응답 하나의 모양 — 아래 중 하나로 **통째로** 맞아야 한다(여러 응답이 이어 붙은 것도 받는다). */
const REPLY = new RegExp(
  [
    // CSI 답: 커서 위치(`R` — DECXCPR `?` 포함) · DA1(`?…c`) · DA2(`>…c`) · 장치 상태(`n`) · 창 보고(`t`) · DECRQM(`$y`) · kitty 키보드(`?…u`)
    "\\x1b\\[\\?[0-9;]*(?:R|c|n|\\$y|u)",
    "\\x1b\\[>[0-9;]*c",
    "\\x1b\\[[0-9;]*(?:R|n|t|\\$y)",
    // 포커스 이벤트(키로는 나올 수 없다)
    "\\x1b\\[[IO]",
    // DCS 답(DECRQSS `P1$r…` · XTVERSION `P>|…` · XTGETTCAP `P1+r…`) — ST 로 끝난다
    "\\x1bP[0-9>]?[!-~][^\\x1b]*\\x1b\\\\",
    // OSC 답(색 질의 4 · 10 · 11 · 12 …) — BEL 또는 ST 로 끝난다
    "\\x1b\\][0-9]+;[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",
  ].join("|"),
  "y",
);

/** 이 글이 통째로 터미널 응답(들)인가 — 순수. 빈 글은 아니다. */
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

/** 지금 도는 사건 — 붙여넣기 · 키 이벤트 처리 중이면 그 사람의 것이다. */
export interface InputContext {
  pasting: boolean;
  keyEvent: boolean;
}

/** xterm `onData` 로 나온 글의 출처 — 순수. */
export function classifyInput(data: string, ctx: InputContext): InputSource {
  if (ctx.pasting) return "paste";
  if (ctx.keyEvent) return "keyboard";
  return isTerminalReply(data) ? "protocol" : "keyboard";
}

/**
 * 한 번에 보낼 글들을 묶을 때의 출처 — 하나라도 사람 것이면 사람(`protocol` 은 모두가 응답일 때만). 순수.
 * 사람 둘이 섞이면 먼저 것을 둔다(어느 쪽이든 개입이다).
 */
export function mergeSource(prev: InputSource | null, next: InputSource): InputSource {
  if (prev === null || prev === "protocol") return next;
  return prev;
}
