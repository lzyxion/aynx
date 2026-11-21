//! SSH 평면의 원격 실행 · 헤드리스 · 터널 op — 위는 서버(op 몸), 아래는 같은 op 를 부르는 GUI 껍데기.
//!
//! ## `ssh_exec` 는 원시 `send_command` 가 아니다
//!
//! - PTY 를 요청하지 않는 별도 exec 채널이라 사용자의 대화형 셸에 글자를 넣지 않는다.
//! - 부르는 쪽은 명령 글자를 스스로 조립하는 GUI 의 고정 함수들과 사람이 승인한 작업안만 돌리는 실행기(`operations`)뿐이다.
//!   이 op 로 가는 Tauri 명령은 없다(시험 `ssh_exec_has_no_frontend_command`) — 프런트 · MCP 에서 임의 문자열이 오는 길이 없다.
//! - 서버는 명령 글자를 로그에 남기지 않는다(세션 번호 · 길이만).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::ipc::frame::{code, Frame};
use super::ipc::{Grade, WireError};
use super::sessions::ConnCtx;
use crate::ssh::{ExecBytes, ExecHandle, ExecOutcome};

/// GUI 가 더 크게 청해도 서버가 여기서 자른다.
const EXEC_BYTES_MAX: usize = 64 * 1024 * 1024;
const COLLECT_CHUNK: usize = 1024 * 1024;
const EXEC_TIMEOUT_MAX: Duration = Duration::from_secs(600);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// 서버 쪽
// ---------------------------------------------------------------------------

pub(crate) fn is_ssh_op(op: &str) -> bool {
    matches!(
        op,
        "ssh_exec"
            | "ssh_exec_cancel"
            | "ssh_alias"
            | "ssh_find"
            | "headless_open"
            | "headless_close"
            | "chan_open"
            | "chan_close"
            | "ssh_copy_id"
    )
}

/// `(연결, execId)` → 취소 깃발
type CancelMap = HashMap<(u64, u64), Arc<AtomicBool>>;

static CANCELS: LazyLock<Mutex<CancelMap>> = LazyLock::new(Default::default);

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|_| WireError::new(code::BAD_BODY, "bad ssh request body"))
}

fn serr(m: impl Into<String>) -> WireError {
    WireError::new(code::SESSION, m)
}

fn open_err(e: crate::ssh::SshOpenError) -> WireError {
    WireError::new(
        super::sessions::SSH_OPEN,
        serde_json::to_string(&e).unwrap_or_else(|_| "{}".into()),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Exec {
    session: u32,
    command: String,
    timeout_ms: u64,
    #[serde(default)]
    exec_id: Option<u64>,
    /// 바이트 모드 — stdout 을 이 번호의 채널 프레임으로 먼저 보낸다.
    #[serde(default)]
    collect: Option<u64>,
    #[serde(default)]
    max_stdout: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecId {
    exec_id: u64,
}

#[derive(Deserialize)]
struct Session {
    session: u32,
}

#[derive(Deserialize)]
struct Alias {
    alias: String,
}

#[derive(Deserialize)]
struct Stream {
    stream: String,
}

#[derive(Deserialize)]
struct ChanOpen {
    session: u32,
    subsystem: String,
}

#[derive(Deserialize)]
struct Chan {
    chan: u64,
}

/// `Debug` 를 파생하지 않는다(비밀번호).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyId {
    alias: String,
    password: String,
    line: String,
    accept_new_host_key: bool,
    verify: bool,
}

pub(crate) async fn handle(op: &str, mut b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
    if let Some(l) = b.get("lang").and_then(Value::as_str).and_then(crate::i18n::parse) {
        crate::i18n::set_lang(l);
    }
    if let Some(o) = b.as_object_mut() {
        o.remove("lang");
    }
    match op {
        "ssh_exec" => exec(body(b)?, ctx).await,
        "ssh_exec_cancel" => {
            let a: ExecId = body(b)?;
            if let Some(flag) = lock(&CANCELS).get(&(ctx.id, a.exec_id)) {
                flag.store(true, Ordering::SeqCst);
            }
            Ok(Value::Null)
        }
        "ssh_alias" => {
            let a: Session = body(b)?;
            let m = crate::ssh::table().0.lock().unwrap();
            Ok(m.get(&a.session)
                .map(|s| json!({ "alias": s.alias, "tile": s.shell.is_some() }))
                .unwrap_or(Value::Null))
        }
        "ssh_find" => {
            let a: Alias = body(b)?;
            let m = crate::ssh::table().0.lock().unwrap();
            let id = crate::agent_instructions::remote::tile_id(
                &a.alias,
                m.iter()
                    .map(|(id, s)| (*id, s.alias.as_str(), s.shell.is_some() && !s.handle.is_closed())),
            );
            Ok(json!(id))
        }
        "headless_open" => {
            let a: Alias = body(b)?;
            let plane = super::hub::ai().ok_or_else(|| serr("ai plane is not running"))?;
            let stream = super::ai::connect_delegated(plane.ctx(), plane.routing(), &a.alias)
                .await
                .map_err(open_err)?;
            Ok(json!({ "stream": stream }))
        }
        "headless_close" => {
            let a: Stream = body(b)?;
            if let Some(plane) = super::hub::ai() {
                super::ai::close_delegated(&plane, &a.stream).await;
            }
            Ok(Value::Null)
        }
        "chan_open" => {
            let a: ChanOpen = body(b)?;
            super::tunnel::open(a.session, &a.subsystem, ctx).await
        }
        "chan_close" => {
            let a: Chan = body(b)?;
            super::tunnel::close(a.chan, ctx.id);
            Ok(Value::Null)
        }
        "ssh_copy_id" => {
            let a: CopyId = body(b)?;
            let report = crate::copy_id::install_line(&a.alias, a.password, &a.line, a.accept_new_host_key, a.verify)
                .await
                .map_err(open_err)?;
            Ok(serde_json::to_value(report).unwrap_or(Value::Null))
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// 명령 글자는 로그에 남기지 않는다.
async fn exec(a: Exec, ctx: &ConnCtx) -> Result<Value, WireError> {
    let handle = crate::ssh::handle_of(crate::ssh::table(), a.session)
        .ok_or_else(|| serr(crate::errors::session_gone()))?;
    let timeout = Duration::from_millis(a.timeout_ms.max(1)).min(EXEC_TIMEOUT_MAX);
    super::log::line(format!(
        "ssh_exec on ssh {} — {} byte command{}",
        a.session,
        a.command.len(),
        if a.collect.is_some() { " (bytes)" } else { "" }
    ));
    if let Some(collect) = a.collect {
        let max = a.max_stdout.unwrap_or(EXEC_BYTES_MAX).min(EXEC_BYTES_MAX);
        let out = crate::ssh::run_exec_bytes_direct(handle, a.command, timeout, max).await;
        // stdout 은 응답보다 먼저 같은 연결 큐로 — GUI 의 수집기가 응답 전에 다 받아야 한다
        for chunk in out.stdout.chunks(COLLECT_CHUNK) {
            let _ = ctx.tx.send(Frame::Channel {
                chan: collect,
                bytes: chunk.to_vec(),
            });
        }
        return Ok(json!({
            "exitCode": out.exit_code,
            "stderr": out.stderr,
            "overflow": out.overflow,
            "timedOut": out.timed_out,
            "error": out.error,
        }));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = a.exec_id {
        lock(&CANCELS).insert((ctx.id, id), Arc::clone(&cancel));
    }
    let out = crate::ssh::run_exec_direct(handle, a.command, timeout, cancel).await;
    if let Some(id) = a.exec_id {
        lock(&CANCELS).remove(&(ctx.id, id));
    }
    Ok(serde_json::to_value(out).unwrap_or(Value::Null))
}

// ---------------------------------------------------------------------------
// GUI 쪽 — `ExecHandle::Server` 의 몸 · 세션 묻기
// ---------------------------------------------------------------------------

/// 살아 있는지는 exec 이 답한다.
pub(crate) fn handle_of(id: u32) -> Option<ExecHandle> {
    Some(ExecHandle::Server(id))
}

pub(crate) async fn alias_of(id: u32) -> Option<String> {
    let v = super::proxy::call(Grade::Read, "ssh_alias", json!({ "session": id })).await.ok()?;
    v.get("alias").and_then(Value::as_str).map(str::to_string)
}

/// 타일의 세션만(헤드리스 아님).
pub(crate) async fn tile_handle_and_alias(id: u32) -> Option<(ExecHandle, String)> {
    let v = super::proxy::call(Grade::Read, "ssh_alias", json!({ "session": id })).await.ok()?;
    if v.get("tile").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let alias = v.get("alias").and_then(Value::as_str)?.to_string();
    Some((ExecHandle::Server(id), alias))
}

pub(crate) async fn find_tile(alias: &str) -> Option<u32> {
    super::proxy::call(Grade::Read, "ssh_find", json!({ "alias": alias }))
        .await
        .ok()?
        .as_u64()
        .map(|v| v as u32)
}

static NEXT_EXEC: AtomicU64 = AtomicU64::new(1);

pub(crate) fn install_remote_exec() {
    crate::ssh::set_remote_exec(
        |id, command, timeout, cancel| Box::pin(exec_text(id, command, timeout, cancel)),
        |id, command, timeout, max| Box::pin(exec_bytes(id, command, timeout, max)),
    );
}

/// 취소는 협력적이다 — 이미 시작된 원격 명령은 계속 돌 수 있다.
pub(crate) async fn exec_text(id: u32, command: String, timeout: Duration, cancel: Arc<AtomicBool>) -> ExecOutcome {
    if cancel.load(Ordering::SeqCst) {
        return ExecOutcome {
            cancelled: true,
            ..Default::default()
        };
    }
    let exec_id = NEXT_EXEC.fetch_add(1, Ordering::Relaxed);
    let watcher = {
        let cancel = Arc::clone(&cancel);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(150)).await;
                if cancel.load(Ordering::SeqCst) {
                    let _ = super::client::request_now(
                        Grade::Write,
                        "ssh_exec_cancel",
                        json!({ "execId": exec_id }),
                    )
                    .await;
                    break;
                }
            }
        })
    };
    let r = super::client::request(
        Grade::Write,
        "ssh_exec",
        json!({
            "session": id,
            "command": command,
            "timeoutMs": timeout.as_millis() as u64,
            "execId": exec_id,
            "lang": super::ssh_proxy::lang(),
        }),
    )
    .await;
    watcher.abort();
    match r {
        Ok(v) => serde_json::from_value(v).unwrap_or_else(|e| ExecOutcome {
            error: Some(format!("bad ssh_exec reply: {e}")),
            ..Default::default()
        }),
        Err(e) => ExecOutcome {
            error: Some(exec_error(e)),
            ..Default::default()
        },
    }
}

pub(crate) async fn exec_bytes(id: u32, command: String, timeout: Duration, max_stdout: usize) -> ExecBytes {
    let collect = super::tunnel::collect_open();
    let r = super::client::request(
        Grade::Write,
        "ssh_exec",
        json!({
            "session": id,
            "command": command,
            "timeoutMs": timeout.as_millis() as u64,
            "collect": collect,
            "maxStdout": max_stdout,
            "lang": super::ssh_proxy::lang(),
        }),
    )
    .await;
    let stdout = super::tunnel::collect_take(collect);
    match r {
        Ok(v) => ExecBytes {
            exit_code: v.get("exitCode").and_then(Value::as_i64),
            stdout,
            stderr: v.get("stderr").and_then(Value::as_str).unwrap_or_default().to_string(),
            overflow: v.get("overflow").and_then(Value::as_bool).unwrap_or(false),
            timed_out: v.get("timedOut").and_then(Value::as_bool).unwrap_or(false),
            error: v.get("error").and_then(Value::as_str).map(str::to_string),
        },
        Err(e) => ExecBytes {
            error: Some(exec_error(e)),
            ..Default::default()
        },
    }
}

fn exec_error(e: WireError) -> String {
    match e.code.as_str() {
        "not-connected" | "closed" | "io" => crate::i18n::tr!(
            ko: "세션 서버에 닿지 못했습니다 ({code}: {msg})",
            en: "Could not reach the session server ({code}: {msg})",
            code = e.code,
            msg = e.message
        ),
        "timeout" => crate::i18n::tr!(
            ko: "세션 서버가 시간 안에 답하지 않았습니다",
            en: "The session server did not answer in time"
        ),
        _ => e.message,
    }
}

pub(crate) async fn copy_id(
    alias: &str,
    password: String,
    line: &str,
    accept_new_host_key: bool,
    verify: bool,
) -> Result<crate::copy_id::InstallReport, crate::ssh::SshOpenError> {
    let r = super::client::request(
        Grade::Write,
        "ssh_copy_id",
        json!({
            "alias": alias,
            "password": password,
            "line": line,
            "acceptNewHostKey": accept_new_host_key,
            "verify": verify,
            "lang": super::ssh_proxy::lang(),
        }),
    )
    .await;
    match r {
        Ok(v) => serde_json::from_value(v)
            .map_err(|e| crate::ssh::SshOpenError::other(format!("bad ssh_copy_id reply: {e}"))),
        Err(e) => Err(open_error(e)),
    }
}

fn open_error(e: WireError) -> crate::ssh::SshOpenError {
    if e.code == super::sessions::SSH_OPEN {
        if let Ok(err) = serde_json::from_str(&e.message) {
            return err;
        }
    }
    crate::ssh::SshOpenError::other(exec_error(e))
}

// ---------------------------------------------------------------------------
// GUI 쪽 — 헤드리스 위임
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_headless_session(alias: String) -> Result<String, crate::ssh::SshOpenError> {
    let v = super::client::request(
        Grade::Write,
        "headless_open",
        json!({ "alias": alias, "lang": super::ssh_proxy::lang() }),
    )
    .await
    .map_err(open_error)?;
    v.get("stream")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| crate::ssh::SshOpenError::other("bad headless_open reply"))
}

#[tauri::command]
pub async fn close_headless_session(stream_id: String) -> Result<(), String> {
    super::proxy::call(Grade::Write, "headless_close", json!({ "stream": stream_id }))
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_exec_has_no_frontend_command() {
        let lib = include_str!("../lib.rs");
        let start = lib.find("generate_handler![").expect("명령 등록 목록");
        let end = start + lib[start..].find("])").expect("목록 끝");
        let list = &lib[start..end];
        for forbidden in ["ssh_exec", "run_exec", "chan_open", "ssh_copy_id", "headless_open", "send_command"] {
            assert!(!list.contains(forbidden), "{forbidden} 가 프런트 명령으로 열려 있다");
        }
        assert_eq!(gui_commands(include_str!("ssh_ops.rs")), vec!["open_headless_session", "close_headless_session"]);
    }

    /// 줄 끝을 LF 로 맞춘 뒤 본다(CRLF 체크아웃).
    fn gui_commands(src: &str) -> Vec<String> {
        src.replace("\r\n", "\n")
            .split("#[tauri::command]\npub async fn ")
            .skip(1)
            .filter_map(|rest| rest.split('(').next().map(str::to_string))
            .collect()
    }

    #[test]
    fn command_scan_ignores_line_endings() {
        let me = include_str!("ssh_ops.rs");
        let crlf = me.replace("\r\n", "\n").replace('\n', "\r\n");
        assert_eq!(gui_commands(&crlf), gui_commands(me));
        assert_eq!(gui_commands(&crlf).len(), 2);
    }

    #[test]
    fn ssh_ops_have_grades() {
        use super::super::ipc::frame::{check_grade, required_grade};
        for op in ["ssh_exec", "ssh_exec_cancel", "headless_open", "headless_close", "chan_open", "chan_close", "ssh_copy_id"] {
            assert!(is_ssh_op(op), "{op}");
            assert_eq!(required_grade(op), Some(Grade::Write), "{op}");
            assert!(check_grade(op, Grade::Read).is_err(), "{op}");
            assert!(check_grade(op, Grade::Approve).is_err(), "{op}");
        }
        for op in ["ssh_alias", "ssh_find"] {
            assert!(is_ssh_op(op), "{op}");
            assert_eq!(required_grade(op), Some(Grade::Read), "{op}");
        }
    }
}
