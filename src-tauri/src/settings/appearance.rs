//! 표시 설정 — 트리거(`Trigger` · 내장 기본 목록) · 앱 크롬 색(`AppTheme` · `[app] dynamic` 읽기) · 터미널(`TermPrefs`) ·
//! 월페이퍼(`WallpaperPrefs`). `settings.rs` 에서 그대로 옮겼다 — 바깥 경로는 `crate::settings::*` 재수출 그대로이고,
//! 값 정리(`AppSettings::sanitize`)와 그 상한 상수는 부모에 남는다.
//!
//! `TermPrefs` 의 `dynamic` 은 **맨 마지막 필드**여야 한다(TOML 하위 테이블 순서) — 프런트 `dynamic-color.test.ts` 가
//! 이 파일을 읽어 지킨다.

use std::collections::BTreeMap;

/// 표시 트리거 하나 — **표시 계열만** 이다.
///
/// 매치했을 때 하는 일은 그 구간에 색을 입히는 것뿐이고, 입력을 보내거나 명령을 실행하는
/// 계열(다른 터미널의 "trigger" 가 흔히 제공하는 것)은 **영구 보류**다. 원격 출력이 앱에게
/// 무언가를 시킬 수 있게 되는 순간, 화면에 로그를 흘리는 것만으로 명령이 실행되는 경로가
/// 생긴다 (`echo` 한 줄이 곧 코드 실행이다). 색칠은 그 위험이 없다.
///
/// `pattern` 은 **정규식**이고 해석은 프런트(JS `RegExp`)가 한다 — 백엔드는 문자열을
/// 보관만 하고 문법을 검사하지 않는다 (`theme` 프리셋 키를 그대로 보관하는 것과 같은 분담).
/// 잘못된 정규식은 프런트가 무시하고 설정 화면에 오류로 표시한다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Trigger {
    /// 정규식 문자열 그대로 (JS `RegExp` 문법). 비면 [`AppSettings::sanitize`] 가 버린다.
    pub pattern: String,
    /// 매치 구간의 글자색 (CSS 색 문자열). `None` 이면 원래 색 그대로.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    /// 매치 구간의 배경색 (CSS 색 문자열). `None` 이면 배경을 칠하지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    /// Ctrl+클릭했을 때 열 URL **템플릿**. `None` 이면 이 트리거는 링크가 아니다.
    ///
    /// `$0`(매치 전체)·`$1`… 이 캡처로 치환된다 — **치환도 검사도 프런트가 한다**
    /// (`pattern` 과 같은 분담: 정규식을 아는 쪽이 캡처를 안다). 백엔드는 문자열을 보관만
    /// 하고 스킴조차 보지 않는다. 실제로 무엇을 열어 줄지는 `src/lib/triggers.ts` 의
    /// `safeUrl` 이 정한다 (http · https · mailto 만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 마우스를 올렸을 때 뜨는 설명 **템플릿**. `None` 이면 툴팁이 없다.
    /// 치환 규칙은 [`Trigger::url`] 과 같다 (인코딩만 하지 않는다 — 사람이 읽는 글이다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    /// 꺼 둔 트리거도 목록에는 남는다 (지우지 않고 잠깐 끄는 용도).
    /// 손으로 적은 파일에서 생략하면 켜진 것으로 본다.
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

fn enabled_default() -> bool {
    true
}

/// 파일에 `triggers` 키가 아예 없을 때 들어가는 내장 두 개.
///
/// 색은 `theme.css` 의 `--err`·`--warn` **계열의 중간 농도**를 박아 둔다. 트리거 색은
/// 사용자가 고칠 수 있는 값이라 토큰 이름이 아니라 실제 색이어야 하고(설정 화면의 색
/// 선택기가 hex 를 요구한다), 테마를 바꿔도 따라가지 않는 것이 오히려 예측 가능하다.
///
/// **배너용 저채도 값(`--err-soft` `#2e1c22`)을 쓰지 않는 이유**: 배경만 칠하는 트리거는
/// 프런트에서 45% 알파로 깔린다 (글자를 덮지 않으려고 — `src/lib/triggers.ts` 의
/// `BG_ALPHA`). 저채도 값을 45% 로 섞으면 터미널 배경(`--term-bg` `#12141a`)과 거의
/// 구분되지 않아 하이라이트가 사라진다. 여기 값들은 그 45% 를 통과한 뒤에도 읽힌다.
pub(super) fn default_triggers() -> Vec<Trigger> {
    vec![
        Trigger {
            pattern: r"\bERROR\b".to_string(),
            fg: None,
            bg: Some("#7a2637".to_string()),
            // 내장 둘은 **하이라이트만** 한다 — 어디로 링크를 걸지, 무엇을 설명할지는
            // 그 로그를 아는 사람만 안다 (예시는 설정 화면의 [예시 추가] 에 있다).
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

/// 앱 크롬(사이드바·탭·모달) 토큰 오버라이드.
///
/// 모든 필드가 `Option` 인 것이 핵심이다 — `None` 은 "안 정했음"이고, 프런트는 그때
/// `removeProperty` 로 `theme.css` 의 기본값으로 되돌린다. 빈 문자열로 덮어쓰는 상태는 없다
/// (`sanitize` 가 빈 문자열을 `None` 으로 접는다).
///
/// 값은 CSS 색 문자열 그대로다 — 앱은 해석하지 않는다(`sessions.toml` 의 `color` 와 같은 규칙).
/// 못 알아볼 값을 넣으면 브라우저가 그 선언 하나를 무시할 뿐 화면이 깨지지는 않는다.
///
/// 토큰만 있는 것은 아니다 — `[app]` 이 이 구조체 하나뿐이라 앱 전역 **동작 플래그**
/// ([`AppTheme::auto_reconnect`]) 도 여기 얹혀 있다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppTheme {
    /// `--accent`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    /// `--bg`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    /// `--bg-panel`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg_panel: Option<String>,
    /// `--fg` — 본문 글자색.
    ///
    /// 아래 넷(`fg`·`border`·`err`·`ok`·`warn`)은 설정 화면에 색 선택기가 **없다**. 손으로
    /// 고칠 수는 있지만 주로 월페이퍼 추출([`AppTheme::dynamic`])이 채우는 칸이다 —
    /// GUI 에 색 선택기 여덟 개를 세우는 것은 "자주 만지는 것만 GUI 로" 라는 이 파일의
    /// 분담에 어긋나고, 그 이상은 ③사용자 CSS 오버라이드의 몫이다.
    /// 보관 규칙은 위 셋과 똑같다 — 문자열 그대로, 빈 값은 `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    /// `--border`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    /// `--err` — 실패
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err: Option<String>,
    /// `--ok` — 정상
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok: Option<String>,
    /// `--warn` — 주의
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warn: Option<String>,
    /// 월페이퍼가 앱 색에 **얼마나** 들어오는가 — `"off"` · `"subtle"` · `"full"`
    /// (docs/log/2026-09-04-dynamic-color.md · docs/log/2026-09-25-wallpaper-tint.md).
    /// `None` = 안 정함 = 프런트가 월페이퍼 유무로 정한다(있으면 `subtle`, 없으면 `off`).
    ///
    /// **"보관만"** 분담이다 (`mode`·`tiling` 과 같다) — 셋을 아는 쪽은 프런트이고 모르는 값은
    /// 거기서 "안 정함" 으로 떨어진다. 백엔드가 하는 일은 **옛 불리언의 이사** 하나뿐이다:
    /// 2026-09-25 전에는 이 칸이 켬/끔 토글(`dynamic = true`)이었고, 그 `true` 는 지금의
    /// `"full"` 과 같은 뜻이라 읽을 때 옮긴다 ([`de_dynamic_mode`]). `false` 는 옛 코드가 적은
    /// 적이 없지만 손으로 적었다면 안 정함과 같다. 쓸 때는 언제나 문자열로 나간다.
    ///
    /// 아래는 `"full"` 일 때의 이야기다 (은은하게는 파일에 색을 남기지 않는다).
    ///
    /// 색이 아니라 **표시**다. 값 자체는 위 여덟 칸과 `[terminal.dynamic]` 에 이미 들어
    /// 있으므로 이 플래그가 없어도 화면은 똑같이 칠해진다. 그런데도 필요한 이유는 셋이다.
    ///
    /// - **월페이퍼를 바꿨을 때 다시 뽑을지**를 이 값이 정한다.
    /// - **월페이퍼를 지웠을 때** 이 색들도 같이 걷을지를 정한다 (원본이 없는데 그 사진의
    ///   색만 남아 있으면 사용자가 색의 출처를 알 길이 없다).
    /// - 설정 화면의 토글이 이 값을 보여준다.
    ///
    /// 사용자가 색을 직접 고르거나 터미널 프리셋을 직접 고르면 프런트가 이 값을 끈다 —
    /// 손으로 고른 값을 다음 추출이 덮어쓰지 않게 하려는 것이다 (그때 `"off"` 로 내려간다).
    #[serde(
        default,
        deserialize_with = "de_dynamic_mode",
        skip_serializing_if = "Option::is_none"
    )]
    pub dynamic: Option<String>,
    /// 앱 크롬 · 타일 면의 **불투명도 %**(0~100). `None` = 안 정함 = 프런트 기본. 낮출수록 앱 배경
    /// (월페이퍼 · 없으면 번짐)이 그만큼 비친다 — 창 자체는 늘 불투명이다(10-22). 범위 밖 값은 `sanitize` 가 버린다.
    /// 프런트가 `--chrome-pct` 로 합성해 슬라이더로 조절한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<u8>,
    /// 저장된 배치를 복원할 때 SSH 타일을 **자동으로 다시 붙일 것인가**.
    /// `None` = 안 정함 = **끔** — 복원된 SSH 타일은 사람이 [다시 연결]을 누를 때까지 기다린다.
    ///
    /// **색 토큰이 아니라 동작 플래그**다. `[app]` 은 지금 이 구조체 하나뿐이라 여기 얹는다 —
    /// 플래그 하나 때문에 `[behavior]` 섹션을 새로 파면 파일에 반쯤 빈 테이블만 늘어난다
    /// (동작 플래그가 몇 개 더 생기면 그때 옮기면 될 일이고, 그때도 `alias` 로 옛 위치를 읽으면 된다).
    ///
    /// **기본이 끔인 이유**: 탭 열 개짜리 배치를 복원하면서 SSH 를 열 개 동시에 여는 것은
    /// 사용자가 시키지 않은 접속이다 — 비밀번호·2FA 프롬프트가 한꺼번에 쏟아지고, 서버 쪽
    /// 로그인 감사에도 유령 접속으로 남는다. 켜는 사람은 그걸 알고 켠다. 켠 경우에도 **동시에
    /// 다 열지는 않고** 프런트가 시차를 두고 하나씩 붙인다(접속 폭주 방지) — 백엔드는 이 불리언만 보관한다.
    ///
    /// `webgl` 과 같은 `Option<bool>` 배관이라 안 정하면 파일에 키 자체가 안 적힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_reconnect: Option<bool>,
    /// **창을 모두 닫으면 트레이에 남기**(③-4 — `crate::tray`). `None` = 켬(기본). 끄면 마지막 창을 닫을 때 GUI 가 끝난다 —
    /// 어느 쪽이든 세션은 세션 서버에 산다. 트레이가 없는 OS 에서는 값과 무관하게 끝난다(`tray::supported`).
    /// 프런트는 `false` 일 때만 적는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_on_close: Option<bool>,
    /// **제목줄의 창 단추**(최소화 · 최대화 · 닫기 — 2026-10-28). `None` = 끔(기본 — 닫기는 독의 [끝내기…] 모달로 옮겼다).
    /// 보관만 한다 — 그리는 것은 프런트(`chrome/WindowTitlebar`)다. 프런트는 `true` 일 때만 적는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_controls: Option<bool>,
    /// **옛 키** — 로컬 타일 머리줄의 자원 칩 켬끔(2026-10-17). 2026-10-18 부터 칩 켬끔은 [`AppTheme::header_chips_hidden`]
    /// 하나가 쥐고, 프런트가 읽을 때 `false` 를 거기의 `"resource"` 로 옮긴 뒤 이 칸은 다시 적지 않는다. 옛 파일을 읽으려고 남긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_chip: Option<bool>,
    /// **타일 머리줄 칩의 순서**(2026-10-18 — 칩 id(기본 순서 — 10-23): `folder` · `branch` · `jump` · `tmux` · `forward` · `resource` · `ai`.
    /// 옛 `ai_read` 는 10-23 에 `ai` 로 합쳤다 — 옮기기는 프런트 `migrateLegacyChips`). 비면 안 적힘 = 기본 순서. 보관만 한다 — 모르는 id 를 버리고 빠진 칩을 끼우는 정규화는 프런트
    /// (`src/lib/header-chips.ts`)이고, 여기서는 공백 · 빈 값 · 중복만 걸러 낸다(`disabled_agents` 와 같은 규칙).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub header_chip_order: Vec<String>,
    /// **끈 머리줄 칩** — 켠 것이 아니라 끈 것을 적는다(새 칩이 생기면 저절로 켬). 비면 안 적힘 = 전부 켬. 걸러 내기는 위와 같다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub header_chips_hidden: Vec<String>,
    /// **상태바의 자원 고리**(이 PC 전체 CPU · 메모리 — `server::resources` 의 `system`). `None` = 켬(기본). 보관만 한다 — 고리를
    /// 그리고 표본을 당기는 것은 프런트다. 프런트는 `false` 일 때만 적는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_rings: Option<bool>,
    /// **상태바의 사용량 고리**(AI CLI 사용 한도 — 에이전트별). `None` = 켬(기본). 보관만 한다 — 프런트는 `false` 일 때만 적는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_rings: Option<bool>,
    /// **새 타일이 어디로 들어가는가** — `"spiral"`(기본) 또는 `"focus"`
    /// (docs/log/2026-09-04-spiral-tiling.md). `None` = 안 정함 = 프런트 기본(`spiral`).
    ///
    /// - `spiral` — 가장 최근에 놓인 칸을 시계 방향으로 계속 쪼갠다 (dwindle).
    /// - `focus` — 지금 포커스된 타일의 **긴 변**을 쪼갠다 (2026-09-04 이전의 규칙).
    ///
    /// [`AppTheme::auto_reconnect`] 와 같은 자리에 사는 **동작 플래그**다 (색 토큰이 아니다).
    /// 값은 `theme`·`tab_style` 과 같은 "보관만" 분담이다 — 후보 목록을 아는 쪽은 프런트이고,
    /// 백엔드는 공백만 떼어 문자열 그대로 들고 있다. 모르는 값이면 프런트가 기본(`spiral`)으로
    /// 떨어지므로, 옛 버전이 남긴 값이나 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiling: Option<String>,
    /// **앱 모드** — `"system"`(기본) · `"dark"` · `"light"`
    /// (docs/log/2026-09-04-light-theme.md). `None` = 안 정함 = 프런트 기본(`system` — 2026-10-01 부터,
    /// 그 전에는 `dark`. docs/log/2026-10-01-design-defaults.md).
    ///
    /// 색 토큰이 아니라 **어느 팔레트를 통째로 쓸 것인가**다. 위 여덟 칸은 그 팔레트 위에
    /// 얹는 오버라이드이므로 층이 다르지만, `[app]` 이 앱 크롬 테이블 하나뿐이라 같이 산다
    /// ([`AppTheme::tiling`] 과 같은 자리 논리다).
    ///
    /// `tiling`·`tab_style`·`theme` 과 같은 **"보관만"** 분담이다 — 후보 셋을 아는 쪽은
    /// 프런트(`APP_MODES`)이고, 백엔드는 공백만 떼어 문자열 그대로 들고 있다. 모르는 값이면
    /// 프런트가 기본(`system`)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    ///
    /// 처음에는 프런트의 localStorage 키에만 있었고, 이 칸이 생기면서 그리로
    /// 옮겼다 — 프런트가 부팅 때 한 번 옛 키를 여기로 이사시키고 지운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// **화면 언어** — `"ko"` · `"en"` (docs/log/2026-09-17-i18n.md).
    /// `None` = 안 정함 = **OS 를 따른다** (`navigator.language` 가 `ko` 로 시작하면 한국어,
    /// 그 밖에는 영어).
    ///
    /// [`AppTheme::mode`] 와 완전히 같은 **"보관만"** 분담이다 — 후보 둘을 아는 쪽은
    /// 프런트(`LANGUAGES`)이고, 백엔드는 공백만 떼어 문자열 그대로 들고 있다. 모르는 값이면
    /// 프런트가 "안 정함"(= OS 따라가기)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    ///
    /// 색 토큰이 아니라 **앱을 켤 때의 동작**이라 `[app]` 에 산다. 백엔드 자신의 메시지는
    /// 아직 이 값을 읽지 않는다 — Rust 쪽 번역은 단계 ④의 몫이다(`set_language` + `tr()`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// **타일 헤더(이름·드래그 손잡이·📂·✦·⤢·×)를 언제 다는가** —
    /// `"always"`(기본) · `"multi"` · `"never"` (docs/log/2026-09-05-tile-header.md).
    /// `None` = 안 정함 = 프런트 기본(`always`).
    ///
    /// - `always` — 타일이 하나뿐인 탭에도 헤더가 붙는다.
    /// - `multi` — 타일이 2개 이상일 때만 (2026-09-05 이전의 동작).
    /// - `never` — 어디에도 안 붙는다. 헤더의 조작들은 전부 단축키로만 한다.
    ///
    /// [`AppTheme::tiling`]·[`AppTheme::mode`] 와 같은 **"보관만"** 분담이다 — 후보 셋을
    /// 아는 쪽은 프런트(`TILE_HEADER_MODES`)이고, 백엔드는 공백만 떼어 문자열 그대로 든다.
    /// 모르는 값이면 프런트가 기본(`always`)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile_header: Option<String>,
    /// **상태바를 어느 가장자리에 두는가** — `"left"`(기본) · `"top"` · `"bottom"` · `"right"`
    /// (i3bar·tmux 상태줄 자리의 얇은 앱 크롬 띠). `None` = 안 정함 = 프런트 기본(`left` — 2026-10-01 부터,
    /// 그 전에는 `top`).
    ///
    /// [`AppTheme::tile_header`]·[`AppTheme::tiling`] 과 같은 **"보관만"** 분담이다 — 후보 넷을
    /// 아는 쪽은 프런트(`STATUS_BAR_POSITIONS`)이고, 백엔드는 공백만 떼어 문자열 그대로 든다.
    /// 모르는 값이면 프런트가 기본(`left`)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// **상태바 모양** — `"flat"`(기본, 지금까지의 평면 띠) · `"panel"`(타일처럼 여백+전 모서리
    /// 둥근 떠 있는 패널). `None` = 안 정함 = 프런트 기본(`flat`).
    ///
    /// [`AppTheme::status_bar`] 와 짝인 **"보관만"** 분담이다 — 후보 셋을 아는 쪽은
    /// 프런트(`STATUS_BAR_STYLES`)이고, 백엔드는 공백만 떼어 문자열 그대로 든다.
    /// 모르는 값이면 프런트가 기본(`flat`)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar_style: Option<String>,
    /// **앱 크롬 재질** — `"glass"`(기본, 반투명 판 + 앱 안 흐림) · `"flat"`(불투명 평면, 2026-10-11 이전 모습).
    /// `None` = 안 정함 = 프런트 기본(`glass`). 색 체계(위 여덟 칸·`dynamic`·`mode`)와 독립된 축이다 —
    /// 유리의 물빛은 프런트가 그 토큰에서 파생한다(`theme.css` 의 `data-material`).
    ///
    /// [`AppTheme::status_bar_style`] 과 같은 **"보관만"** 분담이다 — 후보 둘을 아는 쪽은
    /// 프런트(`MATERIALS`)이고, 백엔드는 공백만 떼어 문자열 그대로 든다.
    /// 모르는 값이면 프런트가 기본(`glass`)으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// **앱 아이콘(창·작업 표시줄)** — 캐릭터 id(`claude`·`gemini`·`gpt`(기본, 빌드 아이콘과 같은 그림)·`grok`) · 사용자
    /// 아이콘 id `user-<12hex>`(docs/log/2026-10-04-app-icon-switch.md · docs/log/2026-10-22-custom-app-icon.md). `None` = 안 정함 = `gpt`.
    ///
    /// [`AppTheme::status_bar_style`] 과 같은 **"보관만"** 분담이다 — 후보를 아는 쪽은 프런트(`APP_ICONS`)와
    /// [`crate::app_icon`] 의 표이고, 모르는 값은 둘 다 기본(`gpt` — 빌드 아이콘과 같은 그림)으로 떨어진다. 창에 거는 것은
    /// `app_icon` 모듈(setup·새 창·`set_app_icon` 명령)이다. exe·설치 관리자 아이콘은 바뀌지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon: Option<String>,
    /// **무입력 자동 잠금까지의 분(分)** — 이 시간 동안 사용자 입력이 하나도 없으면
    /// 프라이버시 가림막(`Veil`)을 자동으로 연다. `None`/없음 또는 `0` = **끔**(자동 잠금 안 함).
    ///
    /// [`AppTheme::auto_reconnect`] 와 같은 자리에 사는 **동작 플래그**다 (색 토큰이 아니다) —
    /// 가림막은 앱 크롬의 일부이고 `[terminal]` 프리셋과 층이 다르다. 보안 잠금이 아니라
    /// 시선 가림일 뿐이라(아무 키·클릭에 곧바로 풀린다) 여기 얹어도 위험이 없다.
    /// `sanitize` 가 `0` 은 `None`(끔)으로 접고, 그 밖의 값은 `1..=240` 으로 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_lock_min: Option<u32>,
    /// **UI 크기 %** — 앱 크롬(글자·아이콘·여백) 전체의 배율 (docs/log/2026-09-25-ui-scale-font.md).
    /// `None` = 안 정함 = 100 %.
    ///
    /// 프런트가 웹뷰 확대(`Webview::setZoom`)로 건다 — 이 값이 정하는 것은 배율 하나뿐이고,
    /// 터미널 글자가 사용자가 정한 [`TermPrefs::font_size`] 그대로 보이게 되돌려 맞추는 일도
    /// 프런트의 몫이다. 범위 밖 값은 `sanitize` 가 [`MIN_UI_SCALE`]~[`MAX_UI_SCALE`] 로 자른다
    /// (터미널 불투명도와 같은 "자른다" 쪽 — 손으로 적은 300 을 "안 정함(=100)" 으로 되돌리면
    /// 크게 보고 싶던 사람의 뜻과 정반대가 된다). 설정 화면의 후보(80·90·100·110·125·150)에
    /// 맞추는 것도 프런트다 — 백엔드는 범위만 지킨다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_scale: Option<u16>,
    /// **앱 글꼴** — CSS `font-family` 문자열 그대로 (`--font-ui` 에 들어간다).
    /// `None` = 안 정함 = `theme.css` 의 기본 스택. 빈 값은 `sanitize` 가 `None` 으로 접는다
    /// ([`TermPrefs::font_family`] 와 같은 "보관만" 분담).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_font_family: Option<String>,
}

/// 터미널 내부(xterm) 취향. `scrollback` 은 여기 없다 — 호스트별 값이라 `sessions.toml` 영역이다.
///
/// **필드 순서가 곧 TOML 출력 순서**다: 테이블인 [`TermPrefs::dynamic`] 이 스칼라들보다
/// 앞에 오면 `[terminal.dynamic]` 헤더 뒤에 찍힌 `theme = …` 이 그 하위 테이블 소속이
/// 되어 다시 읽을 때 사라진다. 그래서 그 필드는 **맨 아래**에 있다
/// ([`AppSettings::triggers`] 가 맨 위에 있는 것과 같은 이유의 반대편이다).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TermPrefs {
    /// 프런트 내장 프리셋 키 (`aynx-dark`·`light`·`tokyo-night`·`gruvbox-dark`), 또는
    /// `"dynamic"` = 아래 [`TermPrefs::dynamic`] 테이블을 쓴다는 뜻.
    /// 백엔드는 목록을 모른다 — 모르는 키면 프런트가 기본 프리셋으로 떨어진다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    /// CSS `font-family` 문자열 그대로 (xterm `fontFamily` 에 그대로 들어간다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// px. `MIN_FONT_SIZE..=MAX_FONT_SIZE` 밖이면 `None` 으로 접는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u16>,
    /// **커서 모양** — `"block"`(기본, 블럭) · `"underline"`(밑줄) · `"bar"`(세로선).
    /// `None` = 안 정함 = 프런트 기본(`block`). xterm `cursorStyle` 에 그대로 들어간다.
    ///
    /// `theme`·`tab_style`·`right_click` 과 같은 **"보관만"** 분담이다 — 후보 셋을 아는 쪽은
    /// 프런트이고, 백엔드는 공백만 떼어 문자열 그대로 든다. 모르는 값이면 프런트가 기본(`block`)
    /// 으로 떨어지므로 손으로 적은 오타가 앱을 막지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_style: Option<String>,
    /// WebGL 가속 렌더러를 쓸 것인가. `None` = 안 정함 = **켬**(프런트 기본값).
    ///
    /// 끌 수 있어야 하는 이유는 성능이 아니라 **탈출구**다 — 드라이버가 이상한 기기에서
    /// 화면이 깨지면 사용자가 스스로 DOM 렌더러로 물러날 수 있어야 한다
    /// (컨텍스트 로스 자동 폴백은 프런트가 따로 한다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webgl: Option<bool>,
    /// **로컬 셸에 통합 훅을 심을 것인가.** `None` = 안 정함 = **켬**(지금까지의 동작).
    ///
    /// 켜면 로컬 셸을 띄울 때 시작 파일을 인자로 물려 준다 — PowerShell 은
    /// `integration.ps1`, Git Bash 는 `integration-gitbash.rc`, WSL 은 `integration-wsl.rc`
    /// (`crate::pty::shell_command`). 그 훅이 내는 것이 **명령 블록**(OSC 133)과
    /// **현재 폴더**(OSC 7)다. 끄면 `integration` 이 전부 `None` 이라 argv 가 이 기능들이
    /// 생기기 전과 **바이트가 같다** — 즉 `cmd` 처럼 동작한다(블록 없음 · 폴더는 PEB 추정).
    ///
    /// 이름에 `local` 이 붙는 이유는 원격에는 이미 **호스트별** 3값
    /// (`sessions.toml` 의 `shell_integration`)이 따로 있기 때문이다 — 이 값은 그것을
    /// 건드리지 않는다.
    ///
    /// `webgl` 과 같은 `Option<bool>` 배관이고 기본이 켬이므로 **끈 사람의 파일에만**
    /// `false` 가 적힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_shell_integration: Option<bool>,
    /// 탭 바 모양 (`pill`·`flat`). 백엔드는 목록을 모르고 문자열만 보관한다 —
    /// 모르는 값이면 프런트가 기본(`pill`)으로 떨어진다 (`theme` 프리셋 키와 같은 분담).
    /// 뺀 옛 모양 키(`powerline` 등)가 옛 파일에 남아 있어도 그대로 들고 있고, 프런트 정규화가 버린다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_style: Option<String>,
    /// 폰트 리가처(`->`·`=>` 결합)를 켤 것인가. `None` = 안 정함 = **끔**(프런트 기본값).
    /// xterm 6 에서 리가처는 WebGL 렌더러에서만 렌더되므로, 켜면 프런트가 그 패널의 WebGL 을
    /// 강제한다 (docs/verification/ligatures.md).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ligatures: Option<bool>,
    /// 터미널에서 **우클릭이 무엇을 하는가** — `"menu"`(기본) 또는 `"paste"`.
    /// `None` = 안 정함 = 프런트 기본(`menu` — 컨텍스트 메뉴).
    ///
    /// `theme`·`tab_style` 과 같은 **"보관만"** 분담이다: 후보 둘을 아는 쪽은 프런트이고,
    /// 모르는 값이면 거기서 기본(`menu`)으로 떨어진다. 백엔드는 공백만 떼어 둔다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_click: Option<String>,
    /// 여러 줄(줄바꿈 포함) 붙여넣기 전에 확인을 묻는가. `None` = 안 정함 = **켬**(프런트 기본).
    ///
    /// 다른 불리언들(`webgl`·`ligatures`)과 같은 규칙으로, 기본과 다른 값일 때만 파일에 남는다 —
    /// 여기서는 기본이 켬이므로 **끈 사람의 파일에만** `false` 가 적힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_multiline_paste: Option<bool>,
    /// **원격이 보낸 OSC 52 를 이 PC 의 클립보드에 쓰는가.** `None` = 안 정함 = **켬**.
    ///
    /// 원격의 vim(`"+y`)·tmux(`set-clipboard on`)가 집은 글자를 터미널에게 건네는 시퀀스다.
    /// 받아 적지 않으면 그 글자는 서버 안에 갇힌다 — SSH 도구에서 가장 크게 비는 자리였다.
    ///
    /// **읽기 요청(`OSC 52 ; c ; ?`)은 이 값과 무관하게 언제나 거부한다** — 답하면 원격에서
    /// 도는 아무 프로그램이나 이 PC 의 클립보드를 읽어 가는 유출 통로가 된다. 그래서 이
    /// 토글이 정하는 것은 **쓰기 한 방향뿐**이다 (docs/log/2026-09-23-osc52-osc8.md).
    ///
    /// `webgl`·`confirm_multiline_paste` 와 같은 `Option<bool>` 배관이고 기본이 켬이므로
    /// **끈 사람의 파일에만** `false` 가 적힌다. 읽는 쪽은 프런트뿐이다
    /// (`Terminal.svelte` 의 OSC 52 핸들러 — 셸 통합과 무관하게 **모든 타일**에 걸린다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc52_clipboard: Option<bool>,
    /// **타일 안 프로그램이 보낸 알림(OSC 9 · OSC 777 `notify`)을 띄우는가.** `None` = 안 정함
    /// = **켬**.
    ///
    /// 꺼도 알아본 시퀀스는 **삼킨다**(화면에 이스케이프 조각이 새지 않게) — 띄우지만 않는다.
    /// 제목 위조 방지(제목은 늘 `aynx · 타일`)·타일당 속도 제한·ConEmu 하위 명령(`9;4`·`9;9`)
    /// 제외는 이 값과 무관한 프런트의 불변이다 (docs/log/2026-09-26-osc-notify-inline-images.md).
    ///
    /// `osc52_clipboard` 와 같은 `Option<bool>` 배관이고 기본이 켬이므로 **끈 사람의 파일에만**
    /// `false` 가 적힌다. 읽는 쪽은 프런트뿐이다 (셸 통합과 무관하게 **모든 타일**에 걸린다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc_notify: Option<bool>,
    /// **sixel · iTerm2 인라인 이미지(OSC 1337 `File=`)를 그리는가.** `None` = 안 정함 = **켬**.
    ///
    /// 프런트가 `@xterm/addon-image` 를 붙이고 떼는 스위치다 — 합자처럼 **열린 타일에도 바로**
    /// 적용된다(끄면 그 타일의 이미지가 사라진다). 같은 `Option<bool>` 배관이라 **끈 사람의
    /// 파일에만** `false` 가 적힌다 (docs/log/2026-09-26-osc-notify-inline-images.md).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_images: Option<bool>,
    /// **프롬프트에 치는 동안 맞는 스니펫을 커서 옆에 띄우는가.** `None` = 안 정함 = **켬**.
    ///
    /// `confirm_multiline_paste`·`webgl` 과 같은 `Option<bool>` 배관이고 기본이 켬이므로
    /// **끈 사람의 파일에만** `false` 가 적힌다.
    ///
    /// 읽는 쪽은 프런트뿐이다 (`Terminal.svelte` — 값은 다시 셀 때마다 읽으므로 끄면 그
    /// 자리에서 상자가 사라진다). 셸 통합(OSC 133)이 있는 타일에만 뜻이 있다 — 사람이 친
    /// 글자가 어디서 시작하는지를 아는 길이 `B` 마커뿐이라, 훅이 없는 타일(`cmd` · tmux 간이
    /// 모드)에서는 이 값이 켜져 있어도 한 번도 뜨지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_snippets: Option<bool>,
    /// **긴 명령이 끝나면 알린다** — 이 초 이상 걸린 명령이 대상이다.
    /// `None` = 안 정함 = **10초**(프런트 기본). `Some(0)` = **끔**.
    ///
    /// 다른 숫자 필드와 달리 **`0` 을 `None` 으로 접지 않는다** ([`AppTheme::idle_lock_min`]
    /// 과 정확히 반대다). 저쪽은 기본이 "끔" 이라 0 과 안 정함이 같은 뜻이지만, 여기는
    /// 기본이 **켬(10초)** 이라 0 은 "사용자가 끄기를 골랐다" 는 **다른 상태**다 — 접으면
    /// 끈 사람이 앱을 다시 켤 때마다 알림이 되살아난다.
    ///
    /// 셸 통합(OSC 133)이 있는 타일에만 뜻이 있다 — 명령의 시작·끝을 아는 길이 그것뿐이다.
    /// 상한은 [`MAX_AFTER_SECS`] 로 자른다 (손으로 적은 터무니없는 값이 사실상
    /// "끔" 이 되지 않게).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_after_secs: Option<u32>,
    /// **이 초 이상 걸린 명령에만** 실행 시간을 블록 오른쪽 끝에 적는다 (화면에 적히는 것은
    /// `12.4초` 하나뿐이고, 성패는 색이 말한다 — 실패면 붉다. 종료 코드 숫자는 실패의 붉은
    /// 띠 말풍선 안이다).
    /// `None` = 안 정함 = **3초**(프런트 기본). `Some(0)` = **끔**.
    ///
    /// 바로 위 [`TermPrefs::notify_after_secs`] 와 **똑같은 배관**이다 — `0` 을 `None` 으로
    /// 접지 않고(기본이 켬이라 0 은 "사용자가 껐다" 는 다른 상태다), 상한만
    /// [`MAX_AFTER_SECS`] 로 자른다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_after_secs: Option<u32>,
    /// **벨**(`\a`)이 왔을 때 무엇을 하는가 — `"visual"`(기본) · `"visual+sound"` · `"off"`.
    /// `None` = 안 정함 = 프런트 기본(`visual` — 타일 테두리가 잠깐 강조색으로 번쩍인다).
    ///
    /// `right_click`·`cursor_style` 과 같은 **"보관만"** 분담이다: 후보 셋을 아는 쪽은
    /// 프런트이고, 모르는 값이면 거기서 기본(`visual`)으로 떨어진다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bell: Option<String>,
    /// **터미널 칸**의 불투명도 %(10~100). `None` = 안 정함 = 100 = 지금까지와 똑같이 불투명.
    ///
    /// [`AppTheme::opacity`] 와 **다른 값**이다. 저쪽은 앱 크롬(창 배경·사이드바·탭 바·타일
    /// 사이 틈)을 비추고, 이 값은 **글자가 앉는 칸 자체**를 비춘다. 둘을 하나로 묶지 않는 이유는
    /// 읽기 쉬운 조합이 대개 "크롬은 많이 비치고 터미널은 조금만" 이라 서로 다른 값을 원하기
    /// 때문이다. 그래서 파일에서도 `[app]` 이 아니라 `[terminal]` 에 있다.
    ///
    /// 하한이 0 이 아니라 10 인 것은 0 이 **글자만 뜨는 유령 칸**이 되어 되돌리기 어렵기
    /// 때문이다 (설정 화면에 가려면 그 칸을 봐야 한다). 범위 밖은 버리지 않고 자른다 —
    /// [`WallpaperPrefs::dim`] 과 같은 규칙이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<u8>,
    /// 월페이퍼에서 만든 터미널 팔레트 (`[terminal] theme = "dynamic"` 일 때 쓰인다).
    /// 비면 테이블 자체가 파일에 안 적힌다.
    ///
    /// **키·값을 검사하지 않는다** — `keybindings` 와 같은 "보관만" 분담이다. 프런트가
    /// 넣는 것은 xterm `ITheme` 의 필드 이름 21칸(`background`·`red`·`brightWhite`…)에
    /// `before-theme`(동적을 켜기 직전의 프리셋 키) 한 칸을 더한 값이고, 그 목록을 아는
    /// 쪽은 프런트다. 모르는 키가 섞여 있어도 프런트가 아는 칸만 골라 xterm 에 건다.
    ///
    /// **왜 파일에 적어 두나**: 안 적으면 앱을 켤 때마다 배경 이미지를 디코딩해 다시
    /// 뽑아야 하고, 그동안 터미널이 기본 팔레트로 한 번 칠해졌다가 바뀐다. 결과를 그대로
    /// 들고 있으면 첫 프레임부터 맞는 색이다.
    ///
    /// [`BTreeMap`] 이라 파일 출력이 결정적이고 (색 이름 순), 위 주석대로 **맨 아래 필드**여야 한다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dynamic: BTreeMap<String, String>,
}

/// 창 **전체**의 배경 이미지 (`docs/log/2026-09-04-wallpaper.md`).
///
/// 색 토큰([`AppTheme`])과 층이 다르다. 저기는 크롬을 **무슨 색으로 칠할지**를 정하고,
/// 여기는 그 크롬 **뒤에 무엇이 깔리는지**를 정한다 — 그래서 자기 테이블을 갖는다.
/// (2단계에서 이 이미지의 색을 뽑아 MD3 팔레트를 만들 때, 그 결과는 `[app]` 의 색
/// 토큰으로 흘러 들어가고 이 테이블은 **원본**으로 남는다.)
///
/// 네 값 모두 `Option` 이고 `None` = "안 정함" 이다 — 기본값은 프런트에 있다
/// (`theme` 프리셋 키와 같은 분담: 백엔드는 값을 보관하고 검증만 한다).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WallpaperPrefs {
    /// `<config_dir>/aynx/` 안의 **파일 이름 한 조각** (`"wallpaper.jpg"`). `None` = 배경 없음.
    ///
    /// **경로가 아니라 이름이다.** 원본 경로를 저장하면 사진을 옮기는 순간 배경이 사라지므로
    /// 고른 그 순간의 바이트를 앱 폴더로 복사해 소유한다(`wallpaper.rs`). 그 결과 이 값에는
    /// 구분자가 들어갈 일이 없고, [`AppSettings::sanitize`] 가 구분자·`..` 가 섞인 값을
    /// 버려서 손으로 고친 파일이 앱 폴더 밖을 가리키지 못하게 한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// 이미지 위에 덮는 검정의 농도 %(0~100). `None` = 안 정함 = 프런트 기본값.
    /// 배경이 밝으면 그 위의 흐린 글자(`--fg-muted`)가 안 읽히므로 **가독성 손잡이**다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<u8>,
    /// 배경 블러 반경 px(0~20). `None` = 안 정함 = 0(선명).
    /// 사진의 디테일이 글자와 경쟁하지 않게 하는 두 번째 손잡이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<u8>,
    /// 배치 — `"cover"`·`"contain"`·`"tile"`·`"center"`. `None` = 안 정함 = `cover`.
    /// 모르는 값은 `sanitize` 가 버린다(= 기본값 추종) — `tab_style` 과 같은 규칙이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<String>,
}

/// 공백만 남은 값은 "적지 않음"과 같다.
/// `[app] dynamic` 읽기 — 옛 불리언과 새 문자열을 **둘 다** 받는다 ([`AppTheme::dynamic`]).
///
/// `true` → `"full"`, `false` → 안 정함, 문자열 → 그대로(공백 정리는 `sanitize` 가 한다).
/// 둘 중 어느 모양도 아닌 값(숫자 등)은 다른 칸의 타입 오류와 똑같이 파일 전체를 못 읽게
/// 된다 — 이 칸만 너그럽게 삼키면 "잘못 적은 칸이 어떻게 되는가" 의 규칙이 이 칸에서만 갈린다.
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
