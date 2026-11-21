//! aynx 이 띄우는 Codex 에 `--no-daemon` 을 끼우는 규칙의 한 곳 (docs/log/2026-09-26-codex-hooks.md "다시 켬 — --no-daemon").
//! 공용 `codex app-server` 데몬에 붙으면 훅이 데몬을 처음 띄운 터미널의 환경으로 돌아 `AYNX_STREAM` 신호가 엉뚱한 타일로 간다.
//! 셸에 손으로 친 `codex` 는 같은 규칙을 셸 글자로 옮긴 감싸개(`crate::shell_integration` — PowerShell · Git Bash)가 맡는다.

pub(crate) const NO_DAEMON_FLAG: &str = "--no-daemon";

fn is_codex(first: &str) -> bool {
    matches!(
        first.to_ascii_lowercase().as_str(),
        "codex" | "codex.exe" | "codex.cmd"
    )
}

fn chose_server(tokens: &[&str]) -> bool {
    tokens
        .iter()
        .any(|t| *t == NO_DAEMON_FLAG || *t == "--remote" || t.starts_with("--remote="))
}

/// `--no-daemon` 을 몇 번째 낱말 앞에 끼울지 — `resume` · `fork` 는 그 하위명령 뒤 자리다.
fn insert_at(tokens: &[&str], enabled: bool) -> Option<usize> {
    let first = tokens.first()?;
    if !enabled || !is_codex(first) || chose_server(tokens) {
        return None;
    }
    match tokens.get(1) {
        Some(&"resume") | Some(&"fork") => Some(2),
        _ => Some(1),
    }
}

#[cfg(test)]
pub(crate) fn codex_argv(argv: &[String], enabled: bool) -> Vec<String> {
    let tokens: Vec<&str> = argv.iter().map(String::as_str).collect();
    let mut out = argv.to_vec();
    if let Some(i) = insert_at(&tokens, enabled) {
        out.insert(i, NO_DAEMON_FLAG.to_owned());
    }
    out
}

/// 줄을 낱말로 다시 짓지 않고 그 자리에 글자만 끼운다 — 사용자 명령의 따옴표·공백을 지키려고.
/// 낱말 경계는 공백뿐이라 따옴표 안의 `--remote` 도 "정했다" 로 읽힌다(덜 끼우는 쪽으로 틀린다).
pub(crate) fn codex_line(command: &str, enabled: bool) -> Option<String> {
    // (시작 바이트, 낱말)
    let mut spans: Vec<(usize, &str)> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in command.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                spans.push((s, &command[s..i]));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        spans.push((s, &command[s..]));
    }
    let tokens: Vec<&str> = spans.iter().map(|(_, t)| *t).collect();
    let at = insert_at(&tokens, enabled)?;
    let (pos, sep_after) = match spans.get(at) {
        Some((s, _)) => (*s, true),
        None => (command.trim_end().len(), false),
    };
    let mut out = String::with_capacity(command.len() + NO_DAEMON_FLAG.len() + 1);
    out.push_str(&command[..pos]);
    if sep_after {
        out.push_str(NO_DAEMON_FLAG);
        out.push(' ');
    } else {
        out.push(' ');
        out.push_str(NO_DAEMON_FLAG);
    }
    out.push_str(&command[pos..]);
    Some(out)
}

// ── Codex 실행 환경 ──
// Codex(0.162) Windows 샌드박스(unelevated)는 Microsoft Store 판 pwsh(MSIX)를 못 띄운다(0xC0000142). Codex 셸은 프로세스 PATH 로만
// 정해져 Codex PATH 에서 스토어 pwsh 자리를 빼고, 자식 명령에는 원래 PATH 를 돌려준다. 사용자 `~/.codex/config.toml` 은 건드리지 않고
// `windows.sandbox="mxc"` 강제는 하지 않는다. OS 분기는 [`codex_launch_env`] 하나.

/// 걸러진 PATH 와 원래 PATH(자식 복원용).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexLaunchEnv {
    pub filtered_path: String,
    pub original_path: String,
}

fn is_store_entry(entry: &str, local_app_data: Option<&str>) -> bool {
    let e = entry.trim().trim_end_matches(['\\', '/']).replace('/', "\\").to_ascii_lowercase();
    if e.is_empty() {
        return false;
    }
    if e.contains("\\windowsapps\\microsoft.powershell") {
        return true;
    }
    if let Some(l) = local_app_data {
        let alias = format!("{}\\microsoft\\windowsapps", l.trim_end_matches(['\\', '/']).replace('/', "\\").to_ascii_lowercase());
        if e == alias {
            return true;
        }
    }
    false
}

pub(crate) fn filter_store_pwsh(path: &str, local_app_data: Option<&str>) -> String {
    path.split(';')
        .filter(|e| !is_store_entry(e, local_app_data))
        .collect::<Vec<_>>()
        .join(";")
}

/// 지금 프로세스 PATH 로 Codex 실행 환경을 정한다 — `#[cfg(windows)]` 에서만, 다른 OS 는 `None` 스텁(셸 고르기가 PATH 에 묶인
/// 문제는 Windows 샌드박스의 것이다).
pub(crate) fn codex_launch_env() -> Option<CodexLaunchEnv> {
    #[cfg(windows)]
    {
        let original = std::env::var("PATH").ok()?;
        let local = std::env::var("LOCALAPPDATA").ok();
        Some(CodexLaunchEnv {
            filtered_path: filter_store_pwsh(&original, local.as_deref()),
            original_path: original,
        })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

pub(crate) fn toml_string(s: &str) -> String {
    if !s.contains('\'') && !s.chars().any(char::is_control) {
        return format!("'{s}'");
    }
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub(crate) fn codex_extra_args(env: Option<&CodexLaunchEnv>) -> Vec<String> {
    let Some(env) = env else {
        return Vec::new();
    };
    vec![
        "-c".into(),
        "features.prefer_mxc=true".into(),
        "-c".into(),
        "suppress_unstable_features_warning=true".into(),
        "-c".into(),
        format!("shell_environment_policy.set.Path={}", toml_string(&env.original_path)),
    ]
}

pub(crate) fn apply_tile_path(env: &mut Vec<(String, String)>, launch: Option<&CodexLaunchEnv>) {
    let Some(l) = launch else { return };
    env.retain(|(k, _)| !k.eq_ignore_ascii_case("PATH"));
    env.push(("PATH".into(), l.filtered_path.clone()));
}

pub(crate) fn codex_line_with_env(command: &str, shell: Option<&str>, env: Option<&CodexLaunchEnv>) -> Option<String> {
    let extra = codex_extra_args(env);
    if extra.is_empty() || crate::agent_args::agent_of_line(command).map(|(id, _)| id) != Some("codex") {
        return None;
    }
    Some(crate::agent_args::with_tokens(command, shell, &extra))
}

#[cfg(test)]
mod launch_env_tests {
    use super::*;

    #[test]
    fn codex_launch_env_filters_store_pwsh() {
        let local = r"C:\Users\me\AppData\Local";
        let path = [
            r"C:\Program Files\WindowsApps\Microsoft.PowerShell_7.5.4.0_x64__8wekyb3d8bbwe",
            r"C:\Windows\system32",
            r"C:\Program Files\PowerShell\7\",
            r"c:\users\ME\appdata\local\microsoft\windowsapps\",
            r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\Other",
            r"C:\Program Files\Git\cmd",
        ]
        .join(";");
        let out = filter_store_pwsh(&path, Some(local));
        assert_eq!(
            out,
            [
                r"C:\Windows\system32",
                r"C:\Program Files\PowerShell\7\",
                r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\Other",
                r"C:\Program Files\Git\cmd",
            ]
            .join(";")
        );
        let env = CodexLaunchEnv {
            filtered_path: out.clone(),
            original_path: path.clone(),
        };
        let extra = codex_extra_args(Some(&env));
        assert_eq!(extra[1], "features.prefer_mxc=true");
        assert_eq!(extra[3], "suppress_unstable_features_warning=true");
        assert_eq!(extra[5], format!("shell_environment_policy.set.Path='{path}'"));
        assert_eq!(toml_string(r"C:\it's"), r#""C:\\it's""#);
        assert!(codex_extra_args(None).is_empty());
        assert_eq!(codex_launch_env().is_some(), cfg!(windows));
    }

    #[test]
    fn codex_tile_shell_path_filtered() {
        let env = CodexLaunchEnv {
            filtered_path: r"C:\Windows".into(),
            original_path: r"C:\Program Files\WindowsApps\Microsoft.PowerShell_7;C:\Windows".into(),
        };
        let mut spec_env = vec![("Path".to_string(), "x".to_string()), ("A".to_string(), "1".to_string())];
        apply_tile_path(&mut spec_env, Some(&env));
        assert_eq!(spec_env, vec![("A".into(), "1".into()), ("PATH".into(), r"C:\Windows".into())]);
        let mut untouched = vec![("A".to_string(), "1".to_string())];
        apply_tile_path(&mut untouched, None);
        assert_eq!(untouched.len(), 1);
        let line = codex_line_with_env("codex --no-daemon", Some("pwsh"), Some(&env)).unwrap();
        assert!(line.starts_with("codex --no-daemon "), "{line}");
        assert!(line.contains("features.prefer_mxc=true"), "{line}");
        assert!(line.contains("shell_environment_policy.set.Path="), "{line}");
        assert_eq!(codex_line_with_env("claude", Some("pwsh"), Some(&env)), None);
        assert_eq!(codex_line_with_env("codex", Some("pwsh"), None), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn argv_gets_the_flag_in_the_right_place() {
        assert_eq!(codex_argv(&v("codex"), true), v("codex --no-daemon"));
        assert_eq!(
            codex_argv(&v("codex --model o3"), true),
            v("codex --no-daemon --model o3")
        );
        assert_eq!(
            codex_argv(&v("codex exec hi"), true),
            v("codex --no-daemon exec hi")
        );
        let id = "01a0dc8b-6ce8-77f1-9b8d-82e8a23c8840";
        assert_eq!(
            codex_argv(&v(&format!("codex resume {id}")), true),
            v(&format!("codex resume --no-daemon {id}"))
        );
        assert_eq!(
            codex_argv(&v(&format!("codex fork {id}")), true),
            v(&format!("codex fork --no-daemon {id}"))
        );
        assert_eq!(
            codex_argv(&v("Codex.exe"), true),
            v("Codex.exe --no-daemon")
        );
    }

    #[test]
    fn argv_is_untouched_when_off_not_codex_or_already_chosen() {
        for cmd in [
            "codex --no-daemon",
            "codex resume --no-daemon x",
            "codex --remote ws://127.0.0.1:1",
            "codex --remote=unix://",
            "claude --resume x",
            "codexx",
            "npx codex",
        ] {
            assert_eq!(codex_argv(&v(cmd), true), v(cmd), "{cmd}");
        }
        assert_eq!(codex_argv(&v("codex"), false), v("codex"), "설정 꺼짐");
        assert_eq!(codex_argv(&v("codex resume x"), false), v("codex resume x"));
        assert!(codex_argv(&[], true).is_empty());
    }

    #[test]
    fn line_inserts_text_without_rebuilding_the_rest() {
        assert_eq!(
            codex_line("codex", true).as_deref(),
            Some("codex --no-daemon")
        );
        assert_eq!(
            codex_line("codex  ", true).as_deref(),
            Some("codex --no-daemon  ")
        );
        assert_eq!(
            codex_line("codex --model \"gpt  5\"", true).as_deref(),
            Some("codex --no-daemon --model \"gpt  5\"")
        );
        assert_eq!(
            codex_line("codex resume abc", true).as_deref(),
            Some("codex resume --no-daemon abc")
        );
        assert_eq!(
            codex_line("codex fork", true).as_deref(),
            Some("codex fork --no-daemon")
        );
        assert_eq!(
            codex_line("  codex resume  abc", true).as_deref(),
            Some("  codex resume  --no-daemon abc")
        );
        assert_eq!(codex_line("codex", false), None);
        assert_eq!(codex_line("claude", true), None);
        assert_eq!(codex_line("codex --no-daemon", true), None);
        assert_eq!(codex_line("codex --remote unix://", true), None);
        assert_eq!(codex_line("", true), None);
        assert_eq!(codex_line("   ", true), None);
    }
}
