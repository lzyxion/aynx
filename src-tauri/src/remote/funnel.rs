//! Funnel 문지기 — 이 포트가 공개 인터넷(`tailscale funnel`)에 나가 있는지 본다. 관문은 tailnet 안 브라우저만 상대한다는 전제라,
//! Funnel 이 이 포트를 가리키면 관문을 열지 않는다(열려 있으면 닫는다).
//!
//! - `ServeConfig` 의 모르는 칸은 무시한다(관대한 해석). CLI 가 없거나 · tailscaled 가 안 돌거나 · JSON 이 아니면 "모름" — 관문은 열되 상태가 까닭을 말한다.
//! - 블로킹이다 — 부르는 쪽이 `spawn_blocking` 으로 감싼다.
//! - 여기는 읽기만 한다. 어느 쪽에도 Funnel 을 켜는 길은 없다(`serve.rs` 도 고정 인자).

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::i18n::tr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Funnel {
    Off,
    On,
    /// 까닭(사용자 문구).
    Unknown(String),
}

impl Funnel {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Funnel::Off => "off",
            Funnel::On => "on",
            Funnel::Unknown(_) => "unknown",
        }
    }
}

/// 넘기면 죽이고 "모름".
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
/// 페어링 응답을 잡고 있으므로 짧게.
const WHOIS_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) fn check(port: u16) -> Funnel {
    let Some(bin) = tailscale_binary() else {
        return Funnel::Unknown(tr!(
            ko: "tailscale CLI 없음 — serve 확인 불가",
            en: "No tailscale CLI — cannot check serve"
        ));
    };
    // `funnel status` 와 `serve status` 는 같은 ServeConfig 를 낸다 — 옛 CLI 에 앞의 것이 없으면 뒤의 것으로.
    let out = run_status(&bin, &["funnel", "status", "--json"])
        .or_else(|_| run_status(&bin, &["serve", "status", "--json"]));
    match out {
        Ok(json) => match port_is_funneled(&json, port) {
            Ok(true) => Funnel::On,
            Ok(false) => Funnel::Off,
            Err(e) => Funnel::Unknown(tr!(
                ko: "tailscale 상태를 해석하지 못했습니다: {e}",
                en: "Could not parse the tailscale status: {e}",
                e = e
            )),
        },
        Err(e) => Funnel::Unknown(tr!(
            ko: "tailscale 상태를 읽지 못했습니다(tailscale 이 꺼져 있나요?): {e}",
            en: "Could not read the tailscale status (is tailscale running?): {e}",
            e = e
        )),
    }
}

pub(crate) fn tailscale_binary() -> Option<PathBuf> {
    let name = format!("tailscale{}", std::env::consts::EXE_SUFFIX);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(&name))
        .chain(known_install_paths())
        .find(|p| p.is_file())
}

/// PATH 에 없을 때 볼 OS 별 기본 설치 자리 — OS 분기는 여기 하나.
///
/// - Windows: 앱이 PATH 갱신 전 환경을 물려받을 수 있다.
/// - Linux: 패키지가 PATH 위에 둔다 — 따로 볼 자리 없음(빈 목록).
/// - macOS: 확인 전(빈 목록 스텁) — App Store 판은 앱 번들 안에 CLI 가 있어 나중에 여기 더한다.
fn known_install_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        vec![base.join("Tailscale").join("tailscale.exe")]
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CliExit {
    Success,
    Failed,
    TimedOut,
}

/// 출력은 시한 초과에도 그때까지 받은 만큼 남는다.
#[derive(Debug, Clone)]
pub(crate) struct CliRun {
    pub stdout: String,
    pub stderr: String,
    pub exit: CliExit,
}

/// 0 이 아닌 종료는 표준 오류 첫 줄로 실패.
pub(crate) fn run_status(bin: &Path, args: &[&str]) -> Result<String, String> {
    let run = run_capture(bin, args, CLI_TIMEOUT)?;
    match run.exit {
        CliExit::Success => Ok(run.stdout),
        CliExit::TimedOut => Err(format!("timeout {}s", CLI_TIMEOUT.as_secs())),
        CliExit::Failed => Err(run.stderr.lines().next().unwrap_or("exit").trim().to_string()),
    }
}

/// 콘솔 창 없이 · 표준 입력 없음. 시한을 넘기면 죽이고 그때까지의 출력을 돌려준다.
pub(crate) fn run_capture(bin: &Path, args: &[&str], timeout: Duration) -> Result<CliRun, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    // 출력은 따로 읽는다 — 파이프가 차서 자식이 멈추면 시한까지 기다리게 된다.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out = drain(stdout, 4 * 1024 * 1024);
    let err = drain(stderr, 64 * 1024);
    let deadline = Instant::now() + timeout;
    let exit = loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break CliExit::Success,
            Ok(Some(_)) => break CliExit::Failed,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break CliExit::TimedOut;
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(CliRun {
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        exit,
    })
}

fn drain<R: std::io::Read + Send + 'static>(pipe: Option<R>, max: u64) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = pipe {
            use std::io::Read as _;
            let _ = p.take(max).read_to_string(&mut s);
        }
        s
    })
}

/// 빈 출력 · `{}` · `null` = 설정 없음(꺼짐).
pub(crate) fn port_is_funneled(json: &str, port: u16) -> Result<bool, String> {
    let json = json.trim();
    if json.is_empty() {
        return Ok(false);
    }
    let value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(config_funnels(&value, port, 0))
}

pub(super) fn config_funnels(cfg: &Value, port: u16, depth: u8) -> bool {
    if depth > 4 {
        return false;
    }
    let funneled = cfg
        .get("AllowFunnel")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, on)| on.as_bool() == Some(true))
        .any(|(host_port, _)| {
            let web = cfg
                .get("Web")
                .and_then(|w| w.get(host_port))
                .and_then(|w| w.get("Handlers"))
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .any(|(_, h)| {
                    h.get("Proxy")
                        .and_then(Value::as_str)
                        .is_some_and(|p| targets_port(p, port))
                });
            let tcp = host_port
                .rsplit(':')
                .next()
                .and_then(|p| cfg.get("TCP")?.get(p)?.get("TCPForward")?.as_str())
                .is_some_and(|f| targets_port(f, port));
            web || tcp
        });
    funneled
        || cfg
            .get("Foreground")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, inner)| config_funnels(inner, port, depth + 1))
}

/// `http://127.0.0.1:47821` · `localhost:47821/x` · `47821` …
pub(crate) fn targets_port(target: &str, port: u16) -> bool {
    let rest = target
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(target)
        .trim();
    let authority = rest.split('/').next().unwrap_or("");
    let (host, p) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, p),
        None => ("", authority),
    };
    let local = matches!(
        host.to_ascii_lowercase().as_str(),
        "" | "127.0.0.1" | "localhost" | "[::1]" | "0.0.0.0"
    );
    local && p.parse::<u16>().ok() == Some(port)
}

/// `Self.DNSName` — 끝의 `.` 를 걷고 소문자. `*.ts.net` 모양이 아니면 `None`.
pub(crate) fn self_dns_name(json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(json.trim()).ok()?;
    let name = value.get("Self")?.get("DNSName")?.as_str()?;
    let name = name.trim().trim_end_matches('.').to_ascii_lowercase();
    super::valid_ts_host(&name).then_some(name)
}

/// `Node.Hostinfo.Hostname`(기기가 알린 이름 — 겹칠 수 있다)이 먼저, 없거나 비었으면 `Node.ComputedName`(tailnet 안에서 유일).
pub(crate) fn whois_node_name(json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(json.trim()).ok()?;
    let node = value.get("Node")?;
    let usable = |field: Option<&Value>| field.and_then(Value::as_str).map(super::auth::label).filter(|name| !name.is_empty());
    let hostname = node.get("Hostinfo").and_then(|h| h.get("Hostname"));
    usable(hostname).or_else(|| usable(node.get("ComputedName")))
}

/// 블로킹. 어떤 실패든 `None` — 표시 이름이 UA 이름으로 돌아갈 뿐이다.
pub(crate) fn whois_node(ip: IpAddr) -> Option<String> {
    let bin = tailscale_binary()?;
    let ip = ip.to_string();
    let run = run_capture(&bin, &["whois", "--json", &ip], WHOIS_TIMEOUT).ok()?;
    if run.exit != CliExit::Success {
        return None;
    }
    whois_node_name(&run.stdout)
}

/// 블로킹. 실패는 사용자 문구.
pub(crate) fn detect_host() -> Result<String, String> {
    let bin = tailscale_binary().ok_or_else(|| {
        tr!(
            ko: "tailscale CLI 를 찾지 못했습니다 — Tailscale 을 설치했는지 보세요",
            en: "Could not find the tailscale CLI — is Tailscale installed?"
        )
    })?;
    let out = run_status(&bin, &["status", "--json"]).map_err(|e| {
        tr!(
            ko: "tailscale 상태를 읽지 못했습니다(tailscale 이 꺼져 있나요?): {e}",
            en: "Could not read the tailscale status (is tailscale running?): {e}",
            e = e
        )
    })?;
    self_dns_name(&out).ok_or_else(|| {
        tr!(
            ko: "이 기기의 MagicDNS 이름(*.ts.net)을 찾지 못했습니다 — tailnet 관리 화면에서 MagicDNS 를 켰는지 보세요",
            en: "Could not find this device's MagicDNS name (*.ts.net) — check that MagicDNS is on in the tailnet admin"
        )
    })
}
