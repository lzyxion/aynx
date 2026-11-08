import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachHandheldInput, endsWord, planSend, textareaDelta } from "$lib/term/handheld-input";

const DEL = "\x7f";

describe("textareaDelta — 폰 키보드의 textarea 차분", () => {
  it("같으면 보낼 것이 없다", () => {
    expect(textareaDelta("abc ", "abc ")).toBe("");
  });

  it("덧붙이면 새 꼬리만", () => {
    expect(textareaDelta("ls", "ls -la")).toBe(" -la");
    expect(textareaDelta("", "한")).toBe("한");
  });

  it("뒤에서 지우면 지운 글자 수만큼 DEL", () => {
    expect(textareaDelta("abc ", "abc")).toBe(DEL);
    expect(textareaDelta("abc ", "ab")).toBe(DEL + DEL);
  });

  it("재조합 안에서 고친 낱말 — 공통 앞부분 뒤를 지우고 다시 쓴다", () => {
    expect(textareaDelta("abc", "abx ")).toBe(DEL + "x ");
  });

  it("자동 고침의 낱말 바꿔치기", () => {
    expect(textareaDelta("echo teh", "echo the ")).toBe(DEL + DEL + "he ");
  });

  it("값이 비워졌다가 새로 찬 것은 부르는 쪽이 거울을 맞춘다 — 함수는 그대로 차분을 낸다", () => {
    expect(textareaDelta("ls", "")).toBe(DEL + DEL);
  });

  it("DEL 은 코드 포인트마다 하나 — 한글 음절 · 서로게이트 쌍(이모지)은 한 글자", () => {
    expect(textareaDelta("한글", "한")).toBe(DEL);
    expect(textareaDelta("hi😀", "hi")).toBe(DEL);
    expect(textareaDelta("a😀b", "a😁")).toBe(DEL + DEL + "😁");
  });

  it("서로게이트 쌍 한가운데서 공통 앞부분을 자르지 않는다", () => {
    expect(textareaDelta("😀", "😁")).toBe(DEL + "😁");
  });

  it("줄바꿈은 CR 로 보낸다(Enter 와 같게)", () => {
    expect(textareaDelta("ls", "ls\n")).toBe("\r");
  });
});

describe("planSend — 거울 · 쥐기 · 셸이 모르는 글", () => {
  it("조합 중 라틴 꼬리는 곧바로 보낸다", () => {
    expect(planSend({ base: "hel", foreign: 0 }, "help", true)).toEqual({ data: "p", mirror: { base: "help", foreign: 0 }, pending: "" });
  });

  it("조합 중 한글 꼬리는 쥐고 지우기만 보낸다 — 거울은 앞부분까지", () => {
    expect(planSend({ base: "ab 한", foreign: 0 }, "ab 하", true)).toEqual({ data: DEL, mirror: { base: "ab ", foreign: 0 }, pending: "하" });
    expect(planSend({ base: "ab ", foreign: 0 }, "ab 할", true).pending).toBe("할");
    // 조합이 끝나면 쥔 것을 보낸다
    expect(planSend({ base: "ab ", foreign: 0 }, "ab 할", false).data).toBe("할");
  });

  it("셸이 모르는 앞글(코드가 넣은 값)은 지워도 DEL 을 보내지 않는다", () => {
    expect(planSend({ base: "sel", foreign: 3 }, "q", false)).toEqual({ data: "q", mirror: { base: "q", foreign: 0 }, pending: "" });
    expect(planSend({ base: "selab", foreign: 3 }, "sel", false).data).toBe(DEL + DEL);
    expect(planSend({ base: "selab", foreign: 3 }, "sex", false).data).toBe(DEL + DEL + "x");
  });

  it("endsWord — 공백 · 줄바꿈으로 끝날 때", () => {
    expect(endsWord("hello ")).toBe(true);
    expect(endsWord("ls\n")).toBe(true);
    expect(endsWord("hello")).toBe(false);
    expect(endsWord("")).toBe(false);
  });
});

// ── 이벤트 순서 모형 ─────────────────────────────────────────────────────────────────────────────────────
// 아래 순서는 **가설**이다(삼성 키보드 · Gboard 를 크롬 안드로이드에서 쓸 때 알려진 모양을 흉내 냄).

/** 브라우저가 쓰는 원래 값 접근자가 있는 textarea 흉내 — 키보드의 편집은 이 접근자로(우리 setter 를 거치지 않고) 한다 */
class FakeTextarea extends EventTarget {
  #v = "";
  selectionStart = 0;
  selectionEnd = 0;
  attrs: Record<string, string> = {};
  get value(): string {
    return this.#v;
  }
  set value(v: string) {
    this.#v = v;
    this.selectionStart = this.selectionEnd = v.length;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
}
const nativeValue = Object.getOwnPropertyDescriptor(FakeTextarea.prototype, "value")!;

function setup() {
  const ta = new FakeTextarea();
  const root = new EventTarget();
  const sent: string[] = [];
  const classes = new Set<string>();
  const view = { textContent: "", classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
  const coreService = { triggerDataEvent: (d: string) => void sent.push(d) };
  const core = {
    _compositionHelper: { _compositionView: view, _isComposing: false, _finalizeComposition() {}, _handleAnyTextareaChanges() {} },
    _inputEvent: () => false,
    coreService,
  };
  const term = { textarea: ta, _core: core } as unknown as Terminal;
  const detach = attachHandheldInput(term, root as unknown as HTMLElement);
  expect(detach).not.toBeNull();

  const native = (v: string, caret = v.length) => {
    nativeValue.set!.call(ta, v);
    ta.selectionStart = ta.selectionEnd = caret;
  };
  const ev = (type: string, props: Record<string, unknown>) => {
    const e = new Event(type, { cancelable: true });
    let stopped = false;
    Object.defineProperty(e, "target", { value: ta });
    e.stopPropagation = () => void (stopped = true);
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
    return { e, stopped: () => stopped };
  };
  /** 조상 캡처(우리) → 과녁(xterm 흉내 · 우리 뒤처리기) */
  const fire = (type: string, props: Record<string, unknown> = {}, xterm?: (e: Event) => void) => {
    const { e, stopped } = ev(type, props);
    root.dispatchEvent(e);
    if (!stopped()) {
      xterm?.(e);
      const again = ev(type, props).e;
      if (e.defaultPrevented) again.preventDefault();
      ta.dispatchEvent(again);
    }
    return e;
  };
  /** xterm 의 일반 키 처리 — Enter 는 CR + 비우기, Backspace 는 DEL(둘 다 기본 동작을 막는다) */
  const xtermKey = (e: Event) => {
    const kc = (e as KeyboardEvent).keyCode;
    if (kc === 13) {
      coreService.triggerDataEvent("\r");
      ta.value = "";
      e.preventDefault();
    } else if (kc === 8) {
      coreService.triggerDataEvent(DEL);
      e.preventDefault();
    }
  };
  const key = (kc: number, k = "Unidentified") => {
    const e = fire("keydown", { keyCode: kc, key: k, code: "", isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }, xtermKey);
    return e;
  };
  const keyup = (kc: number) => fire("keyup", { keyCode: kc, key: "", code: "", isComposing: false });

  let comp: { start: number; end: number } | null = null;
  const input = (inputType: string, data: string | null, isComposing: boolean) => fire("input", { inputType, data, isComposing });
  const before = (inputType: string, data: string | null, isComposing: boolean) =>
    fire("beforeinput", { inputType, data, isComposing, getTargetRanges: () => [] });

  const api = {
    ta,
    sent,
    classes,
    /** 라틴 조합 한 글자(추천 켬 — 낱말을 조합으로 쥔다) */
    compose(ch: string) {
      key(229);
      if (!comp) {
        comp = { start: ta.value.length, end: ta.value.length };
        fire("compositionstart", { data: "" });
      }
      const v = ta.value;
      const region = v.slice(comp.start, comp.end) + ch;
      fire("compositionupdate", { data: region });
      native(v.slice(0, comp.start) + region + v.slice(comp.end));
      comp.end = comp.start + region.length;
      input("insertCompositionText", region, true);
      keyup(229);
    },
    /** 조합 상자의 글을 통째로 갈아 끼운다(추천 낱말 누르기 · 한글 음절 단계) */
    setComposition(text: string) {
      if (!comp) {
        comp = { start: ta.value.length, end: ta.value.length };
        fire("compositionstart", { data: "" });
      }
      const v = ta.value;
      fire("compositionupdate", { data: text });
      native(v.slice(0, comp.start) + text + v.slice(comp.end));
      comp.end = comp.start + text.length;
      input("insertCompositionText", text, true);
    },
    /** 이미 있는 글을 다시 조합으로 연다(setComposingRegion — 값은 그대로) */
    recompose(start: number, end: number) {
      comp = { start, end };
      fire("compositionstart", { data: ta.value.slice(start, end) });
    },
    endComposition() {
      if (!comp) return;
      fire("compositionend", { data: ta.value.slice(comp.start, comp.end) });
      comp = null;
    },
    /** 조합 밖 확정(commitText) — 캐럿 자리에 */
    insertText(t: string, type = "insertText") {
      key(229);
      before(type, t, false);
      const v = ta.value;
      const s = ta.selectionStart;
      native(v.slice(0, s) + t + v.slice(ta.selectionEnd), s + t.length);
      input(type, t, false);
      keyup(229);
    },
    /** 범위 바꿔치기(insertReplacementText — 추천 · 자동 고침) */
    replaceRange(start: number, end: number, t: string) {
      before("insertReplacementText", t, false);
      const v = ta.value;
      native(v.slice(0, start) + t + v.slice(end), start + t.length);
      input("insertReplacementText", t, false);
    },
    /** IME 의 뒤로 지우기(deleteSurroundingText — keyCode 229) */
    deleteBack() {
      key(229);
      const b = before("deleteContentBackward", null, false);
      const s = ta.selectionStart;
      if (!b.defaultPrevented && s > 0) {
        const head = Array.from(ta.value.slice(0, s));
        head.pop();
        native(head.join("") + ta.value.slice(s), head.join("").length);
        input("deleteContentBackward", null, false);
      }
      keyup(229);
    },
    /** beforeinput 없이 값도 그대로인 지우기 input 하나(일부 키보드 · 브라우저의 모양 — 가설) */
    bareDeleteInput() {
      key(229);
      input("deleteContentBackward", null, false);
      keyup(229);
    },
    /** 실제 Backspace 키(keyCode 8) — 막히지 않으면 브라우저가 지운다 */
    realBackspace() {
      const e = key(8, "Backspace");
      if (!e.defaultPrevented && ta.selectionStart > 0) {
        before("deleteContentBackward", null, false);
        const s = ta.selectionStart;
        const head = Array.from(ta.value.slice(0, s));
        head.pop();
        native(head.join("") + ta.value.slice(s), head.join("").length);
        input("deleteContentBackward", null, false);
      }
      keyup(8);
    },
    enter() {
      key(13, "Enter");
      keyup(13);
    },
    native,
    caret(n: number) {
      ta.selectionStart = ta.selectionEnd = n;
    },
    /** 셸 줄 — DEL 은 한 글자 지우기, CR 은 ⏎ */
    line() {
      let out: string[] = [];
      for (const c of sent.join("")) {
        if (c === DEL) out = out.slice(0, -1);
        else if (c === "\r") out.push("⏎");
        else out.push(c);
      }
      return out.join("");
    },
    settle() {
      vi.runAllTimers();
    },
  };
  return api;
}

describe("attachHandheldInput — 키보드 이벤트 순서(가설)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("키보드에 추천 · 자동 고침을 끄라고 알린다", () => {
    const k = setup();
    expect(k.ta.attrs).toMatchObject({ autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false" });
  });

  it("영문 조합은 치는 대로 셸에 간다 · 조합 상자는 숨긴다", () => {
    const k = setup();
    for (const c of "ls") k.compose(c);
    expect(k.line()).toBe("ls");
    expect(k.classes.has("active")).toBe(false);
  });

  it("추천 낱말 누르기 ① 조합을 그 낱말로 갈아 끼우고 끝 + 자동 띄어쓰기 → 비운 뒤 지우고 다시 치기", () => {
    const k = setup();
    for (const c of "helo") k.compose(c);
    k.setComposition("hello");
    k.endComposition();
    k.insertText(" ");
    k.settle();
    expect(k.line()).toBe("hello ");
    expect(k.ta.value).toBe(""); // 확정한 낱말은 비운다 — 키보드가 옛 글을 문맥으로 쥐지 않게
    // 빈 textarea 의 지우기는 실제 Backspace 로 온다 → xterm 이 DEL
    k.realBackspace();
    k.realBackspace();
    k.realBackspace();
    expect(k.line()).toBe("hel");
    k.compose("p");
    k.endComposition();
    expect(k.line()).toBe("help");
  });

  it("추천 낱말 누르기 ② 조합을 그대로 확정한 뒤 insertReplacementText 로 낱말 바꿔치기", () => {
    const k = setup();
    for (const c of "helo") k.compose(c);
    k.endComposition();
    k.replaceRange(0, 4, "hello");
    k.insertText(" ");
    k.settle();
    expect(k.line()).toBe("hello ");
  });

  it("추천 낱말 누르기 ③ 이벤트 없이 값이 통째로 바뀌고 다음 입력에 드러난다", () => {
    const k = setup();
    for (const c of "helo") k.compose(c);
    k.endComposition();
    k.native("hello ");
    k.insertText("w");
    expect(k.line()).toBe("hello w");
  });

  it("추천 낱말 누르기 ④ 비우기 전에(같은 묶음) 지우고 재조합 · 다시 치기 — 지운 글이 되살아나지 않는다", () => {
    const k = setup();
    for (const c of "helo") k.compose(c);
    k.setComposition("hello");
    k.endComposition();
    k.insertText(" ");
    // 타이머 전에 곧바로 지운다(229 · 값 안에서)
    k.deleteBack();
    k.recompose(0, 5);
    k.setComposition("hell");
    k.setComposition("hel");
    expect(k.line()).toBe("hel");
    k.setComposition("help");
    k.endComposition();
    k.insertText(" ");
    k.settle();
    expect(k.line()).toBe("help ");
  });

  it("빈 textarea 의 IME 지우기(실제 Backspace 없이 beforeinput 만) — 셸의 한 글자를 지운다", () => {
    const k = setup();
    for (const c of "ab") k.compose(c);
    k.endComposition();
    k.insertText(" ");
    k.settle();
    k.deleteBack();
    expect(k.line()).toBe("ab");
    k.deleteBack();
    expect(k.line()).toBe("a");
  });

  it("빈 textarea 에 beforeinput 없이 값 그대로의 deleteContentBackward input 만 와도 한 글자", () => {
    const k = setup();
    k.insertText("ab ");
    k.settle();
    expect(k.ta.value).toBe("");
    k.bareDeleteInput();
    expect(k.line()).toBe("ab");
  });

  it("값 안에 글이 있을 때 실제 Backspace — 브라우저가 지우고 차분이 DEL 하나를 보낸다(xterm 에 주지 않음)", () => {
    const k = setup();
    k.insertText("a");
    k.insertText("b");
    k.realBackspace();
    expect(k.ta.value).toBe("a");
    expect(k.line()).toBe("a");
    k.insertText("c");
    expect(k.line()).toBe("ac");
  });

  it("키보드가 캐럿을 가운데로 옮겨 넣기 — 셸 줄이 textarea 와 같아진다", () => {
    const k = setup();
    k.insertText("abc");
    k.caret(1);
    k.insertText("X");
    expect(k.ta.value).toBe("aXbc");
    expect(k.line()).toBe("aXbc");
  });

  it("deleteWordBackward 처럼 여러 글자가 한 번에 사라져도 값 차분대로", () => {
    const k = setup();
    k.insertText("echo hi");
    k.native("echo ");
    k.insertText("yo");
    expect(k.line()).toBe("echo yo");
  });

  it("조합 쥔 채 Enter → 조합 끝 — 두 번 나가지 않는다", () => {
    const k = setup();
    for (const c of "ls") k.compose(c);
    k.enter();
    k.endComposition();
    for (const c of "pwd") k.compose(c);
    k.endComposition();
    k.enter();
    expect(k.line()).toBe("ls⏎pwd⏎");
  });

  it("줄바꿈 확정(insertLineBreak)은 CR 로 가고 textarea 를 비운다", () => {
    const k = setup();
    k.insertText("ls");
    k.insertText("\n", "insertLineBreak");
    k.settle();
    expect(k.line()).toBe("ls⏎");
    expect(k.ta.value).toBe("");
  });

  it("코드가 값을 비우면(붙여넣기 · blur) 거울도 비운다 — 다음 글이 앞 글을 지우지 않는다", () => {
    const k = setup();
    k.insertText("ab");
    k.sent.push("XYZ"); // xterm 의 붙여넣기 — 보내고 비운다
    k.ta.value = "";
    k.insertText("c");
    expect(k.line()).toBe("abXYZc");
  });

  it("코드가 넣은 글(우클릭 선택)을 덮어 써도 셸의 글을 지우지 않는다", () => {
    const k = setup();
    k.insertText("ab");
    k.ta.value = "sel";
    k.ta.selectionStart = 0;
    k.ta.selectionEnd = 3;
    k.insertText("q");
    expect(k.line()).toBe("abq");
  });

  it("한글 — 음절 조합은 끝날 때 한 번(자모가 따로 나가지 않는다)", () => {
    const k = setup();
    for (const s of ["ㅎ", "하", "한"]) k.setComposition(s);
    k.endComposition();
    for (const s of ["ㄱ", "그", "글"]) k.setComposition(s);
    k.endComposition();
    k.settle();
    expect(k.line()).toBe("한글");
    expect(k.sent.join("")).not.toMatch(/[ㄱ-ㅎㅏ-ㅣ]/);
    expect(k.ta.value).toBe("한글"); // 낱말 중간에서는 비우지 않는다
  });

  it("한글 재조합 — 지운 것은 곧바로, 새 음절은 끝날 때", () => {
    const k = setup();
    for (const s of ["ㅎ", "하", "한"]) k.setComposition(s);
    k.endComposition();
    k.recompose(0, 1);
    k.setComposition("하");
    expect(k.line()).toBe("");
    expect(k.classes.has("active")).toBe(true); // 쥔 꼬리만 조합 상자에
    k.setComposition("할");
    k.endComposition();
    expect(k.line()).toBe("할");
    expect(k.sent.join("")).not.toMatch(/[ㄱ-ㅎㅏ-ㅣ]/);
  });

  it("떼면 값 접근자 · 보내기를 되돌린다", () => {
    const ta = new FakeTextarea();
    const sent: string[] = [];
    const coreService = { triggerDataEvent: (d: string) => void sent.push(d) };
    const core = {
      _compositionHelper: { _compositionView: { textContent: "", classList: { add() {}, remove() {}, toggle() {} } }, _isComposing: false, _finalizeComposition() {}, _handleAnyTextareaChanges() {} },
      _inputEvent: () => false,
      coreService,
    };
    const orig = coreService.triggerDataEvent;
    const detach = attachHandheldInput({ textarea: ta, _core: core } as unknown as Terminal, new EventTarget() as unknown as HTMLElement)!;
    expect(Object.prototype.hasOwnProperty.call(ta, "value")).toBe(true);
    detach();
    expect(Object.prototype.hasOwnProperty.call(ta, "value")).toBe(false);
    expect(coreService.triggerDataEvent).toBe(orig);
  });
});
