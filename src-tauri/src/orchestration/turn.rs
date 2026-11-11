//! **헤드리스 턴의 순수 층**(헤드리스 설계 docs/log/2026-10-16-orchestration-headless-design.md 2-3 · 2-3a · 4-1 ~ 4-4 · 4-7 ·
//! 실측 S1 ~ S21 — 3차 2단계). 한 턴 = 프로세스 하나(셸 없는 CLI · 파이프 · 생성 시 Job — 서버 손 `server::workers`)의 재료와 판정:
//!
//! - 인자 배열 [`turn_argv`] — CLI × 등급(`edit` · `full` · 판정형 `read-only`) × 첫 턴/resume. **설정 출처 통제**(2-3a — 출시 조건)가
//!   늘 실린다: Claude `edit` = 후보 A `--restricted --tools …`, `full` · 판정형 = 후보 B `--setting-sources "" --settings <JSON>`(훅 끔),
//!   Codex = 통제 넷 `--ignore-user-config --ignore-rules --disable plugins --disable hooks`. `--bare`(OAuth 를 안 읽는다) ·
//!   `--dangerously-bypass-hook-trust` · `--fork-session`(새 대화 id) 은 **어디에도 없다**(시험 `worker_args_control_setting_sources`).
//! - 이벤트 추출기 [`turn_event`] — stdout 한 줄에서 **낱말 · 수만** 꺼낸다(대화 id · 실효 모델 · 권한 모드 · MCP 상태 · 도구 이름 · 거절 ·
//!   끝). 본문(모델 글 · 도구 입력 · 결과)은 꺼내지 않는다 — 줄은 읽고 버린다(1차 C-7 · `progress.rs` 불변 그대로).
//! - 이상 입력 계약 [`TurnLog`] + [`turn_outcome`](4-4 표) — 원칙: **애매하면 성공이 아니다.** 잘린 줄 · 1 MiB 넘는 줄 · JSON 아님 · 모르는
//!   사건은 세고 버린다 · init 없음 · result 없음 · 종료 코드와 result 불일치 · 다른 대화 id 는 실패다.
//! - 환경 [`headless_env`] — 서버 환경 − **공용 정화**(`pty::scrub_env_names` 하나 — PTY 자식과 같은 목록, D11) + 이 턴의 값.
//! - 지침 턴 파일 본문 [`instructions_text`] — 고정 역할 문장 + 사람의 역할 지침 + 앱이 **읽기만** 한 CLAUDE.md(E19 · S17 · S18).
//!   파일은 턴 자원(턴 끝 확인 뒤 지운다 — 서버 손의 [`TurnFiles`]).
//! - 턴 기록의 `args` 는 **권한 표시 전용 구조**([`args_label`] — 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 없음, D11).

use std::path::PathBuf;

use serde_json::Value;

use super::model::{TurnAnomalies, TurnArgsLabel, WorkerCli};
use super::spawn::sanitize_text;

/// stdout 한 줄 상한(4-4 — 넘으면 버리고 센다).
pub(crate) const LINE_MAX: usize = 1024 * 1024;
/// stderr 꼬리(메모리 · 사람 보기만 — 4-3).
pub(crate) const STDERR_TAIL: usize = 8 * 1024;
/// 시작 시한 — init(Codex `thread.started`)까지(Q4 — 실측 S2 · S5 의 시작은 수 초 · 고정 2분 [추측]).
pub(crate) const START_MS: u64 = 2 * 60_000;
/// 지침 파일에 싣는 문서 하나의 상한(전역 · 저장소 CLAUDE.md — 넘으면 앞부분만 + 잘림 표시).
pub(crate) const INSTRUCTIONS_DOC_MAX: usize = 64 * 1024;
/// Codex `developer_instructions` 상한(명령줄 32,767자 안 — 첫 지시 24 KiB 와 나눠 쓴다 · 역할 지침 4 KiB · 2-1).
pub(crate) const DEVELOPER_INSTRUCTIONS_MAX: usize = 4 * 1024;

/// Claude `edit`(후보 A — `--restricted`)의 내장 도구(S14 실측 그대로).
pub(crate) const CLAUDE_EDIT_TOOLS: &str = "Read,Edit,Write,Glob,Grep,Bash";
/// 판정형(검토자)의 내장 도구 — **읽기만**(`spawn::REVIEWER_CLAUDE_TOOLS` 와 같다 — 시험).
pub(crate) const CLAUDE_JUDGE_TOOLS: &str = "Read,Grep,Glob";

// ---------------------------------------------------------------------------
// 등급 · 인자
// ---------------------------------------------------------------------------

/// 턴의 권한 등급(2-3 · 4-7) — 쓰기형 역할의 `edit` · `full`, 판정형은 늘 `read-only`. 3차 2단계에서 서버가 띄우는 턴은 판정형뿐이다 —
/// 쓰기형 두 등급은 인자 표(시험)로 먼저 서고 3a(작업자 헤드리스)가 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum Grade {
    Edit,
    Full,
    ReadOnly,
}

impl Grade {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Grade::Edit => "edit",
            Grade::Full => "full",
            Grade::ReadOnly => "read-only",
        }
    }
}

/// 한 턴의 인자 재료 — **`Debug` 를 파생하지 않는다**(프롬프트 · 설정 파일 경로). 토큰 값은 여기 없다(Claude 는 `mcp_config` 파일 안,
/// Codex 는 환경 변수 `token_env` 안).
pub(crate) struct TurnArgs<'a> {
    pub cli: WorkerCli,
    /// 실행 파일 절대 경로(PATH 의 `.exe` — `spawn::find_exe`).
    pub exe: &'a str,
    pub grade: Grade,
    /// 이어지는 턴 — 고정 대화 id(Claude `--resume <id>` · Codex `exec resume <thread>`). 없으면 첫 턴.
    pub resume: Option<&'a str>,
    /// Claude 첫 턴 — 서버가 정한 `--session-id`(resume 과 함께 주면 시작 오류 — S1).
    pub session_id: Option<&'a str>,
    /// 세션 서버 MCP 이름(`instance::mcp_name`).
    pub mcp_name: &'a str,
    /// 미리 허용할 우리 MCP 도구(작업자 · 판정형 셋 — `spawn::WORKER_ALLOWED_TOOLS` · `REVIEWER_ALLOWED_TOOLS`).
    pub mcp_tools: &'a [&'a str],
    /// Claude — 턴 토큰이 든 `--mcp-config` 파일.
    pub mcp_config: Option<&'a str>,
    /// Codex — `/mcp` 주소 · 토큰을 담은 환경 변수 이름.
    pub mcp_url: &'a str,
    pub token_env: &'a str,
    /// Claude `edit` · `full` — 허용 명령(맡기기 · 접두 규칙 `Bash(<명령>:*)` 로 `--settings` 의 `permissions.allow` 에 — S3 · S14).
    pub allowed_commands: &'a [String],
    /// Claude — 긴 명세 폴더 읽기 허용(`Read(//…/**)` — `spawn::claude_read_rule`).
    pub read_rule: Option<&'a str>,
    /// Claude 판정형 — 읽기 자리(`--add-dir`).
    pub add_dir: Option<&'a str>,
    /// Codex 첫 턴의 `-C`(작업 폴더) — resume 에는 `-C` 가 없다(S6 — 프로세스 cwd 로 준다).
    pub cwd: Option<&'a str>,
    /// Codex — OS 실행 환경 덧붙임(`codex_launch::codex_extra_args` — Windows 만).
    pub codex_extra: &'a [String],
    /// 역할 모델 · 강도 낱말(`spawn::role_model_args` — 개발 덮기가 이긴 결과).
    pub model_args: &'a [String],
    /// Claude — 지침 턴 파일(`--append-system-prompt-file` — S18).
    pub append_file: Option<&'a str>,
    /// Codex — 추가 지침(`-c developer_instructions=…` — S19). 상한 [`DEVELOPER_INSTRUCTIONS_MAX`].
    pub developer_instructions: Option<&'a str>,
    /// 첫 글자가 `[` 인 지시 하나(`spawn::first_instruction` · `reviewer_prompt` — 머리줄).
    pub prompt: &'a str,
}

/// 허용 명령 하나 → Claude 규칙 `Bash(<명령>:*)`(S3 실측 꼴). 규칙 문법과 부딪히는 글자(`(` `)` `*` · 제어 문자) · 빈 값 · 200자 넘음은
/// `None`(그 명령은 허용하지 않는다 — 좁은 쪽).
pub(crate) fn command_rule(cmd: &str) -> Option<String> {
    let c = cmd.trim();
    if c.is_empty() || c.chars().count() > 200 || c.chars().any(|ch| matches!(ch, '(' | ')' | '*') || ch.is_control()) {
        return None;
    }
    Some(format!("Bash({c}:*)"))
}

/// Claude `--settings` 의 JSON(2-3a) — `permissions.allow` = 허용 명령 규칙, 후보 B(`full` · 판정형)는 `disableAllHooks` 도.
fn claude_settings(grade: Grade, allowed: &[String]) -> String {
    let rules: Vec<String> = match grade {
        Grade::ReadOnly => Vec::new(),
        _ => allowed.iter().filter_map(|c| command_rule(c)).collect(),
    };
    let mut v = serde_json::json!({ "permissions": { "allow": rules } });
    if grade != Grade::Edit {
        v["disableAllHooks"] = Value::Bool(true);
    }
    v.to_string()
}

/// TOML 기본 문자열(`"…"` — 역슬래시 · 따옴표 · 제어 문자 이스케이프). Codex `-c key=<TOML 값>` 의 값으로.
pub(crate) fn toml_basic_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn push_all(a: &mut Vec<String>, xs: &[&str]) {
    a.extend(xs.iter().map(|s| s.to_string()));
}

/// 한 턴의 argv — `[exe, 옵션…, "--", 프롬프트]`(옵션 전부 → `--` → 프롬프트 하나 — 1b). 순수. 표(설계 4-2 · 4-7 · 실측 결과):
///
/// | | 첫 턴 | resume |
/// |---|---|---|
/// | Claude | `-p --output-format stream-json --verbose --session-id <id>` | `… --resume <id>`(`--session-id` 없음 — S1) |
/// | Codex | `-a never exec --json -s <샌드박스> … -C <폴더>` | `-a never exec resume --json … -c sandbox_mode='…' <thread>`(`-s` · `-C` 없음 — S6) |
pub(crate) fn turn_argv(i: &TurnArgs<'_>) -> Vec<String> {
    let mut a: Vec<String> = vec![i.exe.to_string()];
    match i.cli {
        WorkerCli::Claude => {
            push_all(&mut a, &["-p", "--output-format", "stream-json", "--verbose"]);
            match (i.resume, i.session_id) {
                (Some(id), _) => push_all(&mut a, &["--resume", id]),
                (None, Some(id)) => push_all(&mut a, &["--session-id", id]),
                (None, None) => {}
            }
            // 설정 출처 통제(2-3a) — edit = A · full · 판정형 = B.
            match i.grade {
                Grade::Edit => push_all(&mut a, &["--restricted", "--tools", CLAUDE_EDIT_TOOLS]),
                Grade::Full => push_all(&mut a, &["--setting-sources", ""]),
                Grade::ReadOnly => push_all(&mut a, &["--setting-sources", "", "--tools", CLAUDE_JUDGE_TOOLS]),
            }
            a.push("--settings".into());
            a.push(claude_settings(i.grade, i.allowed_commands));
            match i.grade {
                Grade::Edit => push_all(&mut a, &["--permission-mode", "acceptEdits"]),
                Grade::Full => push_all(&mut a, &["--permission-mode", "bypassPermissions"]),
                // 판정형은 권한 모드를 주지 않는다(2차 검토자와 같음 — 읽기 도구만 있다).
                Grade::ReadOnly => {}
            }
            push_all(&mut a, &["--permission-prompts", "none"]);
            a.extend(i.model_args.iter().cloned());
            if let Some(f) = i.append_file {
                push_all(&mut a, &["--append-system-prompt-file", f]);
            }
            if let Some(cfg) = i.mcp_config {
                push_all(&mut a, &["--mcp-config", cfg]);
            }
            a.push("--strict-mcp-config".into());
            if let Some(d) = i.add_dir {
                push_all(&mut a, &["--add-dir", d]);
            }
            a.push("--allowedTools".into());
            for t in i.mcp_tools {
                a.push(format!("mcp__{}__{t}", i.mcp_name));
            }
            if let Some(rule) = i.read_rule {
                a.push(rule.into());
            }
        }
        WorkerCli::Codex => {
            push_all(&mut a, &["-a", "never", "exec"]);
            if i.resume.is_some() {
                a.push("resume".into());
            }
            a.push("--json".into());
            if i.resume.is_none() {
                match i.grade {
                    Grade::Edit => push_all(&mut a, &["-s", "workspace-write"]),
                    Grade::Full => a.push("--dangerously-bypass-approvals-and-sandbox".into()),
                    Grade::ReadOnly => push_all(&mut a, &["-s", "read-only"]),
                }
            }
            push_all(&mut a, &["--ignore-user-config", "--ignore-rules", "--disable", "plugins", "--disable", "hooks"]);
            if i.resume.is_some() {
                // resume 에는 `-s` 가 없다 — 이 턴의 샌드박스는 `-c sandbox_mode`(S6 — 이 턴의 값을 쓴다).
                match i.grade {
                    Grade::Edit => push_all(&mut a, &["-c", "sandbox_mode='workspace-write'"]),
                    Grade::Full => a.push("--dangerously-bypass-approvals-and-sandbox".into()),
                    Grade::ReadOnly => push_all(&mut a, &["-c", "sandbox_mode='read-only'"]),
                }
            }
            if i.grade == Grade::ReadOnly && i.resume.is_none() {
                // 판정형의 cwd 는 git 저장소가 아닌 빈 폴더다 — 없으면 exec 가 시작을 거절한다(2차 0b).
                a.push("--skip-git-repo-check".into());
            }
            a.extend(i.codex_extra.iter().cloned());
            if i.grade == Grade::Edit {
                // S5 — 사용자 config 를 끄면 이 키도 빠져 workspace-write 가 오류 없이 read-only 로 강등된다. E20 — 네트워크는 늘 켠다.
                push_all(&mut a, &["-c", "windows.sandbox='unelevated'", "-c", "sandbox_workspace_write.network_access=true"]);
            }
            a.extend(i.model_args.iter().cloned());
            if let Some(d) = i.developer_instructions.filter(|d| !d.trim().is_empty()) {
                let d: String = sanitize_text(d).chars().take(DEVELOPER_INSTRUCTIONS_MAX).collect();
                a.push("-c".into());
                a.push(format!("developer_instructions={}", toml_basic_string(&d)));
            }
            let s = i.mcp_name;
            for v in [
                format!("mcp_servers.{s}.url='{}'", i.mcp_url),
                format!("mcp_servers.{s}.bearer_token_env_var='{}'", i.token_env),
            ] {
                a.push("-c".into());
                a.push(v);
            }
            for t in i.mcp_tools {
                a.push("-c".into());
                a.push(format!("mcp_servers.{s}.tools.{t}.approval_mode='approve'"));
            }
            match (i.resume, i.cwd) {
                (Some(thread), _) => a.push(thread.into()),
                (None, Some(cwd)) => push_all(&mut a, &["-C", cwd]),
                (None, None) => {}
            }
        }
    }
    a.push("--".into());
    a.push(i.prompt.to_string());
    a
}

/// 모델 · 강도 낱말에서 값을 읽는다(표시용 — `--model x` · `-m x` · `--effort y` · `-c model_reasoning_effort=y`).
fn model_effort_of(args: &[String]) -> (Option<String>, Option<String>) {
    let mut model = None;
    let mut effort = None;
    let mut it = args.iter().peekable();
    while let Some(x) = it.next() {
        match x.as_str() {
            "--model" | "-m" => model = it.next().cloned(),
            "--effort" => effort = it.next().cloned(),
            "-c" => {
                if let Some(v) = it.next().and_then(|v| v.strip_prefix("model_reasoning_effort=")) {
                    effort = Some(v.trim_matches('"').to_string());
                }
            }
            _ => {}
        }
    }
    (model, effort)
}

/// 턴 기록의 `args` — **권한 표시 전용 구조**(D11): CLI · 등급 · 설정 통제 · 허용 규칙 · 샌드박스 · 모델 · 강도 · 지침 해시 · resume.
/// 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 · 대화 id 는 담지 않는다(시험 `turn_args_label_has_no_prompt`).
pub(crate) fn args_label(i: &TurnArgs<'_>, instructions_sha: Option<String>) -> TurnArgsLabel {
    let (model, effort) = model_effort_of(i.model_args);
    let (settings_control, sandbox) = match (i.cli, i.grade) {
        (WorkerCli::Claude, Grade::Edit) => ("restricted", None),
        (WorkerCli::Claude, _) => ("setting-sources-empty", None),
        (WorkerCli::Codex, Grade::Edit) => ("ignore-user-config", Some("workspace-write · network on")),
        (WorkerCli::Codex, Grade::Full) => ("ignore-user-config", Some("none")),
        (WorkerCli::Codex, Grade::ReadOnly) => ("ignore-user-config", Some("read-only")),
    };
    let allowed_rules = match (i.cli, i.grade) {
        (WorkerCli::Claude, Grade::Edit | Grade::Full) => i.allowed_commands.iter().filter_map(|c| command_rule(c)).collect(),
        _ => Vec::new(),
    };
    TurnArgsLabel {
        cli: i.cli.as_str().into(),
        grade: i.grade.as_str().into(),
        settings_control: settings_control.into(),
        allowed_rules,
        sandbox: sandbox.map(str::to_string),
        model,
        effort,
        instructions_sha,
        resume: i.resume.is_some(),
        // 실행 시한은 인자 재료에 없다 — 턴을 띄우는 손(`server::workers`)이 그 턴의 값을 적는다.
        turn_minutes: None,
    }
}

/// 이 턴의 init 에서 확인할 것(4-4 "실효 설정") — [`expect_for`] 가 인자 재료에서 짓는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Expect {
    pub cli: WorkerCli,
    /// 같아야 하는 대화 id — Claude 는 늘(`--session-id` · `--resume`), Codex 는 resume 턴만(첫 턴은 `thread.started` 가 고정한다).
    pub conversation: Option<String>,
    /// 연결돼 있어야 하는 우리 MCP 서버 이름(Claude init `mcp_servers`).
    pub mcp_server: Option<String>,
    /// 이 턴의 권한 모드(Claude init `permissionMode`) — 판정형은 정하지 않는다(대신 넓은 모드를 거절).
    pub permission_mode: Option<&'static str>,
    /// 내장 도구 상한(Claude init `tools` 중 `mcp__` 가 아닌 것) — 넘으면 실효 불일치.
    pub builtin_tools: Option<Vec<&'static str>>,
    pub judge: bool,
}

/// 인자 재료 → init 확인 조건(순수).
pub(crate) fn expect_for(i: &TurnArgs<'_>) -> Expect {
    let conversation = match i.cli {
        WorkerCli::Claude => i.resume.or(i.session_id).map(str::to_string),
        WorkerCli::Codex => i.resume.map(str::to_string),
    };
    let (permission_mode, builtin_tools) = match (i.cli, i.grade) {
        (WorkerCli::Claude, Grade::Edit) => (Some("acceptEdits"), Some(CLAUDE_EDIT_TOOLS.split(',').collect())),
        (WorkerCli::Claude, Grade::Full) => (Some("bypassPermissions"), None),
        (WorkerCli::Claude, Grade::ReadOnly) => (None, Some(CLAUDE_JUDGE_TOOLS.split(',').collect())),
        (WorkerCli::Codex, _) => (None, None),
    };
    Expect {
        cli: i.cli,
        conversation,
        mcp_server: (i.cli == WorkerCli::Claude && i.mcp_config.is_some()).then(|| i.mcp_name.to_string()),
        permission_mode,
        builtin_tools,
        judge: i.grade == Grade::ReadOnly,
    }
}

// ---------------------------------------------------------------------------
// 명령 줄 · 환경
// ---------------------------------------------------------------------------

/// 인자 하나를 표준 MSVC 규칙으로 인용해 붙인다(`CommandLineToArgvW` · MSVC CRT 가 되읽는 꼴 — portable-pty `append_quoted` 와 같은 규칙).
/// 빈 값은 `""`(Claude `--setting-sources ""` — S14 실측은 Python `list2cmdline` 의 같은 꼴).
fn quote_arg(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.chars().any(|c| matches!(c, ' ' | '\t' | '\n' | '\u{0b}' | '"')) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.extend(std::iter::repeat_n('\\', backslashes));
                backslashes = 0;
                out.push(c);
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
}

/// argv → 명령 줄 하나(셸 없음 — 셸 줄로 조립하지 않는다. 받는 쪽은 CLI 의 MSVC CRT 인자 파서).
pub(crate) fn quote_argv(argv: &[String]) -> String {
    let mut out = String::new();
    for (n, a) in argv.iter().enumerate() {
        if n > 0 {
            out.push(' ');
        }
        quote_arg(a, &mut out);
    }
    out
}

/// 헤드리스 턴의 자식 환경(4-3 · D11) — 물려받은 환경에서 **공용 정화 목록**(`pty::scrub_env_names` — PTY 자식과 같은 하나)과 이 턴이 더할
/// 이름을 걷고(Windows 환경 이름은 대소문자를 가리지 않는다) `add` 를 그 뒤에 더한다. 허용 목록으로 좁히지 않는다 — CLI 인증 · 프록시 ·
/// 설정 환경(`CLAUDE_CONFIG_DIR` · `CODEX_HOME` · API 키 변수)을 끊으면 CLI 가 안 선다. 환경은 같은 계정 · 자식 프로세스에 대한 비밀 경계가
/// 아니다. 순수.
pub(crate) fn headless_env(
    inherited: impl IntoIterator<Item = (String, String)>,
    add: &[(String, String)],
) -> Vec<(String, String)> {
    let drop_name = |k: &str| {
        crate::pty::scrub_env_names().any(|n| n.eq_ignore_ascii_case(k)) || add.iter().any(|(n, _)| n.eq_ignore_ascii_case(k))
    };
    let mut out: Vec<(String, String)> = inherited.into_iter().filter(|(k, _)| !k.is_empty() && !drop_name(k)).collect();
    out.extend(add.iter().cloned());
    out
}

// ---------------------------------------------------------------------------
// 지침 턴 파일
// ---------------------------------------------------------------------------

/// 지침 턴 파일의 본문(E19 · S17 · S18) — 고정 역할 문장(종류별 — 3-6) · 사람의 역할 지침 · 앱이 **읽기만** 한 문서들(`(이름, 내용)` —
/// 전역 · 저장소 CLAUDE.md) 순서. 셋 다 비면 `None`(파일도 인자도 없다). 사람이 쓴 글이라 정화만 하고 권한을 바꾸지 않는다(인자 · 통제가
/// 상한). 문서 하나는 [`INSTRUCTIONS_DOC_MAX`] 까지.
pub(crate) fn instructions_text(fixed: &str, role: Option<&str>, docs: &[(&str, &str)]) -> Option<String> {
    let role = role.map(str::trim).filter(|r| !r.is_empty());
    let docs: Vec<&(&str, &str)> = docs.iter().filter(|(_, body)| !body.trim().is_empty()).collect();
    if fixed.trim().is_empty() && role.is_none() && docs.is_empty() {
        return None;
    }
    let mut out = String::new();
    if !fixed.trim().is_empty() {
        out.push_str(&sanitize_text(fixed.trim()));
        out.push_str("\n\n");
    }
    if let Some(r) = role {
        out.push_str("## Role instructions (written by the person who delegated this repository)\n\n");
        out.push_str(&sanitize_text(r));
        out.push_str("\n\n");
    }
    for (name, body) in docs {
        let mut b: String = sanitize_text(body);
        let cut = b.len() > INSTRUCTIONS_DOC_MAX;
        if cut {
            let mut end = INSTRUCTIONS_DOC_MAX;
            while !b.is_char_boundary(end) {
                end -= 1;
            }
            b.truncate(end);
        }
        out.push_str(&format!("## {name} (copied by Aynx — the same instructions an interactive session would load)\n\n"));
        out.push_str(&b);
        if cut {
            out.push_str("\n\n(truncated)");
        }
        out.push_str("\n\n");
    }
    Some(out)
}

/// 전역 CLAUDE.md 의 자리 — `CLAUDE_CONFIG_DIR`(사용자가 정했으면) 아래, 아니면 홈의 `.claude`. **읽기만** 한다(S17 — 통제 A · B 는 이것을
/// 싣지 않는다).
pub(crate) fn global_claude_md(config_dir: Option<&std::ffi::OsStr>, home: Option<PathBuf>) -> Option<PathBuf> {
    let dir = match config_dir.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => home?.join(".claude"),
    };
    Some(dir.join("CLAUDE.md"))
}

/// 턴 자원 파일(지침 턴 파일 등) — **턴 끝 확인 뒤**(트리 0 · 파이프 EOF) 지운다. `Drop` 이 지운다 — 서버 손은 확인되면 곧바로 떨어뜨리고,
/// 확인이 안 서면 런타임 칸에 쥔 채로 두었다가 서버 시계가 확인할 때 떨어뜨린다(시험 `turn_instructions_file_is_reclaimed`).
#[derive(Default)]
pub(crate) struct TurnFiles(pub Vec<PathBuf>);

impl Drop for TurnFiles {
    fn drop(&mut self) {
        for p in self.0.drain(..) {
            let _ = std::fs::remove_file(&p);
        }
    }
}

// ---------------------------------------------------------------------------
// 출력 읽기 — 줄 · 꼬리
// ---------------------------------------------------------------------------

/// 줄 하나(또는 상한을 넘어 버린 줄 · EOF 에서 줄 중간에 잘린 마지막 줄 — 읽는 쪽이 [`LineSplitter::finish`] 로 안다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Line {
    Full(Vec<u8>),
    Oversized,
    Cut,
}

/// stdout 바이트 → 줄(4-4) — 상한을 넘은 줄은 그 자리에서 버리고(메모리를 키우지 않는다) [`Line::Oversized`] 하나로 센다. 순수.
pub(crate) struct LineSplitter {
    buf: Vec<u8>,
    max: usize,
    dropping: bool,
}

impl LineSplitter {
    pub(crate) fn new(max: usize) -> Self {
        LineSplitter {
            buf: Vec::new(),
            max,
            dropping: false,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8], out: &mut Vec<Line>) {
        let mut rest = chunk;
        loop {
            let (seg, nl) = match rest.iter().position(|&b| b == b'\n') {
                Some(p) => (&rest[..p], true),
                None => (rest, false),
            };
            if !self.dropping {
                self.buf.extend_from_slice(seg);
                if self.buf.len() > self.max {
                    self.buf = Vec::new();
                    self.dropping = true;
                    out.push(Line::Oversized);
                }
            }
            if !nl {
                return;
            }
            if self.dropping {
                self.dropping = false;
            } else {
                let mut line = std::mem::take(&mut self.buf);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                out.push(Line::Full(line));
            }
            rest = &rest[seg.len() + 1..];
        }
    }

    /// EOF — 줄 중간에서 끝났으면(잘린 마지막 줄) `true`(버리고 센다).
    pub(crate) fn finish(&mut self) -> bool {
        let cut = !self.dropping && !self.buf.is_empty();
        self.buf.clear();
        self.dropping = false;
        cut
    }
}

/// 끝 N 바이트 고리(stderr 꼬리 — 4-3: 폭주해도 끝만 남고 읽기는 멈추지 않는다). 순수.
pub(crate) struct TailRing {
    buf: Vec<u8>,
    cap: usize,
    total: u64,
}

impl TailRing {
    pub(crate) fn new(cap: usize) -> Self {
        TailRing {
            buf: Vec::new(),
            cap,
            total: 0,
        }
    }

    pub(crate) fn push(&mut self, b: &[u8]) {
        self.total += b.len() as u64;
        if b.len() >= self.cap {
            self.buf.clear();
            self.buf.extend_from_slice(&b[b.len() - self.cap..]);
            return;
        }
        self.buf.extend_from_slice(b);
        if self.buf.len() > self.cap {
            let over = self.buf.len() - self.cap;
            self.buf.drain(..over);
        }
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.buf
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn total(&self) -> u64 {
        self.total
    }
}

// ---------------------------------------------------------------------------
// 이벤트 추출기
// ---------------------------------------------------------------------------

/// stdout 한 줄의 뜻(낱말 · 수만 — 본문 없음).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TurnEvent {
    /// Claude `system/init` · Codex `thread.started`.
    Init {
        conversation: Option<String>,
        model: Option<String>,
        permission_mode: Option<String>,
        cli_version: Option<String>,
        /// `(이름, 상태)` — Claude `mcp_servers`.
        mcp: Vec<(String, String)>,
        tools: Vec<String>,
    },
    /// 도구 호출 `count` 개(이름만 — 마지막 이름).
    Tools { count: u32, last: String },
    /// 거절 하나(Claude `system/permission_denied`).
    Denied,
    /// 턴 끝 — Claude `result` · Codex `turn.completed` · `turn.failed`.
    End {
        ok: bool,
        /// 실패 낱말(Claude `subtype` · Codex `turn-failed`) — 모양이 맞을 때만.
        word: Option<String>,
        conversation: Option<String>,
        /// Claude `result.permission_denials` 의 수.
        denials: u32,
    },
    /// 아는 사건 — 뽑을 것이 없다.
    Known,
    /// 모르는 사건 종류.
    Unknown,
}

/// 짧은 낱말 — 영숫자 · `-_.:` 만 64자까지(아니면 `None`). 영속 · 보드에 실을 수 있는 모양.
fn word(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    (!s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:[]".contains(&b))).then(|| s.to_string())
}

/// 대화 id 모양(uuid 류 — 영숫자 · `-` 만 80자까지).
fn conv_id(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    (!s.is_empty() && s.len() <= 80 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')).then(|| s.to_string())
}

/// 한 줄 → 뜻(4-4 · 실측 S2 · S5 의 모양). JSON 객체가 아니면 `None`(부르는 쪽이 `non_json` 으로 센다). 순수.
pub(crate) fn turn_event(cli: WorkerCli, line: &[u8]) -> Option<TurnEvent> {
    let v: Value = serde_json::from_slice(line).ok()?;
    let o = v.as_object()?;
    let ty = o.get("type").and_then(Value::as_str).unwrap_or("");
    Some(match cli {
        WorkerCli::Claude => match ty {
            "system" => match o.get("subtype").and_then(Value::as_str).unwrap_or("") {
                "init" => TurnEvent::Init {
                    conversation: conv_id(o.get("session_id")),
                    model: word(o.get("model")),
                    permission_mode: word(o.get("permissionMode")),
                    cli_version: word(o.get("claude_code_version")),
                    mcp: o
                        .get("mcp_servers")
                        .and_then(Value::as_array)
                        .map(|xs| {
                            xs.iter()
                                .filter_map(|m| Some((word(m.get("name"))?, word(m.get("status")).unwrap_or_default())))
                                .collect()
                        })
                        .unwrap_or_default(),
                    tools: o
                        .get("tools")
                        .and_then(Value::as_array)
                        .map(|xs| xs.iter().filter_map(|t| t.as_str().map(|s| s.chars().take(128).collect())).collect())
                        .unwrap_or_default(),
                },
                "permission_denied" => TurnEvent::Denied,
                _ => TurnEvent::Known,
            },
            "assistant" => {
                let names: Vec<String> = o
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_array)
                    .map(|cs| {
                        cs.iter()
                            .filter(|c| c.get("type").and_then(Value::as_str) == Some("tool_use"))
                            .map(|c| word(c.get("name")).unwrap_or_else(|| "tool".into()))
                            .collect()
                    })
                    .unwrap_or_default();
                match names.last() {
                    Some(last) => TurnEvent::Tools {
                        count: names.len() as u32,
                        last: last.clone(),
                    },
                    None => TurnEvent::Known,
                }
            }
            "result" => TurnEvent::End {
                ok: o.get("is_error").and_then(Value::as_bool) == Some(false)
                    && o.get("subtype").and_then(Value::as_str) == Some("success"),
                word: word(o.get("subtype")),
                conversation: conv_id(o.get("session_id")),
                denials: o.get("permission_denials").and_then(Value::as_array).map(|d| d.len() as u32).unwrap_or(0),
            },
            "user" | "rate_limit_event" | "stream_event" => TurnEvent::Known,
            _ => TurnEvent::Unknown,
        },
        WorkerCli::Codex => match ty {
            "thread.started" => TurnEvent::Init {
                conversation: conv_id(o.get("thread_id")),
                model: None,
                permission_mode: None,
                cli_version: None,
                mcp: Vec::new(),
                tools: Vec::new(),
            },
            "turn.started" | "item.started" | "item.updated" | "error" => TurnEvent::Known,
            "item.completed" => match o.get("item").and_then(|i| i.get("type")).and_then(Value::as_str).unwrap_or("") {
                t @ ("command_execution" | "file_change" | "mcp_tool_call" | "web_search") => TurnEvent::Tools {
                    count: 1,
                    last: match (t, word(o.get("item").and_then(|i| i.get("tool")))) {
                        ("mcp_tool_call", Some(tool)) => tool,
                        _ => t.to_string(),
                    },
                },
                "agent_message" | "reasoning" | "todo_list" | "error" => TurnEvent::Known,
                _ => TurnEvent::Unknown,
            },
            "turn.completed" => TurnEvent::End {
                ok: true,
                word: None,
                conversation: None,
                denials: 0,
            },
            "turn.failed" => TurnEvent::End {
                ok: false,
                word: Some("turn-failed".into()),
                conversation: None,
                denials: 0,
            },
            _ => TurnEvent::Unknown,
        },
    })
}

/// Codex stderr 의 거절 줄 → 막힌 종류 낱말(S5 · S20 · S21 — 거절은 `--json` 에 항목이 없고 stderr 에만 있다). 거절 줄이 아니면 `None`.
pub(crate) fn stderr_denial(line: &str) -> Option<&'static str> {
    let l = line.to_ascii_lowercase();
    if l.contains("writing outside of the project") {
        Some("outside-write")
    } else if l.contains("blocked by policy") {
        Some("policy")
    } else if l.contains("patch rejected") || l.contains("rejected by user approval") {
        Some("other")
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// 턴 기록(이상 입력 계약 — 4-4)
// ---------------------------------------------------------------------------

/// 한 턴 동안 모은 사실(낱말 · 수만). 서버 손의 읽기 스레드가 줄마다 [`TurnLog::feed_line`] 을 부른다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TurnLog {
    pub init_seen: bool,
    /// init 이 알린 대화 id(Codex 첫 턴은 이것이 고정 id 가 된다).
    pub conversation: Option<String>,
    /// 실효 모델(Claude init `model` — Codex `--json` 에는 없다: rollout `turn_context` · S 덤).
    pub model: Option<String>,
    pub cli_version: Option<String>,
    /// 턴 끝 사건 `(성공, 실패 낱말)` — 처음 것만.
    pub ended: Option<(bool, Option<String>)>,
    pub denials: u32,
    pub denial_kinds: Vec<&'static str>,
    pub tools: u32,
    pub last_tool: Option<String>,
    pub anomalies: TurnAnomalies,
    /// 곧바로 끝내야 할 까닭(도구 사건 전에 — 4-4): `conversation-mismatch` · `mcp-unavailable` · `effective-mismatch`.
    pub abort: Option<&'static str>,
}

/// init 확인(4-4 "init 에서 확인되는 것은 모두 확인") — 어긋나면 낱말. 순수.
fn check_init(e: &Expect, conversation: Option<&str>, permission_mode: Option<&str>, mcp: &[(String, String)], tools: &[String]) -> Result<(), &'static str> {
    if let Some(want) = e.conversation.as_deref() {
        if conversation != Some(want) {
            return Err("conversation-mismatch");
        }
    }
    if e.cli == WorkerCli::Codex && conversation.is_none() {
        return Err("conversation-mismatch");
    }
    if let Some(name) = e.mcp_server.as_deref() {
        // 연결됨(또는 아직 잇는 중)만 — 실패 · 인증 필요 · 없음은 보고할 길이 없는 턴이다.
        let ok = mcp.iter().any(|(n, s)| n == name && matches!(s.as_str(), "connected" | "pending"));
        if !ok {
            return Err("mcp-unavailable");
        }
    }
    if e.cli == WorkerCli::Claude {
        if let Some(want) = e.permission_mode {
            if permission_mode != Some(want) {
                return Err("effective-mismatch");
            }
        }
        if e.judge && matches!(permission_mode, Some("bypassPermissions" | "acceptEdits")) {
            return Err("effective-mismatch");
        }
        if let Some(allowed) = &e.builtin_tools {
            if tools.iter().any(|t| !t.starts_with("mcp__") && !allowed.contains(&t.as_str())) {
                return Err("effective-mismatch");
            }
        }
    }
    Ok(())
}

impl TurnLog {
    /// 줄 하나(또는 상한을 넘은 줄)를 접는다. 곧바로 끝내야 하면 그 낱말을 **처음 한 번** 돌려준다(서버 손이 잡을 끝낸다).
    pub(crate) fn feed(&mut self, e: &Expect, line: &Line) -> Option<&'static str> {
        let bytes = match line {
            Line::Oversized => {
                self.anomalies.oversized += 1;
                return None;
            }
            // 잘린 마지막 줄 — 버리고 센다(본문을 반쯤 해석하지 않는다).
            Line::Cut => {
                self.anomalies.truncated += 1;
                return None;
            }
            Line::Full(b) => b,
        };
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return None;
        }
        let Some(ev) = turn_event(e.cli, bytes) else {
            self.anomalies.non_json += 1;
            return None;
        };
        let before = self.abort;
        match ev {
            TurnEvent::Init {
                conversation,
                model,
                permission_mode,
                cli_version,
                mcp,
                tools,
            } => {
                // 두 번째 init 은 같은 id 여야 한다(다르면 바꿔치기 · 새 대화 — 4-4 표).
                if self.init_seen && self.conversation != conversation {
                    self.abort.get_or_insert("conversation-mismatch");
                } else if let Err(w) = check_init(e, conversation.as_deref(), permission_mode.as_deref(), &mcp, &tools) {
                    self.abort.get_or_insert(w);
                }
                if !self.init_seen {
                    self.init_seen = true;
                    self.conversation = conversation;
                    self.model = model;
                    self.cli_version = cli_version;
                }
            }
            TurnEvent::Tools { count, last } => {
                self.tools += count;
                self.last_tool = Some(last);
            }
            TurnEvent::Denied => self.denials += 1,
            TurnEvent::End {
                ok,
                word,
                conversation,
                denials,
            } => {
                // result 의 대화 id 도 고정 id 여야 한다(Claude — 있으면).
                if let (Some(c), Some(want)) = (conversation.as_deref(), e.conversation.as_deref().or(self.conversation.as_deref())) {
                    if c != want {
                        self.abort.get_or_insert("conversation-mismatch");
                    }
                }
                self.denials = self.denials.max(denials);
                if self.ended.is_none() {
                    self.ended = Some((ok, word));
                }
            }
            TurnEvent::Known => {}
            TurnEvent::Unknown => self.anomalies.unknown += 1,
        }
        if before.is_none() {
            self.abort
        } else {
            None
        }
    }

    /// stderr 한 줄(Codex 거절 줄 — 거절 수 · 종류 낱말). 본문은 남기지 않는다(꼬리는 고리 버퍼가 따로 — 사람 보기만).
    pub(crate) fn feed_stderr(&mut self, e: &Expect, line: &str) {
        if e.cli != WorkerCli::Codex {
            return;
        }
        if let Some(kind) = stderr_denial(line) {
            self.denials += 1;
            if !self.denial_kinds.contains(&kind) {
                self.denial_kinds.push(kind);
            }
        }
    }

    /// **턴 도중에 고정해도 되는 대화 id**(F4 — Codex 첫 턴의 `thread.started`, Claude 는 서버가 정한 id 그대로) — init 을 봤고 init 확인
    /// (`check_init` — resume · Claude 는 기대한 id 와 같음 · Codex 는 id 있음)을 지났고(`abort` 없음) id 모양일 때만. 고정 자체는 턴 끝과
    /// 같은 손(`Orchestration::attempt_conversation` — 처음 받은 id 만 · 다르면 대화 끊김)이 하고, 파일(그 CLI 의 대화 폴더 안 · 기록된
    /// cwd = worktree)은 판독 쪽(`progress::pin_file_open`)이 읽을 때마다 따로 검증한다 — 파일은 아직 없을 수 있다.
    pub(crate) fn early_conversation(&self) -> Option<&str> {
        if !self.init_seen || self.abort.is_some() {
            return None;
        }
        self.conversation.as_deref().filter(|c| crate::agent_sessions::uuid_shape(c))
    }

    /// 지금까지의 진행 칸(F4 — 턴 도중 공개 · 낱말 · 수만).
    pub(crate) fn progress(&self) -> TurnProgress {
        TurnProgress {
            tools: self.tools,
            denials: self.denials,
            denial_kinds: self.denial_kinds.clone(),
            last_tool: self.last_tool.clone(),
            model: self.model.clone(),
            cli_version: self.cli_version.clone(),
        }
    }
}

/// 턴 도중 진행을 알리는 간격의 하한(F4 — 바뀌었을 때 Attempt 마다 이만큼에 한 번까지).
pub(crate) const PROGRESS_EVERY_MS: u64 = 2_000;

/// **도는 턴의 진행 칸**(F4) — `TurnRecord` 의 같은 이름 칸에 그대로 들어간다(낱말 · 수만 — 도구 입력 · 출력 · 본문 · 토큰 없음). 다음 단계의
/// 실행 타임라인은 이 묶음에 칸을 더해 늘린다(서버 손 → `Orchestration::attempt_turn_progress` → 보드가 한 길).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TurnProgress {
    pub tools: u32,
    pub denials: u32,
    pub denial_kinds: Vec<&'static str>,
    /// 마지막 도구 이름(이름만).
    pub last_tool: Option<String>,
    /// 실효 모델(Claude init — Codex `--json` 에는 없다).
    pub model: Option<String>,
    pub cli_version: Option<String>,
}

/// 진행 알림의 문지기(순수 — 시각은 부르는 쪽이 준다): **바뀌었고** 마지막으로 보낸 지 [`PROGRESS_EVERY_MS`] 가 지났을 때만 보낸다(처음 바뀐 것은
/// 곧바로). 미뤄진 변화는 사라지지 않는다 — 간격이 지나 다시 물으면 그때의 값이 나간다. 턴 끝의 최종값은 이 문 밖(턴 기록 끝)이다.
#[derive(Debug, Default)]
pub(crate) struct ProgressGate {
    sent: TurnProgress,
    at: Option<u64>,
}

impl ProgressGate {
    /// 지금 보낼 진행 — 보내면 그 값과 시각을 적는다.
    pub(crate) fn due(&mut self, now_ms: u64, p: TurnProgress) -> Option<TurnProgress> {
        if p == self.sent || self.at.is_some_and(|t| now_ms.saturating_sub(t) < PROGRESS_EVERY_MS) {
            return None;
        }
        self.sent = p.clone();
        self.at = Some(now_ms);
        Some(p)
    }
}

/// 턴 도중 서버 손에 알리는 것(F4) — 턴 고리가 읽기 스레드의 기록을 보고 **기록 잠금을 놓은 뒤** 낸다(받는 쪽은 오케스트레이션 잠금만 잡는다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Pulse {
    /// 고정해도 되는 대화 id([`TurnLog::early_conversation`]) — 턴마다 한 번.
    Conversation(String),
    /// 진행 칸([`ProgressGate`] 를 지난 것).
    Progress(TurnProgress),
}

/// 프로세스 쪽 사실 — 끝 코드 · 서버가 끝낸 까닭 · 트리 종료(잡 0 · 파이프 EOF) 확인.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exit {
    pub code: Option<i64>,
    /// 서버가 잡을 끝냈다 — `stopped`(중단) · `timeout`(실행 시한) · `no-init`(시작 시한). 이상 입력으로 끝낸 것은 [`TurnLog::abort`].
    pub killed: Option<&'static str>,
    pub confirmed: bool,
}

/// 턴 결과 — `outcome` 은 `ok` · `failed` · `timeout` · `stopped` · `stop-unconfirmed`, `reason` 은 실패 낱말.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Outcome {
    pub outcome: &'static str,
    pub reason: Option<String>,
}

impl Outcome {
    fn failed(w: &str) -> Self {
        Outcome {
            outcome: "failed",
            reason: Some(w.to_string()),
        }
    }

    /// 보드 · `exit_reason` 한 줄(`turn failed:no-result` 꼴).
    pub(crate) fn label(&self) -> String {
        match &self.reason {
            Some(r) if self.outcome == "failed" => format!("turn failed:{r}"),
            Some(r) => format!("turn {} ({r})", self.outcome),
            None => format!("turn {}", self.outcome),
        }
    }
}

/// **이상 입력의 계약**(4-4 표 — 순수 · 표본 시험 `turn_outcome_anomalies`). Task 의 완료는 늘 MCP 보고가 정하고, 이것은 보드 · 조정자에게
/// 보이는 턴의 사실이다. 원칙: 애매하면 성공이 아니다.
pub(crate) fn turn_outcome(log: &TurnLog, exit: &Exit) -> Outcome {
    let inner = if exit.killed == Some("stopped") {
        Outcome {
            outcome: "stopped",
            reason: None,
        }
    } else if exit.killed == Some("timeout") {
        Outcome {
            outcome: "timeout",
            reason: None,
        }
    } else if let Some(w) = log.abort {
        Outcome::failed(w)
    } else if exit.killed == Some("no-init") || !log.init_seen {
        Outcome::failed("no-init")
    } else {
        match &log.ended {
            None => Outcome::failed("no-result"),
            Some((true, _)) if exit.code != Some(0) => Outcome::failed("exit-mismatch"),
            Some((false, _)) if exit.code == Some(0) => Outcome::failed("exit-mismatch"),
            Some((false, w)) => Outcome::failed(w.as_deref().filter(|w| *w != "success").unwrap_or("result-error")),
            Some((true, _)) => Outcome {
                outcome: "ok",
                reason: None,
            },
        }
    };
    if exit.confirmed {
        return inner;
    }
    // 트리 종료를 확인하지 못했다 — 살아 있을 수 있다(turn_may_live). 안의 결과는 사유로만.
    Outcome {
        outcome: "stop-unconfirmed",
        reason: Some(match inner.reason {
            Some(r) => format!("{}:{r}", inner.outcome),
            None => inner.outcome.to_string(),
        }),
    }
}
