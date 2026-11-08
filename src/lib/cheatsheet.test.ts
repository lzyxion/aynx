import { describe, expect, it } from "vitest";
import { comboChips, keyChip, mouseChip, nthChip } from "$lib/cheatsheet";
import { mergeComboGroups } from "$lib/status-items";

const texts = (chips: { text: string }[] | null) => chips?.map((c) => c.text) ?? null;

describe("comboChips — 조합 하나가 칩 하나", () => {
  it("접지 않으면 조합마다 칩 하나 (표시 글자로)", () => {
    const chips = comboChips(["Ctrl+KeyF", "Ctrl+Shift+KeyF"]);
    expect(chips).toEqual([keyChip("Ctrl+F"), keyChip("Ctrl+Shift+F")]);
    expect(chips?.every((c) => c.kind === "key")).toBe(true);
  });

  it("방향키 넷은 빈 글자로 접어 `Alt+←→↑↓` 한 칩", () => {
    expect(texts(comboChips(["Alt+ArrowLeft", "Alt+ArrowRight", "Alt+ArrowUp", "Alt+ArrowDown"], ""))).toEqual([
      "Alt+←→↑↓",
    ]);
  });

  it("독 셋은 `/` 로 접어 `Ctrl+Shift+H/J/K` 한 칩", () => {
    expect(texts(comboChips(["Ctrl+Shift+KeyH", "Ctrl+Shift+KeyJ", "Ctrl+Shift+KeyK"], "/"))).toEqual([
      "Ctrl+Shift+H/J/K",
    ]);
  });

  it("하나를 다른 수식 키로 옮겼으면 그것은 따로 선다 — 접어서 거짓말하지 않는다", () => {
    expect(texts(comboChips(["Alt+ArrowLeft", "Ctrl+Alt+KeyH", "Alt+ArrowUp", "Alt+ArrowDown"], ""))).toEqual([
      "Alt+←↑↓",
      "Ctrl+Alt+H",
    ]);
  });

  it("모르는 id(null)는 빠지고, 하나도 없으면 null", () => {
    expect(texts(comboChips([null, "Ctrl+KeyD"]))).toEqual(["Ctrl+D"]);
    expect(comboChips([null, undefined])).toBeNull();
    expect(comboChips([])).toBeNull();
  });
});

describe("nthChip — `Alt+1…9`", () => {
  it("첫 줄의 수식 키를 빌린다", () => {
    expect(nthChip("Alt+Digit1")).toEqual([keyChip("Alt+1…9")]);
    expect(nthChip("Ctrl+Shift+Digit1")).toEqual([keyChip("Ctrl+Shift+1…9")]);
  });
  it("수식 키가 없으면 숫자만, 조합이 없으면 null", () => {
    expect(nthChip("Digit1")).toEqual([keyChip("1…9")]);
    expect(nthChip(null)).toBeNull();
  });
});

describe("칩 종류", () => {
  it("몸짓은 mouse, 고정 키는 key", () => {
    expect(mouseChip("우클릭")).toEqual({ text: "우클릭", kind: "mouse" });
    expect(keyChip("F2")).toEqual({ text: "F2", kind: "key" });
  });
});

describe("mergeComboGroups — 무리를 칩 글자 목록으로", () => {
  it("joiner 기본은 `/`, 빈 글자도 받는다", () => {
    expect(mergeComboGroups(["Ctrl+Shift+H", "Ctrl+Shift+J"])).toEqual(["Ctrl+Shift+H/J"]);
    expect(mergeComboGroups(["Alt+←", "Alt+→"], "")).toEqual(["Alt+←→"]);
    expect(mergeComboGroups([])).toEqual([]);
  });
});
