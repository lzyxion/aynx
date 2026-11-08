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
 * 월페이퍼 → MD3(Material You) 팔레트 — **순수 계산**만 하는 층
 * (docs/log/2026-09-04-dynamic-color.md).
 *
 * DOM 도 상태도 여기 없다: 픽셀 배열 하나를 받아 "앱 크롬 토큰 8개 + 터미널 21색" 을
 * 돌려주는 함수들뿐이다. 이미지를 캔버스에 그려 픽셀을 얻는 일과, 그 결과를 설정에
 * 써 넣는 일은 `dynamic-theme.svelte.ts` 가 한다.
 *
 * 계산은 전부 **브라우저 안**에서 끝난다 — 이미지도 팔레트도 밖으로 나가지 않는다
 * (`@material/material-color-utilities`, Google, Apache-2.0).
 *
 * ## 왜 색을 "뽑기만" 하지 않고 다시 만드나
 *
 * 사진에서 가장 흔한 색 몇 개를 그대로 쓰면 배경과 글자의 대비가 사진마다 달라진다.
 * MD3 의 방식은 뽑은 색에서 **hue·chroma 만 가져오고 밝기(tone)는 스킴이 정하는** 것이다 —
 * 그래서 어떤 사진을 깔아도 배경과 글자가 서로 반대편 끝에 선다. 이 모듈은 그 규칙을
 * 그대로 따르고, 터미널 ANSI 16색에도 같은 원리를 한 겹 더 얹는다(아래).
 *
 * ## 다크/라이트
 *
 * 스킴의 밝기는 **앱 모드**(`mode.svelte.ts`)를 따라간다 — [`paletteFromSource`] 의
 * `isDark` 인자다 (docs/log/2026-09-04-light-theme.md). 이 모듈이 순수하게 남으려고
 * 모드를 직접 읽지 않고 인자로 받는다. 두 모드에서 **달라지는 것은 톤뿐**이고, 의미 hue
 * 고정([`ANSI_HUES`])과 harmonize 15° 규칙은 한 글자도 다르지 않다.
 */

// ---------------------------------------------------------------------------
// 앱 크롬 토큰
// ---------------------------------------------------------------------------

/**
 * 동적 팔레트가 채우는 `[app]` 색 토큰 키 — `settings.svelte.ts` 의 `APP_TOKENS` 와
 * **같은 이름**이어야 한다 (거기서 CSS 변수 이름으로 번역된다).
 */
export const CHROME_KEYS = ["accent", "bg", "bg_panel", "fg", "border", "err", "ok", "warn"] as const;

export type ChromeKey = (typeof CHROME_KEYS)[number];

/** 크롬 토큰 8개의 hex 값 */
export type ChromeTokens = Record<ChromeKey, string>;

// ---------------------------------------------------------------------------
// 터미널 팔레트
// ---------------------------------------------------------------------------

/**
 * `[terminal.dynamic]` 테이블에 보관하는 키 목록 = xterm [`ITheme`] 의 필드 이름 그대로.
 *
 * 21칸이다: 화면 4칸(배경·글자·커서·커서 글자) + 선택 배경 1칸 + ANSI 16색.
 * **파일에 이 이름 그대로 적히므로 바꾸지 않는다** (바꾸면 옛 파일이 반쯤 빈 팔레트가 된다).
 */
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
 * `[terminal.dynamic]` 안의 **색이 아닌** 한 칸 — 동적 테마를 켜기 **직전에** 쓰던 프리셋 키.
 *
 * 끄면 그 프리셋으로 돌아가야 하는데, 그 값을 어딘가에 적어 두지 않으면 앱을 껐다 켠 뒤
 * 되돌릴 곳을 잃는다. 색 맵과 같은 테이블에 얹는 이유는 **수명이 정확히 같기** 때문이다 —
 * 동적 테마를 끄는 순간 이 테이블은 통째로 사라지고, 이 값도 같이 사라져야 한다.
 * 이름에 `-` 가 있어 [`TERM_KEYS`] 의 어떤 색 이름과도 겹치지 않는다.
 */
export const BEFORE_KEY = "before-theme";

/**
 * `[terminal.dynamic]` 안의 또 하나의 **색이 아닌** 칸 — 그 팔레트를 만든 **소스색** hex.
 *
 * 밝기를 바꿀 때 사진을 다시 디코딩하지 않고 같은 소스색에서 새 밝기의 팔레트를
 * **동기로** 다시 풀기 위해 적어 둔다 (`paletteFromImageData` 는 소스색 하나만 골라
 * `paletteFromSource` 에 넘기므로 결과가 비트 단위로 같다). 그 사이가 비면 data-theme 은
 * 이미 라이트인데 토큰은 아직 다크인 순간이 화면에 찍힌다 — 검은 깜빡임.
 * 사용자 색도 이 칸에 원천을 보관한다. full은 app.dynamic === "full"로 먼저 갈리고,
 * 사용자 색은 내장 테마가 아닌지와 chrome 8칸의 customPalette 일치로 판정한다.
 * [`BEFORE_KEY`] 와 수명이 같아 같은 테이블에 산다.
 */
export const SOURCE_KEY = "source-color";

// ---------------------------------------------------------------------------
// 뽑아낸 팔레트 한 벌
// ---------------------------------------------------------------------------

export interface DynamicPalette {
  /** 이미지에서 고른 **소스색** hex (미리보기에 한 칸으로 보여준다) */
  source: string;
  /** 앱 크롬 토큰 8개 */
  chrome: ChromeTokens;
  /** 터미널 21색 (`[terminal.dynamic]` 에 그대로 들어간다) */
  term: Record<TermKey, string>;
}

// ---------------------------------------------------------------------------
// 1단계 — 픽셀 → 소스색
// ---------------------------------------------------------------------------

/**
 * 양자화에 넘길 **최대 변 길이**(px). 이미지를 이 크기로 줄여 그린 뒤 픽셀을 읽는다.
 *
 * 4K 사진을 그대로 돌리면 800만 픽셀에 Celebi 를 먹이는 셈이라 초 단위가 된다. 128px 로
 * 줄이면 최대 16,384 픽셀이고 결과는 사실상 같다 — 색의 **분포**를 보는 알고리즘이라
 * 해상도가 아니라 비율이 중요하기 때문이다.
 */
export const MAX_SAMPLE = 128;

/** 양자화가 남기는 대표색 개수 — MD3 레퍼런스(`themeFromImage`)와 같은 값이다 */
const QUANTIZE_COLORS = 128;

/**
 * 읽을 픽셀이 하나도 없을 때 던지는 오류의 **문구 키**.
 *
 * 이 모듈은 순수하게 남아야 해서(vitest 가 `.svelte.ts` 를 들이지 못한다) 사전을 부르지
 * 않는다 — 옮기는 것은 받는 쪽(`dynamic-theme.svelte.ts` 의 `extractDynamicTheme`)이다.
 */
export const NO_PIXELS_ERROR: Key = "app.dynamic.noPixels";

/**
 * ARGB 픽셀 배열에서 대표색 하나를 고른다.
 *
 * `Score` 는 단순히 "가장 많은 색" 을 고르지 않는다 — 너무 흐릿하거나(chroma 가 낮은 회색)
 * 서로 비슷한 색을 걸러 **테마의 씨앗이 될 만한** 색을 고른다. 그래서 하늘이 절반인 사진에서
 * 회색빛 하늘 대신 붉은 노을이 뽑힌다.
 *
 * `Score.score` 는 후보가 하나도 없으면 자기 폴백(구글 블루)을 돌려주므로 절대 비지 않는다.
 */
export function sourceColorFromPixels(pixels: number[]): number {
  if (pixels.length === 0) {
    throw new Error(NO_PIXELS_ERROR);
  }
  const counts = QuantizerCelebi.quantize(pixels, QUANTIZE_COLORS);
  return Score.score(counts)[0];
}

/**
 * `ImageData` → ARGB 배열. **완전히 불투명한 픽셀만** 담는다.
 *
 * 반투명 픽셀을 그대로 섞으면 캔버스가 깔아 둔 검정과 합성된 값이 들어와, PNG 아이콘처럼
 * 투명한 영역이 넓은 이미지에서 팔레트가 통째로 어두워진다.
 */
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
// 2단계 — 소스색 → 팔레트 한 벌
// ---------------------------------------------------------------------------

/**
 * ANSI 색의 **고정 hue**(HCT). 소스색이 무엇이든 이 각도에서 출발한다.
 *
 * 여기가 "월페이퍼 색을 그대로 쓰지 않는" 가장 중요한 자리다. ANSI 색은 장식이 아니라
 * **의미**다 — `git status` 의 빨강은 "지워짐", `ls` 의 파랑은 "디렉터리", 빌드 로그의
 * 초록은 "통과" 다. 보라색 사진을 깔았다고 오류 메시지가 초록으로 뜨면 팔레트가 예쁜 것과
 * 무관하게 터미널이 **거짓말을 하게** 된다.
 *
 * 그래서 hue 는 고정하고, 소스색 쪽으로는 [`Blend.harmonize`] 가 최대 15° 만 기울인다 —
 * 빨강은 언제나 빨강이되 그 사진의 빨강이 된다 (matugen·Material You 와 같은 방식).
 */
const ANSI_HUES: Record<"red" | "yellow" | "green" | "cyan" | "blue" | "magenta", number> = {
  red: 25,
  yellow: 90,
  green: 140,
  cyan: 200,
  blue: 260,
  magenta: 320,
};

/** 보통 색의 톤 — 어두운 배경 위에서 읽히는 밝기 */
const ANSI_TONE = 70;
/** bright 색의 톤. 보통 색과 10 만 벌린다 — 더 벌리면 bright 가 흰색처럼 바래 구분이 사라진다 */
const ANSI_BRIGHT_TONE = 80;

/**
 * 라이트 스킴의 ANSI 톤 — 밝은 배경(톤 100 근처) 위에서 읽히려면 **어두워야** 한다.
 *
 * 다크와 방향이 대칭이라는 점이 중요하다: 다크에서 bright 가 보통보다 **밝은** 것은
 * "배경에서 더 멀어진다" 는 뜻이고, 흰 배경에서 같은 뜻은 **더 진해지는** 것이다.
 * 그래서 45 → 35 로 내려간다 (Solarized·Gruvbox 의 라이트 판이 모두 같은 방향이다).
 * 벌리는 폭을 10 으로 맞춘 것도 다크와 같다 — 더 벌리면 bright 가 검정에 붙어 버린다.
 */
const ANSI_TONE_LIGHT = 45;
const ANSI_BRIGHT_TONE_LIGHT = 35;
/**
 * ANSI 색의 최소 chroma. 소스색이 회색에 가까운 사진(흑백·안개)에서도 빨강과 초록이
 * 구분돼야 한다 — 순수 톤 차이만 남으면 컬러 로그가 통째로 회색이 된다.
 */
const ANSI_MIN_CHROMA = 40;

/** 터미널 흑백 4칸의 톤 (검정 → 밝은 흰색) */
const TONE_BLACK = 12;
const TONE_BRIGHT_BLACK = 40;
const TONE_WHITE = 85;
const TONE_BRIGHT_WHITE = 95;

/** 선택 영역 배경의 톤과 알파 — 글자를 덮지 않게 반투명으로 깐다 */
const TONE_SELECTION = 40;
/** 라이트에서는 반대로 **밝은** 판이어야 그 위의 검은 글자가 남는다 */
const TONE_SELECTION_LIGHT = 80;
const ALPHA_SELECTION = 0.4;

/** `--ok` 로 인정하는 초록 hue 범위. tertiary 가 이 안이면 그대로 쓴다 */
const GREEN_HUE_MIN = 105;
const GREEN_HUE_MAX = 170;

/** `--ok`·`--warn` 의 톤 — 어두운 크롬 위의 상태 표시라 bright ANSI 와 같은 밝기로 둔다 */
const TONE_STATUS = 78;
/** 라이트 크롬 위의 같은 표시 — 흰 패널에서 읽히려면 내려와야 한다 (본문 대비 4.5:1 근처) */
const TONE_STATUS_LIGHT = 42;

/**
 * 면 세 겹의 톤(중성 팔레트) — 창(거터·탭 바 뒤) · 타일(터미널 캔버스) · 뜬 면(패널·독·메뉴).
 * 두 모드 모두 **창이 가장 어둡고 뜬 면이 가장 밝다** (`theme.css` 의 면 계단과 같다).
 * 한 칸 간격(2·4 톤)은 MD3 surfaceContainer 계단 그대로다.
 */
const SURFACE_TONES_DARK = { window: 4, tile: 6, raised: 10 } as const;
const SURFACE_TONES_LIGHT = { window: 96, tile: 98, raised: 100 } as const;

/**
 * 소스색(ARGB) 하나에서 팔레트 한 벌을 만든다 — **대비 보정 0**.
 *
 * @param isDark 다크 스킴으로 풀 것인가. 앱 모드(`mode.svelte.ts`)를 그대로 받는다 —
 *   호출부가 넘기는 이유는 이 모듈이 **순수**하기 때문이다 (DOM·전역 상태를 안 본다).
 *
 * 라이트 스킴은 같은 사진에서 같은 hue 를 뽑고 **톤만 반대편**으로 간다: 배경이 톤 96~100,
 * 글자가 onSurface(≈10), ANSI 가 45/35 다. 의미 hue 고정 규칙([`ANSI_HUES`])과 harmonize
 * 15° 는 두 모드에서 완전히 같다 — 밝기가 뒤집혔다고 `git status` 의 빨강이 달라질 이유는 없다.
 */
export function paletteFromSource(sourceArgb: number, isDark = true): DynamicPalette {
  const scheme = new SchemeTonalSpot(Hct.fromInt(sourceArgb), isDark, 0);
  const primary = scheme.primary;
  const ansiTone = isDark ? ANSI_TONE : ANSI_TONE_LIGHT;
  const ansiBrightTone = isDark ? ANSI_BRIGHT_TONE : ANSI_BRIGHT_TONE_LIGHT;
  // ANSI 의 진하기 — 스킴의 primary chroma 를 기준으로 잡되 하한을 둔다. TonalSpot 은
  // primary chroma 를 36 으로 고정하므로 **실제로는 언제나 하한(40)이 이긴다**: 사진이
  // 바뀌어도 ANSI 의 진하기는 일정하고, 달라지는 것은 hue 가 소스 쪽으로 기운 만큼(≤15°)과
  // 회색 4칸의 색조다.
  const chroma = Math.max(ANSI_MIN_CHROMA, scheme.primaryPalette.chroma);
  const neutral = scheme.neutralPalette;

  /** 고정 hue → 소스색 쪽으로 최대 15° 기운 ANSI 한 칸 */
  const ansi = (hue: number, tone: number): string =>
    hexFromArgb(Blend.harmonize(Hct.from(hue, chroma, tone).toInt(), primary));

  // 면 계단 — `theme.css` 와 같은 순서: **창 < 타일 < 뜬 면**(다크는 밝아지는 쪽, 라이트는
  // 창이 가장 어둡고 뜬 면이 순백). 톤은 중성 팔레트에서 직접 고른다 — 다크 4 < 6 < 10,
  // 라이트 96 < 98 < 100 (docs/log/2026-09-28-wallpaper-tint-surface-order.md).
  // 예전에는 MD3 이름(surfaceContainerLowest·surface·surfaceContainerLow)을 그대로 써서
  // 다크가 타일(4) < 창(6), 라이트가 뜬 면(96) < 창(98) < 타일(100) 으로 **뒤집혀** 있었다
  // (2026-09-25 에 정적 테마만 창을 맨 아래로 내렸고 여기는 미뤘다 — 호버가 창 톤 +5 라 창을
  // 내리면 호버가 패널 아래로 가라앉았기 때문. 지금은 `derivedChromeTokens` 가 호버를 뜬 면에
  // 붙이므로 그 걸림이 없다). 타일과 거터(창)가 같은 색이면 타일링의 경계가 사라지므로
  // 세 톤은 서로 달라야 한다.
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

    // 흑백 4칸의 톤은 **두 모드가 같다**. ANSI black 은 "검정" 이라는 이름의 색이지 배경이
    // 아니고(라이트 팔레트에서도 검정으로 찍힌다), white/brightWhite 도 마찬가지로
    // 밝은 회색이다 — Solarized Light 가 white 를 base2(#eee8d5)로 두는 것과 같은 규칙이다.
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

  // `--ok` 는 tertiary 를 **먼저** 본다: MD3 의 tertiary 는 소스색과 어울리도록 이미 색상환에서
  // 떨어뜨려 고른 색이라, 그것이 마침 초록 계열이면 팔레트에 가장 자연스럽게 앉는다.
  // 초록이 아니면 의미(정상·성공)를 지키려고 초록 hue 로 고정하고 harmonize 만 건다.
  const tertiary = Hct.fromInt(scheme.tertiary);
  const okHue =
    tertiary.hue >= GREEN_HUE_MIN && tertiary.hue <= GREEN_HUE_MAX
      ? tertiary.hue
      : ANSI_HUES.green;

  const statusTone = isDark ? TONE_STATUS : TONE_STATUS_LIGHT;

  // 창 = MD3 surface · 뜬 면 = surfaceContainer (2026-10-18 — End-4 식 MD3 방향). 터미널 배경(위 `termBg`)은 그 전 면 계단
  // 그대로다(터미널 팔레트는 이번 범위 밖). 그 전의 중성 톤(창 4 · 뜬 면 10)은 옛 파일을 알아보는 [`legacySurfaces`] 에만 남는다.
  const chrome: ChromeTokens = {
    accent: hexFromArgb(primary),
    bg: hexFromArgb(scheme.surface),
    bg_panel: hexFromArgb(scheme.surfaceContainer),
    fg: hexFromArgb(scheme.onSurface),
    border: hexFromArgb(scheme.outlineVariant),
    err: hexFromArgb(scheme.error),
    ok: ansi(okHue, statusTone),
    warn: ansi(ANSI_HUES.yellow, statusTone),
  };

  return { source: hexFromArgb(sourceArgb), chrome, term };
}

/**
 * 2026-10-18 전 [`paletteFromSource`] 가 내던 바탕 두 칸(중성 팔레트 톤 — 다크 창 4 · 뜬 면 10, 라이트 96 · 100).
 * 옛 설정 파일의 여덟 칸이 어느 테마 · 원천에서 왔는지 알아보는 데만 쓴다(`app-color-themes.ts` 의 `upgradeLegacyAppColors`).
 */
export function legacySurfaces(sourceArgb: number, isDark: boolean): Pick<ChromeTokens, "bg" | "bg_panel"> {
  const neutral = new SchemeTonalSpot(Hct.fromInt(sourceArgb), isDark, 0).neutralPalette;
  const tones = isDark ? SURFACE_TONES_DARK : SURFACE_TONES_LIGHT;
  return { bg: hexFromArgb(neutral.tone(tones.window)), bg_panel: hexFromArgb(neutral.tone(tones.raised)) };
}

/** 픽셀 배열 → 팔레트 (소스색 고르기 + 스킴 생성) */
export function paletteFromPixels(pixels: number[], isDark = true): DynamicPalette {
  return paletteFromSource(sourceColorFromPixels(pixels), isDark);
}

/** `ImageData` → 팔레트. 화면 쪽에서 캔버스로 축소해 그린 결과를 그대로 넘긴다 */
export function paletteFromImageData(
  image: { data: Uint8ClampedArray | number[] },
  isDark = true,
): DynamicPalette {
  return paletteFromPixels(pixelsFromImageData(image), isDark);
}

/** `#rrggbb` → 부호 없는 ARGB. 못 알아볼 값이면 `null` (손으로 고친 파일) */
export function sourceArgbFromHex(hex: string | null | undefined): number | null {
  const argb = argbFromHex6(hex);
  return argb === undefined ? null : argb >>> 0;
}

/**
 * [`paletteFromSource`] 의 기억판 — 밝기 전환·검증이 같은 소스를 여러 번 푼다.
 * 소스색은 사진마다 하나라 몇 칸이면 충분하고, 넘치면 통째로 비운다.
 */
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

/** 크롬 여덟 칸이 이 소스색의 그 밝기 팔레트와 정확히 같은가 */
export function chromeIsSourcePalette(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  sourceArgb: number,
  isDark: boolean,
): boolean {
  const palette = cachedPaletteFromSource(sourceArgb, isDark);
  return CHROME_KEYS.every((key) => chrome[key] === palette.chrome[key]);
}

/**
 * 크롬 여덟 칸이 **이 소스색에서 나온 것인가**(밝기 둘 중 하나) — 적어 둔 소스색을 믿기 전에
 * 거치는 문. 손으로 고친 파일·다른 사진의 소스가 남은 경우 엉뚱한 팔레트를 풀지 않게 한다.
 */
export function chromeFromSource(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  sourceArgb: number,
): boolean {
  return chromeIsSourcePalette(chrome, sourceArgb, true) || chromeIsSourcePalette(chrome, sourceArgb, false);
}

// ---------------------------------------------------------------------------
// 3단계 — 저장된 값 → 화면
// ---------------------------------------------------------------------------

/**
 * `[terminal.dynamic]` 맵 → xterm 팔레트. 아직 만든 적이 없으면(또는 반쯤 빈 맵이면)
 * `undefined` 를 돌려주고, 호출부는 그때 기본 프리셋으로 떨어진다.
 *
 * **모르는 키는 버린다** — [`BEFORE_KEY`] 처럼 색이 아닌 칸이 같은 테이블에 살고,
 * 손으로 고친 파일에 아무 키나 들어와도 xterm 에는 [`TERM_KEYS`] 만 나가야 한다.
 */
export function dynamicTermTheme(map: Record<string, string> | null | undefined): ITheme | undefined {
  if (!map) return undefined;
  const theme: Record<string, string> = {};
  for (const key of TERM_KEYS) {
    const v = typeof map[key] === "string" ? map[key].trim() : "";
    if (v) theme[key] = v;
  }
  // 배경·글자가 없는 팔레트는 "만들다 만 것" 이다 — 절반만 걸면 배경만 바뀐 화면이 된다.
  if (!theme.background || !theme.foreground) return undefined;
  return theme as ITheme;
}

/**
 * 크롬 토큰 8개에서 **파생 토큰**을 만든다 (CSS 변수 이름 → 값).
 *
 * 2026-10-18 부터 흐린 글자 · 호버 · 칩 · 선택 줄 · 보조/제3색 · 폴더 · 오류 판 · 스크림은 **MD3 역할의 별칭**이다
 * (`theme.css` 원시 블록 — `--fg-muted: var(--m3-on-surface-variant)` …). 그 역할은 [`M3_ROLES`] 가 원천 색 하나에서 내고
 * `applySettings` 가 인라인으로 얹는다. MD3 에 없는 경고 · 성공색의 옅은 판(`--warn-soft` · `--ok-soft`)과 그 위 글자
 * (`--on-warn-soft` · `--on-ok-soft`)만 여기 남는다 — MD3 container 톤 규칙(판 다크 30 · 라이트 90 · 글자 90 · 10)으로
 * `errorContainer` · `onErrorContainer` 와 같은 자리에 선다.
 *
 * **정해진 칸만** 만든다 — 안 정한 칸은 건드리지 않아 `theme.css` 기본값이 그대로 이긴다.
 */
export function derivedChromeTokens(
  chrome: Partial<Record<ChromeKey, string | null | undefined>>,
  isDark = true,
): Record<string, string> {
  const out: Record<string, string> = {};
  // 경고 · 성공의 옅은 판(container)과 그 위 글자(onContainer) — MD3 errorContainer · onErrorContainer 와 같은 톤 규칙.
  // 작업안의 상태 알약(일부 성공 · 성공)이 실패(`--err-soft` + `--m3-on-error-container`)와 한 벌로 선다(2026-11-01 톤 면 안).
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

/** 옅은 판의 톤 — MD3 container 톤(errorContainer 와 같은 30 · 90) */
const SOFT_TONE_DARK = 30;
const SOFT_TONE_LIGHT = 90;
/** 그 위 글자의 톤 — MD3 onContainer 톤(onErrorContainer 와 같은 90 · 10) */
const ON_SOFT_TONE_DARK = 90;
const ON_SOFT_TONE_LIGHT = 10;
/** 판 · 글자의 채도 상한 — 의미색 그대로면 판이 형광으로 뜬다 */
const SOFT_CHROMA_MAX = 34;

/**
 * [`derivedChromeTokens`] 가 만들 수 있는 **모든** CSS 변수 이름.
 *
 * 동적 테마를 끌 때 이 목록을 훑어 지운다 — 만들어진 것만 지우면, 팔레트가 반쯤 비어
 * 이번에 안 만들어진 토큰이 인라인에 남아 이전 사진의 색으로 화면에 계속 걸린다.
 */
export const DERIVED_TOKENS = ["--warn-soft", "--on-warn-soft", "--ok-soft", "--on-ok-soft"] as const;

// ---------------------------------------------------------------------------
// MD3 역할 토큰 (2026-10-18 — End-4 식 MD3 방향)
// ---------------------------------------------------------------------------

/**
 * `--m3-*` CSS 변수 → MCU `DynamicScheme` 의 역할 이름. 크롬 여덟 칸과 따로 **원천 색 하나**에서 MCU 가 낸다
 * (`app-color-themes.ts` 의 `m3Scheme` — 계열마다 원천 · 팔레트를 고른다). 컨트롤 · 독 · 설정 카드처럼 MD3 모양으로 그린
 * 부품이 이 역할의 별칭(`theme.css` 의 `--control-*`)을 쓴다. 기본 값은 `theme.css` 두 블록에 적혀 있고 시험이 짝을 지킨다.
 */
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
} as const satisfies Record<string, keyof DynamicScheme>;

type M3RoleToken = keyof typeof M3_ROLES;

/**
 * 타일 머리줄의 **종류 칩** 색(2026-10-19 — MD3 custom color 식). 칩마다 hue 는 고정(아래 표 — 2026-10-11 손 고른 색의 HCT hue)이고
 * 테마의 primary 쪽으로 `Blend.harmonize`(최대 15° — ANSI 생성과 같은 규칙)해 한 벌로 보이게 한다. 톤은 MD3 글자 톤(다크 80 ·
 * 라이트 40)에서 시작해, 머리줄 판(뜬 면 surfaceContainer · 활성 surfaceContainerHigh) 위 **호버 칩 판**(그 색 20% — `--chip-tint-hover`)
 * 대비가 4.5 에 못 미치면 바탕에서 멀어지는 쪽으로 한 칸씩 민다. 판은 지금처럼 그 색을 옅게 섞는다(`--chip-tint` 16%) — MD3 container
 * 톤으로 채우면 머리줄에서 칩이 무겁다.
 * Monochrome 처럼 primary 가 무채색인 테마는 harmonize 하지 않고(회색 쪽 hue 로 돌 이유가 없다) chroma 만 낮춘다 — 종류를 가르는 뜻은 남긴다.
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

/** 스킴 하나 → 머리줄 종류 칩 다섯 */
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

/** [`applySettings`] 가 지울 때 훑는 목록 — [`DERIVED_TOKENS`] 와 같은 규칙(만든 것만이 아니라 전부). 역할 + 머리줄 종류 칩 */
export const M3_TOKENS = [...(Object.keys(M3_ROLES) as M3RoleToken[]), ...CHIP_TOKENS] as M3Token[];

/** 스킴 하나 → `--m3-*` 역할 hex 한 벌 + 머리줄 종류 칩(`--chip-*`) */
export function m3RoleTokens(scheme: DynamicScheme): Record<M3Token, string> {
  const out = {} as Record<M3Token, string>;
  for (const token of Object.keys(M3_ROLES) as M3RoleToken[]) out[token] = hexFromArgb(scheme[M3_ROLES[token]] as number);
  Object.assign(out, chipTokens(scheme));
  return out;
}

// ---------------------------------------------------------------------------
// 세 단계 — 끔 · 은은하게 · 전체 (docs/log/2026-09-25-wallpaper-tint.md)
// ---------------------------------------------------------------------------

/**
 * `[app] dynamic` 의 세 값 — 월페이퍼가 앱 색에 **얼마나** 들어오는가.
 *
 * - `off` — 테마 그대로.
 * - `subtle` — 중성 크롬(바탕·패널·선·흐린 글자)만 사진의 hue 쪽으로 **아주 조금** 기운다.
 *   강조색·의미색(err/ok/warn)·본문 글자·터미널은 한 칸도 안 바뀐다 ([`subtleTint`]).
 * - `full` — MD3 한 벌(강조·크롬·터미널)을 사진에서 다시 만든다 ([`paletteFromSource`]).
 *
 * 값은 **문구 키**로 든다 (다른 후보 표들과 같은 모양 — `optionEntries` 가 그대로 받는다).
 */
export const DYNAMIC_MODES = {
  off: "settings.option.dynamic_mode.off",
  subtle: "settings.option.dynamic_mode.subtle",
  full: "settings.option.dynamic_mode.full",
} as const satisfies Record<string, Key>;

export type DynamicMode = keyof typeof DYNAMIC_MODES;

/**
 * 파일·프로필에서 온 값 → 세 값 중 하나, 또는 "안 정함"(`undefined`).
 *
 * **옛 불리언을 여기서 옮긴다**: `true`(켜 둔 추출) → `full`. `false` 는 옛 코드가 적은 적이
 * 없는 값이지만 손으로 적었다면 "안 정함" 과 같게 본다 — 끈 것과 안 정한 것은 옛 화면에서
 * 구별되지 않았다. 모르는 문자열도 "안 정함" 이다 (다른 후보 칸과 같은 규칙).
 */
export function normalizeDynamicMode(raw: unknown): DynamicMode | undefined {
  if (raw === true) return "full";
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return Object.hasOwn(DYNAMIC_MODES, v) ? (v as DynamicMode) : undefined;
}

/**
 * 화면이 쓰는 값 — 사용자가 고르지 않았으면 **월페이퍼가 있을 때 `subtle`**, 없으면 `off`.
 *
 * 기본이 `subtle` 인 이유: 월페이퍼를 깔았다는 것 자체가 "창이 사진과 어울렸으면" 이라는
 * 뜻인데, 크롬이 차가운 회색으로 떠 있으면 사진 위에 딴 앱이 얹힌 것처럼 보인다. 그렇다고
 * `full` 을 기본으로 하면 강조색과 터미널 팔레트까지 사진마다 갈린다 — 그건 사용자가
 * 골라서 켜야 할 일이다. 고르는 순간 그 값이 파일에 남고, 그다음부터는 이 추정이 끼지 않는다.
 */
export function resolveDynamicMode(stored: DynamicMode | null | undefined, hasWallpaper: boolean): DynamicMode {
  return stored ?? (hasWallpaper ? "subtle" : "off");
}

/**
 * 은은하게가 칠하는 CSS 변수 — **중성 크롬만**. 이 목록에 없는 것은 절대 안 건드린다:
 * `--accent`(시그니처 강조색)·`--err/--ok/--warn`(의미색)·`--fg`(본문 대비)·`--term-bg`(터미널).
 */
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

/**
 * 각 칠할 자리를 **누가 정하는가** — 그 `[app]` 칸을 사용자가 정해 두었으면 틴트는 비켜 선다.
 *
 * 파생 토큰(`--bg-hover`·`--fg-muted`…)은 제 원천 칸을 따른다: 바탕을 손으로 고른 사람의
 * 마우스 오버 배경은 [`derivedChromeTokens`] 가 그 바탕에서 이미 만들었고, 거기에 사진의
 * 색을 또 얹으면 한 벌이 깨진다.
 */
export const TINT_OWNER: Record<TintToken, ChromeKey> = {
  "--bg-base": "bg",
  "--bg-panel-base": "bg_panel",
  "--border": "border",
  "--bg-hover": "bg",
  "--bg-chip": "bg",
  "--fg-muted": "fg",
  "--fg-chip": "fg",
};

/**
 * 역할 — 밝기가 **어느 쪽으로는 움직이면 안 되는가**를 정한다.
 * `surface` 는 글자에서 멀어지는 쪽으로만, `text` 는 바탕에서 멀어지는 쪽으로만 (둘 다
 * 대비가 줄지 않는 방향), `line` 은 구분선이라 방향을 묻지 않는다.
 */
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
 * 역할별 **chroma 상한** — HCT 가 아니라 **OKLCH** 단위다. "색" 이 아니라 "기운" 이어야 한다.
 *
 * **왜 여기서만 HCT 를 버렸나.** HCT(CAM16)의 무채색 축은 sRGB 의 회색과 정확히 겹치지 않는다
 * — chroma 30 짜리 강조색에서는 안 보이는 차이지만, chroma 1~2 를 다루는 이 함수에서는 그
 * 어긋남이 틴트보다 커진다. 실제로 hue 192(청록)·chroma 1.4·톤 96 을 HCT 로 풀면 `#f5f3f2`
 * — **따뜻한** 회색이 나왔다. OKLab 은 sRGB 회색이 정확히 a = b = 0 이라 "회색에서 이만큼 그
 * 쪽으로" 가 글자 그대로 성립한다.
 *
 * 값: 다크 바탕 0.010 은 (옛 바탕) `#141416` 을 주황 사진에서 `#181310` 근처로 옮기는 정도다. 바탕은
 * 넓은 면이라 같은 chroma 도 세게 보이므로 가장 낮게, 선은 1px 이라 조금 더 줘야 보인다.
 * 라이트는 밝은 톤에서 같은 chroma 가 훨씬 도드라져(0.01 이면 `#f4f4f2` 가 복숭앗빛으로,
 * 타일 머리줄이 분홍으로 읽힌다) 바탕을 절반으로 낮췄다.
 */
const TINT_CHROMA_DARK: Record<TintRole, number> = { surface: 0.01, line: 0.015, text: 0.01 };
const TINT_CHROMA_LIGHT: Record<TintRole, number> = { surface: 0.005, line: 0.01, text: 0.01 };

/** 틴트 상한을 **다 쓰는** 소스 chroma(HCT). 이보다 흐린 사진은 그 비율만큼 더 옅게 기운다 */
const TINT_FULL_SOURCE_CHROMA = 32;

/** 대비를 지키려고 밝기(OKLab L)를 한 번에 옮기는 폭과 최대 횟수 — 8비트 반올림을 되돌리는 정도 */
const TINT_NUDGE = 0.002;
const TINT_NUDGE_STEPS = 12;

/**
 * **은은하게** — 중성 크롬을 사진의 hue 쪽으로 아주 조금 기울인다 (순수).
 *
 * 각 색을 OKLab 으로 옮겨 **밝기(L)는 그대로 두고**, 색 성분(a, b)을 소스색의 hue 방향으로
 * 역할별 상한 × 소스의 선명도(0~1) 만큼 놓는다 (원래의 아주 옅은 기운 — 테마 회색의 살짝
 * 따뜻한 쪽 — 은 사진의 기운으로 **바뀐다**). L 이 곧 밝기라 대비는 원래 거의 그대로다 —
 * 남는 것은 8비트로 접을 때의 반올림인데, 그 몇 분의 일 단위가 **대비를 줄이는 쪽**으로
 * 떨어지면 L 을 조금씩 밀어 되돌린다 (`surface` 는 글자에서 멀어지게, `text` 는 바탕에서
 * 멀어지게). 그래서 본문·흐린 글자와 바탕 사이 대비는 **원래 값 이상**이 보장된다.
 * 끝내 못 맞추면(순백 패널처럼 더 밝아질 자리가 없으면) 그 자리는 원래 색 그대로 둔다.
 *
 * @param base 칠할 자리 → **지금 그 자리의 색**(`#rrggbb`). 못 알아볼 값·없는 자리는 건너뛴다.
 *   누가 정한 색이 이미 걸린 자리는 부르는 쪽이 빼고 넘긴다 ([`TINT_OWNER`]).
 * @param sourceArgb 사진의 소스색 ([`tintSourceFromPixels`]).
 * @param isDark 앱 모드 — 대비를 지키는 방향이 모드마다 반대다.
 */
export function subtleTint(
  base: Partial<Record<TintToken, string>>,
  sourceArgb: number,
  isDark: boolean,
): Partial<Record<TintToken, string>> {
  const strength = Math.min(1, Hct.fromInt(sourceArgb).chroma / TINT_FULL_SOURCE_CHROMA);
  const [, sa, sb] = oklabFromArgb(sourceArgb);
  const sc = Math.hypot(sa, sb);
  // 소스가 회색이면 방향이 없다 — 칠하지 않는다 (`tintSourceFromPixels` 가 이미 거르지만 순수 함수로서도).
  const dir = sc > 1e-6 ? [sa / sc, sb / sc] : [0, 0];
  const caps = isDark ? TINT_CHROMA_DARK : TINT_CHROMA_LIGHT;
  const out: Partial<Record<TintToken, string>> = {};

  for (const name of TINT_TOKENS) {
    const argb = argbFromHex6(base[name]);
    if (argb === undefined) continue;
    const role = TINT_ROLE[name];
    const c = caps[role] * strength;
    const [l] = oklabFromArgb(argb);

    // 대비가 줄지 않는 방향: 다크의 바탕은 어두워지는 쪽, 흐린 글자는 밝아지는 쪽 (라이트는 반대).
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

/** sRGB 8비트 채널 → 선형 (0~1) */
function linearOf(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 선형 (0~1) → sRGB 8비트 채널 (범위 밖은 자른다) */
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

/** OKLab → ARGB (sRGB 밖이면 채널을 자른다 — 여기서 다루는 chroma 는 그럴 일이 거의 없다) */
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

/**
 * 은은하게가 쓸 소스색 — **흑백·무채색 사진이면 `null`**.
 *
 * [`sourceColorFromPixels`] 와 같은 고르기(Celebi + Score)지만 한 가지가 다르다: 쓸 만한 색이
 * 없을 때 Score 가 내놓는 폴백(구글 블루)을 받지 않는다. 전체 모드는 어차피 한 벌을 만들어야
 * 하니 폴백이라도 있어야 하지만, 은은하게는 "사진의 기운" 이 없으면 **아무것도 안 하는** 것이
 * 맞다 — 흑백 사진을 깔았는데 크롬이 파랗게 기우는 것이 가장 이상하다.
 * 폴백 자리에 불투명 픽셀이 절대 될 수 없는 값(알파 0)을 넣어 그것을 가려낸다.
 */
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

/** WCAG 대비율 — `#rrggbb` 두 개 (못 읽으면 `NaN`) */
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

/** `#rrggbb` → HCT. 못 알아볼 값이면 `undefined` (손으로 고친 파일이 여기까지 올 수 있다) */
function parseHct(hex: string | null | undefined): Hct | undefined {
  const argb = argbFromHex6(hex);
  return argb === undefined ? undefined : Hct.fromInt(argb);
}

/**
 * `#rrggbb` 만 받는다. 라이브러리의 `argbFromHex` 는 3·6·8자리를 받지만 예외를 던지고,
 * 여기 오는 값은 우리가 쓴 6자리이거나 사람이 잘못 고친 값 둘 중 하나다 — 후자는
 * 화면을 깨뜨리는 대신 조용히 건너뛰는 편이 맞다 (색 토큰의 기존 규칙).
 */
function argbFromHex6(hex: string | null | undefined): number | undefined {
  if (typeof hex !== "string") return undefined;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  return 0xff000000 | parseInt(m[1], 16);
}

/** 같은 hue 의 다른 톤 한 칸 (chroma 를 안 주면 원래 값 그대로) */
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


/** 미리보기 견본 — 소스색 · 크롬 4칸 · ANSI 6칸 (설정 화면의 색 칩 줄) */
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
