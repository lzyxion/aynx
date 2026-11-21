import { tick } from "svelte";

/** 메뉴 안 이름 칸 한 벌. 칸의 `<input>` 에는 반드시 `data-inline-edit` 을 붙인다 — 그 표를 보고 전역 `Ctrl+D`(타일 닫기) · `Alt+화살표` 가 비켜난다 */
export interface InlineEdit {
  value: string;
  error: string | null;
  el: HTMLInputElement | null;
}

export function createInlineEdit(): InlineEdit {
  const edit: InlineEdit = $state({ value: "", error: null, el: null });
  return edit;
}

export function beginInlineEdit(edit: InlineEdit, initial = ""): void {
  edit.value = initial;
  edit.error = null;
}

/** `bind:this` 는 DOM 갱신 뒤에야 채워진다 — `tick()` 없이 모드를 바꾼 같은 프레임에 부르면 `el` 이 `null` 이다 */
export async function focusInlineEdit(edit: InlineEdit, select = false): Promise<void> {
  await tick();
  if (select) edit.el?.select();
  else edit.el?.focus();
}

export function resetInlineEdit(edit: InlineEdit): void {
  edit.value = "";
  edit.error = null;
}
