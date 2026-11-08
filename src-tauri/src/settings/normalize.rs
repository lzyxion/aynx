//! 설정 값 정리 — [`AppSettings::sanitize`](읽기 · 저장 · 원격 비교가 모두 지나는 한 곳)와 상한 상수 · 공통 정규화
//! (`trim_map` · `clean_id_list` · `fold_empty`). `settings.rs` 에서 그대로 옮겼다 — 시험이 보는 상수와 `sanitize` 만
//! `pub(super)`(예전 범위 = `settings` 와 그 아래).

use std::collections::BTreeMap;
use std::path::Path;

use super::AppSettings;

/// 글꼴 크기 허용 범위 — 설정 화면의 `<input type="number">` 와 같은 값.
/// 범위를 벗어난 값은 "적지 않음"으로 취급한다 (0 이나 999 가 들어오면 터미널이 못 쓰게 된다).
const MIN_FONT_SIZE: u16 = 8;
const MAX_FONT_SIZE: u16 = 32;

/// 트리거 개수 상한. 줄마다 **전 패턴을 다 돌리므로** 개수가 곧 스캔 비용이다.
/// 손으로 고친 파일에서 수백 개가 들어와도 대량 출력이 느려지지 않게 여기서 자른다.
pub(super) const MAX_TRIGGERS: usize = 50;

/// [`WallpaperPrefs::fit`] 에 쓸 수 있는 값. 모르는 값은 버려서 프런트 기본(`cover`)으로 떨어진다.
pub(super) const WALLPAPER_FITS: [&str; 4] = ["cover", "contain", "tile", "center"];

/// [`WallpaperPrefs::dim`] 상한(%). 하한은 0 이라 `u8` 이 이미 막는다.
pub(super) const MAX_DIM: u8 = 100;

/// [`WallpaperPrefs::blur`] 상한(px). 이보다 크면 가장자리 번짐을 가리는 확대(4%)로도
/// 다 못 감추고, 프런트 슬라이더의 최댓값과 같은 값이어야 한다.
pub(super) const MAX_BLUR: u8 = 20;

/// [`TermPrefs::opacity`] 하한(%). 0 을 열어 두지 않는 이유는 필드 주석에 있다 —
/// 프런트 슬라이더의 최솟값과 같은 값이어야 한다.
const MIN_TERM_OPACITY: u8 = 10;

/// [`TermPrefs::opacity`] 상한(%) = 불투명.
const MAX_TERM_OPACITY: u8 = 100;

/// [`AppTheme::idle_lock_min`] 하한(분). `0` 은 "끔"으로 따로 접으므로(=`None`) 켠 값의
/// 최솟값은 1분이다. 프런트 select 의 최소 옵션(1분)과 같은 값이어야 한다.
const MIN_IDLE_LOCK_MIN: u32 = 1;

/// [`AppTheme::idle_lock_min`] 상한(분) = 4시간. 손으로 적은 터무니없는 값이 사실상
/// "잠금 안 함"이 되지 않게 제정신 범위로 자른다.
pub(super) const MAX_IDLE_LOCK_MIN: u32 = 240;

/// [`AppTheme::ui_scale`] 하한(%). 설정 화면 select 의 최소 후보와 같은 값이어야 한다 —
/// 이보다 작으면 크롬 글자가 10px 아래로 내려가 읽히지 않는다.
const MIN_UI_SCALE: u16 = 80;

/// [`AppTheme::ui_scale`] 상한(%). 1100×720 창에서 150 % 면 CSS 폭이 730px 남짓이라
/// 독·상태바가 겨우 선다 — 그 위는 창 하나로 앱을 쓸 수 없다.
const MAX_UI_SCALE: u16 = 150;

/// [`TermPrefs::notify_after_secs`]·[`TermPrefs::mark_after_secs`]·[`AiPrefs::notify_focused_after_secs`] 상한(초) = 하루.
/// `0`(끔)은 그대로 두므로 **하한은 없다** — 여기서 자르는 것은 "사실상 끔" 이 되는
/// 터무니없는 큰 값뿐이다. 둘은 같은 모양의 "몇 초 이상" 설정이라 상한도 하나로 둔다.
pub(super) const MAX_AFTER_SECS: u32 = 86_400;

impl AppSettings {
    /// 읽고 쓰기 **양쪽**에서 통과시키는 정규화.
    ///
    /// - 문자열은 앞뒤 공백을 떼고, 비면 `None` (= "안 정했음") 으로 접는다.
    ///   그래야 `""` 를 `setProperty` 해서 토큰이 빈 값이 되는 사고가 없다.
    /// - 글꼴 크기가 범위 밖이면 버린다. 손으로 고친 파일이나 옛 버전이 쓴 값에서 올 수 있다.
    /// - 패턴이 빈 트리거는 버린다 (모든 줄에 매치하는 항목이 조용히 생기면 안 된다).
    ///   개수는 [`MAX_TRIGGERS`] 에서 자른다.
    pub(super) fn sanitize(&mut self) {
        fold_empty(&mut self.app.accent);
        fold_empty(&mut self.hosts.sort);
        fold_empty(&mut self.files.default_view);
        fold_empty(&mut self.projects.start_screen);
        fold_empty(&mut self.dock.layout);
        fold_empty(&mut self.plans.exec_sort);
        // 원격 관문 — 이름은 앞뒤 공백을 걷고 소문자로(DNS 이름은 대소문자를 가리지 않는다), 포트 0 은 "안 정함".
        if let Some(host) = self.remote.host.as_mut() {
            *host = host.trim().to_ascii_lowercase();
        }
        fold_empty(&mut self.remote.host);
        if self.remote.port == Some(0) {
            self.remote.port = None;
        }
        fold_empty(&mut self.app.bg);
        fold_empty(&mut self.app.bg_panel);
        fold_empty(&mut self.app.fg);
        fold_empty(&mut self.app.border);
        fold_empty(&mut self.app.err);
        fold_empty(&mut self.app.ok);
        fold_empty(&mut self.app.warn);
        // 월페이퍼 색 단계도 "보관만" 이다 — 셋(off/subtle/full)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.dynamic);
        // 투명도는 0~100 % 만 뜻이 있다 — 손으로 고친 파일의 이상한 값은 "안 정함"(=100) 으로
        // 접는다. 하한은 여기서 강제하지 않는다 (0 도 유효한 %다) — 슬라이더가 표현할 수 있는
        // 하한(`OPACITY_MIN`)은 프런트의 관심사다.
        if self.app.opacity.is_some_and(|p| p > 100) {
            self.app.opacity = None;
        }
        // 타일 배치 방식은 **문자열을 보관만** 한다 (`tab_style`·`theme` 과 같은 분담) —
        // 후보 목록을 아는 쪽은 프런트이고, 모르는 값이면 거기서 기본(spiral)으로 떨어진다.
        fold_empty(&mut self.app.tiling);
        // 앱 모드도 같은 "보관만" 분담이다 — 셋(dark/light/system)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.mode);
        // 화면 언어도 같은 "보관만" 분담이다 — 둘(ko/en)을 아는 쪽은 프런트이고, 모르는
        // 값이면 거기서 "안 정함"(= OS 따라가기)으로 떨어진다.
        fold_empty(&mut self.app.language);
        // 타일 헤더 표시 시점도 마찬가지다 — 셋(always/multi/never)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.tile_header);
        // 상태바 자리도 같은 "보관만" 분담이다 — 넷(bottom/top/left/right)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.status_bar);
        // 상태바 모양도 같은 "보관만" 분담이다 — 둘(flat/panel)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.status_bar_style);
        // 재질도 같은 "보관만" 분담이다 — 둘(glass/flat)을 아는 쪽은 프런트다.
        fold_empty(&mut self.app.material);
        // 앱 아이콘도 같은 "보관만" 분담이다 — 후보를 아는 쪽은 프런트와 `app_icon.rs` 의 표다.
        fold_empty(&mut self.app.app_icon);
        // 무입력 자동 잠금 — `0`(또는 없음)은 끔이라 `None` 으로 접고(색·bool 의 "안 정함"과
        // 같은 자리), 켠 값은 제정신 범위(`1..=240` 분)로 자른다. 손으로 적은 큰 값·0 을
        // 여기서 정리하면 프런트는 "0 = 끄기" 와 유효한 분만 보게 된다.
        match self.app.idle_lock_min {
            Some(0) => self.app.idle_lock_min = None,
            Some(m) => self.app.idle_lock_min = Some(m.clamp(MIN_IDLE_LOCK_MIN, MAX_IDLE_LOCK_MIN)),
            None => {}
        }
        // UI 크기 — 범위로 **자른다** (필드 주석). 앱 글꼴은 "보관만" 이라 빈 값만 접는다.
        if let Some(p) = &mut self.app.ui_scale {
            *p = (*p).clamp(MIN_UI_SCALE, MAX_UI_SCALE);
        }
        fold_empty(&mut self.app.ui_font_family);
        fold_empty(&mut self.terminal.theme);
        fold_empty(&mut self.terminal.font_family);
        // 커서 모양도 **문자열을 보관만** 한다 (`right_click`·`tab_style` 과 같은 분담) —
        // 후보 셋(block·underline·bar)을 아는 쪽은 프런트이고, 모르는 값이면 거기서 기본(block)으로 떨어진다.
        fold_empty(&mut self.terminal.cursor_style);
        fold_empty(&mut self.terminal.tab_style);
        // 우클릭 동작도 **문자열을 보관만** 한다 (`tab_style`·`theme` 과 같은 분담) —
        // 후보 둘(menu·paste)을 아는 쪽은 프런트이고, 모르는 값이면 거기서 기본(menu)으로 떨어진다.
        fold_empty(&mut self.terminal.right_click);
        // 벨도 같은 "보관만" 분담이다 — 셋(visual·visual+sound·off)을 아는 쪽은 프런트다.
        fold_empty(&mut self.terminal.bell);
        // 긴 명령 알림과 실행 시간 표식 — **`0` 은 접지 않는다**(끔이라는 뜻이다. 필드 주석
        // 참고). 자르는 것은 위쪽뿐이라 `clamp` 가 아니라 `min` 이다.
        if let Some(s) = &mut self.terminal.notify_after_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
        if let Some(s) = &mut self.terminal.mark_after_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
        if self
            .terminal
            .font_size
            .is_some_and(|s| !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&s))
        {
            self.terminal.font_size = None;
        }
        // 터미널 불투명도는 **자른다** (월페이퍼 슬라이더와 같은 규칙, 글꼴 크기와는 다르다):
        // 손으로 적은 0 을 "안 정함(=100, 불투명)" 으로 되돌리면 원했던 것과 정반대가 되므로
        // "너무 투명" 은 "가장 투명(10)" 으로 읽는다.
        if let Some(o) = &mut self.terminal.opacity {
            *o = (*o).clamp(MIN_TERM_OPACITY, MAX_TERM_OPACITY);
        }
        // 동적 팔레트 — 키·값 모두 공백을 떼고, 어느 쪽이든 비면 버린다 (`keybindings` 와 같은 규칙).
        // 색 문법도 키 목록도 검사하지 않는다: 아는 쪽은 프런트다.
        self.terminal.dynamic = trim_map(std::mem::take(&mut self.terminal.dynamic));

        // 셸 id 는 문법을 검사하지 않는다 — 공백만 떼고 그대로 보관한다 (프리셋 키와 같다).
        fold_empty(&mut self.shell.default);

        // AI 타일 시작 폴더도 같은 "보관만" 분담이다 — 존재 여부는 셸을 세우는 자리에서
        // 본다 (`crate::pty::spawn_cwd`, 없으면 홈). 여기서 지우면 잠깐 안 붙은 드라이브의
        // 경로가 영영 사라진다.
        fold_empty(&mut self.ai.start_dir);
        // AI 아이콘 모양 · CLI 별 아바타도 같은 "보관만" 분담이다 — 후보(logo/avatar · 아바타 id)를 아는 쪽은 프런트다.
        // 옛 칸 `loading_art = "character"`(10-24 로딩 덮개 그림)는 `icon_style = "avatar"` 로 옮긴다 — 새 칸이 비었을 때만.
        // 옛 칸은 어느 쪽이든 비운다(다시 쓰지 않는다 — 필드 주석). 프런트 `normalizeSettings` 도 같은 이사를 한다.
        fold_empty(&mut self.ai.icon_style);
        if let Some(old) = self.ai.loading_art.take() {
            if self.ai.icon_style.is_none() && old.trim() == "character" {
                self.ai.icon_style = Some("avatar".to_owned());
            }
        }
        fold_empty(&mut self.ai.avatar_claude);
        fold_empty(&mut self.ai.avatar_codex);
        // 보고 있는 타일의 턴 알림 — `notify_after_secs` 와 같은 규칙(`0` = 끔을 살리고 위만 자른다).
        if let Some(s) = &mut self.ai.notify_focused_after_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
        // 추가 인자 — 공백만 떼고, 빈 값은 버린다(= 없음). 문법은 띄우는 자리(`crate::agent_args`)가 본다.
        self.ai.args = trim_map(std::mem::take(&mut self.ai.args));
        crate::agent_mcp::clean_servers(&mut self.ai.mcp_servers);
        if self.ai.mcp_sessions_enabled == Some(true) {
            self.ai.mcp_sessions_enabled = None;
        }
        if self.ai.mcp_sessions_agents.as_ref().is_some_and(|agents| {
            agents.len() == 2 && agents.iter().any(|id| id == "claude")
                && agents.iter().any(|id| id == "codex")
        }) {
            self.ai.mcp_sessions_agents = None;
        }
        // 끈 에이전트 — 공백·빈 값·중복만 걸러 낸다(순서 보존). 모르는 id 도 남긴다(필드 주석).
        clean_id_list(&mut self.ai.disabled_agents);
        // 머리줄 칩 순서 · 끈 칩 — 같은 걸러 내기(필드 주석).
        clean_id_list(&mut self.app.header_chip_order);
        clean_id_list(&mut self.app.header_chips_hidden);

        // 월페이퍼 — 이름은 **한 조각**이어야 하고, 두 슬라이더는 범위로 자른다.
        //
        // 이름을 조각으로 강제하는 것이 여기서 유일하게 "버리는" 검사다: 손으로 고친
        // 파일에 `file = "../../../어딘가/비밀.png"` 이 들어오면 그 경로가 웹뷰로 나가는
        // URL 이 된다. `file_name()` 이 자기 자신과 같은 값(= 구분자도 `..` 도 없는 이름)만
        // 통과시키면 조립 결과는 언제나 앱 폴더 안의 한 파일이다.
        // (asset 프로토콜 스코프도 같은 폴더로 좁혀져 있어 방어가 두 겹이다.)
        fold_empty(&mut self.wallpaper.file);
        if let Some(name) = &self.wallpaper.file {
            if Path::new(name).file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
                self.wallpaper.file = None;
            }
        }
        // 범위 밖은 **버리지 않고 자른다** — 글꼴 크기와 다른 점이다. 저 값은 못 쓰는 값이
        // 되지만(0px 터미널), 이쪽은 "너무 어둡게" 를 "가장 어둡게" 로 읽는 것이 자연스럽다.
        if let Some(d) = &mut self.wallpaper.dim {
            *d = (*d).min(MAX_DIM);
        }
        if let Some(b) = &mut self.wallpaper.blur {
            *b = (*b).min(MAX_BLUR);
        }
        fold_empty(&mut self.wallpaper.fit);
        if self
            .wallpaper
            .fit
            .as_deref()
            .is_some_and(|f| !WALLPAPER_FITS.contains(&f))
        {
            self.wallpaper.fit = None;
        }

        for t in &mut self.triggers {
            let trimmed = t.pattern.trim();
            if trimmed.len() != t.pattern.len() {
                t.pattern = trimmed.to_string();
            }
            fold_empty(&mut t.fg);
            fold_empty(&mut t.bg);
            // 색과 같은 규칙 — 빈 칸은 "안 정함"이다. 프런트가 편집 중에만 쓰는 `""`
            // (= 종류만 켜고 아직 안 적음) 가 파일까지 흘러들어 오면 여기서 접힌다.
            fold_empty(&mut t.url);
            fold_empty(&mut t.tooltip);
        }
        self.triggers.retain(|t| !t.pattern.is_empty());
        self.triggers.truncate(MAX_TRIGGERS);

        // 키보드 오버라이드 — 키·값 모두 공백을 떼고, 어느 쪽이든 비면 버린다.
        // 조합 문법이나 액션 id 는 검사하지 않는다 (프런트가 판단한다).
        self.keybindings = trim_map(std::mem::take(&mut self.keybindings));

        // 자동 승인 정책 — 상한을 제정신 범위로 자르고 패턴을 정리한다(단계 10b).
        self.automation.sanitize();

        // 메신저 알림 — `when` 은 보관만(후보를 아는 쪽은 프런트), 숫자 둘은 `0` 을 살리고 위만 자른다.
        fold_empty(&mut self.messenger.when);
        if let Some(s) = &mut self.messenger.command_min_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
        if let Some(m) = &mut self.messenger.away_after_min {
            *m = (*m).min(MAX_IDLE_LOCK_MIN);
        }
    }
}

/// 문자열 맵의 키·값에서 공백을 떼고, **어느 한쪽이라도 비면 그 항목을 버린다**.
///
/// `[keybindings]` 와 `[terminal.dynamic]` 이 공유하는 정리다 — 둘 다 백엔드가 내용을
/// 해석하지 않고 **보관만** 하는 맵이라, 여기서 할 수 있는 검사가 이것뿐이다.
fn trim_map(map: BTreeMap<String, String>) -> BTreeMap<String, String> {
    map.into_iter()
        .filter_map(|(k, v)| {
            let (k, v) = (k.trim(), v.trim());
            (!k.is_empty() && !v.is_empty()).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// id 목록 걸러 내기 — 공백을 떼고 빈 값 · 중복(처음 것만)을 버린다. 순서는 지키고 모르는 id 도 남긴다(보관만).
fn clean_id_list(list: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    *list = std::mem::take(list)
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty() && seen.insert(a.clone()))
        .collect();
}

fn fold_empty(slot: &mut Option<String>) {
    if let Some(v) = slot {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            *slot = None;
        } else if trimmed.len() != v.len() {
            *v = trimmed.to_string();
        }
    }
}
