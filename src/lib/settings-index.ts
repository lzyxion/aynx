import type { Key } from "$lib/i18n/keys";

/**
 * 설정 화면의 **섹션 목록**과 팔레트가 찾는 **설정 색인** (docs/log/2026-09-25-palette.md).
 *
 * 둘이 한 파일인 이유는 색인의 모든 줄이 섹션 id 하나에 매이기 때문이다 — 섹션 목록이
 * `SettingsModal` 안의 지역 상수로 남아 있으면 색인이 가리키는 id 가 실제로 있는지를 아무도
 * 보지 못한다(단위 시험이 컴포넌트 안을 읽을 수 없다). 그래서 목록을 여기로 꺼내고
 * `SettingsModal` 이 이것을 그대로 쓴다.
 *
 * 순수 데이터다 — DOM 을 긁지 않는다. 설정 줄을 새로 만들었다고 저절로 색인되지 않는 것은
 * 알고 한 선택이다: 긁으면 섹션을 한 번씩 그려 봐야 하고(숨긴 섹션은 `hidden` 이다), 색인에
 * 오를 가치가 있는 줄은 이름이 홀로 서는 손잡이뿐이라 사람이 고르는 편이 낫다.
 */

/**
 * 좌측 사이드 내비 + 우측 내용 패널 (VS Code 식). 세로 목록이던 섹션들을 카테고리로
 * 묶어, 한 번에 한 카테고리만 보여 준다. **탭 바** 는 터미널 겉모양이라 "터미널" 로 합쳤다.
 *
 * 비활성 카테고리는 **언마운트하지 않고 `hidden` 으로만 숨긴다** — `{#if}` 로 갈아 끼우면
 * 단축키의 **기록 모드**나 트리거의 **작성 중 초안**, 접힌 설명의 펼침 상태 같은 지역
 * 상태가 탭을 옮길 때마다 날아간다. 계속 붙여 두고 `hidden` 만 토글하면 상태가 그대로
 * 살아 남는다 (숨김이 확실히 이기도록 CSS 에 `section[hidden]{display:none!important}`).
 */
export const SETTINGS_SECTIONS = [
  // ── 묶음 1: **앱 전체에 걸리는 것** ─────────────────────────────────────────────
  // 네 묶음이고, 묶음 사이에는 **얇은 구분선만** 긋는다(머리글 없음) — 다음 묶음의 첫 칸에
  // `dividerBefore: true` 를 단다 (docs/log/2026-09-30-settings-nav-order.md).
  //
  // 칸마다 `icon` — 왼쪽 메뉴가 이름 앞에 그리는 `UiIcon` 이름(`scripts/gen-ui-icons.mjs` 의 WANTED).
  //
  // 테마가 **맨 앞**, 일반이 그다음이다(2026-10-17 사용자 — 예전엔 일반이 맨 앞, 이름은 "앱 테마").
  // 설정을 처음 열면 첫 칸(테마)이 보인다.
  //
  // 월페이퍼는 **테마 안의 소제목**이다. `settings.toml` 에서는 `[app]` 이 아니라
  // `[wallpaper]` 라 층이 다르지만, 화면에서 하는 일은 결국 하나다 — "창이 어떻게 보이는가".
  { id: "theme", labelKey: "settings.nav.theme", icon: "palette" },
  // 아바타(2026-10-31 — docs/log/2026-10-31-avatars.md 4절)는 왼쪽 메뉴 칸이 아니라 **테마 안의 하위 화면**이다 — 요약의
  // "아바타" 줄([설정 ›])이 연다. 색인 줄은 아래 테마 묶음에 있고 `AppThemeSection.expandForAnchor` 가 그 화면을 연다.
  // 일반 — 여기 있는 값은 어느 한 화면의 것이 아니라 앱 전부에 걸린다(언어·시작 동작·프라이버시 —
  // docs/log/2026-09-17-i18n.md). **옛 `workspace`(탭)·`lock`(잠금) 칸이 여기로 접혔다**
  // (docs/log/2026-09-17-settings-general.md) — 손잡이가 하나뿐인 섹션이 내비 한 칸씩을
  // 쓰면서 정작 화면은 거의 비어 있었다. 바깥에서 그 id 로 들어오던 딥링크는 없다.
  { id: "general", labelKey: "settings.nav.general", icon: "settings" },
  // 단축키가 이 묶음에 드는 것은 키 대부분이 터미널 안이 아니라 **탭·타일·독을 다루는 앱 조작**
  // 이라서다 (터미널 안의 일 — 스니펫·트리거 — 은 다음 묶음).
  { id: "keys", labelKey: "settings.nav.keys", icon: "keyboard" },

  // ── 묶음 2: **터미널 안의 일** ─────────────────────────────────────────────────
  // 옛 `shell`(셸) 칸도 여기 맨 윗줄로 접혔다 — `settings.toml` 의 층(`[shell]` ≠
  // `[terminal]`)은 그대로지만, 사용자가 기본 셸을 찾는 자리는 어차피 "터미널" 이다.
  { id: "terminal", labelKey: "settings.nav.terminal", icon: "terminal", dividerBefore: true },
  // 스니펫은 터미널에 글자를 넣는 일이라 이 묶음이다. `settings.toml` 이 아니라 자기 파일
  // (`snippets.json`)에 사는 것은 레이아웃·테마 프로필과 같다 (docs/log/2026-09-16-snippets.md).
  { id: "snippets", labelKey: "settings.nav.snippets", icon: "snippet" },
  // 트리거는 터미널의 새 출력에 하이라이트·링크·툴팁을 붙이는 일이라 스니펫 곁이다.
  { id: "triggers", labelKey: "settings.nav.triggers", icon: "zap" },

  // ── 묶음 3: **에이전트의 일** ──────────────────────────────────────────────────
  { id: "ai", labelKey: "settings.nav.ai", icon: "ai", dividerBefore: true },
  { id: "mcp", labelKey: "settings.nav.mcp", icon: "mcp" },
  // 지침은 에이전트가 읽는 파일을 관리하는 일이라 MCP 다음, 자동 승인 앞에 둔다.
  { id: "instructions", labelKey: "settings.nav.instructions", icon: "file-text" },
  // 자동 승인은 AI 에이전트 바로 아래다 — AI 가 제안한 작업안을 다루는 정책이라 층이 같다
  // (docs/log/2026-09-10-auto-approval.md).
  { id: "automation", labelKey: "settings.nav.automation", icon: "shield-check" },
  // 알림은 이 묶음의 끝이다 (2026-09-30). 흩어져 있던 알림 칸을 화면만 한자리로 모은 섹션인데
  // (docs/log/2026-09-27-discord-notify.md), 칸 대부분이 에이전트의 일 — 턴 끝·권한 · 검토 요청 ·
  // 메신저 — 이다. 긴 명령·프로그램 알림 둘만 터미널에서 왔다.
  { id: "notifications", labelKey: "settings.nav.notifications", icon: "bell" },

  // ── 묶음 4: **드물게 여는 비밀 관리** ──────────────────────────────────────────
  // **보안(섹션 id 는 `credentials`)은 맨 아래**다 (2026-09-30). 볼트·마스터 암호·저장 항목·위임
  // 대상 — 전부 **비밀을 다루는 일**이라 언어·시작 동작과 층이 다르고, 한 번 정해 두면 드물게 연다
  // (docs/log/2026-09-19-vault.md). 접속 모달의 곁말("설정 › 보안에서 마스터 암호를 둘 수 있습니다")은
  // 이름으로 가리키므로 자리가 바뀌어도 길은 그대로다.
  { id: "credentials", labelKey: "settings.nav.credentials", icon: "lock", dividerBefore: true },
  // **원격 접속**(R1a-5 — 원격 웹 클라이언트)은 보안 바로 아래, 같은 묶음이다 — 켜기·이름·기기 폐기·보안 점검이 전부
  // "누가 이 PC 에 들어올 수 있나" 라 볼트와 층이 같고, 한 번 정해 두면 드물게 연다.
  { id: "remote", labelKey: "settings.nav.remote", icon: "remote" },
] as const satisfies readonly { id: string; labelKey: Key; icon: string; dividerBefore?: true }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * 색인 한 줄 — 팔레트에서 **"설정 › 터미널 › WebGL 가속"** 으로 그려진다.
 *
 * - `section` — 여는 섹션 (`settingsNav.want` 로 간다).
 * - `groupKey` — 섹션 안의 소제목. 이름이 홀로 서지 못하는 줄("어둡게"·"상태")에만 단다.
 * - `labelKey` — 줄의 이름. **설정 화면이 쓰는 바로 그 키**다(한 이름이 두 화면에서 갈리지 않게).
 *   없으면 섹션 자체를 가리키는 줄이다.
 * - `anchor` — 그 줄의 DOM id(대개 컨트롤의 `id` = `<label for>`). 섹션을 편 뒤 그 자리로
 *   스크롤하고, 포커스를 받을 수 있는 요소면 포커스도 준다. 영문 검색어로도 쓴다
 *   (`>webgl` 처럼 영문 자판으로 친 사람이 찾게 — 명령 줄이 영문 id 를 함께 훑는 것과 같은 이유).
 */
export type SettingsIndexEntry = {
  section: SettingsSectionId;
  groupKey?: Key;
  labelKey?: Key;
  anchor?: string;
};

/** 줄 하나를 짧게 적는 도우미 — 표가 한 줄에 한 항목으로 읽히게 */
const row = (
  section: SettingsSectionId,
  labelKey: Key,
  anchor: string,
  groupKey?: Key,
): SettingsIndexEntry => ({ section, labelKey, anchor, ...(groupKey ? { groupKey } : {}) });

/**
 * **AI 에이전트 섹션의 에이전트 블록 안 줄 id** — `McpSection` 이 블록을 에이전트 표로 돌며 그리므로
 * id 도 에이전트 id 로 짓는다(`ai-args-claude` · `ai-hooks-codex` · 카드 머리의 사용 토글은 `ai-enabled-claude` ·
 * 블록 자체는 `ai-agent-claude`).
 * 화면과 색인이 이 함수 하나를 함께 써서 두 쪽의 글자가 갈리지 않는다.
 */
export type AgentAnchorPart = "agent" | "enabled" | "mcp" | "hooks" | "args";
export function agentAnchor(agent: string, part: AgentAnchorPart): string {
  return `ai-${part}-${agent}`;
}

/**
 * 색인. 섹션 줄(섹션 이름만) 열 + 이름 붙은 손잡이들.
 *
 * 올리지 않은 것: 단축키 표의 줄 하나하나(명령 줄이 이미 같은 이름으로 팔레트에 선다) ·
 * 스니펫·트리거의 편집기 칸(항목마다 되풀이되는 칸이라 홀로 선 설정이 아니다) ·
 * CLI 별 등록·복사 단추(줄 이름 "MCP 등록" 이 에이전트마다 대신 선다).
 */
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
  // 아바타 — 요약 줄([설정 ›]) + 하위 화면 안의 줄(소제목 = "아바타" · 열기는 `AppThemeSection.expandForAnchor`)
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
  row("general", "settings.general.files_view.label", "files-default-view"),
  row("general", "settings.general.files_refresh.label", "files-auto-refresh"),
  row("general", "settings.general.project_start.label", "project-start-screen"),
  row("general", "settings.general.idle.label", "lock-idle", "settings.general.privacy.heading"),
  row("general", "settings.general.tray.label", "app-tray-on-close", "settings.general.server.heading"),

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
  // (docs/log/2026-09-27-ai-agents-settings.md). 에이전트 블록 안의 줄은 `agentAnchor` 로 id 를 짓는다.
  row("ai", "settings.ai.start_dir.label", "ai-start-dir", "settings.ai.common.subhead"),
  row("ai", "settings.ai.agent.enabled.label", agentAnchor("claude", "enabled"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.hooks.label", agentAnchor("claude", "hooks"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.claude_statusline.label", "ai-claude-statusline", "settings.ai.agent.claude"),
  row("ai", "settings.ai.args.label", agentAnchor("claude", "args"), "settings.ai.agent.claude"),
  row("ai", "settings.ai.agent.enabled.label", agentAnchor("codex", "enabled"), "settings.ai.agent.codex"),
  row("ai", "settings.ai.hooks.label", agentAnchor("codex", "hooks"), "settings.ai.agent.codex"),
  row("ai", "settings.ai.codex_no_daemon.label", "ai-codex-no-daemon", "settings.ai.agent.codex"),
  row("ai", "settings.ai.args.label", agentAnchor("codex", "args"), "settings.ai.agent.codex"),

  // MCP — 서버 주입 선택과 세션 서버 하위 화면(상태 · 제공 도구 · 최근 호출).
  row("mcp", "settings.ai.external.list.subhead", "ai-mcp-servers"),
  row("mcp", "settings.ai.server.label", "ai-mcp-sessions", "settings.ai.external.list.subhead"),
  // 세션 서버 하위 화면(고정 줄을 누르면 열린다 — `McpManager.expandForAnchor` 가 그 화면으로 간다)
  row("mcp", "settings.ai.endpoint.label", "ai-mcp-sessions-info", "settings.ai.sessions.label"),
  row("mcp", "settings.ai.sessions.view.tools", "ai-mcp-sessions-tools", "settings.ai.sessions.label"),
  row("mcp", "settings.ai.sessions.view.calls", "ai-mcp-sessions-calls", "settings.ai.sessions.label"),

  // 지침 — 팔레트 목적지는 모두 요약 화면에 있다.
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


  // 알림 — 창 안·OS 알림 · Discord (docs/log/2026-09-27-discord-notify.md). 줄 id(=anchor)는 옛 섹션에서
  // 쓰던 그대로다 — 옮긴 것은 화면 자리뿐이다. Discord 줄은 이름이 홀로 서지 못해 소제목을 붙인다
  row("notifications", "settings.ai.notify_turn_end.label", "ai-notify-turn-end", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_permission.label", "ai-notify-permission", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_focused.label", "ai-notify-focused-after", "settings.notifications.app.subhead"),
  row("notifications", "settings.ai.notify_side_chat.label", "ai-notify-side-chat", "settings.notifications.app.subhead"),
  row("notifications", "settings.terminal.notify.label", "notify-after", "settings.notifications.app.subhead"),
  row("notifications", "settings.terminal.osc_notify.label", "osc-notify", "settings.notifications.app.subhead"),
  row("notifications", "settings.automation.notify.label", "notify-review", "settings.notifications.app.subhead"),
  // 메신저 채널 줄은 카드 자체를 가리킨다. 규칙 줄은 채널이 하나도 없으면 숨는데, 그때는 채널 상자로 떨어진다
  // (`MessengerSettings` 의 `RULE_ANCHORS` → `data-anchor-for` · docs/log/2026-09-28-messenger-channels.md "3단계")
  row("notifications", "settings.messenger.channel.discord", "messenger-channel-discord", "settings.messenger.heading"),
  row("notifications", "settings.messenger.channel.slack", "messenger-channel-slack", "settings.messenger.heading"),
  row("notifications", "settings.messenger.when.label", "messenger-when", "settings.messenger.heading"),
  row("notifications", "settings.messenger.away.label", "messenger-away-after", "settings.messenger.heading"),
  row("notifications", "settings.messenger.command.label", "messenger-command-min", "settings.messenger.heading"),
  row("notifications", "settings.messenger.include_command.label", "messenger-include-command", "settings.messenger.heading"),
  row("notifications", "settings.messenger.include_conversation.label", "messenger-include-conversation", "settings.messenger.heading"),

  // 보안 — "상태" 는 홀로 서지 못해 소제목(볼트)을 붙인다
  row("credentials", "settings.credentials.state.label", "vault-state", "commands.palette.setting.vault"),
  row("credentials", "settings.credentials.master.label", "vault-master"),
  // 목록 셋은 하위 화면이다(2026-10-21) — 색인은 요약의 [관리 ›] 단추를 가리킨다(자동 승인의 `auto-bundles` 와 같은 꼴)
  row("credentials", "settings.credentials.items.label", "vault-items"),
  row("credentials", "settings.credentials.delegation.label", "delegation-targets"),
  row("credentials", "settings.credentials.dbai.label", "db-ai-targets"),

  // 원격 접속
  row("remote", "settings.remote.enabled.label", "remote-enabled"),
  row("remote", "settings.remote.host.label", "remote-host"),
  row("remote", "settings.remote.devices.subhead", "remote-devices-label"),
  row("remote", "settings.remote.check.subhead", "remote-checklist"),
];

/** 섹션 id → 그 이름의 문구 키 */
export function sectionLabelKey(id: SettingsSectionId): Key {
  const s = SETTINGS_SECTIONS.find((x) => x.id === id);
  // 타입이 id 를 좁혀 두어 여기로 떨어질 일은 없다 — 떨어지면 색인이 틀린 것이다.
  if (!s) throw new Error(`unknown settings section: ${id}`);
  return s.labelKey;
}

/**
 * 한 줄의 **경로 조각** — 섹션 · (소제목) · (이름). 팔레트가 `›` 로 이어 그리고, 같은 조각을
 * 검색 글자로도 쓴다. 번역 함수를 받는다(이 모듈은 화면 언어를 모른다 — 순수 층).
 */
export function settingPath(e: SettingsIndexEntry, tr: (key: Key) => string): string[] {
  const out = [tr(sectionLabelKey(e.section))];
  if (e.groupKey) out.push(tr(e.groupKey));
  if (e.labelKey) out.push(tr(e.labelKey));
  return out;
}

/** 검색 글자 — 경로 조각 + 영문 anchor(`term-webgl` → `term webgl`) + 섹션 id */
export function settingSearchText(e: SettingsIndexEntry, tr: (key: Key) => string): string {
  const en = [e.section, e.anchor?.replace(/-/g, " ") ?? ""].join(" ");
  return `${settingPath(e, tr).join(" ")} ${en}`;
}
