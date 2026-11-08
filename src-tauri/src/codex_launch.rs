//! **aynx 이 띄우는 Codex 에 `--no-daemon`** — 그 규칙이 사는 한 곳 (docs/log/2026-09-26-codex-hooks.md
//! "다시 켬 — --no-daemon").
//!
//! Codex CLI 0.157 의 TUI 는 기본으로 PC 공용 `codex app-server` 데몬에 붙고, 훅을 **그 데몬 안에서, 데몬을
//! 처음 띄운 터미널의 환경으로** 돌린다 — 그래서 `AYNX_STREAM` 이 옛 타일의 것이 되어 신호가 엉뚱한 타일로
//! 간다. `--no-daemon`("공용 백그라운드 서버 없이 실행") 으로 띄우면 훅이 **그 타일의 환경**을 받는다(실측:
//! 두 타일이 각자 제 `AYNX_STREAM` 을 보냈다).
//!
//! 규칙은 하나다([`insert_at`]):
//!
//! | 명령 | 결과 |
//! | --- | --- |
//! | `codex` · `codex --model o3` · `codex exec …` | `codex --no-daemon …` (맨 앞 옵션 자리 — 모든 하위명령이 받는다) |
//! | `codex resume <id>` · `codex fork <id>` | `codex resume --no-daemon <id>` (그 하위명령의 `--help` 에 있는 자리) |
//! | 이미 `--no-daemon` · `--remote` · `--remote=…` 가 있다 | 그대로 (사용자가 정한 것) |
//! | codex 가 아니다 · 설정이 꺼졌다 | 그대로 |
//!
//! 쓰는 곳: [`codex_line`](자동 실행 한 줄 —
//! `crate::agent_autorun::agent_autorun_command` 가 AI 타일 · 셸 메뉴 · 프로젝트 시작 화면 · 재개/포크 전부에
//! 건다 · 시험용 인자 목록 판은 `codex_argv`). 셸에 손으로 친 `codex` 는 같은 규칙을 셸 글자로 옮긴 감싸개가 맡는다
//! (`crate::shell_integration` — PowerShell · Git Bash).

/// 붙일 플래그.
pub(crate) const NO_DAEMON_FLAG: &str = "--no-daemon";

/// 실행 파일이 codex 인가 — `codex` · `codex.exe` · `codex.cmd` (대소문자 무관).
fn is_codex(first: &str) -> bool {
    matches!(
        first.to_ascii_lowercase().as_str(),
        "codex" | "codex.exe" | "codex.cmd"
    )
}

/// 사용자가 이미 데몬을 정했는가 — `--no-daemon` 이 있거나 `--remote` 로 다른 서버에 붙는다.
fn chose_server(tokens: &[&str]) -> bool {
    tokens
        .iter()
        .any(|t| *t == NO_DAEMON_FLAG || *t == "--remote" || t.starts_with("--remote="))
}

/// `--no-daemon` 을 **몇 번째 낱말 앞에** 끼울지 — 끼우지 않으면 `None`. 규칙은 모듈 머리말의 표.
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

/// 인자 목록에 적용한다 — 끼울 것이 없으면 받은 그대로. 제품 경로는 한 줄([`codex_line`])만 쓰고, 이것은 시험이
/// 재개·포크 명령(`agent_sessions` 의 인자 목록)에 대고 같은 규칙([`insert_at`])을 보는 데 쓴다.
#[cfg(test)]
pub(crate) fn codex_argv(argv: &[String], enabled: bool) -> Vec<String> {
    let tokens: Vec<&str> = argv.iter().map(String::as_str).collect();
    let mut out = argv.to_vec();
    if let Some(i) = insert_at(&tokens, enabled) {
        out.insert(i, NO_DAEMON_FLAG.to_owned());
    }
    out
}

/// 자동 실행할 **한 줄**에 적용한다 — 끼울 것이 없으면 `None`(부르는 쪽이 원래 줄을 쓴다).
///
/// 줄을 낱말로 다시 짓지 않고 **그 자리에 글자만 끼운다** — 사용자의 시작 명령(`codex --model "gpt 5"`)의
/// 따옴표·공백을 건드리지 않기 위해서다. 낱말 경계는 공백으로만 본다(따옴표 안의 `--remote` 도 "정했다" 로
/// 읽힌다 — 덜 끼우는 쪽으로 틀린다).
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
    // 그 낱말 바로 앞(없으면 줄 끝)에 끼운다.
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

// ---------------------------------------------------------------------------
// Codex 실행 환경(2026-10-15 — 설계 C-3 "배포 요건" · 사용자 결정 2: 작업자와 일반 Codex AI 타일 모두)
//
// Codex(0.162)의 Windows 샌드박스 기본 백엔드(unelevated)는 **Microsoft Store 판 pwsh**(MSIX)를 못 띄운다(0xC0000142). Codex 에는
// 셸 경로 키가 없고 셸은 **프로세스 PATH** 로만 정해지므로(`which pwsh`), Codex 프로세스의 PATH 에서 스토어 pwsh 의 `$PSHOME`
// (`\WindowsApps\Microsoft.PowerShell*`)와 별칭 폴더(`%LOCALAPPDATA%\Microsoft\WindowsApps`)를 뺀다 → MSI pwsh 가 있으면 그것,
// 없으면 Windows PowerShell 5.1. 자식 명령에는 원래 PATH 를 `-c shell_environment_policy.set.Path=…` 로 돌려준다(winget 등).
// 그리고 `features.prefer_mxc` — Codex 가 MXC 가용성을 스스로 판정하고, 안 되면 설정된 백엔드로 남는다(`windows.sandbox="mxc"`
// 강제는 하지 않는다). 사용자 `~/.codex/config.toml` 은 건드리지 않는다. **OS 분기는 [`codex_launch_env`] 하나**(다른 OS 는 `None`).
// ---------------------------------------------------------------------------

/// Codex 프로세스의 PATH 덮기 — 걸러진 값과 원래 값(자식 복원용).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexLaunchEnv {
    pub filtered_path: String,
    pub original_path: String,
}

/// 걸러 낼 PATH 조각인가 — 스토어 pwsh `$PSHOME`(`…\WindowsApps\Microsoft.PowerShell_…`) · 별칭 폴더(`%LOCALAPPDATA%\Microsoft\
/// WindowsApps` — 대소문자 · 끝 구분자 무시). **순수**.
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

/// PATH 거르기 — **순수**(가짜 PATH 로 시험한다). 구분자는 `;`(Windows 의 PATH).
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

/// TOML 문자열 값 — 작은따옴표가 없으면 리터럴(`'…'` — 역슬래시를 그대로), 있으면 기본 문자열(`"…"` — `\` · `"` · 제어 문자 이스케이프).
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

/// Codex 실행 인자에 더할 것 — `prefer_mxc` · 경고 끄기 · 자식 PATH 복원. `env` 가 없으면(Windows 밖) 아무것도 없다. 순수.
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

/// 일반 Codex AI 타일 — 그 타일 셸 자체의 PATH 를 거른 값으로 덮는다(`prepare_spawn` 재료의 환경에 `PATH` 를 더한다 — 셸 줄로 바꾸지
/// 않는다). 같은 이름은 먼저 뺀다. 순수.
pub(crate) fn apply_tile_path(env: &mut Vec<(String, String)>, launch: Option<&CodexLaunchEnv>) {
    let Some(l) = launch else { return };
    env.retain(|(k, _)| !k.eq_ignore_ascii_case("PATH"));
    env.push(("PATH".into(), l.filtered_path.clone()));
}

/// autorun 한 줄(이미 셸 글자)에 [`codex_extra_args`] 를 놓는다 — codex 줄이 아니거나 덧붙일 것이 없으면 `None`.
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

    /// 시험 이름 = 설계 H — 가짜 PATH 에서 스토어 pwsh 두 자리만 빠진다.
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
        // 덧붙일 인자 — prefer_mxc · 경고 끄기 · 원래 PATH(리터럴, 작은따옴표가 있으면 기본 문자열).
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
        // 이 OS 의 판 — Windows 면 지금 PATH 에서 값이 나오고, 다른 OS 는 스텁(`None`).
        assert_eq!(codex_launch_env().is_some(), cfg!(windows));
    }

    /// 시험 이름 = 설계 H — 일반 Codex 타일의 셸 PATH 를 덮고(같은 이름은 하나만), autorun 줄에 같은 인자를 놓는다.
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
