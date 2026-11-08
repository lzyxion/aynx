import { describe, expect, it } from "vitest";
import { originOf, randomOrigin, revealRadius } from "./theme-reveal";

describe("randomOrigin — 아무 자리", () => {
  it("가장자리 10% 안쪽에 선다", () => {
    expect(randomOrigin(1000, 500, () => 0)).toEqual({ x: 100, y: 50 });
    const far = randomOrigin(1000, 500, () => 0.999999);
    expect(far.x).toBeLessThan(900);
    expect(far.y).toBeLessThan(450);
    expect(randomOrigin(1000, 500, () => 0.5)).toEqual({ x: 500, y: 250 });
  });
});

describe("originOf — 시작점", () => {
  it("사각형의 가운데", () => {
    expect(originOf({ left: 100, top: 40, width: 60, height: 20 }, 1200, 800)).toEqual({ x: 130, y: 50 });
  });

  it("사각형이 없으면 창 가운데", () => {
    expect(originOf(null, 1200, 800)).toEqual({ x: 600, y: 400 });
  });

  it("크기가 0 인 사각형(숨은 요소)도 창 가운데", () => {
    expect(originOf({ left: 10, top: 10, width: 0, height: 20 }, 1000, 600)).toEqual({ x: 500, y: 300 });
    expect(originOf({ left: 10, top: 10, width: 20, height: 0 }, 1000, 600)).toEqual({ x: 500, y: 300 });
  });
});

describe("revealRadius — 가장 먼 모서리까지", () => {
  it("창 가운데면 반 대각선", () => {
    expect(revealRadius({ x: 600, y: 400 }, 1200, 800)).toBeCloseTo(Math.hypot(600, 400));
  });

  it("왼쪽 위 모서리면 대각선 전체", () => {
    expect(revealRadius({ x: 0, y: 0 }, 1200, 800)).toBeCloseTo(Math.hypot(1200, 800));
  });

  it("오른쪽 아래 근처면 왼쪽 위 모서리까지", () => {
    expect(revealRadius({ x: 1100, y: 700 }, 1200, 800)).toBeCloseTo(Math.hypot(1100, 700));
  });

  it("어느 모서리든 그 거리 이하다", () => {
    const p = { x: 230, y: 610 };
    const r = revealRadius(p, 1200, 800);
    for (const [cx, cy] of [
      [0, 0],
      [1200, 0],
      [0, 800],
      [1200, 800],
    ]) {
      expect(Math.hypot(cx - p.x, cy - p.y)).toBeLessThanOrEqual(r + 1e-9);
    }
  });
});
