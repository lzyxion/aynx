// **폰 입력 칸의 키 판정**(원격 웹 R5 · 10-20 — 입력 칸이 폰의 기본 입력 방식) — 순수 모듈. 칸(`mobile/MobileKeys.svelte`)은 글을 모아
// 한 번에 보내지만, 칸이 비었을 때의 몇 키와 끈적 Ctrl 은 셸에 곧장 가야 한다. 그 판정만 여기서 한다(보내는 길은 칸이 `term-actions` 로).
//
// - 칸이 빈 채 Backspace = 셸에 DEL(`\x7f`) — 이미 보낸 글자를 지운다. 조합 중(`isComposing`)이면 IME 의 몫이라 손대지 않는다.
//   키보드가 실제 Backspace 키를 내지 않고 지우기 입력(`beforeinput` 의 `deleteContentBackward`)만 내는 경우도 같다
//   (`term/handheld-input` 의 빈 textarea 지우기와 같은 결 — 키로 이미 보낸 것은 부르는 쪽이 한 번만 센다).
//   빈 칸의 Enter 는 따로 셀 것이 없다 — 폼 제출이 빈 글 + Enter 를 보낸다.
// - 끈적 Ctrl 이 걸린 채 빈 칸에 글자 하나를 쓰면 그 글자를 곧장 키로 보낸다 — Ctrl 은 터미널의 사람 키 문(`sendInput`)이 바로 입력과
//   똑같이 붙이고 푼다(`ctrlOf` — 붙일 수 없는 글자면 그대로 보내고 푼다).

/** 셸의 지우기 키(xterm 의 Backspace 와 같은 글자) */
export const DEL = "\x7f";

/** 입력 칸 keydown 하나 → 셸에 곧장 보낼 키(`null` = 칸이 그대로 처리) */
export function emptyFieldKey(key: string, value: string, composing: boolean): string | null {
  if (composing || value !== "") return null;
  return key === "Backspace" ? DEL : null;
}

/** 입력 칸 beforeinput · input 하나 → 빈 칸의 뒤로 지우기라 셸에 DEL 을 보낼까 */
export function emptyFieldDelete(inputType: string, value: string, composing: boolean): boolean {
  if (composing || value !== "") return false;
  return inputType === "deleteContentBackward" || inputType === "deleteWordBackward";
}

/**
 * 입력 칸 input 하나 → 끈적 Ctrl 로 곧장 보낼 글자(`null` = 칸에 둔다). 빈 칸(`prev`)에서 글자 **하나**가 막 생겼을 때만 —
 * 이미 쓰던 글 뒤에 붙인 글자나 여러 글자(붙여넣기 · 추천 낱말)는 칸에 둔다.
 */
export function armedFieldChar(prev: string, value: string, armed: boolean): string | null {
  if (!armed || prev !== "") return null;
  return [...value].length === 1 ? value : null;
}
