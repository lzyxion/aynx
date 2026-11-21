//! **빌린 DB 비밀번호** — 사람 쿼리 타일이 비밀번호로 인증에 성공한 값을 세션 서버 메모리에만 들고, 그 연결의 사람 타일이 붙어 있는 동안
//! AI 연결(읽기 `db::ai` · 쓰기 작업안 `db::ai_write`)이 볼트보다 먼저 쓴다(docs/log/2026-11-09-db-borrowed-password.md).
//!
//! ## 불변식(→ docs/invariants.md 전문 8)
//!
//! - **담는 곳은 하나** — 사람 타일의 새 열기(`table::open`)가 네트워크 엔진에 비밀번호로 붙은 뒤, 인증에 쓴 바로 그 값(친 값 · 볼트 값).
//!   [연결 테스트](`table::test`) · 재부착 · AI 연결은 담지 않는다 · "볼트에 저장" 체크와 무관(시험 `borrowed_remembered_only_by_tile_open`).
//! - **지우는 사건은 셋뿐** — 그 연결 id 의 마지막 사람 타일이 표에서 빠짐([`last_tile_closed`] — 떨어진 세션으로 남은 동안은 그대로) ·
//!   대상이 바뀜([`lend`] — `DbIdentity::of(.., None).same(..)`) · AI 연결에서 거절됨([`reject`]).
//! - **볼트 잠금 · 가림막 · 창 0개 · GUI 연결 0 과 무관하다** — 이 표와 볼트 평면은 서로 모른다(시험 `borrowed_password_never_leaves`).
//!   타일이 없을 때 볼트 값으로 새로 여는 AI 길은 볼트가 열려 있고 그 연결에 헤드리스 위임(`[[database]] headless`)이 있어야 한다.
//! - 지울 때 빌린 값으로 연 AI 읽기 연결도 거둔다(`ai::retire_borrowed` — 도는 조회는 끝까지). 쓰기 작업안의 트랜잭션은 끝까지 간다.
//! - **비밀** — 볼트 값과 같은 규칙: 프로세스 밖(파이프 · GUI · 프런트 · MCP · 로그 · `Debug` · 영속 파일 · 감사)으로 나가지 않는다 · 값을
//!   돌려주는 op 는 없다. 꺼내는 길은 AI 연결의 [`lend`] 와 끊긴 사람 타일 다시 열기의 [`carry`](`table::open` 하나) 둘뿐 — 접속 한 번에 쓰고 버린다.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use zeroize::Zeroizing;

use super::conns::DbConn;
use crate::delegation::database::DbIdentity;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct Held {
    /// 인증 당시 연결 줄의 신원(경유 별칭이 가리키는 곳은 보지 않는다).
    ident: DbIdentity,
    password: Zeroizing<String>,
    /// 거절 · 거두기가 그 사이 바뀐 새 값을 지우지 않게.
    stamp: u64,
}

pub(crate) struct Lent {
    pub password: Zeroizing<String>,
    pub stamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Missing {
    TileClosed,
    TargetChanged,
    Rejected,
    /// 재부착은 이 까닭이 아니다(담긴 값이 남는다).
    NoPassword,
}

#[derive(Default)]
pub(crate) struct Borrowed {
    held: HashMap<String, Held>,
    tiles: HashSet<String>,
    /// 다시 담거나 마지막 타일이 빠지면 걷는다.
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
    pub(crate) fn tile_opened(&mut self, id: &str) {
        self.tiles.insert(id.to_string());
    }

    /// 타일이 표에 있을 때만 담는다.
    pub(crate) fn remember(&mut self, id: &str, ident: DbIdentity, password: Zeroizing<String>) -> bool {
        if !self.tiles.contains(id) {
            return false;
        }
        self.next_stamp += 1;
        self.held.insert(id.to_string(), Held { ident, password, stamp: self.next_stamp });
        self.dropped.remove(id);
        true
    }

    pub(crate) fn last_tile_closed(&mut self, id: &str) -> bool {
        self.tiles.remove(id);
        self.dropped.remove(id);
        self.held.remove(id).is_some()
    }

    /// 신원이 담을 때와 다르면 그 자리에서 버린다. `(빌린 값 또는 없는 까닭, 이번에 버렸나)`.
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

    pub(crate) fn still_lent(&self, id: &str, stamp: u64) -> bool {
        self.held.get(id).is_some_and(|h| h.stamp == stamp)
    }

    pub(crate) fn reject(&mut self, id: &str, stamp: u64) -> bool {
        if self.held.get(id).is_some_and(|h| h.stamp == stamp) {
            self.held.remove(id);
            self.dropped.insert(id.to_string(), Missing::Rejected);
            return true;
        }
        false
    }

    /// 신원은 보지 않는다(바뀐 대상은 [`Borrowed::lend`] 가 본 순간 [`Missing::TargetChanged`] 로 남는다).
    pub(crate) fn missing(&self, id: &str) -> Option<Missing> {
        if !self.tiles.contains(id) {
            return Some(Missing::TileClosed);
        }
        if !self.held.contains_key(id) {
            return Some(self.dropped.get(id).copied().unwrap_or(Missing::NoPassword));
        }
        None
    }

    /// 끊긴 사람 타일을 다시 여는 데 쓸 값 — 항목이 거둬지며 값이 지워지기 전에 잡는다(`table::open` 하나 · 신원이 지금 줄과 같을 때만 쓴다).
    pub(crate) fn carry(&self, id: &str) -> Option<(DbIdentity, Zeroizing<String>)> {
        if !self.tiles.contains(id) {
            return None;
        }
        self.held.get(id).map(|h| (h.ident.clone(), h.password.clone()))
    }

    /// 값은 꺼내지 않는다(`table::reattach_only` 의 `[db-carry]` 표지용).
    pub(crate) fn can_carry(&self, id: &str) -> bool {
        self.tiles.contains(id) && self.held.contains_key(id)
    }
}

static STORE: LazyLock<Mutex<Borrowed>> = LazyLock::new(Default::default);

pub(crate) fn tile_opened(id: &str) {
    lock(&STORE).tile_opened(id);
}

pub(crate) fn remember(id: &str, ident: DbIdentity, password: Zeroizing<String>) -> bool {
    lock(&STORE).remember(id, ident, password)
}

pub(crate) fn last_tile_closed(id: &str) {
    if lock(&STORE).last_tile_closed(id) {
        super::ai::retire_borrowed(id);
    }
}

pub(crate) fn lend(conn: &DbConn) -> Result<Lent, Missing> {
    let (lent, dropped) = lock(&STORE).lend(conn);
    if dropped {
        super::ai::retire_borrowed(&conn.id);
    }
    lent
}

pub(crate) fn still_lent(id: &str, stamp: u64) -> bool {
    lock(&STORE).still_lent(id, stamp)
}

pub(crate) fn reject(id: &str, stamp: u64) -> bool {
    lock(&STORE).reject(id, stamp)
}

pub(crate) fn missing(id: &str) -> Option<Missing> {
    lock(&STORE).missing(id)
}

pub(crate) fn carry(id: &str) -> Option<(DbIdentity, Zeroizing<String>)> {
    lock(&STORE).carry(id)
}

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
        assert!(b.remember(&c.id, DbIdentity::of(&c, None), pw("p2")));
        assert!(!b.still_lent(&c.id, stamp));
        assert_eq!(b.lend(&c).0.ok().map(|l| l.password.to_string()), Some("p2".into()));
        assert!(b.last_tile_closed(&c.id));
        assert_eq!(b.missing(&c.id), Some(Missing::TileClosed));
        assert!(matches!(b.lend(&c).0, Err(Missing::TileClosed)));
        assert!(!b.remember(&c.id, DbIdentity::of(&c, None), pw("p3")));
    }

    /// 같음의 눈은 [연결 테스트] 와 같다(이름 · TLS · 폴더는 보지 않는다).
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

    #[test]
    fn debug_hides_the_value() {
        let mut b = Borrowed::default();
        let c = conn("Brw_unit0004", "db.local");
        b.tile_opened(&c.id);
        b.remember(&c.id, DbIdentity::of(&c, None), pw("BRW-SECRET-dbg"));
        let d = format!("{b:?} {:?}", b.missing(&c.id));
        assert!(!d.contains("BRW-SECRET") && !d.contains("Brw_unit0004") && !d.contains("db.local"), "{d}");
    }

    /// `src/` 아래 `.rs`(시험 파일 · 시험 묶음 제외), 열쇠는 `/` 로 이은 상대 경로.
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

    /// 빌린 값 표를 아는 곳은 세션 서버 안의 둘(타일 표 · AI 연결)뿐 — MCP · op 몸 · GUI 프록시 · Tauri 명령 · 볼트 평면은 모른다.
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
