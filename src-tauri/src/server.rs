//! 세션 서버 — `aynx session-server`(분리 프로세스)와 그것을 찾거나 띄워 붙는 GUI 쪽 클라이언트.
//!
//! 로컬 PTY · SSH(풀 · 포워드 · 헤드리스) · 신호 · 볼트 · AI(MCP · 거울 · 작업안) · DB · 메신저 다리 평면이 서버에 산다 — GUI 가 꺼져도 산다.
//! 볼트 값은 서버 프로세스 밖으로 나가지 않는다. GUI 가 원격에 닿는 길은 둘뿐이다 — `ssh_exec` 와 채널 터널(SFTP).
//!
//! ## 나눔
//!
//! `*_proxy` · `client` · `launch` 는 GUI, `ipc/` · `discovery` · `os` · `ssh_ops` · `tunnel` · `resources` 는 둘 다, 나머지는 서버다.
//!
//! ## 불변식
//!
//! - **인스턴스 잠금의 실체는 파이프 선점**(`FIRST_PIPE_INSTANCE`) — 둘째 서버는 로그 한 줄 남기고 조용히 끝난다. `server.json` 은 안내다(비밀 없음).
//! - **상대 확인은 양방향**: 서버는 클라이언트 exe 를, GUI 는 서버 exe 를 본다. 불일치는 즉시 끊고 로그.
//! - **승인 등급은 `ops_approve` 하나만 받는다** — 승인 프레임은 GUI 의 사람 행동(Tauri 명령 `approve_operation`)에서만 만들어지고
//!   (`client::request_approve` — 시험이 소스를 훑어 고정), 서버는 받아도 판정을 다시 한다(`operations::approval::approve_in`).
//! - **파이프를 중계하는 CLI 하위 명령을 만들지 않는다** — 하위 명령은 `session-server` 하나뿐이다.

pub(crate) mod ai;
pub(crate) mod ai_proxy;
pub(crate) mod chat_proc;
pub(crate) mod chat_tile;
pub(crate) mod chat_tile_proxy;
pub(crate) mod client;
pub(crate) mod credit;
pub(crate) mod db_ops;
pub(crate) mod db_proxy;
pub(crate) mod discovery;
pub(crate) mod hub;
pub(crate) mod ipc;
pub(crate) mod launch;
pub(crate) mod log;
pub(crate) mod messenger_bridge;
pub(crate) mod messenger_bridge_proxy;
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

/// 클라이언트 0개 · 살아 있는 세션 0개 · 진행 중 작업안 0개가 이만큼 이어지면 서버가 스스로 끝난다.
const DEFAULT_IDLE: Duration = Duration::from_secs(600);

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.iter().position(|a| a == key).and_then(|i| args.get(i + 1).cloned())
}

/// `aynx session-server [--launch-mode M] [--origin EXE] [--idle-secs N]` — 돌려주는 값은 프로세스 종료 코드다.
pub(crate) fn session_server_main() -> i32 {
    // 가장 먼저 — 셸을 띄우기 전에 물려받은 "Ctrl+C 무시" 를 걷는다(`os::enable_ctrl_c_for_children` 머리말).
    os::enable_ctrl_c_for_children();
    // mysql_async 의 `ClientConfig::builder()` 는 켜진 공급자가 둘 이상이면(어떤 의존이 `rustls/ring` 을 켜는 날) 패닉한다 —
    // 세션 서버가 DB 접속 하나로 죽지 않게 진입에서 한 번 정해 둔다(docs/log/2026-10-12-query-tile.md).
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
    // 개발 빌드는 그림자 사본에서 돈다 — 원본 exe(GUI)도 클라이언트로 받는다. 릴리스는 자기 이미지 하나.
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
        messenger_bridge: true,
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
    // 자진 종료 판정(`serve::Busy`)에는 끼지 않는다.
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
