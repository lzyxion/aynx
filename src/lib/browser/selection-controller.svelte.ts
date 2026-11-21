import {
  clear,
  clickSelect,
  emptySelection,
  marqueeSelect,
  moveFocus,
  pruneSelection,
  selectAll,
  type Box,
  type SelectionState,
} from "$lib/selection";

/** 모든 조작은 새 [`SelectionState`] 를 대입한다 — `Set` 을 제자리에서 고치면 룬이 들여다보지 않아 화면이 따라오지 않는다 */
export class SelectionController {
  #state = $state<SelectionState>(emptySelection());

  get state(): SelectionState {
    return this.#state;
  }

  get ids(): ReadonlySet<string> {
    return this.#state.ids;
  }

  get focus(): string | null {
    return this.#state.focus;
  }

  get count(): number {
    return this.#state.ids.size;
  }

  has(id: string): boolean {
    return this.#state.ids.has(id);
  }

  set(next: SelectionState): void {
    this.#state = next;
  }

  click(
    ev: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    id: string,
    order: readonly string[],
  ): void {
    this.#state = clickSelect(
      this.#state,
      id,
      { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey },
      order,
    );
  }

  pickForMenu(id: string, order: readonly string[]): void {
    if (!this.#state.ids.has(id)) this.#state = clickSelect(this.#state, id, {}, order);
  }

  /** 대입하지 않고 돌려주기만 한다 — WebView2 는 `dragstart` 중에 소스 요소가 바뀌면 드래그를 취소하므로 호출부가 한 틱 미뤄 [`set`] 으로 앉힌다 */
  forDrag(id: string, order: readonly string[]): SelectionState {
    return this.#state.ids.has(id) ? this.#state : clickSelect(this.#state, id, {}, order);
  }

  /** `wrap` 은 두 타일이 일부러 다르다 — 파일 목록은 수천 줄이 흔해 끝에서 맨 위로 튀면 위치 감각이 끊긴다 */
  move(order: readonly string[], delta: number, extend: boolean, wrap: boolean): void {
    this.#state = moveFocus(this.#state, order, delta, extend, wrap);
  }

  all(order: readonly string[]): void {
    this.#state = selectAll(order, this.#state.focus);
  }

  clear(): void {
    this.#state = clear();
  }

  marquee(
    rects: readonly { id: string; rect: Box }[],
    box: Box,
    additive: boolean,
    base: SelectionState,
  ): void {
    this.#state = marqueeSelect(rects, box, additive, base);
  }

  /** `pruneSelection` 은 바뀔 것이 없으면 같은 객체를 돌려준다 — 대입을 건너뛰어 `$effect` 에서 불러도 무한 갱신이 되지 않는다 */
  prune(order: readonly string[]): void {
    const next = pruneSelection(this.#state, order);
    if (next !== this.#state) this.#state = next;
  }
}

export function createSelection(): SelectionController {
  return new SelectionController();
}
