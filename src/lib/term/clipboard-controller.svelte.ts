// **터미널 타일의 복사 · 붙여넣기 확인 흐름** — `Terminal.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 6차).
// `Terminal` 이 옛 상태 자리에서 하나 만들고(`createClipboardController` — `term` · `active` 는 게터) 값은 게터로 읽는다.
//
// 쥐는 것: 선택 자동 복사(`paste` 모드 — 버튼을 뗄 때 한 번) · 선택 복사 · 붙여넣기 요청(여러 줄이면 확인 대기) · 클립보드 읽기 ·
// 확인 대기 상태(`pastePrompt`) · 고칠 수 있는 글(`pasteDraft`)과 그 줄 수 · 확인 상자의 [붙여넣기] 단추 손잡이. 그림은 `term/PasteConfirm.svelte`.
//
// **여기 없는 것** — 실제로 넣는 `pasteToTerm`(입력 출처 `paste` 의 동기 구간 `inputPasting` — `$lib/term/input-source`)과 토스트(`showNote`)는
// `Terminal` 에 남아 host 로 받는다. 확인 상자가 뜨면 [붙여넣기] 로 포커스를 옮기는 `$effect` · 창 `mouseup` 리스너 등록/해제 ·
// 선택 변경 구독 · 붙여넣기 이벤트 가로채기 · 정리의 확인 대기 걷기는 `Terminal` 의 원래 자리 · 원래 순서다.
import type { Terminal } from "@xterm/xterm";
import { readClipboard, writeClipboard } from "$lib/clipboard";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";

/** `Terminal` 이 넘기는 값 — **게터**라 그때그때의 값이다(`term` 은 `mount()` 가 채운다). */
export interface ClipboardHost {
  readonly term: Terminal | null;
  readonly active: boolean;
  /** 타일 토스트 한 줄 */
  showNote(text: string, ok: boolean): void;
  /** `term.paste()` — 그 동안 나온 글은 붙여넣기(사람)로 친다 */
  pasteToTerm(text: string): void;
}

/** 복사 · 붙여넣기 하나 벌을 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createClipboardController(h: ClipboardHost) {
  /**
   * 선택이 바뀌었지만 아직 복사하지 않았다 (`paste` 모드에서만 선다).
   *
   * `onSelectionChange` 에서 곧바로 복사하지 않는 이유는 그 콜백이 **드래그하는 내내**
   * 불리기 때문이다 — 한 번 긋는 동안 클립보드를 수십 번 갈아 끼우게 된다. 사용자가 말한
   * 것은 "드래그로 선택하면" 이고, 그 몸짓이 끝나는 지점은 버튼을 떼는 순간이다.
   */
  let selectionDirty = false;

  /** 확인을 기다리는 붙여넣기 (`null` = 없음). 모달이 이 값을 그린다 */
  let pastePrompt = $state<{ text: string } | null>(null);
  /**
   * 확인 상자의 **고칠 수 있는 글**(10-25 사용자 — 붙이기 전에 손보고 싶다) — 열 때 원문 전체(줄 끝은 `\n`)로 채운다. 고치지 않았으면 원문
   * 그대로 붙인다(줄 끝 · 바이트가 처음 받은 그것이다)
   */
  let pasteDraft = $state("");
  /** 고쳐 쓴 글의 줄 수 — 제목이 따라간다(끝의 개행 하나는 세지 않는다 — [`requestPaste`] 와 같은 셈) */
  const pasteDraftLines = $derived.by(() => {
    if (pasteDraft === "") return 0;
    const lines = pasteDraft.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.length;
  });

  /** 선택이 바뀌었다는 표시만 세운다 — 복사는 버튼을 뗄 때(`flushSelectionCopy`) */
  function markSelectionDirty() {
    selectionDirty = true;
  }

  /**
   * 선택 텍스트를 클립보드로 — **성공도 한 줄로 알린다**.
   *
   * 원래는 알리지 않았다("눈앞의 선택이 이미 피드백이다"). 그 근거는 원격 복사(OSC 52)가
   * 토스트를 갖게 된 날 무너졌다 ([2026-09-23-osc52-osc8.md]) — 한 타일에서 복사 둘이
   * 서로 다르게 말하면, 드래그가 정말 복사까지 갔는지를 사람이 구별할 방법이 없다
   * (그래서 지금은 둘 다 이 한 줄을 쓴다). 특히 `paste` 모드의 드래그 자동 복사는 누른
   * 버튼도 고른 메뉴 항목도 없어 **화면에 흔적이 하나도 남지 않는 몸짓**이다.
   *
   * **속도 제한은 두지 않는다** — 원격 복사와 달리 여기서는 몸짓 하나가 곧 복사 하나다
   * (드래그 내내 오는 선택 변경은 `selectionDirty` 가 이미 버튼 떼는 순간 하나로 접는다).
   * 빈 선택은 조용히 돌아간다 — 복사한 것이 없으면 할 말도 없다.
   *
   * AI 타일에서는 원격 복사(OSC 52) 쪽이 성공을 말하지 않는다 — CLI 가 제 "copied" 를 띄운다
   * ([2026-10-05-ai-tile-copy-note.md]). 이 함수(앱 자신의 선택 복사)는 그대로 말한다 — 그때 CLI 는 모른다.
   */
  async function copySelection() {
    const text = h.term?.getSelection() ?? "";
    if (text === "") return;
    if (await writeClipboard(text)) h.showNote(tr("pane.term.clipboard.copied"), true);
    else h.showNote(tr("pane.term.clipboard.write_failed"), false);
  }

  /**
   * 버튼을 뗄 때 한 번 — `paste` 모드의 자동 복사. 선택이 안 바뀌었으면 여기서 끝난다.
   * 창 `mouseup` 에 건다(`pointerup` 아님) — xterm 이 선택 변경을 문서 `mouseup` 에서 알리므로 그 뒤라야 표시가 서 있다.
   */
  function flushSelectionCopy() {
    if (!selectionDirty) return;
    selectionDirty = false;
    void copySelection();
  }

  /**
   * **이 패널의 붙여넣기가 지나는 단 하나의 통로.** 우클릭·컨텍스트 메뉴·`Ctrl+Shift+V`·
   * `Shift+Insert` 가 전부 여기로 모인다 — 확인 모달이 한 갈래에만 붙으면 나머지 갈래가
   * 곧 "확인 없이 여러 줄이 실행되는 길" 이 된다.
   *
   * 실제로 넣는 것은 `term.paste()` 다 (`session.write` 가 아니다): 그 API 가 브래킷
   * 붙여넣기(`\x1b[200~`)를 셸이 켜 두었을 때만 감싸 준다. 결과는 `onData` → `sendInput`
   * 으로 흘러 동시 입력에도 그대로 실린다 — 지금까지의 붙여넣기와 같은 길이다.
   */
  function requestPaste(text: string) {
    if (text === "") return;
    if (settings.confirmMultilinePaste && /[\r\n]/.test(text)) {
      // 줄 수는 고친 글을 따라 `pasteDraftLines` 가 센다(끝의 개행 하나가 만든 빈 줄은 세지 않는다 — 그건 줄이 아니라 "실행" 이다)
      pastePrompt = { text };
      pasteDraft = text.replace(/\r\n?/g, "\n");
      return;
    }
    h.pasteToTerm(text);
  }

  /** 클립보드를 읽어 [`requestPaste`] 로. 못 읽으면 토스트 한 줄 (조용히 실패하지 않는다) */
  async function pasteFromClipboard() {
    const text = await readClipboard();
    if (text === null) {
      h.showNote(tr("pane.term.clipboard.read_failed"), false);
      return;
    }
    requestPaste(text);
  }

  /** 확인 모달의 [붙여넣기] — 모달을 먼저 닫고 값을 쓴다. 고치지 않았으면 원문, 고쳤으면 고친 글(비었으면 붙이지 않는다) */
  function confirmPaste() {
    const pending = pastePrompt;
    const draft = pasteDraft;
    pastePrompt = null;
    pasteDraft = "";
    if (pending) {
      const same = draft === pending.text.replace(/\r\n?/g, "\n");
      const out = same ? pending.text : draft;
      if (out !== "") h.pasteToTerm(out);
    }
    if (h.active) h.term?.focus();
  }

  function cancelPaste() {
    pastePrompt = null;
    pasteDraft = "";
    if (h.active) h.term?.focus();
  }

  /** 정리 — 확인 대기 중이던 붙여넣기는 대상과 함께 사라진다 */
  function dropPrompt() {
    pastePrompt = null;
  }

  /**
   * 확인 모달의 [붙여넣기] 버튼 — 모달이 뜨면 여기로 포커스를 옮긴다(`Terminal` 의 `$effect`).
   *
   * 옮기지 않으면 포커스가 xterm 에 남아 **모달 뒤의 셸이 키를 계속 받는다** — 확인을
   * 기다리는 동안 친 글자가 보이지 않는 곳으로 흘러 들어가는 셈이다. Escape 도 이 버튼에서
   * 올라와야 위 `onkeydown` 이 받는다.
   */
  let pasteConfirmBtn = $state<HTMLButtonElement | null>(null);

  return {
    get pastePrompt() {
      return pastePrompt;
    },
    /** 고칠 수 있는 글(`PasteConfirm` 이 묶는다) */
    get pasteDraft() {
      return pasteDraft;
    },
    set pasteDraft(v: string) {
      pasteDraft = v;
    },
    get pasteDraftLines() {
      return pasteDraftLines;
    },
    /** [붙여넣기] 단추(`PasteConfirm` 이 묶는다) */
    get pasteConfirmBtn() {
      return pasteConfirmBtn;
    },
    set pasteConfirmBtn(v: HTMLButtonElement | null) {
      pasteConfirmBtn = v;
    },
    markSelectionDirty,
    copySelection,
    flushSelectionCopy,
    requestPaste,
    pasteFromClipboard,
    confirmPaste,
    cancelPaste,
    dropPrompt,
  };
}

export type ClipboardController = ReturnType<typeof createClipboardController>;
