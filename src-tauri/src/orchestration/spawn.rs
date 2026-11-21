//! 작업자 띄우기의 순수 층 — 첫 지시 · 이어지는 지시 · 띄우는 손([`WorkerLauncher`]) · 한 턴의 계획([`TurnPlan`]).
//! - **셸을 쓰지 않는다** — 셸 없는 프로세스 하나에 인자 배열 그대로(시험 `first_instruction_passed_as_argv_not_shell_line`).
//! - **프롬프트 첫 글자는 늘 `[`** — Claude 의 `/…`(슬래시 명령) · Codex 의 `!…`(셸 직행)을 막는다.
//! - 인자 순서 = **옵션 전부 → `--` → 프롬프트 하나** — Claude 의 여러 값 옵션이 프롬프트를 삼킨다.
//! - 사용자 추가 인자(`[ai.args]`)는 붙이지 않는다(권한 · MCP 인자와 충돌). 전역 MCP 토큰도 싣지 않는다 — 그 턴의 작업자 토큰만, 값은 인자에 없다.
//! - 역할 칸은 자유 인자가 아니다 — 정해진 넷(`model` · `effort` · 권한 등급 · 지침 파일)만 인자가 된다(`turn::turn_argv`).

use std::path::{Path, PathBuf};

use super::model::{Task, WorkerCli};

/// Windows 명령줄 한도(32767자)를 넘으면 spawn 이 즉시 실패한다 — 다른 인자 몫 8 KiB 를 남긴다.
pub(crate) const PROMPT_ARG_MAX: usize = 24 * 1024;

/// 작업자가 미리 허용받는 MCP 도구 — Claude `--allowedTools` · Codex `approval_mode` 가 이 목록 하나로 짓는다.
pub(crate) const WORKER_ALLOWED_TOOLS: &[&str] = &["get_task", "commit_changes", "report_done"];

// ---------------------------------------------------------------------------
// 띄우는 손
// ---------------------------------------------------------------------------

/// 지침 본문을 담으므로 `Debug` 를 파생하지 않는다.
#[derive(Clone)]
pub(crate) struct TurnPlan {
    pub n: u32,
    /// 이어지는 턴의 고정 대화 id. 없으면 첫 턴.
    pub resume: Option<String>,
    /// 머리줄 없이 — [`resume_instruction`] 이 붙인다.
    pub text: Option<String>,
    pub role: super::roles::TurnRole,
    pub turn_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Base {
    Main,
    Commit(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reuse {
    pub path: String,
    pub branch: String,
    /// 원래 기준 커밋 — diff 의 base 가 Task 의 처음 기준이 되게.
    pub base_commit: String,
}

/// `old` = 그때의 통합 머리. `prompt` 는 첫 지시에 덧붙일 해결 절.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolveSeed {
    pub old: String,
    pub conflict_commit: String,
    pub prompt: String,
}

/// **`Debug` 를 파생하지 않는다**(그 턴의 작업자 토큰 · 지침).
#[derive(Clone)]
pub(crate) struct LaunchJob {
    pub run_id: String,
    pub attempt_id: String,
    pub task: Task,
    pub cli: WorkerCli,
    pub repo: String,
    pub worktree_dir: String,
    pub base: Base,
    pub reuse: Option<Reuse>,
    /// **그 턴의** 작업자 토큰 — Claude 는 턴 MCP 파일에만, Codex 는 그 턴 프로세스의 환경에만.
    pub token: String,
    /// 턴 MCP 파일의 주인 열쇠 — 세션 id 가 아니다.
    pub stream: String,
    /// Claude 의 첫 턴 `--session-id`. Codex 는 `None`(첫 턴 `thread.started` 가 고정한다).
    pub session_id: Option<String>,
    pub seed: Option<ResolveSeed>,
    pub review: Option<ReviewJob>,
    pub turn: TurnPlan,
}

/// `agent_mcp::claim` 의 열쇠 — 세션 표에는 없다.
pub(crate) fn turn_claim_key(attempt_id: &str, n: u32) -> String {
    format!("{}-t{n}", worker_stream(attempt_id))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewJob {
    pub report_id: String,
    pub commit: String,
    pub base: Option<String>,
}

/// 이 손은 **오케스트레이션 잠금 밖에서** 불린다.
pub(crate) trait WorkerLauncher: Send + Sync {
    fn launch(&self, job: LaunchJob);
    /// 아직 생성 중이면 생성 끝에서 회수한다.
    fn stop(&self, run_id: &str, attempt_id: &str);
    fn tree_gone(&self, attempt_id: &str) -> bool;
    /// 끝난 뒤의 중단은 다시 불리지 않으므로 시계가 본다.
    fn exited(&self, _attempt_id: &str) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// 첫 지시
// ---------------------------------------------------------------------------

/// 첫 글자는 늘 `[`.
pub(crate) fn header(attempt_id: &str, task_id: &str) -> String {
    format!("[Aynx · worker {attempt_id} · Task {task_id}]")
}

/// ask-ai 와 같은 뜻의 정화.
pub(crate) fn sanitize_text(s: &str) -> String {
    let s = s.replace("\r\n", "\n").replace('\r', "\n");
    s.chars()
        .filter(|&c| c == '\n' || c == '\t' || !(c.is_control()))
        .collect()
}

pub(crate) fn task_body(task: &Task) -> String {
    let mut out = String::new();
    out.push_str(
        "You are a worker agent that Aynx started for one task of an orchestration run. \
A coordinator AI defined the task below and a person supervises the run.\n\
- Start with the get_task tool. Work only inside this worktree (your current folder). It is a separate git worktree on its own branch — not a security sandbox.\n\
- When you are done, commit with the commit_changes tool (the app runs git for you — selection \"all\" or a list of files; you need no write access to .git), then call the report_done tool once with outcome success or failure.\n\
- ",
    );
    out.push_str(WORKER_HEADLESS_RULE);
    out.push_str("\n\n");
    out.push_str("# Task: ");
    out.push_str(&sanitize_text(&task.title));
    out.push_str("\n\n## Goal\n");
    out.push_str(&sanitize_text(&task.goal));
    if !task.scope.trim().is_empty() {
        out.push_str("\n\n## Scope (what you may change)\n");
        out.push_str(&sanitize_text(&task.scope));
    }
    if !task.done_when.trim().is_empty() {
        out.push_str("\n\n## Done when\n");
        out.push_str(&sanitize_text(&task.done_when));
    }
    out.push('\n');
    out
}

/// **첫 글자는 늘 `[`**.
pub(crate) fn first_instruction(attempt_id: &str, task_id: &str, body: &str) -> String {
    let mut s = header(attempt_id, task_id);
    s.push('\n');
    s.push_str(body);
    s
}

/// 첫 지시와 지침 턴 파일에 함께 싣는다.
pub(crate) const WORKER_HEADLESS_RULE: &str = "You run headless — nobody can answer a permission prompt. If a tool or command you need is denied, keep your changes in place (do not revert them), then call report_done with outcome blocked and say exactly what you need (the command, network access, or the folder). You will be resumed in this same conversation once it is allowed.";

/// 지침 턴 파일의 머리 — 사람의 역할 지침은 이 뒤에 붙고 대신하지 못한다.
pub(crate) const WORKER_FIXED_INSTRUCTIONS: &str = "# Aynx — worker role\n\nYou are a worker that Aynx started headless for one task of an orchestration run. \
Work only in your worktree, commit with commit_changes and finish every turn by calling report_done (success, failure — or blocked when something you need is denied). \
You run headless — nobody can answer a permission prompt. If a tool or command you need is denied, keep your changes in place (do not revert them), then call report_done with outcome blocked and say exactly what you need.";

/// 첫 글자는 늘 `[`.
pub(crate) fn resume_header(attempt_id: &str, n: u32) -> String {
    format!("[Aynx · coordinator → worker {attempt_id} · turn {n}]")
}

/// **첫 글자는 늘 `[`**. 본문 상한은 부르는 쪽(`send_prompt` — `text-too-long`)이 이미 봤다.
pub(crate) fn resume_instruction(attempt_id: &str, n: u32, text: &str) -> String {
    let mut s = resume_header(attempt_id, n);
    s.push('\n');
    s.push_str(&sanitize_text(text));
    s.push_str("\n\n(When you are done, commit with commit_changes and call report_done again — success, failure or blocked.)");
    s
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Prompt {
    Inline(String),
    /// `file` 에 `body` 를 쓰고 `prompt` 만 인자로 — Claude 는 `read_dir` 읽기를 미리 허용한다.
    File { prompt: String, file: PathBuf, body: String, read_dir: PathBuf },
}

impl Prompt {
    pub(crate) fn arg(&self) -> &str {
        match self {
            Prompt::Inline(p) | Prompt::File { prompt: p, .. } => p,
        }
    }
}

#[cfg(test)]
pub(crate) fn plan_prompt(attempt_id: &str, task: &Task, run_dir: &Path) -> Prompt {
    plan_prompt_with(attempt_id, task, run_dir, None)
}

pub(crate) fn plan_prompt_with(attempt_id: &str, task: &Task, run_dir: &Path, extra: Option<&str>) -> Prompt {
    let mut body = task_body(task);
    if let Some(x) = extra {
        body.push_str(&sanitize_text(x));
    }
    let inline = first_instruction(attempt_id, &task.id, &body);
    if inline.len() <= PROMPT_ARG_MAX {
        return Prompt::Inline(inline);
    }
    let file = run_dir.join(format!("{}.md", task.id));
    let short = format!(
        "Your task specification is long, so it is in a file. Read the file {} first and follow it exactly.\n",
        file.display().to_string().replace('\\', "/")
    );
    Prompt::File {
        prompt: first_instruction(attempt_id, &task.id, &short),
        file,
        body: first_instruction(attempt_id, &task.id, &body),
        read_dir: run_dir.to_path_buf(),
    }
}

/// `C:\a\b` → `Read(//c/a/b/**)` — Claude 가 받는 형식은 `//` + POSIX 드라이브 경로다. 규칙 문법과 부딪히는 글자가 있으면 `None`.
pub(crate) fn claude_read_rule(dir: &Path) -> Option<String> {
    let s = dir.to_str()?.replace('\\', "/");
    if s.chars().any(|c| matches!(c, '(' | ')' | '*') || c.is_control()) {
        return None;
    }
    let posix = match s.as_bytes() {
        [d, b':', b'/', ..] if d.is_ascii_alphabetic() => format!("//{}{}", (*d as char).to_ascii_lowercase(), &s[2..]),
        [b'/', ..] => format!("/{s}"),
        _ => return None,
    };
    Some(format!("Read({}/**)", posix.trim_end_matches('/')))
}

// ---------------------------------------------------------------------------
// 검토자
// ---------------------------------------------------------------------------

/// `tools.rs` 의 `REVIEWER_TOOLS` 와 같다(시험).
pub(crate) const REVIEWER_ALLOWED_TOOLS: &[&str] = &["get_task", "get_diff", "report_review"];

/// Claude 검토자의 내장 도구 — **읽기만**(Bash · Edit · Write · WebFetch 없음).
pub(crate) const REVIEWER_CLAUDE_TOOLS: &str = "Read,Grep,Glob";

/// 첫 글자는 늘 `[`.
pub(crate) fn reviewer_header(attempt_id: &str, task_id: &str) -> String {
    format!("[Aynx · reviewer {attempt_id} · Task {task_id}]")
}

/// Task 명세 · 보고 본문은 싣지 않는다(`get_task` 로 읽는다) — 명세 파일을 cwd 밖에 두면 Claude 는 `--permission-prompts none` 이라 읽지 못한다.
pub(crate) fn reviewer_prompt(attempt_id: &str, task_id: &str, commit: &str, base: Option<&str>, place: &str) -> String {
    let place = place.replace('\\', "/");
    let mut s = reviewer_header(attempt_id, task_id);
    s.push('\n');
    s.push_str(&format!(
        "You are a reviewer agent that Aynx started to review one worker's report in an orchestration run. \
This is a role-based supplementary review that a person and a coordinator AI read — not an independent guarantee.\n\
- You review the reported commit {commit} against the task's base {base} — the task's own change, not the integration result.\n\
- That commit is checked out read-only at {place} (a detached git worktree). Your current folder is an empty folder; read the code at that path.\n\
- You can only read. Do not try to edit files, commit or run anything that changes state.\n\
- Start with the get_task tool (the task, the worker's report and its changed files), read the change with get_diff (the file list, then each file's patch page by page — never claim you read a truncated diff in full), then call report_review exactly once: verdict pass or changes-requested, a short summary and findings (at most 20 short items).\n\
- You run headless — nobody can answer a permission prompt. If you cannot read what you need, call report_review with verdict changes-requested and say in a finding what you could not read — never end without report_review.\n",
        base = base.unwrap_or("(unknown)"),
    ));
    sanitize_text(&s)
}

/// 지침 턴 파일의 머리 — 사람의 역할 지침은 이 뒤에 붙고 대신하지 못한다.
pub(crate) const REVIEWER_FIXED_INSTRUCTIONS: &str = "# Aynx — reviewer role\n\nYou are a read-only reviewer that Aynx started headless. \
You can only read; report your verdict with report_review exactly once.";

/// 보드에 보일 검토자의 고정 인자(토큰 · 경로 · 프롬프트 없음) — `turn::turn_argv` 의 판정형 줄과 맞춘다.
pub(crate) fn reviewer_args_label(cli: WorkerCli) -> String {
    match cli {
        WorkerCli::Claude => format!(
            "claude -p --output-format stream-json --setting-sources \"\" --tools {REVIEWER_CLAUDE_TOOLS} --settings {{disableAllHooks}} --permission-prompts none --strict-mcp-config (reviewer · headless)"
        ),
        WorkerCli::Codex => {
            "codex -a never exec --json -s read-only --ignore-user-config --ignore-rules --disable plugins --disable hooks --skip-git-repo-check (reviewer · headless)".into()
        }
    }
}

/// 개발 빌드의 덮기(`dev` = `(Claude 모델, Codex 강도)`)가 역할 값을 이긴다. 어긋난 값은 그 칸을 버린다(인자에 싣지 않는다).
pub(crate) fn role_model_args(cli: WorkerCli, model: Option<&str>, effort: Option<&str>, dev: (Option<&str>, Option<&str>)) -> Vec<String> {
    let dev_ok = |v: &&str| !v.is_empty() && v.len() <= 40 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b));
    let model_ok = |v: &&str| !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._:[]".contains(&b));
    let mut out = Vec::new();
    match cli {
        WorkerCli::Claude => {
            if let Some(m) = dev.0.filter(dev_ok).or(model.filter(model_ok)) {
                out.extend(["--model".to_owned(), m.to_owned()]);
            }
            if let Some(e) = effort.filter(|e| matches!(*e, "low" | "medium" | "high" | "xhigh" | "max")) {
                out.extend(["--effort".to_owned(), e.to_owned()]);
            }
        }
        WorkerCli::Codex => {
            if let Some(m) = model.filter(model_ok) {
                out.extend(["-m".to_owned(), m.to_owned()]);
            }
            let e = dev.1.filter(dev_ok).or(effort.filter(|e| matches!(*e, "low" | "medium" | "high" | "xhigh")));
            if let Some(e) = e {
                out.extend(["-c".to_owned(), format!("model_reasoning_effort={e}")]);
            }
        }
    }
    out
}

/// **개발 빌드 전용** 모델 덮기 — **릴리스 빌드에는 이 길이 없다**(시험 `dev_model_override_is_debug_only`).
#[cfg(debug_assertions)]
pub(crate) fn dev_model_override() -> (Option<String>, Option<String>) {
    let var = |k: &str| std::env::var(k).ok();
    (var("AYNX_DEV_AGENT_MODEL"), var("AYNX_DEV_CODEX_EFFORT"))
}

/// 릴리스 빌드 — 모델 덮기 길은 없다.
#[cfg(not(debug_assertions))]
pub(crate) fn dev_model_override() -> (Option<String>, Option<String>) {
    (None, None)
}

pub(crate) fn turn_model_args(cli: WorkerCli, model: Option<&str>, effort: Option<&str>) -> Vec<String> {
    let (m, e) = dev_model_override();
    role_model_args(cli, model, effort, (m.as_deref(), e.as_deref()))
}

pub(crate) fn new_uuid() -> Option<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).ok()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Some(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

/// 세션이 아니다 — [`turn_claim_key`] 의 바탕.
pub(crate) fn worker_stream(attempt_id: &str) -> String {
    format!("orch-{}", attempt_id.trim_start_matches("att-"))
}

/// `worktree::valid_name` 을 지나야 한다.
pub(crate) fn worktree_name(task_id: &str, attempt_id: &str) -> String {
    let t: String = task_id.trim_start_matches("task-").chars().take(8).collect();
    let a: String = attempt_id.trim_start_matches("att-").chars().take(8).collect();
    format!("orch-{t}-{a}")
}

/// Windows 는 **`.exe` 만** — `.cmd` · `.bat` 은 cmd.exe 가 명령줄을 다시 해석해 프롬프트 글자가 주입 통로가 된다.
pub(crate) fn find_exe(name: &str, path: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let path = path?;
    for dir in std::env::split_paths(path) {
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            continue;
        }
        #[cfg(windows)]
        let cand = dir.join(format!("{name}.exe"));
        #[cfg(not(windows))]
        let cand = dir.join(name);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}
