//! Funnel 문지기 — `tailscale funnel status --json` 으로 **이 포트가 공개 인터넷에 나가 있는지** 본다(설계 13절 "실수 방지").
//!
//! `tailscale serve` 는 tailnet 안만, `tailscale funnel` 은 **인터넷 전체**에 연다. 관문은 아직(그리고 앞으로도) tailnet 안
//! 브라우저만 상대한다는 전제라, Funnel 이 이 포트를 가리키면 관문을 열지 않는다(열려 있으면 닫는다 — `gateway::run`).
//!
//! - 읽는 것은 `ipn.ServeConfig` JSON 이다: `AllowFunnel{"<이름>:<https 포트>": true}` 인 자리의 `Web[..].Handlers[..].Proxy`
//!   또는 `TCP[<포트>].TCPForward` 가 `127.0.0.1:<우리 포트>`(·`localhost`·`[::1]`·포트만)를 가리키면 "켜짐".
//!   `Foreground{<세션>: ServeConfig}`(전경 `tailscale funnel` 실행)도 같은 규칙으로 들여다본다. 모르는 칸은 무시한다(관대한 해석).
//! - CLI 가 없거나·tailscaled 가 안 돌거나·JSON 이 아니면 **"모름"** — 관문은 열되 상태가 그 까닭을 말한다(serve 도 확인 불가).
//! - 실행 파일 찾기에서 OS 를 타는 것은 [`known_install_paths`] **하나**다(PATH 찾기는 OS 무관 — `EXE_SUFFIX`).
//! - 블로킹이다(프로세스 실행 + 시한 10초) — 부르는 쪽이 `spawn_blocking` 으로 감싼다.
//! - 페어링 요청의 기본 기기 이름을 찾는 `tailscale whois`([`whois_node`])도 여기 있다 — 인자는 고정 + 파싱된 `IpAddr` 하나 · 시한 3초 · 실패는 조용히 `None`.
//! - 여기는 **읽기만** 한다. [연결] 이 부르는 `tailscale serve` 실행은 `serve.rs`(같은 [`run_capture`] 길 · 고정 인자)이고, 어느 쪽에도 Funnel 을 켜는 길은 없다.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::i18n::tr;

/// Funnel 판정.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Funnel {
    Off,
    On,
    /// 확인하지 못했다 — 까닭(사용자 문구).
    Unknown(String),
}

impl Funnel {
    /// `remote_status` 의 `funnel` 칸.
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Funnel::Off => "off",
            Funnel::On => "on",
            Funnel::Unknown(_) => "unknown",
        }
    }
}

/// CLI 한 번의 시한 — 넘기면 죽이고 "모름".
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
/// `whois` 한 번의 시한 — 페어링 응답을 잡고 있으므로 짧게.
const WHOIS_TIMEOUT: Duration = Duration::from_secs(3);

/// 이 포트가 Funnel 로 나가 있는가 — CLI 를 부른다(블로킹).
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

/// `tailscale` 실행 파일 — PATH 먼저, 그다음 OS 별 기본 설치 자리.
pub(crate) fn tailscale_binary() -> Option<PathBuf> {
    let name = format!("tailscale{}", std::env::consts::EXE_SUFFIX);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(&name))
        .chain(known_install_paths())
        .find(|p| p.is_file())
}

/// PATH 에 없을 때 볼 OS 별 기본 설치 자리 — **OS 분기는 여기 하나**(CLAUDE.md · `cwd.rs` 본보기).
///
/// - Windows: 설치기는 `C:\Program Files\Tailscale\tailscale.exe` 에 두고 PATH 에도 올리지만, 앱이 PATH 갱신 전 환경을 물려받을 수 있다.
/// - Linux: 패키지가 `/usr/bin` 등 PATH 위에 둔다 — 따로 볼 자리 없음(빈 목록).
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

/// CLI 한 번이 어떻게 끝났나.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CliExit {
    Success,
    Failed,
    /// 시한을 넘겨 죽였다.
    TimedOut,
}

/// CLI 한 번의 결과 — 출력은 시한 초과에도 그때까지 받은 만큼 남는다.
#[derive(Debug, Clone)]
pub(crate) struct CliRun {
    pub stdout: String,
    pub stderr: String,
    pub exit: CliExit,
}

/// CLI 를 시한 안에서 돌려 표준 출력을 받는다. 0 이 아닌 종료는 표준 오류 첫 줄로 실패.
pub(crate) fn run_status(bin: &Path, args: &[&str]) -> Result<String, String> {
    let run = run_capture(bin, args, CLI_TIMEOUT)?;
    match run.exit {
        CliExit::Success => Ok(run.stdout),
        CliExit::TimedOut => Err(format!("timeout {}s", CLI_TIMEOUT.as_secs())),
        CliExit::Failed => Err(run.stderr.lines().next().unwrap_or("exit").trim().to_string()),
    }
}

/// CLI 를 시한 안에서 돌린다(콘솔 창 없이 · 표준 입력 없음). 시한을 넘기면 죽이고 그때까지의 출력을 돌려준다.
pub(crate) fn run_capture(bin: &Path, args: &[&str], timeout: Duration) -> Result<CliRun, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — 콘솔 창이 번쩍이지 않게
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

/// 파이프를 다른 스레드에서 `max` 바이트까지 읽는다.
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

/// `ServeConfig` JSON 에서 이 포트가 Funnel 로 나가는지 — **순수 함수**. 빈 출력·`{}`·`null` = 설정 없음(꺼짐).
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

/// 프록시 대상(`http://127.0.0.1:47821` · `localhost:47821/x` · `47821` …)이 이 기기의 이 포트인가.
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

/// `tailscale status --json` → 이 기기의 MagicDNS 이름(`Self.DNSName` — 끝의 `.` 를 걷고 소문자). `*.ts.net` 모양이 아니면 `None`
/// (R1a-5 — 설정 화면의 [찾기]). **순수 함수**(시험).
pub(crate) fn self_dns_name(json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(json.trim()).ok()?;
    let name = value.get("Self")?.get("DNSName")?.as_str()?;
    let name = name.trim().trim_end_matches('.').to_ascii_lowercase();
    super::valid_ts_host(&name).then_some(name)
}

/// `tailscale whois --json` → 그 기기의 이름. 사람이 읽기 좋은 `Node.Hostinfo.Hostname`(기기가 알린 이름 — 겹칠 수 있다)이 먼저,
/// 없거나 비었으면 `Node.ComputedName`(tailnet 안에서 유일한 DNS 이름). 둘 다 없거나 JSON 이 아니면 `None`.
/// 제어 문자 · 길이는 [`label`](super::auth::label) 로 걷는다. **순수 함수**(시험).
pub(crate) fn whois_node_name(json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(json.trim()).ok()?;
    let node = value.get("Node")?;
    let usable = |field: Option<&Value>| field.and_then(Value::as_str).map(super::auth::label).filter(|name| !name.is_empty());
    let hostname = node.get("Hostinfo").and_then(|h| h.get("Hostname"));
    usable(hostname).or_else(|| usable(node.get("ComputedName")))
}

/// 이 IP 의 tailnet 기기 이름을 CLI 로 찾는다(블로킹 — 부르는 쪽이 `spawn_blocking`). 어떤 실패든 `None` — 표시 이름이 UA 이름으로 돌아갈 뿐이다.
pub(crate) fn whois_node(ip: IpAddr) -> Option<String> {
    let bin = tailscale_binary()?;
    let ip = ip.to_string();
    let run = run_capture(&bin, &["whois", "--json", &ip], WHOIS_TIMEOUT).ok()?;
    if run.exit != CliExit::Success {
        return None;
    }
    whois_node_name(&run.stdout)
}

/// 이 PC 의 MagicDNS 이름을 CLI 로 찾는다(블로킹 — 부르는 쪽이 `spawn_blocking`). 실패는 사용자 문구.
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
