import { describe, expect, it } from "vitest";
import {
  UI_SCALES,
  compensatedFontSize,
  normalizeUiScale,
  screenToLogical,
  zoomFactor,
} from "./ui-scale";

describe("normalizeUiScale", () => {
  it("후보는 그대로, 기본(100)은 '안 정함'", () => {
    for (const s of UI_SCALES) expect(normalizeUiScale(s)).toBe(s === 100 ? undefined : s);
  });

  it("범위 밖은 자른다 — 백엔드 sanitize 와 같다", () => {
    expect(normalizeUiScale(0)).toBe(80);
    expect(normalizeUiScale(50)).toBe(80);
    expect(normalizeUiScale(300)).toBe(150);
  });

  it("사이 값은 가장 가까운 후보로, 같은 거리면 작은 쪽", () => {
    expect(normalizeUiScale(115)).toBe(110); // 110·125 중 110 이 가깝다(5 vs 10)
    expect(normalizeUiScale(118)).toBe(125);
    expect(normalizeUiScale(95)).toBe(90); // 90·100 같은 거리 → 작은 쪽
    expect(normalizeUiScale(137.5)).toBe(125); // 125·150 같은 거리 → 작은 쪽
    expect(normalizeUiScale(104)).toBeUndefined(); // 100 에 붙는다 = 안 정함
  });

  it("숫자가 아니면 '안 정함'", () => {
    for (const raw of [undefined, null, "125", NaN, Infinity, {}]) {
      expect(normalizeUiScale(raw)).toBeUndefined();
    }
  });
});

describe("zoomFactor", () => {
  it("안 정함은 1, 나머지는 % / 100", () => {
    expect(zoomFactor(undefined)).toBe(1);
    expect(zoomFactor(null)).toBe(1);
    expect(zoomFactor(125)).toBe(1.25);
    expect(zoomFactor(80)).toBe(0.8);
  });
});

describe("compensatedFontSize", () => {
  it("배율로 나눠 화면의 물리 크기를 100% 때와 같게", () => {
    expect(compensatedFontSize(14, 1)).toBe(14);
    expect(compensatedFontSize(14, 1.25)).toBe(11.2);
    expect(compensatedFontSize(12, 1.5)).toBe(8);
    expect(compensatedFontSize(14, 0.8)).toBe(17.5);
    expect(compensatedFontSize(13, 1.1)).toBe(11.82);
  });

  it("되돌려 곱하면 원래 크기에 1/100 안으로 붙는다", () => {
    for (const size of [8, 12, 14, 16, 32]) {
      for (const pct of UI_SCALES) {
        const f = pct / 100;
        expect(Math.abs(compensatedFontSize(size, f) * f - size)).toBeLessThan(0.01);
      }
    }
  });

  it("말이 안 되는 계수는 무시한다", () => {
    expect(compensatedFontSize(14, 0)).toBe(14);
    expect(compensatedFontSize(14, NaN)).toBe(14);
  });
});

describe("screenToLogical", () => {
  it("페이지의 화면 좌표(확대로 나뉜 값)에 계수를 다시 곱한다", () => {
    expect(screenToLogical(800, 1)).toBe(800);
    expect(screenToLogical(800, 1.25)).toBe(1000);
    expect(screenToLogical(-100, 1.5)).toBe(-150);
    expect(screenToLogical(800, 0)).toBe(800);
  });
});
