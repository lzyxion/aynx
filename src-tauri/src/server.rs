//! 세션 서버 — `aynx session-server`(분리 프로세스)와 그것을 찾거나 띄워 붙는 GUI 쪽 클라이언트
//! (설계 `docs/internal/session-server-design-2026-10-08.md` 4.1·4.2·4.6 · 9절 ③).
//!
//! **③-2**: 서버는 뜨고, 파이프를 선점하고, 상대를 확인하고, **로컬 PTY 세션의 주인**이다(`sessions` — 열기·쓰기·붙기·
//! 떨어지기·이관·닫기 · 출력 프레임 + ACK 크레딧 `credit`). GUI 연결이 끊겨도(GUI 종료·kill) 세션은 `Detached` 로 산다.
//! GUI 의 로컬 Tauri 명령은 같은 이름의 프록시(`proxy`)다. SSH·MCP·작업안은 아직 GUI 프로세스에 있다(③-3b2·③-3c) — 볼트는 ③-3b1 부터 서버.
//!
//! **③-3a**: 신호 평면 — 신호 토큰 표·에이전트 상태 표·`/agent-signal` 수신이 서버에 산다(`signal_http` · `signals`). GUI 를
//! 강제 종료했다 다시 켜도 살아남은 셸(로컬·원격)의 훅 신호가 그대로 받아들여지고 상태 점이 이어진다.
//!
//! **③-3b1**: 볼트 평면 — 금고(`vault.bin`·키·열림/잠김)·외부 MCP 실행 브로커(`mcp-run` 티켓)·HTTP 헤더 프록시
//! (`/mcp-proxy/<티켓>`)가 서버에 산다(`vault_ops`). 볼트 값은 서버 프로세스 밖으로 나가지 않는다.
//! GUI 를 강제 종료해도 살아남은 AI CLI 의 외부 MCP 티켓이 남고(창 0개 잠금 동안 정지), 가림막을 걷으면 이어진다.
//!
//! **③-3b2**: SSH 평면 — 대화형 SSH 세션(`crate::ssh`)·연결 풀·포트 포워드(-L/-R/-D·에이전트 포워딩·신호 `-R`)·헤드리스 위임
//! 접속·원격 신호 파일·SSH 세션 로그가 서버에 산다. GUI 종료·kill·quitAll 뒤에도 원격 셸·tmux 클라이언트·포워드·신호가 살고, 다시
//! 켜면 같은 세션에 붙는다. GUI 가 원격에 닿는 길은 둘뿐이다 — `ssh_exec`(git·실행기 — 명령은 GUI Rust 가 조립)와 채널 터널
//! (SFTP — GUI 의 russh-sftp 가 그 위에서 돈다). SSH 인증은 금고를 같은 프로세스에서 읽는다(③-3b1 의 과도기 op 삭제).
//!
//! ## 나눔
//!
//! | 자리 | 하는 일 | 어느 프로세스 |
//! | --- | --- | --- |
//! | 이 파일 | 하위 명령 진입(`session_server_main` — 인자·로그·런타임) | 서버 |
//! | `serve` | 선점·찾기 파일·접속마다 상대 확인·op 표(`dispatch`)·고아 자진 종료(`IdleGuard`)·정상 종료 마감 | 서버 |
//! | `ipc/` | 프레임 셋·판 협상·등급(`frame`) · 파이프 이름·DACL·선점·상대 pid/exe(`transport`) | 둘 다 |
//! | `discovery` | `data_root()/server.json` 읽기·원자 교체·제 것만 지우기 | 둘 다 |
//! | `os` | 이미지 경로·생존·자기 잡·자식 트리 종료·분리 실행(cfg 함수 하나씩, 유닉스는 스텁) | 둘 다 |
//! | `launch` | 띄울 exe(개발 빌드는 그림자 사본)·믿을 서버 판정·띄우기·기다리기 | GUI |
//! | `client` | 연결 하나·재연결·요청 짝 맞춤·이벤트·출력 중계 · Tauri 명령 `session_server_status`·`_restart`·`_close_all` | GUI |
//! | `sessions` | 로컬 세션 op · 연결 싱크 · 연결 끊김 = 임대 해제 | 서버 |
//! | `credit` | ACK 크레딧(임대별·전체 예산) | 서버 |
//! | `signal_http` | 신호 평면 — 127.0.0.1 임시 포트의 `/agent-signal`(신호 전용 토큰만) → 상태 표 → 이벤트 `agent-signal` | 서버 |
//! | `signals` | 신호 평면 op(`signal_issue`·`signal_revoke`·`signal_written`·`signal_live`·`agent_states_snapshot`·`agent_state_forget`·`agent_state_seen`·`agent_conversation_links`·`agent_conversation_launched`) | 서버 |
//! | `vault_ops` | 볼트 평면 op(`vault_*`·`mcp_prepare`·`mcp_retain`) — 금고·실행 브로커·헤더 프록시의 주인 · 클라이언트 0 = 창 0개 잠금 | 서버 |
//! | `hub` | 서버 안의 공용 손잡이 — 이벤트 방송 · 신호 포트 · 금고(SSH 평면이 쓴다) | 서버 |
//! | `ssh_ops` | SSH 평면의 `ssh_exec`·헤드리스·터널·copy-id op(서버) + 그 GUI 껍데기(`ExecHandle::Server` · 헤드리스 거울·라우팅) | 둘 다 |
//! | `tunnel` | 채널 터널(SFTP 서브시스템 바이트 ⇄ `Channel` 프레임 · 양방향 크레딧) — 서버 펌프와 GUI 이음 스트림 | 둘 다 |
//! | `ssh_proxy` | SSH 타일 Tauri 명령(`open_ssh_session`·`session_info`·포워드) — 같은 이름의 서버 op 프록시 | GUI |
//! | `proxy` | 로컬 Tauri 명령 프록시 · 출력 경로표 · 서버 멈춤 처리 · 신호 평면 op 의 GUI 쪽 껍데기 | GUI |
//! | `vault_proxy` | `vault_*` Tauri 명령(같은 이름) · AI 타일의 `mcp_prepare` · 설정 저장의 티켓 회수·정리 · 마지막 창 잠금 · 과도기 자격증명 | GUI |
//! | `ai` | **AI 평면**(③-3c) — MCP `/mcp`·`mcp.json`·거울·라우팅·작업안·결과·실행기·감사 · op(`ctx_batch`·`ops_*`·`mcp_*` …) | 서버 |
//! | `ai_proxy` | 거울 Tauri 명령(순서 큐 → `ctx_batch`) · MCP 좌표·토큰 묻기 · 관제판 목록 · `agent-mcp` 주장 | GUI |
//! | `db_ops` | **DB 평면 op**(판 8 — 쿼리 타일: `db_open`·`db_query`·`db_cancel`·`db_schema`·`db_objects`·`db_table_detail`·`db_definition`·`db_set_write`·`db_close`) — 몸은 `crate::db` | 서버 |
//! | `db_proxy` | 쿼리 타일 Tauri 명령(같은 이름) — 판 8 미만 서버면 보내지 않고 "재시작 필요" | GUI |
//! | `log` | `data_root()/server.log`(1 MiB × 2) | 서버 |
//! | `resources` | **로컬 자원 모니터**(판 18) — op `resource_snapshot`(읽기 · 관찰 임대) · 표본 스레드(보일 때만) + Tauri 명령 같은 이름 | 둘 다 |
//!
//! ## 불변식
//!
//! - **인스턴스 잠금의 실체는 파이프 선점**(`FIRST_PIPE_INSTANCE`) — 둘째 서버는 err 5 를 보고 로그 한 줄 남기고 조용히 끝난다.
//!   `server.json` 은 안내다(비밀 없음).
//! - **상대 확인은 양방향**: 서버는 클라이언트 exe 를, GUI 는 서버 exe 를 `QueryFullProcessImageNameW` 로 본다. 불일치는 즉시 끊고 로그.
//! - **승인 등급은 `ops_approve` 하나만 받는다**(③-3c) — 승인 프레임은 GUI 의 사람 행동(Tauri 명령 `approve_operation`)에서만
//!   만들어지고(`client::request_approve` — 시험이 소스를 훑어 고정), 서버는 받아도 판정을 다시 한다(`operations::approval::approve_in`).
//!
//! **③-3c**: AI 평면 — MCP(`/mcp`, 신호 평면과 한 리스너)·`mcp.json`(주인 = 서버)·거울·라우팅·작업안 저장소·결과·실행기·만료·감사가
//! 서버에 산다(`ai`). GUI 가 없어도 AI 타일의 CLI 가 같은 포트로 세션을 읽고, 승인된 작업안이 끝까지 돈다. ③-4 부터 사전 정책 자동 승인의 시계도 서버다(`operations::auto` — 창 0개에도) · 떨어진 세션 목록(`sessions_detached`) · 찾기 파일의 세션 수(설치기 경고).
//! - **파이프를 중계하는 CLI 하위 명령을 만들지 않는다** — 하위 명령은 `session-server` 하나뿐이다.

pub(crate) mod ai;
pub(crate) mod ai_proxy;
pub(crate) mod chat_proc;
pub(crate) mod client;
pub(crate) mod credit;
pub(crate) mod db_ops;
pub(crate) mod db_proxy;
pub(crate) mod discovery;
pub(crate) mod hub;
pub(crate) mod ipc;
pub(crate) mod launch;
pub(crate) mod log;
pub(crate) mod orchestration_proxy;
pub(crate) mod os;
pub(crate) mod producer;
pub(crate) mod producer_proxy;
pub(crate) mod proxy;
pub(crate) mod resources;
pub(crate) mod serve;
pub(crate) mod sessions;
pub(crate) mod side_chat;
pub(crate) mod side_chat_proxy;
pub(crate) mod signal_http;
pub(crate) mod signals;
pub(crate) mod ssh_ops;
pub(crate) mod ssh_proxy;
pub(crate) mod tile_permission;
pub(crate) mod tile_permission_proxy;
pub(crate) mod tunnel;
pub(crate) mod vault_ops;
pub(crate) mod vault_proxy;
pub(crate) mod workers;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_side_chat;

use std::time::Duration;

/// 클라이언트 0개 · 살아 있는 세션 0개 · 진행 중 작업안 0개가 이만큼 이어지면 서버가 스스로 끝난다(설계 4.1).
const DEFAULT_IDLE: Duration = Duration::from_secs(600);

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.iter().position(|a| a == key).and_then(|i| args.get(i + 1).cloned())
}

/// `aynx session-server [--launch-mode M] [--origin EXE] [--idle-secs N]` — Tauri·웹뷰 없이 끝까지 돈다.
/// 돌려주는 값은 프로세스 종료 코드다(정상 종료·다른 서버가 이미 있음 = 0).
pub(crate) fn session_server_main() -> i32 {
    // 가장 먼저 — 셸을 띄우기 전에 물려받은 "Ctrl+C 무시" 를 걷는다(`os::enable_ctrl_c_for_children` 머리말).
    os::enable_ctrl_c_for_children();
    // rustls 의 전역 기본 암호 공급자를 aws-lc-rs 로 못 박는다(이미 설치돼 있으면 그대로 — 결과는 버린다). mysql_async 는 TLS 설정을
    // `ClientConfig::builder()` 로 짜는데, 그 함수는 기능으로 켜진 공급자가 **둘 이상**이면(어떤 의존이 `rustls/ring` 을 켜는 날)
    // 기본 공급자를 고르지 못해 패닉한다. 지금은 aws-lc-rs 하나뿐이라 괜찮지만, 그날 세션 서버가 DB 접속 하나로 죽지 않게 진입에서
    // 한 번 정해 둔다(쿼리 타일 스파이크 함정 1 — docs/log/2026-10-12-query-tile.md). 다른 사용자(reqwest · russh 등)는
    // 공급자를 직접 넘기므로 이것과 무관하다.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let args: Vec<String> = std::env::args().skip(2).collect();
    if let Some(p) = crate::instance::data_root() {
        log::init(p.join("server.log"));
    }
    let Some(pipe) = ipc::transport::endpoint() else {
        log::line("session server is not implemented on this OS");
        return 1;
    };
    let own = os::own_image();
    let mut trusted: Vec<String> = own.iter().cloned().collect();
    // 개발 빌드는 그림자 사본에서 돈다(`launch` 머리말) — 원본 exe(GUI)도 클라이언트로 받는다. 릴리스는 자기 이미지 하나.
    if crate::instance::DEV {
        trusted.extend(arg_value(&args, "--origin"));
    }
    let idle = arg_value(&args, "--idle-secs")
        .or_else(|| std::env::var("AYNX_SERVER_IDLE_SECS").ok())
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&s| s > 0)
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_IDLE);
    let cfg = serve::Config {
        pipe,
        discovery: discovery::path(),
        idle,
        launch_mode: arg_value(&args, "--launch-mode").unwrap_or_else(|| "manual".into()),
        own_job: true,
        kill_tree: true,
        trusted_clients: trusted,
        app_version: env!("CARGO_PKG_VERSION").into(),
        vault_dir: None,
        audit_dir: crate::audit::audit_dir(),
        mcp_json: crate::mcp::config_path(),
        db_conns: None,
        orchestration_dir: crate::orchestration::store_dir(),
    };
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            log::line(format!("tokio runtime: {e}"));
            return 1;
        }
    };
    // 자원 표본 스레드(`resources` 머리말) — 서버가 뜨면 곧바로 선다. 세션이 0 이면 쉬고(프로세스 목록을 읽지 않는다), 세션이
    // 생기면 GUI 없이도 잰다(GUI 가 꺼져 있던 동안의 이력). 자진 종료 판정(`serve::Busy`)에는 끼지 않는다.
    resources::start();
    let exit = rt.block_on(async {
        let exit = serve::run(cfg).await;
        // 마지막 응답(`shutdown` 의 ok)이 파이프로 나갈 틈.
        tokio::time::sleep(Duration::from_millis(200)).await;
        exit
    });
    match exit {
        serve::Exit::Shutdown(_) | serve::Exit::AlreadyRunning => 0,
        serve::Exit::Failed(_) => 1,
    }
}
