import { appColorPalette, customPalette, selectedCustomSource, selectedAppColorTheme, type AppColorThemeId } from "$lib/app-color-themes";
import { normalizeUiScale } from "$lib/ui-scale";
import {
  DEFAULT_TERM_PRESET,
  TERM_PRESETS,
  fixedDynamicTermKey,
  isDynamicTermKey,
  isFixedDynamicTermKey,
  isLightBackground,
  isUserTermKey,
} from "$lib/theme";
import { clampInt, text } from "$lib/settings-codec";
import {
  BEFORE_KEY,
  SOURCE_KEY,
  cachedPaletteFromSource,
  chromeFromSource,
  sourceArgbFromHex,
  type DynamicPalette,
} from "$lib/dynamic-color";
import {
  isAppIconId,
  DEFAULT_APP_ICON,
  DEFAULT_OPACITY,
  DEFAULT_STATUS_BAR,
  DEFAULT_STATUS_BAR_STYLE,
  DEFAULT_DOCK_LAYOUT,
  DOCK_LAYOUTS,
  DEFAULT_MATERIAL,
  DEFAULT_TAB_STYLE,
  DEFAULT_TERM_OPACITY,
  DEFAULT_TILE_HEADER,
  DEFAULT_TILING,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_FIT,
  OPACITY_MAX,
  OPACITY_MIN,
  STATUS_BAR_POSITIONS,
  STATUS_BAR_STYLES,
  MATERIALS,
  TAB_STYLES,
  TERM_OPACITY_MAX,
  TERM_OPACITY_MIN,
  TILE_HEADER_MODES,
  TILING_MODES,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_BLUR_MIN,
  WALLPAPER_DIM_MAX,
  WALLPAPER_DIM_MIN,
  WALLPAPER_FITS,
  type StatusBarPosition,
  type StatusBarStyle,
  type Material,
  type TabStyle,
  type TileHeaderMode,
  type TilingMode,
  type WallpaperFit,
} from "./options";
import { applySettings, settings } from "./store.svelte.js";
import { isDefaultChipOrder, normalizeChipHidden, normalizeChipOrder, type HeaderChipId } from "$lib/header-chips";
import { APP_TOKEN_KEYS, describeError } from "./internal";
import type { AppSettings } from "./schema";

function fixedKeyFor(isDark: boolean): string {
  const cur = settings.current.terminal.theme;
  return isFixedDynamicTermKey(cur) ? cur! : fixedDynamicTermKey(isDark);
}

/** 기본(`aynx`)은 색을 비워 CSS · 기본 터미널 팔레트로 돌아간다 */
export function setAppColorTheme(id: AppColorThemeId, isDark: boolean): void {
  const palette = appColorPalette(id, isDark);
  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = palette?.chrome[key];
  settings.current.app.dynamic = "off";
  settings.current.terminal.dynamic = palette
    ? { ...palette.term, [BEFORE_KEY]: isDark ? DEFAULT_TERM_PRESET : "aynx-light" }
    : undefined;
  settings.current.terminal.theme = palette ? fixedKeyFor(isDark) : (isDark ? undefined : "aynx-light");
  applySettings();
}

export function setCustomAppColor(hex: string, isDark: boolean): void {
  const palette = customPalette(hex, isDark);
  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = palette.chrome[key];
  settings.current.app.dynamic = "off";
  settings.current.terminal.theme = fixedKeyFor(isDark);
  settings.current.terminal.dynamic = {
    ...palette.term,
    [BEFORE_KEY]: isDark ? DEFAULT_TERM_PRESET : "aynx-light",
    [SOURCE_KEY]: palette.source,
  };
  applySettings();
}

/** 소스색 칸([`SOURCE_KEY`])이 없는 옛 파일을 위한 보조 — 파일에 적지 않는다 */
let rememberedSource: number | null = null;

export function rememberDynamicSource(argb: number | null): void {
  rememberedSource = argb === null ? null : argb >>> 0;
}

/** 지금 크롬 여덟 칸이 정말 그 소스에서 나왔을 때만 믿는다 — 다른 사진의 소스가 남아도 엉뚱한 색으로 풀지 않는다 */
export function currentDynamicSource(cur: AppSettings = settings.current): number | null {
  if (cur.app.dynamic !== "full") return null;
  return wallpaperChromeSource(cur);
}

/** `full` 여부는 보지 않는다 — full 에서 터미널 프리셋을 따로 골라 `off` 로 내려가도 크롬은 그 사진의 것이라 밝기를 따라와야 한다 */
function wallpaperChromeSource(cur: AppSettings = settings.current): number | null {
  const stored = sourceArgbFromHex(cur.terminal.dynamic?.[SOURCE_KEY]);
  for (const argb of [stored, rememberedSource]) {
    if (argb !== null && chromeFromSource(cur.app, argb)) return argb;
  }
  return null;
}

/**
 * 월페이퍼 추출(full)도 여기서 동기로 바꾼다 — `data-theme` 을 바꾸는 같은 틱이라야 "속성은 라이트, 토큰은 다크" 인
 * 프레임(검은 깜빡임)이 생기지 않는다. 소스를 모르면 그대로 두고 `modeChanged` 의 재추출이 채운다.
 */
export function syncAppColorTheme(isDark: boolean): void {
  syncAppColorThemeOn(settings.current, isDark);
}

/** 원격 폰은 `settings.current` 의 사본에 건다 — 사본이라 저장 · [취소] 비교에 닿지 않는다 */
export function syncAppColorThemeOn(cur: AppSettings, isDark: boolean): void {
  if (cur.app.dynamic === "full") {
    const argb = currentDynamicSource(cur);
    if (argb === null) return;
    const palette = cachedPaletteFromSource(argb, isDark);
    for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
    // full 이면 터미널 프리셋은 언제나 `dynamic` · `dynamic-dark` · `dynamic-light` 다(`setTermPreset` 이 다른 키를 고르면 full 을 내린다)
    const before = cur.terminal.dynamic?.[BEFORE_KEY];
    const map: Record<string, string> = { ...palette.term, [SOURCE_KEY]: palette.source };
    if (before) map[BEFORE_KEY] = before;
    cur.terminal.dynamic = map;
    return;
  }
  const id = selectedAppColorTheme(cur.app);
  const source = selectedCustomSource(cur);
  if ((!id || id === "aynx") && !source) {
    // full 을 떠난 월페이퍼 크롬 — 크롬만 다시 풀고 고른 터미널 프리셋은 그대로 둔다
    const argb = wallpaperChromeSource(cur);
    if (argb === null) return;
    const palette = cachedPaletteFromSource(argb, isDark);
    for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
    return;
  }
  const palette = source ? customPalette(source, isDark) : appColorPalette(id!, isDark)!;
  for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
  if (isDynamicTermKey(cur.terminal.theme)) {
    cur.terminal.dynamic = {
      ...palette.term,
      [BEFORE_KEY]: isDark ? DEFAULT_TERM_PRESET : "aynx-light",
      ...(source ? { [SOURCE_KEY]: source } : {}),
    };
  }
}

export function setUiScale(pct: number) {
  settings.current.app.ui_scale = normalizeUiScale(pct);
  applySettings();
}

export function setUiFontFamily(value: string) {
  settings.current.app.ui_font_family = text(value);
  applySettings();
}

export function setOpacity(pct: number) {
  if (!Number.isFinite(pct)) return;
  const v = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(pct)));
  settings.current.app.opacity = v === DEFAULT_OPACITY ? undefined : v;
}

export function setTermOpacity(pct: number) {
  if (!Number.isFinite(pct)) return;
  const v = Math.min(TERM_OPACITY_MAX, Math.max(TERM_OPACITY_MIN, Math.round(pct)));
  settings.current.terminal.opacity = v === DEFAULT_TERM_OPACITY ? undefined : v;
}

export function setTabStyle(key: string) {
  const valid = key in TAB_STYLES ? (key as TabStyle) : DEFAULT_TAB_STYLE;
  settings.current.terminal.tab_style = valid === DEFAULT_TAB_STYLE ? undefined : valid;
}

export function setTiling(key: string) {
  const valid = key in TILING_MODES ? (key as TilingMode) : DEFAULT_TILING;
  settings.current.app.tiling = valid === DEFAULT_TILING ? undefined : valid;
}

export function setTileHeader(key: string) {
  const valid = key in TILE_HEADER_MODES ? (key as TileHeaderMode) : DEFAULT_TILE_HEADER;
  settings.current.app.tile_header = valid === DEFAULT_TILE_HEADER ? undefined : valid;
}

export function setHeaderChipOrder(order: readonly string[]) {
  const next = normalizeChipOrder(order);
  settings.current.app.header_chip_order = isDefaultChipOrder(next) ? undefined : next;
}

/** 파일에는 끈 것을 적는다 */
export function setHeaderChipShown(id: HeaderChipId, on: boolean) {
  const hidden = normalizeChipHidden(settings.current.app.header_chips_hidden).filter((x) => x !== id);
  const next = on ? hidden : normalizeChipHidden([...hidden, id]);
  settings.current.app.header_chips_hidden = next.length > 0 ? next : undefined;
  // 옛 키가 남아 있으면(정규화 전 값) 켬끔을 이 칸 하나가 쥐게 비운다
  settings.current.app.resource_chip = undefined;
}

export function resetHeaderChips() {
  settings.current.app.header_chip_order = undefined;
  settings.current.app.header_chips_hidden = undefined;
  settings.current.app.resource_chip = undefined;
}

export function setResourceRings(on: boolean) {
  settings.current.app.resource_rings = on ? undefined : false;
}

export function setUsageRings(on: boolean) {
  settings.current.app.usage_rings = on ? undefined : false;
}

export function setWindowControls(on: boolean) {
  settings.current.app.window_controls = on ? true : undefined;
}

export function setStatusBar(key: string) {
  const valid = key in STATUS_BAR_POSITIONS ? (key as StatusBarPosition) : DEFAULT_STATUS_BAR;
  settings.current.app.status_bar = valid === DEFAULT_STATUS_BAR ? undefined : valid;
}

export function setStatusBarStyle(key: string) {
  const valid = key in STATUS_BAR_STYLES ? (key as StatusBarStyle) : DEFAULT_STATUS_BAR_STYLE;
  settings.current.app.status_bar_style = valid === DEFAULT_STATUS_BAR_STYLE ? undefined : valid;
}

export function setDockLayout(key: string) {
  const valid = key in DOCK_LAYOUTS ? (key as keyof typeof DOCK_LAYOUTS) : DEFAULT_DOCK_LAYOUT;
  settings.current.dock.layout = valid === DEFAULT_DOCK_LAYOUT ? undefined : valid;
}

export function setMaterial(key: string) {
  const valid = key in MATERIALS ? (key as Material) : DEFAULT_MATERIAL;
  settings.current.app.material = valid === DEFAULT_MATERIAL ? undefined : valid;
}

/** 곧바로 걸리고(`applySettings` → Rust `set_app_icon`) 저장은 설정 [저장] 이 한다 — [취소] 가 저장된 아이콘으로 되돌린다 */
export function setAppIcon(key: string): void {
  const valid = isAppIconId(key) ? key : DEFAULT_APP_ICON;
  settings.current.app.app_icon = valid === DEFAULT_APP_ICON ? undefined : valid;
  applySettings();
}


// ── 월페이퍼에서 뽑은 색 ── (docs/log/2026-09-04-dynamic-color.md)

export function adoptDynamicPalette(palette: DynamicPalette) {
  // 되돌아갈 프리셋은 처음 켜기 직전의 것이다 — 재추출 때 이어받지 않으면 `before-theme` 이 "dynamic" 이 되어 되돌아갈 자리를 잃는다
  const before = isDynamicTermKey(settings.current.terminal.theme)
    ? settings.current.terminal.dynamic?.[BEFORE_KEY]
    : (settings.current.terminal.theme ?? DEFAULT_TERM_PRESET);
  const termKey = fixedKeyFor(!isLightBackground(palette.term.background));

  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = palette.chrome[key];
  settings.current.app.dynamic = "full";

  // 소스색도 남긴다 — 밝기를 바꿀 때 사진 없이 동기로 다시 풀기 위해서다
  const map: Record<string, string> = { ...palette.term, [SOURCE_KEY]: palette.source };
  if (before) map[BEFORE_KEY] = before;
  settings.current.terminal.dynamic = map;
  settings.current.terminal.theme = termKey;

  applySettings();
}

/**
 * 크롬 색은 이전 값으로 복원하지 않고 비운다 — 되살리려면 여덟 칸의 그림자 테이블을 파일에 들고 있어야 해서 하지 않는다.
 * 터미널 프리셋 키 하나만 팔레트 테이블의 `before-theme` 으로 되돌린다.
 */
export function clearDynamicTheme() {
  const before = settings.current.terminal.dynamic?.[BEFORE_KEY];
  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = undefined;
  settings.current.app.dynamic = undefined;
  settings.current.terminal.dynamic = undefined;
  settings.current.terminal.theme =
    before && before !== DEFAULT_TERM_PRESET && (before in TERM_PRESETS || isUserTermKey(before)) ? before : undefined;
  applySettings();
}

// ── 월페이퍼 ── (docs/log/2026-09-04-wallpaper.md)
// `file` 만은 setter 가 없다 — 고르는 순간 파일 복사가 일어나 되돌릴 수 없어 백엔드가 직접 쓴다(`wallpaper_set`/`wallpaper_clear`).

export function setWallpaperDim(pct: number) {
  const v = clampInt(pct, WALLPAPER_DIM_MIN, WALLPAPER_DIM_MAX);
  settings.current.wallpaper.dim = v === undefined || v === DEFAULT_WALLPAPER_DIM ? undefined : v;
}

export function setWallpaperBlur(px: number) {
  const v = clampInt(px, WALLPAPER_BLUR_MIN, WALLPAPER_BLUR_MAX);
  settings.current.wallpaper.blur = v === undefined || v === WALLPAPER_BLUR_MIN ? undefined : v;
}

export function setWallpaperFit(key: string) {
  const valid = key in WALLPAPER_FITS ? (key as WallpaperFit) : DEFAULT_WALLPAPER_FIT;
  settings.current.wallpaper.fit = valid === DEFAULT_WALLPAPER_FIT ? undefined : valid;
}

/** `current` 와 `saved` 를 함께 옮긴다 — `saved` 를 안 옮기면 [취소] 가 지워진 사본의 이름을 되살려 깨진 배경을 만든다 */
export function adoptWallpaperFile(file: string | undefined) {
  settings.current.wallpaper.file = file;
  settings.saved.wallpaper.file = file;
}
