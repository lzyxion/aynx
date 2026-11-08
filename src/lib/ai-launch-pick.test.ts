import { describe, expect, it } from "vitest";
import { carouselOffset, digitRowIndex, planAiLaunch } from "./ai-launch-pick";

const claude = { command: "claude", id: "claude", name: "Claude Code" };
const codex = { command: "codex", id: "codex", name: "Codex" };

describe("planAiLaunch", () => {
  it("후보가 없으면 none", () => {
    expect(planAiLaunch([], [], null)).toEqual({ mode: "none" });
  });

  it("후보가 하나면 상자 없이 곧바로", () => {
    expect(planAiLaunch([codex], [{ id: "codex", installed: true }], "claude")).toEqual({ mode: "direct", cli: codex });
  });

  it("줄 순서 · 숫자 키 · 설치 여부는 후보 그대로", () => {
    const plan = planAiLaunch([claude, codex], [{ id: "claude", installed: true }, { id: "codex", installed: false }], null);
    expect(plan).toEqual({
      mode: "pick",
      selected: 0,
      rows: [
        { cli: claude, installed: true, digit: "1" },
        { cli: codex, installed: false, digit: "2" },
      ],
    });
  });

  it("감지 목록에 없는 후보(폴백)는 설치 안 됨", () => {
    const plan = planAiLaunch([claude, codex], [], null);
    expect(plan.mode === "pick" && plan.rows.map((r) => r.installed)).toEqual([false, false]);
  });

  it("처음 골라진 줄 = 마지막으로 연 CLI · 후보에 없으면 첫 줄", () => {
    const det = [
      { id: "claude", installed: true },
      { id: "codex", installed: true },
    ];
    expect(planAiLaunch([claude, codex], det, "codex")).toMatchObject({ mode: "pick", selected: 1 });
    expect(planAiLaunch([claude, codex], det, "gemini")).toMatchObject({ mode: "pick", selected: 0 });
  });

  it("열째 줄부터는 숫자 키가 없다", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ command: `c${i}`, id: `c${i}`, name: `C${i}` }));
    const plan = planAiLaunch(many, [], null);
    expect(plan.mode === "pick" && plan.rows.map((r) => r.digit)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", null, null,
    ]);
  });
});

describe("digitRowIndex", () => {
  it("숫자 줄 · 숫자 패드 둘 다", () => {
    expect(digitRowIndex("Digit1", 2)).toBe(0);
    expect(digitRowIndex("Numpad2", 2)).toBe(1);
  });
  it("줄이 없거나 숫자 키가 아니면 null", () => {
    expect(digitRowIndex("Digit3", 2)).toBeNull();
    expect(digitRowIndex("Digit0", 5)).toBeNull();
    expect(digitRowIndex("KeyA", 5)).toBeNull();
  });
});

describe("carouselOffset — 돌림판 자리", () => {
  it("골라진 줄은 0, 양옆은 ±1", () => {
    expect(carouselOffset(2, 2, 5)).toBe(0);
    expect(carouselOffset(3, 2, 5)).toBe(1);
    expect(carouselOffset(1, 2, 5)).toBe(-1);
  });
  it("끝과 처음이 이어진다", () => {
    expect(carouselOffset(0, 4, 5)).toBe(1);
    expect(carouselOffset(4, 0, 5)).toBe(-1);
  });
  it("짝수 개의 맞은편은 왼쪽", () => {
    expect(carouselOffset(2, 0, 4)).toBe(-2);
    expect(carouselOffset(1, 0, 2)).toBe(-1);
  });
  it("줄 하나 · 없음", () => {
    expect(carouselOffset(0, 0, 1)).toBe(0);
    expect(carouselOffset(0, 0, 0)).toBe(0);
  });
});
