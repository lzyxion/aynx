// 터미널 한 장의 입력 중 스니펫 제안 — 상자 상태(줄·선택·자리) · 다시 세기(디바운스) · 수락 · 상자가 떠 있을 때의 키 · IME 조합.
// `Terminal.svelte` 가 옛 상태 자리에서 하나 만들고, 그림(`SnippetSuggest`) · 리스너 부착 · 접는 `$effect` 는 `Terminal` 에 있다. `$effect` 없음.
import type { Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import type { ShellIntegration } from "$lib/shell-integration";
import { SNIPPET_SUGGEST_LIMIT, suggestSnippets, type SnippetSuggestion } from "$lib/snippets";
import { eraseCount, inputRange } from "$lib/snippet-input";
import { snippets } from "$lib/snippets.svelte.js";
import { snippetInsertText } from "$lib/app/snippets.svelte.js";

/** 제안이 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface SuggestHost {
  readonly term: Terminal | null;
  /** xterm 마운트 요소 — 그 부모(타일 상자)가 좌표의 기준이다 */
  readonly container: HTMLElement | null;
  readonly disposed: boolean;
  /** 입력 앵커를 쥔 셸 통합 — 없으면 한 번도 뜨지 않는다 */
  readonly shell: ShellIntegration | null;
  /** 이 타일이 키를 받는가 */
  readonly active: boolean;
  /** 이 타일의 SSH 별칭 (로컬·끊긴 타일은 `null`) — 범위 거르기가 받는 값 */
  readonly alias: string | null;
}

// ---------------------------------------------------------------------------
// 입력 중 스니펫 제안 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안")
//
// 프롬프트에 두 글자 이상 치면 맞는 스니펫이 커서 옆에 뜬다. 조각이 셋으로 나뉘어 있고
// 여기는 **그 셋이 만나는 자리**다.
//
//   규칙(입력 모드·읽을 구간·지울 글자 수)  `snippet-input.ts` — 순수
//   어느 줄이 서는가 (`suggestSnippets`)     `snippets.ts`      — 순수
//   앵커(= 명령문이 시작하는 자리)           `shell-integration.ts` (마커를 쥔 쪽)
//   버퍼 읽기 · 셀 기하 · 키 · 쓰기          여기
//
// 셸 통합이 없는 타일(cmd · tmux 간이 모드 · 훅이 안 들어간 원격)에서는 `shell` 이 없거나
// 앵커가 `null` 이라 **한 번도 뜨지 않는다** — 걸러 내는 것이 아니라 재료가 없다.
// ---------------------------------------------------------------------------

/** 제안 목록이 다시 계산되기까지의 시간(ms) — 셸이 메아리친 뒤에 읽어야 한다 */
const SUGGEST_DEBOUNCE_MS = 40;
/** 줄 하나의 대략 높이(px) — 위로 뒤집을지 재는 데만 쓴다 (정확할 필요는 없다) */
const SUGGEST_ROW_H = 22;
/** 상자의 세로 여백(padding + 테두리) 어림값 */
const SUGGEST_PAD_H = 8;
/** 상자의 어림 폭 — 가로 클램프용. CSS 의 `max-width` 와 같은 값이다 */
const SUGGEST_W = 360;

/**
 * 타일 하나의 제안 상자. 손잡이는 전부 화살표 필드다 — 마크업(`onpick`)·리스너·xterm 콜백에
 * 그대로 넘겨도 `this` 가 흔들리지 않는다.
 */
export class SnippetSuggestController {
  #h: SuggestHost;

  constructor(h: SuggestHost) {
    this.#h = h;
  }

  /** 지금 떠 있는 줄들 (빈 배열 = 상자가 없다) */
  suggestItems = $state<SnippetSuggestion[]>([]);
  /** 하이라이트된 줄. **`-1` 이 기본**이다 — 고르기 전의 Enter·Tab 은 셸의 것이다 */
  suggestSel = $state(-1);
  /** 타일 상자 기준 좌표 (`null` = 아직 못 쟀다) */
  suggestBox = $state<{ left: number; top: number } | null>(null);
  /**
   * 지금 상자의 근거가 된 **친 글자 그대로** (트림하지 않은 원문).
   *
   * 룬 상태가 아니다 — 화면에 그리지 않고 오직 "몇 글자를 지울 것인가" 에만 쓴다
   * (`kept`·`shownPane` 과 같은 이유).
   */
  #suggestTyped = "";
  /**
   * Escape 로 접은 글자 (`null` = 접지 않았다).
   *
   * 값이 **글자**인 것이 요점이다: 같은 글자인 동안에는 다시 뜨지 않고, 한 글자라도 더
   * 치거나 지우면 그때부터 다시 뜬다. 불리언 한 칸으로 두면 "이 프롬프트에서는 영영 안 뜬다"
   * 가 되어, 실수로 Escape 를 누른 사람이 그 명령을 다 칠 때까지 기능이 사라진다.
   */
  #suggestDismissed: string | null = null;
  /** IME 조합 중인가 — 조합 중에는 화면의 글자가 아직 확정이 아니다 (아래 `composition*`) */
  #composing = false;
  /** 키 입력이 나가는 문(`Terminal` 의 `sendInput`) — 마운트에서 채운다 (제안 수락이 키 입력과 같은 길로 나간다) */
  inputSink: ((data: string) => void) | null = null;
  #suggestTimer: ReturnType<typeof setTimeout> | undefined;

  /** 상자를 접는다 (이유를 묻지 않는 쪽 — 접는 계기가 여럿이다) */
  closeSuggest = () => {
    if (this.suggestItems.length > 0) this.suggestItems = [];
    this.suggestSel = -1;
    this.suggestBox = null;
    this.#suggestTyped = "";
  };

  /** Escape — 이번 글자에 한해 접는다 (위 [`suggestDismissed`]) */
  #dismissSuggest() {
    this.#suggestDismissed = this.#suggestTyped.trim();
    this.closeSuggest();
  }

  /**
   * 커서 칸 **바로 아래**의 좌표를 타일 상자 기준으로 잰다 (`null` = 잴 수 없다).
   *
   * xterm 은 "커서가 화면의 어디인가" 를 공개 API 로 주지 않는다 — `rowAtClientY` 와 같은
   * 처방으로 `.xterm-screen` 의 상자를 `cols`×`rows` 로 나눈다 (WebGL 렌더러에는 DOM 행이
   * 아예 없어 그쪽을 셀 수 없다).
   *
   * 넘침은 두 가지로 처리한다: 오른쪽으로 새면 **왼쪽으로 당기고**(클램프), 아래로 새면
   * 커서 **위로 뒤집는다**. 높이는 줄 수로 어림한다 — 정확히 재려면 한 프레임 뒤에 다시
   * 그려야 하고, 그러면 상자가 눈에 띄게 한 번 튄다.
   */
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
    // 커서의 **화면 행** (스크롤을 내려다보는 중이면 화면 밖일 수 있다 — 그때는 접는다).
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

  /**
   * 제안을 다시 센다 — 접는 갈래가 여럿이고 전부 **조용하다**(안내를 띄우지 않는다).
   *
   * 부르는 자리는 셋이다: 셸이 뭔가를 쓴 뒤(`onWriteParsed` → 디바운스) · IME 조합이 끝난
   * 뒤 · 설정이 바뀐 뒤. 사람이 친 키(`onData`)에 달지 않는 이유는 **화면이 아직 그 글자를
   * 모르기 때문**이다 — 우리가 읽는 것은 셸이 메아리친 버퍼이지 키 자체가 아니다.
   */
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
    // **열로 자른다** — 줄 전체를 문자열로 바꾼 뒤 인덱스로 자르면 한글·CJK 에서 어긋난다
    // (`inputRange` 주석). 오른쪽 공백은 xterm 이 떼어 준다.
    const typed =
      buf.getLine(range.line)?.translateToString(true, range.startCol, range.endCol) ?? "";
    const q = typed.trim();

    if (this.#suggestDismissed !== null) {
      if (q === this.#suggestDismissed) {
        this.closeSuggest();
        return;
      }
      this.#suggestDismissed = null; // 글자가 달라졌다 — 접어 둔 것이 풀린다
    }

    const items = suggestSnippets(q, snippets(), this.#h.alias, SNIPPET_SUGGEST_LIMIT);
    if (items.length === 0) {
      this.closeSuggest();
      return;
    }
    // 친 글자가 달라졌으면 선택을 **비운다** — 목록이 바뀌었는데 하이라이트만 남아 있으면
    // 그다음 Enter 가 사람이 본 적 없는 줄을 넣는다.
    if (typed !== this.#suggestTyped) this.suggestSel = -1;
    this.#suggestTyped = typed;
    this.suggestItems = items;
    this.suggestBox = this.#suggestAnchorBox(items.length);
    if (!this.suggestBox) this.closeSuggest(); // 잴 수 없으면 그리지 않는다
  }

  /** 디바운스 한 겹 — 대량 출력 중에 매 write 마다 버퍼를 읽지 않게 */
  scheduleSuggest = () => {
    clearTimeout(this.#suggestTimer);
    this.#suggestTimer = setTimeout(() => {
      this.#suggestTimer = undefined;
      this.#recomputeSuggest();
    }, SUGGEST_DEBOUNCE_MS);
  };

  /**
   * 고른 줄을 넣는다 — **친 글자를 지우고 그 자리에 명령을 놓는다.**
   *
   * 나가는 바이트는 `\x7f`(DEL) × 친 글자 수 + 명령이고 **끝에 `\r` 이 없다**. 스니펫의
   * `enter` 를 보지 않는 것은 이 길의 뜻이 다르기 때문이다: 팔레트·단축키는 "이 명령을
   * 실행한다" 지만 여기는 "치던 명령을 완성한다" 이고, 완성된 줄을 확인하고 Enter 를 치는
   * 것은 사람의 몫이다 (지우는 명령이 한 번 더 보이는 자리가 바로 여기다).
   *
   * `\b` 가 아니라 `\x7f` 인 이유: xterm 이 Backspace 를 DEL 로 보낸다 — 여기서 다른 바이트를
   * 쓰면 셸의 줄 편집기가 우리 것만 다르게 읽는다.
   *
   * 나가는 길은 [`inputSink`](= `sendInput`)다(사람이 친 키와 **같은 길**). 동시 입력이 켜진 탭이면
   * 형제 타일에도 같은 글자가 이미 들어가 있으므로 지우기·넣기도 함께 가야 짝이 맞는다.
   */
  async #acceptSuggest(id: string, erase: number) {
    const text = await snippetInsertText(id);
    if (text === null || text === "") return;
    this.inputSink?.("\x7f".repeat(Math.max(0, erase)) + text);
    if (this.#h.active) this.#h.term?.focus();
  }

  /** 마우스로 줄을 눌렀다 — 키보드와 **같은 몸통**을 지난다 (지울 길이를 먼저 붙든다) */
  pickSuggest = (id: string) => {
    const erase = eraseCount(this.#suggestTyped);
    this.closeSuggest();
    void this.#acceptSuggest(id, erase);
  };

  /**
   * **제안 상자가 떠 있는 동안에만** 도는 키들 (docs/log/2026-09-16-snippets.md).
   * 반환값 규약은 `term/key-handlers.ts` 의 `handleShortcut` 과 같다 (`true` = 내가 삼켰다).
   *
   * ## 고른 것이 없으면 Enter·Tab 은 **셸의 것**이다
   *
   * 이 상자는 사람이 부른 것이 아니라 **스스로 뜬다**. 그러니 그 순간 Enter 의 뜻이
   * 바뀌면, 제안이 뜬 줄 모르고 명령을 다 친 사람이 Enter 를 눌렀을 때 자기가 친 것 대신
   * 남의 명령이 들어간다 — 터미널에서 가장 비싼 종류의 놀람이다. 그래서 상자는 **`↓` 로
   * 한 번 손을 얹기 전까지 키를 하나도 가져가지 않는다**. Tab 도 같다(셸의 자동완성이다).
   *
   * `↑` 는 그 대칭이다: 고른 것이 없으면 그대로 셸로 가고(명령 이력), 첫 줄에서 다시
   * 누르면 **선택을 놓아** 그다음 `↑` 이 이력으로 간다 — 목록 안을 맴돌지 않는다.
   *
   * 수식 키는 **정확히** 본다 (`Shift+Tab`·`Ctrl+Enter` 는 우리 것이 아니다) — 넘겨야
   * 뒤의 `handleShortcut` 이 사용자가 그 조합에 걸어 둔 액션을 볼 수 있다.
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
      if (this.suggestSel < 0) return false; // 고른 것이 없다 — 셸의 명령 이력으로
      ev.preventDefault();
      this.suggestSel = this.suggestSel === 0 ? -1 : this.suggestSel - 1;
      return true;
    }
    if ((ev.code === "Tab" || ev.code === "Enter") && !ev.shiftKey) {
      if (this.suggestSel < 0) return false; // 평소의 Tab·Enter (머리말)
      ev.preventDefault();
      const item = this.suggestItems[this.suggestSel];
      const erase = eraseCount(this.#suggestTyped);
      this.closeSuggest();
      if (item) void this.#acceptSuggest(item.id, erase);
      return true;
    }
    if (ev.code === "Escape" && !ev.shiftKey) {
      ev.preventDefault();
      // 창의 Escape 사슬로 새지 않게 여기서 끊는다 — 이 상자를 접으려던 한 번이 뒤에
      // 깔린 모달까지 함께 닫으면 안 된다 (`SnippetPrompt`·`PaneMenu` 와 같은 규칙).
      ev.stopPropagation();
      this.#dismissSuggest();
      return true;
    }
    return false;
  };

  // IME 조합 중에는 화면의 글자가 **아직 확정이 아니다** — 한글을 치는 내내 자모가
  // 버퍼에 들어왔다 나가므로, 그 값으로 목록을 만들면 글자마다 상자가 떴다 사라진다.
  // 조합을 시작하면 접고, 끝나면 그때의 화면으로 다시 센다. (리스너는 `mount()` 가 textarea 에 건다.)
  onCompositionStart = () => {
    this.#composing = true;
    this.closeSuggest();
  };
  onCompositionEnd = () => {
    this.#composing = false;
    this.scheduleSuggest();
  };

  /** 언마운트 정리 — 옮기기 전 `mount()` 정리의 다섯 줄 그대로 */
  teardown(): void {
    clearTimeout(this.#suggestTimer); // 예약된 제안 계산이 죽은 버퍼를 읽지 않게
    this.closeSuggest();
    this.#suggestDismissed = null;
    this.#composing = false;
    this.inputSink = null;
  }
}
