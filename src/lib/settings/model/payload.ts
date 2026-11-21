// 내부 전용 저장 짐(`toPayload` — 기본값 · 빈 값은 파일에 적지 않는다) — 배럴이 내보내지 않는다(테스트는 직접 부른다).
import { cloneSettings, normalizeMcpServers, normalizeMcpSessionsAgents } from "./normalize";
import {
  DEFAULT_MESSENGER_AWAY_AFTER_MIN,
  DEFAULT_MESSENGER_COMMAND_MIN_SECS,
  DEFAULT_MESSENGER_WHEN,
} from "$lib/messenger-notify";
import { DEFAULT_UI_SCALE } from "$lib/ui-scale";
import {
  cleanAllowRules,
  cleanBundleOff,
  cleanStringList,
  keybindingsToPayload,
  normalizeStringMap,
  triggersToPayload,
} from "$lib/settings-codec";
import type {
  AiPrefs,
  AppSettings,
  AppTheme,
  AutomationPrefs,
  MessengerPrefs,
  ShellPrefs,
  TermPrefs,
  VaultPrefs,
  WallpaperPrefs,
} from "./schema";
import {
  DEFAULT_APP_MODE,
  DEFAULT_BELL,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FILE_VIEW,
  DEFAULT_HOST_SORT,
  DEFAULT_MARK_AFTER_SECS,
  DEFAULT_NOTIFY_AFTER_SECS,
  DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  DEFAULT_OPACITY,
  DEFAULT_PROJECT_START_SCREEN,
  DEFAULT_AI_ICON_STYLE,
  DEFAULT_AI_AVATARS,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_EXEC_SORT,
  DEFAULT_RIGHT_CLICK,
  DEFAULT_STATUS_BAR,
  DEFAULT_STATUS_BAR_STYLE,
  DEFAULT_MATERIAL,
  DEFAULT_APP_ICON,
  DEFAULT_TERM_OPACITY,
  DEFAULT_TILE_HEADER,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_FIT,
  VAULT_AUTO_LOCK_DEFAULT,
  WALLPAPER_BLUR_MIN,
} from "./options";
import { APP_TOKEN_KEYS } from "./internal";

function messengerToPayload(m: MessengerPrefs): MessengerPrefs {
  const out: MessengerPrefs = {};
  if (m.when && m.when !== DEFAULT_MESSENGER_WHEN) out.when = m.when;
  if (m.agent_stop === false) out.agent_stop = false;
  if (m.agent_permission === false) out.agent_permission = false;
  if (typeof m.command_min_secs === "number" && m.command_min_secs !== DEFAULT_MESSENGER_COMMAND_MIN_SECS) {
    out.command_min_secs = m.command_min_secs;
  }
  if (m.osc === false) out.osc = false;
  if (m.operation_results === false) out.operation_results = false;
  if (m.operation_pending === false) out.operation_pending = false;
  if (m.include_summary === false) out.include_summary = false;
  if (m.include_command === true) out.include_command = true;
  if (m.include_conversation === false) out.include_conversation = false;
  if (typeof m.away_after_min === "number" && m.away_after_min !== DEFAULT_MESSENGER_AWAY_AFTER_MIN) {
    out.away_after_min = m.away_after_min;
  }
  if (m.discord === false) out.discord = false;
  if (m.slack === false) out.slack = false;
  if (m.telegram === false) out.telegram = false;
  if (m.telegram_chat === true) out.telegram_chat = true;
  if (m.discord_chat === true) out.discord_chat = true;
  if (m.slack_chat === true) out.slack_chat = true;
  return out;
}

export function toPayload(s: AppSettings): AppSettings {
  const app: AppTheme = {};
  for (const key of APP_TOKEN_KEYS) {
    const v = s.app[key];
    if (v) app[key] = v;
  }
  // `off` 는 "안 정함"(월페이퍼가 있으면 subtle) 추정을 이기는 값이라 기본값처럼 보여도 적는다.
  if (s.app.dynamic) app.dynamic = s.app.dynamic;
  if (typeof s.app.opacity === "number" && s.app.opacity !== DEFAULT_OPACITY) {
    app.opacity = s.app.opacity;
  }
  if (s.app.auto_reconnect === true) app.auto_reconnect = true;
  if (s.app.tray_on_close === false) app.tray_on_close = false;
  if (s.app.header_chip_order && s.app.header_chip_order.length > 0) app.header_chip_order = [...s.app.header_chip_order];
  if (s.app.header_chips_hidden && s.app.header_chips_hidden.length > 0) {
    app.header_chips_hidden = [...s.app.header_chips_hidden];
  }
  if (s.app.resource_rings === false) app.resource_rings = false;
  if (s.app.usage_rings === false) app.usage_rings = false;
  if (s.app.window_controls === true) app.window_controls = true;
  if (s.app.tiling) app.tiling = s.app.tiling;
  if (s.app.mode && s.app.mode !== DEFAULT_APP_MODE) app.mode = s.app.mode;
  if (s.app.language) app.language = s.app.language;
  if (s.app.tile_header && s.app.tile_header !== DEFAULT_TILE_HEADER) {
    app.tile_header = s.app.tile_header;
  }
  if (s.app.status_bar && s.app.status_bar !== DEFAULT_STATUS_BAR) {
    app.status_bar = s.app.status_bar;
  }
  if (s.app.status_bar_style && s.app.status_bar_style !== DEFAULT_STATUS_BAR_STYLE) {
    app.status_bar_style = s.app.status_bar_style;
  }
  if (s.app.material && s.app.material !== DEFAULT_MATERIAL) {
    app.material = s.app.material;
  }
  if (s.app.app_icon && s.app.app_icon !== DEFAULT_APP_ICON) {
    app.app_icon = s.app.app_icon;
  }
  if (typeof s.app.idle_lock_min === "number" && s.app.idle_lock_min > 0) {
    app.idle_lock_min = s.app.idle_lock_min;
  }
  if (typeof s.app.ui_scale === "number" && s.app.ui_scale !== DEFAULT_UI_SCALE) {
    app.ui_scale = s.app.ui_scale;
  }
  if (s.app.ui_font_family) app.ui_font_family = s.app.ui_font_family;

  const terminal: TermPrefs = {};
  if (s.terminal.theme) terminal.theme = s.terminal.theme;
  if (s.terminal.font_family) terminal.font_family = s.terminal.font_family;
  if (s.terminal.font_size) terminal.font_size = s.terminal.font_size;
  if (s.terminal.cursor_style && s.terminal.cursor_style !== DEFAULT_CURSOR_STYLE) {
    terminal.cursor_style = s.terminal.cursor_style;
  }
  if (s.terminal.webgl === false) terminal.webgl = false;
  if (s.terminal.tab_style) terminal.tab_style = s.terminal.tab_style;
  if (s.terminal.ligatures === true) terminal.ligatures = true;
  if (s.terminal.right_click && s.terminal.right_click !== DEFAULT_RIGHT_CLICK) {
    terminal.right_click = s.terminal.right_click;
  }
  if (s.terminal.confirm_multiline_paste === false) terminal.confirm_multiline_paste = false;
  if (s.terminal.osc52_clipboard === false) terminal.osc52_clipboard = false;
  if (s.terminal.osc_notify === false) terminal.osc_notify = false;
  if (s.terminal.inline_images === false) terminal.inline_images = false;
  if (s.terminal.inline_snippets === false) terminal.inline_snippets = false;
  if (s.terminal.local_shell_integration === false) terminal.local_shell_integration = false;
  // `0` 은 적는다 — 끈 것은 기본이 아니라 선택이라 파일에 남지 않으면 다음 실행에서 되살아난다.
  if (
    typeof s.terminal.notify_after_secs === "number" &&
    s.terminal.notify_after_secs !== DEFAULT_NOTIFY_AFTER_SECS
  ) {
    terminal.notify_after_secs = s.terminal.notify_after_secs;
  }
  if (
    typeof s.terminal.mark_after_secs === "number" &&
    s.terminal.mark_after_secs !== DEFAULT_MARK_AFTER_SECS
  ) {
    terminal.mark_after_secs = s.terminal.mark_after_secs;
  }
  if (s.terminal.bell && s.terminal.bell !== DEFAULT_BELL) terminal.bell = s.terminal.bell;
  if (
    typeof s.terminal.opacity === "number" &&
    s.terminal.opacity !== DEFAULT_TERM_OPACITY
  ) {
    terminal.opacity = s.terminal.opacity;
  }
  if (s.terminal.dynamic && Object.keys(s.terminal.dynamic).length > 0) {
    terminal.dynamic = { ...s.terminal.dynamic };
  }

  const shell: ShellPrefs = {};
  if (s.shell.default) shell.default = s.shell.default;

  const ai: AiPrefs = {};
  if (s.ai.start_dir) ai.start_dir = s.ai.start_dir;
  if (s.ai.notify_turn_end === false) ai.notify_turn_end = false;
  if (s.ai.notify_permission === false) ai.notify_permission = false;
  if (s.ai.notify_side_chat === false) ai.notify_side_chat = false;
  if (
    typeof s.ai.notify_focused_after_secs === "number" &&
    s.ai.notify_focused_after_secs !== DEFAULT_NOTIFY_FOCUSED_AFTER_SECS
  ) {
    ai.notify_focused_after_secs = s.ai.notify_focused_after_secs;
  }
  if (s.ai.codex_no_daemon === false) ai.codex_no_daemon = false;
  if (s.ai.claude_statusline === false) ai.claude_statusline = false;
  if (s.ai.icon_style && s.ai.icon_style !== DEFAULT_AI_ICON_STYLE) ai.icon_style = s.ai.icon_style;
  if (s.ai.avatar_claude && s.ai.avatar_claude !== DEFAULT_AI_AVATARS.claude) ai.avatar_claude = s.ai.avatar_claude;
  if (s.ai.avatar_codex && s.ai.avatar_codex !== DEFAULT_AI_AVATARS.codex) ai.avatar_codex = s.ai.avatar_codex;
  const args = normalizeStringMap(s.ai.args);
  if (args) ai.args = args;
  const mcpServers = normalizeMcpServers(s.ai.mcp_servers);
  if (mcpServers) ai.mcp_servers = mcpServers;
  if (s.ai.mcp_sessions_enabled === false) ai.mcp_sessions_enabled = false;
  const mcpSessionsAgents = normalizeMcpSessionsAgents(s.ai.mcp_sessions_agents);
  if (mcpSessionsAgents) ai.mcp_sessions_agents = mcpSessionsAgents;
  const disabledAgents = cleanStringList(s.ai.disabled_agents);
  if (disabledAgents.length > 0) ai.disabled_agents = disabledAgents;

  // `file` 은 백엔드가 정한 값을 되돌려 보낼 뿐이지만, 저장은 전체 재작성이라 빼면 방금 건 배경이 다음 [저장] 에 사라진다.
  const wallpaperPrefs: WallpaperPrefs = {};
  if (s.wallpaper.file) wallpaperPrefs.file = s.wallpaper.file;
  if (typeof s.wallpaper.dim === "number" && s.wallpaper.dim !== DEFAULT_WALLPAPER_DIM) {
    wallpaperPrefs.dim = s.wallpaper.dim;
  }
  if (typeof s.wallpaper.blur === "number" && s.wallpaper.blur !== WALLPAPER_BLUR_MIN) {
    wallpaperPrefs.blur = s.wallpaper.blur;
  }
  if (s.wallpaper.fit && s.wallpaper.fit !== DEFAULT_WALLPAPER_FIT) {
    wallpaperPrefs.fit = s.wallpaper.fit;
  }

  // 자동 승인은 언제나 전체 객체를 보낸다 — 기본값이면 백엔드가 `[automation]` 을 안 쓴다.
  const automation: AutomationPrefs = {
    auto_approve: s.automation.auto_approve,
    allow_patterns: cleanStringList(s.automation.allow_patterns),
    // 묶음 · 끈 명령 · 알림 칸도 언제나 보낸다 — 빼면 백엔드가 "파일에 없음" 으로 읽어 저장 한 번에 기본으로 되돌아간다.
    bundles: cleanStringList(s.automation.bundles),
    bundle_off: cleanBundleOff(s.automation.bundle_off),
    max_targets: s.automation.max_targets,
    max_concurrency: s.automation.max_concurrency,
    auto_max_per_window: s.automation.auto_max_per_window,
    auto_window_secs: s.automation.auto_window_secs,
    approval_ttl_minutes: s.automation.approval_ttl_minutes,
    notify_review_requests: s.automation.notify_review_requests,
    notify_operation_results: s.automation.notify_operation_results,
    audit_retention_days: s.automation.audit_retention_days,
    audit_output_excerpt: s.automation.audit_output_excerpt,
    allow_pipes: s.automation.allow_pipes,
    // 빼면 백엔드가 저장 때 손편집 `[[automation.allow]]` 를 지운다.
    allow: cleanAllowRules(s.automation.allow),
  };

  // 기본값(30분) · 안 정함이면 적지 않는다 — `0`("잠그지 않는다")은 기본값과 다른 답이라 적는다.
  const vaultPrefs: VaultPrefs = {};
  if (
    typeof s.vault.auto_lock_minutes === "number" &&
    s.vault.auto_lock_minutes !== VAULT_AUTO_LOCK_DEFAULT
  ) {
    vaultPrefs.auto_lock_minutes = s.vault.auto_lock_minutes;
  }

  // 트리거는 빈 배열도 언제나 보낸다 — 빼면 백엔드가 내장 두 개를 되살려 다 지운 목록이 저장 한 번에 부활한다.
  return {
    app,
    terminal,
    shell,
    ai,
    wallpaper: wallpaperPrefs,
    triggers: triggersToPayload(s.triggers),
    keybindings: keybindingsToPayload(s.keybindings),
    automation,
    vault: vaultPrefs,
    hosts: s.hosts.sort && s.hosts.sort !== DEFAULT_HOST_SORT ? { sort: s.hosts.sort } : {},
    files: {
      ...(s.files.default_view && s.files.default_view !== DEFAULT_FILE_VIEW
        ? { default_view: s.files.default_view }
        : {}),
      ...(s.files.auto_refresh === false ? { auto_refresh: false } : {}),
    },
    projects:
      s.projects.start_screen && s.projects.start_screen !== DEFAULT_PROJECT_START_SCREEN
        ? { start_screen: s.projects.start_screen }
        : {},
    dock: s.dock.layout && s.dock.layout !== DEFAULT_DOCK_LAYOUT ? { layout: s.dock.layout } : {},
    plans: s.plans.exec_sort && s.plans.exec_sort !== DEFAULT_EXEC_SORT ? { exec_sort: s.plans.exec_sort } : {},
    updates: s.updates.auto_check === false ? { auto_check: false } : {},
    messenger: messengerToPayload(s.messenger),
    remote: {
      ...(s.remote.enabled ? { enabled: true } : {}),
      ...(s.remote.port !== undefined ? { port: s.remote.port } : {}),
      ...(s.remote.host ? { host: s.remote.host } : {}),
    },
  };
}

/** 떠 낸 사본을 보내고 돌려준다 — 끝난 뒤의 `current` 를 저장됨으로 적으면 기다리는 사이의 편집이 디스크에 없는데 "저장됨" 으로 보인다 */
export async function sendSnapshot(
  current: AppSettings,
  send: (payload: AppSettings) => Promise<unknown>,
): Promise<AppSettings> {
  const sent = cloneSettings(current);
  await send(toPayload(sent));
  return sent;
}
