//! GUI 가 잠깐 띄우는 `codex app-server` 의 요청 하나 — 지난 대화 이름 바꾸기 · 지우기가 같이 쓴다 (docs/log/2026-10-24-convo-rename.md).
//! Codex 의 기록은 직접 고치지 않는다 — 여러 곳에 나눠 두어 한쪽만 고치면 어긋난다. 스레드를 열지 않는 요청만 쓰므로 MCP 서버 끄기 · 모델 인자는 없다.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::i18n::tr;

const TIMEOUT: Duration = Duration::from_secs(15);
/// 다루지 않는 서버 요청에 답하는 JSON-RPC 오류 — 사이드 채팅 Codex 어댑터와 같은 값.
pub(crate) const UNSUPPORTED: i64 = -32601;

/// 사이드 채팅(`side_chat::codex::argv`)의 끄기 셋과 같다(훅 · 플러그인 · 앱).
pub(crate) const APP_SERVER_ARGS: &[&str] =
    &["app-server", "--disable", "hooks", "--disable", "plugins", "--disable", "apps"];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RpcFail {
    NoExe,
    Spawn(String),
    Closed,
    /// Codex 가 지은 문구 — 사용자 글자를 담지 않는다.
    Error(String),
}

pub(crate) fn fail_text(f: RpcFail, server: impl FnOnce(&str) -> String) -> String {
    match f {
        RpcFail::NoExe => tr!(ko: "PATH 에서 codex 를 찾지 못했습니다", en: "codex was not found on PATH"),
        RpcFail::Spawn(e) => tr!(ko: "Codex 를 띄우지 못했습니다: {e}", en: "Could not start Codex: {e}"),
        RpcFail::Closed => tr!(ko: "Codex 가 답하지 않았습니다", en: "Codex did not respond"),
        RpcFail::Error(msg) => server(&msg),
    }
}

fn send<W: Write>(w: &mut W, v: &Value) -> Result<(), RpcFail> {
    writeln!(w, "{v}").and_then(|_| w.flush()).map_err(|_| RpcFail::Closed)
}

/// 서버 요청(`id` + `method`)에는 "다루지 않음" 으로 답한다 — 영영 기다리지 않게.
fn wait_reply<R: BufRead, W: Write>(r: &mut R, w: &mut W, id: i64) -> Result<Value, RpcFail> {
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line).map_err(|_| RpcFail::Closed)? == 0 {
            return Err(RpcFail::Closed);
        }
        let Ok(mut v) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if v.get("method").is_some() {
            if let Some(req) = v.get("id") {
                send(w, &json!({"jsonrpc": "2.0", "id": req, "error": {"code": UNSUPPORTED, "message": "unsupported"}}))?;
            }
            continue;
        }
        if v["id"].as_i64() != Some(id) {
            continue;
        }
        if let Some(e) = v.get("error") {
            let msg = e["message"].as_str().unwrap_or("error");
            return Err(RpcFail::Error(msg.chars().take(300).collect()));
        }
        return Ok(v["result"].take());
    }
}

pub(crate) fn request_over<R: BufRead, W: Write>(
    r: &mut R,
    w: &mut W,
    method: &str,
    params: Value,
    client_version: &str,
) -> Result<Value, RpcFail> {
    send(w, &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"clientInfo": {"name": "aynx", "version": client_version}}}))?;
    wait_reply(r, w, 1)?;
    send(w, &json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}))?;
    send(w, &json!({"jsonrpc": "2.0", "id": 2, "method": method, "params": params}))?;
    wait_reply(r, w, 2)
}

/// 콘솔 창이 번쩍이지 않게 — OS 를 타는 것은 이 함수 하나다.
fn hide_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// `home` 이 있으면 그 집(`CODEX_HOME`)을 보게 한다 — 목록이 읽은 루트의 집과 어긋나지 않게.
pub(crate) fn request_with(
    exe: &Path,
    home: Option<&Path>,
    method: &str,
    params: Value,
) -> Result<Value, RpcFail> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(exe);
    if let Some(h) = home {
        cmd.env("CODEX_HOME", h);
    }
    cmd.args(APP_SERVER_ARGS)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| RpcFail::Spawn(e.to_string()))?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(RpcFail::Spawn("stdio".into()));
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let method = method.to_owned();
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        let out = request_over(&mut r, &mut stdin, &method, params, env!("CARGO_PKG_VERSION"));
        drop(stdin);
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(TIMEOUT);
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while matches!(out, Ok(Ok(_))) && std::time::Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    out.unwrap_or(Err(RpcFail::Closed))
}

/// 집은 그 대화를 찾은 루트의 부모(`<CODEX_HOME>/sessions` → `<CODEX_HOME>`)다 — `codex_roots` 와 같은 집.
pub(crate) fn request(root: &Path, method: &str, params: Value) -> Result<Value, RpcFail> {
    let exe = crate::orchestration::spawn::find_exe("codex", std::env::var_os("PATH").as_deref())
        .ok_or(RpcFail::NoExe)?;
    request_with(&exe, root.parent(), method, params)
}

#[cfg(test)]
mod tests;
