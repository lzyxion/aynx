// 폰 입력 칸의 키 판정 — 순수 모듈. 칸은 글을 모아 한 번에 보내지만, 빈 칸의 지우기와 끈적 Ctrl 은 셸에 곧장 가야 한다.
// 조합 중(`isComposing`)이면 IME 의 몫이라 손대지 않는다.

export const DEL = "\x7f";

export function emptyFieldKey(key: string, value: string, composing: boolean): string | null {
  if (composing || value !== "") return null;
  return key === "Backspace" ? DEL : null;
}

/** 실제 Backspace 키 없이 `deleteContentBackward` 만 내는 키보드가 있다 — 키로 이미 보낸 것은 부르는 쪽이 한 번만 센다 */
export function emptyFieldDelete(inputType: string, value: string, composing: boolean): boolean {
  if (composing || value !== "") return false;
  return inputType === "deleteContentBackward" || inputType === "deleteWordBackward";
}

/** 빈 칸에서 글자 하나가 막 생겼을 때만 — 붙여넣기 · 추천 낱말(여러 글자)은 칸에 둔다 */
export function armedFieldChar(prev: string, value: string, armed: boolean): string | null {
  if (!armed || prev !== "") return null;
  return [...value].length === 1 ? value : null;
}
