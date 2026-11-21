// 설정의 값 범위 — 범위 상수 · 기본값 · 선택지 표(키 → 문구 키) · 앱 색 토큰 표. 룬도 부수효과도 없다.
import type { Key } from "$lib/i18n/keys";
import type { FileView } from "$lib/session";
import type { StartScreenMode } from "$lib/project-start";
import type { AppTheme, AutomationPrefs } from "./schema";
import { DEFAULT_DOCK_LAYOUT, type DockLayout } from "$lib/dock";
import type { ExecSort } from "$lib/console/exec-rows";

/** 옛 `[vault] auto_lock_minutes` 의 기본값 — 아무도 읽지 않지만 이 값과 같으면 파일에 안 적는다 */
export const VAULT_AUTO_LOCK_DEFAULT = 30;

/** Rust `settings/normalize.rs` 의 `MIN/MAX_FONT_SIZE` 와 같은 값이어야 한다 */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/** Rust `settings/normalize.rs` 의 `MAX_TRIGGERS` 와 같은 값이어야 한다 */
export const MAX_TRIGGERS = 50;

/** Rust `settings/automation.rs` 와 같은 값이어야 한다 — 진짜 방어선은 Rust 이고 프런트의 clamp 는 화면 편의다 */
export const AUTO_MAX_TARGETS_DEFAULT = 10;
export const AUTO_MAX_TARGETS_MIN = 1;
export const AUTO_MAX_TARGETS_MAX = 100;
export const AUTO_MAX_CONCURRENCY_DEFAULT = 4;
export const AUTO_MAX_CONCURRENCY_MIN = 1;
export const AUTO_MAX_CONCURRENCY_MAX = 16;

/** 빈도 한도 — Rust `settings/automation.rs` 의 상수와 같아야 한다 */
export const AUTO_MAX_PER_WINDOW_DEFAULT = 20;
export const AUTO_MAX_PER_WINDOW_MIN = 1;
export const AUTO_MAX_PER_WINDOW_MAX = 1000;
export const AUTO_WINDOW_SECS_DEFAULT = 300;
export const AUTO_WINDOW_SECS_MIN = 1;
export const AUTO_WINDOW_SECS_MAX = 86400;

/** Rust `settings/automation.rs` 의 상수와 같아야 한다 — 하한 `0` 은 "너무 짧음" 이 아니라 만료 없음이다 */
export const APPROVAL_TTL_MINUTES_DEFAULT = 30;
export const APPROVAL_TTL_MINUTES_MIN = 0;
export const APPROVAL_TTL_MINUTES_MAX = 1440;

/** Rust `DEFAULT_NOTIFY_REVIEW_REQUESTS` 와 같아야 한다 */
export const NOTIFY_REVIEW_REQUESTS_DEFAULT = true;

/** Rust `DEFAULT_NOTIFY_OPERATION_RESULTS` 와 같아야 한다 */
export const NOTIFY_OPERATION_RESULTS_DEFAULT = true;

/** Rust `settings/automation.rs` 의 상수와 같아야 한다 — 하한 `0` 은 지우지 않음이다 */
export const AUDIT_RETENTION_DAYS_DEFAULT = 90;
export const AUDIT_RETENTION_DAYS_MIN = 0;
export const AUDIT_RETENTION_DAYS_MAX = 3650;

/** 백엔드 `Default` 와 짝이다 */
export function defaultAutomation(): AutomationPrefs {
  return {
    auto_approve: false,
    allow_patterns: [],
    bundles: [],
    bundle_off: {},
    max_targets: AUTO_MAX_TARGETS_DEFAULT,
    max_concurrency: AUTO_MAX_CONCURRENCY_DEFAULT,
    auto_max_per_window: AUTO_MAX_PER_WINDOW_DEFAULT,
    auto_window_secs: AUTO_WINDOW_SECS_DEFAULT,
    approval_ttl_minutes: APPROVAL_TTL_MINUTES_DEFAULT,
    notify_review_requests: NOTIFY_REVIEW_REQUESTS_DEFAULT,
    notify_operation_results: NOTIFY_OPERATION_RESULTS_DEFAULT,
    audit_retention_days: AUDIT_RETENTION_DAYS_DEFAULT,
    audit_output_excerpt: false,
    allow_pipes: false,
    allow: [],
  };
}

/** 내장 WARN 트리거와 같은 값(Rust `default_triggers`) — 배경은 45% 알파로 깔려 저채도 값은 화면에서 안 보인다 */
export const DEFAULT_TRIGGER_BG = "#6b4a17";

/**
 * `errorBg` 는 내장 ERROR 와 같다. 글자색(`*Fg`)은 다크(`#12141a`) · 흰 배경 둘 다에서
 * 대비 3.8 이상인 중간 밝기 값만 고른다.
 */
export const EXAMPLE_TRIGGER_COLORS = {
  fatalBg: "#9b1b30",
  errorBg: "#7a2637",
  warnBg: DEFAULT_TRIGGER_BG,
  failFg: "#d63c4e",
  passFg: "#1c9150",
  warnFg: "#a97b0c",
  infoFg: "#5b88a5",
} as const;

export const DEFAULT_FONT_FAMILY = "'Cascadia Mono', 'D2Coding', Consolas, monospace";
export const DEFAULT_FONT_SIZE = 14;
/** 60 은 글래스 판이 흐린 배경을 비추면서도 터미널 위 글자 대비 4.5:1 을 넘는 자리다(theme.css `--glass-dense`) */
export const DEFAULT_OPACITY = 60;
/** 0 을 열지 않는다 — 앱 크롬이 통째로 사라져 되돌릴 UI 자체가 안 보인다 */
export const OPACITY_MIN = 10;
export const OPACITY_MAX = 100;

/** 100 = 불투명 = 예전과 같은 렌더 경로. 크롬 투명도와 일부러 따로 둔다 — 글자 칸까지 비치면 대비가 무너진다 */
export const DEFAULT_TERM_OPACITY = 100;
/** 백엔드 `MIN_TERM_OPACITY` 와 같은 값이어야 한다 */
export const TERM_OPACITY_MIN = 10;
export const TERM_OPACITY_MAX = 100;

/** Rust `MIN/MAX_IDLE_LOCK_MIN` 과 같은 값이어야 한다 — `0`(끔)은 범위 밖 특수값이라 여기 들지 않는다 */
export const IDLE_LOCK_MIN = 1;
export const IDLE_LOCK_MAX = 240;

/** `0` 은 끔이고, 그것은 이 기본값과 다른 상태다 */
export const DEFAULT_NOTIFY_AFTER_SECS = 10;
/** Rust `MAX_AFTER_SECS` 와 같은 값이어야 한다 — 시간 표식 · 보고 있는 타일 임계도 같은 상한을 쓴다 */
export const NOTIFY_AFTER_MAX_SECS = 86_400;

export const DEFAULT_NOTIFY_FOCUSED_AFTER_SECS = 60;

/** 1초는 쓰지 않는다 — `git status` 같은 흔한 명령이 전부 걸려 숫자가 무늬가 된다 */
export const DEFAULT_MARK_AFTER_SECS = 3;

/** 키가 그대로 `[terminal] bell` 에 저장된다. 소리를 기본으로 두지 않는다 — 벨은 의도 없이 자주 울린다 */
export const BELL_MODES = {
  visual: "settings.option.bell.visual",
  "visual+sound": "settings.option.bell.visual+sound",
  off: "settings.option.bell.off",
} as const satisfies Record<string, Key>;

export type BellMode = keyof typeof BELL_MODES;

export const DEFAULT_BELL: BellMode = "visual";

export const WALLPAPER_FITS = {
  cover: "settings.option.wallpaper_fit.cover",
  contain: "settings.option.wallpaper_fit.contain",
  tile: "settings.option.wallpaper_fit.tile",
  center: "settings.option.wallpaper_fit.center",
} as const satisfies Record<string, Key>;

export type WallpaperFit = keyof typeof WALLPAPER_FITS;

export const DEFAULT_WALLPAPER_FIT: WallpaperFit = "cover";

/** 0 이 아닌 이유는 가독성 — 흐린 글자 · 경계선이 어두운 바탕을 전제로 고른 색이다 */
export const DEFAULT_WALLPAPER_DIM = 40;
export const WALLPAPER_DIM_MIN = 0;
/** Rust `MAX_DIM` 과 같은 값이어야 한다 */
export const WALLPAPER_DIM_MAX = 100;

/** px — Rust `MAX_BLUR` 와 같은 값이어야 한다 */
export const WALLPAPER_BLUR_MIN = 0;
export const WALLPAPER_BLUR_MAX = 20;

/**
 * 표의 순서가 곧 select 의 순서이고 기본값이 맨 위다(아래 다른 디자인 표들도 같다).
 * 걷은 옛 모양 값이 남은 파일 · 테마 프로필은 정규화가 버려 기본(`pill`)으로 떨어진다.
 */
export const TAB_STYLES = {
  pill: "settings.option.tab_style.pill",
  flat: "settings.option.tab_style.flat",
} as const satisfies Record<string, Key>;

export type TabStyle = keyof typeof TAB_STYLES;

export const DEFAULT_TAB_STYLE: TabStyle = "pill";

/** 키는 `settings.toml` 의 `[hosts] sort` 에 저장되므로 바꾸지 않는다 */
export const HOST_SORTS = {
  name: "app.hosts.sort.name",
  recent: "app.hosts.sort.recent",
} as const satisfies Record<string, Key>;

export type HostSort = keyof typeof HOST_SORTS;

export const DEFAULT_HOST_SORT: HostSort = "name";

/**
 * 키는 `[files] default_view` 와 배치 파일의 `fileView` 에 저장되므로 바꾸지 않는다.
 * 옛 두 값(`tree`·`navigate`)은 읽을 때 `details` 로 옮긴다(`migrateFileView`).
 */
export const FILE_VIEWS = {
  icons: "settings.general.files_view.option.icons",
  compact: "settings.general.files_view.option.compact",
  details: "settings.general.files_view.option.details",
} as const satisfies Record<FileView, Key>;

export const DEFAULT_FILE_VIEW: FileView = "details";

/** 키는 `[projects] start_screen` 에 저장되므로 바꾸지 않는다 */
export const PROJECT_START_SCREENS = {
  auto: "settings.general.project_start.option.auto",
  off: "settings.general.project_start.option.off",
} as const satisfies Record<StartScreenMode, Key>;

export const DEFAULT_PROJECT_START_SCREEN: StartScreenMode = "auto";

/** 키가 그대로 `[ai] icon_style` 에 저장된다 */
export const AI_ICON_STYLES = {
  logo: "settings.theme.avatar.style.option.logo",
  avatar: "settings.theme.avatar.style.option.avatar",
} as const satisfies Record<string, Key>;

export type AiIconStyle = keyof typeof AI_ICON_STYLES;

export const DEFAULT_AI_ICON_STYLE: AiIconStyle = "logo";

/** 키는 로고 이름(`aiIconName`)과 같은 CLI 낱말, 값은 앱 아이콘 id(내장 키) */
export const DEFAULT_AI_AVATARS = { claude: "claude", codex: "gpt" } as const;

/** 키가 그대로 `[terminal] right_click` 에 저장된다 */
export const RIGHT_CLICK_MODES = {
  menu: "settings.option.right_click.menu",
  paste: "settings.option.right_click.paste",
} as const satisfies Record<string, Key>;

export type RightClickMode = keyof typeof RIGHT_CLICK_MODES;

export const DEFAULT_RIGHT_CLICK: RightClickMode = "menu";

/** 키가 그대로 `[terminal] cursor_style` 에 저장되고 xterm `cursorStyle` 로 내려간다 */
export const CURSOR_STYLES = {
  block: "settings.option.cursor_style.block",
  underline: "settings.option.cursor_style.underline",
  bar: "settings.option.cursor_style.bar",
} as const satisfies Record<string, Key>;

export type CursorStyle = keyof typeof CURSOR_STYLES;

export const DEFAULT_CURSOR_STYLE: CursorStyle = "block";

/** 방향을 사람이 이미 고른 길(툴바 ◫/⬓ · 드롭 4분면 · 그룹 전체 열기 · 시작 타일 교체)에는 어느 쪽도 끼어들지 않는다 */
export const TILING_MODES = {
  spiral: "settings.option.tiling.spiral",
  focus: "settings.option.tiling.focus",
} as const satisfies Record<string, Key>;

export type TilingMode = keyof typeof TILING_MODES;

export const DEFAULT_TILING: TilingMode = "spiral";

/** 키가 그대로 `[app] tile_header` 에 저장된다. 시작 타일에는 어느 값이든 붙지 않는다(`PaneHost` 의 `headed`) */
export const TILE_HEADER_MODES = {
  always: "settings.option.tile_header.always",
  multi: "settings.option.tile_header.multi",
  never: "settings.option.tile_header.never",
} as const satisfies Record<string, Key>;

export type TileHeaderMode = keyof typeof TILE_HEADER_MODES;

export const DEFAULT_TILE_HEADER: TileHeaderMode = "always";

/** 키가 그대로 `[app] status_bar` 에 저장된다 */
export const STATUS_BAR_POSITIONS = {
  left: "settings.option.status_bar.left",
  top: "settings.option.status_bar.top",
  bottom: "settings.option.status_bar.bottom",
  right: "settings.option.status_bar.right",
} as const satisfies Record<string, Key>;

export type StatusBarPosition = keyof typeof STATUS_BAR_POSITIONS;

export const DEFAULT_STATUS_BAR: StatusBarPosition = "left";

/** 키가 그대로 `[app] status_bar_style` 에 저장되고 `StatusBar.svelte` 의 `data-style` 로 내려간다 */
export const STATUS_BAR_STYLES = {
  flat: "settings.option.status_bar_style.flat",
  panel: "settings.option.status_bar_style.panel",
  hug: "settings.option.status_bar_style.hug",
} as const satisfies Record<string, Key>;

export type StatusBarStyle = keyof typeof STATUS_BAR_STYLES;

export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "flat";

/**
 * 키가 그대로 `[dock] layout` 에 저장되므로 바꾸지 않는다. 런처 독의 쪽을 고르고 채팅 독은 늘 반대쪽이다 —
 * 상태바 자리와는 무관하다.
 */
export const DOCK_LAYOUTS = {
  "launcher-left": "settings.option.dock_layout.launcher_left",
  "launcher-right": "settings.option.dock_layout.launcher_right",
} as const satisfies Record<DockLayout, Key>;

export { DEFAULT_DOCK_LAYOUT };

/** 키가 그대로 `[plans] exec_sort` 에 저장되므로 바꾸지 않는다 */
export const EXEC_SORTS = {
  newest: "board.exec.sort.newest",
  oldest: "board.exec.sort.oldest",
} as const satisfies Record<ExecSort, Key>;

export const DEFAULT_EXEC_SORT: ExecSort = "newest";

/** 키가 그대로 `[app] material` 에 저장되고 `<html data-material>` 로 내려간다 */
export const MATERIALS = {
  flat: "settings.option.material.flat",
  glass: "settings.option.material.glass",
} as const satisfies Record<string, Key>;

export type Material = keyof typeof MATERIALS;

export const DEFAULT_MATERIAL: Material = "glass";

/**
 * 키는 `[app] app_icon` 에 저장되고 Rust `app_icon.rs` 의 표와 같은 글자다(바꾸지 않는다).
 * 썸네일은 `src/lib/assets/app-icons/<키>.png` · 순서 = 고르기 칩 순서(기본이 앞).
 */
export const APP_ICONS = {
  gpt: "settings.option.app_icon.gpt",
  claude: "settings.option.app_icon.claude",
  gemini: "settings.option.app_icon.gemini",
  grok: "settings.option.app_icon.grok",
} as const satisfies Record<string, Key>;

export type AppIcon = keyof typeof APP_ICONS;

export const DEFAULT_APP_ICON: AppIcon = "gpt";

/** Rust `app_icon/user.rs` 의 `is_user_id` 와 같은 모양 — 파일이 없어도 모양만 보고 남긴다(Rust 가 기본 그림을 건다) */
const USER_APP_ICON_RE = /^user-[0-9a-f]{12}$/;

export function isUserAppIconId(v: unknown): v is string {
  return typeof v === "string" && USER_APP_ICON_RE.test(v);
}

export function isAppIconId(v: unknown): v is string {
  return (typeof v === "string" && Object.hasOwn(APP_ICONS, v)) || isUserAppIconId(v);
}

/** 키가 그대로 `[app] mode` 에 저장된다 */
export const APP_MODES = {
  dark: "settings.option.mode.dark",
  light: "settings.option.mode.light",
} as const satisfies Record<string, Key>;

export type AppMode = keyof typeof APP_MODES;

export const DEFAULT_APP_MODE: AppMode = "dark";

/** 파일에 적힐 수 있는 값만 — "안 정함"(OS 를 따른다)은 이 표에 없다 */
export const LANGUAGES = {
  ko: "ko",
  en: "en",
} as const;

export type Language = keyof typeof LANGUAGES;

/** "안 정함" 의 `<option value>` — `LANGUAGES` 에 없는 글자라 `setLanguage` 가 "안 정함" 으로 읽는다 */
export const LANGUAGE_AUTO = "auto";

/** 사전에 두지 않는다 — 영어 사전에 `한국어` 를 적으면 "영어 사전에 한글이 없다" 는 테스트와 부딪친다 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  ko: "한국어",
  en: "English",
};

/** 합자를 켰을 때 사용자가 글꼴을 안 정했으면 이 스택으로 폴백한다 */
export const LIGATURE_FONT_FAMILY =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

/**
 * `bg`/`bg_panel` 은 기저색 토큰(`-base`)에 쓴다 — `--bg` 는 theme.css 가 `--chrome-pct` 로 합성하므로
 * 인라인 `--bg` 로 덮으면 합성이 끊겨 투명도가 안 먹는다.
 */
export const APP_TOKENS = {
  accent: "--accent",
  bg: "--bg-base",
  bg_panel: "--bg-panel-base",
  fg: "--fg",
  border: "--border",
  err: "--err",
  ok: "--ok",
  warn: "--warn",
} as const satisfies Partial<Record<keyof AppTheme, string>>;

export type AppTokenKey = keyof typeof APP_TOKENS;
