/**
 * 다중 선택 모델(순수 함수) — 모든 함수는 새 상태를 돌려준다. `Set` 은 룬이 속을 들여다보지 않아 제자리에서 고치면 화면이 따라오지 않는다.
 * `focus` 는 선택과 다르다(언제나 하나, 선택 밖일 수 있다). `anchor` 는 Shift 가 건드리지 않는다 — 없으면 같은 앵커에서 범위를 늘였다 줄였다 할 수 없다.
 */

export interface SelectionState {
  anchor: string | null;
  focus: string | null;
  ids: ReadonlySet<string>;
}

export interface ClickMods {
  ctrl?: boolean;
  shift?: boolean;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function emptySelection(): SelectionState {
  return { anchor: null, focus: null, ids: new Set() };
}

export function clear(): SelectionState {
  return emptySelection();
}

function span(order: readonly string[], a: string | null, b: string): string[] {
  const j = order.indexOf(b);
  if (j < 0) return [];
  const i = a === null ? -1 : order.indexOf(a);
  if (i < 0) return [b];
  return i <= j ? order.slice(i, j + 1) : order.slice(j, i + 1);
}

/** `order` 는 지금 화면에 보이는 순서여야 한다(검색 중이면 평면 결과의 순서) */
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

/** 포커스는 있던 자리를 지킨다 — 커서가 튀면 이어서 Shift+화살표로 좁힐 때 엉뚱한 데서 시작한다 */
export function selectAll(order: readonly string[], focus: string | null = null): SelectionState {
  const keep = focus !== null && order.includes(focus) ? focus : (order[0] ?? null);
  return { anchor: order[0] ?? null, focus: keep, ids: new Set(order) };
}

/** 아이콘 보기의 줄 이동(±칸 수)은 감싸지 않는다(`wrap`) — 칸 수만큼 감싸면 엉뚱한 열로 튄다 */
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
    next = delta > 0 ? 0 : n - 1;
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

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** `base` 는 드래그를 시작할 때의 선택이어야 한다 — 매 프레임의 결과를 base 로 삼으면 사각형을 되돌려도 지나간 항목이 남는다 */
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

/** 사라진 id 가 남으면 "N개 선택" 에 계속 세어지고 Delete 가 화면에 없는 것을 지운다 */
export function pruneSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const alive = new Set(order);
  const ids = new Set<string>();
  for (const id of state.ids) if (alive.has(id)) ids.add(id);
  const focus = state.focus !== null && alive.has(state.focus) ? state.focus : (order[0] ?? null);
  const anchor = state.anchor !== null && alive.has(state.anchor) ? state.anchor : focus;
  // 바뀐 것이 없으면 같은 객체 — 호출부가 `$state` 에 매번 대입하므로 새 객체면 무한히 다시 그린다.
  if (ids.size === state.ids.size && focus === state.focus && anchor === state.anchor) return state;
  return { anchor, focus, ids };
}
