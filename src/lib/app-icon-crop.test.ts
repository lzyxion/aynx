import { describe, expect, it } from "vitest";
import {
  MIN_CROP,
  OUT_MAX,
  OUT_MIN,
  clampCrop,
  cropOnStage,
  fitStage,
  initialCrop,
  moveCrop,
  outputSide,
  previewBackground,
  resizeCrop,
  zoomCrop,
} from "./app-icon-crop";

describe("사용자 앱 아이콘 자르기 계산", () => {
  it("처음 영역은 짧은 변 전체의 가운데 정사각", () => {
    expect(initialCrop(400, 300)).toEqual({ x: 50, y: 0, size: 300 });
    expect(initialCrop(300, 500)).toEqual({ x: 0, y: 100, size: 300 });
    expect(initialCrop(256, 256)).toEqual({ x: 0, y: 0, size: 256 });
  });

  it("무대는 contain 으로 가운데 놓는다", () => {
    expect(fitStage(400, 200, 200)).toEqual({ scale: 0.5, left: 0, top: 50 });
    const s = fitStage(400, 200, 200);
    expect(cropOnStage({ x: 100, y: 0, size: 200 }, s)).toEqual({ left: 50, top: 50, size: 100 });
  });

  it("영역은 그림 밖으로 나가지 않고 한 변은 하한 · 짧은 변 사이", () => {
    expect(clampCrop({ x: -10, y: 500, size: 100 }, 400, 300)).toEqual({ x: 0, y: 200, size: 100 });
    expect(clampCrop({ x: 0, y: 0, size: 999 }, 400, 300).size).toBe(300);
    expect(clampCrop({ x: 0, y: 0, size: 1 }, 400, 300).size).toBe(MIN_CROP);
    // 하한보다 작은 그림이면 짧은 변이 하한이다.
    expect(clampCrop({ x: 0, y: 0, size: 1 }, 10, 12).size).toBe(10);
  });

  it("옮기기는 한 변을 지키고 가장자리에서 멈춘다", () => {
    const c = { x: 50, y: 0, size: 300 };
    expect(moveCrop(c, 30, 30, 400, 300)).toEqual({ x: 80, y: 0, size: 300 });
    expect(moveCrop(c, 500, 0, 400, 300)).toEqual({ x: 100, y: 0, size: 300 });
  });

  it("모서리 끌기 — 반대 모서리가 고정이고 그림 끝이 상한", () => {
    const c = { x: 100, y: 100, size: 100 };
    // 오른쪽 아래를 대각선으로 20 끌면 한 변 +20, 왼쪽 위 고정.
    expect(resizeCrop(c, "se", 20, 20, 400, 400)).toEqual({ x: 100, y: 100, size: 120 });
    // 왼쪽 위를 바깥으로 끌면 오른쪽 아래(200,200) 고정.
    expect(resizeCrop(c, "nw", -40, -40, 400, 400)).toEqual({ x: 60, y: 60, size: 140 });
    // 상한 — 오른쪽 위로 크게 끌면 위쪽 여유(아래 변 y=200)와 오른쪽 여유(400-100) 중 작은 것.
    expect(resizeCrop(c, "ne", 1000, -1000, 400, 400)).toEqual({ x: 100, y: 0, size: 200 });
    // 하한 — 안으로 크게 끌어도 MIN_CROP.
    expect(resizeCrop(c, "sw", 1000, -1000, 400, 400)).toEqual({ x: 200 - MIN_CROP, y: 100, size: MIN_CROP });
  });

  it("휠 확대는 가운데를 지키고 그림 안에 머문다", () => {
    const c = { x: 100, y: 100, size: 100 };
    expect(zoomCrop(c, 0.5, 400, 400)).toEqual({ x: 125, y: 125, size: 50 });
    expect(zoomCrop(c, 10, 400, 300).size).toBe(300);
    const z = zoomCrop({ x: 0, y: 0, size: 100 }, 2, 400, 400);
    expect(z).toEqual({ x: 0, y: 0, size: 200 });
  });

  it("내보낼 한 변은 256..1024", () => {
    expect(outputSide({ x: 0, y: 0, size: 40 })).toBe(OUT_MIN);
    expect(outputSide({ x: 0, y: 0, size: 600.4 })).toBe(600);
    expect(outputSide({ x: 0, y: 0, size: 4000 })).toBe(OUT_MAX);
  });

  it("미리보기 배경은 영역이 상자를 꽉 채운다", () => {
    expect(previewBackground({ x: 100, y: 50, size: 200 }, 400, 300, 64)).toEqual({
      size: "128px 96px",
      position: "-32px -16px",
    });
  });
});
