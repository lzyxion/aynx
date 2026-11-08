import { describe, expect, it } from "vitest";
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
 * 선택 모델 (docs/log/2026-09-04-hosts-multiselect.md 1절).
 *
 * 이 파일이 지키는 계약 셋: **앵커는 따로 산다**(Shift 범위를 늘였다 줄였다 할 수 있어야
 * 한다) · **포커스는 선택과 다르다**(커서는 언제나 하나) · **`pruneSelection` 은 바뀔 것이
 * 없으면 같은 객체를 돌려준다**(`$effect` 안에서 `$state` 에 대입되므로 새 객체를 만들면
 * 목록이 그대로여도 무한히 다시 그린다).
 */

/** 골라진 것들을 **`order` 순서**로 펴서 비교한다 — `Set` 의 순회 순서에 기대지 않으려고 */
function picked(state: SelectionState, order: readonly string[]): string[] {
  return order.filter((id) => state.ids.has(id));
}

const ORDER = ["a", "b", "c", "d", "e"];

describe("clickSelect", () => {
  it("수식 키 없는 클릭은 단일 선택 — 앵커·포커스가 그 자리로 간다", () => {
    const s = clickSelect(emptySelection(), "c", {}, ORDER);
    expect(picked(s, ORDER)).toEqual(["c"]);
    expect(s.anchor).toBe("c");
    expect(s.focus).toBe("c");
  });

  it("단일 클릭은 이전 선택을 통째로 대신한다", () => {
    let s = clickSelect(emptySelection(), "a", {}, ORDER);
    s = clickSelect(s, "b", { ctrl: true }, ORDER);
    s = clickSelect(s, "d", {}, ORDER);
    expect(picked(s, ORDER)).toEqual(["d"]);
  });

  it("Ctrl+클릭은 토글 — 없으면 더하고 있으면 뺀다", () => {
    let s = clickSelect(emptySelection(), "a", {}, ORDER);
    s = clickSelect(s, "c", { ctrl: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["a", "c"]);
    s = clickSelect(s, "a", { ctrl: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["c"]);
  });

  it("Ctrl+클릭은 앵커도 그 자리로 옮긴다 — 다음 Shift 범위의 시작이다", () => {
    let s = clickSelect(emptySelection(), "a", {}, ORDER);
    s = clickSelect(s, "c", { ctrl: true }, ORDER);
    expect(s.anchor).toBe("c");
    s = clickSelect(s, "e", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["c", "d", "e"]);
  });

  it("Shift+클릭은 앵커에서 여기까지의 범위", () => {
    let s = clickSelect(emptySelection(), "b", {}, ORDER);
    s = clickSelect(s, "d", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
    expect(s.focus).toBe("d");
  });

  it("Shift 범위는 역방향(위로 긋기)에서도 같다", () => {
    let s = clickSelect(emptySelection(), "d", {}, ORDER);
    s = clickSelect(s, "b", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("d");
    expect(s.focus).toBe("b");
  });

  it("앵커가 고정이라 Shift+클릭을 두 번 하면 늘렸다 줄였다 된다", () => {
    let s = clickSelect(emptySelection(), "b", {}, ORDER);
    s = clickSelect(s, "e", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["b", "c", "d", "e"]);
    s = clickSelect(s, "c", { shift: true }, ORDER); // 줄인다 — 앵커 b 는 그대로
    expect(picked(s, ORDER)).toEqual(["b", "c"]);
    expect(s.anchor).toBe("b");
  });

  it("Ctrl+Shift 는 기존 선택에 범위를 더한다", () => {
    let s = clickSelect(emptySelection(), "a", {}, ORDER);
    s = clickSelect(s, "c", { ctrl: true }, ORDER);
    s = clickSelect(s, "e", { ctrl: true, shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["a", "c", "d", "e"]);
  });

  it("앵커가 없는 첫 Shift+클릭은 포커스를 앵커 대신 쓴다", () => {
    const start: SelectionState = { anchor: null, focus: "b", ids: new Set() };
    const s = clickSelect(start, "d", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
  });

  it("앵커도 포커스도 없으면 Shift+클릭은 그 하나만 고른다", () => {
    const s = clickSelect(emptySelection(), "c", { shift: true }, ORDER);
    expect(picked(s, ORDER)).toEqual(["c"]);
  });

  it("목록 밖의 대상을 Shift 로 짚으면 단일 선택으로 떨어진다", () => {
    let s = clickSelect(emptySelection(), "b", {}, ORDER);
    s = clickSelect(s, "zzz", { shift: true }, ORDER);
    expect([...s.ids]).toEqual(["zzz"]);
    expect(s.anchor).toBe("zzz");
    expect(s.focus).toBe("zzz");
  });
});

describe("selectAll", () => {
  it("전부 고르고 포커스는 있던 자리를 지킨다", () => {
    const s = selectAll(ORDER, "c");
    expect(picked(s, ORDER)).toEqual(ORDER);
    expect(s.focus).toBe("c");
    expect(s.anchor).toBe("a");
  });

  it("있던 자리가 목록에 없으면 첫 항목이 포커스다", () => {
    expect(selectAll(ORDER, "zzz").focus).toBe("a");
    expect(selectAll(ORDER).focus).toBe("a");
  });

  it("빈 목록이면 전부 null", () => {
    const s = selectAll([]);
    expect(s.ids.size).toBe(0);
    expect(s.focus).toBeNull();
    expect(s.anchor).toBeNull();
  });
});

describe("clear · emptySelection", () => {
  it("둘 다 아무것도 고르지 않은 상태다", () => {
    for (const s of [clear(), emptySelection()]) {
      expect(s.ids.size).toBe(0);
      expect(s.focus).toBeNull();
      expect(s.anchor).toBeNull();
    }
  });
});

describe("moveFocus", () => {
  it("화살표 한 칸 — 그 자리 하나만 골라지고 앵커도 따라간다", () => {
    const start = clickSelect(emptySelection(), "b", {}, ORDER);
    const s = moveFocus(start, ORDER, 1, false);
    expect(s.focus).toBe("c");
    expect(s.anchor).toBe("c");
    expect(picked(s, ORDER)).toEqual(["c"]);
  });

  it("extend(Shift+화살표)는 앵커에서 새 포커스까지 범위로 넓힌다", () => {
    let s = clickSelect(emptySelection(), "b", {}, ORDER);
    s = moveFocus(s, ORDER, 1, true);
    s = moveFocus(s, ORDER, 1, true);
    expect(picked(s, ORDER)).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b"); // 앵커는 움직이지 않는다
    expect(s.focus).toBe("d");
  });

  it("extend 로 앵커를 지나 되돌아오면 범위가 반대편으로 뒤집힌다", () => {
    let s = clickSelect(emptySelection(), "c", {}, ORDER);
    s = moveFocus(s, ORDER, -1, true);
    s = moveFocus(s, ORDER, -1, true);
    expect(picked(s, ORDER)).toEqual(["a", "b", "c"]);
    expect(s.anchor).toBe("c");
  });

  it("wrap 이 꺼져 있으면 양끝에서 멈춘다", () => {
    const top = clickSelect(emptySelection(), "a", {}, ORDER);
    expect(moveFocus(top, ORDER, -1, false).focus).toBe("a");
    const bottom = clickSelect(emptySelection(), "e", {}, ORDER);
    expect(moveFocus(bottom, ORDER, 1, false).focus).toBe("e");
  });

  it("wrap 이 켜져 있으면 양끝에서 감싼다", () => {
    const top = clickSelect(emptySelection(), "a", {}, ORDER);
    expect(moveFocus(top, ORDER, -1, false, true).focus).toBe("e");
    const bottom = clickSelect(emptySelection(), "e", {}, ORDER);
    expect(moveFocus(bottom, ORDER, 1, false, true).focus).toBe("a");
  });

  it("커서가 없으면 진행 방향의 첫 칸에서 시작한다", () => {
    expect(moveFocus(emptySelection(), ORDER, 1, false).focus).toBe("a");
    expect(moveFocus(emptySelection(), ORDER, -1, false).focus).toBe("e");
  });

  it("빈 목록에서는 같은 객체를 그대로 돌려준다", () => {
    const s = emptySelection();
    expect(moveFocus(s, [], 1, false)).toBe(s);
  });

  it("아이콘 보기의 줄 이동(±칸 수)도 같은 함수다", () => {
    const grid = ["a", "b", "c", "d", "e", "f"]; // 3칸 × 2줄
    const s = moveFocus(clickSelect(emptySelection(), "b", {}, grid), grid, 3, false);
    expect(s.focus).toBe("e");
  });
});

describe("marqueeSelect", () => {
  /** 20px 높이의 줄 여섯 개 — id 는 화면 순서 그대로 온다 */
  const rects: { id: string; rect: Box }[] = ORDER.map((id, i) => ({
    id,
    rect: { left: 0, right: 100, top: i * 20, bottom: i * 20 + 20 },
  }));

  it("사각형에 걸린 것만 고른다", () => {
    const s = marqueeSelect(rects, { left: 0, right: 50, top: 25, bottom: 55 }, false);
    expect(picked(s, ORDER)).toEqual(["b", "c"]);
  });

  it("변이 스치기만 하는 것은 겹친 것으로 치지 않는다", () => {
    // b 의 위 변(y=20)에 정확히 닿는 사각형 — 넓이가 0 이므로 b 는 안 걸린다
    const s = marqueeSelect(rects, { left: 0, right: 50, top: 0, bottom: 20 }, false);
    expect(picked(s, ORDER)).toEqual(["a"]);
  });

  it("포커스·앵커는 걸린 것 중 화면 순서상 첫 항목이다", () => {
    const s = marqueeSelect(rects, { left: 0, right: 50, top: 45, bottom: 85 }, false);
    expect(s.focus).toBe("c");
    expect(s.anchor).toBe("c");
  });

  it("additive 는 base 에 더한다 — base 는 긋기 시작할 때의 선택이다", () => {
    const base = clickSelect(emptySelection(), "e", {}, ORDER);
    const s = marqueeSelect(rects, { left: 0, right: 50, top: 5, bottom: 25 }, true, base);
    expect(picked(s, ORDER)).toEqual(["a", "b", "e"]);
  });

  it("additive 는 사각형을 되돌리면 base 로 돌아간다 — 지나간 것이 남지 않는다", () => {
    const base = clickSelect(emptySelection(), "e", {}, ORDER);
    const wide = marqueeSelect(rects, { left: 0, right: 50, top: 5, bottom: 65 }, true, base);
    expect(picked(wide, ORDER)).toEqual(["a", "b", "c", "d", "e"]);
    // 같은 base 로 다시 계산한다 (앞 프레임의 결과를 base 로 삼지 않는다)
    const shrunk = marqueeSelect(rects, { left: 0, right: 50, top: 5, bottom: 15 }, true, base);
    expect(picked(shrunk, ORDER)).toEqual(["a", "e"]);
  });

  it("additive 가 아니면 아무것도 안 걸렸을 때 비운다", () => {
    const base = clickSelect(emptySelection(), "e", {}, ORDER);
    const s = marqueeSelect(rects, { left: 200, right: 300, top: 0, bottom: 10 }, false, base);
    expect(s.ids.size).toBe(0);
    expect(s.focus).toBeNull();
  });

  it("additive 면 아무것도 안 걸려도 base 의 선택·포커스를 지킨다", () => {
    const base = clickSelect(emptySelection(), "e", {}, ORDER);
    const s = marqueeSelect(rects, { left: 200, right: 300, top: 0, bottom: 10 }, true, base);
    expect(picked(s, ORDER)).toEqual(["e"]);
    expect(s.focus).toBe("e");
  });
});

describe("pruneSelection", () => {
  it("사라진 id 를 선택에서 떨어낸다", () => {
    const s = selectAll(ORDER, "c");
    const next = pruneSelection(s, ["a", "c"]);
    expect(picked(next, ["a", "c"])).toEqual(["a", "c"]);
  });

  it("포커스가 사라지면 첫 항목으로 되돌린다 — 커서가 없으면 화살표가 먹지 않는다", () => {
    const s = clickSelect(emptySelection(), "e", {}, ORDER);
    const next = pruneSelection(s, ["a", "b"]);
    expect(next.focus).toBe("a");
    expect(next.anchor).toBe("a");
  });

  it("바뀔 것이 없으면 **같은 객체**를 돌려준다 (무한 재렌더 방지)", () => {
    const s = selectAll(ORDER, "c");
    expect(pruneSelection(s, ORDER)).toBe(s);
  });

  it("빈 선택 + 빈 목록도 같은 객체다", () => {
    const s = emptySelection();
    expect(pruneSelection(s, [])).toBe(s);
  });

  it("목록이 통째로 비면 전부 null 이다", () => {
    const s = selectAll(ORDER, "c");
    const next = pruneSelection(s, []);
    expect(next.ids.size).toBe(0);
    expect(next.focus).toBeNull();
    expect(next.anchor).toBeNull();
  });
});
