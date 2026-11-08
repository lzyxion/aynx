//! **세션 서버의 작업자 손**(설계 C-3 · C-7 — G 3단계 · 헤드리스 설계 4-1 ~ 4-5 · 4-7 — 3차 3a) — `orchestration::spawn::WorkerLauncher` 의
//! 서버 구현. 조정자의 `spawn_worker` · `send_prompt` 가 잠금 안에서 턴을 예약한 뒤 여기 [`ServerLauncher::launch`] 가 **스레드 하나**에서
//! 그 턴 하나를 끝까지 본다:
//!
//! - **작업자 · 해결자**([`launch_writer`]): (첫 턴) worktree(`orchestration::worktree::create_blocking` — Git 훅 끔 · Run 의 자리 안) · 충돌
//!   자리 · 첫 지시(인자 또는 Run 폴더의 `task-<id>.md`) / (이어지는 턴) 그 Attempt 의 worktree · resume 지시 → 실행 파일(PATH 의 `.exe` 만) →
//!   **효과 직전 확인**(`Orchestration::turn_preflight` — 맡기기 · 신원 · 역할) → 턴 MCP 파일(그 턴의 작업자 토큰) → 지침 턴 파일(고정 쓰기형
//!   문장 + 역할 지침 + 전역 · worktree CLAUDE.md) → 인자(`turn::turn_argv` — 역할의 등급 · 허용 명령 · 모델 · 강도) → [`run_turn_blocking`].
//! - **검토자**([`launch_reviewer`]): 검토 자리 → 빈 cwd → 짧은 고정 지시 → 효과 직전 확인 → 턴 MCP 파일 → 지침 턴 파일 → 판정형 고정 인자
//!   (역할의 모델 · 강도 · 지침만 더한다 — 권한은 늘 읽기 전용) → [`run_turn_blocking`].
//!
//! [`run_turn_blocking`]: `os::spawn_in_job`(파이프 둘 동시 배출 · 표준 입력 즉시 EOF · 창 없음 · **생성과 동시에 Job** · `SPAWN_LOCK` 아래 ·
//! 공용 환경 정화) → stdout 줄마다 낱말 · 수만(`turn::TurnLog` — init 이 어긋나면 도구 사건 전에 잡을 끝낸다 · resume 은 **같은 대화 id**
//! 여야 한다 · init 이 확인을 지나면 그 자리에서 대화를 고정 — F4) · 시작 시한 · 실행 시한(맡기기 `turn_minutes`) → 잡 0 + EOF 확인 → `turn::turn_outcome` → 턴 자원(턴 MCP 파일 · 지침 파일)
//! 회수 → `attempt_process_exited`(`idle` · `reported` · `exited` · `stopped` · `stop-unconfirmed`).
//!
//! 어느 단계든 실패하면 `attempt_spawn_failed`(첫 턴 = 끝 상태 · 이어지는 턴 = `idle` 로 — 아무것도 전달되지 않았다). 중단이 생성 중에 오면
//! 프로세스가 선 순간 회수한다(`attempt_spawned` → `Reap`).
//!
//! 불변식:
//! - 서버가 GUI 요청 없이 띄우는 것은 **헤드리스 턴과 수락 전 검증뿐**이다 — 턴(작업자 · 해결자 · 검토자 — 이 파일의 [`run_turn_blocking`] ·
//!   세션 · PTY 아님)과 검증(`orchestration/verify.rs`). 둘의 OS 몸은 `server::os::spawn_in_job` 하나다(시험 `server_spawns_only_turns_and_verify`).
//! - 서버는 작업자에게 **키도 표준 입력도 보내지 않는다**(stdin = NUL) — 지시는 실행 인자뿐이다. 이 파일에 PTY 쓰기는 없다.
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

/// 끝난 뒤 트리가 사라지기를 기다리는 상한.
const CONFIRM_WAIT: Duration = Duration::from_secs(5);

/// Attempt 하나(지금 턴)의 런타임 — 메모리만.
struct Rt {
    /// 턴 프로세스가 끝났다(턴 고리가 끝을 봤다).
    exited: bool,
    /// 지금 턴의 잡 프로세스. 트리 판정 · 중단은 이 잡으로 한다.
    turn: Option<Arc<JobProc>>,
    /// 지금 턴의 중단 깃발(턴 고리가 본다 — `stopped` 로 끝낸다).
    stop_flag: Arc<AtomicBool>,
    /// 턴 자원(턴 MCP 파일의 주인 표시 · 지침 턴 파일) — 이 칸이 떨어질 때(= 트리 종료 확인 뒤 표에서 지울 때) 회수된다.
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

/// **턴 자원**(헤드리스 설계 4-5 · D11 — 세션이 아니라 턴의 것): 턴 MCP 파일의 claim 열쇠(`agent_mcp::release_stream` 이 그 주인이 쥔
/// 파일을 지운다) · 지침 턴 파일. `Drop` 이 거둔다 — 런타임 칸이 표에서 떨어지는 순간(트리 종료 확인 뒤)에만 떨어진다. 다음 턴은 새 파일을
/// 쓰므로 이전 턴의 파일을 지워도 resume 이 깨지지 않는다.
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

/// 서버의 작업자 손.
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

/// **생성 실패의 회수 한 벌**(리뷰 F13) — 턴 MCP 파일 · claim(턴이 서기 전이라 턴 자원이 아직 없다) · 런타임 칸 · 그 턴의 작업자 토큰
/// (`attempt_spawn_failed`). 턴 프로세스가 선 순간 [`LaunchGuard::disarm`] — 그 뒤로는 턴 자원이 파일 · claim 을, 종료 확인이 토큰을 맡는다.
/// 실패 · 패닉 어느 길로 떨어져도 돈다.
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
            // `guard` 가 여기서 떨어진다 — 실패면 회수, 성공이면(턴이 섰다) 아무 일 없음.
        });
    }

    fn stop(&self, run_id: &str, attempt_id: &str) {
        let exited = {
            let mut g = table(&self.table);
            let Some(rt) = g.get_mut(attempt_id) else {
                // 아직 프로세스가 없다(생성 중) — 생성 끝의 `attempt_spawned` 가 `Reap` 을 돌려 회수한다.
                return;
            };
            rt.stop_flag.store(true, Ordering::SeqCst);
            if let Some(p) = &rt.turn {
                // 잡 하나가 턴 트리 전부다(턴 고리가 끝을 보고 확인한다).
                p.terminate();
            }
            rt.exited
        };
        log::line(format!("orchestration — stopping the turn of {attempt_id} ({run_id})"));
        // 턴이 이미 끝난 뒤의 중단(`stop-unconfirmed` → 사람의 [중단]) — 턴 고리가 다시 부르지 않으므로 여기서 확인을 다시 건다.
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

/// 턴의 잡이 비었나(못 물으면 비었다고 보지 않는다). 잡이 없으면(턴 전) 빈 것이다.
fn gone_now(rt: &Rt) -> bool {
    match &rt.turn {
        Some(p) => {
            p.terminate();
            tree_gone_with(Some(p.active()))
        }
        None => true,
    }
}

/// 트리 판정(순수 — 시험이 끼운다): `job` = 잡이 있으면 `Some(활성 수 · 못 물으면 None)`. 잡 조회 실패는 "끝남" 이 아니다(4-3 —
/// `stop-unconfirmed`).
pub(crate) fn tree_gone_with(job: Option<Option<u32>>) -> bool {
    match job {
        Some(active) => active == Some(0),
        None => true,
    }
}

/// 트리가 사라졌는지 [`CONFIRM_WAIT`] 까지 보고 알린다 — 확인되면 런타임 칸을 지운다(턴 자원 회수). 확인되지 않으면 Attempt 는
/// `stop-unconfirmed`(살아 있을 수 있음)로 남고 서버 시계가 다시 본다.
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

/// **개발 빌드 전용** — `AYNX_DEV_FAKE_AGENT=<node 스크립트 절대 경로>` 면 작업자 · 검토자 CLI 대신 그 스크립트를 node 로 띄운다(모델을
/// 부르지 않고 끝에서 끝까지 — 3a: 스크립트는 stdout 에 Claude stream-json · Codex `--json` 꼴의 **JSONL 사건**을 내고 우리 MCP 를 부른다 —
/// `scripts/dev/fake-agent-headless.mjs`). **릴리스 빌드에는 이 길이 없다**(아래 스텁 · 시험 `fake_agent_is_debug_only`).
#[cfg(debug_assertions)]
fn dev_fake_agent() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("AYNX_DEV_FAKE_AGENT")?);
    (p.is_absolute() && p.is_file()).then_some(p)
}

/// 릴리스 빌드 — 가짜 작업자 길은 없다.
#[cfg(not(debug_assertions))]
fn dev_fake_agent() -> Option<PathBuf> {
    None
}

/// 짧은 실패 사유(영어 낱말 — 보드 · 영속 파일).
fn why(stage: &str, e: impl std::fmt::Display) -> String {
    format!("{stage}: {e}")
}

fn launch_blocking(o: &Arc<Orchestration>, t: &Table, job: LaunchJob, guard: &mut LaunchGuard) -> Result<(), String> {
    if job.review.is_some() {
        return launch_reviewer(o, t, job, guard);
    }
    launch_writer(o, t, job, guard)
}

/// 실행 파일(PATH 의 `.exe` 만 — `.cmd` 는 cmd.exe 가 프롬프트를 다시 해석한다). 개발 빌드의 가짜 작업자면 node.
fn find_cli(cli: WorkerCli) -> Result<(String, Option<PathBuf>), String> {
    let fake = dev_fake_agent();
    let exe_name = if fake.is_some() { "node" } else { cli.as_str() };
    let exe = spawn::find_exe(exe_name, std::env::var_os("PATH").as_deref())
        .ok_or_else(|| why("cli-not-found", format!("{exe_name} was not found on PATH (an .exe is required)")))?;
    Ok((exe.to_string_lossy().into_owned(), fake))
}

/// 턴 MCP 재료 — Claude 는 그 턴의 작업자 토큰이 든 파일(`orch-<att>-t<n>.json` — 턴 자원), Codex 는 그 턴 프로세스의 환경 변수.
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
            // Codex 실행 환경(Windows — 스토어 pwsh 를 뺀 PATH · `prefer_mxc` · 자식 PATH 복원). 판정형은 read-only 라 샌드박스 백엔드를
            // `unelevated` 로 고정하지 않는다(스토어판 pwsh 0xC0000142 — 1차 함정 · 쓰기형은 인자 표가 `windows.sandbox` 를 싣는다).
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

/// 지침 턴 파일을 쓴다(Claude — E19 · S17 · S18): `<Run 폴더>/turns/<att>-t<n>.md`. `(경로, 본문 해시)` — 본문이 없으면 `None`. 파일은 턴
/// 자원이다(턴 끝 확인 뒤 지운다).
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

/// 전역 CLAUDE.md(사용자 — 읽기만).
fn global_claude_md() -> Option<String> {
    turn::global_claude_md(std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(), dirs::home_dir()).and_then(|p| read_capped(&p))
}

/// **작업자 · 해결자 턴 하나**(쓰기형 — 3a). 첫 턴은 worktree 를 만들고, 이어지는 턴은 그 Attempt 의 worktree 에서 같은 대화를 resume 한다.
fn launch_writer(o: &Arc<Orchestration>, t: &Table, mut job: LaunchJob, guard: &mut LaunchGuard) -> Result<(), String> {
    let cli = job.cli;
    let n = job.turn.n;
    let resume = job.turn.resume.clone();
    // 1. worktree — Run 의 자리 안 · Git 훅 끔 · 새 브랜치. 이어 쓰기(`reuseWorktreeOf`) · 이어지는 턴이면 있는 것을 쓴다.
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
    // 1b. 충돌 해결 자리(통합 설계 3b — 첫 턴만).
    if let Some(seed) = &job.seed {
        crate::orchestration::seed_conflict(Path::new(&created.path), seed).map_err(|e| why(e.code, e.message))?;
    }
    // 2. 지시 — 첫 턴은 Task 명세(인자 ≤ 24 KiB 또는 Run 폴더의 명세 파일), 이어지는 턴은 머리줄 + 조정자의 글.
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
    // 3. 실행 파일.
    let (exe, fake) = find_cli(cli)?;
    // 4. **효과 직전 확인**(2-4 · 2-6) — 맡기기 · 받아들인 판 · 신원(Run 사본과도) · 역할(CLI · 종류 사본). 어긋나면 이 턴은 서지 않는다.
    if let Some((role, minutes)) = o.turn_preflight(&job.run_id, &job.attempt_id).map_err(|e| why(e.code, e.message))? {
        job.turn.role = role;
        job.turn.turn_minutes = minutes;
    }
    // 5. 턴 MCP — 그 턴의 작업자 토큰만(전역 · 조정자 토큰 없음).
    let mcp = mcp_bits(&job)?;
    // 6. 지침 — Claude 는 지침 턴 파일(고정 쓰기형 문장 + 역할 지침 + 앱이 읽기만 한 전역 · worktree CLAUDE.md — E19), Codex 는
    //    `developer_instructions`(역할 지침 — S19: AGENTS.md 는 CLI 가 스스로 싣는다).
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
    // 작업자 상세의 턴 시한 막대 — 이 턴이 실제로 받은 시한(아래 `run_ms` 와 같은 값).
    label.turn_minutes = Some(job.turn.turn_minutes.max(1));
    if let Some(script) = &fake {
        // 개발 빌드의 가짜 작업자 — stdout 에 JSONL 사건을 내는 스크립트(아니면 `no-init` 으로 끝난다).
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

/// **검토자 띄우기**(통합 설계 3-3 · 0b D — 판정형 역할 · 3a): 검토 자리(보고 커밋의 분리 HEAD worktree · Run 자리 안 · 훅 끔) →
/// symlink 밖 검사(`symlink-outside` 면 띄우지 않는다) → 빈 cwd(서버 데이터 폴더) → 짧은 고정 지시 → 효과 직전 확인 → 턴 MCP(검토자 토큰만) →
/// 지침 턴 파일 → **판정형 고정 인자**(`turn::turn_argv` · `Grade::ReadOnly` — 역할의 권한 칸과 무관 · 모델 · 강도 · 지침만 역할에서) → 헤드리스 턴.
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
    // 9절 위험 5 확정 — 추적 symlink 가 자리 밖이면 거절(자리는 남는다 — 사람이 본다).
    crate::orchestration::review_links_ok(Path::new(&place)).map_err(|e| why(e.code, e.message))?;
    let prompt = spawn::reviewer_prompt(&job.attempt_id, &job.task.id, &rv.commit, rv.base.as_deref(), &place);
    let (exe, fake) = find_cli(cli)?;
    if let Some((role, minutes)) = o.turn_preflight(&job.run_id, &job.attempt_id).map_err(|e| why(e.code, e.message))? {
        job.turn.role = role;
        job.turn.turn_minutes = minutes;
    }
    let mcp = mcp_bits(&job)?;
    // 지침 턴 파일(E19 · S17 · S18 — Claude 만): 고정 판정형 문장 + 역할 지침 + 전역 CLAUDE.md. 보고 커밋의 CLAUDE.md 는 싣지 않는다(작업자가
    // 고칠 수 있는 글을 검토자의 시스템 지침으로 올리지 않는다 — 필요하면 검토자가 Read 로 읽는다).
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
        // 판정형은 역할의 권한 칸과 무관하게 읽기 전용(4-7 — 시험 `judge_kind_is_read_only_whatever_permission`).
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
    // 작업자 상세의 턴 시한 막대 — 이 턴이 실제로 받은 시한(아래 `run_ms` 와 같은 값).
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

/// 지침 파일 하나를 읽는다(상한 넘으면 앞부분만 — `turn::instructions_text` 가 다시 자른다). 없거나 못 읽으면 `None`.
fn read_capped(p: &Path) -> Option<String> {
    let f = std::fs::File::open(p).ok()?;
    let mut buf = Vec::new();
    f.take(turn::INSTRUCTIONS_DOC_MAX as u64 + 4).read_to_end(&mut buf).ok()?;
    let s = String::from_utf8_lossy(&buf).into_owned();
    (!s.trim().is_empty()).then_some(s)
}

/// 헤드리스 턴 하나의 실행 재료(명령 줄 · 환경 · 확인 조건 · 시한) — **`Debug` 를 파생하지 않는다**(명령 줄에 프롬프트 · 설정 파일 경로,
/// 환경에 토큰).
pub(crate) struct TurnSpec {
    pub exe: String,
    pub cmdline: String,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub expect: turn::Expect,
    /// 시작 시한(init 까지 — Q4).
    pub start_ms: u64,
    /// 실행 시한(턴 전체 — 맡기기 `turn_minutes`).
    pub run_ms: u64,
}

/// 헤드리스 턴 하나의 결과 — 낱말 · 수와 stderr 꼬리(메모리 · 사람 보기만), 그리고 트리 종료를 확인했는지.
pub(crate) struct TurnRun {
    pub outcome: turn::Outcome,
    pub log: turn::TurnLog,
    pub exit_code: Option<i64>,
    pub confirmed: bool,
    /// stderr 끝 8 KiB(메모리만 — 영속 · 로그 · 조정자에 싣지 않는다 · 4-4).
    #[cfg_attr(not(test), allow(dead_code))]
    pub stderr_tail: Vec<u8>,
}

/// 파이프 하나를 끝까지 비운다(각자의 스레드 — 한쪽이 차서 자식이 멈추지 않게, 4-3). 조각을 줄로 나눠(1 MiB 상한) `line` 에 넘기고,
/// 조각마다 `raw` 에도 넘긴다(stderr 꼬리). EOF 에서 잘린 마지막 줄이면 `cut` 을 부르고 `done` 을 보낸다.
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

/// **헤드리스 턴 하나를 돌린다**(블로킹 — 헤드리스 설계 4-3 · 4-4). `os::spawn_in_job`(생성 시 Job · `SPAWN_LOCK` 아래) → stdout 줄 읽기
/// (`turn::LineSplitter` 1 MiB · `turn::TurnLog` — 본문은 버린다) · stderr 꼬리(`turn::TailRing` 8 KiB · Codex 거절 줄)를 **각자의 스레드**가
/// 동시에 비운다 → `on_started`(서버 손이 런타임 칸에 잡을 적는다) → 고리: 중단 깃발 · init 어긋남(도구 사건 전에 끝냄) · 시작 시한 · 실행
/// 시한 · 맏이 끝 → **잡을 끝내고**(남은 손자 · 고아) 활성 0 · 파이프 둘 EOF 를 확인 → `turn::turn_outcome`. 생성 실패는 `Err((낱말, 문장))`
/// (아무것도 서지 않았다). 고리는 도는 동안 `on_pulse` 로 턴 도중의 사실(`turn::Pulse` — 고정해도 되는 대화 id · 2초에 한 번까지의 진행 칸)을
/// 낸다 — 이 스레드에서 · 기록 잠금 밖에서.
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
                // 곧바로 끝낼 까닭(`abort`)은 기록에 남고 턴 고리가 본다.
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
            break None; // 사유는 `TurnLog::abort` 에 — 도구 사건 전에 끝낸다.
        }
        // F4 — init 이 확인을 지난 순간 대화를 고정한다(턴 끝까지 기다리지 않는다 — 첫 턴 동안 `read_worker` · 보드가 `no-conversation` 이 아니게).
        if let Some(c) = early {
            conversation_sent = true;
            on_pulse(turn::Pulse::Conversation(c));
        }
        // F4 — 진행 칸(도구 수 · 거절 · 마지막 도구 · 모델)은 바뀌었을 때 2초에 한 번까지(`turn::ProgressGate`).
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
    // 잔여 자식 정리 — 맏이가 끝났어도 잡 안의 손자 · 고아를 끝낸다(그들이 파이프를 쥐고 있으면 EOF 가 서지 않는다).
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

/// 헤드리스 턴을 세우고 끝까지 본다 — 작업자 · 해결자 · 검토자 공용. 런타임 칸을 먼저 만들고(중단이 생성 중에 와도 깃발이 선다) → 생성 →
/// `attempt_spawned`(그사이 중단이면 곧바로 끝냄) → 턴 기록 시작 → (도중) 대화 고정 → 끝 → 턴 기록 끝 · (Codex) 대화 확인 → 확인되면 칸을 지워 턴 자원을 거두고
/// `attempt_process_exited`, 확인이 안 서면 칸(잡 · 자원)을 쥔 채 `stop-unconfirmed` — 서버 시계가 다시 본다(`tree_gone`).
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
        // 섰다 — 이 뒤로 턴 자원 · 토큰은 런타임 칸과 종료 확인이 맡는다(리뷰 F13 — 생성 실패 회수와 한 벌).
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
        // 턴 끝과 같은 손 · 같은 판정(처음 받은 id 만 · 다르면 대화 끊김). 잠금 = 오케스트레이션 하나(기록 잠금은 이미 놓았다).
        turn::Pulse::Conversation(c) => o.attempt_conversation(&run_id, &attempt_id, &c),
        // 도는 턴 기록의 진행 칸만 — 영속 쓰기 · seq · `wait_run` 깨우기 없음(이벤트 `orchestration-progress` 만). 최종값은 아래 턴 기록 끝.
        turn::Pulse::Progress(p) => o.attempt_turn_progress(&run_id, &attempt_id, n, &p),
    });
    let (run, _proc) = match result {
        Ok(r) => r,
        Err((word, msg)) => return Err(why("spawn", format!("{word}: {msg}"))),
    };
    guard.disarm();
    let rec = ended_record(n, &label, &run);
    o.attempt_turn(&run_id, &attempt_id, rec, true);
    // Codex 첫 턴의 대화 고정(4-4 E8 — 서버가 띄운 프로세스의 stdout `thread.started`). 보통은 턴 도중에 이미 섰다(F4 — 위 `Pulse`) — 그러면 같은
    // 값 확인만이고(아무 일 없음), 다르면 대화 끊김. init 확인에 걸린 턴(도중 고정 없음)의 id 도 예전 그대로 여기서. Claude 는 `--session-id` 로 이미 고정돼 있다.
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
            // 칸을 지우면 턴 자원(턴 MCP 파일 · 지침 파일)이 함께 떨어진다(`TurnResources`).
            g.remove(&attempt_id);
        } else if let Some(rt) = g.get_mut(&attempt_id) {
            rt.exited = true;
        }
    }
    o.attempt_process_exited(&run_id, &attempt_id, run.confirmed, run.exit_code.map(|c| c as u32));
    Ok(())
}

/// 턴 시작의 기록(시각은 오케스트레이션 시계가 찍는다).
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

/// 턴 끝의 기록 — 낱말 · 수만(본문 · stderr 꼬리는 싣지 않는다 — 꼬리는 메모리 · 로그 밖).
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

/// 서버 시작 때 한 번 — 산 턴이 없으니(옛 서버의 턴 잡은 자기 잡과 함께 끝났다) 남은 턴 자원(턴 MCP 파일 `orch-att-*` · 지침 턴 파일
/// `<Run 폴더>/turns/`)을 쓸어 낸다(4-5 · D11). 지운 수.
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

    /// 트리 판정(순수): 잡이 비어야 확인 — 못 물으면 비었다고 보지 않는다(4-3 · `stop-unconfirmed`).
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

    /// 리뷰 F13 — 턴이 서기 전에 실패하면(실패 · 패닉 어느 길이든) 턴 MCP 파일 claim · 런타임 칸 · 그 턴의 작업자 토큰을 **함께** 거둔다.
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
        // 턴이 선 뒤(무장 해제)에는 아무것도 하지 않는다.
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
