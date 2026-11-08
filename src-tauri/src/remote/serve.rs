//! **Tailscale 연결** — 설정 › 원격 접속의 [연결] · [serve 끄기] 뒤(이름 찾기 → `tailscale serve` 판정 · 실행 → `[remote]` 저장 → 관문 맞추기).
//!
//! 불변식:
//! - **집 PC 전용**이다(`deny.rs` 의 `HOME_ONLY` — 원격 창에서는 세 명령 모두 거절, 화면에도 줄이 없다).
//! - **실행 인자는 고정이고 포트 숫자 하나만 끼운다**([`serve_on_args`] · [`SERVE_OFF_ARGS`]). 프런트 문자열은 인자에 닿지 않는다 —
//!   포트는 `u16` 으로 받고, `replace` 는 판정 대상과 견주기만 한다.
//! - **Funnel 길이 없다** — 여기서 부르는 CLI 인자에 Funnel 을 켜는 것이 없고, 443 이나 이 포트가 Funnel 로 나가 있으면 연결을 거절한다
//!   (덮어쓰기 확인도 없다 · [`ServeState::Funnel443`]).
//! - **남의 443 은 사람이 확인해야 덮는다** — 확인한 대상과 지금 대상이 다르면 다시 묻는다([`plan`]). 끄기는 우리 포트일 때만.
//! - `[remote]` 저장은 serve 가 우리 포트를 가리키는 것을 **확인한 뒤에만** 한다. 저장은 디스크의 설정에서 `[remote]` 한 칸만 바꾼다
//!   (`settings::set_remote_connected` — 화면의 저장 전 편집은 파일에 실리지 않는다).
//! - 토글과 serve 는 따로다 — [serve 끄기] 는 `[remote]` 를 안 바꾸고, 토글은 serve 를 안 건드린다.
//!
//! 판정은 순수 함수([`serve_state`] · [`admin_url`] · [`plan`] · [`classify_failure`])이고 시험은 CLI 를 부르지 않는다.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

use super::funnel::{self, config_funnels, targets_port, CliExit, CliRun};
use crate::i18n::tr;

/// `serve --bg` 의 시한 — tailnet 에서 serve 가 꺼져 있으면 CLI 가 활성화 주소를 찍고 기다린다(그래서 시한 뒤에도 부분 출력을 본다).
const SERVE_TIMEOUT: Duration = Duration::from_secs(15);

/// 443 을 걷는 고정 인자 — 다른 serve 설정은 그대로.
const SERVE_OFF_ARGS: [&str; 3] = ["serve", "--https=443", "off"];

/// 443 → 이 앱의 관문. 끼우는 것은 포트 숫자뿐이다.
fn serve_on_args(port: u16) -> [String; 4] {
    [
        "serve".to_string(),
        "--bg".to_string(),
        "--https=443".to_string(),
        format!("http://127.0.0.1:{port}"),
    ]
}

/// `serve status --json` 판정.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ServeState {
    /// 443 또는 이 포트가 공개 인터넷에 나가 있다 — 연결 거절.
    Funnel443,
    /// 443 의 `/` 가 이 포트로 온다.
    Ours,
    /// 443 을 다른 곳이 쓴다.
    Other { target: String },
    None,
}

/// `ServeConfig` JSON → 판정. **순수 함수**. 빈 출력 · `{}` · `null` = 설정 없음, 모르는 칸은 무시한다.
pub(crate) fn serve_state(json: &str, port: u16) -> Result<ServeState, String> {
    let json = json.trim();
    if json.is_empty() {
        return Ok(ServeState::None);
    }
    let cfg: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if funnels_443(&cfg, 0) || config_funnels(&cfg, port, 0) {
        return Ok(ServeState::Funnel443);
    }
    let roots: Vec<&Value> = webs_443(&cfg).filter_map(|web| web.get("Handlers")?.get("/")).collect();
    let ours = roots
        .iter()
        .any(|h| h.get("Proxy").and_then(Value::as_str).is_some_and(|p| targets_port(p, port)));
    if ours {
        return Ok(ServeState::Ours);
    }
    let other = roots
        .first()
        .map(|h| handler_label(h))
        .or_else(|| tcp_forward_443(&cfg))
        .or_else(|| foreground_443(&cfg, 0));
    Ok(other.map_or(ServeState::None, |target| ServeState::Other { target }))
}

/// `AllowFunnel` 에 `*:443` 이 켜졌나 — `Foreground` 안도(`config_funnels` 와 같은 깊이 제한).
fn funnels_443(cfg: &Value, depth: u8) -> bool {
    if depth > 4 {
        return false;
    }
    let here = cfg
        .get("AllowFunnel")
        .and_then(Value::as_object)
        .is_some_and(|m| m.iter().any(|(k, on)| k.ends_with(":443") && on.as_bool() == Some(true)));
    here || foregrounds(cfg).any(|inner| funnels_443(inner, depth + 1))
}

fn foregrounds(cfg: &Value) -> impl Iterator<Item = &Value> {
    cfg.get("Foreground").and_then(Value::as_object).into_iter().flat_map(|m| m.values())
}

/// `Web` 의 `*:443` 자리들.
fn webs_443(cfg: &Value) -> impl Iterator<Item = &Value> {
    cfg.get("Web")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(k, _)| k.ends_with(":443"))
        .map(|(_, web)| web)
}

fn tcp_forward_443(cfg: &Value) -> Option<String> {
    cfg.get("TCP")?.get("443")?.get("TCPForward")?.as_str().map(str::to_string)
}

/// 전경 serve 가 443 을 쥐었으면 그 대상의 표식.
fn foreground_443(cfg: &Value, depth: u8) -> Option<String> {
    if depth > 4 {
        return None;
    }
    foregrounds(cfg).find_map(|inner| {
        let web = webs_443(inner)
            .filter_map(|web| web.get("Handlers")?.as_object()?.values().next())
            .map(handler_label)
            .next();
        web.or_else(|| tcp_forward_443(inner))
            .or_else(|| inner.get("TCP")?.get("443").map(|_| "(foreground)".to_string()))
            .or_else(|| foreground_443(inner, depth + 1))
    })
}

/// 핸들러 → 화면에 적을 짧은 표식.
fn handler_label(handler: &Value) -> String {
    let text = |key: &str| handler.get(key).and_then(Value::as_str).filter(|s| !s.is_empty());
    if let Some(proxy) = text("Proxy") {
        proxy.to_string()
    } else if let Some(path) = text("Path") {
        path.to_string()
    } else if text("Text").is_some() {
        "(text)".to_string()
    } else {
        "(other)".to_string()
    }
}

/// CLI 출력에서 tailnet 관리 화면 주소 — `https://login.tailscale.com/` 로 시작하는 첫 토큰만(둘레 구두점은 걷는다). 다른 도메인은 버린다.
pub(crate) fn admin_url(text: &str) -> Option<String> {
    const PREFIX: &str = "https://login.tailscale.com/";
    text.split_whitespace()
        .map(|t| t.trim_start_matches(['(', '<', '[', '"', '\'']))
        .map(|t| t.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', '>', ']', '"', '\'']))
        .find(|t| t.starts_with(PREFIX))
        .map(str::to_string)
}

/// `remote_serve_connect` 의 답. 그 밖의 실패는 `Err(사용자 문구)`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ServeOutcome {
    Connected {
        host: String,
        url: String,
    },
    /// 443 을 다른 곳이 쓴다 — 사람이 이 `target` 을 `replace` 로 돌려줘야 덮는다.
    Confirm {
        target: String,
    },
    /// tailnet 관리 화면에서 켤 것이 있다.
    Admin {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
}

/// 판정 → 할 일. **순수 함수**.
#[derive(Debug, PartialEq, Eq)]
enum Plan {
    /// 이미 우리 것 — serve 를 다시 걸지 않고 저장만(멱등).
    SaveOnly,
    Run,
    Confirm(String),
    RefuseFunnel,
}

fn plan(state: &ServeState, replace: Option<&str>) -> Plan {
    match state {
        ServeState::Funnel443 => Plan::RefuseFunnel,
        ServeState::Ours => Plan::SaveOnly,
        ServeState::None => Plan::Run,
        ServeState::Other { target } if replace == Some(target.as_str()) => Plan::Run,
        ServeState::Other { target } => Plan::Confirm(target.clone()),
    }
}

/// 사람에게 보일 CLI 한 줄 — 표준 오류 첫 줄, 없으면 표준 출력 첫 줄.
fn first_line(run: &CliRun) -> Option<String> {
    run.stderr
        .lines()
        .chain(run.stdout.lines())
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

fn admin_with_url(url: String) -> ServeOutcome {
    ServeOutcome::Admin {
        message: tr!(
            ko: "이 tailnet 에서 serve 또는 HTTPS 인증서가 꺼져 있습니다.",
            en: "Serve or HTTPS certificates are off on this tailnet."
        ),
        url: Some(url),
    }
}

/// 성공하지 못한 `serve --bg` → 답. 주소가 잡히면 관리 화면, 주소 없는 시한 초과 · HTTPS/not enabled 류는 원인 문구, 그 밖은 실패. **순수 함수**.
fn classify_failure(run: &CliRun) -> Result<ServeOutcome, String> {
    if let Some(url) = admin_url(&format!("{}\n{}", run.stdout, run.stderr)) {
        return Ok(admin_with_url(url));
    }
    let line = first_line(run);
    let lower = line.as_deref().unwrap_or("").to_ascii_lowercase();
    if run.exit == CliExit::TimedOut || lower.contains("https") || lower.contains("not enabled") {
        let message = line.unwrap_or_else(|| {
            tr!(
                ko: "tailscale serve 가 시간 안에 끝나지 않았습니다. 관리 화면에서 serve 와 HTTPS 를 켰는지 보세요.",
                en: "tailscale serve did not finish in time. Check that serve and HTTPS are on in the admin console."
            )
        });
        return Ok(ServeOutcome::Admin { message, url: None });
    }
    let line = line.unwrap_or_else(|| "exit".to_string());
    Err(tr!(
        ko: "tailscale serve 가 실패했습니다: {line}",
        en: "tailscale serve failed: {line}",
        line = line
    ))
}

fn no_cli() -> String {
    tr!(
        ko: "tailscale CLI 를 찾지 못했습니다 — Tailscale 을 설치했는지 보세요",
        en: "Could not find the tailscale CLI — is Tailscale installed?"
    )
}

fn resolve_port(port: Option<u16>) -> u16 {
    port.filter(|p| *p != 0).unwrap_or(crate::instance::remote_port(crate::instance::DEV))
}

fn read_state(bin: &Path, port: u16) -> Result<ServeState, String> {
    let json = funnel::run_status(bin, &["serve", "status", "--json"]).map_err(|e| {
        tr!(
            ko: "tailscale serve 상태를 읽지 못했습니다(tailscale 이 꺼져 있나요?): {e}",
            en: "Could not read the tailscale serve status (is tailscale running?): {e}",
            e = e
        )
    })?;
    serve_state(&json, port).map_err(|e| {
        tr!(
            ko: "tailscale serve 상태를 해석하지 못했습니다: {e}",
            en: "Could not parse the tailscale serve status: {e}",
            e = e
        )
    })
}

/// `remote_serve_status` 의 답.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ServeStatus {
    /// `none` · `ours` · `other` · `funnel` · `unknown`
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

fn status_of(state: Result<ServeState, String>) -> ServeStatus {
    let (state, target) = match state {
        Ok(ServeState::None) => ("none", None),
        Ok(ServeState::Ours) => ("ours", None),
        Ok(ServeState::Other { target }) => ("other", Some(target)),
        Ok(ServeState::Funnel443) => ("funnel", None),
        Err(_) => ("unknown", None),
    };
    ServeStatus { state, target }
}

fn connect_blocking(app: &AppHandle, port_arg: Option<u16>, replace: Option<String>) -> Result<ServeOutcome, String> {
    let port = resolve_port(port_arg);
    let host = funnel::detect_host()?;
    let bin = funnel::tailscale_binary().ok_or_else(no_cli)?;
    match plan(&read_state(&bin, port)?, replace.as_deref()) {
        Plan::RefuseFunnel => {
            return Err(tr!(
                ko: "443 또는 이 포트가 Funnel 로 공개 인터넷에 나가 있어 연결하지 않았습니다. Funnel 을 끈 뒤 다시 시도하세요.",
                en: "Not connected: port 443 or this port is exposed to the public internet through Funnel. Turn Funnel off and try again."
            ));
        }
        Plan::Confirm(target) => return Ok(ServeOutcome::Confirm { target }),
        Plan::SaveOnly => {}
        Plan::Run => {
            let args = serve_on_args(port);
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            let run = funnel::run_capture(&bin, &args, SERVE_TIMEOUT)?;
            if run.exit != CliExit::Success {
                return classify_failure(&run);
            }
            if read_state(&bin, port)? != ServeState::Ours {
                if let Some(url) = admin_url(&format!("{}\n{}", run.stdout, run.stderr)) {
                    return Ok(admin_with_url(url));
                }
                return Err(tr!(
                    ko: "tailscale serve 를 걸었지만 443 이 이 앱을 가리키지 않습니다",
                    en: "tailscale serve ran, but 443 does not point at this app"
                ));
            }
        }
    }
    crate::settings::set_remote_connected(&host, port_arg)?;
    super::sync(app);
    let url = format!("https://{host}/");
    Ok(ServeOutcome::Connected { host, url })
}

fn off_blocking(port_arg: Option<u16>) -> Result<(), String> {
    let port = resolve_port(port_arg);
    let bin = funnel::tailscale_binary().ok_or_else(no_cli)?;
    if read_state(&bin, port)? != ServeState::Ours {
        return Err(tr!(
            ko: "443 이 이 앱을 가리키지 않아 아무것도 바꾸지 않았습니다",
            en: "443 does not point at this app, so nothing was changed"
        ));
    }
    let run = funnel::run_capture(&bin, &SERVE_OFF_ARGS, SERVE_TIMEOUT)?;
    if run.exit == CliExit::Success {
        return Ok(());
    }
    let line = first_line(&run).unwrap_or_else(|| "exit".to_string());
    Err(tr!(
        ko: "tailscale serve 를 끄지 못했습니다: {line}",
        en: "Could not turn off tailscale serve: {line}",
        line = line
    ))
}

/// 지금 443 판정 — CLI 가 없거나 못 읽으면 `unknown`. **집 PC 전용**(`deny.rs`). 아무것도 바꾸지 않는다.
#[tauri::command]
pub async fn remote_serve_status(port: Option<u16>) -> Result<ServeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let port = resolve_port(port);
        status_of(
            funnel::tailscale_binary()
                .ok_or_else(no_cli)
                .and_then(|bin| read_state(&bin, port)),
        )
    })
    .await
    .map_err(|e| e.to_string())
}

/// [연결] — 이름 찾기 → serve 판정 · 실행 → `[remote]` 저장 → 관문 맞추기. **집 PC 전용**(`deny.rs`).
#[tauri::command]
pub async fn remote_serve_connect(app: AppHandle, port: Option<u16>, replace: Option<String>) -> Result<ServeOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || connect_blocking(&app, port, replace))
        .await
        .map_err(|e| e.to_string())?
}

/// [serve 끄기] — 443 이 이 포트일 때만 걷는다. `[remote]` 는 안 바꾼다. **집 PC 전용**(`deny.rs`).
#[tauri::command]
pub async fn remote_serve_off(port: Option<u16>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || off_blocking(port))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 이 PC 에서 실측한 모양.
    const MEASURED: &str = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"mypc.tail1234.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47821"}}}}}"#;

    fn run(exit: CliExit, stdout: &str, stderr: &str) -> CliRun {
        CliRun {
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            exit,
        }
    }

    #[test]
    fn measured_json_is_ours_only_for_that_port() {
        assert_eq!(serve_state(MEASURED, 47821), Ok(ServeState::Ours));
        assert_eq!(
            serve_state(MEASURED, 47822),
            Ok(ServeState::Other { target: "http://127.0.0.1:47821".to_string() })
        );
    }

    #[test]
    fn empty_outputs_are_none() {
        for empty in ["", "  \n", "{}", "null"] {
            assert_eq!(serve_state(empty, 47821), Ok(ServeState::None), "{empty:?}");
        }
        assert!(serve_state("not json", 47821).is_err());
    }

    #[test]
    fn other_targets_are_named() {
        let proxy = r#"{"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}"#;
        assert_eq!(serve_state(proxy, 47821), Ok(ServeState::Other { target: "http://127.0.0.1:3000".to_string() }));
        let text = r#"{"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Text":"hello"}}}}}"#;
        assert_eq!(serve_state(text, 47821), Ok(ServeState::Other { target: "(text)".to_string() }));
        let path = r#"{"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Path":"C:/www"}}}}}"#;
        assert_eq!(serve_state(path, 47821), Ok(ServeState::Other { target: "C:/www".to_string() }));
        let tcp = r#"{"TCP":{"443":{"TCPForward":"127.0.0.1:47821"}}}"#;
        assert_eq!(serve_state(tcp, 47821), Ok(ServeState::Other { target: "127.0.0.1:47821".to_string() }));
    }

    #[test]
    fn funnel_refuses_even_if_it_points_elsewhere() {
        let other = r#"{"AllowFunnel":{"a.b.ts.net:443":true},"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}"#;
        assert_eq!(serve_state(other, 47821), Ok(ServeState::Funnel443));
        let off = r#"{"AllowFunnel":{"a.b.ts.net:443":false},"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47821"}}}}}"#;
        assert_eq!(serve_state(off, 47821), Ok(ServeState::Ours));
        // 다른 포트로 나가도 이 포트면 거절 — 관문이 어차피 닫는다(`funnel.rs`).
        let port8443 = r#"{"AllowFunnel":{"a.b.ts.net:8443":true},"Web":{"a.b.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47821"}}}}}"#;
        assert_eq!(serve_state(port8443, 47821), Ok(ServeState::Funnel443));
        let fg = r#"{"Foreground":{"s1":{"AllowFunnel":{"a.b.ts.net:443":true}}}}"#;
        assert_eq!(serve_state(fg, 47821), Ok(ServeState::Funnel443));
    }

    #[test]
    fn foreground_holding_443_is_other() {
        let web = r#"{"Foreground":{"s1":{"Web":{"a.b.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47821"}}}}}}}"#;
        assert_eq!(serve_state(web, 47821), Ok(ServeState::Other { target: "http://127.0.0.1:47821".to_string() }));
        let tcp = r#"{"Foreground":{"s1":{"TCP":{"443":{"HTTPS":true}}}}}"#;
        assert_eq!(serve_state(tcp, 47821), Ok(ServeState::Other { target: "(foreground)".to_string() }));
        let elsewhere = r#"{"Foreground":{"s1":{"TCP":{"8443":{"HTTPS":true}}}}}"#;
        assert_eq!(serve_state(elsewhere, 47821), Ok(ServeState::None));
    }

    #[test]
    fn other_paths_and_ports_are_not_overwritten() {
        let foo = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"a.b.ts.net:443":{"Handlers":{"/foo":{"Proxy":"http://127.0.0.1:3000"}}}}}"#;
        assert_eq!(serve_state(foo, 47821), Ok(ServeState::None));
        let port8443 = r#"{"Web":{"a.b.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}"#;
        assert_eq!(serve_state(port8443, 47821), Ok(ServeState::None));
    }

    #[test]
    fn proxy_forms_match_targets_port() {
        for proxy in ["http://localhost:47821", "http://127.0.0.1:47821/", "localhost:47821", "47821"] {
            let json = format!(r#"{{"Web":{{"a.b.ts.net:443":{{"Handlers":{{"/":{{"Proxy":"{proxy}"}}}}}}}}}}"#);
            assert!(targets_port(proxy, 47821), "{proxy}");
            assert_eq!(serve_state(&json, 47821), Ok(ServeState::Ours), "{proxy}");
        }
    }

    #[test]
    fn admin_url_takes_only_the_login_domain() {
        assert_eq!(
            admin_url("To enable, visit:\n\n   https://login.tailscale.com/f/serve?node=abc.\n"),
            Some("https://login.tailscale.com/f/serve?node=abc".to_string())
        );
        assert_eq!(
            admin_url("see (https://login.tailscale.com/admin/dns), then retry"),
            Some("https://login.tailscale.com/admin/dns".to_string())
        );
        assert_eq!(admin_url("visit https://login.tailscale.com.evil.example/f/serve"), None);
        assert_eq!(admin_url("visit https://evil.example/https://login.tailscale.com/"), None);
        assert_eq!(admin_url("http://login.tailscale.com/f/serve"), None);
        assert_eq!(admin_url("nothing here"), None);
    }

    #[test]
    fn plan_asks_again_when_the_target_changed() {
        let other = ServeState::Other { target: "http://127.0.0.1:3000".to_string() };
        assert_eq!(plan(&other, None), Plan::Confirm("http://127.0.0.1:3000".to_string()));
        assert_eq!(plan(&other, Some("http://127.0.0.1:4000")), Plan::Confirm("http://127.0.0.1:3000".to_string()));
        assert_eq!(plan(&other, Some("http://127.0.0.1:3000")), Plan::Run);
        assert_eq!(plan(&ServeState::None, None), Plan::Run);
        assert_eq!(plan(&ServeState::Ours, None), Plan::SaveOnly);
        // Funnel 은 확인으로도 덮지 않는다.
        assert_eq!(plan(&ServeState::Funnel443, Some("anything")), Plan::RefuseFunnel);
    }

    #[test]
    fn failures_are_classified() {
        // 시한 초과 뒤의 부분 출력에서 주소를 찾는다.
        let waiting = run(CliExit::TimedOut, "Serve is not enabled.\nhttps://login.tailscale.com/f/serve?node=x\n", "");
        assert!(matches!(
            classify_failure(&waiting),
            Ok(ServeOutcome::Admin { url: Some(u), .. }) if u == "https://login.tailscale.com/f/serve?node=x"
        ));
        let silent = run(CliExit::TimedOut, "", "");
        assert!(matches!(classify_failure(&silent), Ok(ServeOutcome::Admin { url: None, .. })));
        let https = run(CliExit::Failed, "", "HTTPS certificates are not available\nmore\n");
        assert_eq!(
            classify_failure(&https),
            Ok(ServeOutcome::Admin { message: "HTTPS certificates are not available".to_string(), url: None })
        );
        let other = run(CliExit::Failed, "", "Access denied\n");
        assert!(classify_failure(&other).unwrap_err().contains("Access denied"));
    }

    #[test]
    fn args_are_fixed_and_never_funnel() {
        assert_eq!(serve_on_args(47821), ["serve", "--bg", "--https=443", "http://127.0.0.1:47821"]);
        assert_eq!(SERVE_OFF_ARGS, ["serve", "--https=443", "off"]);
        for arg in serve_on_args(47821).iter().map(String::as_str).chain(SERVE_OFF_ARGS) {
            assert!(!arg.to_ascii_lowercase().contains("funnel"), "{arg}");
        }
    }

    #[test]
    fn port_zero_or_none_means_instance_default() {
        let default = crate::instance::remote_port(crate::instance::DEV);
        assert_eq!(resolve_port(None), default);
        assert_eq!(resolve_port(Some(0)), default);
        assert_eq!(resolve_port(Some(50000)), 50000);
    }

    #[test]
    fn answers_serialize_as_the_front_expects() {
        let connected = ServeOutcome::Connected { host: "a.b.ts.net".to_string(), url: "https://a.b.ts.net/".to_string() };
        assert_eq!(
            serde_json::to_value(&connected).unwrap(),
            serde_json::json!({"kind": "connected", "host": "a.b.ts.net", "url": "https://a.b.ts.net/"})
        );
        let admin = ServeOutcome::Admin { message: "m".to_string(), url: None };
        assert_eq!(serde_json::to_value(&admin).unwrap(), serde_json::json!({"kind": "admin", "message": "m"}));
        assert_eq!(
            serde_json::to_value(status_of(Ok(ServeState::Other { target: "t".to_string() }))).unwrap(),
            serde_json::json!({"state": "other", "target": "t"})
        );
        assert_eq!(status_of(Err("x".to_string())).state, "unknown");
    }
}
