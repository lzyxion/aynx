import {
  argbFromHex, DynamicScheme, Hct, hexFromArgb, SchemeTonalSpot, TonalPalette, Variant,
} from "@material/material-color-utilities";
import {
  CHROME_KEYS, SOURCE_KEY, cachedPaletteFromSource, chromeFromSource, contrastRatio, dynamicTermTheme, legacySurfaces,
  m3RoleTokens, paletteFromSource, sourceArgbFromHex, type ChromeTokens, type DynamicPalette, type M3Token,
} from "$lib/dynamic-color";
import type { Key } from "$lib/i18n/keys";
import type { AppTheme, AppSettings } from "$lib/settings/model/schema";
import type { ITheme } from "@xterm/xterm";
import { TERM_PRESETS, isLightBackground, type FixedDynamicTerms } from "$lib/theme";

/**
 * 계열 안의 순서가 칩의 순환 순서다. Classic의 id·원천색은 옛 저장값 그대로다.
 * `aynx`(기본)는 원천색이 없다 — 중성 그래파이트 크롬([`NEUTRAL_CHROME`])을 파랑 강조색 쪽으로 물들인 것이고
 * `theme.css` 기본값 자체라 설정에 색을 적지 않는다(변형 id 는 저장되지 않는다 — 고른 것은 여덟 칸 정확 일치로 다시 읽는다).
 * **Signal** 계열(id `prism` — 화면 이름은 2026-11-02 에 AYNX → Signal)은 기본 Azure(`aynx`)와 같은 몸 — 중성 그래파이트 크롬을
 * 강조색 hue 로 물들이고 MD3 역할은 그 강조색이 원천 — 에 강조색만 다른 다섯(Tide · Phosphor · Volt · Ember · Iris)이다(2026-11-02 —
 * 목업 WWwoYFwjCfoq7V1FgSfYpf). 바탕까지 원천으로 진하게 물드는 Classic 과는 강조색 채도 · 바탕 세기로 갈린다.
 * 그 전 2026-10-24 에는 기본 하나뿐이었다(옛 Vibrant 변형 Luna · Aoi · Hikari · Sumire 와 Cyberpunk 계열을 걷었다. 그것을
 * 쓰던 파일은 여덟 칸이 그대로 남아 어느 칩도 켜지지 않고, MD3 역할은 강조색을 원천으로 본다 — [`appM3Spec`]. Cyberpunk
 * 터미널 프리셋도 같은 날 걷었다 — 옛 키는 `theme.ts` 의 `LEGACY_PRESETS` 가 AYNX 로 접는다).
 * Classic·사용자 색은 원천색에서 생성한 뒤 바탕 칸만 [`tintSurfaces`]로 더 물들인다(2026-10-13).
 * Monochrome은 같은 중성 크롬에 변형마다 다른 온도로 아주 옅게 물들인다([`MONO_TINT`] — 커서만 강조색).
 */
export const APP_COLOR_FAMILIES = [
  { id: "prism", label: "settings.theme.palette.prism", variants: [
    { id: "aynx", label: "settings.theme.palette.azure", dark: "#8ab4ff", light: "#2f62c8" },
    { id: "tide", label: "settings.theme.palette.tide", dark: "#5fd6c6", light: "#0b7a6f" },
    { id: "phosphor", label: "settings.theme.palette.phosphor", dark: "#9be37a", light: "#3c7d1e" },
    { id: "volt", label: "settings.theme.palette.volt", dark: "#f2cf55", light: "#8a6a00" },
    { id: "ember", label: "settings.theme.palette.ember", dark: "#ff9a7a", light: "#c04a2a" },
    { id: "iris", label: "settings.theme.palette.iris", dark: "#b6a3ff", light: "#5a45c8" },
  ] },
  { id: "classic", label: "settings.theme.palette.classic", variants: [
    { id: "ocean", label: "settings.theme.palette.ocean", source: "#4285c5" },
    { id: "forest", label: "settings.theme.palette.forest", source: "#398568" },
    { id: "sunset", label: "settings.theme.palette.sunset", source: "#df7654" },
    { id: "lavender", label: "settings.theme.palette.lavender", source: "#9074ce" },
    { id: "rose", label: "settings.theme.palette.rose", source: "#c66187" },
    { id: "amber", label: "settings.theme.palette.amber", source: "#bd9136" },
    { id: "slate", label: "settings.theme.palette.slate", source: "#627d8c" },
  ] },
  { id: "mono", label: "settings.theme.palette.mono", variants: [
    { id: "mono-white", label: "settings.theme.palette.white", dark: "#ececef", light: "#2a2a2e" },
    { id: "mono-silver", label: "settings.theme.palette.silver", dark: "#b4b4bb", light: "#4d4d55" },
    { id: "mono-graphite", label: "settings.theme.palette.graphite", dark: "#8e8e97", light: "#68686f" },
  ] },
] as const satisfies readonly { id: string; label: Key; variants: readonly {
  id: string; label: Key; source?: string; dark?: string; light?: string;
}[] }[];

export type AppColorFamily = (typeof APP_COLOR_FAMILIES)[number];
export type AppColorFamilyId = AppColorFamily["id"];
export type AppColorThemeId = AppColorFamily["variants"][number]["id"];

/**
 * 중성 그래파이트 크롬 7칸 — 기본(`aynx`)과 Monochrome 이 이 위에 바탕 물만 다르게 들인다.
 * 터미널 쪽 짝은 `graphite-*` 프리셋(터미널 목록에 그대로 남는 무채색 원본)이다.
 */
const NEUTRAL_CHROME: Record<"dark" | "light", Omit<ChromeTokens, "accent">> = {
  dark: { bg: "#0c0c0e", bg_panel: "#1b1b1e", fg: "#ececef", border: "#2e2e33", err: "#e0655a", ok: "#6fb37c", warn: "#d9a441" },
  light: { bg: "#f4f4f2", bg_panel: "#ffffff", fg: "#2a2a2e", border: "#d9d9d5", err: "#c24439", ok: "#397c47", warn: "#906816" },
};
/**
 * 바탕 물들임 세기 — HCT chroma. 생성 팔레트의 중성 면은 chroma 4~10이라 다크는 거의 검정, 라이트는
 * 거의 흰색으로 보여 "강조색 하나만 바뀐" 느낌이 났다. 이 값 하나로 세기를 조절한다(0이면 생성값 그대로).
 * 기본(`aynx`)도 같은 세기로 강조색 파랑 쪽에 물든다.
 */
export const BG_TINT = 12;
/**
 * Monochrome 의 바탕 물 — 무채색이 정체성이라 [`BG_TINT`]의 절반 아래로, "색" 이 아니라 **온도**로만 읽히게 한다.
 * 변형마다 hue 가 다르다: White 는 물들이지 않고(중성), Silver 는 차가운 푸른 회색, Graphite 는 따뜻한 회색.
 */
export const MONO_TINT = 6;
const MONO_HUE: Record<"mono-white" | "mono-silver" | "mono-graphite", number | null> = {
  "mono-white": null,
  "mono-silver": 250,
  "mono-graphite": 65,
};
/**
 * 라이트 뜬 면은 순백이라 물들 수 없다 — 흰색에 물든 창(`bg`)을 이만큼 섞는다(tone 약 99).
 * tone 99 근처에서는 HCT 가 hue 를 자주 놓쳐(회색·보라빛 흰색) sRGB 섞기로 한다. 창 < 타일(98) < 뜬 면 순서는 지킨다.
 */
const LIGHT_PANEL_MIX = 0.25;

/**
 * 팔레트의 바탕 칸(`bg`·`bg_panel`·`border`·터미널 `background`·`cursorAccent`)만 `hue` 로 다시 만든다.
 * tone 은 그대로 두고 chroma 만 `strength` 까지 올린다 — 대비는 tone 이 정하므로 글자 대비가 그대로다.
 * 라이트 뜬 면만 예외([`LIGHT_PANEL_MIX`]). 강조색·의미색·ANSI·선택 배경은 건드리지 않는다.
 * 월페이퍼 full(`paletteFromPixels`)은 이 함수를 지나지 않는다.
 */
function tintSurfaces(palette: DynamicPalette, isDark: boolean, hue: number, strength: number): DynamicPalette {
  const tint = (hex: string) => {
    const color = Hct.fromInt(argbFromHex(hex));
    // 밝은 톤의 따뜻한 hue(빨강·주황)는 sRGB 안에서 낼 수 있는 chroma 가 작다. 그 너머를 요청하면 HCT 가
    // hue 를 놓친 색(분홍 → 보라빛 흰색)을 돌려주므로, hue·tone 이 맞는 가장 큰 chroma 까지 내려가며 찾는다.
    for (let chroma = strength; chroma > color.chroma; chroma -= 0.5) {
      const out = Hct.from(hue, chroma, color.tone);
      const off = Math.abs(((out.hue - hue + 540) % 360) - 180);
      // 물들임은 올리기만 한다 — 생성값보다 옅으면 생성값 그대로
      if (off <= 5 && Math.abs(out.tone - color.tone) <= 0.5 && out.chroma > color.chroma) return hexFromArgb(out.toInt());
    }
    return hex;
  };
  palette.chrome.bg = tint(palette.chrome.bg);
  palette.chrome.bg_panel = isDark ? tint(palette.chrome.bg_panel) : mixHex("#ffffff", palette.chrome.bg, LIGHT_PANEL_MIX);
  palette.chrome.border = tint(palette.chrome.border);
  palette.term.background = tint(palette.term.background);
  palette.term.cursorAccent = palette.term.background;
  return palette;
}

/** 생성 팔레트(Classic·사용자 색)는 원천 hue 로 물들인다. 회색에 가까운 원천은 원천 chroma 보다 진하게 물들이지 않는다 */
function tintFromSource(palette: DynamicPalette, isDark: boolean): DynamicPalette {
  const source = Hct.fromInt(argbFromHex(palette.source));
  return tintSurfaces(palette, isDark, source.hue, Math.min(BG_TINT, source.chroma));
}

/** sRGB 채널별 선형 섞기 — `amount` 만큼 `b` 쪽으로 */
function mixHex(a: string, b: string, amount: number): string {
  const x = argbFromHex(a), y = argbFromHex(b);
  const channel = (shift: number) => Math.round(((x >> shift) & 255) * (1 - amount) + ((y >> shift) & 255) * amount);
  return hexFromArgb((0xff << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0));
}

/** 중성 크롬 + `graphite-*` 21색 + 강조색 커서 — 기본과 Monochrome 의 물들이기 전 바탕 */
function neutralPalette(accent: string, isDark: boolean): DynamicPalette {
  return {
    source: accent,
    chrome: { accent, ...NEUTRAL_CHROME[isDark ? "dark" : "light"] },
    term: { ...TERM_PRESETS[isDark ? "graphite-dark" : "graphite-light"].theme, cursor: accent } as DynamicPalette["term"],
  };
}


// ---------------------------------------------------------------------------
// MD3 역할 — 크롬의 원천 (2026-10-18 — End-4 식 MD3 방향)
// ---------------------------------------------------------------------------

/**
 * 크롬 색 체계는 **MD3 역할**이다: 창 = surface · 뜬 면 = surfaceContainer · 본문 = onSurface · 선 = outlineVariant ·
 * 강조 = primary · 오류 = error (+ `theme.css` 가 나머지 역할을 별칭으로 — 호버 surfaceContainerHigh · 선택 줄 secondaryContainer …).
 * 역할은 계열마다 원천 하나에서 MCU 스킴으로 낸다. 기본은 **`SchemeTonalSpot(원천, isDark, 0)` 그대로**(목업 값)이고:
 * - `mono` — Monochrome 은 무채색이 정체성이다. TonalSpot 은 원천 chroma 와 무관하게 primary chroma 36 을 입혀 회색 강조색이
 *   파랑 · 보라로 물들므로, 톤 규칙(TonalSpot)은 그대로 두고 강조 · 면 팔레트를 거의 회색([`MONO_CHROMA`] — White 는 0)으로,
 *   hue 는 변형의 바탕 온도([`MONO_HUE`] — `neutralHue`)로 둔다. `SchemeMonochrome` 은 다크 primary 가 순백(톤 100)이라 칩 · 스위치가 너무 튄다.
 * 터미널 팔레트(ANSI · 터미널 배경 · 커서)는 이 길을 지나지 않는다 — 그 전 생성값 그대로다.
 */
export interface M3Spec {
  source: string;
  mono?: boolean;
  /** Monochrome 의 바탕 온도 hue(`null` = 무채 — White) */
  neutralHue?: number | null;
}

/** Monochrome 의 강조 · 면 팔레트 chroma — 색이 아니라 **온도**로만 읽히게(TonalSpot 면은 6) */
export const MONO_CHROMA = 4;

/** 기본(`aynx`) · Mono 는 다크 강조색(Classic 은 원천)을 **두 모드 공통 원천**으로 쓴다 — 목업의 기본 파랑 = #8ab4ff */
function variantM3Spec(id: AppColorThemeId): M3Spec {
  const family = familyOf(id);
  const variant = (appColorFamily(family).variants as readonly { id: string; source?: string; dark?: string }[])
    .find((entry) => entry.id === id)!;
  const source = variant.source ?? variant.dark!;
  if (family === "mono") return { source, mono: true, neutralHue: MONO_HUE[id as keyof typeof MONO_HUE] };
  return { source };
}

/** 재료 → MCU 스킴(대비 보정 0) */
export function m3Scheme(spec: M3Spec, isDark: boolean): DynamicScheme {
  const sourceColorHct = Hct.fromInt(argbFromHex(spec.source));
  if (!spec.mono) return new SchemeTonalSpot(sourceColorHct, isDark, 0);
  const plain = spec.neutralHue === undefined || spec.neutralHue === null;
  const gray = TonalPalette.fromHueAndChroma(spec.neutralHue ?? 0, plain ? 0 : MONO_CHROMA);
  return new DynamicScheme({
    sourceColorHct, variant: Variant.TONAL_SPOT, contrastLevel: 0, isDark,
    primaryPalette: gray, secondaryPalette: gray, tertiaryPalette: gray,
    neutralPalette: gray, neutralVariantPalette: gray,
  });
}

const m3Cache = new Map<string, Record<M3Token, string>>();
const M3_CACHE = 32;

/** 재료 → `--m3-*` 한 벌(기억판 — 슬라이더를 끌 때도 `applySettings` 가 불린다) */
export function m3Tokens(spec: M3Spec, isDark: boolean): Record<M3Token, string> {
  const key = [spec.source, isDark, spec.mono ? 1 : 0, spec.neutralHue ?? "-"].join(":");
  let tokens = m3Cache.get(key);
  if (!tokens) {
    if (m3Cache.size >= M3_CACHE) m3Cache.clear();
    tokens = m3RoleTokens(m3Scheme(spec, isDark));
    m3Cache.set(key, tokens);
  }
  return tokens;
}

/** MD3 역할 → 저장 칸 여섯(의미색 `ok` · `warn` 은 MD3 에 없어 ANSI 톤 생성 그대로 — 부르는 쪽이 붙인다) */
export function m3Chrome(tokens: Record<M3Token, string>): Omit<ChromeTokens, "ok" | "warn"> {
  return {
    accent: tokens["--m3-primary"],
    bg: tokens["--m3-surface"],
    bg_panel: tokens["--m3-surface-container"],
    fg: tokens["--m3-on-surface"],
    border: tokens["--m3-outline-variant"],
    err: tokens["--m3-error"],
  };
}

/** 기본(`aynx`)의 `--m3-*` — `theme.css` 두 블록의 값(짝 시험) */
export function defaultM3Tokens(isDark: boolean): Record<M3Token, string> {
  return m3Tokens(variantM3Spec("aynx"), isDark);
}

// ---------------------------------------------------------------------------
// 내장 테마 한 벌
// ---------------------------------------------------------------------------

/**
 * 2026-10-18 전의 한 벌 — 터미널 21색과 의미색(ok · warn)은 **지금도 이 값**이고(터미널은 이번 범위 밖), 크롬 여섯 칸은
 * 옛 파일을 알아보는 데만 쓴다([`upgradeLegacyAppColors`]). 생성 테마는 그 전 면 계단([`legacySurfaces`]) 위에 바탕 칸을 물들였다.
 */
function legacyFromSource(argb: number, isDark: boolean): DynamicPalette {
  const p = paletteFromSource(argb, isDark);
  return { source: p.source, chrome: { ...p.chrome, ...legacySurfaces(argb, isDark) }, term: p.term };
}

const legacyPalettes = new Map<string, DynamicPalette>();
export function legacyAppColorPalette(id: AppColorThemeId, isDark: boolean): DynamicPalette {
  const key = id + ":" + isDark;
  let palette = legacyPalettes.get(key);
  if (!palette) {
    const familyId = familyOf(id);
    const variants: readonly { id: AppColorThemeId; source?: string; dark?: string; light?: string }[] = appColorFamily(familyId).variants;
    const variant = variants.find((entry) => entry.id === id)!;
    const mode = isDark ? "dark" : "light";
    if (familyId === "prism") {
      // 중성 크롬을 강조색의 hue 로 BG_TINT 만큼 물들인 것(2026-10-13) — 기본 `aynx` 는 `aynx-*` 터미널 프리셋이 이 값이다.
      // Signal 의 나머지 변형(2026-11-02)도 같은 몸이다 — 터미널은 graphite 21색 위에 그 강조색 커서 · 물든 배경
      const accent = variant[mode]!;
      palette = tintSurfaces(neutralPalette(accent, isDark), isDark, Hct.fromInt(argbFromHex(accent)).hue, BG_TINT);
    } else if (familyId === "classic") {
      palette = tintFromSource(legacyFromSource(argbFromHex(variant.source!), isDark), isDark);
    } else {
      // Monochrome: 중성 크롬 + graphite 21색, 강조색·커서와 바탕 온도(MONO_HUE)만 변형마다 다르다
      palette = neutralPalette(variant[mode]!, isDark);
      const hue = MONO_HUE[id as keyof typeof MONO_HUE];
      if (hue !== null) palette = tintSurfaces(palette, isDark, hue, MONO_TINT);
    }
    legacyPalettes.set(key, palette);
  }
  return palette;
}

/** 옛 한 벌의 터미널 · 의미색 + 지금 MD3 크롬 */
function withM3Chrome(legacy: DynamicPalette, tokens: Record<M3Token, string>): DynamicPalette {
  return {
    source: legacy.source,
    chrome: { ...m3Chrome(tokens), ok: legacy.chrome.ok, warn: legacy.chrome.warn },
    term: { ...legacy.term },
  };
}

const palettes = new Map<string, DynamicPalette>();
function builtInPalette(id: AppColorThemeId, isDark: boolean): DynamicPalette {
  const key = id + ":" + isDark;
  let palette = palettes.get(key);
  if (!palette) {
    palette = withM3Chrome(legacyAppColorPalette(id, isDark), m3Tokens(variantM3Spec(id), isDark));
    palettes.set(key, palette);
  }
  return palette;
}

/**
 * 기본(`aynx`)의 한 벌 — 크롬은 `SchemeTonalSpot(#8ab4ff)` 의 MD3 역할(2026-10-18), 의미색은 중성 그래파이트의 것,
 * 터미널은 `aynx-*` 프리셋. `theme.css` 의 두 블록과 그 프리셋이 이 값이다(짝 시험).
 */
export function defaultAppPalette(isDark: boolean): DynamicPalette {
  const palette = builtInPalette("aynx", isDark);
  return { source: palette.source, chrome: { ...palette.chrome }, term: { ...palette.term } };
}

export function appColorFamily(id: AppColorFamilyId): AppColorFamily {
  return APP_COLOR_FAMILIES.find((family) => family.id === id)!;
}

export function familyOf(id: AppColorThemeId): AppColorFamilyId {
  return APP_COLOR_FAMILIES.find((family) => family.variants.some((variant) => variant.id === id))!.id;
}

/** 다른 계열·사용자 색·추출에서 오면 첫 변형, 같은 계열이면 다음 변형. */
export function nextInFamily(familyId: AppColorFamilyId, current: AppColorThemeId | null): AppColorThemeId {
  const family = appColorFamily(familyId);
  const index = family.variants.findIndex((variant) => variant.id === current);
  return family.variants[(index + 1) % family.variants.length].id;
}

/** 기본(`aynx`)은 CSS·터미널 기본값 자체라 설정에 색을 적지 않는다. 나머지는 여덟 칸 전체다. */
export function appColorPalette(id: AppColorThemeId, isDark: boolean): DynamicPalette | null {
  return id === "aynx" ? null : builtInPalette(id, isDark);
}

/** 저장된 여덟 칸의 정확 일치로 판정한다. 월페이퍼 full은 내장 테마로 표시하지 않는다. */
export function selectedAppColorTheme(app: AppTheme): AppColorThemeId | null {
  if (app.dynamic === "full") return null;
  if (CHROME_KEYS.every((key) => !app[key])) return "aynx";
  return matchBuiltIn(app)?.id ?? null;
}

/** 8칸이 정확히 같은 내장 테마와 그 모드(기본 제외). 모드는 문서 속성이 아니라 일치한 쪽에서 읽는다 */
function matchBuiltIn(
  app: AppTheme,
  palette: (id: AppColorThemeId, isDark: boolean) => DynamicPalette = builtInPalette,
): { id: AppColorThemeId; isDark: boolean } | null {
  for (const family of APP_COLOR_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.id === "aynx") continue;
      for (const isDark of [true, false]) {
        const p = palette(variant.id, isDark);
        if (CHROME_KEYS.every((key) => app[key] === p.chrome[key])) return { id: variant.id, isDark };
      }
    }
  }
  return null;
}

/** 2026-10-18 전 사용자 색의 한 벌 — 강조색은 원천의 hue·chroma 를 지킨 채 대비 경계로 옮긴 톤(지금은 터미널 커서만 이 값) */
function legacyCustomPalette(sourceHex: string, isDark: boolean): DynamicPalette {
  const argb = sourceArgbFromHex(sourceHex);
  if (argb === null) throw new Error("Invalid custom source color");
  const palette = tintFromSource(legacyFromSource(argb, isDark), isDark);
  const source = Hct.fromInt(argb);
  const readable = (hex: string) => isDark
    ? contrastRatio(hex, "#141416") >= 4.5 && contrastRatio(hex, palette.chrome.bg) >= 3
    : contrastRatio(hex, palette.chrome.bg) >= 4.5 && contrastRatio(hex, "#ffffff") >= 4.5;
  let accent = palette.source;
  if (!readable(accent)) {
    // 대비는 톤에 따라 단조롭게 바뀐다. 실패한 원천과 읽히는 끝점 사이의 가장 가까운 경계를 찾는다.
    // HCT의 sRGB 변환·반올림을 거친 hex로 매번 검산하므로 경계에서도 조건을 지킨다.
    let failing = source.tone;
    let passing = isDark ? 100 : 0;
    const at = (tone: number) => hexFromArgb(Hct.from(source.hue, source.chroma, tone).toInt());
    for (let i = 0; i < 24; i++) {
      const tone = (failing + passing) / 2;
      if (readable(at(tone))) passing = tone;
      else failing = tone;
    }
    accent = at(passing);
  }
  palette.chrome.accent = accent;
  palette.term.cursor = accent;
  return palette;
}

/**
 * 사용자 색 — 크롬은 `SchemeTonalSpot(원천)` 의 MD3 역할(강조색 = primary — MD3 톤 규칙이 대비를 맞춘다).
 * 터미널은 그 전 그대로(TonalSpot + 바탕 물들임, 커서는 대비 경계로 옮긴 원천 — [`legacyCustomPalette`]).
 */
export function customPalette(sourceHex: string, isDark: boolean): DynamicPalette {
  const legacy = legacyCustomPalette(sourceHex, isDark);
  return withM3Chrome(legacy, m3Tokens({ source: legacy.source }, isDark));
}

/** source-color는 full도 쓰므로 모드·내장 판정·여덟 칸 일치를 모두 확인한다. */
export function selectedCustomSource(settings: Pick<AppSettings, "app" | "terminal">): string | null {
  if (settings.app.dynamic === "full" || selectedAppColorTheme(settings.app)) return null;
  const source = settings.terminal.dynamic?.[SOURCE_KEY];
  if (sourceArgbFromHex(source) === null) return null;
  for (const isDark of [true, false]) {
    const palette = customPalette(source!, isDark);
    if (CHROME_KEYS.every((key) => settings.app[key] === palette.chrome[key])) return palette.source;
  }
  return null;
}

/**
 * 옛 파일(2026-10-18 전 크롬)의 여덟 칸을 **같은 테마 · 원천의 MD3 크롬**으로 바꾼다 — 내장 테마 · 사용자 색 · 월페이퍼 full.
 * 터미널 칸은 생성값이 그대로라 손대지 않는다. 바꿨으면 `true`. 아무 테마와도 안 맞는 손 고친 칸은 그대로 둔다
 * (MD3 역할은 강조색을 원천으로 본다 — [`appM3Spec`]).
 */
export function upgradeLegacyAppColors(settings: Pick<AppSettings, "app" | "terminal">): boolean {
  const app = settings.app;
  if (CHROME_KEYS.every((key) => !app[key])) return false;
  const same = (chrome: ChromeTokens) => CHROME_KEYS.every((key) => app[key] === chrome[key]);
  const write = (chrome: ChromeTokens) => {
    for (const key of CHROME_KEYS) app[key] = chrome[key];
    return true;
  };
  const source = sourceArgbFromHex(settings.terminal.dynamic?.[SOURCE_KEY]);
  if (source !== null) {
    for (const isDark of [true, false]) {
      if (same(legacyFromSource(source, isDark).chrome)) return write(cachedPaletteFromSource(source, isDark).chrome);
    }
  }
  const builtIn = matchBuiltIn(app, legacyAppColorPalette);
  if (builtIn) return write(builtInPalette(builtIn.id, builtIn.isDark).chrome);
  if (source !== null) {
    const hex = hexFromArgb(source);
    for (const isDark of [true, false]) {
      if (same(legacyCustomPalette(hex, isDark).chrome)) return write(customPalette(hex, isDark).chrome);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 고정 밝기 터미널 — 가상 프리셋 `dynamic-dark` · `dynamic-light` (2026-11-03 반대 밝기 → 2026-11-08 고정)
// ---------------------------------------------------------------------------

/**
 * 지금 `[terminal.dynamic]` 팔레트의 **반대 밝기** 21색 — 고정 밝기 키([`fixedDynamicTerms`])의 반대 쪽. 저장하지 않고 그때 낸다.
 * 밝기는 맵의 배경으로 읽고(`isLightBackground`), 그 맵을 만든 원천을 반대 밝기로 다시 푼다:
 * 내장 변형 → [`appColorPalette`] · 사용자 색 → [`customPalette`] · 월페이퍼(full, 또는 크롬이 그 원천 그대로) → 적어 둔 원천색.
 * 맵이 없거나 원천을 모르면(기본 `aynx` — 맵이 없다 · 옛 파일 · 손으로 고친 칸) `undefined` — 그리는 쪽은 기본 프리셋으로 떨어진다.
 */
export function oppositeDynamicTerm(settings: Pick<AppSettings, "app" | "terminal">): ITheme | undefined {
  const map = settings.terminal.dynamic;
  const current = dynamicTermTheme(map);
  if (!current) return undefined;
  const wantDark = isLightBackground(current.background);
  const app = settings.app;
  const builtIn = selectedAppColorTheme(app);
  if (builtIn && builtIn !== "aynx") return dynamicTermTheme(appColorPalette(builtIn, wantDark)?.term);
  const custom = selectedCustomSource(settings);
  if (custom) return dynamicTermTheme(customPalette(custom, wantDark).term);
  const argb = sourceArgbFromHex(map?.[SOURCE_KEY]);
  if (argb !== null && (app.dynamic === "full" || chromeFromSource(app, argb))) {
    return dynamicTermTheme(cachedPaletteFromSource(argb, wantDark).term);
  }
  return undefined;
}

let lastOpposite: { key: string; theme: ITheme | undefined } | null = null;

/** [`oppositeDynamicTerm`] 의 기억판 — 같은 크롬 · 맵이면 마지막 결과(사용자 색은 풀 때마다 대비 경계를 찾는다) */
export function cachedOppositeDynamicTerm(settings: Pick<AppSettings, "app" | "terminal">): ITheme | undefined {
  const map = settings.terminal.dynamic;
  if (!map) return undefined;
  const key = [
    settings.app.dynamic ?? "", ...CHROME_KEYS.map((k) => settings.app[k] ?? ""),
    map[SOURCE_KEY] ?? "", map.background ?? "", map.foreground ?? "",
  ].join("|");
  if (lastOpposite?.key === key) return lastOpposite.theme;
  const theme = oppositeDynamicTerm(settings);
  lastOpposite = { key, theme };
  return theme;
}

/**
 * 고정 밝기 가상 키(`dynamic-dark` · `dynamic-light` — 2026-11-08)가 그리는 두 벌. 지금 맵이 그 밝기면 맵 그대로,
 * 아니면 [`oppositeDynamicTerm`] 으로 반대 밝기를 다시 낸다. 맵이 없으면 둘 다 없다 · 원천을 모르면 맵 쪽 하나만.
 */
export function fixedDynamicTerms(
  settings: Pick<AppSettings, "app" | "terminal">,
  opposite: (s: Pick<AppSettings, "app" | "terminal">) => ITheme | undefined = oppositeDynamicTerm,
): FixedDynamicTerms {
  const current = dynamicTermTheme(settings.terminal.dynamic);
  if (!current) return {};
  const other = opposite(settings);
  return isLightBackground(current.background) ? { light: current, dark: other } : { dark: current, light: other };
}

/** [`fixedDynamicTerms`] 의 기억판 — 반대 쪽은 [`cachedOppositeDynamicTerm`] */
export function cachedFixedDynamicTerms(settings: Pick<AppSettings, "app" | "terminal">): FixedDynamicTerms {
  return fixedDynamicTerms(settings, cachedOppositeDynamicTerm);
}

// ---------------------------------------------------------------------------
// 지금 설정 → `--m3-*`
// ---------------------------------------------------------------------------

/**
 * 지금 설정의 MD3 재료 — 크롬 팔레트가 만들어진 **같은 원천**을 고른다. `null` = 기본(`theme.css` 값이 이긴다).
 * 월페이퍼 full · 사용자 색은 적어 둔 원천(`source-color`), 내장 테마는 변형의 원천, 그 밖(손으로 고친 칸 · 옛 파일)은
 * 강조색을 원천으로 본다(강조색이 없으면 기본).
 */
export function appM3Spec(settings: Pick<AppSettings, "app" | "terminal">, isDark: boolean): M3Spec | null {
  const app = settings.app;
  if (app.dynamic === "full") {
    const source = sourceArgbFromHex(settings.terminal.dynamic?.[SOURCE_KEY]);
    if (source !== null) return { source: hexFromArgb(source) };
  }
  const builtIn = selectedAppColorTheme(app);
  if (builtIn === "aynx") return null;
  if (builtIn) return variantM3Spec(builtIn);
  const custom = selectedCustomSource(settings);
  if (custom) return { source: custom };
  const accent = sourceArgbFromHex(app.accent);
  return accent === null ? null : { source: hexFromArgb(accent) };
}

let lastM3: { key: string; tokens: Record<M3Token, string> | null } | null = null;

/** [`appM3Spec`] → 토큰(`null` = 인라인을 걷고 `theme.css` 기본). 같은 설정이면 마지막 결과를 그대로 준다 */
export function appM3Tokens(settings: Pick<AppSettings, "app" | "terminal">, isDark: boolean): Record<M3Token, string> | null {
  const key = [
    isDark, settings.app.dynamic ?? "", settings.terminal.dynamic?.[SOURCE_KEY] ?? "", ...CHROME_KEYS.map((k) => settings.app[k] ?? ""),
  ].join("|");
  if (lastM3?.key === key) return lastM3.tokens;
  const spec = appM3Spec(settings, isDark);
  const tokens = spec ? m3Tokens(spec, isDark) : null;
  lastM3 = { key, tokens };
  return tokens;
}
