/**
 * 단축키 레지스트리와 조합을 푸는 순수 함수들 — Svelte · `t()` 를 들이지 않는다(화면 글자는 부르는 쪽이 사전으로 만든다).
 *
 * 조합 문자열은 `settings.toml` 의 `[keybindings]` 와 주고받는 계약이다: 수식 키 `Ctrl` → `Alt` → `Shift`(이 순서 고정) 뒤에
 * KeyboardEvent 의 `code`(물리 키)를 `+` 로 잇는다 — `"Ctrl+Shift+KeyC"` · `"Ctrl+ArrowUp"`.
 * `ev.key` 는 매칭 · 기록 어디서도 쓰지 않는다 — 한국어 IME 가 켜지면 `"Process"` / `keyCode 229` 로 뭉개진다(xterm #6065). `ev.code` 는 IME 와 무관하다.
 * Meta(⊞/⌘) 는 v1 에서 무시한다 — 윈도 키를 잡으면 OS 와 다툰다.
 */

import type { Key } from "$lib/i18n/keys";

/**
 * `files` 는 파일 타일이 활성일 때만 잡는 층이다(실행은 `browser/file-keys.ts`). 같은 창 keydown 을 전역 층과 함께 지나
 * 두 층에 같은 조합이 걸리면 둘 다 돈다 — 충돌 판정([`sharesKeys`])에서는 `files` 와 `global` 을 한 이름공간으로 본다.
 */
export type ActionScope = "terminal" | "global" | "files";

export interface ActionDef {
  /** `settings.toml` 의 키다 — 바꾸면 저장해 둔 오버라이드가 조용히 기본값으로 돌아간다(모르는 id 는 무시된다) */
  id: string;
  scope: ActionScope;
  def: string;
}

/** `params` 는 `workspace-1`…`-9` 아홉 줄이 번호 하나를 받는 키를 나눠 쓰기 때문이다 */
export interface ActionLabel {
  key: Key;
  params?: Record<string, string>;
}

/** `settings.` 키를 읽는다 — 팔레트 · 치트시트 · 설정이 한 액션을 같은 이름으로 부르게 */
export function actionLabel(id: string): ActionLabel {
  const n = /^workspace-([1-9])$/.exec(id)?.[1];
  if (n) return { key: "settings.keybinding.workspace", params: { n } };
  return { key: `settings.keybinding.${id}` as Key };
}

/**
 * id 는 모두 `settings.toml` 키라 옛 이름(`*-tab` · `workspace-*` · `open-console` · `ai-panel` · `expand-*`)도 그대로 둔다 — 라벨만 바꾼다.
 * 점프가 `Ctrl+↑/↓` 인 것은 인텔 그래픽 드라이버가 `Ctrl+Alt+화살표` 를 화면 회전으로 OS 층에서 선점할 수 있어서다
 * (`term/key-handlers.ts`) — 그 조합은 타일 크기 조절이 받았고(사용자 결정), 회전 핫키가 켜진 PC 에서는 설정에서 다시 묶는다.
 */
export const ACTIONS: readonly ActionDef[] = [
  // ── 터미널 ──
  { id: "jump-prev", scope: "terminal", def: "Ctrl+ArrowUp" },
  { id: "jump-next", scope: "terminal", def: "Ctrl+ArrowDown" },
  { id: "copy-output", scope: "terminal", def: "Ctrl+Shift+KeyC" },
  { id: "edit-remote", scope: "terminal", def: "Ctrl+Shift+KeyE" },
  // 같은 조합을 diff 타일도 제 keydown 에서 쓴다 — 터미널 층 조합이라 전역 표에 없어 겹치지 않는다
  { id: "ask-ai-block", scope: "terminal", def: "Ctrl+Shift+KeyX" },
  // ── 전역 ──
  { id: "new-tab", scope: "global", def: "Ctrl+Shift+KeyT" },
  { id: "close-tab", scope: "global", def: "Ctrl+Shift+KeyW" },
  // 셸은 "찾아서 포커스" 가 아니라 언제나 새로 연다 — 나란히 여는 것이 정상인 타일이다
  { id: "new-shell", scope: "global", def: "Ctrl+Shift+KeyN" },
  // 헤더 `×` 와 같은 경로 · 확인창 없음. `Ctrl+D` 는 세션 없는 타일에서만 돌아(살아 있는 셸에서는 EOF) 붙어 있는 SSH 를 키보드로 닫는 길은 이것뿐이다
  { id: "close-tile", scope: "global", def: "Ctrl+Shift+KeyQ" },
  { id: "next-tab", scope: "global", def: "Ctrl+Tab" },
  { id: "prev-tab", scope: "global", def: "Ctrl+Shift+Tab" },
  { id: "split", scope: "global", def: "Ctrl+Shift+KeyD" },
  { id: "open-settings", scope: "global", def: "Ctrl+Comma" },
  // 독 칸 셋(H · J · K)은 같은 키로 열고 닫는다. `open-hosts` · `open-projects` 에서 옮길 때 옛 id 별칭은 두지 않았다(오버라이드 없음을 사용자가 확인)
  { id: "open-hosts-dock", scope: "global", def: "Ctrl+Shift+KeyH" },
  { id: "open-projects-dock", scope: "global", def: "Ctrl+Shift+KeyJ" },
  { id: "open-db-dock", scope: "global", def: "Ctrl+Shift+KeyK" },
  // Shift 가 있어야 앱 몫이다 — `Ctrl+[`(Shift 없음)는 터미널에서 ESC 와 같은 키라 묶지 않는다. 작업안 `]` 와 한 쌍
  { id: "open-chat-dock", scope: "global", def: "Ctrl+Shift+BracketLeft" },
  // 로컬 셸 타일에서는 그 셸의 폴더로 로컬 파일 타일을 연다 — 라벨이 둘을 다 적는다
  { id: "open-sftp", scope: "global", def: "Ctrl+Shift+KeyO" },
  { id: "open-localfs", scope: "global", def: "Ctrl+Shift+KeyL" },
  { id: "ai-panel", scope: "global", def: "Ctrl+Shift+KeyA" },
  { id: "open-console", scope: "global", def: "Ctrl+Shift+KeyM" },
  // `Ctrl+]`(Shift 없음 — 0x1D, telnet 탈출 등)는 묶지 않아 그대로 셸로 간다
  { id: "open-plans", scope: "global", def: "Ctrl+Shift+BracketRight" },
  { id: "folder-conversations", scope: "global", def: "Ctrl+Shift+KeyY" },
  { id: "open-file", scope: "global", def: "Ctrl+Shift+Period" },
  // 리눅스 IBus 의 유니코드 입력과 겹친다 — 알고 받은 선택(사용자 결정)
  { id: "switch-profile", scope: "global", def: "Ctrl+Shift+KeyU" },
  { id: "switch-workspace", scope: "global", def: "Ctrl+Shift+KeyG" },
  // 알고 받은 손실: 터미널 안 프로그램이 받던 `Ctrl+PgUp/PgDn`(vim 탭 넘기기 등) — 설정에서 옮긴다
  { id: "next-workspace", scope: "global", def: "Ctrl+PageDown" },
  { id: "prev-workspace", scope: "global", def: "Ctrl+PageUp" },
  { id: "toggle-sync", scope: "global", def: "Ctrl+Shift+KeyI" },
  // 가림막 — 볼트도 함께 잠근다. 켜기만 하는 키다: 걷는 문은 가림막 위의 관문 하나뿐이다(`Veil.svelte`)
  { id: "toggle-veil", scope: "global", def: "Ctrl+Shift+KeyB" },
  // 원격 창에서는 아무 일도 없다(끝내기 명령은 메인 PC 전용 — `remote/deny.rs`)
  { id: "quit-app", scope: "global", def: "Ctrl+Shift+F4" },
  // `Ctrl+P` 는 readline 의 "이전 명령"이라 잡지 않는다 — 전역 조합은 `handleShortcut` 이 삼켜 pty 로 보내지 않는다
  { id: "command-palette", scope: "global", def: "Ctrl+Shift+KeyP" },
  // 팔레트를 스니펫 접두사가 찍힌 채로 연다 — 접두사가 같은 글자인 것도 여기서 온다(`SNIPPET_QUERY_PREFIX`)
  { id: "insert-snippet", scope: "global", def: "Ctrl+Shift+Semicolon" },
  // `Ctrl+F` 는 readline 커서 전진 · vim 페이지 다운을 셸에서 뺏는다 — 알고 한 선택, 설정에서 비우면 셸로 돌아간다.
  // `find` 하나를 포커스된 타일의 종류로 가른다(`app/tile-find.ts`) — 새 id 를 만들면 다시 묶어 둔 사람의 조합이 어떤 타일에서만 안 먹는다
  { id: "find", scope: "global", def: "Ctrl+KeyF" },
  { id: "find-all", scope: "global", def: "Ctrl+Shift+KeyF" },
  { id: "reconnect-all", scope: "global", def: "Ctrl+Shift+KeyR" },
  // ── 타일 포커스 · 이동 · 크기 조절 ──
  { id: "focus-left", scope: "global", def: "Alt+ArrowLeft" },
  { id: "focus-right", scope: "global", def: "Alt+ArrowRight" },
  { id: "focus-up", scope: "global", def: "Alt+ArrowUp" },
  { id: "focus-down", scope: "global", def: "Alt+ArrowDown" },
  { id: "move-left", scope: "global", def: "Alt+Shift+ArrowLeft" },
  { id: "move-right", scope: "global", def: "Alt+Shift+ArrowRight" },
  { id: "move-up", scope: "global", def: "Alt+Shift+ArrowUp" },
  { id: "move-down", scope: "global", def: "Alt+Shift+ArrowDown" },
  // `Ctrl+Shift+←/→` 는 셸 · 글 칸의 낱말 고르기라 쓰지 않는다. 인텔 회전 핫키가 켜진 PC 에서는 OS 가 선점한다 — 알고 받은 위험
  { id: "expand-left", scope: "global", def: "Ctrl+Alt+ArrowLeft" },
  { id: "expand-right", scope: "global", def: "Ctrl+Alt+ArrowRight" },
  { id: "expand-up", scope: "global", def: "Ctrl+Alt+ArrowUp" },
  { id: "expand-down", scope: "global", def: "Ctrl+Alt+ArrowDown" },
  { id: "zoom-tile", scope: "global", def: "Ctrl+Shift+KeyZ" },
  { id: "flip-convo", scope: "global", def: "Ctrl+Shift+Backslash" },
  // `?` 단독도 문을 연다 — 그쪽은 코드에 고정이다(`app/keys.svelte.ts` 의 `handleCheatSheetKey`)
  { id: "cheat-sheet", scope: "global", def: "Ctrl+Shift+Slash" },
  // 일본어 배열에서는 이 자리가 반각/전각 키라 IME 전환과 겹친다 — 설정에서 옮긴다
  { id: "go-to-alert", scope: "global", def: "Alt+Backquote" },
  ...goToTabActions(),
  // ── 파일 타일 ── 전역 층과 한 창 keydown 을 나눠 쓰므로 전역 기본값과 겹치지 않는 조합만 고른다
  { id: "files-location", scope: "files", def: "Ctrl+KeyL" },
  { id: "files-view-icons", scope: "files", def: "Ctrl+Digit1" },
  { id: "files-view-compact", scope: "files", def: "Ctrl+Digit2" },
  { id: "files-view-details", scope: "files", def: "Ctrl+Digit3" },
  { id: "files-places", scope: "files", def: "F9" },
  { id: "files-filter", scope: "files", def: "Ctrl+KeyI" },
  { id: "files-preview", scope: "files", def: "F11" },
];

/** 손으로 아홉 줄을 적으면 오타 하나가 남의 설정 파일의 죽은 id 가 된다. 형식은 [`tabIndexOf`] · [`actionLabel`] 의 정규식과 같다 */
function goToTabActions(): ActionDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    id: `workspace-${i + 1}`,
    scope: "global" as const,
    def: `Alt+Digit${i + 1}`,
  }));
}

export function tabIndexOf(action: string): number | null {
  const m = /^workspace-([1-9])$/.exec(action);
  return m ? Number(m[1]) : null;
}

/**
 * 입력칸 안에서도 통하는 액션 — 어떤 입력칸도 뜻을 두지 않는 조합이다. 막으면 독 검색 칸에 커서가 든 타일이 키보드의 함정이 되고,
 * 토글은 칸을 만진 뒤 같은 키로 닫지 못한다(여는 키가 닫지 못하는 토글은 토글이 아니다).
 */
export function bypassesEditGuard(action: string): boolean {
  return (
    action === "close-tile" ||
    action === "zoom-tile" ||
    action === "open-hosts-dock" ||
    action === "open-projects-dock" ||
    action === "open-db-dock" ||
    action === "open-chat-dock" ||
    action === "open-settings" ||
    action === "open-console" ||
    action === "open-plans" ||
    action === "switch-profile" ||
    action === "toggle-veil" ||
    action === "quit-app" ||
    action === "go-to-alert" ||
    // 대화 면의 포커스는 늘 입력 칸이라 가드에 걸면 같은 키로 터미널 면에 돌아오지 못한다
    action === "flip-convo" ||
    action.startsWith("focus-") ||
    action.startsWith("move-") ||
    action.startsWith("expand-")
  );
}

export type Overrides = Record<string, string>;

const BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]));

function isModifierCode(code: string): boolean {
  return (
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight"
  );
}

/** 수식 순서 `Ctrl` → `Alt` → `Shift` 고정 · `ev.code` 로만 읽는다(머리말). 수식 키만 눌렸으면 `null` */
export function comboFromEvent(ev: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}): string | null {
  if (!ev.code || isModifierCode(ev.code)) return null;
  const parts: string[] = [];
  if (ev.ctrlKey) parts.push("Ctrl");
  if (ev.altKey) parts.push("Alt");
  if (ev.shiftKey) parts.push("Shift");
  parts.push(ev.code);
  return parts.join("+");
}

/**
 * 앱이 뜻을 두지 않은 WebView2 가속키 중 대화상자 · 막대 · 패널이 튀어나오는 것들 (docs/log/2026-09-08-browser-accelerators.md).
 * 새로고침(`Ctrl+R` · `F5`)과 개발자 도구(`F12` · `Ctrl+Shift+I`)는 일부러 넣지 않는다 — CDP 검증 도구와 손 재현이 기댄다.
 */
const BROWSER_CHROME_COMBOS: ReadonlySet<string> = new Set([
  "Ctrl+KeyP", // 인쇄 대화상자
  "Ctrl+Shift+KeyP", // 시스템 인쇄 대화상자 (기본값은 팔레트라 보통 앞에서 걸린다)
  "Ctrl+KeyS", // 페이지 저장 (파일 대화상자)
  "Ctrl+Shift+KeyS", // 폐기된 배치 저장 조합: 브라우저/셸로 흘리지 않는다.
  "Ctrl+KeyO", // 파일 열기 (파일 대화상자 → 웹뷰가 그 파일로 이동한다)
  "Ctrl+KeyU", // 소스 보기
  "Ctrl+KeyJ", // 다운로드
  "Ctrl+KeyH", // 방문 기록
  "Ctrl+KeyF", // 찾기 막대 — 앱 검색이 꺼졌거나 모달 안이어도 브라우저로 넘기지 않는다
  "Ctrl+KeyG", // 찾기 막대 — 다음 찾기
  "Ctrl+Shift+KeyG", // 찾기 막대 — 이전 찾기
  "F3", // 찾기 막대 — 다음 찾기
  "Shift+F3", // 찾기 막대 — 이전 찾기
]);

/** `true` 면 부르는 쪽이 브라우저 기본 동작을 끊는다. 같은 조합의 앱 · 편집기 동작은 따로 처리한다 */
export function isBrowserChromeCombo(combo: string): boolean {
  return BROWSER_CHROME_COMBOS.has(combo);
}

// ── 편집 필드 판정 — 키 가드와 네이티브 우클릭 메뉴가 같은 뜻으로 쓴다(갈리면 한쪽만 되는 조용한 어긋남) ──

/** `instanceof HTMLElement` 를 쓰지 않는다 — vitest `node` 환경에는 DOM 전역이 없다 */
interface ElementLike {
  tagName: string;
  isContentEditable?: boolean;
  type?: unknown;
  closest(selector: string): unknown;
}

function asElement(target: EventTarget | null): ElementLike | null {
  const el = target as unknown as Partial<ElementLike> | null;
  if (!el || typeof el.closest !== "function" || typeof el.tagName !== "string") return null;
  return el as ElementLike;
}

/**
 * 글자를 치는 곳만 편집 필드다 — 체크박스 · `<select>` 등은 [`isControlOwnedKey`] 가 따로 본다.
 * xterm 의 숨은 textarea 와 IME 포커스 주인(`data-ime-proxy`)은 편집 필드가 아니다 — 그 위에서도 전역 단축키가 먹어야 한다.
 * `<input>` 은 거부 목록으로 가른다 — 모르는 `type` 은 글자 칸으로 친다(단축키가 글자를 뺏는 쪽이 더 아프다).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  if (el.closest(".xterm")) return false;
  if (el.closest("[data-ime-proxy]")) return false;
  const tag = el.tagName;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has(inputType(el));
  return tag === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * 단축키에서는 터미널처럼 다루는 글 칸(`data-terminal-keys` — AI 타일 대화 면의 입력 칸)만.
 * [`isEditableTarget`] 은 바꾸지 않는다 — 우클릭 메뉴 판정은 이 칸에서도 웹뷰의 글 칸 메뉴를 둔다.
 */
export function isTerminalKeysInput(target: EventTarget | null): boolean {
  const el = asElement(target);
  return !!el && !!el.closest("[data-terminal-keys]");
}

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "image",
  "color",
  "file",
]);

/** 문자열이 아니면 진짜 DOM 의 기본값처럼 `"text"` */
function inputType(el: ElementLike): string {
  return typeof el.type === "string" ? el.type.toLowerCase() : "text";
}

const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "Space",
  "Enter",
  "NumpadEnter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * 포커스된 폼 컨트롤이 스스로 쓰는 맨 키인가 — 설정에서 맨 화살표 · `Shift+글자` 도 묶을 수 있어서다.
 * `Ctrl` · `Alt` 가 섞이면 언제나 앱의 것. `<select>` 는 글자 찾기 때문에 기능 키를 뺀 전부가 그 칸의 것이다.
 */
export function isControlOwnedKey(
  target: EventTarget | null,
  ev: { ctrlKey: boolean; altKey: boolean; code: string },
): boolean {
  if (ev.ctrlKey || ev.altKey) return false;
  const el = asElement(target);
  if (!el || el.closest(".xterm")) return false;
  if (el.tagName === "SELECT") return !/^F\d{1,2}$/.test(ev.code);
  if (el.tagName === "INPUT" && NON_TEXT_INPUT_TYPES.has(inputType(el))) {
    return CONTROL_KEYS.has(ev.code);
  }
  return false;
}

/**
 * 창 전역에서 웹뷰의 기본 우클릭 메뉴를 막는다 — 예외는 앱이 이미 메뉴를 세운 것(`defaultPrevented`) · 편집 필드 · 문서 편집기 안.
 * 창 리스너는 반드시 버블 단계여야 한다 — 캡처로 달면 앱 메뉴보다 먼저 돌아 언제나 "막는다" 가 된다 (docs/log/2026-09-08-native-context-menu.md).
 */
export function shouldBlockNativeContextMenu(
  target: EventTarget | null,
  defaultPrevented: boolean,
): boolean {
  if (defaultPrevented) return false;
  if (isInDocEditor(target)) return false;
  return !isEditableTarget(target);
}

// ── 문서 편집기의 키 경계 ── (docs/log/2026-09-27-doc-edit.md)

export function isInDocEditor(target: EventTarget | null): boolean {
  const el = asElement(target);
  return !!el && !!el.closest(".cm-editor");
}

/**
 * 편집기 안에서도 앱이 쥐는 작업면 조합 — 편집기의 줄 옮기기 · 커서 더하기보다 타일 키가 이긴다(타일이 키보드의 함정이 되지 않게).
 * `paletteCombo` 는 사용자가 다시 묶었을 수 있어 부르는 쪽이 준다.
 */
export function appKeepsInEditor(combo: string, paletteCombo: string | null): boolean {
  if (paletteCombo !== null && combo === paletteCombo) return true;
  if (combo.startsWith("Ctrl+Shift+")) return true;
  if (/^Alt\+(Shift\+)?Arrow(Left|Right|Up|Down)$/.test(combo)) return true;
  if (/^Ctrl\+Alt\+Arrow(Left|Right|Up|Down)$/.test(combo)) return true;
  return combo === "Ctrl+Tab" || combo === "Ctrl+PageUp" || combo === "Ctrl+PageDown";
}

/** 실제로 묶인(`bound`) 조합만 앱이 가져간다 — 묶이지 않은 것까지 빼앗으면 편집기만 그 키를 잃는다 */
export function editorOwnsKey(
  target: EventTarget | null,
  combo: string,
  opts: { bound: boolean; paletteCombo: string | null },
): boolean {
  if (!isInDocEditor(target)) return false;
  return !(opts.bound && appKeepsInEditor(combo, opts.paletteCombo));
}

const CODE_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "Del",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

function labelPart(part: string): string {
  if (part === "Ctrl" || part === "Alt" || part === "Shift") return part;
  if (part.startsWith("Key") && part.length === 4) return part.slice(3);
  if (part.startsWith("Digit") && part.length === 6) return part.slice(5);
  if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`;
  if (/^F\d{1,2}$/.test(part)) return part;
  return CODE_LABELS[part] ?? part;
}

/** 빈 값이면 빈 문자열 — 안 걸린 칸의 이름은 화면마다 다르다(설정은 `settings.keys.unbound`) */
export function displayCombo(combo: string | null | undefined): string {
  if (!combo) return "";
  return combo.split("+").map(labelPart).join("+");
}

/** 오버라이드 우선, 없으면 기본값. 모르는 id 면 `null` */
export function effectiveCombo(id: string, overrides: Overrides): string | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const o = overrides[id];
  if (o && o.trim() !== "") return o;
  // 폐기 override가 가리킨 조합에 새 기본 동작을 자동으로 붙이지 않는다. ID 목록은 settings-codec에 보존한다.
  return [overrides["open-layouts"], overrides["save-layout"]].includes(def.def) ? null : def.def;
}

export function isOverridden(id: string, overrides: Overrides): boolean {
  const o = overrides[id];
  const def = BY_ID.get(id);
  return !!def && !!o && o.trim() !== "" && o !== def.def;
}

export interface ResolvedBindings {
  terminal: Map<string, string>;
  global: Map<string, string>;
  files: Map<string, string>;
  effective: Record<string, string>;
}

/** 같은 층의 충돌은 나중 것이 남는다(last-wins) — 사용자가 알 수 있게 [`conflicts`] 가 따로 경고한다 */
export function resolveBindings(overrides: Overrides = {}): ResolvedBindings {
  const terminal = new Map<string, string>();
  const global = new Map<string, string>();
  const files = new Map<string, string>();
  const effective: Record<string, string> = {};
  const maps = { terminal, global, files };

  for (const action of ACTIONS) {
    const combo = effectiveCombo(action.id, overrides);
    if (!combo) continue;
    effective[action.id] = combo;
    maps[action.scope].set(combo, action.id); // last-wins
  }
  return { terminal, global, files, effective };
}

export interface Conflict {
  scope: ActionScope;
  combo: string;
  ids: string[];
}

export function sharesKeys(a: ActionScope, b: ActionScope): boolean {
  if (a === b) return true;
  return (a === "files" && b === "global") || (a === "global" && b === "files");
}

/** 경고만 한다. 터미널 층은 진입점이 달라 따로 센다. `files` 묶음은 파일 액션이 하나라도 낀 조합만 적는다(전역끼리는 `global` 이 적는다) */
export function conflicts(overrides: Overrides = {}): Conflict[] {
  const out: Conflict[] = [];
  for (const scope of ["terminal", "global", "files"] as const) {
    const byCombo = new Map<string, string[]>();
    for (const action of ACTIONS) {
      if (!sharesKeys(action.scope, scope)) continue;
      if (scope === "global" && action.scope !== "global") continue;
      const combo = effectiveCombo(action.id, overrides);
      if (!combo) continue;
      const list = byCombo.get(combo);
      if (list) list.push(action.id);
      else byCombo.set(combo, [action.id]);
    }
    for (const [combo, ids] of byCombo) {
      if (ids.length < 2) continue;
      if (scope === "files" && !ids.some((id) => BY_ID.get(id)?.scope === "files")) continue;
      out.push({ scope, combo, ids });
    }
  }
  return out;
}

export function conflictsWith(id: string, overrides: Overrides = {}): string[] {
  const def = BY_ID.get(id);
  if (!def) return [];
  const combo = effectiveCombo(id, overrides);
  if (!combo) return [];
  return ACTIONS.filter(
    (a) => a.id !== id && sharesKeys(a.scope, def.scope) && effectiveCombo(a.id, overrides) === combo,
  ).map((a) => a.id);
}

export function actionsByScope(scope: ActionScope): ActionDef[] {
  return ACTIONS.filter((a) => a.scope === scope);
}
