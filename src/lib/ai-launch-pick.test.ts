import { describe, expect, it } from "vitest";
import { carouselOffset, digitRowIndex, launchFormFor, otherLaunchForm, parseLaunchForm, planAiLaunch } from "./ai-launch-pick";

const claude = { command: "claude", id: "claude", name: "Claude Code" };
const codex = { command: "codex", id: "codex", name: "Codex" };

describe("planAiLaunch", () => {
  it("후보가 없으면 none", () => {
    expect(planAiLaunch([], [], null)).toEqual({ mode: "none" });
  });

  it("후보가 하나면 상자 없이 곧바로", () => {
    expect(planAiLaunch([codex], [{ id: "codex", installed: true }], "claude")).toEqual({ mode: "direct", cli: codex, chat: false });
  });

  it("줄 순서 · 숫자 키 · 설치 여부는 후보 그대로", () => {
    const plan = planAiLaunch([claude, codex], [{ id: "claude", installed: true }, { id: "codex", installed: false }], null);
    expect(plan).toEqual({
      mode: "pick",
      selected: 0,
      rows: [
        { cli: claude, installed: true, digit: "1", chat: false },
        { cli: codex, installed: false, digit: "2", chat: false },
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

describe("planAiLaunch — 채팅 모양(실험 설정)", () => {
  const det = [
    { id: "claude", installed: true },
    { id: "codex", installed: true },
  ];
  const gemini = { command: "gemini", id: "gemini", name: "Gemini" };

  it("설정 켬이면 Claude Code · Codex 줄에 chat: true · 모르는 CLI 는 false", () => {
    const plan = planAiLaunch([claude, codex, gemini], det, null, true);
    expect(plan.mode === "pick" && plan.rows.map((r) => r.chat)).toEqual([true, true, false]);
  });

  it("설정 끔이면 줄 모두 chat: false", () => {
    const plan = planAiLaunch([claude, codex], det, null, false);
    expect(plan.mode === "pick" && plan.rows.map((r) => r.chat)).toEqual([false, false]);
  });

  it("후보가 하나면 설정과 상관없이 곧바로 — 채팅을 받는지만 싣는다", () => {
    expect(planAiLaunch([codex], det, null, true)).toEqual({ mode: "direct", cli: codex, chat: true });
    expect(planAiLaunch([codex], det, null, false)).toEqual({ mode: "direct", cli: codex, chat: false });
    expect(planAiLaunch([gemini], det, null, true)).toEqual({ mode: "direct", cli: gemini, chat: false });
  });
});

describe("여는 모양 — [ai] launch_form", () => {
  it("parseLaunchForm — \"chat\" 만 채팅 · 생략 · 틀린 꼴은 터미널", () => {
    expect(parseLaunchForm("chat")).toBe("chat");
    for (const v of [undefined, null, "", "terminal", "Chat", " chat", 1, true, {}]) expect(parseLaunchForm(v)).toBe("terminal");
  });

  it("launchFormFor — 채팅을 못 받는 줄(설정 끔 · 모르는 CLI · 원격)은 늘 터미널", () => {
    expect(launchFormFor(true, "chat")).toBe("chat");
    expect(launchFormFor(true, "terminal")).toBe("terminal");
    expect(launchFormFor(false, "chat")).toBe("terminal");
    expect(launchFormFor(false, "terminal")).toBe("terminal");
  });

  it("설정 끔이면 기본 모양이 채팅이어도 줄은 터미널로 연다", () => {
    const det = [{ id: "claude", installed: true }, { id: "codex", installed: true }];
    const plan = planAiLaunch([claude, codex], det, null, false);
    expect(plan.mode === "pick" && plan.rows.map((r) => launchFormFor(r.chat, "chat"))).toEqual(["terminal", "terminal"]);
  });

  it("otherLaunchForm", () => {
    expect(otherLaunchForm("chat")).toBe("terminal");
    expect(otherLaunchForm("terminal")).toBe("chat");
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
