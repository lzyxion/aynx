import { describe, expect, it } from "vitest";
import { initialSelection, moveSelection, switcherKeyOf, type SwitcherKeyEvent } from "$lib/profile-switcher";

/** 테마 프로필 빠른 전환 — 순수 규칙 (docs/log/2026-09-28-profile-switcher.md) */

const key = (code: string, mods: Partial<SwitcherKeyEvent> = {}): SwitcherKeyEvent => ({
  code,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("switcherKeyOf", () => {
  it("화살표 · Tab · Shift+Tab 이 앞뒤다", () => {
    expect(switcherKeyOf(key("ArrowLeft"))).toEqual({ kind: "prev" });
    expect(switcherKeyOf(key("ArrowRight"))).toEqual({ kind: "next" });
    expect(switcherKeyOf(key("Tab"))).toEqual({ kind: "next" });
    expect(switcherKeyOf(key("Tab", { shiftKey: true }))).toEqual({ kind: "prev" });
  });

  it("Home · End · Enter(숫자 패드 포함) · Escape", () => {
    expect(switcherKeyOf(key("Home"))).toEqual({ kind: "home" });
    expect(switcherKeyOf(key("End"))).toEqual({ kind: "end" });
    expect(switcherKeyOf(key("Enter"))).toEqual({ kind: "apply" });
    expect(switcherKeyOf(key("NumpadEnter"))).toEqual({ kind: "apply" });
    expect(switcherKeyOf(key("Escape"))).toEqual({ kind: "close" });
  });

  it("숫자 1…9 는 윗줄 · 숫자 패드 모두 그 번째 카드다 (0 은 뜻이 없다)", () => {
    expect(switcherKeyOf(key("Digit1"))).toEqual({ kind: "nth", index: 0 });
    expect(switcherKeyOf(key("Digit9"))).toEqual({ kind: "nth", index: 8 });
    expect(switcherKeyOf(key("Numpad3"))).toEqual({ kind: "nth", index: 2 });
    expect(switcherKeyOf(key("Digit0"))).toBeNull();
    expect(switcherKeyOf(key("Digit2", { shiftKey: true }))).toBeNull(); // Shift+2 = @
  });

  it("IME 가 켜져 key 가 Process 여도 code 로 읽는다", () => {
    expect(switcherKeyOf(key("Digit2", { key: "Process" }))).toEqual({ kind: "nth", index: 1 });
  });

  it("Ctrl · Alt · Meta 가 섞이면 뜻이 없다 (같은 단축키 닫기는 부르는 쪽이 먼저 본다)", () => {
    expect(switcherKeyOf(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(switcherKeyOf(key("Enter", { altKey: true }))).toBeNull();
    expect(switcherKeyOf(key("Digit1", { metaKey: true }))).toBeNull();
    expect(switcherKeyOf(key("KeyU", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("모르는 글자는 null", () => {
    expect(switcherKeyOf(key("KeyA"))).toBeNull();
    expect(switcherKeyOf(key("Space"))).toBeNull();
    expect(switcherKeyOf(key("ArrowUp"))).toBeNull();
  });
});

describe("initialSelection", () => {
  const ids = ["a", "b", "c"];

  it("지금 쓰는 프로필이 골라진 채 열린다", () => {
    expect(initialSelection(ids, "b")).toBe(1);
    expect(initialSelection(ids, "c")).toBe(2);
  });

  it("고른 것이 없거나 목록에 없으면 첫 카드", () => {
    expect(initialSelection(ids, null)).toBe(0);
    expect(initialSelection(ids, "gone")).toBe(0);
  });

  it("목록이 비면 -1", () => {
    expect(initialSelection([], "a")).toBe(-1);
    expect(initialSelection([], null)).toBe(-1);
  });
});

describe("moveSelection", () => {
  it("앞뒤는 끝에서 돌아 나온다", () => {
    expect(moveSelection(3, 0, { kind: "next" })).toBe(1);
    expect(moveSelection(3, 2, { kind: "next" })).toBe(0);
    expect(moveSelection(3, 0, { kind: "prev" })).toBe(2);
    expect(moveSelection(3, 1, { kind: "prev" })).toBe(0);
  });

  it("Home · End", () => {
    expect(moveSelection(4, 2, { kind: "home" })).toBe(0);
    expect(moveSelection(4, 0, { kind: "end" })).toBe(3);
  });

  it("숫자는 그 번째로, 카드 수를 넘으면 그대로", () => {
    expect(moveSelection(4, 0, { kind: "nth", index: 2 })).toBe(2);
    expect(moveSelection(4, 1, { kind: "nth", index: 8 })).toBe(1);
  });

  it("카드 한 장이면 어디로 가도 그 한 장", () => {
    for (const kind of ["prev", "next", "home", "end"] as const) {
      expect(moveSelection(1, 0, { kind })).toBe(0);
    }
  });

  it("빈 목록은 -1, 범위 밖 값은 먼저 안으로 들인다", () => {
    expect(moveSelection(0, 0, { kind: "next" })).toBe(-1);
    expect(moveSelection(3, -1, { kind: "next" })).toBe(1);
    expect(moveSelection(3, 9, { kind: "prev" })).toBe(1);
  });

  it("적용 · 닫기는 고른 칸을 옮기지 않는다", () => {
    expect(moveSelection(3, 1, { kind: "apply" })).toBe(1);
    expect(moveSelection(3, 1, { kind: "close" })).toBe(1);
  });
});
