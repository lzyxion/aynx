//! **빌린 DB 비밀번호**(2026-11-09 사용자 결정 — docs/log/2026-11-09-db-borrowed-password.md) — 사람의 쿼리 타일이 비밀번호로 인증에
//! 성공하면(사람이 친 값이든 볼트에서 읽은 값이든) 그 값을 **세션 서버 메모리에만** 들고 있다가, 그 연결의 사람 타일이 붙어 있는 동안 AI
//! 연결(읽기 `db::ai` · 쓰기 작업안 `db::ai_write`)이 볼트보다 먼저 그 값으로 붙는다. SSH 는 사람이 연 연결 위에 exec 채널을 더 열어 AI
//! 작업안을 돌리지만 DB 는 연결마다 인증이라 같은 경험("사람이 열어 둔 세션 위에서 AI 가 계속 일한다")을 이렇게 낸다.
//!
//! ## 불변식
//!
//! - **담는 곳은 하나** — 사람 타일의 새 열기(`table::open`)가 네트워크 엔진(PG · MySQL)에 비밀번호로 붙은 뒤. 값은 인증에 쓴 바로 그것이다
//!   (몸의 값 · 몸이 비었으면 엔진에 넘기기 전에 정한 볼트 값 — `net::OpenSecrets::settle_password`). [연결 테스트](`table::test`) · 재부착(새 인증
//!   없음 — 담긴 값은 표 항목이 사는 동안 그대로) · AI 연결 자신은 담지 않는다(시험 `borrowed_remembered_only_by_tile_open`). "볼트에 저장"
//!   체크와 무관하다.
//! - **지우는 사건은 셋뿐** — ① **그 연결 id 의 마지막 사람 타일이 표에서 빠짐**([`last_tile_closed`] — `table::retire` 하나: 닫기 · 창 파괴 ·
//!   리로드로 떼어 둔 TTL · 떨어진 세션 [닫기] · 모두 닫기 · 다른 연결로 바뀜 — 창이 사라져 떨어진 세션으로 남은 동안은 항목이 사니 그대로다) · ② **대상이 바뀜**(쓰는 순간 지금 연결 줄의 신원이 담을 때의 스냅샷과 다르면 버린다 —
//!   [`lend`] · 같음의 눈은 [연결 테스트] 의 `test_vault_allowed` 와 같은 `DbIdentity::of(.., None).same(..)`) · ③ 그 값이 AI 연결에서 거절됨
//!   ([`reject`]).
//! - **볼트 잠금 · 가림막 · 창 0개 · GUI 연결 0 과 무관하다**(같은 날 두 번째 사용자 결정 — SSH 의 열린 세션이 가림막 · GUI 종료에도 AI 읽기 ·
//!   작업안을 이어 가는 것과 같은 등급). 이 표는 볼트 평면을 모르고 볼트 평면도 이 표를 모른다(시험 `borrowed_password_never_leaves`).
//!   타일이 없을 때 볼트 값으로 새로 여는 AI 길은 예전 그대로 볼트가 열려 있어야 하고, 그 연결에 헤드리스 위임(`[[database]] headless`)이 있어야 한다.
//! - **까닭** — 빌려줄 값이 없으면 [`Missing`] 하나(타일 없음 · 대상 바뀜 · 거절 · 비밀번호 없이 붙음)로 AI 문구(`ai::no_password_text`)를 가른다.
//! - 지울 때 **빌린 값으로 연 AI 읽기 연결**(`db::ai` 의 풀)도 거둔다(`ai::retire_borrowed` — 도는 조회는 끝까지 두고 끝나면 닫는다). 쓰기
//!   작업안의 연결은 실행 한 번만 살아 도는 트랜잭션이 끝까지 간다.
//! - **비밀** — 볼트 값과 같은 규칙: 이 프로세스 밖(파이프 · GUI · 프런트 · MCP · 로그 · `Debug` · 영속 파일 · 감사)으로 나가지 않는다. 값은
//!   `Zeroizing`(지우면 0 으로 덮인다) · `Debug` 는 가린다 · 값을 돌려주는 op 는 없다(꺼내는 길은 AI 연결의 [`lend`] 와 — 떨어진 세션을
//!   다시 붙이는데 DB 쪽이 연결을 끊었을 때 — 같은 stream 의 사람 타일 다시 열기의 [`carry`](`table::open` 하나) 둘 — 그 값은 드라이버
//!   접속 한 번에 쓰고 버린다). 시험 `borrowed_password_never_leaves`.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use zeroize::Zeroizing;

use super::conns::DbConn;
use crate::delegation::database::DbIdentity;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 담아 둔 값 하나 — **`Debug` 를 파생하지 않는다**.
struct Held {
    /// 인증 당시 연결 줄의 신원(경유 별칭이 가리키는 곳은 보지 않는다 — 같은 별칭이면 지금 같은 곳).
    ident: DbIdentity,
    password: Zeroizing<String>,
    /// 담을 때마다 새 번호 — 거절 · 거두기가 그 사이 바뀐 새 값을 지우지 않게.
    stamp: u64,
}

/// AI 연결에 빌려준 값 — 접속 한 번에 쓰고 버린다(**`Debug` 없음**).
pub(crate) struct Lent {
    pub password: Zeroizing<String>,
    pub stamp: u64,
}

/// 빌려줄 값이 없는 까닭 — AI 에게 주는 문구를 가른다(값은 싣지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Missing {
    /// (a) 그 연결을 연 사람 타일이 없다.
    TileClosed,
    /// (c) 타일이 인증한 뒤 연결의 대상이 바뀌어 버렸다.
    TargetChanged,
    /// (d) DB 가 빌린 값을 거절해 버렸다.
    Rejected,
    /// (e) 타일은 열려 있지만 비밀번호 없이 붙었다(서버가 요구하지 않았다) — 빌려줄 값이 없다. 재부착은 이 까닭이 아니다(담긴 값이 남는다).
    NoPassword,
}

/// 표 한 벌 — 제품은 [`STORE`] 하나, 시험은 따로 만들어 쓴다.
#[derive(Default)]
pub(crate) struct Borrowed {
    held: HashMap<String, Held>,
    /// 사람 타일이 표에 있는 연결 id.
    tiles: HashSet<String>,
    /// 값을 버린 까닭(대상 바뀜 · 거절 — 문구용). 다시 담거나 마지막 타일이 빠지면 걷는다.
    dropped: HashMap<String, Missing>,
    next_stamp: u64,
}

impl std::fmt::Debug for Borrowed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Borrowed")
            .field("held", &self.held.len())
            .field("tiles", &self.tiles.len())
            .finish_non_exhaustive()
    }
}

impl Borrowed {
    /// 그 연결 id 의 사람 타일이 표에 섰다.
    pub(crate) fn tile_opened(&mut self, id: &str) {
        self.tiles.insert(id.to_string());
    }

    /// 사람 타일의 인증 성공 뒤 담는다 — 타일이 표에 있을 때만. 담았나.
    pub(crate) fn remember(&mut self, id: &str, ident: DbIdentity, password: Zeroizing<String>) -> bool {
        if !self.tiles.contains(id) {
            return false;
        }
        self.next_stamp += 1;
        self.held.insert(id.to_string(), Held { ident, password, stamp: self.next_stamp });
        self.dropped.remove(id);
        true
    }

    /// 그 연결 id 의 마지막 사람 타일이 빠졌다 — 값을 지운다. 지운 값이 있었나.
    pub(crate) fn last_tile_closed(&mut self, id: &str) -> bool {
        self.tiles.remove(id);
        self.dropped.remove(id);
        self.held.remove(id).is_some()
    }

    /// AI 연결이 빌린다 — 타일이 있고 지금 연결 줄의 신원이 담을 때와 같을 때만. 신원이 다르면 그 자리에서 버린다(대상이 바뀌었다).
    /// `(빌린 값 또는 없는 까닭, 이번에 버렸나)`.
    pub(crate) fn lend(&mut self, conn: &DbConn) -> (Result<Lent, Missing>, bool) {
        if !self.tiles.contains(&conn.id) {
            return (Err(Missing::TileClosed), self.held.remove(&conn.id).is_some());
        }
        let Some(h) = self.held.get(&conn.id) else {
            return (Err(self.dropped.get(&conn.id).copied().unwrap_or(Missing::NoPassword)), false);
        };
        if !h.ident.same(&DbIdentity::of(conn, None)) {
            self.held.remove(&conn.id);
            self.dropped.insert(conn.id.clone(), Missing::TargetChanged);
            return (Err(Missing::TargetChanged), true);
        }
        (Ok(Lent { password: h.password.clone(), stamp: h.stamp }), false)
    }

    /// 빌린 값이 아직 빌려줄 수 있는 그대로인가(지워지거나 갈리지 않았다).
    pub(crate) fn still_lent(&self, id: &str, stamp: u64) -> bool {
        self.held.get(id).is_some_and(|h| h.stamp == stamp)
    }

    /// 빌린 값을 DB 가 거절했다 — 그 값일 때만 지운다. 지웠나.
    pub(crate) fn reject(&mut self, id: &str, stamp: u64) -> bool {
        if self.held.get(id).is_some_and(|h| h.stamp == stamp) {
            self.held.remove(id);
            self.dropped.insert(id.to_string(), Missing::Rejected);
            return true;
        }
        false
    }

    /// 빌려줄 값이 없는 까닭(빌려줄 수 있으면 `None`) — 신원은 보지 않는다(바뀐 대상은 [`Borrowed::lend`] 가 본 순간
    /// [`Missing::TargetChanged`] 로 남는다).
    pub(crate) fn missing(&self, id: &str) -> Option<Missing> {
        if !self.tiles.contains(id) {
            return Some(Missing::TileClosed);
        }
        if !self.held.contains_key(id) {
            return Some(self.dropped.get(id).copied().unwrap_or(Missing::NoPassword));
        }
        None
    }

    /// **끊긴 사람 타일을 다시 여는 데 쓸 값**(②) — 떨어진 세션을 다시 붙이는데 DB 쪽이 연결을 끊었다: 그 항목이 거둬지며 값이 지워지기
    /// 전에 사본과 신원을 잡는다(`table::open` 하나 — 신원이 지금 줄과 같을 때만 쓴다). 타일이 표에 없으면 `None`.
    pub(crate) fn carry(&self, id: &str) -> Option<(DbIdentity, Zeroizing<String>)> {
        if !self.tiles.contains(id) {
            return None;
        }
        self.held.get(id).map(|h| (h.ident.clone(), h.password.clone()))
    }

    /// [`Borrowed::carry`] 가 값을 줄 수 있나 — 값은 꺼내지 않는다(`table::reattach_only` 가 `[db-carry]` 표지를 다는 데만 · 신원 견주기는
    /// 새 열기의 몫이라 여기서는 보지 않는다).
    pub(crate) fn can_carry(&self, id: &str) -> bool {
        self.tiles.contains(id) && self.held.contains_key(id)
    }
}

/// 세션 서버의 한 벌.
static STORE: LazyLock<Mutex<Borrowed>> = LazyLock::new(Default::default);

/// 사람 타일이 섰다(`table::open` — 표의 잠금 안).
pub(crate) fn tile_opened(id: &str) {
    lock(&STORE).tile_opened(id);
}

/// 사람 타일의 인증 성공 뒤 담는다(`table::open` 하나 — 표의 잠금 안 · 친 값 · 볼트 값).
pub(crate) fn remember(id: &str, ident: DbIdentity, password: Zeroizing<String>) -> bool {
    lock(&STORE).remember(id, ident, password)
}

/// 마지막 사람 타일이 빠졌다(`table::retire` — 표의 잠금 안). 값을 지우고 그 값으로 연 AI 읽기 연결을 거둔다.
pub(crate) fn last_tile_closed(id: &str) {
    if lock(&STORE).last_tile_closed(id) {
        super::ai::retire_borrowed(id);
    }
}

/// AI 연결이 빌린다([`Borrowed::lend`]) — 대상이 바뀌어 버렸으면 그 값으로 연 AI 읽기 연결도 거둔다. 없으면 그 까닭.
pub(crate) fn lend(conn: &DbConn) -> Result<Lent, Missing> {
    let (lent, dropped) = lock(&STORE).lend(conn);
    if dropped {
        super::ai::retire_borrowed(&conn.id);
    }
    lent
}

/// [`Borrowed::still_lent`].
pub(crate) fn still_lent(id: &str, stamp: u64) -> bool {
    lock(&STORE).still_lent(id, stamp)
}

/// [`Borrowed::reject`].
pub(crate) fn reject(id: &str, stamp: u64) -> bool {
    lock(&STORE).reject(id, stamp)
}

/// [`Borrowed::missing`].
pub(crate) fn missing(id: &str) -> Option<Missing> {
    lock(&STORE).missing(id)
}

/// [`Borrowed::carry`] — 끊긴 사람 타일의 다시 열기(`table::open` 하나).
pub(crate) fn carry(id: &str) -> Option<(DbIdentity, Zeroizing<String>)> {
    lock(&STORE).carry(id)
}

/// [`Borrowed::can_carry`] — 값 없이 있다는 것만(`table::reattach_only` 의 표지).
pub(crate) fn can_carry(id: &str) -> bool {
    lock(&STORE).can_carry(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::conns::DbEngine;

    fn conn(id: &str, host: &str) -> DbConn {
        DbConn {
            id: id.into(),
            name: "n".into(),
            engine: DbEngine::Postgres,
            via: None,
            path: None,
            host: Some(host.into()),
            port: Some(5432),
            database: Some("app".into()),
            user: Some("u".into()),
            tls_mode: None,
            tls_ca: None,
            folder: None,
        }
    }

    fn pw(s: &str) -> Zeroizing<String> {
        Zeroizing::new(s.to_string())
    }

    /// ② — 끊긴 사람 타일의 다시 열기가 잡는 사본: 타일이 표에 있고 값이 있을 때만(신원도 함께 — 쓰는 쪽이 지금 줄과 견준다) · 마지막
    /// 타일이 빠진 뒤에는 없다.
    #[test]
    fn carry_only_while_the_tile_holds_a_value() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0003", "db.local");
        assert!(b.carry(&c.id).is_none(), "타일 없음");
        assert!(!b.can_carry(&c.id));
        b.tile_opened(&c.id);
        assert!(b.carry(&c.id).is_none(), "값 없음");
        assert!(!b.can_carry(&c.id));
        assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p1")));
        assert!(b.can_carry(&c.id), "값이 있으면 표지");
        let (ident, v) = b.carry(&c.id).expect("사본");
        assert!(ident.same(&DbIdentity::of(&c, None)) && v.as_str() == "p1");
        assert!(b.carry(&c.id).is_some(), "잡아도 지우지 않는다");
        b.last_tile_closed(&c.id);
        assert!(b.carry(&c.id).is_none());
        assert!(!b.can_carry(&c.id));
    }

    /// 담기는 타일이 표에 있을 때만 · 빌리면 같은 값(몇 번이든 — 잠금이라는 사건이 이 표에 없다) · 다시 담으면 새 값 · 마지막 타일이 빠지면
    /// 지워진다(그 뒤 담기도 없다).
    #[test]
    fn held_while_the_tile_is_open() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0001", "db.local");
        assert!(!b.remember(&c.id, DbIdentity::of(&c, None), pw("p1")), "타일 없이 담지 않는다");
        assert_eq!(b.missing(&c.id), Some(Missing::TileClosed));
        assert!(matches!(b.lend(&c).0, Err(Missing::TileClosed)));
        b.tile_opened(&c.id);
        assert_eq!(b.missing(&c.id), Some(Missing::NoPassword));
        assert!(matches!(b.lend(&c).0, Err(Missing::NoPassword)));
        assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p1")));
        assert_eq!(b.missing(&c.id), None);
        let (lent, dropped) = b.lend(&c);
        let stamp = lent.as_ref().unwrap().stamp;
        assert_eq!(lent.ok().map(|l| l.password.to_string()), Some("p1".into()));
        assert!(!dropped);
        let again = b.lend(&c).0.ok().unwrap();
        assert_eq!((again.password.as_str(), again.stamp), ("p1", stamp), "같은 값 · 같은 번호");
        assert!(b.still_lent(&c.id, stamp));
        // 새 인증(다른 타일 · 다시 연 타일)은 새 값 · 새 번호.
        assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p2")));
        assert!(!b.still_lent(&c.id, stamp));
        assert_eq!(b.lend(&c).0.ok().map(|l| l.password.to_string()), Some("p2".into()));
        // 마지막 타일이 빠지면 지운다.
        assert!(b.last_tile_closed(&c.id));
        assert_eq!(b.missing(&c.id), Some(Missing::TileClosed));
        assert!(matches!(b.lend(&c).0, Err(Missing::TileClosed)));
        assert!(!b.remember(&c.id, DbIdentity::of(&c, None), pw("p3")));
    }

    /// 대상이 바뀌면 쓰지 않고 그 자리에서 버린다 — 같음의 눈은 [연결 테스트] 와 같다(이름 · TLS · 폴더는 보지 않는다). 까닭은
    /// [`Missing::TargetChanged`] 로 남고, 다시 담으면 걷힌다.
    #[test]
    fn target_change_drops_the_value() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0002", "db.local");
        b.tile_opened(&c.id);
        assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p")));
        let mut renamed = c.clone();
        renamed.name = "other name".into();
        renamed.folder = Some("f".into());
        assert!(b.lend(&renamed).0.is_ok(), "이름 · 폴더는 대상이 아니다");
        let changes: [fn(&mut DbConn); 6] = [
            |c: &mut DbConn| c.host = Some("evil.example".into()),
            |c: &mut DbConn| c.port = Some(6543),
            |c: &mut DbConn| c.database = Some("other".into()),
            |c: &mut DbConn| c.user = Some("root".into()),
            |c: &mut DbConn| c.via = Some("jump".into()),
            |c: &mut DbConn| c.engine = DbEngine::Mysql,
        ];
        for change in changes {
            assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p")));
            assert_eq!(b.missing(&c.id), None, "다시 담으면 까닭이 걷힌다");
            let mut moved = c.clone();
            change(&mut moved);
            let (lent, dropped) = b.lend(&moved);
            assert!(matches!(lent, Err(Missing::TargetChanged)) && dropped, "바뀐 대상에 빌려주지 않는다");
            assert!(matches!(b.lend(&c).0, Err(Missing::TargetChanged)), "버렸다");
            assert_eq!(b.missing(&c.id), Some(Missing::TargetChanged));
        }
    }

    /// 거절은 그 값(번호)일 때만 지운다 — 그 사이 다시 담긴 새 값은 남는다. 까닭은 [`Missing::Rejected`].
    #[test]
    fn reject_only_the_lent_value() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0003", "db.local");
        b.tile_opened(&c.id);
        b.remember(&c.id, DbIdentity::of(&c, None), pw("old"));
        let old = b.lend(&c).0.ok().unwrap().stamp;
        b.remember(&c.id, DbIdentity::of(&c, None), pw("new"));
        assert!(!b.still_lent(&c.id, old));
        assert!(!b.reject(&c.id, old), "새 값은 그대로");
        let new = b.lend(&c).0.ok().unwrap();
        assert_eq!(new.password.as_str(), "new");
        assert!(b.reject(&c.id, new.stamp));
        assert_eq!(b.missing(&c.id), Some(Missing::Rejected));
        assert!(matches!(b.lend(&c).0, Err(Missing::Rejected)));
    }

    /// `Debug` 는 값을 싣지 않는다(개수만).
    #[test]
    fn debug_hides_the_value() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0004", "db.local");
        b.tile_opened(&c.id);
        b.remember(&c.id, DbIdentity::of(&c, None), pw("BRW-SECRET-dbg"));
        let d = format!("{b:?} {:?}", b.missing(&c.id));
        assert!(!d.contains("BRW-SECRET") && !d.contains("Brw_unit0004") && !d.contains("db.local"), "{d}");
    }

    /// 시험용 소스 훑기 — `src/` 아래 `.rs`(시험 파일 · 이 파일의 시험 묶음 제외), 열쇠는 `/` 로 이은 상대 경로.
    fn sources() -> Vec<(String, String)> {
        fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<(String, String)>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().is_some_and(|n| n != "tests" && n != "testdata") {
                        walk(&p, root, out);
                    }
                    continue;
                }
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                if !rel.ends_with(".rs") || rel.ends_with("tests.rs") || rel.ends_with("_tests.rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&p).unwrap().replace("\r\n", "\n");
                let body = text.split("\n#[cfg(test)]\nmod tests {").next().unwrap_or("").to_string();
                out.push((rel, body));
            }
        }
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut out = Vec::new();
        walk(&root, &root, &mut out);
        out
    }

    fn fn_body<'a>(src: &'a str, head: &str) -> &'a str {
        let at = src.find(head).unwrap_or_else(|| panic!("{head} 없음"));
        &src[at..at + src[at..].find("\n}\n").unwrap()]
    }

    /// 시험 `borrowed_remembered_only_by_tile_open` — 담는 곳은 사람 타일의 새 열기(`table::open`) 하나다: [연결 테스트](`table::test`)와 AI
    /// 연결(`db::ai` · `db::ai_write`)은 담지 않는다. 볼트 값을 몸에 미리 정하는 `settle_password` 도 타일의 엔진 열기(`table::open_engine`) 하나뿐이다 —
    /// 그래서 담는 값은 인증에 쓴 바로 그 값이다(친 값 · 볼트 값).
    #[test]
    fn borrowed_remembered_only_by_tile_open() {
        let all = sources();
        let callers: Vec<&String> = all.iter().filter(|(_, s)| s.contains("borrowed::remember(")).map(|(p, _)| p).collect();
        assert_eq!(callers, vec!["db/table.rs"], "담는 곳");
        let table = &all.iter().find(|(p, _)| p == "db/table.rs").unwrap().1;
        assert_eq!(table.matches("borrowed::remember(").count(), 1);
        assert!(fn_body(table, "pub(crate) async fn open(").contains("borrowed::remember("), "타일의 새 열기 안");
        assert!(!fn_body(table, "pub(crate) async fn test(").contains("borrowed"), "연결 테스트는 담지 않는다");
        let settlers: Vec<&String> = all.iter().filter(|(p, s)| p != "db/net.rs" && s.contains(".settle_password(")).map(|(p, _)| p).collect();
        assert_eq!(settlers, vec!["db/table.rs"], "볼트 값을 미리 정하는 곳");
        assert_eq!(table.matches(".settle_password(").count(), 1);
        let engine = fn_body(table, "async fn open_engine(");
        assert!(engine.contains(".settle_password(") && engine.find(".settle_password(") < engine.find("::connect("), "엔진에 넘기기 전에 정한다");
        assert!(!fn_body(table, "pub(crate) async fn test(").contains("settle_password"), "연결 테스트는 미리 정하지 않는다");
        for f in ["db/ai.rs", "db/ai_write.rs"] {
            let s = &all.iter().find(|(p, _)| p == f).unwrap().1;
            assert!(!s.contains("remember(") && !s.contains("tile_opened("), "{f} 가 담는다");
        }
    }

    /// 시험 `borrowed_password_never_leaves` — 빌린 비밀번호는 볼트 값과 같은 규칙: 이 표를 아는 곳은 세션 서버 안의 둘(타일 표 · AI 연결)
    /// 뿐이고 MCP · op 몸 · GUI 프록시 · Tauri 명령 · **볼트 평면(`server::vault_ops` — 잠금 · 해제는 이 표에 닿지 않는다)** 은 모른다. 표 · 빌린 값은 `Debug` 를 파생하지 않고 로그 · 이벤트 · JSON 을 쓰지
    /// 않는다. 값을 꺼내는 곳은 AI 연결의 접속 한 번(`ai::open_with`)과 끊긴 사람 타일의 다시 열기(`table::open` 의 [`carry`])뿐이다.
    #[test]
    fn borrowed_password_never_leaves() {
        let all = sources();
        let mut knows: Vec<&str> = all
            .iter()
            .filter(|(p, s)| p != "db/borrowed.rs" && s.contains("borrowed::"))
            .map(|(p, _)| p.as_str())
            .collect();
        knows.sort_unstable();
        assert_eq!(knows, ["db/ai.rs", "db/table.rs"], "빌린 값 표를 아는 곳");
        let vault_ops = &all.iter().find(|(p, _)| p == "server/vault_ops.rs").unwrap().1;
        assert!(!vault_ops.contains("borrowed"), "볼트 잠금 · 해제는 빌린 값에 닿지 않는다");
        let mut lenders: Vec<&str> = all.iter().filter(|(_, s)| s.contains("lend_for(")).map(|(p, _)| p.as_str()).collect();
        lenders.sort_unstable();
        assert_eq!(lenders, ["db/ai.rs", "db/ai_write.rs"], "빌리는 곳은 AI 연결뿐");
        let ai = &all.iter().find(|(p, _)| p == "db/ai.rs").unwrap().1;
        assert_eq!(ai.matches("l.password").count(), 1, "값은 접속 몸에 한 번 실린다");
        // 끊긴 사람 타일의 다시 열기(②)가 잡는 사본 — 타일 표의 새 열기 하나에서만(엔진 접속 몸으로 간다).
        let carriers: Vec<&str> = all.iter().filter(|(_, s)| s.contains("borrowed::carry(")).map(|(p, _)| p.as_str()).collect();
        assert_eq!(carriers, ["db/table.rs"], "다시 열기의 사본을 잡는 곳");
        let table = &all.iter().find(|(p, _)| p == "db/table.rs").unwrap().1;
        assert_eq!(table.matches("borrowed::carry(").count(), 1);
        assert!(fn_body(table, "pub(crate) async fn open(").contains("borrowed::carry("), "타일의 새 열기 안");
        let me = &all.iter().find(|(p, _)| p == "db/borrowed.rs").unwrap().1;
        for bad in ["log::line", "eprintln!", "println!", "json!", "Serialize", "hub::", "crate::server", "format!(", "write!("] {
            assert!(!me.contains(bad), "borrowed.rs 에 {bad}");
        }
        for ty in ["struct Held", "struct Lent", "struct Borrowed"] {
            let at = me.find(ty).unwrap();
            let head = &me[me[..at].rfind("\n\n").unwrap_or(0)..at];
            assert!(!head.lines().any(|l| l.contains("derive") && l.contains("Debug")), "{ty} 가 Debug 를 파생한다");
        }
    }
}
