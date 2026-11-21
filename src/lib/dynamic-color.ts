import {
  Blend,
  type DynamicScheme,
  Hct,
  QuantizerCelebi,
  SchemeTonalSpot,
  Score,
  argbFromRgb,
  hexFromArgb,
  redFromArgb,
  greenFromArgb,
  blueFromArgb,
} from "@material/material-color-utilities";
import type { ITheme } from "@xterm/xterm";
import type { Key } from "$lib/i18n/keys";

/**
 * 월페이퍼 → MD3 팔레트의 순수 계산 — 모드는 읽지 않고 `isDark` 인자로 받는다. 이미지도 팔레트도 밖으로 나가지 않는다
 * (docs/log/2026-09-04-dynamic-color.md).
 */

// ---------------------------------------------------------------------------
// 앱 크롬 토큰
// ---------------------------------------------------------------------------

/** `settings.svelte.ts` 의 `APP_TOKENS` 와 같은 이름이어야 한다 */
export const CHROME_KEYS = ["accent", "bg", "bg_panel", "fg", "border", "err", "ok", "warn"] as const;

export type ChromeKey = (typeof CHROME_KEYS)[number];

export type ChromeTokens = Record<ChromeKey, string>;

// ---------------------------------------------------------------------------
// 터미널 팔레트
// ---------------------------------------------------------------------------

/** xterm `ITheme` 필드 이름 그대로 — 파일에 이 이름 그대로 적히므로 바꾸지 않는다(바꾸면 옛 파일이 반쯤 빈 팔레트가 된다) */
export const TERM_KEYS = [
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

export type TermKey = (typeof TERM_KEYS)[number];

/**
 * `[terminal.dynamic]` 안의 색이 아닌 칸 — 켜기 직전의 프리셋 키. 테이블과 수명이 같아(끄면 통째로 사라진다) 같은 곳에 산다.
 * 이름의 `-` 로 [`TERM_KEYS`] 와 겹치지 않는다.
 */
export const BEFORE_KEY = "before-theme";

/**
 * 그 팔레트를 만든 소스색 hex — 밝기를 바꿀 때 사진을 다시 디코딩하지 않고 동기로 다시 푼다(그 사이가 비면 검은 깜빡임이 찍힌다).
 * 사용자 색도 이 칸에 원천을 둔다.
 */
export const SOURCE_KEY = "source-color";

// ---------------------------------------------------------------------------
// 뽑아낸 팔레트 한 벌
// ---------------------------------------------------------------------------

export interface DynamicPalette {
  source: string;
  chrome: ChromeTokens;
  term: Record<TermKey, string>;
}

// ---------------------------------------------------------------------------
// 픽셀 → 소스색
// ---------------------------------------------------------------------------

/** 양자화 전에 줄여 그릴 최대 변(px) — 분포를 보는 알고리즘이라 결과는 사실상 같고, 원본 그대로면 초 단위가 된다 */
export const MAX_SAMPLE = 128;

/** MD3 레퍼런스(`themeFromImage`)와 같은 값 */
const QUANTIZE_COLORS = 128;

/** 문구 키 — 이 모듈은 사전을 부르지 않는다(vitest 가 `.svelte.ts` 를 들이지 못한다). 옮기는 쪽은 `extractDynamicTheme` */
export const NO_PIXELS_ERROR: Key = "app.dynamic.noPixels";

/** `Score.score` 는 후보가 없으면 자기 폴백(구글 블루)을 돌려주므로 비지 않는다 */
export function sourceColorFromPixels(pixels: number[]): number {
  if (pixels.length === 0) {
    throw new Error(NO_PIXELS_ERROR);
  }
  const counts = QuantizerCelebi.quantize(pixels, QUANTIZE_COLORS);
  return Score.score(counts)[0];
}

/** 완전히 불투명한 픽셀만 — 반투명을 섞으면 캔버스의 검정과 합성돼 투명 영역이 넓은 이미지의 팔레트가 어두워진다 */
export function pixelsFromImageData(image: { data: Uint8ClampedArray | number[] }): number[] {
  const d = image.data;
  const out: number[] = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    if (d[i + 3] !== 255) continue;
    out.push(argbFromRgb(d[i], d[i + 1], d[i + 2]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 소스색 → 팔레트 한 벌
// ---------------------------------------------------------------------------

/** ANSI 의 고정 hue(HCT) — ANSI 색은 의미라 월페이퍼 색을 그대로 쓰지 않는다. 소스색 쪽으로는 `Blend.harmonize` 가 최대 15° 만 기울인다 */
const ANSI_HUES: Record<"red" | "yellow" | "green" | "cyan" | "blue" | "magenta", number> = {
  red: 25,
  yellow: 90,
  green: 140,
  cyan: 200,
  blue: 260,
  magenta: 320,
};

const ANSI_TONE = 70;
/** 보통 색과 10 만 벌린다 — 더 벌리면 bright 가 흰색처럼 바래 구분이 사라진다 */
const ANSI_BRIGHT_TONE = 80;

/** 라이트 — 흰 배경에서 bright 는 더 진해지는 쪽(45 → 35). 더 벌리면 bright 가 검정에 붙는다 */
const ANSI_TONE_LIGHT = 45;
const ANSI_BRIGHT_TONE_LIGHT = 35;
/** 회색에 가까운 사진에서도 빨강과 초록이 구분돼야 한다 */
const ANSI_MIN_CHROMA = 40;

const TONE_BLACK = 12;
const TONE_BRIGHT_BLACK = 40;
const TONE_WHITE = 85;
const TONE_BRIGHT_WHITE = 95;

const TONE_SELECTION = 40;
/** 라이트에서는 밝은 판이어야 그 위의 검은 글자가 남는다 */
const TONE_SELECTION_LIGHT = 80;
const ALPHA_SELECTION = 0.4;

const OK_TERTIARY_HUE_MIN = 105;
const OK_TERTIARY_HUE_MAX = 170;

/** 따뜻한 원천에서 harmonize 가 초록을 노랑 쪽으로 끌어 `--warn` 과 헷갈려서 가둔다 */
const OK_HUE_MIN = 140;
const OK_HUE_MAX = 155;
/** 파랑 · 청록 원천에서 105° 쪽으로 밀려 연두로 보여서 위쪽을 자른다 */
const WARN_HUE_MIN = 75;
const WARN_HUE_MAX = 90;
/** 경계 판정의 여유 — 8비트 반올림으로 경계를 살짝 넘은 hue(155.x · 74.x 등)를 다시 만들지 않는다 */
const STATUS_HUE_SLACK = 0.5;

const TONE_STATUS = 78;
const TONE_STATUS_LIGHT = 42;

/** 두 모드 모두 창 < 타일 < 뜬 면 (`theme.css` 의 면 계단과 같다) */
const SURFACE_TONES_DARK = { window: 4, tile: 6, raised: 10 } as const;
const SURFACE_TONES_LIGHT = { window: 96, tile: 98, raised: 100 } as const;

/** 대비 보정 0 — 두 모드에서 달라지는 것은 톤뿐이다(의미 hue 고정 · harmonize 15° 는 같다) */
export function paletteFromSource(sourceArgb: number, isDark = true): DynamicPalette {
  const scheme = new SchemeTonalSpot(Hct.fromInt(sourceArgb), isDark, 0);
  const primary = scheme.primary;
  const ansiTone = isDark ? ANSI_TONE : ANSI_TONE_LIGHT;
  const ansiBrightTone = isDark ? ANSI_BRIGHT_TONE : ANSI_BRIGHT_TONE_LIGHT;
  // TonalSpot 은 primary chroma 를 36 으로 고정하므로 실제로는 늘 하한(40)이 이긴다
  const chroma = Math.max(ANSI_MIN_CHROMA, scheme.primaryPalette.chroma);
  const neutral = scheme.neutralPalette;

  const ansi = (hue: number, tone: number): string =>
    hexFromArgb(Blend.harmonize(Hct.from(hue, chroma, tone).toInt(), primary));

  // 타일과 거터(창)가 같은 색이면 타일링의 경계가 사라진다 — 세 톤은 서로 달라야 한다(docs/log/2026-09-28-wallpaper-tint-surface-order.md)
  const tones = isDark ? SURFACE_TONES_DARK : SURFACE_TONES_LIGHT;
  const termBg = hexFromArgb(neutral.tone(tones.tile));

  const term: Record<TermKey, string> = {
    background: termBg,
    foreground: hexFromArgb(scheme.onSurface),
    cursor: hexFromArgb(primary),
    // 커서 블록 안의 글자색 — 배경과 같게 두면 블록 위 글자가 언제나 읽힌다.
    cursorAccent: termBg,
    selectionBackground: withAlpha(
      scheme.primaryPalette.tone(isDark ? TONE_SELECTION : TONE_SELECTION_LIGHT),
      ALPHA_SELECTION,
    ),

    // 흑백 4칸의 톤은 두 모드가 같다 — ANSI black 은 배경이 아니라 "검정" 이라는 이름의 색이다
    black: hexFromArgb(neutral.tone(TONE_BLACK)),
    red: ansi(ANSI_HUES.red, ansiTone),
    green: ansi(ANSI_HUES.green, ansiTone),
    yellow: ansi(ANSI_HUES.yellow, ansiTone),
    blue: ansi(ANSI_HUES.blue, ansiTone),
    magenta: ansi(ANSI_HUES.magenta, ansiTone),
    cyan: ansi(ANSI_HUES.cyan, ansiTone),
    white: hexFromArgb(neutral.tone(TONE_WHITE)),

    brightBlack: hexFromArgb(neutral.tone(TONE_BRIGHT_BLACK)),
    brightRed: ansi(ANSI_HUES.red, ansiBrightTone),
    brightGreen: ansi(ANSI_HUES.green, ansiBrightTone),
    brightYellow: ansi(ANSI_HUES.yellow, ansiBrightTone),
    brightBlue: ansi(ANSI_HUES.blue, ansiBrightTone),
    brightMagenta: ansi(ANSI_HUES.magenta, ansiBrightTone),
    brightCyan: ansi(ANSI_HUES.cyan, ansiBrightTone),
    brightWhite: hexFromArgb(neutral.tone(TONE_BRIGHT_WHITE)),
  };

  const statusTone = isDark ? TONE_STATUS : TONE_STATUS_LIGHT;

  // 터미널 배경(`termBg`)은 면 계단 그대로다. 옛 중성 톤(창 4 · 뜬 면 10)은 옛 파일을 알아보는 [`legacySurfaces`] 에만 남는다.
  const chrome: ChromeTokens = {
    accent: hexFromArgb(primary),
    bg: hexFromArgb(scheme.surface),
    bg_panel: hexFromArgb(scheme.surfaceContainer),
    fg: hexFromArgb(scheme.onSurface),
    border: hexFromArgb(scheme.outlineVariant),
    err: hexFromArgb(scheme.error),
    ok: hexFromArgb(clampHue(unclampedOk(scheme, chroma, statusTone), OK_HUE_MIN, OK_HUE_MAX, chroma, statusTone)),
    warn: hexFromArgb(clampHue(unclampedWarn(scheme, chroma, statusTone), WARN_HUE_MIN, WARN_HUE_MAX, chroma, statusTone)),
  };

  return { source: hexFromArgb(sourceArgb), chrome, term };
}

function unclampedOk(scheme: SchemeTonalSpot, chroma: number, tone: number): number {
  const tertiaryHue = Hct.fromInt(scheme.tertiary).hue;
  const hue = tertiaryHue >= OK_TERTIARY_HUE_MIN && tertiaryHue <= OK_TERTIARY_HUE_MAX ? tertiaryHue : ANSI_HUES.green;
  return Blend.harmonize(Hct.from(hue, chroma, tone).toInt(), scheme.primary);
}

function unclampedWarn(scheme: SchemeTonalSpot, chroma: number, tone: number): number {
  return Blend.harmonize(Hct.from(ANSI_HUES.yellow, chroma, tone).toInt(), scheme.primary);
}

function clampHue(argb: number, min: number, max: number, chroma: number, tone: number): number {
  const hue = Hct.fromInt(argb).hue;
  if (hue < min - STATUS_HUE_SLACK) return Hct.from(min, chroma, tone).toInt();
  if (hue > max + STATUS_HUE_SLACK) return Hct.from(max, chroma, tone).toInt();
  return argb;
}

function statusBasis(sourceArgb: number, isDark: boolean): [SchemeTonalSpot, number, number] {
  const scheme = new SchemeTonalSpot(Hct.fromInt(sourceArgb), isDark, 0);
  return [scheme, Math.max(ANSI_MIN_CHROMA, scheme.primaryPalette.chroma), isDark ? TONE_STATUS : TONE_STATUS_LIGHT];
}

/** 옛 `ok`(hue 를 가두지 않은 값) — 옛 설정 파일의 여덟 칸을 알아보는 데만 쓴다(`app-color-themes.ts` 의 `upgradeLegacyAppColors`) */
export function legacyOk(sourceArgb: number, isDark: boolean): string {
  return hexFromArgb(unclampedOk(...statusBasis(sourceArgb, isDark)));
}

/** [`legacyOk`] 와 같이 옛 파일 알아보기 전용 */
export function legacyWarn(sourceArgb: number, isDark: boolean): string {
  return hexFromArgb(unclampedWarn(...statusBasis(sourceArgb, isDark)));
}

/** 옛 바탕 두 칸(중성 톤) — 옛 설정 파일 알아보기 전용(`upgradeLegacyAppColors`) */
export function legacySurfaces(sourceArgb: number, isDark: boolean): Pick<ChromeTokens, "bg" | "bg_panel"> {
  const neutral = new SchemeTonalSpot(Hct.fromInt(sourceArgb), isDark, 0).neutralPalette;
  const tones = isDark ? SURFACE_TONES_DARK : SURFACE_TONES_LIGHT;
  return { bg: hexFromArgb(neutral.tone(tones.window)), bg_panel: hexFromArgb(neutral.tone(tones.raised)) };
}

export function paletteFromPixels(pixels: number[], isDark = true): DynamicPalette {
  return paletteFromSource(sourceColorFromPixels(pixels), isDark);
}

export function paletteFromImageData(
  image: { data: Uint8ClampedArray | number[] },
  isDark = true,
): DynamicPalette {
  return paletteFromPixels(pixelsFromImageData(image), isDark);
}

export function sourceArgbFromHex(hex: string | null | undefined): number | null {
  const argb = argbFromHex6(hex);
  return argb === undefined ? null : argb >>> 0;
}

const sourcePalettes = new Map<string, DynamicPalette>();
const SOURCE_PALETTE_CACHE = 16;

export function cachedPaletteFromSource(sourceArgb: number, isDark: boolean): DynamicPalette {
  const key = `${sourceArgb >>> 0}:${isDark}`;
  let palette = sourcePalettes.get(key);
  if (!palette) {
    if (sourcePalettes.size >= SOURCE_PALETTE_CACHE) sourcePalettes.clear();
    palette = paletteFromSource(sourceArgb >>> 0, isDark);
    sourcePalettes.set(key, palette);
  }
  return palette;
}

export function chromeIsSourcePalette(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  sourceArgb: number,
  isDark: boolean,
): boolean {
  const palette = cachedPaletteFromSource(sourceArgb, isDark);
  return CHROME_KEYS.every((key) => chrome[key] === palette.chrome[key]);
}

/** 적어 둔 소스색을 믿기 전에 거치는 문 — 손으로 고친 파일 · 다른 사진의 소스로 엉뚱한 팔레트를 풀지 않게 */
export function chromeFromSource(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  sourceArgb: number,
): boolean {
  return chromeIsSourcePalette(chrome, sourceArgb, true) || chromeIsSourcePalette(chrome, sourceArgb, false);
}

// ---------------------------------------------------------------------------
// 저장된 값 → 화면
// ---------------------------------------------------------------------------

/** 모르는 키는 버린다 — 색이 아닌 칸이 같은 테이블에 살고, xterm 에는 [`TERM_KEYS`] 만 나가야 한다 */
export function dynamicTermTheme(map: Record<string, string> | null | undefined): ITheme | undefined {
  if (!map) return undefined;
  const theme: Record<string, string> = {};
  for (const key of TERM_KEYS) {
    const v = typeof map[key] === "string" ? map[key].trim() : "";
    if (v) theme[key] = v;
  }
  // 배경 · 글자가 없으면 만들다 만 것 — 절반만 걸면 배경만 바뀐 화면이 된다
  if (!theme.background || !theme.foreground) return undefined;
  return theme as ITheme;
}

/**
 * MD3 에 없는 경고 · 성공색의 옅은 판과 그 위 글자만 만든다 — 나머지 파생 색은 `theme.css` 의 MD3 역할 별칭이다.
 * 안 정한 칸은 건드리지 않아 `theme.css` 기본값이 이긴다.
 */
export function derivedChromeTokens(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  isDark = true,
): Record<string, string> {
  const out: Record<string, string> = {};
  const softPair = (hex: string | null | undefined, soft: string, on: string): void => {
    const hct = parseHct(hex);
    if (!hct) return;
    const chroma = Math.min(hct.chroma, SOFT_CHROMA_MAX);
    out[soft] = toneOf(hct, isDark ? SOFT_TONE_DARK : SOFT_TONE_LIGHT, chroma);
    out[on] = toneOf(hct, isDark ? ON_SOFT_TONE_DARK : ON_SOFT_TONE_LIGHT, chroma);
  };
  softPair(chrome.warn, "--warn-soft", "--on-warn-soft");
  softPair(chrome.ok, "--ok-soft", "--on-ok-soft");
  return out;
}

const SOFT_TONE_DARK = 30;
const SOFT_TONE_LIGHT = 90;
const ON_SOFT_TONE_DARK = 90;
const ON_SOFT_TONE_LIGHT = 10;
/** 판 · 글자의 채도 상한 — 의미색 그대로면 판이 형광으로 뜬다 */
const SOFT_CHROMA_MAX = 34;

/** 동적 테마를 끌 때 훑어 지우는 전부 — 만들어진 것만 지우면 이전 사진의 색이 인라인에 남는다 */
export const DERIVED_TOKENS = ["--warn-soft", "--on-warn-soft", "--ok-soft", "--on-ok-soft"] as const;

// ---------------------------------------------------------------------------
// MD3 역할 토큰
// ---------------------------------------------------------------------------

/** `--m3-*` → MCU 역할 이름. 기본 값은 `theme.css` 두 블록에 적혀 있고 시험이 짝을 지킨다 */
export const M3_ROLES = {
  "--m3-surface": "surface",
  "--m3-surface-container-lowest": "surfaceContainerLowest",
  "--m3-surface-container-low": "surfaceContainerLow",
  "--m3-surface-container": "surfaceContainer",
  "--m3-surface-container-high": "surfaceContainerHigh",
  "--m3-surface-container-highest": "surfaceContainerHighest",
  "--m3-on-surface": "onSurface",
  "--m3-on-surface-variant": "onSurfaceVariant",
  "--m3-outline": "outline",
  "--m3-outline-variant": "outlineVariant",
  "--m3-primary": "primary",
  "--m3-on-primary": "onPrimary",
  "--m3-primary-container": "primaryContainer",
  "--m3-on-primary-container": "onPrimaryContainer",
  "--m3-secondary-container": "secondaryContainer",
  "--m3-on-secondary-container": "onSecondaryContainer",
  "--m3-tertiary-container": "tertiaryContainer",
  "--m3-on-tertiary-container": "onTertiaryContainer",
  "--m3-secondary": "secondary",
  "--m3-on-secondary": "onSecondary",
  "--m3-tertiary": "tertiary",
  "--m3-on-tertiary": "onTertiary",
  "--m3-error": "error",
  "--m3-on-error": "onError",
  "--m3-error-container": "errorContainer",
  "--m3-on-error-container": "onErrorContainer",
  "--m3-inverse-surface": "inverseSurface",
  // 반대 밝기의 primary — 앱 테마와 밝기가 다른 터미널 바탕 위의 AI 권한 단계 색(`theme.css` 의 `--ai-term-lv*`)
  "--m3-inverse-primary": "inversePrimary",
} as const satisfies Record<string, keyof DynamicScheme>;

type M3RoleToken = keyof typeof M3_ROLES;

/**
 * 머리줄 종류 칩의 고정 hue — 테마 primary 쪽으로 harmonize 하고, 호버 칩 판 위 대비가 4.5 에 못 미치면 바탕에서 멀어지는 쪽으로 톤을 민다.
 * 무채색 테마는 harmonize 하지 않고 chroma 만 낮춘다.
 */
export const CHIP_HUES = {
  "--chip-folder": 83, // 금빛
  "--chip-branch": 301, // 보라
  "--chip-tmux": 182, // 청록
  "--chip-jump": 358, // 장미(경유)
  "--chip-forward": 51, // 산호(포워딩)
} as const;
export type ChipToken = keyof typeof CHIP_HUES;
export const CHIP_TOKENS = Object.keys(CHIP_HUES) as ChipToken[];
const CHIP_CHROMA = 40;
const CHIP_CHROMA_MONO = 16;
/** primary chroma 가 이보다 낮으면 무채색 테마로 본다 */
const MONO_PRIMARY_CHROMA = 8;
/** 대비를 재는 칩 판의 세기 — 호버(`--chip-tint-hover`, 평소 16% 보다 진해 대비가 더 낮다) */
const CHIP_TINT_WORST = 0.2;
const CHIP_TONE_DARK = 80;
const CHIP_TONE_LIGHT = 40;

/** sRGB 채널별 섞기 — CSS `color-mix(in srgb, top a, transparent)` 를 `under` 위에 얹은 결과 */
function overArgb(under: number, top: number, alpha: number): number {
  const ch = (shift: number) => Math.round(((under >> shift) & 255) * (1 - alpha) + ((top >> shift) & 255) * alpha);
  return argbFromRgb(ch(16), ch(8), ch(0));
}

export function chipTokens(scheme: DynamicScheme): Record<ChipToken, string> {
  const dark = scheme.isDark;
  const mono = scheme.primaryPalette.chroma < MONO_PRIMARY_CHROMA;
  const plates = [scheme.surfaceContainer, scheme.surfaceContainerHigh];
  const out = {} as Record<ChipToken, string>;
  for (const token of CHIP_TOKENS) {
    let tone = dark ? CHIP_TONE_DARK : CHIP_TONE_LIGHT;
    let hex = "";
    for (let i = 0; i <= 40; i++) {
      let argb = Hct.from(CHIP_HUES[token], mono ? CHIP_CHROMA_MONO : CHIP_CHROMA, clampTone(tone)).toInt();
      if (!mono) argb = Blend.harmonize(argb, scheme.primary);
      hex = hexFromArgb(argb);
      if (plates.every((plate) => contrastRatio(hex, hexFromArgb(overArgb(plate, argb, CHIP_TINT_WORST))) >= 4.5)) break;
      tone += dark ? 1 : -1;
    }
    out[token] = hex;
  }
  return out;
}

export type M3Token = M3RoleToken | ChipToken;

/** [`DERIVED_TOKENS`] 와 같은 규칙 — 만든 것만이 아니라 전부 지운다 */
export const M3_TOKENS = [...(Object.keys(M3_ROLES) as M3RoleToken[]), ...CHIP_TOKENS] as M3Token[];

export function m3RoleTokens(scheme: DynamicScheme): Record<M3Token, string> {
  const out = {} as Record<M3Token, string>;
  for (const token of Object.keys(M3_ROLES) as M3RoleToken[]) out[token] = hexFromArgb(scheme[M3_ROLES[token]] as number);
  Object.assign(out, chipTokens(scheme));
  return out;
}

// ---------------------------------------------------------------------------
// 끔 · 은은하게 · 전체 (docs/log/2026-09-25-wallpaper-tint.md)
// ---------------------------------------------------------------------------

/** `[app] dynamic` 의 값 — `subtle` 은 중성 크롬만 기울이고 강조색 · 의미색 · 본문 글자 · 터미널은 바꾸지 않는다 */
export const DYNAMIC_MODES = {
  off: "settings.option.dynamic_mode.off",
  subtle: "settings.option.dynamic_mode.subtle",
  full: "settings.option.dynamic_mode.full",
} as const satisfies Record<string, Key>;

export type DynamicMode = keyof typeof DYNAMIC_MODES;

/** 옛 불리언 `true` → `full`. `false` · 모르는 문자열은 "안 정함" 이다 */
export function normalizeDynamicMode(raw: unknown): DynamicMode | undefined {
  if (raw === true) return "full";
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return Object.hasOwn(DYNAMIC_MODES, v) ? (v as DynamicMode) : undefined;
}

/** 안 골랐으면 월페이퍼가 있을 때 `subtle` — `full` 은 강조색 · 터미널까지 사진마다 갈려 사람이 골라 켜야 한다 */
export function resolveDynamicMode(stored: DynamicMode | null | undefined, hasWallpaper: boolean): DynamicMode {
  return stored ?? (hasWallpaper ? "subtle" : "off");
}

/** 중성 크롬만 — `--accent` · `--err/--ok/--warn` · `--fg` · `--term-bg` 는 칠하지 않는다 */
export const TINT_TOKENS = [
  "--bg-base",
  "--bg-panel-base",
  "--border",
  "--bg-hover",
  "--bg-chip",
  "--fg-muted",
  "--fg-chip",
] as const;

export type TintToken = (typeof TINT_TOKENS)[number];

/** 그 `[app]` 칸을 사용자가 정해 두었으면 틴트는 비켜 선다 — 파생 토큰은 제 원천 칸을 따른다 */
export const TINT_OWNER: Record<TintToken, ChromeKey> = {
  "--bg-base": "bg",
  "--bg-panel-base": "bg_panel",
  "--border": "border",
  "--bg-hover": "bg",
  "--bg-chip": "bg",
  "--fg-muted": "fg",
  "--fg-chip": "fg",
};

/** `surface` 는 글자에서, `text` 는 바탕에서 멀어지는 쪽으로만 밝기가 움직인다(대비가 줄지 않게). `line` 은 묻지 않는다 */
type TintRole = "surface" | "line" | "text";

const TINT_ROLE: Record<TintToken, TintRole> = {
  "--bg-base": "surface",
  "--bg-panel-base": "surface",
  "--border": "line",
  "--bg-hover": "surface",
  "--bg-chip": "surface",
  "--fg-muted": "text",
  "--fg-chip": "text",
};

/**
 * 역할별 chroma 상한 — OKLCH 단위다. HCT 의 무채색 축은 sRGB 회색과 어긋나 chroma 1~2 에서는 그 차이가 틴트보다 커진다.
 */
const TINT_CHROMA_DARK: Record<TintRole, number> = { surface: 0.01, line: 0.015, text: 0.01 };
const TINT_CHROMA_LIGHT: Record<TintRole, number> = { surface: 0.005, line: 0.01, text: 0.01 };

/** 틴트 상한을 **다 쓰는** 소스 chroma(HCT). 이보다 흐린 사진은 그 비율만큼 더 옅게 기운다 */
const TINT_FULL_SOURCE_CHROMA = 32;

/** 대비를 지키려고 밝기(OKLab L)를 한 번에 옮기는 폭과 최대 횟수 — 8비트 반올림을 되돌리는 정도 */
const TINT_NUDGE = 0.002;
const TINT_NUDGE_STEPS = 12;

/**
 * 밝기(OKLab L)는 그대로 두고 색 성분만 놓는다 — 8비트 반올림이 대비를 줄이면 L 을 밀어 되돌리고, 끝내 못 맞추면 원래 색 그대로.
 * 누가 정한 색이 이미 걸린 자리는 부르는 쪽이 `base` 에서 뺀다([`TINT_OWNER`]).
 */
export function subtleTint(
  base: Partial<Record<TintToken, string>>,
  sourceArgb: number,
  isDark: boolean,
): Partial<Record<TintToken, string>> {
  const strength = Math.min(1, Hct.fromInt(sourceArgb).chroma / TINT_FULL_SOURCE_CHROMA);
  const [, sa, sb] = oklabFromArgb(sourceArgb);
  const sc = Math.hypot(sa, sb);
  // 소스가 회색이면 방향이 없다 — 칠하지 않는다
  const dir = sc > 1e-6 ? [sa / sc, sb / sc] : [0, 0];
  const caps = isDark ? TINT_CHROMA_DARK : TINT_CHROMA_LIGHT;
  const out: Partial<Record<TintToken, string>> = {};

  for (const name of TINT_TOKENS) {
    const argb = argbFromHex6(base[name]);
    if (argb === undefined) continue;
    const role = TINT_ROLE[name];
    const c = caps[role] * strength;
    const [l] = oklabFromArgb(argb);

    // +1 = 밝아져도 된다(어두워지면 안 된다), -1 = 그 반대, 0 = 묻지 않는다.
    const allowed = role === "line" ? 0 : (role === "surface") === isDark ? -1 : 1;
    const baseY = luminance(argb);

    let lightness = l;
    let tinted = argbFromOklab(lightness, dir[0] * c, dir[1] * c);
    for (let i = 0; i < TINT_NUDGE_STEPS && allowed !== 0; i++) {
      if (allowed * (luminance(tinted) - baseY) >= 0) break;
      lightness += allowed * TINT_NUDGE;
      tinted = argbFromOklab(lightness, dir[0] * c, dir[1] * c);
    }
    const ok = allowed === 0 || allowed * (luminance(tinted) - baseY) >= 0;
    out[name] = hexFromArgb(ok ? tinted : argb);
  }
  return out;
}

function linearOf(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function channelOf(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** ARGB → OKLab `[L, a, b]` (Björn Ottosson, 2020) */
export function oklabFromArgb(argb: number): [number, number, number] {
  const r = linearOf(redFromArgb(argb));
  const g = linearOf(greenFromArgb(argb));
  const b = linearOf(blueFromArgb(argb));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function argbFromOklab(L: number, a: number, b: number): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return argbFromRgb(
    channelOf(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channelOf(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channelOf(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

/** 흑백 · 무채색 사진이면 `null` — Score 의 폴백(구글 블루)을 받지 않는다(흑백 사진에 크롬이 파랗게 기울지 않게) */
export function tintSourceFromPixels(pixels: number[]): number | null {
  if (pixels.length === 0) return null;
  const counts = QuantizerCelebi.quantize(pixels, QUANTIZE_COLORS);
  const best = Score.score(counts, { fallbackColorARGB: NO_TINT_SOURCE })[0];
  return best === NO_TINT_SOURCE ? null : best;
}

/** [`tintSourceFromPixels`] 의 "없음" 표시 — 알파 0 이라 불투명 픽셀에서는 절대 안 나온다 */
const NO_TINT_SOURCE = 0x00000000;

/** WCAG 상대 휘도 (0~1) */
export function luminance(argb: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(redFromArgb(argb)) + 0.7152 * lin(greenFromArgb(argb)) + 0.0722 * lin(blueFromArgb(argb));
}

export function contrastRatio(a: string, b: string): number {
  const x = argbFromHex6(a);
  const y = argbFromHex6(b);
  if (x === undefined || y === undefined) return Number.NaN;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// 작은 도구들
// ---------------------------------------------------------------------------

function parseHct(hex: string | null | undefined): Hct | undefined {
  const argb = argbFromHex6(hex);
  return argb === undefined ? undefined : Hct.fromInt(argb);
}

/** `#rrggbb` 만 — 라이브러리의 `argbFromHex` 는 예외를 던지는데, 사람이 잘못 고친 값은 조용히 건너뛰어야 한다 */
function argbFromHex6(hex: string | null | undefined): number | undefined {
  if (typeof hex !== "string") return undefined;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  return 0xff000000 | parseInt(m[1], 16);
}

function toneOf(hct: Hct, tone: number, chroma = hct.chroma): string {
  return hexFromArgb(Hct.from(hct.hue, chroma, clampTone(tone)).toInt());
}

function clampTone(tone: number): number {
  return Math.min(100, Math.max(0, tone));
}

/** ARGB + 알파 → xterm 이 읽는 8자리 hex (`#rrggbbaa`) */
function withAlpha(argb: number, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hexFromArgb(argb)}${a.toString(16).padStart(2, "0")}`;
}


export function paletteSwatches(p: DynamicPalette): string[] {
  return [
    p.source,
    p.chrome.accent,
    p.chrome.bg,
    p.chrome.bg_panel,
    p.chrome.fg,
    p.term.red,
    p.term.green,
    p.term.yellow,
    p.term.blue,
    p.term.magenta,
    p.term.cyan,
  ];
}
