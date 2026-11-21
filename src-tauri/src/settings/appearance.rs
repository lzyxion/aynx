//! 표시 설정 — 트리거 · 앱 크롬(`[app]`) · 터미널(`[terminal]`) · 월페이퍼. 값 정리와 상한 상수는 `normalize.rs`.
//! 문자열 칸 대부분은 "보관만" 한다 — 후보를 아는 쪽은 프런트이고 모르는 값은 프런트가 기본으로 떨어뜨린다.
//!
//! `TermPrefs` 의 `dynamic` 은 맨 마지막 필드여야 한다 — 프런트 `dynamic-color.test.ts` 가 이 파일을 읽어 지킨다.

use std::collections::BTreeMap;

/// 표시 트리거 — 색칠 · 링크 · 툴팁만이다. 입력을 보내거나 명령을 실행하는 계열은 두지 않는다
/// — 원격 출력(`echo` 한 줄)이 곧 코드 실행이 된다. `pattern` 의 해석 · 검사는 프런트(JS `RegExp`)가 한다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Trigger {
    pub pattern: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    /// Ctrl+클릭 URL 템플릿(`$0` · `$1` …). 백엔드는 스킴조차 보지 않는다 — 여는 것은 `src/lib/triggers.ts` 의 `safeUrl` 이 정한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    /// 손으로 적은 파일에서 생략하면 켜진 것으로 본다.
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

fn enabled_default() -> bool {
    true
}

/// 파일에 `triggers` 키가 아예 없을 때 들어가는 내장 두 개. 배경은 프런트가 45% 알파로 깔므로
/// (`triggers.ts` 의 `BG_ALPHA`) 저채도 값을 쓰면 터미널 배경과 구분되지 않는다.
pub(super) fn default_triggers() -> Vec<Trigger> {
    vec![
        Trigger {
            pattern: r"\bERROR\b".to_string(),
            fg: None,
            bg: Some("#7a2637".to_string()),
            url: None,
            tooltip: None,
            enabled: true,
        },
        Trigger {
            pattern: r"\bWARN(ING)?\b".to_string(),
            fg: None,
            bg: Some("#6b4a17".to_string()),
            url: None,
            tooltip: None,
            enabled: true,
        },
    ]
}

/// `[app]` — 앱 크롬 토큰 오버라이드와 앱 전역 동작 플래그. 색은 CSS 색 문자열 그대로(앱은 해석하지 않는다).
/// `None` = 안 정함 — 프런트가 `theme.css` 기본값으로 되돌린다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg_panel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warn: Option<String>,
    /// 월페이퍼 색 단계 — `"off"` · `"subtle"` · `"full"`. `None` = 프런트가 월페이퍼 유무로 정한다.
    /// 옛 불리언 `true` 는 읽을 때 `"full"` 로 옮긴다([`de_dynamic_mode`]) — 지우면 옛 설정이 깨진다.
    #[serde(
        default,
        deserialize_with = "de_dynamic_mode",
        skip_serializing_if = "Option::is_none"
    )]
    pub dynamic: Option<String>,
    /// 크롬 · 타일 면의 불투명도 %(0~100). 창 자체는 늘 불투명이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<u8>,
    /// 배치 복원 때 SSH 타일 자동 재접속. `None` = 끔 — 시키지 않은 접속(비밀번호 · 2FA 폭주 · 유령 로그인)을 만들지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_reconnect: Option<bool>,
    /// 창을 모두 닫으면 트레이에 남기. `None` = 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_on_close: Option<bool>,
    /// 제목줄의 창 단추. `None` = 끔.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_controls: Option<bool>,
    /// 옛 키 — 프런트가 읽을 때 `false` 를 [`AppTheme::header_chips_hidden`] 의 `"resource"` 로 옮기고 다시 적지 않는다. 옛 파일을 읽으려고 남긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_chip: Option<bool>,
    /// 비면 기본 순서. 모르는 id 를 버리고 빠진 칩을 끼우는 정규화는 프런트(`header-chips.ts`)이고 여기서는 공백 · 빈 값 · 중복만 거른다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub header_chip_order: Vec<String>,
    /// 켠 것이 아니라 끈 것을 적는다 — 새 칩은 저절로 켜진다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub header_chips_hidden: Vec<String>,
    /// `None` = 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_rings: Option<bool>,
    /// `None` = 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_rings: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiling: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// `None` = OS 를 따른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile_header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// 캐릭터 id 또는 사용자 아이콘 id `user-<12hex>`. `None` = `gpt`. exe · 설치 관리자 아이콘은 바뀌지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon: Option<String>,
    /// 무입력 자동 잠금(가림막)까지의 분. `None` · `0` = 끔 — `sanitize` 가 0 은 `None` 으로 접고 나머지는 `1..=240` 으로 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_lock_min: Option<u32>,
    /// UI 크기 %(`None` = 100). 범위 밖은 버리지 않고 자른다 — 손으로 적은 300 을 100 으로 되돌리면 뜻과 정반대다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_scale: Option<u16>,
    /// CSS `font-family` 문자열 그대로. 빈 값은 `None` 으로 접는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_font_family: Option<String>,
}

/// 터미널 내부(xterm) 취향. 필드 순서가 곧 TOML 출력 순서다 — 테이블인 `dynamic` 이 스칼라보다 앞에 오면
/// `[terminal.dynamic]` 헤더 뒤의 `theme = …` 이 하위 테이블 소속이 되어 다시 읽을 때 사라진다. 그래서 맨 아래다.
/// 기본이 켬인 `Option<bool>` 칸은 끈 사람의 파일에만 `false` 가 적힌다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TermPrefs {
    /// 프런트 내장 프리셋 키, 또는 `"dynamic"` = 아래 [`TermPrefs::dynamic`] 테이블.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// px. `MIN_FONT_SIZE..=MAX_FONT_SIZE` 밖이면 `None` 으로 접는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_style: Option<String>,
    /// `None` = 켬. 드라이버가 이상한 기기에서 DOM 렌더러로 물러날 탈출구다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webgl: Option<bool>,
    /// 로컬 셸에 통합 훅을 심는가(`None` = 켬). 끄면 argv 가 훅 없던 때와 바이트가 같다. 원격은 호스트별 `shell_integration` 이 따로다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_shell_integration: Option<bool>,
    /// 뺀 옛 모양 키가 남아 있어도 그대로 들고 있고 프런트 정규화가 버린다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_style: Option<String>,
    /// `None` = 끔. xterm 6 에서 리가처는 WebGL 에서만 그려져 켜면 프런트가 WebGL 을 강제한다(docs/verification/ligatures.md).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ligatures: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_click: Option<String>,
    /// `None` = 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_multiline_paste: Option<bool>,
    /// 원격이 보낸 OSC 52 를 이 PC 클립보드에 쓰는가(`None` = 켬). 쓰기 한 방향뿐이다 —
    /// 읽기 요청(`OSC 52 ; c ; ?`)은 이 값과 무관하게 늘 거부한다(답하면 원격이 클립보드를 읽어 가는 통로가 된다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc52_clipboard: Option<bool>,
    /// OSC 9 · 777 알림을 띄우는가(`None` = 켬). 꺼도 알아본 시퀀스는 삼킨다 — 띄우지만 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc_notify: Option<bool>,
    /// `None` = 켬.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_images: Option<bool>,
    /// `None` = 켬. 셸 통합(OSC 133)이 있는 타일에서만 뜬다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_snippets: Option<bool>,
    /// 초. `None` = 10 · `Some(0)` = 끔 — 기본이 켬이라 0 을 `None` 으로 접으면 끈 사람의 알림이 되살아난다. 상한 [`MAX_AFTER_SECS`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_after_secs: Option<u32>,
    /// 초. `None` = 3 · `Some(0)` = 끔 — `notify_after_secs` 와 같은 규칙.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_after_secs: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bell: Option<String>,
    /// 터미널 칸의 불투명도 %(10~100 · `None` = 100). `[app] opacity` 와 다른 값이다. 하한 10 — 0 이면 칸이 사라져 되돌리기 어렵다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<u8>,
    /// 월페이퍼에서 만든 팔레트 — 키 · 값을 검사하지 않고 보관만 한다. 맨 아래 필드여야 한다(위 머리말).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dynamic: BTreeMap<String, String>,
}

/// 창 전체의 배경 이미지. `None` = 안 정함 — 기본값은 프런트에 있다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WallpaperPrefs {
    /// `<config_dir>/aynx/` 안의 파일 이름 한 조각 — 경로가 아니다. `sanitize` 가 구분자 · `..` 가 섞인 값을 버려 앱 폴더 밖을 못 가리킨다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// 0~100 %.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<u8>,
    /// 0~20 px.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<u8>,
    /// 모르는 값은 `sanitize` 가 버린다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<String>,
}

/// 옛 불리언과 새 문자열을 둘 다 받는다 — `true` → `"full"`, `false` → 안 정함.
/// 어느 모양도 아닌 값은 다른 칸처럼 파일 전체를 못 읽게 둔다(이 칸만 너그럽게 삼키지 않는다).
fn de_dynamic_mode<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Flag(bool),
        Mode(String),
    }
    Ok(
        match <Option<Raw> as serde::Deserialize>::deserialize(deserializer)? {
            Some(Raw::Flag(true)) => Some("full".to_string()),
            Some(Raw::Flag(false)) | None => None,
            Some(Raw::Mode(mode)) => Some(mode),
        },
    )
}
