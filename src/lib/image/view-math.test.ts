import { describe, expect, it } from "vitest";
import {
  aboveFit,
  canPan,
  centerOnMap,
  clampPan,
  clampScale,
  fitScale,
  fitView,
  minimapRect,
  minimapSize,
  panBy,
  percentOf,
  stepScale,
  wheelFactor,
  zoomAt,
  zoomCentered,
  zoomLabel,
  zoomPressed,
  presetChecked,
  NO_ZOOM_LABEL,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./view-math";

const box = { w: 400, h: 300 };

describe("fitScale — 맞춤은 다 들어오는 배율, 1 을 넘지 않는다", () => {
  it("큰 그림은 줄인다(긴 쪽 기준)", () => {
    expect(fitScale({ w: 800, h: 300 }, box)).toBeCloseTo(0.5);
    expect(fitScale({ w: 400, h: 600 }, box)).toBeCloseTo(0.5);
  });
  it("작은 그림은 늘리지 않는다 — 1:1", () => {
    expect(fitScale({ w: 100, h: 50 }, box)).toBe(1);
  });
  it("크기를 모르면 1", () => {
    expect(fitScale({ w: 0, h: 0 }, box)).toBe(1);
    expect(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 })).toBe(1);
  });
  it("맞춤 보기는 가운데", () => {
    expect(fitView({ w: 100, h: 50 }, box)).toEqual({ scale: 1, x: 150, y: 125 });
  });
});

describe("clampScale · clampPan", () => {
  it("배율은 하한 · 상한으로 묶되 맞춤이 더 작으면 맞춤까지", () => {
    expect(clampScale(100)).toBe(ZOOM_MAX);
    expect(clampScale(0.001)).toBe(ZOOM_MIN);
    expect(clampScale(0.001, 0.01)).toBe(0.01);
    expect(clampScale(Number.NaN)).toBe(1);
  });
  it("작은 축은 가운데, 큰 축은 빈 곳이 보이지 않게", () => {
    const img = { w: 1000, h: 100 };
    expect(clampPan({ scale: 1, x: 50, y: 0 }, img, box)).toEqual({ scale: 1, x: 0, y: 100 });
    expect(clampPan({ scale: 1, x: -900, y: 0 }, img, box).x).toBe(-600);
    expect(clampPan({ scale: 1, x: -300, y: 0 }, img, box).x).toBe(-300);
  });
});

describe("zoomAt — 커서 자리의 그림 점이 그대로 남는다", () => {
  it("커서 밑 그림 점이 확대 뒤에도 커서 밑", () => {
    const img = { w: 2000, h: 1500 };
    const v0 = fitView(img, box); // 0.2
    const at = { x: 100, y: 80 };
    const ix = (at.x - v0.x) / v0.scale;
    const iy = (at.y - v0.y) / v0.scale;
    const v1 = zoomAt(v0, img, box, 1, at);
    expect(v1.scale).toBe(1);
    expect((at.x - v1.x) / v1.scale).toBeCloseTo(ix);
    expect((at.y - v1.y) / v1.scale).toBeCloseTo(iy);
  });
  it("가장자리에서는 경계가 이긴다(빈 곳을 보이지 않는다)", () => {
    const img = { w: 2000, h: 1500 };
    const v = zoomAt(fitView(img, box), img, box, 1, { x: 0, y: 0 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });
  it("가운데 기준 확대 — 상한으로 묶인다", () => {
    const img = { w: 100, h: 100 };
    expect(zoomCentered(fitView(img, box), img, box, 1000).scale).toBe(ZOOM_MAX);
  });
});

describe("이동 · 단계 · 휠 · 글자", () => {
  it("끌기는 경계 안에서만", () => {
    const img = { w: 1000, h: 1000 };
    const v = { scale: 1, x: 0, y: 0 };
    expect(panBy(v, img, box, 50, 50)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(panBy(v, img, box, -50, -20)).toEqual({ scale: 1, x: -50, y: -20 });
  });
  it("끌 곳이 있는가 · 맞춤보다 큰가", () => {
    const img = { w: 1000, h: 1000 };
    expect(canPan({ scale: 0.3, x: 0, y: 0 }, img, box)).toBe(false);
    expect(canPan({ scale: 1, x: 0, y: 0 }, img, box)).toBe(true);
    expect(aboveFit(fitScale(img, box), img, box)).toBe(false);
    expect(aboveFit(1, img, box)).toBe(true);
    // 작은 그림은 1:1 이 맞춤이라 작은 지도가 서지 않는다
    expect(aboveFit(1, { w: 50, h: 50 }, box)).toBe(false);
  });
  it("단계 · 휠 · 백분율", () => {
    expect(stepScale(1, 1)).toBeCloseTo(1.25);
    expect(stepScale(1.25, -1)).toBeCloseTo(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-100000)).toBe(2);
    expect(percentOf(0.424)).toBe(42);
    expect(percentOf(0.001)).toBe(1);
  });
});

describe("배율 글자 · [맞춤 | 1:1] · 배율 목록 체크 — 하나만 켠다", () => {
  it("그림이 없으면 배율 글자는 빈 표시", () => {
    expect(zoomLabel(null)).toBe(NO_ZOOM_LABEL);
    expect(zoomLabel(0.424)).toBe("42%");
  });
  it("작은 그림의 맞춤(= 1:1)은 [맞춤] 만 · 1:1 을 고른 상태면 [1:1] 만", () => {
    expect(zoomPressed(true, true, 1)).toEqual({ fit: true, actual: false });
    expect(zoomPressed(true, false, 1)).toEqual({ fit: false, actual: true });
    expect(zoomPressed(true, false, 2)).toEqual({ fit: false, actual: false });
    expect(zoomPressed(false, true, 1)).toEqual({ fit: false, actual: false });
  });
  it("배율 목록도 같은 규칙 — 맞춤 보기면 100% 줄을 체크하지 않는다", () => {
    expect(presetChecked(true, 1, 1)).toBe(false);
    expect(presetChecked(false, 1, 1)).toBe(true);
    expect(presetChecked(false, 0.5, 1)).toBe(false);
  });
});

describe("작은 지도", () => {
  it("비율 그대로 긴 변이 max", () => {
    expect(minimapSize({ w: 2000, h: 1000 }, 160)).toEqual({ w: 160, h: 80 });
  });
  it("보는 사각형 — 그림 왼쪽 위 1:1 이면 무대 크기만큼", () => {
    const img = { w: 2000, h: 1000 };
    const map = minimapSize(img, 160);
    const r = minimapRect({ scale: 1, x: 0, y: 0 }, img, box, map);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBeCloseTo(400 * (160 / 2000));
    expect(r.h).toBeCloseTo(300 * (80 / 1000));
  });
  it("지도를 누른 점이 무대 가운데로(경계 안)", () => {
    const img = { w: 2000, h: 1000 };
    const map = minimapSize(img, 160);
    const v = centerOnMap({ scale: 1, x: 0, y: 0 }, img, box, map, { x: 80, y: 40 });
    expect(v.x).toBeCloseTo(200 - 1000);
    expect(v.y).toBeCloseTo(150 - 500);
  });
});
