/**
 * **터미널 컨텍스트 메뉴가 두드리는 창구**
 * (docs/log/2026-09-05-terminal-context-menu.md).
 *
 * `shell-integration.ts` 의 명령 레지스트리와 **같은 패턴이고 같은 이유**다: 메뉴를 그리는
 * 곳은 `PaneHost`(타일 상자 **밖** — 상자마다 `isolation: isolate` 라 안에서는 이웃 타일에
 * 덮인다)이고, 복사·붙여넣기·화면 지우기를 실제로 할 수 있는 것은 xterm 인스턴스를 쥔
 * `Terminal.svelte` 뿐이다. 컴포넌트 경계를 넘어 메서드를 부르는 대신, 살아 있는 패널이
 * 자기 창구를 패널 id 와 함께 여기 올려 둔다.
 *
 * 저쪽(`CommandApi`)과 **나눠 두는 이유**는 층이 다르기 때문이다. 저기는 OSC 133 이
 * 만들어 준 **명령 블록**에 대한 물음이고(마지막 출력·점프·상태), 여기는 **화면과
 * 클립보드**에 대한 조작이다 — OSC 133 이 없는 세션에서도 전부 뜻이 있다.
 *
 * ## 왜 링크가 인자로 오지 않는가
 *
 * 메뉴 항목의 신원은 `PaneMenuAction` 문자열 하나뿐이고, "어느 링크인가" 는 그 문자열에
 * 담기지 않는다. 그래서 **우클릭한 순간의 링크를 터미널이 스스로 기억해 두고**
 * [`openLink`]·[`copyLink`] 가 그것을 쓴다. 메뉴 쪽에서 값을 들고 다니면 `docs/conventions.md`
 * 의 "메뉴를 닫는 코드는 값을 스냅샷한 뒤에 온다" 를 한 자리 더 지켜야 하는데, 그 값의
 * 출처는 어차피 터미널이다.
 */

import type { AskAnchor } from "$lib/ask-ai";
import type { ScreenSnapshot } from "$lib/screen-thumb";
import type { BandKey } from "$lib/mobile/keys";

/** 그 패널의 터미널로 들어가는 조작들 — 전부 "지금 이 화면" 에 대한 것이다 */
export interface TermActions {
  /** 선택된 텍스트를 클립보드로 (선택이 없으면 아무것도 안 한다) */
  copySelection(): void;
  /**
   * 클립보드 → 터미널. **여러 줄이면 확인 모달을 거친다** (설정
   * `[terminal] confirm_multiline_paste`) — 이 앱의 붙여넣기 통로는 이것 하나다.
   */
  paste(): void;
  /** 버퍼 전체 선택 (xterm `selectAll`) */
  selectAll(): void;
  /**
   * 화면 지우기 — **xterm `clear()`** 다. 셸에 `clear` 를 보내지 않는다: 그러면 지금 치고
   * 있던 명령줄이 실행되어 버리고, 셸이 없는(끊긴) 타일에서는 아무 일도 안 일어난다.
   */
  clear(): void;
  /** 우클릭한 자리의 링크를 브라우저로 (기억해 둔 링크가 없으면 아무것도 안 한다) */
  openLink(): void;
  /** 우클릭한 자리의 링크 주소를 클립보드로 */
  copyLink(): void;
  /**
   * 지금 **저장할 스크롤백이 있는가** — 메뉴가 그 줄을 흐리게 둘지 정하는 값이다
   * (docs/log/2026-09-17-scrollback-export-and-logs.md).
   */
  hasScrollback(): boolean;
  /**
   * 지금 **보이는 화면**(보통 · 대체 화면 어느 쪽이든, 스크롤해 둔 자리 그대로 `viewportY` 부터 `rows` 줄)을 칸의
   * 색 · 굵게 · 흐림째 — 대시보드 세션 카드의 화면 축소판(`$lib/screen-thumb` · docs/log/2026-09-29-dashboard-thumbs.md).
   * 서버에 묻지 않고 xterm 이 이미 쥔 버퍼를 읽기만 한다.
   */
  screenSnapshot(): ScreenSnapshot;
  /**
   * 지금 **화면**(스크롤과 상관없이 맨 아래 `rows` 줄 — 스크롤백 아님)의 글자 줄 — 대화 면이 Claude 의 폴더 신뢰 질문을 알아채는 데 쓴다
   * (`pane/claude-trust.ts`). 값은 부른 쪽의 메모리에만 머문다(로그 · 저장 · 서버로 나가지 않는다).
   */
  screenLines(): string[];
  /** 버퍼 전체를 `.txt` 로 — 저장 자리는 OS 대화상자가 묻고, 결과는 앱 토스트가 말한다 */
  saveScrollback(): void;
  /**
   * 이 세션이 쓰고 있는 **세션 로그 파일** (`null` = 로깅이 꺼져 있다).
   *
   * **값이 아니라 함수**인 것은 이 창구의 다른 칸과 같은 이유다: 창구는 마운트에서 한 번
   * 등록되는데 이 값은 세션이 붙은 뒤에 채워진다. 그리고 메뉴가 **동기**라 물어보는 자리에서
   * `await` 할 수 없으므로, 터미널이 미리 받아 둔 것을 여기서 꺼내 간다.
   */
  logPath(): string | null;
  /** 그 로그 파일을 OS 기본 앱으로 (없으면 아무것도 안 한다) */
  openLog(): void;
  // ── 블록을 AI 타일에 넘기기 (docs/log/2026-09-28-ask-ai-block.md) ─────────
  /** 이 터미널이 지금 **괄호 붙여넣기 모드**(DECSET 2004)인가 — 새 AI 타일의 준비 신호 중 하나 */
  bracketedPaste(): boolean;
  /**
   * 글을 **입력 줄에 넣는다 — 보내지 않는다**. 괄호 붙여넣기로 감싸 여러 줄이어도 중간에 보내지지 않고, 모드가
   * 꺼져 있으면 넣지 않는다(`"no-bracketed"`). 세션이 없으면(끊김 · 재연결 중) `"closed"`.
   * 동시 입력을 타지 않는다 — 사람이 고른 이 타일 하나에만 넣는다(`$lib/ask-ai` 의 `pasteBytes`).
   */
  insertText(text: string): "ok" | "no-bracketed" | "closed";
  /**
   * **문서 코드 블록을 셸 입력 줄에 넣는다 — 실행하지 않는다**(문서 타일의 [터미널에 넣기] — `$lib/code-to-term` 의 `codeInsertBytes`).
   * [`insertText`] 와 달리 **한 줄**은 괄호 붙여넣기 모드가 꺼져 있어도 글자 그대로 넣는다(줄바꿈이 없으니 실행되지 않는다). 여러 줄인데
   * 모드가 꺼져 있으면 넣지 않고(`"multiline"`), 넣을 글이 없으면 `"empty"`, 세션이 없으면(끊김 · 재연결 중) `"closed"`.
   * 동시 입력을 타지 않는다 — 사람이 고른 이 타일 하나에만 넣는다.
   */
  insertCode(code: string): "ok" | "multiline" | "empty" | "closed";
  /** 이 터미널에 키보드 포커스를 준다 */
  focus(): void;
  /**
   * 그 블록의 프롬프트 줄 **바로 아래**의 화면 좌표 — 고르기 상자가 설 자리다. 줄이 화면 밖이면 커서 줄 아래.
   * 터미널이 아직 그려지지 않았으면 `null`.
   */
  blockAnchor(blockId: number): AskAnchor | null;
  // ── 모바일 키 띠 · 입력 칸 (원격 웹 R5 — `mobile/MobileKeys.svelte`) ─────────
  /** 띠 키 하나를 **사람이 친 키**로 보낸다(출처 `keyboard` · 끈적 Ctrl · 응용 커서 모드는 터미널이 본다) */
  bandKey(key: BandKey): void;
  /**
   * 입력 칸의 글을 넣는다 — 붙여넣기와 같은 길(`term.paste` — 괄호 붙여넣기 모드면 감싼다 · 동시 입력도 같다). `enter` 면 뒤에 Enter
   * 키 하나(사람 키). 모바일 IME 의 조합을 xterm 이 직접 받지 않게(한글 등).
   */
  sendText(text: string, enter: boolean): void;
  /**
   * 키 글자를 **사람이 친 키**로 곧장 보낸다(출처 `keyboard` — 폰 입력 칸의 빈 칸 Backspace = DEL · 끈적 Ctrl 이 걸린 글자 하나).
   * 끈적 Ctrl 이 걸려 있으면 터미널의 사람 키 문이 바로 입력과 같게 붙이고 푼다.
   */
  sendKeys(data: string): void;
  /**
   * **대화 면 입력 칸의 보내기**(2026-10-17 — `pane/FlipComposer`) — 사람이 이 터미널에 친 것과 같은 길: 한 줄은 키보드(출처
   * `keyboard`), 여러 줄은 붙여넣기(`term.paste` — 괄호 붙여넣기 모드면 감싼다 · 출처 `paste`), 그 뒤 Enter 키 하나. 계획은
   * `term/submit-text.ts`. 세션이 없으면(끊김 · 재연결 중) `"closed"`, 글이 비면 `"empty"`.
   *
   * `attach`(2026-10-24 — 입력 칸의 첨부 칩 · 경로 하나에 하나)가 있으면 글보다 먼저 하나씩 [`insertText`] 와 같은 괄호 붙여넣기로 이
   * 타일에만 넣고 그때마다 틈(`SUBMIT_ATTACH_GAP_MS`)을 둔다 — 터미널 면에 파일을 끌어 놓을 때와 같은 바이트라 CLI 가 같은 식으로
   * 그림(`[Image #N]`)으로 바꾼다. 그때는 글이 비어도 Enter 를 보낸다. 괄호 붙여넣기 모드가 꺼져 있으면 아무것도 보내지 않는다(`"no-bracketed"`).
   */
  submitText(text: string, attach?: readonly string[]): "ok" | "closed" | "empty" | "no-bracketed";
  /**
   * **대화 면의 [중지]**(2026-11-02 — `pane/AiFlip`) — Esc 키 하나(`\x1b`)를 **이 타일에만** 사람 키(출처 `keyboard`)로 보낸다. Claude
   * Code · Codex 의 TUI 에서 Esc 는 지금 턴을 끊는다. 사람이 누른 단추가 만드는 고정 키라 AI 문자열이 PTY 로 가는 길이 아니다(키보드로
   * Esc 를 친 것과 같은 등급). 동시 입력 형제에게는 싣지 않는다(`writeInput` 직행 — 다른 타일의 턴까지 끊지 않게) · 끈적 Ctrl 도 붙이지
   * 않는다. 세션이 없으면(끊김 · 재연결 중) `"closed"`.
   */
  sendEscape(): "ok" | "closed";
}

const registry = new Map<string, TermActions>();

/**
 * 패널의 터미널 창구를 등록한다 (터미널 마운트 시 1회).
 * 해제는 **내가 넣은 그 창구일 때만** 지운다 (`registerCommands` 와 같은 이유 — 재마운트가
 * 겹치면 나중에 뜬 패널의 창구를 먼저 죽은 패널이 지워 버린다).
 */
export function registerTermActions(paneId: string, api: TermActions): () => void {
  registry.set(paneId, api);
  return () => {
    if (registry.get(paneId) === api) registry.delete(paneId);
  };
}

/** 그 패널의 창구 (없으면 null — 아직 마운트 전이거나 세션 없는 타일이다) */
export function termActionsOf(paneId: string): TermActions | null {
  return registry.get(paneId) ?? null;
}
