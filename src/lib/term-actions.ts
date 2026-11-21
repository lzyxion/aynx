/**
 * 터미널 조작 창구 — 메뉴는 `PaneHost`(타일 상자 밖)가 그리고 조작은 xterm 을 쥔 `Terminal.svelte` 만 할 수 있어,
 * 살아 있는 패널이 자기 창구를 패널 id 로 여기 올려 둔다.
 * 링크는 인자로 오지 않는다 — 우클릭한 순간의 링크를 터미널이 기억해 두고 [`openLink`] · [`copyLink`] 가 쓴다.
 */

import type { AskAnchor } from "$lib/ask-ai";
import type { ScreenSnapshot } from "$lib/screen-thumb";
import type { BandKey } from "$lib/mobile/keys";

export interface TermActions {
  copySelection(): void;
  /** 여러 줄이면 확인 모달을 거친다 — 이 앱의 붙여넣기 통로는 이것 하나다 */
  paste(): void;
  selectAll(): void;
  /** xterm `clear()` 다 — 셸에 `clear` 를 보내면 치던 명령줄이 실행된다 */
  clear(): void;
  openLink(): void;
  copyLink(): void;
  hasScrollback(): boolean;
  /** 서버에 묻지 않고 xterm 이 쥔 버퍼를 읽기만 한다 */
  screenSnapshot(): ScreenSnapshot;
  /** 값은 부른 쪽의 메모리에만 머문다(로그 · 저장 · 서버로 나가지 않는다) */
  screenLines(): string[];
  /** 값은 부른 쪽 메모리에만 머문다 */
  screenBottom(rows: number): ScreenSnapshot;
  saveScrollback(): void;
  /** 값이 아니라 함수다 — 창구는 마운트에서 한 번 등록되고 이 값은 세션이 붙은 뒤에 채워지며, 메뉴는 동기다 */
  logPath(): string | null;
  openLog(): void;
  // ── 블록을 AI 타일에 넘기기 ─────────
  bracketedPaste(): boolean;
  /** 입력 줄에 넣기만 한다 — 보내지 않는다. 동시 입력을 타지 않는다(이 타일 하나에만) */
  insertText(text: string): "ok" | "no-bracketed" | "closed";
  /** 실행하지 않는다 — 한 줄은 괄호 붙여넣기 없이도 넣고, 여러 줄은 모드가 꺼져 있으면 넣지 않는다. 동시 입력을 타지 않는다 */
  insertCode(code: string): "ok" | "multiline" | "empty" | "closed";
  focus(): void;
  blockAnchor(blockId: number): AskAnchor | null;
  // ── 모바일 키 띠 · 입력 칸 ─────────
  /** 사람이 친 키로 보낸다(출처 `keyboard`) */
  bandKey(key: BandKey): void;
  /** 붙여넣기와 같은 길(`term.paste`) — 모바일 IME 의 조합을 xterm 이 직접 받지 않게 */
  sendText(text: string, enter: boolean): void;
  /** 사람이 친 키로 곧장 보낸다(출처 `keyboard`) */
  sendKeys(data: string): void;
  /**
   * 사람이 이 터미널에 친 것과 같은 길이다. `attach` 는 글보다 먼저 이 타일에만 괄호 붙여넣기로 넣는다 —
   * 터미널 면에 파일을 끌어 놓을 때와 같은 바이트라 CLI 가 같은 식으로 그림으로 바꾼다.
   */
  submitText(text: string, attach?: readonly string[]): "ok" | "closed" | "empty" | "no-bracketed";
  /**
   * 대화 면의 [중지] — Esc 하나를 이 타일에만 사람 키로 보낸다. 사람이 누른 단추가 만드는 고정 키라 AI 문자열이 PTY 로 가는 길이 아니다.
   * 동시 입력 형제에게는 싣지 않는다(다른 타일의 턴까지 끊지 않게).
   */
  sendEscape(): "ok" | "closed";
}

const registry = new Map<string, TermActions>();

/** 해제는 내가 넣은 그 창구일 때만 지운다 — 재마운트가 겹치면 먼저 죽은 패널이 새 창구를 지운다 */
export function registerTermActions(paneId: string, api: TermActions): () => void {
  registry.set(paneId, api);
  return () => {
    if (registry.get(paneId) === api) registry.delete(paneId);
  };
}

export function termActionsOf(paneId: string): TermActions | null {
  return registry.get(paneId) ?? null;
}
