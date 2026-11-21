// xterm 6.0.0 IME 조합 전송 우회 — 화면이 바쁠 때 한글이 빠지거나 두 번 들어가던 것. 미룬 전송 전부를 깃발 하나(`_isSendingComposition`)로
// 지켜 다음 일반 키가 모두 취소한다(xterm #6089 · 수정안 PR #6090 미병합). PR #6090 을 옮겨 인스턴스 메서드 넷만 바꿔 끼우고,
// 보낸 자리는 수위(`sentUpTo`)로 적어 같은 범위가 두 번 나가지 않게 한다. 조합 밖 글자(keyCode 229)의 지연 차분도 같은 수위를 쓴다(xterm #6045).
// 모양이 6.0.0 과 다르면 손대지 않는다 — 상위 수정이 들어오면 이 파일을 걷는다.
// 재현: MS 한국어 IME + 메인 스레드를 80ms 이상 붙잡으면 누락, 200ms 이상이면 누락 · 중복.
import type { Terminal } from "@xterm/xterm";

/** 6.0.0 `CompositionHelper` 의 내부 모양 — 공개 API 가 아니다 */
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

export function patchCompositionHelperInstance(helper: unknown): boolean {
  if (!looksLike600(helper)) return false;
  const h = helper;
  /** 오래된 것부터 */
  const pending: (() => void)[] = [];
  /** textarea 값에서 이미 보낸 끝 위치 */
  let sentUpTo = 0;
  /**
   * 수위 너머에서 이미 보낸 구멍 — 조합 밖 키(keyCode ≠ 229)는 keypress 길이 곧바로 보내는데 같은 글자가 textarea 에도 들어가,
   * 밀린 조합 전송이 값 끝까지 읽으면 두 번 나간다.
   */
  let holes: { start: number; end: number }[] = [];
  let directKey = false;
  /** xterm 이 값을 비우면(Enter · blur) 다음 input 이 그보다 앞에서 시작한다 */
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
    // 값이 우리 모르게 줄었다(비우기). 조합 중의 input 은 미리 쓰기 글자를 제자리에서 바꿔 늘 앞에서 시작하므로 거기서는 가르지 않는다.
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
    // 수위는 절대 위치라 값이 밑에서 다시 쓰였으면(_syncTextArea 등) 함께 내려온다.
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
      // 줄 선 것을 순서대로 먼저 보낸다 — 원본은 여기서 전부 취소한다(#6089).
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
      // `_isComposing` 으로 가르면 안 된다 — 동기 길이 이 전송을 비울 때는 이미 거짓이라 새 조합의 미리 쓰기 글자까지 읽는다.
      const end = h._compositionPosition.start > position.start ? h._compositionPosition.start : h._textarea.value.length;
      const input = sliceUnsent(position.start, end);
      if (input.length > 0) h._coreService.triggerDataEvent(input, true);
    };
    pending.push(send);
    setTimeout(() => {
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
      // 보낸 위치는 수위가 기억한다 — `_dataAlreadySent` 로 또 밀면 글자를 건너뛴다.
      h._dataAlreadySent = "";
      if (now.startsWith(old) && now.length > old.length) {
        const added = sliceUnsent(old.length, now.length);
        if (added.length > 0) h._coreService.triggerDataEvent(added, true);
      } else if (now.length < old.length) {
        sentUpTo = Math.min(sentUpTo, now.length);
        h._coreService.triggerDataEvent("\x7f", true);
      } else if (now !== old) {
        sentUpTo = now.length;
        h._coreService.triggerDataEvent(now, true);
      }
    }, 0);
  };

  h._isSendingComposition = false;
  return true;
}

/** `term.open()` 뒤에 부른다. 못 찾거나 모양이 다르면 그대로 둔다 */
export function patchTerminalComposition(term: Terminal): boolean {
  const core = (term as unknown as { _core?: { _compositionHelper?: unknown } })._core;
  const ok = patchCompositionHelperInstance(core?._compositionHelper);
  if (!ok) console.warn("[aynx] xterm 조합 도우미 모양이 달라 IME 수정을 건너뜁니다");
  return ok;
}
