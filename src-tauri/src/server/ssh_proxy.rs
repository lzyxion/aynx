//! GUI 쪽 SSH 평면 껍데기 — 대화형 SSH · 연결 풀 · 포워드는 세션 서버에 살고, 여기는 프런트가 부르는 Tauri 명령만 있다.
//!
//! - 접속 관문(호스트 키 · 비밀번호 · 암호구)은 "끊고 재시도"다 — 서버가 `SshOpenError` 로 답하면 프런트가 모달로 묻고 다시 부른다.
//!   값은 그 한 번의 몸에만 실리고 GUI 는 로그 · `Debug` 에 남기지 않는다(그래서 인자를 구조체로 묶지 않는다).
//! - 창의 generation 은 GUI 만 안다 — 여는 사이 창이 리로드 · 파괴됐으면 방금 연 세션을 곧바로 닫는다(로컬 열기와 같은 규칙).

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::client;
use super::ipc::Grade;
use super::proxy::{call, lease_body, route_abandon, route_drop, route_pending, route_pin};
use crate::i18n::{self, tr, Lang};
use crate::session_core::{Keys, Kind};
use crate::ssh::open::SshOpenResult;
use crate::ssh::SshOpenError;

/// 서버가 만드는 사람 문구의 언어 — 몸마다 싣는다(서버에는 언어 설정이 없다).
pub(crate) fn lang() -> &'static str {
    match i18n::lang() {
        Lang::En => "en",
        Lang::Ko => "ko",
    }
}

fn anonymous_stream() -> String {
    static ANON: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    format!(
        "ssh-anon-{}-{}",
        std::process::id(),
        ANON.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// `open_ssh` 의 실패는 코드 `ssh-open` + 메시지 = `SshOpenError` JSON 이다.
fn open_error(e: super::ipc::WireError) -> SshOpenError {
    if e.code == super::sessions::SSH_OPEN {
        if let Ok(err) = serde_json::from_str::<SshOpenError>(&e.message) {
            return err;
        }
    }
    let msg = match e.code.as_str() {
        "not-connected" | "closed" | "io" | "timeout" => tr!(
            ko: "세션 서버에 닿지 못했습니다 ({code}: {msg})",
            en: "Could not reach the session server ({code}: {msg})",
            code = e.code,
            msg = e.message
        ),
        _ => e.message,
    };
    SshOpenError::other(msg)
}

/// `password`·`passphrase` 는 저장하지 않는다 — 이 호출 한 번의 몸에만 싣는다.
/// 에이전트 신호를 세울지는 프런트가 정하지 않는다 — 서버 `ssh::open::signal_stream` 한 곳.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_ssh_session(
    webview: tauri::Webview,
    alias: String,
    host_key_decision: Option<Value>,
    password: Option<String>,
    passphrase: Option<String>,
    passphrase_for: Option<String>,
    declined_keys: Option<Vec<String>>,
    tmux_name: Option<String>,
    adhoc: Option<Value>,
    start: Option<Value>,
    no_tmux: Option<bool>,
    force_tmux: Option<bool>,
    stream_id: Option<String>,
    on_data: Channel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
) -> Result<SshOpenResult, SshOpenError> {
    let label = webview.window().label().to_string();
    let seen = crate::reap::generation(&label);
    let stream = stream_id.unwrap_or_else(anonymous_stream);
    let body = json!({
        "alias": alias,
        "hostKeyDecision": host_key_decision,
        "password": password,
        "passphrase": passphrase,
        "passphraseFor": passphrase_for,
        "declinedKeys": declined_keys,
        "tmuxName": tmux_name,
        "adhoc": adhoc,
        "start": start,
        "noTmux": no_tmux,
        "forceTmux": force_tmux,
        "stream": stream,
        "window": label,
        "cols": cols,
        "rows": rows,
        "lang": lang(),
    });
    let prev = route_pending(&stream, on_data, None, Kind::Ssh);
    let opened = match client::request(Grade::Write, "open_ssh", body).await {
        Ok(v) => serde_json::from_value::<SshOpenResult>(v)
            .map_err(|e| SshOpenError::other(format!("bad open_ssh reply: {e}"))),
        Err(e) => Err(open_error(e)),
    };
    let opened = match opened {
        Ok(o) => o,
        Err(e) => {
            route_abandon(&stream, prev);
            return Err(e);
        }
    };
    route_pin(&opened.lease, opened.id);
    if crate::reap::admit(&label, seen, (), |()| {}).is_err() {
        eprintln!(
            "세션 정리: `{label}` 창이 여는 사이 다시 떴거나 닫혀 SSH {} 을 거뒀습니다",
            opened.id
        );
        let k: &Keys = &opened.lease;
        let _ = call(Grade::Write, "close", lease_body(k)).await;
        route_drop(&k.stream, k.session_epoch, k.lease_epoch);
        return Err(SshOpenError::other(crate::reap::window_gone_message()));
    }
    Ok(opened)
}

#[tauri::command]
pub async fn session_info(id: u32) -> Result<Value, String> {
    call(Grade::Read, "ssh_info", json!({ "id": id })).await
}

/// 검사 · 127.0.0.1 바인드는 서버가 한다.
#[tauri::command]
pub async fn add_forward(
    session_id: u32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    kind: Option<Value>,
) -> Result<Value, String> {
    call(
        Grade::Write,
        "forward_add",
        json!({
            "sessionId": session_id,
            "localPort": local_port,
            "remoteHost": remote_host,
            "remotePort": remote_port,
            "kind": kind,
            "lang": lang(),
        }),
    )
    .await
}

#[tauri::command]
pub async fn list_forwards(session_id: u32) -> Value {
    call(Grade::Read, "forward_list", json!({ "sessionId": session_id }))
        .await
        .unwrap_or_else(|_| json!([]))
}

/// 앱이 건 신호 포워드는 서버가 거절한다.
#[tauri::command]
pub async fn remove_forward(id: u32) -> Result<(), String> {
    call(Grade::Write, "forward_remove", json!({ "id": id, "lang": lang() }))
        .await
        .map(|_| ())
}

pub(crate) async fn log_path(id: u32) -> Option<String> {
    call(Grade::Read, "ssh_log_path", json!({ "id": id }))
        .await
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_errors_cross_the_pipe_unchanged() {
        let errs = vec![
            SshOpenError::HostKeyUnknown {
                fingerprint: "SHA256:abc".into(),
                key_type: "ssh-ed25519".into(),
                host: "dev-01".into(),
                port: 22,
                no_store: false,
            },
            SshOpenError::password_required("비밀번호가 필요합니다"),
            SshOpenError::PassphraseRequired {
                path: "C:/k".into(),
                fingerprint: None,
                wrong: true,
                stored_rejected: false,
            },
        ];
        for e in errs {
            let wire = super::super::ipc::WireError::new(
                super::super::sessions::SSH_OPEN,
                serde_json::to_string(&e).unwrap(),
            );
            let back = open_error(wire);
            assert_eq!(serde_json::to_value(&back).unwrap(), serde_json::to_value(&e).unwrap());
        }
        let back = open_error(super::super::ipc::WireError::new("closed", "connection closed"));
        assert!(matches!(back, SshOpenError::Other { .. }));
    }
}
