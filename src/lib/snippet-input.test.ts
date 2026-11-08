import { describe, expect, it } from "vitest";
import { eraseCount, inputModeAfter, inputRange } from "$lib/snippet-input";

describe("inputModeAfter — `B` 뒤 `C` 앞", () => {
  it("`B` 가 켠다", () => {
    expect(inputModeAfter(false, "B")).toBe(true);
    expect(inputModeAfter(true, "B")).toBe(true);
  });

  it("`C`·`D`·새 `A` 가 끈다", () => {
    expect(inputModeAfter(true, "C")).toBe(false);
    expect(inputModeAfter(true, "D")).toBe(false);
    expect(inputModeAfter(true, "A")).toBe(false);
  });

  it("모르는 조각은 상태를 건드리지 않는다", () => {
    expect(inputModeAfter(true, "P")).toBe(true);
    expect(inputModeAfter(false, "E")).toBe(false);
    expect(inputModeAfter(true, "")).toBe(true);
  });

  it("A→B→C→D 한 바퀴", () => {
    let on = false;
    for (const [kind, want] of [
      ["A", false],
      ["B", true],
      ["C", false],
      ["D", false],
      ["A", false],
      ["B", true],
    ] as const) {
      on = inputModeAfter(on, kind);
      expect(on, kind).toBe(want);
    }
  });
});

describe("inputRange — 읽을 구간", () => {
  it("같은 줄이면 앵커 열부터 커서 열까지", () => {
    expect(inputRange({ line: 12, col: 10 }, { line: 12, col: 15 })).toEqual({
      line: 12,
      startCol: 10,
      endCol: 15,
    });
  });

  it("아직 아무것도 안 쳤으면 빈 구간이다 (null 이 아니다)", () => {
    expect(inputRange({ line: 3, col: 8 }, { line: 3, col: 8 })).toEqual({
      line: 3,
      startCol: 8,
      endCol: 8,
    });
  });

  it("앵커가 없으면 null — 입력 모드가 아니다", () => {
    expect(inputRange(null, { line: 1, col: 1 })).toBeNull();
    expect(inputRange(undefined, { line: 1, col: 1 })).toBeNull();
  });

  it("줄이 다르면 null — 여러 줄 입력은 접는다", () => {
    expect(inputRange({ line: 5, col: 2 }, { line: 6, col: 4 })).toBeNull();
    expect(inputRange({ line: 5, col: 2 }, { line: 4, col: 4 })).toBeNull();
  });

  it("커서가 앵커보다 앞이면 null", () => {
    expect(inputRange({ line: 7, col: 10 }, { line: 7, col: 9 })).toBeNull();
  });
});

describe("eraseCount — 지울 백스페이스 개수", () => {
  it("칸이 아니라 글자 수다 (두 칸짜리 한글도 하나)", () => {
    expect(eraseCount("git")).toBe(3);
    expect(eraseCount("배포")).toBe(2);
  });

  it("서러게이트 쌍은 한 글자로 센다", () => {
    expect(eraseCount("🚀x")).toBe(2);
  });

  it("빈 값·문자열이 아닌 값은 0", () => {
    expect(eraseCount("")).toBe(0);
    expect(eraseCount(null)).toBe(0);
    expect(eraseCount(undefined)).toBe(0);
  });
});
