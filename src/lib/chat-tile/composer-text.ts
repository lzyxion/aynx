// 채팅 타일 입력 칸 글 바꾸기 — `FlipComposer` 를 고치지 않고 받은 `<textarea>` 에 글을 넣는 유일한 곳.
// 값을 바꾼 뒤 `input` 사건을 내야 안의 `bind:value` 가 받는다(빼면 보내기 단추 · 보낼 글이 옛 값에 머문다).

export interface ComposerField {
  value: string;
  setSelectionRange(start: number, end: number): void;
  dispatchEvent(ev: Event): boolean;
  focus(opts?: FocusOptions): void;
}

export function setComposerText(el: ComposerField, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.setSelectionRange(text.length, text.length);
  el.focus({ preventScroll: true });
}
