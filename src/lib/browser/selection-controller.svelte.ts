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

/**
 * **선택 컨트롤러** — 순수 모델(`$lib/selection`) 위에 상태 한 칸과 손잡이를 얹은 것.
 *
 * 규칙 자체는 예전부터 한 파일에 있었다(`selection.ts`). 그런데 그것을 **화면에 붙이는
 * 배선**은 파일 타일과 세션 타일에 각각 있었고, 그 배선이 실은 글자 그대로 같았다:
 * `$state` 한 칸, 클릭 핸들러, 우클릭 규칙, 드래그 규칙, 화살표, `Ctrl+A`, Escape, 정리.
 * 한쪽에만 손이 가면 두 타일의 선택 감각이 조용히 갈린다 — 여기 하나로 모은다.
 *
 * ## 상태를 통째로 갈아 끼운다
 *
 * 모든 조작은 새 [`SelectionState`] 를 만들어 대입한다 (`Set` 을 제자리에서 고치지
 * 않는다 — 룬은 `Set` 속을 들여다보지 않아 화면이 따라오지 않는다).
 *
 * ## `$effect` 는 여기 없다
 *
 * 룬 모듈에는 효과를 붙일 컴포넌트 수명이 없다 (docs/log/2026-09-05-refactor-page-split.md
 * 의 규칙). 목록이 바뀐 뒤의 정리는 [`prune`] 이라는 **함수**로만 내고, 그것을 언제 부를지는
 * 컴포넌트가 한 줄로 건다: `$effect(() => sel.prune(order))`.
 */
export class SelectionController {
  #state = $state<SelectionState>(emptySelection());

  /** 지금 선택 한 벌 (앵커·포커스·id 집합) */
  get state(): SelectionState {
    return this.#state;
  }

  /** 골라져 있는 id 들 */
  get ids(): ReadonlySet<string> {
    return this.#state.ids;
  }

  /** 키보드 커서가 앉은 id (없으면 `null`) */
  get focus(): string | null {
    return this.#state.focus;
  }

  /** 배지·메뉴 문구가 보는 개수 (2 이상일 때만 다중용 화면이 된다) */
  get count(): number {
    return this.#state.ids.size;
  }

  has(id: string): boolean {
    return this.#state.ids.has(id);
  }

  /** 통째로 갈아 끼운다 — 드래그가 미리 계산해 둔 선택을 한 틱 뒤에 앉힐 때 쓴다 */
  set(next: SelectionState): void {
    this.#state = next;
  }

  /**
   * 줄 하나를 클릭했다 — 수식 키에 따라 단일 / 토글(Ctrl) / 범위(Shift).
   *
   * `ev` 는 `MouseEvent` 를 그대로 받는다 (`metaKey` 는 macOS 의 ⌘).
   */
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

  /**
   * 우클릭의 선택 규칙 — **이미 골라진 것 위면 선택을 지키고**, 밖이면 그 줄 하나만 고른다.
   * (탐색기의 관례다: 여럿 골라 놓고 우클릭했는데 선택이 하나로 줄면 다중 메뉴가 뜰 수 없다.)
   */
  pickForMenu(id: string, order: readonly string[]): void {
    if (!this.#state.ids.has(id)) this.#state = clickSelect(this.#state, id, {}, order);
  }

  /**
   * 드래그가 실을 선택 — **고른 것을 끌면 선택 전체, 고르지 않은 것을 끌면 그것 하나**.
   *
   * 여기서는 **대입하지 않고 돌려주기만 한다**. WebView2 는 `dragstart` 가 도는 중에 소스
   * 요소가 움직이면 드래그를 통째로 취소하는데, 선택 표시가 바뀌면 줄의 그림이 달라진다 —
   * 그래서 호출부가 이 값을 한 틱 미뤄 [`set`] 으로 앉힌다.
   */
  forDrag(id: string, order: readonly string[]): SelectionState {
    return this.#state.ids.has(id) ? this.#state : clickSelect(this.#state, id, {}, order);
  }

  /**
   * 화살표로 커서를 옮긴다. `wrap` 은 양끝에서 감쌀지 —
   * **두 타일이 일부러 다른 유일한 자리**다 (세션 타일의 목록 보기는 감싸고, 파일 목록은
   * 수천 줄이 흔해 끝에서 맨 위로 튀면 위치 감각이 끊긴다).
   */
  move(order: readonly string[], delta: number, extend: boolean, wrap: boolean): void {
    this.#state = moveFocus(this.#state, order, delta, extend, wrap);
  }

  /** `Ctrl+A` — 전부. 커서는 있던 자리를 지킨다 */
  all(order: readonly string[]): void {
    this.#state = selectAll(order, this.#state.focus);
  }

  /** `Escape` · 빈 곳 클릭 — 아무것도 안 고른 상태로 */
  clear(): void {
    this.#state = clear();
  }

  /** 러버밴드가 매 프레임 부른다 (`base` 는 **드래그를 시작할 때의** 선택) */
  marquee(
    rects: readonly { id: string; rect: Box }[],
    box: Box,
    additive: boolean,
    base: SelectionState,
  ): void {
    this.#state = marqueeSelect(rects, box, additive, base);
  }

  /**
   * 목록이 바뀐 뒤의 뒷정리 — 사라진 id 를 떨어낸다.
   *
   * `pruneSelection` 은 바뀔 것이 없으면 **같은 객체**를 돌려주므로, 이것을 `$effect` 에서
   * 매 프레임 불러도 무한 갱신이 되지 않는다 (대입 자체를 건너뛴다).
   */
  prune(order: readonly string[]): void {
    const next = pruneSelection(this.#state, order);
    if (next !== this.#state) this.#state = next;
  }
}

/** 컨트롤러 하나 — 타일마다 하나씩 만든다 (선택은 타일의 것이지 앱의 것이 아니다) */
export function createSelection(): SelectionController {
  return new SelectionController();
}
