import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  anchoredScroll,
  clampZoom,
  effectiveZoom,
  toggleZoom,
  wheelZoom,
  zoomIn,
  zoomOut,
  zoomPercent,
} from "$lib/mermaid-zoom";

describe("mermaid 배율 — 단계", () => {
  it("맞춤에서 한 단계 — 맞춤 배율보다 큰/작은 첫 단계", () => {
    expect(zoomIn(null, 0.6)).toBe(0.67);
    expect(zoomOut(null, 0.6)).toBe(0.5);
    // 좁은 다이어그램은 맞춤 = 100%
    expect(zoomIn(null, 1)).toBe(1.25);
    expect(zoomOut(null, 1)).toBe(0.9);
  });

  it("단계 위에 있으면 이웃 단계로", () => {
    expect(zoomIn(1, 0.3)).toBe(1.25);
    expect(zoomOut(1.25, 0.3)).toBe(1);
    expect(zoomIn(2, 1)).toBe(2.5);
  });

  it("맞춤 배율이 단계와 거의 같으면 그 단계를 건너뛴다", () => {
    expect(zoomIn(null, 0.6699)).toBe(0.75);
    expect(zoomOut(null, 0.6701)).toBe(0.5);
  });

  it("양끝에서 멈춘다", () => {
    expect(zoomIn(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomOut(ZOOM_MIN, 1)).toBe(ZOOM_MIN);
    // 맞춤이 50% 보다 작아도(아주 넓은 다이어그램) 축소는 50%
    expect(zoomOut(null, 0.2)).toBe(ZOOM_MIN);
    expect(zoomIn(null, 0.2)).toBe(0.5);
  });

  it("휠 — 위로 크게, 아래로 작게, 0 은 그대로", () => {
    expect(wheelZoom(1, 1, -100)).toBe(1.25);
    expect(wheelZoom(1, 1, 100)).toBe(0.9);
    expect(wheelZoom(null, 1, 0)).toBe(null);
  });

  it("더블클릭 — 맞춤 ↔ 100%", () => {
    expect(toggleZoom(null)).toBe(1);
    expect(toggleZoom(1)).toBe(null);
    expect(toggleZoom(2.5)).toBe(null);
  });
});

describe("mermaid 배율 — 값", () => {
  it("한계 · 숫자 아님", () => {
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("보이는 배율 · 글자 — 맞춤을 못 쟀으면 100%", () => {
    expect(effectiveZoom(null, 0)).toBe(1);
    expect(effectiveZoom(null, 0.42)).toBe(0.42);
    expect(effectiveZoom(2, 0.42)).toBe(2);
    expect(zoomPercent(null, 0.426)).toBe("43%");
    expect(zoomPercent(1.25, 1)).toBe("125%");
  });

  it("기준점 고정 스크롤", () => {
    // 100 → 200%: 상자 왼쪽에서 50px 의 점(내용 50)이 내용 100 이 되므로 스크롤 50
    expect(anchoredScroll(0, 50, 1, 2)).toBe(50);
    // 되돌리면 0
    expect(anchoredScroll(50, 50, 2, 1)).toBe(0);
    expect(anchoredScroll(10, 0, 0, 2)).toBe(10);
    expect(anchoredScroll(0, 100, 2, 1)).toBe(0);
  });
});
