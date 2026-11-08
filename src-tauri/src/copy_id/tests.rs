use super::*;

const ED: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB+/x0y9Zq==";

/// POSIX 셸이 인용을 걷어내는 것과 같은 규칙으로 한 단어를 되돌린다 — **테스트 전용**.
///
/// 이스케이프가 맞는지 눈으로 문자열을 비교하는 대신, **셸이 볼 것과 같은 값**이 나오는지
/// 확인하려고 둔다 (`'\''` 같은 표현은 따옴표 개수 세기 같은 눈대중으로는 검증되지 않는다).
fn unquote(word: &str) -> String {
    let mut out = String::new();
    let mut chars = word.chars();
    let mut inside = false;
    while let Some(c) = chars.next() {
        match c {
            '\'' => inside = !inside,
            // 인용 밖의 백슬래시는 다음 한 글자를 문자 그대로 만든다.
            '\\' if !inside => out.extend(chars.next()),
            other => out.push(other),
        }
    }
    assert!(!inside, "인용이 닫히지 않았다: {word}");
    out
}

/// 조립된 명령에서 `echo <단어> >>` 의 그 단어를 떼어낸다 — **테스트 전용**.
fn appended_word(cmd: &str) -> &str {
    let start = cmd.find("else echo ").expect("append 분기가 없다") + "else echo ".len();
    let len = cmd[start..].find(" >> ").expect("리다이렉트가 없다");
    &cmd[start..start + len]
}

#[test]
fn quotes_wrap_and_escape_single_quotes() {
    assert_eq!(shell_quote("plain"), "'plain'");
    // 작은따옴표 하나 → 닫고 · 이스케이프된 따옴표 · 다시 연다.
    assert_eq!(shell_quote("it's"), r#"'it'\''s'"#);
    assert_eq!(shell_quote("''"), r#"''\'''\'''"#);
    assert_eq!(shell_quote(""), "''");
}

#[test]
fn quotes_leave_base64_and_shell_metachars_literal() {
    // base64 의 `+ / =` 와 셸 메타문자가 그대로 남아야 한다 — 작은따옴표 안에서는
    // 전부 평범한 글자다.
    let nasty = "ssh-rsa AAAA+b/c== user$(whoami) `id` \\x ; rm -rf / && echo !!";
    let quoted = shell_quote(nasty);
    assert!(quoted.starts_with('\'') && quoted.ends_with('\''));
    // 따옴표가 없는 입력이면 안쪽은 원문 그대로다.
    assert_eq!(&quoted[1..quoted.len() - 1], nasty);
}

#[test]
fn quoting_round_trips_for_anything_a_key_line_can_hold() {
    // 셸이 볼 값이 원문과 같아야 한다 — 이스케이프가 맞다는 것의 정의다.
    for raw in [
        "",
        "plain",
        "it's",
        "'",
        "''",
        r"back\slash",
        "AAAA+b/c==",
        "$(whoami) `id` ${HOME} !! \"dq\"",
        "x'; rm -rf ~; echo '",
        "한글 주석",
    ] {
        assert_eq!(unquote(&shell_quote(raw)), raw, "원문: {raw}");
    }
}

#[test]
fn comment_sanitizing_drops_control_bytes() {
    // 개행이 살아 있으면 한 줄인 줄 알았던 것이 서버에서 두 줄이 된다.
    assert_eq!(
        sanitize_comment("you@box\nssh-rsa AAAA"),
        "you@boxssh-rsa AAAA"
    );
    assert_eq!(sanitize_comment("  spaced  "), "spaced");
    assert_eq!(sanitize_comment("a\tb\r\nc"), "abc");
    assert_eq!(sanitize_comment(""), "");
}

#[test]
fn public_line_joins_body_and_comment() {
    assert_eq!(public_line(ED, "you@box"), format!("{ED} you@box"));
    // 주석이 없으면 뒤에 공백을 남기지 않는다 (`ssh-keygen -y` 와 같은 모양).
    assert_eq!(public_line(ED, ""), ED);
    assert_eq!(public_line(ED, "   "), ED);
    // 공백이 든 주석은 그대로 살린다 — OpenSSH 는 주석을 줄 끝까지로 읽는다.
    assert_eq!(
        public_line(ED, "my laptop key"),
        format!("{ED} my laptop key")
    );
}

#[test]
fn key_part_strips_the_comment() {
    assert_eq!(key_part(&format!("{ED} you@box")), ED);
    assert_eq!(key_part(&format!("{ED} my laptop key")), ED);
    // 주석이 없으면 줄 전체가 곧 키다.
    assert_eq!(key_part(ED), ED);
    // 망가진 입력에도 패닉하지 않는다.
    assert_eq!(key_part("ssh-ed25519"), "ssh-ed25519");
    assert_eq!(key_part(""), "");
    assert_eq!(key_part("   "), "   ");
    // 주석에 멀티바이트 문자가 있어도 슬라이스가 문자 경계에서 끊긴다.
    assert_eq!(key_part(&format!("{ED} 한글 주석")), ED);
}

#[test]
fn install_command_is_one_line_with_the_right_modes() {
    let cmd = install_command(&public_line(ED, "you@box"));
    // 줄바꿈이 없어야 한다 — 여러 줄이면 중간에서 끊길 때 반쯤 실행된다.
    assert!(!cmd.contains('\n'), "{cmd}");
    // sshd 의 StrictModes 계약.
    assert!(cmd.contains("mkdir -p ~/.ssh"), "{cmd}");
    assert!(cmd.contains("chmod 700 ~/.ssh &&"), "{cmd}");
    assert!(cmd.contains("chmod 600 ~/.ssh/authorized_keys"), "{cmd}");
    assert!(cmd.contains("touch ~/.ssh/authorized_keys"), "{cmd}");
    // 멱등: 있으면 표식만, 없으면 덧붙이고 표식.
    assert!(cmd.contains("grep -qF"), "{cmd}");
    assert!(cmd.contains(">> ~/.ssh/authorized_keys"), "{cmd}");
    assert!(cmd.contains(&format!("echo {MARK_PRESENT}")), "{cmd}");
    assert!(cmd.contains(&format!("echo {MARK_ADDED}")), "{cmd}");
    // 덮어쓰기(`>`)가 아니라 덧붙이기(`>>`) 여야 한다 — 남의 키를 날리면 안 된다.
    assert!(!cmd.contains(" > ~/.ssh/authorized_keys"), "{cmd}");
    assert_eq!(cmd.matches(">>").count(), 1, "{cmd}");
}

#[test]
fn install_command_greps_the_key_but_appends_the_comment() {
    let line = public_line(ED, "you@box");
    let cmd = install_command(&line);
    // 검색은 주석을 뺀 키 본문으로 (주석만 다른 같은 키가 중복 등록되지 않게).
    assert!(
        cmd.contains(&format!("grep -qF '{ED}' ~/.ssh/authorized_keys")),
        "{cmd}"
    );
    // 덧붙이는 것은 주석까지 포함한 한 줄.
    assert!(cmd.contains(&format!("echo '{line}' >>")), "{cmd}");
}

#[test]
fn install_command_escapes_a_quote_in_the_comment() {
    // 주석은 키 파일이 정하는 임의의 문자열이다 — 작은따옴표가 들어올 수 있다.
    let line = public_line(ED, "you's box");
    let cmd = install_command(&line);
    assert!(
        cmd.contains(r"you'\''s box"),
        "`'\\''` 로 갈아 끼우지 않았다: {cmd}"
    );
    // 셸이 볼 값은 원래의 한 줄 그대로여야 한다.
    assert_eq!(unquote(appended_word(&cmd)), line);
}

#[test]
fn install_command_neutralizes_an_injection_attempt() {
    // 주석에 명령을 심으려는 시도. 작은따옴표를 닫고 나가려 해도 `'\''` 로 막힌다.
    let line = public_line(ED, "x'; rm -rf ~; echo '");
    let cmd = install_command(&line);
    // 핵심: 위험한 텍스트가 **한 단어 안에** 갇혀 있다. 그 단어를 걷어내면 원문이
    // 그대로 나오고, 셸에는 명령이 아니라 인자 하나로 보인다.
    let word = appended_word(&cmd);
    assert_eq!(unquote(word), line);
    // 명령 구분자(`;`)가 인용 밖으로 새어 나오지 않았다.
    assert!(!word.starts_with("'; "), "{word}");
    assert!(cmd.contains(r"x'\''; rm -rf ~; echo '\''"), "{cmd}");
    // 리다이렉트는 여전히 하나뿐이다 — 주석이 새 리다이렉트를 만들지 못했다.
    assert_eq!(cmd.matches(">>").count(), 1, "{cmd}");
}

#[test]
fn output_marks_decide_added_versus_present() {
    assert_eq!(parse_install_output(MARK_ADDED, "", Some(0)), Ok(true));
    assert_eq!(parse_install_output(MARK_PRESENT, "", Some(0)), Ok(false));
    // 서버가 MOTD 등을 함께 흘려도 줄 단위로 잡는다.
    let noisy = format!("Welcome to Ubuntu\n{MARK_ADDED}\n");
    assert_eq!(parse_install_output(&noisy, "", Some(0)), Ok(true));
}

#[test]
fn output_without_marks_is_a_failure_with_the_real_reason() {
    let err =
        parse_install_output("", "mkdir: cannot create directory: Read-only", Some(1)).unwrap_err();
    assert!(
        err.contains("authorized_keys 를 수정하지 못했습니다"),
        "{err}"
    );
    assert!(err.contains("Read-only"), "{err}");

    // stderr 가 비면 종료 코드라도 싣는다.
    let bare = parse_install_output("", "", Some(2)).unwrap_err();
    assert!(bare.ends_with("(종료 코드 2)"), "{bare}");
    // 표식과 비슷하지만 다른 줄에 묻어 있는 것은 표식이 아니다.
    assert!(parse_install_output("no __aynx_key_added__ here", "", Some(0)).is_err());
}

#[test]
fn report_message_says_added_versus_present_and_flags_pubkey_off() {
    let added = report_message("box", true, Verified::Ok);
    assert!(added.contains("키를 등록했습니다"), "{added}");
    assert!(added.contains("비밀번호 없이"), "{added}");

    let present = report_message("box", false, Verified::Ok);
    assert!(present.contains("이미 같은 키가"), "{present}");

    let broken = report_message("box", true, Verified::Failed);
    assert!(broken.contains("PubkeyAuthentication no"), "{broken}");
}

#[test]
fn a_skipped_check_does_not_blame_the_server() {
    // 파일에만 있는 키 — 붙어 보지 않았으므로 sshd 설정을 의심하는 말이 나오면 안 된다.
    let skipped = report_message("box", true, Verified::Skipped);
    assert!(skipped.contains("키를 등록했습니다"), "{skipped}");
    assert!(skipped.contains("암호구"), "{skipped}");
    // **옛 길(ssh-add)을 가리키지 않는다** — 다시 묻지 않게 하는 자리는 이제 금고다
    // (2026-09-19 ② · docs/log/2026-09-19-vault.md).
    assert!(!skipped.contains("ssh-add"), "{skipped}");
    assert!(!skipped.contains("ssh-agent"), "{skipped}");
    assert!(!skipped.contains("PubkeyAuthentication"), "{skipped}");
    assert!(!skipped.contains("실패했습니다"), "{skipped}");
}

#[test]
fn payloads_serialize_in_camel_case() {
    let key = serde_json::to_string(&AgentKey {
        fingerprint: "SHA256:aaaa".into(),
        key_type: "ssh-ed25519".into(),
        comment: "you@box".into(),
        public_line: format!("{ED} you@box"),
    })
    .unwrap();
    assert!(key.contains(r#""keyType":"ssh-ed25519""#), "{key}");
    assert!(key.contains(r#""publicLine":"#), "{key}");
    assert!(key.contains(r#""fingerprint":"SHA256:aaaa""#), "{key}");

    let report = serde_json::to_string(&InstallReport {
        added: true,
        already_present: false,
        key_auth_ok: false,
        message: "…".into(),
    })
    .unwrap();
    assert_eq!(
        report,
        r#"{"added":true,"alreadyPresent":false,"keyAuthOk":false,"message":"…"}"#
    );
}

#[test]
fn report_never_carries_a_password_shaped_field() {
    // 계약을 못 박아 둔다: 보고 페이로드의 키는 이 넷뿐이다.
    let json: serde_json::Value = serde_json::from_str(
        &serde_json::to_string(&InstallReport {
            added: false,
            already_present: true,
            key_auth_ok: true,
            message: "ok".into(),
        })
        .unwrap(),
    )
    .unwrap();
    let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["added", "alreadyPresent", "keyAuthOk", "message"]);
}
