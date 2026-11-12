// **내부 전용** — 저장할 때 백엔드로 보낼 모양(`toPayload`: 기본값·빈 값은 파일에 적지 않는다)과 보낸 사본(`sendSnapshot`).
// 부르는 곳은 `store.svelte.ts` 의 `saveSettings` 하나 — 배럴이 내보내지 않는다(테스트는 직접 부른다).
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

/** 파일로 갈 메신저 칸 — **기본값과 다른 칸만** 싣는다(다 기본이면 백엔드가 `[messenger]` 를 안 쓴다) */
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
  if (m.include_conversation === true) out.include_conversation = true;
  if (typeof m.away_after_min === "number" && m.away_after_min !== DEFAULT_MESSENGER_AWAY_AFTER_MIN) {
    out.away_after_min = m.away_after_min;
  }
  if (m.discord === false) out.discord = false;
  if (m.slack === false) out.slack = false;
  return out;
}

/** `undefined` 필드를 빼고 백엔드로 보낼 모양으로 만든다 (TOML 에 빈 값이 남지 않게) */
export function toPayload(s: AppSettings): AppSettings {
  const app: AppTheme = {};
  for (const key of APP_TOKEN_KEYS) {
    const v = s.app[key];
    if (v) app[key] = v;
  }
  // 고른 적이 있을 때만 적는다 — 안 정함은 "월페이퍼가 있으면 은은하게" 라는 추정으로 남고,
  // `off` 는 그 추정을 **이기는** 값이라 기본값처럼 보여도 적어야 한다.
  if (s.app.dynamic) app.dynamic = s.app.dynamic;
  // 기본값([`DEFAULT_OPACITY`])은 파일에 적지 않는다 — 바꿨을 때만 남긴다.
  if (typeof s.app.opacity === "number" && s.app.opacity !== DEFAULT_OPACITY) {
    app.opacity = s.app.opacity;
  }
  // 기본값(끔)은 파일에 적지 않는다 — 켰을 때만 남긴다 (webgl 과 같은 규칙).
  if (s.app.auto_reconnect === true) app.auto_reconnect = true;
  // 트레이에 남기는 기본이 켬이다 — 끌 때만 파일에 남긴다(③-4).
  if (s.app.tray_on_close === false) app.tray_on_close = false;
  // 머리줄 칩 — 순서는 기본과 다를 때만, 끈 칩은 하나라도 있을 때만 남긴다(정규화가 이미 그 모양으로 접어 둔다).
  // 옛 `resource_chip` 은 정규화가 끈 칩으로 옮겼으므로 적지 않는다.
  if (s.app.header_chip_order && s.app.header_chip_order.length > 0) app.header_chip_order = [...s.app.header_chip_order];
  if (s.app.header_chips_hidden && s.app.header_chips_hidden.length > 0) {
    app.header_chips_hidden = [...s.app.header_chips_hidden];
  }
  // 상태바 자원 고리도 기본이 켬 — 끌 때만 남긴다.
  if (s.app.resource_rings === false) app.resource_rings = false;
  // 사용량 고리도 같다.
  if (s.app.usage_rings === false) app.usage_rings = false;
  // 제목줄 창 단추는 기본이 끔 — 켤 때만 남긴다.
  if (s.app.window_controls === true) app.window_controls = true;
  // 기본 배치(spiral)는 파일에 적지 않는다 — 다른 값을 골랐을 때만 남긴다 (tab_style 과 같은 규칙).
  if (s.app.tiling) app.tiling = s.app.tiling;
  // 기본 모드(dark)는 파일에서 생략해도 같은 밝기로 열린다.
  if (s.app.mode && s.app.mode !== DEFAULT_APP_MODE) app.mode = s.app.mode;
  // 언어는 **기본값이 없다** — "안 정함" 은 OS 추종이라 어느 값과도 같지 않다. 고른 값이
  // 있으면 그대로 적고, 없으면 키 자체가 안 남는다 (`shell.default` 와 같은 모양).
  if (s.app.language) app.language = s.app.language;
  // 기본(always)도 파일에 적지 않는다 — `setTileHeader` 가 그때 값을 지우지만, 손으로
  // `tile_header = "always"` 를 적어 둔 파일도 저장 한 번에 "안 정함"으로 접힌다 (mode 와 같다).
  if (s.app.tile_header && s.app.tile_header !== DEFAULT_TILE_HEADER) {
    app.tile_header = s.app.tile_header;
  }
  // 기본 자리(left)는 파일에 적지 않는다 — `setStatusBar` 가 그때 값을 지우지만, 손으로
  // `status_bar = "left"` 를 적어 둔 파일도 저장 한 번에 "안 정함"으로 접힌다 (tile_header 와 같다).
  if (s.app.status_bar && s.app.status_bar !== DEFAULT_STATUS_BAR) {
    app.status_bar = s.app.status_bar;
  }
  // 기본 모양(flat)도 파일에 적지 않는다 — `setStatusBarStyle` 가 그때 값을 지우지만, 손으로
  // `status_bar_style = "flat"` 을 적어 둔 파일도 저장 한 번에 "안 정함"으로 접힌다 (status_bar 와 같다).
  if (s.app.status_bar_style && s.app.status_bar_style !== DEFAULT_STATUS_BAR_STYLE) {
    app.status_bar_style = s.app.status_bar_style;
  }
  // 기본 재질(glass)도 파일에 적지 않는다 (status_bar_style 과 같다).
  if (s.app.material && s.app.material !== DEFAULT_MATERIAL) {
    app.material = s.app.material;
  }
  // 기본 아이콘(aynx)도 파일에 적지 않는다 (status_bar_style 과 같다).
  if (s.app.app_icon && s.app.app_icon !== DEFAULT_APP_ICON) {
    app.app_icon = s.app.app_icon;
  }
  // 끔(0/안 정함)은 파일에 적지 않는다 — 켠 값(1~240분)만 남긴다. 정규화가 0 을 undefined 로
  // 접으므로 여기 오는 값은 이미 유효한 분이지만, 손편집 방어로 한 번 더 `> 0` 을 본다.
  if (typeof s.app.idle_lock_min === "number" && s.app.idle_lock_min > 0) {
    app.idle_lock_min = s.app.idle_lock_min;
  }
  // 기본 크기(100)는 파일에 적지 않는다 — 정규화가 이미 undefined 로 접지만 한 번 더 본다.
  if (typeof s.app.ui_scale === "number" && s.app.ui_scale !== DEFAULT_UI_SCALE) {
    app.ui_scale = s.app.ui_scale;
  }
  if (s.app.ui_font_family) app.ui_font_family = s.app.ui_font_family;

  const terminal: TermPrefs = {};
  if (s.terminal.theme) terminal.theme = s.terminal.theme;
  if (s.terminal.font_family) terminal.font_family = s.terminal.font_family;
  if (s.terminal.font_size) terminal.font_size = s.terminal.font_size;
  // 기본 모양(block)은 파일에 적지 않는다 — 다른 값을 골랐을 때만 남긴다 (tab_style 과 같은 규칙).
  if (s.terminal.cursor_style && s.terminal.cursor_style !== DEFAULT_CURSOR_STYLE) {
    terminal.cursor_style = s.terminal.cursor_style;
  }
  // 기본값(켬)은 파일에 적지 않는다 — 껐을 때만 남긴다 (다른 필드와 같은 규칙).
  if (s.terminal.webgl === false) terminal.webgl = false;
  // 기본 모양(pill)은 파일에 적지 않는다 — 다른 값을 골랐을 때만 남긴다 (theme 프리셋과 같은 규칙).
  if (s.terminal.tab_style) terminal.tab_style = s.terminal.tab_style;
  // 기본값(끔)은 파일에 적지 않는다 — 켰을 때만 남긴다 (webgl 과 대칭).
  if (s.terminal.ligatures === true) terminal.ligatures = true;
  // 기본 동작(menu)은 파일에 적지 않는다 — 다른 값을 골랐을 때만 남긴다 (tab_style 과 같은 규칙).
  if (s.terminal.right_click && s.terminal.right_click !== DEFAULT_RIGHT_CLICK) {
    terminal.right_click = s.terminal.right_click;
  }
  // 기본값(켬)은 파일에 적지 않는다 — 껐을 때만 남긴다 (webgl 과 같은 규칙).
  if (s.terminal.confirm_multiline_paste === false) terminal.confirm_multiline_paste = false;
  // 원격 클립보드 쓰기(OSC 52)도 같은 규칙 — 기본이 켬이라 **끈 사람의 파일에만** false 가 남는다.
  if (s.terminal.osc52_clipboard === false) terminal.osc52_clipboard = false;
  // 프로그램 알림(OSC 9·777)·인라인 이미지도 같은 규칙 — 기본이 켬이라 끈 사람의 파일에만 남는다.
  if (s.terminal.osc_notify === false) terminal.osc_notify = false;
  if (s.terminal.inline_images === false) terminal.inline_images = false;
  // 인라인 스니펫 제안도 같은 규칙 — 기본이 켬이라 **끈 사람의 파일에만** false 가 남는다.
  if (s.terminal.inline_snippets === false) terminal.inline_snippets = false;
  // 같은 규칙 — 로컬 셸 통합도 기본이 켬이라 **끈 사람의 파일에만** false 가 남는다.
  if (s.terminal.local_shell_integration === false) terminal.local_shell_integration = false;
  // 긴 명령 알림 — 기본(10초)만 안 적는다. **`0` 은 적는다**: 끈 것은 기본이 아니라 선택이라
  // 파일에 남지 않으면 다음 실행에서 되살아난다 (다른 숫자 필드와 다른 유일한 점이다).
  if (
    typeof s.terminal.notify_after_secs === "number" &&
    s.terminal.notify_after_secs !== DEFAULT_NOTIFY_AFTER_SECS
  ) {
    terminal.notify_after_secs = s.terminal.notify_after_secs;
  }
  // 실행 시간 표식의 임계 — 바로 위와 같은 규칙이다 (기본 3초만 안 적고, `0` 은 적는다).
  if (
    typeof s.terminal.mark_after_secs === "number" &&
    s.terminal.mark_after_secs !== DEFAULT_MARK_AFTER_SECS
  ) {
    terminal.mark_after_secs = s.terminal.mark_after_secs;
  }
  // 기본 벨(visual)은 파일에 적지 않는다 — 다른 값을 골랐을 때만 남긴다 (right_click 과 같다).
  if (s.terminal.bell && s.terminal.bell !== DEFAULT_BELL) terminal.bell = s.terminal.bell;
  // 기본값(100 = 불투명)은 파일에 적지 않는다 — 낮췄을 때만 남긴다 (app.opacity 와 같은 규칙).
  if (
    typeof s.terminal.opacity === "number" &&
    s.terminal.opacity !== DEFAULT_TERM_OPACITY
  ) {
    terminal.opacity = s.terminal.opacity;
  }
  // 뽑아낸 팔레트는 있을 때만 싣는다 — 없으면 `[terminal.dynamic]` 테이블 자체가 안 생긴다.
  if (s.terminal.dynamic && Object.keys(s.terminal.dynamic).length > 0) {
    terminal.dynamic = { ...s.terminal.dynamic };
  }

  // "아직 안 고름" 은 파일에 적지 않는다 — 고른 셸이 있을 때만 남긴다 (없으면 OS 초기값).
  const shell: ShellPrefs = {};
  if (s.shell.default) shell.default = s.shell.default;

  // "안 정함"(= 홈)은 파일에 적지 않는다 — 폴더를 골랐을 때만 남긴다 (셸과 같은 규칙).
  const ai: AiPrefs = {};
  if (s.ai.start_dir) ai.start_dir = s.ai.start_dir;
  // 턴 끝 알림은 켬이 기본이라 **끈 값만** 남긴다 (`local_shell_integration` 과 같은 규칙).
  if (s.ai.notify_turn_end === false) ai.notify_turn_end = false;
  if (s.ai.notify_permission === false) ai.notify_permission = false;
  if (s.ai.notify_side_chat === false) ai.notify_side_chat = false;
  // 보고 있는 타일의 턴 알림 — 기본(60초)만 안 적는다. **`0` 은 적는다**(`notify_after_secs` 와 같은 규칙).
  if (
    typeof s.ai.notify_focused_after_secs === "number" &&
    s.ai.notify_focused_after_secs !== DEFAULT_NOTIFY_FOCUSED_AFTER_SECS
  ) {
    ai.notify_focused_after_secs = s.ai.notify_focused_after_secs;
  }
  if (s.ai.codex_no_daemon === false) ai.codex_no_daemon = false;
  if (s.ai.claude_statusline === false) ai.claude_statusline = false;
  // AI 아이콘 모양 · CLI 별 아바타 — 기본(logo · claude · gpt)은 적지 않는다(`status_bar_style` 과 같은 규칙). 옛 `loading_art` 는 싣지 않는다.
  if (s.ai.icon_style && s.ai.icon_style !== DEFAULT_AI_ICON_STYLE) ai.icon_style = s.ai.icon_style;
  if (s.ai.avatar_claude && s.ai.avatar_claude !== DEFAULT_AI_AVATARS.claude) ai.avatar_claude = s.ai.avatar_claude;
  if (s.ai.avatar_codex && s.ai.avatar_codex !== DEFAULT_AI_AVATARS.codex) ai.avatar_codex = s.ai.avatar_codex;
  // 추가 인자 — 적은 것이 있을 때만 `[ai.args]` 표가 생긴다(빈 값 = 없음).
  const args = normalizeStringMap(s.ai.args);
  if (args) ai.args = args;
  // 환경변수·헤더는 참조만 싣는다 — 끈 항목도 남겨 다음에 다시 켤 수 있다.
  const mcpServers = normalizeMcpServers(s.ai.mcp_servers);
  if (mcpServers) ai.mcp_servers = mcpServers;
  if (s.ai.mcp_sessions_enabled === false) ai.mcp_sessions_enabled = false;
  const mcpSessionsAgents = normalizeMcpSessionsAgents(s.ai.mcp_sessions_agents);
  if (mcpSessionsAgents) ai.mcp_sessions_agents = mcpSessionsAgents;
  // 끈 에이전트 — 끈 것이 있을 때만 적는다(기본 = 모두 사용).
  const disabledAgents = cleanStringList(s.ai.disabled_agents);
  if (disabledAgents.length > 0) ai.disabled_agents = disabledAgents;

  // 월페이퍼 — `file` 은 **백엔드가 정한 값을 되돌려 보내는 것뿐**이다 (이미지를 고르는
  // 순간 `wallpaper_set` 이 이미 파일에 썼다). 그래도 실어 보내야 한다: 저장은 전체
  // 재작성이라 빼면 방금 건 배경이 다음 [저장] 한 번에 사라진다.
  // 나머지 셋은 기본값이면 안 적는다 (다른 설정과 같은 규칙).
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

  // 자동 승인 — **언제나** 전체 객체를 보낸다(패턴만 정리해서). 백엔드가 기본값이면
  // `[automation]` 을 안 쓰므로(skip_serializing_if), 켠 적 없는 사용자의 파일은 그대로 깨끗하다.
  const automation: AutomationPrefs = {
    auto_approve: s.automation.auto_approve,
    allow_patterns: cleanStringList(s.automation.allow_patterns),
    // 묶음도 **언제나** 보낸다 — 빼면 백엔드가 "파일에 없음" 으로 읽어 켜 둔 묶음이 저장 한
    // 번에 꺼진다(트리거 목록과 같은 이유).
    bundles: cleanStringList(s.automation.bundles),
    // 끈 명령도 **언제나** 보낸다(비면 백엔드가 파일에 안 쓴다) — 빼면 저장 한 번에 끈 명령이 다시 켜진다.
    bundle_off: cleanBundleOff(s.automation.bundle_off),
    max_targets: s.automation.max_targets,
    max_concurrency: s.automation.max_concurrency,
    auto_max_per_window: s.automation.auto_max_per_window,
    auto_window_secs: s.automation.auto_window_secs,
    approval_ttl_minutes: s.automation.approval_ttl_minutes,
    // 검토 요청 OS 알림도 **언제나** 보낸다 — 기본이 켬이라 빼면 백엔드가 "파일에 없음" 으로
    // 읽어 **꺼 둔 것이 저장 한 번에 다시 켜진다**(묶음 목록과 같은 이유, 방향만 반대다).
    notify_review_requests: s.automation.notify_review_requests,
    // 실행 결과 OS 알림도 같은 이유로 언제나 보낸다.
    notify_operation_results: s.automation.notify_operation_results,
    // 감사 보관 일수·출력 발췌도 언제나 보낸다(빼면 백엔드가 기본값으로 되돌린다).
    audit_retention_days: s.automation.audit_retention_days,
    audit_output_excerpt: s.automation.audit_output_excerpt,
    allow_pipes: s.automation.allow_pipes,
    // 구조적 규칙도 **언제나** 함께 보낸다(정리해서) — 빼면 백엔드가 저장 시 손편집
    // `[[automation.allow]]` 를 지운다(round-trip 보존).
    allow: cleanAllowRules(s.automation.allow),
  };

  // 금고 정책 — 기본값(30분)과 같거나 "안 정함" 이면 **적지 않는다**. 백엔드도 같은 값을
  // `skip_serializing_if` 로 생략하므로, 이 기능을 만진 적 없는 사용자의 파일에는 `[vault]`
  // 가 아예 없다 (`[automation]` 과 같은 규칙). `0`("잠그지 않는다")은 기본값과 다른 답이라
  // 그대로 적힌다.
  const vaultPrefs: VaultPrefs = {};
  if (
    typeof s.vault.auto_lock_minutes === "number" &&
    s.vault.auto_lock_minutes !== VAULT_AUTO_LOCK_DEFAULT
  ) {
    vaultPrefs.auto_lock_minutes = s.vault.auto_lock_minutes;
  }

  // 트리거는 **언제나** 보낸다 (빈 배열 포함). 빼면 백엔드가 "파일에 없음" 으로 읽고
  // 내장 두 개를 되살려, 사용자가 다 지운 목록이 저장 한 번에 부활한다.
  // 단축키도 마찬가지로 언제나 보낸다 (빈 객체 = "전부 기본값"). 모양 다듬기는 코덱이 한다.
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
    // 기본(이름)이면 적지 않는다 — 백엔드도 비면 `[hosts]` 를 아예 안 쓴다.
    hosts: s.hosts.sort && s.hosts.sort !== DEFAULT_HOST_SORT ? { sort: s.hosts.sort } : {},
    // 기본(트리)이면 적지 않는다 — 백엔드도 비면 `[files]` 를 아예 안 쓴다.
    // 자동 새로고침은 끌 때만 적는다(기본 켬).
    files: {
      ...(s.files.default_view && s.files.default_view !== DEFAULT_FILE_VIEW
        ? { default_view: s.files.default_view }
        : {}),
      ...(s.files.auto_refresh === false ? { auto_refresh: false } : {}),
    },
    // 기본(auto)이면 적지 않는다 — 백엔드도 비면 `[projects]` 를 아예 안 쓴다.
    projects:
      s.projects.start_screen && s.projects.start_screen !== DEFAULT_PROJECT_START_SCREEN
        ? { start_screen: s.projects.start_screen }
        : {},
    // 기본(launcher-left)이면 적지 않는다 — 백엔드도 비면 `[dock]` 을 아예 안 쓴다.
    dock: s.dock.layout && s.dock.layout !== DEFAULT_DOCK_LAYOUT ? { layout: s.dock.layout } : {},
    // 기본(newest)이면 적지 않는다 — 백엔드도 비면 `[plans]` 를 아예 안 쓴다.
    plans: s.plans.exec_sort && s.plans.exec_sort !== DEFAULT_EXEC_SORT ? { exec_sort: s.plans.exec_sort } : {},
    // 업데이트 자동 확인은 끌 때만 적는다(기본 켬).
    updates: s.updates.auto_check === false ? { auto_check: false } : {},
    messenger: messengerToPayload(s.messenger),
    // 정한 칸만 — 다 비면 백엔드가 `[remote]` 를 아예 안 쓴다.
    remote: {
      ...(s.remote.enabled ? { enabled: true } : {}),
      ...(s.remote.port !== undefined ? { port: s.remote.port } : {}),
      ...(s.remote.host ? { host: s.remote.host } : {}),
    },
  };
}

/**
 * 지금 값을 **떠 낸 그 사본**을 보내고, 성공하면 그 사본을 돌려준다 — 부르는 쪽은 이것을 `saved` 로 삼는다.
 * 보내고 기다리는 사이에 생긴 편집은 사본에 섞이지 않으므로 `dirty` 로 남는다(끝난 뒤의 `current` 를
 * 저장됨으로 적으면 디스크에 없는 값이 "저장됨" 으로 보인다).
 */
export async function sendSnapshot(
  current: AppSettings,
  send: (payload: AppSettings) => Promise<unknown>,
): Promise<AppSettings> {
  const sent = cloneSettings(current);
  await send(toPayload(sent));
  return sent;
}
