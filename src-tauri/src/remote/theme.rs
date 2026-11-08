//! **관문 쪽 색 — 메인 PC 앱이 지금 칠한 색 그대로**(2026-11-01 사용자 결정).
//!
//! 집 PC 주 창이 색을 칠할 때마다(`applySettings` 끝 — `src/lib/gate-theme.ts`) 원천 토큰의 **계산된 값**과 모드를
//! [`remote_gate_theme_set`](super::remote_gate_theme_set)으로 넘긴다. 여기는 그것을 **메모리에만** 두고(영속 없음 — 첫 창이
//! 뜨기 전에는 gate.css 의 기본 AYNX), 관문이 `/remote/theme.css` 로 내보낸다(gate.css 뒤 — `gate.rs` 의 `shell`).
//!
//! - 명령은 **집 PC 전용**(`deny.rs` `HOME_ONLY`) — 원격 창은 이 기기 밝기 사본을 칠할 수 있어 보내지 않는다(프런트도 건너뛴다).
//! - **CSS 주입 방어**: 이름은 [`TOKENS`] 허용 목록만, 값은 [`MAX_VALUE`] 글자 안의 허용 문자(`#` 영숫자 `( ) , . % -` 공백 `/`)만 —
//!   벗어난 칸은 버린다(`;` `{` `}` `<` `:` 따옴표 · `\` 가 없으니 선언을 끝내거나 규칙을 열거나 주소를 쓸 수 없다). 모드는 `dark|light` 둘만.
//! - 페어링 전 브라우저에도 나간다 — 색 값뿐이라 받아들인다. 월페이퍼 그림 · 글꼴은 싣지 않는다.

use std::collections::HashMap;
use std::sync::Mutex;

/// 관문이 받는 원천 토큰 — 앱 theme.css 와 같은 이름(gate.css 가 이것으로 나머지를 다시 짓는다). 프런트의 목록과 같다
/// (`src/lib/gate-theme.ts` 의 `GATE_THEME_TOKENS`).
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

/// 값 하나의 길이 상한(`color-mix(…)` 한 겹이 넉넉히 들어간다).
pub(crate) const MAX_VALUE: usize = 200;

/// 받아 둔 색 한 벌.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GateTheme {
    pub(crate) mode: &'static str,
    /// [`TOKENS`] 순서 — 허용된 칸만.
    pub(crate) tokens: Vec<(&'static str, String)>,
}

static THEME: Mutex<Option<GateTheme>> = Mutex::new(None);

/// 값 하나를 믿어도 되는가 — 다듬은 값 또는 `None`(그 칸을 버린다).
pub(crate) fn clean_value(v: &str) -> Option<&str> {
    let v = v.trim();
    if v.is_empty() || v.len() > MAX_VALUE {
        return None;
    }
    let ok = v
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '#' | '(' | ')' | ',' | '.' | '%' | '-' | ' ' | '/'));
    // `:` · 따옴표가 막혀 주소는 쓸 수 없지만, 자원을 부르는 함수 이름은 그래도 따로 거절한다(읽는 사람이 안심하게).
    let lower = v.to_ascii_lowercase();
    let fetches = ["url(", "image(", "image-set(", "src(", "element(", "cross-fade("].iter().any(|f| lower.contains(f));
    (ok && !fetches).then_some(v)
}

/// 받은 것 → 한 벌. 모드가 둘 밖이면 `None`(아무것도 바꾸지 않는다).
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

/// 한 벌 → `/remote/theme.css` 몸. 없으면 빈 몸(gate.css 기본값 그대로).
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

/// 들인다 — 바뀌었으면 `true`.
pub(crate) fn set(theme: GateTheme) -> bool {
    let mut slot = THEME.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref() == Some(&theme) {
        return false;
    }
    *slot = Some(theme);
    true
}

/// 지금 메인 PC 모드 — 받은 값이 없으면 `None`(관문 쪽은 기기 밝기를 따른다).
pub(crate) fn mode() -> Option<&'static str> {
    THEME.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|t| t.mode)
}

/// 지금 `/remote/theme.css` 몸.
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
