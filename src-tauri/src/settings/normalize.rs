//! 설정 값 정리 — [`AppSettings::sanitize`](읽기 · 저장 · 원격 비교가 모두 지나는 한 곳)와 상한 상수.
//! 상수 대부분은 프런트 `settings/model/options.ts` · 설정 화면의 범위와 같은 값이어야 한다.

use std::collections::BTreeMap;
use std::path::Path;

use super::AppSettings;

/// 범위 밖은 "적지 않음" 으로 접는다(0 · 999 면 터미널을 못 쓴다).
const MIN_FONT_SIZE: u16 = 8;
const MAX_FONT_SIZE: u16 = 32;

/// 줄마다 전 패턴을 돌리므로 개수가 곧 스캔 비용이다.
pub(super) const MAX_TRIGGERS: usize = 50;

pub(super) const WALLPAPER_FITS: [&str; 4] = ["cover", "contain", "tile", "center"];

pub(super) const MAX_DIM: u8 = 100;

/// 이보다 크면 가장자리 번짐을 가리는 확대(4%)로도 다 못 감춘다.
pub(super) const MAX_BLUR: u8 = 20;

const MIN_TERM_OPACITY: u8 = 10;

const MAX_TERM_OPACITY: u8 = 100;

/// `0` 은 끔으로 따로 접으므로 켠 값의 최솟값은 1분이다.
const MIN_IDLE_LOCK_MIN: u32 = 1;

pub(super) const MAX_IDLE_LOCK_MIN: u32 = 240;

/// 이보다 작으면 크롬 글자가 10px 아래로 내려가 읽히지 않는다.
const MIN_UI_SCALE: u16 = 80;

/// 1100×720 창에서 150 % 면 독 · 상태바가 겨우 선다.
const MAX_UI_SCALE: u16 = 150;

/// "몇 초 이상" 설정들의 상한 = 하루. `0`(끔)은 그대로 두므로 하한은 없다.
pub(super) const MAX_AFTER_SECS: u32 = 86_400;

impl AppSettings {
    /// 읽고 쓰기 양쪽에서 통과시킨다. 빈 문자열은 `None` 으로 접는다 — `""` 를 `setProperty` 해 토큰이 비는 사고가 없게.
    pub(super) fn sanitize(&mut self) {
        fold_empty(&mut self.app.accent);
        fold_empty(&mut self.hosts.sort);
        fold_empty(&mut self.files.default_view);
        fold_empty(&mut self.projects.start_screen);
        fold_empty(&mut self.dock.layout);
        fold_empty(&mut self.plans.exec_sort);
        // DNS 이름은 대소문자를 가리지 않는다. 포트 0 은 "안 정함".
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
        fold_empty(&mut self.app.dynamic);
        if self.app.opacity.is_some_and(|p| p > 100) {
            self.app.opacity = None;
        }
        fold_empty(&mut self.app.tiling);
        fold_empty(&mut self.app.mode);
        fold_empty(&mut self.app.language);
        fold_empty(&mut self.app.tile_header);
        fold_empty(&mut self.app.status_bar);
        fold_empty(&mut self.app.status_bar_style);
        fold_empty(&mut self.app.material);
        fold_empty(&mut self.app.app_icon);
        match self.app.idle_lock_min {
            Some(0) => self.app.idle_lock_min = None,
            Some(m) => self.app.idle_lock_min = Some(m.clamp(MIN_IDLE_LOCK_MIN, MAX_IDLE_LOCK_MIN)),
            None => {}
        }
        if let Some(p) = &mut self.app.ui_scale {
            *p = (*p).clamp(MIN_UI_SCALE, MAX_UI_SCALE);
        }
        fold_empty(&mut self.app.ui_font_family);
        fold_empty(&mut self.terminal.theme);
        fold_empty(&mut self.terminal.font_family);
        fold_empty(&mut self.terminal.cursor_style);
        fold_empty(&mut self.terminal.tab_style);
        fold_empty(&mut self.terminal.right_click);
        fold_empty(&mut self.terminal.bell);
        // `0` 은 끔이라 접지 않는다 — 위만 자른다.
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
        // 버리지 않고 자른다 — 손으로 적은 0 을 "안 정함(=불투명)" 으로 되돌리면 뜻과 정반대다.
        if let Some(o) = &mut self.terminal.opacity {
            *o = (*o).clamp(MIN_TERM_OPACITY, MAX_TERM_OPACITY);
        }
        self.terminal.dynamic = trim_map(std::mem::take(&mut self.terminal.dynamic));

        fold_empty(&mut self.shell.default);

        // 존재 여부는 여기서 보지 않는다 — 지우면 잠깐 안 붙은 드라이브의 경로가 영영 사라진다.
        fold_empty(&mut self.ai.start_dir);
        // 옛 칸 `loading_art = "character"` 는 새 칸이 비었을 때만 `icon_style = "avatar"` 로 옮기고, 옛 칸은 늘 비운다.
        // 프런트 `normalizeSettings` 도 같은 이사를 한다 — 지우면 옛 설정이 깨진다.
        fold_empty(&mut self.ai.icon_style);
        if let Some(old) = self.ai.loading_art.take() {
            if self.ai.icon_style.is_none() && old.trim() == "character" {
                self.ai.icon_style = Some("avatar".to_owned());
            }
        }
        fold_empty(&mut self.ai.avatar_claude);
        fold_empty(&mut self.ai.avatar_codex);
        if let Some(s) = &mut self.ai.notify_focused_after_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
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
        clean_id_list(&mut self.ai.disabled_agents);
        clean_id_list(&mut self.app.header_chip_order);
        clean_id_list(&mut self.app.header_chips_hidden);

        // 이름은 한 조각이어야 한다 — `../../비밀.png` 가 웹뷰로 나가는 URL 이 되지 않게(asset 스코프와 두 겹 방어).
        fold_empty(&mut self.wallpaper.file);
        if let Some(name) = &self.wallpaper.file {
            if Path::new(name).file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
                self.wallpaper.file = None;
            }
        }
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
            fold_empty(&mut t.url);
            fold_empty(&mut t.tooltip);
        }
        // 패턴이 빈 트리거는 버린다 — 모든 줄에 매치하는 항목이 조용히 생기면 안 된다.
        self.triggers.retain(|t| !t.pattern.is_empty());
        self.triggers.truncate(MAX_TRIGGERS);

        self.keybindings = trim_map(std::mem::take(&mut self.keybindings));

        self.automation.sanitize();

        fold_empty(&mut self.messenger.when);
        if let Some(s) = &mut self.messenger.command_min_secs {
            *s = (*s).min(MAX_AFTER_SECS);
        }
        if let Some(m) = &mut self.messenger.away_after_min {
            *m = (*m).min(MAX_IDLE_LOCK_MIN);
        }
    }
}

/// 키 · 값 어느 한쪽이라도 비면 그 항목을 버린다.
fn trim_map(map: BTreeMap<String, String>) -> BTreeMap<String, String> {
    map.into_iter()
        .filter_map(|(k, v)| {
            let (k, v) = (k.trim(), v.trim());
            (!k.is_empty() && !v.is_empty()).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// 순서는 지키고 모르는 id 도 남긴다.
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
