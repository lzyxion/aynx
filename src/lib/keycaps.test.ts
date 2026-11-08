import { describe, expect, it } from "vitest";
import { mouseButton, splitCombo, splitKeySequence, splitMouseGesture } from "./keycaps";

describe("splitCombo", () => {
  it("수식 키 조합은 키마다 칩 하나", () => {
    expect(splitCombo("Ctrl+Shift+H")).toEqual(["Ctrl", "Shift", "H"]);
    expect(splitCombo("Alt+X")).toEqual(["Alt", "X"]);
    expect(splitCombo("  Shift+Enter ")).toEqual(["Shift", "Enter"]);
  });

  it("키 하나는 칩 하나", () => {
    expect(splitCombo("Esc")).toEqual(["Esc"]);
    expect(splitCombo("F5")).toEqual(["F5"]);
    expect(splitCombo("↑↓")).toEqual(["↑↓"]);
    expect(splitCombo("?")).toEqual(["?"]);
  });

  it("`+` 자신이 키인 자리는 깨지 않는다", () => {
    expect(splitCombo("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(splitCombo("+")).toEqual(["+"]);
    expect(splitCombo("Ctrl+Shift++")).toEqual(["Ctrl", "Shift", "+"]);
  });

  it("구두점 끝 키는 칩 하나", () => {
    expect(splitCombo("Ctrl+,")).toEqual(["Ctrl", ","]);
    expect(splitCombo("Ctrl+/")).toEqual(["Ctrl", "/"]);
    expect(splitCombo("Ctrl+\\")).toEqual(["Ctrl", "\\"]);
  });

  it("끝 키 묶음 · 낱말은 쪼개지 않는다", () => {
    expect(splitCombo("Ctrl+Shift+H/J/K")).toEqual(["Ctrl", "Shift", "H/J/K"]);
    expect(splitCombo("Alt+←→↑↓")).toEqual(["Alt", "←→↑↓"]);
    expect(splitCombo("Alt+1…9")).toEqual(["Alt", "1…9"]);
    expect(splitCombo("Ctrl+클릭")).toEqual(["Ctrl", "클릭"]);
  });

  it("빈 글자는 빈 배열", () => {
    expect(splitCombo("")).toEqual([]);
    expect(splitCombo("   ")).toEqual([]);
  });
});

describe("splitKeySequence", () => {
  it("공백은 차례로 누르는 조합 사이", () => {
    expect(splitKeySequence("Ctrl+B d")).toEqual([["Ctrl", "B"], ["d"]]);
    expect(splitKeySequence("Ctrl+Shift+H")).toEqual([["Ctrl", "Shift", "H"]]);
  });

  it("숫자 패드 `Num 1` 은 공백이 껴도 키 하나", () => {
    expect(splitKeySequence("Ctrl+Num 1")).toEqual([["Ctrl", "Num 1"]]);
    expect(splitKeySequence("Num 5")).toEqual([["Num 5"]]);
  });

  it("빈 글자는 빈 배열", () => {
    expect(splitKeySequence("")).toEqual([]);
  });
});

describe("mouseButton", () => {
  it("ko 클릭 낱말", () => {
    expect(mouseButton("클릭")).toBe("left");
    expect(mouseButton("우클릭")).toBe("right");
    expect(mouseButton("더블클릭")).toBe("double");
  });

  it("en 클릭 낱말 — 대소문자 무시", () => {
    expect(mouseButton("Click")).toBe("left");
    expect(mouseButton("click")).toBe("left");
    expect(mouseButton("Right-click")).toBe("right");
    expect(mouseButton("right-click")).toBe("right");
    expect(mouseButton("Double-click")).toBe("double");
  });

  it("클릭이 아닌 것은 null — 키 · 드래그 · 휠", () => {
    expect(mouseButton("Ctrl")).toBeNull();
    expect(mouseButton("드래그")).toBeNull();
    expect(mouseButton("Drag")).toBeNull();
    expect(mouseButton("휠")).toBeNull();
    expect(mouseButton("C")).toBeNull();
  });

  it("조합을 쪼갠 끝 토큰으로 판정한다", () => {
    expect(splitCombo("Ctrl+클릭").map(mouseButton)).toEqual([null, "left"]);
    expect(splitCombo("Shift+우클릭").map(mouseButton)).toEqual([null, "right"]);
    expect(splitCombo("Shift+right-click").map(mouseButton)).toEqual([null, "right"]);
  });
});

describe("splitMouseGesture", () => {
  it("클릭 조합만이면 칩 조각 하나", () => {
    expect(splitMouseGesture("우클릭")).toEqual([{ kind: "keys", value: "우클릭" }]);
    expect(splitMouseGesture("Ctrl+click")).toEqual([{ kind: "keys", value: "Ctrl+click" }]);
  });

  it("자리 낱말은 글자로 — 어순은 사전 그대로", () => {
    expect(splitMouseGesture("헤더 우클릭")).toEqual([
      { kind: "text", value: "헤더" },
      { kind: "keys", value: "우클릭" },
    ]);
    expect(splitMouseGesture("Right-click tab")).toEqual([
      { kind: "keys", value: "Right-click" },
      { kind: "text", value: "tab" },
    ]);
  });

  it("클릭이 없는 몸짓은 null — 끌기 · 드래그", () => {
    expect(splitMouseGesture("헤더 → 탭 바")).toBeNull();
    expect(splitMouseGesture("빈 곳 드래그")).toBeNull();
    expect(splitMouseGesture("Drag the divider")).toBeNull();
    expect(splitMouseGesture("Ctrl")).toBeNull();
  });
});
