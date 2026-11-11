import type { ITheme } from "@xterm/xterm";
import type { Key } from "$lib/i18n/keys";

/**
 * 터미널 내부 팔레트 — 설계안 "디자인 커스텀" 3층 중 **②터미널 내부**.
 *
 * ①앱 크롬은 `theme.css` 의 CSS 토큰이고, 여기 있는 값들은 xterm 이 자기 캔버스 안에서만 쓰는
 * 별개의 팔레트다. 둘은 자동으로 연동되지 않는다 — `aynx-dark`·`aynx-light` 만 `theme.css` 와
 * 짝을 맞춰 뒀고, 나머지 프리셋은 원본 팔레트를 그대로 옮긴 것이라 앱 크롬과 색이 달라도
 * 정상이다.
 *
 * 프리셋은 **ANSI 16색까지 전부** 정의한다. 일부만 정의하면 나머지는 xterm 내장 기본값이 되어
 * 배경만 바뀌고 글자색은 그대로인 어중간한 화면이 나온다 (특히 라이트 프리셋에서 치명적이다).
 */
export interface TermPreset {
  /**
   * 설정 화면의 select 에 보이는 이름 — **문구 키**다 (`t()` 가 렌더 때 푼다).
   *
   * 지금은 이름이 전부 두 언어에서 같은 글자다(고유명 Tokyo Night · Gruvbox 와 `Aynx Dark` ·
   * `Aynx Light` — 2026-10-24 에 번역된 이름을 걷었다). 그래도 키는 남긴다 — 번역되는 이름이
   * 다시 생길 때 그 한 벌만 예외로 기억하지 않게 **전부** 키로 통일한다 (docs/log/2026-09-17-i18n.md).
   */
  labelKey: Key;
  theme: ITheme;
}

/** 설정에 아무것도 없거나 모르는 키일 때 쓰는 프리셋. `settings.toml` 의 `terminal.theme` 기본값 */
export const DEFAULT_TERM_PRESET = "aynx-dark";

/**
 * 내장 프리셋 목록. 키가 `settings.toml` 에 그대로 저장된다 — **키 이름은 바꾸지 않는다**
 * (바꾸면 사용자 파일이 모르는 키가 되어 기본값으로 떨어진다).
 *
 * 여러 번 어겼다: 제품명이 바뀔 때마다 프리셋 키도 따라갔다(마지막은 AYNX 개명 —
 * docs/log/2026-10-22-rename-aynx.md, 옛 제품명 별칭은 2차에 걷었다).
 * 그래서 옛 키를 지금 키로 옮기는 별칭 표를 하나 둔다
 * ([`LEGACY_PRESETS`] · [`canonicalPreset`]).
 *
 * 적는 순서는 다크 → 라이트이고, 라이트 쪽은 [`LIGHT_OF`] 짝 순서다. 설정 화면의 목록 순서는
 * 이 객체가 아니라 [`termPresetGroups`] 가 정한다(짝 표에서 순서를 뽑는다) — 여기 순서는 읽는 사람을 위한 것이다.
 */
export const TERM_PRESETS: Record<string, TermPreset> = {
  // Aynx 기본: graphite-dark 21색에서 배경 두 칸(background·cursorAccent)만 파랑 쪽으로 물들이고
  // 커서는 기본 강조색(파랑). CSS와 짝 검사로 지킨다(`app-color-themes.ts` 의 `defaultAppPalette`).
  // 2026-10-11 전에는 Luna 였고, 2026-10-13 까지는 배경도 graphite 그대로였다.
  "aynx-dark": {
    labelKey: "settings.preset.aynx-dark",
    theme: {
      background: "#0b111c",
      foreground: "#d8d8dc",
      cursor: "#8ab4ff",
      cursorAccent: "#0b111c",
      selectionBackground: "#2c2c31",
      black: "#1e1e22",
      red: "#e0655a",
      green: "#6fb37c",
      yellow: "#d9a441",
      blue: "#6d9ad1",
      magenta: "#b88bc7",
      cyan: "#5fb3b3",
      white: "#c8c8cd",
      brightBlack: "#5a5a63",
      brightRed: "#ef7f74",
      brightGreen: "#86c592",
      brightYellow: "#e6b95a",
      brightBlue: "#86aee0",
      brightMagenta: "#c9a2d6",
      brightCyan: "#7ac7c7",
      brightWhite: "#ececf0",
    },
  },

  // 옛 중성 그래파이트 팔레트. 다크 red·green·yellow는 Monochrome err·ok·warn과 같은 hex다.
  // 라이트 ANSI는 옛 값 그대로라 크롬 의미색과 다르다. 커서만 Monochrome White로 맞춘다.
  // 이 목록의 값은 무채색 원본 그대로이고, Monochrome Silver·Graphite 는 팔레트를 만들 때 배경만 옅게 덮는다.
  "graphite-dark": {
    labelKey: "settings.preset.graphite-dark",
    theme: {
      background: "#111113",
      foreground: "#d8d8dc",
      cursor: "#ececef",
      cursorAccent: "#111113",
      selectionBackground: "#2c2c31",
      black: "#1e1e22",
      red: "#e0655a",
      green: "#6fb37c",
      yellow: "#d9a441",
      blue: "#6d9ad1",
      magenta: "#b88bc7",
      cyan: "#5fb3b3",
      white: "#c8c8cd",
      brightBlack: "#5a5a63",
      brightRed: "#ef7f74",
      brightGreen: "#86c592",
      brightYellow: "#e6b95a",
      brightBlue: "#86aee0",
      brightMagenta: "#c9a2d6",
      brightCyan: "#7ac7c7",
      brightWhite: "#ececf0",
    },
  },

  // Tokyo Night (enkia/tokyo-night-vscode-theme) 의 터미널 팔레트.
  "tokyo-night": {
    labelKey: "settings.preset.tokyo-night",
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#283457",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },

  // Gruvbox Dark (morhetz/gruvbox) 의 터미널 팔레트.
  "gruvbox-dark": {
    labelKey: "settings.preset.gruvbox-dark",
    theme: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      cursorAccent: "#282828",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },

  // ── 라이트 프리셋 ────────────────────────────────────────────────────────
  //
  // 아래는 모두 **밝은 배경**용이다. 앱이 라이트 모드로 바뀌면 [`LIGHT_OF`] 표가 다크
  // 프리셋을 여기 짝으로 자동 교체한다 (docs/log/2026-09-04-light-theme.md).
  //
  // 라이트 팔레트에서 bright 계열이 보통 계열보다 **어두운** 것은 오타가 아니다: 어두운
  // 배경에서 "bright" 는 배경에서 더 멀어지는 = 밝아지는 방향이지만, 흰 배경에서 같은
  // 뜻은 **더 진해지는** 것이다. Solarized·Gruvbox 의 라이트 판이 모두 그렇게 되어 있다.
  //
  // Aynx 기본 라이트: graphite-light 21색에서 배경 두 칸만 파랑 쪽으로 물들이고 커서는 기본 강조색(파랑).
  "aynx-light": {
    labelKey: "settings.preset.aynx-light",
    theme: {
      background: "#fcfaff",
      foreground: "#2a2a2e",
      cursor: "#2f62c8",
      cursorAccent: "#fcfaff",
      selectionBackground: "#dcdcd8",
      black: "#2a2a2e",
      red: "#c9463b",
      green: "#3f8a4f",
      yellow: "#a8791a",
      blue: "#3a6fb0",
      magenta: "#8a5aa3",
      cyan: "#2f8f8f",
      white: "#e8e8e4",
      brightBlack: "#8a8a92",
      brightRed: "#df6255",
      brightGreen: "#57a466",
      brightYellow: "#c4922e",
      brightBlue: "#5b8ccc",
      brightMagenta: "#a577bd",
      brightCyan: "#48a9a9",
      brightWhite: "#f6f6f2",
    },
  },

  "graphite-light": {
    labelKey: "settings.preset.graphite-light",
    theme: {
      background: "#fbfbf9",
      foreground: "#2a2a2e",
      cursor: "#2a2a2e",
      cursorAccent: "#fbfbf9",
      selectionBackground: "#dcdcd8",
      black: "#2a2a2e",
      red: "#c9463b",
      green: "#3f8a4f",
      yellow: "#a8791a",
      blue: "#3a6fb0",
      magenta: "#8a5aa3",
      cyan: "#2f8f8f",
      white: "#e8e8e4",
      brightBlack: "#8a8a92",
      brightRed: "#df6255",
      brightGreen: "#57a466",
      brightYellow: "#c4922e",
      brightBlue: "#5b8ccc",
      brightMagenta: "#a577bd",
      brightCyan: "#48a9a9",
      brightWhite: "#f6f6f2",
    },
  },

  // Solarized Light (Ethan Schoonover) — 공식 팔레트의 표준 ANSI 배치 그대로다:
  // 배경 base3(#fdf6e3) · 글자 base00(#657b83), bright 쪽에 base01~base3 회색 계단이 들어간다.
  "solarized-light": {
    labelKey: "settings.preset.solarized-light",
    theme: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#657b83",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },

  // Gruvbox Light (morhetz/gruvbox) — 위 Gruvbox Dark 의 공식 라이트 판.
  // 배경 light0(#fbf1c7) · 글자 dark1(#3c3836), bright 는 "faded" 계열(더 진한 쪽)이다.
  "gruvbox-light": {
    labelKey: "settings.preset.gruvbox-light",
    theme: {
      background: "#fbf1c7",
      foreground: "#3c3836",
      cursor: "#3c3836",
      cursorAccent: "#fbf1c7",
      selectionBackground: "#ebdbb2",
      black: "#fbf1c7",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#7c6f64",
      brightBlack: "#928374",
      brightRed: "#9d0006",
      brightGreen: "#79740e",
      brightYellow: "#b57614",
      brightBlue: "#076678",
      brightMagenta: "#8f3f71",
      brightCyan: "#427b58",
      brightWhite: "#3c3836",
    },
  },
};

/**
 * **옛 프리셋 키 → 지금 키.** 걷은 프리셋이나 바뀐 키가 사용자 `settings.toml`(`theme` · `before-theme` 같은
 * 프리셋 칸)에 남아 있으면 "모르는 키 → 기본값(다크)" 으로 떨어진다 — 그래서 읽을 때 접고, 다음 저장 때 새 값으로 쓴다.
 *
 * 제품명이 바뀔 때의 별칭(설정 폴더 이전과 짝)도 여기 둔다 — 지난 개명의 별칭은 이전을 실기로 확인한 뒤
 * 걷었다(docs/log/2026-10-22-rename-aynx.md 의 2차). 별칭은 체인이 아니라 **평평한 표**라 한 번의 조회로 끝나야 한다.
 */
const LEGACY_PRESETS: Readonly<Record<string, string>> = {
  // Luna 프리셋은 2026-10-13 에 걷었다(앱 색 테마 Luna 도 2026-10-24 에 걷었다 — 옛 키는 기본으로 접는다).
  "luna-dark": "aynx-dark",
  "luna-light": "aynx-light",
  // Cyberpunk 2077 · Neon 터미널 프리셋은 2026-10-24 에 걷었다(앱 색 테마 쪽은 같은 날 먼저) — 모드만 지켜 기본으로 접는다.
  "cyber-2077-dark": "aynx-dark",
  "cyber-2077-light": "aynx-light",
  "cyber-neon-dark": "aynx-dark",
  "cyber-neon-light": "aynx-light",
  // 라이트 모드 전부터 있던 짝 없는 밝은 프리셋 `light`("라이트 (기본형)")는 2026-10-24 에 걷었다 — 밝은 쪽 기본으로 접는다.
  light: "aynx-light",
};

/**
 * 옛 제품명 시절의 프리셋 키를 지금 키로 옮긴다. 그 밖의 값은 **그대로 통과**한다 —
 * 빈 값도, 가상 키 [`DYNAMIC_TERM_KEY`] 도, 모르는 키도 여기서 판정하지 않는다
 * (모르는 키를 버리는 일은 설정 정규화가 따로 한다).
 */
export function canonicalPreset(key: string): string;
export function canonicalPreset(key: string | null | undefined): string | null | undefined;
export function canonicalPreset(key: string | null | undefined): string | null | undefined {
  if (!key) return key;
  return LEGACY_PRESETS[key] ?? key;
}

/**
 * 다크 프리셋 → 그 **라이트 짝**. 앱 모드가 라이트로 바뀌는 순간 지금 걸린 프리셋이 이 표의
 * 왼쪽에 있으면 오른쪽으로 갈아 끼운다 (다크로 돌아오면 반대로 — [`darkOf`]).
 *
 * 왜 자동으로 바꾸나: 프리셋은 **터미널 배경색**을 들고 있다. 크롬만 하얘지고 터미널이
 * `#111113` 로 남으면 밝은 창 한가운데 검은 구멍이 뚫린 화면이 된다 — 모드를 바꾼 사람이
 * 곧바로 설정을 한 번 더 열어야 한다면 그 모드는 반쪽이다.
 *
 * 표에 없는 키(월페이퍼에서 뽑은 `dynamic`, 손으로 적은 모르는 키)는 **건드리지 않는다**. 특히 `dynamic` 은 교체가 아니라 **재추출**로
 * 모드를 따라간다 (`dynamic-theme.svelte.ts`) — 사진은 그대로고 스킴만 라이트로 다시 푼다.
 *
 * `tokyo-night` 의 짝이 왜 `solarized-light` 인가: Tokyo Night 에도 공식 라이트 판
 * (Tokyo Night Day)이 있지만 16색 ANSI 표가 공개 저장소에 확정된 형태로 있지 않아,
 * **값을 지어내는 대신** 팔레트 전체가 검증된 Solarized Light 로 보냈다. 둘 다 채도를
 * 눌러 둔 "차분한 편집기" 계열이라 인상이 크게 튀지 않는다.
 */
export const LIGHT_OF: Readonly<Record<string, string>> = {
  "aynx-dark": "aynx-light",
  "graphite-dark": "graphite-light",
  "tokyo-night": "solarized-light",
  "gruvbox-dark": "gruvbox-light",
};

/**
 * **설정 › 터미널 테마 목록의 순서와 묶음** — 다크 묶음 → 라이트 묶음(2026-10-24).
 *
 * n번째 다크의 [`LIGHT_OF`] 짝이 n번째 라이트가 되게 **짝 표에서** 순서를 뽑는다 — 객체 순서와 짝 표를 따로 맞추면
 * 언젠가 어긋난다. 그래서 **모든 프리셋은 짝 표 안에 있어야 한다** — 짝 없는 프리셋(옛 `light`)은 2026-10-24 에 걷으며
 * 그 자리(배경 밝기로 묶음을 가르던 코드)도 걷었다. 짝 없는 프리셋을 다시 들이면 목록에서 빠지고 시험
 * ("모든 프리셋이 정확히 한 번 나온다")이 잡는다 — 그때 묶을 규칙을 다시 정한다.
 */
export function termPresetGroups(): { dark: string[]; light: string[] } {
  const dark = Object.keys(LIGHT_OF).filter((k) => k in TERM_PRESETS);
  const light = dark.map((k) => LIGHT_OF[k]).filter((k) => k in TERM_PRESETS);
  return { dark, light };
}

/** [`LIGHT_OF`] 를 뒤집은 표 (라이트 → 다크). 손으로 두 벌 적으면 언젠가 어긋난다 */
const DARK_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LIGHT_OF).map(([dark, light]) => [light, dark]),
);

/**
 * 모드가 바뀌었을 때 **갈아 끼울 프리셋 키**. 바꿀 필요가 없으면 `null`.
 *
 * `null` 을 돌려주는 경우가 셋이다 — 이미 그쪽 모드의 프리셋이거나, 짝이 없는 키이거나
 * (`dynamic`·모르는 키), 인자가 비었거나. 호출부는 `null` 이면 설정을 아예
 * 건드리지 않는다: "바꿀 것이 없다" 와 "기본값으로 되돌린다" 는 다른 일이다.
 */
export function pairedPreset(key: string | null | undefined, wantLight: boolean): string | null {
  if (!key) key = DEFAULT_TERM_PRESET;
  const next = wantLight ? LIGHT_OF[key] : DARK_OF[key];
  return next && next !== key ? next : null;
}

/**
 * 기본 팔레트. `Terminal.svelte` 가 설정을 못 읽었을 때의 폴백이자, 이 모듈의 옛 export 계약이다.
 * (설정이 있으면 `settings.termTheme` 이 프리셋을 골라 준다)
 */
export const termTheme: ITheme = TERM_PRESETS[DEFAULT_TERM_PRESET].theme;

/**
 * 월페이퍼에서 만든 팔레트를 가리키는 **가상 프리셋 키**
 * (docs/log/2026-09-04-dynamic-color.md).
 *
 * [`TERM_PRESETS`] 에 정적으로 넣지 **않는다** — 저 목록은 앱에 박힌 상수고 이쪽은 사진마다
 * 달라지는 값이라, 같은 자리에 두면 "기본 프리셋" 하나가 매번 다른 색이 되는 표가 된다.
 * 대신 [`termThemeOf`] 가 두 번째 인자로 받아 그때 끼워 넣는다.
 */
export const DYNAMIC_TERM_KEY = "dynamic";

/**
 * [`DYNAMIC_TERM_KEY`] 와 같은 색 테마를 **밝기를 고정해** 쓰는 가상 키 둘 — 라이트 앱 테마에서 터미널만 그 테마의 다크 색으로
 * 쓰는 자리. 앱 밝기를 바꿔도 고른 밝기 그대로다(2026-11-08 — 11-03 의 상대 키 `dynamic-alt`(반대 밝기)를 갈음).
 * 저장하는 것은 이 키뿐이고 21색은 그릴 때 앱 색 테마 · 사용자 색 · 월페이퍼 원천에서 다시 낸다
 * (`app-color-themes.ts` 의 `fixedDynamicTerms`).
 */
export const DYNAMIC_DARK_TERM_KEY = "dynamic-dark";
export const DYNAMIC_LIGHT_TERM_KEY = "dynamic-light";
/** 옛 상대 키(11-03 — 그때 맵의 반대 밝기) — 설정 정규화가 고정 키로 옮긴다. 그리는 쪽은 모른다. */
export const LEGACY_DYNAMIC_ALT_TERM_KEY = "dynamic-alt";

/** 그 밝기의 고정 키 — 앱이 색 테마를 새로 걸 때 고르는 값(그때 앱 밝기 그대로) */
export function fixedDynamicTermKey(isDark: boolean): string {
  return isDark ? DYNAMIC_DARK_TERM_KEY : DYNAMIC_LIGHT_TERM_KEY;
}

/** 고정 밝기 가상 키인가 */
export function isFixedDynamicTermKey(key: string | null | undefined): boolean {
  return key === DYNAMIC_DARK_TERM_KEY || key === DYNAMIC_LIGHT_TERM_KEY;
}

/** `dynamic` · `dynamic-dark` · `dynamic-light` — 색 테마에서 생성한 팔레트를 쓰는 가상 키인가 */
export function isDynamicTermKey(key: string | null | undefined): boolean {
  return key === DYNAMIC_TERM_KEY || isFixedDynamicTermKey(key);
}

/** 고정 밝기 팔레트 두 벌 — 못 푼 쪽은 `undefined` */
export interface FixedDynamicTerms {
  dark?: ITheme;
  light?: ITheme;
}

/**
 * 고정 밝기 키 둘의 이름 (프리셋 목록의 맨 아래 두 칸) — **문구 키**다
 * ([`TermPreset.labelKey`] 와 같은 규칙, docs/log/2026-09-17-i18n.md). 앱 밝기를 따르는 `dynamic` 칸은 목록에 없다(2026-11-08).
 */
export const DYNAMIC_FIXED_TERM_LABEL: { dark: Key; light: Key } = {
  dark: "settings.preset.dynamicDark",
  light: "settings.preset.dynamicLight",
};

/**
 * 프리셋 키 → 팔레트. 모르는 키·빈 값은 **조용히 기본 프리셋**으로 떨어진다.
 *
 * 백엔드는 프리셋 목록을 모르고 문자열을 그대로 보관한다. 그래서 옛 설정 파일이나 손으로 고친
 * 파일에 없는 키가 들어 있을 수 있고, 그건 오류가 아니라 "기본값으로 보여줄 상황"이다.
 *
 * `dynamic` 은 [`TERM_PRESETS`] 에 없는 **가상 키**다. 그 값을 아는 쪽은 설정 상태이므로
 * 호출부가 `dynamic` 인자로 건네고, 아직 뽑은 적이 없으면(=`undefined`) 다른 모르는 키와
 * 똑같이 기본 프리셋으로 떨어진다.
 *
 * 사용자 테마(`user:<id>` — [`isUserTermKey`])도 같은 길이다 — 목록을 아는 쪽(설정 상태)이 `user` 로 건넨다.
 * **사용자 테마를 푸는 곳은 이 함수 하나다**(설정 화면 · 터미널 · 테마 프로필 카드 · 원격 창 모두 이것을 지난다).
 * 고정 밝기 키(`dynamic-dark` · `dynamic-light`)도 같다 — 두 벌을 `fixed` 로 건네고, 못 풀었으면 기본 프리셋.
 */
export function termThemeOf(
  key: string | null | undefined,
  dynamic?: ITheme,
  user?: UserTermLookup,
  fixed?: FixedDynamicTerms,
): ITheme {
  if (key === DYNAMIC_TERM_KEY) return dynamic ?? termTheme;
  if (key === DYNAMIC_DARK_TERM_KEY) return fixed?.dark ?? termTheme;
  if (key === DYNAMIC_LIGHT_TERM_KEY) return fixed?.light ?? termTheme;
  if (isUserTermKey(key)) {
    // 사용자 테마는 폴더의 파일이 진실이다 — 지워졌거나 아직 목록을 못 읽었으면 **같은 모드의 Aynx** 로 그린다
    // (설정 파일은 고쳐 쓰지 않는다 — 파일을 되살리면 아무것도 안 해도 돌아온다).
    return user?.themes[userTermId(key)]?.theme ?? TERM_PRESETS[user?.light ? "aynx-light" : DEFAULT_TERM_PRESET].theme;
  }
  return (key ? TERM_PRESETS[key]?.theme : undefined) ?? termTheme;
}

// ---------------------------------------------------------------------------
// 사용자 터미널 테마 — 가져온 색 구성(`<설정 루트>/terminal-themes/<id>.json`, Rust `term_themes.rs`)
// ---------------------------------------------------------------------------

/**
 * 사용자 테마를 가리키는 프리셋 키의 머리 — `user:<id>`. 내장 키(`aynx-dark` …)와 `dynamic` 은 `:` 가 없어 겹치지 않는다.
 * 사용자 테마는 [`LIGHT_OF`] 밖이라 앱 모드를 바꿔도 갈아 끼우지 않는다(짝 지정은 아직 없다).
 */
export const USER_TERM_PREFIX = "user:";

/** id 모양 — Rust `term_themes::is_id` 와 같다(`[a-z0-9]` 로 시작하는 `[a-z0-9-]` 48자까지) */
const USER_TERM_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** 사용자 테마 키 모양인가 — 파일이 있는지는 보지 않는다(설정 정규화가 모양만 보고 보존한다) */
export function isUserTermKey(key: string | null | undefined): key is string {
  return !!key && key.startsWith(USER_TERM_PREFIX) && USER_TERM_ID.test(key.slice(USER_TERM_PREFIX.length));
}

/** id → 키 */
export function userTermKey(id: string): string {
  return USER_TERM_PREFIX + id;
}

/** 키 → id (모양을 본 뒤에 부른다) */
export function userTermId(key: string): string {
  return key.slice(USER_TERM_PREFIX.length);
}

/** 사용자 테마 한 벌 — Rust `TermThemeEntry` 의 이름과 21색을 xterm 팔레트로 */
export interface UserTermTheme {
  id: string;
  name: string;
  theme: ITheme;
}

/**
 * [`termThemeOf`] 가 사용자 키를 풀 때 보는 것 — id → 테마, 그리고 없을 때 떨어질 모드(라이트면 `aynx-light`).
 * 이 모듈은 상태를 갖지 않는다 — 목록은 설정 상태(`settings.userTermThemes`)가 들고 부르는 쪽이 건넨다.
 */
export interface UserTermLookup {
  themes: Readonly<Record<string, UserTermTheme>>;
  light?: boolean;
}

/** 저장하는 21칸 — xterm `ITheme` 의 이름 그대로(Rust `term_themes::Colors` 와 같은 칸) */
export const TERM_COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export type TermColorKey = (typeof TERM_COLOR_KEYS)[number];
/** 21칸 전부 `#rrggbb` 인 한 벌 */
export type TermColors = Record<TermColorKey, string>;

/** `#rrggbb` 의 상대 휘도(0~1, sRGB 근사). 모양이 틀리면 0 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
}

/** 밝은 배경의 팔레트인가 — 배경 휘도 0.4 이상(지운 사용자 테마를 같은 모드의 Aynx 로 돌릴 때 · 가져오기의 bright 채우기) */
export function isLightBackground(background: string | undefined): boolean {
  return !!background && luminance(background) >= 0.4;
}

/** 설정 화면의 미리보기 견본 — 배경·글자에 이어 대표 ANSI 6색 (없는 값은 건너뛴다) */
export function presetSwatches(theme: ITheme): string[] {
  return [
    theme.background,
    theme.foreground,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
  ].filter((c): c is string => typeof c === "string");
}

/**
 * 터미널 투명도가 켜져 있으면(100 미만) 팔레트의 **배경만 완전 투명**으로 바꾼 사본.
 * 100%(기본)면 원본을 **그대로** 돌려준다.
 *
 * ## 왜 `pct` 만큼이 아니라 0 인가 (한 겹만 칠한다)
 *
 * 터미널 칸에는 색을 칠할 수 있는 층이 둘이다 — 타일 배경판(`.pane-box` 의 `--term-bg-fill`,
 * 알파가 이미 들어 있다)과 xterm 캔버스. **둘 다** `pct` 만큼 칠하면 알파가 곱해져
 * (0.8 위에 0.8 = 0.96) 슬라이더를 내려도 뒤가 거의 안 비친다 — 실기에서 "내릴수록 검어진다"
 * 로 보이던 값이 이것이다. 그래서 칠하는 층을 **배경판 하나로** 정하고, 캔버스는 아무것도
 * 칠하지 않는다(알파 0). 두 층의 색이 갈릴 걱정도 없다: `--term-bg` 는 바로 이 팔레트의
 * `background` 를 옮겨 적은 값이다 (settings.svelte.ts 의 `applySettings`).
 *
 * 기본 배경이 아닌 칸(ANSI 배경색·선택·커서)은 이 함수가 손대지 않으므로 그대로 불투명하다.
 *
 * 왜 사본인가: `TERM_PRESETS` 의 팔레트는 모듈 상수라 그 자리에서 고치면 프리셋 자체가
 * 오염된다 (투명도를 되돌려도 원래 색이 안 돌아온다). 그래서 값이 바뀌는 경우에만 새 객체를
 * 만들고, 안 바뀌면 **같은 참조**를 돌려준다 — xterm 의 `options.theme` 재대입이 매번 전체
 * 리렌더를 부르므로, 참조가 그대로면 호출부가 그것으로 "바뀐 게 없다" 를 판정할 수 있다.
 *
 * `#rgb`·`#rrggbb`·`#rrggbbaa` 만 다룬다. xterm 은 `rgb()`·색 이름도 받지만 여기서
 * 문자열을 조립하다 실패하면 배경이 통째로 검정이 되므로, **모르는 형식은 손대지 않는다**
 * (그 팔레트는 불투명한 채로 남는다 — 조용한 최악보다 낫다). 지금 프리셋과 월페이퍼 추출은
 * 전부 hex 를 쓴다.
 */
export function withTransparentCanvas(theme: ITheme, pct: number): ITheme {
  if (!(pct < 100)) return theme; // NaN 도 여기서 걸러진다 (부정형 비교)
  const bg = theme.background;
  if (!bg) return theme;
  const rgb = hex6(bg);
  if (!rgb) return theme;
  // 색은 그대로 두고 알파만 0 — xterm 이 `allowTransparency` 와 함께 읽어 글리프 뒤를 비운다.
  return { ...theme, background: `${rgb}00` };
}

/** `#rgb`·`#rrggbb`·`#rrggbbaa` → `#rrggbb` (알파는 버린다). 그 밖의 형식이면 `null` */
function hex6(css: string): string | null {
  const s = css.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s.slice(0, 7);
}

/**
 * 스크롤바 손잡이 색을 팔레트에서 **파생시켜** 채운다 (이미 정해져 있으면 그대로 둔다).
 *
 * 터미널의 스크롤바는 브라우저 것이 아니다 — xterm 6 은 자기 DOM(`.xterm-scrollable-element
 * > .scrollbar > .slider`)을 그리고 그 배경색을 `ITheme` 의 `scrollbarSlider*` 세 칸에서
 * 읽는다 (`Viewport.ts` 가 그 세 줄짜리 `<style>` 을 화면에 심는다). 그래서 앱 크롬 쪽
 * `::-webkit-scrollbar` 규칙은 터미널에 **닿지 않고**, 색은 여기서 팔레트와 맞춰야 한다.
 *
 * 글자색에서 뽑는 이유는 프리셋 하나하나에 손으로 세 칸을 더 적지 않기 위해서다 —
 * 밝은 프리셋에서는 어두운 손잡이가, 어두운 테마에서는 밝은 손잡이가 저절로 나온다.
 * 월페이퍼에서 뽑은 동적 팔레트에도 같은 규칙이 그대로 먹는다.
 */
export function withScrollbarSlider(theme: ITheme): ITheme {
  // 개요 눈금자(`overviewRuler`)의 왼쪽 1px 테두리는 **지운다** — 터미널이 스크롤바 폭을
  // 좁히려고 눈금자를 켜 두는데(Terminal.svelte 의 `overviewRuler`), 기본값(글자색)이면
  // 스크롤바가 사라진 뒤에도 타일 오른쪽에 세로선 하나가 늘 남는다. 눈금자에는 검색
  // 매치 표시만 남긴다 (docs/log/2026-09-26-thin-terminal-scrollbar.md).
  const ruler = theme.overviewRulerBorder ? theme : { ...theme, overviewRulerBorder: "#00000000" };
  if (ruler.scrollbarSliderBackground) return ruler;
  const rgb = hex6(ruler.foreground ?? "");
  if (!rgb) return ruler;
  return {
    ...ruler,
    scrollbarSliderBackground: `${rgb}2e`, // ~18% — 쉬고 있을 때는 있는 듯 없는 듯
    scrollbarSliderHoverBackground: `${rgb}4d`, // ~30% — 손잡이 위 (두께는 그대로, 색으로만 반응)
    scrollbarSliderActiveBackground: `${rgb}73`, // ~45% — 잡고 끄는 동안
  };
}
