import {
  argbFromHex, DynamicScheme, Hct, hexFromArgb, SchemeTonalSpot, TonalPalette, Variant,
} from "@material/material-color-utilities";
import {
  CHROME_KEYS, SOURCE_KEY, cachedPaletteFromSource, chromeFromSource, contrastRatio, dynamicTermTheme, legacyOk, legacySurfaces, legacyWarn,
  m3RoleTokens, paletteFromSource, sourceArgbFromHex, type ChromeTokens, type DynamicPalette, type M3Token,
} from "$lib/dynamic-color";
import type { Key } from "$lib/i18n/keys";
import type { AppTheme, AppSettings } from "$lib/settings/model/schema";
import type { ITheme } from "@xterm/xterm";
import { TERM_PRESETS, isLightBackground, type FixedDynamicTerms } from "$lib/theme";

/**
 * 계열 안의 순서가 칩의 순환 순서다. Classic 의 id · 원천색은 옛 저장값 그대로다 — 바꾸지 않는다.
 * 변형 id 는 저장되지 않는다 — 고른 것은 여덟 칸 정확 일치로 다시 읽으므로 색 값을 바꾸면 옛 파일의 칩이 꺼진다.
 * `aynx`(기본)는 `theme.css` 기본값 자체라 설정에 색을 적지 않는다. 계열 id `prism` 의 화면 이름은 Signal 이다 —
 * 기본 Azure(`aynx`)와 같은 몸에 강조색만 다른 다섯이 붙어 순환한다.
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

/** 터미널 쪽 짝은 `graphite-*` 프리셋이다 */
const NEUTRAL_CHROME: Record<"dark" | "light", Omit<ChromeTokens, "accent">> = {
  dark: { bg: "#0c0c0e", bg_panel: "#1b1b1e", fg: "#ececef", border: "#2e2e33", err: "#e0655a", ok: "#6fb37c", warn: "#d9a441" },
  light: { bg: "#f4f4f2", bg_panel: "#ffffff", fg: "#2a2a2e", border: "#d9d9d5", err: "#c24439", ok: "#397c47", warn: "#906816" },
};
/** 바탕 물들임 세기(HCT chroma) — 0 이면 생성값 그대로 */
export const BG_TINT = 12;
/** Monochrome 은 무채색이 정체성이라 "색" 이 아니라 온도로만 읽히게 옅게 */
export const MONO_TINT = 6;
const MONO_HUE: Record<"mono-white" | "mono-silver" | "mono-graphite", number | null> = {
  "mono-white": null,
  "mono-silver": 250,
  "mono-graphite": 65,
};
/** tone 99 근처에서는 HCT 가 hue 를 자주 놓쳐(보라빛 흰색) 라이트 뜬 면은 sRGB 섞기로 한다 — 창 < 타일 < 뜬 면 순서는 지킨다 */
const LIGHT_PANEL_MIX = 0.25;

/** tone 은 그대로 두고 chroma 만 올린다 — 대비는 tone 이 정하므로 글자 대비가 그대로다 */
function tintSurfaces(palette: DynamicPalette, isDark: boolean, hue: number, strength: number): DynamicPalette {
  const tint = (hex: string) => {
    const color = Hct.fromInt(argbFromHex(hex));
    // sRGB 밖의 chroma 를 요청하면 HCT 가 hue 를 놓친 색을 돌려준다 — hue · tone 이 맞는 가장 큰 chroma 까지 내려가며 찾는다
    for (let chroma = strength; chroma > color.chroma; chroma -= 0.5) {
      const out = Hct.from(hue, chroma, color.tone);
      const off = Math.abs(((out.hue - hue + 540) % 360) - 180);
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

/** 회색에 가까운 원천은 원천 chroma 보다 진하게 물들이지 않는다 */
function tintFromSource(palette: DynamicPalette, isDark: boolean): DynamicPalette {
  const source = Hct.fromInt(argbFromHex(palette.source));
  return tintSurfaces(palette, isDark, source.hue, Math.min(BG_TINT, source.chroma));
}

function mixHex(a: string, b: string, amount: number): string {
  const x = argbFromHex(a), y = argbFromHex(b);
  const channel = (shift: number) => Math.round(((x >> shift) & 255) * (1 - amount) + ((y >> shift) & 255) * amount);
  return hexFromArgb((0xff << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0));
}

function neutralPalette(accent: string, isDark: boolean): DynamicPalette {
  return {
    source: accent,
    chrome: { accent, ...NEUTRAL_CHROME[isDark ? "dark" : "light"] },
    term: { ...TERM_PRESETS[isDark ? "graphite-dark" : "graphite-light"].theme, cursor: accent } as DynamicPalette["term"],
  };
}


// ---------------------------------------------------------------------------
// MD3 역할 — 크롬의 원천
// ---------------------------------------------------------------------------

/**
 * Monochrome 은 TonalSpot 의 톤 규칙에 거의 회색 팔레트를 끼운다 — TonalSpot 그대로면 회색 강조색이 파랑 · 보라로 물들고,
 * `SchemeMonochrome` 은 다크 primary 가 순백이라 칩 · 스위치가 너무 튄다. 터미널 팔레트는 이 길을 지나지 않는다.
 */
export interface M3Spec {
  source: string;
  mono?: boolean;
  /** `null` = 무채(White) */
  neutralHue?: number | null;
}

export const MONO_CHROMA = 4;

/** 다크 강조색(Classic 은 원천)을 두 모드 공통 원천으로 쓴다 */
function variantM3Spec(id: AppColorThemeId): M3Spec {
  const family = familyOf(id);
  const variant = (appColorFamily(family).variants as readonly { id: string; source?: string; dark?: string }[])
    .find((entry) => entry.id === id)!;
  const source = variant.source ?? variant.dark!;
  if (family === "mono") return { source, mono: true, neutralHue: MONO_HUE[id as keyof typeof MONO_HUE] };
  return { source };
}

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

/** 기억판 — 슬라이더를 끌 때도 `applySettings` 가 불린다 */
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

/** 의미색 `ok` · `warn` 은 MD3 에 없어 부르는 쪽이 붙인다 */
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

/** `theme.css` 두 블록의 값과 같아야 한다(짝 시험) */
export function defaultM3Tokens(isDark: boolean): Record<M3Token, string> {
  return m3Tokens(variantM3Spec("aynx"), isDark);
}

// ---------------------------------------------------------------------------
// 내장 테마 한 벌
// ---------------------------------------------------------------------------

/** 터미널 21색과 의미색은 지금도 이 값이다 — 크롬 여섯 칸은 옛 파일을 알아보는 데만 쓴다([`upgradeLegacyAppColors`]) */
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
      // 기본 `aynx` 는 `aynx-*` 터미널 프리셋이 이 값이다
      const accent = variant[mode]!;
      palette = tintSurfaces(neutralPalette(accent, isDark), isDark, Hct.fromInt(argbFromHex(accent)).hue, BG_TINT);
    } else if (familyId === "classic") {
      palette = tintFromSource(legacyFromSource(argbFromHex(variant.source!), isDark), isDark);
    } else {
      palette = neutralPalette(variant[mode]!, isDark);
      const hue = MONO_HUE[id as keyof typeof MONO_HUE];
      if (hue !== null) palette = tintSurfaces(palette, isDark, hue, MONO_TINT);
    }
    legacyPalettes.set(key, palette);
  }
  return palette;
}

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

/** `theme.css` 의 두 블록과 `aynx-*` 터미널 프리셋이 이 값이다(짝 시험) */
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

export function nextInFamily(familyId: AppColorFamilyId, current: AppColorThemeId | null): AppColorThemeId {
  const family = appColorFamily(familyId);
  const index = family.variants.findIndex((variant) => variant.id === current);
  return family.variants[(index + 1) % family.variants.length].id;
}

export function appColorPalette(id: AppColorThemeId, isDark: boolean): DynamicPalette | null {
  return id === "aynx" ? null : builtInPalette(id, isDark);
}

export function selectedAppColorTheme(app: AppTheme): AppColorThemeId | null {
  if (app.dynamic === "full") return null;
  if (CHROME_KEYS.every((key) => !app[key])) return "aynx";
  return matchBuiltIn(app)?.id ?? null;
}

/** 모드는 문서 속성이 아니라 일치한 쪽에서 읽는다 */
function matchBuiltIn(
  app: AppTheme,
  chromes: (id: AppColorThemeId, isDark: boolean) => readonly ChromeTokens[] = (id, isDark) => [builtInPalette(id, isDark).chrome],
): { id: AppColorThemeId; isDark: boolean } | null {
  for (const family of APP_COLOR_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.id === "aynx") continue;
      for (const isDark of [true, false]) {
        if (chromes(variant.id, isDark).some((chrome) => CHROME_KEYS.every((key) => app[key] === chrome[key]))) {
          return { id: variant.id, isDark };
        }
      }
    }
  }
  return null;
}

/** 옛 파일 알아보기 · 터미널 커서에만 쓴다 — 강조색은 원천의 hue · chroma 를 지킨 채 대비 경계로 옮긴 톤 */
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
    // 반올림을 거친 hex 로 매번 검산하므로 경계에서도 조건을 지킨다
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

export function customPalette(sourceHex: string, isDark: boolean): DynamicPalette {
  const legacy = legacyCustomPalette(sourceHex, isDark);
  return withM3Chrome(legacy, m3Tokens({ source: legacy.source }, isDark));
}

/** source-color 는 full 도 쓰므로 모드 · 내장 판정 · 여덟 칸 일치를 모두 확인한다 */
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

/** 옛 의미색 둘 — hue 를 가두지 않은 `ok` · `warn` */
type LegacyStatus = Pick<ChromeTokens, "ok" | "warn">;

function legacyStatus(sourceArgb: number, isDark: boolean): LegacyStatus {
  return { ok: legacyOk(sourceArgb, isDark), warn: legacyWarn(sourceArgb, isDark) };
}

/** 생성 테마(Classic)만 옛 의미색이 달랐다 */
const legacyBuiltInStatuses = new Map<string, LegacyStatus>();
function legacyBuiltInStatus(id: AppColorThemeId, isDark: boolean): LegacyStatus {
  const key = id + ":" + isDark;
  let status = legacyBuiltInStatuses.get(key);
  if (!status) {
    const variant = (appColorFamily(familyOf(id)).variants as readonly { id: string; source?: string }[]).find((entry) => entry.id === id)!;
    const { ok, warn } = builtInPalette(id, isDark).chrome;
    status = variant.source ? legacyStatus(argbFromHex(variant.source), isDark) : { ok, warn };
    legacyBuiltInStatuses.set(key, status);
  }
  return status;
}

/** 공개 판(0.1.4 이하)은 (옛 ok, 옛 warn), `ok` 만 가둔 개발 빌드는 (지금 ok, 옛 warn)이다 — 지우면 그 파일을 못 알아본다 */
function legacyCandidates(palettes: readonly DynamicPalette[], old: LegacyStatus): ChromeTokens[] {
  return palettes.flatMap(({ chrome }) => [{ ...chrome, ...old }, { ...chrome, ok: old.ok }, { ...chrome, warn: old.warn }]);
}

/** 옛 파일의 여덟 칸을 같은 테마 · 원천의 지금 크롬으로 바꾼다 — 터미널 칸 · 아무 테마와도 안 맞는 손 고친 칸은 그대로 둔다 */
export function upgradeLegacyAppColors(settings: Pick<AppSettings, "app" | "terminal">): boolean {
  const app = settings.app;
  if (CHROME_KEYS.every((key) => !app[key])) return false;
  const same = (chrome: ChromeTokens) => CHROME_KEYS.every((key) => app[key] === chrome[key]);
  const write = (chrome: ChromeTokens) => {
    if (same(chrome)) return false;
    for (const key of CHROME_KEYS) app[key] = chrome[key];
    return true;
  };
  const source = sourceArgbFromHex(settings.terminal.dynamic?.[SOURCE_KEY]);
  if (source !== null) {
    for (const isDark of [true, false]) {
      const current = cachedPaletteFromSource(source, isDark);
      if (legacyCandidates([legacyFromSource(source, isDark), current], legacyStatus(source, isDark)).some(same)) {
        return write(current.chrome);
      }
    }
  }
  const builtIn = matchBuiltIn(app, (id, isDark) =>
    legacyCandidates([legacyAppColorPalette(id, isDark), builtInPalette(id, isDark)], legacyBuiltInStatus(id, isDark)));
  if (builtIn) return write(builtInPalette(builtIn.id, builtIn.isDark).chrome);
  if (source !== null) {
    const hex = hexFromArgb(source);
    for (const isDark of [true, false]) {
      const current = customPalette(hex, isDark);
      if (legacyCandidates([legacyCustomPalette(hex, isDark), current], legacyStatus(source, isDark)).some(same)) {
        return write(current.chrome);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 고정 밝기 터미널 — 가상 프리셋 `dynamic-dark` · `dynamic-light`
// ---------------------------------------------------------------------------

/** 저장하지 않고 그때 낸다 — 원천을 모르면 `undefined`(그리는 쪽은 기본 프리셋으로 떨어진다) */
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

/** 사용자 색은 풀 때마다 대비 경계를 찾으므로 마지막 결과를 기억한다 */
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

export function fixedDynamicTerms(
  settings: Pick<AppSettings, "app" | "terminal">,
  opposite: (s: Pick<AppSettings, "app" | "terminal">) => ITheme | undefined = oppositeDynamicTerm,
): FixedDynamicTerms {
  const current = dynamicTermTheme(settings.terminal.dynamic);
  if (!current) return {};
  const other = opposite(settings);
  return isLightBackground(current.background) ? { light: current, dark: other } : { dark: current, light: other };
}

export function cachedFixedDynamicTerms(settings: Pick<AppSettings, "app" | "terminal">): FixedDynamicTerms {
  return fixedDynamicTerms(settings, cachedOppositeDynamicTerm);
}

// ---------------------------------------------------------------------------
// 지금 설정 → `--m3-*`
// ---------------------------------------------------------------------------

/** 크롬 팔레트가 만들어진 같은 원천을 고른다 — `null` = 기본(`theme.css` 값이 이긴다) */
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

/** `null` = 인라인을 걷고 `theme.css` 기본 */
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
