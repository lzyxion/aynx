// 설정의 모양 — Rust `settings.rs` 와 1:1. 칸 이름은 `settings.toml` 의 키 그대로(snake_case)라 바꾸지 않는다.
import type { DynamicMode } from "$lib/dynamic-color";
import type { MessengerPrefsRaw } from "$lib/messenger-notify";
import type { Trigger } from "$lib/triggers";

/** `[app]` */
export interface AppTheme {
  accent?: string | null;
  bg?: string | null;
  bg_panel?: string | null;
  fg?: string | null;
  border?: string | null;
  err?: string | null;
  ok?: string | null;
  warn?: string | null;
  /**
   * 안 정함 = 월페이퍼가 있으면 `subtle`, 없으면 `off`. 옛 파일의 `dynamic = true` 는 `full` 로 읽힌다.
   * `subtle` 은 파일에 색을 남기지 않는다 — 소스색은 이번 실행에서만 든다.
   */
  dynamic?: DynamicMode | null;
  /** 앱 크롬 · 타일 면의 불투명도 %(10~100) — 터미널 칸은 영향 없음 */
  opacity?: number | null;
  auto_reconnect?: boolean | null;
  /** 안 정함 = 켬 */
  tray_on_close?: boolean | null;
  /** 옛 키 — 정규화가 `false` 를 `header_chips_hidden` 의 `"resource"` 로 옮기고 이 칸은 비운다 */
  resource_chip?: boolean | null;
  /** `$lib/header-chips` 의 id — 옛 id `ai_read` 는 `header_chips_hidden` 과 함께 `ai` 로 옮긴다(`migrateLegacyChips`) */
  header_chip_order?: string[] | null;
  /** 켠 것이 아니라 끈 것을 적는다 — 새 칩이 생기면 저절로 켬이다 */
  header_chips_hidden?: string[] | null;
  /** 안 정함 = 켬 */
  resource_rings?: boolean | null;
  /** 안 정함 = 켬 */
  usage_rings?: boolean | null;
  window_controls?: boolean | null;
  tiling?: string | null;
  mode?: string | null;
  /** 안 정함 = OS 를 따른다(`navigator.language`) */
  language?: string | null;
  tile_header?: string | null;
  status_bar?: string | null;
  status_bar_style?: string | null;
  material?: string | null;
  /** 내장 키 또는 사용자 아이콘 `user-<12hex>` — exe · 설치 관리자 아이콘은 바뀌지 않는다 */
  app_icon?: string | null;
  /** 분 — `0` · 안 정함 = 끔, 켠 값은 정규화 · 백엔드 sanitize 가 `1..=240` 으로 자른다 */
  idle_lock_min?: number | null;
  /** UI 크기 % — 안 정함 = 100, 정규화가 `UI_SCALES` 중 하나로 붙인다 */
  ui_scale?: number | null;
  /** CSS `font-family` 문자열 그대로 */
  ui_font_family?: string | null;
}

/** `[terminal]` */
export interface TermPrefs {
  theme?: string | null;
  font_family?: string | null;
  font_size?: number | null;
  cursor_style?: string | null;
  /** 안 정함 = 켬 */
  webgl?: boolean | null;
  tab_style?: string | null;
  ligatures?: boolean | null;
  right_click?: string | null;
  /** 안 정함 = 켬 */
  confirm_multiline_paste?: boolean | null;
  /** 안 정함 = 켬 · 쓰기 한 방향만 켜고 끈다 — 읽기 요청(`OSC 52 ; c ; ?`)은 이 값과 무관하게 언제나 거부한다 */
  osc52_clipboard?: boolean | null;
  /** 안 정함 = 켬 · 꺼도 알아본 시퀀스는 삼킨다 — 제목 위조 방지 · 속도 제한은 이 값과 무관한 불변이다 */
  osc_notify?: boolean | null;
  /** 안 정함 = 켬 */
  inline_images?: boolean | null;
  /** 안 정함 = 켬 · 셸 통합(OSC 133 `B` 마커)이 있는 타일에만 뜻이 있다 */
  inline_snippets?: boolean | null;
  /** 안 정함 = 켬 · 읽는 쪽은 백엔드다(`pty.rs` 가 셸을 띄우기 직전에 파일에서 직접 읽는다) */
  local_shell_integration?: boolean | null;
  /** 초 — 안 정함 = `DEFAULT_NOTIFY_AFTER_SECS`, `0` = 끔. `0` 은 "안 정함" 이 아니라 정규화 · 저장이 살려 둔다 */
  notify_after_secs?: number | null;
  /** 초 — `notify_after_secs` 와 같은 규칙(`0` = 끔, 살려 둔다) */
  mark_after_secs?: number | null;
  bell?: string | null;
  /**
   * 터미널 칸 불투명도 %(10~100), 안 정함 = 100. 100 일 때 xterm 렌더 경로가 예전과 같아야 하므로
   * (`allowTransparency` 도 끈 채) 기본값은 파일에도 안 적고 CSS 도 건드리지 않는다.
   */
  opacity?: number | null;
  /**
   * `[terminal.dynamic]` — xterm `ITheme` 이름 21칸 + 색이 아닌 `BEFORE_KEY` 한 칸.
   * 첫 프레임 때문에 파일에 적는다 — 안 적으면 켤 때마다 기본 팔레트로 한 번 칠해졌다가 바뀐다.
   */
  dynamic?: Record<string, string> | null;
}

/** `[shell]` */
export interface ShellPrefs {
  /**
   * 안 정함 = OS 초기값을 쓰되 그 폴백이 파일을 고쳐 쓰지는 않는다. 모르는 id 를 버리지 않는다 —
   * 셸 목록은 기기 상태라 오늘 없는 id 가 내일 돌아온다(WSL 배포판을 다시 깔면).
   */
  default?: string | null;
}

/** 비밀값 없는 외부 MCP 서버 — 켠 항목은 aynx 이 띄우는 로컬 에이전트에만 실린다. */
export interface AiMcpServer {
  name: string;
  enabled: boolean;
  /** 없으면 Claude·Codex 모두, 빈 배열이면 주입하지 않는다. */
  agents?: string[];
  project_id?: string;
  /** 값은 볼트에만 저장하고 이 목록에는 이름과 참조만 둔다(HTTP 헤더도 같다). */
  env?: { name: string; secret_ref: string }[];
  headers?: { name: string; secret_ref: string }[];
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** 생략 = 끔. 실은 서버의 도구는 늘 승인 요청이 오고, 묻지 않기는 사이드 채팅의 권한 모드 · 허용 목록이 정한다 */
  side_chat?: boolean;
}

/** `[ai]` */
export interface AiPrefs {
  /**
   * 모양을 검사하지 않고 지금 없는 폴더도 지우지 않는다 — 외장 · 네트워크 드라이브가 다시 붙으면 돌아온다.
   * 실제 판정은 `pty.rs` 의 `spawn_cwd` 하나다.
   */
  start_dir?: string | null;
  /** 안 정함 = 켬 */
  notify_turn_end?: boolean | null;
  /** 안 정함 = 켬 */
  notify_permission?: boolean | null;
  /** 안 정함 = 켬 */
  notify_side_chat?: boolean | null;
  /** 초 — `notify_after_secs` 와 같은 규칙(`0` = 끔, 살려 둔다) */
  notify_focused_after_secs?: number | null;
  /** 안 정함 = 켬 */
  codex_no_daemon?: boolean | null;
  /** 이름은 옛 상태줄 방식의 것 — 뜻은 로컬 claude 에 요금제 한도 mod 를 싣는가 · 안 정함 = 켬 */
  claude_statusline?: boolean | null;
  icon_style?: string | null;
  /** 앱 아이콘 id(내장 키 · `user-<12hex>`) */
  avatar_claude?: string | null;
  avatar_codex?: string | null;
  /** 옛 칸 — 정규화가 `character` 를 `icon_style = "avatar"` 로 옮기고(새 칸이 비었을 때만) 버린다(Rust 도 같다) */
  loading_art?: string | null;
  /**
   * 에이전트 id(Rust `agent_args::TARGETS`) → 한 줄. 나누기 · 검사 · 인용은 Rust(`agent_args.rs`)이고
   * 설정 화면은 Rust 미리보기가 통과시킨 값만 적는다.
   */
  args?: Record<string, string> | null;
  mcp_servers?: AiMcpServer[] | null;
  /** 생략은 켬 · Claude/Codex 둘 다 */
  mcp_sessions_enabled?: boolean | null;
  mcp_sessions_agents?: string[] | null;
  /** 모르는 id 도 버리지 않는다(`automation.bundles` 와 같은 보존 규칙) */
  disabled_agents?: string[] | null;
}

/** `[wallpaper]` */
export interface WallpaperPrefs {
  /** 경로가 아니라 백엔드가 앱 폴더로 복사한 사본의 파일 이름 한 조각 — 값은 `wallpaper_set`/`wallpaper_clear` 명령이 정한다 */
  file?: string | null;
  /** 검정 덮개 %(0~100) */
  dim?: number | null;
  /** px(0~20) */
  blur?: number | null;
  fit?: string | null;
}

/** `[automation]` — 두 상한(`max_targets` · `max_concurrency`)은 백엔드가 승인 진입에서 무조건 강제한다(수동 · 자동 공통) */
export interface AutomationPrefs {
  auto_approve: boolean;
  allow_patterns: string[];
  /** 모르는 id 는 지우지 않고 무시한다(새 버전의 묶음을 켜 둔 파일을 잃지 않게) — Rust 도 디스크의 이 값을 스스로 펼친다 */
  bundles: string[];
  /** 좁히기만 한다(묶음보다 넓어지지 않는다) · 모르는 묶음 · 키도 보존한다 */
  bundle_off: Record<string, string[]>;
  max_targets: number;
  max_concurrency: number;
  /** 진짜 방어선은 Rust(`approve_operation`)이고 프런트는 값만 편집한다 */
  auto_max_per_window: number;
  /** 초 */
  auto_window_secs: number;
  /** 분 — `0` 은 "만료 없음" 이라 그대로 산다(하한으로 접지 않는다) */
  approval_ttl_minutes: number;
  /** 기본 켬 */
  notify_review_requests: boolean;
  /** 기본 켬 · 끄는 것은 OS 알림뿐 — 토스트 · 알림 센터 기록에는 끄는 칸을 두지 않는다(실행 결과를 조용히 삼키는 길을 만들지 않는다) */
  notify_operation_results: boolean;
  /** 일 — `0` = 지우지 않음(하한으로 접지 않는다) */
  audit_retention_days: number;
  /** 기본 끔 — 원격 출력에 비밀이 섞일 수 있고 감사 파일은 볼트 밖이라 옵트인. 켜도 AI 읽기 공유가 꺼진 대상의 출력은 적지 않는다 */
  audit_output_excerpt: boolean;
  /** 기본 끔 — 다른 명령을 실행하는 단계는 늘 거절, 리다이렉트 · 치환 · 서브셸 · `;` · `||` 섞임은 여전히 사람 승인 */
  allow_pipes: boolean;
  /** 평탄한 `allow_patterns` 와 OR 로 합쳐진다 */
  allow: AllowRule[];
}

/**
 * `subcommands` 가 비면 서브커맨드 개념이 없다는 뜻(플래그만 붙는 `df -h` 류는 통과).
 * 인자 제약 칸은 전부 선택 — 없거나 비면 제약이 없다(옛 규칙은 예전 의미 그대로).
 */
export interface AllowRule {
  exec: string;
  subcommands: string[];
  /** 명령 어디에든 있으면 불허(`-f` 는 `-fn` 도, `--follow` 는 `--fol` 도, 끝 `*` 는 접두). */
  deny_flags?: string[];
  /** 비어 있지 않으면 모든 플래그가 여기 있어야 한다. */
  allow_flags?: string[];
  require_flags?: string[];
  /** 서브커맨드(없으면 exec) 뒤 첫 비플래그 인자는 없거나 이 중 하나(끝 `*` 는 접두). */
  first_arg?: string[];
  /** `0` = 인자 없이. */
  max_args?: number;
  /** 서브커맨드가 exec 바로 다음 낱말이어야 한다(앞 플래그의 값이 서브커맨드로 위장하지 못하게). 묶음 규칙은 늘 켠다. */
  sub_first?: boolean;
}

/**
 * `[vault]` — 비밀도, "금고가 있는가" 도 여기 적히지 않는다. 아무도 읽지 않는 왕복 보존용 칸이다 —
 * 저장은 전체 재작성이라(`toPayload`) 싣지 않으면 손으로 적어 둔 `[vault]` 가 [저장] 한 번에 사라진다.
 */
export interface VaultPrefs {
  auto_lock_minutes?: number | null;
}

export interface HostsPrefs {
  sort?: string;
}

export interface FilesPrefs {
  default_view?: string;
  /** 안 정함 = 켬 */
  auto_refresh?: boolean | null;
}

export interface ProjectsPrefs {
  start_screen?: string;
}

export interface DockPrefs {
  layout?: string;
}

export interface PlansPrefs {
  exec_sort?: string;
}

/** 건너뛴 판 · 알린 판은 설정이 아니라 Rust `updater.json` 에 산다 */
export interface UpdatesPrefs {
  /** 안 정함 = 켬 */
  auto_check?: boolean | null;
}

/** 웹훅 URL 은 여기 없다 — 비밀이라 백엔드의 채널별 자기 파일에만 산다(→ docs/invariants.md 전문 6) */
export type MessengerPrefs = MessengerPrefsRaw;

/** 비밀은 없다 · 기본 포트는 Rust 가 정한다(릴리스 47821 · 개발 47822) */
export interface RemotePrefs {
  enabled?: boolean;
  /** 127.0.0.1 포트 */
  port?: number;
  /** 받을 `*.ts.net` 이름 */
  host?: string;
}

export interface AppSettings {
  app: AppTheme;
  terminal: TermPrefs;
  shell: ShellPrefs;
  ai: AiPrefs;
  wallpaper: WallpaperPrefs;
  /** 빈 배열 = 사용자가 다 지웠다(백엔드는 파일에 키가 없을 때만 내장 두 개를 채운다) */
  triggers: Trigger[];
  /** 오버라이드만 — 키가 없는 액션은 레지스트리 기본값을 쓴다 */
  keybindings: Record<string, string>;
  automation: AutomationPrefs;
  vault: VaultPrefs;
  hosts: HostsPrefs;
  files: FilesPrefs;
  projects: ProjectsPrefs;
  dock: DockPrefs;
  plans: PlansPrefs;
  updates: UpdatesPrefs;
  messenger: MessengerPrefs;
  remote: RemotePrefs;
}
