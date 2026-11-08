// 설정 화면 **터미널** 손잡이 — 프리셋 · 글꼴 · 커서 · 우클릭 · 붙여넣기 · OSC · 셸 통합 · 벨 · 기본 셸
// (`TerminalSection`).
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
 * 터미널 프리셋을 고른다. 기본 프리셋을 고르면 파일에 적지 않는다 (기본값 추종).
 *
 * `dynamic` 이 **아닌** 프리셋을 고르면 동적 테마 표시를 끈다 — 사용자가 팔레트를 직접
 * 골랐다는 뜻이므로, 다음 월페이퍼 교체가 그것을 덮으면 안 된다. (크롬 색은 그대로 둔다:
 * 이 select 의 이름은 "터미널 테마" 이고, 만진 적 없는 창 색까지 되돌리는 것은 월권이다.)
 * 고정 밝기(`dynamic-dark` · `dynamic-light`)도 같은 팔레트 계열이라 내리지 않는다 — 내리면 맵을 다시 세울 원천을 잃는다.
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

/** WebGL 가속 켬/끔. 켜는 것이 기본이므로 켤 때는 값을 지운다 (기본값 추종) */
export function setWebgl(on: boolean) {
  settings.current.terminal.webgl = on ? undefined : false;
}

/**
 * 커서 모양을 고른다 — 기본(`block`)이면 값을 지운다 (탭 모양과 같은 규칙).
 * **이미 열려 있는 탭에도 바로 적용된다** (`Terminal.svelte` 의 설정 `$effect`).
 */
export function setCursorStyle(key: string) {
  const valid = key in CURSOR_STYLES ? (key as CursorStyle) : DEFAULT_CURSOR_STYLE;
  settings.current.terminal.cursor_style = valid === DEFAULT_CURSOR_STYLE ? undefined : valid;
}

/**
 * 기본 셸을 고른다 — 설정 화면의 드롭다운 하나가 부른다. 고르는 항목은 **언제나 실제
 * 셸**이라 값이 비는 일은 없지만, `undefined`(또는 빈 문자열)는 "안 고름" 으로 읽어 값을
 * 지운다 (그러면 OS 초기값으로 돌아간다 — 기본값 추종, 프리셋·탭 모양과 같은 규칙).
 */
export function setDefaultShell(id: string | undefined) {
  settings.current.shell.default = text(id);
}

/** 합자 켬/끔. 끄는 것이 기본이므로 끌 때는 값을 지운다 (webgl 과 대칭) */
export function setLigatures(on: boolean) {
  settings.current.terminal.ligatures = on ? true : undefined;
}

/**
 * 터미널 우클릭 동작을 고른다 — 기본(`menu`)이면 값을 지운다 (탭 모양과 완전히 같은 규칙).
 * **이미 열려 있는 터미널에 바로 적용된다** (핸들러가 매번 이 값을 다시 읽는다).
 */
export function setRightClick(key: string) {
  const valid = key in RIGHT_CLICK_MODES ? (key as RightClickMode) : DEFAULT_RIGHT_CLICK;
  settings.current.terminal.right_click = valid === DEFAULT_RIGHT_CLICK ? undefined : valid;
}

/** 여러 줄 붙여넣기 확인. 켜는 것이 기본이므로 **끌 때만** 값을 남긴다 (합자와 반대) */
export function setConfirmMultilinePaste(on: boolean) {
  settings.current.terminal.confirm_multiline_paste = on ? undefined : false;
}

/**
 * 입력 중 스니펫 제안. 켜는 것이 기본이므로 **끌 때만** 값을 남긴다
 * (`setConfirmMultilinePaste` 와 같은 규칙).
 *
 * **이미 열려 있는 터미널에 바로 적용된다** (목록을 다시 셀 때마다 이 값을 읽는다).
 */
export function setInlineSnippets(on: boolean) {
  settings.current.terminal.inline_snippets = on ? undefined : false;
}

/**
 * 원격 클립보드 쓰기(OSC 52). 켜는 것이 기본이므로 **끌 때만** 값을 남긴다
 * (`setConfirmMultilinePaste` 와 같은 규칙).
 *
 * **이미 열려 있는 터미널에 바로 적용된다** (핸들러가 시퀀스마다 이 값을 읽는다).
 * 읽기 요청 거부는 이 손잡이 밖이다 — 끌 수 없는 불변이다.
 */
export function setOsc52Clipboard(on: boolean) {
  settings.current.terminal.osc52_clipboard = on ? undefined : false;
}

/**
 * 인라인 이미지(sixel · iTerm2). 켜는 것이 기본이므로 **끌 때만** 값을 남긴다.
 * **열린 타일에도 바로 적용된다** — 끄면 그 타일에 그려져 있던 이미지도 함께 사라진다.
 */
export function setInlineImages(on: boolean) {
  settings.current.terminal.inline_images = on ? undefined : false;
}

/**
 * 로컬 셸 통합 주입. 켜는 것이 기본이므로 **끌 때만** 값을 남긴다
 * (`setConfirmMultilinePaste` 와 같은 규칙).
 *
 * 바뀐 값은 **다음에 여는 셸부터** 듣는다 — 이미 떠 있는 셸의 argv 는 되돌릴 수 없다.
 */
export function setLocalShellIntegration(on: boolean) {
  settings.current.terminal.local_shell_integration = on ? undefined : false;
}

/**
 * 실행 시간 표식의 임계(초)를 정한다 — [`setNotifyAfterSecs`] 와 **글자 하나 빼고 같다**
 * (`0` 은 지우지 않고, 기본값과 같을 때만 지운다).
 *
 * **바로 적용된다**: 표식 판정이 블록이 닫히는 순간에 `settings.markAfterSecs` 를 읽는다.
 * 이미 그려진 표식은 그대로 남는다 (지난 화면을 소급해 고치지 않는다).
 */
export function setMarkAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_MARK_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.terminal.mark_after_secs =
    clamped === DEFAULT_MARK_AFTER_SECS ? undefined : clamped;
}

/**
 * 벨 모드를 고른다 — 기본(`visual`)이면 값을 지운다 (우클릭 동작과 완전히 같은 규칙).
 * **이미 열려 있는 터미널에 바로 적용된다** (벨이 울릴 때마다 이 값을 다시 읽는다).
 */
export function setBell(key: string) {
  const valid = key in BELL_MODES ? (key as BellMode) : DEFAULT_BELL;
  settings.current.terminal.bell = valid === DEFAULT_BELL ? undefined : valid;
}
