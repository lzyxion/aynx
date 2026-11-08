//! 세션 진단 Tauri 명령 — `session_stats`(로컬·SSH 공용).
//!
//! 예전에는 거울·라우팅·작업안을 함께 만지는 `report_session`·`drop_session` 도 여기 살았다. ③-3c 부터 그 저장소들은 세션
//! 서버에 살고, 명령은 GUI 의 같은 이름 프록시(`crate::server::ai_proxy`) · 몸은 서버의 거울 묶음(`crate::server::ai`)이다.

/// **이 세션이 웹뷰로 얼마나 내보냈는가** — 침묵한 타일을 진단하는 창구
/// (docs/log/2026-09-05-silent-session-selfheal.md).
///
/// 프런트는 "열렸는데 첫 출력이 안 온다" 를 감지하면 채널을 다시 붙이는데
/// (`Terminal.svelte` 의 침묵 감시), 그때 이 값을 함께 찍어 원인을 가른다:
///
/// | 보낸 수(`sent_chunks`) | 받은 수(프런트) | 읽는 법 |
/// | --- | --- | --- |
/// | 0 | 0 | **Rust 가 안 보냈다** — 펌프가 멎었거나 수문이 닫힌 채 남았다 |
/// | > 0 | 0 | **IPC 유실** — 채널 번호에 빈칸이 생겨 그 뒤가 JS 큐에 갇혔다 |
/// | > 0 | > 0 | 정상 (감시가 발동했다면 그냥 느린 셸이다) |
///
/// `send_failures > 0` 이면 유실이 **확정**이다 (`last_error` 에 사유가 남는다).
///
/// 로컬·SSH 를 `kind` 하나로 같이 받는다 — 프런트에서는 한 함수이고, 계수기 자체가
/// 두 종류가 공유하는 배처([`crate::output::spawn_batcher`])에 얹혀 있어 여기가 제자리다.
///
/// `async` 인 이유는 규칙 그대로다 (docs/conventions.md) — 하는 일은 잠금 한 번과 원자
/// 읽기뿐이라 동기여도 되지만, **이 명령을 부르는 순간이 하필 "다른 타일이 침묵 중" 일 때**라
/// UI 스레드를 한 톨도 빌리지 않는 편이 맞다.
#[tauri::command]
pub async fn session_stats(kind: String, id: u32) -> Result<serde_json::Value, String> {
    match kind.as_str() {
        // 로컬·SSH 모두 세션 서버의 배처가 센다(③-2 · ③-3b2) — "보낸 수" 는 서버가 파이프로 내보낸 것이다.
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
