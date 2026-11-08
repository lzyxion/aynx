use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

// ssh-keygen 으로 생성한 고정 테스트 키 (새 의존성 없이 파싱만 한다).
const KEY_A: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ7I5J1hmFJDc8kN9+LqhN3z+6JwLWkh7g7K9aMtxhkO test-a";
const KEY_A_FP: &str = "SHA256:WIpJIv894VmU5sjZFf6WspSgaDiwt9t6hcz0+6dlGQ0";

const KEY_B: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHOw9Cb1dnDSbUzLXH1pYTXdnxCCzKUsYu2zWC5uw9Ja test-b";
const KEY_B_FP: &str = "SHA256:sab7xzQH9P4camo4ecZVaUUTTbD6GNYnk9lF2xvmUgE";

// 다른 알고리즘 (ECDSA) — OpenSSH 는 같은 호스트에 키 타입별로 별도 항목을 허용한다.
const KEY_C_ECDSA: &str = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAk6UaifKkyKbp7BwgvzwgEAujYG5O2idFN0wxb4mRammkUWLXjvCO/NCHd0xviOZZLmnDPaXg+9eu+8UAVdkV8= test-c";

fn key(openssh: &str) -> PublicKey {
    PublicKey::from_openssh(openssh).expect("테스트 키 파싱")
}

/// std 만으로 만드는 임시 디렉터리 (tempfile 의존성 추가 금지 조건).
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aynx-known-hosts-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
        TempDir(dir)
    }

    fn file(&self) -> PathBuf {
        self.0.join("known_hosts")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn fingerprint_is_openssh_sha256_format() {
    assert_eq!(fingerprint(&key(KEY_A)), KEY_A_FP);
    assert_eq!(fingerprint(&key(KEY_B)), KEY_B_FP);
    assert_eq!(key_type(&key(KEY_A)), "ssh-ed25519");
    assert_eq!(key_type(&key(KEY_C_ECDSA)), "ecdsa-sha2-nistp256");
}

#[test]
fn missing_file_is_unknown() {
    let tmp = TempDir::new();
    // 파일 자체가 없는 경우 (첫 실행) 도 Unknown 이어야 한다.
    let status = check_at("example.com", 22, &key(KEY_A), tmp.file()).unwrap();
    assert_eq!(
        status,
        HostKeyStatus::Unknown {
            fingerprint: KEY_A_FP.into(),
            key_type: "ssh-ed25519".into(),
        }
    );
}

#[test]
fn empty_file_is_unknown() {
    let tmp = TempDir::new();
    std::fs::write(tmp.file(), b"").unwrap();
    let status = check_at("example.com", 22, &key(KEY_A), tmp.file()).unwrap();
    assert!(matches!(status, HostKeyStatus::Unknown { .. }));
}

#[test]
fn tofu_flow_unknown_then_learn_then_known() {
    let tmp = TempDir::new();
    let path = tmp.file();
    let k = key(KEY_A);

    assert!(matches!(
        check_at("example.com", 22, &k, &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));

    learn_at("example.com", 22, &k, &path).unwrap();

    assert_eq!(
        check_at("example.com", 22, &k, &path).unwrap(),
        HostKeyStatus::Known
    );
}

#[test]
fn different_key_same_algorithm_is_changed() {
    let tmp = TempDir::new();
    let path = tmp.file();

    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();

    let status = check_at("example.com", 22, &key(KEY_B), &path).unwrap();
    assert_eq!(
        status,
        HostKeyStatus::Changed {
            fingerprint: KEY_B_FP.into(),
            key_type: "ssh-ed25519".into(),
            // 기록돼 있던 쪽(A)의 지문이 함께 실려야 다이얼로그가 "무엇에서 무엇으로" 를 말한다.
            old_fingerprint: Some(KEY_A_FP.into()),
        }
    );
}

#[test]
fn non_default_port_is_recorded_and_matched_separately() {
    let tmp = TempDir::new();
    let path = tmp.file();
    let k = key(KEY_A);

    learn_at("example.com", 2222, &k, &path).unwrap();

    // [host]:port 형식으로 기록된다.
    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(
        contents.contains("[example.com]:2222 "),
        "실제 내용: {contents}"
    );

    assert_eq!(
        check_at("example.com", 2222, &k, &path).unwrap(),
        HostKeyStatus::Known
    );
    // 포트가 다르면 별개 호스트로 취급 → 여전히 Unknown.
    assert!(matches!(
        check_at("example.com", 22, &k, &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));
    // 다른 호스트도 마찬가지.
    assert!(matches!(
        check_at("other.example.com", 2222, &k, &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));
}

#[test]
fn different_algorithm_is_unknown_not_changed() {
    let tmp = TempDir::new();
    let path = tmp.file();

    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();

    // 같은 호스트라도 키 타입이 다르면 MITM 이 아니라 아직 모르는 키다.
    assert!(matches!(
        check_at("example.com", 22, &key(KEY_C_ECDSA), &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));

    // 두 타입이 공존할 수 있다.
    learn_at("example.com", 22, &key(KEY_C_ECDSA), &path).unwrap();
    assert_eq!(
        check_at("example.com", 22, &key(KEY_A), &path).unwrap(),
        HostKeyStatus::Known
    );
    assert_eq!(
        check_at("example.com", 22, &key(KEY_C_ECDSA), &path).unwrap(),
        HostKeyStatus::Known
    );
}

#[test]
fn learn_creates_parent_directory() {
    let tmp = TempDir::new();
    let nested = tmp.0.join("nested").join(".ssh").join("known_hosts");
    learn_at("example.com", 22, &key(KEY_A), &nested).unwrap();
    assert!(nested.exists());
    assert_eq!(
        check_at("example.com", 22, &key(KEY_A), &nested).unwrap(),
        HostKeyStatus::Known
    );
}

/// 회귀 테스트: 주석이 붙은 키가 Changed 로 오판되면 안 된다.
/// (russh 는 `PublicKey` 의 comment 까지 비교하므로 정규화가 필요하다.)
#[test]
fn comment_does_not_affect_matching() {
    let tmp = TempDir::new();
    let path = tmp.file();

    // 주석 있는 키로 기록.
    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();
    // 기록된 줄에는 주석이 남지 않아야 한다.
    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(!contents.contains("test-a"), "실제 내용: {contents}");

    // 주석이 다른 동일 키로 검증해도 Known.
    let mut renamed = key(KEY_A);
    renamed.set_comment("someone@elsewhere");
    assert_eq!(
        check_at("example.com", 22, &renamed, &path).unwrap(),
        HostKeyStatus::Known
    );

    // 주석 없는 동일 키도 Known.
    assert_eq!(
        check_at("example.com", 22, &without_comment(&key(KEY_A)), &path).unwrap(),
        HostKeyStatus::Known
    );
}

#[test]
fn extract_public_key_unwraps_enum() {
    let k = key(KEY_A);
    let wrapped: PublicKeyOrCertificate = k.clone().into();
    assert_eq!(fingerprint(&extract_public_key(&wrapped)), fingerprint(&k));
}

#[test]
fn status_serializes_with_snake_case_tag() {
    let known = serde_json::to_string(&HostKeyStatus::Known).unwrap();
    assert_eq!(known, r#"{"status":"known"}"#);

    let changed = serde_json::to_string(&HostKeyStatus::Changed {
        fingerprint: KEY_A_FP.into(),
        key_type: "ssh-ed25519".into(),
        old_fingerprint: None,
    })
    .unwrap();
    assert!(changed.starts_with(r#"{"status":"changed","fingerprint":"SHA256:"#));
}

// -----------------------------------------------------------------------
// 지우기·교체 (2026-09-16)
// -----------------------------------------------------------------------

/// `ssh-keygen -H` 가 만든 해시 항목 하나 — 호스트는 `example.com`(22번).
/// (러시의 자체 테스트 픽스처와 같은 줄이라 계산이 맞는지 서로 교차 검증된다.)
const HASHED_EXAMPLE_COM: &str = "|1|O33ESRMWPVkMYIwJ1Uw+n877jTo=|nuuC5vEqXlEZ/8BXQR7m619W6Ak=";

#[test]
fn host_pattern_uses_brackets_only_for_non_default_port() {
    assert_eq!(host_pattern("example.com", 22), "example.com");
    assert_eq!(host_pattern("example.com", 2222), "[example.com]:2222");
}

#[test]
fn field_matches_plain_and_comma_lists() {
    assert!(field_matches("example.com", "example.com"));
    assert!(field_matches(
        "a.example,example.com,b.example",
        "example.com"
    ));
    assert!(field_matches("[example.com]:2222", "[example.com]:2222"));
    // 포트가 다르면 다른 호스트다.
    assert!(!field_matches("example.com", "[example.com]:2222"));
    assert!(!field_matches("other.example", "example.com"));
}

#[test]
fn field_matches_hashed_entries() {
    assert!(field_matches(HASHED_EXAMPLE_COM, "example.com"));
    assert!(!field_matches(HASHED_EXAMPLE_COM, "other.example"));
    // 소금·해시가 망가진 줄은 조용히 넘어간다 (파일 하나가 통째로 못 쓰이면 안 된다).
    assert!(!field_matches("|1|not-base64|!!!", "example.com"));
    assert!(!field_matches("|1|", "example.com"));
}

#[test]
fn pattern_matches_wildcards_and_question_marks() {
    assert!(pattern_matches("*.example.com", "web.example.com", 22));
    assert!(pattern_matches("*.example.com", "a.b.example.com", 22));
    // `*` 는 0글자도 먹지만 점 하나는 패턴에 적혀 있어야 한다.
    assert!(!pattern_matches("*.example.com", "example.com", 22));
    assert!(pattern_matches("10.0.0.*", "10.0.0.7", 22));
    assert!(!pattern_matches("10.0.0.*", "10.0.1.7", 22));
    assert!(pattern_matches(
        "web-0?.example.com",
        "web-01.example.com",
        22
    ));
    assert!(!pattern_matches(
        "web-0?.example.com",
        "web-011.example.com",
        22
    ));
    // 호스트 이름은 대소문자를 가리지 않는다 (OpenSSH 와 같다).
    assert!(pattern_matches("*.EXAMPLE.com", "web.example.com", 22));
    // 와일드카드가 없는 패턴은 자기 자신하고만 맞는다 — 예전의 글자 비교 그대로다.
    assert!(pattern_matches("example.com", "example.com", 22));
    assert!(!pattern_matches("other.example", "example.com", 22));
}

#[test]
fn pattern_matches_uses_the_recorded_host_port_spelling() {
    // 기본 포트가 아니면 대상 글자가 `[host]:port` 라, 패턴도 그 모양이어야 덮는다.
    assert!(pattern_matches(
        "[*.example.com]:2222",
        "web.example.com",
        2222
    ));
    assert!(!pattern_matches("*.example.com", "web.example.com", 2222));
    assert!(!pattern_matches(
        "[*.example.com]:2222",
        "web.example.com",
        22
    ));
}

#[test]
fn pattern_matches_lists_and_negation() {
    // 쉼표 목록 — 하나만 맞아도 참.
    assert!(pattern_matches(
        "a.example,*.example.com,b.example",
        "web.example.com",
        22
    ));
    // 부정이 맞으면 **순서와 무관하게** 거짓이다 (OpenSSH 의 `match_pattern_list`).
    assert!(!pattern_matches(
        "*.example.com,!secure.example.com",
        "secure.example.com",
        22
    ));
    assert!(!pattern_matches(
        "!secure.example.com,*.example.com",
        "secure.example.com",
        22
    ));
    // 그 목록의 다른 호스트는 여전히 맞는다.
    assert!(pattern_matches(
        "*.example.com,!secure.example.com",
        "web.example.com",
        22
    ));
    // 부정만 있는 목록은 아무것도 덮지 않는다 (긍정이 하나도 없다).
    assert!(!pattern_matches(
        "!secure.example.com",
        "web.example.com",
        22
    ));
    // 해시된 항목은 패턴 판정에서 빠진다 (그쪽은 HMAC 으로 본다).
    assert!(!pattern_matches(HASHED_EXAMPLE_COM, "example.com", 22));
    assert!(field_matches(HASHED_EXAMPLE_COM, "example.com"));
}

#[test]
fn line_targets_skips_comments_blanks_and_markers() {
    assert!(line_targets(
        "example.com ssh-ed25519 AAAA\n",
        "example.com"
    ));
    assert!(!line_targets(
        "# example.com ssh-ed25519 AAAA\n",
        "example.com"
    ));
    assert!(!line_targets("\n", "example.com"));
    assert!(!line_targets("   ", "example.com"));
    assert!(!line_targets(
        "@cert-authority example.com ssh-ed25519 AAAA\n",
        "example.com"
    ));
    assert!(!line_targets(
        "@revoked example.com ssh-ed25519 AAAA\n",
        "example.com"
    ));
}

#[test]
fn forget_removes_only_matching_lines_and_keeps_the_rest_byte_for_byte() {
    let tmp = TempDir::new();
    let path = tmp.file();
    // 손으로 적은 주석·빈 줄·CRLF 가 섞인 파일. 지운 줄 말고는 바이트가 같아야 한다.
    let original = "# 내가 적어 둔 주석\r\n\
             other.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHOw9Cb1dnDSbUzLXH1pYTXdnxCCzKUsYu2zWC5uw9Ja\r\n\
             \r\n\
             example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ7I5J1hmFJDc8kN9+LqhN3z+6JwLWkh7g7K9aMtxhkO\n\
             @cert-authority example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ7I5J1hmFJDc8kN9+LqhN3z+6JwLWkh7g7K9aMtxhkO\n";
    std::fs::write(&path, original).unwrap();

    assert_eq!(forget_at("example.com", 22, &path).unwrap(), 1);

    let after = std::fs::read_to_string(&path).unwrap();
    let expected: String = original
        .split_inclusive('\n')
        .filter(|l| !l.starts_with("example.com "))
        .collect();
    assert_eq!(after, expected);
    // 마커 줄은 살아 있다.
    assert!(after.contains("@cert-authority"));
}

#[test]
fn forget_matches_hashed_entries_too() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(
        &path,
        format!("{HASHED_EXAMPLE_COM} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ7I5J1hmFJDc8kN9+LqhN3z+6JwLWkh7g7K9aMtxhkO\n"),
    )
    .unwrap();
    assert_eq!(forget_at("example.com", 22, &path).unwrap(), 1);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
}

#[test]
fn forget_removes_matching_pattern_lines_too() {
    let tmp = TempDir::new();
    let path = tmp.file();
    // 넷 중 둘이 대상이다: 와일드카드 줄과 정확한 줄. 부정이 붙은 줄과 남의 대역은 남는다.
    let original = "*.example.com ssh-ed25519 AAAA1\n\
             web.example.com ssh-ed25519 AAAA2\n\
             *.example.com,!web.example.com ssh-ed25519 AAAA3\n\
             10.0.0.* ssh-ed25519 AAAA4\n\
             @cert-authority *.example.com ssh-ed25519 AAAA5\n";
    std::fs::write(&path, original).unwrap();

    assert_eq!(forget_at("web.example.com", 22, &path).unwrap(), 2);

    let after = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        after,
        "*.example.com,!web.example.com ssh-ed25519 AAAA3\n\
             10.0.0.* ssh-ed25519 AAAA4\n\
             @cert-authority *.example.com ssh-ed25519 AAAA5\n"
    );
}

#[test]
fn forget_is_a_no_op_when_nothing_matches() {
    let tmp = TempDir::new();
    let path = tmp.file();
    // 없는 파일도 오류가 아니다.
    assert_eq!(forget_at("example.com", 22, &path).unwrap(), 0);

    std::fs::write(&path, "other.example ssh-ed25519 AAAA\n").unwrap();
    assert_eq!(forget_at("example.com", 22, &path).unwrap(), 0);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "other.example ssh-ed25519 AAAA\n"
    );
}

#[test]
fn forget_separates_ports() {
    let tmp = TempDir::new();
    let path = tmp.file();
    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();
    learn_at("example.com", 2222, &key(KEY_A), &path).unwrap();

    assert_eq!(forget_at("example.com", 2222, &path).unwrap(), 1);
    assert_eq!(
        check_at("example.com", 22, &key(KEY_A), &path).unwrap(),
        HostKeyStatus::Known
    );
    assert!(matches!(
        check_at("example.com", 2222, &key(KEY_A), &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));
}

#[test]
fn forget_removes_every_key_type_of_that_host() {
    let tmp = TempDir::new();
    let path = tmp.file();
    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();
    learn_at("example.com", 22, &key(KEY_C_ECDSA), &path).unwrap();

    assert_eq!(forget_at("example.com", 22, &path).unwrap(), 2);
    assert!(matches!(
        check_at("example.com", 22, &key(KEY_A), &path).unwrap(),
        HostKeyStatus::Unknown { .. }
    ));
}

#[test]
fn replace_swaps_the_changed_key_and_then_it_is_known() {
    let tmp = TempDir::new();
    let path = tmp.file();
    learn_at("example.com", 22, &key(KEY_A), &path).unwrap();

    // 바뀐 키 — 옛 지문이 실려 온다.
    assert_eq!(
        check_at("example.com", 22, &key(KEY_B), &path).unwrap(),
        HostKeyStatus::Changed {
            fingerprint: KEY_B_FP.into(),
            key_type: "ssh-ed25519".into(),
            old_fingerprint: Some(KEY_A_FP.into()),
        }
    );

    assert_eq!(
        replace_at("example.com", 22, &key(KEY_B), &path).unwrap(),
        1
    );

    assert_eq!(
        check_at("example.com", 22, &key(KEY_B), &path).unwrap(),
        HostKeyStatus::Known
    );
    // 옛 줄은 남지 않았다 — 키 줄이 정확히 하나다. (빈 줄은 세지 않는다: russh 의
    // `learn_known_hosts_path` 는 비어 있는 파일 끝에 개행을 하나 먼저 적는다.)
    let contents = std::fs::read_to_string(&path).unwrap();
    let keys: Vec<&str> = contents.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(keys.len(), 1, "실제 내용: {contents:?}");
    assert!(!contents.contains(KEY_A.split(' ').nth(1).unwrap()));
}
