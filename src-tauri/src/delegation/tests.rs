use super::*;

#[test]
fn host_write_preserves_unknown_repo_block() {
    let repo = "[[repo]]\npath = 'C:/old' # 사람이 둔 글\nunknown = ['x', 4]\n";
    let body = format!("{repo}\n[[target]]\nalias = 'h'\nexpect_user = 'u'\nexpect_host = 'h'\nexpect_port = 22\nread = false\n");
    let out = upsert_target_in_doc(
        &body,
        "h",
        &IdentitySnapshot {
            user: "u".into(),
            host: "h".into(),
            port: 22,
        },
        &DelegationGrants {
            read: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        out.starts_with(repo),
        "모르는 저장소 블록과 주석은 그대로 남는다"
    );
    assert!(Delegation::parse(&out).unwrap().read_granted("h"));
}

const SAMPLE: &str = "\
[[target]]
alias        = \"Remote-SSH\"
expect_user  = \"innobe\"
expect_host  = \"localhost\"
expect_port  = 1220
connect      = true
read         = true
propose      = true
auto_execute = false
vault_passphrase = true
client       = \"any\"

[[target]]
alias        = \"locked\"
expect_user  = \"root\"
expect_host  = \"10.0.0.9\"
expect_port  = 22

[[target]]
alias        = \"auto\"
expect_user  = \"u\"
expect_host  = \"h\"
expect_port  = 22
auto_execute = true
";

#[test]
fn parses_a_target_and_defaults_missing_perms_to_false() {
    let delegation = Delegation::parse(SAMPLE).unwrap();
    let t = delegation.target("Remote-SSH").expect("대상이 있어야 한다");
    assert_eq!(t.expect_user, "innobe");
    assert_eq!(t.expect_host, "localhost");
    assert_eq!(t.expect_port, 1220);
    assert!(t.connect);
    assert!(t.read);
    assert!(t.propose);
    assert!(!t.auto_execute);
    assert!(t.vault_passphrase);
    assert_eq!(t.client, "any");

    // 권한을 안 적은 대상은 전부 false, client 는 "any".
    let locked = delegation.target("locked").expect("대상");
    assert!(!locked.connect);
    assert!(!locked.read);
    assert!(!locked.propose);
    assert!(!locked.auto_execute);
    // 2026-09-22 에 늘어난 칸도 **적지 않으면 false** 다 (위임은 명시로만).
    assert!(!locked.vault_passphrase);
    assert_eq!(locked.client, "any");
}

#[test]
fn missing_file_is_an_empty_delegation_not_an_error() {
    let delegation = Delegation::load_at(Path::new("Z:/nonexistent/delegation.toml"));
    assert!(delegation.target("anything").is_none());
    assert!(!delegation.connect_granted("anything"));
    assert!(!delegation.read_granted("anything"));
}

#[test]
fn empty_content_is_an_empty_delegation() {
    let delegation = Delegation::parse("").unwrap();
    assert!(delegation.target("x").is_none());
}

#[test]
fn broken_toml_is_a_clear_error() {
    assert!(Delegation::parse("this is = = not toml").is_err());
}

#[test]
fn grant_lookups_are_case_insensitive_and_default_false_off_list() {
    let delegation = Delegation::parse(SAMPLE).unwrap();
    // 위임된 별칭 — 대소문자 무시.
    assert!(delegation.connect_granted("remote-ssh"));
    assert!(delegation.read_granted("REMOTE-SSH"));
    assert!(delegation.propose_granted("remote-ssh"));
    // auto_execute 는 Remote-SSH 가 false. "auto" 대상은 auto_execute 만 적힌 **비누적 옛 조합**이라
    // 누적 규칙(read && propose && auto_execute)으로 읽혀 자동 실행이 없다.
    assert!(!delegation.auto_execute_granted("remote-ssh"));
    assert!(!delegation.auto_execute_granted("AUTO"));
    // 볼트 암호구도 같은 규칙 — SAMPLE 은 Remote-SSH 에만 켜 뒀다.
    assert!(delegation.vault_passphrase_granted("remote-ssh"));
    assert!(!delegation.vault_passphrase_granted("AUTO"));
    // 접속만 막힌(권한 없는) 대상 — propose 도 안 적었으니 false.
    assert!(!delegation.connect_granted("locked"));
    assert!(!delegation.read_granted("locked"));
    assert!(!delegation.propose_granted("locked"));
    assert!(!delegation.auto_execute_granted("locked"));
    assert!(!delegation.vault_passphrase_granted("locked"));
    // 목록에 없는 별칭 — 언제나 false(위임은 명시로만).
    assert!(!delegation.connect_granted("ghost"));
    assert!(!delegation.read_granted("ghost"));
    assert!(!delegation.propose_granted("ghost"));
    assert!(!delegation.auto_execute_granted("ghost"));
    assert!(!delegation.vault_passphrase_granted("ghost"));
}

#[test]
fn headless_targets_returns_only_connect_granted() {
    let delegation = Delegation::parse(SAMPLE).unwrap();
    let aliases: Vec<&str> = delegation
        .headless_targets()
        .iter()
        .map(|t| t.alias.as_str())
        .collect();
    // SAMPLE: Remote-SSH 는 read+propose+connect, locked 는 아무것도, auto 는 비누적 옛 조합.
    assert_eq!(aliases, vec!["Remote-SSH"]);
    // 읽기만(또는 읽기+옛 connect) 준 호스트는 헤드리스 발견 항목이 아니다.
    let read_only = Delegation::parse(
        "[[target]]\nalias = \"r\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\nconnect = true\n",
    )
    .unwrap();
    assert!(read_only.headless_targets().is_empty());
    // 빈 위임 목록은 빈 목록.
    assert!(Delegation::default().headless_targets().is_empty());
}

#[test]
fn identity_matches_only_when_all_three_agree() {
    let delegation = Delegation::parse(SAMPLE).unwrap();
    assert!(delegation.identity_matches("Remote-SSH", "innobe", "localhost", 1220));
    // 하나라도 어긋나면 거부.
    assert!(!delegation.identity_matches("Remote-SSH", "other", "localhost", 1220));
    assert!(!delegation.identity_matches("Remote-SSH", "innobe", "10.0.0.1", 1220));
    assert!(!delegation.identity_matches("Remote-SSH", "innobe", "localhost", 22));
    // 목록에 없는 별칭은 무엇과도 일치하지 않는다.
    assert!(!delegation.identity_matches("ghost", "innobe", "localhost", 1220));
}

// -----------------------------------------------------------------------
// 쓰기 — 순수 함수들 (docs/log/2026-09-21-fleet-delegation-ui.md)
// -----------------------------------------------------------------------

fn snap() -> IdentitySnapshot {
    IdentitySnapshot {
        user: "innobe".into(),
        host: "localhost".into(),
        port: 1220,
    }
}

fn grants(connect: bool, read: bool, propose: bool, auto_execute: bool) -> DelegationGrants {
    DelegationGrants {
        connect,
        read,
        propose,
        auto_execute,
        approve_all: false,
        vault_passphrase: false,
    }
}

/// 'Ask' 단계(read+propose) 위에 `접속`·`볼트의 키 암호구 사용` 만 다르게 준 한 벌.
fn grants_vault(connect: bool, vault_passphrase: bool) -> DelegationGrants {
    DelegationGrants {
        connect,
        read: true,
        propose: true,
        vault_passphrase,
        ..DelegationGrants::default()
    }
}

#[test]
fn grant_dependencies_are_normalized_to_cumulative_stages() {
    let n = |g: DelegationGrants| normalize_grants(&g);
    // 누적 모양은 그대로다.
    for g in [
        DelegationGrants::default(),
        grants(false, true, false, false),
        grants(false, true, true, false),
        grants(true, true, true, false),
        grants(true, true, true, true),
        grants_vault(true, true),
    ] {
        assert_eq!(n(g), g, "{g:?}");
    }
    // 작업안은 읽기 없이 켜지지 않는다 — 위에 놓인 자동 실행·접속·볼트도 함께 꺼진다.
    assert_eq!(n(grants(true, false, true, true)), DelegationGrants::default());
    // 자동 실행은 작업안 없이 켜지지 않는다.
    assert_eq!(n(grants(false, true, false, true)), grants(false, true, false, false));
    // 접속은 'Ask' 아래에서 꺼진다(예전 "작업안 ⊂ 접속" 이 뒤집혔다).
    assert_eq!(n(grants(true, true, false, false)), grants(false, true, false, false));
    // 볼트 암호구 ⊂ 접속 — 접속이 꺼지면 함께 꺼진다.
    assert_eq!(n(grants_vault(false, true)), grants_vault(false, false));
    let mut low = grants_vault(true, true);
    low.propose = false;
    assert_eq!(n(low), grants(false, true, false, false));
}

#[test]
fn grant_lookups_are_cumulative() {
    // 옛 파일의 비누적 조합 — 마이그레이션 없이 누적 규칙으로 읽힌다.
    let d = Delegation::parse(
        "[[target]]
alias = \"no-read\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
connect = true
propose = true
auto_execute = true
vault_passphrase = true

[[target]]
alias = \"read-connect\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
connect = true
read = true

[[target]]
alias = \"full\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
connect = true
read = true
propose = true
auto_execute = true
vault_passphrase = true
",
    )
    .unwrap();
    // read 가 없으면 아무것도 없다.
    assert!(!d.read_granted("no-read"));
    assert!(!d.propose_granted("no-read"));
    assert!(!d.auto_execute_granted("no-read"));
    assert!(!d.connect_granted("no-read"));
    assert!(!d.vault_passphrase_granted("no-read"));
    // 읽기 전용 + 옛 connect → 헤드리스 접속은 'Ask' 이상에서만이라 없다.
    assert!(d.read_granted("read-connect"));
    assert!(!d.propose_granted("read-connect"));
    assert!(!d.connect_granted("read-connect"));
    // 전부.
    assert!(d.read_granted("full") && d.propose_granted("full") && d.auto_execute_granted("full"));
    assert!(d.connect_granted("full") && d.vault_passphrase_granted("full"));
    // 요약 숫자도 누적으로 센다.
    assert_eq!(d.auto_execute_granted_count(), 1);
}

#[test]
fn vault_passphrase_round_trips_through_the_writer() {
    // 새 블록 — 다섯이 나란히 적히고 다시 읽힌다.
    let out = upsert_target_in_doc("", "web-01", &snap(), &grants_vault(true, true)).expect("저장");
    assert!(out.contains("vault_passphrase = true"));
    let t = Delegation::parse(&out)
        .unwrap()
        .target("web-01")
        .unwrap()
        .clone();
    assert!(t.connect && t.vault_passphrase);

    // 끄면 `false` 로 적힌다(지워지지 않는다) — 다섯이 나란히 보여야 한다.
    let off =
        upsert_target_in_doc(&out, "web-01", &snap(), &grants_vault(true, false)).expect("저장");
    assert!(off.contains("vault_passphrase = false"));
    assert!(
        !Delegation::parse(&off)
            .unwrap()
            .target("web-01")
            .unwrap()
            .vault_passphrase
    );

    // 접속 없이 볼트만 켠 저장은 볼트가 꺼진 채 적힌다(정규화 — 붙을 수도 없는 대상의 암호구는 없다).
    let only = upsert_target_in_doc("", "solo", &snap(), &grants_vault(false, true)).expect("저장");
    let t = Delegation::parse(&only).unwrap().target("solo").unwrap().clone();
    assert!(!t.connect && !t.vault_passphrase && t.propose);
}

#[test]
fn upsert_creates_a_block_in_an_empty_file() {
    let out = upsert_target_in_doc("", "web-01", &snap(), &grants(true, true, true, false))
        .expect("저장");
    let delegation = Delegation::parse(&out).expect("다시 읽힌다");
    let t = delegation.target("web-01").expect("대상");
    assert_eq!(t.expect_user, "innobe");
    assert_eq!(t.expect_host, "localhost");
    assert_eq!(t.expect_port, 1220);
    assert!(t.connect && t.read && t.propose);
    assert!(!t.auto_execute);
    // 새 블록은 client 를 적지 않는다 = "any".
    assert_eq!(t.client, "any");
    assert!(!out.contains("client"));
}

#[test]
fn upsert_keeps_comments_order_and_unknown_keys() {
    let src = "\
# 위임 — 손으로 적은 머리글
[[target]]
alias        = \"Remote-SSH\"   # 사내망
expect_user  = \"innobe\"
expect_host  = \"localhost\"
expect_port  = 1220
connect      = true
read         = true
client       = \"claude\"
";
    let out = upsert_target_in_doc(src, "remote-ssh", &snap(), &grants(true, true, true, false))
        .expect("저장");
    assert!(out.contains("# 위임 — 손으로 적은 머리글"));
    assert!(out.contains("# 사내망"), "줄 끝 주석이 남아야 한다");
    // 모르는 키는 그대로.
    assert!(out.contains("client       = \"claude\""));
    // 별칭 표기는 사용자가 적은 그대로(대소문자를 우리가 바꾸지 않는다).
    assert!(out.contains("alias        = \"Remote-SSH\""));
    let t = Delegation::parse(&out)
        .unwrap()
        .target("Remote-SSH")
        .unwrap()
        .clone();
    assert!(t.propose);
    assert!(!t.auto_execute);
    assert_eq!(t.client, "claude");
}

#[test]
fn upsert_with_no_grants_removes_the_block_instead_of_leaving_a_dead_one() {
    let src = "\
[[target]]
alias = \"a\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
connect = true

[[target]]
alias = \"b\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
";
    let out = upsert_target_in_doc(src, "a", &snap(), &DelegationGrants::default()).expect("저장");
    let delegation = Delegation::parse(&out).unwrap();
    assert!(
        delegation.target("a").is_none(),
        "죽은 블록을 남기지 않는다"
    );
    assert!(delegation.target("b").is_some(), "남의 블록은 그대로");
    assert!(!out.contains("connect"));
}

#[test]
fn upsert_normalizes_a_broken_dependency_instead_of_writing_it() {
    let src = "# 머리글\n";
    // 읽기 없는 작업안은 아무 권한도 아니다 — 블록을 만들지 않는다.
    let out = upsert_target_in_doc(src, "a", &snap(), &grants(false, false, true, false)).unwrap();
    assert_eq!(out, src);
    // 읽기 전용에 실린 접속은 꺼진 채 적힌다.
    let out = upsert_target_in_doc(src, "a", &snap(), &grants(true, true, false, false)).unwrap();
    let t = Delegation::parse(&out).unwrap().target("a").unwrap().clone();
    assert!(t.read && !t.connect && !t.propose);
}

#[test]
fn removing_the_first_block_keeps_the_file_header() {
    let src = "\
# ~/.aynx/delegation.toml — 머리글
# 두 줄짜리다

[[target]]
alias = \"a\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
connect = true

[[target]]
alias = \"b\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
";
    let (out, n) = remove_aliases_in_doc(src, &["A".to_string()]).expect("지우기");
    assert_eq!(n, 1);
    assert!(
        out.contains("# ~/.aynx/delegation.toml — 머리글"),
        "머리글이 살아야 한다"
    );
    assert!(out.contains("# 두 줄짜리다"));
    let delegation = Delegation::parse(&out).unwrap();
    assert!(delegation.target("a").is_none());
    assert!(delegation.target("b").is_some());
}

#[test]
fn removing_every_block_still_keeps_the_header() {
    let src = "# 머리글\n\n[[target]]\nalias = \"a\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nconnect = true\n";
    let (out, n) = remove_aliases_in_doc(src, &["a".to_string()]).unwrap();
    assert_eq!(n, 1);
    assert!(out.contains("# 머리글"));
    assert!(Delegation::parse(&out).unwrap().target("a").is_none());
}

#[test]
fn remove_is_a_quiet_noop_when_nothing_matches() {
    let src = "[[target]]\nalias = \"a\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nconnect = true\n";
    let (out, n) = remove_aliases_in_doc(src, &["ghost".to_string()]).unwrap();
    assert_eq!(n, 0);
    assert_eq!(out, src);
    // 빈 목록·빈 글자도 no-op.
    assert_eq!(remove_aliases_in_doc(src, &[]).unwrap().1, 0);
    assert_eq!(
        remove_aliases_in_doc(src, &["  ".to_string()]).unwrap().1,
        0
    );
    // 파일에 target 이 아예 없어도 no-op.
    assert_eq!(
        remove_aliases_in_doc("# 빈 파일\n", &["a".to_string()])
            .unwrap()
            .1,
        0
    );
}

#[test]
fn remove_takes_several_aliases_at_once() {
    let src = "[[target]]\nalias = \"a\"\nexpect_user=\"u\"\nexpect_host=\"h\"\nexpect_port=22\nconnect=true\n\n[[target]]\nalias = \"b\"\nexpect_user=\"u\"\nexpect_host=\"h\"\nexpect_port=22\nread=true\n\n[[target]]\nalias = \"c\"\nexpect_user=\"u\"\nexpect_host=\"h\"\nexpect_port=22\nread=true\n";
    let (out, n) = remove_aliases_in_doc(src, &["a".into(), "C".into()]).unwrap();
    assert_eq!(n, 2);
    let delegation = Delegation::parse(&out).unwrap();
    assert!(delegation.target("a").is_none() && delegation.target("c").is_none());
    assert!(delegation.target("b").is_some());
}

#[test]
fn rename_moves_only_the_alias_and_keeps_the_snapshot() {
    let src = "[[target]]\nalias        = \"Remote-SSH\"\nexpect_user  = \"innobe\"\nexpect_host  = \"localhost\"\nexpect_port  = 1220\nconnect      = true\n";
    let (out, renamed) = rename_alias_in_doc(src, "remote-ssh", "SSH").unwrap();
    assert!(renamed);
    let delegation = Delegation::parse(&out).unwrap();
    assert!(delegation.target("Remote-SSH").is_none());
    let t = delegation.target("SSH").expect("새 이름");
    assert_eq!(t.expect_user, "innobe");
    assert_eq!(t.expect_host, "localhost");
    assert_eq!(t.expect_port, 1220);
    assert!(t.connect);
    // 정렬 공백(장식)이 그대로 물려받아진다.
    assert!(out.contains("alias        = \"SSH\""));
}

#[test]
fn rename_is_a_quiet_noop_for_a_host_without_a_delegation() {
    let src = "[[target]]\nalias = \"a\"\nexpect_user=\"u\"\nexpect_host=\"h\"\nexpect_port=22\nconnect=true\n";
    let (out, renamed) = rename_alias_in_doc(src, "ghost", "other").unwrap();
    assert!(!renamed);
    assert_eq!(out, src);
    // 같은 글자로의 변경도 no-op — 대소문자만 바꾸는 것은 **변경이다**(아래).
    assert!(!rename_alias_in_doc(src, "a", "a").unwrap().1);
    assert!(rename_alias_in_doc(src, "a", "A").unwrap().1);
    // 빈 별칭은 거절.
    assert!(rename_alias_in_doc(src, "", "x").is_err());
    assert!(rename_alias_in_doc(src, "a", "  ").is_err());
}

#[test]
fn writers_reject_a_file_they_cannot_parse() {
    assert!(upsert_target_in_doc("= =", "a", &snap(), &grants(true, false, false, false)).is_err());
    assert!(remove_aliases_in_doc("= =", &["a".to_string()]).is_err());
    assert!(rename_alias_in_doc("= =", "a", "b").is_err());
    // `target` 이 블록 배열이 아니면 **조용히 갈아 끼우지 않고** 손으로 고치라고 말한다.
    assert!(upsert_target_in_doc(
        "target = 1\n",
        "a",
        &snap(),
        &grants(true, false, false, false)
    )
    .is_err());
}

#[test]
fn crlf_files_stay_crlf() {
    let src = "[[target]]\r\nalias = \"a\"\r\nexpect_user = \"u\"\r\nexpect_host = \"h\"\r\nexpect_port = 22\r\nconnect = true\r\n";
    let out = upsert_target_in_doc(src, "a", &snap(), &grants(true, true, false, false)).unwrap();
    assert!(out.contains("\r\n"));
    assert!(!out.contains("\n\n\r"), "LF 가 섞이지 않는다");
}

// ── 옛 이름 이사 (2026-09-21 개명) ──────────────────────────────────────
//
// `migrate_legacy_file` 은 경로를 받으므로 홈 디렉터리 없이 그대로 볼 수 있다.

fn temp_dir(tag: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "aynx-delegation-{tag}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
    dir
}

#[test]
fn legacy_file_is_renamed_once_when_the_new_name_is_missing() {
    let dir = temp_dir("migrate");
    let legacy = dir.join(LEGACY_FILE_NAME);
    let path = dir.join("delegation.toml");
    std::fs::write(&legacy, SAMPLE).unwrap();

    migrate_legacy_file(&path);
    assert!(path.exists(), "새 이름으로 옮겨진다");
    assert!(!legacy.exists(), "옛 파일은 남지 않는다");
    // 내용은 한 글자도 바뀌지 않는다 — 스키마가 그대로라 그대로 읽힌다.
    assert_eq!(std::fs::read_to_string(&path).unwrap(), SAMPLE);
    assert!(Delegation::load_at(&path).connect_granted("remote-ssh"));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn migration_is_a_no_op_when_the_new_file_already_exists() {
    let dir = temp_dir("both");
    let legacy = dir.join(LEGACY_FILE_NAME);
    let path = dir.join("delegation.toml");
    std::fs::write(&legacy, SAMPLE).unwrap();
    std::fs::write(&path, "").unwrap();

    migrate_legacy_file(&path);
    // 새 이름이 이긴다 — 덮어쓰지 않고, 옛 파일도 그 자리에 남는다(사람이 지운다).
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    assert!(legacy.exists());

    // 옛 파일도 없으면 조용한 no-op 이다(없는 파일을 만들지 않는다).
    let empty = temp_dir("none");
    let fresh = empty.join("delegation.toml");
    migrate_legacy_file(&fresh);
    assert!(!fresh.exists());

    std::fs::remove_dir_all(&dir).ok();
    std::fs::remove_dir_all(&empty).ok();
}

/// 모두 승인(2026-10-23) — 누적: 자동 실행 없이는 켜지지 않고(정규화가 끈다) · 판정도 누적이다 · 준 적 없는 블록에는 키를 적지 않는다.
#[test]
fn approve_all_is_cumulative_above_auto() {
    let all = DelegationGrants { approve_all: true, ..grants(false, true, true, true) };
    assert_eq!(normalize_grants(&all), all, "누적 모양은 그대로");
    // 자동 실행이 없으면 모두 승인도 꺼진다(넓히지 않고 좁힌다).
    let no_auto = DelegationGrants { approve_all: true, ..grants(false, true, true, false) };
    assert_eq!(normalize_grants(&no_auto), grants(false, true, true, false));
    let no_read = DelegationGrants { approve_all: true, ..grants(false, false, true, true) };
    assert_eq!(normalize_grants(&no_read), DelegationGrants::default());
    assert!(DelegationGrants { approve_all: true, ..DelegationGrants::default() }.any());

    let d = Delegation::parse(
        "[[target]]
alias = \"yolo\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
auto_execute = true
approve_all = true

[[target]]
alias = \"odd\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
approve_all = true

[[target]]
alias = \"auto\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
auto_execute = true
",
    )
    .unwrap();
    assert!(d.approve_all_granted("yolo") && d.approve_all_granted("YOLO"));
    assert!(!d.approve_all_granted("odd"), "자동 실행 없는 손 편집은 모두 승인이 아니다");
    assert!(!d.approve_all_granted("auto"));
    assert!(!d.approve_all_granted("ghost"));
    assert_eq!(d.approve_all_granted_count(), 1);

    // 쓰기 — 준 적 없는 블록에는 `approve_all` 키가 생기지 않고, 켜면 적히고, 끄면 false 로 남는다.
    let plain = upsert_target_in_doc("", "web", &snap(), &grants(false, true, true, true)).unwrap();
    assert!(!plain.contains("approve_all"), "{plain}");
    let on = upsert_target_in_doc(&plain, "web", &snap(), &all).unwrap();
    assert!(on.contains("approve_all = true"), "{on}");
    assert!(Delegation::parse(&on).unwrap().approve_all_granted("web"));
    let off = upsert_target_in_doc(&on, "web", &snap(), &grants(false, true, true, true)).unwrap();
    assert!(off.contains("approve_all = false"), "{off}");
    assert!(!Delegation::parse(&off).unwrap().approve_all_granted("web"));
}
