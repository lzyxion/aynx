use super::*;

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("aynx-db기록-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더 생성");
        Self(dir)
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn success_sets_time_and_counts() {
    let mut f = DbHistoryFile::default();
    assert!(apply_ok(&mut f, "Qp9-pg-dev01", 100));
    assert!(apply_ok(&mut f, "Qp9-pg-dev01", 200));
    let e = &f.conns["Qp9-pg-dev01"];
    assert_eq!(e.last_ok_at, Some(200));
    assert_eq!(e.count, 2);
    // 연결 id 모양이 아니면 적지 않는다(빈 글자 · 짧음 · 경로 같은 글자).
    for bad in ["", "short", "C:\\data\\app.db", "a b c d e f g h"] {
        assert!(!apply_ok(&mut f, bad, 1), "{bad}");
    }
    assert_eq!(f.conns.len(), 1);
}

#[test]
fn forget_removes_only_named_ids() {
    let mut f = DbHistoryFile::default();
    apply_ok(&mut f, "Xk3_local-01", 1);
    apply_ok(&mut f, "Qp9-pg-dev01", 2);
    // 대소문자를 가린다(볼트 열쇠와 같은 규칙) — 다른 글자는 지우지 않는다.
    assert!(!forget(&mut f, &["xk3_local-01".to_string()]));
    assert!(forget(&mut f, &["Xk3_local-01".to_string(), "Nope_nope-01".to_string()]));
    assert_eq!(f.conns.keys().collect::<Vec<_>>(), vec!["Qp9-pg-dev01"]);
    assert!(!forget(&mut f, &[]));
}

#[test]
fn missing_or_broken_file_starts_empty_and_round_trips() {
    let dir = TempDir::new("파일");
    let p = dir.path("db-history.json");
    assert_eq!(load_file(&p), DbHistoryFile::default());
    std::fs::write(&p, "{ 깨진").unwrap();
    assert_eq!(load_file(&p), DbHistoryFile::default());
    // 깨진 파일 위에 적으면 새 표로 다시 선다.
    assert!(modify(&p, |f| apply_ok(f, "Xk3_local-01", 7)).unwrap());
    let back = load_file(&p);
    assert_eq!(back.conns["Xk3_local-01"], DbHistoryEntry { last_ok_at: Some(7), count: 1 });
    // 바뀐 것이 없으면 쓰지 않는다.
    assert!(!modify(&p, |f| forget(f, &["Nope_nope-01".to_string()])).unwrap());
    // 모르는 칸 · 빠진 칸은 너그럽게(옛/새 판).
    std::fs::write(&p, r#"{"conns":{"Xk3_local-01":{"last_ok_at":5,"extra":1}},"other":true}"#).unwrap();
    assert_eq!(load_file(&p).conns["Xk3_local-01"], DbHistoryEntry { last_ok_at: Some(5), count: 0 });
}

#[test]
fn file_holds_no_secret_or_sql_fields() {
    // 파일의 모양 = id → {last_ok_at, count} 뿐(머리말 "담지 않는 것").
    let mut f = DbHistoryFile::default();
    apply_ok(&mut f, "Qp9-pg-dev01", 42);
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(v, serde_json::json!({ "conns": { "Qp9-pg-dev01": { "last_ok_at": 42, "count": 1 } } }));
}

#[test]
fn ai_paths_never_record() {
    // AI 전용 연결(`db::ai` 읽기 풀 · `db::ai_write` 쓰기 연결) · 작업안 실행 · MCP 는 기록을 부르지 않는다 — 적는 곳은
    // 서버 op `db_open`(사람 쿼리 타일) 하나다(머리말 "무엇을 적지 않나").
    let src = |p: &str| std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(p)).unwrap();
    for p in ["src/db/ai.rs", "src/db/ai_write.rs", "src/operations/db_exec.rs", "src/mcp/db.rs", "src/db/table.rs"] {
        assert!(!src(p).contains("db_history"), "{p} 가 DB 접속 기록을 부른다");
    }
    assert!(src("src/server/db_ops.rs").contains("crate::db_history::record_ok("));
}
