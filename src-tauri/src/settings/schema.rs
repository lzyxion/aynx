//! `settings.toml` 의 모양 — [`AppSettings`] 와 작은 섹션 타입들 · serde 기본값/생략 조건.
//! 필드 이름은 사용자 파일에 키로 적힌다 — 바꾸지 않는다. 섹션은 기본값과 같으면 파일에 아예 안 쓴다.

use std::collections::BTreeMap;

use super::appearance::{default_triggers, AppTheme, TermPrefs, Trigger, WallpaperPrefs};
use super::automation::AutomationPrefs;

/// 섹션이 없으면 각 섹션의 기본값. `triggers` 만 키가 없을 때 내장 두 개가 들어온다 — 다 지우면 `triggers = []` 가 남아 되살아나지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
    /// TOML 배열은 테이블보다 먼저 나와야 다시 읽힌다(`[terminal]` 뒤에 찍히면 그 섹션 소속이 된다) — 그래서 맨 위 필드다.
    #[serde(default = "default_triggers")]
    pub triggers: Vec<Trigger>,
    #[serde(default)]
    pub app: AppTheme,
    #[serde(default)]
    pub terminal: TermPrefs,
    #[serde(default)]
    pub shell: ShellPrefs,
    #[serde(default)]
    pub ai: AiPrefs,
    #[serde(default)]
    pub wallpaper: WallpaperPrefs,
    /// 단축키 오버라이드만 — 액션 id → 조합 문자열. 없는 액션 = 프런트 기본값. 백엔드는 문법도 id 도 모른다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub keybindings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "AutomationPrefs::is_default")]
    pub automation: AutomationPrefs,
    /// 비밀도 "금고가 있는가" 도 여기 적히지 않는다.
    #[serde(default, skip_serializing_if = "VaultPrefs::is_default")]
    pub vault: VaultPrefs,
    #[serde(default, skip_serializing_if = "HostsPrefs::is_default")]
    pub hosts: HostsPrefs,
    #[serde(default, skip_serializing_if = "FilesPrefs::is_default")]
    pub files: FilesPrefs,
    #[serde(default, skip_serializing_if = "ProjectsPrefs::is_default")]
    pub projects: ProjectsPrefs,
    #[serde(default, skip_serializing_if = "DockPrefs::is_default")]
    pub dock: DockPrefs,
    #[serde(default, skip_serializing_if = "PlansPrefs::is_default")]
    pub plans: PlansPrefs,
    /// 건너뛴 판 · 알린 판은 설정이 아니라 `updater.json` 이다.
    #[serde(default, skip_serializing_if = "UpdatesPrefs::is_default")]
    pub updates: UpdatesPrefs,
    #[serde(default, skip_serializing_if = "MessengerPrefs::is_default")]
    pub messenger: MessengerPrefs,
    #[serde(default, skip_serializing_if = "RemotePrefs::is_default")]
    pub remote: RemotePrefs,
}

impl Default for AppSettings {
    /// 내장 트리거도 들어간다 — "파일에 triggers 키가 없다" 와 같은 상태다.
    fn default() -> Self {
        AppSettings {
            triggers: default_triggers(),
            app: AppTheme::default(),
            terminal: TermPrefs::default(),
            shell: ShellPrefs::default(),
            ai: AiPrefs::default(),
            wallpaper: WallpaperPrefs::default(),
            keybindings: BTreeMap::new(),
            automation: AutomationPrefs::default(),
            vault: VaultPrefs::default(),
            hosts: HostsPrefs::default(),
            files: FilesPrefs::default(),
            projects: ProjectsPrefs::default(),
            dock: DockPrefs::default(),
            plans: PlansPrefs::default(),
            updates: UpdatesPrefs::default(),
            messenger: MessengerPrefs::default(),
            remote: RemotePrefs::default(),
        }
    }
}

/// 원격 웹 클라이언트 관문. 비밀은 없다. 원격 창은 이 칸을 바꾸지 못한다(`remote/deny.rs`) — 켜는 일은 메인 PC 에서만.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct RemotePrefs {
    /// 안 정하면 끔.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// 127.0.0.1 에서 들을 포트(안 정하면 [`crate::instance::remote_port`] — 릴리스 · 개발이 다르다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// 받을 `Host` — 사용자의 MagicDNS 이름. 비면 미설정.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

impl RemotePrefs {
    pub fn is_default(&self) -> bool {
        *self == RemotePrefs::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct HostsPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}

impl HostsPrefs {
    pub fn is_default(&self) -> bool {
        *self == HostsPrefs::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct FilesPrefs {
    /// 옛 값(`tree` · `navigate`)은 프런트가 읽을 때 `details` 로 옮긴다 — 여기는 손대지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_view: Option<String>,
    /// 로컬 파일 타일 자동 새로고침(없으면 켬). 읽는 쪽은 프런트뿐이고 여기는 왕복만 한다(없으면 저장 때 칸이 사라진다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_refresh: Option<bool>,
}

impl FilesPrefs {
    pub fn is_default(&self) -> bool {
        *self == FilesPrefs::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct ProjectsPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_screen: Option<String>,
}

impl ProjectsPrefs {
    pub fn is_default(&self) -> bool {
        *self == ProjectsPrefs::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct DockPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
}

impl DockPrefs {
    pub fn is_default(&self) -> bool {
        *self == DockPrefs::default()
    }
}

/// 없으면 켬 — 찾고 알리기만 한다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct UpdatesPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_check: Option<bool>,
}

impl UpdatesPrefs {
    pub fn is_default(&self) -> bool {
        *self == UpdatesPrefs::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct PlansPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exec_sort: Option<String>,
}

impl PlansPrefs {
    pub fn is_default(&self) -> bool {
        *self == PlansPrefs::default()
    }
}

/// 메신저 알림의 취향만 — 칸마다 `None` = 프런트 기본값. 웹훅 URL · 봇 토큰은 여기 없다 — 채널마다 자기 파일이다(→ docs/invariants.md 전문 6).
/// `*_chat` 칸(메신저 다리)은 세션 서버의 다리가 글마다 다시 읽는다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct MessengerPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    /// 안 정하면 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_stop: Option<bool>,
    /// 안 정하면 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_permission: Option<bool>,
    /// 초(안 정하면 300). `0` = 끔이라 접지 않는다 — 위만 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_min_secs: Option<u32>,
    /// 안 정하면 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc: Option<bool>,
    /// 끝난 명령의 명령 줄을 싣는가 — 안 정하면 끔(비밀이 섞일 수 있고 메신저 서버로 간다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_command: Option<bool>,
    /// 에이전트 알림에 대화에서 나온 글자를 싣는가 — 안 정하면 켬(그 글자가 메신저 서버로 간다).
    /// 글자는 Rust 가 대화 파일에서 읽어 곧장 몸통에 붙인다 — 프런트로 돌아가지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_conversation: Option<bool>,
    /// 분(안 정하면 5). `0` = 입력 시계는 안 보고 가림막만 본다 — 접지 않고 위만 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub away_after_min: Option<u32>,
    /// 안 정하면 켬 — 웹훅이 등록돼야 실제로 간다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discord: Option<bool>,
    /// 안 정하면 켬 — 웹훅이 등록돼야 실제로 간다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slack: Option<bool>,
    /// 작업안 실행 결과(안 정하면 켬). 창이 없으면 GUI · 세션 서버가 자리 비움으로 보고 보낸다(`operations::notify`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_results: Option<bool>,
    /// 작업안 승인 대기(안 정하면 켬). 승인 단추 · 링크는 어느 채널에도 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_pending: Option<bool>,
    /// 승인 대기 알림에 AI 가 쓴 `summary` 를 싣는가(안 정하면 켬).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_summary: Option<bool>,
    /// 안 정하면 켬 — 봇이 등록되고 짝지은 대화방이 있어야 실제로 간다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram: Option<bool>,
    /// 메신저에서 타일에 말하기 — 안 정하면 끔. 끄면 곧바로 넣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_chat: Option<bool>,
    /// `telegram_chat` 과 같은 뜻(Discord DM) — 안 정하면 끔.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discord_chat: Option<bool>,
    /// `telegram_chat` 과 같은 뜻(Slack DM) — 안 정하면 끔.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slack_chat: Option<bool>,
}

impl MessengerPrefs {
    pub fn is_default(&self) -> bool {
        *self == MessengerPrefs::default()
    }
}

/// 아무도 읽지 않는 칸 하나를 왕복만 시킨다 — 지우면 옛 앱이 적은 `auto_lock_minutes` 가 [저장] 한 번에 조용히 사라진다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct VaultPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_lock_minutes: Option<u32>,
}

impl VaultPrefs {
    pub fn is_default(&self) -> bool {
        *self == VaultPrefs::default()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ShellPrefs {
    /// 프런트 `ShellInfo.id`. `None` = 아직 안 골랐다 — OS 초기값 폴백이 이 값을 채우지는 않는다.
    /// 이 PC 에 없는 id 도 지우지 않는다 — 배포판을 다시 설치하면 고른 셸이 돌아온다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

/// AI 타일(Claude Code · Codex) 취향. 기본이 켬인 `Option<bool>` 칸은 끈 사람의 파일에만 `false` 가 적힌다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AiPrefs {
    /// 포커스된 로컬 터미널의 폴더가 없을 때 쓰는 시작 폴더(`None` = 홈). 존재 여부는 검사하지 않는다 — 없는 폴더는 띄울 때 홈으로 떨어진다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_turn_end: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_permission: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_side_chat: Option<bool>,
    /// 보고 있는 타일도 알릴 턴 길이(초). `None` = 60 · `Some(0)` = 끔 — 0 을 접지 않고 위만 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_focused_after_secs: Option<u32>,
    /// 켜면 aynx 이 띄우는 codex 와 로컬 타일에서 친 codex 에 `--no-daemon` — 공용 데몬에 붙으면 훅 신호가 데몬을 처음 띄운 타일로 간다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_no_daemon: Option<bool>,
    /// 요금제 한도 mod 를 싣는가(안 정하면 켬). 키 이름은 옛 상태줄 방식의 것 그대로다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_statusline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_style: Option<String>,
    /// 앱 아이콘과 같은 id. 모르는 id · 지운 그림은 프런트가 기본으로 접는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_claude: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_codex: Option<String>,
    /// 옛 칸 — 읽기만 한다. `sanitize` 가 `icon_style` 로 옮기고 비운다(다시 쓰지 않는다).
    #[serde(default, skip_serializing)]
    pub loading_art: Option<String>,
    /// 끈 에이전트는 새로 띄우거나 고르는 자리에서만 빠진다. 모르는 id 는 버리지 않는다 — 새 판의 에이전트를 끈 파일을 옛 판이 저장해도 살아 있게.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_agents: Vec<String>,
    /// aynx 이 띄우는 에이전트에 붙일 추가 인자(에이전트 id → 한 줄). 손으로 친 명령에는 붙지 않는다 · 틀린 값은 띄울 때 통째로 버린다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, String>,
    /// 비밀 없는 외부 MCP 목록 — 로컬에서 aynx 이 띄우는 에이전트에만, 다음 실행부터 실린다.
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "crate::agent_mcp::deserialize_servers"
    )]
    pub mcp_servers: Vec<crate::agent_mcp::McpServer>,
    /// 세션 서버도 다음 로컬 AI 타일 실행에만 싣는다. 생략은 켬·두 에이전트 모두다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_sessions_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_sessions_agents: Option<Vec<String>>,
    /// 채팅 모양 AI 타일(실험) — `Some(true)` 만 켬. 세션 서버가 새 채팅 타일을 열 때마다 다시 읽는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_tile: Option<bool>,
    /// 런처의 AI 줄을 누르면 여는 모양 — 프런트만 읽는다. `"chat"` 말고는 `sanitize` 가 접는다(생략 = 터미널).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_form: Option<String>,
}
