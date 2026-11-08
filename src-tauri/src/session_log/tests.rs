use super::*;

/// std 만으로 만드는 임시 디렉터리 (sessions_meta 테스트와 같은 방식).
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aynx-session-log-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn korean_and_ordinary_aliases_survive_untouched() {
    assert_eq!(sanitize_alias("web-01"), "web-01");
    assert_eq!(sanitize_alias("내 서버"), "내 서버");
    assert_eq!(sanitize_alias("서버_1.example.com"), "서버_1.example.com");
}

#[test]
fn forbidden_characters_are_replaced() {
    assert_eq!(
        sanitize_alias(r#"a\b/c:d*e?f"g<h>i|j"#),
        "a_b_c_d_e_f_g_h_i_j"
    );
    // 제어 문자도 (별칭은 사용자가 적는 값이라 무엇이든 들어올 수 있다)
    assert_eq!(sanitize_alias("a\nb\tc"), "a_b_c");
}

#[test]
fn trailing_dots_and_spaces_are_stripped() {
    // Windows 가 조용히 잘라 내는 것들 — 미리 떼어야 만든 파일을 다시 열 수 있다.
    assert_eq!(sanitize_alias("web."), "web");
    assert_eq!(sanitize_alias("web... "), "web");
    assert_eq!(sanitize_alias("  web  "), "web");
}

#[test]
fn an_alias_that_vanishes_falls_back_to_a_fixed_stem() {
    assert_eq!(sanitize_alias(""), FALLBACK_STEM);
    assert_eq!(sanitize_alias("   "), FALLBACK_STEM);
    assert_eq!(sanitize_alias("..."), FALLBACK_STEM);
}

#[test]
fn long_aliases_are_cut_on_character_boundaries() {
    let long = "가".repeat(200);
    let out = sanitize_alias(&long);
    assert_eq!(out.chars().count(), MAX_STEM_CHARS);
    // 바이트 중간에서 잘리지 않았다 (잘렸으면 이 비교 자체가 불가능하다).
    assert!(out.chars().all(|c| c == '가'));
}

#[test]
fn file_name_has_the_expected_shape() {
    assert_eq!(
        log_file_name("web", "20260902-134500", 1),
        "web-20260902-134500.log"
    );
    assert_eq!(
        log_file_name("a/b", "20260902-134500", 1),
        "a_b-20260902-134500.log"
    );
    // 두 번째부터는 차례 접미사
    assert_eq!(
        log_file_name("web", "20260902-134500", 2),
        "web-20260902-134500-2.log"
    );
    // 실제 시각도 같은 모양인지 (자리수·구분자)
    let stamp = now_stamp();
    assert_eq!(stamp.len(), 15, "{stamp}");
    assert_eq!(stamp.as_bytes()[8], b'-', "{stamp}");
    assert!(
        stamp
            .chars()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit()),
        "{stamp}"
    );
}

/// tee 의 핵심 계약: **바이트가 도착한 그대로** 파일에 들어간다.
/// 이스케이프 시퀀스도, UTF-8 중간에서 쪼개진 청크도 손대지 않는다 (4단계 로그 재생의 재료).
#[test]
fn the_writer_preserves_bytes_verbatim_and_flushes_on_close() {
    let tmp = TempDir::new();
    let (path, file) = create_unique_in(&tmp.0, "t", "20260902-134500").expect("파일");
    let tx = spawn_writer(&path, file);

    // OSC 133 마커 · 색 시퀀스 · 커서 이동이 섞인 실제 출력 모양
    let chunks: Vec<Vec<u8>> = vec![
        b"\x1b]133;A\x07\x1b[32muser@host\x1b[0m$ ".to_vec(),
        b"echo \xed\x95\x9c".to_vec(), // "한" 의 앞 3바이트 전부
        vec![0xea, 0xb8],              // "글" 의 앞 2바이트 — 청크 경계가 글자 중간이다
        vec![0x80, b'\r', b'\n'],      // 나머지 1바이트
        b"\x1b]133;D;1\x07".to_vec(),
    ];
    let mut expected = Vec::new();
    for c in &chunks {
        expected.extend_from_slice(c);
        tx.send(c.clone()).expect("전송");
    }

    // 송신자를 떨어뜨리면 스레드가 flush 하고 끝난다.
    drop(tx);
    // 스레드가 끝날 때까지 기다린다 (파일 내용이 확정되는 시점).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let got = std::fs::read(&path).unwrap_or_default();
        if got == expected {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "flush 되지 않았다: {got:?}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// 파일 내용이 `expected` 가 될 때까지 기다린다(쓰기 스레드의 flush 시점).
fn wait_for_content(path: &Path, expected: &[u8]) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let got = std::fs::read(path).unwrap_or_default();
        if got == expected {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{}: {got:?}",
            path.display()
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// 이미 있는 같은 이름의 파일은 **건드리지 않고** `-2` 로 비켜 간다 (예전엔 이어 썼다).
#[test]
fn an_existing_log_is_never_appended_to() {
    let tmp = TempDir::new();
    let first = tmp.0.join("web-20260902-134500.log");
    std::fs::write(&first, b"before\n").expect("쓰기");

    let (path, file) = create_unique_in(&tmp.0, "web", "20260902-134500").expect("파일");
    assert_eq!(path, tmp.0.join("web-20260902-134500-2.log"));
    let tx = spawn_writer(&path, file);
    tx.send(b"after\n".to_vec()).expect("전송");
    drop(tx);

    wait_for_content(&path, b"after\n");
    assert_eq!(std::fs::read(&first).expect("읽기"), b"before\n");
}

/// 같은 호스트 타일 둘이 **같은 초**에 열려도(배치 복원) 파일이 갈리고 내용이 섞이지 않는다.
#[test]
fn two_writers_with_the_same_stamp_get_separate_files() {
    let tmp = TempDir::new();
    let (pa, fa) = create_unique_in(&tmp.0, "web", "20260902-134500").expect("첫째");
    let (pb, fb) = create_unique_in(&tmp.0, "web", "20260902-134500").expect("둘째");
    assert_eq!(pa, tmp.0.join("web-20260902-134500.log"));
    assert_eq!(pb, tmp.0.join("web-20260902-134500-2.log"));

    let ta = spawn_writer(&pa, fa);
    let tb = spawn_writer(&pb, fb);
    for _ in 0..3 {
        ta.send(b"A".to_vec()).expect("전송");
        tb.send(b"B".to_vec()).expect("전송");
    }
    drop(ta);
    drop(tb);

    wait_for_content(&pa, b"AAA");
    wait_for_content(&pb, b"BBB");
}

/// "로그 폴더 열기" 가 기대는 계약: **없으면 만들고, 있으면 가만히 둔다.**
/// (없는 폴더를 그대로 답해 탐색기가 "찾을 수 없습니다" 를 띄우던 것이 고친 버그다.)
#[test]
fn ensuring_the_logs_dir_creates_it_and_is_idempotent() {
    let tmp = TempDir::new();
    // 실제 모양과 같은 중첩 경로 (`<data_dir>/aynx/logs`) — 한 번에 두 단계가 생겨야 한다.
    let dir = tmp.0.join("aynx").join("logs");
    assert!(!dir.exists());

    ensure_logs_dir_at(&dir).expect("폴더 생성");
    assert!(dir.is_dir());

    // 두 번째 호출은 아무 일도 하지 않는다 — 안의 파일도 그대로다.
    let keep = dir.join("web-20260917-010203.log");
    std::fs::write(&keep, b"kept").expect("쓰기");
    ensure_logs_dir_at(&dir).expect("이미 있어도 성공");
    assert_eq!(std::fs::read(&keep).expect("읽기"), b"kept");
}

/// 폴더 자리에 **파일**이 있으면 만들 수 없다 — 패닉이 아니라 보일 한 줄이 나온다.
#[test]
fn ensuring_a_path_blocked_by_a_file_is_an_error() {
    let tmp = TempDir::new();
    let blocked = tmp.0.join("logs");
    std::fs::write(&blocked, b"not a folder").expect("쓰기");
    assert!(ensure_logs_dir_at(&blocked).is_err());
}

#[test]
fn opening_an_impossible_path_is_an_error_not_a_panic() {
    let tmp = TempDir::new();
    // 폴더가 아닌 자리(파일) 안에는 로그를 만들 수 없다.
    let blocked = tmp.0.join("not-a-dir");
    std::fs::write(&blocked, b"x").expect("쓰기");
    assert!(create_unique_in(&blocked, "web", "20260902-134500").is_err());
}
