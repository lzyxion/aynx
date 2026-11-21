// 폰(`handheld()`)의 화면 키보드 입력 — xterm 의 숨은 textarea 를 "셸 줄 끝의 거울" 로 보고 차분만 보낸다.
// 안드로이드 키보드는 거의 모든 키를 229 로 보내고 textarea 글을 제자리에서 고치는데(재조합 · 낱말 바꿔치기), xterm 6.0.0 은 textarea 를
// 덧붙기만 하는 글로 보아 지운 글자가 셸에 남거나 되살아난다 — 그 전송 길을 끄고 대신 보낸다.
// 불변식: 셸 줄의 끝 = textarea 값 중 `foreign` 뒤. 셸 커서는 줄 끝이라 어느 자리를 고쳤든 공통 앞부분 뒤를 DEL 로 지우고 새 꼬리를 쓴다.
// - 한글 · 가나 · 한자가 든 조합 꼬리만 끝날 때까지 쥔다(자모가 따로 나가지 않게). 나머지는 조합 중에도 보낸다.
// - 낱말을 확정하면 textarea 를 비운다 — 키보드가 지난 낱말을 쥐고 고쳐 써 지운 글이 되살아나는 자리를 없앤다.
// - 지울 글이 textarea 에 있는 실제 Backspace 는 xterm 에 주지 않는다 — xterm 은 기본 동작을 막아 셸과 textarea 가 한 글자 어긋난다.
// - 코드가 값을 바꾸면 셸이 모르는 글이다 — 이 요소의 값 setter 를 덮어 그 자리에서 거울을 맞춘다.
// 메인 PC 창 · 데스크톱 원격 창은 쓰지 않는다(데스크톱 IME 는 `ime-composition-fix`). 모양이 6.0.0 과 다르면 손대지 않는다.
import type { Terminal } from "@xterm/xterm";

const DEL = "\x7f";

/** 끝날 때까지 쥐는 조합 글 — 한글 · CJK · 가나 · 전각 */
const HOLD = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿＀-￯]/;

/** 서로게이트 쌍 한가운데서 끊기지 않게 한 칸 물린다 */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i > 0 && i < Math.max(a.length, b.length)) {
    const c = a.charCodeAt(i - 1);
    if (c >= 0xd800 && c <= 0xdbff) i--;
  }
  return i;
}

/** 앞 `foreign` 단위(UTF-16)는 셸이 모르는 글(코드가 넣은 값) — 지워도 DEL 을 보내지 않는다 */
export interface Mirror {
  base: string;
  foreign: number;
}

export interface SendPlan {
  /** DEL × n + 새 꼬리 — 줄바꿈은 CR */
  data: string;
  mirror: Mirror;
  /** 조합 상자에 보일 쥔 꼬리 */
  pending: string;
}

/** DEL 은 코드 포인트마다 하나 */
export function planSend(mirror: Mirror, now: string, composing: boolean): SendPlan {
  const base = mirror.base;
  const foreign = Math.min(mirror.foreign, base.length);
  const p = commonPrefix(base, now);
  const removed = Array.from(base.slice(Math.max(p, foreign))).length;
  const nextForeign = Math.min(foreign, p);
  const tail = now.slice(p);
  const del = DEL.repeat(removed);
  if (composing && HOLD.test(tail)) {
    return { data: del, mirror: { base: now.slice(0, p), foreign: nextForeign }, pending: tail };
  }
  return { data: del + tail.replace(/\r?\n/g, "\r"), mirror: { base: now, foreign: nextForeign }, pending: "" };
}

export function textareaDelta(before: string, after: string): string {
  return planSend({ base: before, foreign: 0 }, after, false).data;
}

export function endsWord(value: string): boolean {
  return /\s$/.test(value);
}

/** 6.0.0 의 내부 모양 — 공개 API 가 아니다 */
interface CoreLike {
  _compositionHelper: {
    _compositionView: HTMLElement;
    _isComposing: boolean;
    _isSendingComposition?: boolean;
    _finalizeComposition(waitForPropagation: boolean): void;
    _handleAnyTextareaChanges(): void;
  };
  _inputEvent(ev: InputEvent): boolean;
  coreService: { triggerDataEvent(data: string, wasUserInput?: boolean): void };
}

function looksLike600(core: unknown): core is CoreLike {
  if (typeof core !== "object" || core === null) return false;
  const c = core as Record<string, unknown>;
  const h = c._compositionHelper as Record<string, unknown> | undefined;
  return typeof c._inputEvent === "function" &&
    typeof (c.coreService as { triggerDataEvent?: unknown } | undefined)?.triggerDataEvent === "function" &&
    typeof h === "object" && h !== null &&
    typeof h._finalizeComposition === "function" &&
    typeof h._handleAnyTextareaChanges === "function" &&
    typeof h._compositionView === "object";
}

function valueAccessor(el: object): PropertyDescriptor | null {
  for (let o = Object.getPrototypeOf(el); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "value");
    if (d) return d.get && d.set ? d : null;
  }
  return null;
}

const plainKey = (ev: KeyboardEvent) => !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey;

/**
 * `term.open()` · `patchTerminalComposition` **뒤에** 부른다(그 수정이 얹은 메서드를 다시 덮는다). 이벤트는 `root` 의 캡처로 받아
 * xterm 의 textarea 처리기보다 먼저 돈다. 못 얹었으면 `null`.
 */
export function attachHandheldInput(term: Terminal, root: HTMLElement): (() => void) | null {
  const core = (term as unknown as { _core?: unknown })._core;
  const textarea = term.textarea;
  const access = textarea ? valueAccessor(textarea) : null;
  if (!textarea || !access || !looksLike600(core)) {
    console.warn("[aynx] xterm 입력 모양이 달라 폰 입력 수정을 건너뜁니다");
    return null;
  }
  const helper = core._compositionHelper;
  const view = helper._compositionView;
  // 조합 도우미는 조합 상자 자리만 잡는다 — 전송은 `flush` 가 한다.
  helper._finalizeComposition = function () {
    view.classList.remove("active");
    helper._isComposing = false;
    helper._isSendingComposition = false;
  };
  helper._handleAnyTextareaChanges = function () {};
  core._inputEvent = () => false;
  // 키보드가 따르는지는 키보드 몫이다(삼성 키보드 · Gboard 는 일부만 따른다).
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("spellcheck", "false");

  const readValue = (): string => access.get!.call(textarea) as string;

  let mirror: Mirror = { base: readValue(), foreign: readValue().length };
  let composing = false;
  let pending = "";
  /** 마지막 일반 키(≠ 229)를 xterm 이 처리했다 — 그 키가 낸 textarea 변화는 보내지 않는다(xterm 이 이미 보냈다) */
  let keyHandled = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  // 이 요소에만 덮는다 — 떼면 원형으로 돌아간다.
  Object.defineProperty(textarea, "value", {
    configurable: true,
    enumerable: access.enumerable,
    get: () => readValue(),
    set: (v: string) => {
      access.set!.call(textarea, v);
      const now = readValue();
      mirror = { base: now, foreign: now.length };
      pending = "";
      showPending();
    },
  });

  const coreService = core.coreService;
  const send = (data: string) => coreService.triggerDataEvent(data, true);

  /** 쥔 꼬리만 — xterm 은 조합 낱말 전체를 그려 재조합 때 셸에 이미 있는 글과 겹쳐 보인다 */
  function showPending() {
    view.textContent = pending;
    view.classList.toggle("active", composing && pending.length > 0);
  }

  const flush = (hold: boolean) => {
    const plan = planSend(mirror, readValue(), hold);
    mirror = plan.mirror;
    pending = plan.pending;
    if (plan.data.length > 0) send(plan.data);
    showPending();
  };

  const resync = () => {
    const now = readValue();
    mirror = { base: now, foreign: Math.min(mirror.foreign, now.length) };
  };

  /** 같은 묶음의 IME 이벤트가 다 온 뒤(0ms) — 그새 바뀌었으면 그대로 */
  const scheduleReset = () => {
    if (resetTimer !== undefined) return;
    resetTimer = setTimeout(() => {
      resetTimer = undefined;
      const now = readValue();
      if (composing || pending.length > 0 || now === "" || now !== mirror.base || !endsWord(now)) return;
      textarea.value = ""; // setter 가 거울을 비운다
    }, 0);
  };
  const cancelReset = () => {
    clearTimeout(resetTimer);
    resetTimer = undefined;
  };

  const mine = (ev: Event) => ev.target === textarea;

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!mine(ev)) return;
    if (ev.keyCode === 229) {
      keyHandled = false;
      return; // 무엇이 바뀌었는지는 뒤따르는 input 이 말한다
    }
    // 일반 키가 조합을 끊는다 — 밀린 글을 그 키보다 먼저 보낸다.
    flush(false);
    composing = false;
    showPending();
    // 지울 글이 textarea 에 있는 Backspace — 브라우저가 지우게 두고(input → 차분 DEL) xterm 에는 주지 않는다.
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    if (ev.keyCode === 8 && plainKey(ev) && (start !== end ? end > mirror.foreign : start > mirror.foreign)) {
      keyHandled = false;
      ev.stopPropagation();
      return;
    }
    keyHandled = true;
  };
  // xterm 의 keydown 처리기 **뒤의** 값을 거울로 삼는다. textarea 자신의 캡처로 단다 — 버블로 달면 xterm 의 `stopPropagation` 에 불리지 않는다.
  const onKeyDownAfter = (ev: KeyboardEvent) => {
    if (ev.keyCode !== 229 && keyHandled) resync();
  };
  const onBlurAfter = () => {
    composing = false;
    pending = "";
    cancelReset();
    showPending();
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (!mine(ev)) return;
    keyHandled = false;
  };
  const onBeforeInput = (ev: Event) => {
    if (!mine(ev)) return;
    const ie = ev as InputEvent;
    // 빈 textarea(또는 셸이 모르는 글뿐)의 뒤로 지우기 — 키보드가 실제 Backspace 를 보내지 않을 때의 대신이다.
    if (ie.isComposing || keyHandled) return;
    if (ie.inputType !== "deleteContentBackward" && ie.inputType !== "deleteWordBackward") return;
    const start = textarea.selectionStart ?? 0;
    if (start !== (textarea.selectionEnd ?? start) || start > mirror.foreign) return;
    ev.preventDefault();
    flush(false);
    send(DEL);
  };
  const onInput = (ev: Event) => {
    if (!mine(ev)) return;
    const ie = ev as InputEvent;
    const comp = ie.isComposing === true;
    // beforeinput 없이 온 빈 자리의 뒤로 지우기 — `onBeforeInput` 의 대신과 같다
    if (!comp && !keyHandled && (ie.inputType === "deleteContentBackward" || ie.inputType === "deleteWordBackward")) {
      const start = textarea.selectionStart ?? 0;
      if (readValue() === mirror.base && start === (textarea.selectionEnd ?? start) && start <= mirror.foreign) {
        send(DEL);
        return;
      }
    }
    // 그 키의 변화 하나만 삼킨다 — keyup 이 늦어도 다음 IME 확정까지 삼키지 않게
    if (keyHandled && !comp) {
      keyHandled = false;
      resync();
    } else {
      flush(comp);
    }
    if (!comp && !composing) scheduleReset();
  };
  const onCompositionStart = (ev: Event) => {
    if (!mine(ev)) return;
    cancelReset();
    flush(false);
    composing = true;
  };
  const onCompositionEnd = (ev: Event) => {
    if (!mine(ev)) return;
    composing = false;
    flush(false);
    scheduleReset();
  };
  // xterm 의 조합 처리기가 조합 상자를 낱말 전체로 켠 뒤 — 쥔 꼬리만 보이게 되돌린다.
  const onCompositionAfter = () => showPending();

  const opts = { capture: true } as const;
  root.addEventListener("keydown", onKeyDown, opts);
  root.addEventListener("keyup", onKeyUp, opts);
  root.addEventListener("beforeinput", onBeforeInput, opts);
  root.addEventListener("input", onInput, opts);
  root.addEventListener("compositionstart", onCompositionStart, opts);
  root.addEventListener("compositionend", onCompositionEnd, opts);
  textarea.addEventListener("keydown", onKeyDownAfter, opts);
  textarea.addEventListener("blur", onBlurAfter);
  textarea.addEventListener("compositionstart", onCompositionAfter);
  textarea.addEventListener("compositionupdate", onCompositionAfter);
  return () => {
    cancelReset();
    root.removeEventListener("keydown", onKeyDown, opts);
    root.removeEventListener("keyup", onKeyUp, opts);
    root.removeEventListener("beforeinput", onBeforeInput, opts);
    root.removeEventListener("input", onInput, opts);
    root.removeEventListener("compositionstart", onCompositionStart, opts);
    root.removeEventListener("compositionend", onCompositionEnd, opts);
    textarea.removeEventListener("keydown", onKeyDownAfter, opts);
    textarea.removeEventListener("blur", onBlurAfter);
    textarea.removeEventListener("compositionstart", onCompositionAfter);
    textarea.removeEventListener("compositionupdate", onCompositionAfter);
    delete (textarea as unknown as { value?: unknown }).value;
  };
}
