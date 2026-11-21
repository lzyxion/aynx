/**
 * 탭 바 드롭의 구역 · 이동량(순수) — 처음 찍은 client rect 만 겨눈다.
 * 움직인 DOM 을 다시 읽으면 탭이 비켜서는 순간 삽입 · 머무름이 뒤집힌다.
 */
import { dragTabHoverAction, type TabHoverDrag } from "$lib/tab-hover";

export type TabDropDrag = Exclude<TabHoverDrag, null> | "hosts" | null;
export interface TabDropSnapshotItem {
  id: string;
  rect: Pick<DOMRect, "left" | "right" | "top" | "width" | "height">;
}
export type TabDropTarget =
  | { kind: "insert"; beforeId: string; end?: never }
  | { kind: "insert"; end: true; beforeId?: never }
  | { kind: "dwell"; tabId: string };
export interface TabDropPreview {
  offsets: Record<string, number>;
  ghost: { left: number; top: number; width: number; height: number } | null;
}

/** 커서 기준 판정 — 타일 · 호스트 · 다른 창 탭. 이 창 탭은 `tabReorderTarget` 이 맡는다 */
export function tabDropTarget({
  snapshot, clientX, kind, activeId, draggedTabId,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  clientX: number;
  kind: TabDropDrag;
  activeId: string | null;
  draggedTabId: string | null;
}): TabDropTarget | null {
  if (kind === null || !Number.isFinite(clientX)) return null;
  if (snapshot.length === 0) return { kind: "insert", end: true };
  const insert = (index: number): TabDropTarget | null => {
    const source = kind === "tab" ? snapshot.findIndex((tab) => tab.id === draggedTabId) : -1;
    // 자기 바로 앞·뒤는 순서가 그대로다 — 드롭 자리도 미리보기도 비운다.
    if (source >= 0 && (index === source || index === source + 1)) return null;
    return index === snapshot.length
      ? { kind: "insert", end: true }
      : { kind: "insert", beforeId: snapshot[index].id };
  };
  if (clientX < snapshot[0].rect.left) return insert(0);
  for (let i = 0; i < snapshot.length; i++) {
    const tab = snapshot[i];
    if (clientX < tab.rect.left) return insert(i);
    if (i + 1 < snapshot.length && clientX >= snapshot[i + 1].rect.left) continue;
    if (clientX >= tab.rect.right) continue;
    const dwell = dragTabHoverAction({
      kind: kind === "pane" ? kind : null, overId: tab.id, activeId, pendingId: null,
    }) === "arm";
    const fraction = (clientX - tab.rect.left) / tab.rect.width;
    if (dwell && fraction >= 0.25 && fraction < 0.75) return { kind: "dwell", tabId: tab.id };
    return insert(fraction < (dwell ? 0.25 : 0.5) ? i : i + 1);
  }
  return insert(snapshot.length);
}

/**
 * 커서가 아니라 따라오는 탭의 가운데로 정한다(크롬 규칙). `offset` 은 `tabDragOffset` 의 값이어야 보이는 탭과 판정이 같다.
 * 끝 모서리에 닿아도 넘은 것으로 친다 — 스트립 끝에 갇힌 탭은 폭이 달라 가운데가 못 닿을 수 있다.
 */
export function tabReorderTarget({
  snapshot, draggedTabId, offset,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  draggedTabId: string | null;
  offset: number | null;
}): TabDropTarget | null {
  const source = snapshot.findIndex((tab) => tab.id === draggedTabId);
  if (source < 0 || offset === null || !Number.isFinite(offset)) return null;
  const center = (rect: TabDropSnapshotItem["rect"]) => rect.left + rect.width / 2;
  const width = snapshot[source].rect.width;
  const left = snapshot[source].rect.left + offset;
  const dragged = left + width / 2;
  let passed = 0;
  for (let i = 0; i < snapshot.length; i++) {
    const rect = snapshot[i].rect;
    if (i < source && dragged > center(rect) && left > rect.left) passed++;
    if (i > source && (dragged >= center(rect) || left + width >= rect.right)) passed++;
  }
  if (passed === source) return null;
  const index = passed < source ? passed : passed + 1;
  return index === snapshot.length
    ? { kind: "insert", end: true }
    : { kind: "insert", beforeId: snapshot[index].id };
}

/** 이웃은 가운데를 넘는 순간 비켜서므로 겹침은 절반 남짓이 한계다 — `min` 을 그보다 올리면 머무름이 서지 않는다 */
export function tabOverlapTarget({
  snapshot, draggedTabId, offset, offsets, min = 0.3,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  draggedTabId: string | null;
  offset: number | null;
  offsets: Readonly<Record<string, number>>;
  min?: number;
}): string | null {
  const source = snapshot.find((tab) => tab.id === draggedTabId);
  if (!source || offset === null || !Number.isFinite(offset)) return null;
  const left = source.rect.left + offset;
  const right = left + source.rect.width;
  let best: string | null = null;
  let bestFraction = min;
  for (const tab of snapshot) {
    if (tab.id === draggedTabId) continue;
    const tabLeft = tab.rect.left + (offsets[tab.id] ?? 0);
    const overlap = Math.min(right, tabLeft + tab.rect.width) - Math.max(left, tabLeft);
    const fraction = overlap / Math.min(tab.rect.width, source.rect.width);
    if (fraction >= bestFraction) {
      best = tab.id;
      bestFraction = fraction;
    }
  }
  return best;
}

// 폭 대신 left 차이를 쓴다 — gap(과 이웃 사이의 겹침)이 피치에 함께 들어 있다.
function tabPitch(snapshot: readonly TabDropSnapshotItem[], index: number, gap: number): number {
  return snapshot.length === 1
    ? snapshot[index].rect.width + gap
    : index + 1 < snapshot.length
      ? snapshot[index + 1].rect.left - snapshot[index].rect.left
      : snapshot[index].rect.left - snapshot[index - 1].rect.left;
}

/** 바 밖으로 빠진 탭의 뒤만 당긴다 */
export function tabDragCollapse({
  snapshot, draggedTabId, gap = 0,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  draggedTabId: string | null;
  gap?: number;
}): { offsets: Record<string, number>; newTabOffset: number } {
  const offsets: Record<string, number> = {};
  const source = snapshot.findIndex((tab) => tab.id === draggedTabId);
  if (source < 0) return { offsets, newTabOffset: 0 };
  const pitch = tabPitch(snapshot, source, gap);
  for (let i = source + 1; i < snapshot.length; i++) offsets[snapshot[i].id] = -pitch;
  return { offsets, newTabOffset: -pitch };
}

export function tabDropPreview({
  snapshot, target, draggedTabId, fallbackWidth = 200, gap = 0,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  target: TabDropTarget | null;
  draggedTabId: string | null;
  fallbackWidth?: number;
  gap?: number;
}): TabDropPreview {
  const offsets: Record<string, number> = {};
  const empty = { offsets, ghost: null };
  if (target?.kind !== "insert") return empty;
  const index = target.end ? snapshot.length : snapshot.findIndex((tab) => tab.id === target.beforeId);
  if (index < 0) return empty;
  const pitchAt = (i: number): number => tabPitch(snapshot, i, gap);
  const source = snapshot.findIndex((tab) => tab.id === draggedTabId);
  if (source >= 0) {
    if (index === source || index === source + 1) return empty;
    const pitch = pitchAt(source);
    const endLeft = snapshot.at(-1)!.rect.left + pitchAt(snapshot.length - 1);
    const left = index === snapshot.length ? endLeft : snapshot[index].rect.left;
    offsets[snapshot[source].id] = left - snapshot[source].rect.left - (index > source ? pitch : 0);
    for (let i = 0; i < snapshot.length; i++) {
      if (index <= i && i < source) offsets[snapshot[i].id] = pitch;
      if (source < i && i < index) offsets[snapshot[i].id] = -pitch;
    }
    return { offsets, ghost: null };
  }
  if (snapshot.length === 0) {
    return { offsets, ghost: { left: 0, top: 0, width: fallbackWidth, height: 28 } };
  }
  const pitch = snapshot.length === 1 ? pitchAt(0)
    : (snapshot.at(-1)!.rect.left - snapshot[0].rect.left) / (snapshot.length - 1);
  const refIndex = Math.min(index, snapshot.length - 1);
  const ref = snapshot[refIndex].rect;
  for (let i = index; i < snapshot.length; i++) offsets[snapshot[i].id] = pitch;
  return {
    offsets,
    ghost: {
      left: index === snapshot.length ? ref.left + pitchAt(refIndex) : ref.left,
      top: ref.top,
      width: pitch + ref.width - pitchAt(refIndex),
      height: ref.height,
    },
  };
}

/** 이 창 탭의 삽입 판정(`tabReorderTarget`)도 이 값을 쓴다 */
export function tabDragOffset({
  snapshot, bounds, clientX, grab, draggedTabId,
}: {
  snapshot: readonly TabDropSnapshotItem[];
  clientX: number;
  bounds: Pick<DOMRect, "left" | "right">;
  grab: number | null;
  draggedTabId: string | null;
}): number | null {
  const source = snapshot.find((tab) => tab.id === draggedTabId);
  if (!source || grab === null) return null;
  const left = Math.max(bounds.left, Math.min(clientX - grab, bounds.right - source.rect.width));
  return left - source.rect.left;
}
