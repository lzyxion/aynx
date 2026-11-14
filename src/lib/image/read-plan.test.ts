import { describe, expect, it } from "vitest";
import { PREVIEW_MAX_BYTES } from "$lib/browser/preview";
import { IMAGE_CONFIRM_BYTES, IMAGE_MAX_BYTES, imageReadPlan, progressRatio } from "./read-plan";

const MB = 1024 * 1024;

describe("imageReadPlan — 크기로 읽는 길을 고른다", () => {
  it("20 MB 이하 = 한 번에(미리 보기와 같은 길 · 그 상한은 그대로)", () => {
    expect(PREVIEW_MAX_BYTES).toBe(20 * MB);
    expect(imageReadPlan(0, false)).toBe("direct");
    expect(imageReadPlan(PREVIEW_MAX_BYTES, false)).toBe("direct");
  });
  it("넘으면 조각 · 진행", () => {
    expect(imageReadPlan(PREVIEW_MAX_BYTES + 1, false)).toBe("progress");
    expect(imageReadPlan(IMAGE_CONFIRM_BYTES - 1, false)).toBe("progress");
  });
  it("500 MB 이상은 먼저 묻고, 그래도 열기면 조각", () => {
    expect(IMAGE_CONFIRM_BYTES).toBe(500 * MB);
    expect(imageReadPlan(IMAGE_CONFIRM_BYTES, false)).toBe("confirm");
    expect(imageReadPlan(IMAGE_CONFIRM_BYTES, true)).toBe("progress");
  });
  it("상한을 넘으면 묻지도 않고 열지 않는다", () => {
    expect(imageReadPlan(IMAGE_MAX_BYTES + 1, true)).toBe("too-large");
    expect(imageReadPlan(IMAGE_MAX_BYTES, true)).toBe("progress");
  });
  it("모르는 크기는 한 번에(백엔드가 다시 막는다)", () => {
    expect(imageReadPlan(Number.NaN, false)).toBe("direct");
  });
});

describe("progressRatio", () => {
  it("0~1 · 전체를 모르면 0", () => {
    expect(progressRatio(5, 10)).toBe(0.5);
    expect(progressRatio(20, 10)).toBe(1);
    expect(progressRatio(5, 0)).toBe(0);
  });
});
