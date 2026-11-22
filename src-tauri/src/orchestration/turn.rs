//! 헤드리스 턴의 순수 층 — 인자 · 환경 · 지침 파일 · stdout 판독 · 턴 결과(설계 docs/log/2026-10-16-orchestration-headless-design.md).
//!
//! - 설정 출처 통제가 늘 실린다(출시 조건). `--bare`(OAuth 를 안 읽는다) · `--dangerously-bypass-hook-trust` · `--fork-session`(새 대화 id)은
//!   어디에도 없다(시험 `worker_args_control_setting_sources`).
//! - stdout 에서는 낱말 · 수만 꺼내고 본문(모델 글 · 도구 입력 · 결과)은 버린다.
//! - 애매하면 성공이 아니다 — 이상한 줄은 세고 버리고, init · result 없음 · 종료 코드와 result 불일치 · 다른 대화 id 는 실패다.
//! - 턴 기록의 `args` 는 권한 표시 전용 — 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 없음.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::model::{TurnAnomalies, TurnArgsLabel, WorkerCli};
use super::spawn::sanitize_text;

pub(crate) const LINE_MAX: usize = 1024 * 1024;
pub(crate) const STDERR_TAIL: usize = 8 * 1024;
/// 시작 시한 — init(Codex `thread.started`)까지.
pub(crate) const START_MS: u64 = 2 * 60_000;
pub(crate) const INSTRUCTIONS_DOC_MAX: usize = 64 * 1024;
/// Codex `developer_instructions` 상한 — 명령줄 32,767자를 첫 지시 24 KiB 와 나눠 쓴다.
pub(crate) const DEVELOPER_INSTRUCTIONS_MAX: usize = 4 * 1024;

pub(crate) const CLAUDE_EDIT_TOOLS: &str = "Read,Edit,Write,Glob,Grep,Bash";
pub(crate) const CLAUDE_JUDGE_TOOLS: &str = "Read,Grep,Glob";

// ---------------------------------------------------------------------------
// 등급 · 인자
// ---------------------------------------------------------------------------

/// 쓰기형 역할은 `edit` · `full`, 판정형은 늘 `read-only`.
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

/// `Debug` 를 파생하지 않는다(프롬프트 · 설정 파일 경로). 토큰 값은 여기 없다 — Claude 는 `mcp_config` 파일 안, Codex 는 환경 변수 안.
pub(crate) struct TurnArgs<'a> {
    pub cli: WorkerCli,
    pub exe: &'a str,
    pub grade: Grade,
    /// 고정 대화 id. 없으면 첫 턴.
    pub resume: Option<&'a str>,
    /// Claude 첫 턴만 — resume 과 함께 주면 시작 오류다.
    pub session_id: Option<&'a str>,
    pub mcp_name: &'a str,
    pub mcp_tools: &'a [&'a str],
    pub mcp_config: Option<&'a str>,
    pub mcp_url: &'a str,
    pub token_env: &'a str,
    pub allowed_commands: &'a [String],
    pub read_rule: Option<&'a str>,
    pub add_dir: Option<&'a str>,
    /// Codex 첫 턴의 `-C` — resume 에는 `-C` 가 없어 프로세스 cwd 로 준다.
    pub cwd: Option<&'a str>,
    pub codex_extra: &'a [String],
    pub model_args: &'a [String],
    pub append_file: Option<&'a str>,
    pub developer_instructions: Option<&'a str>,
    /// 첫 글자가 `[` 인 지시 하나.
    pub prompt: &'a str,
}

/// 규칙 문법과 부딪히는 글자(`(` `)` `*` · 제어 문자) · 빈 값 · 200자 넘음은 `None` — 그 명령은 허용하지 않는다(좁은 쪽).
pub(crate) fn command_rule(cmd: &str) -> Option<String> {
    let c = cmd.trim();
    if c.is_empty() || c.chars().count() > 200 || c.chars().any(|ch| matches!(ch, '(' | ')' | '*') || ch.is_control()) {
        return None;
    }
    Some(format!("Bash({c}:*)"))
}

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

/// `[exe, 옵션…, "--", 프롬프트]` — 프롬프트는 늘 `--` 뒤 마지막 한 칸이다.
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
                // resume 에는 `-s` 가 없다 — 이 턴의 샌드박스는 `-c sandbox_mode` 로 준다.
                match i.grade {
                    Grade::Edit => push_all(&mut a, &["-c", "sandbox_mode='workspace-write'"]),
                    Grade::Full => a.push("--dangerously-bypass-approvals-and-sandbox".into()),
                    Grade::ReadOnly => push_all(&mut a, &["-c", "sandbox_mode='read-only'"]),
                }
            }
            if i.grade == Grade::ReadOnly && i.resume.is_none() {
                // 판정형의 cwd 는 git 저장소가 아닌 빈 폴더다 — 없으면 exec 가 시작을 거절한다.
                a.push("--skip-git-repo-check".into());
            }
            a.extend(i.codex_extra.iter().cloned());
            if i.grade == Grade::Edit {
                // 사용자 config 를 끄면 이 키도 빠져 workspace-write 가 오류 없이 read-only 로 강등된다. 네트워크는 늘 켠다.
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
        turn_minutes: None,
    }
}

/// 이 턴의 init 에서 확인할 실효 설정.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Expect {
    pub cli: WorkerCli,
    /// Codex 첫 턴은 `None` — `thread.started` 가 고정한다.
    pub conversation: Option<String>,
    pub mcp_server: Option<String>,
    pub permission_mode: Option<&'static str>,
    pub builtin_tools: Option<Vec<&'static str>>,
    pub judge: bool,
}

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

/// MSVC CRT · `CommandLineToArgvW` 가 되읽는 인용 규칙. 빈 값은 `""` 로 남아야 한다(Claude `--setting-sources ""`).
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

/// 셸 줄이 아니다 — 받는 쪽은 CLI 의 MSVC CRT 인자 파서다.
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

/// 정화 목록은 PTY 자식과 같은 `pty::scrub_env_names` 하나다(시험이 소스로 본다). 허용 목록으로 좁히지 않는다 — CLI 인증 · 프록시 ·
/// 설정 환경(`CLAUDE_CONFIG_DIR` · `CODEX_HOME` · API 키 변수)을 끊으면 CLI 가 안 선다. 환경은 같은 계정 안의 비밀 경계가 아니다.
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

/// 지침은 정화만 하고 권한을 바꾸지 않는다 — 상한은 인자 · 설정 통제다. 셋 다 비면 `None`(파일도 인자도 없다).
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

/// 읽기만 한다 — 설정 출처 통제가 이 파일을 싣지 않아 앱이 지침 파일로 옮긴다.
pub(crate) fn global_claude_md(config_dir: Option<&std::ffi::OsStr>, home: Option<PathBuf>) -> Option<PathBuf> {
    let dir = match config_dir.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => home?.join(".claude"),
    };
    Some(dir.join("CLAUDE.md"))
}

const IMPORT_DEPTH: usize = 4;
const IMPORT_FILES_MAX: usize = 32;

pub(crate) struct ProjectDoc {
    /// `"CLAUDE.md"` · `"AGENTS.md"`
    pub source: &'static str,
    pub body: String,
}

/// 저장소 지침 — `CLAUDE.md`(없거나 비면 `AGENTS.md`)와 그 안의 `@경로` 불러오기를 본문 뒤에 덧붙인다.
pub(crate) fn project_instructions(root: &Path) -> Option<ProjectDoc> {
    let (source, body) = ["CLAUDE.md", "AGENTS.md"].into_iter().find_map(|name| read_capped(&root.join(name)).map(|b| (name, b)))?;
    let Ok(base) = std::fs::canonicalize(root) else { return Some(ProjectDoc { source, body }) };
    let mut seen: HashSet<PathBuf> = std::fs::canonicalize(root.join(source)).into_iter().collect();
    let mut found: Vec<(PathBuf, String)> = Vec::new();
    let mut total = body.len();
    collect_imports(&base, &base, &import_refs(&body), 1, &mut seen, &mut found, &mut total);
    let mut out = body;
    for (path, text) in found {
        let rel = path.strip_prefix(&base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        out.push_str(&format!("\n\n--- {rel} (imported) ---\n\n"));
        out.push_str(&text);
    }
    Some(ProjectDoc { source, body: out })
}

fn collect_imports(
    base: &Path,
    dir: &Path,
    refs: &[String],
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    found: &mut Vec<(PathBuf, String)>,
    total: &mut usize,
) {
    for raw in refs {
        if found.len() >= IMPORT_FILES_MAX || *total >= INSTRUCTIONS_DOC_MAX {
            return;
        }
        let Some(path) = resolve_import(base, dir, raw) else { continue };
        if !seen.insert(path.clone()) {
            continue;
        }
        let Some(text) = read_capped(&path) else { continue };
        *total += text.len();
        let inner = if depth < IMPORT_DEPTH { import_refs(&text) } else { Vec::new() };
        let parent = path.parent().map(Path::to_path_buf).unwrap_or_else(|| base.to_path_buf());
        found.push((path, text));
        collect_imports(base, &parent, &inner, depth + 1, seen, found, total);
    }
}

/// `root` 밖은 풀지 않는다 — 저장소 글(작업자가 고칠 수 있다)이 `@` 로 계정의 다른 파일을 시스템 지침에 끌어 오는 길이 된다.
/// 판정은 canonicalize 뒤 접두사라 밖을 가리키는 심볼릭 링크 · 정션도 걸린다.
fn resolve_import(base: &Path, dir: &Path, raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim_end_matches(['.', ',', ';', ':', ')']);
    [raw, trimmed].into_iter().find_map(|cand| {
        let p = Path::new(cand);
        if cand.is_empty() || cand.starts_with('~') || p.components().any(|c| matches!(c, std::path::Component::Prefix(_) | std::path::Component::RootDir)) {
            return None;
        }
        let canon = std::fs::canonicalize(dir.join(p)).ok()?;
        (canon.starts_with(base) && canon.is_file()).then_some(canon)
    })
}

/// Claude Code 의 `@경로` — 줄 머리 또는 공백 뒤의 `@` 에 이은 공백 아닌 글자열. 펜스 블록 · 인라인 코드 안은 아니다.
fn import_refs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for line in text.lines() {
        let t = line.trim_start();
        let mark = t.chars().next().filter(|c| *c == '`' || *c == '~');
        if let Some(c) = mark {
            let n = t.chars().take_while(|x| *x == c).count();
            if n >= 3 {
                match fence {
                    None => fence = Some((c, n)),
                    Some((fc, fnn)) if fc == c && n >= fnn && t[n..].trim().is_empty() => fence = None,
                    _ => {}
                }
                continue;
            }
        }
        if fence.is_some() {
            continue;
        }
        let b = line.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'`' {
                let run = b[i..].iter().take_while(|x| **x == b'`').count();
                // 같은 길이의 닫는 줄이 있을 때만 코드다 — 없으면 글자 그대로
                let close = (i + run..b.len()).find(|&j| b[j] == b'`' && b[j..].iter().take_while(|x| **x == b'`').count() == run && b[j - 1] != b'`');
                i = match close {
                    Some(j) => j + run,
                    None => i + run,
                };
                continue;
            }
            if b[i] == b'@' && (i == 0 || b[i - 1].is_ascii_whitespace()) {
                let end = line[i + 1..].find(char::is_whitespace).map_or(line.len(), |e| i + 1 + e);
                if end > i + 1 {
                    out.push(line[i + 1..end].to_owned());
                }
                i = end;
                continue;
            }
            i += 1;
        }
    }
    out
}

fn read_capped(p: &Path) -> Option<String> {
    use std::io::Read;
    let f = std::fs::File::open(p).ok()?;
    let mut buf = Vec::new();
    f.take(INSTRUCTIONS_DOC_MAX as u64 + 4).read_to_end(&mut buf).ok()?;
    let s = String::from_utf8_lossy(&buf).into_owned();
    (!s.trim().is_empty()).then_some(s)
}

/// 턴 자원 파일 — `Drop` 이 지우므로 턴 끝 확인(트리 0 · 파이프 EOF) 전에는 떨어뜨리지 않는다(시험 `turn_instructions_file_is_reclaimed`).
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Line {
    Full(Vec<u8>),
    Oversized,
    Cut,
}

/// 상한을 넘은 줄은 그 자리에서 버린다 — 메모리를 키우지 않는다.
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

    /// EOF — 줄 중간에서 끝났으면 `true`.
    pub(crate) fn finish(&mut self) -> bool {
        let cut = !self.dropping && !self.buf.is_empty();
        self.buf.clear();
        self.dropping = false;
        cut
    }
}

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

/// 낱말 · 수만 — 본문을 담는 칸을 더하지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TurnEvent {
    Init {
        conversation: Option<String>,
        model: Option<String>,
        permission_mode: Option<String>,
        cli_version: Option<String>,
        mcp: Vec<(String, String)>,
        tools: Vec<String>,
    },
    Tools { count: u32, last: String },
    Denied,
    End {
        ok: bool,
        word: Option<String>,
        conversation: Option<String>,
        denials: u32,
    },
    Known,
    Unknown,
}

/// 영속 · 보드에 실을 수 있는 모양만 통과시킨다.
fn word(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    (!s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:[]".contains(&b))).then(|| s.to_string())
}

fn conv_id(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    (!s.is_empty() && s.len() <= 80 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')).then(|| s.to_string())
}

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

/// Codex 의 거절은 `--json` 에 항목이 없고 stderr 에만 있다.
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
// 턴 기록
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TurnLog {
    pub init_seen: bool,
    pub conversation: Option<String>,
    /// Claude init 에서만 온다 — Codex `--json` 에는 없다.
    pub model: Option<String>,
    pub cli_version: Option<String>,
    /// 처음 것만.
    pub ended: Option<(bool, Option<String>)>,
    pub denials: u32,
    pub denial_kinds: Vec<&'static str>,
    pub tools: u32,
    pub last_tool: Option<String>,
    pub anomalies: TurnAnomalies,
    /// 곧바로 끝내야 할 까닭.
    pub abort: Option<&'static str>,
}

/// init 에서 확인되는 것은 모두 확인한다.
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
    /// 곧바로 끝내야 하면 그 낱말을 처음 한 번만 돌려준다.
    pub(crate) fn feed(&mut self, e: &Expect, line: &Line) -> Option<&'static str> {
        let bytes = match line {
            Line::Oversized => {
                self.anomalies.oversized += 1;
                return None;
            }
            // 본문을 반쯤 해석하지 않는다.
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
                // 두 번째 init 은 같은 id 여야 한다 — 다르면 바꿔치기 · 새 대화다.
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

    /// 본문은 남기지 않는다.
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

    /// 턴 도중에 고정해도 되는 대화 id — init 확인을 지났을 때만. 대화 파일은 아직 없을 수 있어, 판독 쪽(`progress::pin_file_open`)이
    /// 읽을 때마다 따로 검증한다.
    pub(crate) fn early_conversation(&self) -> Option<&str> {
        if !self.init_seen || self.abort.is_some() {
            return None;
        }
        self.conversation.as_deref().filter(|c| crate::agent_sessions::uuid_shape(c))
    }

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

pub(crate) const PROGRESS_EVERY_MS: u64 = 2_000;

/// `TurnRecord` 의 같은 이름 칸에 그대로 들어간다 — 낱말 · 수만(도구 입력 · 출력 · 본문 · 토큰 없음).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TurnProgress {
    pub tools: u32,
    pub denials: u32,
    pub denial_kinds: Vec<&'static str>,
    pub last_tool: Option<String>,
    pub model: Option<String>,
    pub cli_version: Option<String>,
}

/// 미뤄진 변화는 사라지지 않는다 — 간격이 지나 다시 물으면 그때의 값이 나간다. 턴 끝의 최종값은 이 문 밖이다.
#[derive(Debug, Default)]
pub(crate) struct ProgressGate {
    sent: TurnProgress,
    at: Option<u64>,
}

impl ProgressGate {
    pub(crate) fn due(&mut self, now_ms: u64, p: TurnProgress) -> Option<TurnProgress> {
        if p == self.sent || self.at.is_some_and(|t| now_ms.saturating_sub(t) < PROGRESS_EVERY_MS) {
            return None;
        }
        self.sent = p.clone();
        self.at = Some(now_ms);
        Some(p)
    }
}

/// 턴 고리가 기록 잠금을 놓은 뒤 낸다 — 받는 쪽은 오케스트레이션 잠금만 잡는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Pulse {
    /// 턴마다 한 번.
    Conversation(String),
    Progress(TurnProgress),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exit {
    pub code: Option<i64>,
    /// 서버가 잡을 끝낸 까닭(`stopped` · `timeout` · `no-init`). 이상 입력으로 끝낸 것은 [`TurnLog::abort`].
    pub killed: Option<&'static str>,
    /// 트리 종료(잡 0 · 파이프 EOF) 확인.
    pub confirmed: bool,
}

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

    pub(crate) fn label(&self) -> String {
        match &self.reason {
            Some(r) if self.outcome == "failed" => format!("turn failed:{r}"),
            Some(r) => format!("turn {} ({r})", self.outcome),
            None => format!("turn {}", self.outcome),
        }
    }
}

/// 애매하면 성공이 아니다(시험 `turn_outcome_anomalies`). Task 의 완료는 늘 MCP 보고가 정하고, 이것은 턴의 사실일 뿐이다.
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
    // 트리 종료를 확인하지 못했다 — 살아 있을 수 있다. 안의 결과는 사유로만.
    Outcome {
        outcome: "stop-unconfirmed",
        reason: Some(match inner.reason {
            Some(r) => format!("{}:{r}", inner.outcome),
            None => inner.outcome.to_string(),
        }),
    }
}
