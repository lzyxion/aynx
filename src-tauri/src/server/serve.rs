//! 서버 본체 — 파이프 선점 → 찾기 파일 → 접속마다 상대 확인 → 프레임 처리, 그리고 **수명**(정상 종료 · 고아 자진 종료).
//!
//! ③-2 부터 **로컬 PTY 세션의 주인**이다 — `hello`·`ping`·`status`·`shutdown` 에 더해 세션 op(`server::sessions`)를 받고,
//! 출력 프레임을 보내고 ACK 를 받는다. 볼트 평면은 ③-3b1, **SSH 평면**(대화형 SSH·연결 풀·포워드·헤드리스·원격 신호 파일·
//! SSH 세션 로그)은 ③-3b2 부터, **AI 평면**(MCP `/mcp`·`mcp.json`·거울·라우팅·작업안·실행기·감사)은 ③-3c 부터 여기 — 공용
//! 손잡이(이벤트·신호 포트·금고·AI 평면)는 `server::hub`.
//!
//! - 상대 확인: 접속한 프로세스의 이미지 경로가 [`Config::trusted_clients`] 중 하나가 아니면 **즉시 끊고 로그**.
//! - 판: `hello` 가 범위를 협상한다([`frame::negotiate`]). 협상 전에는 판에 무관한 op(`hello`·`shutdown`)만 받는다.
//! - 등급: 요청의 `kind` 가 op 의 요구 등급과 같아야 한다. `Approve` 는 늘 거부([`frame::check_grade`]).
//! - 수명: `shutdown`(Write) 또는 [`IdleGuard`] 만료(세션 0 · 클라이언트 0 이 이어질 때) → [`finish`](세션 전부 닫기 →
//!   자식 트리 종료 → 찾기 파일 지우기). 자기 잡(`KILL_ON_JOB_CLOSE`)은 프로세스가 끝날 때 OS 가 닫으며 남은 잡 자식을
//!   끝낸다 — Store(MSIX) pwsh 는 잡에 안 들어 크래시 땐 고아가 남을 수 있다(정직한 한계 · ③-0).
//! - **연결이 끊기면 그 연결의 임대를 푼다**(`sessions::conn_gone`) — GUI 정상 종료·kill 모두 세션은 산다. 그 연결이 뽑아 간
//!   원격 신호 토큰은 거두지 않고 고아로만 표시한다(`agent_signal::orphan_conn` — 일주일 쉬면 tick 이 거둔다).
//! - ③-3a 부터 **신호 평면**(`signal_http` — 127.0.0.1 임시 포트의 `/agent-signal`)도 여기서 띄운다. 받은 신호는 서버 이벤트
//!   `agent-signal` 로 모든 연결에 방송된다. 포트는 `hello`·`status` 의 `signal_port`.
//! - ③-3b1 부터 **볼트 평면**(`vault_ops` — 금고·외부 MCP 실행 브로커·HTTP 헤더 프록시)도 여기 산다. 볼트 op 는 블로킹 풀에서
//!   돌고, **클라이언트가 0 이 되면 볼트를 창 0개 잠금으로 잠근다**(HTTP 티켓은 정지 — 해제하면 같은 티켓이 산다).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, watch};

use super::ai::{self, AiPlane};
use super::discovery::{self, Discovery};
use super::signal_http;
use super::vault_ops::VaultPlane;
use super::sessions::{self, ConnCtx};
use super::ipc::frame::{self, code};
use super::ipc::transport::{BindError, Listener};
use super::ipc::{BoxStream, Frame, Grade, Hello, Peer, ProtocolRange, Welcome, WireError};
use super::log;
use super::os;

/// 서버 하나의 설정 — 제품은 `server::session_server_main` 이, 시험은 직접 만든다.
pub(crate) struct Config {
    pub pipe: String,
    /// 찾기 파일 자리(`None` 이면 쓰지 않는다 — 시험).
    pub discovery: Option<PathBuf>,
    /// 클라이언트 0개가 이만큼 이어지면 끝난다.
    pub idle: Duration,
    /// GUI 가 띄운 방식(`os::SpawnMode::as_str`) — 서버는 스스로 알 길이 없어 인자로 받는다.
    pub launch_mode: String,
    /// 자기 잡을 만들까(제품 true — 시험 프로세스를 잡에 넣지 않는다).
    pub own_job: bool,
    /// 정상 종료에서 자식 트리를 끝낼까(제품 true — 시험 프로세스의 다른 자식을 건드리지 않는다).
    pub kill_tree: bool,
    /// 받을 클라이언트 exe 경로들(서버 자신의 이미지 + 개발 빌드의 원본 exe).
    pub trusted_clients: Vec<String>,
    pub app_version: String,
    /// 볼트 폴더(③-3b1) — `None` 이면 `instance::config_root()`(제품). 시험은 임시 폴더.
    pub vault_dir: Option<PathBuf>,
    /// 감사 로그 폴더(③-3c) — 제품은 `audit::audit_dir()`, 시험은 임시 폴더(`None` = 감사 꺼짐).
    pub audit_dir: Option<PathBuf>,
    /// `mcp.json`(포트·MCP 토큰) 자리(③-3c — 주인은 서버) — 제품은 `mcp::config_path()`, 시험은 임시 폴더(`None` = 안 씀).
    pub mcp_json: Option<PathBuf>,
    /// DB 연결 목록 파일(쿼리 타일 — `db::conns`) — `None` 이면 `config_root()/db-connections.json`(제품). 시험은 임시 파일.
    pub db_conns: Option<PathBuf>,
    /// 오케스트레이션 영속 폴더(2026-10-14) — 제품은 `orchestration::store_dir()`, 시험은 임시 폴더(`None` = 안 씀).
    pub orchestration_dir: Option<PathBuf>,
}

/// `run` 이 끝난 까닭.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Exit {
    /// 정상 종료(`shutdown` 프레임 · 고아 자진 종료) — 사유 한 줄.
    Shutdown(String),
    /// 같은 파이프의 첫 인스턴스가 이미 있다(err 5) — 다른 서버가 돈다. 조용히 끝난다.
    AlreadyRunning,
    Failed(String),
}

/// 고아 자진 종료의 조건 묶음 — **바쁜 이유가 하나라도 있으면** 시계가 멈춘다. 살아 있는 세션(붙었거나 떨어진)이 하나라도
/// 있으면 무기한이다(설계 4.1 · 열린 질문 2). ③-3c 부터 **진행 중 작업안**(승인됨·실행 중 — `plans`)도 바쁜 이유다(헤드리스
/// 대상만 도는 실행은 세션 표에 타일이 없어도 끝까지 돈다).
///
/// **떨어진 세션으로 남은 쿼리 타일의 DB 연결은 세션으로 센다**(`sessions` 에 더한다 — 2026-11-09 사용자 결정 ②): 창이 사라져도(GUI
/// 종료 · 마지막 창 X · GUI 연결 끊김) DB 타일은 TTL 없이 떨어진 세션 목록에 남아 사람이 닫거나 다시 붙일 때까지 산다(`db::table` 머리말).
/// 붙은 DB 연결은 그 GUI 연결이 `clients` 로 이미 세이고, 리로드로 떼어 둔 것(TTL 10분)은 창이 살아 있으니 따로 세지 않는다. 서버가
/// 끝날 때 남은 DB 연결을 닫는다(`run` 끝 — `db::table::close_all`).
///
/// **사이드 채팅 프로세스도 바쁜 이유가 아니다**(v2 2단계 — DB 연결과 같은 근거 · 같은 TTL 10분 — `side_chat::DETACH_TTL`). 끝날 때 닫는다
/// (`run` 끝 — `side_chat::close_all`).
///
/// **살아 있는 오케스트레이션 Run**(running · paused · stopping — `runs`)도 바쁜 이유다(2026-10-14 설계 C-7). orphaned(재시작 뒤
/// 읽기 전용)는 아니다 — 그것만 남은 서버는 끝나도 파일이 남는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Busy {
    pub clients: usize,
    pub sessions: usize,
    pub plans: usize,
    pub runs: usize,
}

impl Busy {
    pub(crate) fn idle(&self) -> bool {
        self.clients == 0 && self.sessions == 0 && self.plans == 0 && self.runs == 0
    }
}

/// 한가함이 `limit` 동안 이어졌는지 재는 시계.
#[derive(Debug)]
pub(crate) struct IdleGuard {
    limit: Duration,
    since: Option<Instant>,
}

impl IdleGuard {
    pub(crate) fn new(limit: Duration, now: Instant) -> Self {
        IdleGuard {
            limit,
            since: Some(now),
        }
    }

    /// 지금 상태를 보고 만료됐으면 `true`. 바쁘면 시계를 지운다.
    pub(crate) fn observe(&mut self, busy: Busy, now: Instant) -> bool {
        if !busy.idle() {
            self.since = None;
            return false;
        }
        let since = *self.since.get_or_insert(now);
        now.duration_since(since) >= self.limit
    }
}

/// 연결들이 함께 보는 서버 상태.
struct Shared {
    started: Instant,
    started_at_ms: u64,
    launch_mode: String,
    app_version: String,
    own_job: bool,
    /// 붙은 클라이언트 수 — AI 평면의 "끝난 실행 지켜보기" 도 본다(③-4 — 0 이면 미전달 큐로).
    clients: Arc<AtomicUsize>,
    /// 연결 번호(1부터) — 세션 임대의 `conn`.
    conn_seq: AtomicU64,
    /// 종료 요청 — 사유가 들어오면 듣기 고리가 멈춘다.
    stop: watch::Sender<Option<String>>,
    /// 서버 → 모든 클라이언트 이벤트(이름, 몸). 연결마다 seq 를 따로 매긴다.
    events: broadcast::Sender<(String, Value)>,
    /// 신호 평면 포트(못 띄웠으면 `None`).
    signal_port: Option<u16>,
    /// 볼트 평면(③-3b1) — 금고·실행 브로커·헤더 프록시.
    plane: Arc<VaultPlane>,
    /// AI 평면(③-3c) — MCP·거울·라우팅·작업안·감사.
    ai: Arc<AiPlane>,
}

impl Shared {
    fn busy(&self) -> Busy {
        Busy {
            clients: self.clients.load(Ordering::SeqCst),
            // 떨어진 세션으로 남은 쿼리 타일의 DB 연결도 세션으로 센다(② — 사람이 닫거나 다시 붙일 때까지 서버가 산다).
            sessions: sessions::live_count() + crate::db::table::kept_count(),
            plans: self.ai.ops.in_progress(),
            runs: self.ai.orch.active_count(),
        }
    }

    fn status(&self) -> Value {
        json!({
            "server_pid": std::process::id(),
            "clients": self.clients.load(Ordering::SeqCst),
            "sessions": sessions::live_count(),
            "dbs": crate::db::table::live_count(),
            "sideChats": super::side_chat::live_count(),
            "producerChats": super::producer::live_count(),
            "uptime_ms": self.started.elapsed().as_millis() as u64,
            "started_at_ms": self.started_at_ms,
            "own_job": self.own_job,
            "launch_mode": self.launch_mode,
            "app_version": self.app_version,
            "protocol": ProtocolRange::OURS,
            "signal_port": self.signal_port,
            "mcp": self.plane.status(),
            "ai": self.ai.status(),
        })
    }

    fn request_stop(&self, reason: String) {
        self.stop.send_if_modified(|cur| {
            if cur.is_none() {
                *cur = Some(reason);
                true
            } else {
                false
            }
        });
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 서버를 돌린다 — 끝날 때까지 돌아오지 않는다.
pub(crate) async fn run(cfg: Config) -> Exit {
    let mut listener = match Listener::bind(&cfg.pipe) {
        Ok(l) => l,
        Err(BindError::Taken) => {
            log::line(format!("another server holds {} (err 5) — exiting", cfg.pipe));
            return Exit::AlreadyRunning;
        }
        Err(BindError::Other(e)) => {
            log::line(format!("bind failed: {e}"));
            return Exit::Failed(e);
        }
    };
    // 자기 잡 — 지금은 자식이 없지만 ③-2 의 PTY 자식이 여기 든다. 손잡이는 프로세스 끝까지 쥔다.
    let job = cfg.own_job.then(os::create_kill_on_close_job);
    let own_job = matches!(job, Some(Ok(_)));
    if let Some(Err(e)) = &job {
        log::line(format!("own job unavailable: {e}"));
    }
    let (stop_tx, mut stop_rx) = watch::channel(None);
    let (events, _) = broadcast::channel(1024);
    // 로컬 세션의 사건(종료·자원 회수)을 모든 연결의 이벤트로 — 시험은 한 프로세스에 서버를 여럿 띄우니 매번 갈아 끼운다.
    crate::pty::set_events(Arc::new(sessions::Broadcaster(events.clone())));
    // 세션 id 의 바탕 — 서버가 다시 떠도 GUI 가 쥔 옛 id 와 겹치지 않게(시각에서 뽑는다, 1..=2000 × 백만).
    crate::pty::seed_ids(((now_ms() / 1000) % 2000 + 1) as u32 * 1_000_000);
    // AI 평면(③-3c) — MCP 토큰·거울·라우팅·작업안·감사. 리스너(아래 신호 평면)에 `/mcp` 갈래로 꽂히고, 포트가 서면 `mcp.json` 을
    // 쓴다(주인 = 서버). 파이프 선점(위) 뒤라 둘째 서버는 여기까지 오지 않는다 — `mcp.json` 을 덮을 일이 없다.
    // DB 평면(쿼리 타일) — 연결을 열 때 서버가 직접 읽는 '경유 없음' 목록의 자리(시험만 바꾼다 — 제품은 `config_root()`).
    if let Some(p) = &cfg.db_conns {
        crate::db::conns::set_path_override(Some(p.clone()));
    }
    let ai_plane = AiPlane::new(
        events.clone(),
        cfg.audit_dir.clone(),
        cfg.mcp_json.clone(),
        cfg.orchestration_dir.clone(),
    );
    // 신호 평면 — 받은 훅 신호를 모든 연결의 이벤트 `agent-signal` 로(페이로드 그대로 — GUI 가 같은 이름으로 중계한다). 같은
    // 리스너가 `/mcp` 도 받는다(③-3c — 경로별 문지기·토큰 종류·동시 상한은 갈라 둔다, `signal_http` 머리말).
    let signal_events = events.clone();
    let signal = signal_http::start(
        Arc::new(move |payload| {
            let _ = signal_events.send((crate::agent_signal::EVENT.into(), payload));
        }),
        ai_plane.mcp_route(),
    );
    if signal.is_none() {
        log::line("signal plane failed to start — tiles open without agent signals");
    }
    ai_plane.bound(signal.as_ref().map(|p| p.port));
    super::hub::install_ai(ai_plane.clone());
    // 오케스트레이션 작업자 손(3차 3a) — 서버가 GUI 요청 없이 띄우는 헤드리스 턴(작업자 · 해결자 · 검토자 — `server::workers`, 세션 아님).
    // 옛 서버가 남긴 턴 자원(턴 MCP 파일 · 지침 턴 파일)은 산 턴이 없으니 지금 쓸어 낸다(4-5 · D11).
    let swept = super::workers::sweep_turn_leftovers();
    if swept > 0 {
        log::line(format!("orchestration — removed {swept} leftover turn file(s) of an earlier server"));
    }
    ai_plane.orch.set_launcher(super::workers::ServerLauncher::new(&ai_plane.orch));
    // 통합 설계 2단계 — 통합 ref 를 읽고 올리는 손(공용 git 실행기). 남은 Run 의 끝나지 않은 통합 작업은 완료 증거 ref 로 판정한다
    // (재시작 복구 — git 을 기다리지 않게 따로 스레드에서).
    ai_plane.orch.set_integrator(std::sync::Arc::new(crate::orchestration::GitRefs));
    // 통합 설계 6단계 — 서버 임시 자리(검증 · 검토)의 소유 기록 · 작업자 worktree [정리]가 쓰는 곁 파일(`worktrees.json`).
    ai_plane.orch.set_sidecar(crate::worktree::sidecar_path());
    // 통합 설계 3단계 — 수락의 통합 작업은 따로 스레드에서 돈다(자기 약한 참조).
    ai_plane.orch.install_self();
    {
        let orch = ai_plane.orch.clone();
        let _ = std::thread::Builder::new().name("orchestration-recover".into()).spawn(move || {
            let n = orch.recover_jobs();
            if n > 0 {
                log::line(format!("orchestration — recovered integration state of {n} run(s)"));
            }
        });
    }
    // 볼트 평면 — 금고는 이 프로세스의 메모리에만 열린다(`vault_ops` 머리말). 브로커 포트는 지금 잡는다.
    let plane = Arc::new(VaultPlane::new(cfg.vault_dir.clone()));
    // SSH 평면(③-3b2)의 공용 손잡이 — 이벤트 방송 · 신호 포트(원격 `-R` 의 이어 줄 곳) · 금고(SSH 인증이 직접 읽는다).
    super::hub::install(events.clone(), signal.as_ref().map(|p| p.port), plane.vault.clone(), plane.broker.clone());
    // SSH 세션 id 의 바탕 — 로컬과 같은 규칙(서버가 다시 떠도 GUI 가 쥔 옛 id·SFTP 캐시와 겹치지 않게).
    crate::ssh::seed_ids(((now_ms() / 1000) % 2000 + 1) as u32 * 1_000_000);
    let shared = Arc::new(Shared {
        started: Instant::now(),
        started_at_ms: now_ms(),
        launch_mode: cfg.launch_mode.clone(),
        app_version: cfg.app_version.clone(),
        own_job,
        clients: Arc::new(AtomicUsize::new(0)),
        conn_seq: AtomicU64::new(0),
        stop: stop_tx,
        events,
        signal_port: signal.as_ref().map(|p| p.port),
        plane,
        ai: ai_plane,
    });
    // 찾기 파일 — 살아 있는 세션 수(`sessions`)도 싣는다(③-4 — 설치기 훅이 "세션 N개가 닫힙니다" 를 읽는다). 수가 바뀌면 시계가
    // 다시 쓴다([`write_discovery`]).
    let mut written_sessions = sessions::live_count();
    write_discovery(&cfg, &shared, written_sessions);
    // 서버의 두 시계(③-4) — 사전 정책 자동 승인 · GUI 없을 때 끝난 실행 지켜보기.
    shared.ai.start_timers(shared.clients.clone());
    log::line(format!(
        "started — pipe {} · launch_mode {} · own_job {own_job} · idle {}s · signal port {:?}",
        cfg.pipe,
        cfg.launch_mode,
        cfg.idle.as_secs(),
        shared.signal_port
    ));
    if let Some(b) = &shared.plane.broker {
        log::line(format!("mcp launch broker on 127.0.0.1:{} (header proxy starts with the first http ticket)", b.port()));
    }

    let mut guard = IdleGuard::new(cfg.idle, Instant::now());
    let tick = (cfg.idle / 10).clamp(Duration::from_millis(200), Duration::from_secs(5));
    let mut ticker = tokio::time::interval(tick);
    let trusted = Arc::new(cfg.trusted_clients.clone());
    let reason = loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, peer)) => {
                    if !peer_trusted(&peer, &trusted) {
                        log::line(format!(
                            "refused client pid {:?} exe {:?} — not the app executable",
                            peer.pid, peer.image
                        ));
                        drop(stream);
                        continue;
                    }
                    tokio::spawn(serve_conn(stream, peer, shared.clone()));
                }
                Err(e) => {
                    log::line(format!("accept failed: {e}"));
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            },
            _ = stop_rx.changed() => {
                if let Some(r) = stop_rx.borrow().clone() {
                    break r;
                }
            }
            _ = ticker.tick() => {
                let live = sessions::live_count();
                if live != written_sessions {
                    written_sessions = live;
                    write_discovery(&cfg, &shared, live);
                }
                let pruned = crate::agent_signal::prune_orphans();
                if pruned > 0 {
                    log::line(format!("pruned {pruned} orphaned remote signal token(s) (idle over 7 days)"));
                }
                if guard.observe(shared.busy(), Instant::now()) {
                    break format!(
                        "idle for {}s with no clients, no sessions, no running plans and no active runs",
                        cfg.idle.as_secs()
                    );
                }
            }
        }
    };
    // 도는 작업안을 먼저 멈춘다 — 취소 스위치를 세우고 승인됨·실행 중을 `cancelled` 로 봉한다(감사에 한 줄씩 · 자동 재실행 없음).
    let sealed = shared.ai.ops.cancel_all_for_shutdown();
    if sealed > 0 {
        log::line(format!("shutdown — {sealed} running task plan(s) marked cancelled"));
    }
    // SSH 세션(대화형·헤드리스)을 먼저 닫는다 — 포워드 리스너·SFTP·신호 토큰·원격 신호 파일·셸 채널·전송로(상한 10초:
    // 죽어 가는 전송로의 닫기 시한이 서버 끝을 붙들지 않게).
    if cfg.kill_tree {
        let closed = tokio::time::timeout(Duration::from_secs(10), sessions::close_all_ssh()).await;
        log::line(format!("shutdown — ssh sessions closed {:?}", closed.ok()));
    }
    // 쿼리 타일의 DB 연결(떼어 둔 것 · 비밀번호를 묻는 동안 세워 둔 전송로까지)도 닫는다 — 엔진이 SSH 전송로 핀·터널을 놓는다.
    // 시험 서버도 닫는다(`kill_tree` 와 무관 — DB 표를 만지는 시험은 모두 `SESSION_STATE` 로 줄을 선다).
    let dbs = crate::db::table::close_all();
    if dbs > 0 {
        log::line(format!("shutdown — closed {dbs} db connection(s)"));
    }
    // 사이드 채팅 프로세스도 잡째 닫는다(`Busy` 에 세지 않는다 — 같은 근거 · `side_chat` 머리말). 시험 서버도 닫는다.
    let chats = super::side_chat::close_all();
    if chats > 0 {
        log::line(format!("shutdown — closed {chats} side chat(s)"));
    }
    // 프로듀서 채팅도(같은 근거 — `server::producer` 머리말 · Run 은 `Busy.runs` 가 센다).
    let producers = super::producer::close_all();
    if producers > 0 {
        log::line(format!("shutdown — closed {producers} producer chat(s)"));
    }
    // AI 전용 DB 연결(쿼리 타일 3a — `db::ai` 풀)도 닫는다.
    let ai_dbs = crate::db::ai::close_all();
    if ai_dbs > 0 {
        log::line(format!("shutdown — closed {ai_dbs} AI db connection(s)"));
    }
    // 오케스트레이션 영속 쓰기 줄을 비운다(리뷰 F10 — 쓰기 스레드가 잠금 밖에서 쓴다, 마지막 사건까지 파일에).
    shared.ai.orch.flush_saves();
    finish(&cfg, &reason);
    // 세션을 닫은 뒤에 신호 평면을 내린다(종료 마감의 회수가 먼저 돈다).
    drop(signal);
    drop(listener);
    Exit::Shutdown(reason)
}

/// 찾기 파일을 (다시) 쓴다 — 비밀 없음. `sessions` 는 지금 살아 있는 세션 수(설치기 경고용).
fn write_discovery(cfg: &Config, shared: &Shared, sessions: usize) {
    let Some(path) = &cfg.discovery else {
        return;
    };
    let d = Discovery {
        pid: std::process::id(),
        protocol: ProtocolRange::OURS,
        app_version: cfg.app_version.clone(),
        pipe: cfg.pipe.clone(),
        started_at_ms: shared.started_at_ms,
        launch_mode: cfg.launch_mode.clone(),
        sessions,
    };
    if let Err(e) = discovery::write(path, &d) {
        log::line(format!("server.json write failed: {e}"));
    }
}

fn peer_trusted(peer: &Peer, trusted: &[String]) -> bool {
    peer.image
        .as_deref()
        .is_some_and(|img| trusted.iter().any(|t| os::same_exe(img, t)))
}

/// 이벤트 이름(F8) — 이 연결로 가는 방송이 밀려 이벤트를 버렸다(몸 `{dropped}` — 어느 이벤트인지는 모른다). 그 연결에만 보내고
/// GUI 는 같은 이름으로 창에 중계한다(`client::RELAYED`) — 보이는 오케스트레이션 보드 · 조정자 칩 표가 한 번 다시 읽는다.
pub(crate) const EVENTS_LAGGED: &str = "events-lagged";

/// 방송 수신 하나 → 중계할 이벤트. 밀림(`Lagged`)은 로그 한 줄 + [`EVENTS_LAGGED`], 닫힘은 `None`(중계 끝).
fn relay_item(r: Result<(String, Value), broadcast::error::RecvError>) -> Option<(String, Value)> {
    match r {
        Ok(e) => Some(e),
        Err(broadcast::error::RecvError::Lagged(n)) => {
            log::line(format!("event relay lagged — {n} event(s) dropped"));
            Some((EVENTS_LAGGED.into(), json!({ "dropped": n })))
        }
        Err(broadcast::error::RecvError::Closed) => None,
    }
}

/// 정상 종료의 마감 — 세션 전부 닫기(셸 kill) → 남은 자식 트리 종료(Store pwsh 처럼 잡에 안 든 손자까지 —
/// ③-0) → 찾기 파일 지우기. 세션을 먼저 닫는 것은 종료 마감(토큰 회수 알림)이 제 순서로 돌게 하려는 것이다.
fn finish(cfg: &Config, reason: &str) {
    // 이 뒤로 끝나는 세션의 사유는 "서버가 멈췄다" — 타일이 셸 실패(종료 코드 1)로 읽지 않게(`sessions::exit_for_stop`).
    // (시험 서버는 `kill_tree: false` — 같은 시험 프로세스의 다른 시험에 표식이 새지 않는다.)
    if cfg.kill_tree {
        sessions::mark_stopping();
    }
    let closed = if cfg.kill_tree {
        sessions::close_everything_blocking()
    } else {
        0
    };
    let killed = if cfg.kill_tree { os::terminate_descendants() } else { 0 };
    if let Some(path) = &cfg.discovery {
        discovery::remove_if_ours(path, std::process::id());
    }
    log::line(format!(
        "shutdown — {reason} · sessions closed {closed} · descendants terminated {killed}"
    ));
}

/// 연결 하나 — 읽기 고리 + 쓰기 태스크(응답·이벤트·출력 프레임이 한 줄로 나간다).
///
/// - 세션 op 중 맵 조작뿐인 것(`sessions::inline_op`)은 이 고리에서 순서대로, 블로킹을 쓰는 것(열기·쓰기·닫기·붙기 …)은
///   태스크로 돈다 — 한 타일의 쓰기는 프런트가 응답을 기다려 하나씩 보내므로 순서가 선다.
/// - ACK 는 응답 없이 곧바로 크레딧에.
/// - 끝나면(EOF·오류·GUI kill) 이 연결의 임대를 모두 푼다 — 세션은 산다(`sessions::conn_gone`).
async fn serve_conn(stream: BoxStream, peer: Peer, shared: Arc<Shared>) {
    let (mut rd, mut wr) = tokio::io::split(stream);
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();
    let writer = tokio::spawn(async move {
        while let Some(f) = out_rx.recv().await {
            if frame::write_frame(&mut wr, &f).await.is_err() {
                break;
            }
        }
    });
    let conn = shared.conn_seq.fetch_add(1, Ordering::SeqCst) + 1;
    // 산 연결로 적는다 — 끊긴 뒤에 끝나는 열기·붙기가 이 연결에 임대를 적지 못하게(`sessions::conn_gone` 이 지운다 · 재리뷰 R02).
    sessions::conn_opened(conn);
    let ctx = ConnCtx {
        id: conn,
        tx: out_tx.clone(),
        signal_port: shared.signal_port,
    };
    let count = shared.clients.fetch_add(1, Ordering::SeqCst) + 1;
    log::line(format!("client pid {:?} connected as conn {conn} ({count} now)", peer.pid));
    let _ = shared.events.send(("clients".into(), json!({ "count": count })));

    // 이벤트 중계 — 연결마다 seq 1부터. 밀려 놓친 이벤트가 있어도(Lagged) 중계를 멈추지 않고, 그 자리에 [`EVENTS_LAGGED`] 하나를
    // 이 연결에만 보낸다(F8 — 마지막 변화 이벤트가 빠져 보드 · 칩이 옛 상태에 머물지 않게 · `relay_item`).
    let mut ev_rx = shared.events.subscribe();
    let ev_out = out_tx.clone();
    let relay = tokio::spawn(async move {
        let seq = AtomicU64::new(0);
        loop {
            let Some((name, body)) = relay_item(ev_rx.recv().await) else {
                break;
            };
            let seq = seq.fetch_add(1, Ordering::SeqCst) + 1;
            if ev_out.send(Frame::Event { seq, name, body }).is_err() {
                break;
            }
        }
    });

    let mut negotiated: Option<u32> = None;
    loop {
        let f = match frame::read_frame(&mut rd).await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                log::line(format!("client pid {:?} bad frame: {e}", peer.pid));
                break;
            }
        };
        let (id, kind, op, body) = match f {
            Frame::Request { id, kind, op, body } => (id, kind, op, body),
            Frame::Ack(a) if negotiated.is_some() => {
                sessions::ack(a);
                continue;
            }
            // 채널 터널(판 5) — 주인 연결의 것만(`tunnel`).
            Frame::Channel { chan, bytes } if negotiated.is_some() => {
                super::tunnel::from_client(conn, chan, bytes);
                continue;
            }
            Frame::ChanAck { chan, consumed } if negotiated.is_some() => {
                super::tunnel::server_ack(conn, chan, consumed);
                continue;
            }
            _ => continue, // 클라이언트가 응답·이벤트·출력을 보낼 일은 없다 — 버린다
        };
        let reply = match dispatch(&shared, &mut negotiated, id, kind, &op, body) {
            Routed::Done(reply) => reply,
            // 마스터 확인(판 16) — 판 15 이하로 붙은 GUI 는 이 op 를 모른다.
            Routed::Session(_) if op == "vault_verify_master" && negotiated.is_some_and(|p| p < frame::VAULT_VERIFY_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "vault_verify_master needs protocol 16"))
            }
            // 다중 시청자(판 17 — 원격 웹 R2-A) — 판 16 이하로 붙은 GUI 는 이 op 를 모른다.
            Routed::Session(_)
                if matches!(op.as_str(), "attach_viewer" | "detach_viewer")
                    && negotiated.is_some_and(|p| p < frame::VIEWER_PROTOCOL) =>
            {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "viewer ops need protocol 17"))
            }
            Routed::Session(body) if super::vault_ops::is_vault_op(&op) => {
                // 디스크·Argon2 — 블로킹 풀에서. 응답은 같은 쓰기 큐로(몸·응답은 로그에 남기지 않는다).
                let plane = shared.plane.clone();
                let tx = out_tx.clone();
                tokio::spawn(async move {
                    let r = tokio::task::spawn_blocking(move || super::vault_ops::handle(&op, body, &plane))
                        .await
                        .unwrap_or_else(|_| Err(WireError::new(super::vault_ops::VAULT, "vault task failed")));
                    let _ = tx.send(to_frame(id, r));
                });
                continue;
            }
            // AI 평면(③-3c). 거울 묶음·좌표는 읽기 고리 안에서 온 순서대로(잠금과 대입뿐 — 거울은 순서가 곧 정확성), 나머지
            // (설정·위임 파일을 읽는 작업안 op · 관제판 목록)는 블로킹 풀에서. 몸·응답은 로그에 남기지 않는다(토큰·거울 내용).
            Routed::Session(body) if ai::is_ai_op(&op) && ai::inline_op(&op) => to_frame(id, ai::handle(&op, body, &shared.ai)),
            Routed::Session(body) if ai::is_ai_op(&op) => {
                let plane = shared.ai.clone();
                let tx = out_tx.clone();
                tokio::spawn(async move {
                    let r = tokio::task::spawn_blocking(move || ai::handle(&op, body, &plane))
                        .await
                        .unwrap_or_else(|_| Err(WireError::new(frame::code::SESSION, "ai task failed")));
                    let _ = tx.send(to_frame(id, r));
                });
                continue;
            }
            // 자원 모니터(판 18) — 판 17 이하로 붙은 GUI 는 이 op 를 모른다. 잠금 · 복사뿐이라 고리 안에서(표본은 제 스레드).
            Routed::Session(_)
                if super::resources::is_resource_op(&op) && negotiated.is_some_and(|p| p < frame::RESOURCE_PROTOCOL) =>
            {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "resource ops need protocol 18"))
            }
            Routed::Session(body) if super::resources::is_resource_op(&op) => to_frame(id, super::resources::handle(&op, body)),
            // 사이드 채팅(판 19 · 보는 창 여럿 판 21) — 판 20 이하로 붙은 GUI 는 지금 뜻을 모른다. 보내기는 프로세스를 띄우고 준비를 기다리므로(블로킹)
            // 블로킹 풀 태스크로(이 연결의 다른 op 를 막지 않는다). 몸 · 응답은 로그에 남기지 않는다(사람 글).
            Routed::Session(_)
                if super::side_chat::is_side_chat_op(&op) && negotiated.is_some_and(|p| p < frame::SIDE_CHAT_VIEWERS_PROTOCOL) =>
            {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "side chat ops need protocol 21"))
            }
            Routed::Session(body) if super::side_chat::is_side_chat_op(&op) => {
                let tx = out_tx.clone();
                tokio::spawn(async move {
                    let r = tokio::task::spawn_blocking(move || super::side_chat::handle(&op, body, conn))
                        .await
                        .unwrap_or_else(|_| Err(WireError::new(super::side_chat::SIDE_CHAT, "side chat task failed")));
                    let _ = tx.send(to_frame(id, r));
                });
                continue;
            }
            // 프로듀서 채팅(판 20 — `server::producer`) — 사이드 채팅과 같은 꼴(블로킹 풀 · 몸 · 응답은 로그에 남기지 않는다).
            Routed::Session(_) if super::producer::is_producer_op(&op) && negotiated.is_some_and(|p| p < frame::PRODUCER_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "producer chat ops need protocol 20"))
            }
            Routed::Session(body) if super::producer::is_producer_op(&op) => {
                let tx = out_tx.clone();
                tokio::spawn(async move {
                    let r = tokio::task::spawn_blocking(move || super::producer::handle(&op, body, conn))
                        .await
                        .unwrap_or_else(|_| Err(WireError::new(super::producer::PRODUCER, "producer chat task failed")));
                    let _ = tx.send(to_frame(id, r));
                });
                continue;
            }
            // 타일 권한 카드(판 22) — 판 21 이하로 붙은 GUI 는 이 op 를 모른다. 잠금 · 대입뿐이라 고리 안에서(몸 · 응답은 로그에 남기지 않는다).
            Routed::Session(_)
                if super::tile_permission::is_op(&op) && negotiated.is_some_and(|p| p < frame::TILE_PERMISSION_PROTOCOL) =>
            {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "tile permission ops need protocol 22"))
            }
            Routed::Session(body) if super::tile_permission::is_op(&op) => to_frame(id, super::tile_permission::handle(&op, body)),
            Routed::Session(body) if super::signals::is_signal_op(&op) => {
                to_frame(id, super::signals::handle(&op, body, &ctx))
            }
            // DB 평면(판 8 — 쿼리 타일) — 블로킹 풀·시간 제한이 있어 태스크로(긴 쿼리가 이 연결의 다른 op 를 막지 않는다).
            // 판 7 로 붙은 GUI 에는 열지 않는다(그 GUI 는 이 op 를 모른다 — 새 GUI 는 보내기 전에 스스로 거른다).
            Routed::Session(_) if super::db_ops::is_db_op(&op) && negotiated.is_some_and(|p| p < frame::DB_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "db ops need protocol 8"))
            }
            // 트랜잭션 작업(판 9) — 판 8 로 붙은 GUI 는 이 op 를 모른다.
            Routed::Session(_) if op == "db_tx" && negotiated.is_some_and(|p| p < frame::DB_TX_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "db_tx needs protocol 9"))
            }
            // 스크립트 실행(판 10) — 판 9 로 붙은 GUI 는 이 op 를 모른다.
            Routed::Session(_) if op == "db_script" && negotiated.is_some_and(|p| p < frame::DB_SCRIPT_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "db_script needs protocol 10"))
            }
            // 연결 테스트(판 28) — 판 27 로 붙은 GUI 는 이 op 를 모른다.
            Routed::Session(_) if op == "db_test" && negotiated.is_some_and(|p| p < frame::DB_TEST_PROTOCOL) => {
                Frame::err(id, WireError::new(code::PROTOCOL_MISMATCH, "db_test needs protocol 28"))
            }
            Routed::Session(body) if super::db_ops::is_db_op(&op) => {
                let ctx = ctx.clone();
                tokio::spawn(async move {
                    let reply = to_frame(id, super::db_ops::handle(&op, body, &ctx).await);
                    let _ = ctx.tx.send(reply);
                });
                continue;
            }
            // SSH 평면의 exec·헤드리스·터널 op(③-3b2) — 기다림이 있어 태스크로.
            Routed::Session(body) if super::ssh_ops::is_ssh_op(&op) => {
                let ctx = ctx.clone();
                tokio::spawn(async move {
                    let reply = to_frame(id, super::ssh_ops::handle(&op, body, &ctx).await);
                    let _ = ctx.tx.send(reply);
                });
                continue;
            }
            Routed::Session(body) if sessions::inline_op(&op) => {
                to_frame(id, sessions::handle(&op, body, &ctx).await)
            }
            Routed::Session(body) => {
                let ctx = ctx.clone();
                tokio::spawn(async move {
                    let reply = to_frame(id, sessions::handle(&op, body, &ctx).await);
                    let _ = ctx.tx.send(reply);
                });
                continue;
            }
        };
        if out_tx.send(reply).is_err() {
            break;
        }
    }
    relay.abort();
    sessions::conn_gone(conn);
    // 그 연결이 연 채널 터널(SFTP)을 닫는다 — SSH 세션 자체는 산다.
    super::tunnel::close_conn(conn);
    let orphaned = crate::agent_signal::orphan_conn(conn);
    if orphaned > 0 {
        log::line(format!("conn {conn} gone — {orphaned} remote signal token(s) kept (orphaned, pruned after 7 idle days)"));
    }
    drop(ctx);
    drop(out_tx);
    // 태스크로 돈 op 가 아직 큐를 쥐고 있을 수 있다 — 쓰기 태스크는 읽는 쪽이 끊겼으니 곧 실패로 끝난다.
    writer.abort();
    let count = shared.clients.fetch_sub(1, Ordering::SeqCst) - 1;
    log::line(format!("client pid {:?} (conn {conn}) gone ({count} now)", peer.pid));
    // 보는 창이 없다 — 볼트를 잠근다(창 0개 = 정지: HTTP 티켓은 지우지 않는다 · GUI kill 대비 · `vault_ops` 머리말).
    if count == 0 {
        super::vault_ops::lock(&shared.plane, crate::vault::LockReason::WindowsZero, "no clients");
        // 검토 카드를 열어 둔 사람도 없다 — 서버 자동 승인이 그 작업안을 더는 건너뛰지 않는다(③-4).
        shared.ai.ops.auto.clear_reviewing();
    }
    let _ = shared.events.send(("clients".into(), json!({ "count": count })));
}

fn to_frame(id: u64, r: Result<Value, WireError>) -> Frame {
    match r {
        Ok(v) => Frame::ok(id, v),
        Err(e) => Frame::err(id, e),
    }
}

/// [`dispatch`] 의 갈래 — 곧바로 답할 것, 또는 세션 op(몸을 넘긴다).
enum Routed {
    Done(Frame),
    Session(Value),
}

/// 요청 하나 → 응답 하나, 또는 세션 op 로 넘김(상태는 `shared`·`negotiated` 뿐).
fn dispatch(shared: &Shared, negotiated: &mut Option<u32>, id: u64, kind: Grade, op: &str, body: Value) -> Routed {
    // 판 협상 전에는 판에 무관한 op 만 — 모르는 판의 몸을 풀지 않는다.
    if negotiated.is_none() && !frame::version_free(op) {
        return Routed::Done(Frame::err(id, WireError::new(code::NEED_HELLO, "send hello first")));
    }
    if let Err(e) = frame::check_grade(op, kind) {
        return Routed::Done(Frame::err(id, e));
    }
    Routed::Done(match op {
        "hello" => {
            let hello: Hello = match serde_json::from_value(body) {
                Ok(h) => h,
                Err(e) => return Routed::Done(Frame::err(id, WireError::new(code::BAD_BODY, e.to_string()))),
            };
            let Some(p) = frame::negotiate(hello.protocol, ProtocolRange::OURS) else {
                log::line(format!(
                    "protocol mismatch — client {:?} ({}) vs server {:?}",
                    hello.protocol, hello.app_version, ProtocolRange::OURS
                ));
                return Routed::Done(Frame::err(
                    id,
                    WireError::new(
                        code::PROTOCOL_MISMATCH,
                        format!(
                            "client {}..={} vs server {}..={}",
                            hello.protocol.min, hello.protocol.max, frame::PROTOCOL_MIN, frame::PROTOCOL_MAX
                        ),
                    ),
                ));
            };
            *negotiated = Some(p);
            let w = Welcome {
                protocol: p,
                server_pid: std::process::id(),
                app_version: shared.app_version.clone(),
                started_at_ms: shared.started_at_ms,
                launch_mode: shared.launch_mode.clone(),
                signal_port: shared.signal_port,
            };
            Frame::ok(id, serde_json::to_value(w).unwrap_or(Value::Null))
        }
        "ping" => Frame::ok(id, json!({ "pong": true, "at_ms": now_ms() })),
        "status" => Frame::ok(id, shared.status()),
        "shutdown" => {
            shared.request_stop("shutdown requested by client".into());
            Frame::ok(id, json!({ "stopping": true }))
        }
        // 나머지는 세션 op·신호 평면 op(`frame::required_grade` 의 표 — 모르는 op 는 check_grade 가 이미 걸렀다).
        _ => return Routed::Session(body),
    })
}

#[cfg(test)]
mod relay_tests {
    use super::*;

    /// 시험 `relay_lagged_becomes_signal`(F8) — 방송이 밀리면 버린 수를 실은 `events-lagged` 하나가 그 자리에 선다(중계는 이어진다) ·
    /// 닫히면 중계 끝 · 보통 이벤트는 그대로.
    #[test]
    fn relay_lagged_becomes_signal() {
        let (tx, mut rx) = broadcast::channel::<(String, Value)>(2);
        for i in 0..5 {
            tx.send(("orchestration-changed".into(), json!({ "seq": i }))).unwrap();
        }
        let first = relay_item(rx.try_recv().map_err(|e| match e {
            broadcast::error::TryRecvError::Lagged(n) => broadcast::error::RecvError::Lagged(n),
            _ => broadcast::error::RecvError::Closed,
        }));
        assert_eq!(first, Some((EVENTS_LAGGED.to_string(), json!({ "dropped": 3 }))));
        let next = relay_item(Ok(rx.try_recv().unwrap()));
        assert_eq!(next, Some(("orchestration-changed".to_string(), json!({ "seq": 3 }))));
        assert_eq!(relay_item(Err(broadcast::error::RecvError::Closed)), None);
    }
}
