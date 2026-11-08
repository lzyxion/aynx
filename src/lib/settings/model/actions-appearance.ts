// 설정 화면 **앱 테마·모양** 손잡이 — 색 토큰 · UI 크기/글꼴 · 투명도 · 탭/타일/상태바 모양 ·
// 월페이퍼에서 뽑은 색 · 월페이퍼 (`AppThemeSection` · `GeneralSection` 일부).
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

/**
 * 색 테마를 새로 걸 때의 터미널 키 — 이미 고정 밝기(`dynamic-dark` · `dynamic-light`)를 골라 두었으면 그 밝기를 지키고,
 * 아니면(내장 프리셋 · 처음) 그때 앱 밝기의 고정 키다(2026-11-08 — 앱 밝기를 따르는 칸은 없다).
 */
function fixedKeyFor(isDark: boolean): string {
  const cur = settings.current.terminal.theme;
  return isFixedDynamicTermKey(cur) ? cur! : fixedDynamicTermKey(isDark);
}

/** 내장 테마는 전체 팔레트다. 기본(`aynx`)은 색을 비워 CSS·기본 터미널 팔레트로 돌아간다. */
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

/** 원천색은 기존 source-color 칸에 둔다. full과 달리 앱 dynamic은 off다. */
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

/**
 * 이번 실행에서 사진을 읽어 알아 둔 소스색 — 소스색 칸([`SOURCE_KEY`])이 없는 옛 파일을 위한
 * 보조다 (`dynamic-theme.svelte.ts` 의 `primeDynamicSource` 가 채운다). 파일에 적지 않는다.
 */
let rememberedSource: number | null = null;

export function rememberDynamicSource(argb: number | null): void {
  rememberedSource = argb === null ? null : argb >>> 0;
}

/**
 * 지금 걸린 **월페이퍼 추출(full)** 팔레트의 소스색 — 모르면 `null`.
 *
 * 적어 둔 칸을 먼저, 이번 실행에서 읽어 둔 값을 다음으로 보고, **지금 크롬 여덟 칸이 정말 그
 * 소스에서 나왔을 때만** 믿는다 (프로필·[취소]·손으로 고친 파일이 다른 사진의 소스를 남겨도
 * 엉뚱한 색으로 풀지 않는다).
 */
export function currentDynamicSource(cur: AppSettings = settings.current): number | null {
  if (cur.app.dynamic !== "full") return null;
  return wallpaperChromeSource(cur);
}

/**
 * 지금 크롬 여덟 칸이 **월페이퍼 추출 팔레트 그대로**라면 그 소스색 — `full` 여부는 보지 않는다.
 * full 에서 터미널 프리셋을 따로 고르면 `setTermPreset` 이 앱 쪽을 `off` 로 내리지만 크롬 색은 그 사진의
 * 것으로 남는다. 그 크롬도 밝기를 바꿀 때 따라와야 한다(10-17 — 터미널만 바뀌고 앱 화면은 그대로이던 버그).
 */
function wallpaperChromeSource(cur: AppSettings = settings.current): number | null {
  const stored = sourceArgbFromHex(cur.terminal.dynamic?.[SOURCE_KEY]);
  for (const argb of [stored, rememberedSource]) {
    if (argb !== null && chromeFromSource(cur.app, argb)) return argb;
  }
  return null;
}

/**
 * 밝기를 바꿔도 고른 색 계열을 유지한다. 별도로 고른 터미널 프리셋은 건드리지 않는다.
 *
 * **월페이퍼 추출(full)도 여기서 동기로 바꾼다** — 소스색을 알면 사진을 다시 읽지 않고 같은
 * 소스에서 새 밝기 팔레트를 푼다. 부르는 쪽(`mode.svelte.ts`)이 `data-theme` 을 바꾸는 같은
 * 틱이라 "속성은 라이트, 토큰은 다크" 인 프레임(검은 깜빡임)이 생기지 않는다. 소스를 모르면
 * 예전처럼 그대로 두고 `modeChanged` 의 재추출이 채운다.
 */
export function syncAppColorTheme(isDark: boolean): void {
  syncAppColorThemeOn(settings.current, isDark);
}

/**
 * [`syncAppColorTheme`] 의 몸통 — **고칠 설정을 받는다**. 원격 폰의 이 기기 밝기(`mode.svelte.ts`)가 `settings.current` 의 **사본**에
 * 같은 규칙을 걸어 화면에만 얹는다(사본이라 저장 · [취소] 비교에 닿지 않는다).
 */
export function syncAppColorThemeOn(cur: AppSettings, isDark: boolean): void {
  if (cur.app.dynamic === "full") {
    const argb = currentDynamicSource(cur);
    if (argb === null) return;
    const palette = cachedPaletteFromSource(argb, isDark);
    for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
    // full 이면 터미널 프리셋은 언제나 `dynamic` · `dynamic-dark` · `dynamic-light` 다 (`setTermPreset` 이 다른 키를 고르면 full 을 내린다).
    // 맵은 늘 새 밝기로 다시 서고, 고정 밝기 키는 맵이 다른 밝기면 그 반대를 그릴 때 낸다.
    const before = cur.terminal.dynamic?.[BEFORE_KEY];
    const map: Record<string, string> = { ...palette.term, [SOURCE_KEY]: palette.source };
    if (before) map[BEFORE_KEY] = before;
    cur.terminal.dynamic = map;
    return;
  }
  const id = selectedAppColorTheme(cur.app);
  const source = selectedCustomSource(cur);
  if ((!id || id === "aynx") && !source) {
    // full 을 떠난 월페이퍼 크롬 — 크롬만 새 밝기로 다시 풀고 고른 터미널 프리셋은 그대로 둔다(위 함수 주석).
    const argb = wallpaperChromeSource(cur);
    if (argb === null) return;
    const palette = cachedPaletteFromSource(argb, isDark);
    for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
    return;
  }
  const palette = source ? customPalette(source, isDark) : appColorPalette(id!, isDark)!;
  for (const key of APP_TOKEN_KEYS) cur.app[key] = palette.chrome[key];
  // 고정 밝기 키도 맵을 새 밝기로 다시 세운다 — 맵은 "지금 밝기" 이고 고정 키는 거기서 제 밝기를 다시 낸다
  if (isDynamicTermKey(cur.terminal.theme)) {
    cur.terminal.dynamic = {
      ...palette.term,
      [BEFORE_KEY]: isDark ? DEFAULT_TERM_PRESET : "aynx-light",
      ...(source ? { [SOURCE_KEY]: source } : {}),
    };
  }
}

/**
 * **UI 크기**(%)를 고른다 — 기본(100)·후보 밖 값은 정규화 규칙 그대로 접는다.
 * **바로 적용된다**(웹뷰 확대 + 터미널 글자 되돌려 맞추기) — 다른 손잡이와 같은 미리보기
 * 계약이라 파일에는 [저장] 이 쓰고 [취소] 면 되돌아온다.
 */
export function setUiScale(pct: number) {
  settings.current.app.ui_scale = normalizeUiScale(pct);
  applySettings();
}

/** **앱 글꼴** — 빈 칸이면 "안 정함"(= theme.css 기본 스택). 치는 동안 바로 걸린다 */
export function setUiFontFamily(value: string) {
  settings.current.app.ui_font_family = text(value);
  applySettings();
}

/**
 * 투명도(%)를 정한다 — 앱 배경(월페이퍼 · 없으면 번짐)이 크롬 · 타일에 비치는 정도. [`OPACITY_MIN`]~[`OPACITY_MAX`] 로
 * 잘라 정수로 두고, 기본값([`DEFAULT_OPACITY`])이면 값을 지운다 (기본값 추종 — 다른 설정과 같은 규칙).
 * 실제 화면 반영은 +page 의 $effect 가 `--chrome-pct` 를 갈아 끼우며 즉시 한다.
 */
export function setOpacity(pct: number) {
  if (!Number.isFinite(pct)) return;
  const v = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(pct)));
  settings.current.app.opacity = v === DEFAULT_OPACITY ? undefined : v;
}

/**
 * **터미널 칸** 불투명도(%)를 정한다 — 위 [`setOpacity`] 와 같은 모양이지만 다른 칸이다
 * (`[terminal] opacity`). 기본값(100)이면 값을 지운다 = 파일에도 안 남고 렌더 경로도 예전 그대로.
 *
 * 화면 반영은 두 갈래로 즉시 일어난다: 타일 배경은 +page 의 $effect 가 `--term-opacity` 를
 * 갈아 끼우고, xterm 자신의 배경은 `Terminal.svelte` 의 $effect 가 `theme` 를 다시 건다.
 */
export function setTermOpacity(pct: number) {
  if (!Number.isFinite(pct)) return;
  const v = Math.min(TERM_OPACITY_MAX, Math.max(TERM_OPACITY_MIN, Math.round(pct)));
  settings.current.terminal.opacity = v === DEFAULT_TERM_OPACITY ? undefined : v;
}

/** 탭 바 모양을 고른다. 기본 모양(pill)을 고르면 파일에 적지 않는다 (기본값 추종) */
export function setTabStyle(key: string) {
  const valid = key in TAB_STYLES ? (key as TabStyle) : DEFAULT_TAB_STYLE;
  settings.current.terminal.tab_style = valid === DEFAULT_TAB_STYLE ? undefined : valid;
}

/**
 * 타일 배치 방식을 고른다 — 기본(`spiral`)이면 값을 지운다 (탭 모양과 완전히 같은 규칙).
 * **바로 적용된다**: 다음에 여는 타일부터 새 규칙이 자리를 정한다 (이미 있는 배치는 그대로).
 */
export function setTiling(key: string) {
  const valid = key in TILING_MODES ? (key as TilingMode) : DEFAULT_TILING;
  settings.current.app.tiling = valid === DEFAULT_TILING ? undefined : valid;
}

/**
 * 타일 헤더를 언제 달지 고른다 — 기본(`always`)이면 값을 지운다 (타일 배치와 같은 규칙).
 *
 * **이미 열려 있는 타일에 바로 적용된다** (배치 설정과 다른 점이다): 헤더는 상자 안에
 * 형제 하나가 들고 나는 일일 뿐이라 `<Terminal>` 은 재마운트되지 않고, 줄었다 늘어난
 * 높이는 Terminal 의 ResizeObserver → refit 이 받아 낸다.
 */
export function setTileHeader(key: string) {
  const valid = key in TILE_HEADER_MODES ? (key as TileHeaderMode) : DEFAULT_TILE_HEADER;
  settings.current.app.tile_header = valid === DEFAULT_TILE_HEADER ? undefined : valid;
}

/**
 * 타일 머리줄 칩의 순서(설정 › 터미널 — 끌어서 · Alt+←/→). 정규화한 순서가 기본과 같으면 값을 지운다.
 * 열린 타일의 머리줄에 바로 적용된다(`settings.headerChipsShown`).
 */
export function setHeaderChipOrder(order: readonly string[]) {
  const next = normalizeChipOrder(order);
  settings.current.app.header_chip_order = isDefaultChipOrder(next) ? undefined : next;
}

/** 머리줄 칩 하나를 켜고 끈다 — 파일에는 **끈 것**을 적는다(비면 지운다 = 전부 켬) */
export function setHeaderChipShown(id: HeaderChipId, on: boolean) {
  const hidden = normalizeChipHidden(settings.current.app.header_chips_hidden).filter((x) => x !== id);
  const next = on ? hidden : normalizeChipHidden([...hidden, id]);
  settings.current.app.header_chips_hidden = next.length > 0 ? next : undefined;
  // 옛 키가 남아 있으면(정규화 전 값) 켬끔을 이 칸 하나가 쥐게 비운다
  settings.current.app.resource_chip = undefined;
}

/** 머리줄 칩의 순서 · 켬끔을 모두 기본으로 */
export function resetHeaderChips() {
  settings.current.app.header_chip_order = undefined;
  settings.current.app.header_chips_hidden = undefined;
  settings.current.app.resource_chip = undefined;
}

/** 상태바의 자원 고리(이 PC 전체 CPU · 메모리) — 기본이 켬이라 끌 때만 값을 남긴다 */
export function setResourceRings(on: boolean) {
  settings.current.app.resource_rings = on ? undefined : false;
}

/** 상태바의 사용량 고리(AI CLI 사용 한도) — 기본이 켬이라 끌 때만 값을 남긴다 */
export function setUsageRings(on: boolean) {
  settings.current.app.usage_rings = on ? undefined : false;
}

/** 제목줄의 창 단추(최소화 · 최대화 · 닫기) — 기본이 끔이라 켤 때만 값을 남긴다 */
export function setWindowControls(on: boolean) {
  settings.current.app.window_controls = on ? true : undefined;
}

/**
 * 상태바를 어느 가장자리에 둘지 고른다 — 기본(`left`)이면 값을 지운다 (타일 헤더와 같은 규칙).
 * **바로 적용된다**: `+page` 의 배치가 `settings.statusBar` 를 반응형으로 읽어 띠를 옮긴다.
 */
export function setStatusBar(key: string) {
  const valid = key in STATUS_BAR_POSITIONS ? (key as StatusBarPosition) : DEFAULT_STATUS_BAR;
  settings.current.app.status_bar = valid === DEFAULT_STATUS_BAR ? undefined : valid;
}

/**
 * 상태바를 어떤 모양으로 그릴지 고른다 — 기본(`flat`)이면 값을 지운다 (자리와 같은 규칙).
 * **바로 적용된다**: `StatusBar` 가 `settings.statusBarStyle` 를 반응형으로 읽어 모서리·여백을 바꾼다.
 */
export function setStatusBarStyle(key: string) {
  const valid = key in STATUS_BAR_STYLES ? (key as StatusBarStyle) : DEFAULT_STATUS_BAR_STYLE;
  settings.current.app.status_bar_style = valid === DEFAULT_STATUS_BAR_STYLE ? undefined : valid;
}

/**
 * 독 배치를 고른다(런처 독의 쪽 — 채팅 독은 늘 반대쪽) — 기본(`launcher-left`)이면 값을 지운다 (상태바 자리와 같은 규칙).
 * **바로 적용된다**: 두 독이 `settings.dockLayout` 을 반응형으로 읽어 제 쪽 · 가장자리 띠를 옮긴다.
 */
export function setDockLayout(key: string) {
  const valid = key in DOCK_LAYOUTS ? (key as keyof typeof DOCK_LAYOUTS) : DEFAULT_DOCK_LAYOUT;
  settings.current.dock.layout = valid === DEFAULT_DOCK_LAYOUT ? undefined : valid;
}

/**
 * 앱 크롬 재질을 고른다 — 기본(`glass`)이면 값을 지운다 (상태바 모양과 같은 규칙).
 * **바로 적용된다**: `mode.svelte.ts` 가 `settings.material` 을 반응형으로 읽어 `<html data-material>` 을 바꾼다.
 */
export function setMaterial(key: string) {
  const valid = key in MATERIALS ? (key as Material) : DEFAULT_MATERIAL;
  settings.current.app.material = valid === DEFAULT_MATERIAL ? undefined : valid;
}

/**
 * 앱 아이콘(창·작업 표시줄)을 고른다 — 기본(`gpt`)이면 값을 지운다
 * (docs/log/2026-10-04-app-icon-switch.md).
 *
 * **곧바로 걸리고, 저장은 설정 [저장] 이 한다**(2026-10-22 사용자 — 다른 모양 칸과 같은 미저장 변경): `applySettings` 가
 * Rust `set_app_icon` 을 불러 열린 모든 창 · 작업 표시줄 · 트레이에 미리보기로 건다. [취소](`revertSettings` → `applySettings` →
 * `syncAppIcon`)가 저장된 아이콘으로 되돌리고, [저장] 이 파일에 쓰고 고른 테마 프로필에도 지금 모양을 반영한다(`SettingsModal` 의
 * `save` — 묻지 않음).
 */
export function setAppIcon(key: string): void {
  // 내장 캐릭터 키 또는 사용자 아이콘 id(`user-<12hex>` — docs/log/2026-10-22-custom-app-icon.md). 그 밖은 기본.
  const valid = isAppIconId(key) ? key : DEFAULT_APP_ICON;
  settings.current.app.app_icon = valid === DEFAULT_APP_ICON ? undefined : valid;
  applySettings();
}


// ---------------------------------------------------------------------------
// 월페이퍼에서 뽑은 색 (docs/log/2026-09-04-dynamic-color.md)
//
// 여기 둘은 **상태를 옮기는 일**만 한다 — 이미지를 캔버스에 그려 색을 뽑는 것은
// `$lib/dynamic-theme.svelte.js` 다 (DOM 이 필요한 쪽과 설정을 아는 쪽을 갈랐다).
// ---------------------------------------------------------------------------

/** 뽑아낸 팔레트를 상태에 얹는다 — 크롬 토큰 여덟 칸 + 터미널 팔레트 + 프리셋 키 + 표시 */
export function adoptDynamicPalette(palette: DynamicPalette) {
  // 되돌아갈 프리셋은 **처음 켜기 직전**의 그것이다. 이미 켜져 있으면(=월페이퍼를 바꿔
  // 다시 뽑는 중) 그때 적어 둔 값을 그대로 이어받는다 — 안 그러면 두 번째 추출에서
  // `before-theme` 이 "dynamic" 이 되어 되돌아갈 자리를 잃는다. 고정 밝기 키도 같다(되돌아갈 자리는 가상 키가 아니다).
  const before = isDynamicTermKey(settings.current.terminal.theme)
    ? settings.current.terminal.dynamic?.[BEFORE_KEY]
    : (settings.current.terminal.theme ?? DEFAULT_TERM_PRESET);
  // 고정 밝기를 골라 둔 채면(재추출 · 다른 색 테마에서 월페이퍼로 옮김) 그 밝기를 지키고, 아니면 뽑은 팔레트 밝기의
  // 고정 키다(앱 색 테마를 새로 고를 때와 같은 규칙 — `fixedKeyFor`).
  const termKey = fixedKeyFor(!isLightBackground(palette.term.background));

  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = palette.chrome[key];
  settings.current.app.dynamic = "full";

  // 소스색도 같은 테이블에 남긴다 — 밝기를 바꿀 때 사진 없이 동기로 다시 풀기 위해서다.
  const map: Record<string, string> = { ...palette.term, [SOURCE_KEY]: palette.source };
  if (before) map[BEFORE_KEY] = before;
  settings.current.terminal.dynamic = map;
  settings.current.terminal.theme = termKey;

  applySettings();
}

/**
 * 동적 테마를 끈다 — 색 토큰 여덟 칸과 팔레트를 **비우고**, 터미널 프리셋만 켜기 직전
 * 값으로 되돌린다.
 *
 * 크롬 색을 "이전 값" 으로 복원하지 않고 **비우는**(= `theme.css` 기본값) 이유는, 켜는
 * 순간 사용자가 손으로 고른 색이 이미 덮여 버렸기 때문이다. 그 값을 되살리려면 여덟 칸을
 * 한 벌 더 파일에 들고 있어야 하는데(`[app.before_dynamic]` 같은 것), 껐다 켜는 한 번을
 * 위해 설정 파일에 그림자 테이블을 만드는 것은 값에 비해 비싸다. 프리셋 키 **하나**는
 * 팔레트 테이블에 얹을 수 있어서(`before-theme`) 그것만 되돌린다.
 */
export function clearDynamicTheme() {
  const before = settings.current.terminal.dynamic?.[BEFORE_KEY];
  for (const key of APP_TOKEN_KEYS) settings.current.app[key] = undefined;
  settings.current.app.dynamic = undefined;
  settings.current.terminal.dynamic = undefined;
  // 기본 프리셋이거나 지금은 없는 키면 "안 정함" 으로 둔다 (기본값 추종 — setTermPreset 과 같은 규칙).
  // 사용자 테마 키는 모양만 보고 되돌린다(파일이 없으면 그릴 때 같은 모드의 AYNX — `termThemeOf`).
  // `dynamic` · 고정 밝기 어느 쪽이었든 같다 — 맵이 사라지니 둘 다 그릴 것이 없다.
  settings.current.terminal.theme =
    before && before !== DEFAULT_TERM_PRESET && (before in TERM_PRESETS || isUserTermKey(before)) ? before : undefined;
  applySettings();
}

// ---------------------------------------------------------------------------
// 월페이퍼 (docs/log/2026-09-04-wallpaper.md)
//
// 세 손잡이(어둡게·블러·배치)는 **평범한 설정**이다 — 다른 값들처럼 상태만 바꾸면
// `+page` 의 `$effect` 가 즉시 화면에 반영하고, 파일에는 [저장] 이 쓴다.
//
// `file` 만은 여기 setter 가 없다. 이미지를 고르는 순간 파일 복사가 일어나 **되돌릴 수
// 없으므로** 그 한 칸은 백엔드가 직접 쓰고(`wallpaper_set`/`wallpaper_clear`),
// `$lib/wallpaper.svelte.js` 가 그 결과를 `current`·`saved` 양쪽에 반영한다
// (그래야 [취소] 가 이미 지워진 파일을 되살리려 들지 않는다).
// ---------------------------------------------------------------------------

/** 이미지 위 검정 덮개 %(0~100). 기본값이면 파일에 적지 않는다 (기본값 추종) */
export function setWallpaperDim(pct: number) {
  const v = clampInt(pct, WALLPAPER_DIM_MIN, WALLPAPER_DIM_MAX);
  settings.current.wallpaper.dim = v === undefined || v === DEFAULT_WALLPAPER_DIM ? undefined : v;
}

/** 배경 블러 px(0~20). 0(선명)이 기본이므로 그때는 값을 지운다 */
export function setWallpaperBlur(px: number) {
  const v = clampInt(px, WALLPAPER_BLUR_MIN, WALLPAPER_BLUR_MAX);
  settings.current.wallpaper.blur = v === undefined || v === WALLPAPER_BLUR_MIN ? undefined : v;
}

/** 배치를 고른다. 기본(`cover`)이면 파일에 적지 않는다 (프리셋·탭 모양과 같은 규칙) */
export function setWallpaperFit(key: string) {
  const valid = key in WALLPAPER_FITS ? (key as WallpaperFit) : DEFAULT_WALLPAPER_FIT;
  settings.current.wallpaper.fit = valid === DEFAULT_WALLPAPER_FIT ? undefined : valid;
}

/**
 * 백엔드가 쓴 `file` 을 상태에 **되받는다** (`$lib/wallpaper.svelte.js` 전용).
 *
 * `current` 와 `saved` 를 **함께** 옮기는 것이 요점이다. 파일 복사는 이미 끝났으므로
 * 이것은 "저장되지 않은 변경" 이 아니다 — `saved` 를 안 옮기면 설정 화면이 영원히
 * dirty 로 보이고, [취소] 가 지워진 사본의 이름을 되살려 깨진 배경을 만든다.
 */
export function adoptWallpaperFile(file: string | undefined) {
  settings.current.wallpaper.file = file;
  settings.saved.wallpaper.file = file;
}
