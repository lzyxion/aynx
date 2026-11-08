import { describe, expect, it } from "vitest";
import {
  DOC_ZOOM_DEFAULT,
  DOC_ZOOM_MAX,
  DOC_ZOOM_MIN,
  DOC_ZOOM_STEPS,
  clampDocZoom,
  docZoomIn,
  docZoomOut,
  wheelDocZoom,
} from "$lib/doc-zoom";

describe("문서 글자 크기 단계", () => {
  it("기본 100 은 단계 안에 있고 단계는 오름차순이다", () => {
    expect(DOC_ZOOM_STEPS).toContain(DOC_ZOOM_DEFAULT);
    expect([...DOC_ZOOM_STEPS].sort((a, b) => a - b)).toEqual(DOC_ZOOM_STEPS);
    expect(DOC_ZOOM_MIN).toBe(80);
    expect(DOC_ZOOM_MAX).toBe(200);
  });

  it("한 단계씩 오르내리고 끝에서는 멈춘다", () => {
    expect(docZoomIn(100)).toBe(110);
    expect(docZoomIn(110)).toBe(125);
    expect(docZoomOut(100)).toBe(90);
    expect(docZoomIn(DOC_ZOOM_MAX)).toBe(DOC_ZOOM_MAX);
    expect(docZoomOut(DOC_ZOOM_MIN)).toBe(DOC_ZOOM_MIN);
  });

  it("단계 밖 값에서도 이웃 단계로 간다", () => {
    expect(docZoomIn(130)).toBe(150);
    expect(docZoomOut(130)).toBe(125);
  });

  it("휠은 위로 굴리면 크게 · 아래로 작게 · 0 이면 그대로", () => {
    expect(wheelDocZoom(100, -120)).toBe(110);
    expect(wheelDocZoom(100, 120)).toBe(90);
    expect(wheelDocZoom(125, 0)).toBe(125);
  });

  it("읽은 값은 가장 가까운 단계로 · 숫자가 아니면 null", () => {
    expect(clampDocZoom(125)).toBe(125);
    expect(clampDocZoom(130)).toBe(125);
    expect(clampDocZoom(1000)).toBe(200);
    expect(clampDocZoom(10)).toBe(80);
    expect(clampDocZoom("120")).toBeNull();
    expect(clampDocZoom(Number.NaN)).toBeNull();
    expect(clampDocZoom(undefined)).toBeNull();
  });
});
