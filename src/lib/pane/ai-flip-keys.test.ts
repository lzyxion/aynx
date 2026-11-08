import { describe, expect, it } from "vitest";
import { composerEnter, flipKeyAction, isTypingKey, sentMatches, type FlipKeyContext, type FlipKeyEvent } from "$lib/pane/ai-flip-keys";
import { submitPlan } from "$lib/term/submit-text";

const ev = (key: string, code: string, mods: Partial<FlipKeyEvent> = {}): FlipKeyEvent => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
/** 포커스가 터미널 textarea 에 있는 대화 면(기본) */
const term: FlipKeyContext = { globalCombo: false, inComposer: false, inConvo: false, onControl: false, hasSelection: false };
const convo: FlipKeyContext = { ...term, inConvo: true };

describe("flipKeyAction — 대화 면의 키", () => {
  it("글자 · Shift 글자 · 스페이스 · 한글 IME(Process/229) 는 터미널로 넘기며 흘려보낸다", () => {
    expect(flipKeyAction(ev("a", "KeyA"), term)).toBe("type");
    expect(flipKeyAction(ev("A", "KeyA", { shiftKey: true }), term)).toBe("type");
    expect(flipKeyAction(ev(" ", "Space"), term)).toBe("type");
    expect(flipKeyAction(ev("Process", "KeyG", { keyCode: 229 }), term)).toBe("type");
    expect(flipKeyAction(ev("ㅎ", "KeyG", { isComposing: true }), term)).toBe("type");
    expect(flipKeyAction(ev("Dead", "Quote"), term)).toBe("type");
  });
  it("AltGr 글자(Ctrl+Alt)는 글자, Ctrl 이나 Alt 하나만이면 조합", () => {
    expect(isTypingKey(ev("@", "KeyQ", { ctrlKey: true, altKey: true }))).toBe(true);
    expect(isTypingKey(ev("a", "KeyA", { ctrlKey: true }))).toBe(false);
    expect(isTypingKey(ev("a", "KeyA", { altKey: true }))).toBe(false);
  });
  it("붙여넣기 조합은 터미널로", () => {
    expect(flipKeyAction(ev("v", "KeyV", { ctrlKey: true }), term)).toBe("type");
    expect(flipKeyAction(ev("V", "KeyV", { ctrlKey: true, shiftKey: true }), term)).toBe("type");
    expect(flipKeyAction(ev("Insert", "Insert", { shiftKey: true }), term)).toBe("type");
  });
  it("Escape 는 돌아가기(CLI 로 보내지 않는다)", () => {
    expect(flipKeyAction(ev("Escape", "Escape"), term)).toBe("back");
    expect(flipKeyAction(ev("Escape", "Escape"), convo)).toBe("back");
  });
  it("스크롤 키는 대화 면을 민다", () => {
    expect(flipKeyAction(ev("ArrowUp", "ArrowUp"), term)).toBe("scroll-up");
    expect(flipKeyAction(ev("ArrowDown", "ArrowDown"), term)).toBe("scroll-down");
    expect(flipKeyAction(ev("PageUp", "PageUp"), term)).toBe("page-up");
    expect(flipKeyAction(ev("PageDown", "PageDown"), term)).toBe("page-down");
    expect(flipKeyAction(ev("Home", "Home"), term)).toBe("top");
    expect(flipKeyAction(ev("End", "End", { ctrlKey: true }), term)).toBe("bottom");
  });
  it("Ctrl+C — 대화 면에 고른 글이 있으면 기본 복사, 없으면 삼킨다(CLI 중단이 새지 않게)", () => {
    const c = ev("c", "KeyC", { ctrlKey: true });
    expect(flipKeyAction(c, { ...convo, hasSelection: true })).toBe("pass");
    expect(flipKeyAction(c, convo)).toBe("swallow");
    expect(flipKeyAction(c, term)).toBe("swallow");
    expect(flipKeyAction(ev("Insert", "Insert", { ctrlKey: true }), { ...convo, hasSelection: true })).toBe("pass");
  });
  it("전역 단축키 · 수식 키 홀로는 지나간다", () => {
    expect(flipKeyAction(ev("|", "Backslash", { ctrlKey: true, shiftKey: true }), { ...term, globalCombo: true })).toBe("pass");
    expect(flipKeyAction(ev("Shift", "ShiftLeft", { shiftKey: true }), term)).toBe("pass");
    expect(flipKeyAction(ev("Control", "ControlLeft", { ctrlKey: true }), term)).toBe("pass");
  });
  it("대화 면 안 단추의 Enter/Space 와 Tab 은 제 것", () => {
    expect(flipKeyAction(ev("Enter", "Enter"), { ...convo, onControl: true })).toBe("pass");
    expect(flipKeyAction(ev(" ", "Space"), { ...convo, onControl: true })).toBe("pass");
    expect(flipKeyAction(ev("Tab", "Tab"), convo)).toBe("pass");
  });
  it("그 밖은 보이지 않는 터미널로 새지 않게 삼킨다", () => {
    expect(flipKeyAction(ev("Enter", "Enter"), term)).toBe("swallow");
    expect(flipKeyAction(ev("Backspace", "Backspace"), term)).toBe("swallow");
    expect(flipKeyAction(ev("Tab", "Tab"), term)).toBe("swallow");
    expect(flipKeyAction(ev("d", "KeyD", { ctrlKey: true }), term)).toBe("swallow");
    expect(flipKeyAction(ev("F5", "F5"), term)).toBe("swallow");
  });
});

describe("대화 기록 안 찾기", () => {
  const ctrlF = ev("f", "KeyF", { ctrlKey: true });
  it("find 조합이면 어디서든(입력 칸 · 기록 · 터미널 포커스) 띠를 연다 — 전역 조합이어도 먼저", () => {
    expect(flipKeyAction(ctrlF, { ...term, inComposer: true, globalCombo: true, findCombo: true })).toBe("find");
    expect(flipKeyAction(ctrlF, { ...convo, globalCombo: true, findCombo: true })).toBe("find");
    expect(flipKeyAction(ctrlF, { ...term, globalCombo: true, findCombo: true })).toBe("find");
  });
  it("find 조합이 아니면 예전 그대로(전역 조합은 지나간다)", () => {
    expect(flipKeyAction(ctrlF, { ...convo, globalCombo: true })).toBe("pass");
    expect(flipKeyAction(ctrlF, convo)).toBe("swallow");
  });
  it("띠 안의 키는 전부 띠의 것 — Escape(띠 닫기) · Enter · F3 · 글자 · 칸 안의 Ctrl+F", () => {
    const inFind: FlipKeyContext = { ...convo, inFind: true };
    expect(flipKeyAction(ev("Escape", "Escape"), inFind)).toBe("pass");
    expect(flipKeyAction(ev("Enter", "Enter"), inFind)).toBe("pass");
    expect(flipKeyAction(ev("F3", "F3", { shiftKey: true }), inFind)).toBe("pass");
    expect(flipKeyAction(ev("a", "KeyA"), inFind)).toBe("pass");
    expect(flipKeyAction(ctrlF, { ...inFind, globalCombo: true, findCombo: true })).toBe("pass");
  });
});

describe("입력 칸 (composer)", () => {
  const box: FlipKeyContext = { ...term, inComposer: true };
  it("칸 안에서는 글자 · Enter · 화살표 · 복사를 칸에 맡기고 Escape · PageUp/Down 만 가로챈다", () => {
    expect(flipKeyAction(ev("a", "KeyA"), box)).toBe("pass");
    expect(flipKeyAction(ev("Enter", "Enter"), box)).toBe("pass");
    expect(flipKeyAction(ev("ArrowUp", "ArrowUp"), box)).toBe("pass");
    expect(flipKeyAction(ev("c", "KeyC", { ctrlKey: true }), box)).toBe("pass");
    expect(flipKeyAction(ev("Escape", "Escape"), box)).toBe("back");
    expect(flipKeyAction(ev("PageUp", "PageUp"), box)).toBe("page-up");
    expect(flipKeyAction(ev("PageDown", "PageDown"), box)).toBe("page-down");
  });
  it("IME 조합 중의 Escape 는 조합을 끄는 것 — 돌아가지 않는다", () => {
    expect(flipKeyAction(ev("Escape", "Escape", { isComposing: true }), box)).toBe("pass");
  });
  it("Enter = 보내기 · Shift+Enter = 줄바꿈 · IME 조합 중 Enter 는 아무것도", () => {
    expect(composerEnter(ev("Enter", "Enter"))).toBe("send");
    expect(composerEnter(ev("Enter", "Enter", { shiftKey: true }))).toBe("newline");
    expect(composerEnter(ev("Enter", "Enter", { isComposing: true }))).toBe("none");
    expect(composerEnter(ev("Process", "Enter", { keyCode: 229 }))).toBe("none");
    expect(composerEnter(ev("Enter", "Enter", { ctrlKey: true }))).toBe("none");
    expect(composerEnter(ev("a", "KeyA"))).toBe("none");
  });
  it("보낸 글 ↔ 기록의 사용자 말 — 공백을 고르고 앞부분으로 맞댄다", () => {
    expect(sentMatches("fix  the\nbuild ", "fix the build")).toBe(true);
    expect(sentMatches("x".repeat(300), "x".repeat(250))).toBe(true);
    // Claude 가 여러 줄 붙여넣기를 꼬리표로 감싸 적어도 같은 말이다
    expect(sentMatches("a\nb", '<pasted_content id="1f">\na\nb\n</pasted_content id="1f">')).toBe(true);
    expect(sentMatches("hello", "world")).toBe(false);
    expect(sentMatches("hello", null)).toBe(false);
    expect(sentMatches("hello", "")).toBe(false);
    expect(sentMatches("", "hello")).toBe(false);
    // (2026-10-24) 첨부 칩과 함께 보낸 글 — 기록 앞의 그림 자리표는 걷고 맞댄다 · 그림만 보낸 말은 글 없는 사람 말과 같다
    expect(sentMatches("이거 봐", "[Image #1] [Image #2] 이거 봐")).toBe(true);
    expect(sentMatches("", "[Image #1]")).toBe(true);
    expect(sentMatches("   ", null)).toBe(true);
  });
});

describe("submitPlan (보내기 계획)", () => {
  it("한 줄은 키보드, 여러 줄은 붙여넣기 · 끝의 줄바꿈 · 공백은 걷는다 · CRLF 는 LF 로", () => {
    expect(submitPlan("hello")).toEqual({ mode: "keyboard", text: "hello" });
    expect(submitPlan("hello\n\n  ")).toEqual({ mode: "keyboard", text: "hello" });
    expect(submitPlan("a\r\nb")).toEqual({ mode: "paste", text: "a\nb" });
    expect(submitPlan("  indented\nnext")).toEqual({ mode: "paste", text: "  indented\nnext" });
  });
  it("비면 보내지 않는다", () => {
    expect(submitPlan("")).toBeNull();
    expect(submitPlan(" \n\t")).toBeNull();
  });
});
