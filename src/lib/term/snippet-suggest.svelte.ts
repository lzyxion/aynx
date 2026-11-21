// 터미널 한 장의 입력 중 스니펫 제안 — 상자 상태 · 다시 세기 · 수락 · 상자가 떠 있을 때의 키 · IME 조합.
// 셸 통합이 없는 타일은 앵커가 없어 한 번도 뜨지 않는다(걸러 내는 것이 아니라 재료가 없다).
import type { Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import type { ShellIntegration } from "$lib/shell-integration";
import { SNIPPET_SUGGEST_LIMIT, suggestSnippets, type SnippetSuggestion } from "$lib/snippets";
import { eraseCount, inputRange } from "$lib/snippet-input";
import { snippets } from "$lib/snippets.svelte.js";
import { snippetInsertText } from "$lib/app/snippets.svelte.js";

export interface SuggestHost {
  readonly term: Terminal | null;
  /** 그 부모(타일 상자)가 좌표의 기준이다 */
  readonly container: HTMLElement | null;
  readonly disposed: boolean;
  readonly shell: ShellIntegration | null;
  readonly active: boolean;
  /** 로컬 · 끊긴 타일은 `null` */
  readonly alias: string | null;
}

/** 셸이 메아리친 뒤에 읽어야 한다 */
const SUGGEST_DEBOUNCE_MS = 40;
/** 위로 뒤집을지 재는 어림값 */
const SUGGEST_ROW_H = 22;
const SUGGEST_PAD_H = 8;
/** CSS 의 `max-width` 와 같은 값이다 */
const SUGGEST_W = 360;

/** 손잡이는 화살표 필드다 — 마크업 · 리스너에 그대로 넘겨도 `this` 가 흔들리지 않는다. */
export class SnippetSuggestController {
  #h: SuggestHost;

  constructor(h: SuggestHost) {
    this.#h = h;
  }

  suggestItems = $state<SnippetSuggestion[]>([]);
  /** `-1` 이 기본이다 — 고르기 전의 Enter · Tab 은 셸의 것이다 */
  suggestSel = $state(-1);
  suggestBox = $state<{ left: number; top: number } | null>(null);
  /** 트림하지 않은 원문 — 지울 글자 수에만 쓴다. 룬이 아니다(그리지 않는다) */
  #suggestTyped = "";
  /** Escape 로 접은 **글자** — 불리언이면 그 프롬프트에서 영영 안 뜬다. 한 글자라도 바뀌면 다시 뜬다 */
  #suggestDismissed: string | null = null;
  #composing = false;
  /** 제안 수락이 사람이 친 키와 같은 길(`sendInput`)로 나간다 — 마운트에서 채운다 */
  inputSink: ((data: string) => void) | null = null;
  #suggestTimer: ReturnType<typeof setTimeout> | undefined;

  closeSuggest = () => {
    if (this.suggestItems.length > 0) this.suggestItems = [];
    this.suggestSel = -1;
    this.suggestBox = null;
    this.#suggestTyped = "";
  };

  #dismissSuggest() {
    this.#suggestDismissed = this.#suggestTyped.trim();
    this.closeSuggest();
  }

  /** WebGL 렌더러에는 DOM 행이 없어 `.xterm-screen` 상자를 칸으로 나눠 잰다. 높이는 어림한다 — 재고 다시 그리면 상자가 한 번 튄다. */
  #suggestAnchorBox(rows: number): { left: number; top: number } | null {
    const t = this.#h.term;
    const host = this.#h.container?.parentElement;
    if (!t || !host) return null;
    const screen = t.element?.querySelector(".xterm-screen");
    if (!screen || t.rows <= 0 || t.cols <= 0) return null;
    const box = screen.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    if (box.height <= 0 || box.width <= 0) return null;

    const cellW = box.width / t.cols;
    const cellH = box.height / t.rows;
    const buf = t.buffer.active;
    const screenRow = buf.baseY + buf.cursorY - buf.viewportY;
    if (screenRow < 0 || screenRow >= t.rows) return null;

    const height = rows * SUGGEST_ROW_H + SUGGEST_PAD_H;
    const x = box.left - hostBox.left + buf.cursorX * cellW;
    const below = box.top - hostBox.top + (screenRow + 1) * cellH;
    const flip = below + height > hostBox.height;
    return {
      left: Math.max(0, Math.min(x, hostBox.width - SUGGEST_W)),
      top: Math.max(0, flip ? below - cellH - height : below),
    };
  }

  /** 사람이 친 키(`onData`)에 달지 않는다 — 읽는 것은 셸이 메아리친 버퍼라 화면이 아직 그 글자를 모른다. */
  #recomputeSuggest() {
    const t = this.#h.term;
    const shell = this.#h.shell;
    if (!t || this.#h.disposed || !shell || !this.#h.active || this.#composing || !settings.inlineSnippets) {
      this.closeSuggest();
      return;
    }
    const buf = t.buffer.active;
    const range = inputRange(shell.inputAnchor(), {
      line: buf.baseY + buf.cursorY,
      col: buf.cursorX,
    });
    if (!range) {
      this.closeSuggest();
      return;
    }
    // 열로 자른다 — 문자열 인덱스로 자르면 한글 · CJK 에서 어긋난다.
    const typed =
      buf.getLine(range.line)?.translateToString(true, range.startCol, range.endCol) ?? "";
    const q = typed.trim();

    if (this.#suggestDismissed !== null) {
      if (q === this.#suggestDismissed) {
        this.closeSuggest();
        return;
      }
      this.#suggestDismissed = null;
    }

    const items = suggestSnippets(q, snippets(), this.#h.alias, SNIPPET_SUGGEST_LIMIT);
    if (items.length === 0) {
      this.closeSuggest();
      return;
    }
    // 글자가 달라졌으면 선택을 비운다 — 남으면 다음 Enter 가 사람이 본 적 없는 줄을 넣는다.
    if (typed !== this.#suggestTyped) this.suggestSel = -1;
    this.#suggestTyped = typed;
    this.suggestItems = items;
    this.suggestBox = this.#suggestAnchorBox(items.length);
    if (!this.suggestBox) this.closeSuggest();
  }

  scheduleSuggest = () => {
    clearTimeout(this.#suggestTimer);
    this.#suggestTimer = setTimeout(() => {
      this.#suggestTimer = undefined;
      this.#recomputeSuggest();
    }, SUGGEST_DEBOUNCE_MS);
  };

  /**
   * DEL × 친 글자 수 + 명령이고 끝에 `\r` 이 없다 — "치던 명령을 완성한다" 이지 실행이 아니다(스니펫의 `enter` 를 보지 않는다).
   * `\b` 가 아니라 `\x7f` — xterm 이 Backspace 를 DEL 로 보낸다. `sendInput` 길이라 동시 입력의 형제 타일과도 짝이 맞는다.
   */
  async #acceptSuggest(id: string, erase: number) {
    const text = await snippetInsertText(id);
    if (text === null || text === "") return;
    this.inputSink?.("\x7f".repeat(Math.max(0, erase)) + text);
    if (this.#h.active) this.#h.term?.focus();
  }

  /** 지울 길이를 먼저 붙든다 */
  pickSuggest = (id: string) => {
    const erase = eraseCount(this.#suggestTyped);
    this.closeSuggest();
    void this.#acceptSuggest(id, erase);
  };

  /**
   * 상자가 떠 있는 동안에만 도는 키. `true` = 내가 삼켰다.
   * 상자는 스스로 뜨므로 `↓` 로 손을 얹기 전까지 Enter · Tab 을 가져가지 않는다 — 다 친 사람의 Enter 에 남의 명령이 들어가면 안 된다.
   * `↑` 는 첫 줄에서 다시 누르면 선택을 놓아 셸 이력으로 간다. 수식 키는 정확히 본다(뒤의 단축키가 받게).
   */
  handleSuggestKeys = (ev: KeyboardEvent): boolean => {
    const n = this.suggestItems.length;
    if (n === 0) return false;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;

    if (ev.code === "ArrowDown" && !ev.shiftKey) {
      ev.preventDefault();
      this.suggestSel = this.suggestSel < 0 ? 0 : (this.suggestSel + 1) % n;
      return true;
    }
    if (ev.code === "ArrowUp" && !ev.shiftKey) {
      if (this.suggestSel < 0) return false;
      ev.preventDefault();
      this.suggestSel = this.suggestSel === 0 ? -1 : this.suggestSel - 1;
      return true;
    }
    if ((ev.code === "Tab" || ev.code === "Enter") && !ev.shiftKey) {
      if (this.suggestSel < 0) return false;
      ev.preventDefault();
      const item = this.suggestItems[this.suggestSel];
      const erase = eraseCount(this.#suggestTyped);
      this.closeSuggest();
      if (item) void this.#acceptSuggest(item.id, erase);
      return true;
    }
    if (ev.code === "Escape" && !ev.shiftKey) {
      ev.preventDefault();
      // 창의 Escape 사슬로 새지 않게 — 뒤에 깔린 모달까지 함께 닫으면 안 된다.
      ev.stopPropagation();
      this.#dismissSuggest();
      return true;
    }
    return false;
  };

  // 조합 중의 글자는 아직 확정이 아니다 — 그 값으로 세면 자모마다 상자가 떴다 사라진다.
  onCompositionStart = () => {
    this.#composing = true;
    this.closeSuggest();
  };
  onCompositionEnd = () => {
    this.#composing = false;
    this.scheduleSuggest();
  };

  teardown(): void {
    clearTimeout(this.#suggestTimer); // 예약된 제안 계산이 죽은 버퍼를 읽지 않게
    this.closeSuggest();
    this.#suggestDismissed = null;
    this.#composing = false;
    this.inputSink = null;
  }
}
