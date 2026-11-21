// 터미널 타일의 복사 · 붙여넣기 확인 흐름. 값은 게터로 읽는다(`term` 은 `mount()` 가 채운다).
// 실제로 넣는 `pasteToTerm`(입력 출처 `paste` 구간)과 리스너 등록 · 정리 순서는 `Terminal.svelte` 에 남는다.
import type { Terminal } from "@xterm/xterm";
import { readClipboard, writeClipboard } from "$lib/clipboard";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";

export interface ClipboardHost {
  readonly term: Terminal | null;
  readonly active: boolean;
  showNote(text: string, ok: boolean): void;
  /** `term.paste()` — 그 동안 나온 글은 붙여넣기(사람)로 친다 */
  pasteToTerm(text: string): void;
}

export function createClipboardController(h: ClipboardHost) {
  /** `onSelectionChange` 는 드래그 내내 불린다 — 거기서 곧바로 복사하면 클립보드를 수십 번 갈아 끼운다. 버튼을 뗄 때 한 번. */
  let selectionDirty = false;

  let pastePrompt = $state<{ text: string } | null>(null);
  /** 고치지 않았으면 원문 그대로 붙인다(줄 끝 · 바이트가 처음 받은 그것이다) */
  let pasteDraft = $state("");
  /** 끝의 개행 하나는 세지 않는다 — 그건 줄이 아니라 "실행" 이다 */
  const pasteDraftLines = $derived.by(() => {
    if (pasteDraft === "") return 0;
    const lines = pasteDraft.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.length;
  });

  function markSelectionDirty() {
    selectionDirty = true;
  }

  /** 성공도 알린다 — 원격 복사(OSC 52)와 같은 한 줄이어야 드래그가 복사까지 갔는지 구별된다. AI 타일에서도 말한다(CLI 는 이 복사를 모른다). */
  async function copySelection() {
    const text = h.term?.getSelection() ?? "";
    if (text === "") return;
    if (await writeClipboard(text)) h.showNote(tr("pane.term.clipboard.copied"), true);
    else h.showNote(tr("pane.term.clipboard.write_failed"), false);
  }

  /** 창 `mouseup` 에 건다(`pointerup` 아님) — xterm 이 선택 변경을 문서 `mouseup` 에서 알리므로 그 뒤라야 표시가 서 있다. */
  function flushSelectionCopy() {
    if (!selectionDirty) return;
    selectionDirty = false;
    void copySelection();
  }

  /**
   * 이 타일의 붙여넣기가 지나는 **단 하나의 통로** — 확인이 한 갈래에만 붙으면 나머지가 "확인 없이 여러 줄이 실행되는 길" 이 된다.
   * `session.write` 가 아니라 `term.paste()` 다 — 셸이 켜 두었을 때만 괄호 붙여넣기로 감싼다.
   */
  function requestPaste(text: string) {
    if (text === "") return;
    if (settings.confirmMultilinePaste && /[\r\n]/.test(text)) {
      pastePrompt = { text };
      pasteDraft = text.replace(/\r\n?/g, "\n");
      return;
    }
    h.pasteToTerm(text);
  }

  async function pasteFromClipboard() {
    const text = await readClipboard();
    if (text === null) {
      h.showNote(tr("pane.term.clipboard.read_failed"), false);
      return;
    }
    requestPaste(text);
  }

  /** 모달을 먼저 닫고 쓴다. 고친 글이 비었으면 붙이지 않는다 */
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

  function dropPrompt() {
    pastePrompt = null;
  }

  /** 모달이 뜨면 여기로 포커스를 옮긴다 — 안 옮기면 모달 뒤의 셸이 키를 계속 받는다. Escape 도 이 버튼에서 올라와야 받힌다. */
  let pasteConfirmBtn = $state<HTMLButtonElement | null>(null);

  return {
    get pastePrompt() {
      return pastePrompt;
    },
    get pasteDraft() {
      return pasteDraft;
    },
    set pasteDraft(v: string) {
      pasteDraft = v;
    },
    get pasteDraftLines() {
      return pasteDraftLines;
    },
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
