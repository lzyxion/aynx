use std::path::{Path, PathBuf};

use super::*;
use crate::remote_signal_file::AgentKeys;

#[test]
fn shim_body_names_its_agent_and_carries_the_version_on_line_two() {
    for agent in AGENTS {
        let body = shim_body(agent);
        let mut lines = body.lines();
        assert_eq!(lines.next(), Some("#!/bin/sh"));
        assert_eq!(lines.next(), Some(version_line().as_str()), "둘째 줄이 판 표식이다");
        assert!(body.contains(&format!("\nname={agent}\n")), "{agent}");
        assert!(!body.contains("__AYNX_AGENT__"));
        // 소스 · eval 없이 키만 읽는다.
        assert!(!body.contains("eval"));
        assert!(
            !body.lines().any(|l| l.trim_start().starts_with(". ") || l.trim_start().starts_with("source ")),
            "타일 파일을 소스하지 않는다"
        );
        assert!(body.contains("set -f"), "글롭이 낱말을 펴지 않게");
    }
    assert_eq!(version_line(), format!("# aynx-shim-version: {SHIM_VERSION}"));
    assert!(SHIM_TEMPLATE.contains(&format!("\n{}\n", version_line())), "상수와 본문의 판이 같다");
}

#[test]
fn install_command_skips_current_shims_and_writes_atomically() {
    let cmd = install_command();
    assert!(cmd.starts_with(r#"mkdir -p "$HOME"/'.config/aynx/bin' && "#), "{cmd}");
    for agent in AGENTS {
        assert!(cmd.contains(&format!(r#"f="$HOME"/'.config/aynx/bin/{agent}'"#)), "{agent}");
        assert!(cmd.contains(&crate::ssh::sh_quote(&shim_body(agent))), "{agent}");
    }
    assert_eq!(cmd.matches("sed -n 2p").count(), AGENTS.len() + 1, "심 둘 + 에이전트 rc");
    assert!(cmd.contains(&crate::ssh::sh_quote(&version_line())));
    assert!(cmd.contains(r#"chmod 755 "$f.aynx-tmp" && mv -f "$f.aynx-tmp" "$f""#));
    assert!(cmd.len() < 64 * 1024, "한 exec 인자에 넉넉히 든다");
    assert_eq!(remove_command("codex"), r#"rm -f "$HOME"/'.config/aynx/bin/codex'"#);
    assert_eq!(PATH_EXPORT, r#"PATH="$HOME/.config/aynx/bin:$PATH""#);
}

// ── 실제 sh 로 심을 돌린다 (Git Bash · dash · bash — 없으면 건너뛴다) ─────

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-shim-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Windows 경로를 sh 가 읽는 모양으로(`C:\a` → `/c/a`).
fn posix(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    match s.as_bytes() {
        [d, b':', b'/', ..] if cfg!(windows) => {
            format!("/{}{}", (*d as char).to_ascii_lowercase(), &s[2..])
        }
        _ => s,
    }
}

struct Run {
    /// 진짜 실행 파일이 받은 인자 — 돌지 않았으면 `None`.
    args: Option<Vec<String>>,
    code: Option<i32>,
}

/// `agent` 의 심을 깐 홈에서 `<agent> <args>` 를 PATH 로 부른다. `tile` 이 있으면 스트림 `s-1` 의 타일 파일,
/// `stream` 은 `AYNX_STREAM`. `with_real` 이 거짓이면 진짜 실행 파일이 PATH 에 없다. sh 가 없으면 `None`.
fn run_shim(
    tag: &str,
    agent: &str,
    args: &[&str],
    tile: Option<&str>,
    stream: Option<&str>,
    with_real: bool,
) -> Option<Run> {
    use std::process::Command;
    if Command::new("sh").arg("-c").arg("exit 0").output().is_err() {
        eprintln!("sh 가 없어 건너뜀");
        return None;
    }
    let dir = temp_dir(tag);
    let home = dir.join("home");
    let bin = home.join(".config/aynx/bin");
    let real = dir.join("real");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::create_dir_all(home.join(".config/aynx/signal")).unwrap();
    std::fs::create_dir_all(&real).unwrap();
    std::fs::write(bin.join(agent), shim_body(agent)).unwrap();
    std::fs::write(
        real.join(agent),
        "#!/bin/sh\nprintf 'REAL\\n'\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n",
    )
    .unwrap();
    if let Some(body) = tile {
        std::fs::write(home.join(".config/aynx/signal/s-1.env"), body).unwrap();
    }
    let q = |p: &Path| crate::ssh::sh_quote(&posix(p));
    let path = if with_real {
        format!("{}:{}:$PATH", q(&bin), q(&real))
    } else {
        q(&bin)
    };
    let stream = match stream {
        Some(s) => format!("AYNX_STREAM={}; export AYNX_STREAM; ", crate::ssh::sh_quote(s)),
        None => String::new(),
    };
    let quoted: Vec<String> = args.iter().map(|a| crate::ssh::sh_quote(a)).collect();
    let cmd = format!(
        "chmod +x {bin}/{agent} {real}/{agent}; unset AYNX_STREAM; HOME={home}; export HOME; \
         PATH={path}; export PATH; {stream}{agent} {args}",
        bin = q(&bin),
        real = q(&real),
        home = q(&home),
        args = quoted.join(" "),
    );
    let o = Command::new("sh").arg("-c").arg(&cmd).output().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    let out = String::from_utf8_lossy(&o.stdout).replace("\r\n", "\n");
    let mut lines = out.lines();
    let args = (lines.next() == Some("REAL")).then(|| lines.map(str::to_string).collect());
    Some(Run {
        args,
        code: o.status.code(),
    })
}

fn tile(claude: &[&str], codex: &[&str], no_daemon: bool) -> String {
    let words = |w: &[&str]| w.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    crate::remote_signal_file::body(
        None,
        Some(&AgentKeys {
            args: vec![("claude", words(claude)), ("codex", words(codex))],
            no_daemon,
        }),
        1,
    )
    .unwrap()
}

/// 앱이 띄우는 줄과 **같은 자리** — `agent_args` 의 자리 규칙 + `codex_launch` 의 `--no-daemon` 규칙으로 지은 줄을 정답으로 견준다.
#[test]
fn real_sh_places_args_like_the_app_launch() {
    let extras = ["--model", "o3"];
    let file = tile(&["--model", "opus"], &extras, true);
    let expect = |agent: &str, args: &[&str], extra: &[&str], nd: bool| -> Vec<String> {
        let line = format!("{agent} {}", args.join(" "));
        let toks: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
        let placed = crate::agent_args::with_tokens(&line, Some("bash"), &toks);
        let full = crate::codex_launch::codex_line(&placed, nd).unwrap_or(placed);
        full.split_whitespace().skip(1).map(str::to_string).collect()
    };
    let codex_cases: &[&[&str]] = &[
        &[],
        &["resume", "abc"],
        &["fork"],
        &["--no-daemon", "foo"],
        &["--remote", "x"],
        &["exec", "hi"],
        &["--no-daemon", "resume", "id"],
        &["resume", "--no-daemon", "id"],
    ];
    for (i, args) in codex_cases.iter().enumerate() {
        let Some(run) = run_shim(&format!("codex{i}"), "codex", args, Some(&file), Some("s-1"), true)
        else {
            return;
        };
        assert_eq!(run.args, Some(expect("codex", args, &extras, true)), "codex {args:?}");
    }
    for (i, args) in [&[][..], &["--resume", "abc"], &["-p", "hi"]].iter().enumerate() {
        let run = run_shim(&format!("claude{i}"), "claude", args, Some(&file), Some("s-1"), true).unwrap();
        assert_eq!(run.args, Some(expect("claude", args, &["--model", "opus"], false)), "claude {args:?}");
    }
    // `--no-daemon` 이 꺼져 있으면 끼우지 않는다 · 추가 인자에 `--remote` 가 있어도.
    let off = tile(&[], &extras, false);
    let run = run_shim("codex-off", "codex", &["resume", "abc"], Some(&off), Some("s-1"), true).unwrap();
    assert_eq!(run.args, Some(expect("codex", &["resume", "abc"], &extras, false)));
    let remote = tile(&[], &["--remote=ws://x"], true);
    let run = run_shim("codex-remote", "codex", &[], Some(&remote), Some("s-1"), true).unwrap();
    assert_eq!(run.args, Some(vec!["--remote=ws://x".to_string()]));
}

/// 공백을 품은 낱말은 한 인자로 · 글롭 글자는 펴지지 않는다 · 사용자 인자는 그대로.
#[test]
fn real_sh_keeps_words_whole() {
    let file = tile(&["--append-system-prompt", "be brief *", "-x"], &[], false);
    let Some(run) = run_shim("words", "claude", &["say  two", "*"], Some(&file), Some("s-1"), true) else {
        return;
    };
    let want = ["say  two", "*", "--append-system-prompt", "be brief *", "-x"];
    assert_eq!(run.args, Some(want.iter().map(|s| s.to_string()).collect()));
}

/// 앱 밖(스트림 없음) · 타일 파일 없음 · 모양이 틀린 스트림은 인자 그대로. 진짜 실행 파일이 없으면 127.
#[test]
fn real_sh_passes_through_outside_a_tile_and_fails_like_a_missing_command() {
    let file = tile(&["--model", "opus"], &["--model", "o3"], true);
    let same = |v: &[&str]| Some(v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    let Some(run) = run_shim("nostream", "codex", &["resume", "abc"], Some(&file), None, true) else {
        return;
    };
    assert_eq!(run.args, same(&["resume", "abc"]));
    let run = run_shim("nofile", "codex", &["resume", "abc"], None, Some("s-1"), true).unwrap();
    assert_eq!(run.args, same(&["resume", "abc"]));
    let run = run_shim("badstream", "claude", &["-p"], Some(&file), Some("../s-1"), true).unwrap();
    assert_eq!(run.args, same(&["-p"]));
    let run = run_shim("missing", "codex", &[], Some(&file), Some("s-1"), false).unwrap();
    assert_eq!(run.args, None);
    assert_eq!(run.code, Some(127));
}

// ── 사용자 rc 뒤에 심 폴더를 다시 앞으로 (2026-10-26 실기 버그) ─────

#[test]
fn rc_shim_front_is_marked_first_and_restored_after_the_profiles() {
    for rc in [agent_rc_body(), crate::shell_integration::remote_rc_body()] {
        let mark = rc.find(RC_SHIM_MARK).expect("머리");
        let chain = rc.find(crate::shell_integration::PROFILE_CHAIN).expect("프로필");
        let front = rc.find(RC_SHIM_FRONT).expect("꼬리");
        assert!(mark < chain && chain < front, "{rc}");
        assert!(!rc.contains('\r') && !rc.contains("eval") && !rc.contains('!'), "{rc}");
        assert!(rc.ends_with('\n'));
    }
    let body = agent_rc_body();
    assert_eq!(body.lines().nth(1), Some(agent_rc_version_line().as_str()), "둘째 줄이 판 표식이다");
    let cmd = install_command();
    assert!(cmd.contains(r#"f="$HOME"/'.config/aynx/agent-rc'"#), "{cmd}");
    assert!(cmd.contains(&crate::ssh::sh_quote(&body)));
    assert!(cmd.contains(&crate::ssh::sh_quote(&agent_rc_version_line())));
    assert_eq!(AGENT_RC_PATH, "$HOME/.config/aynx/agent-rc");
}

/// 앱이 심 폴더를 앞에 export 한 뒤 rc 가 돌고, 사용자 프로필이 진짜 `claude` 가 사는 폴더를 앞에 얹는다 —
/// 그래도 rc 를 다 읽은 뒤 `command -v claude` 는 심이다. export 하지 않았으면(토글 끔 — 심 파일은 남아 있다) 손대지 않는다.
/// 셸 통합 rc 의 tmux 줄은 시험 기계의 tmux 를 건드리지 않게 뺀다. sh 가 없으면 건너뛴다.
#[test]
fn real_sh_rc_puts_the_shim_back_in_front_after_the_user_profile() {
    use std::process::Command;
    if Command::new("sh").arg("-c").arg("exit 0").output().is_err() {
        eprintln!("sh 가 없어 건너뜀");
        return;
    }
    let integration: String = crate::shell_integration::remote_rc_body()
        .lines()
        .filter(|l| !l.starts_with("command -v tmux"))
        .map(|l| format!("{l}\n"))
        .collect();
    for (tag, rc) in [("agent-rc", agent_rc_body()), ("integration-rc", integration)] {
        for exported in [true, false] {
            let dir = temp_dir(&format!("{tag}-{exported}"));
            let home = dir.join("home");
            let bin = home.join(".config/aynx/bin");
            let local = home.join(".local/bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::create_dir_all(&local).unwrap();
            std::fs::write(bin.join("claude"), shim_body("claude")).unwrap();
            std::fs::write(local.join("claude"), "#!/bin/sh\nexit 0\n").unwrap();
            // Claude Code 설치기가 넣는 바로 그 줄(프로필이 bashrc 를 읽는 흔한 모양까지).
            std::fs::write(home.join(".bash_profile"), ". \"$HOME/.bashrc\"\n").unwrap();
            // 뒤에 심 폴더를 한 번 더 붙이는 줄 — 걷어 내고 앞에 **한 번만** 서야 한다.
            std::fs::write(
                home.join(".bashrc"),
                "export PATH=\"$HOME/.local/bin:$PATH\"\nPATH=\"$PATH:$HOME/.config/aynx/bin\"\n",
            )
            .unwrap();
            let rc_file = dir.join("rc");
            std::fs::write(&rc_file, &rc).unwrap();
            let q = |p: &Path| crate::ssh::sh_quote(&posix(p));
            let front = if exported { r#"PATH="$HOME/.config/aynx/bin:$PATH"; "# } else { "" };
            let cmd = format!(
                "chmod +x {bin}/claude {local}/claude; unset TMUX; HOME={home}; export HOME; {front}export PATH; \
                 . {rc} >/dev/null 2>&1; printf 'AT %s\n' \"$(command -v claude)\"; \
                 case \":$PATH:\" in *\":$HOME/.config/aynx/bin:\"*\":$HOME/.config/aynx/bin:\"*) echo TWICE ;; esac",
                bin = q(&bin),
                local = q(&local),
                home = q(&home),
                rc = q(&rc_file),
            );
            let o = Command::new("sh").arg("-c").arg(&cmd).output().unwrap();
            let _ = std::fs::remove_dir_all(&dir);
            let out = String::from_utf8_lossy(&o.stdout).replace("\r\n", "\n");
            let at = out
                .lines()
                .filter_map(|l| l.strip_prefix("AT "))
                .next_back()
                .unwrap_or_else(|| panic!("{tag}: {out}"))
                .to_string();
            let want = if exported { "/.config/aynx/bin/claude" } else { "/.local/bin/claude" };
            assert!(at.ends_with(want), "{tag} exported={exported}: {at}");
            assert!(!out.contains("TWICE"), "{tag}: 심 폴더는 한 번만 — {out}");
        }
    }
}
