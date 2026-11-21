//! 백엔드가 만드는 **사용자에게 보이는 문구**의 언어 — 프런트 사전에 없는 Rust 글자(실패 문구 · 안내문 · 셸 표시 이름).
//!
//! 키 표(`t("sftp.not_found")`)는 쓰지 않는다 — 호출 자리의 짝이어야 grep 이 바로 가고 ko/en 이 한 `format!` 검사를 받는다.
//!
//! 시작값은 setup 이 명령 전에 `[app] language` 로 건다(없으면 [`Lang::Ko`]) — "OS 를 따른다"(`navigator.language`)를
//! 아는 쪽은 프런트이고, 부팅 첫 줄의 `set_language` 가 곧바로 바로잡는다.
//!
//! AI 가 읽는 글자는 여기 오지 않는다 — MCP 도구 설명 · `initialize` instructions · 도구 안내문은 영어 리터럴이다
//! (MCP 표면은 표시 언어를 타지 않는다 — 언어에 따라 같은 프롬프트가 다르게 동작하면 안 된다). 번역 대상은 화면에 나가는 글자뿐이다.

use std::sync::atomic::{AtomicU8, Ordering};

/// 프런트의 `Locale` 과 같은 두 값이다.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Ko,
    En,
}

static LANG: AtomicU8 = AtomicU8::new(Lang::Ko as u8);

fn load_global() -> Lang {
    if LANG.load(Ordering::Relaxed) == Lang::En as u8 {
        Lang::En
    } else {
        Lang::Ko
    }
}

fn store_global(l: Lang) {
    LANG.store(l as u8, Ordering::Relaxed);
}

#[cfg(not(test))]
pub fn lang() -> Lang {
    load_global()
}

#[cfg(not(test))]
pub fn set_lang(l: Lang) {
    store_global(l);
}

// ── 테스트에서는 **스레드 지역**이다 ─────────────────────────────────────────────
// 한국어 문구를 글자까지 단언하는 테스트가 여럿이라, 병렬 테스트에서 전역을 영어로 뒤집으면 그 단언들이 무작위로 깨진다.
#[cfg(test)]
thread_local! {
    static TEST_LANG: std::cell::Cell<Lang> = const { std::cell::Cell::new(Lang::Ko) };
}

#[cfg(test)]
pub fn lang() -> Lang {
    TEST_LANG.with(|c| c.get())
}

#[cfg(test)]
pub fn set_lang(l: Lang) {
    TEST_LANG.with(|c| c.set(l));
}

/// `"ko"` · `"en"` 만 안다.
pub fn parse(s: &str) -> Option<Lang> {
    match s.trim() {
        "ko" => Some(Lang::Ko),
        "en" => Some(Lang::En),
        _ => None,
    }
}

/// 프런트가 언어를 바꿀 때마다 부른다 (`setLocale`). 모르는 값은 프로그래밍 오류라 이 문구만은 번역하지 않는다.
///
/// 글자를 **한 번 만들어 OS 에 걸어 두는 곳**(트레이 메뉴·툴팁)은 `tr!` 을 다시 부를 계기가 없으므로 여기서 다시 걸게 한다.
#[tauri::command]
pub async fn set_language(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    match parse(&lang) {
        Some(l) => {
            set_lang(l);
            crate::tray::language_changed(&app);
            Ok(())
        }
        None => Err(format!("unknown language: {lang}")),
    }
}

/// 사용자에게 보이는 문구 하나 — 한국어와 영어를 **한자리에** 적는다.
///
/// ```ignore
/// tr!(ko: "설정을 저장하지 못했습니다", en: "Could not save settings")
/// tr!(ko: "{name} 이(가) 이미 있습니다", en: "{name} already exists", name = shown)
/// ```
macro_rules! tr {
    (ko: $ko:literal, en: $en:literal $(, $name:ident = $value:expr)* $(,)?) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::Ko => format!($ko $(, $name = $value)*),
            $crate::i18n::Lang::En => format!($en $(, $name = $value)*),
        }
    };
}

pub(crate) use tr;

#[cfg(test)]
mod tests {
    use super::*;

/// 테스트 빌드에서는 스레드 지역이 [`lang`] 자리를 대신하므로 전역 원자값은 여기서만 직접 본다.
    #[test]
    fn atomic_global_round_trip() {
        store_global(Lang::En);
        assert_eq!(load_global(), Lang::En);
        store_global(Lang::Ko);
        assert_eq!(load_global(), Lang::Ko);
    }

    #[test]
    fn parses_only_two_codes() {
        assert_eq!(parse("ko"), Some(Lang::Ko));
        assert_eq!(parse("en"), Some(Lang::En));
        assert_eq!(parse("  en  "), Some(Lang::En)); // 공백은 접는다
        assert_eq!(parse("EN"), None); // 대문자는 프런트가 보내지 않는다
        assert_eq!(parse("en-US"), None);
        assert_eq!(parse(""), None);
        assert_eq!(parse("fr"), None);
    }

    #[test]
    fn picks_the_branch_of_the_current_language() {
        set_lang(Lang::Ko);
        assert_eq!(tr!(ko: "저장했습니다", en: "Saved"), "저장했습니다");
        set_lang(Lang::En);
        assert_eq!(tr!(ko: "저장했습니다", en: "Saved"), "Saved");
        set_lang(Lang::Ko);
    }

    #[test]
    fn interpolates_named_arguments_in_both_branches() {
        let name = "web-01";
        set_lang(Lang::Ko);
        assert_eq!(
            tr!(ko: "{host} 에 붙지 못했습니다", en: "Could not connect to {host}", host = name),
            "web-01 에 붙지 못했습니다"
        );
        set_lang(Lang::En);
        assert_eq!(
            tr!(ko: "{host} 에 붙지 못했습니다", en: "Could not connect to {host}", host = name),
            "Could not connect to web-01"
        );
        assert_eq!(
            tr!(ko: "{a}/{b} · {a}", en: "{a}/{b} · {a}", a = 1, b = 2),
            "1/2 · 1"
        );
        set_lang(Lang::Ko);
    }

    #[test]
    fn captures_surrounding_bindings_without_an_argument_list() {
        let e = "권한 없음";
        set_lang(Lang::En);
        assert_eq!(
            tr!(ko: "지우지 못했습니다: {e}", en: "Could not delete: {e}"),
            "Could not delete: 권한 없음"
        );
        set_lang(Lang::Ko);
        assert_eq!(
            tr!(ko: "지우지 못했습니다: {e}", en: "Could not delete: {e}"),
            "지우지 못했습니다: 권한 없음"
        );
    }

/// 언어를 안 건드린 스레드는 한국어다 — 한국어 문구를 단언하는 다른 테스트들이 이 성질에 기댄다.
    #[test]
    fn a_fresh_thread_speaks_korean() {
        set_lang(Lang::En);
        let seen = std::thread::spawn(lang).join().expect("스레드");
        assert_eq!(seen, Lang::Ko);
        set_lang(Lang::Ko);
    }
}
