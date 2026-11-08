// xterm 6.0.0 의 IME 조합 전송을 고친다 — 화면이 바쁠 때 한글이 빠지거나 두 번 들어가던 것.
// 원인: 조합이 끝난 글자를 setTimeout(0) 뒤에 보내는데, 미룬 전송 전부를 깃발 하나(`_isSendingComposition`)로
// 지켜서 메인 스레드가 멈춘 사이 조합이 여럿 끝나면 다음 일반 키가 그 깃발을 끄며 **모든** 미룬 전송을 취소한다
// (xterm.js 이슈 #6089 · 수정안 PR #6090 — 2026-10-07 기준 미병합, 정식판 6.0.0 에 그대로 있다).
// 여기서는 PR #6090 을 6.0.0 구조에 옮겨 **인스턴스 메서드 넷만** 바꿔 끼운다: 미룬 전송은 순서 큐, 보낸 자리는
// 수위(`sentUpTo`)로 기록해 어느 길로 먼저 가든 같은 범위가 두 번 나가지 않는다.
// 조합 밖 글자(공백·숫자 — IME 가 켜져 있으면 keyCode 229)의 지연 차분도 같은 수위를 쓴다 — 원본은 키가 겹치면
// 같은 글자를 두 번 보낸다(xterm #6045). 실제 IME 시험에서 PR #6090 만으로는 `하는 하는` 같은 단어 중복이 남았다.
// 모양이 6.0.0 과 다르면(업그레이드) 손대지 않는다 — 그때는 이 파일을 걷고 상위 수정이 들어왔는지 본다.
// 재현: 실제 MS 한국어 IME 입력 + 메인 스레드를 80ms 이상 붙잡으면 누락, 200ms 이상이면 누락·중복이 섞인다.
import type { Terminal } from "@xterm/xterm";

/** 6.0.0 `CompositionHelper` 에서 쓰는 내부 모양 — 공개 API 가 아니다 */
export interface CompositionHelperLike {
  _textarea: HTMLTextAreaElement;
  _compositionView: HTMLElement;
  _coreService: { triggerDataEvent(data: string, wasUserInput?: boolean): void };
  _isComposing: boolean;
  _isSendingComposition?: boolean;
  _compositionPosition: { start: number; end: number };
  _dataAlreadySent: string;
  compositionstart(): void;
  keydown(ev: KeyboardEvent): boolean;
  _finalizeComposition(waitForPropagation: boolean): void;
  _handleAnyTextareaChanges(): void;
}

/** 6.0.0 과 같은 모양인가 — 깃발이 있고 고칠 메서드가 다 있을 때만 */
function looksLike600(helper: unknown): helper is CompositionHelperLike {
  if (typeof helper !== "object" || helper === null) return false;
  const h = helper as Record<string, unknown>;
  return typeof h._isSendingComposition === "boolean" &&
    typeof h._finalizeComposition === "function" &&
    typeof h.keydown === "function" &&
    typeof h.compositionstart === "function" &&
    typeof h._handleAnyTextareaChanges === "function" &&
    h._textarea instanceof Object &&
    typeof (h._coreService as { triggerDataEvent?: unknown } | undefined)?.triggerDataEvent === "function";
}

/** 조합 도우미에 고친 메서드를 얹는다. 얹었으면 `true` */
export function patchCompositionHelperInstance(helper: unknown): boolean {
  if (!looksLike600(helper)) return false;
  const h = helper;
  /** 끝났지만 아직 보내지 않은 조합의 전송 — 오래된 것부터 */
  const pending: (() => void)[] = [];
  /** textarea 값에서 이미 보낸 끝 위치 */
  let sentUpTo = 0;
  /**
   * 수위 너머에서 **이미 보낸 구멍** — 조합 밖 키(공백 등 keyCode ≠ 229)는 xterm 의 keypress 길이 곧바로 보내는데
   * 같은 글자가 textarea 에도 들어간다. 밀려 있던 조합 전송이 "값 끝까지" 읽으면 그 글자가 두 번 나간다.
   */
  let holes: { start: number; end: number }[] = [];
  /** 마지막 keydown 이 keypress 길로 보내질 일반 키였는가 — 뒤따르는 input 의 자리를 구멍으로 적는다 */
  let directKey = false;
  /** 마지막 input 뒤의 textarea 길이 — xterm 이 값을 비우면(Enter·blur) 다음 input 이 그보다 앞에서 시작한다 */
  let lastLength = 0;

  const sliceUnsent = (start: number, end: number): string => {
    const from = Math.max(start, sentUpTo);
    const to = Math.max(from, end);
    sentUpTo = Math.max(sentUpTo, to);
    const value = h._textarea.value;
    let out = "";
    let at = from;
    for (const hole of holes) {
      if (hole.end <= at || hole.start >= to) continue;
      out += value.substring(at, Math.max(at, hole.start));
      at = Math.max(at, hole.end);
    }
    out += value.substring(at, Math.max(at, to));
    holes = holes.filter((hole) => hole.end > sentUpTo);
    return out;
  };

  h._textarea.addEventListener?.("input", (ev: Event) => {
    const input = ev as InputEvent;
    const direct = directKey;
    directKey = false;
    const end = h._textarea.value.length;
    const start = end - (input.data?.length ?? 0);
    // 값이 우리 모르게 줄었다(비우기) — 그 너머의 기록은 옛 글자의 자리다. 조합 중의 input 은 미리 쓰기 글자를
    // 제자리에서 바꾸므로 늘 앞에서 시작한다 — 거기서는 가르지 않는다(조합 뒤 비우기는 compositionstart 가 본다).
    if (!input.isComposing && start < lastLength) {
      holes = holes.filter((hole) => hole.end <= start);
      sentUpTo = Math.min(sentUpTo, Math.max(0, start));
    }
    lastLength = end;
    if (!direct || input.isComposing || input.inputType !== "insertText" || !input.data) return;
    holes.push({ start, end });
  }, true);

  h.compositionstart = function () {
    h._isComposing = true;
    h._compositionPosition.start = h._textarea.value.length;
    // 수위는 textarea 안의 절대 위치라, 값이 밑에서 다시 쓰였으면(_syncTextArea 등) 함께 내려온다.
    // 조합은 값 끝에서 시작하므로 그 너머의 구멍은 비워지기 전 글자의 자리다.
    holes = holes.filter((hole) => hole.end <= h._compositionPosition.start);
    sentUpTo = Math.min(sentUpTo, h._compositionPosition.start);
    h._compositionView.textContent = "";
    h._dataAlreadySent = "";
    h._compositionView.classList.add("active");
  };

  h.keydown = function (ev: KeyboardEvent) {
    directKey = false;
    if (h._isComposing || pending.length > 0) {
      // 20 CapsLock · 229 조합 문자 · 16~18 수식 키는 조합을 이어 간다
      if (ev.keyCode === 20 || ev.keyCode === 229 || ev.keyCode === 16 || ev.keyCode === 17 || ev.keyCode === 18) return false;
      h._finalizeComposition(false);
    }
    if (ev.keyCode === 229) {
      h._handleAnyTextareaChanges();
      return false;
    }
    directKey = true;
    return true;
  };

  h._finalizeComposition = function (waitForPropagation: boolean) {
    h._compositionView.classList.remove("active");
    h._isComposing = false;
    if (!waitForPropagation) {
      // 이미 줄 선 것을 순서대로 먼저 보낸다 — 예전엔 여기서 전부 취소했다(#6089).
      for (const send of pending.splice(0, pending.length)) send();
      // compositionupdate 의 0ms 타이머가 아직이면 end 가 start 그대로다 — 커서 위치까지 넓힌다.
      const end = Math.max(h._compositionPosition.end, h._textarea.selectionEnd ?? h._compositionPosition.end);
      const input = sliceUnsent(h._compositionPosition.start, end);
      if (input.length > 0) h._coreService.triggerDataEvent(input, true);
      return;
    }
    // 새 compositionstart 가 타이머보다 먼저 올 수 있어 위치를 복사해 둔다.
    const position = { start: h._compositionPosition.start, end: h._compositionPosition.end };
    const send = () => {
      // keydown 이 이미 보낸 몫만큼 건너뛴다(xterm #3191).
      position.start += h._dataAlreadySent.length;
      // 더 새 조합이 이 뒤에서 시작했으면 그 시작이 이 조합의 끝이다. `_isComposing` 으로 가르면 안 된다 —
      // 동기 길이 이 전송을 비울 때는 이미 거짓이라, 새 조합의 미리 쓰기 글자까지 읽어 버린다.
      const end = h._compositionPosition.start > position.start ? h._compositionPosition.start : h._textarea.value.length;
      const input = sliceUnsent(position.start, end);
      if (input.length > 0) h._coreService.triggerDataEvent(input, true);
    };
    pending.push(send);
    setTimeout(() => {
      // 동기 길이 이미 비웠으면 할 일이 없다
      const i = pending.indexOf(send);
      if (i === -1) return;
      pending.splice(i, 1);
      send();
    }, 0);
  };

  h._handleAnyTextareaChanges = function () {
    const old = h._textarea.value;
    setTimeout(() => {
      if (h._isComposing) return;
      // 앞서 줄 선 조합이 먼저다 — 수위를 이 차분이 먼저 밀면 그 조합이 빈 조각이 된다.
      for (const send of pending.splice(0, pending.length)) send();
      const now = h._textarea.value;
      // 보낸 위치는 수위가 기억하므로 keydown 몫(`_dataAlreadySent`)으로 조합 시작을 밀 필요가 없다 — 겹치면 글자를 건너뛴다.
      h._dataAlreadySent = "";
      if (now.startsWith(old) && now.length > old.length) {
        const added = sliceUnsent(old.length, now.length);
        if (added.length > 0) h._coreService.triggerDataEvent(added, true);
      } else if (now.length < old.length) {
        sentUpTo = Math.min(sentUpTo, now.length);
        h._coreService.triggerDataEvent("\x7f", true);
      } else if (now !== old) {
        // 값이 통째로 바뀌었다 — 원본처럼 새 값을 그대로 보내고 수위를 끝으로 옮긴다.
        sentUpTo = now.length;
        h._coreService.triggerDataEvent(now, true);
      }
    }, 0);
  };

  h._isSendingComposition = false;
  return true;
}

/** `term.open()` 뒤에 부른다 — 내부 도우미를 찾아 고친다. 못 찾거나 모양이 다르면 그대로 둔다 */
export function patchTerminalComposition(term: Terminal): boolean {
  const core = (term as unknown as { _core?: { _compositionHelper?: unknown } })._core;
  const ok = patchCompositionHelperInstance(core?._compositionHelper);
  if (!ok) console.warn("[aynx] xterm 조합 도우미 모양이 달라 IME 수정을 건너뜁니다");
  return ok;
}
