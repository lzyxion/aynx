import { describe, expect, it } from "vitest";
import { patchCompositionHelperInstance } from "$lib/term/ime-composition-fix";

// xterm 6.0.0 `CompositionHelper` 를 lib/xterm.mjs 에서 그대로 옮긴 모형 — 고치지 않는 메서드(compositionupdate·
// compositionend·_handleAnyTextareaChanges)는 원본 동작 그대로여야 수정이 그 사이에서 맞는지 볼 수 있다.
function makeHelper() {
  let handled = "";
  const textarea = Object.assign(new EventTarget(), { value: "", selectionStart: 0, selectionEnd: 0 }) as unknown as HTMLTextAreaElement;
  const view = { textContent: "", classList: { add() {}, remove() {} } } as unknown as HTMLElement;
  const h = {
    _textarea: textarea,
    _compositionView: view,
    _coreService: { triggerDataEvent: (d: string) => { handled += d; } },
    _isComposing: false,
    _isSendingComposition: false,
    _compositionPosition: { start: 0, end: 0 },
    _dataAlreadySent: "",
    compositionstart() {
      this._isComposing = true;
      this._compositionPosition.start = this._textarea.value.length;
      this._compositionView.textContent = "";
      this._dataAlreadySent = "";
    },
    compositionupdate(ev: { data: string }) {
      this._compositionView.textContent = ev.data;
      setTimeout(() => { this._compositionPosition.end = this._textarea.value.length; }, 0);
    },
    compositionend() { this._finalizeComposition(true); },
    keydown(ev: KeyboardEvent): boolean {
      if (this._isComposing || this._isSendingComposition) {
        if ([20, 229, 16, 17, 18].includes(ev.keyCode)) return false;
        this._finalizeComposition(false);
      }
      if (ev.keyCode === 229) { this._handleAnyTextareaChanges(); return false; }
      return true;
    },
    _finalizeComposition(wait: boolean) {
      this._isComposing = false;
      if (wait) {
        const e = { start: this._compositionPosition.start, end: this._compositionPosition.end };
        this._isSendingComposition = true;
        setTimeout(() => {
          if (!this._isSendingComposition) return;
          this._isSendingComposition = false;
          e.start += this._dataAlreadySent.length;
          const i = this._isComposing
            ? this._textarea.value.substring(e.start, this._compositionPosition.start)
            : this._textarea.value.substring(e.start);
          if (i.length > 0) this._coreService.triggerDataEvent(i);
        }, 0);
      } else {
        this._isSendingComposition = false;
        this._coreService.triggerDataEvent(this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end));
      }
    },
    _handleAnyTextareaChanges() {
      const old = this._textarea.value;
      setTimeout(() => {
        if (this._isComposing) return;
        const now = this._textarea.value;
        const diff = now.replace(old, "");
        this._dataAlreadySent = diff;
        if (now.length > old.length) this._coreService.triggerDataEvent(diff);
        else if (now.length < old.length) this._coreService.triggerDataEvent("\x7f");
        else if (now !== old) this._coreService.triggerDataEvent(now);
      }, 0);
    },
  };
  return { h, textarea, handled: () => handled };
}

const wait = () => new Promise<void>((r) => setTimeout(r, 0));
/** textarea 에 글자가 들어간 input 이벤트 (조합 밖) */
function typed(textarea: HTMLTextAreaElement, data: string) {
  textarea.value += data;
  const ev = new Event("input");
  Object.defineProperties(ev, { data: { value: data }, inputType: { value: "insertText" }, isComposing: { value: false } });
  textarea.dispatchEvent(ev);
}
const key = (keyCode: number) => ({ keyCode }) as KeyboardEvent;

function patched() {
  const made = makeHelper();
  expect(patchCompositionHelperInstance(made.h)).toBe(true);
  return made;
}

describe("patchCompositionHelperInstance — 6.0.0 원래 동작은 그대로", () => {
  it("단순 글자 ㅇㅇ", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "ㅇ" }); textarea.value = "ㅇ";
    await wait(); h.compositionend(); await wait();
    expect(handled()).toBe("ㅇ");
    h.compositionstart(); h.compositionupdate({ data: "ㅇ" }); textarea.value = "ㅇㅇ";
    await wait(); h.compositionend(); await wait();
    expect(handled()).toBe("ㅇㅇ");
  });

  it("받침이 다음 음절로 넘어가는 아아", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "ㅇ" }); textarea.value = "ㅇ";
    await wait(); h.compositionupdate({ data: "아" }); textarea.value = "아";
    await wait(); h.compositionupdate({ data: "앙" }); textarea.value = "앙";
    await wait(); h.compositionend(); h.compositionstart(); h.compositionupdate({ data: "아" }); textarea.value = "아아";
    await wait(); h.compositionend(); await wait();
    expect(handled()).toBe("아아");
  });

  it("일본어 변환(길이가 바뀜) 今", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "い" }); textarea.value = "い";
    await wait(); h.compositionupdate({ data: "いま" }); textarea.value = "いま";
    await wait(); h.compositionupdate({ data: "今" }); textarea.value = "今";
    await wait(); h.compositionend(); await wait();
    expect(handled()).toBe("今");
  });

  it("조합 직후 비조합 글자 ㅇ1", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "ㅇ" }); textarea.value = "ㅇ";
    await wait(); h.compositionend(); textarea.value = "ㅇ1"; await wait();
    expect(handled()).toBe("ㅇ1");
  });
});

describe("patchCompositionHelperInstance — 메인 스레드가 밀렸을 때 (xterm #6089)", () => {
  /** 니가 끝나 전송이 줄 선 채 다가 시작·끝나고, 그 뒤 '.' 이 동기 길을 탄다 */
  async function niDaDot(h: ReturnType<typeof makeHelper>["h"], textarea: HTMLTextAreaElement) {
    h.compositionstart(); h.compositionupdate({ data: "니" }); textarea.value = "니";
    await wait();
    h.compositionend();
    h.compositionstart(); h.compositionupdate({ data: "다" }); textarea.value = "니다";
    h.compositionend();
    h.keydown(key(190));
    await wait();
  }

  it("원본 6.0.0 은 줄 선 전송을 함께 취소해 글자를 잃는다(재현)", async () => {
    const { h, textarea, handled } = makeHelper();
    await niDaDot(h, textarea);
    expect(handled()).not.toBe("니다");
  });

  it("고친 뒤에는 줄 선 조합을 순서대로 보낸다", async () => {
    const { h, textarea, handled } = patched();
    await niDaDot(h, textarea);
    expect(handled()).toBe("니다");
  });

  it("조합 중에 일반 키가 끼어들어도 그 조합을 보낸다", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "가" });
    textarea.value = "가"; textarea.selectionStart = 1; textarea.selectionEnd = 1;
    h.keydown(key(32));
    await wait();
    expect(handled()).toBe("가");
  });

  it("같은 범위를 두 번 보내지 않는다 — 타이머와 동기 길이 겹쳐도", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "한" }); textarea.value = "한";
    await wait();
    h.compositionend();
    h.keydown(key(13)); // Enter 가 줄 선 전송을 먼저 비운다
    await wait(); await wait();
    expect(handled()).toBe("한");
  });

  it("조합 밖 글자가 겹쳐 와도 두 번 보내지 않는다 (xterm #6045)", async () => {
    const run = async (made: ReturnType<typeof makeHelper>) => {
      const { h, textarea } = made;
      h.keydown(key(229)); textarea.value = "a";
      h.keydown(key(229)); textarea.value = "ab";
      await wait();
      return made.handled();
    };
    expect(await run(makeHelper())).toBe("abb"); // 원본 재현
    expect(await run(patched())).toBe("ab");
  });

  it("조합 뒤 공백이 겹쳐도 단어가 한 번만 간다", async () => {
    const { h, textarea, handled } = patched();
    h.compositionstart(); h.compositionupdate({ data: "는" }); textarea.value = "는";
    await wait();
    h.keydown(key(229)); // 공백 키 — 아직 조합 중이라 조합을 이어 간다
    h.compositionend(); textarea.value = "는 ";
    h.keydown(key(229)); // 다음 키 — 조합 밖 차분
    await wait(); await wait();
    expect(handled()).toBe("는 ");
  });

  it("keypress 로 이미 보낸 공백을 밀린 차분이 다시 보내지 않는다", async () => {
    const { h, textarea, handled } = patched();
    h.keydown(key(229)); // 조합 밖 차분 예약 — 그때의 값은 ""
    h.compositionstart(); h.compositionupdate({ data: "가" }); textarea.value = "가";
    h.compositionend();
    h.keydown(key(32)); // 공백 — 줄 선 "가" 를 먼저 보내고 keypress 길로 간다
    h._coreService.triggerDataEvent(" "); // xterm 의 keypress 전송
    typed(textarea, " ");
    await wait(); await wait();
    expect(handled()).toBe("가 ");
  });

  it("값이 비워진 뒤에는 옛 구멍이 새 글자를 가리지 않는다", async () => {
    const { h, textarea, handled } = patched();
    h.keydown(key(32)); h._coreService.triggerDataEvent(" "); typed(textarea, " ");
    textarea.value = ""; // Enter·blur 로 xterm 이 비운다
    h.compositionstart(); h.compositionupdate({ data: "가" }); textarea.value = "가";
    await wait(); h.compositionend(); await wait();
    expect(handled()).toBe(" 가");
  });

  it("모양이 다르면 손대지 않는다", () => {
    expect(patchCompositionHelperInstance({})).toBe(false);
    expect(patchCompositionHelperInstance(null)).toBe(false);
  });
});
