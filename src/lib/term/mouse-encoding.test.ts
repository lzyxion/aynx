import { describe, expect, it } from "vitest";
import { encodingAfter, encodingSuffix } from "./mouse-encoding";

describe("마우스 보고 인코딩(직렬화가 싣지 않는 것 — 10-26)", () => {
  it("?1006h 는 SGR · ?1006l 은 기본 · 관계없는 모드는 그대로(null)", () => {
    expect(encodingAfter("default", [1000, 1006], true)).toBe("sgr");
    expect(encodingAfter("sgr", [1006], false)).toBe("default");
    expect(encodingAfter("sgr", [1049, 25], true)).toBeNull();
    expect(encodingAfter("sgr", [1006], true)).toBeNull(); // 이미 그렇다
  });

  it("SGR 픽셀(?1016) · 하위 매개변수 꼴도 읽는다", () => {
    expect(encodingAfter("default", [[1016]], true)).toBe("sgr-pixels");
    expect(encodingAfter("default", [1006, 1016], true)).toBe("sgr-pixels"); // 마지막이 이긴다
  });

  it("직렬화 끝에 붙일 글 — 기본이면 없다", () => {
    expect(encodingSuffix("sgr")).toBe("\x1b[?1006h");
    expect(encodingSuffix("sgr-pixels")).toBe("\x1b[?1016h");
    expect(encodingSuffix("default")).toBe("");
  });
});
