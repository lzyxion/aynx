// 설정 전역 상태(`settings` · `settingsNav`) · 화면 적용 · 읽기/저장 · 창 사이 알림.
// 모듈 수준의 바뀌는 상태(은은하게 소스색 · 확대 계수 · 창 라벨)는 이 파일에만 산다.
import { invoke, emit } from "../../ipc";
import { syncGateTheme } from "$lib/gate-theme";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { FileView } from "$lib/session";
import { migrateFileView } from "$lib/session/spec";
import type { StartScreenMode } from "$lib/project-start";
import type { DockLayout } from "$lib/dock";
import type { ExecSort } from "$lib/console/exec-rows";
import { resolveMessengerRules } from "$lib/messenger-notify";
import { DEFAULT_UI_SCALE, compensatedFontSize, noteAppliedZoom, zoomFactor } from "$lib/ui-scale";
import {
  DEFAULT_TERM_PRESET,
  termThemeOf,
  termTone,
  withScrollbarSlider,
  withTransparentCanvas,
  type FixedDynamicTerms,
  type UserTermLookup,
  type UserTermTheme,
} from "$lib/theme";
import { compileTriggers } from "$lib/triggers";
import { normalizeChipHidden, normalizeChipOrder, type HeaderChipId } from "$lib/header-chips";
import {
  DERIVED_TOKENS,
  M3_TOKENS,
  TINT_OWNER,
  TINT_TOKENS,
  derivedChromeTokens,
  dynamicTermTheme,
  resolveDynamicMode,
  subtleTint,
  type DynamicMode,
  type TintToken,
} from "$lib/dynamic-color";
import type { ITheme } from "@xterm/xterm";
import type { AppSettings, AutomationPrefs } from "./schema";
import {
  APP_TOKENS,
  DEFAULT_BELL,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FILE_VIEW,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_HOST_SORT,
  DEFAULT_EXEC_SORT,
  DEFAULT_MARK_AFTER_SECS,
  DEFAULT_NOTIFY_AFTER_SECS,
  DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  DEFAULT_OPACITY,
  DEFAULT_PROJECT_START_SCREEN,
  DEFAULT_AI_ICON_STYLE,
  DEFAULT_AI_AVATARS,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_RIGHT_CLICK,
  DEFAULT_STATUS_BAR,
  DEFAULT_STATUS_BAR_STYLE,
  DEFAULT_MATERIAL,
  DEFAULT_APP_ICON,
  DEFAULT_TAB_STYLE,
  DEFAULT_TERM_OPACITY,
  DEFAULT_TILE_HEADER,
  DEFAULT_TILING,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_FIT,
  LIGATURE_FONT_FAMILY,
  WALLPAPER_BLUR_MIN,
  type AiIconStyle,
  type BellMode,
  type CursorStyle,
  type HostSort,
  type RightClickMode,
  type StatusBarPosition,
  type StatusBarStyle,
  type Material,
  type TabStyle,
  type TileHeaderMode,
  type TilingMode,
  type WallpaperFit,
} from "./options";
import { cloneSettings, emptySettings, normalizeSettings, sameSettings } from "./normalize";
import { sendSnapshot } from "./payload";
import { APP_TOKEN_KEYS, describeError } from "./internal";
import { rememberSplashColors, rememberSplashIcon } from "$lib/splash-memo";
import { appM3Tokens, cachedFixedDynamicTerms, upgradeLegacyAppColors } from "$lib/app-color-themes";

// ── 이 기기 보기 층 ──
// 원격 폰의 "이 기기" 값(글자 크기 · 밝기)을 `settings.current` 를 건드리지 않고 화면에만 얹는다 — 원격 창의 저장이 그 값을 메인 PC 의 `settings.toml` 에 싣지 않게.

let deviceFontSize = $state<number | null>(null);
/** 이 기기 밝기로 바꾼 설정 사본 — 색 토큰 · 터미널 팔레트만 본다 */
let deviceView = $state<AppSettings | null>(null);

export function setDeviceFontSize(px: number | null): void {
  if (deviceFontSize !== px) deviceFontSize = px;
}

/** 다시 칠하는 것은 부르는 쪽(`applySettings`) */
export function setDeviceView(view: AppSettings | null): void {
  deviceView = view;
}

function colorSource(): AppSettings {
  return deviceView ?? settings.current;
}

/** `current` 는 화면에 지금 적용 중인 값(미리보기 포함), `saved` 는 마지막으로 파일에 들어간 값이다 — [취소] 는 `saved` 로 되돌린다 */
class SettingsStore {
  current = $state<AppSettings>(emptySettings());
  saved = $state<AppSettings>(emptySettings());

  dynamicTerm = $derived<ITheme | undefined>(dynamicTermTheme(this.current.terminal.dynamic));
  /** 저장하지 않는다 — 앱 색 테마 · 사용자 색 · 월페이퍼 원천에서 다시 낸다 */
  dynamicFixedTerms = $derived<FixedDynamicTerms>(cachedFixedDynamicTerms(this.current));
  dynamicTheme = $derived(this.current.app.dynamic === "full");
  dynamicMode = $derived<DynamicMode>(
    resolveDynamicMode(this.current.app.dynamic, !!this.current.wallpaper.file),
  );
  /** 설정 파일 밖(`<설정 루트>/terminal-themes/`)이라 `current`/`saved` 에 들지 않는다 */
  userTermThemes = $state<UserTermTheme[]>([]);
  /** `[app] mode` 를 함께 읽어 모드가 바뀔 때 다시 계산되게 한다(모드의 진실은 `<html data-theme>`) */
  userTermLookup = $derived.by((): UserTermLookup => {
    void this.current.app.mode;
    return { themes: Object.fromEntries(this.userTermThemes.map((u) => [u.id, u])), light: isLightNow() };
  });
  termTheme = $derived<ITheme>(
    deviceView
      ? termThemeOf(
          deviceView.terminal.theme,
          dynamicTermTheme(deviceView.terminal.dynamic),
          this.userTermLookup,
          cachedFixedDynamicTerms(deviceView),
        )
      : termThemeOf(this.current.terminal.theme, this.dynamicTerm, this.userTermLookup, this.dynamicFixedTerms),
  );
  presetKey = $derived(this.current.terminal.theme ?? DEFAULT_TERM_PRESET);
  fontFamily = $derived(this.current.terminal.font_family ?? DEFAULT_FONT_FAMILY);
  /** `fontFamilyEffective` 가 이 값을 읽으므로 위에 둔다 */
  ligatures = $derived(this.current.terminal.ligatures ?? false);
  fontFamilyEffective = $derived(
    this.ligatures && this.current.terminal.font_family == null
      ? LIGATURE_FONT_FAMILY
      : this.fontFamily,
  );
  fontSize = $derived(this.current.terminal.font_size ?? DEFAULT_FONT_SIZE);
  uiScale = $derived(this.current.app.ui_scale ?? DEFAULT_UI_SCALE);
  /** 웹뷰 확대가 CSS px 를 키우므로 `fontSize` 를 UI 배율로 나눠 xterm 에 넘긴다 — 설정 칸의 숫자는 여전히 `fontSize` 다 */
  termFontSize = $derived(compensatedFontSize(deviceFontSize ?? this.fontSize, zoomFactor(this.uiScale)));
  webgl = $derived(this.current.terminal.webgl ?? true);
  cursorStyle = $derived<CursorStyle>(
    (this.current.terminal.cursor_style ?? DEFAULT_CURSOR_STYLE) as CursorStyle,
  );
  opacity = $derived(this.current.app.opacity ?? DEFAULT_OPACITY);
  /** 100 이면 `allowTransparency` 를 켜지 않고 `theme.background` 도 예전 hex 그대로라 렌더 경로가 바뀌지 않는다 */
  termOpacity = $derived(this.current.terminal.opacity ?? DEFAULT_TERM_OPACITY);
  /** 100 미만이면 캔버스 배경을 완전 투명으로 비운다 — 칠하는 층이 `--term-bg-fill` 하나여야 알파가 두 번 곱해지지 않는다 */
  termThemeEffective = $derived<ITheme>(
    withScrollbarSlider(withTransparentCanvas(this.termTheme, this.termOpacity)),
  );
  /** `+page` 의 부팅이 이 값을 읽으므로 `loadSettings` 가 끝난 뒤에 복원을 판단한다 */
  autoReconnect = $derived(this.current.app.auto_reconnect ?? false);
  trayOnClose = $derived(this.current.app.tray_on_close ?? true);
  headerChipOrder = $derived<readonly HeaderChipId[]>(normalizeChipOrder(this.current.app.header_chip_order));
  headerChipsHidden = $derived<readonly HeaderChipId[]>(normalizeChipHidden(this.current.app.header_chips_hidden));
  headerChipsShown = $derived<readonly HeaderChipId[]>(
    this.headerChipOrder.filter((id) => !this.headerChipsHidden.includes(id)),
  );
  resourceChip = $derived(!this.headerChipsHidden.includes("resource"));
  resourceRings = $derived(this.current.app.resource_rings ?? true);
  usageRings = $derived(this.current.app.usage_rings ?? true);
  windowControls = $derived(this.current.app.window_controls === true);
  tabStyle = $derived<TabStyle>((this.current.terminal.tab_style ?? DEFAULT_TAB_STYLE) as TabStyle);
  rightClick = $derived<RightClickMode>(
    (this.current.terminal.right_click ?? DEFAULT_RIGHT_CLICK) as RightClickMode,
  );
  confirmMultilinePaste = $derived(this.current.terminal.confirm_multiline_paste ?? true);
  inlineSnippets = $derived(this.current.terminal.inline_snippets ?? true);
  osc52Clipboard = $derived(this.current.terminal.osc52_clipboard ?? true);
  oscNotify = $derived(this.current.terminal.osc_notify ?? true);
  inlineImages = $derived(this.current.terminal.inline_images ?? true);
  /** 실제로 argv 를 정하는 것은 백엔드다 — 여기는 설정 화면의 토글만 읽는다 */
  localShellIntegration = $derived(this.current.terminal.local_shell_integration ?? true);
  notifyAfterSecs = $derived(
    this.current.terminal.notify_after_secs ?? DEFAULT_NOTIFY_AFTER_SECS,
  );
  markAfterSecs = $derived(this.current.terminal.mark_after_secs ?? DEFAULT_MARK_AFTER_SECS);
  bell = $derived<BellMode>((this.current.terminal.bell ?? DEFAULT_BELL) as BellMode);
  tiling = $derived<TilingMode>((this.current.app.tiling ?? DEFAULT_TILING) as TilingMode);
  tileHeader = $derived<TileHeaderMode>(
    (this.current.app.tile_header ?? DEFAULT_TILE_HEADER) as TileHeaderMode,
  );
  statusBar = $derived<StatusBarPosition>(
    (this.current.app.status_bar ?? DEFAULT_STATUS_BAR) as StatusBarPosition,
  );
  statusBarStyle = $derived<StatusBarStyle>(
    (this.current.app.status_bar_style ?? DEFAULT_STATUS_BAR_STYLE) as StatusBarStyle,
  );
  material = $derived<Material>((this.current.app.material ?? DEFAULT_MATERIAL) as Material);
  appIcon = $derived<string>(this.current.app.app_icon ?? DEFAULT_APP_ICON);
  idleLockMin = $derived(this.current.app.idle_lock_min ?? 0);
  /** 얕은 복사본이어야 구독하는 `$effect` 가 원소 안쪽(`pattern` · 색)까지 의존성으로 잡는다 */
  triggers = $derived(this.current.triggers.map((t) => ({ ...t })));
  keybindings = $derived({ ...this.current.keybindings });
  defaultShell = $derived(this.current.shell.default ?? undefined);
  aiStartDir = $derived(this.current.ai.start_dir ?? undefined);
  notifyTurnEnd = $derived(this.current.ai.notify_turn_end ?? true);
  notifyPermission = $derived(this.current.ai.notify_permission ?? true);
  notifySideChat = $derived(this.current.ai.notify_side_chat ?? true);
  notifyFocusedAfterSecs = $derived(
    this.current.ai.notify_focused_after_secs ?? DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  );
  codexNoDaemon = $derived(this.current.ai.codex_no_daemon ?? true);
  claudeStatusline = $derived(this.current.ai.claude_statusline ?? true);
  chatTile = $derived(this.current.ai.chat_tile === true);
  aiIconStyle = $derived<AiIconStyle>((this.current.ai.icon_style ?? DEFAULT_AI_ICON_STYLE) as AiIconStyle);
  aiAvatarClaude = $derived<string>(this.current.ai.avatar_claude ?? DEFAULT_AI_AVATARS.claude);
  aiAvatarCodex = $derived<string>(this.current.ai.avatar_codex ?? DEFAULT_AI_AVATARS.codex);
  disabledAgents = $derived<readonly string[]>(this.current.ai.disabled_agents ?? []);
  messenger = $derived(resolveMessengerRules(this.current.messenger));
  /** 화면에 그릴 URL 은 이 이름이 아니라 `$lib/wallpaper.svelte.js` 의 `wallpaper.src` 다 */
  wallpaperFile = $derived(this.current.wallpaper.file ?? undefined);
  wallpaperDim = $derived(this.current.wallpaper.dim ?? DEFAULT_WALLPAPER_DIM);
  wallpaperBlur = $derived(this.current.wallpaper.blur ?? WALLPAPER_BLUR_MIN);
  wallpaperFit = $derived<WallpaperFit>(
    (this.current.wallpaper.fit ?? DEFAULT_WALLPAPER_FIT) as WallpaperFit,
  );
  triggerErrors = $derived(compileTriggers(this.current.triggers).errors);
  automationPrefs = $derived<AutomationPrefs>(this.current.automation);
  hostSort = $derived<HostSort>((this.current.hosts.sort ?? DEFAULT_HOST_SORT) as HostSort);
  execSort = $derived<ExecSort>((this.current.plans.exec_sort ?? DEFAULT_EXEC_SORT) as ExecSort);
  fileDefaultView = $derived<FileView>(migrateFileView(this.current.files.default_view) ?? DEFAULT_FILE_VIEW);
  fileAutoRefresh = $derived(this.current.files.auto_refresh ?? true);
  autoCheckUpdates = $derived(this.current.updates.auto_check ?? true);
  projectStartScreen = $derived<StartScreenMode>(
    (this.current.projects.start_screen ?? DEFAULT_PROJECT_START_SCREEN) as StartScreenMode,
  );
  dockLayout = $derived<DockLayout>((this.current.dock.layout ?? DEFAULT_DOCK_LAYOUT) as DockLayout);
  dirty = $derived(!sameSettings(this.current, this.saved));
}

export const settings = new SettingsStore();

/**
 * 설정 화면을 열면서 펴 줄 섹션 — `SettingsModal` 이 한 번 읽고 비운다(남으면 다음에 엉뚱한 섹션이 펴진다).
 * `anchor` 를 먼저 적고 `want` 를 적는다 — 읽는 쪽은 `want` 를 보고 깨어난다.
 */
export const settingsNav = $state<{ want: string | null; anchor: string | null }>({
  want: null,
  anchor: null,
});

/** `mode.svelte.ts` 를 import 하지 않는다 — 저쪽이 이 모듈의 setter 를 불러 순환이 된다 */
function isLightNow(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
}

export function applySettings() {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const color = colorSource();
  for (const key of APP_TOKEN_KEYS) {
    const value = color.app[key];
    if (value) root.style.setProperty(APP_TOKENS[key], value);
    else root.style.removeProperty(APP_TOKENS[key]);
  }

  // 동적 테마 플래그가 아니라 "그 칸이 정해졌는가" 를 본다 — 강조색만 고른 사람도 선택 행 배경이 따라와야 한다.
  // 지울 때는 목록 전부를 훑는다 — 이번에 만들지 못한 칸이 인라인에 남아 지난 팔레트 색으로 걸리지 않게.
  const derived = derivedChromeTokens(color.app, !isLightNow());
  for (const name of DERIVED_TOKENS) {
    const value = derived[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  const m3 = appM3Tokens(color, !isLightNow());
  for (const name of M3_TOKENS) {
    const value = m3?.[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  // 은은하게가 칠하는 자리 중 저장 칸이 아닌 넷(호버 · 칩 · 흐린 글자)은 별칭이라 위 루프가 걷지 않는다 — 지난 틴트가
  // 인라인에 남아 다음 틴트의 기준이 되거나(겹쳐 칠함) 은은하게를 끈 뒤에도 남지 않게 먼저 걷는다
  for (const name of TINT_TOKENS) {
    if (!(Object.values(APP_TOKENS) as string[]).includes(name)) root.style.removeProperty(name);
  }

  applyWallpaperTint(root);

  // 캔버스 바깥(안쪽 여백)까지 덮어야 해 CSS 토큰으로도 든다 — 터미널 투명도를 켜면 이 토큰(`--term-bg-fill`)만 칠한다.
  const termBg = settings.termTheme.background;
  if (termBg) root.style.setProperty("--term-bg", termBg);
  else root.style.removeProperty("--term-bg");
  const termFg = settings.termTheme.foreground;
  if (termFg) root.style.setProperty("--term-fg", termFg);
  else root.style.removeProperty("--term-fg");
  // 터미널 바탕의 밝기 — 터미널 바탕 위의 AI 권한 단계 색(`theme.css` 의 `--ai-term-lv*`)이 앱 테마가 아니라 이것을 따른다
  const tone = termTone(termBg, termFg);
  if (tone) root.dataset.termTone = tone;
  else delete root.dataset.termTone;

  const uiFont = settings.current.app.ui_font_family;
  if (uiFont) root.style.setProperty("--font-ui", uiFont);
  else root.style.removeProperty("--font-ui");

  applyUiZoom(zoomFactor(settings.current.app.ui_scale));

  syncAppIcon();
  // 다음 시작의 스플래시가 이 색으로 뜬다 — 토큰을 다 얹은 **뒤**라야 계산값이 맞다 (`splash-memo.ts`)
  rememberSplashColors(root);
  syncGateTheme(root);
}

/** `applySettings` 는 슬라이더를 끌 때도 불리므로 바뀐 때만 넘긴다 — `null` = 아직 안 넘김(첫 적용은 늘 넘긴다) */
let appliedAppIcon: string | null = null;

/** Rust 가 열린 모든 창에 건다 — 새 창은 Rust 가 스스로 건다(`on_page_load`) */
function syncAppIcon(): void {
  const id = settings.current.app.app_icon ?? DEFAULT_APP_ICON;
  if (id === appliedAppIcon) return;
  appliedAppIcon = id;
  rememberSplashIcon(id);
  void invoke("set_app_icon", { id }).catch((e) => {
    console.warn("[aynx] 앱 아이콘을 바꾸지 못했습니다 (무시):", describeError(e));
  });
}

/**
 * 은은하게의 소스색(ARGB) — 이번 실행에서만 든다. 파일에 적지 않는다 — 칠하는 값이 지금 모드의 `theme.css` 기본값에서
 * 그때그때 나와 적으면 곧 낡고, 소스색만 적으면 월페이퍼가 바뀔 때마다 사용자가 누르지 않은 저장이 생긴다.
 */
let wallpaperTintSource: number | null = null;

export function adoptWallpaperTint(argb: number | null): void {
  if (wallpaperTintSource === argb) return;
  wallpaperTintSource = argb;
  applySettings();
}

/**
 * `applySettings` 의 색 두 단계 바로 뒤에 돌아야 `getComputedStyle` 값이 곧 지금 모드의 `theme.css` 기본값이다.
 * 사용자가 정한 칸(`TINT_OWNER`)은 칠하지 않는다 — 색 선택기가 보여 주는 값과 화면이 달라지면 안 된다.
 */
function applyWallpaperTint(root: HTMLElement): void {
  if (wallpaperTintSource === null || settings.dynamicMode !== "subtle") return;
  const computed = getComputedStyle(root);
  const base: Partial<Record<TintToken, string>> = {};
  for (const name of TINT_TOKENS) {
    if (colorSource().app[TINT_OWNER[name]]) continue;
    base[name] = computed.getPropertyValue(name).trim();
  }
  const tint = subtleTint(base, wallpaperTintSource, !isLightNow());
  for (const name of TINT_TOKENS) {
    const value = tint[name];
    if (value) root.style.setProperty(name, value);
  }
}

/** `null` 로 시작해 첫 호출은 늘 보낸다 — 웹뷰 확대는 새로고침을 넘어 남아 설정과 웹뷰 배율이 어긋날 수 있다 */
let requestedZoom: number | null = null;

/** 실패를 삼킨다 — 권한이 빠진 빌드 · Tauri 없는 자리에서 배율 하나로 설정 적용 전체가 멈추면 안 된다 */
function applyUiZoom(factor: number): void {
  if (requestedZoom === factor) return;
  requestedZoom = factor;
  let webview;
  try {
    webview = getCurrentWebview();
  } catch {
    return;
  }
  void webview
    .setZoom(factor)
    .then(() => noteAppliedZoom(factor))
    .catch((e: unknown) => {
      console.warn("[aynx] UI 크기를 걸지 못했습니다:", describeError(e));
      if (requestedZoom === factor) requestedZoom = null;
    });
}


// ── 창 사이 전파 — 보내는 쪽 ──
// 받는 쪽(`settings-sync.svelte.ts`)을 여기 두면 `mode` · `wallpaper` 와 순환이 된다.

export const SETTINGS_SAVED_EVENT = "settings-saved";

/**
 * 설정 값을 싣지 않는다 — 파일이 유일한 진실이라 받는 창이 다시 읽는다(백엔드 sanitize 로 깎였을 수 있다).
 * 라벨은 Tauri v2 `Event<T>` 에 보낸 창이 없어 자기 방송을 걸러 내려고 싣는다.
 */
export interface SettingsSavedPayload {
  from: string;
}

let windowLabel: string | null = null;

/**
 * 모듈 최상단에서 읽지 않는다 — Tauri 가 없는 자리(테스트)에서 던지면 설정 모듈 전체가 못 뜬다.
 * 실패해도 빈 문자열을 캐시한다 — 빈 라벨끼리는 같아 "자기 것으로 보고 무시" 쪽으로 떨어진다.
 */
export function thisWindowLabel(): string {
  if (windowLabel !== null) return windowLabel;
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    windowLabel = "";
  }
  return windowLabel;
}

/** 실패를 삼킨다 — 파일은 이미 쓰였으니 [저장] 이 성공한 저장을 실패로 보이면 안 된다. 백엔드가 `settings.toml` 을 직접 쓰는 월페이퍼 경로도 부른다 */
export function emitSettingsSaved(): void {
  const payload: SettingsSavedPayload = { from: thisWindowLabel() };
  void emit(SETTINGS_SAVED_EVENT, payload).catch(() => {});
}

/** 실패를 삼킨다 — 설정 파일이 없다고 앱이 못 뜨면 안 된다 */
export async function loadSettings(): Promise<void> {
  try {
    const raw = await invoke<AppSettings>("load_settings");
    settings.current = normalizeSettings(raw);
    // 옛 면 계단 크롬을 같은 테마의 MD3 크롬으로 — 파일은 다음 저장 때 바뀐다
    upgradeLegacyAppColors(settings.current);
    settings.saved = cloneSettings(settings.current);
  } catch (e) {
    console.warn("[aynx] 설정을 읽지 못했습니다 — 기본값으로 시작합니다:", describeError(e));
  }
  applySettings();
}

/** `loadSettings` 와 달리 실패를 삼키지 않는다. 실패 경로에서는 알리지 않는다 — 다른 창이 옛 값을 다시 읽어 편집을 날린다 */
export async function saveSettings(): Promise<void> {
  try {
    settings.saved = await sendSnapshot(settings.current, (payload) => invoke("save_settings", { settings: payload }));
  } catch (e) {
    throw new Error(describeError(e));
  }
  emitSettingsSaved();
}

export function setUserTermThemes(list: UserTermTheme[]): void {
  settings.userTermThemes = list;
  // `user:` 키의 팔레트가 이제 풀린다 — 부팅 때는 설정 적용 **뒤**에 목록이 오므로 `--term-bg` · `--term-fg` · `data-term-tone` 을 다시 옮겨 적는다
  applySettings();
}

/** 다른 미저장 편집을 싣지 않게 `saved` 사본을 고쳐 그 한 칸만 저장한다 */
export async function replaceTermPresetAndSave(gone: string, next: string | undefined): Promise<void> {
  const value = next === DEFAULT_TERM_PRESET ? undefined : next;
  if (settings.current.terminal.theme === gone) {
    settings.current.terminal.theme = value;
    applySettings();
  }
  if (settings.saved.terminal.theme !== gone) return;
  const snapshot = cloneSettings(settings.saved);
  snapshot.terminal.theme = value;
  try {
    settings.saved = await sendSnapshot(snapshot, (payload) => invoke("save_settings", { settings: payload }));
  } catch (e) {
    throw new Error(describeError(e));
  }
  emitSettingsSaved();
}

export function revertSettings() {
  settings.current = cloneSettings(settings.saved);
  applySettings();
}
