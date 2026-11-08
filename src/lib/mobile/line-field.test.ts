import { describe, expect, it } from "vitest";
import { armedFieldChar, DEL, emptyFieldDelete, emptyFieldKey } from "./line-field";
import { ctrlOf } from "./keys";

describe("emptyFieldKey — 빈 입력 칸의 키", () => {
  it("빈 칸의 Backspace 는 셸에 DEL", () => {
    expect(emptyFieldKey("Backspace", "", false)).toBe(DEL);
    expect(DEL).toBe("\x7f");
  });

  it("글이 있거나 조합 중이면 칸의 몫", () => {
    expect(emptyFieldKey("Backspace", "a", false)).toBeNull();
    expect(emptyFieldKey("Backspace", "", true)).toBeNull();
  });

  it("다른 키(Enter 포함)는 손대지 않는다 — 빈 Enter 는 폼 제출이 보낸다", () => {
    for (const k of ["Enter", "a", "Unidentified", "Process", "Delete"]) expect(emptyFieldKey(k, "", false)).toBeNull();
  });
});

describe("armedFieldChar — 끈적 Ctrl + 입력 칸", () => {
  it("빈 칸에 글자 하나 → 곧장 보낸다(Ctrl 은 터미널 문이 붙인다)", () => {
    expect(armedFieldChar("", "c", true)).toBe("c");
    expect(ctrlOf(armedFieldChar("", "c", true)!)).toBe("\x03");
    expect(ctrlOf(armedFieldChar("", "D", true)!)).toBe("\x04");
  });

  it("Ctrl 이 안 걸렸거나 · 쓰던 글 뒤거나 · 여러 글자면 칸에 둔다", () => {
    expect(armedFieldChar("", "c", false)).toBeNull();
    expect(armedFieldChar("ab", "abc", true)).toBeNull();
    expect(armedFieldChar("", "hello", true)).toBeNull();
    expect(armedFieldChar("", "", true)).toBeNull();
  });

  it("서로게이트 쌍 하나도 한 글자로 센다", () => {
    expect(armedFieldChar("", "😀", true)).toBe("😀");
  });
});

describe("emptyFieldDelete — 키 없이 온 지우기 입력", () => {
  it("빈 칸의 뒤로 지우기만", () => {
    expect(emptyFieldDelete("deleteContentBackward", "", false)).toBe(true);
    expect(emptyFieldDelete("deleteWordBackward", "", false)).toBe(true);
    expect(emptyFieldDelete("deleteContentBackward", "a", false)).toBe(false);
    expect(emptyFieldDelete("deleteContentBackward", "", true)).toBe(false);
    expect(emptyFieldDelete("insertText", "", false)).toBe(false);
    expect(emptyFieldDelete("deleteContentForward", "", false)).toBe(false);
  });
});
