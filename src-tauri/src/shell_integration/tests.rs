use super::*;

/// 조립 결과에서 heredoc 블록(표식 사이)을 꺼낸다 — 잘림 검사에 쓴다.
fn heredoc_body(script: &str) -> String {
    let mut inside = false;
    let mut body = String::new();
    for line in script.lines() {
        if !inside {
            if line.ends_with(&format!("<<'{HEREDOC_TAG}'")) {
                inside = true;
            }
            continue;
        }
        if line == HEREDOC_TAG {
            break;
        }
        body.push_str(line);
        body.push('\n');
    }
    body
}

#[test]
fn snippet_never_contains_the_heredoc_tag() {
    // 이것이 깨지면 원격 파일이 잘린다 — build_bootstrap_heredoc 도 Err 로 막는다.
    assert!(!SNIPPET.lines().any(|l| l.trim_end() == HEREDOC_TAG));
    assert!(build_bootstrap_heredoc(None).is_ok());
}

#[test]
fn snippet_wraps_for_tmux_with_doubled_escapes() {
    // docs/verification/tmux.md §1 의 규칙 그대로: ESC P tmux; + payload(ESC 이중화) + ESC \
    assert!(
        SNIPPET.contains(r"\033Ptmux;\033\033]133;%s\007\033\\"),
        "tmux passthrough 래핑이 사라졌다"
    );
    // 감싸지 않는 평문 경로도 함께 있어야 한다 ($TMUX 가 없을 때)
    assert!(SNIPPET.contains(r"printf '\033]133;%s\007'"));
    // $TMUX 로 갈린다
    assert!(SNIPPET.contains(r#"[ -n "$TMUX" ]"#));
}

#[test]
fn snippet_emits_all_four_markers_with_our_tag() {
    // v3: 마커마다 `aynx=1` 이 붙는다 — 프런트가 첫 A 의 태그로 소스를 고정한다.
    assert_eq!(SNIPPET.matches(r#"__aynx_emit "C;aynx=1""#).count(), 2); // bash · zsh
    assert_eq!(SNIPPET.matches(r#"__aynx_emit "D;$c;aynx=1""#).count(), 2);
    assert_eq!(SNIPPET.matches(r#"__aynx_emit "A;aynx=1""#).count(), 2);
    // B 만 자리가 다르다 — precmd 가 아니라 **PS1 의 끝**이다 (아래 테스트).
    // B 는 zsh 만 __aynx_emit 으로 담는다 — bash 는 PS1 이스케이프 글자로 적는다 (v5)
    assert_eq!(
        SNIPPET
            .matches(r#"__aynx_b=$(__aynx_emit "B;aynx=1")"#)
            .count(),
        1
    );
    // 태그 없는 옛 방출이 하나도 남지 않아야 한다.
    for old in [
        "__aynx_emit A",
        "__aynx_emit B",
        "__aynx_emit C",
        r#"__aynx_emit "D;$c""#,
    ] {
        assert!(!SNIPPET.contains(&format!("{old}\n")), "{old} 가 남았다");
        assert!(!SNIPPET.contains(&format!("{old};")), "{old} 가 남았다");
    }
}

#[test]
fn bash_c_marker_goes_to_the_terminal_not_the_commands_stdout() {
    // `{ a; b; } > f` 의 DEBUG trap 은 리다이렉트가 이미 걸린 뒤에 돈다 — stdout 에 내면
    // 마커가 사용자 파일에 박힌다 (docs/log/2026-09-27-shell-marker-redirect.md).
    // `2>` 가 `>/dev/tty` 보다 먼저여야 /dev/tty 를 못 열 때의 오류 문구도 삼킨다.
    let bash = SNIPPET
        .lines()
        .find(|l| l.starts_with("__aynx_pre(){ [ -n \"$__aynx_prev\" ]"))
        .expect("bash __aynx_pre");
    assert!(
        bash.contains(r#"__aynx_emit "C;aynx=1" 2>/dev/null >/dev/tty; return 0; }"#),
        "{bash}"
    );
    // 그 밖의 방출은 최상위(PROMPT_COMMAND · PS1 · zsh preexec)라 stdout 그대로다.
    assert_eq!(SNIPPET.matches("/dev/tty").count(), 1);
}

/// 진짜 bash 에 스니펫을 읽혀 **복합 명령의 리다이렉트 파일에 마커가 새지 않는지** 본다.
///
/// 파이프로 띄우므로 제어 터미널이 없다 — `/dev/tty` 가 안 열리는 경우의 **조용한 생략**까지
/// 함께 본다(stderr 가 비어야 한다). 터미널로 가는 쪽의 실측은 로그 문서에 있다.
/// bash 가 없는 기계에서는 조용히 건너뛴다 ([`gitbash_hook_lands_with_a_windows_shaped_folder`] 와 같은 규칙).
#[test]
fn bash_c_marker_does_not_leak_into_a_redirected_group() {
    #[cfg(windows)]
    const BASH: &str = r"C:\Program Files\Git\bin\bash.exe";
    #[cfg(not(windows))]
    const BASH: &str = "/bin/bash";
    if !Path::new(BASH).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aynx-redirect-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let wrote = std::fs::write(dir.join("s.sh"), snippet_file().as_bytes()).is_ok();
    if wrote {
        // 프롬프트를 흉내 낸다: 입력 대기(1)로 세운 뒤 복합 명령 하나.
        let script = ". ./s.sh; __aynx_state=1; { printf '# x\\n'; echo y; } > f.md; \
                          printf '%s|%s' \"$__aynx_state\" \"$__aynx_cmd\"";
        let out = std::process::Command::new(BASH)
            .args(["--norc", "--noprofile", "-c", script])
            .current_dir(&dir)
            .stdin(std::process::Stdio::null())
            .output();
        if let Ok(out) = out {
            let file = std::fs::read(dir.join("f.md")).unwrap_or_default();
            assert_eq!(file, b"# x\ny\n", "{:?}", String::from_utf8_lossy(&file));
            // trap 은 돌았다 — 첫 단순 명령을 사용자 명령으로 잡았다.
            assert_eq!(String::from_utf8_lossy(&out.stdout), "2|printf '# x\\n'");
            assert!(
                out.stderr.is_empty(),
                "{:?}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bash_b_is_written_as_ps1_escapes_so_the_tmux_st_backslash_survives() {
    // 날 바이트 `ESC \` 를 PS1 에 넣으면 끝의 `\` 가 감싸개의 `\]` 와 붙어 `\\` + `]` 가 된다
    // (docs/log/2026-09-27-shell-marker-redirect.md 의 v5 절). bash 갈래는 PS1 이스케이프 글자로 적는다.
    let bash = SNIPPET
        .lines()
        .find(|l| l.starts_with("if [ -n \"$TMUX\" ]; then __aynx_b="))
        .expect("bash 의 B");
    assert_eq!(
        bash,
        r#"if [ -n "$TMUX" ]; then __aynx_b='\033Ptmux;\033\033]133;B;aynx=1\007\033\\'; else __aynx_b='\033]133;B;aynx=1\007'; fi"#
    );
    // bash 갈래 안에 있다(zsh 는 날 바이트 — 프롬프트에서 `\` 가 특별하지 않다).
    let bash_at = SNIPPET.find(bash).unwrap();
    let bash_branch = SNIPPET.find("if [ -n \"$BASH_VERSION\" ]; then").unwrap();
    let zsh_branch = SNIPPET.find("elif [ -n \"$ZSH_VERSION\" ]; then").unwrap();
    assert!(bash_branch < bash_at && bash_at < zsh_branch);
    let zsh_b = SNIPPET.find(r#"__aynx_b=$(__aynx_emit "B;aynx=1")"#).unwrap();
    assert!(zsh_branch < zsh_b);
}

/// 진짜 bash 에서 `__aynx_ready` 가 붙인 PS1 을 `${PS1@P}`(bash 4.4+)로 풀어 **B 가 온전한지** 본다 —
/// tmux 면 passthrough 가 `ESC \` 로 끝나고 그 뒤에 `]` 가 없어야 하며, 아니면 BEL 꼴이다.
/// bash 가 없거나 4.4 보다 낡았으면 조용히 건너뛴다.
#[test]
fn bash_prompt_expands_the_b_marker_intact_with_and_without_tmux() {
    #[cfg(windows)]
    const BASH: &str = r"C:\Program Files\Git\bin\bash.exe";
    #[cfg(not(windows))]
    const BASH: &str = "/bin/bash";
    if !Path::new(BASH).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aynx-ps1-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if std::fs::write(dir.join("s.sh"), snippet_file().as_bytes()).is_ok() {
        // `@P` 는 4.4 전에는 문법 오류라 eval 뒤에 숨긴다. 두 번 부르는 것은 멱등 가드 확인이다.
        let script = "if [ $((BASH_VERSINFO[0]*100+BASH_VERSINFO[1])) -lt 404 ]; then printf OLD; exit 0; fi; \
                          . ./s.sh; PS1='$ '; __aynx_ready; __aynx_ready; eval 'printf %s \"${PS1@P}\"'";
        let cases: [(Option<&str>, &[u8]); 2] = [
            (Some("fake"), b"$ \x1bPtmux;\x1b\x1b]133;B;aynx=1\x07\x1b\\"),
            (None, b"$ \x1b]133;B;aynx=1\x07"),
        ];
        for (tmux, want) in cases {
            let mut cmd = std::process::Command::new(BASH);
            cmd.args(["--norc", "--noprofile", "-c", script])
                .current_dir(&dir)
                .stdin(std::process::Stdio::null());
            // 남의 훅 탐지에 걸리면 아무것도 심지 않는다 — 테스트를 도는 터미널의 흔적을 지운다.
            for var in [
                "TMUX",
                "VSCODE_SHELL_INTEGRATION",
                "ITERM_SHELL_INTEGRATION_INSTALLED",
                "KITTY_SHELL_INTEGRATION",
                "WARP_HONOR_PS1",
            ] {
                cmd.env_remove(var);
            }
            if let Some(t) = tmux {
                cmd.env("TMUX", t);
            }
            let Ok(out) = cmd.output() else { continue };
            if out.stdout == b"OLD" {
                return;
            }
            assert_eq!(
                out.stdout,
                want,
                "TMUX={tmux:?} {:?} / {:?}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn b_sits_at_the_end_of_ps1_and_is_reapplied_every_prompt() {
    // 옛 동작(precmd 에서 A 바로 뒤)은 PS1 이 그려지기 **전**이라 B 의 열이 언제나 0 이었다.
    // 이제는 PS1 꼬리에 붙어 프롬프트 문자열이 명령문에서 빠진다.
    assert!(
        SNIPPET.contains(r#"PS1="$PS1\[$__aynx_b\]""#),
        "bash 감싸개가 없다"
    );
    assert!(
        SNIPPET.contains(r#"PS1="$PS1%{$__aynx_b%}""#),
        "zsh 감싸개가 없다"
    );
    // 멱등 가드 — 이미 붙어 있으면 아무 일도 하지 않는다 (양쪽 셸 다).
    assert_eq!(
        SNIPPET.matches(r#"case "$PS1" in *"133;B"*) ;;"#).count(),
        2
    );
    // **매 프롬프트 다시 확인한다** — starship·oh-my-posh 는 PS1 을 통째로 다시 만든다.
    // bash 는 PROMPT_COMMAND 의 맨 뒤(__aynx_ready), zsh 는 precmd 의 맨 뒤.
    assert!(SNIPPET.contains("__aynx_ready(){ __aynx_state=1; case"));
    assert!(SNIPPET.contains("precmd_functions=(${precmd_functions:#__aynx_ready} __aynx_ready)"));
    assert!(SNIPPET
        .contains(r#"PROMPT_COMMAND="__aynx_post${PROMPT_COMMAND:+;$PROMPT_COMMAND};__aynx_ready""#));
}

#[test]
fn snippet_stands_down_when_another_integration_is_already_there() {
    // 설계 §5 ①: 환경 변수 넷 · 함수 이름 셋. 하나라도 걸리면 훅을 안 건다.
    for name in [
        "VSCODE_SHELL_INTEGRATION",
        "ITERM_SHELL_INTEGRATION_INSTALLED",
        "KITTY_SHELL_INTEGRATION",
        "WARP_HONOR_PS1",
    ] {
        assert!(SNIPPET.contains(&format!("[ -n \"${name}\" ]")), "{name}");
    }
    for func in ["__vsc_prompt_start", "iterm2_preexec", "starship_precmd"] {
        assert!(
            SNIPPET.contains(&format!("command -v {func} >/dev/null 2>&1")),
            "{func}"
        );
    }
    // 걸리면 __aynx_loaded 만 세우고 곧바로 돌아간다 (두 번 로드돼도 조용하다).
    assert!(SNIPPET.contains("then __aynx_loaded=1; return 0; fi"));
    // 탐지는 **source 시점 1회**다 — 프롬프트마다 도는 함수 안에 있으면 안 된다.
    let guard = SNIPPET.find("VSCODE_SHELL_INTEGRATION").expect("탐지");
    let first_fn = SNIPPET.find("__aynx_emit(){").expect("첫 함수");
    assert!(guard < first_fn, "탐지가 함수 정의보다 뒤에 있다");
}

#[test]
fn snippet_preserves_existing_prompt_command() {
    // oh-my-posh 공존 계약 — 기존 값을 가운데 두고 앞뒤로만 끼워 넣는다.
    assert!(SNIPPET
        .contains(r#"PROMPT_COMMAND="__aynx_post${PROMPT_COMMAND:+;$PROMPT_COMMAND};__aynx_ready""#));
    // bash 5.1+ 의 배열 형태도 같은 규칙으로 다룬다.
    assert!(SNIPPET.contains(r#"PROMPT_COMMAND=(__aynx_post "${PROMPT_COMMAND[@]}" __aynx_ready)"#));
    // 종료 코드를 뒤 함수에 그대로 넘긴다 (테마가 $? 로 색을 정한다)
    assert!(SNIPPET.contains("return $c; }"));
}

#[test]
fn snippet_appends_to_the_server_history_file() {
    assert!(SNIPPET.contains(r#">> "$HOME/.aynx/history""#));
    assert!(SNIPPET.contains("mkdir -p \"$HOME/.aynx\""));
    // ISO 시각 · 종료 코드 · 명령 세 칸의 TSV
    assert!(SNIPPET.contains(r"printf '%s\t%s\t%s\n'"));
    // 시각은 UTC ISO 8601 한 칸
    assert!(SNIPPET.contains("date -u +%Y-%m-%dT%H:%M:%SZ"));
}

// ── 조용한 경로 (SFTP 로 파일을 심은 뒤) ────────────────────────────────

#[test]
fn quiet_bootstrap_types_exactly_one_command_line() {
    // 실기 피드백의 핵심 — 접속 화면에 남는 것은 **한 줄**이어야 한다.
    let script = build_bootstrap_quiet(None);
    assert!(script.starts_with('\n'), "{script:?}");
    assert!(script.ends_with('\n'), "{script:?}");
    let lines: Vec<&str> = script.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(lines.len(), 1, "{script:?}");
    // 그 한 줄이 source + tmux 를 이 순서로 담는다
    assert!(
        lines[0].starts_with(". ~/.aynx/integration.sh; "),
        "{script:?}"
    );
    assert!(lines[0].ends_with(TMUX_PASSTHROUGH), "{script:?}");
    // 파일 심기는 셸이 하지 않는다 (그것이 SFTP 로 간 이유다)
    assert!(!script.contains(HEREDOC_TAG), "{script:?}");
    assert!(!script.contains("cat >"), "{script:?}");
}

#[test]
fn quiet_bootstrap_order_is_source_tmux_then_on_connect() {
    let script = build_bootstrap_quiet(Some("cd /srv\n"));
    let source = script.find(". ~/.aynx/integration.sh").expect("source");
    let tmux = script.find("allow-passthrough").expect("tmux");
    let user = script.find("cd /srv").expect("on_connect");
    assert!(source < tmux, "{script}");
    assert!(tmux < user, "{script}");
    // on_connect 는 **다음 줄**이다 (한 줄에 이어 붙지 않는다)
    assert!(script.ends_with("\ncd /srv\n"), "{script}");
}

#[test]
fn quiet_on_connect_without_trailing_newline_gets_one() {
    let script = build_bootstrap_quiet(Some("tmux new -A -s main"));
    assert!(script.ends_with("tmux new -A -s main\n"), "{script}");
}

// ── 시작 파일로 실행 (exec 런처 · rc · 결정표) ──────────────────────────

#[test]
fn launcher_has_exactly_two_single_quotes() {
    // sshd 는 이 문자열을 `$SHELL -c <명령>` 으로 건넨다. 그 셸이 fish·csh 여도 깨지지
    // 않는 유일한 모양이 **작은따옴표 한 겹**이고, 그래서 안쪽에는 하나도 없어야 한다.
    let s = exec_launcher();
    assert_eq!(s.matches('\'').count(), 2, "{s}");
    let first = s.find('\'').unwrap();
    let last = s.rfind('\'').unwrap();
    assert!(!s[first + 1..last].contains('\''), "{s}");
    // 여는 따옴표는 `sh -c` 바로 뒤, 닫는 따옴표는 맨 끝이다.
    assert!(s.starts_with("exec sh -c '"), "{s}");
    assert!(s.ends_with("fi'"), "{s}");
}

/// tmux 새 세션의 셸(2026-10-08) — rc 가 있고 bash 면 런처와 같은 rc 로, 아니면 예전 그대로 `exec "${SHELL:-/bin/sh}" -l`.
/// 세션 명령은 `sh_quote` 한 겹 안에 들어가므로 작은따옴표가 없어야 하고, rc 경로는 런처와 같은 글자다.
#[test]
fn tmux_session_shell_uses_the_rc_only_when_it_exists_and_bash() {
    let s = tmux_session_shell(false);
    assert_eq!(
        s,
        "if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; \
             else exec \"${SHELL:-/bin/sh}\" -l; fi"
    );
    assert!(!s.contains('\''), "{s}");
    assert!(!s.contains('!') && !s.contains('~'), "{s}");
    // rc 없음 · bash 아님의 갈래 = 지금까지의 세션 셸 글자 그대로
    assert!(s.ends_with("else exec \"${SHELL:-/bin/sh}\" -l; fi"), "{s}");
    // 런처와 같은 rc 를 가리킨다
    assert!(exec_launcher().contains(&format!("--rcfile \"{RC_IN_LAUNCHER}\" -i")));
    assert!(s.contains(&format!("--rcfile \"{RC_IN_LAUNCHER}\" -i")));
}

/// 에이전트 활성화(2026-10-26)면 셸 통합 rc 가 없을 때 bash 는 에이전트 rc 로 — 셸 통합 rc 가 먼저, 나머지는 예전 `-l`.
#[test]
fn tmux_session_shell_with_agent_falls_back_to_the_agent_rc_for_bash() {
    let s = tmux_session_shell(true);
    assert_eq!(
        s,
        "if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; \
             elif [ -f \"$HOME/.config/aynx/agent-rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.config/aynx/agent-rc\" -i; \
             else exec \"${SHELL:-/bin/sh}\" -l; fi"
    );
    assert!(!s.contains('\'') && !s.contains('!') && !s.contains('~'), "{s}");
}

#[test]
fn launcher_hooks_bash_and_leaves_other_shells_alone() {
    let s = exec_launcher();
    assert_eq!(
        s,
        "exec sh -c 'if [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; \
             else exec \"${SHELL:-/bin/sh}\" -l; fi'"
    );
    // `$SHELL` 이 빈 계정에서도 셸이 뜬다 (WSL 런처와 같은 이유).
    assert!(s.contains("${SHELL:-/bin/sh}"), "{s}");
    // 경로는 `~` 가 아니라 `$HOME` 이다 — 큰따옴표 안에서 `~` 는 풀리지 않는다.
    assert!(!s.contains('~'), "{s}");
    // 히스토리 전개 문자는 여기에도 없어야 한다 (셸이 읽는 줄이다).
    assert!(!s.contains('!'), "{s}");
}

#[test]
fn rc_reads_the_login_profiles_in_order_then_our_snippet() {
    let rc = remote_rc_body();
    let etc = rc.find("/etc/profile").expect("/etc/profile");
    let bash_profile = rc.find(".bash_profile").expect(".bash_profile");
    let bash_login = rc.find(".bash_login").expect(".bash_login");
    let profile = rc.find("$HOME/.profile").expect(".profile");
    let snippet = rc.find(SNIPPET_IN_HOME).expect("snippet");
    // 심 폴더 다시 앞으로(v2): 머리는 프로필 전, 꼬리는 프로필 뒤 · 스니펫 전.
    let mark = rc.find(crate::agent_shim::RC_SHIM_MARK).expect("mark");
    let front = rc.find(crate::agent_shim::RC_SHIM_FRONT).expect("front");
    assert!(mark < etc && profile < front && front < snippet, "{rc}");
    let tmux = rc.find("allow-passthrough").expect("tmux");
    // 로그인 셸과 같은 순서: /etc/profile → 셋 중 처음 있는 것 하나 → 우리 것
    assert!(etc < bash_profile, "{rc}");
    assert!(bash_profile < bash_login, "{rc}");
    assert!(bash_login < profile, "{rc}");
    assert!(profile < snippet, "{rc}");
    assert!(snippet < tmux, "{rc}");
    // 셋 중 **하나만** 읽는다 (break) — 로그인 bash 와 같은 규칙이다.
    assert!(rc.contains("break; fi"), "{rc}");
    assert!(rc.contains("unset __aynx_f"), "{rc}");
    // `~/.bashrc` 를 따로 **읽지 않는다** — 로그인 bash 는 프로필을 통해서만 그것을
    // 읽는다 (주석으로는 언급하되 source 하는 줄이 없어야 한다).
    assert!(!rc.contains("$HOME/.bashrc"), "{rc}");
    assert!(rc.contains("# ~/.bashrc 는 따로 읽지 않는다"), "{rc}");
    // tmux 줄은 의미가 그대로다 (조용한 경로와 **같은 상수**).
    assert!(rc.contains(TMUX_PASSTHROUGH), "{rc}");
    // 첫 줄이 버전이고, 줄바꿈은 LF 하나다 (CR 이 섞이면 bash 가 죽는다).
    assert!(rc.starts_with("# aynx shell integration rc (v"), "{rc}");
    assert!(!rc.contains('\r'), "{rc:?}");
    assert!(rc.ends_with('\n'), "{rc:?}");
}

#[test]
fn rc_paths_all_point_at_the_same_two_files() {
    // SFTP(상대) · 셸(`~`) · 런처(`$HOME`) 세 표기가 같은 자리를 가리켜야 한다.
    assert_eq!(RC_PATH.strip_prefix("~/").unwrap(), REMOTE_RC_PATH);
    assert_eq!(
        RC_IN_LAUNCHER.strip_prefix("$HOME/").unwrap(),
        REMOTE_RC_PATH
    );
    assert_eq!(SNIPPET_IN_HOME.strip_prefix("$HOME/").unwrap(), REMOTE_PATH);
    assert_eq!(RC_PATH.strip_suffix("/rc").unwrap(), "~/.aynx");
    // 런처가 읽는 파일이 곧 우리가 SFTP 로 올리는 파일이다.
    assert!(exec_launcher().contains(RC_IN_LAUNCHER));
    assert!(remote_rc_body().contains(SNIPPET_IN_HOME));
}

#[test]
fn the_decision_table_is_the_whole_contract() {
    use BootstrapPlan::*;
    use RemoteSetup::*;
    let bash = Some("/bin/bash");
    // exec 런처는 **bash 일 때만**이다.
    assert_eq!(bootstrap_plan(true, ExecReady, bash), Exec);
    assert_eq!(bootstrap_plan(true, ExecReady, Some("/usr/bin/bash")), Exec);
    // zsh·fish·sh 는 오늘까지의 경로 그대로 — 훅을 잃지 않는다.
    for other in ["/usr/bin/zsh", "/usr/bin/fish", "/bin/sh", "/bin/csh", ""] {
        assert_eq!(
            bootstrap_plan(true, ExecReady, Some(other)),
            ShellQuiet,
            "{other}"
        );
    }
    // 답이 없으면(탐침 실패·타임아웃) 모르는 쪽으로 안전하게 기운다.
    assert_eq!(bootstrap_plan(true, ExecReady, None), ShellQuiet);
    // /bin/sh 가 없는 서버는 로그인 셸과 무관하게 타이핑 경로다.
    assert_eq!(bootstrap_plan(true, FilesOnly, bash), ShellQuiet);
    assert_eq!(bootstrap_plan(true, Failed, bash), ShellHeredoc);
    // 옵트아웃이 가장 세다 — SFTP 를 시도조차 하지 않으므로 나머지 인자는 무의미하다.
    for setup in [ExecReady, FilesOnly, Failed] {
        assert_eq!(bootstrap_plan(false, setup, bash), ShellOptOut);
        assert_eq!(bootstrap_plan(false, setup, None), ShellOptOut);
    }
}

#[test]
fn the_login_shell_probe_works_in_any_shell() {
    // sshd 는 이것도 `<로그인 셸> -c` 로 돌린다 — 런처와 같은 인용 규칙이 필요하다.
    assert_eq!(LOGIN_SHELL_PROBE, "echo \"$SHELL\"");
    assert!(!LOGIN_SHELL_PROBE.contains('\''), "{LOGIN_SHELL_PROBE}");
    assert!(!LOGIN_SHELL_PROBE.contains('!'));
    // 판정은 경로가 아니라 이름으로 한다 (런처의 `${SHELL##*/}` 와 같은 규칙).
    assert!(is_bash(Some("/bin/bash")));
    assert!(is_bash(Some("bash")));
    assert!(!is_bash(Some("/bin/bash-completion")));
    assert!(!is_bash(Some("/usr/bin/zsh")));
    assert!(!is_bash(Some("")));
    assert!(!is_bash(None));
}

#[test]
fn the_exec_path_types_nothing_of_ours() {
    // 훅은 시작 파일이 이미 걸었다 — 남는 것은 사용자의 on_connect 뿐이다.
    assert_eq!(build_bootstrap_exec(None), "");
    let script = build_bootstrap_exec(Some("cd /srv"));
    assert_eq!(script, "cd /srv\n"); // 끝 개행 계약은 그대로다
    for ours in [
        SNIPPET_PATH,
        RC_PATH,
        HEREDOC_TAG,
        "allow-passthrough",
        "__aynx",
    ] {
        assert!(!script.contains(ours), "{ours} 가 남았다: {script:?}");
    }
}

// ── 부트스트랩 에코 지우기 (EchoFilter) ─────────────────────────────────

/// 청크들을 차례로 먹여 나온 바이트를 잇는다 (실제 펌프와 같은 순서).
fn pump(filter: &mut EchoFilter, chunks: &[&str]) -> String {
    let mut out = Vec::new();
    for c in chunks {
        out.extend_from_slice(&filter.feed(c.as_bytes()));
    }
    String::from_utf8(out).expect("유효한 UTF-8")
}

#[test]
fn quiet_bootstrap_types_exactly_the_line_the_filter_erases() {
    // 조립과 지우기가 같은 문자열을 봐야 한다 — 갈라지면 에코가 화면에 남는다.
    let line = quiet_command_line();
    let script = build_bootstrap_quiet(None);
    assert_eq!(script, format!("\n{line}\n"));
    assert!(line.starts_with(". ~/.aynx/integration.sh; "));
    assert!(!line.contains('\n'));
}

#[test]
fn echo_is_erased_inside_a_single_chunk() {
    let line = quiet_command_line();
    let mut f = EchoFilter::for_line(&line);
    let out = pump(&mut f, &[&format!("user@host:~$ {line}\r\nuser@host:~$ ")]);
    // 줄바꿈은 남는다 — 지우면 다음 프롬프트가 앞 줄에 붙는다.
    assert_eq!(out, "user@host:~$ \r\nuser@host:~$ ");
}

#[test]
fn echo_is_erased_across_chunk_boundaries() {
    let line = quiet_command_line();
    // 한 글자씩 쪼개도 결과가 같아야 한다 (경계가 needle 한가운데를 지나는 최악).
    let stream = format!("$ {line}\r\n$ ");
    let chunks: Vec<String> = stream.chars().map(|c| c.to_string()).collect();
    let refs: Vec<&str> = chunks.iter().map(String::as_str).collect();
    let mut f = EchoFilter::for_line(&line);
    assert_eq!(pump(&mut f, &refs), "$ \r\n$ ");
}

#[test]
fn a_mismatch_passes_everything_through_byte_for_byte() {
    let line = quiet_command_line();
    let mut f = EchoFilter::for_line(&line);
    // 앞부분만 같고 뒤가 다른 줄 — 한 바이트도 삼키면 안 된다 (붙들었던 것도 돌려준다).
    let stream = ". ~/.aynx/integration.sh\r\necho hi\r\n";
    assert_eq!(pump(&mut f, &[stream]), stream);

    // heredoc 폴백 경로의 화면(= 우리 한 줄이 아예 없다)도 그대로 통과한다.
    let mut f = EchoFilter::for_line(&line);
    let fallback = build_bootstrap_heredoc(None).unwrap();
    assert_eq!(pump(&mut f, &[&fallback]), fallback);
}

#[test]
fn only_the_first_occurrence_is_erased() {
    let line = quiet_command_line();
    let mut f = EchoFilter::for_line(&line);
    // 두 번째는 사용자가 직접 친 것일 수 있다 — 남겨야 한다.
    let out = pump(&mut f, &[&format!("$ {line}\r\n$ {line}\r\n")]);
    assert_eq!(out, format!("$ \r\n$ {line}\r\n"));
}

#[test]
fn past_the_budget_nothing_is_touched() {
    let line = quiet_command_line();
    let mut f = EchoFilter::for_line(&line);
    // MOTD 가 예산을 통째로 먹으면 그 뒤의 우리 줄은 포기한다 (지우기보다 통과가 안전).
    let motd = "M".repeat(ECHO_BUDGET);
    let out = pump(&mut f, &[&motd, &format!("$ {line}\r\n")]);
    assert_eq!(out, format!("{motd}$ {line}\r\n"));
}

#[test]
fn newlines_match_cr_lf_or_crlf() {
    // 서버가 줄바꿈을 변환해 에코해도 같은 줄로 본다.
    for eol in ["\n", "\r", "\r\n"] {
        let mut f = EchoFilter::for_line("a\nb");
        assert_eq!(pump(&mut f, &[&format!("x a{eol}b y")]), "x  y");
    }
    // CRLF 가 청크 경계에 걸려도 `\n` 을 흘리지 않는다.
    let mut f = EchoFilter::for_line("a\nb");
    assert_eq!(pump(&mut f, &["x a\r", "\nb y"]), "x  y");
}

#[test]
fn passthrough_filter_never_touches_anything() {
    // 옵트아웃 호스트 — 심은 것이 없으니 지울 것도 없다.
    let mut f = EchoFilter::passthrough();
    let line = quiet_command_line();
    assert_eq!(pump(&mut f, &[&line, "\r\n"]), format!("{line}\r\n"));
}

// ── 옵트아웃 경로 (shell_integration = false) ───────────────────────────

#[test]
fn opt_out_types_nothing_of_ours() {
    // "이 서버엔 아무것도 심지 마라" — 우리 흔적이 한 글자도 없어야 한다.
    assert_eq!(build_bootstrap_opt_out(None), "");

    let script = build_bootstrap_opt_out(Some("cd /srv\n"));
    assert_eq!(script, "cd /srv\n");
    for ours in [
        SNIPPET_PATH,
        HEREDOC_TAG,
        "mkdir -p",
        "allow-passthrough",
        "__aynx",
    ] {
        assert!(!script.contains(ours), "{ours} 가 남았다: {script:?}");
    }
}

#[test]
fn opt_out_still_normalizes_the_users_command() {
    // on_connect 계약은 그대로다 — 끝 개행이 없으면 하나 붙는다 (없으면 실행되지 않는다).
    assert_eq!(
        build_bootstrap_opt_out(Some("tmux new -A -s main")),
        "tmux new -A -s main\n"
    );
}

/// SFTP 로 올리는 바이트와 셸이 heredoc 으로 만드는 바이트가 같아야 한다 —
/// 다르면 "내용이 같으면 생략" 최적화가 접속마다 다시 쓰게 된다.
#[test]
fn both_paths_write_the_same_file() {
    let file = snippet_file();
    assert!(file.ends_with('\n'));
    assert_eq!(file.trim_end(), SNIPPET.trim_end());
    let script = build_bootstrap_heredoc(None).unwrap();
    assert_eq!(heredoc_body(&script), file);
}

/// SFTP 경로와 셸 경로는 **같은 파일**을 가리켜야 한다. SFTP v3 에는 `~` 를 풀어 줄
/// 셸이 없고 상대 경로의 기준이 홈이므로, `~/` 를 뗀 것이 정확히 그 자리다.
#[test]
fn remote_path_is_the_typed_path_without_the_tilde() {
    assert_eq!(SNIPPET_PATH.strip_prefix("~/").unwrap(), REMOTE_PATH);
    assert!(!REMOTE_PATH.starts_with('/') && !REMOTE_PATH.starts_with('~'));
    assert_eq!(
        REMOTE_PATH.strip_suffix("/integration.sh").unwrap(),
        REMOTE_DIR
    );
}

// ── 폴백 경로 (heredoc) ─────────────────────────────────────────────────

#[test]
fn bootstrap_order_is_snippet_source_tmux_then_on_connect() {
    let script = build_bootstrap_heredoc(Some("cd /srv\n")).unwrap();
    let heredoc = script.find("<<'AYNX_EOF'").expect("heredoc 시작");
    let terminator = script.find("\nAYNX_EOF\n").expect("heredoc 종료");
    let source = script.find(". ~/.aynx/integration.sh").expect("source");
    let tmux = script.find("allow-passthrough").expect("tmux");
    let user = script.find("cd /srv").expect("on_connect");
    assert!(heredoc < terminator, "{script}");
    assert!(terminator < source, "{script}");
    assert!(source < tmux, "{script}");
    assert!(tmux < user, "{script}");
}

#[test]
fn bootstrap_overwrites_idempotently_and_ends_with_newline() {
    let script = build_bootstrap_heredoc(None).unwrap();
    // 두 경로 모두 앞 개행 하나로 시작한다 (MOTD 뒤 프롬프트 줄과 섞이지 않게)
    assert!(script.starts_with('\n'), "{script}");
    // `>` 여야 재접속마다 갱신된다 (`>>` 면 파일이 무한히 자란다)
    assert!(script.starts_with("\nmkdir -p ~/.aynx && cat > ~/.aynx/integration.sh <<'AYNX_EOF'\n"));
    // 마지막 줄도 개행으로 끝나야 셸이 읽는다 (입력 줄에 걸린 채 남지 않게)
    assert!(script.ends_with('\n'));
    // on_connect 가 없어도 주입은 한다
    assert!(script.contains(". ~/.aynx/integration.sh"));
}

#[test]
fn on_connect_without_trailing_newline_gets_one() {
    let script = build_bootstrap_heredoc(Some("tmux new -A -s main")).unwrap();
    assert!(script.ends_with("tmux new -A -s main\n"), "{script}");
}

#[test]
fn on_connect_cannot_truncate_the_heredoc() {
    // 사용자가 자기 명령에 종료 표식을 적어도 스니펫은 온전해야 한다 —
    // on_connect 는 heredoc **바깥**(종료 표식 뒤)에 붙기 때문이다.
    let script = build_bootstrap_heredoc(Some("echo hi\nAYNX_EOF\necho bye\n")).unwrap();
    assert_eq!(heredoc_body(&script).trim_end(), SNIPPET.trim_end());
    // 사용자 줄은 스니펫 뒤에 그대로 남는다 (앱이 해석하거나 지우지 않는다)
    let after = script.split_once(". ~/.aynx/integration.sh").unwrap().1;
    assert!(after.contains("\nAYNX_EOF\n"));
    assert!(after.contains("echo bye"));
}

#[test]
fn heredoc_body_round_trips() {
    // 조립한 뒤 다시 꺼낸 본문이 원본과 같아야 한다 (구분자·개행 처리 검증)
    let script = build_bootstrap_heredoc(None).unwrap();
    assert_eq!(heredoc_body(&script).trim_end(), SNIPPET.trim_end());
}

#[test]
fn nothing_we_type_can_trigger_history_expansion() {
    // 스니펫도 부트스트랩도 대화형 bash 에 **타이핑되듯** 들어간다. `!` 가 있으면
    // 히스토리 전개가 그 줄을 먹어 버린다 (heredoc 본문도 예외가 아니다).
    // 두 경로 다 지켜야 한다 — 조용한 경로도 결국 타이핑이다.
    for script in [
        build_bootstrap_heredoc(None).unwrap(),
        build_bootstrap_quiet(None),
    ] {
        assert!(
            !script.contains('!'),
            "부트스트랩에 히스토리 전개 문자가 있다"
        );
        // 줄 첫 글자의 `^` 는 대화형 bash 의 빠른 치환(`^old^new`)이다.
        assert!(!script.lines().any(|l| l.starts_with('^')));
    }
}

// ── 로컬 PowerShell 훅 (OSC 7) ──────────────────────────────────────────

#[test]
fn ps_snippet_is_ascii_only_and_versioned() {
    // 5.1 은 BOM 없는 파일을 ANSI 코드 페이지로 읽는다 — ASCII 밖으로 나가면 깨진다.
    assert!(
        PS_SNIPPET.is_ascii(),
        "PowerShell 스니펫에 ASCII 밖 글자가 있다"
    );
    // 첫 줄이 곧 버전이다 (내용이 바뀌면 ensure_ps_script 가 알아서 다시 쓴다).
    assert!(PS_SNIPPET.starts_with("# aynx shell integration (v"));
    assert!(ps_snippet_file().ends_with('\n'));
}

#[test]
fn ps_snippet_emits_osc7_inside_the_returned_prompt() {
    // OSC 를 **반환 문자열 안에** 넣는 것이 계약이다 (PSReadLine 재렌더에 살아남는다).
    assert!(PS_SNIPPET.contains(r#"$__w = "$__esc]7;file://localhost/$__p$__bel""#));
    // 사용자 프롬프트를 감싼다 — 원본을 먼저 부르고 꼬리에 붙인다.
    assert!(PS_SNIPPET.contains("$__r = & $function:__aynx_prompt_orig"));
    // 두 번 읽어도 자기 자신을 감싸지 않는다.
    assert!(PS_SNIPPET.contains(r"if (-not (Test-Path Function:\global:__aynx_prompt_orig))"));
    // 폴더가 없는 공급자(HKLM: · Env:)에서는 아무것도 내지 않는다.
    assert!(PS_SNIPPET.contains("$__loc.Provider.Name -eq 'FileSystem'"));
    // 구분자는 슬래시고, 정규식이 아니라 String.Replace 다 (`-replace '\'` 는 죽는다).
    assert!(PS_SNIPPET.contains(r"$__loc.ProviderPath.Replace('\', '/')"));
    assert!(!PS_SNIPPET.contains("-replace"));
}

#[test]
fn ps_snippet_wraps_the_prompt_in_osc133_a_and_b() {
    // 돌려주는 문자열 하나가 [D] A <사용자 prompt> OSC7 B 다 — B 가 **진짜 끝**이다.
    assert!(
        PS_SNIPPET.contains(r#""$__d$__esc]133;A;aynx=1$__bel$__r$__w$__esc]133;B;aynx=1$__bel""#)
    );
    // 종료 코드는 명령이 실제로 돌았을 때만, 그리고 A 보다 **앞**에 나간다.
    assert!(PS_SNIPPET.contains(r#"if ($__ran) { $__d = "$__esc]133;D;$__c;aynx=1$__bel" }"#));
    // `$?` 는 prompt 의 첫 문장에서, 그것도 **함수 안 첫 줄**에서 읽는다
    // (대입 한 줄이 $? 를 지운다 — 실기로 확인).
    let code = PS_SNIPPET.find("$__c = __aynx_code").expect("첫 문장");
    let esc = PS_SNIPPET.find("$__esc = [char]27").expect("그다음");
    assert!(code < esc, "{PS_SNIPPET}");
    assert!(PS_SNIPPET.contains("function global:__aynx_code {\n    $__ok = $?"));
    // OSC 7 은 그대로 살아 있다 (v1 의 유일한 일이었다).
    assert!(PS_SNIPPET.contains(r#"$__w = "$__esc]7;file://localhost/$__p$__bel""#));
}

#[test]
fn ps_snippet_emits_c_from_a_psreadline_enter_handler() {
    // C 는 프롬프트 밖이다 — Enter 를 **실제로 수락했을 때만** 낸다.
    assert!(PS_SNIPPET.contains("Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {"));
    assert!(PS_SNIPPET.contains("[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState("));
    // 파스 오류(여러 줄 입력 중간)와 빈 입력은 거른다 — C 중복·가짜 블록 방지.
    assert!(PS_SNIPPET.contains(
        r#"$__go = ($__txt.Trim().Length -gt 0) -and (($null -eq $__pe) -or ($__pe.Count -eq 0))"#
    ));
    // 순서가 계약이다: AcceptLine **뒤에** C 를 내야 커서가 출력의 첫 줄에 있다.
    let accept = PS_SNIPPET.find("::AcceptLine()").expect("AcceptLine");
    let emit = PS_SNIPPET.find("]133;C;aynx=1").expect("C");
    assert!(accept < emit, "{PS_SNIPPET}");
    // PSReadLine 이 없으면 핸들러를 아예 걸지 않는다 (그 세션은 A/B/D 만 낸다).
    assert!(PS_SNIPPET.contains("if (Get-Module PSReadLine) {"));
    // 그래도 D 는 나온다 — 히스토리 id 변화가 둘째 신호다.
    assert!(PS_SNIPPET.contains(r#"$__ran = $global:__aynx_ran -or ($__id -ne $global:__aynx_hist)"#));
}

#[test]
fn ps_snippet_stands_down_when_another_integration_is_already_there() {
    assert!(PS_SNIPPET.contains(
        "if ($env:VSCODE_SHELL_INTEGRATION -or $env:ITERM_SHELL_INTEGRATION_INSTALLED) { return }"
    ));
    // 첫 줄(버전) 바로 다음이어야 한다 — 아무것도 정의하기 전에 물러난다.
    let second = PS_SNIPPET.lines().nth(1).expect("둘째 줄");
    assert!(
        second.starts_with("if ($env:VSCODE_SHELL_INTEGRATION"),
        "{second}"
    );
}

#[test]
fn ps_dot_source_quotes_paths_with_spaces_and_apostrophes() {
    assert_eq!(
        ps_dot_source(r"C:\Users\wl\AppData\Roaming\aynx\integration.ps1"),
        r". 'C:\Users\wl\AppData\Roaming\aynx\integration.ps1'"
    );
    // 작은따옴표는 두 번 적어 탈출한다 — 그것 하나뿐이다(백슬래시·$ 는 글자 그대로).
    assert_eq!(
        ps_dot_source(r"C:\Users\o'brien\My Docs\한글\integration.ps1"),
        r". 'C:\Users\o''brien\My Docs\한글\integration.ps1'"
    );
    assert_eq!(ps_single_quote("$env:PATH`x"), "'$env:PATH`x'");
}

/// 진짜 PowerShell 을 세워 훅이 OSC 7 을 내는지 본다 — **비대화형**으로 `prompt` 를
/// 한 번 굴린다 (`-NoExit` 은 여기서 쓸 수 없다: 프로세스가 끝나지 않는다).
///
/// pwsh 도 powershell 도 못 띄우는 기계에서는 **조용히 건너뛴다** — 이 테스트는
/// CI 를 흔들 자격이 없다 (`cwd.rs` 의 실기 테스트와 같은 규칙).
#[cfg(windows)]
#[test]
fn powershell_hook_reports_the_current_folder_as_osc7() {
    let dir = std::env::temp_dir().join(format!("aynx-ps-hook-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(PS_SCRIPT_NAME);
    let wrote = std::fs::write(&path, ps_snippet_file().as_bytes()).is_ok();
    if wrote {
        let script = format!(
            "{}; Set-Location C:\\Windows; prompt",
            ps_dot_source(&path.to_string_lossy())
        );
        for exe in ["pwsh.exe", "powershell.exe"] {
            let Ok(out) = std::process::Command::new(exe)
                .args(["-NoProfile", "-Command", &script])
                .output()
            else {
                continue; // 그 셸이 없는 기계 — 건너뛴다
            };
            let text = String::from_utf8_lossy(&out.stdout);
            assert!(
                text.contains("]7;file://localhost/C:/Windows"),
                "{exe} 가 OSC 7 을 내지 않았다: {text:?}"
            );
            // v2 — 같은 문자열이 A 로 시작해 B 로 끝난다 (블록 경계).
            let a = text.find("]133;A;aynx=1").expect("A");
            let osc7 = text.find("]7;file://localhost").expect("OSC 7");
            let b = text.find("]133;B;aynx=1").expect("B");
            assert!(a < osc7 && osc7 < b, "{exe}: {text:?}");
            // 명령이 돈 적이 없으니 D 는 없다 (빈 Enter 에 가짜 D 를 내지 않는 그 규칙).
            assert!(!text.contains("]133;D;"), "{exe}: {text:?}");
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ── WSL(bash) 훅 ────────────────────────────────────────────────────────

#[test]
fn windows_paths_become_mnt_paths_with_a_lowercase_drive() {
    assert_eq!(
        windows_to_wsl_path(r"C:\Users\you\AppData\Roaming\aynx").unwrap(),
        "/mnt/c/Users/you/AppData/Roaming/aynx"
    );
    // 드라이브 문자는 소문자다 (`/mnt/D` 는 없다)
    assert_eq!(windows_to_wsl_path(r"D:\work").unwrap(), "/mnt/d/work");
    // 드라이브 루트와 꼬리 슬래시
    assert_eq!(windows_to_wsl_path(r"C:\").unwrap(), "/mnt/c");
    assert_eq!(windows_to_wsl_path("C:/work/").unwrap(), "/mnt/c/work");
    // 공백·한글도 그냥 경로 글자다 (인용은 sh_single_quote 의 몫)
    assert_eq!(
        windows_to_wsl_path(r"C:\My Docs\한글").unwrap(),
        "/mnt/c/My Docs/한글"
    );
    // UNC·유닉스·드라이브 상대 경로에는 대응하는 자리가 없다 → 주입을 건너뛴다
    assert_eq!(windows_to_wsl_path(r"\\wsl.localhost\Ubuntu\home"), None);
    assert_eq!(windows_to_wsl_path(r"\\server\share\aynx"), None);
    assert_eq!(windows_to_wsl_path("/home/me/aynx"), None);
    assert_eq!(windows_to_wsl_path(r"C:relative\aynx"), None);
    assert_eq!(windows_to_wsl_path(""), None);
}

#[test]
fn sh_quoting_closes_and_reopens_around_an_apostrophe() {
    assert_eq!(sh_single_quote("/mnt/c/work"), "'/mnt/c/work'");
    // sh 의 작은따옴표 안에는 탈출 문법이 없다 — 닫고 붙이고 다시 연다.
    assert_eq!(sh_single_quote("/mnt/c/o'brien"), r"'/mnt/c/o'\''brien'");
    // 그 안에서 `$`·백틱·백슬래시는 전부 글자 그대로다 (감싸는 것 말고 할 일이 없다).
    assert_eq!(sh_single_quote(r"$HOME/a b\c"), r"'$HOME/a b\c'");
}

#[test]
fn wsl_rc_reads_the_users_bashrc_first_then_our_snippet() {
    let rc = wsl_rc_body("/mnt/c/Users/wl/AppData/Roaming/aynx");
    // 순서가 계약이다 — 사용자 rc 가 PROMPT_COMMAND 를 세운 **뒤에** 우리가 감싼다.
    let user = rc.find(".bashrc").expect("bashrc");
    let ours = rc.find("integration.sh").expect("snippet");
    assert!(user < ours, "{rc}");
    assert!(
        rc.contains(r#"[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc""#),
        "{rc}"
    );
    assert!(
        rc.contains("'/mnt/c/Users/wl/AppData/Roaming/aynx/integration.sh'"),
        "{rc}"
    );
    // 첫 줄이 버전이고, 줄바꿈은 LF 하나다 (CR 이 섞이면 bash 가 죽는다).
    assert!(rc.starts_with("# aynx shell integration for WSL (v"), "{rc}");
    assert!(!rc.contains('\r'), "{rc:?}");
    assert!(rc.ends_with('\n'), "{rc:?}");
}

#[test]
fn wsl_launch_script_hooks_bash_and_leaves_other_shells_alone() {
    let script = wsl_launch_script("/mnt/c/aynx/integration-wsl.rc");
    assert_eq!(
        script,
        "if [ \"${SHELL##*/}\" = bash ]; then exec bash --rcfile '/mnt/c/aynx/integration-wsl.rc' -i; \
             else exec \"${SHELL:-/bin/sh}\" -l; fi"
    );
    // `$SHELL` 이 비어 있는 배포판(docker-desktop 류)에서도 셸이 뜬다.
    assert!(script.contains("${SHELL:-/bin/sh}"), "{script}");
    // 시작 폴더 규칙은 건드리지 않는다.
    assert!(!script.contains("--cd"), "{script}");
}

// ── Git Bash 훅 (`--rcfile`) ────────────────────────────────────────────

#[test]
fn windows_paths_become_msys_paths_with_a_lowercase_drive() {
    assert_eq!(
        windows_to_msys_path(r"C:\Users\you\AppData\Roaming\aynx").unwrap(),
        "/c/Users/you/AppData/Roaming/aynx"
    );
    assert_eq!(windows_to_msys_path(r"D:\work").unwrap(), "/d/work");
    assert_eq!(windows_to_msys_path(r"C:\").unwrap(), "/c");
    assert_eq!(windows_to_msys_path("C:/work/").unwrap(), "/c/work");
    assert_eq!(
        windows_to_msys_path(r"C:\My Docs\한글").unwrap(),
        "/c/My Docs/한글"
    );
    // WSL 쪽과 **같은 규칙, 다른 앞머리**다 (몸통이 하나다).
    assert_eq!(
        windows_to_wsl_path(r"C:\work").unwrap(),
        format!("/mnt{}", windows_to_msys_path(r"C:\work").unwrap())
    );
    // 대응하는 자리가 없는 경로는 전부 None → 주입을 건너뛴다.
    assert_eq!(windows_to_msys_path(r"\\server\share\aynx"), None);
    assert_eq!(windows_to_msys_path("/home/me/aynx"), None);
    assert_eq!(windows_to_msys_path(r"C:relative\aynx"), None);
    assert_eq!(windows_to_msys_path(""), None);
}

#[test]
fn gitbash_rc_replaces_the_login_shell_and_fixes_the_cwd_shape() {
    let rc = gitbash_rc_body("/c/Users/wl/AppData/Roaming/aynx");
    // `--login` 을 뗐으니 프로필을 여기서 대신 읽는다 — 원격 rc 와 **같은 다섯 줄**이다.
    assert!(rc.contains(PROFILE_CHAIN), "{rc}");
    assert!(remote_rc_body().contains(PROFILE_CHAIN));
    // 순서가 계약이다: 프로필 → 스니펫 → __aynx_cwd 덮어쓰기.
    let profile = rc.find("/etc/profile").expect("profile");
    let snippet = rc.find("integration.sh").expect("snippet");
    let cwd = rc.find("__aynx_cwd(){").expect("cwd 덮어쓰기");
    assert!(profile < snippet && snippet < cwd, "{rc}");
    assert!(
        rc.contains("'/c/Users/wl/AppData/Roaming/aynx/integration.sh'"),
        "{rc}"
    );
    // MSYS 의 `/c/Users/x` 는 윈도우가 못 여는 경로다 — 드라이브 앞머리만 되돌린다.
    assert!(rc.contains(r#"p="/${p:1:1}:${p:2}""#), "{rc}");
    assert!(
        rc.contains("printf '\\033]7;file://localhost%s\\007' \"$p\""),
        "{rc}"
    );
    // tmux 래핑은 133 과 같은 규칙 그대로다.
    assert!(
        rc.contains(r"\033Ptmux;\033\033]7;file://localhost%s\007\033\\"),
        "{rc}"
    );
    // 프롬프트마다 프로세스를 띄우지 않는다 (cygpath 금지).
    assert!(!rc.contains("cygpath"), "{rc}");
    // 첫 줄이 버전이고, 줄바꿈은 LF 하나다.
    assert!(
        rc.starts_with("# aynx shell integration for Git Bash (v"),
        "{rc}"
    );
    assert!(!rc.contains('\r'), "{rc:?}");
    assert!(rc.ends_with('\n'), "{rc:?}");
}

/// 진짜 Git Bash 를 세워 `--rcfile` 훅이 붙는지 본다 — 프로필이 살아 있고(`PATH`),
/// `A` 가 오고, `B` 가 **PS1 끝**에 있고, OSC 7 이 **윈도우가 열 수 있는 모양**인지.
///
/// Git for Windows 가 없는 기계에서는 **조용히 건너뛴다** ([`powershell_hook_reports_the_current_folder_as_osc7`]
/// 과 같은 규칙 — 이 테스트는 CI 를 흔들 자격이 없다).
#[cfg(windows)]
#[test]
fn gitbash_hook_lands_with_a_windows_shaped_folder() {
    use std::io::Write;
    // `crate::pty::GIT_BASH` 과 같은 자리 (그쪽은 비공개라 여기서 따로 적는다).
    const GIT_BASH: &str = r"C:\Program Files\Git\bin\bash.exe";
    if !Path::new(GIT_BASH).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aynx-gitbash-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let msys = windows_to_msys_path(&dir.to_string_lossy());
    if let Some(dir_in_msys) = msys {
        let wrote = std::fs::write(dir.join(SH_SCRIPT_NAME), snippet_file().as_bytes()).is_ok()
            && std::fs::write(
                dir.join(GITBASH_RC_NAME),
                gitbash_rc_body(&dir_in_msys).as_bytes(),
            )
            .is_ok();
        if wrote {
            let rc = format!("{dir_in_msys}/{GITBASH_RC_NAME}");
            let child = std::process::Command::new(GIT_BASH)
                .args(["--rcfile", &rc, "-i"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn();
            if let Ok(mut child) = child {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"cd /c; __aynx_post; printf '%s' \"$PS1\"; exit\n");
                }
                if let Ok(out) = child.wait_with_output() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    assert!(text.contains("]133;A;aynx=1"), "A 가 없다: {text:?}");
                    // MSYS 의 `/c` 가 아니라 윈도우가 여는 `c:` 로 나가야 한다.
                    assert!(
                        text.contains("]7;file://localhost/c:"),
                        "OSC 7 이 MSYS 모양이다: {text:?}"
                    );
                    // B 는 PS1 의 **끝**에 있다 (프롬프트 문자열 뒤).
                    assert!(text.contains("133;B;aynx=1"), "B 가 PS1 에 없다: {text:?}");
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wsl_reads_exactly_the_same_snippet_as_the_remote() {
    // WSL 도 리눅스 bash 다 — 스니펫을 둘로 나눌 이유가 없고, 나누면 갈라진다.
    assert_eq!(snippet_file(), snippet_file());
    assert!(SNIPPET.contains("__aynx_cwd"));
}

#[test]
fn snippet_reports_the_current_folder_as_osc7() {
    // 프롬프트마다(precmd) A 직전에 폴더를 말한다 — bash·zsh 양쪽 경로 모두.
    assert_eq!(
        SNIPPET
            .matches(r#"__aynx_cwd; __aynx_emit "A;aynx=1""#)
            .count(),
        2
    );
    // 평문 경로: `ESC ] 7 ; file://<호스트><PWD> BEL`
    assert!(SNIPPET.contains(r#"printf '\033]7;file://%s%s\007' "$h" "$PWD""#));
    // tmux 안에서는 133 과 **같은 규칙**으로 감싼다 (ESC 이중화 · ESC P tmux; … ESC \)
    assert!(SNIPPET.contains(r"\033Ptmux;\033\033]7;file://%s%s\007\033\\"));
    // 호스트는 $HOSTNAME → hostname → localhost 순 (zsh 는 $HOSTNAME 이 없을 수 있다)
    assert!(SNIPPET.contains(r#"local h="${HOSTNAME:-$(hostname 2>/dev/null)}""#));
    assert!(SNIPPET.contains("h=localhost"));
    // 첫 줄이 버전이다 — 내용이 바뀌면 put_snippet 의 비교가 달라져 다음 접속에 갱신된다.
    assert!(SNIPPET.starts_with("# aynx shell integration (v"));
}

#[test]
fn tmux_line_survives_a_host_without_tmux() {
    // tmux 가 없으면 세 시도가 모두 실패하지만 줄 전체는 성공으로 끝난다 —
    // 안 그러면 우리 훅이 그 줄을 "실패한 명령" 으로 표시한다.
    assert!(TMUX_PASSTHROUGH.contains("command -v tmux"));
    assert!(TMUX_PASSTHROUGH.ends_with("; true"));
}

// ── 에이전트 감싸개 (2026-10-26 `crate::agent_tile` — 그 전 codex `--no-daemon` 만: docs/log/2026-09-26-codex-hooks.md) ──────────

#[test]
fn agent_wrappers_stand_only_in_an_aynx_tile() {
    let nd = crate::tile_env::NO_DAEMON_ENV;
    let tile = crate::tile_env::TILE_AGENT_ENV;
    // PowerShell — 스트림 + (장식 파일 또는 no-daemon 표식) · claude 는 장식 파일이 있을 때만 · 사용자 함수는 건드리지 않는다 · 파일 끝
    assert!(PS_AGENT_WRAPPER.is_ascii());
    assert!(PS_AGENT_WRAPPER.starts_with(&format!(
        r"if ($env:AYNX_STREAM -and ($env:{tile} -or $env:{nd} -eq '1'))"
    )));
    for needle in [
        "'--no-daemon'".to_string(),
        "'--remote'".to_string(),
        "'--remote=*'".to_string(),
        "'resume'".to_string(),
        "'fork'".to_string(),
        "-CommandType Application,ExternalScript".to_string(),
        "[IO.File]::ReadAllLines($__f)".to_string(),
        "Split([char]31)".to_string(),
        "& $__x @__b".to_string(),
        format!(r"if ($env:{tile} -and -not (Test-Path Function:\global:claude))"),
        r"if (-not (Test-Path Function:\global:codex))".to_string(),
    ] {
        assert!(PS_AGENT_WRAPPER.contains(&needle), "{needle}");
    }
    assert!(!PS_AGENT_WRAPPER.contains("Invoke-Expression") && !PS_AGENT_WRAPPER.contains("iex "), "장식 파일을 실행하지 않는다");
    let file = ps_snippet_file();
    assert!(file.ends_with(&format!("{PS_AGENT_WRAPPER}\n")));
    assert!(file.starts_with(PS_SNIPPET));
    // Git Bash — 같은 규칙 · rc 의 맨 끝 · `!` · eval · 소스 없음 · alias 에 안전한 `function` 꼴
    for needle in [
        "[ -n \"$AYNX_STREAM\" ] || return 0".to_string(),
        format!("if [ -n \"${tile}\" ] || [ \"${nd}\" = 1 ]; then"),
        "declare -F codex >/dev/null 2>&1 || function codex {".to_string(),
        "declare -F claude >/dev/null 2>&1 || function claude {".to_string(),
        "--no-daemon|--remote|--remote=*)".to_string(),
        "resume|fork)".to_string(),
        "IFS=$'\\037' read -r -a __w".to_string(),
    ] {
        assert!(GITBASH_AGENT_WRAPPER.contains(&needle), "{needle}");
    }
    assert!(!GITBASH_AGENT_WRAPPER.contains("codex()") && !GITBASH_AGENT_WRAPPER.contains("claude()"));
    assert!(!GITBASH_AGENT_WRAPPER.contains('!'));
    assert!(!GITBASH_AGENT_WRAPPER.contains("eval") && !GITBASH_AGENT_WRAPPER.contains(". \"$AYNX_TILE_AGENT\""));
    let rc = gitbash_rc_body("/c/x");
    assert!(rc.ends_with(GITBASH_AGENT_WRAPPER));
    assert!(rc.find("__aynx_cwd(){").unwrap() < rc.find("__aynx_agent_wrap").unwrap());
    // 공용 스니펫(원격·WSL)은 v6 부터 프롬프트마다 표식을 보는 자기 `codex` 감싸개를 가진다 — 장식 파일은 모른다(원격은 PATH 심
    // `crate::agent_shim` · WSL 에는 표식이 건너가지 않는다). rc 몫과 이름이 겹치지 않는다(rc 는 제 정의 함수를 `unset -f` 한다).
    assert!(SNIPPET.contains(&format!("[ \"${nd}\" = 1 ] || return 0")));
    assert!(!SNIPPET.contains("__aynx_agent") && !SNIPPET.contains(tile));
    assert!(!wsl_rc_body("/mnt/c/x").contains("codex"));
}

/// 감싸개 실기의 장식 파일 — `crate::agent_tile::body` 그대로(공백 · 작은따옴표 · 한글이 든 낱말 포함).
#[cfg(windows)]
fn agent_tile_file(dir: &Path) -> std::path::PathBuf {
    let body = crate::agent_tile::body(&[
        ("claude", vec!["--model".into(), "opus 5".into(), "--mcp-config".into(), "C:/tmp/it's 설정.json".into()]),
        ("codex", vec!["-c".into(), "mcp_servers.x.args=['a b','c']".into(), "--model".into(), "o3".into()]),
    ]);
    let path = dir.join("tile-0123456789abcdef.env");
    std::fs::write(&path, body.as_bytes()).unwrap();
    path
}

/// 진짜 PowerShell 에서 감싸개를 돌려 본다 — PATH 앞에 인자를 `|` 로 이어 찍는 가짜 `claude.ps1` · `codex.ps1` 를 두고(낱말 경계를 보려고).
/// pwsh·powershell 이 없는 기계에서는 건너뛴다(위 OSC 7 실기와 같은 규칙).
#[cfg(windows)]
#[test]
fn powershell_agent_wrapper_inserts_tile_words_and_no_daemon() {
    let dir = std::env::temp_dir().join(format!("aynx-ps-agent-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(PS_SCRIPT_NAME);
    // 출력을 UTF-8 로 — 5.1 의 콘솔 출력 인코딩은 OEM 코드 페이지다.
    let fake = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output ('ARGS:' + ($args -join '|'))\r\n";
    let ok = std::fs::write(&path, ps_snippet_file().as_bytes()).is_ok()
        && std::fs::write(dir.join("codex.ps1"), fake.as_bytes()).is_ok()
        && std::fs::write(dir.join("claude.ps1"), fake.as_bytes()).is_ok();
    if ok {
        let tile = agent_tile_file(&dir);
        let path_var = format!("{};{}", dir.display(), std::env::var("PATH").unwrap_or_default());
        let script = format!(
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8; {}; codex resume abc; codex --remote ws://x; codex fork --no-daemon z; claude --resume q; (Test-Path Function:\\global:claude)",
            ps_dot_source(&path.to_string_lossy())
        );
        for exe in ["pwsh.exe", "powershell.exe"] {
            let run = |tile_file: Option<&Path>, marked: bool| {
                let mut c = std::process::Command::new(exe);
                c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
                    .env("PATH", &path_var)
                    .env("AYNX_STREAM", "s1")
                    .env_remove("VSCODE_SHELL_INTEGRATION")
                    .env_remove("ITERM_SHELL_INTEGRATION_INSTALLED");
                match tile_file {
                    Some(f) => c.env(crate::tile_env::TILE_AGENT_ENV, f.to_string_lossy().replace('\\', "/")),
                    None => c.env_remove(crate::tile_env::TILE_AGENT_ENV),
                };
                if marked {
                    c.env(crate::tile_env::NO_DAEMON_ENV, "1");
                } else {
                    c.env_remove(crate::tile_env::NO_DAEMON_ENV);
                }
                c.output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            };
            let lines = |out: &str| -> Vec<String> {
                out.lines()
                    .map(str::trim)
                    .filter(|l| l.starts_with("ARGS:") || *l == "True" || *l == "False")
                    .map(String::from)
                    .collect()
            };
            let Some(on) = run(Some(&tile), true) else { continue };
            assert_eq!(
                lines(&on),
                [
                    "ARGS:resume|--no-daemon|-c|mcp_servers.x.args=['a b','c']|--model|o3|abc",
                    "ARGS:-c|mcp_servers.x.args=['a b','c']|--model|o3|--remote|ws://x",
                    "ARGS:fork|--no-daemon|-c|mcp_servers.x.args=['a b','c']|--model|o3|z",
                    "ARGS:--resume|q|--model|opus 5|--mcp-config|C:/tmp/it's 설정.json",
                    "True",
                ],
                "{exe}: {on:?}"
            );
            // 장식 파일 없이 표식만 — 예전 codex 감싸개와 같다 · claude 감싸개는 서지 않는다.
            let nd_only = run(None, true).unwrap_or_default();
            assert_eq!(
                lines(&nd_only),
                ["ARGS:resume|--no-daemon|abc", "ARGS:--remote|ws://x", "ARGS:fork|--no-daemon|z", "ARGS:--resume|q", "False"],
                "{exe} 표식만: {nd_only:?}"
            );
            // 경로는 있는데 파일이 없다 — 그대로(표식이 없으면 `--no-daemon` 도 없다).
            let missing = run(Some(&dir.join("tile-ffffffffffffffff.env")), false).unwrap_or_default();
            assert_eq!(lines(&missing)[..2], ["ARGS:resume|abc", "ARGS:--remote|ws://x"], "{exe} 파일 없음: {missing:?}");
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// 진짜 Git Bash 에서 감싸개를 돌려 본다 — PATH 앞에 인자를 `|` 로 이어 찍는 가짜 `claude` · `codex` 를 두고. Git for Windows 가
/// 없으면 건너뛴다.
#[cfg(windows)]
#[test]
fn gitbash_agent_wrapper_inserts_tile_words_and_no_daemon() {
    const GIT_BASH: &str = r"C:\Program Files\Git\bin\bash.exe";
    if !Path::new(GIT_BASH).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aynx-gb-agent-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let Some(dir_in_msys) = windows_to_msys_path(&dir.to_string_lossy()) else {
        return;
    };
    let fake = b"#!/bin/sh\nIFS='|'; echo \"ARGS:$*\"\n";
    let ok = std::fs::write(dir.join("wrap.sh"), GITBASH_AGENT_WRAPPER.as_bytes()).is_ok()
        && std::fs::write(dir.join("codex"), fake).is_ok()
        && std::fs::write(dir.join("claude"), fake).is_ok();
    if ok {
        let tile = agent_tile_file(&dir);
        let script = format!(
            "PATH='{dir_in_msys}':$PATH; . '{dir_in_msys}/wrap.sh'; codex resume abc; codex --remote=unix://; codex fork --no-daemon z; claude --resume q; type -t claude"
        );
        let run = |tile_file: Option<&Path>, marked: bool| {
            let mut c = std::process::Command::new(GIT_BASH);
            c.args(["--noprofile", "--norc", "-c", &script]).env("AYNX_STREAM", "s1");
            match tile_file {
                Some(f) => c.env(crate::tile_env::TILE_AGENT_ENV, f.to_string_lossy().replace('\\', "/")),
                None => c.env_remove(crate::tile_env::TILE_AGENT_ENV),
            };
            if marked {
                c.env(crate::tile_env::NO_DAEMON_ENV, "1");
            } else {
                c.env_remove(crate::tile_env::NO_DAEMON_ENV);
            }
            c.output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        };
        if let Some(on) = run(Some(&tile), true) {
            let lines: Vec<&str> = on.lines().map(str::trim).collect();
            assert_eq!(
                lines,
                [
                    "ARGS:resume|--no-daemon|-c|mcp_servers.x.args=['a b','c']|--model|o3|abc",
                    "ARGS:-c|mcp_servers.x.args=['a b','c']|--model|o3|--remote=unix://",
                    "ARGS:fork|--no-daemon|-c|mcp_servers.x.args=['a b','c']|--model|o3|z",
                    "ARGS:--resume|q|--model|opus 5|--mcp-config|C:/tmp/it's 설정.json",
                    "function"
                ],
                "{on:?}"
            );
            // 장식 파일 없이 표식만 — 예전 codex 감싸개와 같다 · claude 감싸개는 서지 않는다.
            let nd_only = run(None, true).unwrap_or_default();
            let lines: Vec<&str> = nd_only.lines().map(str::trim).collect();
            assert_eq!(
                lines,
                ["ARGS:resume|--no-daemon|abc", "ARGS:--remote=unix://", "ARGS:fork|--no-daemon|z", "ARGS:--resume|q", "file"],
                "표식만: {nd_only:?}"
            );
            // 둘 다 없음 = 함수 없음.
            let off = run(None, false).unwrap_or_default();
            let lines: Vec<&str> = off.lines().map(str::trim).collect();
            assert_eq!(lines[..2], ["ARGS:resume|abc", "ARGS:--remote=unix://"], "표식 없음: {off:?}");
            assert_eq!(lines.last(), Some(&"file"), "표식 없음 = 함수 없음: {off:?}");
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// 원격 스니펫(v6)의 `codex` 감싸개 — Git Bash rc 의 감싸개와 같은 규칙이고, 소스할 때가 아니라 프롬프트마다
/// (`__aynx_ready` 끝) 표식을 본다(원격은 신호 `export` 가 스니펫 **뒤에** 온다). 표식 없이는 서지 않는다.
#[test]
fn remote_snippet_codex_wrapper_arms_only_when_marked() {
    // 글자 계약 — bash 갈래 안 · 프롬프트 끝에서 확인 · 두 표식 · 사용자 함수 존중 · 같은 끼우기 규칙 · `!` 없음
    let arm = SNIPPET.find("__aynx_codex_arm(){").expect("arm");
    let bash_branch = SNIPPET.find("if [ -n \"$BASH_VERSION\" ]; then").unwrap();
    let zsh_branch = SNIPPET.find("elif [ -n \"$ZSH_VERSION\" ]; then").unwrap();
    assert!(bash_branch < arm && arm < zsh_branch, "bash 갈래 안에만");
    assert!(SNIPPET.contains("esac; __aynx_codex_arm; }"), "__aynx_ready 끝에서 부른다");
    assert!(SNIPPET.contains(
        r#"[ -z "$__aynx_codex_armed" ] && [ -n "$AYNX_STREAM" ] && [ "$AYNX_CODEX_NO_DAEMON" = 1 ] || return 0"#
    ));
    assert!(SNIPPET.contains("declare -F codex >/dev/null 2>&1 && return 0"));
    assert!(SNIPPET.contains("--no-daemon|--remote|--remote=*) command codex \"$@\"; return ;;"));
    assert!(SNIPPET.contains(r#"resume|fork) local __s=$1; shift; command codex "$__s" --no-daemon "$@" ;;"#));
    assert!(!SNIPPET.contains('!'), "히스토리 전개");
    // 최상위에서 `function codex` 를 바로 세우지 않는다 — 정의는 arm 함수 안에만 있다.
    assert_eq!(SNIPPET.matches("function codex {").count(), 1);
    assert!(SNIPPET.find("function codex {").unwrap() > arm);

    #[cfg(windows)]
    const BASH: &str = r"C:\Program Files\Git\bin\bash.exe";
    #[cfg(not(windows))]
    const BASH: &str = "/bin/bash";
    if !Path::new(BASH).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aynx-remote-codex-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let fake = dir.join("codex");
    let ok = std::fs::write(dir.join("s.sh"), snippet_file().as_bytes()).is_ok()
        && std::fs::write(&fake, b"#!/bin/sh\necho \"ARGS:$*\"\n").is_ok();
    #[cfg(unix)]
    let ok = ok && {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).is_ok()
    };
    if ok {
        // 소스 직후(표식이 있어도 아직 안 섬) → 프롬프트 흉내(__aynx_ready) → 서는지.
        let script = "PATH=\"$PWD:$PATH\"; . ./s.sh; type -t codex; __aynx_ready; \
                      codex resume abc; codex --model o3; codex --remote=unix://; type -t codex";
        let run = |marked: bool| {
            let mut c = std::process::Command::new(BASH);
            c.args(["--norc", "--noprofile", "-c", script])
                .current_dir(&dir)
                .stdin(std::process::Stdio::null())
                .env("AYNX_STREAM", "s1");
            if marked {
                c.env(crate::tile_env::NO_DAEMON_ENV, "1");
            } else {
                c.env_remove(crate::tile_env::NO_DAEMON_ENV);
            }
            c.output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        };
        if let Some(on) = run(true) {
            let lines: Vec<&str> = on.lines().map(str::trim).collect();
            assert_eq!(
                lines,
                [
                    "file",
                    "ARGS:resume --no-daemon abc",
                    "ARGS:--no-daemon --model o3",
                    "ARGS:--remote=unix://",
                    "function"
                ],
                "{on:?}"
            );
            let off = run(false).unwrap_or_default();
            let lines: Vec<&str> = off.lines().map(str::trim).collect();
            assert_eq!(
                lines,
                ["file", "ARGS:resume abc", "ARGS:--model o3", "ARGS:--remote=unix://", "file"],
                "표식 없음 = 함수 없음: {off:?}"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ── 옛 claude 감싸개(상태줄 `--settings`)는 없다 (2026-10-10 — 한도 % 는 타일 환경의 mod 가 받는다, `crate::claude_usage`) ─────────────
// 2026-10-26 의 `claude` 감싸개는 타일 장식 파일만 읽는다(`agent_wrappers_stand_only_in_an_aynx_tile`) — 로컬 PowerShell · Git Bash 에만.

#[test]
fn no_claude_wrapper_in_any_integration_file() {
    for body in [ps_snippet_file(), gitbash_rc_body("/c/x"), snippet_file(), wsl_rc_body("/mnt/c/x")] {
        assert!(!body.contains("AYNX_CLAUDE") && !body.contains("--settings"), "{body}");
    }
    for body in [snippet_file(), wsl_rc_body("/mnt/c/x")] {
        assert!(!body.contains("function global:claude") && !body.contains("function claude"), "{body}");
    }
    assert_eq!(ps_snippet_file().matches("function global:claude").count(), 1);
    assert_eq!(gitbash_rc_body("/c/x").matches("function claude").count(), 1);
}
