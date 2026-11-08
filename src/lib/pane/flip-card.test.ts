import { describe, expect, it } from "vitest";
import { FLIP_CARD, cardAt, cardScale, flipDuration, planFlip, restingCard } from "./flip-card";

describe("planFlip", () => {
  it("쉬는 터미널 → 대화: 0 → -90 · 바뀜 · +90 → 0, 바뀌는 순간은 한가운데", () => {
    const plan = planFlip(restingCard("term"), "convo")!;
    expect(plan.from).toBe("term");
    expect(plan.to).toBe("convo");
    expect(plan.swapAt).toBe(0.5);
    expect(plan.travel).toBe(180);
    expect(plan.stops).toEqual([
      { offset: 0, angle: 0 },
      { offset: 0.5, angle: -90 },
      { offset: 0.5, angle: 90 },
      { offset: 1, angle: 0 },
    ]);
  });

  it("대화 → 터미널은 거울(반대 방향)", () => {
    const plan = planFlip(restingCard("convo"), "term")!;
    expect(plan.stops.map((s) => s.angle)).toEqual([0, 90, -90, 0]);
  });

  it("이미 그 면 0° 면 움직일 것 없음", () => {
    expect(planFlip(restingCard("term"), "term")).toBeNull();
  });

  it("도중에 되돌림 — 지금 면이 목표면 그 각도에서 0° 로, 면 바뀜 없음", () => {
    const plan = planFlip({ face: "term", angle: -40 }, "term")!;
    expect(plan.swapAt).toBeNull();
    expect(plan.travel).toBe(40);
    expect(plan.stops).toEqual([
      { offset: 0, angle: -40 },
      { offset: 1, angle: 0 },
    ]);
  });

  it("도중에 되돌림 — 이미 바뀐 면이면 그 가장자리까지 가서 다시 바꾼다", () => {
    // 터미널 → 대화 후반(대화 면 +30°)에서 터미널로
    const plan = planFlip({ face: "convo", angle: 30 }, "term")!;
    expect(plan.from).toBe("convo");
    expect(plan.stops.map((s) => s.angle)).toEqual([30, 90, -90, 0]);
    expect(plan.travel).toBe(150);
    expect(plan.swapAt).toBeCloseTo(60 / 150);
  });
});

describe("cardAt", () => {
  const full = planFlip(restingCard("term"), "convo")!;

  it("앞 절반은 처음 면, 가장자리부터는 바뀐 면", () => {
    expect(cardAt(full, 0)).toEqual({ face: "term", angle: 0 });
    expect(cardAt(full, 0.25)).toEqual({ face: "term", angle: -45 });
    expect(cardAt(full, 0.5)).toEqual({ face: "convo", angle: 90 });
    expect(cardAt(full, 0.75)).toEqual({ face: "convo", angle: 45 });
    expect(cardAt(full, 1)).toEqual({ face: "convo", angle: 0 });
  });

  it("면마다 사는 쪽이 정해져 있다 — 터미널은 음수 · 대화는 양수", () => {
    for (let i = 0; i <= 20; i++) {
      const s = cardAt(full, i / 20);
      if (s.face === "term") expect(s.angle).toBeLessThanOrEqual(0);
      else expect(s.angle).toBeGreaterThanOrEqual(0);
      expect(Math.abs(s.angle)).toBeLessThanOrEqual(90);
    }
  });

  it("범위 밖 진행도는 끝으로 붙인다", () => {
    expect(cardAt(full, -1)).toEqual({ face: "term", angle: 0 });
    expect(cardAt(full, 2)).toEqual({ face: "convo", angle: 0 });
  });

  it("되돌림 길도 읽는다", () => {
    const back = planFlip({ face: "term", angle: -60 }, "term")!;
    expect(cardAt(back, 0.5)).toEqual({ face: "term", angle: -30 });
  });

  it("연타를 이어 붙여도 각도가 이어진다", () => {
    const mid = cardAt(full, 0.6); // 대화 면 +72°
    const back = planFlip(mid, "term")!;
    expect(cardAt(back, 0)).toEqual(mid);
    expect(cardAt(back, 1)).toEqual({ face: "term", angle: 0 });
  });
});

describe("flipDuration", () => {
  it("쉬던 자리에서면 한 번의 길이", () => {
    expect(flipDuration(planFlip(restingCard("term"), "convo")!, false)).toBe(FLIP_CARD.ms);
  });

  it("도중이면 돌 각도에 비례해 짧게 — 아래 한계 있음", () => {
    expect(flipDuration(planFlip({ face: "convo", angle: 0.5 }, "term")!, true)).toBeLessThanOrEqual(FLIP_CARD.rapidMs + 1);
    expect(flipDuration(planFlip({ face: "term", angle: -5 }, "term")!, true)).toBe(FLIP_CARD.rapidMinMs);
    expect(flipDuration(planFlip({ face: "term", angle: -90 }, "term")!, true)).toBe(Math.round(FLIP_CARD.rapidMs / 2));
  });
});

describe("cardScale", () => {
  it("0° 면 그대로, 가장자리에서 원근 확대를 정확히 상쇄", () => {
    expect(cardScale(0)).toBe(1);
    const k = FLIP_CARD.perspective;
    // 가까운 변의 확대 k / (k - 0.5) × 축소 = 1
    expect(cardScale(90) * (k / (k - 0.5))).toBeCloseTo(1);
    expect(cardScale(-90)).toBe(cardScale(90));
  });
});
