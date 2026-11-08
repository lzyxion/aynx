import { describe, expect, it } from "vitest";
import { flyoutKeyAction, placeFlyout } from "$lib/menu-flyout";

/**
 * 옆으로 뜨는 목록의 공통 규칙 (docs/log/2026-09-17-tile-menu-flyouts.md).
 *
 * `placeFlyout` 의 케이스들은 2026-09-15 에 `plus-menu.test.ts` 에서 쓰인 그대로다 —
 * 함수가 `+` 메뉴 전용이 아니게 되면서 시험도 함께 옮겨 왔다. **두 메뉴가 같은 함수를
 * 쓴다는 것이 이 파일이 지키는 계약**이라, 한쪽을 고치려고 이 규칙을 건드리면 다른 쪽이
 * 함께 움직인다는 사실이 여기서 보여야 한다.
 */

describe("placeFlyout", () => {
  const row = { left: 100, right: 320, top: 200 };
  const menu = { left: 100, right: 320, top: 180 };
  const size = { width: 200, height: 160 };

  it("기본은 메뉴 오른쪽 바깥, 줄과 같은 높이", () => {
    expect(placeFlyout(row, menu, size, { width: 1200, height: 800 })).toEqual({
      left: 322,
      top: 200,
    });
  });

  it("오른쪽이 모자라면 메뉴 왼쪽 바깥으로 넘어간다", () => {
    const wide = { left: 600, right: 820, top: 180 };
    expect(
      placeFlyout({ ...row, left: 600, right: 820 }, wide, size, {
        width: 900,
        height: 800,
      }).left,
    ).toBe(398); // 600 - 2 - 200
  });

  it("양쪽 다 모자라면 왼쪽 여백에 붙인다 — 왼쪽 끝은 보여야 이름을 읽는다", () => {
    const narrow = placeFlyout(
      { left: 8, right: 228, top: 200 },
      { left: 8, right: 228, top: 180 },
      size,
      { width: 300, height: 800 },
    );
    expect(narrow.left).toBe(8);
  });

  it("아래가 넘치면 위로 끌어올린다", () => {
    expect(placeFlyout(row, menu, size, { width: 1200, height: 300 }).top).toBe(132);
  });

  it("목록이 창보다 길면 위쪽 여백에 붙는다 (넘치는 만큼은 목록이 스크롤한다)", () => {
    expect(
      placeFlyout(row, menu, { width: 200, height: 900 }, { width: 1200, height: 400 }).top,
    ).toBe(8);
  });
});

describe("flyoutKeyAction — 한 켜 들어가고 한 켜 나온다", () => {
  it("줄 위에서는 → 가 연다", () => {
    expect(flyoutKeyAction("ArrowRight", "row")).toBe("open");
    expect(flyoutKeyAction("ArrowLeft", "row")).toBeNull();
  });

  it("목록 안에서는 ← 가 나간다", () => {
    expect(flyoutKeyAction("ArrowLeft", "flyout")).toBe("close");
    expect(flyoutKeyAction("ArrowRight", "flyout")).toBeNull();
  });

  /**
   * Escape 는 **일부러** 이 표 밖이다 — 두 메뉴가 그 키를 받는 자리와 전파 규칙이 다르다
   * (모듈 머리말). 여기서 뜻을 하나로 정해 버리면 한쪽의 규칙이 조용히 깨진다.
   */
  it("Enter·Space·Escape 는 이 표가 보지 않는다", () => {
    for (const key of ["Enter", " ", "Escape"]) {
      expect(flyoutKeyAction(key, "row"), key).toBeNull();
      expect(flyoutKeyAction(key, "flyout"), key).toBeNull();
    }
  });
});
