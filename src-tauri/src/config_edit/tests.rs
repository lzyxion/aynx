use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

/// std 만으로 만드는 임시 디렉터리 (known_hosts 테스트와 같은 방식 — 새 의존성 없이).
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aynx-config-edit-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
        TempDir(dir)
    }

    fn file(&self) -> PathBuf {
        self.0.join("config")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn minimal(name: &str, host_name: &str) -> NewHost {
    NewHost {
        name: name.to_string(),
        host_name: host_name.to_string(),
        user: None,
        port: None,
        identity_file: None,
        identities_only: None,
        proxy_jump: None,
    }
}

fn full() -> NewHost {
    NewHost {
        name: "web".to_string(),
        host_name: "10.0.0.1".to_string(),
        user: Some("deploy".to_string()),
        port: Some(2222),
        identity_file: Some("~/.ssh/id_ed25519".to_string()),
        identities_only: None,
        proxy_jump: None,
    }
}

// --- 별칭 검증 -------------------------------------------------------

#[test]
fn alias_trims_and_accepts_normal_names() {
    assert_eq!(validate_alias("  web  ").unwrap(), "web");
    assert_eq!(validate_alias("prod-web.01_a").unwrap(), "prod-web.01_a");
    assert_eq!(validate_alias("한글별칭").unwrap(), "한글별칭");
}

#[test]
fn alias_rejects_empty_and_whitespace() {
    assert_eq!(validate_alias("").unwrap_err(), "별칭을 입력하세요");
    assert_eq!(validate_alias("   ").unwrap_err(), "별칭을 입력하세요");
    assert_eq!(
        validate_alias("my host").unwrap_err(),
        "별칭에 공백을 쓸 수 없습니다"
    );
    assert!(validate_alias("a\tb").is_err());
}

#[test]
fn alias_rejects_wildcards() {
    // 패턴 블록은 사이드바 목록에 뜨지 않는다 — 입력 단계에서 막는다.
    for bad in ["web*", "*", "web?", "!secret", "pro!d"] {
        let err = validate_alias(bad).unwrap_err();
        assert!(err.contains("와일드카드"), "{bad} → {err}");
    }
}

#[test]
fn alias_rejects_quotes_and_structural_chars() {
    assert!(validate_alias("\"web\"").unwrap_err().contains("따옴표"));
    assert!(validate_alias("web#1").unwrap_err().contains("따옴표"));
    assert!(validate_alias("web=1").unwrap_err().contains("="));
    assert!(validate_alias("web\nHost evil").is_err());
}

// --- 나머지 필드 검증 -------------------------------------------------

#[test]
fn host_name_is_required() {
    assert_eq!(
        validate(&minimal("web", "  ")).unwrap_err(),
        "호스트 주소를 입력하세요"
    );
    assert_eq!(
        validate(&minimal("web", "a b")).unwrap_err(),
        "호스트 주소에 공백을 쓸 수 없습니다"
    );
    assert!(validate(&minimal("web", "a\"b")).is_err());
}

#[test]
fn blank_optionals_become_none() {
    let host = NewHost {
        name: "web".into(),
        host_name: "10.0.0.1".into(),
        user: Some("   ".into()),
        port: None,
        identity_file: Some("".into()),
        identities_only: None,
        proxy_jump: Some("  ".into()),
    };
    let v = validate(&host).unwrap();
    assert_eq!(v.user, None);
    assert_eq!(v.identity_file, None);
    assert!(!v.identities_only);
    assert_eq!(v.proxy_jump, None);
    // 빈 값은 줄 자체가 나오지 않는다.
    assert_eq!(format_block(&v), "Host web\n    HostName 10.0.0.1\n");
}

#[test]
fn user_and_port_are_checked() {
    let mut host = full();
    host.user = Some("dep loy".into());
    assert!(validate(&host).unwrap_err().contains("사용자 이름"));

    let mut host = full();
    host.port = Some(0);
    assert_eq!(validate(&host).unwrap_err(), "포트는 1 이상이어야 합니다");
}

/// 경유 호스트 — 저장할 수 있는 것과 `ssh.rs` 가 실제로 열 수 있는 것이 같아야 한다.
#[test]
fn proxy_jump_is_checked() {
    // `[user@]host[:port]` 한 덩어리라 공백이 들어갈 자리가 없다.
    let mut host = full();
    host.proxy_jump = Some("bas tion".into());
    assert_eq!(
        validate(&host).unwrap_err(),
        "경유 호스트에 공백을 쓸 수 없습니다"
    );

    // 한 줄짜리 값의 공통 금지 문자는 같은 문지기를 쓴다.
    let mut host = full();
    host.proxy_jump = Some("bastion#1".into());
    assert!(validate(&host).unwrap_err().contains("따옴표"));

    // 여러 홉은 접속 단계가 거절하는 것과 **같은 한 줄**로 막는다.
    let mut host = full();
    host.proxy_jump = Some("a,b".into());
    assert_eq!(validate(&host).unwrap_err(), crate::ssh::multi_jump());

    // 자기 자신을 거쳐 자기에게 붙을 수는 없다 (대소문자 무시).
    let mut host = full();
    host.proxy_jump = Some("WEB".into());
    assert!(validate(&host).unwrap_err().contains("자기 자신"));

    // 정상 값은 trim 만 하고 그대로 통과한다.
    let mut host = full();
    host.proxy_jump = Some("  deploy@bastion:2222  ".into());
    assert_eq!(
        validate(&host).unwrap().proxy_jump.as_deref(),
        Some("deploy@bastion:2222")
    );
}

// --- 블록 포매팅 ------------------------------------------------------

#[test]
fn formats_full_block_with_four_space_indent() {
    let v = validate(&full()).unwrap();
    assert_eq!(
        format_block(&v),
        "\
Host web
    HostName 10.0.0.1
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
"
    );
}

#[test]
fn add_writes_the_proxy_jump_line_last() {
    let mut host = full();
    host.proxy_jump = Some("bastion".into());
    let block = format_block(&validate(&host).unwrap());
    assert_eq!(
        block,
        "\
Host web
    HostName 10.0.0.1
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump bastion
"
    );
    // 파서가 그대로 읽어 들인다 (적은 것과 보이는 것이 같다).
    let cfg = crate::ssh_config::parse(&block);
    assert_eq!(cfg.hosts[0].proxy_jump.as_deref(), Some("bastion"));
}

/// `IdentitiesOnly` 는 **켤 때만** 한 줄이 나가고, 자리는 `IdentityFile` 바로 뒤다.
#[test]
fn add_writes_the_identities_only_line_right_after_the_key() {
    let mut host = full();
    host.identities_only = Some(true);
    let block = format_block(&validate(&host).unwrap());
    assert_eq!(
        block,
        "\
Host web
    HostName 10.0.0.1
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
"
    );
    // 파서가 그대로 읽어 들인다 (적은 것과 보이는 것이 같다).
    let cfg = crate::ssh_config::parse(&block);
    assert!(cfg.hosts[0].identities_only);
    assert!(cfg.hosts[0].identities_only_own);

    // 꺼짐은 `no` 가 아니라 **줄 없음**이다 — `None` 과 `Some(false)` 가 같은 결과다.
    for off in [None, Some(false)] {
        let mut host = full();
        host.identities_only = off;
        let block = format_block(&validate(&host).unwrap());
        assert!(!block.contains("IdentitiesOnly"), "{block}");
    }
}

#[test]
fn identity_file_with_spaces_is_quoted() {
    let mut host = full();
    host.identity_file = Some("C:/Users/my name/.ssh/id_ed25519".into());
    let block = format_block(&validate(&host).unwrap());
    assert!(
        block.contains("    IdentityFile \"C:/Users/my name/.ssh/id_ed25519\"\n"),
        "{block}"
    );
}

// --- 개행 처리 --------------------------------------------------------

#[test]
fn append_to_empty_file_has_no_leading_blank_line() {
    let v = validate(&minimal("web", "10.0.0.1")).unwrap();
    assert_eq!(append_text("", &v), "Host web\n    HostName 10.0.0.1\n");
}

#[test]
fn append_after_missing_trailing_newline_closes_the_line_first() {
    let v = validate(&minimal("web", "10.0.0.1")).unwrap();
    // 기존 마지막 줄이 개행으로 끝나지 않으면 우리 블록이 그 줄에 붙어 버린다.
    let text = append_text("Host a\n    HostName a.example.com", &v);
    assert!(text.starts_with("\n\nHost web\n"), "{text:?}");
}

#[test]
fn append_after_trailing_newline_inserts_one_blank_line() {
    let v = validate(&minimal("web", "10.0.0.1")).unwrap();
    assert!(append_text("Host a\n", &v).starts_with("\nHost web\n"));
}

#[test]
fn append_does_not_stack_blank_lines() {
    let v = validate(&minimal("web", "10.0.0.1")).unwrap();
    // 이미 빈 줄로 끝난 파일에 또 빈 줄을 넣지 않는다 (반복 추가 시 간격이 벌어지지 않게).
    assert!(append_text("Host a\n\n", &v).starts_with("Host web\n"));
    assert!(append_text("Host a\r\n\r\n", &v).starts_with("Host web\n"));
}

// --- 파일 왕복 --------------------------------------------------------

#[test]
fn appended_host_round_trips_through_the_parser() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(
        &path,
        "# 사람이 쓴 주석\nHost old\n    HostName old.example.com\n",
    )
    .unwrap();

    add_host_at(&path, &full()).unwrap();

    let content = std::fs::read_to_string(&path).unwrap();
    // 기존 내용은 한 글자도 바뀌지 않는다.
    assert!(
        content.starts_with("# 사람이 쓴 주석\nHost old\n    HostName old.example.com\n"),
        "{content}"
    );

    let cfg = crate::ssh_config::parse(&content);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["old", "web"]);

    let added = cfg.hosts.iter().find(|h| h.name == "web").unwrap();
    assert_eq!(added.host_name.as_deref(), Some("10.0.0.1"));
    assert_eq!(added.user.as_deref(), Some("deploy"));
    assert_eq!(added.port, Some(2222));
    assert_eq!(added.identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
}

#[test]
fn creates_missing_directory_and_file() {
    let tmp = TempDir::new();
    let nested = tmp.0.join("home").join(".ssh").join("config");
    add_host_at(&nested, &minimal("web", "10.0.0.1")).unwrap();

    let content = std::fs::read_to_string(&nested).unwrap();
    assert_eq!(content, "Host web\n    HostName 10.0.0.1\n");
}

#[test]
fn duplicate_alias_is_rejected_case_insensitively() {
    let tmp = TempDir::new();
    let path = tmp.file();
    add_host_at(&path, &minimal("web", "10.0.0.1")).unwrap();

    let err = add_host_at(&path, &minimal("web", "10.0.0.2")).unwrap_err();
    assert_eq!(err, "이미 있는 별칭입니다");
    // ssh 의 호스트 매칭이 대소문자를 무시하므로 대문자 변형도 중복이다.
    assert_eq!(
        add_host_at(&path, &minimal("WEB", "10.0.0.3")).unwrap_err(),
        "이미 있는 별칭입니다"
    );

    // 거부된 시도가 파일을 건드리지 않았는지 확인.
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "Host web\n    HostName 10.0.0.1\n"
    );
}

#[test]
fn invalid_input_never_touches_the_file() {
    let tmp = TempDir::new();
    let path = tmp.file();
    assert!(add_host_at(&path, &minimal("web *", "10.0.0.1")).is_err());
    // 검증이 IO 앞에 있으므로 파일조차 생기지 않는다.
    assert!(!path.exists());
}

// --- 국소 블록 패치 ---------------------------------------------------

fn edit(original: &str, name: &str, host_name: &str) -> EditHost {
    EditHost {
        original_name: original.to_string(),
        name: name.to_string(),
        host_name: host_name.to_string(),
        user: None,
        port: None,
        identity_file: None,
        identities_only: None,
        proxy_jump: None,
    }
}

/// 패치만 하고 경고는 버린다 (경고를 보는 테스트는 따로).
fn patched(content: &str, host: &EditHost) -> String {
    patch_block(content, &host.original_name, host).unwrap().0
}

#[test]
fn patch_replaces_values_and_keeps_indentation_style() {
    let before = "\
Host web
  HostName 10.0.0.1
  User old
  Port 22
";
    let mut h = edit("web", "web", "10.0.0.9");
    h.user = Some("deploy".into());
    h.port = Some(2222);

    assert_eq!(
        patched(before, &h),
        "\
Host web
  HostName 10.0.0.9
  User deploy
  Port 2222
"
    );
}

#[test]
fn patch_removes_cleared_options_and_appends_new_ones() {
    let before = "\
Host web
    HostName 10.0.0.1
    User old
    Port 2222
";
    // user·port 를 비우고 IdentityFile 을 새로 채운다.
    let mut h = edit("web", "web", "10.0.0.1");
    h.identity_file = Some("~/.ssh/id_ed25519".into());

    assert_eq!(
        patched(before, &h),
        "\
Host web
    HostName 10.0.0.1
    IdentityFile ~/.ssh/id_ed25519
"
    );
}

/// 경유 호스트 줄의 세 걸음 — **없던 줄을 더하고 · 값을 바꾸고 · 비우면 지운다.**
/// (`IdentityFile`·`Port` 와 같은 규칙이라는 것이 이 테스트의 요점이다.)
#[test]
fn patch_adds_changes_and_removes_the_proxy_jump_line() {
    let plain = "Host web\n    HostName 10.0.0.1\n";

    // ① 없던 줄을 더한다 — 블록 끝에.
    let mut h = edit("web", "web", "10.0.0.1");
    h.proxy_jump = Some("bastion".into());
    let added = patched(plain, &h);
    assert_eq!(
        added,
        "Host web\n    HostName 10.0.0.1\n    ProxyJump bastion\n"
    );

    // ② 값을 바꾼다 — 줄은 제자리에 남는다.
    let mut h = edit("web", "web", "10.0.0.1");
    h.proxy_jump = Some("deploy@bastion:2222".into());
    assert_eq!(
        patched(&added, &h),
        "Host web\n    HostName 10.0.0.1\n    ProxyJump deploy@bastion:2222\n"
    );

    // ③ 비우면 줄이 사라진다 (다른 옵션의 "비우기" 와 같다).
    assert_eq!(patched(&added, &edit("web", "web", "10.0.0.1")), plain);
}

/// `IdentitiesOnly` 줄의 세 걸음 — **없던 줄을 더하고 · 그대로 두고 · 끄면 지운다.**
/// (`ProxyJump` 와 같은 규칙이라는 것이 이 테스트의 요점이다.)
#[test]
fn patch_adds_and_removes_the_identities_only_line() {
    let plain = "Host web\n    HostName 10.0.0.1\n    IdentityFile ~/.ssh/id_ed25519\n";

    // ① 없던 줄을 더한다 — 블록 끝에.
    let mut h = edit("web", "web", "10.0.0.1");
    h.identity_file = Some("~/.ssh/id_ed25519".into());
    h.identities_only = Some(true);
    let added = patched(plain, &h);
    assert_eq!(
        added,
        "Host web\n    HostName 10.0.0.1\n    IdentityFile ~/.ssh/id_ed25519\n    IdentitiesOnly yes\n"
    );

    // ② 다시 켠 채로 저장하면 그 줄은 **제자리**다 (한 벌이 쌓이지 않는다).
    assert_eq!(patched(&added, &h), added);

    // ③ 끄면 줄이 사라진다 — `None` 도 `Some(false)` 도 같다.
    for off in [None, Some(false)] {
        let mut h = edit("web", "web", "10.0.0.1");
        h.identity_file = Some("~/.ssh/id_ed25519".into());
        h.identities_only = off;
        assert_eq!(patched(&added, &h), plain, "{off:?}");
    }
}

/// 손으로 적어 둔 `IdentitiesOnly no` 는 켜면 `yes` 로 **갈아 끼운다** (줄은 제자리).
/// 그리고 `Host *` 의 값은 이 편집이 건드리지 않는다 — 블록 밖이기 때문이다.
#[test]
fn patch_replaces_an_existing_identities_only_value_and_leaves_the_wildcard_alone() {
    let before = "\
Host *
    IdentitiesOnly yes

Host web
    HostName 10.0.0.1
    IdentitiesOnly no
    User deploy
";
    let mut h = edit("web", "web", "10.0.0.1");
    h.user = Some("deploy".into());
    h.identities_only = Some(true);

    assert_eq!(
        patched(before, &h),
        "\
Host *
    IdentitiesOnly yes

Host web
    HostName 10.0.0.1
    IdentitiesOnly yes
    User deploy
"
    );

    // 끄면 이 블록의 줄만 사라지고 `Host *` 는 그대로다 (= 상속으로 되돌아간다).
    let mut h = edit("web", "web", "10.0.0.1");
    h.user = Some("deploy".into());
    assert_eq!(
        patched(before, &h),
        "\
Host *
    IdentitiesOnly yes

Host web
    HostName 10.0.0.1
    User deploy
"
    );
}

/// 경유 호스트를 고쳐도 블록의 나머지 줄(주석·미지원 옵션·다른 옵션)은 제자리다.
#[test]
fn patch_proxy_jump_leaves_the_other_lines_alone() {
    let before = "\
Host web
    # 사내망 전용
    HostName 10.0.0.1
    ProxyJump old-bastion
    StrictHostKeyChecking no
    User deploy
";
    let mut h = edit("web", "web", "10.0.0.1");
    h.user = Some("deploy".into());
    h.proxy_jump = Some("new-bastion".into());

    assert_eq!(
        patched(before, &h),
        "\
Host web
    # 사내망 전용
    HostName 10.0.0.1
    ProxyJump new-bastion
    StrictHostKeyChecking no
    User deploy
"
    );
}

/// 폼이 막지 못한 값이 올라와도 파일에는 닿지 않는다 — 검증이 IO 앞에 있다.
#[test]
fn patch_rejects_a_self_reference_and_multiple_hops() {
    let before = "Host web\n    HostName 10.0.0.1\n";

    let mut h = edit("web", "web", "10.0.0.1");
    h.proxy_jump = Some("web".into());
    assert!(patch_block(before, "web", &h)
        .unwrap_err()
        .contains("자기 자신"));

    let mut h = edit("web", "web", "10.0.0.1");
    h.proxy_jump = Some("a,b".into());
    assert_eq!(
        patch_block(before, "web", &h).unwrap_err(),
        crate::ssh::multi_jump()
    );
}

#[test]
fn patch_preserves_comments_and_unsupported_options_in_place() {
    let before = "\
Host web
    # 사내망 전용
    HostName 10.0.0.1
    StrictHostKeyChecking no
    ServerAliveInterval 30
    User old
    Compression yes
";
    let mut h = edit("web", "web", "10.0.0.2");
    h.user = Some("deploy".into());

    // 미지원 줄·주석은 순서까지 그대로. 우리 옵션만 자리에서 값이 바뀐다.
    assert_eq!(
        patched(before, &h),
        "\
Host web
    # 사내망 전용
    HostName 10.0.0.2
    StrictHostKeyChecking no
    ServerAliveInterval 30
    User deploy
    Compression yes
"
    );
}

#[test]
fn patch_never_touches_bytes_outside_the_block() {
    let before = "\
# 파일 머리 주석
Include ~/.ssh/conf.d/*

Host alpha
    HostName alpha.example.com
    Port 22

Host web
    HostName 10.0.0.1
    User old

Host omega
    HostName omega.example.com
    ServerAliveInterval 5
";
    let mut h = edit("web", "web", "10.0.0.9");
    h.user = Some("deploy".into());
    let after = patched(before, &h);

    let (head, _) = before.split_once("Host web").unwrap();
    let (_, tail) = before.split_once("\nHost omega").unwrap();
    // 앞뒤 영역이 바이트 단위로 그대로다.
    assert!(after.starts_with(head), "{after}");
    assert!(after.ends_with(&format!("\nHost omega{tail}")), "{after}");
    // 바뀐 것은 블록 안 두 줄뿐.
    assert!(after.contains("Host web\n    HostName 10.0.0.9\n    User deploy\n\n"));
    assert_eq!(after.matches("HostName").count(), 3);
}

#[test]
fn patch_renames_the_alias_only_on_the_host_line() {
    let before = "Host web\n    HostName 10.0.0.1\n";
    let after = patched(before, &edit("web", "web-new", "10.0.0.1"));
    assert_eq!(after, "Host web-new\n    HostName 10.0.0.1\n");

    // 파서가 새 이름으로 읽는다.
    let cfg = crate::ssh_config::parse(&after);
    assert_eq!(cfg.hosts.len(), 1);
    assert_eq!(cfg.hosts[0].name, "web-new");
}

#[test]
fn patch_rename_keeps_the_other_patterns_and_warns() {
    let before = "Host web staging  # 두 곳 공용\n    HostName 10.0.0.1\n";
    let h = edit("web", "web2", "10.0.0.1");
    let (after, warnings) = patch_block(before, "web", &h).unwrap();

    assert_eq!(
        after,
        "Host web2 staging  # 두 곳 공용\n    HostName 10.0.0.1\n"
    );
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("패턴 2개"), "{warnings:?}");
}

// --- 이름 바꾸기 ⑤ 다른 블록의 ProxyJump ------------------------------

/// 사용자 보고 그대로: `Remote-SSH` → `SSH` 로 바꿨더니 다른 블록의 `ProxyJump` 가
/// 없는 이름을 가리킨 채 남아 그 호스트가 경유 단계에서 실패했다.
#[test]
fn rename_retargets_proxy_jump_in_other_blocks() {
    let before = "\
Host before
    HostName 10.0.0.0
    ProxyJump Remote-SSH
Host Remote-SSH
    HostName 10.0.0.1
Host after
    HostName 10.0.0.2
    ProxyJump Remote-SSH
";
    let (after, warnings) =
        patch_block(before, "Remote-SSH", &edit("Remote-SSH", "SSH", "10.0.0.1")).unwrap();

    // 앞 블록도 뒤 블록도 따라간다.
    assert_eq!(
        after,
        "\
Host before
    HostName 10.0.0.0
    ProxyJump SSH
Host SSH
    HostName 10.0.0.1
Host after
    HostName 10.0.0.2
    ProxyJump SSH
"
    );
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("참조 2개"), "{warnings:?}");

    // 파서가 읽는 그림도 맞다 — 두 호스트가 새 이름을 거쳐 간다.
    let cfg = crate::ssh_config::parse(&after);
    for name in ["before", "after"] {
        let h = cfg.hosts.iter().find(|h| h.name == name).unwrap();
        assert_eq!(h.proxy_jump.as_deref(), Some("SSH"));
    }
}

/// 값의 모양 넷: 쉼표 목록 · `user@별칭:포트` · `=` 표기 · 줄 끝 주석.
/// **별칭 자리만** 바뀌고 나머지 글자는 제자리다.
#[test]
fn rename_replaces_only_the_alias_segment_of_a_jump_value() {
    let before = "\
Host Remote-SSH
    HostName 10.0.0.1
Host a
    ProxyJump gate,Remote-SSH
Host b
    ProxyJump deploy@Remote-SSH:2222
Host c
    ProxyJump=Remote-SSH  # 사내 경유
Host d
    ProxyJump Remote-SSH,tail
";
    let after = patched(before, &edit("Remote-SSH", "SSH", "10.0.0.1"));
    assert_eq!(
        after,
        "\
Host SSH
    HostName 10.0.0.1
Host a
    ProxyJump gate,SSH
Host b
    ProxyJump deploy@SSH:2222
Host c
    ProxyJump=SSH  # 사내 경유
Host d
    ProxyJump SSH,tail
"
    );
}

/// 걸리지 말아야 할 것들: 더 긴 별칭(`Remote-SSH2`) · 접두 별칭 · 값이 아닌 자리
/// (`HostName`·주석) · 우리 것이 아닌 옵션.
#[test]
fn rename_does_not_touch_look_alike_jump_values_or_other_lines() {
    let before = "\
# Remote-SSH 로 가는 길
Host Remote-SSH
    HostName 10.0.0.1
Host a
    ProxyJump Remote-SSH2
Host b
    ProxyJump Remote
Host c
    HostName Remote-SSH
    RemoteCommand ssh Remote-SSH
";
    let (after, warnings) =
        patch_block(before, "Remote-SSH", &edit("Remote-SSH", "SSH", "10.0.0.1")).unwrap();

    // 블록 밖에서 바뀐 것은 **하나도 없다** — 고친 것은 Host 줄뿐.
    assert_eq!(after, before.replacen("Host Remote-SSH\n", "Host SSH\n", 1));
    // 고친 참조가 없으면 알림도 없다.
    assert!(warnings.is_empty(), "{warnings:?}");
}

/// 이름을 바꾸지 않는 저장은 `ProxyJump` 줄을 스치지도 않는다 (자기 블록 값만 제 규칙대로).
#[test]
fn saving_without_a_rename_leaves_other_jump_lines_alone() {
    let before = "Host web\n    ProxyJump gate\nHost db\n    ProxyJump web\n";
    let mut h = edit("web", "web", "10.0.0.1");
    h.proxy_jump = Some("gate".into());
    assert_eq!(
        patched(before, &h),
        "Host web\n    ProxyJump gate\n    HostName 10.0.0.1\nHost db\n    ProxyJump web\n"
    );
}

/// 패턴 블록(`Host *`)도 **글자째 적혀 있으면** 따라간다 — 그 줄 역시 없는 이름을
/// 가리키게 되기 때문이다. CRLF 파일에서도 줄 모양이 그대로다.
#[test]
fn rename_retargets_a_pattern_block_and_keeps_crlf() {
    let before = "Host web\r\n    HostName 10.0.0.1\r\nHost *\r\n    ProxyJump web\r\n";
    let after = patched(before, &edit("web", "web-2", "10.0.0.1"));
    assert_eq!(
        after,
        "Host web-2\r\n    HostName 10.0.0.1\r\nHost *\r\n    ProxyJump web-2\r\n"
    );
}

#[test]
fn patch_rejects_an_alias_that_another_block_already_uses() {
    let before = "Host web\n    HostName 10.0.0.1\nHost db\n    HostName 10.0.0.2\n";
    let err = patch_block(before, "web", &edit("web", "db", "10.0.0.1")).unwrap_err();
    assert_eq!(err, "이미 있는 별칭입니다");

    // 자기 이름을 그대로 두는 것은 당연히 허용 (대소문자만 바꾸는 것도).
    assert!(patch_block(before, "web", &edit("web", "web", "10.0.0.1")).is_ok());
    let after = patched(before, &edit("web", "WEB", "10.0.0.1"));
    assert!(after.starts_with("Host WEB\n"), "{after}");
}

#[test]
fn patch_reports_a_missing_host() {
    let err = patch_block("Host web\n", "nope", &edit("nope", "nope", "1.1.1.1")).unwrap_err();
    assert_eq!(err, "호스트를 찾을 수 없습니다 — 목록을 새로고침하세요");
}

#[test]
fn patch_keeps_the_equals_form_of_an_existing_line() {
    let before = "Host=web\n    HostName=10.0.0.1\n    Port = 22\n";
    let mut h = edit("web", "web", "10.0.0.9");
    h.port = Some(2222);

    // 구분자(`=`, ` = `)를 원문 그대로 유지한 채 값만 바꾼다.
    assert_eq!(
        patched(before, &h),
        "Host=web\n    HostName=10.0.0.9\n    Port = 2222\n"
    );
}

#[test]
fn patch_keeps_trailing_comments_on_an_option_line() {
    let before = "Host web\n    Port 22  # 기본 포트\n    HostName 10.0.0.1\n";
    let mut h = edit("web", "web", "10.0.0.1");
    h.port = Some(2222);
    assert_eq!(
        patched(before, &h),
        "Host web\n    Port 2222  # 기본 포트\n    HostName 10.0.0.1\n"
    );
}

#[test]
fn patch_only_edits_the_first_block_of_a_repeated_alias() {
    let before = "\
Host web
    HostName first.example.com
Host web
    HostName second.example.com
";
    let (after, warnings) = patch_block(before, "web", &edit("web", "web", "10.0.0.9")).unwrap();
    assert_eq!(
        after,
        "\
Host web
    HostName 10.0.0.9
Host web
    HostName second.example.com
"
    );
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("첫 번째 블록만"), "{warnings:?}");
}

#[test]
fn patch_drops_duplicate_option_lines_inside_the_block() {
    // 같은 옵션이 두 번 있으면 첫 줄만 남긴다 — 남기면 first-wins 로 옛 값이 되살아난다.
    let before = "Host web\n    Port 22\n    Port 2200\n    HostName 10.0.0.1\n";
    let mut h = edit("web", "web", "10.0.0.1");
    h.port = Some(2222);
    assert_eq!(
        patched(before, &h),
        "Host web\n    Port 2222\n    HostName 10.0.0.1\n"
    );
}

#[test]
fn patch_appends_before_the_trailing_blank_line() {
    let before = "Host web\n    HostName 10.0.0.1\n\nHost db\n    HostName 10.0.0.2\n";
    let mut h = edit("web", "web", "10.0.0.1");
    h.user = Some("deploy".into());
    assert_eq!(
        patched(before, &h),
        "Host web\n    HostName 10.0.0.1\n    User deploy\n\nHost db\n    HostName 10.0.0.2\n"
    );
}

#[test]
fn patch_closes_a_file_that_ends_without_a_newline() {
    let before = "Host web\n    HostName 10.0.0.1";
    let mut h = edit("web", "web", "10.0.0.1");
    h.port = Some(2222);
    assert_eq!(
        patched(before, &h),
        "Host web\n    HostName 10.0.0.1\n    Port 2222\n"
    );
}

#[test]
fn patch_handles_a_block_without_any_option_line() {
    let before = "Host web\nHost db\n    HostName 10.0.0.2\n";
    assert_eq!(
        patched(before, &edit("web", "web", "10.0.0.1")),
        "Host web\n    HostName 10.0.0.1\nHost db\n    HostName 10.0.0.2\n"
    );
}

#[test]
fn patch_stops_at_a_match_block() {
    let before = "Host web\n    HostName 10.0.0.1\nMatch host web\n    User matched\n";
    assert_eq!(
        patched(before, &edit("web", "web", "10.0.0.9")),
        "Host web\n    HostName 10.0.0.9\nMatch host web\n    User matched\n"
    );
}

#[test]
fn patch_keeps_crlf_line_endings() {
    let before = "Host web\r\n    HostName 10.0.0.1\r\n    User old\r\n";
    let mut h = edit("web", "web-2", "10.0.0.9");
    h.user = None;
    h.port = Some(2222);
    // 고친 줄도, 새로 넣은 줄도 CRLF 다.
    assert_eq!(
        patched(before, &h),
        "Host web-2\r\n    HostName 10.0.0.9\r\n    Port 2222\r\n"
    );
}

#[test]
fn patch_quotes_paths_with_spaces() {
    let before = "Host web\n    HostName 10.0.0.1\n";
    let mut h = edit("web", "web", "10.0.0.1");
    h.identity_file = Some("~\\Documents\\my keys\\id_ed25519".into());
    let after = patched(before, &h);
    assert!(
        after.contains("    IdentityFile \"~\\Documents\\my keys\\id_ed25519\"\n"),
        "{after}"
    );
    // 백슬래시 경로가 왕복해도 그대로 (Windows config 표기 관례).
    let cfg = crate::ssh_config::parse(&after);
    assert_eq!(
        cfg.hosts[0].identity_file.as_deref(),
        Some("~\\Documents\\my keys\\id_ed25519")
    );
}

#[test]
fn patch_reuses_the_add_form_validation() {
    let before = "Host web\n    HostName 10.0.0.1\n";
    assert_eq!(
        patch_block(before, "web", &edit("web", "", "10.0.0.1")).unwrap_err(),
        "별칭을 입력하세요"
    );
    assert_eq!(
        patch_block(before, "web", &edit("web", "we b", "10.0.0.1")).unwrap_err(),
        "별칭에 공백을 쓸 수 없습니다"
    );
    assert_eq!(
        patch_block(before, "web", &edit("web", "web", "  ")).unwrap_err(),
        "호스트 주소를 입력하세요"
    );
    assert!(patch_block(before, "web", &edit("web", "web*", "1.1.1.1")).is_err());
}

// --- 파일 왕복 (수정) --------------------------------------------------

#[test]
fn edit_writes_the_file_and_round_trips_through_the_parser() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(
        &path,
        "# 머리 주석\nHost web\n    HostName 10.0.0.1\n    User old\n\nHost db\n    HostName 10.0.0.2\n",
    )
    .unwrap();

    let mut h = edit("web", "web", "10.0.0.9");
    h.user = Some("deploy".into());
    h.port = Some(2222);
    assert!(edit_host_at(&path, &h).unwrap().is_empty());

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.starts_with("# 머리 주석\n"), "{content}");
    assert!(
        content.ends_with("Host db\n    HostName 10.0.0.2\n"),
        "{content}"
    );

    let cfg = crate::ssh_config::parse(&content);
    let web = cfg.hosts.iter().find(|x| x.name == "web").unwrap();
    assert_eq!(web.host_name.as_deref(), Some("10.0.0.9"));
    assert_eq!(web.user.as_deref(), Some("deploy"));
    assert_eq!(web.port, Some(2222));
    // 옆 블록은 그대로.
    let db = cfg.hosts.iter().find(|x| x.name == "db").unwrap();
    assert_eq!(db.host_name.as_deref(), Some("10.0.0.2"));
}

#[test]
fn edit_leaves_the_file_untouched_when_nothing_changed() {
    let tmp = TempDir::new();
    let path = tmp.file();
    let before = "Host web\n    HostName 10.0.0.1\n";
    std::fs::write(&path, before).unwrap();

    assert!(edit_host_at(&path, &edit("web", "web", "10.0.0.1"))
        .unwrap()
        .is_empty());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}

#[test]
fn edit_rejects_a_missing_file_or_host() {
    let tmp = TempDir::new();
    let path = tmp.file();
    let err = edit_host_at(&path, &edit("web", "web", "10.0.0.1")).unwrap_err();
    assert!(err.starts_with("호스트를 찾을 수 없습니다"), "{err}");

    std::fs::write(&path, "Host db\n").unwrap();
    assert!(edit_host_at(&path, &edit("web", "web", "10.0.0.1"))
        .unwrap_err()
        .starts_with("호스트를 찾을 수 없습니다"));
}

// --- 호스트 삭제 (블록 들어내기) -------------------------------------

/// 삭제만 하고 경고는 버린다.
fn removed(content: &str, name: &str) -> String {
    remove_block(content, name).unwrap().0
}

#[test]
fn remove_single_pattern_block_cleanly() {
    let before = "\
Host web
    HostName 10.0.0.1
    User deploy
    Port 2222
";
    // 파일에 블록이 하나뿐이면 통째로 사라져 빈 파일이 된다.
    assert_eq!(removed(before, "web"), "");
}

#[test]
fn remove_keeps_surrounding_blocks_comments_and_blank_lines() {
    let before = "\
# 파일 머리 주석

Host alpha
    HostName alpha.example.com
    Port 22

Host web
    HostName 10.0.0.1
    User old

Host omega
    HostName omega.example.com
    ServerAliveInterval 5
";
    let after = removed(before, "web");
    // 앞뒤 블록·주석은 그대로, 블록 사이 빈 줄은 하나만 남는다.
    assert_eq!(
        after,
        "\
# 파일 머리 주석

Host alpha
    HostName alpha.example.com
    Port 22

Host omega
    HostName omega.example.com
    ServerAliveInterval 5
"
    );
    // 지운 뒤에도 나머지가 파서로 깨끗이 읽힌다.
    let cfg = crate::ssh_config::parse(&after);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "omega"]);
}

#[test]
fn remove_never_touches_bytes_outside_the_block() {
    let before = "\
# 머리
Host alpha
    HostName alpha.example.com

Host web
    HostName 10.0.0.1

Host omega
    HostName omega.example.com
";
    let after = removed(before, "web");
    let (head, _) = before.split_once("\nHost web").unwrap();
    let (_, tail) = before.split_once("\nHost omega").unwrap();
    // 대상 블록 앞은 바이트째 그대로, 뒤 블록도 바이트째 그대로.
    assert!(after.starts_with(head), "{after}");
    assert!(after.ends_with(&format!("Host omega{tail}")), "{after}");
}

#[test]
fn remove_the_first_block_leaves_the_next_at_the_top() {
    let before = "Host web\n    HostName 10.0.0.1\n\nHost db\n    HostName 10.0.0.2\n";
    // web 을 지우면 web 과 db 를 가르던 빈 줄이 함께 빠져 db 가 맨 위로 붙는다.
    assert_eq!(removed(before, "web"), "Host db\n    HostName 10.0.0.2\n");
}

#[test]
fn remove_a_comment_directly_above_the_block_is_left_in_place() {
    // ssh config 에는 "이 주석이 이 블록 것" 이라는 표시가 없다 — 국소 삭제라 블록 밖
    // (Host 줄 위)의 주석은 건드리지 않는다. 남은 주석은 사용자가 판단할 몫.
    let before = "# web 서버\nHost web\n    HostName 10.0.0.1\nHost db\n    HostName 10.0.0.2\n";
    assert_eq!(
        removed(before, "web"),
        "# web 서버\nHost db\n    HostName 10.0.0.2\n"
    );
}

#[test]
fn remove_matches_the_alias_case_insensitively() {
    // edit_host 와 같은 대소문자 무시 매칭.
    let before = "Host web\n    HostName 10.0.0.1\nHost db\n    HostName 10.0.0.2\n";
    assert_eq!(removed(before, "WEB"), "Host db\n    HostName 10.0.0.2\n");
}

#[test]
fn remove_stops_the_block_at_a_match_block() {
    let before = "Host web\n    HostName 10.0.0.1\nMatch host web\n    User matched\n";
    // 블록 끝은 Match 직전 — Match 블록은 남는다.
    assert_eq!(removed(before, "web"), "Match host web\n    User matched\n");
}

#[test]
fn remove_keeps_crlf_line_endings_of_the_survivors() {
    let before = "Host web\r\n    HostName 10.0.0.1\r\n\r\nHost db\r\n    HostName 10.0.0.2\r\n";
    assert_eq!(
        removed(before, "web"),
        "Host db\r\n    HostName 10.0.0.2\r\n"
    );
}

#[test]
fn remove_multi_pattern_keeps_the_block_and_drops_only_that_alias() {
    // 공용 줄은 블록을 지우면 다른 별칭까지 사라진다 — 별칭만 빼고 블록은 남긴다.
    let before = "Host web db  # 공용\n    HostName 10.0.0.1\n";
    let (after, warnings) = remove_block(before, "web").unwrap();
    assert_eq!(after, "Host db  # 공용\n    HostName 10.0.0.1\n");
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("별칭 2개"), "{warnings:?}");
    assert!(warnings[0].contains("'web'"), "{warnings:?}");

    // 가운데/마지막 토큰도 인접 공백째 깔끔히 빠진다.
    assert_eq!(
        remove_block("Host web db cache\n    HostName 1.1.1.1\n", "db")
            .unwrap()
            .0,
        "Host web cache\n    HostName 1.1.1.1\n"
    );
    assert_eq!(
        remove_block("Host web db\n    HostName 1.1.1.1\n", "db")
            .unwrap()
            .0,
        "Host web\n    HostName 1.1.1.1\n"
    );
}

/// 지우기는 고칠 값이 없다(무엇으로 바꿀지는 사람만 안다) — 대신 **누가 그 호스트를
/// 거쳐 가고 있었는지** 이름을 대 준다. 줄 자체는 손대지 않는다.
#[test]
fn remove_warns_about_the_hosts_that_jump_through_it() {
    let before = "\
Host web
    ProxyJump bastion
Host bastion
    HostName 10.0.0.1
Host db
    ProxyJump deploy@bastion:2222
Host cache
    ProxyJump gate,bastion
Host other
    ProxyJump bastion2
Host *
    ServerAliveInterval 30
";
    let (after, warnings) = remove_block(before, "bastion").unwrap();

    assert_eq!(warnings.len(), 1);
    assert!(
        warnings[0].contains("web, db, cache") && !warnings[0].contains("other"),
        "{warnings:?}"
    );
    // 블록만 빠지고 가리키던 줄은 글자째 그대로다.
    assert!(!after.contains("Host bastion\n"), "{after}");
    assert!(after.contains("    ProxyJump bastion\n"), "{after}");
    assert!(
        after.contains("    ProxyJump deploy@bastion:2222\n"),
        "{after}"
    );

    // 아무도 거쳐 가지 않으면 조용하다.
    assert!(remove_block("Host a\nHost bastion\n", "bastion")
        .unwrap()
        .1
        .is_empty());
}

#[test]
fn remove_reports_a_missing_host() {
    let err = remove_block("Host web\n    HostName 10.0.0.1\n", "nope").unwrap_err();
    assert_eq!(err, "호스트를 찾을 수 없습니다 — 목록을 새로고침하세요");
    assert_eq!(
        remove_block("Host web\n", "  ").unwrap_err(),
        "호스트를 찾을 수 없습니다 — 목록을 새로고침하세요"
    );
}

#[test]
fn remove_only_the_first_of_a_repeated_alias_and_warns() {
    let before = "\
Host web
    HostName first.example.com
Host web
    HostName second.example.com
";
    let (after, warnings) = remove_block(before, "web").unwrap();
    assert_eq!(after, "Host web\n    HostName second.example.com\n");
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("첫 번째 블록만 삭제"), "{warnings:?}");
}

#[test]
fn remove_host_at_writes_the_file_and_round_trips() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(
        &path,
        "# 머리 주석\nHost web\n    HostName 10.0.0.1\n    User old\n\nHost db\n    HostName 10.0.0.2\n",
    )
    .unwrap();

    assert!(remove_host_at(&path, "web").unwrap().is_empty());

    let content = std::fs::read_to_string(&path).unwrap();
    assert_eq!(content, "# 머리 주석\nHost db\n    HostName 10.0.0.2\n");
    let cfg = crate::ssh_config::parse(&content);
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["db"]);
}

#[test]
fn remove_host_at_rejects_a_missing_file_or_host() {
    let tmp = TempDir::new();
    let path = tmp.file();
    assert!(remove_host_at(&path, "web")
        .unwrap_err()
        .starts_with("호스트를 찾을 수 없습니다"));

    std::fs::write(&path, "Host db\n    HostName 10.0.0.2\n").unwrap();
    assert!(remove_host_at(&path, "web")
        .unwrap_err()
        .starts_with("호스트를 찾을 수 없습니다"));
    // 실패한 시도가 파일을 건드리지 않았는지.
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "Host db\n    HostName 10.0.0.2\n"
    );
}

#[test]
fn remove_host_at_leaves_the_file_untouched_when_only_an_alias_is_dropped_but_matches_nothing() {
    // 공용 줄에서 별칭을 빼면 내용이 실제로 바뀌므로 파일은 쓰인다 — 여기선 바뀌는지만 확인.
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(&path, "Host web db\n    HostName 10.0.0.1\n").unwrap();
    let warnings = remove_host_at(&path, "web").unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "Host db\n    HostName 10.0.0.1\n"
    );
}

#[test]
fn repeated_appends_stay_parseable() {
    let tmp = TempDir::new();
    let path = tmp.file();
    for i in 1..=3 {
        add_host_at(&path, &minimal(&format!("h{i}"), &format!("10.0.0.{i}"))).unwrap();
    }

    let content = std::fs::read_to_string(&path).unwrap();
    let cfg = crate::ssh_config::parse(&content);
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["h1", "h2", "h3"]);
    // 블록 사이는 빈 줄 하나씩.
    assert!(!content.contains("\n\n\n"), "{content:?}");
}

// --- 추가 → (고치기) → 삭제 왕복 (2026-09-30 파일 끝 빈 줄) ---------------

/// 실제에 가까운 설정 — Include · 주석 · 여러 블록 · Match · `Host *`. 끝은 개행 하나.
const REALISTIC: &str = "\
Include ~/.ssh/config.d/*

# 회사
Host bastion
    HostName 10.0.0.1
    User ops

Host web-* # 웹 서버들
    ProxyJump bastion
    User deploy

Match host db exec \"true\"
    User dba

Host *
    ServerAliveInterval 30
";

/// `before` 를 파일로 두고 `steps` 를 돈 뒤의 파일 내용.
fn round_trip(before: &str, rename: bool) -> String {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(&path, before).unwrap();
    add_host_at(&path, &minimal("zz-test", "127.0.0.9")).unwrap();
    let name = if rename {
        edit_host_at(&path, &edit("zz-test", "zz-test2", "127.0.0.9")).unwrap();
        "zz-test2"
    } else {
        "zz-test"
    };
    remove_host_at(&path, name).unwrap();
    std::fs::read_to_string(&path).unwrap()
}

#[test]
fn add_then_remove_restores_the_file_byte_for_byte() {
    let crlf = REALISTIC.replace('\n', "\r\n");
    for before in [
        REALISTIC,
        crlf.as_str(),
        "",
        "Host only\n    HostName 1.1.1.1\n",
        "\n",
    ] {
        assert_eq!(round_trip(before, false), before, "추가 → 삭제: {before:?}");
    }
}

#[test]
fn add_rename_then_remove_restores_the_file_byte_for_byte() {
    let crlf = REALISTIC.replace('\n', "\r\n");
    for before in [REALISTIC, crlf.as_str(), ""] {
        assert_eq!(
            round_trip(before, true),
            before,
            "추가 → 이름 바꾸기 → 삭제: {before:?}"
        );
    }
}

#[test]
fn add_then_remove_without_a_trailing_newline_only_closes_the_last_line() {
    // 끝 개행이 없던 파일은 추가가 마지막 줄을 개행으로 닫는다 — 삭제 뒤 그 개행 하나만 남는다
    // (추가된 뒤의 파일은 "끝 개행 하나였던 원본" 과 바이트가 같아 삭제가 둘을 가를 수 없다).
    let lf = REALISTIC.trim_end_matches('\n');
    assert_eq!(round_trip(lf, false), format!("{lf}\n"));
    assert_eq!(round_trip(lf, true), format!("{lf}\n"));
    let crlf = REALISTIC.replace('\n', "\r\n");
    let crlf = crlf.trim_end_matches("\r\n");
    assert_eq!(round_trip(crlf, false), format!("{crlf}\n"));
}

#[test]
fn remove_the_last_block_takes_the_blank_line_above_it_but_not_a_comment() {
    // 마지막 블록은 위의 구분 빈 줄 하나를 함께 가져간다(추가가 띄운 그 줄).
    assert_eq!(
        removed("Host a\n    HostName 1\n\nHost b\n    HostName 2\n", "b"),
        "Host a\n    HostName 1\n"
    );
    assert_eq!(
        removed(
            "Host a\r\n    HostName 1\r\n\r\nHost b\r\n    HostName 2\r\n",
            "b"
        ),
        "Host a\r\n    HostName 1\r\n"
    );
    // 빈 줄은 하나만 — 더 위의 빈 줄은 그대로다.
    assert_eq!(removed("Host a\n\n\nHost b\n", "b"), "Host a\n\n");
    // 바로 위가 주석이면 아무것도 더 가져가지 않는다(주석은 블록 밖 — 기존 규칙).
    assert_eq!(
        removed("Host a\n\n# b 서버\nHost b\n", "b"),
        "Host a\n\n# b 서버\n"
    );
    // 마지막이 아닌 블록은 예전 그대로 — 위의 빈 줄은 남고 제 뒤 빈 줄이 함께 빠진다.
    assert_eq!(
        removed("Host a\n\nHost b\n\nHost c\n", "b"),
        "Host a\n\nHost c\n"
    );
}

/// 호스트 이름 변경 · 삭제가 DB 연결 목록의 경유를 따라간다(`edit_host` · `remove_host` 명령의 몸) — 실패는 경고 한 줄.
#[test]
fn host_rename_and_removal_follow_db_connections() {
    let dir = TempDir::new();
    let path = dir.0.join("db-connections.json");
    let conn = |id: &str, via: Option<&str>| crate::db::conns::DbConn {
        id: id.into(),
        name: id.into(),
        engine: crate::db::conns::DbEngine::Postgres,
        via: via.map(str::to_string),
        path: None,
        host: Some("localhost".into()),
        port: Some(5432),
        database: None,
        user: None,
        tls_mode: None,
        tls_ca: None,
        folder: None,
    };
    crate::db::conns::save_at(&path, &[conn("Abc_via0001", Some("web-01")), conn("Abc_dir0001", None)]).unwrap();

    let mut warnings = Vec::new();
    follow_rename_in_db_conns(Some(&path), "web-01", " web-02 ", &mut warnings);
    assert!(warnings.is_empty(), "{warnings:?}");
    let back = crate::db::conns::load_at(&path).unwrap().conns;
    assert_eq!(back[0].via.as_deref(), Some("web-02"));
    assert_eq!(back[1].via, None);

    // 설정 폴더를 모르면 지나간다 · 깨진 파일은 경고 한 줄(호스트 수정은 되돌리지 않는다).
    follow_rename_in_db_conns(None, "web-02", "web-03", &mut warnings);
    assert!(warnings.is_empty());
    std::fs::create_dir_all(dir.0.join("as-dir.json")).unwrap();
    follow_rename_in_db_conns(Some(&dir.0.join("as-dir.json")), "web-02", "web-03", &mut warnings);
    assert_eq!(warnings.len(), 1, "{warnings:?}");

    let mut warnings = Vec::new();
    follow_remove_in_db_conns(Some(&path), "WEB-02", &mut warnings);
    assert!(warnings.is_empty(), "{warnings:?}");
    let left: Vec<String> = crate::db::conns::load_at(&path).unwrap().conns.into_iter().map(|d| d.id).collect();
    assert_eq!(left, ["Abc_dir0001"]);
}
