import type { ITheme } from "@xterm/xterm";
import type { Key } from "$lib/i18n/keys";

/**
 * 터미널 내부 팔레트 — xterm 캔버스 안에서만 쓴다. 앱 크롬(`theme.css`)과 자동 연동되지 않고 `aynx-dark` · `aynx-light` 만 짝을 맞춘다.
 * 프리셋은 ANSI 16색까지 전부 정의한다 — 일부만 두면 나머지가 xterm 기본값이 되어 배경만 바뀐 화면이 된다(라이트 프리셋에서 치명적).
 */
export interface TermPreset {
  /** 문구 키다(`t()` 가 렌더 때 푼다) — 지금은 이름이 두 언어에서 같아도 전부 키로 둔다 */
  labelKey: Key;
  theme: ITheme;
}

/** 모르는 키일 때 쓰는 프리셋 · `settings.toml` 의 `terminal.theme` 기본값 */
export const DEFAULT_TERM_PRESET = "aynx-dark";

/**
 * 키가 `settings.toml` 에 그대로 저장된다 — 바꾸지 않는다(바꾸면 사용자 파일이 기본값으로 떨어진다 · 옛 키는 [`LEGACY_PRESETS`]).
 * 설정 화면의 목록 순서는 이 객체가 아니라 [`termPresetGroups`] 가 정한다.
 */
export const TERM_PRESETS: Record<string, TermPreset> = {
  // Aynx 기본: graphite-dark 21색에서 배경 두 칸(background·cursorAccent)만 파랑 쪽으로 물들이고 커서는 기본 강조색(파랑).
  // CSS와 짝 검사로 지킨다(`app-color-themes.ts` 의 `defaultAppPalette`).
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

  // 다크 red·green·yellow는 Monochrome err·ok·warn과 같은 hex다. 라이트 ANSI는 크롬 의미색과 다르다.
  // 값은 무채색 원본 그대로이고, Monochrome Silver·Graphite 는 팔레트를 만들 때 배경만 옅게 덮는다.
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

  // ── 라이트 프리셋 ──
  // 라이트 팔레트의 bright 계열이 보통 계열보다 어두운 것은 오타가 아니다 — 흰 배경에서 "bright" 는 더 진해지는 쪽이다.
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

  // Solarized Light (Ethan Schoonover) — 공식 팔레트의 표준 ANSI 배치 그대로다.
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

  // Gruvbox Light (morhetz/gruvbox) — bright 는 "faded" 계열(더 진한 쪽)이다.
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
 * 옛 프리셋 키 → 지금 키. 사용자 `settings.toml` 의 프리셋 칸(`theme` · `before-theme` …)에 남은 옛 키가 기본값(다크)으로 떨어지지 않게
 * 읽을 때 접고 다음 저장 때 새 값으로 쓴다. 평평한 표라 한 번의 조회로 끝나야 한다.
 */
const LEGACY_PRESETS: Readonly<Record<string, string>> = {
  "luna-dark": "aynx-dark",
  "luna-light": "aynx-light",
  "cyber-2077-dark": "aynx-dark",
  "cyber-2077-light": "aynx-light",
  "cyber-neon-dark": "aynx-dark",
  "cyber-neon-light": "aynx-light",
  light: "aynx-light",
};

/** 표에 없는 값(빈 값 · 가상 키 · 모르는 키)은 그대로 통과한다 — 모르는 키를 버리는 일은 설정 정규화가 한다 */
export function canonicalPreset(key: string): string;
export function canonicalPreset(key: string | null | undefined): string | null | undefined;
export function canonicalPreset(key: string | null | undefined): string | null | undefined {
  if (!key) return key;
  return LEGACY_PRESETS[key] ?? key;
}

/**
 * 다크 프리셋 → 라이트 짝 — 앱 모드가 바뀌면 지금 프리셋을 갈아 끼운다(반대는 `DARK_OF`). 표에 없는 키는 건드리지 않는다 —
 * `dynamic` 은 교체가 아니라 재추출로 모드를 따른다(`dynamic-theme.svelte.ts`).
 * `tokyo-night` 의 짝이 `solarized-light` 인 것은 Tokyo Night Day 의 16색 ANSI 표가 확정된 형태로 없어 값을 지어내지 않으려는 것이다.
 */
export const LIGHT_OF: Readonly<Record<string, string>> = {
  "aynx-dark": "aynx-light",
  "graphite-dark": "graphite-light",
  "tokyo-night": "solarized-light",
  "gruvbox-dark": "gruvbox-light",
};

/**
 * 설정 › 터미널 테마 목록의 순서 — 짝 표에서 뽑는다. 모든 프리셋은 짝 표 안에 있어야 한다
 * (짝 없는 프리셋은 목록에서 빠지고 시험 "모든 프리셋이 정확히 한 번 나온다" 가 잡는다).
 */
export function termPresetGroups(): { dark: string[]; light: string[] } {
  const dark = Object.keys(LIGHT_OF).filter((k) => k in TERM_PRESETS);
  const light = dark.map((k) => LIGHT_OF[k]).filter((k) => k in TERM_PRESETS);
  return { dark, light };
}

/** [`LIGHT_OF`] 를 뒤집은 표 — 손으로 두 벌 적으면 언젠가 어긋난다 */
const DARK_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LIGHT_OF).map(([dark, light]) => [light, dark]),
);

/** 바꿀 필요가 없으면 `null` — 호출부는 설정을 건드리지 않는다("바꿀 것이 없다" 와 "기본값으로 되돌린다" 는 다른 일이다) */
export function pairedPreset(key: string | null | undefined, wantLight: boolean): string | null {
  if (!key) key = DEFAULT_TERM_PRESET;
  const next = wantLight ? LIGHT_OF[key] : DARK_OF[key];
  return next && next !== key ? next : null;
}

/** 기본 팔레트 — 설정을 못 읽었을 때의 폴백 */
export const termTheme: ITheme = TERM_PRESETS[DEFAULT_TERM_PRESET].theme;

/** 월페이퍼 팔레트의 가상 프리셋 키 — 값이 사진마다 달라 [`TERM_PRESETS`] 에 넣지 않고 [`termThemeOf`] 가 인자로 받는다 */
export const DYNAMIC_TERM_KEY = "dynamic";

/** 밝기를 고정한 가상 키 둘 — 저장하는 것은 키뿐이고 21색은 그릴 때 다시 낸다(`app-color-themes.ts` 의 `fixedDynamicTerms`) */
export const DYNAMIC_DARK_TERM_KEY = "dynamic-dark";
export const DYNAMIC_LIGHT_TERM_KEY = "dynamic-light";
/** 옛 상대 키 — 설정 정규화가 고정 키로 옮긴다. 그리는 쪽은 모른다 */
export const LEGACY_DYNAMIC_ALT_TERM_KEY = "dynamic-alt";

export function fixedDynamicTermKey(isDark: boolean): string {
  return isDark ? DYNAMIC_DARK_TERM_KEY : DYNAMIC_LIGHT_TERM_KEY;
}

export function isFixedDynamicTermKey(key: string | null | undefined): boolean {
  return key === DYNAMIC_DARK_TERM_KEY || key === DYNAMIC_LIGHT_TERM_KEY;
}

export function isDynamicTermKey(key: string | null | undefined): boolean {
  return key === DYNAMIC_TERM_KEY || isFixedDynamicTermKey(key);
}

export interface FixedDynamicTerms {
  dark?: ITheme;
  light?: ITheme;
}

/** 고정 밝기 키 둘의 이름 — 문구 키다 */
export const DYNAMIC_FIXED_TERM_LABEL: { dark: Key; light: Key } = {
  dark: "settings.preset.dynamicDark",
  light: "settings.preset.dynamicLight",
};

/**
 * 프리셋 키 → 팔레트. 모르는 키 · 빈 값은 조용히 기본 프리셋으로 떨어진다(백엔드는 목록을 모르고 문자열을 그대로 보관한다).
 * 사용자 테마를 푸는 곳은 이 함수 하나다 — 설정 화면 · 터미널 · 테마 프로필 카드 · 원격 창 모두 이것을 지난다.
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
    // 지워졌거나 아직 목록을 못 읽었으면 같은 모드의 Aynx 로 그린다 — 설정 파일은 고쳐 쓰지 않는다(파일을 되살리면 돌아온다)
    return user?.themes[userTermId(key)]?.theme ?? TERM_PRESETS[user?.light ? "aynx-light" : DEFAULT_TERM_PRESET].theme;
  }
  return (key ? TERM_PRESETS[key]?.theme : undefined) ?? termTheme;
}

// ── 사용자 터미널 테마 ──

/** `user:<id>` — 내장 키 · `dynamic` 은 `:` 가 없어 겹치지 않는다. [`LIGHT_OF`] 밖이라 앱 모드를 바꿔도 갈아 끼우지 않는다 */
export const USER_TERM_PREFIX = "user:";

/** id 모양 — Rust `term_themes::is_id` 와 같다(`[a-z0-9]` 로 시작하는 `[a-z0-9-]` 48자까지) */
const USER_TERM_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** 사용자 테마 키 모양인가 — 파일이 있는지는 보지 않는다(설정 정규화가 모양만 보고 보존한다) */
export function isUserTermKey(key: string | null | undefined): key is string {
  return !!key && key.startsWith(USER_TERM_PREFIX) && USER_TERM_ID.test(key.slice(USER_TERM_PREFIX.length));
}

export function userTermKey(id: string): string {
  return USER_TERM_PREFIX + id;
}

/** 모양을 본 뒤에 부른다 */
export function userTermId(key: string): string {
  return key.slice(USER_TERM_PREFIX.length);
}

/** Rust `TermThemeEntry` 의 이름과 21색 */
export interface UserTermTheme {
  id: string;
  name: string;
  theme: ITheme;
}

/** 이 모듈은 상태를 갖지 않는다 — 목록은 설정 상태(`settings.userTermThemes`)가 들고 부르는 쪽이 건넨다 */
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
export type TermColors = Record<TermColorKey, string>;

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
}

export function isLightBackground(background: string | undefined): boolean {
  return !!background && luminance(background) >= 0.4;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/** `applySettings` 가 `<html data-term-tone>` 에 단다 — `null` 이면 터미널 바탕 위 AI 권한 단계 색이 앱 테마 것 그대로다 */
export function termTone(background: string | undefined, foreground: string | undefined): "dark" | "light" | null {
  if (!background || !HEX6.test(background)) return null;
  if (!foreground || !HEX6.test(foreground)) return isLightBackground(background) ? "light" : "dark";
  return luminance(background) < luminance(foreground) ? "dark" : "light";
}

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
 * 터미널 투명도(100 미만)면 배경만 알파 0 으로 바꾼 사본 — 칠하는 층은 타일 배경판(`--term-bg-fill`) 하나다(캔버스까지 칠하면 알파가 곱해진다).
 * 값이 안 바뀌면 같은 참조를 돌려준다 — `options.theme` 재대입이 전체 리렌더를 부르므로 호출부가 참조로 "바뀐 게 없다" 를 판정한다.
 * hex 가 아닌 형식은 손대지 않는다 — 문자열 조립에 실패하면 배경이 통째로 검정이 된다.
 */
export function withTransparentCanvas(theme: ITheme, pct: number): ITheme {
  if (!(pct < 100)) return theme; // NaN 도 여기서 걸러진다 (부정형 비교)
  const bg = theme.background;
  if (!bg) return theme;
  const rgb = hex6(bg);
  if (!rgb) return theme;
  // xterm 이 `allowTransparency` 와 함께 읽어 글리프 뒤를 비운다
  return { ...theme, background: `${rgb}00` };
}

function hex6(css: string): string | null {
  const s = css.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s.slice(0, 7);
}

/**
 * 스크롤바 손잡이 색을 글자색에서 파생한다(이미 정해져 있으면 그대로). xterm 6 의 슬라이더는 `ITheme.scrollbarSlider*` 에서 색을 읽어
 * 앱의 `::-webkit-scrollbar` 규칙이 닿지 않는다.
 */
export function withScrollbarSlider(theme: ITheme): ITheme {
  // 개요 눈금자의 왼쪽 테두리는 지운다 — 기본값(글자색)이면 스크롤바가 사라진 뒤에도 타일 오른쪽에 세로선이 남는다
  const ruler = theme.overviewRulerBorder ? theme : { ...theme, overviewRulerBorder: "#00000000" };
  if (ruler.scrollbarSliderBackground) return ruler;
  const rgb = hex6(ruler.foreground ?? "");
  if (!rgb) return ruler;
  return {
    ...ruler,
    scrollbarSliderBackground: `${rgb}2e`,
    scrollbarSliderHoverBackground: `${rgb}4d`,
    scrollbarSliderActiveBackground: `${rgb}73`,
  };
}
