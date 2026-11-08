//! MCP 실행 브로커·HTTP 헤더 프록시. 설정 파일과 CLI 인자에는 비밀 값이 실리지 않는다.
//! 볼트에서 값을 읽어 루프백 TCP로 Rust 도우미에 전달하고, 대상 자식에만 심는다.
//! MCP RPC·프런트에는 이 통로가 없다. 비밀은 출력·Debug로 남기지 않는다.
//!
//! **③-3b1 부터 세션 서버 프로세스에 산다**([`Broker`] 한 벌 — `server::serve` 가 볼트와 함께 쥔다). 볼트와 같은
//! 프로세스여야 값이 파이프를 타지 않는다. GUI 는 서버 op `mcp_prepare`·`mcp_retain` 으로만 닿고(`server::vault_ops`),
//! 받는 것은 티켓이 박힌 실행 모양(도우미 인자·프록시 URL)뿐이다. 그래서 GUI 를 강제 종료해도 살아남은 AI CLI 의
//! 외부 MCP 가 이어진다(창 0개 잠금 동안은 정지 — 볼트가 잠겨 값을 내주지 않는다, 해제하면 같은 티켓으로 복구).
//!
//! - 실행 브로커: 127.0.0.1 임시 포트. `aynx mcp-run <포트> <티켓>` 도우미가 **인자로** 포트를 안다(그 인자는 GUI 가
//!   `--mcp-config` 파일·codex `-c` 에 적는다) — 포트가 GUI 것에서 서버 것으로 바뀌었을 뿐 모양은 그대로다.
//! - 헤더 프록시: 127.0.0.1 의 **자기 포트**(`proxy`, 처음 HTTP 티켓을 만들 때 띄운다). 신호 평면(`server::signal_http`)
//!   포트와 합치는 일은 ③-3c(MCP 가 서버로 올 때 한 포트로 모은다).

use crate::i18n::tr;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::agent_mcp::McpServer;
use crate::vault::Vault;

mod proxy;

#[derive(Serialize, Deserialize)]
struct Launch {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    cwd: Option<String>,
}

impl Drop for Launch {
    fn drop(&mut self) {
        for value in self.env.values_mut() {
            value.zeroize();
        }
    }
}

struct Ticket {
    server: McpServer,
    cwd: Option<String>,
}

type Tickets = Arc<Mutex<HashMap<String, Ticket>>>;

/// 실행 브로커 한 벌 — 티켓 표·브로커 포트·(필요할 때 띄우는) 헤더 프록시 포트.
pub(crate) struct Broker {
    port: u16,
    tickets: Tickets,
    vault: Arc<Vault>,
    proxy_port: OnceLock<Result<u16, ()>>,
}

impl Broker {
    /// 브로커를 띄운다(127.0.0.1 임시 포트 + 듣기 스레드 하나).
    pub(crate) fn start(vault: Arc<Vault>) -> Result<Arc<Broker>, ()> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| ())?;
        let port = listener.local_addr().map_err(|_| ())?.port();
        let tickets: Tickets = Arc::new(Mutex::new(HashMap::new()));
        let pending = tickets.clone();
        let reader = vault.clone();
        std::thread::Builder::new()
            .name("mcp-launch".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let _ = serve_with(stream, &pending, |ticket| launch_for(ticket, &reader));
                }
            })
            .map_err(|_| ())?;
        Ok(Arc::new(Broker {
            port,
            tickets,
            vault,
            proxy_port: OnceLock::new(),
        }))
    }

    /// 브로커 포트(`mcp-run` 도우미가 인자로 받는 것).
    pub(crate) fn port(&self) -> u16 {
        self.port
    }

    /// 헤더 프록시 포트 — 아직 HTTP 티켓을 만든 적이 없으면 `None`.
    pub(crate) fn proxy_port(&self) -> Option<u16> {
        self.proxy_port.get().and_then(|r| r.ok())
    }

    /// 환경변수가 있는 서버만 도우미로 감싼다. 자식 재시작에서도 같은 실행 범위를 유지한다.
    /// 돌려주는 모양에는 티켓(도우미 인자·프록시 URL)만 있고 값·변수 이름·헤더 이름은 없다.
    pub(crate) fn prepare(&self, server: &McpServer, cwd: Option<&str>) -> Result<McpServer, String> {
        prepare_with(self, server, cwd, &helper_exe()?)
    }

    /// 저장된 원본 서버 구성과 다른 티켓은 회수한다. 반환 뒤에는 tickets 락을 쥐지 않는다.
    pub(crate) fn retain(&self, saved: &[McpServer]) {
        retain_tickets_in(&self.tickets, saved);
    }

    /// 가림막·사람 잠금 — HTTP 티켓은 다시 열어도 되살리지 않는다. stdio의 기존 경계는 유지한다.
    /// (창 0개 잠금은 이것을 부르지 않는다 — 정지일 뿐이라 해제하면 같은 티켓이 산다.) 폐기한 수.
    pub(crate) fn revoke_http(&self) -> usize {
        revoke_http_tickets_in(&self.tickets)
    }

    /// 살아 있는 티켓의 참조만 모은다. 반환 뒤에는 tickets 락을 쥐지 않는다.
    pub(crate) fn active_secret_refs(&self) -> Result<HashSet<String>, ()> {
        let tickets = self.tickets.lock().map_err(|_| ())?;
        Ok(tickets
            .values()
            .flat_map(|ticket| ticket.server.env.iter().chain(&ticket.server.headers).map(|entry| entry.secret_ref.clone()))
            .collect())
    }

    /// 살아 있는 티켓 수 `(stdio, http)` — 상태 줄·로그용.
    pub(crate) fn counts(&self) -> (usize, usize) {
        let Ok(t) = self.tickets.lock() else { return (0, 0) };
        let http = t.values().filter(|x| x.server.transport == "http").count();
        (t.len() - http, http)
    }
}

/// `mcp-run` 도우미로 띄울 exe — 이 프로세스(세션 서버) 자신. 개발 빌드는 그림자 사본이다(`server::launch` — 같은 바이너리).
fn helper_exe() -> Result<String, String> {
    Ok(std::env::current_exe()
        .map_err(|_| "Could not locate the MCP launcher")?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn launch_for(ticket: &Ticket, vault: &Vault) -> Result<Launch, ()> {
    if ticket.server.transport != "stdio" {
        return Err(());
    }
    let mut launch = Launch {
        command: ticket.server.command.clone().ok_or(())?,
        args: ticket.server.args.clone(),
        env: BTreeMap::new(),
        cwd: ticket.cwd.clone(),
    };
    for entry in &ticket.server.env {
        let value = vault.mcp_env_for(&entry.secret_ref).map_err(|_| ())?;
        launch.env.insert(entry.name.clone(), value.to_string());
    }
    Ok(launch)
}

fn serve_with(
    mut stream: TcpStream,
    tickets: &Tickets,
    resolve: impl FnOnce(&Ticket) -> Result<Launch, ()>,
) -> Result<(), ()> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| ())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| ())?;
    let mut token = Zeroizing::new([0u8; 64]);
    stream.read_exact(token.as_mut()).map_err(|_| ())?;
    let token = std::str::from_utf8(token.as_ref()).map_err(|_| ())?;
    let launch = {
        let pending = tickets.lock().map_err(|_| ())?;
        let ticket = pending.get(token).ok_or(())?;
        resolve(ticket)?
    };
    let body = Zeroizing::new(serde_json::to_vec(&launch).map_err(|_| ())?);
    let size = u32::try_from(body.len()).map_err(|_| ())?;
    stream.write_all(&size.to_be_bytes()).map_err(|_| ())?;
    stream.write_all(&body).map_err(|_| ())
}

fn prepare_with(broker: &Broker, server: &McpServer, cwd: Option<&str>, exe: &str) -> Result<McpServer, String> {
    if server.env.is_empty() && server.headers.is_empty() {
        return Ok(server.clone());
    }
    let proxy_port = if server.transport == "http" {
        Some(
            (*broker
                .proxy_port
                .get_or_init(|| proxy::start(&broker.tickets, broker.vault.clone())))
            .map_err(|_| "MCP 헤더 프록시를 시작하지 못했습니다")?,
        )
    } else {
        None
    };
    let mut pending = broker
        .tickets
        .lock()
        .map_err(|_| "Could not prepare the MCP launcher")?;
    let token = if let Some((token, _)) = pending
        .iter()
        .find(|(_, ticket)| ticket.server == *server && ticket.cwd.as_deref() == cwd)
    {
        token.clone()
    } else {
        if pending.len() >= 4096 {
            return Err("Too many active MCP launch configurations".into());
        }
        let token = crate::token::generate_token().ok_or("Could not prepare the MCP launcher")?;
        pending.insert(
            token.clone(),
            Ticket {
                server: server.clone(),
                cwd: cwd.map(str::to_owned),
            },
        );
        token
    };
    let mut prepared = server.clone();
    if let Some(port) = proxy_port {
        prepared.url = Some(format!("http://127.0.0.1:{port}/mcp-proxy/{token}"));
        prepared.headers.clear();
    } else {
        prepared.command = Some(exe.to_owned());
        prepared.args = vec!["mcp-run".into(), broker.port.to_string(), token];
        prepared.env.clear();
    }
    Ok(prepared)
}

fn retain_tickets_in(tickets: &Tickets, saved: &[McpServer]) {
    if let Ok(mut pending) = tickets.lock() {
        pending.retain(|_, ticket| saved.contains(&ticket.server));
    }
}

fn revoke_http_tickets_in(tickets: &Tickets) -> usize {
    let Ok(mut pending) = tickets.lock() else { return 0 };
    let before = pending.len();
    pending.retain(|_, ticket| ticket.server.transport != "http");
    before - pending.len()
}

#[cfg(windows)]
fn executable(command: &str, cwd: Option<&str>) -> std::path::PathBuf {
    let path = std::path::PathBuf::from(command);
    let path = if path.is_relative() {
        cwd.map_or_else(|| path.clone(), |cwd| std::path::Path::new(cwd).join(&path))
    } else {
        path
    };
    if path.is_file() {
        return path;
    }
    // 경로가 있는 명령은 실행 폴더 기준이다. 파일이 없어도 도우미 폴더에서 찾지 않는다.
    if command.contains(['/', '\\']) || std::path::Path::new(command).is_absolute() {
        return path;
    }
    // PATH의 npx.cmd/uv.exe 등도 찾는다. 인자는 Command가 인용한다.
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        for ext in extensions.split(';') {
            let candidate = dir.join(format!("{command}{ext}"));
            if candidate.is_file() {
                return candidate;
            }
        }
        let candidate = dir.join(command);
        if candidate.is_file() {
            return candidate;
        }
    }
    path
}

#[cfg(not(windows))]
fn executable(command: &str, _cwd: Option<&str>) -> std::path::PathBuf {
    command.into()
}

fn fetch_launch(port: u16, token: &str) -> Result<Launch, ()> {
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(());
    }
    let mut stream =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(5))
            .map_err(|_| ())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| ())?;
    stream.write_all(token.as_bytes()).map_err(|_| ())?;
    let mut size = [0u8; 4];
    stream.read_exact(&mut size).map_err(|_| ())?;
    let size = u32::from_be_bytes(size) as usize;
    if size > 1024 * 1024 {
        return Err(());
    }
    let mut body = Zeroizing::new(vec![0; size]);
    stream.read_exact(&mut body).map_err(|_| ())?;
    serde_json::from_slice(&body).map_err(|_| ())
}

fn child_command(launch: &Launch) -> Command {
    let mut command = Command::new(executable(&launch.command, launch.cwd.as_deref()));
    command
        .args(&launch.args)
        .envs(&launch.env)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if let Some(cwd) = &launch.cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn run(port: u16, token: &str) -> Result<i32, ()> {
    let launch = fetch_launch(port, token)?;
    let mut command = child_command(&launch);
    let mut child = command.spawn().map_err(|_| ())?;
    drop(command);
    drop(launch);
    child
        .wait()
        .map(|status| status.code().unwrap_or(1))
        .map_err(|_| ())
}

#[cfg(test)]
mod tests;

pub(crate) fn helper_main() -> i32 {
    let result = (|| {
        let mut args = std::env::args().skip(2);
        let port = args.next().ok_or(())?.parse().map_err(|_| ())?;
        let token = Zeroizing::new(args.next().ok_or(())?);
        run(port, &token)
    })();
    result.unwrap_or_else(|()| {
        eprintln!("[aynx] {}", tr!(ko: "MCP 서버를 실행할 수 없습니다. 서버 설정을 확인하고 AYNX 에서 볼트 잠금을 해제하세요.", en: "MCP server could not start. Check the server settings and unlock the vault in AYNX."));
        1
    })
}
