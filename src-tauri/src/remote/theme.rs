//! **관문 쪽 색 — 메인 PC 앱이 지금 칠한 색 그대로.** 메모리에만 둔다(영속 없음).
//!
//! - 명령은 **메인 PC 전용**(`deny.rs` `HOME_ONLY`) — 원격 창은 이 기기 밝기 사본을 칠할 수 있어 보내지 않는다.
//! - **CSS 주입 방어**: 이름은 [`TOKENS`] 허용 목록만, 값은 허용 문자만 — `;` `{` `}` `<` `:` 따옴표 · `\` 가 없으니 선언을 끝내거나
//!   규칙을 열거나 주소를 쓸 수 없다. 모드는 `dark|light` 둘만.
//! - 페어링 전 브라우저에도 나간다 — 색 값뿐이라 받아들인 한계다. 월페이퍼 그림 · 글꼴은 싣지 않는다.

use std::collections::HashMap;
use std::sync::Mutex;

/// 앱 theme.css 와 같은 이름 — gate.css 가 이것으로 나머지를 다시 짓는다(프런트 목록과 같음 — 시험 `tokens_match_frontend_list`).
pub(crate) const TOKENS: &[&str] = &[
    "--bg-base",
    "--bg-panel-base",
    "--fg",
    "--fg-muted",
    "--border",
    "--accent",
    "--on-accent",
    "--m3-secondary-container",
    "--on-accent-soft",
    "--tertiary",
    "--ok",
    "--err",
    "--chrome-pct",
];

pub(crate) const MAX_VALUE: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GateTheme {
    pub(crate) mode: &'static str,
    pub(crate) tokens: Vec<(&'static str, String)>,
}

static THEME: Mutex<Option<GateTheme>> = Mutex::new(None);

pub(crate) fn clean_value(v: &str) -> Option<&str> {
    let v = v.trim();
    if v.is_empty() || v.len() > MAX_VALUE {
        return None;
    }
    let ok = v
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '#' | '(' | ')' | ',' | '.' | '%' | '-' | ' ' | '/'));
    // `:` · 따옴표가 막혀 주소는 쓸 수 없지만, 자원을 부르는 함수 이름은 그래도 따로 거절한다.
    let lower = v.to_ascii_lowercase();
    let fetches = ["url(", "image(", "image-set(", "src(", "element(", "cross-fade("].iter().any(|f| lower.contains(f));
    (ok && !fetches).then_some(v)
}

pub(crate) fn build(mode: &str, tokens: &HashMap<String, String>) -> Option<GateTheme> {
    let mode = match mode {
        "dark" => "dark",
        "light" => "light",
        _ => return None,
    };
    let tokens = TOKENS
        .iter()
        .filter_map(|&name| tokens.get(name).and_then(|v| clean_value(v)).map(|v| (name, v.to_string())))
        .collect();
    Some(GateTheme { mode, tokens })
}

pub(crate) fn css_of(theme: Option<&GateTheme>) -> String {
    let Some(t) = theme else {
        return String::new();
    };
    let mut s = format!(":root{{color-scheme:{};", t.mode);
    for (name, value) in &t.tokens {
        s.push_str(name);
        s.push(':');
        s.push_str(value);
        s.push(';');
    }
    s.push_str("}\n");
    s
}

/// 바뀌었으면 `true`.
pub(crate) fn set(theme: GateTheme) -> bool {
    let mut slot = THEME.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref() == Some(&theme) {
        return false;
    }
    *slot = Some(theme);
    true
}

pub(crate) fn mode() -> Option<&'static str> {
    THEME.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|t| t.mode)
}

pub(crate) fn css() -> String {
    css_of(THEME.lock().unwrap_or_else(|e| e.into_inner()).as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn only_listed_names_and_clean_values_pass() {
        let got = build(
            "light",
            &map(&[
                ("--bg-base", " #f9f9ff "),
                ("--accent", "color-mix(in srgb, #415f91 46%, rgb(255 255 255 / 0.22))"),
                ("--chrome-pct", "60%"),
                ("--evil", "#000"),
                ("--fg", "#fff;} body{display:none"),
                ("--fg-muted", "#fff}"),
                ("--border", "url(x)"),
                ("--tertiary", "<b>"),
                ("--ok", "IMAGE-SET(a)"),
                ("--err", "rgb(0 0 0) !important"),
                ("--on-accent", &"a".repeat(MAX_VALUE + 1)),
                ("--on-accent-soft", ""),
                ("--m3-secondary-container", "\"x\""),
                ("--bg-panel-base", "var(--x\\3a)"),
            ]),
        )
        .expect("모드 light");
        assert_eq!(got.mode, "light");
        let names: Vec<_> = got.tokens.iter().map(|(n, _)| *n).collect();
        assert_eq!(names, ["--bg-base", "--accent", "--chrome-pct"], "허용 목록 순서 · 나쁜 칸 버림");
        assert_eq!(got.tokens[0].1, "#f9f9ff", "앞뒤 공백 다듬기");
    }

    #[test]
    fn mode_is_dark_or_light_only() {
        assert!(build("auto", &HashMap::new()).is_none());
        assert!(build("dark;}", &HashMap::new()).is_none());
        assert_eq!(build("dark", &HashMap::new()).map(|t| t.mode), Some("dark"));
    }

    #[test]
    fn css_is_empty_without_theme_and_carries_mode() {
        assert_eq!(css_of(None), "");
        let t = build("light", &map(&[("--bg-base", "#f9f9ff"), ("--chrome-pct", "60%")])).unwrap();
        assert_eq!(css_of(Some(&t)), ":root{color-scheme:light;--bg-base:#f9f9ff;--chrome-pct:60%;}\n");
        let t = build("dark", &HashMap::new()).unwrap();
        assert_eq!(css_of(Some(&t)), ":root{color-scheme:dark;}\n");
    }

    #[test]
    fn tokens_match_frontend_list() {
        let src = include_str!("../../../src/lib/gate-theme.ts");
        let start = src.find("GATE_THEME_TOKENS = [").expect("프런트 목록");
        let end = start + src[start..].find(']').expect("목록 끝");
        let front: Vec<&str> = src[start..end].split('"').skip(1).step_by(2).collect();
        assert_eq!(front, TOKENS, "프런트 · 관문의 토큰 목록이 같아야 한다");
    }
}
