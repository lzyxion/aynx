//! 세션 진단 Tauri 명령 — `session_stats`(로컬·SSH 공용).

/// 이 세션이 웹뷰로 얼마나 내보냈는가 — 침묵한 타일을 진단하는 창구(docs/log/2026-09-05-silent-session-selfheal.md).
/// 보낸 수 0 = Rust 가 안 보냈다 · 보낸 수 > 0 인데 받은 수 0 = IPC 유실 · `send_failures > 0` 이면 유실 확정.
#[tauri::command]
pub async fn session_stats(kind: String, id: u32) -> Result<serde_json::Value, String> {
    match kind.as_str() {
        "local" | "ssh" => {
            crate::server::proxy::call(
                crate::server::ipc::Grade::Read,
                "stats",
                serde_json::json!({ "kind": kind, "id": id }),
            )
            .await
        }
        other => Err(format!("알 수 없는 세션 종류: {other}")),
    }
}
