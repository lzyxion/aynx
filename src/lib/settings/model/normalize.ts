import {
  bareName,
  clampInt,
  cleanAllowRules,
  cleanBundleOff,
  cloneBundleOff,
  sameBundleOff,
  cleanStringList,
  cloneAllowRule,
  known,
  normalizeKeybindings,
  normalizeStringMap,
  normalizeTriggers,
  sameAllowRules,
  sameKeybindings,
  sameStringList,
  sameStringMap,
  sameTriggers,
  text,
  vaultAutoLockMinutes,
} from "$lib/settings-codec";
import { MESSENGER_AWAY_MAX_MIN, MESSENGER_WHENS } from "$lib/messenger-notify";
import { normalizeUiScale } from "$lib/ui-scale";
import { isDefaultChipOrder, migrateLegacyChips, normalizeChipHidden, normalizeChipOrder } from "$lib/header-chips";
import {
  DYNAMIC_DARK_TERM_KEY,
  DYNAMIC_LIGHT_TERM_KEY,
  DYNAMIC_TERM_KEY,
  LEGACY_DYNAMIC_ALT_TERM_KEY,
  TERM_PRESETS,
  canonicalPreset,
  isDynamicTermKey,
  isLightBackground,
  isUserTermKey,
} from "$lib/theme";
import { BEFORE_KEY, dynamicTermTheme, normalizeDynamicMode } from "$lib/dynamic-color";
import type {
  AiPrefs,
  AiMcpServer,
  AppSettings,
  AppTheme,
  AutomationPrefs,
  MessengerPrefs,
  RemotePrefs,
  ShellPrefs,
  TermPrefs,
  WallpaperPrefs,
} from "./schema";
import {
  APPROVAL_TTL_MINUTES_DEFAULT,
  APPROVAL_TTL_MINUTES_MAX,
  APPROVAL_TTL_MINUTES_MIN,
  APP_MODES,
  AUDIT_RETENTION_DAYS_DEFAULT,
  AUDIT_RETENTION_DAYS_MAX,
  AUDIT_RETENTION_DAYS_MIN,
  AUTO_MAX_CONCURRENCY_DEFAULT,
  AUTO_MAX_CONCURRENCY_MAX,
  AUTO_MAX_CONCURRENCY_MIN,
  AUTO_MAX_PER_WINDOW_DEFAULT,
  AUTO_MAX_PER_WINDOW_MAX,
  AUTO_MAX_PER_WINDOW_MIN,
  AUTO_MAX_TARGETS_DEFAULT,
  AUTO_MAX_TARGETS_MAX,
  AUTO_MAX_TARGETS_MIN,
  AUTO_WINDOW_SECS_DEFAULT,
  AUTO_WINDOW_SECS_MAX,
  AUTO_WINDOW_SECS_MIN,
  BELL_MODES,
  CURSOR_STYLES,
  DEFAULT_FILE_VIEW,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HOST_SORTS,
  IDLE_LOCK_MAX,
  IDLE_LOCK_MIN,
  LANGUAGES,
  MAX_TRIGGERS,
  NOTIFY_AFTER_MAX_SECS,
  OPACITY_MAX,
  OPACITY_MIN,
  PROJECT_START_SCREENS,
  AI_ICON_STYLES,
  DEFAULT_AI_AVATARS,
  isAppIconId,
  DOCK_LAYOUTS,
  EXEC_SORTS,
  RIGHT_CLICK_MODES,
  STATUS_BAR_POSITIONS,
  STATUS_BAR_STYLES,
  MATERIALS,
  APP_ICONS,
  isUserAppIconId,
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
  defaultAutomation,
  type AppTokenKey,
} from "./options";
import { APP_TOKEN_KEYS } from "./internal";
import { migrateFileView } from "$lib/session/spec";

/** 옛 두 값(`tree` · `navigate`)은 `details` 로 옮기고 기본값이면 칸을 비운다. `session/spec` 는 배럴 대신 직접 부른다(배럴은 세션 열기까지 끌고 온다) */
function fileViewSetting(v: unknown): string | undefined {
  const view = migrateFileView(typeof v === "string" ? v.trim() : v);
  return view === null || view === DEFAULT_FILE_VIEW ? undefined : view;
}

export function emptySettings(): AppSettings {
  return {
    app: {},
    terminal: {},
    shell: {},
    ai: {},
    wallpaper: {},
    triggers: [],
    keybindings: {},
    automation: defaultAutomation(),
    vault: {},
    hosts: {},
    files: {},
    projects: {},
    dock: {},
    plans: {},
    updates: {},
    messenger: {},
    remote: {},
  };
}

/** 상태 객체를 두 벌(현재/저장됨) 들고 있어야 [취소] 가 성립한다 — 배열 · 맵 칸은 깊게 복사한다 */
export function cloneSettings(s: AppSettings): AppSettings {
  return {
    app: {
      ...s.app,
      header_chip_order: s.app.header_chip_order ? [...s.app.header_chip_order] : undefined,
      header_chips_hidden: s.app.header_chips_hidden ? [...s.app.header_chips_hidden] : undefined,
    },
    terminal: { ...s.terminal, dynamic: s.terminal.dynamic ? { ...s.terminal.dynamic } : undefined },
    shell: { ...s.shell },
    ai: {
      ...s.ai,
      mcp_sessions_agents: s.ai.mcp_sessions_agents ? [...s.ai.mcp_sessions_agents] : undefined,
      mcp_servers: s.ai.mcp_servers?.map((server) => ({
        ...server,
        args: server.args ? [...server.args] : undefined,
        agents: server.agents ? [...server.agents] : undefined,
        env: server.env?.map((entry) => ({ name: entry.name, secret_ref: entry.secret_ref })),
        headers: server.headers?.map((entry) => ({ name: entry.name, secret_ref: entry.secret_ref })),
      })),
      disabled_agents: s.ai.disabled_agents ? [...s.ai.disabled_agents] : undefined,
    },
    wallpaper: { ...s.wallpaper },
    triggers: s.triggers.map((t) => ({ ...t })),
    keybindings: { ...s.keybindings },
    automation: {
      ...s.automation,
      allow_patterns: [...s.automation.allow_patterns],
      bundles: [...s.automation.bundles],
      bundle_off: cloneBundleOff(s.automation.bundle_off),
      allow: s.automation.allow.map(cloneAllowRule),
    },
    vault: { ...s.vault },
    hosts: { ...s.hosts },
    files: { ...s.files },
    projects: { ...s.projects },
    dock: { ...s.dock },
    plans: { ...s.plans },
    updates: { ...s.updates },
    messenger: { ...s.messenger },
    remote: { ...s.remote },
  };
}

/** 필드를 직접 비교한다 — JSON 비교는 키 순서에 흔들린다 */
export function sameSettings(a: AppSettings, b: AppSettings): boolean {
  return (
    APP_TOKEN_KEYS.every((k) => a.app[k] === b.app[k]) &&
    a.app.dynamic === b.app.dynamic &&
    a.app.opacity === b.app.opacity &&
    a.app.auto_reconnect === b.app.auto_reconnect &&
    a.app.tray_on_close === b.app.tray_on_close &&
    sameStringList(a.app.header_chip_order ?? [], b.app.header_chip_order ?? []) &&
    sameStringList(a.app.header_chips_hidden ?? [], b.app.header_chips_hidden ?? []) &&
    a.app.resource_rings === b.app.resource_rings &&
    a.app.usage_rings === b.app.usage_rings &&
    a.app.window_controls === b.app.window_controls &&
    a.app.tiling === b.app.tiling &&
    a.app.mode === b.app.mode &&
    a.app.language === b.app.language &&
    a.app.tile_header === b.app.tile_header &&
    a.app.status_bar === b.app.status_bar &&
    a.app.status_bar_style === b.app.status_bar_style &&
    a.app.material === b.app.material &&
    a.app.app_icon === b.app.app_icon &&
    a.app.idle_lock_min === b.app.idle_lock_min &&
    a.app.ui_scale === b.app.ui_scale &&
    a.app.ui_font_family === b.app.ui_font_family &&
    a.terminal.theme === b.terminal.theme &&
    a.terminal.font_family === b.terminal.font_family &&
    a.terminal.font_size === b.terminal.font_size &&
    a.terminal.cursor_style === b.terminal.cursor_style &&
    a.terminal.webgl === b.terminal.webgl &&
    a.terminal.tab_style === b.terminal.tab_style &&
    a.terminal.ligatures === b.terminal.ligatures &&
    a.terminal.right_click === b.terminal.right_click &&
    a.terminal.confirm_multiline_paste === b.terminal.confirm_multiline_paste &&
    a.terminal.osc52_clipboard === b.terminal.osc52_clipboard &&
    a.terminal.osc_notify === b.terminal.osc_notify &&
    a.terminal.inline_images === b.terminal.inline_images &&
    a.terminal.inline_snippets === b.terminal.inline_snippets &&
    a.terminal.local_shell_integration === b.terminal.local_shell_integration &&
    a.terminal.notify_after_secs === b.terminal.notify_after_secs &&
    a.terminal.mark_after_secs === b.terminal.mark_after_secs &&
    a.terminal.bell === b.terminal.bell &&
    a.terminal.opacity === b.terminal.opacity &&
    sameStringMap(a.terminal.dynamic, b.terminal.dynamic) &&
    a.shell.default === b.shell.default &&
    a.ai.start_dir === b.ai.start_dir &&
    a.ai.notify_turn_end === b.ai.notify_turn_end &&
    a.ai.notify_permission === b.ai.notify_permission &&
    a.ai.notify_side_chat === b.ai.notify_side_chat &&
    a.ai.notify_focused_after_secs === b.ai.notify_focused_after_secs &&
    a.ai.codex_no_daemon === b.ai.codex_no_daemon &&
    a.ai.claude_statusline === b.ai.claude_statusline &&
    a.ai.icon_style === b.ai.icon_style &&
    a.ai.avatar_claude === b.ai.avatar_claude &&
    a.ai.avatar_codex === b.ai.avatar_codex &&
    sameStringMap(a.ai.args, b.ai.args) &&
    sameMcpServers(a.ai.mcp_servers, b.ai.mcp_servers) &&
    (a.ai.mcp_sessions_enabled ?? true) === (b.ai.mcp_sessions_enabled ?? true) &&
    sameStringList(normalizeMcpSessionsAgents(a.ai.mcp_sessions_agents) ?? ["claude", "codex"], normalizeMcpSessionsAgents(b.ai.mcp_sessions_agents) ?? ["claude", "codex"]) &&
    sameStringList(a.ai.disabled_agents ?? [], b.ai.disabled_agents ?? []) &&
    (a.ai.chat_tile === true) === (b.ai.chat_tile === true) &&
    a.wallpaper.file === b.wallpaper.file &&
    a.wallpaper.dim === b.wallpaper.dim &&
    a.wallpaper.blur === b.wallpaper.blur &&
    a.wallpaper.fit === b.wallpaper.fit &&
    sameTriggers(a.triggers, b.triggers) &&
    sameKeybindings(a.keybindings, b.keybindings) &&
    a.automation.auto_approve === b.automation.auto_approve &&
    a.automation.max_targets === b.automation.max_targets &&
    a.automation.max_concurrency === b.automation.max_concurrency &&
    a.automation.auto_max_per_window === b.automation.auto_max_per_window &&
    a.automation.auto_window_secs === b.automation.auto_window_secs &&
    a.automation.approval_ttl_minutes === b.automation.approval_ttl_minutes &&
    a.automation.notify_review_requests === b.automation.notify_review_requests &&
    a.automation.notify_operation_results === b.automation.notify_operation_results &&
    a.automation.audit_retention_days === b.automation.audit_retention_days &&
    a.automation.audit_output_excerpt === b.automation.audit_output_excerpt &&
    a.automation.allow_pipes === b.automation.allow_pipes &&
    sameStringList(a.automation.allow_patterns, b.automation.allow_patterns) &&
    sameStringList(a.automation.bundles, b.automation.bundles) &&
    sameBundleOff(a.automation.bundle_off, b.automation.bundle_off) &&
    sameAllowRules(a.automation.allow, b.automation.allow) &&
    a.vault.auto_lock_minutes === b.vault.auto_lock_minutes &&
    a.hosts.sort === b.hosts.sort &&
    a.files.default_view === b.files.default_view &&
    a.files.auto_refresh === b.files.auto_refresh &&
    a.projects.start_screen === b.projects.start_screen &&
    a.dock.layout === b.dock.layout &&
    a.plans.exec_sort === b.plans.exec_sort &&
    a.updates.auto_check === b.updates.auto_check &&
    a.messenger.when === b.messenger.when &&
    a.messenger.agent_stop === b.messenger.agent_stop &&
    a.messenger.agent_permission === b.messenger.agent_permission &&
    a.messenger.command_min_secs === b.messenger.command_min_secs &&
    a.messenger.osc === b.messenger.osc &&
    a.messenger.operation_results === b.messenger.operation_results &&
    a.messenger.operation_pending === b.messenger.operation_pending &&
    a.messenger.include_summary === b.messenger.include_summary &&
    a.messenger.include_command === b.messenger.include_command &&
    a.messenger.include_conversation === b.messenger.include_conversation &&
    a.messenger.away_after_min === b.messenger.away_after_min &&
    a.messenger.discord === b.messenger.discord &&
    a.messenger.slack === b.messenger.slack &&
    a.messenger.telegram === b.messenger.telegram &&
    a.messenger.telegram_chat === b.messenger.telegram_chat &&
    a.messenger.discord_chat === b.messenger.discord_chat &&
    a.messenger.slack_chat === b.messenger.slack_chat &&
    a.remote.enabled === b.remote.enabled &&
    a.remote.port === b.remote.port &&
    a.remote.host === b.remote.host
  );
}

function headerChipOrderOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const order = normalizeChipOrder(raw);
  return isDefaultChipOrder(order) ? undefined : order;
}

function nonEmpty(list: string[]): string[] | undefined {
  return list.length > 0 ? list : undefined;
}

function avatarChoice(raw: unknown, fallback: string): string | undefined {
  const v = typeof raw === "string" ? raw.trim() : "";
  return isAppIconId(v) && v !== fallback ? v : undefined;
}

/** 백엔드도 같은 정규화를 하지만 명령이 아직 없거나 옛 버전일 수 있어 한 번 더 거른다 — 여기서 통과한 값만 DOM · xterm 에 들어간다 */
export function normalizeSettings(raw: unknown): AppSettings {
  const src = (raw ?? {}) as Partial<AppSettings>;
  const app = (src.app ?? {}) as AppTheme;
  const terminal = (src.terminal ?? {}) as TermPrefs;
  const shell = (src.shell ?? {}) as ShellPrefs;
  const ai = (src.ai ?? {}) as AiPrefs;
  const wallpaper = (src.wallpaper ?? {}) as WallpaperPrefs;

  const size = typeof terminal.font_size === "number" ? Math.round(terminal.font_size) : undefined;

  // 동적 팔레트는 값을 검사하지 않는다(백엔드와 같은 "보관만" 분담) — 색이 아닌 `before-theme` 칸만 프리셋 별칭을 지난다
  const dynamicPalette = canonicalBefore(normalizeStringMap(terminal.dynamic));

  // 옛 `ai_read` 칩은 `ai` 로 옮긴다(`migrateLegacyChips`)
  const chips = migrateLegacyChips(app.header_chip_order, app.header_chips_hidden);

  return {
    app: {
      ...normalizeAppTokens(app),
      // 옛 불리언(`true`)은 `full` 로 옮겨진다 — 백엔드도 같은 이사를 한다
      dynamic: normalizeDynamicMode(app.dynamic),
      // 손으로 적은 0 도 `OPACITY_MIN` 으로 올린다 — 슬라이더가 표현할 수 없는 상태를 들지 않는다(백엔드 sanitize 는 0~100 을 통과시킨다)
      opacity:
        typeof app.opacity === "number" && Number.isFinite(app.opacity)
          ? Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(app.opacity)))
          : undefined,
      auto_reconnect: typeof app.auto_reconnect === "boolean" ? app.auto_reconnect : undefined,
      tray_on_close: typeof app.tray_on_close === "boolean" ? app.tray_on_close : undefined,
      // 옛 `resource_chip = false` 는 끈 칩의 `"resource"` 로 옮긴다 — 켬끔을 쥐는 칸이 둘이면 한쪽을 켜도 칩이 안 서는 자리가 생긴다
      header_chip_order: headerChipOrderOf(chips.order),
      header_chips_hidden: nonEmpty(
        normalizeChipHidden([
          ...(Array.isArray(chips.hidden) ? chips.hidden : []),
          ...(app.resource_chip === false ? ["resource"] : []),
        ]),
      ),
      resource_rings: typeof app.resource_rings === "boolean" ? app.resource_rings : undefined,
      usage_rings: typeof app.usage_rings === "boolean" ? app.usage_rings : undefined,
      window_controls: app.window_controls === true ? true : undefined,
      tiling: known(app.tiling, TILING_MODES),
      mode: known(app.mode, APP_MODES),
      language: known(app.language, LANGUAGES),
      tile_header: known(app.tile_header, TILE_HEADER_MODES),
      status_bar: known(app.status_bar, STATUS_BAR_POSITIONS),
      status_bar_style: known(app.status_bar_style, STATUS_BAR_STYLES),
      material: known(app.material, MATERIALS),
      // 사용자 아이콘 id(`user-<12hex>`)는 모양만 보고 남긴다(파일이 없으면 Rust 가 기본 그림을 건다)
      app_icon: known(app.app_icon, APP_ICONS) ?? (isUserAppIconId(app.app_icon) ? app.app_icon : undefined),
      // 백엔드 sanitize 와 같은 규칙 — 0 은 하한으로 올리지 않고 "안 정함"(= 끔)으로 접는다(opacity 와 다른 점)
      idle_lock_min:
        typeof app.idle_lock_min === "number" &&
        Number.isFinite(app.idle_lock_min) &&
        Math.round(app.idle_lock_min) > 0
          ? Math.min(IDLE_LOCK_MAX, Math.max(IDLE_LOCK_MIN, Math.round(app.idle_lock_min)))
          : undefined,
      ui_scale: normalizeUiScale(app.ui_scale),
      ui_font_family: text(app.ui_font_family),
    },
    terminal: {
      // `dynamic*` 는 `TERM_PRESETS` 에 없는 가상 키라 팔레트가 있을 때만 통과한다. 옛 키(`canonicalPreset`)는
      // 백엔드 값이 상태로 들어오는 유일한 지점인 여기서 옮긴다 — 다음 [저장] 때 새 키가 적힌다
      theme: normalizePresetKey(canonicalPreset(terminal.theme), dynamicPalette),
      font_family: text(terminal.font_family),
      font_size:
        size !== undefined && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX ? size : undefined,
      cursor_style: known(terminal.cursor_style, CURSOR_STYLES),
      webgl: typeof terminal.webgl === "boolean" ? terminal.webgl : undefined,
      // 걷은 옛 탭 모양 키도 이 길로 빠져 기본(pill)이 된다 — 옛 파일 · 테마 프로필이 오류 없이 읽힌다
      tab_style: known(terminal.tab_style, TAB_STYLES),
      ligatures: typeof terminal.ligatures === "boolean" ? terminal.ligatures : undefined,
      right_click: known(terminal.right_click, RIGHT_CLICK_MODES),
      confirm_multiline_paste:
        typeof terminal.confirm_multiline_paste === "boolean"
          ? terminal.confirm_multiline_paste
          : undefined,
      osc52_clipboard:
        typeof terminal.osc52_clipboard === "boolean" ? terminal.osc52_clipboard : undefined,
      osc_notify: typeof terminal.osc_notify === "boolean" ? terminal.osc_notify : undefined,
      inline_images:
        typeof terminal.inline_images === "boolean" ? terminal.inline_images : undefined,
      inline_snippets:
        typeof terminal.inline_snippets === "boolean" ? terminal.inline_snippets : undefined,
      local_shell_integration:
        typeof terminal.local_shell_integration === "boolean"
          ? terminal.local_shell_integration
          : undefined,
      // `0` 을 살려 둔다(끔이라는 뜻) — `idle_lock_min` 과 정반대인 것은 기본값이 켬이기 때문이다. 위는 백엔드 sanitize 와 같은 값으로 자른다
      notify_after_secs:
        typeof terminal.notify_after_secs === "number" &&
        Number.isFinite(terminal.notify_after_secs) &&
        Math.round(terminal.notify_after_secs) >= 0
          ? Math.min(NOTIFY_AFTER_MAX_SECS, Math.round(terminal.notify_after_secs))
          : undefined,
      mark_after_secs:
        typeof terminal.mark_after_secs === "number" &&
        Number.isFinite(terminal.mark_after_secs) &&
        Math.round(terminal.mark_after_secs) >= 0
          ? Math.min(NOTIFY_AFTER_MAX_SECS, Math.round(terminal.mark_after_secs))
          : undefined,
      bell: known(terminal.bell, BELL_MODES),
      // 백엔드 sanitize 와 같은 clamp — 손으로 적은 0 도 하한으로 올라온다
      opacity:
        typeof terminal.opacity === "number" && Number.isFinite(terminal.opacity)
          ? Math.min(
              TERM_OPACITY_MAX,
              Math.max(TERM_OPACITY_MIN, Math.round(terminal.opacity)),
            )
          : undefined,
      dynamic: dynamicPalette,
    },
    // 셸 id 는 목록과 맞춰 보지 않는다 — 지금 기기에 없는 셸이어도 값은 살려 둔다
    shell: { default: text(shell.default) },
    // 시작 폴더도 검사하지 않는다 — 있는지는 세션을 세우는 자리(`spawn_cwd`)가 본다
    ai: {
      start_dir: text(ai.start_dir),
      notify_turn_end: typeof ai.notify_turn_end === "boolean" ? ai.notify_turn_end : undefined,
      notify_permission: typeof ai.notify_permission === "boolean" ? ai.notify_permission : undefined,
      notify_side_chat: typeof ai.notify_side_chat === "boolean" ? ai.notify_side_chat : undefined,
      notify_focused_after_secs:
        typeof ai.notify_focused_after_secs === "number" &&
        Number.isFinite(ai.notify_focused_after_secs) &&
        Math.round(ai.notify_focused_after_secs) >= 0
          ? Math.min(NOTIFY_AFTER_MAX_SECS, Math.round(ai.notify_focused_after_secs))
          : undefined,
      codex_no_daemon: typeof ai.codex_no_daemon === "boolean" ? ai.codex_no_daemon : undefined,
      claude_statusline: typeof ai.claude_statusline === "boolean" ? ai.claude_statusline : undefined,
      chat_tile: ai.chat_tile === true ? true : undefined,
      // 옛 칸 `loading_art = "character"` 는 새 칸이 비었을 때만 `avatar` 로 옮기고 싣지 않는다 — Rust `sanitize` 도 같은 이사를 한다
      icon_style: known(ai.icon_style, AI_ICON_STYLES) ?? (ai.loading_art === "character" ? "avatar" : undefined),
      avatar_claude: avatarChoice(ai.avatar_claude, DEFAULT_AI_AVATARS.claude),
      avatar_codex: avatarChoice(ai.avatar_codex, DEFAULT_AI_AVATARS.codex),
      args: normalizeStringMap(ai.args),
      mcp_servers: normalizeMcpServers(ai.mcp_servers),
      mcp_sessions_enabled: ai.mcp_sessions_enabled === false ? false : undefined,
      mcp_sessions_agents: normalizeMcpSessionsAgents(ai.mcp_sessions_agents),
      // 모르는 id 도 남긴다 — Rust `sanitize` 와 같은 규칙
      disabled_agents: nonEmpty(cleanStringList(ai.disabled_agents)),
    },
    wallpaper: {
      // 이름 한 조각만 통과시킨다(백엔드 sanitize 와 같다) — 손으로 고친 파일이 앱 폴더 밖을 가리키지 않게 하는 두 번째 그물이다
      file: bareName(wallpaper.file),
      dim: clampInt(wallpaper.dim, WALLPAPER_DIM_MIN, WALLPAPER_DIM_MAX),
      blur: clampInt(wallpaper.blur, WALLPAPER_BLUR_MIN, WALLPAPER_BLUR_MAX),
      fit: known(wallpaper.fit, WALLPAPER_FITS),
    },
    triggers: normalizeTriggers(src.triggers, MAX_TRIGGERS),
    keybindings: normalizeKeybindings(src.keybindings),
    automation: normalizeAutomation(src.automation),
    // `0`(잠그지 않음)을 살린다 — 백엔드 `VaultPrefs::minutes` 와 같은 값
    vault: { auto_lock_minutes: vaultAutoLockMinutes((src.vault ?? {}).auto_lock_minutes) },
    hosts: { sort: known((src.hosts ?? {}).sort, HOST_SORTS) },
    files: {
      default_view: fileViewSetting((src.files ?? {}).default_view),
      auto_refresh: typeof (src.files ?? {}).auto_refresh === "boolean" ? (src.files ?? {}).auto_refresh : undefined,
    },
    projects: { start_screen: known((src.projects ?? {}).start_screen, PROJECT_START_SCREENS) },
    dock: { layout: known((src.dock ?? {}).layout, DOCK_LAYOUTS) },
    plans: { exec_sort: known((src.plans ?? {}).exec_sort, EXEC_SORTS) },
    updates: { auto_check: typeof (src.updates ?? {}).auto_check === "boolean" ? (src.updates ?? {}).auto_check : undefined },
    messenger: normalizeMessenger(src.messenger),
    remote: normalizeRemote(src.remote),
  };
}

/** `0` 은 살린다 — 끔이라는 뜻이다 */
function nonNegInt(v: unknown, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && Math.round(v) >= 0
    ? Math.min(max, Math.round(v))
    : undefined;
}

/** Rust `RemotePrefs::sanitize` 와 같은 규칙 — 이름 모양(`*.ts.net`) 검사는 Rust 관문이 한다 */
function normalizeRemote(raw: unknown): RemotePrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const port = typeof r.port === "number" && Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535 ? r.port : undefined;
  const host = typeof r.host === "string" ? r.host.trim().toLowerCase() : "";
  return {
    enabled: r.enabled === true ? true : undefined,
    port,
    host: host === "" ? undefined : host,
  };
}

/** 백엔드 sanitize 와 같은 규칙 */
function normalizeMessenger(raw: unknown): MessengerPrefs {
  const m = (raw ?? {}) as MessengerPrefs;
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  return {
    when: known(m.when, MESSENGER_WHENS),
    agent_stop: bool(m.agent_stop),
    agent_permission: bool(m.agent_permission),
    command_min_secs: nonNegInt(m.command_min_secs, NOTIFY_AFTER_MAX_SECS),
    osc: bool(m.osc),
    operation_results: bool(m.operation_results),
    operation_pending: bool(m.operation_pending),
    include_summary: bool(m.include_summary),
    include_command: bool(m.include_command),
    include_conversation: bool(m.include_conversation),
    away_after_min: nonNegInt(m.away_after_min, MESSENGER_AWAY_MAX_MIN),
    discord: bool(m.discord),
    slack: bool(m.slack),
    telegram: bool(m.telegram),
    telegram_chat: bool(m.telegram_chat),
    discord_chat: bool(m.discord_chat),
    slack_chat: bool(m.slack_chat),
  };
}

/** 백엔드 `AutomationPrefs::sanitize` 와 같은 규칙 */
function normalizeAutomation(raw: unknown): AutomationPrefs {
  const a = (raw ?? {}) as Partial<AutomationPrefs>;
  return {
    auto_approve: a.auto_approve === true,
    allow_patterns: cleanStringList(a.allow_patterns),
    // 모르는 묶음 id 는 버리지 않는다 — 새 버전의 묶음을 켜 둔 파일을 옛 버전이 저장해도 값이 살아 있어야 한다
    bundles: cleanStringList(a.bundles),
    // 모르는 묶음 · 키도 남긴다 — 좁히기만 하는 칸이다
    bundle_off: cleanBundleOff(a.bundle_off),
    max_targets:
      clampInt(a.max_targets, AUTO_MAX_TARGETS_MIN, AUTO_MAX_TARGETS_MAX) ??
      AUTO_MAX_TARGETS_DEFAULT,
    max_concurrency:
      clampInt(a.max_concurrency, AUTO_MAX_CONCURRENCY_MIN, AUTO_MAX_CONCURRENCY_MAX) ??
      AUTO_MAX_CONCURRENCY_DEFAULT,
    // 진짜 강제는 Rust 지만 화면 값이 어긋나지 않게 같은 범위로 자른다
    auto_max_per_window:
      clampInt(a.auto_max_per_window, AUTO_MAX_PER_WINDOW_MIN, AUTO_MAX_PER_WINDOW_MAX) ??
      AUTO_MAX_PER_WINDOW_DEFAULT,
    auto_window_secs:
      clampInt(a.auto_window_secs, AUTO_WINDOW_SECS_MIN, AUTO_WINDOW_SECS_MAX) ??
      AUTO_WINDOW_SECS_DEFAULT,
    // `0`(만료 없음)을 살린다 — 백엔드 `sanitize` 와 같은 규칙
    approval_ttl_minutes:
      clampInt(a.approval_ttl_minutes, APPROVAL_TTL_MINUTES_MIN, APPROVAL_TTL_MINUTES_MAX) ??
      APPROVAL_TTL_MINUTES_DEFAULT,
    // 기본이 켬이라 `false` 라고 똑똑히 적혀 있을 때만 끈다
    notify_review_requests: a.notify_review_requests !== false,
    notify_operation_results: a.notify_operation_results !== false,
    // `0`(지우지 않음)을 살린다
    audit_retention_days:
      clampInt(a.audit_retention_days, AUDIT_RETENTION_DAYS_MIN, AUDIT_RETENTION_DAYS_MAX) ??
      AUDIT_RETENTION_DAYS_DEFAULT,
    audit_output_excerpt: a.audit_output_excerpt === true,
    allow_pipes: a.allow_pipes === true,
    allow: cleanAllowRules(a.allow),
  };
}

function normalizeAppTokens(app: AppTheme): Pick<AppTheme, AppTokenKey> {
  const out = {} as Pick<AppTheme, AppTokenKey>;
  for (const key of APP_TOKEN_KEYS) out[key] = text(app[key]);
  return out;
}

/** 옛 파일의 `before-theme` 에도 옛 키가 있을 수 있다 — 그대로 두면 동적을 껐을 때 돌아갈 프리셋을 잃는다(`clearDynamicTheme`) */
function canonicalBefore(
  palette: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const before = palette?.[BEFORE_KEY];
  if (!palette || !before) return palette;
  const canon = canonicalPreset(before);
  return canon === before ? palette : { ...palette, [BEFORE_KEY]: canon };
}

/**
 * `dynamic*` 키는 팔레트가 있을 때만 통과한다. 옛 키 둘(`dynamic` · `dynamic-alt`)은 그 순간 보이던 밝기의 고정 키로 옮긴다.
 * 사용자 테마 키(`user:<id>`)는 모양만 보고 보존한다 — 지워졌으면 그리는 쪽(`termThemeOf`)이 떨어지고, 설정 파일은 몰래 고쳐 쓰지 않는다.
 */
function normalizePresetKey(
  raw: unknown,
  palette: Record<string, string> | undefined,
): string | undefined {
  const key = text(raw);
  if (!key) return undefined;
  if (key === DYNAMIC_TERM_KEY || key === LEGACY_DYNAMIC_ALT_TERM_KEY) {
    const map = dynamicTermTheme(palette);
    if (!map) return undefined;
    const light = isLightBackground(map.background) !== (key === LEGACY_DYNAMIC_ALT_TERM_KEY);
    return light ? DYNAMIC_LIGHT_TERM_KEY : DYNAMIC_DARK_TERM_KEY;
  }
  if (isDynamicTermKey(key)) return dynamicTermTheme(palette) ? key : undefined;
  if (isUserTermKey(key)) return key;
  return key in TERM_PRESETS ? key : undefined;
}

/** 구조만 다듬는다 — 내용 검증은 Rust, 모양이 틀린 항목은 이웃 항목을 잃지 않고 버린다. */
export function normalizeMcpServers(raw: unknown): AiMcpServer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const servers: AiMcpServer[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const server = value as Partial<AiMcpServer>;
    if (typeof server.name !== "string" || typeof server.enabled !== "boolean") continue;
    if (server.agents !== undefined && (!Array.isArray(server.agents) || !server.agents.every((v) => typeof v === "string"))) continue;
    const agents = server.agents === undefined ? {} : { agents: [...server.agents] };
    if (server.project_id !== undefined && typeof server.project_id !== "string") continue;
    if (server.env !== undefined && (!Array.isArray(server.env) || !server.env.every((e) => e && typeof e.name === "string" && typeof e.secret_ref === "string"))) continue;
    if (server.headers !== undefined && (!Array.isArray(server.headers) || !server.headers.every((e) => e && typeof e.name === "string" && typeof e.secret_ref === "string"))) continue;
    const scoped = { ...(server.project_id ? { project_id: server.project_id } : {}), ...(server.env?.length ? { env: server.env.map((entry) => ({ name: entry.name, secret_ref: entry.secret_ref })) } : {}) };
    const headers = server.headers?.length ? { headers: server.headers.map((entry) => ({ name: entry.name, secret_ref: entry.secret_ref })) } : {};
    // 옛 `side_chat_no_ask` 는 칸을 골라 담으므로 저절로 빠진다
    const side = server.side_chat === true ? { side_chat: true } : {};
    if (server.transport === "stdio") {
      if (typeof server.command !== "string") continue;
      if (server.args !== undefined && (!Array.isArray(server.args) || !server.args.every((v) => typeof v === "string"))) continue;
      servers.push({ name: server.name, enabled: server.enabled, ...agents, ...scoped, transport: "stdio", command: server.command, args: [...(server.args ?? [])], ...side });
    } else if (server.transport === "http" && typeof server.url === "string") {
      servers.push({ name: server.name, enabled: server.enabled, ...agents, ...scoped, ...headers, transport: "http", url: server.url, ...side });
    }
  }
  return servers.length > 0 ? servers : undefined;
}

/** 키 순서는 따지지 않고 서버 · 인자 순서와 값은 따진다 */
function sameMcpServers(a: AiMcpServer[] | null | undefined, b: AiMcpServer[] | null | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((server, i) => {
    const other = right[i];
    return server.name === other.name && server.enabled === other.enabled && server.transport === other.transport &&
      server.project_id === other.project_id && (server.env ?? []).length === (other.env ?? []).length && (server.env ?? []).every((entry, index) => entry.name === other.env?.[index]?.name && entry.secret_ref === other.env?.[index]?.secret_ref) &&
      (server.headers ?? []).length === (other.headers ?? []).length && (server.headers ?? []).every((entry, index) => entry.name === other.headers?.[index]?.name && entry.secret_ref === other.headers?.[index]?.secret_ref) &&
      server.command === other.command && server.url === other.url && sameStringList(server.args ?? [], other.args ?? []) &&
      !!server.side_chat === !!other.side_chat &&
      sameStringList(server.agents ?? ["claude", "codex"], other.agents ?? ["claude", "codex"]);
  });
}

/** 둘 다 대상인 기본값은 생략하고, 명시한 빈 목록 · 모르는 id 는 뜻을 유지한다 */
export function normalizeMcpSessionsAgents(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === "string")) return undefined;
  const agents = [...new Set<string>(raw)];
  return agents.length === 2 && agents.includes("claude") && agents.includes("codex") ? undefined : agents;
}
