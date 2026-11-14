import { describe, expect, it } from "vitest";
import { imageKeyAction, type KeyLike } from "./keys";

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("imageKeyAction — 물리 키(`ev.code`) · 수식키 조합은 흘려보낸다", () => {
  it("아는 키", () => {
    expect(imageKeyAction(key("ArrowLeft"))).toBe("prev");
    expect(imageKeyAction(key("ArrowRight"))).toBe("next");
    expect(imageKeyAction(key("Digit0"))).toBe("fit");
    expect(imageKeyAction(key("Numpad0"))).toBe("fit");
    expect(imageKeyAction(key("Digit1"))).toBe("actual");
    expect(imageKeyAction(key("Equal"))).toBe("zoomIn");
    expect(imageKeyAction(key("NumpadAdd"))).toBe("zoomIn");
    expect(imageKeyAction(key("Minus"))).toBe("zoomOut");
    expect(imageKeyAction(key("KeyM"))).toBe("minimap");
  });
  it("`+` 는 Shift+`=` 도 받는다 — 다른 키의 Shift 는 흘려보낸다", () => {
    expect(imageKeyAction(key("Equal", { shiftKey: true }))).toBe("zoomIn");
    expect(imageKeyAction(key("ArrowLeft", { shiftKey: true }))).toBeNull();
    expect(imageKeyAction(key("KeyM", { shiftKey: true }))).toBeNull();
  });
  it("Ctrl · Alt · Meta 조합(전역 단축키 — Alt+화살표 포커스 등)은 흘려보낸다", () => {
    expect(imageKeyAction(key("ArrowLeft", { altKey: true }))).toBeNull();
    expect(imageKeyAction(key("ArrowRight", { altKey: true, shiftKey: true }))).toBeNull();
    expect(imageKeyAction(key("Equal", { ctrlKey: true }))).toBeNull();
    expect(imageKeyAction(key("Digit0", { metaKey: true }))).toBeNull();
  });
  it("조합 중 · 모르는 키는 흘려보낸다", () => {
    expect(imageKeyAction(key("KeyM", { isComposing: true }))).toBeNull();
    expect(imageKeyAction(key("KeyA"))).toBeNull();
    expect(imageKeyAction(key("Enter"))).toBeNull();
  });
});
