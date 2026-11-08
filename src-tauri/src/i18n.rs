//! 백엔드가 만드는 **사용자에게 보이는 문구**의 언어 (국제화 단계 ④).
//!
//! 프런트는 사전(`src/lib/i18n/`)을 쓰지만 Rust 가 만들어 올려 보내는 글자 — `Err(String)`
//! 로 올라가 토스트·배너가 되는 실패 문구, 이벤트에 실려 가는 안내문, 셸 표시 이름 —
//! 은 프런트 사전에 없다. 그 글자들이 앱 언어를 따라가게 하는 것이 이 모듈이다.
//!
//! ## 키 표가 아니라 **호출 자리의 짝**이다
//!
//! 번역을 `i18n::t("sftp.not_found")` 같은 키 표로 두지 않았다. 이유 둘:
//!
//! 1. **호출 자리가 그대로 읽힌다.** `grep "찾을 수 없습니다"` 가 문구를 만드는 코드로
//!    바로 간다. 키 표를 끼면 grep 이 표로 가고, 거기서 다시 쓰는 자리를 찾아야 한다.
//! 2. **ko/en 이 어긋날 수 없다.** 두 리터럴이 한 매크로 호출 안에 있으므로 컴파일러가
//!    **둘 다** `format!` 로 검사한다 — 한쪽에만 `{name}` 이 남거나 한쪽 칸이 비는 사고가
//!    타입 검사에서 걸린다. 표를 쓰면 그것을 지키는 일은 테스트의 몫이 된다.
//!
//! ## 시작값
//!
//! `lib.rs` 의 setup 이 **명령이 돌기 전에** 저장된 `[app] language` 를
//! ([`crate::settings::app_language`]) 읽어 건다. 값이 없거나 모르는 값이면 [`Lang::Ko`] 다 —
//! "OS 를 따른다"(`navigator.language`)를 아는 쪽은 프런트이고, 프런트는 부팅 첫 줄에서
//! `set_language` 를 불러 이 값을 곧바로 바로잡는다. 그 몇 ms 사이에 백엔드가 만드는
//! 사용자 문구는 없다(첫 명령이 그 뒤에 온다).
//!
//! ## AI 가 읽는 글자는 여기 오지 않는다
//!
//! MCP 도구 설명·`initialize` instructions·도구가 돌려주는 안내문은 **영어 리터럴**이다.
//! 그것을 읽는 것은 사람이 아니라 모델이고, 표시 언어를 바꿨다고 도구 설명이 바뀌면
//! 같은 프롬프트가 언어에 따라 다르게 동작한다. 주석·`eprintln!`·테스트 단언도 그대로
//! 한국어다 — 번역 대상은 **화면에 나가는 글자**뿐이다.

use std::sync::atomic::{AtomicU8, Ordering};

/// 앱 언어. 프런트의 `Locale` 과 같은 두 값이다.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Ko,
    En,
}

/// 지금 언어. 어느 스레드에서든 읽으므로 원자값 하나다 (블로킹 풀·MCP 서버 스레드 포함).
static LANG: AtomicU8 = AtomicU8::new(Lang::Ko as u8);

/// 전역 원자값 읽기 — 프로덕션의 [`lang`] 이 이것이다.
fn load_global() -> Lang {
    if LANG.load(Ordering::Relaxed) == Lang::En as u8 {
        Lang::En
    } else {
        Lang::Ko
    }
}

/// 전역 원자값 쓰기 — 프로덕션의 [`set_lang`] 이 이것이다.
fn store_global(l: Lang) {
    LANG.store(l as u8, Ordering::Relaxed);
}

/// 지금 언어를 읽는다. [`tr!`] 이 부르는 자리다.
#[cfg(not(test))]
pub fn lang() -> Lang {
    load_global()
}

/// 언어를 건다. setup 과 [`set_language`] 명령이 부른다.
#[cfg(not(test))]
pub fn set_lang(l: Lang) {
    store_global(l);
}

// ── 테스트에서는 **스레드 지역**이다 ─────────────────────────────────────────────
//
// `cargo test` 는 한 바이너리의 테스트를 스레드로 **병렬** 실행한다. 그런데 이 저장소에는
// 한국어 실패 문구를 글자까지 단언하는 테스트가 여럿 있다(`config_edit` 의 별칭 검사 등).
// 전역 원자값을 영어로 뒤집는 테스트가 하나라도 있으면 그 단언들이 **무작위로** 깨진다 —
// 고친 사람과 깨지는 것을 보는 사람이 다른, 가장 나쁜 종류의 실패다.
//
// 그래서 테스트 빌드에서만 값을 스레드 지역으로 옮긴다. 다른 스레드는 여전히 기본값
// (한국어)을 보므로 기존 단언은 그대로 서고, 언어를 바꾸는 테스트는 제 스레드 안에서만
// 바꾼다. 전역 원자값 자체는 [`atomic_global_round_trip`] 이 따로 본다.
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

/// `"ko"` · `"en"` 만 안다. 그 밖에는 `None` — 부르는 쪽이 "모르는 값" 을 어떻게 다룰지
/// 정한다(시작은 한국어로 떨어지고, 명령은 오류를 낸다).
pub fn parse(s: &str) -> Option<Lang> {
    match s.trim() {
        "ko" => Some(Lang::Ko),
        "en" => Some(Lang::En),
        _ => None,
    }
}

/// 프런트가 언어를 바꿀 때마다 부른다 (`setLocale`).
///
/// 모르는 값은 **프로그래밍 오류**다 — 후보를 아는 쪽이 프런트이고 select 는 둘만 준다.
/// 그래서 이 오류 문구만은 번역하지 않는다(사용자가 볼 일이 없고, 보면 영어가 낫다).
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
///
/// 두 리터럴 모두 `format!` 을 지나므로 자리표시자가 한쪽에만 있거나 이름이 틀리면
/// **컴파일이 멈춘다**. 인자를 안 적어도 `format!` 의 암묵 포획이 그대로 동작하므로
/// 바깥 변수 이름이 자리표시자와 같으면 (`{e}`) 인자 줄이 필요 없다.
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

    /// 전역 원자값의 왕복. 프로덕션의 [`lang`]·[`set_lang`] 이 쓰는 바로 그 두 함수다
    /// (테스트 빌드에서는 스레드 지역이 그 자리를 대신하므로 여기서만 직접 본다).
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
        // 같은 이름을 두 번 쓰는 것도, 인자가 둘인 것도 두 갈래 모두에서 선다.
        assert_eq!(
            tr!(ko: "{a}/{b} · {a}", en: "{a}/{b} · {a}", a = 1, b = 2),
            "1/2 · 1"
        );
        set_lang(Lang::Ko);
    }

    /// 인자 줄 없이 **바깥 변수를 그대로 포획**하는 꼴 — 실제 호출 자리의 대부분이 이것이다
    /// (`.map_err(|e| tr!(ko: "…: {e}", en: "…: {e}"))`).
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

    /// 언어를 안 건드린 스레드는 한국어다 — 한국어 문구를 단언하는 다른 테스트들이
    /// 이 성질에 기대고 있다(모듈 머리말 참고).
    #[test]
    fn a_fresh_thread_speaks_korean() {
        set_lang(Lang::En);
        let seen = std::thread::spawn(lang).join().expect("스레드");
        assert_eq!(seen, Lang::Ko);
        set_lang(Lang::Ko);
    }
}
