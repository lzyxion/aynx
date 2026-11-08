// **폰(원격 웹 R5 — `handheld()`)의 화면 키보드 입력** — xterm 의 숨은 textarea 를 "셸 줄 끝의 거울" 로 보고 차분만 보낸다.
//
// 왜: 안드로이드 키보드(삼성 키보드 · Gboard)는 거의 모든 키를 `keyCode 229` 로 보내고, 낱말 하나를 조합(composition)으로 쥔 채
// textarea 안의 글을 **제자리에서** 고친다 — 지우기(`deleteContentBackward`), 지운 자리 앞 낱말을 다시 조합으로 여는 재조합
// (`setComposingRegion`), 자동 고침 · 추천 낱말 누르기의 낱말 바꿔치기(`insertReplacementText` 또는 조합 갈아 끼우기 + 자동 띄어쓰기).
// xterm 6.0.0 은 textarea 를 **덧붙기만 하는 글**로 보아(조합은 compositionstart 때의 값 끝에서 시작 · 229 키는 무시 · "통째로 바뀜"
// 은 값 전체를 다시 보냄) 지운 글자가 셸에 남거나 되살아난다.
//
// 여기서는 그 길을 끄고(조합 도우미의 전송 둘 · `_inputEvent` 의 insertText 전송) 우리가 대신 보낸다. 불변식 하나:
// **셸 줄의 끝 = textarea 값 중 `foreign` 뒤**(`base` 가 마지막으로 맞춘 값). 이벤트마다 지금 값과 `base` 의 **공통 앞부분 뒤**를
// 지우고(DEL × 글자 수) 새 꼬리를 쓴다(`planSend` — 순수). 셸 커서는 줄 끝이므로 어느 자리를 고쳤든(키보드가 캐럿을 옮겨 가운데를
// 고쳐도) 같은 결과다. 차분은 값만 보고 정하므로 inputType · target range 가 무엇이든(실기에서 확인 전인 모양 포함) 같은 길이다.
// - **조합 중에도 보낸다**(라틴 글자 · 지우기) — 영문 추천 입력의 조합 낱말이 셸에 곧바로 보이고, 재조합 안의 지우기도 곧바로 간다.
//   **한글 · 가나 · 한자가 든 조합 꼬리만 끝날 때까지 쥔다**(자모가 따로 나가지 않게 — `HOLD`). 쥔 꼬리는 조합 상자에 그것만 보인다
//   (xterm 은 조합 낱말 전체를 그려 재조합 때 셸에 이미 있는 글과 겹쳐 보였다).
// - **낱말을 확정하면(값이 공백 · 줄바꿈으로 끝나고 조합 · 밀린 글이 없으면) textarea 를 비운다**(`scheduleReset`). 키보드가 지난 낱말을
//   문맥으로 쥐고 있다가 고쳐 쓰는(추천 낱말 누르기 뒤 지운 글이 되살아나던 — 10-20 실기) 자리를 없앤다. 빈 textarea 의 지우기는
//   키보드가 실제 Backspace(keyCode 8)로 보내고 xterm 이 DEL 을 보낸다(아니면 `onBeforeInput` 이 대신).
// - 일반 키(keyCode ≠ 229 — Enter · 화살표 · 키 띠가 아닌 실제 키)는 xterm 이 보낸다. 그 키 앞에 밀린 글을 먼저 보낸다. 다만 **지울 글이
//   textarea 에 있는 실제 Backspace** 는 xterm 에 주지 않고 브라우저가 textarea 에서 지우게 둔다(xterm 은 DEL 을 보내고 기본 동작을
//   막아 셸과 textarea 가 한 글자 어긋났다) — 뒤따르는 input 이 차분으로 DEL 을 보낸다.
// - textarea 값을 **코드가** 바꾸면(xterm 의 Enter · Ctrl+C · blur · 붙여넣기 비우기, 우클릭 선택 넣기, 우리 비우기) 그 값은 셸이 모르는
//   글이다 — 값 setter 를 이 요소에만 덮어 거울을 그 자리에서 맞춘다(`foreign` = 그 길이 — 지워도 DEL 을 보내지 않는다).
// - 보내는 길은 xterm 과 같은 `triggerDataEvent` → `onData` → `sendInput` — 입력 출처는 예전처럼 `keyboard`(`term/input-source`).
// 집 PC 창 · 데스크톱 원격 창은 이 파일을 쓰지 않는다(데스크톱 한국어 IME 는 `ime-composition-fix` 그대로).
// 모양이 6.0.0 과 다르면 손대지 않는다.
import type { Terminal } from "@xterm/xterm";

const DEL = "\x7f";

/** 끝날 때까지 쥐는 조합 글 — 한글(자모 · 음절) · CJK · 가나 · 전각. 라틴 · 숫자 · 문장 부호 · 이모지는 곧바로 보낸다 */
const HOLD = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿＀-￯]/;

/** 앞의 글이 서로게이트 쌍 한가운데서 끊기지 않게 공통 앞부분 길이를 한 칸 물린다 */
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

/** 셸과 맞춘 textarea 값 — 앞 `foreign` 단위(UTF-16)는 셸이 모르는 글(코드가 넣은 값) */
export interface Mirror {
  base: string;
  foreign: number;
}

export interface SendPlan {
  /** 셸에 보낼 글(DEL × n + 새 꼬리 — 줄바꿈은 CR) */
  data: string;
  mirror: Mirror;
  /** 조합이 끝날 때까지 쥔 꼬리(조합 상자에 보일 글) */
  pending: string;
}

/**
 * textarea 가 `mirror.base` → `now` 로 바뀌었을 때 보낼 것 · 새 거울. 순수.
 * 공통 앞부분 뒤의 옛 글 중 셸이 아는 몫만 DEL(코드 포인트마다 하나)로 지우고 새 꼬리를 쓴다.
 * `composing` 이고 새 꼬리에 `HOLD` 글자가 있으면 지우기만 보내고 꼬리는 쥔다(거울은 앞부분까지).
 */
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

/** textarea 가 `before` → `after` 로 바뀌었을 때 셸에 보낼 글(조합 밖 · 셸이 다 아는 거울). 순수. */
export function textareaDelta(before: string, after: string): string {
  return planSend({ base: before, foreign: 0 }, after, false).data;
}

/** 낱말을 확정한 값인가 — 공백 · 줄바꿈으로 끝난다(비울 때) */
export function endsWord(value: string): boolean {
  return /\s$/.test(value);
}

/** 6.0.0 의 쓰는 내부 모양 — 공개 API 가 아니다 */
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

/** 요소의 원형 사슬에서 `value` 접근자를 찾는다 */
function valueAccessor(el: object): PropertyDescriptor | null {
  for (let o = Object.getPrototypeOf(el); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "value");
    if (d) return d.get && d.set ? d : null;
  }
  return null;
}

const plainKey = (ev: KeyboardEvent) => !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey;

/**
 * `term.open()` · `patchTerminalComposition` 뒤에 부른다(그 수정이 얹은 메서드를 다시 덮는다). 이벤트는 `root`(textarea 의 조상)의
 * **캡처**로 받아 xterm 의 textarea 처리기보다 먼저 돈다. 못 얹었으면 `null`(예전 길 그대로), 얹었으면 떼는 함수.
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
  // 조합 도우미는 조합 상자 자리만 잡는다 — 끝난 조합 · 229 키의 textarea 차분은 보내지 않는다(아래 `flush` 가 보낸다).
  helper._finalizeComposition = function () {
    view.classList.remove("active");
    helper._isComposing = false;
    helper._isSendingComposition = false;
  };
  helper._handleAnyTextareaChanges = function () {};
  // keydown 없이(또는 keyup 뒤에) 오는 insertText 를 xterm 이 따로 보내던 길(이모지 · 일부 키보드의 확정) — 이것도 `flush` 가 본다.
  core._inputEvent = () => false;
  // 키보드의 추천 · 자동 고침 · 자동 대문자를 끄라고 알린다(xterm 이 셋은 이미 단다 — 다시 못 박고 autocomplete 를 더한다).
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

  // 코드가 값을 바꾸면 그 값은 셸이 모르는 글이다 — 그 자리에서 거울을 맞춘다(이 요소에만 덮는다 · 떼면 원형으로 돌아간다).
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

  /** 조합 상자 — 쥔 꼬리만(셸에 이미 간 글은 셸 화면에 있다) */
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

  /** 낱말을 확정했으면 textarea 를 비운다 — 같은 묶음의 IME 이벤트가 다 온 뒤(0ms) · 그새 바뀌었으면 그대로 */
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
      return; // IME 의 키 — 무엇이 바뀌었는지는 뒤따르는 input 이 말한다
    }
    // 일반 키가 조합을 끊는다(조합 도우미의 `_finalizeComposition(false)` 자리) — 밀린 글을 그 키보다 먼저 보낸다.
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
  // xterm 의 keydown 이 값을 비웠을 수 있다 — setter 가 이미 맞췄지만, 그 처리기 **뒤의** 값을 한 번 더 거울로 삼는다.
  // textarea 자신의 **캡처** 처리기로 xterm 의 것(같은 자리 · 같은 단계 · 먼저 등록) 뒤에 돈다 — 버블로 달면 xterm 의 `cancel`
  // (`stopPropagation`)이 과녁의 버블 단계를 통째로 건너뛰게 해 불리지 않는다.
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
    // 빈 textarea(또는 셸이 모르는 글뿐)에서 뒤로 지우기 — 브라우저는 아무것도 바꾸지 않는다. 키보드가 실제 Backspace 를 보내지 않는
    // 경우의 대신 — 셸의 한 글자를 지운다(xterm 이 keyCode 8 을 처리한 키는 `keyHandled` 로 건너뛴다).
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
    // beforeinput 없이 온 빈 자리의 뒤로 지우기(값이 그대로) — `onBeforeInput` 의 대신과 같다(그쪽이 막았으면 input 은 오지 않는다)
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
  // xterm 의 조합 처리기(textarea · 버블)가 조합 상자를 조합 낱말 전체로 켠 뒤 — 쥔 꼬리만 보이게 되돌린다.
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
