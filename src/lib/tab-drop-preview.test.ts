import { describe, expect, it } from "vitest";
import { tabDropTarget, tabReorderTarget, tabDropPreview, tabDragOffset, tabDragCollapse, tabOverlapTarget, type TabDropSnapshotItem, type TabDropDrag } from "$lib/tab-drop-preview";

const item = (id: string, left: number, width = 200): TabDropSnapshotItem => ({
  id, rect: { left, right: left + width, top: 20, width, height: 28 },
});
const snapshot = [item("a", 100), item("b", 304), item("c", 508), item("d", 712)];
const before = (beforeId: string) => ({ kind: "insert" as const, beforeId });
const end = { kind: "insert" as const, end: true as const };
const target = (clientX: number, overrides: Partial<Parameters<typeof tabDropTarget>[0]> = {}) =>
  tabDropTarget({ snapshot, clientX, kind: "pane", activeId: "a", draggedTabId: null, ...overrides });
const preview = (overrides: Partial<Parameters<typeof tabDropPreview>[0]> = {}) =>
  tabDropPreview({ snapshot, target: before("b"), draggedTabId: null, ...overrides });

describe("tabDropTarget — 처음 찍은 탭의 세 구역", () => {
  it("타일은 왼쪽 25%·가운데 50%·오른쪽 25% 를 나눈다", () => {
    expect(target(353)).toEqual(before("b"));
    expect(target(354)).toEqual({ kind: "dwell", tabId: "b" });
    expect(target(453)).toEqual({ kind: "dwell", tabId: "b" });
    expect(target(454)).toEqual(before("c"));
  });

  it("활성 탭에는 가운데가 없어 반으로 가른다", () => {
    expect(target(199)).toEqual(before("a"));
    expect(target(200)).toEqual(before("b"));
  });

  it.each<TabDropDrag>(["hosts", "tab"])("%s 는 비활성 탭도 머무름 없이 반으로 가른다", (kind) => {
    expect(target(403, { kind })).toEqual(before("b"));
    expect(target(404, { kind })).toEqual(before("c"));
    for (const x of [354, 400, 453]) expect(target(x, { kind })?.kind).toBe("insert");
  });

  it("끄는 탭 자신은 비활성이어도 머무르거나 미리보지 않는다", () => {
    for (const x of [305, 370, 403, 404, 440, 503]) {
      expect(target(x, { kind: "tab", draggedTabId: "b" })).toBeNull();
    }
  });

  it("탭 드래그에서 자기 바로 앞·뒤는 변화가 없다", () => {
    expect(target(290, { kind: "tab", draggedTabId: "b" })).toBeNull();
    expect(target(510, { kind: "tab", draggedTabId: "b" })).toBeNull();
    expect(target(99, { kind: "tab", draggedTabId: "a" })).toBeNull();
    expect(target(999, { kind: "tab", draggedTabId: "d" })).toBeNull();
    expect(target(909, { kind: "tab", draggedTabId: "a" })).toEqual(end);
  });

  it("첫 탭 왼쪽·탭 사이 gap·마지막 오른쪽 빈 곳은 삽입 자리다", () => {
    expect(target(99)).toEqual(before("a"));
    expect(target(302)).toEqual(before("b"));
    expect(target(912)).toEqual(end);
    expect(target(999)).toEqual(end);
    expect(target(900)).toEqual(end);
  });

  it("다른 창 탭은 로컬 원본 id 없이 커서 반반으로 자리를 고른다", () => {
    expect(target(403, { kind: "tab", draggedTabId: null })).toEqual(before("b"));
    expect(target(404, { kind: "tab", draggedTabId: null })).toEqual(before("c"));
    expect(target(404, { kind: "tab", draggedTabId: null, activeId: null })).toEqual(before("c"));
  });

  it("타일은 같은 글자의 탭 id 를 끄는 것으로 보지 않는다", () => {
    expect(target(404, { draggedTabId: "b" })).toEqual({ kind: "dwell", tabId: "b" });
  });

  it("활성 탭이 없어도 머무를 수 있다", () => {
    expect(target(200, { activeId: null })).toEqual({ kind: "dwell", tabId: "a" });
  });

  it("빈 스트립은 맨 끝이고, 받지 않는 종류·유효하지 않은 좌표는 null 이다", () => {
    expect(target(100, { snapshot: [] })).toEqual(end);
    expect(target(100, { kind: null })).toBeNull();
    expect(target(NaN)).toBeNull();
    expect(target(Infinity)).toBeNull();
  });

  it("이웃과 겹친 칸도 움직인 DOM 대신 다음 스냅숏 탭 앞을 가리킨다", () => {
    const overlapped = [item("a", 100), item("b", 288, 212), item("c", 488, 212)];
    expect(target(287, { snapshot: overlapped })).toEqual(before("b"));
    expect(target(288, { snapshot: overlapped })).toEqual(before("b"));
    expect(target(487, { snapshot: overlapped })).toEqual(before("c"));
    expect(target(488, { snapshot: overlapped })).toEqual(before("c"));
    const moved = overlapped.map((tab) => item(tab.id, tab.rect.left + 200, tab.rect.width));
    expect(target(400, { snapshot: moved })).toEqual(before("b"));
    expect(target(400, { snapshot: overlapped })).toEqual({ kind: "dwell", tabId: "b" });
    expect(target(400, { snapshot: overlapped })).toEqual({ kind: "dwell", tabId: "b" });
  });
});

describe("tabReorderTarget — 이 창 탭은 따라오는 탭의 가운데로 자리를 고른다", () => {
  const bounds = { left: 100, right: 1200 };
  // Tabs 의 onOver 와 같은 길 — 따라오기 이동량을 그대로 넘긴다.
  const reorder = (clientX: number, draggedTabId = "b", overrides: { snapshot?: TabDropSnapshotItem[]; bounds?: typeof bounds; grab?: number } = {}) => {
    const items = overrides.snapshot ?? snapshot;
    const offset = tabDragOffset({
      snapshot: items, bounds: overrides.bounds ?? bounds, clientX, grab: overrides.grab ?? 40, draggedTabId,
    });
    return tabReorderTarget({ snapshot: items, draggedTabId, offset });
  };

  it("오른쪽 이웃의 가운데에 닿으면 그 뒤로, 못 닿으면 제자리다", () => {
    // b 의 가운데 404 → c 의 가운데 608 까지 204 — 커서 344 + 204 = 548.
    expect(reorder(547)).toBeNull();
    expect(reorder(548)).toEqual(before("d"));
    // 이웃의 가운데(커서 기준이면 머무름이던 자리)에서 놓아도 순서가 바뀐다.
    expect(reorder(608)).toEqual(before("d"));
    expect(reorder(751)).toEqual(before("d"));
  });

  it("왼쪽으로도 같은 규칙이다", () => {
    expect(reorder(549, "d")).toBeNull();
    expect(reorder(548, "d")).toEqual(before("c"));
    expect(reorder(345, "d")).toEqual(before("c"));
    expect(reorder(344, "d")).toEqual(before("b"));
    expect(reorder(141)).toBeNull();
    expect(reorder(140)).toEqual(before("a"));
    expect(reorder(-500)).toEqual(before("a"));
  });

  it("마지막 탭 가운데를 넘어 끝까지 가면 맨 끝이다", () => {
    expect(reorder(752)).toEqual(end);
    expect(reorder(2000)).toEqual(end);
    expect(reorder(2000, "d")).toBeNull();
    expect(reorder(2000, "a")).toEqual(end);
  });

  it("커서가 어디를 잡았든 탭의 가운데가 기준이다", () => {
    expect(reorder(547 + 150, "b", { grab: 190 })).toBeNull();
    expect(reorder(548 + 150, "b", { grab: 190 })).toEqual(before("d"));
  });

  it("스트립 끝에 갇힌 탭은 폭이 이웃과 달라도 맨 앞·맨 끝이다", () => {
    const overlapped = [item("a", 100), item("b", 288, 212), item("c", 488, 212)];
    expect(reorder(-500, "b", { snapshot: overlapped })).toEqual(before("a"));
    expect(reorder(2000, "b", { snapshot: overlapped, bounds: { left: 100, right: 700 } })).toEqual(end);
    expect(reorder(2000, "a", { snapshot: overlapped, bounds: { left: 100, right: 700 } })).toEqual(end);
  });

  it("따라오지 않는 드래그(다른 창·스냅숏에 없는 탭)는 판정하지 않는다", () => {
    expect(tabReorderTarget({ snapshot, draggedTabId: "b", offset: null })).toBeNull();
    expect(tabReorderTarget({ snapshot, draggedTabId: "foreign", offset: 0 })).toBeNull();
    expect(tabReorderTarget({ snapshot, draggedTabId: null, offset: 0 })).toBeNull();
    expect(tabReorderTarget({ snapshot, draggedTabId: "b", offset: NaN })).toBeNull();
  });

  it("판정이 비켜서기 미리보기로 그대로 이어진다", () => {
    expect(preview({ target: reorder(547), draggedTabId: "b" }).offsets).toEqual({});
    expect(preview({ target: reorder(548), draggedTabId: "b" }).offsets).toEqual({ b: 204, c: -204 });
  });
});

describe("tabDropPreview — DOM 순서는 그대로, 피치만큼 비켜선다", () => {
  it("뒤로 옮기면 원본이 그 자리에 서고 사이 탭들이 왼쪽으로 비켜선다", () => {
    expect(preview({ target: before("d"), draggedTabId: "a" })).toEqual({
      offsets: { a: 408, b: -204, c: -204 }, ghost: null,
    });
    expect(preview({ target: end, draggedTabId: "b" })).toEqual({
      offsets: { b: 408, c: -204, d: -204 }, ghost: null,
    });
  });

  it("앞으로 옮기면 사이 탭들이 오른쪽으로 비켜선다", () => {
    expect(preview({ target: before("a"), draggedTabId: "d" })).toEqual({
      offsets: { d: -612, a: 204, b: 204, c: 204 }, ghost: null,
    });
  });

  it("자기 앞·뒤·마지막 자기 뒤는 고스트도 이동도 없다", () => {
    expect(preview({ target: before("b"), draggedTabId: "b" })).toEqual({ offsets: {}, ghost: null });
    expect(preview({ target: before("c"), draggedTabId: "b" })).toEqual({ offsets: {}, ghost: null });
    expect(preview({ target: end, draggedTabId: "d" })).toEqual({ offsets: {}, ghost: null });
  });

  it("삽입이 없거나 머무는 동안은 제자리다", () => {
    expect(preview({ target: null })).toEqual({ offsets: {}, ghost: null });
    expect(preview({ target: { kind: "dwell", tabId: "b" } })).toEqual({ offsets: {}, ghost: null });
    expect(preview({ target: before("missing") })).toEqual({ offsets: {}, ghost: null });
  });

  it("새 탭은 뒤 탭들을 한 피치 밀고 pill gap 을 뺀 폭의 슬롯을 만든다", () => {
    expect(preview()).toEqual({
      offsets: { b: 204, c: 204, d: 204 },
      ghost: { left: 304, top: 20, width: 200, height: 28 },
    });
    expect(preview({ target: before("a") }).offsets).toEqual({ a: 204, b: 204, c: 204, d: 204 });
  });

  it("다른 창 탭 id 가 로컬 목록에 없으면 새 탭 슬롯이다", () => {
    expect(preview({ draggedTabId: "foreign" })).toEqual(preview());
  });

  it("맨 끝 새 탭은 다른 탭을 밀지 않고 마지막 피치 뒤에 선다", () => {
    expect(preview({ target: end })).toEqual({
      offsets: {}, ghost: { left: 916, top: 20, width: 200, height: 28 },
    });
  });

  it("폭(212)보다 피치(200)가 좁으면 피치로 이동하고 겹침은 고스트 폭에 남긴다", () => {
    const overlapped = [item("a", 100), item("b", 288, 212), item("c", 488, 212), item("d", 688, 212)];
    expect(preview({ snapshot: overlapped, target: before("a"), draggedTabId: "c" })).toEqual({
      offsets: { c: -388, a: 200, b: 200 }, ghost: null,
    });
    expect(preview({ snapshot: overlapped, target: end, draggedTabId: "a" })).toEqual({
      offsets: { a: 600, b: -188, c: -188, d: -188 }, ghost: null,
    });
    const added = preview({ snapshot: overlapped });
    expect(added.offsets.b).toBe(196);
    expect(added.ghost).toEqual({ left: 288, top: 20, width: 208, height: 28 });
  });

  it("탭 하나의 피치는 gap 을 폴백으로 더한다", () => {
    expect(preview({ snapshot: [item("a", 100)], target: before("a"), gap: 4 })).toEqual({
      offsets: { a: 204 }, ghost: { left: 100, top: 20, width: 200, height: 28 },
    });
    expect(preview({ snapshot: [item("a", 100)], target: end, gap: 4 })).toEqual({
      offsets: {}, ghost: { left: 304, top: 20, width: 200, height: 28 },
    });
  });

  it("빈 스트립에는 기준 탭 폭·높이로 슬롯을 만든다", () => {
    expect(preview({ snapshot: [], target: end, fallbackWidth: 180 })).toEqual({
      offsets: {}, ghost: { left: 0, top: 0, width: 180, height: 28 },
    });
  });

  it("스냅숏·드롭 대상·DOM 순서를 바꾸지 않는다", () => {
    const frozen = snapshot.map((tab) => Object.freeze({ ...tab, rect: Object.freeze({ ...tab.rect }) }));
    Object.freeze(frozen);
    const insertion = Object.freeze(before("d"));
    const original = JSON.stringify(frozen);
    tabDropTarget({ snapshot: frozen, clientX: 550, kind: "tab", activeId: "a", draggedTabId: "a" });
    tabDropPreview({ snapshot: frozen, target: insertion, draggedTabId: "a" });
    tabDropPreview({ snapshot: frozen, target: insertion, draggedTabId: null });
    expect(JSON.stringify(frozen)).toBe(original);
  });
});

describe("tabDragOffset — 잡은 지점이 커서를 따라간다", () => {
  const follow = (clientX: number, overrides: Partial<Parameters<typeof tabDragOffset>[0]> = {}) =>
    tabDragOffset({ snapshot, bounds: { left: 100, right: 1200 }, clientX, grab: 40, draggedTabId: "b", ...overrides });

  it("삽입 슬롯 이동량 대신 커서 이동량을 쓰고, 이웃의 이동량은 유지한다", () => {
    const plan = preview({ target: end, draggedTabId: "b" });
    const offsets = { ...plan.offsets, b: follow(650) };
    expect(offsets).toEqual({ b: 306, c: -204, d: -204 });
    expect(follow(650)).toBe(306);
    expect(plan.offsets.b).toBe(408);
  });

  it("자기 앞·뒤라 판정이 비어도 원본 탭은 따라간다", () => {
    const insertion = target(390, { kind: "tab", draggedTabId: "b" });
    expect(insertion).toBeNull();
    expect(preview({ target: insertion, draggedTabId: "b" }).offsets).toEqual({});
    expect(follow(390)).toBe(46);
    expect(follow(344)).toBe(0);
    expect(follow(320)).toBe(-24);
  });

  it("activeId 와 무관하게 같은 스냅숏의 따라오기를 유지한다", () => {
    expect(follow(600)).toBe(256);
    expect(follow(600, { draggedTabId: "b" })).toBe(256);
  });

  it("마지막 탭 오른쪽이 비어 있어도 스트립 양 끝까지 따라간다", () => {
    expect(follow(-100)).toBe(-204);
    expect(follow(2000)).toBe(696);
    expect(follow(1100)).toBe(696);
    expect(follow(500, { grab: 190 })).toBe(6);
    expect(follow(500, { grab: 0 })).toBe(196);
    expect(follow(900, { snapshot: [item("b", 304)] })).toBe(556);
    expect(follow(2000, { snapshot: [item("b", 304)] })).toBe(696);
  });

  it("첫 탭보다 왼쪽에 있는 스트립 경계와 탭 폭보다 좁은 영역도 스트립 기준이다", () => {
    expect(follow(-100, { bounds: { left: 80, right: 1200 } })).toBe(-224);
    expect(follow(1000, { bounds: { left: 80, right: 200 } })).toBe(-224);
  });

  it("이웃과의 겹침·서로 다른 폭과 스크롤된 client 좌표를 그대로 쓴다", () => {
    const overlapped = [item("a", -80), item("b", 108, 212), item("c", 308, 212)];
    const bounds = { left: 20, right: 700 };
    expect(follow(-200, { snapshot: overlapped, bounds })).toBe(-88);
    expect(follow(800, { snapshot: overlapped, bounds })).toBe(380);
    expect(follow(150, { snapshot: overlapped, bounds })).toBe(2);
    expect(follow(800, { snapshot: overlapped, bounds, draggedTabId: "a" })).toBe(580);
  });

  it("다른 창 탭·버린 스냅숏·끝난 드래그는 따라오지 않는다", () => {
    expect(follow(500, { draggedTabId: null })).toBeNull();
    expect(follow(500, { draggedTabId: "foreign" })).toBeNull();
    expect(follow(500, { snapshot: [] })).toBeNull();
    expect(follow(500, { grab: null })).toBeNull();
    expect(preview({ draggedTabId: null }).ghost).not.toBeNull();
  });
});

describe("tabDragCollapse — 원래 배치에서 빠진 자리를 닫는다", () => {
  const collapse = (overrides: Partial<Parameters<typeof tabDragCollapse>[0]> = {}) =>
    tabDragCollapse({ snapshot, draggedTabId: "b", ...overrides });

  it("끄는 탭 뒤와 + 만 pill gap 을 포함한 한 피치 당긴다", () => {
    expect(collapse()).toEqual({ offsets: { c: -204, d: -204 }, newTabOffset: -204 });
    expect(collapse({ draggedTabId: "a" })).toEqual({ offsets: { b: -204, c: -204, d: -204 }, newTabOffset: -204 });
    expect(collapse({ draggedTabId: "d" })).toEqual({ offsets: {}, newTabOffset: -204 });
  });

  it("첫 탭의 겹침과 나머지 탭의 피치를 원래 left 차이로 잰다", () => {
    const overlapped = [item("a", 100), item("b", 288, 212), item("c", 488, 212)];
    expect(collapse({ snapshot: overlapped, draggedTabId: "a" })).toEqual({ offsets: { b: -188, c: -188 }, newTabOffset: -188 });
    expect(collapse({ snapshot: overlapped })).toEqual({ offsets: { c: -200 }, newTabOffset: -200 });
    expect(collapse({ snapshot: overlapped, draggedTabId: "c" })).toEqual({ offsets: {}, newTabOffset: -200 });
  });

  it("탭 하나도 + 를 당긴다 — 폭에 gap 을 더한다", () => {
    expect(collapse({ snapshot: [item("b", 304)], gap: 4 })).toEqual({ offsets: {}, newTabOffset: -204 });
    expect(collapse({ snapshot: [item("b", 304)], gap: 0 })).toEqual({ offsets: {}, newTabOffset: -200 });
  });

  it("외부 드래그·재진입·끝난 드래그에는 이동량이 없다", () => {
    for (const draggedTabId of [null, "foreign"]) {
      expect(collapse({ draggedTabId })).toEqual({ offsets: {}, newTabOffset: 0 });
    }
    expect(collapse({ snapshot: [] })).toEqual({ offsets: {}, newTabOffset: 0 });
    expect(preview({ target: end, draggedTabId: "b" }).offsets).toEqual({ b: 408, c: -204, d: -204 });
    expect(collapse().offsets).toEqual({ c: -204, d: -204 });
    expect(collapse({ draggedTabId: null }).offsets).toEqual({});
  });

  it("스크롤된 좌표·얼린 스냅숏도 같은 피치이고 원본은 바꾸지 않는다", () => {
    const original = JSON.stringify(snapshot);
    const scrolled = snapshot.map((tab) => Object.freeze(item(tab.id, tab.rect.left - 350, tab.rect.width)));
    Object.freeze(scrolled);
    expect(collapse({ snapshot: scrolled })).toEqual(collapse());
    expect(JSON.stringify(snapshot)).toBe(original);
  });
});

describe("tabOverlapTarget — 이 창 탭을 다른 탭에 걸쳐 둔다", () => {
  const strip: TabDropSnapshotItem[] = ["a", "b", "c"].map((id, i) => ({
    id, rect: { left: 100 + i * 100, right: 200 + i * 100, top: 0, width: 100, height: 28 },
  }));
  const over = (offset: number | null, offsets: Record<string, number> = {}) =>
    tabOverlapTarget({ snapshot: strip, draggedTabId: "b", offset, offsets });

  it("끄는 탭이 이웃과 30% 이상 겹치면 그 이웃이다", () => {
    expect(over(35)).toBe("c");
    expect(over(-40)).toBe("a");
  });

  it("조금 밀어 본 것·제자리는 머무름이 아니다", () => {
    expect(over(0)).toBeNull();
    expect(over(20)).toBeNull();
    expect(over(null)).toBeNull();
  });

  it("비켜선 이웃은 보이는 자리로 겹침을 잰다", () => {
    expect(over(65, { c: -100 })).toBe("c");
    expect(over(90, { c: -100 })).toBeNull();
  });
});
