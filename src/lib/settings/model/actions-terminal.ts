import { DEFAULT_TERM_PRESET, isDynamicTermKey } from "$lib/theme";
import { text } from "$lib/settings-codec";
import {
  BELL_MODES,
  CURSOR_STYLES,
  DEFAULT_BELL,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_MARK_AFTER_SECS,
  DEFAULT_RIGHT_CLICK,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  NOTIFY_AFTER_MAX_SECS,
  RIGHT_CLICK_MODES,
  type BellMode,
  type CursorStyle,
  type RightClickMode,
} from "./options";
import { applySettings, settings } from "./store.svelte.js";

/**
 * `dynamic` 이 아닌 프리셋을 고르면 동적 테마(full)를 내린다 — 다음 월페이퍼 교체가 직접 고른 팔레트를 덮으면 안 된다.
 * 크롬 색은 그대로 둔다(만진 적 없는 창 색까지 되돌리지 않는다). 고정 밝기 키는 내리지 않는다 — 맵을 다시 세울 원천을 잃는다.
 */
export function setTermPreset(key: string) {
  settings.current.terminal.theme = key === DEFAULT_TERM_PRESET ? undefined : key;
  // 은은하게는 터미널을 안 건드리므로 내리지 않는다 — 전체일 때만 `off` 로.
  if (!isDynamicTermKey(key) && settings.current.app.dynamic === "full") {
    settings.current.app.dynamic = "off";
  }
  applySettings(); // --term-bg 가 프리셋을 따라간다
}

export function setTermFontFamily(value: string) {
  settings.current.terminal.font_family = text(value);
}

/** 범위를 벗어난 값은 "안 정함" 으로 둔다 — 입력 중간 상태(빈 칸)를 오류로 만들지 않는다 */
export function setTermFontSize(value: number | null | undefined) {
  const size = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
  settings.current.terminal.font_size =
    size !== undefined && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX ? size : undefined;
}

export function setWebgl(on: boolean) {
  settings.current.terminal.webgl = on ? undefined : false;
}

export function setCursorStyle(key: string) {
  const valid = key in CURSOR_STYLES ? (key as CursorStyle) : DEFAULT_CURSOR_STYLE;
  settings.current.terminal.cursor_style = valid === DEFAULT_CURSOR_STYLE ? undefined : valid;
}

export function setDefaultShell(id: string | undefined) {
  settings.current.shell.default = text(id);
}

export function setLigatures(on: boolean) {
  settings.current.terminal.ligatures = on ? true : undefined;
}

export function setRightClick(key: string) {
  const valid = key in RIGHT_CLICK_MODES ? (key as RightClickMode) : DEFAULT_RIGHT_CLICK;
  settings.current.terminal.right_click = valid === DEFAULT_RIGHT_CLICK ? undefined : valid;
}

export function setConfirmMultilinePaste(on: boolean) {
  settings.current.terminal.confirm_multiline_paste = on ? undefined : false;
}

export function setInlineSnippets(on: boolean) {
  settings.current.terminal.inline_snippets = on ? undefined : false;
}

/** OSC 52 쓰기만 이 손잡이다 — 읽기 요청 거부는 끌 수 없는 불변이다 */
export function setOsc52Clipboard(on: boolean) {
  settings.current.terminal.osc52_clipboard = on ? undefined : false;
}

export function setInlineImages(on: boolean) {
  settings.current.terminal.inline_images = on ? undefined : false;
}

/** 다음에 여는 셸부터 듣는다 — 이미 떠 있는 셸의 argv 는 되돌릴 수 없다 */
export function setLocalShellIntegration(on: boolean) {
  settings.current.terminal.local_shell_integration = on ? undefined : false;
}

/** `0` 은 지우지 않고 기본값과 같을 때만 지운다(`setNotifyAfterSecs` 와 같은 규칙) */
export function setMarkAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_MARK_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.terminal.mark_after_secs =
    clamped === DEFAULT_MARK_AFTER_SECS ? undefined : clamped;
}

export function setBell(key: string) {
  const valid = key in BELL_MODES ? (key as BellMode) : DEFAULT_BELL;
  settings.current.terminal.bell = valid === DEFAULT_BELL ? undefined : valid;
}
