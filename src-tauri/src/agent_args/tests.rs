use super::*;

fn p(s: &str) -> Vec<String> {
    parse_args(s).unwrap()
}

fn v(xs: &[&str]) -> Vec<String> {
    xs.iter().map(|x| x.to_string()).collect()
}

fn claude() -> &'static ArgsTarget {
    target("claude").unwrap()
}

fn codex() -> &'static ArgsTarget {
    target("codex").unwrap()
}

const U: &str = "11111111-2222-4333-8444-555555555555";
const V7: &str = "01a0dc8b-6ce8-77f1-9b8d-82e8a23c8840";

#[test]
fn table_ids_are_distinct_and_match_the_hook_table() {
    let mut ids = std::collections::HashSet::new();
    for t in TARGETS {
        assert!(ids.insert(t.id));
        assert!(
            crate::agent_hooks::TARGETS.iter().any(|h| h.id == t.id),
            "훅 표와 같은 id: {}",
            t.id
        );
        assert!(!t.exes.is_empty());
        // 프로젝트의 `agent` 칸은 id 를 그대로 실행 파일 이름으로 친다(`src/lib/projects.ts` 의 `agentCommand`) —
        // 셋째 에이전트도 이 약속을 지켜야 표 한 줄로 붙는다.
        assert_eq!(t.exes[0], t.id, "id = 첫 실행 파일 이름: {}", t.id);
    }
}

#[test]
fn agent_of_line_reads_the_first_word_and_keeps_the_rest() {
    assert_eq!(agent_of_line("claude"), Some(("claude", String::new())));
    assert_eq!(
        agent_of_line("  Claude.EXE  --model opus "),
        Some(("claude", "--model opus".to_string()))
    );
    assert_eq!(
        agent_of_line("codex --yolo"),
        Some(("codex", "--yolo".to_string()))
    );
    assert_eq!(agent_of_line("npm ci"), None);
    assert_eq!(agent_of_line(""), None);
    assert!(is_agent("claude") && is_agent("codex") && !is_agent("npm"));
    assert_eq!(display_of("codex"), Some("Codex"));
}

#[test]
fn parse_splits_on_whitespace_and_groups_quotes() {
    assert_eq!(p(""), Vec::<String>::new());
    assert_eq!(p("   "), Vec::<String>::new());
    assert_eq!(p("--model opus"), v(&["--model", "opus"]));
    assert_eq!(p("  --model   opus  "), v(&["--model", "opus"]));
    assert_eq!(
        p("--append-system-prompt \"be brief\""),
        v(&["--append-system-prompt", "be brief"])
    );
    assert_eq!(
        p("--append-system-prompt 'be brief'"),
        v(&["--append-system-prompt", "be brief"])
    );
    assert_eq!(p("--x=\"a b\"c"), v(&["--x=a bc"]));
    assert_eq!(p("-c \"model='o3'\""), v(&["-c", "model='o3'"]));
    assert_eq!(
        p("'a;b|c&d$e`f<g>h'"),
        v(&["a;b|c&d$e`f<g>h"]),
        "따옴표 안의 셸 글자는 글자다"
    );
    assert_eq!(p("C:\\dir\\x"), v(&["C:\\dir\\x"]), "역슬래시는 그냥 글자");
    assert_eq!(p("--add-dir 'C:\\my dir'"), v(&["--add-dir", "C:\\my dir"]));
    assert_eq!(
        p("--append-system-prompt '한국어로 답해'"),
        v(&["--append-system-prompt", "한국어로 답해"])
    );
    assert_eq!(p("a\u{3000}b"), v(&["a", "b"]), "전각 공백도 가른다");
    assert_eq!(p("'it''s'"), v(&["its"]), "붙은 따옴표 둘은 한 낱말");
}

#[test]
fn parse_rejects_shell_syntax_and_characters_shells_read() {
    for (s, e) in [
        ("--model opus; rm -rf /", ArgsError::ShellMeta(';')),
        ("a && b", ArgsError::ShellMeta('&')),
        ("a | b", ArgsError::ShellMeta('|')),
        ("a > out.txt", ArgsError::ShellMeta('>')),
        ("a < in", ArgsError::ShellMeta('<')),
        ("`whoami`", ArgsError::ShellMeta('`')),
        ("$(whoami)", ArgsError::ShellMeta('$')),
        ("$env:PATH", ArgsError::ShellMeta('$')),
        ("'unclosed", ArgsError::Unclosed('\'')),
        ("\"unclosed", ArgsError::Unclosed('"')),
        ("'say \"hi\"'", ArgsError::Forbidden('"')),
        ("%PATH%", ArgsError::Forbidden('%')),
        ("'100%'", ArgsError::Forbidden('%')),
        ("\u{2018}x\u{2019}", ArgsError::Forbidden('\u{2018}')),
        ("a\nb", ArgsError::Control),
        ("'a\nb'", ArgsError::Control),
        ("a\tb", ArgsError::Control),
        ("'a\rb'", ArgsError::Control),
        ("\u{1b}[31m", ArgsError::Control),
        ("''", ArgsError::Empty),
        ("'C:\\my dir\\'", ArgsError::TrailingBackslash),
        ("C:\\dir\\", ArgsError::TrailingBackslash),
        ("--x \"\"", ArgsError::Empty),
    ] {
        assert_eq!(parse_args(s), Err(e), "{s:?}");
    }
    assert_eq!(
        parse_args(&"a".repeat(MAX_LEN + 1)),
        Err(ArgsError::TooLong)
    );
    assert!(parse_args(&"a".repeat(MAX_LEN)).is_ok());
    for e in [
        ArgsError::Unclosed('\''),
        ArgsError::ShellMeta(';'),
        ArgsError::Forbidden('"'),
        ArgsError::Forbidden('%'),
        ArgsError::Control,
        ArgsError::Empty,
        ArgsError::TrailingBackslash,
        ArgsError::TooLong,
    ] {
        assert!(!e.message().is_empty());
    }
}

#[test]
fn quote_leaves_plain_words_and_wraps_the_rest_per_shell() {
    use QuoteStyle::*;
    for s in [PowerShell, Cmd, Posix] {
        assert_eq!(quote("--model", s), "--model");
        assert_eq!(quote("opus", s), "opus");
    }
    assert_eq!(quote("be brief", PowerShell), "'be brief'");
    assert_eq!(quote("it's", PowerShell), "'it''s'");
    assert_eq!(quote("--", PowerShell), "'--'");
    assert_eq!(
        quote("-Dfoo.bar=1", PowerShell),
        "'-Dfoo.bar=1'",
        "PowerShell 이 . 에서 가르는 옛 버그를 피한다"
    );
    assert_eq!(
        quote("a,b", PowerShell),
        "'a,b'",
        "PowerShell 에서 쉼표는 배열"
    );
    assert_eq!(quote("@x", PowerShell), "'@x'");
    assert_eq!(quote("$x;y", PowerShell), "'$x;y'");
    assert_eq!(quote("be brief", Cmd), "\"be brief\"");
    assert_eq!(quote("a&b|c", Cmd), "\"a&b|c\"");
    assert_eq!(quote("--model=opus", Cmd), "\"--model=opus\"");
    assert_eq!(quote("be brief", Posix), "'be brief'");
    assert_eq!(quote("it's", Posix), "'it'\\''s'");
    assert_eq!(quote("$(id)", Posix), "'$(id)'");
    assert_eq!(quote("=cmd", Posix), "'=cmd'", "zsh 의 = 확장");
    assert_eq!(quote("~/x", Posix), "'~/x'");
    assert_eq!(quote("Read,Write", Posix), "Read,Write");
    assert_eq!(quote("한국어", Posix), "'한국어'");
    assert_eq!(quote("한국어", PowerShell), "'한국어'");
}

/// 파서를 지난 어떤 낱말도 인용한 글자에서 따옴표를 벗어나지 못한다 — 인용 안에 그 셸이 따로 읽는 글자가 남지 않는다.
#[test]
fn quoted_user_tokens_cannot_break_out() {
    let attacks = [
        "'x'\"'\"'; calc'",
        "'a''; Remove-Item C:\\ -Recurse; '''",
        "\"& calc & \"",
        "\"a' ; whoami ; 'b\"",
        "'$(id)' '`id`' '${IFS}'",
        "\"^& calc\"",
        "\"a!b!\"",
    ];
    for a in attacks {
        let Ok(tokens) = parse_args(a) else { continue };
        for tok in &tokens {
            // PowerShell: '…' 안에서 끝낼 수 있는 것은 ' 뿐이고 모두 겹쳐졌다
            let ps = quote(tok, QuoteStyle::PowerShell);
            if ps.starts_with('\'') {
                let inner = &ps[1..ps.len() - 1];
                assert!(!inner.replace("''", "").contains('\''), "{ps}");
            } else {
                assert!(
                    ps.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_-=/+".contains(c)),
                    "{ps}"
                );
            }
            // cmd: "…" 안에 " 도 % 도 없다
            let cmd = quote(tok, QuoteStyle::Cmd);
            assert!(!cmd.trim_matches('"').contains(['"', '%']), "{cmd}");
            // POSIX: '…' 조각들 밖에는 \' 만 있다
            let sh = quote(tok, QuoteStyle::Posix);
            if sh.starts_with('\'') {
                let rebuilt = sh
                    .split("'\\''")
                    .map(|seg| seg.trim_matches('\''))
                    .collect::<Vec<_>>()
                    .join("'");
                assert_eq!(&rebuilt, tok, "{sh}");
            }
        }
    }
}

#[test]
fn quote_style_follows_the_tile_shell() {
    assert_eq!(quote_style(Some("pwsh")), QuoteStyle::PowerShell);
    assert_eq!(quote_style(Some("powershell")), QuoteStyle::PowerShell);
    assert_eq!(quote_style(Some("cmd")), QuoteStyle::Cmd);
    assert_eq!(quote_style(Some("gitbash")), QuoteStyle::Posix);
    assert_eq!(quote_style(Some("wsl:Ubuntu")), QuoteStyle::Posix);
    #[cfg(windows)]
    assert_eq!(quote_style(None), QuoteStyle::PowerShell);
    #[cfg(not(windows))]
    assert_eq!(quote_style(None), QuoteStyle::Posix);
}

fn with(line: &str, shell: Option<&str>, claude: &str, codex: &str) -> String {
    let (c, x) = (claude.to_owned(), codex.to_owned());
    with_extra_args(line, shell, move |id| match id {
        "claude" => Some(c.clone()),
        "codex" => Some(x.clone()),
        _ => None,
    })
}

#[test]
fn claude_extras_go_at_the_end_of_every_launch_kind() {
    let sh = Some("pwsh");
    let e = "--model opus --append-system-prompt 'be brief'";
    assert_eq!(
        with("claude", sh, e, ""),
        "claude --model opus --append-system-prompt 'be brief'"
    );
    assert_eq!(
        with(&format!("claude --resume {U}"), sh, e, ""),
        format!("claude --resume {U} --model opus --append-system-prompt 'be brief'")
    );
    assert_eq!(
        with(&format!("claude --resume {U} --fork-session"), sh, e, ""),
        format!(
            "claude --resume {U} --fork-session --model opus --append-system-prompt 'be brief'"
        )
    );
    assert_eq!(
        with("claude  ", sh, "--model opus", ""),
        "claude --model opus"
    );
    assert_eq!(
        with(
            "Claude.exe",
            Some("cmd"),
            "--append-system-prompt 'be brief'",
            ""
        ),
        "Claude.exe --append-system-prompt \"be brief\""
    );
    assert_eq!(
        with(
            "claude",
            Some("gitbash"),
            "--append-system-prompt \"it's\"",
            ""
        ),
        "claude --append-system-prompt 'it'\\''s'"
    );
}

#[test]
fn codex_extras_go_before_the_session_id() {
    let sh = Some("pwsh");
    let e = "--model o3 -c \"model_reasoning_effort='high'\"";
    let q = "--model o3 -c 'model_reasoning_effort=''high'''";
    assert_eq!(with("codex", sh, "", e), format!("codex {q}"));
    assert_eq!(
        with("codex --no-daemon", sh, "", "--model o3"),
        "codex --no-daemon --model o3"
    );
    assert_eq!(
        with(&format!("codex resume {V7}"), sh, "", e),
        format!("codex resume {q} {V7}")
    );
    assert_eq!(
        with(
            &format!("codex resume --no-daemon {V7}"),
            sh,
            "",
            "--model o3"
        ),
        format!("codex resume --no-daemon --model o3 {V7}")
    );
    assert_eq!(
        with(&format!("codex fork {V7}"), sh, "", "--model o3"),
        format!("codex fork --model o3 {V7}")
    );
    assert_eq!(
        with("codex exec hi", sh, "", "--model o3"),
        "codex --model o3 exec hi"
    );
    assert_eq!(
        with("codex resume", sh, "", "--model o3"),
        "codex resume --model o3"
    );
}

#[test]
fn nothing_changes_without_valid_extras_or_for_other_commands() {
    assert_eq!(with("claude", None, "", ""), "claude");
    assert_eq!(
        with("claude", None, "--model opus; calc", ""),
        "claude",
        "틀린 값은 통째로 버린다"
    );
    assert_eq!(with("claude", None, "'open", ""), "claude");
    assert_eq!(with("pwsh", None, "--model opus", "--model o3"), "pwsh");
    assert_eq!(with("npx claude", None, "--model opus", ""), "npx claude");
    assert_eq!(with("claudex", None, "--model opus", ""), "claudex");
    assert_eq!(with("", None, "--model opus", ""), "");
    assert_eq!(with_extra_args("claude", None, |_| None), "claude");
    // 한 에이전트의 인자가 다른 에이전트에 붙지 않는다
    assert_eq!(with("codex", Some("pwsh"), "--model opus", ""), "codex");
    assert_eq!(with("claude", Some("pwsh"), "", "--model o3"), "claude");
}

/// autorun 의 문([`crate::agent_autorun::agent_autorun_command`])과 같은 순서 — 추가 인자를 먼저, 그다음 `--no-daemon`.
#[test]
fn codex_no_daemon_lands_before_the_extras_and_respects_user_choices() {
    use crate::codex_launch::codex_line;
    let run = |cmd: &str, extras: &str, on: bool| {
        let l = with(cmd, Some("pwsh"), "", extras);
        codex_line(&l, on).unwrap_or(l)
    };
    assert_eq!(
        run("codex", "--model o3", true),
        "codex --no-daemon --model o3"
    );
    assert_eq!(run("codex", "--model o3", false), "codex --model o3");
    assert_eq!(
        run(&format!("codex resume {V7}"), "--model o3", true),
        format!("codex resume --no-daemon --model o3 {V7}")
    );
    assert_eq!(
        run(&format!("codex fork {V7}"), "--model o3", true),
        format!("codex fork --no-daemon --model o3 {V7}")
    );
    assert_eq!(
        run(&format!("codex resume {V7}"), "--model o3", false),
        format!("codex resume --model o3 {V7}")
    );
    assert_eq!(run("codex", "", true), "codex --no-daemon");
    // 사용자가 서버를 정했으면 끼우지 않는다(둘이 되지 않는다)
    assert_eq!(
        run("codex", "--remote ws://127.0.0.1:9", true),
        "codex --remote 'ws://127.0.0.1:9'"
    );
    assert_eq!(
        run("codex", "--no-daemon --model o3", true),
        "codex --no-daemon --model o3"
    );
}

/// 재개 · 포크 명령(`crate::agent_sessions` 가 짓는 한 줄)에 대고 — 설정 조합마다.
#[test]
fn resume_and_fork_launches_from_the_session_table() {
    use crate::codex_launch::codex_line;
    let lines = crate::agent_sessions::launch_lines_for_tests(U, V7);
    for (agent, mode, line) in lines {
        for on in [true, false] {
            let with_extras = with(&line, Some("pwsh"), "--model opus", "--model o3");
            let out = if agent == "codex" {
                codex_line(&with_extras, on).unwrap_or(with_extras)
            } else {
                with_extras
            };
            let want = match (agent, mode, on) {
                ("claude", "resume", _) => format!("claude --resume {U} --model opus"),
                ("claude", "fork", _) => format!("claude --resume {U} --fork-session --model opus"),
                ("codex", m, true) => format!("codex {m} --no-daemon --model o3 {V7}"),
                ("codex", m, false) => format!("codex {m} --model o3 {V7}"),
                other => panic!("{other:?}"),
            };
            assert_eq!(out, want);
        }
    }
}

#[test]
fn dangerous_flags_are_reported_not_blocked() {
    let d = |t: &ArgsTarget, s: &str| dangerous_of(&p(s), t);
    assert_eq!(
        d(claude(), "--dangerously-skip-permissions"),
        v(&["--dangerously-skip-permissions"])
    );
    assert_eq!(
        d(
            claude(),
            "--allow-dangerously-skip-permissions --model opus"
        ),
        v(&["--allow-dangerously-skip-permissions"])
    );
    assert_eq!(d(codex(), "--yolo --yolo"), v(&["--yolo"]));
    assert_eq!(
        d(codex(), "--dangerously-bypass-approvals-and-sandbox"),
        v(&["--dangerously-bypass-approvals-and-sandbox"])
    );
    assert_eq!(
        d(codex(), "--dangerously-something-new=1"),
        v(&["--dangerously-something-new=1"])
    );
    assert!(d(claude(), "--model opus").is_empty());
    assert!(d(claude(), "'not --dangerously'").is_empty());
}

#[test]
fn preview_shows_the_new_session_line_or_the_error() {
    let pv = preview_in(claude(), "--model opus", true, Some("pwsh"));
    assert_eq!(pv.line.as_deref(), Some("claude --model opus"), "claude 에는 덧붙이는 장식이 없다");
    assert_eq!(pv.error, None);
    assert_eq!(preview_in(claude(), "", true, None).line.as_deref(), Some("claude"));
    assert_eq!(
        preview_in(claude(), "--settings my.json", true, None)
            .line
            .as_deref(),
        Some("claude --settings 'my.json'")
    );
    assert_eq!(
        preview_in(codex(), "--model o3", true, Some("pwsh"))
            .line
            .as_deref(),
        Some("codex --no-daemon --model o3")
    );
    assert_eq!(
        preview_in(codex(), "--model o3", false, Some("pwsh"))
            .line
            .as_deref(),
        Some("codex --model o3")
    );
    assert_eq!(
        preview_in(codex(), "-c \"x='a b'\"", true, Some("gitbash"))
            .line
            .as_deref(),
        Some("codex --no-daemon -c 'x='\\''a b'\\'''")
    );
    let bad = preview_in(claude(), "--model opus; calc", true, None);
    assert_eq!(bad.line, None);
    assert!(bad.error.is_some());
    let yolo = preview_in(codex(), "--yolo", true, None);
    assert_eq!(yolo.dangerous, v(&["--yolo"]));
}
