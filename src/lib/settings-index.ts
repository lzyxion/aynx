import type { Key } from "$lib/i18n/keys";

/**
 * 설정 화면의 섹션 목록과 팔레트가 찾는 설정 색인 — 순수 데이터다(DOM 을 긁지 않는다 · 색인 줄은 사람이 고른다).
 * 목록을 `SettingsModal` 밖에 두는 것은 색인의 섹션 id 를 시험이 대조하게 하려는 것이다.
 */

/**
 * 비활성 섹션은 언마운트하지 않고 `hidden` 으로만 숨긴다 — `{#if}` 로 갈아 끼우면 단축키 기록 모드 · 트리거 작성 중 초안 같은
 * 지역 상태가 탭을 옮길 때마다 날아간다.
 * `dividerBefore` — 묶음 경계에만 구분선(docs/log/2026-09-30-settings-nav-order.md). `icon` 은 `scripts/gen-ui-icons.mjs` 의 WANTED 이름.
 */
export const SETTINGS_SECTIONS = [
  { id: "theme", labelKey: "settings.nav.theme", icon: "palette" },
  { id: "general", labelKey: "settings.nav.general", icon: "settings" },
  { id: "keys", labelKey: "settings.nav.keys", icon: "keyboard" },

  { id: "terminal", labelKey: "settings.nav.terminal", icon: "terminal", dividerBefore: true },
  { id: "snippets", labelKey: "settings.nav.snippets", icon: "snippet" },
  { id: "triggers", labelKey: "settings.nav.triggers", icon: "zap" },
  { id: "templates", labelKey: "settings.nav.templates", icon: "layout" },

  { id: "ai", labelKey: "settings.nav.ai", icon: "ai", dividerBefore: true },
  { id: "mcp", labelKey: "settings.nav.mcp", icon: "mcp" },
  { id: "instructions", labelKey: "settings.nav.instructions", icon: "file-text" },
  { id: "automation", labelKey: "settings.nav.automation", icon: "shield-check" },
  { id: "notifications", labelKey: "settings.nav.notifications", icon: "bell" },

  { id: "credentials", labelKey: "settings.nav.credentials", icon: "lock", dividerBefore: true },
  { id: "remote", labelKey: "settings.nav.remote", icon: "remote" },
] as const satisfies readonly { id: string; labelKey: Key; icon: string; dividerBefore?: true }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * - `groupKey` — 이름이 홀로 서지 못하는 줄("어둡게"·"상태")에만 단다.
 * - `labelKey` — 설정 화면이 쓰는 바로 그 키. 없으면 섹션 자체를 가리키는 줄이다.
 * - `anchor` — 그 줄의 DOM id(대개 `<label for>`). 영문 검색어로도 쓴다.
 */
export type SettingsIndexEntry = {
  section: SettingsSectionId;
  groupKey?: Key;
  labelKey?: Key;
  anchor?: string;
};

const row = (
  section: SettingsSectionId,
  labelKey: Key,
  anchor: string,
  groupKey?: Key,
): SettingsIndexEntry => ({ section, labelKey, anchor, ...(groupKey ? { groupKey } : {}) });

/** `McpSection` 의 에이전트 블록 안 줄 id — 화면과 색인이 이 함수 하나를 함께 써서 글자가 갈리지 않는다 */
export type AgentAnchorPart = "agent" | "enabled" | "mcp" | "hooks" | "args";
export function agentAnchor(agent: string, part: AgentAnchorPart): string {
  return `ai-${part}-${agent}`;
}

/** 단축키 표의 줄 · 스니펫 · 트리거 편집기 칸 · CLI 별 등록 단추는 올리지 않는다 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  ...SETTINGS_SECTIONS.map((s) => ({ section: s.id })),

  // 테마
  row("theme", "settings.theme.profile.heading", "theme-profile"),
  row("theme", "settings.theme.wallpaper.dim.label", "wp-dim", "settings.theme.wallpaper.heading"),
  row("theme", "settings.theme.wallpaper.blur.label", "wp-blur", "settings.theme.wallpaper.heading"),
  row("theme", "settings.theme.wallpaper.fit.label", "wp-fit", "settings.theme.wallpaper.heading"),
  row("theme", "settings.theme.palette.heading", "app-colors"),
  row("theme", "settings.theme.palette.extract", "app-dynamic", "settings.theme.palette.heading"),
  row("theme", "settings.theme.palette.prism", "app-color-prism", "settings.theme.palette.heading"),
  row("theme", "settings.theme.palette.classic", "app-color-classic", "settings.theme.palette.heading"),
  row("theme", "settings.theme.palette.mono", "app-color-mono", "settings.theme.palette.heading"),
  row("theme", "settings.theme.mode.label", "app-mode", "settings.theme.mode.heading"),
  row("theme", "settings.theme.color.opacity.label", "app-opacity", "settings.theme.color.heading"),
  row("theme", "settings.theme.color.term_opacity.label", "term-opacity"),
  row("theme", "settings.theme.material.label", "material"),
  row("theme", "settings.theme.tabs.style.label", "tab-style"),
  row("theme", "settings.theme.window_controls.label", "window-controls", "settings.theme.tabs.style.label"),
  row("theme", "settings.theme.statusbar.label", "status-bar"),
  row("theme", "settings.theme.statusbar.style.label", "status-bar-style"),
  row("theme", "settings.theme.dock.label", "dock-layout"),
  row("theme", "settings.theme.tile.tiling.label", "tiling"),
  row("theme", "settings.theme.tile.header.label", "tile-header"),
  // 아바타 하위 화면 — 열기는 `AppThemeSection.expandForAnchor`
  row("theme", "settings.theme.avatars.label", "avatars-open"),
  row("theme", "settings.theme.avatar.style.label", "ai-icon-style", "settings.theme.avatars.label"),
  row("theme", "settings.avatars.library.heading", "avatar-library", "settings.theme.avatars.label"),
  row("theme", "settings.avatars.slot.app", "app-icon", "settings.theme.avatars.label"),
  row("theme", "settings.avatars.slot.claude", "avatar-claude", "settings.theme.avatars.label"),
  row("theme", "settings.avatars.slot.codex", "avatar-codex", "settings.theme.avatars.label"),

  // 일반
  row("general", "settings.general.language.label", "app-language"),
  row("general", "settings.general.ui_scale.label", "app-ui-scale"),
  row("general", "settings.general.ui_font.label", "app-ui-font"),
  row("general", "settings.general.reconnect.label", "app-auto-reconnect"),
  row("general", "settings.general.history.label", "app-host-history"),
  row("general", "settings.general.project_start.label", "project-start-screen"),
  row("general", "settings.general.tray.label", "app-tray-on-close"),
  row("general", "settings.general.files_view.label", "files-default-view", "settings.general.files.heading"),
  row("general", "settings.general.files_refresh.label", "files-auto-refresh", "settings.general.files.heading"),
  row("general", "settings.general.transfer.export.label", "settings-export", "settings.general.transfer.heading"),
  row("general", "settings.general.transfer.import.label", "settings-import", "settings.general.transfer.heading"),

  // 터미널
  row("terminal", "settings.terminal.shell.label", "default-shell"),
  row("terminal", "settings.terminal.theme.label", "term-preset"),
  row("terminal", "settings.terminal.font.label", "term-font"),
  row("terminal", "settings.terminal.size.label", "term-size"),
  row("terminal", "settings.terminal.header_chips.label", "header-chips"),
  row("terminal", "settings.terminal.cursor.label", "cursor-style"),
  row("terminal", "settings.terminal.webgl.label", "term-webgl"),
  row("terminal", "settings.terminal.ligatures.label", "term-ligatures"),
  row("terminal", "settings.terminal.inline_images.label", "term-inline-images"),
  row("terminal", "settings.terminal.right_click.label", "right-click"),
  row("terminal", "settings.terminal.paste_confirm.label", "paste-confirm"),
  row("terminal", "settings.terminal.osc52.label", "osc52-clipboard"),
  row("terminal", "settings.terminal.shell_integration.label", "local-shell-integration"),
  row("terminal", "settings.terminal.inline_snippets.label", "inline-snippets"),
  row("terminal", "settings.terminal.mark.label", "mark-after"),
  row("terminal", "settings.terminal.bell.label", "bell"),
  row("terminal", "settings.terminal.logs_folder.label", "logs-folder"),

  // AI 에이전트
  row("ai", "settings.ai.start_dir.label", "ai-start-dir", "settings.ai.common.subhead"),
  row("ai", "settings.ai.agent.enabled.label", agentAnchor("claude", "enabled"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.hooks.label", agentAnchor("claude", "hooks"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.claude_statusline.label", "ai-claude-statusline", "settings.ai.agent.claude"),
  row("ai", "settings.ai.args.label", agentAnchor("claude", "args"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.agent.enabled.label", agentAnchor("codex", "enabled"), "settings.ai.agent.codex"),
  row("ai", "settings.ai.hooks.label", agentAnchor("codex", "hooks"), "settings.ai.agent.codex"),
  row("ai", "settings.ai.codex_no_daemon.label", "ai-codex-no-daemon", "settings.ai.agent.codex"),
  row("ai", "settings.ai.args.label", agentAnchor("codex", "args"), "settings.ai.agent.codex"),

  // MCP
  row("mcp", "settings.ai.external.list.subhead", "ai-mcp-servers"),
  row("mcp", "settings.ai.server.label", "ai-mcp-sessions", "settings.ai.external.list.subhead"),
  // 세션 서버 하위 화면 — 열기는 `McpManager.expandForAnchor`
  row("mcp", "settings.ai.endpoint.label", "ai-mcp-sessions-info", "settings.ai.sessions.label"),
  row("mcp", "settings.ai.sessions.view.tools", "ai-mcp-sessions-tools", "settings.ai.sessions.label"),
  row("mcp", "settings.ai.sessions.view.calls", "ai-mcp-sessions-calls", "settings.ai.sessions.label"),

  // 지침
  row("instructions", "settings.instructions.side_chat.name", "instructions-side-chat"),
  row("instructions", "settings.instructions.list", "instructions-list"),
  row("instructions", "settings.instructions.add", "instructions-add"),
  row("instructions", "settings.instructions.import", "instructions-import"),
  row("instructions", "settings.instructions.preview.open", "instructions-apply"),

  // 자동 승인
  row("automation", "settings.automation.approve.label", "auto-approve"),
  row("automation", "settings.automation.bundles.label", "auto-bundles"),
  row("automation", "settings.automation.allow.label", "auto-allow"),
  row("automation", "settings.automation.targets.label", "auto-max-targets"),
  row("automation", "settings.automation.concurrency.label", "auto-max-concurrency"),
  row("automation", "settings.automation.ttl.label", "approval-ttl"),
  row("automation", "settings.automation.retention.label", "audit-retention"),
  row("automation", "settings.automation.excerpt.label", "audit-output-excerpt"),


  // 알림
  row("notifications", "settings.ai.notify_turn_end.label", "ai-notify-turn-end", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_permission.label", "ai-notify-permission", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_focused.label", "ai-notify-focused-after", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_side_chat.label", "ai-notify-side-chat", "settings.notifications.app.subhead"),
  row("notifications", "settings.terminal.notify.label", "notify-after", "settings.notifications.app.subhead"),
  row("notifications", "settings.terminal.osc_notify.label", "osc-notify", "settings.notifications.app.subhead"),
  row("notifications", "settings.automation.notify.label", "notify-review", "settings.notifications.app.subhead"),
  // 메신저 규칙 줄은 채널이 없으면 숨는다 — 그때는 `MessengerSettings` 의 `RULE_ANCHORS`(`data-anchor-for`)로 채널 상자에 떨어진다.
  // 봇 말하기 줄도 짝짓기 전이면 줄이 없어 그 채널 칸으로 떨어진다
  row("notifications", "settings.messenger.channel.discord", "messenger-channel-discord", "settings.messenger.heading"),
  row("notifications", "settings.messenger.bot.chat.label", "messenger-channel-discord-chat", "settings.messenger.channel.discord"),
  row("notifications", "settings.messenger.channel.slack", "messenger-channel-slack", "settings.messenger.heading"),
  row("notifications", "settings.messenger.bot.chat.label", "messenger-channel-slack-chat", "settings.messenger.channel.slack"),
  row("notifications", "settings.messenger.channel.telegram", "messenger-channel-telegram", "settings.messenger.heading"),
  row("notifications", "settings.messenger.bot.chat.label", "messenger-channel-telegram-chat", "settings.messenger.channel.telegram"),
  row("notifications", "settings.messenger.when.label", "messenger-when", "settings.messenger.heading"),
  row("notifications", "settings.messenger.away.label", "messenger-away-after", "settings.messenger.heading"),
  row("notifications", "settings.messenger.command.label", "messenger-command-min", "settings.messenger.heading"),
  row("notifications", "settings.messenger.include_command.label", "messenger-include-command", "settings.messenger.heading"),
  row("notifications", "settings.messenger.include_conversation.label", "messenger-include-conversation", "settings.messenger.heading"),

  // 보안
  row("credentials", "settings.credentials.state.label", "vault-state", "commands.palette.setting.vault"),
  row("credentials", "settings.credentials.master.label", "vault-master"),
  row("credentials", "settings.credentials.items.label", "vault-items"),
  row("credentials", "settings.credentials.delegation.label", "delegation-targets"),
  row("credentials", "settings.credentials.dbai.label", "db-ai-targets"),
  row("credentials", "settings.general.idle.label", "lock-idle"),

  // 원격 접속
  row("remote", "settings.remote.enabled.label", "remote-enabled"),
  row("remote", "settings.remote.host.label", "remote-host"),
  row("remote", "settings.remote.devices.subhead", "remote-devices-label"),
  row("remote", "settings.remote.check.subhead", "remote-checklist"),
];

/** 원격 창 화면에서 `{#if !isRemote}` 로 빠지는 줄 — 팔레트가 없는 줄로 데려가지 않게 색인에서도 뺀다 */
const MAIN_PC_ONLY_ANCHORS: ReadonlySet<string> = new Set(["settings-export", "settings-import"]);

export function settingsIndexFor(remoteWindow: boolean): readonly SettingsIndexEntry[] {
  if (!remoteWindow) return SETTINGS_INDEX;
  return SETTINGS_INDEX.filter((e) => e.anchor === undefined || !MAIN_PC_ONLY_ANCHORS.has(e.anchor));
}

export function sectionLabelKey(id: SettingsSectionId): Key {
  const s = SETTINGS_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown settings section: ${id}`);
  return s.labelKey;
}

export function settingPath(e: SettingsIndexEntry, tr: (key: Key) => string): string[] {
  const out = [tr(sectionLabelKey(e.section))];
  if (e.groupKey) out.push(tr(e.groupKey));
  if (e.labelKey) out.push(tr(e.labelKey));
  return out;
}

export function settingSearchText(e: SettingsIndexEntry, tr: (key: Key) => string): string {
  const en = [e.section, e.anchor?.replace(/-/g, " ") ?? ""].join(" ");
  return `${settingPath(e, tr).join(" ")} ${en}`;
}
