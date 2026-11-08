use super::*;

fn l() -> Labels {
    Labels {
        header: "── 설정 스크립트 · api ──".into(),
        ok_pre: "✓ 끝 (".into(),
        ok_post: "초)".into(),
        ok_plain: "✓ 끝".into(),
        fail_pre: "✗ 실패 (종료 코드 ".into(),
        fail_post: ")".into(),
        ok_tail: " · Claude Code 를 띄웁니다".into(),
        fail_tail: " · 에이전트를 띄우지 않았습니다".into(),
    }
}

#[test]
fn shells_map_to_their_shape() {
    assert_eq!(shell_of(Some("pwsh")), ScriptShell::PowerShell("pwsh"));
    assert_eq!(
        shell_of(Some("powershell")),
        ScriptShell::PowerShell("powershell")
    );
    assert_eq!(shell_of(Some("cmd")), ScriptShell::Cmd);
    assert_eq!(
        shell_of(Some("gitbash")),
        ScriptShell::Posix(PathStyle::Msys)
    );
    assert_eq!(
        shell_of(Some("wsl:Ubuntu")),
        ScriptShell::Posix(PathStyle::Wsl)
    );
    assert_eq!(shell_of(None), default_shell());
}

#[test]
fn printf_escape_is_ascii_without_quotes_or_double_backslashes() {
    let raw = "cp \"$AYNX_ROOT_PATH\\.env\" .env; echo '한글' `x` !";
    let e = printf_b_escape(raw);
    assert!(e.is_ascii(), "{e}");
    for bad in ['\'', '"', '$', '`', '!', '\n'] {
        assert!(!e.contains(bad), "{bad:?} in {e}");
    }
    assert!(!e.contains("\\\\"), "{e}");
    assert_eq!(printf_b_escape("a b-c_d.e/f:g"), "a b-c_d.e/f:g");
    assert_eq!(printf_b_escape("'"), "\\0047");
    assert_eq!(printf_b_escape("\n"), "\\0012");
    assert_eq!(printf_b_escape("\\"), "\\0134");
    assert_eq!(printf_b_escape("가"), "\\0352\\0260\\0200");
}

#[test]
fn paths_become_expressions_and_local_paths_follow_the_shell() {
    assert_eq!(posix_path_expr("~"), "\"$HOME\"");
    assert_eq!(
        posix_path_expr("~/api-wt/feat x"),
        "\"$HOME/$(printf %b \"api-wt/feat x\")\""
    );
    assert_eq!(
        posix_path_expr("/srv/a'b"),
        "\"$(printf %b \"/srv/a\\0047b\")\""
    );
    assert_eq!(
        posix_local_path(r"C:\src\api", PathStyle::Msys),
        "/c/src/api"
    );
    assert_eq!(
        posix_local_path(r"C:\src\api\", PathStyle::Wsl),
        "/mnt/c/src/api"
    );
    assert_eq!(posix_local_path("c:/x", PathStyle::Wsl), "/mnt/c/x");
    assert_eq!(posix_local_path(r"D:\", PathStyle::Msys), "/d");
    assert_eq!(
        posix_local_path(r"\\srv\share\r", PathStyle::Msys),
        "//srv/share/r"
    );
    assert_eq!(posix_local_path(r"C:\src", PathStyle::Native), r"C:\src");
}

#[test]
fn posix_line_is_one_ascii_line_with_a_single_layer_of_quotes() {
    let prog = posix_program(
        &posix_path_expr("~/api-wt/b"),
        &posix_path_expr("~/api"),
        "npm ci\necho '끝'",
        "abcdef0123456789",
        &l(),
    );
    assert!(!prog.contains('\''), "{prog}");
    assert!(!prog.contains('\n'));
    assert!(prog.contains("sh -e -c"));
    assert!(prog.contains("]7717;aynx-setup;abcdef0123456789;%s"));
    let line = posix_line(&prog);
    assert!(line.is_ascii(), "{line}");
    assert!(line.starts_with("sh -c '") && line.ends_with('\''));
    assert_eq!(line.matches('\'').count(), 2, "인용은 한 겹");
}

#[test]
fn powershell_wrapper_embeds_the_script_as_base64_and_quotes_paths() {
    let w = powershell_wrapper(
        r"C:\it's\wt",
        r"C:\src\api",
        "pnpm install\n'@\nexit 3",
        "00ff00ff",
        &l(),
    );
    assert!(w.contains(r"Set-Location -LiteralPath 'C:\it''s\wt'"));
    assert!(w.contains(r"$env:AYNX_ROOT_PATH = 'C:\src\api'"));
    let b64 = base64_encode("pnpm install\n'@\nexit 3".as_bytes());
    assert!(w.contains(&b64));
    assert!(
        !w.contains("pnpm install"),
        "본문은 글자 그대로 싣지 않는다"
    );
    assert!(w.contains("]7717;aynx-setup;00ff00ff;"));
    let line = powershell_line(
        "pwsh",
        Path::new(r"C:\Users\me\AppData\Roaming\aynx\setup-run\run-00ff00ff.ps1"),
    );
    assert_eq!(
        line,
        r"pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\me\AppData\Roaming\aynx\setup-run\run-00ff00ff.ps1'"
    );
}

#[test]
fn cmd_wrapper_restores_the_code_page_and_escapes_echo() {
    let w = cmd_wrapper(
        r"C:\wt\b",
        r"C:\src\api",
        Path::new(r"C:\run\body-1.cmd"),
        "0a0a0a0a",
        &l(),
    );
    let chcp = w.find("chcp 65001").unwrap();
    let first_non_ascii = w
        .char_indices()
        .find(|(_, c)| !c.is_ascii())
        .map(|(i, _)| i)
        .unwrap();
    assert!(chcp < first_non_ascii, "한글 줄은 chcp 뒤에");
    assert!(w.contains("call \"C:\\run\\body-1.cmd\""));
    assert!(w.contains("chcp %AYNX_CP%"));
    assert!(w.contains("]7717;aynx-setup;0a0a0a0a;%AYNX_RC%"));
    assert!(w.ends_with("\r\n"));
    assert_eq!(cmd_echo("a&b|c<d>e^f%g"), "a^&b^|c^<d^>e^^f%%g");
    assert_eq!(
        cmd_line(Path::new(r"C:\run\run-1.cmd")),
        "cmd /d /c \"C:\\run\\run-1.cmd\""
    );
}

#[test]
fn base64_matches_the_standard_alphabet_and_padding() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"f"), "Zg==");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert_eq!(base64_encode(b"foo"), "Zm9v");
    assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64_encode("가".as_bytes()), "6rCA");
    assert_eq!(base64_encode(&[0xfb, 0xff]), "+/8=");
}

#[test]
fn remote_start_carries_only_the_project_id_and_nonce() {
    // 프런트가 싣는 모양 — 스크립트 글자는 없다(이 모듈이 `projects.json` 에서 읽는다).
    let st: crate::ssh::SshStart = serde_json::from_str(
        r#"{"cwd":"~/api-wt/x","command":"claude","setup":{"projectId":"p1","nonce":"abcd1234"}}"#,
    )
    .unwrap();
    let setup = st.setup.unwrap();
    assert_eq!(
        (setup.project_id.as_str(), setup.nonce.as_str()),
        ("p1", "abcd1234")
    );
    // 원격 줄 — 스크립트가 성공할 때만 에이전트(`&&`), 한 줄 · ASCII.
    let prog = posix_program(
        &posix_path_expr("~/api-wt/x"),
        &posix_path_expr("~/api"),
        "npm ci",
        "abcd1234",
        &l(),
    );
    let line = format!("{} && claude", posix_line(&prog));
    assert!(
        line.starts_with("sh -c '") && line.ends_with("' && claude"),
        "{line}"
    );
    assert!(line.is_ascii() && !line.contains('\n'));
}

#[test]
fn remote_setup_types_a_short_line_and_writes_the_program_by_exec() {
    let prog = posix_program(
        &posix_path_expr("~/api-wt/x"),
        &posix_path_expr("~/api"),
        "npm ci\necho '끝'",
        "abcd1234",
        &l(),
    );
    let s = remote_setup_of(&prog, "abcd1234", Some("claude"));
    assert_eq!(
        s.short,
        "sh \"$HOME/.cache/aynx/setup-abcd1234.sh\" && claude"
    );
    assert_eq!(s.long, format!("{} && claude", posix_line(&prog)));
    assert_eq!(
        remote_setup_of(&prog, "abcd1234", Some("  ")).short,
        "sh \"$HOME/.cache/aynx/setup-abcd1234.sh\""
    );
    assert_eq!(
        remote_setup_of(&prog, "abcd1234", None).long,
        posix_line(&prog)
    );
    // 쓰는 명령 — 한 줄 · ASCII · 인용 한 겹 · 스크립트 글자는 그대로 싣지 않는다(8진).
    let w = &s.write_command;
    assert!(w.is_ascii() && !w.contains('\n'), "{w}");
    assert!(
        w.starts_with("sh -c 'umask 077 && mkdir -p \"$HOME/.cache/aynx\" && {"),
        "{w}"
    );
    assert!(
        w.ends_with("> \"$HOME/.cache/aynx/setup-abcd1234.sh\"; }'"),
        "{w}"
    );
    assert_eq!(w.matches('\'').count(), 2, "인용은 한 겹");
    assert!(!w.contains("끝"), "영숫자 밖의 글자는 8진으로만");
    // 파일은 첫 줄에서 자기를 지운다.
    assert!(posix_file_body(&prog).starts_with("rm -f -- \"$0\"\n"));
}

#[test]
fn local_posix_file_line_uses_the_shell_path_and_stays_ascii() {
    // Git Bash · WSL 이 읽는 꼴로 옮긴 데이터 폴더의 파일 — 영숫자 경로는 작은따옴표 한 겹.
    let f = r"C:\Users\me\AppData\Roaming\aynx-dev\setup-run\run-abcd1234.sh";
    assert_eq!(
        posix_file_line(&posix_local_path(f, PathStyle::Msys)),
        "sh '/c/Users/me/AppData/Roaming/aynx-dev/setup-run/run-abcd1234.sh'"
    );
    assert_eq!(
        posix_file_line(&posix_local_path(f, PathStyle::Wsl)),
        "sh '/mnt/c/Users/me/AppData/Roaming/aynx-dev/setup-run/run-abcd1234.sh'"
    );
    // 한글 · 공백 밖의 글자가 섞인 경로는 8진으로 — 치는 글자는 ASCII 뿐이다.
    let odd = posix_file_line("/c/Users/진열/it's/run-1.sh");
    assert!(odd.is_ascii(), "{odd}");
    assert!(odd.starts_with("sh \"$(printf %b \"/c/Users/"), "{odd}");
    // 본문 — 첫 줄 자기 삭제 · LF · ASCII · BOM 없음.
    let prog = posix_program(
        &posix_path_expr("/c/wt"),
        &posix_path_expr("/c/src"),
        "echo 끝",
        "abcd1234",
        &l(),
    );
    let body = posix_file_body(&prog);
    assert!(body.is_ascii() && !body.contains('\r'), "{body}");
    assert!(body.starts_with("rm -f -- \"$0\"\n") && body.ends_with('\n'));
}

#[test]
fn write_private_writes_bytes_as_given() {
    let dir = std::env::temp_dir().join(format!("aynx-setup-write-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("run-x.sh");
    write_private(&f, b"long old content\n").unwrap();
    write_private(&f, b"a\nb\n").unwrap();
    assert_eq!(
        std::fs::read(&f).unwrap(),
        b"a\nb\n",
        "덮어쓰면 줄어든다(truncate) · LF 그대로"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn nonce_must_be_hex() {
    assert!(check_nonce("0123abcd").is_ok());
    assert!(check_nonce("0123").is_err());
    assert!(check_nonce("0123abcz").is_err());
    assert!(check_nonce("../../x0").is_err());
}

#[test]
fn labels_split_around_the_number() {
    let x = labels("api", Some("Claude Code"));
    assert!(!x.ok_pre.contains(CUT) && !x.ok_post.contains(CUT));
    assert!(!x.fail_pre.is_empty() && !x.fail_post.is_empty());
    assert!(x.ok_tail.contains("Claude Code"));
    assert!(x.header.contains("api"));
    let y = labels("api", None);
    assert!(y.ok_tail.is_empty() && y.fail_tail.is_empty());
}
