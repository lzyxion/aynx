//! 프런트가 갈래를 가르는 실패의 **이유 코드** — `[exists] …` 처럼 ASCII 접두사를 단다. 글자 조각으로 가르면 번역하는 순간 분기가 조용히 죽는다.
//!
//! - 코드 표는 프런트 `src/lib/error-reason.ts` 와 글자까지 같다 — 한쪽만 바꾸지 않는다.
//! - 문구가 감싸여 올라가므로(`sftp_browser::fail` · `move_failure` 가 앞에 말을 붙인다) 판정은 `startsWith` 가 아니라 "들어 있는가" 다.
//! - 세션 **열기** 실패는 여기 오지 않는다 — 구조화된 페이로드로 올라가 `session.ts` 의 `parseSessionError` 가 받는다.

use crate::i18n::tr;

pub const EXISTS: &str = "exists";
pub const NOT_EMPTY: &str = "not-empty";
pub const SESSION_GONE: &str = "session-gone";
pub const CANCELLED: &str = "cancelled";
pub const VAULT_LOCKED: &str = "vault-locked";
pub const VAULT_WRONG_MASTER: &str = "vault-wrong-master";
/// 오류가 아니라 권유다 — 볼트는 옵트인이라 "아직 안 만들었다" 가 정상 상태다.
pub const VAULT_ABSENT: &str = "vault-absent";
/// 저장하려는 파일이 편집을 시작한 뒤 디스크에서 바뀌었다 — 쓰지 않았다.
pub const CONFLICT: &str = "conflict";
/// 저장은 없어진 파일을 새로 만들지 않는다.
pub const MISSING: &str = "missing";
/// 첫 커밋을 만들 git 신원이 서지 않는다 — 앱이 대신 설정하지 않는다.
pub const GIT_IDENTITY: &str = "git-identity";
/// 다른 창이 세션을 가져갔거나 같은 스트림에 새 회차가 섰다. 프런트의 손잡이 호출은 오류를 삼키므로 화면 분기는 없다.
pub const STALE_LEASE: &str = "stale-lease";
pub const SESSION_ALIVE: &str = "session-alive";
pub const SESSION_BUSY: &str = "session-busy";
/// 다른 창이 그 세션에 붙어 있다(빼앗기 없이 붙으려 했다).
pub const SESSION_ATTACHED: &str = "session-attached";

/// 붙은 세션 서버가 이 기능의 판보다 옛것이다.
pub const SERVER_OUTDATED: &str = "server-outdated";
/// `chats.json` 이 그 창이 읽은 `rev` 뒤에 바뀌어 쓰지 않았다(주 창 · 원격 창 동시 편집).
pub const STALE_LIST: &str = "stale-list";

/// DB 가 비밀번호를 청했는데 실은 것이 없다(볼트에도 없다).
pub const DB_PASSWORD: &str = "db-password";
/// [`SESSION_GONE`] 의 덧말 — 같은 타일의 끊긴 연결이 빌린 비밀번호를 쥐고 있어 다시 붙을 수 있다. 값이 아니라 있다는 표지뿐이다.
pub const DB_CARRY: &str = "db-carry";
pub const DB_AUTH: &str = "db-auth";
/// [`DB_AUTH`] 의 덧말 — 거절된 값이 볼트에 담겨 있던 것이었다(SSH `stored_rejected` 와 같은 뜻).
pub const DB_STORED_REJECTED: &str = "db-stored-rejected";
pub const DB_DISCONNECTED: &str = "db-disconnected";
pub const DB_TX_STALE: &str = "db-tx-stale";
/// 자동 커밋을 끈 조회 길에서 엔진이 실행 중에 읽기 전용으로 거절했다 — 부작용이 두 번 나지 않게 서버는 다시 돌지 않았다.
pub const DB_NEEDS_WORK: &str = "db-needs-work";
/// 그 문장이 실행됐는지 · 반영됐는지 앱은 모른다(`EngineError::Unconfirmed`).
pub const DB_UNCONFIRMED: &str = "db-unconfirmed";

pub fn with_reason(reason: &str, message: String) -> String {
    format!("[{reason}] {message}")
}

/// 감싸인 문구도 알아본다.
pub fn has_reason(message: &str, reason: &str) -> bool {
    message.contains(&format!("[{reason}]"))
}

pub fn is_cancelled(message: &str) -> bool {
    has_reason(message, CANCELLED)
}

// ---------------------------------------------------------------------------
// 생성자
// ---------------------------------------------------------------------------

pub fn exists(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(ko: "{shown} 이(가) 이미 있습니다", en: "{shown} already exists"),
    )
}

pub fn exists_pick_another_name(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 이(가) 이미 있습니다 — 다른 이름을 지정하세요",
            en: "{shown} already exists — choose a different name",
        ),
    )
}

pub fn exists_choose_overwrite(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 이(가) 이미 있습니다 — 덮어쓸지 정하세요",
            en: "{shown} already exists — decide whether to overwrite",
        ),
    )
}

/// SFTP 의 rename 은 디렉터리를 합치지 못한다.
pub fn dir_exists_no_merge(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 디렉터리가 이미 있습니다 — 원격 이동은 디렉터리를 합치지 못합니다 (이름 바꾸기나 건너뛰기를 고르세요)",
            en: "The folder {shown} already exists — a remote move cannot merge folders (choose rename or skip)",
        ),
    )
}

pub fn not_empty(shown: &str) -> String {
    with_reason(
        NOT_EMPTY,
        tr!(
            ko: "{shown} 이(가) 비어 있지 않습니다 — 안의 항목까지 지우려면 재귀 삭제를 쓰세요",
            en: "{shown} is not empty — use recursive delete to remove what is inside",
        ),
    )
}

pub fn session_gone() -> String {
    with_reason(
        SESSION_GONE,
        tr!(ko: "세션을 찾을 수 없습니다", en: "Could not find the session"),
    )
}

pub fn session_gone_closed() -> String {
    with_reason(
        SESSION_GONE,
        tr!(
            ko: "세션을 찾을 수 없습니다 — 연결이 끊겼거나 이미 닫힌 세션입니다",
            en: "Could not find the session — it was disconnected or already closed",
        ),
    )
}

/// 본문만 만든다 — 감싸는 `sftp_browser::fail` 이 접두사를 바깥에 붙인다(사람이 읽는 줄이 `[…]` 로 시작하지 않게).
pub fn session_lost_text() -> String {
    tr!(ko: "세션이 끊겼습니다", en: "The session was lost")
}

pub fn cancelled() -> String {
    with_reason(
        CANCELLED,
        tr!(ko: "전송을 취소했습니다", en: "The transfer was cancelled"),
    )
}

pub fn vault_locked() -> String {
    with_reason(
        VAULT_LOCKED,
        tr!(
            ko: "금고가 잠겨 있습니다 — 마스터 비밀번호로 잠금을 해제하세요",
            en: "The vault is locked — unlock it with the master password",
        ),
    )
}

/// 왜 틀렸는지는 말하지 않는다 — AEAD 는 키 틀림과 파일 손상을 구분하지 않고, 구분하는 척하는 문구는 공격자에게 신탁이 된다.
pub fn vault_wrong_master() -> String {
    with_reason(
        VAULT_WRONG_MASTER,
        tr!(
            ko: "금고를 열지 못했습니다 — 마스터 비밀번호가 맞는지 확인하세요",
            en: "Could not open the vault — check that the master password is correct",
        ),
    )
}

pub fn vault_absent() -> String {
    with_reason(
        VAULT_ABSENT,
        tr!(
            ko: "금고가 아직 없습니다 — 먼저 금고를 만드세요",
            en: "There is no vault yet — create one first",
        ),
    )
}

pub fn conflict(shown: &str) -> String {
    with_reason(
        CONFLICT,
        tr!(
            ko: "{shown} 이(가) 편집을 시작한 뒤 디스크에서 바뀌었습니다 — 저장하지 않았습니다",
            en: "{shown} changed on disk after editing started — it was not saved",
        ),
    )
}

pub fn missing(shown: &str) -> String {
    with_reason(
        MISSING,
        tr!(
            ko: "{shown} 이(가) 없습니다 — 지워졌거나 옮겨졌습니다 (저장하지 않았습니다)",
            en: "{shown} does not exist — it was deleted or moved (it was not saved)",
        ),
    )
}

pub fn git_identity_missing() -> String {
    with_reason(
        GIT_IDENTITY,
        tr!(
            ko: "저장소는 만들었지만 첫 커밋을 만들지 못했습니다 — git 사용자 이름·이메일이 설정되어 있지 않습니다",
            en: "The repository was created but the first commit failed — the git user name and email are not set",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{set_lang, Lang};

    #[test]
    fn every_constructor_carries_its_reason_in_both_languages() {
        for lang in [Lang::Ko, Lang::En] {
            set_lang(lang);
            let cases: [(String, &str); 14] = [
                (exists("a.txt"), EXISTS),
                (exists_pick_another_name("a.txt"), EXISTS),
                (exists_choose_overwrite("a.txt"), EXISTS),
                (dir_exists_no_merge("/srv/x"), EXISTS),
                (not_empty("/srv/x"), NOT_EMPTY),
                (session_gone(), SESSION_GONE),
                (session_gone_closed(), SESSION_GONE),
                (cancelled(), CANCELLED),
                (vault_locked(), VAULT_LOCKED),
                (vault_wrong_master(), VAULT_WRONG_MASTER),
                (vault_absent(), VAULT_ABSENT),
                (conflict("/srv/a.conf"), CONFLICT),
                (missing("/srv/a.conf"), MISSING),
                (git_identity_missing(), GIT_IDENTITY),
            ];
            for (message, reason) in cases {
                assert!(
                    message.starts_with(&format!("[{reason}] ")),
                    "{lang:?}: {message}"
                );
                assert!(has_reason(&message, reason), "{lang:?}: {message}");
            }
        }
        set_lang(Lang::Ko);
    }

    #[test]
    fn the_body_is_translated_and_the_prefix_is_not() {
        set_lang(Lang::Ko);
        assert_eq!(exists("a.txt"), "[exists] a.txt 이(가) 이미 있습니다");
        set_lang(Lang::En);
        assert_eq!(exists("a.txt"), "[exists] a.txt already exists");
        set_lang(Lang::Ko);
    }

    #[test]
    fn a_wrapped_message_still_carries_the_reason() {
        let wrapped = format!("3개 이동 완료, 4번째에서 중단: {}", cancelled());
        assert!(is_cancelled(&wrapped), "{wrapped}");
        assert!(!is_cancelled("권한이 없습니다"));
        assert!(!has_reason(&exists("a.txt"), NOT_EMPTY));
        assert!(!has_reason(&not_empty("/x"), EXISTS));
    }

    #[test]
    fn the_lost_session_body_has_no_prefix_of_its_own() {
        let body = session_lost_text();
        assert!(!body.contains('['), "{body}");
        let wrapped = with_reason(SESSION_GONE, format!("/srv 목록을 읽지 못했습니다: {body}"));
        assert!(has_reason(&wrapped, SESSION_GONE), "{wrapped}");
    }
}
