/**
 * **다중 선택 모델** — 탐색기의 선택 규칙을 담은 순수 함수 묶음
 * (docs/log/2026-09-04-hosts-multiselect.md).
 *
 * 여기에는 DOM 도, Svelte 도, 호스트라는 개념도 없다. 아는 것은 **문자열 id 와 그 순서**
 * 뿐이라 세션 타일(`Sidebar`)이 처음 쓰지만 SFTP·로컬 파일 브라우저도 같은 규칙을 그대로
 * 물려받을 수 있다 — 선택은 "무엇을 고르는가" 와 무관하게 늘 같은 관례(클릭·Ctrl·Shift·
 * 화살표·러버밴드)를 따르기 때문이다. 브라우저마다 손으로 다시 짜면 한쪽에서만 Shift 범위가
 * 어긋나는 식으로 조용히 갈린다.
 *
 * **상태는 세 조각이다.**
 *
 * - `ids`   : 지금 골라져 있는 것들. 조작(열기·이동·복사·제거)의 대상이다.
 * - `focus` : 키보드 커서가 앉은 한 곳. 화살표가 움직이는 것은 이 값이고, 화면에는 링으로
 *             그린다. **선택과 다르다** — 포커스는 언제나 하나뿐이고, 선택 밖에 있을 수도
 *             있다(Ctrl+화살표를 넣게 되면 그렇다).
 * - `anchor`: Shift 범위의 **고정된 한쪽 끝**. 클릭·Ctrl+클릭이 새로 박고, Shift 는 건드리지
 *             않는다. 이 값이 따로 없으면 Shift+클릭을 두 번 했을 때 두 번째 범위가 첫
 *             범위의 끝에서 다시 시작해 "늘렸다 줄였다" 가 안 된다.
 *
 * 모든 함수는 **새 상태를 돌려준다** (제자리에서 고치지 않는다). 호출부가 `state = f(state, …)`
 * 로 통째로 갈아 끼우면 Svelte 의 `$state` 가 그 대입 하나만 보고 다시 그린다 — `Set` 은
 * 룬이 속을 들여다보지 않으므로, 안에서 `add`/`delete` 를 하면 화면이 따라오지 않는다.
 */

/** 선택 한 벌 — 세 조각의 뜻은 파일 머리말 참고 */
export interface SelectionState {
  /** Shift 범위의 고정된 끝 (없으면 `null`) */
  anchor: string | null;
  /** 키보드 커서가 앉은 항목 (없으면 `null`) */
  focus: string | null;
  /** 골라져 있는 항목들 */
  ids: ReadonlySet<string>;
}

/** 클릭에 붙어 온 수식 키 — `ctrl` 은 토글, `shift` 는 범위 */
export interface ClickMods {
  ctrl?: boolean;
  shift?: boolean;
}

/**
 * 러버밴드 판정에 쓰는 사각형. `DOMRect` 가 그대로 들어맞으므로(구조적 타이핑) 호출부는
 * `getBoundingClientRect()` 결과를 변환 없이 넘길 수 있다.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 아무것도 고르지 않은 상태 */
export function emptySelection(): SelectionState {
  return { anchor: null, focus: null, ids: new Set() };
}

/** `clear()` — 이름만 다른 [`emptySelection`] (호출부에서 뜻이 또렷하게 읽히도록) */
export function clear(): SelectionState {
  return emptySelection();
}

/**
 * `order` 안에서 `a`..`b` 구간(양 끝 포함). `a` 가 없거나 목록에 없으면 `b` 하나만,
 * `b` 마저 목록에 없으면 빈 배열이다.
 */
function span(order: readonly string[], a: string | null, b: string): string[] {
  const j = order.indexOf(b);
  if (j < 0) return [];
  const i = a === null ? -1 : order.indexOf(a);
  if (i < 0) return [b];
  return i <= j ? order.slice(i, j + 1) : order.slice(j, i + 1);
}

/**
 * 항목 하나를 클릭했다 — 탐색기의 세 갈래 그대로다.
 *
 * - 수식 키 없음: **단일 선택**. 앵커와 포커스가 그 자리로 간다.
 * - `Ctrl`     : **토글**. 이미 골라져 있으면 빼고, 아니면 더한다. 앵커도 그 자리로 옮긴다 —
 *                Ctrl 로 짚은 곳이 다음 Shift 범위의 시작이라는 것이 탐색기의 감각이다.
 * - `Shift`    : 앵커에서 여기까지 **범위**. 앵커는 그대로 두어야 같은 앵커에서 범위를
 *                늘였다 줄였다 할 수 있다. `Ctrl+Shift` 면 기존 선택에 범위를 **더한다**.
 *
 * `order` 는 **지금 화면에 보이는 순서**여야 한다 (검색 중이면 평면 결과의 순서). 범위는
 * 보이는 대로 이어지는 것이지 파일 순서로 이어지는 것이 아니다.
 */
export function clickSelect(
  state: SelectionState,
  id: string,
  mods: ClickMods,
  order: readonly string[],
): SelectionState {
  const ctrl = mods.ctrl ?? false;
  const shift = mods.shift ?? false;

  if (shift) {
    const base = state.anchor ?? state.focus;
    const picked = span(order, base, id);
    // 범위를 못 만들었으면(대상이 목록 밖) 단일 선택으로 떨어진다 — 아무 일도 안 하는 것보다
    // 클릭한 것이 골라지는 편이 예측 가능하다.
    if (picked.length === 0) return { anchor: id, focus: id, ids: new Set([id]) };
    const ids = ctrl ? new Set([...state.ids, ...picked]) : new Set(picked);
    return { anchor: base ?? id, focus: id, ids };
  }

  if (ctrl) {
    const ids = new Set(state.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { anchor: id, focus: id, ids };
  }

  return { anchor: id, focus: id, ids: new Set([id]) };
}

/**
 * 전부 선택 (`Ctrl+A`). 포커스는 **있던 자리를 지킨다** — 지금 보고 있던 곳에서 커서가
 * 튀면 이어서 Shift+화살표로 좁힐 때 엉뚱한 데서 시작한다. 있던 자리가 목록에 없으면 첫 항목.
 */
export function selectAll(order: readonly string[], focus: string | null = null): SelectionState {
  const keep = focus !== null && order.includes(focus) ? focus : (order[0] ?? null);
  return { anchor: order[0] ?? null, focus: keep, ids: new Set(order) };
}

/**
 * 화살표로 포커스를 옮긴다.
 *
 * - `extend`(Shift+화살표): 앵커에서 새 포커스까지 **범위**로 넓힌다 (앵커는 그대로).
 * - 아니면: 그 자리 **하나만** 골라진다 (앵커도 따라간다).
 *
 * `wrap` 은 양끝에서 감쌀지 — 목록 보기의 ↑↓ 는 감싸고(예전부터의 동작), 아이콘 보기의
 * 줄 이동(±칸 수)은 감싸지 않는다 (칸 수만큼 감싸면 엉뚱한 열로 튀어 위치 감각이 끊긴다).
 * 포커스가 아직 없으면 방향에 따라 첫/마지막 항목에서 시작한다.
 */
export function moveFocus(
  state: SelectionState,
  order: readonly string[],
  delta: number,
  extend: boolean,
  wrap = false,
): SelectionState {
  const n = order.length;
  if (n === 0) return state;
  const at = state.focus === null ? -1 : order.indexOf(state.focus);
  let next: number;
  if (at < 0) {
    next = delta > 0 ? 0 : n - 1; // 커서가 없던 상태 — 진행 방향의 첫 칸에서 시작한다
  } else if (wrap) {
    next = (((at + delta) % n) + n) % n;
  } else {
    next = Math.min(n - 1, Math.max(0, at + delta));
  }
  const id = order[next];
  if (!extend) return { anchor: id, focus: id, ids: new Set([id]) };
  const base = state.anchor ?? state.focus ?? id;
  return { anchor: base, focus: id, ids: new Set(span(order, base, id)) };
}

/** 두 사각형이 겹치는가 — 변이 스치기만 하는 것은 겹친 것으로 치지 않는다 */
function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * **러버밴드(마퀴)** — 사각형에 걸친 항목을 고른다.
 *
 * `additive`(Ctrl 을 누른 채 그었다)면 `base` 에 **더하고**, 아니면 걸린 것만 남긴다.
 * `base` 는 **드래그를 시작할 때의 선택**이어야 한다 — 매 프레임의 결과를 다시 base 로
 * 삼으면 사각형을 되돌려도 한 번 지나간 항목이 그대로 남는다 (되돌리기가 안 되는 마퀴).
 *
 * 포커스·앵커는 걸린 것 중 **화면 순서상 첫 항목**으로 간다 (`rects` 는 보이는 순서로
 * 온다). 아무것도 안 걸렸으면 `additive` 일 때는 base 의 것을 지키고, 아니면 비운다.
 */
export function marqueeSelect(
  rects: readonly { id: string; rect: Box }[],
  box: Box,
  additive: boolean,
  base: SelectionState = emptySelection(),
): SelectionState {
  const hit: string[] = [];
  for (const r of rects) if (overlaps(r.rect, box)) hit.push(r.id);
  const ids = additive ? new Set([...base.ids, ...hit]) : new Set(hit);
  const head = hit[0] ?? (additive ? base.focus : null);
  return { anchor: head, focus: head, ids };
}

/**
 * 목록이 바뀐 뒤의 뒷정리 — 사라진 id 를 선택·포커스·앵커에서 떨어낸다.
 *
 * 폴더를 옮기거나 호스트를 지우면(또는 검색어를 치면) 골라 두었던 것이 화면에서 사라진다.
 * 그대로 두면 보이지 않는 항목이 "N개 선택" 에 계속 세어지고, Delete 가 화면에 없는 것을
 * 지운다. 없어진 포커스는 **첫 항목**으로 되돌린다 (커서가 아예 사라지면 화살표가 먹지 않는다).
 */
export function pruneSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const alive = new Set(order);
  const ids = new Set<string>();
  for (const id of state.ids) if (alive.has(id)) ids.add(id);
  const focus = state.focus !== null && alive.has(state.focus) ? state.focus : (order[0] ?? null);
  const anchor = state.anchor !== null && alive.has(state.anchor) ? state.anchor : focus;
  // 아무것도 안 바뀌었으면 **같은 객체**를 돌려준다 — 호출부가 이것을 `$state` 에 매번
  // 대입하므로, 새 객체를 만들면 목록이 그대로여도 무한히 다시 그린다.
  if (ids.size === state.ids.size && focus === state.focus && anchor === state.anchor) return state;
  return { anchor, focus, ids };
}
