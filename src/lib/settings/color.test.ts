import { describe, expect, it } from "vitest";
import { toHex } from "$lib/settings/color";

// `environment: "node"` 라 `document` 가 없다 — 브라우저에게 물어보는 길이 막힌 상태의
// 계약을 그대로 고정한다 (hex 두 형태는 알아보고, 나머지는 검정으로 떨어진다).
describe("toHex — 색 선택기가 받아들이는 #rrggbb 로", () => {
  it("6자리 hex 는 소문자로만 바꾼다", () => {
    expect(toHex("#7AA2F7")).toBe("#7aa2f7");
  });

  it("3자리 hex 는 두 배로 펴 준다", () => {
    expect(toHex("#F0A")).toBe("#ff00aa");
  });

  it("빈 값은 검정 (색 선택기는 '안 정함' 을 표현하지 못한다)", () => {
    expect(toHex("")).toBe("#000000");
  });

  it("hex 가 아닌 값은 document 없이는 검정 — 텍스트 칸의 값 자체는 살아 있다", () => {
    expect(toHex("tomato")).toBe("#000000");
    expect(toHex("rgb(1 2 3)")).toBe("#000000");
  });

  it("hex 처럼 생겼지만 자릿수가 다르면 hex 로 보지 않는다", () => {
    expect(toHex("#12345")).toBe("#000000");
  });
});
