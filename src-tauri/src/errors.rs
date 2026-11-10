//! 프런트가 **갈래를 가르려고 보는** 실패 넷 — 글자가 아니라 **이유 코드**로 가른다.
//!
//! 백엔드 명령은 전부 `Result<_, String>` 이고(호출 자리가 많아 모양을 바꾸지 않는다),
//! 그중 네 부류는 프런트가 화면을 다르게 그린다: 같은 이름이 이미 있으면 [덮어쓰기] 를
//! 권하고, 디렉터리가 비어 있지 않으면 재귀 삭제를 묻고, 세션이 사라졌으면 빨간 오류
//! 대신 "연결 대기" 배너를 세우고, 사용자가 누른 취소는 실패로 그리지 않는다.
//!
//! 단계 ④ 전까지 그 판정은 **한국어 조각**(`이미 있습니다` …)을 `includes()` 로 맞춰 보는
//! 것이었다. 그래서 그 넷만 번역에서 빠져 있었다 — 영어로 옮기는 순간 분기가 조용히
//! 죽기 때문이다(화면에는 아무 흔적도 남지 않는다). 이 모듈이 그 매듭을 푼다:
//!
//! ```text
//! [exists] note.txt 이(가) 이미 있습니다 — 다른 이름을 지정하세요
//! [exists] note.txt already exists — choose a different name
//! └──┬───┘ └────────────────────────┬──────────────────────────┘
//!  기계가 읽는다 (언어를 안 탄다)      사람이 읽는다 (`tr!` 로 번역된다)
//! ```
//!
//! 접두사는 **ASCII 고정**이라 언어를 타지 않고, 본문은 여느 문구와 같이 [`tr!`] 을 지난다.
//! 프런트는 `src/lib/error-reason.ts` 의 같은 코드 표를 보고 갈래를 가르며, **화면에 찍기
//! 전에 `stripReason` 으로 접두사를 떼므로** 사용자는 대괄호를 보지 못한다.
//!
//! ## 왜 `startsWith` 가 아니라 "들어 있는가" 인가
//!
//! 이 문구들은 감싸여 올라가기도 한다 — `sftp_browser::fail` 은 `"{무엇}: {까닭}"` 으로,
//! `move_failure` 는 `"2개 이동 완료, 3번째에서 중단: {까닭}"` 으로 앞에 말을 붙인다.
//! 그래서 접두사는 **문자열 어딘가에 있으면 그 갈래**이고, 프런트의 판정도 같다
//! (단계 ④ 이전의 `includes()` 와 정확히 같은 성질이라 화면 동작이 바뀌지 않는다).
//!
//! ## 여기 없는 것
//!
//! 세션 **열기** 실패는 이 표에 오지 않는다 — 그쪽은 애초에 구조화된 페이로드
//! (`{kind, message, fingerprint…}`)로 올라가고 `session.ts` 의 `parseSessionError` 가
//! 받는다. 이 모듈은 그 길이 없는 `Result<_, String>` 명령들의 몫이다.

use crate::i18n::tr;

/// 같은 이름이 이미 있다 — 프런트는 [덮어쓰기] 재시도를 권한다.
pub const EXISTS: &str = "exists";
/// 디렉터리가 비어 있지 않다 — 프런트는 재귀 삭제를 한 번 더 묻는다.
pub const NOT_EMPTY: &str = "not-empty";
/// 세션이 없거나 끊겼다 — 프런트는 오류 대신 "연결 대기" 배너를 세운다.
pub const SESSION_GONE: &str = "session-gone";
/// 사용자가 누른 취소 — 프런트는 실패가 아니라 "취소됨" 으로 그린다.
pub const CANCELLED: &str = "cancelled";
/// 자격증명 금고가 잠겨 있다 — 프런트는 오류 대신 **잠금 해제 모달**을 연다
/// ([`crate::vault`]). 사용자가 마스터를 넣고 나면 하려던 일을 다시 시도한다.
pub const VAULT_LOCKED: &str = "vault-locked";
/// 마스터 비밀번호가 틀렸다 — 프런트는 모달을 **닫지 않고** 그 칸에 빨간 줄만 세운다.
pub const VAULT_WRONG_MASTER: &str = "vault-wrong-master";
/// 금고 파일이 아직 없다 — 프런트는 "금고 만들기" 를 권한다 (오류가 아니라 **권유**다:
/// 금고는 옵트인이라 "아직 안 만들었다" 가 정상 상태다).
pub const VAULT_ABSENT: &str = "vault-absent";
/// 저장하려는 파일이 **편집을 시작한 뒤 디스크에서 바뀌었다** — 프런트는 쓰지 않은 채
/// [다시 불러오기] · [덮어쓰기] 띠를 세운다 (문서 편집 E1, docs/log/2026-09-27-doc-edit.md).
pub const CONFLICT: &str = "conflict";
/// 저장하려는 파일이 **없다**(지워졌거나 옮겨졌다) — 저장은 파일을 새로 만들지 않는다.
/// 프런트는 글을 그대로 두고 "저장 못 함" 띠를 세운다 (`[conflict]` 와 따로 두는 이유는 같은 기록).
pub const MISSING: &str = "missing";
/// 첫 커밋을 만들 **git 신원**(`user.name`·`user.email`)이 서지 않는다 — 프런트는 git 의 한 줄 대신 "먼저 설정하세요"
/// + 복사할 `git config --global …` 두 줄을 그린다 (docs/log/2026-09-28-project-create.md). 앱이 대신 설정하지 않는다.
pub const GIT_IDENTITY: &str = "git-identity";
/// 세션 손잡이의 임대가 낡았다 — 다른 창이 세션을 가져갔거나 같은 스트림에 새 회차가 섰다
/// (`crate::session_core`). 프런트의 손잡이 호출은 오류를 삼키므로 화면 분기는 없고 로그·시험이 본다.
pub const STALE_LEASE: &str = "stale-lease";
/// 같은 스트림의 세션이 아직 살아 있다 — 프런트는 새로 열지 않고 **붙는다**(`attach_session`).
pub const SESSION_ALIVE: &str = "session-alive";
/// 같은 스트림을 다른 열기가 여는 중이다 — 프런트는 잠시 뒤 다시 본다.
pub const SESSION_BUSY: &str = "session-busy";
/// 다른 창이 그 세션에 붙어 있다(빼앗기 없이 붙으려 했다).
pub const SESSION_ATTACHED: &str = "session-attached";

/// 붙은 세션 서버가 이 기능의 판보다 옛것이다 — 프런트는 [세션 서버 다시 시작] 을 권한다(쿼리 타일 — 판 8 의 DB op).
/// 프런트 `error-reason.ts` 의 표에는 쿼리 타일 화면(6단계)이 넣는다.
pub const SERVER_OUTDATED: &str = "server-outdated";
/// 사이드 채팅 목록(`chats.json`)이 그 창이 읽은 판(`rev`) 뒤에 바뀌어 쓰지 않았다(2026-11-01 — 주 창 · 원격 창 동시 편집). 프런트
/// `app/side-chats` 가 다시 읽고 제 바뀜을 다시 얹어 저장한다.
pub const STALE_LIST: &str = "stale-list";

/// DB 가 비밀번호를 청했는데 실은 것이 없다(볼트에도 없다) — 쿼리 타일이 **DB 접속 모달**을 띄운다(7단계).
pub const DB_PASSWORD: &str = "db-password";
/// [`SESSION_GONE`] 의 덧말(쿼리 타일의 붙기만 — `db::table::reattach_only`) — 같은 타일의 끊긴 연결이 **빌린 비밀번호**를 쥐고 있어
/// 새 열기가 그 값으로 다시 붙을 수 있다(`db::borrowed` 의 `carry`). 쿼리 타일은 볼트 잠금 해제를 먼저 묻지 않고 한 번 열어 본다
/// (`query/open-flow` — 실패하면 평소 관문). 값이 아니라 있다는 표지뿐이다.
pub const DB_CARRY: &str = "db-carry";
/// DB 가 비밀번호를 거절했다(PG 28P01) — 쿼리 타일이 모달로 다시 묻는다.
pub const DB_AUTH: &str = "db-auth";
/// [`DB_AUTH`] 의 덧말 — 거절된 값이 **볼트에 담겨 있던 것**이었다(모달이 저장 체크를 미리 켠다 — SSH `stored_rejected` 와 같은 뜻).
pub const DB_STORED_REJECTED: &str = "db-stored-rejected";
/// 열려 있던 DB 연결이 끊겼다(전송로 사망 · 서버가 끊음) — 쿼리 타일이 "연결이 끊겼습니다 · [다시 연결]" 띠를 세운다.
pub const DB_DISCONNECTED: &str = "db-disconnected";
/// 트랜잭션 작업 요청이 낡았다(이미 끝났거나 다른 작업 — 재부착 전의 [커밋] 등) — 쿼리 타일이 작업 상태를 다시 읽는다(1단계).
pub const DB_TX_STALE: &str = "db-tx-stale";
/// 자동 커밋을 끈 타일의 조회 길에서 PG · MySQL 엔진이 **실행 중에** 읽기 전용으로 거절했다(함수 · CTE 안의 쓰기) — 서버는 다시 돌지 않았다
/// (부작용이 두 번 나지 않게 · Codex 검토 반영 1). 쿼리 타일이 [트랜잭션 작업 시작] 뒤 다시 실행하라고 안내한다.
pub const DB_NEEDS_WORK: &str = "db-needs-work";
/// 실행 결과 미확인(`EngineError::Unconfirmed` — 응답 대기를 멈추고 연결을 버렸다 · 자동 커밋 단문의 `COMMIT` 응답 유실): 그 문장이
/// 실행됐는지 · 반영됐는지 앱은 모른다(Codex 검토 반영 2 — 판 15). 쿼리 타일이 '결과 불명' 틀로 눈에 띄게 보인다(다시 연결해 데이터 확인).
pub const DB_UNCONFIRMED: &str = "db-unconfirmed";

/// 이유 코드를 앞에 단다 — `"[exists] …"`.
pub fn with_reason(reason: &str, message: String) -> String {
    format!("[{reason}] {message}")
}

/// 이 실패가 그 갈래인가. 감싸인 문구도 알아본다 (모듈 머리말의 "왜 `startsWith` 가 아닌가").
pub fn has_reason(message: &str, reason: &str) -> bool {
    message.contains(&format!("[{reason}]"))
}

/// 취소로 멈춘 실패인가 — 전송 경로가 "이건 오류가 아니다" 를 가리는 자리.
pub fn is_cancelled(message: &str) -> bool {
    has_reason(message, CANCELLED)
}

// ---------------------------------------------------------------------------
// 생성자 — 문구는 `tr!`, 접두사는 ASCII
// ---------------------------------------------------------------------------

/// `{shown} 이(가) 이미 있습니다`
pub fn exists(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(ko: "{shown} 이(가) 이미 있습니다", en: "{shown} already exists"),
    )
}

/// 이름을 손으로 적는 자리(이름 바꾸기·업로드)에서 — 다른 이름을 권한다.
pub fn exists_pick_another_name(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 이(가) 이미 있습니다 — 다른 이름을 지정하세요",
            en: "{shown} already exists — choose a different name",
        ),
    )
}

/// 충돌 정책이 `Fail` 일 때 — 덮어쓸지 정하라고 되돌린다.
pub fn exists_choose_overwrite(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 이(가) 이미 있습니다 — 덮어쓸지 정하세요",
            en: "{shown} already exists — decide whether to overwrite",
        ),
    )
}

/// 원격 이동만의 막다른 골목 — SFTP 의 rename 은 디렉터리를 합치지 못한다.
pub fn dir_exists_no_merge(shown: &str) -> String {
    with_reason(
        EXISTS,
        tr!(
            ko: "{shown} 디렉터리가 이미 있습니다 — 원격 이동은 디렉터리를 합치지 못합니다 (이름 바꾸기나 건너뛰기를 고르세요)",
            en: "The folder {shown} already exists — a remote move cannot merge folders (choose rename or skip)",
        ),
    )
}

/// `{shown} 이(가) 비어 있지 않습니다 — …`
pub fn not_empty(shown: &str) -> String {
    with_reason(
        NOT_EMPTY,
        tr!(
            ko: "{shown} 이(가) 비어 있지 않습니다 — 안의 항목까지 지우려면 재귀 삭제를 쓰세요",
            en: "{shown} is not empty — use recursive delete to remove what is inside",
        ),
    )
}

/// 세션 표에 그 번호가 없다 (짧은 판 — 뒤에 말을 더 붙이지 않는 자리).
pub fn session_gone() -> String {
    with_reason(
        SESSION_GONE,
        tr!(ko: "세션을 찾을 수 없습니다", en: "Could not find the session"),
    )
}

/// 세션 표에 그 번호가 없다 — 왜 없는지까지 말해 주는 판.
pub fn session_gone_closed() -> String {
    with_reason(
        SESSION_GONE,
        tr!(
            ko: "세션을 찾을 수 없습니다 — 연결이 끊겼거나 이미 닫힌 세션입니다",
            en: "Could not find the session — it was disconnected or already closed",
        ),
    )
}

/// 서버가 `NoConnection`/`ConnectionLost` 를 줬다 — **본문만** 만든다.
///
/// 이 문구는 `sftp_browser::fail` 이 `"{무엇}: {까닭}"` 으로 감싸므로, 접두사는 감싼
/// **바깥**에 붙는다(그래야 사람이 읽는 줄이 `[…]` 로 시작하지 않는다). 그 자리가
/// [`with_reason`] 을 직접 부르는 유일한 곳이다.
pub fn session_lost_text() -> String {
    tr!(ko: "세션이 끊겼습니다", en: "The session was lost")
}

/// 사용자가 [취소] 를 눌렀다.
pub fn cancelled() -> String {
    with_reason(
        CANCELLED,
        tr!(ko: "전송을 취소했습니다", en: "The transfer was cancelled"),
    )
}

/// 금고가 잠겨 있다 — 프런트는 이걸 보고 잠금 해제 모달을 연다.
pub fn vault_locked() -> String {
    with_reason(
        VAULT_LOCKED,
        tr!(
            ko: "금고가 잠겨 있습니다 — 마스터 비밀번호로 잠금을 해제하세요",
            en: "The vault is locked — unlock it with the master password",
        ),
    )
}

/// 마스터 비밀번호가 틀렸다.
///
/// **왜 틀렸는지는 말하지 않는다** — AEAD 는 "키가 틀렸다" 와 "파일이 손상됐다" 를 구분해
/// 주지 않고, 구분해 주는 척하는 문구는 공격자에게 신탁이 된다. 사람에게 필요한 다음 행동은
/// 어느 쪽이든 같다(다시 입력한다).
pub fn vault_wrong_master() -> String {
    with_reason(
        VAULT_WRONG_MASTER,
        tr!(
            ko: "금고를 열지 못했습니다 — 마스터 비밀번호가 맞는지 확인하세요",
            en: "Could not open the vault — check that the master password is correct",
        ),
    )
}

/// 금고 파일이 아직 없다 (= 옵트인하지 않았다).
pub fn vault_absent() -> String {
    with_reason(
        VAULT_ABSENT,
        tr!(
            ko: "금고가 아직 없습니다 — 먼저 금고를 만드세요",
            en: "There is no vault yet — create one first",
        ),
    )
}

/// 디스크의 파일이 편집을 시작한 뒤 바뀌었다 — 쓰지 않았다.
pub fn conflict(shown: &str) -> String {
    with_reason(
        CONFLICT,
        tr!(
            ko: "{shown} 이(가) 편집을 시작한 뒤 디스크에서 바뀌었습니다 — 저장하지 않았습니다",
            en: "{shown} changed on disk after editing started — it was not saved",
        ),
    )
}

/// 저장할 파일이 없다 — 저장은 파일을 새로 만들지 않는다.
pub fn missing(shown: &str) -> String {
    with_reason(
        MISSING,
        tr!(
            ko: "{shown} 이(가) 없습니다 — 지워졌거나 옮겨졌습니다 (저장하지 않았습니다)",
            en: "{shown} does not exist — it was deleted or moved (it was not saved)",
        ),
    )
}

/// 저장소는 만들었지만 첫 커밋을 만들 신원이 없다 (`git var GIT_AUTHOR_IDENT` 가 서지 않는다).
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

    /// 생성자가 만든 문구는 **두 언어 모두에서** 제 접두사로 시작한다 — 프런트의 분기가
    /// 언어를 타지 않는다는 계약 그 자체다.
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

    /// 본문은 언어를 타고, 접두사는 타지 않는다.
    #[test]
    fn the_body_is_translated_and_the_prefix_is_not() {
        set_lang(Lang::Ko);
        assert_eq!(exists("a.txt"), "[exists] a.txt 이(가) 이미 있습니다");
        set_lang(Lang::En);
        assert_eq!(exists("a.txt"), "[exists] a.txt already exists");
        set_lang(Lang::Ko);
    }

    /// 감싸인 문구도 같은 갈래다 (`fail` 과 `move_failure` 가 앞에 말을 붙인다).
    #[test]
    fn a_wrapped_message_still_carries_the_reason() {
        let wrapped = format!("3개 이동 완료, 4번째에서 중단: {}", cancelled());
        assert!(is_cancelled(&wrapped), "{wrapped}");
        assert!(!is_cancelled("권한이 없습니다"));
        // 코드가 다르면 걸리지 않는다 — 넷이 서로를 오인하지 않는다.
        assert!(!has_reason(&exists("a.txt"), NOT_EMPTY));
        assert!(!has_reason(&not_empty("/x"), EXISTS));
    }

    /// 세션이 끊긴 본문은 **접두사가 없다** — 감싸는 쪽이 바깥에 붙인다.
    #[test]
    fn the_lost_session_body_has_no_prefix_of_its_own() {
        let body = session_lost_text();
        assert!(!body.contains('['), "{body}");
        let wrapped = with_reason(SESSION_GONE, format!("/srv 목록을 읽지 못했습니다: {body}"));
        assert!(has_reason(&wrapped, SESSION_GONE), "{wrapped}");
    }
}
