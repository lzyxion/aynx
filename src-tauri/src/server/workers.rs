//! 세션 서버의 작업자 손 — `orchestration::spawn::WorkerLauncher` 의 서버 구현. 헤드리스 턴(작업자 · 해결자 · 검토자) 하나를 스레드 하나에서 끝까지 본다.
//!
//! 불변식:
//! - 서버가 GUI 요청 없이 띄우는 것은 헤드리스 턴과 수락 전 검증뿐이다 — 둘의 OS 몸은 `server::os::spawn_in_job` 하나다
//!   (시험 `server_spawns_only_turns_and_verify`). 턴은 세션 · PTY 가 아니다.
//! - 서버는 작업자에게 키도 표준 입력도 보내지 않는다(stdin = EOF) — 지시는 실행 인자뿐이다. 이 파일에 PTY 쓰기는 없다.
//! - 턴은 효과 직전 확인(`Orchestration::turn_preflight`)을 지나야 선다 — 어긋나면 이 턴은 서지 않는다.
//! - 토큰은 로그에 남기지 않는다(로그 줄은 Run · Attempt id · 턴 번호 · 단계 이름 · 오류 사유뿐).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use super::log;
use super::os::{self, JobProc};
use crate::orchestration::spawn::{self, LaunchJob, Prompt, WorkerLauncher};
use crate::orchestration::turn::{self, TurnArgs, TurnFiles};
use crate::orchestration::{AttemptKind, Orchestration, SpawnVerdict, TurnArgsLabel, TurnRecord, WorkerCli};

const CONFIRM_WAIT: Duration = Duration::from_secs(5);

struct Rt {
    exited: bool,
    turn: Option<Arc<JobProc>>,
    stop_flag: Arc<AtomicBool>,
    /// 트리 종료 확인 뒤 표에서 칸을 지울 때만 떨어져야 한다 — 그 전에 회수하면 산 턴의 파일이 사라진다.
    resources: Option<TurnResources>,
}

impl Rt {
    fn new() -> Self {
        Rt {
            exited: false,
            turn: None,
            stop_flag: Arc::default(),
            resources: None,
        }
    }
}

/// 턴 자원(턴 MCP 파일 claim · 지침 턴 파일) — 세션이 아니라 턴의 것이다. 다음 턴은 새 파일을 쓰므로 지워도 resume 이 깨지지 않는다.
struct TurnResources {
    claim: String,
    _files: TurnFiles,
}

impl Drop for TurnResources {
    fn drop(&mut self) {
        crate::agent_mcp::release_stream(&self.claim);
    }
}

type Table = Arc<Mutex<HashMap<String, Rt>>>;

pub(crate) struct ServerLauncher {
    orch: Weak<Orchestration>,
    table: Table,
}

impl ServerLauncher {
    pub(crate) fn new(orch: &Arc<Orchestration>) -> Arc<Self> {
        Arc::new(ServerLauncher {
            orch: Arc::downgrade(orch),
            table: Arc::default(),
        })
    }
}

fn table(t: &Table) -> std::sync::MutexGuard<'_, HashMap<String, Rt>> {
    t.lock().unwrap_or_else(|e| e.into_inner())
}

/// 생성 실패의 회수 한 벌(claim · 런타임 칸 · 작업자 토큰) — 실패 · 패닉 어느 길로 떨어져도 돈다. 턴이 선 순간 `disarm` 해야
/// 산 턴의 자원을 거두지 않는다.
struct LaunchGuard {
    orch: Weak<Orchestration>,
    table: Table,
    run_id: String,
    attempt_id: String,
    claim: String,
    why: String,
    armed: bool,
}

impl LaunchGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let removed = crate::agent_mcp::release_stream(&self.claim);
        table(&self.table).remove(&self.attempt_id);
        let why = if self.why.is_empty() { "spawn: interrupted".to_string() } else { self.why.clone() };
        log::line(format!(
            "orchestration — turn of {} ({}) not started: {why} ({removed} turn config file(s) removed)",
            self.attempt_id, self.run_id
        ));
        if let Some(o) = self.orch.upgrade() {
            o.attempt_spawn_failed(&self.run_id, &self.attempt_id, &why);
        }
    }
}

impl WorkerLauncher for ServerLauncher {
    fn launch(&self, job: LaunchJob) {
        let orch = self.orch.clone();
        let t = Arc::clone(&self.table);
        std::thread::spawn(move || {
            let Some(o) = orch.upgrade() else { return };
            let mut guard = LaunchGuard {
                orch: orch.clone(),
                table: Arc::clone(&t),
                run_id: job.run_id.clone(),
                attempt_id: job.attempt_id.clone(),
                claim: job.stream.clone(),
                why: String::new(),
                armed: true,
            };
            if let Err(why) = launch_blocking(&o, &t, job, &mut guard) {
                guard.why = why;
            }
        });
    }

    fn stop(&self, run_id: &str, attempt_id: &str) {
        let exited = {
            let mut g = table(&self.table);
            let Some(rt) = g.get_mut(attempt_id) else {
                // 생성 중 — 생성 끝의 `attempt_spawned` 가 `Reap` 을 돌려 회수한다
                return;
            };
            rt.stop_flag.store(true, Ordering::SeqCst);
            if let Some(p) = &rt.turn {
                p.terminate();
            }
            rt.exited
        };
        log::line(format!("orchestration — stopping the turn of {attempt_id} ({run_id})"));
        // 턴이 이미 끝난 뒤의 중단 — 턴 고리가 다시 부르지 않으므로 여기서 확인을 다시 건다
        if exited {
            confirm_later(self.orch.clone(), Arc::clone(&self.table), run_id.to_string(), attempt_id.to_string());
        }
    }

    fn tree_gone(&self, attempt_id: &str) -> bool {
        let mut g = table(&self.table);
        let gone = g.get(attempt_id).is_none_or(gone_now);
        if gone {
            g.remove(attempt_id);
        }
        gone
    }

    fn exited(&self, attempt_id: &str) -> bool {
        table(&self.table).get(attempt_id).is_some_and(|r| r.exited)
    }
}

fn gone_now(rt: &Rt) -> bool {
    match &rt.turn {
        Some(p) => {
            p.terminate();
            tree_gone_with(Some(p.active()))
        }
        None => true,
    }
}

/// 잡 조회 실패(`Some(None)`)는 "끝남" 이 아니다 — `stop-unconfirmed` 로 남아야 한다.
pub(crate) fn tree_gone_with(job: Option<Option<u32>>) -> bool {
    match job {
        Some(active) => active == Some(0),
        None => true,
    }
}

fn confirm_blocking(orch: &Weak<Orchestration>, t: &Table, run_id: &str, attempt_id: &str) {
    let deadline = Instant::now() + CONFIRM_WAIT;
    let confirmed = loop {
        let gone = table(t).get(attempt_id).is_none_or(gone_now);
        if gone || Instant::now() >= deadline {
            break gone;
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    if confirmed {
        table(t).remove(attempt_id);
    }
    if let Some(o) = orch.upgrade() {
        o.attempt_process_exited(run_id, attempt_id, confirmed, None);
    }
}

fn confirm_later(orch: Weak<Orchestration>, t: Table, run_id: String, attempt_id: String) {
    std::thread::spawn(move || confirm_blocking(&orch, &t, &run_id, &attempt_id));
}

/// 개발 빌드 전용 가짜 작업자(`scripts/dev/fake-agent-headless.mjs`) — 릴리스 빌드에는 이 길이 없다(시험 `fake_agent_is_debug_only`).
#[cfg(debug_assertions)]
fn dev_fake_agent() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("AYNX_DEV_FAKE_AGENT")?);
    (p.is_absolute() && p.is_file()).then_some(p)
}

#[cfg(not(debug_assertions))]
fn dev_fake_agent() -> Option<PathBuf> {
    None
}

/// 영속 파일에 남는 영어 낱말이다.
fn why(stage: &str, e: impl std::fmt::Display) -> String {
    format!("{stage}: {e}")
}

fn launch_blocking(o: &Arc<Orchestration>, t: &Table, job: LaunchJob, guard: &mut LaunchGuard) -> Result<(), String> {
    if job.review.is_some() {
        return launch_reviewer(o, t, job, guard);
    }
    launch_writer(o, t, job, guard)
}

/// PATH 의 `.exe` 만 — `.cmd` 는 cmd.exe 가 프롬프트를 다시 해석한다.
fn find_cli(cli: WorkerCli) -> Result<(String, Option<PathBuf>), String> {
    let fake = dev_fake_agent();
    let exe_name = if fake.is_some() { "node" } else { cli.as_str() };
    let exe = spawn::find_exe(exe_name, std::env::var_os("PATH").as_deref())
        .ok_or_else(|| why("cli-not-found", format!("{exe_name} was not found on PATH (an .exe is required)")))?;
    Ok((exe.to_string_lossy().into_owned(), fake))
}

struct McpBits {
    name: &'static str,
    url: String,
    token_env: &'static str,
    config: Option<String>,
    add: Vec<(String, String)>,
    codex_extra: Vec<String>,
}

fn mcp_bits(job: &LaunchJob) -> Result<McpBits, String> {
    let port = super::hub::signal_port().ok_or_else(|| why("mcp-unavailable", "the session server has no MCP port"))?;
    let name = crate::instance::mcp_name(crate::instance::DEV);
    let url = format!("{}/mcp", crate::tile_env::base_url(port));
    let token_env = crate::tile_env::MCP_TOKEN_ENV;
    let mut add: Vec<(String, String)> = Vec::new();
    let mut codex_extra: Vec<String> = Vec::new();
    let config = match job.cli {
        WorkerCli::Claude => Some(
            crate::agent_mcp::write_worker_config(&job.attempt_id, job.turn.n, port, &job.token, &job.stream)
                .ok_or_else(|| why("mcp-config", "could not write the turn MCP config"))?,
        ),
        WorkerCli::Codex => {
            add.push((token_env.to_string(), job.token.clone()));
            // 판정형은 read-only 라 샌드박스 백엔드를 `unelevated` 로 고정하지 않는다(스토어판 pwsh 0xC0000142 · 쓰기형은 인자 표가 `windows.sandbox` 를 싣는다)
            let launch = crate::codex_launch::codex_launch_env();
            crate::codex_launch::apply_tile_path(&mut add, launch.as_ref());
            codex_extra = crate::codex_launch::codex_extra_args(launch.as_ref());
            None
        }
    };
    Ok(McpBits {
        name,
        url,
        token_env,
        config,
        add,
        codex_extra,
    })
}

/// `(경로, 본문 해시)` — 파일 경로는 서버 시작 때 쓸어 내는 `sweep_turn_leftovers` 와 맞아야 한다.
fn write_instructions(run_dir: &Path, attempt_id: &str, n: u32, body: Option<String>, files: &mut TurnFiles) -> Result<(Option<String>, Option<String>), String> {
    let Some(body) = body else { return Ok((None, None)) };
    let dir = run_dir.join("turns");
    std::fs::create_dir_all(&dir).map_err(|e| why("instructions", e))?;
    let path = dir.join(format!("{attempt_id}-t{n}.md"));
    files.0.push(path.clone());
    crate::fs_atomic::write_atomic(&path, body.as_bytes()).map_err(|e| why("instructions", e))?;
    let sha = crate::orchestration::verify::sha256_hex(body.as_bytes());
    Ok((Some(path.to_string_lossy().replace('\\', "/")), Some(sha)))
}

fn global_claude_md() -> Option<String> {
    turn::global_claude_md(std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(), dirs::home_dir()).and_then(|p| read_capped(&p))
}

fn launch_writer(o: &Arc<Orchestration>, t: &Table, mut job: LaunchJob, guard: &mut LaunchGuard) -> Result<(), String> {
    let cli = job.cli;
    let n = job.turn.n;
    let resume = job.turn.resume.clone();
    let created = match &job.reuse {
        Some(r) => {
            if !Path::new(&r.path).is_dir() {
                return Err(why("worktree-failed", "the worktree is gone"));
            }
            crate::orchestration::worktree::Created {
                path: r.path.clone(),
                branch: r.branch.clone(),
                base_commit: r.base_commit.clone(),
            }
        }
        None => {
            let name = spawn::worktree_name(&job.task.id, &job.attempt_id);
            crate::orchestration::worktree::create_blocking(
                Path::new(&job.repo),
                &job.worktree_dir,
                &name,
                &job.base,
                &job.run_id,
                crate::worktree::sidecar_path().as_deref(),
                &crate::orchestration::worktree::empty_hooks_dir(),
            )
            .map_err(|e| why(e.code, e.message))?
        }
    };
    if resume.is_none() && !o.attempt_worktree(&job.run_id, &job.attempt_id, &created.path, &created.branch, &created.base_commit) {
        return Err("stopped before the worker started".into());
    }
    if let Some(seed) = &job.seed {
        crate::orchestration::seed_conflict(Path::new(&created.path), seed).map_err(|e| why(e.code, e.message))?;
    }
    let run_dir = crate::orchestration::store_dir()
        .map(|d| d.join(&job.run_id))
        .ok_or_else(|| why("prompt", "no data folder"))?;
    let (prompt_arg, read_rule) = match &job.turn.text {
        Some(text) => (spawn::resume_instruction(&job.attempt_id, n, text), None),
        None => {
            let prompt = spawn::plan_prompt_with(&job.attempt_id, &job.task, &run_dir, job.seed.as_ref().map(|s| s.prompt.as_str()));
            let read_rule = match &prompt {
                Prompt::File { file, body, read_dir, .. } => {
                    std::fs::create_dir_all(read_dir).map_err(|e| why("prompt", e))?;
                    crate::fs_atomic::write_atomic(file, body.as_bytes()).map_err(|e| why("prompt", e))?;
                    match cli {
                        WorkerCli::Claude => spawn::claude_read_rule(read_dir),
                        WorkerCli::Codex => None,
                    }
                }
                Prompt::Inline(_) => None,
            };
            (prompt.arg().to_string(), read_rule)
        }
    };
    let (exe, fake) = find_cli(cli)?;
    // 효과 직전 확인 — 어긋나면 이 턴은 서지 않는다(파일 · 프로세스보다 먼저)
    if let Some((role, minutes)) = o.turn_preflight(&job.run_id, &job.attempt_id).map_err(|e| why(e.code, e.message))? {
        job.turn.role = role;
        job.turn.turn_minutes = minutes;
    }
    // 그 턴의 작업자 토큰만 싣는다(전역 · 조정자 토큰 없음)
    let mcp = mcp_bits(&job)?;
    let role = &job.turn.role;
    let mut files = TurnFiles::default();
    let (append_file, instructions_sha) = match cli {
        WorkerCli::Claude => {
            let global = global_claude_md();
            let local = read_capped(&Path::new(&created.path).join("CLAUDE.md"));
            let mut docs: Vec<(&str, &str)> = Vec::new();
            if let Some(g) = global.as_deref() {
                docs.push(("User instructions (~/.claude/CLAUDE.md)", g));
            }
            if let Some(l) = local.as_deref() {
                docs.push(("Project instructions (CLAUDE.md in your worktree)", l));
            }
            let body = turn::instructions_text(spawn::WORKER_FIXED_INSTRUCTIONS, role.instructions.as_deref(), &docs);
            write_instructions(&run_dir, &job.attempt_id, n, body, &mut files)?
        }
        WorkerCli::Codex => (None, role.instructions.as_deref().map(|r| crate::orchestration::verify::sha256_hex(r.as_bytes()))),
    };
    let model_args = spawn::turn_model_args(cli, role.model.as_deref(), role.effort.as_deref());
    let args = TurnArgs {
        cli,
        exe: &exe,
        grade: role.grade,
        resume: resume.as_deref(),
        session_id: if resume.is_none() { job.session_id.as_deref() } else { None },
        mcp_name: mcp.name,
        mcp_tools: spawn::WORKER_ALLOWED_TOOLS,
        mcp_config: mcp.config.as_deref(),
        mcp_url: &mcp.url,
        token_env: mcp.token_env,
        allowed_commands: &role.allowed_commands,
        read_rule: read_rule.as_deref(),
        add_dir: None,
        cwd: Some(&created.path),
        codex_extra: &mcp.codex_extra,
        model_args: &model_args,
        append_file: append_file.as_deref(),
        developer_instructions: if cli == WorkerCli::Codex { role.instructions.as_deref() } else { None },
        prompt: &prompt_arg,
    };
    let mut argv = turn::turn_argv(&args);
    let expect = turn::expect_for(&args);
    let mut label = turn::args_label(&args, instructions_sha);
    // 아래 `run_ms` 와 같은 값이어야 한다
    label.turn_minutes = Some(job.turn.turn_minutes.max(1));
    if let Some(script) = &fake {
        argv.insert(1, script.to_string_lossy().into_owned());
        log::line(format!("orchestration — turn {n} of {} uses the dev fake agent (debug build only)", job.attempt_id));
    }
    let env = turn::headless_env(
        std::env::vars_os().map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())),
        &mcp.add,
    );
    let spec = TurnSpec {
        exe,
        cmdline: turn::quote_argv(&argv),
        cwd: PathBuf::from(&created.path),
        env,
        expect,
        start_ms: turn::START_MS,
        run_ms: u64::from(job.turn.turn_minutes.max(1)) * 60_000,
    };
    start_turn(o, t, job, guard, spec, label, files)
}

fn launch_reviewer(o: &Arc<Orchestration>, t: &Table, mut job: LaunchJob, guard: &mut LaunchGuard) -> Result<(), String> {
    let cli = job.cli;
    let Some(rv) = job.review.clone() else {
        return Err(why("review", "no review target"));
    };
    let run_dir = crate::orchestration::store_dir()
        .map(|d| d.join(&job.run_id))
        .ok_or_else(|| why("review-place", "no data folder"))?;
    let (place, cwd) = crate::orchestration::review_place(
        Path::new(&job.repo),
        &job.worktree_dir,
        &run_dir,
        &job.run_id,
        &job.task.id,
        &job.attempt_id,
        &rv.commit,
        o.sidecar().as_deref(),
    )
    .map_err(|e| why(e.code, e.message))?;
    if !o.attempt_review_place(&job.run_id, &job.attempt_id, &place, &cwd) {
        return Err("stopped before the reviewer started".into());
    }
    // 추적 symlink 가 자리 밖이면 띄우지 않는다(자리는 남는다 — 사람이 본다)
    crate::orchestration::review_links_ok(Path::new(&place)).map_err(|e| why(e.code, e.message))?;
    let prompt = spawn::reviewer_prompt(&job.attempt_id, &job.task.id, &rv.commit, rv.base.as_deref(), &place);
    let (exe, fake) = find_cli(cli)?;
    if let Some((role, minutes)) = o.turn_preflight(&job.run_id, &job.attempt_id).map_err(|e| why(e.code, e.message))? {
        job.turn.role = role;
        job.turn.turn_minutes = minutes;
    }
    let mcp = mcp_bits(&job)?;
    // 보고 커밋의 CLAUDE.md 는 싣지 않는다 — 작업자가 고칠 수 있는 글을 검토자의 시스템 지침으로 올리지 않는다
    let role = &job.turn.role;
    let mut files = TurnFiles::default();
    let (append_file, instructions_sha) = match cli {
        WorkerCli::Claude => {
            let global = global_claude_md();
            let docs: Vec<(&str, &str)> = global.as_deref().map(|g| ("User instructions (~/.claude/CLAUDE.md)", g)).into_iter().collect();
            let body = turn::instructions_text(spawn::REVIEWER_FIXED_INSTRUCTIONS, role.instructions.as_deref(), &docs);
            write_instructions(&run_dir, &job.attempt_id, 1, body, &mut files)?
        }
        WorkerCli::Codex => (None, role.instructions.as_deref().map(|r| crate::orchestration::verify::sha256_hex(r.as_bytes()))),
    };
    let model_args = spawn::turn_model_args(cli, role.model.as_deref(), role.effort.as_deref());
    let args = TurnArgs {
        cli,
        exe: &exe,
        // 판정형은 역할의 권한 칸과 무관하게 읽기 전용(시험 `judge_kind_is_read_only_whatever_permission`)
        grade: turn::Grade::ReadOnly,
        resume: None,
        session_id: job.session_id.as_deref(),
        mcp_name: mcp.name,
        mcp_tools: spawn::REVIEWER_ALLOWED_TOOLS,
        mcp_config: mcp.config.as_deref(),
        mcp_url: &mcp.url,
        token_env: mcp.token_env,
        allowed_commands: &[],
        read_rule: None,
        add_dir: Some(&place),
        cwd: Some(&cwd),
        codex_extra: &mcp.codex_extra,
        model_args: &model_args,
        append_file: append_file.as_deref(),
        developer_instructions: if cli == WorkerCli::Codex { role.instructions.as_deref() } else { None },
        prompt: &prompt,
    };
    let mut argv = turn::turn_argv(&args);
    let expect = turn::expect_for(&args);
    let mut label = turn::args_label(&args, instructions_sha);
    // 아래 `run_ms` 와 같은 값이어야 한다
    label.turn_minutes = Some(job.turn.turn_minutes.max(1));
    if let Some(script) = &fake {
        argv.insert(1, script.to_string_lossy().into_owned());
        log::line(format!("orchestration — reviewer {} uses the dev fake agent (debug build only)", job.attempt_id));
    }
    let env = turn::headless_env(
        std::env::vars_os().map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())),
        &mcp.add,
    );
    let spec = TurnSpec {
        exe,
        cmdline: turn::quote_argv(&argv),
        cwd: PathBuf::from(&cwd),
        env,
        expect,
        start_ms: turn::START_MS,
        run_ms: u64::from(job.turn.turn_minutes.max(1)) * 60_000,
    };
    start_turn(o, t, job, guard, spec, label, files)
}

fn read_capped(p: &Path) -> Option<String> {
    let f = std::fs::File::open(p).ok()?;
    let mut buf = Vec::new();
    f.take(turn::INSTRUCTIONS_DOC_MAX as u64 + 4).read_to_end(&mut buf).ok()?;
    let s = String::from_utf8_lossy(&buf).into_owned();
    (!s.trim().is_empty()).then_some(s)
}

/// `Debug` 를 파생하지 않는다 — 명령 줄에 프롬프트, 환경에 토큰이 있다.
pub(crate) struct TurnSpec {
    pub exe: String,
    pub cmdline: String,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub expect: turn::Expect,
    /// init 까지의 시한
    pub start_ms: u64,
    pub run_ms: u64,
}

pub(crate) struct TurnRun {
    pub outcome: turn::Outcome,
    pub log: turn::TurnLog,
    pub exit_code: Option<i64>,
    pub confirmed: bool,
    /// 메모리만 — 영속 · 로그 · 조정자에 싣지 않는다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub stderr_tail: Vec<u8>,
}

/// 파이프마다 자기 스레드로 끝까지 비운다 — 한쪽이 차면 자식이 멈춘다.
fn drain(
    mut f: std::fs::File,
    log: Arc<Mutex<turn::TurnLog>>,
    mut line: impl FnMut(&mut turn::TurnLog, turn::Line) + Send + 'static,
    mut raw: impl FnMut(&[u8]) + Send + 'static,
    done: mpsc::Sender<()>,
) {
    std::thread::spawn(move || {
        let mut split = turn::LineSplitter::new(turn::LINE_MAX);
        let mut lines = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match f.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    raw(&buf[..n]);
                    split.push(&buf[..n], &mut lines);
                    if !lines.is_empty() {
                        let mut l = log.lock().unwrap_or_else(|e| e.into_inner());
                        for x in lines.drain(..) {
                            line(&mut l, x);
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break, // 깨진 파이프 = 쓰는 쪽이 모두 닫혔다(EOF)
            }
        }
        if split.finish() {
            line(&mut log.lock().unwrap_or_else(|e| e.into_inner()), turn::Line::Cut);
        }
        let _ = done.send(());
    });
}

/// 헤드리스 턴 하나를 돌린다(블로킹). stdout 본문은 버리고 낱말 · 수만 남긴다. `on_pulse` 는 기록 잠금 밖에서 부른다.
pub(crate) fn run_turn_blocking(
    spec: TurnSpec,
    stop: &AtomicBool,
    on_started: impl FnOnce(&Arc<JobProc>),
    mut on_pulse: impl FnMut(turn::Pulse),
) -> Result<(TurnRun, Arc<JobProc>), (&'static str, String)> {
    let mut proc = os::spawn_in_job(&spec.exe, &spec.cmdline, &spec.cwd, &spec.env, os::Stdin::Eof)?;
    let started = Instant::now();
    let log = Arc::new(Mutex::new(turn::TurnLog::default()));
    let ring = Arc::new(Mutex::new(turn::TailRing::new(turn::STDERR_TAIL)));
    let expect = Arc::new(spec.expect);
    let (tx, rx) = mpsc::channel::<()>();
    let mut pipes = 0;
    if let Some(out) = proc.stdout.take() {
        let e = Arc::clone(&expect);
        drain(
            out,
            Arc::clone(&log),
            move |l, line| {
                l.feed(&e, &line);
            },
            |_| {},
            tx.clone(),
        );
        pipes += 1;
    }
    if let Some(err) = proc.stderr.take() {
        let (e, ring) = (Arc::clone(&expect), Arc::clone(&ring));
        drain(
            err,
            Arc::clone(&log),
            move |l, line| {
                if let turn::Line::Full(b) = line {
                    l.feed_stderr(&e, &String::from_utf8_lossy(&b));
                }
            },
            move |chunk| ring.lock().unwrap_or_else(|e| e.into_inner()).push(chunk),
            tx.clone(),
        );
        pipes += 1;
    }
    drop(tx);
    let proc = Arc::new(proc);
    on_started(&proc);
    let mut exit_code = None;
    let mut conversation_sent = false;
    let mut gate = turn::ProgressGate::default();
    let killed: Option<&'static str> = loop {
        if stop.load(Ordering::SeqCst) {
            break Some("stopped");
        }
        let elapsed = started.elapsed().as_millis() as u64;
        let (aborted, init_seen, early, progress) = {
            let l = log.lock().unwrap_or_else(|e| e.into_inner());
            let early = if conversation_sent { None } else { l.early_conversation().map(str::to_owned) };
            (l.abort.is_some(), l.init_seen, early, l.init_seen.then(|| l.progress()))
        };
        if aborted {
            break None; // init 이 어긋났다 — 도구 사건 전에 끝낸다
        }
        if let Some(c) = early {
            conversation_sent = true;
            on_pulse(turn::Pulse::Conversation(c));
        }
        if let Some(p) = progress.and_then(|p| gate.due(elapsed, p)) {
            on_pulse(turn::Pulse::Progress(p));
        }
        if !init_seen && elapsed >= spec.start_ms {
            break Some("no-init");
        }
        if elapsed >= spec.run_ms {
            break Some("timeout");
        }
        if let Some(c) = proc.wait(50) {
            exit_code = Some(c);
            break None;
        }
    };
    // 맏이가 끝났어도 잡 안의 손자 · 고아를 끝낸다 — 그들이 파이프를 쥐고 있으면 EOF 가 서지 않는다
    proc.terminate();
    if exit_code.is_none() {
        exit_code = proc.wait(1_000);
    }
    let until = Instant::now() + CONFIRM_WAIT;
    let mut gone = false;
    while Instant::now() < until {
        if proc.active() == Some(0) {
            gone = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut eof = 0;
    while eof < pipes {
        let left = until.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left.max(Duration::from_millis(1))) {
            Ok(()) => eof += 1,
            Err(_) => break,
        }
    }
    let confirmed = gone && eof == pipes;
    let log = log.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let outcome = turn::turn_outcome(
        &log,
        &turn::Exit {
            code: exit_code,
            killed,
            confirmed,
        },
    );
    let stderr_tail = ring.lock().unwrap_or_else(|e| e.into_inner()).bytes().to_vec();
    Ok((
        TurnRun {
            outcome,
            log,
            exit_code,
            confirmed,
            stderr_tail,
        },
        proc,
    ))
}

/// 런타임 칸을 생성보다 먼저 만든다 — 중단이 생성 중에 와도 깃발이 서야 한다. 종료가 확인되지 않으면 칸(잡 · 자원)을 쥔 채
/// `stop-unconfirmed` 로 두고 서버 시계가 다시 본다.
#[allow(clippy::too_many_arguments)]
fn start_turn(
    o: &Arc<Orchestration>,
    t: &Table,
    job: LaunchJob,
    guard: &mut LaunchGuard,
    spec: TurnSpec,
    label: TurnArgsLabel,
    files: TurnFiles,
) -> Result<(), String> {
    let rt = Rt::new();
    let stop = Arc::clone(&rt.stop_flag);
    table(t).insert(job.attempt_id.clone(), rt);
    let mut files = Some(files);
    let (run_id, attempt_id, n) = (job.run_id.clone(), job.attempt_id.clone(), job.turn.n);
    let kind = if job.review.is_some() { AttemptKind::Judge } else { AttemptKind::Write };
    let result = run_turn_blocking(spec, &stop, |proc| {
        if let Some(rt) = table(t).get_mut(&attempt_id) {
            rt.turn = Some(Arc::clone(proc));
            rt.resources = Some(TurnResources {
                claim: job.stream.clone(),
                _files: files.take().unwrap_or_default(),
            });
        }
        if o.attempt_spawned(&run_id, &attempt_id, Some(proc.pid)) == SpawnVerdict::Reap {
            log::line(format!("orchestration — turn {n} of {attempt_id} started after a stop — reaping"));
            if let Some(rt) = table(t).get_mut(&attempt_id) {
                rt.stop_flag.store(true, Ordering::SeqCst);
            }
            proc.terminate();
        }
        o.attempt_turn(&run_id, &attempt_id, running_record(n, &label), false);
        log::line(format!(
            "orchestration — {} {attempt_id} of {run_id} turn {n} started (headless {} · pid {})",
            kind.as_str(),
            job.cli.as_str(),
            proc.pid
        ));
    }, |pulse| match pulse {
        turn::Pulse::Conversation(c) => o.attempt_conversation(&run_id, &attempt_id, &c),
        turn::Pulse::Progress(p) => o.attempt_turn_progress(&run_id, &attempt_id, n, &p),
    });
    let (run, _proc) = match result {
        Ok(r) => r,
        Err((word, msg)) => return Err(why("spawn", format!("{word}: {msg}"))),
    };
    guard.disarm();
    let rec = ended_record(n, &label, &run);
    o.attempt_turn(&run_id, &attempt_id, rec, true);
    // 도중에 이미 고정됐으면 같은 값 확인만이다 — init 확인에 걸려 도중 고정이 없던 턴의 id 는 여기서 선다
    if let Some(conv) = run.log.conversation.as_deref() {
        o.attempt_conversation(&run_id, &attempt_id, conv);
    }
    log::line(format!(
        "orchestration — {attempt_id} of {run_id} turn {n} ended ({}{})",
        run.outcome.label(),
        if run.confirmed { "" } else { " · tree not confirmed gone" }
    ));
    {
        let mut g = table(t);
        if run.confirmed {
            g.remove(&attempt_id);
        } else if let Some(rt) = g.get_mut(&attempt_id) {
            rt.exited = true;
        }
    }
    o.attempt_process_exited(&run_id, &attempt_id, run.confirmed, run.exit_code.map(|c| c as u32));
    Ok(())
}

/// 시각은 오케스트레이션 시계가 찍는다.
fn running_record(n: u32, label: &TurnArgsLabel) -> TurnRecord {
    TurnRecord {
        n,
        started_at: 0,
        ended_at: None,
        outcome: "running".into(),
        reason: None,
        exit_code: None,
        denials: 0,
        denial_kinds: Vec::new(),
        tools: 0,
        last_tool: None,
        cli_version: None,
        model: None,
        args: label.clone(),
        anomalies: Default::default(),
    }
}

/// 낱말 · 수만 — 본문 · stderr 꼬리는 싣지 않는다.
fn ended_record(n: u32, label: &TurnArgsLabel, run: &TurnRun) -> TurnRecord {
    TurnRecord {
        outcome: run.outcome.outcome.into(),
        reason: run.outcome.reason.clone(),
        exit_code: run.exit_code,
        denials: run.log.denials,
        denial_kinds: run.log.denial_kinds.iter().map(|k| k.to_string()).collect(),
        tools: run.log.tools,
        last_tool: run.log.last_tool.clone(),
        cli_version: run.log.cli_version.clone(),
        model: run.log.model.clone(),
        anomalies: run.log.anomalies,
        ..running_record(n, label)
    }
}

/// 서버 시작 때 한 번만 — 산 턴이 없을 때만 남은 턴 자원을 지워도 된다.
pub(crate) fn sweep_turn_leftovers() -> usize {
    let mut n = crate::agent_mcp::sweep_worker_configs();
    if let Some(root) = crate::orchestration::store_dir() {
        if let Ok(dirs) = std::fs::read_dir(&root) {
            for d in dirs.flatten() {
                let turns = d.path().join("turns");
                if let Ok(files) = std::fs::read_dir(&turns) {
                    for f in files.flatten() {
                        if f.file_type().is_ok_and(|t| t.is_file()) && std::fs::remove_file(f.path()).is_ok() {
                            n += 1;
                        }
                    }
                }
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_gone_needs_job_empty() {
        assert!(tree_gone_with(Some(Some(0))));
        assert!(!tree_gone_with(Some(Some(1))), "잡에 남았다");
        assert!(!tree_gone_with(Some(None)), "잡을 못 물었다 — 미상");
        assert!(tree_gone_with(None), "턴 전(잡 없음)");
    }

    #[derive(Default)]
    struct Capture(Mutex<Vec<crate::orchestration::spawn::LaunchJob>>);

    impl WorkerLauncher for Capture {
        fn launch(&self, job: LaunchJob) {
            self.0.lock().unwrap().push(job);
        }
        fn stop(&self, _run_id: &str, _attempt_id: &str) {}
        fn tree_gone(&self, _attempt_id: &str) -> bool {
            true
        }
    }

    #[test]
    fn launch_guard_releases_claim_and_token() {
        let o = Arc::new(Orchestration::new(None, Arc::new(|_: &str, _: serde_json::Value| {}), None));
        let cap = Arc::new(Capture::default());
        o.set_launcher(cap.clone());
        let run = o.test_spawn_one();
        let job = cap.0.lock().unwrap().pop().unwrap();
        let name = format!("orch-{}-t1.json", job.attempt_id);
        assert!(crate::agent_mcp::claim(&job.stream, &name));
        assert!(crate::agent_mcp::claimed_files().contains(&name));
        assert!(o.resolve(Some(&format!("Bearer {}", job.token))).is_some());
        let t: Table = Arc::default();
        table(&t).insert(job.attempt_id.clone(), Rt::new());
        {
            let _guard = LaunchGuard {
                orch: Arc::downgrade(&o),
                table: Arc::clone(&t),
                run_id: run.clone(),
                attempt_id: job.attempt_id.clone(),
                claim: job.stream.clone(),
                why: "spawn: boom".into(),
                armed: true,
            };
        }
        assert!(!crate::agent_mcp::claimed_files().contains(&name), "claim 을 놓았다");
        assert!(table(&t).is_empty(), "런타임 칸을 지웠다");
        assert!(o.resolve(Some(&format!("Bearer {}", job.token))).is_none(), "토큰을 거뒀다");
        let d = o.run_detail(&run).unwrap();
        assert_eq!(d["attempts"][0]["state"], "exited");
        assert!(d["attempts"][0]["exitReason"].as_str().unwrap().contains("boom"));
        assert!(crate::agent_mcp::claim(&job.stream, &name));
        {
            let mut g = LaunchGuard {
                orch: Arc::downgrade(&o),
                table: Arc::clone(&t),
                run_id: run,
                attempt_id: job.attempt_id.clone(),
                claim: job.stream.clone(),
                why: String::new(),
                armed: true,
            };
            g.disarm();
        }
        assert!(crate::agent_mcp::claimed_files().contains(&name), "턴 자원이 맡는다");
        crate::agent_mcp::release_stream(&job.stream);
    }
}
