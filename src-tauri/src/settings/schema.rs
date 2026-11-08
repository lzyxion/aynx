//! `settings.toml` 의 모양 — [`AppSettings`] 와 작은 섹션 타입들(`[remote]` · `[hosts]` · `[files]` · `[projects]` · `[dock]` ·
//! `[messenger]` · `[vault]` · `[shell]` · `[ai]`) · serde 기본값/생략 조건. `settings.rs` 에서 그대로 옮겼다.
//! 표시 섹션 타입은 `appearance.rs`, `[automation]` 은 `automation.rs`, 값 정리는 `normalize.rs`.

use std::collections::BTreeMap;

use super::appearance::{default_triggers, AppTheme, TermPrefs, Trigger, WallpaperPrefs};
use super::automation::AutomationPrefs;

/// 설정 파일 전체. 세 섹션 모두 없어도 되고, 없으면 각 섹션의 기본값이 된다.
///
/// `triggers` 만 "없음"의 기본값이 빈 목록이 **아니다** — 파일에 키가 없으면
/// [`default_triggers`] 의 내장 두 개가 들어온다 (첫 실행에 바로 쓸모가 보이도록).
/// 저장은 언제나 전체 재작성이라 목록을 다 지우면 파일에 `triggers = []` 가 남고,
/// 그 뒤로는 내장 기본이 되살아나지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
    /// TOML 배열은 테이블보다 **먼저** 나와야 파일이 다시 읽힌다 (`triggers = []` 가
    /// `[terminal]` 뒤에 찍히면 그 배열이 terminal 섹션 소속이 되어 버린다).
    /// 직렬화 순서가 곧 파일 순서이므로 이 필드가 맨 위에 선언돼 있다.
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
    /// 키보드 단축키 **오버라이드**만 담는 맵 — 액션 id → 키 조합 문자열
    /// (`"new-tab" = "Ctrl+Shift+KeyT"`). 기본값은 프런트에 있으므로 **없는 액션 = 기본값 사용**이다.
    ///
    /// 조합 문법(`Ctrl`/`Alt`/`Shift` + KeyboardEvent `code`, `+` 로 연결)도 액션 id 목록도
    /// 백엔드는 모른다 — 문자열을 그대로 보관만 한다 (`theme` 프리셋 키와 같은 분담).
    /// [`BTreeMap`] 이라 파일 출력이 결정적이고, 비면 `[keybindings]` 테이블 자체가 안 적힌다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub keybindings: BTreeMap<String, String>,
    /// 자동 승인 정책 — 로드맵 **단계 10b** (`[automation]`).
    ///
    /// 기본값과 같으면 파일에 **적지 않는다**([`AutomationPrefs::is_default`]) — 다른 섹션이
    /// "안 정한 칸은 안 쓴다" 는 것과 같은 규칙이라, 이 기능을 켠 적 없는 사용자의 파일에는
    /// `[automation]` 이 아예 없다(= 기본 끔). 프런트 정책 평가기가 이 값을 읽어 자동 승인을
    /// 판단하고, **상한(max_targets·max_concurrency)은 백엔드가
    /// [`crate::operations::approval::approve_operation`] 진입에서 무조건 강제**한다(수동·자동 공통).
    #[serde(default, skip_serializing_if = "AutomationPrefs::is_default")]
    pub automation: AutomationPrefs,
    /// 자격증명 금고 (`[vault]`) — [`crate::vault`].
    ///
    /// 여기 있는 것은 **정책 한 칸**(놀고 있으면 몇 분 뒤 잠그는가)뿐이다. 비밀 자체도,
    /// "금고가 있는가" 도 이 파일에 적히지 않는다 — 그건 `vault.bin` 의 존재가 말한다.
    /// 기본값과 같으면 `[automation]` 과 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "VaultPrefs::is_default")]
    pub vault: VaultPrefs,
    /// 호스트 목록 (`[hosts]`) — 지금은 정렬 한 칸이다 (docs/log/2026-09-23-host-history.md).
    /// 기본값이면 `[vault]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "HostsPrefs::is_default")]
    pub hosts: HostsPrefs,
    /// 파일 타일 (`[files]`) — 지금은 기본 보기 한 칸이다 (docs/log/2026-09-25-file-tree-view.md).
    /// 기본값이면 `[hosts]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "FilesPrefs::is_default")]
    pub files: FilesPrefs,
    /// 프로젝트 (`[projects]`) — 지금은 시작 화면 한 칸이다 (docs/log/2026-09-26-project-start-screen.md).
    /// 기본값이면 `[files]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "ProjectsPrefs::is_default")]
    pub projects: ProjectsPrefs,
    /// 독 (`[dock]`) — 지금은 배치 한 칸이다(런처 독 · 채팅 독이 어느 쪽에 서나 — docs/log/2026-10-23-side-chat-dock.md).
    /// 기본값이면 `[projects]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "DockPrefs::is_default")]
    pub dock: DockPrefs,
    /// 작업안 (`[plans]`) — 지금은 실행 목록 정렬 한 칸이다(채팅 독의 작업안 갈래 — 2026-11-01).
    /// 기본값이면 `[dock]` 과 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "PlansPrefs::is_default")]
    pub plans: PlansPrefs,
    /// 메신저 알림 (`[messenger]`) — Discord 웹훅으로 무엇을 언제 보낼지의 **취향만**
    /// (docs/log/2026-09-27-discord-notify.md). 웹훅 URL 자체는 여기 없다 — 비밀이라 자기 파일에
    /// 산다([`crate::messenger`]). 기본값이면 `[projects]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "MessengerPrefs::is_default")]
    pub messenger: MessengerPrefs,
    /// 원격 웹 클라이언트 관문 (`[remote]`) — [`crate::remote`]. 켜기·포트·받을 이름 셋뿐이고 비밀은 없다.
    /// 기본값이면 `[messenger]` 와 같은 규칙으로 파일에 아예 안 쓴다.
    #[serde(default, skip_serializing_if = "RemotePrefs::is_default")]
    pub remote: RemotePrefs,
}

impl Default for AppSettings {
    /// 파일이 없거나 깨졌을 때의 시작점. **내장 트리거는 여기에도 들어간다** —
    /// "파일에 triggers 키가 없다" 와 같은 상태이기 때문이다.
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
            messenger: MessengerPrefs::default(),
            remote: RemotePrefs::default(),
        }
    }
}

/// 원격 웹 클라이언트 관문의 `[remote]` 섹션 ([`crate::remote`] — 설계 docs/log/2026-10-15-remote-web-client-design.md 14절).
///
/// 칸마다 `None` = 안 정함. 해석(기본 포트 · 이름 모양 검사)은 [`crate::remote`] 가 하고, 여기는 빈 값·`0` 만 접는다.
/// 켜는 일은 **집 PC 에서만**(원격 창의 거부 목록 — R1a 4번 커밋 `remote/deny.rs` 에서 `save_settings` 의 이 칸 변경을 막는다).
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct RemotePrefs {
    /// 관문을 여는가 (안 정하면 **끔**).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// 127.0.0.1 에서 들을 포트 (안 정하면 [`crate::instance::remote_port`] — 릴리스·개발이 다르다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// 받을 `Host` — 사용자의 MagicDNS 이름(`mypc.tailnet-xxxx.ts.net`). 비면 미설정(관문은 열지 않는다 — 개발 빌드는 루프백만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

impl RemotePrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[remote]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == RemotePrefs::default()
    }
}

/// 호스트 목록의 `[hosts]` 섹션 — **정렬 한 칸**.
///
/// `sort` 는 문자열을 **보관만** 한다(`tab_style`·`tiling` 과 같은 분담) — 후보 둘
/// (`name`·`recent`)을 아는 쪽은 프런트이고, 모르는 값이면 거기서 기본(`name`)으로 떨어진다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct HostsPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}

impl HostsPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[hosts]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == HostsPrefs::default()
    }
}

/// 파일 타일의 `[files]` 섹션 — **기본 보기 한 칸** (docs/log/2026-09-25-file-tree-view.md).
///
/// `default_view` 는 문자열을 **보관만** 한다(`[hosts] sort` 와 같은 분담) — 후보 셋
/// (`icons`·`compact`·`details`, docs/log/2026-10-07-file-tile-dolphin.md)을 아는 쪽은 프런트이고, 모르는 값이면 거기서
/// 기본(`details`)으로 떨어진다. 옛 두 값(`tree`·`navigate`)도 프런트가 읽을 때 `details` 로 옮긴다 — 여기는 손대지 않는다.
/// 타일마다 고른 보기는 여기가 아니라 배치 파일(`workspaces.json` 의 `fileView`)에 산다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct FilesPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_view: Option<String>,
    /// 로컬 파일 타일의 자동 새로고침(보이는 폴더의 OS 변경 알림 · 원격은 늘 ⟳ —
    /// docs/log/2026-10-21-file-tile-auto-refresh.md). 키 이름은 원격 갈래를 걷기 전 그대로다(이미 저장된 값이 산다). **끌 때만** 적는다(`[app] tray_on_close` 와 같은 규칙 — 없으면 켬).
    /// 읽는 쪽은 프런트뿐이고 여기는 왕복만 한다(없으면 저장 때 칸이 사라진다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_refresh: Option<bool>,
}

impl FilesPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[files]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == FilesPrefs::default()
    }
}

/// 프로젝트의 `[projects]` 섹션 — **시작 화면 한 칸** (docs/log/2026-09-26-project-start-screen.md).
///
/// `start_screen` 은 문자열을 **보관만** 한다(`[files] default_view` 와 같은 분담) — 후보 둘
/// (`auto`·`off`)을 아는 쪽은 프런트이고, 모르는 값이면 거기서 기본(`auto` — 로컬 프로젝트와 모든
/// 워크트리(새로 만든 것 포함)를 열 때 늘 셸 대신 시작 화면; `off` 는 곧장 셸)으로 떨어진다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct ProjectsPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_screen: Option<String>,
}

impl ProjectsPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[projects]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == ProjectsPrefs::default()
    }
}

/// 독의 `[dock]` 섹션 — **배치 한 칸** (docs/log/2026-10-23-side-chat-dock.md).
///
/// `layout` 은 문자열을 **보관만** 한다(`[projects] start_screen` 과 같은 분담) — 후보 둘
/// (`launcher-left` · `launcher-right` — 런처 독이 선 쪽, 채팅 독은 늘 반대쪽)을 아는 쪽은 프런트이고,
/// 모르는 값이면 거기서 기본(`launcher-left`)으로 떨어진다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct DockPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
}

impl DockPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[dock]` 을 생략한다.
    pub fn is_default(&self) -> bool {
        *self == DockPrefs::default()
    }
}

/// 작업안의 `[plans]` 섹션 — **실행 목록 정렬 한 칸**(2026-11-01).
///
/// `exec_sort` 는 문자열을 **보관만** 한다(`[hosts] sort` 와 같은 분담) — 후보 둘(`newest` · `oldest`)을 아는 쪽은
/// 프런트이고, 모르는 값이면 거기서 기본(`newest` — 최근 먼저)으로 떨어진다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct PlansPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exec_sort: Option<String>,
}

impl PlansPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[plans]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == PlansPrefs::default()
    }
}

/// 메신저 알림의 `[messenger]` 섹션 (docs/log/2026-09-27-discord-notify.md).
///
/// 판정도 발사도 **프런트**가 한다(`src/lib/messenger-notify.ts` · `src/lib/app/messenger.ts`) —
/// Rust 는 보관만 한다(`[ai] notify_turn_end` 와 같은 분담). 칸마다 `None` = 안 정함 = 프런트 기본값이고,
/// 기본과 다른 값만 파일에 적힌다. 사건 규칙은 채널이 **함께** 쓰고, 채널마다의 보내기 칸(`discord` · `slack`)이 따로
/// 있다(docs/log/2026-09-28-messenger-channels.md). **웹훅 URL 은 이 구조체에 없다** — [`crate::messenger`] 의
/// 채널별 자기 파일.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct MessengerPrefs {
    /// 언제 — `away`(기본: 가림막이 걸렸거나 입력이 한참 없을 때만) | `always`. 문자열을 **보관만** 한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    /// 에이전트 턴 끝 (안 정하면 켬).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_stop: Option<bool>,
    /// 에이전트 권한 물음 (안 정하면 켬).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_permission: Option<bool>,
    /// 이만큼(초) 넘게 걸린 명령이 끝나면 (안 정하면 300). **`0` = 끔을 접지 않는다** —
    /// [`TermPrefs::notify_after_secs`] 와 같은 배관(위만 [`MAX_AFTER_SECS`] 로 자른다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_min_secs: Option<u32>,
    /// 프로그램이 보낸 OSC 9·777 알림 (안 정하면 켬).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc: Option<bool>,
    /// 끝난 명령의 **명령 줄**을 싣는가 (안 정하면 끔 — 명령 줄에 비밀이 섞일 수 있고 그것이 메신저 서버로 간다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_command: Option<bool>,
    /// 에이전트 알림에 **대화에서 나온 글자**(대화 제목 · 에이전트 마지막 답 앞부분 · 권한을 묻는 도구 이름)를
    /// 싣는가 (안 정하면 끔 — 켜면 그 글자가 메신저 서버로 간다). 글자는 Rust 가 대화 파일에서 읽어 곧장
    /// 몸통에 붙인다 — 프런트로 돌아가지 않는다([`crate::messenger`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_conversation: Option<bool>,
    /// 입력이 이만큼(분) 없으면 자리 비움으로 친다 (안 정하면 5). `0` = 입력 시계는 안 보고 가림막만 본다 —
    /// 그래서 `0` 도 접지 않고, 위만 [`MAX_IDLE_LOCK_MIN`] 으로 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub away_after_min: Option<u32>,
    /// Discord 채널로 보내는가 (안 정하면 켬 — 웹훅이 등록돼 있으면 그리로 간다). 위의 사건 규칙은 채널이
    /// 함께 쓴다 (docs/log/2026-09-28-messenger-channels.md).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discord: Option<bool>,
    /// Slack 채널로 보내는가 (안 정하면 켬 — 웹훅이 등록돼야 실제로 간다). `discord` 와 같은 모양.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slack: Option<bool>,
    /// **작업안 실행 결과**를 보내는가 (안 정하면 켬 — ③-4). 창이 있으면 프런트가 `when` 규칙대로, GUI 가 트레이에만 있거나
    /// 아예 없으면(세션 서버 혼자) 자리 비움으로 보고 GUI·서버가 보낸다(`operations::notify`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_results: Option<bool>,
    /// **작업안 승인 대기**를 보내는가 (안 정하면 켬 — 승인 요약, docs/log/2026-10-21-approval-summary.md). AI 가 원격 명령 · DB 쓰기의
    /// 승인을 요청해 검토 대기에 들어가면 한 번(자동 승인된 것은 아니다). 창이 있으면 프런트가 `when` 규칙대로, 창이 없으면
    /// GUI(트레이) · 세션 서버가 자리 비움으로 보고 보낸다(`operations::notify`). 승인 단추 · 링크는 어느 채널에도 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_pending: Option<bool>,
    /// 승인 대기 알림에 **AI 가 쓴 설명**(`summary`)을 싣는가 (안 정하면 켬). 끄면 앱 분석 한 줄과 대상 · 만료만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_summary: Option<bool>,
}

impl MessengerPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[messenger]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == MessengerPrefs::default()
    }
}

/// 자격증명 금고의 `[vault]` 섹션 — **지금은 보존만 하는 칸 하나**다.
///
/// `auto_lock_minutes` 는 **2026-09-19 저녁에 읽기를 그만뒀다**: 금고를 잠그는 것은 이제
/// 프라이버시 가림막 하나이고([`crate::vault`] 머리말), 같은 사건을 두 번째 시계로 또 세면
/// 사용자가 칸 둘을 맞춰 놓아야 "자리를 비우면 둘 다" 를 얻는다.
///
/// **그래도 칸은 남겨 둔다.** 설정 저장은 파일 전체를 다시 쓰는 일이라([`save_at`]), 이
/// 칸을 구조체에서 지우면 예전 앱이 적어 둔 `[vault] auto_lock_minutes` 가 설정 화면의
/// [저장] 한 번에 조용히 사라진다(`[[automation.allow]]`·트리거 목록과 같은 이유). 아무도
/// 읽지 않는 값을 왕복시키는 것이 남의 파일을 지우는 것보다 싸다.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct VaultPrefs {
    /// 옛 판의 유휴 자동 잠금(분). **아무도 읽지 않는다** — 왕복 보존용이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_lock_minutes: Option<u32>,
}

impl VaultPrefs {
    /// 기본값과 같은가 — `skip_serializing_if` 가 이걸 보고 `[vault]` 를 생략한다.
    pub fn is_default(&self) -> bool {
        *self == VaultPrefs::default()
    }
}

/// 로컬 셸 취향 — 지금은 "기본 셸" 하나뿐이다.
///
/// `[terminal]` 에 얹지 않고 자기 테이블을 갖는 이유는 다루는 층이 다르기 때문이다.
/// `[terminal]` 은 **xterm 화면**(색·글꼴·가속)이고, 이 값은 **어떤 프로세스를 띄우는가**다.
/// 값 하나로 시작하지만 늘어나면(시작 폴더·기본 인자 등) 전부 이쪽에 붙는다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ShellPrefs {
    /// 프런트 `ShellInfo.id` (`"pwsh"`·`"cmd"`·`"wsl:<distro>"`…) — **언제나 구체적인 셸
    /// 하나**다. `None` = **아직 안 골랐다** 이고, 그때는 OS 초기값
    /// ([`crate::pty::os_default_shell_id`])이 쓰인다. **그 폴백이 이 값을 채우지는
    /// 않는다** — 값은 사용자가 설정 화면에서 고를 때만 생긴다.
    ///
    /// 백엔드는 이 문자열을 **보관만 한다** — 목록을 아는 쪽은 프런트다(`theme` 프리셋 키와
    /// 같은 분담). WSL 배포판을 지운 뒤처럼 지금 기기에 없는 id 가 남아 있을 수 있고,
    /// 그때 설정 화면은 "이 PC 에 없어 …를 씁니다" 로 알리기만 하고 값은 지우지 않는다:
    /// 그 배포판을 다시 설치하면 아무것도 안 해도 원래 고른 셸이 돌아온다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

/// AI 타일(Claude Code · Codex) 취향 — "시작 폴더" 와 "턴 끝 알림".
///
/// [`ShellPrefs`] 와 나란한 층이다(둘 다 **어떤 프로세스를 어디서 띄우는가**), 자기 테이블을
/// 갖는 이유는 대상이 다르기 때문이다 — 저기는 사람이 여는 셸, 여기는 AI CLI 타일이다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AiPrefs {
    /// AI 타일을 열 때 쓸 시작 폴더의 절대 경로. `None` = 안 정함 = 홈.
    ///
    /// **1순위가 아니다** — 포커스된 로컬 터미널의 지금 폴더가 있으면 그것이 먼저고
    /// (프런트 `panes.svelte.ts` 의 `resolveLocalCwd`), 이 값은 그게 없을 때(시작 화면 ·
    /// SSH 타일에서 열 때) 쓰인다. 셸 세션을 실제로 세우는 자리는
    /// [`crate::pty::spawn_cwd`] 이고, 거기서 없는 폴더는 조용히 홈으로 떨어진다.
    ///
    /// 백엔드는 이 문자열을 **보관만 한다** — 공백만 떼고 경로 모양·존재 여부를 검사하지
    /// 않는다 (`shell.default` 와 같은 분담). 폴더가 잠깐 없는 외장 드라이브·네트워크
    /// 경로여도 값을 지우지 않는 편이 낫다: 다시 붙으면 아무것도 안 해도 돌아온다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_dir: Option<String>,
    /// Claude Code **턴이 끝나면 알릴 것인가** (`[ai] notify_turn_end`, 안 정하면 **켬**).
    ///
    /// 판정도 발사도 **프런트**가 한다(`src/lib/agent-notify.ts` · `src/lib/app/agent-notify.ts`
    /// — docs/log/2026-09-25-agent-stop-notify.md). Rust 는 보관만 한다. `local_shell_integration`
    /// 과 같은 `Option<bool>` 배관이라 끈 사람의 파일에만 `false` 가 적힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_turn_end: Option<bool>,
    /// Claude Code 가 **권한을 물으면 알릴 것인가** (`[ai] notify_permission`, 안 정하면 **켬**).
    ///
    /// `notify_turn_end` 와 같은 배관·같은 분담(판정·발사는 프런트, docs/log/2026-09-25-shell-claude-
    /// signals.md). 둘을 한 칸으로 묶지 않은 까닭: "턴 끝은 조용히, 권한 물음만" 을 원하는 사람이
    /// 있다 — 권한 물음은 사람이 답하기 전까지 일이 **멈춰 있는** 순간이라 급함이 다르다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_permission: Option<bool>,
    /// **사이드 채팅의 끝남 · 권한 물음을 알릴 것인가** (`[ai] notify_side_chat`, 안 정하면 **켬**).
    ///
    /// 같은 배관·같은 분담(판정·발사는 프런트 `src/lib/side-chat-notify.ts`). 타일 알림과 묶지 않은 까닭:
    /// 채팅은 짧은 질문이 잦아 타일 알림만 원하는 사람에게 함께 울리면 안 된다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_side_chat: Option<bool>,
    /// **보고 있는 타일도** 알릴 턴 길이(초) (`[ai] notify_focused_after_secs`). `None` = 안 정함 =
    /// **60초**(프런트 기본). `Some(0)` = **끔**(보고 있는 타일은 알리지 않는다 — 옛 동작).
    ///
    /// 포커스를 둔 채 자리를 비운 사람을 위한 칸이다(docs/log/2026-09-27-agent-banners.md "보고 있는
    /// 타일도"). 판정·발사는 프런트(`src/lib/agent-notify.ts`)이고 Rust 는 보관만 한다.
    /// [`TermPrefs::notify_after_secs`] 와 **똑같은 배관**이다 — 기본이 켬이라 `0` 을 `None` 으로 접지
    /// 않고, 위만 [`MAX_AFTER_SECS`] 로 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_focused_after_secs: Option<u32>,
    /// Codex 를 **타일마다 따로** 돌릴 것인가 (`[ai] codex_no_daemon`, 안 정하면 **켬**).
    ///
    /// Codex 0.157 은 기본으로 PC 공용 app-server 데몬에 붙고 훅을 **그 데몬의 환경**으로 돌려, 신호가
    /// 데몬을 처음 띄운 타일로 간다. 켜 두면 aynx 이 띄우는 codex(AI 타일 · 재개 · 새 대화로 계속)에
    /// `--no-daemon` 을 붙이고([`crate::codex_launch`]), 로컬 타일 셸의 통합 스크립트가 손으로 친 `codex` 도
    /// 감싼다(`AYNX_CODEX_NO_DAEMON` — `crate::pty`). docs/log/2026-09-26-codex-hooks.md "다시 켬".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_no_daemon: Option<bool>,
    /// Claude Code 에 **요금제 한도 mod 를 실을 것인가** (`[ai] claude_statusline`, 안 정하면 **켬** — 이름은 옛 상태줄
    /// 방식의 것이다, 2026-10-10 mod 로 바뀜).
    ///
    /// 켜 두면 로컬 타일 셸의 환경에 `CLAUDE_CODE_PLUGIN_DIRS`(앱이 적은 mod 폴더)와 한도 도우미 경로를 심어, 그 타일에서
    /// 뜨는 모든 claude 가 mod 를 싣는다(`crate::pty`). 판정은 `crate::claude_usage` 한 곳이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_statusline: Option<bool>,
    /// **AI 아이콘 모양** (`[ai] icon_style`) — `"logo"`(기본, 그 CLI 의 브랜드 로고) · `"avatar"`(CLI 마다 고른 아바타 —
    /// [`Self::avatar_claude`] · [`Self::avatar_codex`]). 탭 · 타일 머리줄 · 독/런처 · 채팅 독 · 앱 안 알림 · AI 로딩 덮개가 모두
    /// 이 한 칸을 따른다(docs/log/2026-10-31-avatars.md). `None` = 안 정함 = 프런트 기본(`logo`). [`AppTheme::material`] 과 같은
    /// **"보관만"** 분담이다 — 후보를 아는 쪽은 프런트(`AI_ICON_STYLES`)이고, 백엔드는 공백만 떼어 문자열 그대로 든다.
    /// 옛 칸 [`Self::loading_art`] 의 `character` 는 sanitize 가 `avatar` 로 옮긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_style: Option<String>,
    /// claude 의 **아바타** (`[ai] avatar_claude`) — 앱 아이콘과 같은 id(내장 `claude` · `gemini` · `gpt` · `grok` 또는
    /// `user-<12hex>` — [`crate::app_icon`]). `None` = 안 정함 = 프런트 기본(`claude`). "보관만" — 모르는 id · 지운 그림은 프런트가
    /// 기본으로 접는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_claude: Option<String>,
    /// codex 의 **아바타** (`[ai] avatar_codex`) — [`Self::avatar_claude`] 와 같은 규칙, 기본 `gpt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_codex: Option<String>,
    /// **옛 칸** `[ai] loading_art`(`logo` | `character` — 10-24 의 AI 로딩 덮개 그림) — **읽기만 한다**. sanitize 가 `character` 를
    /// [`Self::icon_style`] `= "avatar"` 로 옮기고(새 칸이 비었을 때만) 이 칸을 비운다. 파일에 다시 쓰지 않는다.
    #[serde(default, skip_serializing)]
    pub loading_art: Option<String>,
    /// **끈 에이전트** id 목록 (`[ai] disabled_agents = ["codex"]`, 비었으면 안 적힘 = **모두 사용**).
    ///
    /// 판정·적용은 전부 **프런트**다(`src/lib/agent-enabled.ts`) — 끈 에이전트는 새로 띄우거나 고르는 자리(상태바
    /// `>_` 메뉴 · 프로젝트 시작 화면·폼 · 블록 넘기기 · 사용량 칩)에서만 빠진다. 훅 · `[ai.args]` · 대화 기록 ·
    /// 외부 MCP · 이미 열린 타일은 그대로라 다시 켜면 원래대로다. Rust 는 보관만 한다 — 공백 제거 · 빈 값 버림 ·
    /// 중복 제거(순서 보존)만 하고, **모르는 id 는 버리지 않는다**(`automation.bundles` 와 같은 규칙: 새 버전의
    /// 에이전트를 끈 파일을 옛 버전이 저장해도 값이 살아 있게).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_agents: Vec<String>,
    /// aynx 이 **띄우는** 에이전트(AI 타일 · 셸 메뉴 · 프로젝트 시작 화면 · 재개 · 새 대화로 계속)에 붙일 **추가 인자**
    /// — `[ai.args]` 표, 에이전트 id(`crate::agent_args::TARGETS`) → 사용자가 적은 한 줄. 셸에 손으로 친 명령에는
    /// 붙지 않는다. 백엔드는 공백만 떼고 보관한다 — 낱말로 나누고 검사하고 셸에 맞춰 다시 인용하는 것은
    /// `crate::agent_args` 한 곳이고, 틀린 값(손으로 고친 파일)은 띄울 때 통째로 버린다(docs/log/2026-09-27-agent-extra-args.md).
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
}
