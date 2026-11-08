use super::*;

// ── 원격 경로 정규화 ────────────────────────────────────────────────────

#[test]
fn strips_home_prefix() {
    // SFTP 에는 `~` 를 풀어 줄 셸이 없다 — 상대 경로의 기준이 이미 홈이다.
    assert_eq!(normalize_remote("~/nginx.conf").unwrap(), "nginx.conf");
    assert_eq!(normalize_remote("~/etc/a.conf").unwrap(), "etc/a.conf");
    assert_eq!(normalize_remote("~").unwrap(), ".");
    assert_eq!(normalize_remote("~/").unwrap(), ".");
}

#[test]
fn keeps_absolute_paths() {
    assert_eq!(
        normalize_remote("/etc/nginx.conf").unwrap(),
        "/etc/nginx.conf"
    );
    assert_eq!(normalize_remote("/").unwrap(), "/");
    // 절대 경로 안의 `~` 는 진짜 디렉터리 이름이다
    assert_eq!(normalize_remote("/home/~/a").unwrap(), "/home/~/a");
}

#[test]
fn collapses_redundant_separators() {
    assert_eq!(normalize_remote("  ~//a//./b  ").unwrap(), "a/b");
    assert_eq!(normalize_remote("/etc//nginx/").unwrap(), "/etc/nginx");
}

#[test]
fn rejects_parent_traversal() {
    for path in ["../etc/passwd", "~/../../etc", "/var/../etc", ".."] {
        let err = normalize_remote(path).unwrap_err();
        assert!(err.contains(".."), "{path}: {err}");
    }
}

#[test]
fn rejects_empty_remote_path() {
    assert!(normalize_remote("   ").unwrap_err().contains("원격 경로"));
}

// ── 업로드 파일 이름 ────────────────────────────────────────────────────

#[test]
fn accepts_plain_file_names() {
    assert_eq!(sanitize_file_name("  설정.conf  ").unwrap(), "설정.conf");
    assert_eq!(sanitize_file_name("a b.tar.gz").unwrap(), "a b.tar.gz");
}

#[test]
fn rejects_paths_in_file_names() {
    for name in ["../x", "a/b", "a\\b", ".", "..", "  "] {
        assert!(sanitize_file_name(name).is_err(), "{name}");
    }
}

#[test]
fn joins_remote_paths() {
    assert_eq!(join_remote(".", "a.conf"), "a.conf");
    assert_eq!(join_remote("/etc", "a.conf"), "/etc/a.conf");
    assert_eq!(join_remote("/", "a.conf"), "/a.conf");
    assert_eq!(join_remote("etc/", "a.conf"), "etc/a.conf");
}

// ── 로컬 경로 매핑 ──────────────────────────────────────────────────────

#[test]
fn maps_edit_to_local_path() {
    let root = Path::new("C:\\data");
    let p = local_edit_path(root, 3, "/etc/nginx/nginx.conf");
    assert_eq!(p.file_name().unwrap(), "nginx.conf");
    let dir = p
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert_eq!(dir, "3-etc_nginx");
    assert!(p.starts_with(root.join("edit")));
}

/// 같은 이름·다른 디렉터리·다른 세션이 서로 덮어쓰지 않아야 한다.
#[test]
fn separates_same_name_in_different_places() {
    let root = Path::new("C:\\data");
    let a = local_edit_path(root, 1, "/etc/nginx.conf");
    let b = local_edit_path(root, 1, "nginx.conf");
    let c = local_edit_path(root, 2, "/etc/nginx.conf");
    assert_ne!(a, b);
    assert_ne!(a, c);
    // 같은 세션의 같은 경로는 **같은 자리**여야 한다 (다시 열면 이어서 편집)
    assert_eq!(a, local_edit_path(root, 1, "/etc/nginx.conf"));
}

#[test]
fn sanitizes_only_windows_illegal_chars() {
    assert_eq!(local_name("설정 파일.conf"), "설정 파일.conf");
    assert_eq!(local_name("a:b?c*.txt"), "a_b_c_.txt");
    assert_eq!(local_name("  "), "file");
}

// ── 헤더 디코드 ─────────────────────────────────────────────────────────

#[test]
fn decodes_percent_encoded_headers() {
    assert_eq!(percent_decode("nginx.conf").unwrap(), "nginx.conf");
    assert_eq!(percent_decode("%2Fetc%2Fnginx").unwrap(), "/etc/nginx");
    assert_eq!(percent_decode("a%20b").unwrap(), "a b");
    // 한글 이름 (UTF-8 3바이트 × 2)
    assert_eq!(percent_decode("%EC%84%A4%EC%A0%95").unwrap(), "설정");
    // `+` 는 공백이 아니다 (encodeURIComponent 는 `+` 를 그대로 둔다)
    assert_eq!(percent_decode("a+b").unwrap(), "a+b");
}

#[test]
fn rejects_broken_headers() {
    assert!(percent_decode("%2").is_err());
    assert!(percent_decode("%zz").is_err());
    assert!(percent_decode("%FF%FE").is_err()); // UTF-8 이 아니다
}

// ── 상한 문구 ───────────────────────────────────────────────────────────

#[test]
fn formats_sizes() {
    assert_eq!(human_size(512), "512B");
    assert_eq!(human_size(2048), "2.0KB");
    assert_eq!(human_size(EDIT_MAX_BYTES), "10.0MB");
    assert_eq!(human_size(UPLOAD_MAX_BYTES as u64), "100.0MB");
}

// ── 세션 정리 ───────────────────────────────────────────────────────────

/// 테스트끼리 전역 맵을 공유하므로 세션 id 를 겹치지 않게 크게 잡는다
/// (`port_forward` 테스트와 같은 규칙).
fn insert_dummy(session_id: u32, remote: &str) -> u32 {
    let id = NEXT_EDIT_ID.fetch_add(1, Ordering::Relaxed);
    let task = tokio::spawn(std::future::pending::<()>());
    EDITS.lock().unwrap().insert(
        id,
        Edit {
            session_id,
            remote_path: remote.to_string(),
            local_path: PathBuf::from("C:\\data\\aynx\\edit").join(base_name(remote)),
            file_name: base_name(remote).to_string(),
            abort: task.abort_handle(),
        },
    );
    id
}

#[tokio::test]
async fn lists_only_the_given_session() {
    let a = insert_dummy(800_001, "/etc/a.conf");
    let b = insert_dummy(800_001, "b.conf");
    let c = insert_dummy(800_002, "c.conf");

    assert_eq!(
        list_edits(800_001).iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![a, b]
    );
    assert_eq!(list_edits(800_001)[0].remote_path, "/etc/a.conf");
    assert_eq!(
        list_edits(800_002).iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![c]
    );

    stop_session_sftp(800_001);
    stop_session_sftp(800_002);
}

#[tokio::test]
async fn session_cleanup_stops_only_that_session() {
    insert_dummy(800_011, "a.conf");
    insert_dummy(800_011, "b.conf");
    insert_dummy(800_012, "c.conf");

    assert_eq!(stop_session_sftp(800_011), 2);
    assert!(list_edits(800_011).is_empty());
    assert_eq!(list_edits(800_012).len(), 1);
    // 두 번째 정리는 아무것도 하지 않는다
    assert_eq!(stop_session_sftp(800_011), 0);
    stop_session_sftp(800_012);
}

#[tokio::test]
async fn stop_edit_is_idempotent() {
    let id = insert_dummy(800_021, "a.conf");
    stop_edit(id).unwrap();
    assert!(list_edits(800_021).is_empty());
    // 이미 사라진 id 도 오류가 아니다 (세션이 먼저 닫힌 뒤의 [중지] 클릭)
    stop_edit(id).unwrap();
}
