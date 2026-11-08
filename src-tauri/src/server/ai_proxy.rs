//! GUI 쪽 **AI 평면 프록시**(③-3c) — 거울·MCP 좌표·관제판 목록의 Tauri 명령(같은 이름·인자·반환)과 세션 서버 op 사이.
//!
//! - **거울 큐**: 프런트의 `report_session`·`update_session_context`·`push_session_block(s)`·`drop_session` 은 **동기 명령**으로
//!   남아(부른 순서 = 큐 순서) 한 줄 큐에 쌓이고, 일꾼 하나가 모인 만큼을 op `ctx_batch` **한 장**에 실어 보낸다 — 앞 장의 답을
//!   기다리는 동안 쌓인 것이 다음 장이다(쓰기가 몰리면 저절로 묶인다). 같은 키의 `update`(라이브 필드 **통째 교체**)가 아직
//!   나가지 않았으면 그 자리에서 새 값으로 갈아 끼운다(합치기 — 뒤에 같은 키의 다른 줄이 있거나 창 거둠 벽을 넘으면 합치지
//!   않는다). 창 거둠(`reap`)도 같은 큐를 지나 거울 쓰기와 순서가 선다. 부하 수치는 [`mirror_stats`](설정의 세션 서버 줄).
//! - **MCP 좌표**: 주인은 서버(`mcp.json` 을 서버가 쓴다 — GUI 는 쓰지 않는다). [`mcp_coords`]·[`mcp_tile_token`] 은 **그때그때**
//!   서버에 묻는다(캐시 없음 — 서버가 바뀌면 다음 물음이 새 좌표다: `session-server-connected{replaced}` 를 기다릴 필요가 없다).
//!   (3차 4단계) MCP 토큰은 **타일마다**다 — 셸 환경에는 서버가 `open` 에서 직접 넣고, GUI 는 그 타일의 토큰을 `--mcp-config` 파일
//!   (`agent_mcp::SessionsServer`)에만 쓴다. 프런트·로그로 내보내지 않는다(결정 6 · 시험 `tile_token_never_reaches_frontend`).
//! - 승인은 여기 없다 — `operations::approval::approve_operation` 이 `client::request_approve` 로 보낸다.

use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex, Once};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{oneshot, Notify};

use super::ai::{MirrorLine, MirrorOp};
use super::client;
use super::ipc::{Grade, WireError};
use crate::context::{CommandBlockMirror, LastCommand};

/// 서버 실패를 사람 문구로(세션 op 실패의 `message` 는 이미 사람 문구다).
pub(crate) fn wire_message(e: WireError) -> String {
    match e.code.as_str() {
        "not-connected" | "closed" | "io" | "timeout" => crate::i18n::tr!(
            ko: "세션 서버에 닿지 못했습니다 ({code}: {msg})",
            en: "Could not reach the session server ({code}: {msg})",
            code = e.code,
            msg = e.message
        ),
        _ => e.message,
    }
}

/// 서버 op 하나(읽기·쓰기 등급).
pub(crate) async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    client::request(kind, op, body).await.map_err(wire_message)
}

// ---------------------------------------------------------------------------
// 거울 큐
// ---------------------------------------------------------------------------

/// 거울 큐의 부하 수치 — 쌓인 줄 · 합쳐 없앤 줄 · 보낸 줄 · 보낸 장(프레임) · 보낸 몸 바이트 · 실패한 장 · 한 장의 최대 줄.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStats {
    pub enqueued: u64,
    pub coalesced: u64,
    pub sent_ops: u64,
    pub batches: u64,
    pub bytes: u64,
    pub failed_batches: u64,
    pub max_batch: u64,
}

type Waiter = Option<oneshot::Sender<Value>>;

/// 큐의 한 줄 — 연산 · 넣은 시각(epoch ms — 서버가 신선도 표식으로 쓴다) · 답을 기다리는 손(창 거둠만).
type Queued = (MirrorOp, u64, Waiter);

struct Mirror {
    q: Mutex<VecDeque<Queued>>,
    notify: Notify,
    stats: Mutex<MirrorStats>,
    started: Once,
}

static MIRROR: LazyLock<Mirror> = LazyLock::new(|| Mirror {
    q: Mutex::new(VecDeque::new()),
    notify: Notify::new(),
    stats: Mutex::new(MirrorStats::default()),
    started: Once::new(),
});

/// 한 장에 싣는 줄의 상한 — 스크롤백 꼬리(400줄) 갱신이 몰려도 한 프레임이 몇 MB 를 넘지 않게.
const BATCH_MAX: usize = 128;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 큐에 한 줄 — 합치기 규칙은 머리말. 합쳤으면 `true`(시각도 새 것으로).
fn push(q: &mut VecDeque<Queued>, op: MirrorOp, at: u64, waiter: Waiter) -> bool {
    if waiter.is_none() {
        if let MirrorOp::Update { key, .. } = &op {
            // 뒤에서부터 같은 키의 마지막 줄을 찾는다 — 창 거둠(열쇠 없음)은 벽이다.
            for (queued, qat, w) in q.iter_mut().rev() {
                match queued.key() {
                    None => break,
                    Some(k) if k == key => {
                        if matches!(queued, MirrorOp::Update { .. }) && w.is_none() {
                            *queued = op;
                            *qat = at;
                            return true;
                        }
                        break;
                    }
                    Some(_) => {}
                }
            }
        }
    }
    q.push_back((op, at, waiter));
    false
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn enqueue(op: MirrorOp, waiter: Waiter) {
    MIRROR.started.call_once(|| {
        tauri::async_runtime::spawn(worker());
    });
    let coalesced = push(&mut lock(&MIRROR.q), op, now_ms(), waiter);
    {
        let mut st = lock(&MIRROR.stats);
        st.enqueued += 1;
        if coalesced {
            st.coalesced += 1;
        }
    }
    MIRROR.notify.notify_one();
}

async fn worker() {
    loop {
        let batch: Vec<Queued> = {
            let mut q = lock(&MIRROR.q);
            let n = q.len().min(BATCH_MAX);
            q.drain(..n).collect()
        };
        if batch.is_empty() {
            MIRROR.notify.notified().await;
            continue;
        }
        let (ops, waiters): (Vec<MirrorLine>, Vec<Waiter>) =
            batch.into_iter().map(|(op, at, w)| (MirrorLine { at, op }, w)).unzip();
        let n = ops.len() as u64;
        let body = json!({ "ops": ops });
        let bytes = serde_json::to_vec(&body).map(|v| v.len() as u64).unwrap_or(0);
        let r = client::request(Grade::Write, "ctx_batch", body).await;
        {
            let mut st = lock(&MIRROR.stats);
            st.batches += 1;
            st.sent_ops += n;
            st.bytes += bytes;
            st.max_batch = st.max_batch.max(n);
            if r.is_err() {
                st.failed_batches += 1;
            }
        }
        let results = match r {
            Ok(Value::Array(rs)) => rs,
            Ok(_) => Vec::new(),
            Err(e) => {
                // 서버에 닿지 못했다 — 이 장은 버린다(거울은 다음 보고·갱신이 다시 채운다 · 서버가 바뀌었으면 세션도 끝났다).
                eprintln!("[server] 거울 묶음 {n}줄을 보내지 못했습니다: {} {}", e.code, e.message);
                Vec::new()
            }
        };
        for (i, w) in waiters.into_iter().enumerate() {
            if let Some(w) = w {
                let _ = w.send(results.get(i).cloned().unwrap_or(Value::Null));
            }
        }
    }
}

/// 거울 큐 수치 — `session_server_status` 가 싣는다.
pub(crate) fn mirror_stats() -> MirrorStats {
    lock(&MIRROR.stats).clone()
}

/// 세션 정체성+옵트인을 등록/갱신한다(옵트아웃이면 서버가 라이브 필드를 즉시 비우고 그 세션의 대기 작업안을 만료시킨다).
/// 실행 라우팅(SSH 세션 id)도 같은 줄이 잇는다.
///
/// **동기로 남는다**(docs/conventions.md 의 예외) — 하는 일이 큐 잠금 한 번과 넣기뿐이고, 부른 순서가 곧 거울의 순서다(동기
/// 명령은 온 순서대로 돈다). 인자 이름은 프런트 계약이다. 소유 창 라벨은 Tauri 가 주입한다(reap 이 죽은 창의 거울을 거둔다).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn report_session(
    webview: tauri::Webview,
    key: String,
    label: String,
    kind: String,
    code: String,
    opted_in: bool,
    ssh_session_id: Option<u32>,
    screen_only: Option<bool>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    tab_key: Option<String>,
    host_alias: Option<String>,
) -> Result<(), String> {
    enqueue(
        MirrorOp::Report {
            key,
            label,
            kind,
            code,
            opted_in,
            ssh_session_id,
            screen_only,
            workspace_id,
            workspace_name,
            tab_key,
            host_alias,
            owner: webview.window().label().to_string(),
        },
        None,
    );
    Ok(())
}

/// 옵트인된 세션의 라이브 필드(status·last·scrollback)를 갱신한다 — 같은 키의 아직 안 나간 갱신은 이 값으로 합쳐진다.
/// **동기로 남는다**([`report_session`] 과 같은 근거).
#[tauri::command]
pub fn update_session_context(
    key: String,
    status: Option<String>,
    last: Option<LastCommand>,
    scrollback_tail: Vec<String>,
) -> Result<(), String> {
    enqueue(
        MirrorOp::Update {
            key,
            status,
            last,
            scrollback_tail,
        },
        None,
    );
    Ok(())
}

/// 옵트인된 세션의 이력에 블록 하나를 덧붙인다(OSC 133 `D` 마다). **동기로 남는다** — 이력은 순서가 곧 정확성이다.
#[tauri::command]
pub fn push_session_block(key: String, block: CommandBlockMirror) -> Result<(), String> {
    enqueue(MirrorOp::Block { key, block }, None);
    Ok(())
}

/// 이관으로 창을 건너온 타일의 이력을 한 번에 다시 채운다.
#[tauri::command]
pub async fn push_session_blocks(key: String, blocks: Vec<CommandBlockMirror>) -> Result<(), String> {
    enqueue(MirrorOp::Blocks { key, blocks }, None);
    Ok(())
}

/// 세션을 거울에서 지운다(패널 닫힘·창 종료) — 서버가 라우팅·대기 작업안도 함께 거둔다.
#[tauri::command]
pub fn drop_session(key: String) -> Result<(), String> {
    enqueue(MirrorOp::Drop { key }, None);
    Ok(())
}

/// 죽은 창의 거울을 거둔다(`reap`) — 같은 큐를 지나 그 창의 마지막 거울 쓰기 뒤에 선다. 거둔 스트림들.
pub(crate) async fn reclaim_window(window: &str, before: u64, keep: Vec<String>) -> Vec<String> {
    let (tx, rx) = oneshot::channel();
    enqueue(
        MirrorOp::Reclaim {
            window: window.to_string(),
            before,
            keep,
        },
        Some(tx),
    );
    rx.await
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// MCP 좌표 · 관제판
// ---------------------------------------------------------------------------

/// 서버 MCP 의 좌표(비밀 없음).
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct McpCoords {
    pub running: bool,
    pub port: u16,
    pub url: String,
}

/// 서버 MCP 의 좌표 — 서버에 닿지 못하면 `None`.
pub(crate) async fn mcp_coords() -> Option<McpCoords> {
    let v = call(Grade::Read, "mcp_coords", json!({})).await.ok()?;
    serde_json::from_value(v).ok()
}

/// 그 AI 타일의 **타일 MCP 토큰**(3차 4단계 — 서버가 `open` 에서 그 타일만의 것을 뽑았다 · `crate::tile_token`) — **GUI Rust 만**(그 타일의
/// `--mcp-config` 파일에만 · 로그·프런트 금지). MCP 가 꺼져 있거나 · 서버에 닿지 못하거나 · 그 스트림의 살아 있는 회차가 없으면 `None`.
async fn mcp_tile_token(stream: &str) -> Option<String> {
    let v = call(Grade::Read, "mcp_tile_token", json!({ "stream": stream })).await.ok()?;
    v.get("token").and_then(Value::as_str).map(str::to_string).filter(|t| !t.is_empty())
}

/// AI 타일의 `--mcp-config`·codex 인자에 실을 세션 서버 좌표(`agent_mcp::SessionsServer`) — **그 타일의 토큰**으로(3차 4단계 — 예전에는 서버
/// 전역 토큰 하나였다). Claude 파일은 토큰이 달라 타일마다 하나가 된다(이름의 해시가 다르다). 스트림이 없으면(옛 프런트) 싣지 않는다.
pub(crate) async fn sessions_server_for(stream: Option<&str>) -> Option<crate::agent_mcp::SessionsServer> {
    let stream = stream?;
    let coords = mcp_coords().await?;
    let token = mcp_tile_token(stream).await?;
    crate::agent_mcp::SessionsServer::running(coords.running, coords.port, &token, crate::instance::DEV)
}

/// 사람 콘솔용 전역 세션 목록 — MCP `list_sessions` 와 같은 객체(서버 op `console_sessions`). 실패면 빈 목록.
#[tauri::command]
pub async fn list_console_sessions() -> Result<Value, String> {
    Ok(call(Grade::Read, "console_sessions", json!({}))
        .await
        .unwrap_or_else(|_| Value::Array(Vec::new())))
}

/// **마지막으로 처리한 MCP 요청**의 도장(없으면 `None` = 아직 아무도 안 붙었다) — 상태바 `✦ AI 연결`.
#[tauri::command]
pub async fn mcp_activity() -> Result<Option<crate::mcp::McpActivity>, ()> {
    Ok(call(Grade::Read, "mcp_activity", json!({}))
        .await
        .ok()
        .and_then(|v| serde_json::from_value(v).ok()))
}

/// 설정 › MCP › 세션 서버 하위 화면의 **도구 목록** — 이 서버가 어느 호출자에게든 낼 수 있는 도구 `[{name, group, description}]`
/// (서버 op `mcp_tools` — `tools/list` 의 스키마 함수에서 뽑는다 · 비밀 없음). 서버에 닿지 못하거나 옛 서버(op 를 모른다)면 오류 문구.
#[tauri::command]
pub async fn mcp_tools() -> Result<Value, String> {
    call(Grade::Read, "mcp_tools", json!({})).await
}

/// 같은 화면의 **최근 도구 호출** — 최근 것부터 200줄(서버 op `mcp_calls` · 서버 메모리에만 — 서버가 다시 뜨면 빈다). 한 줄은
/// 도구 이름 · 시각 · 호출자 종류 · 클라이언트 이름 · 결과 종류 · 거절 낱말뿐이다(인자 · 결과 · 토큰 · 스트림 id 없음 — `mcp::insight`).
#[tauri::command]
pub async fn mcp_calls() -> Result<Value, String> {
    call(Grade::Read, "mcp_calls", json!({})).await
}

// ---------------------------------------------------------------------------
// 서버 자동 승인과의 짝(③-4 — `operations::auto`)
// ---------------------------------------------------------------------------

/// 창마다 "사람이 지금 검토 카드를 열어 둔 작업안" — 합집합을 서버에 보낸다(서버 자동 승인이 건너뛴다).
static REVIEWING: LazyLock<Mutex<std::collections::HashMap<String, Vec<String>>>> = LazyLock::new(Default::default);

fn reviewing_union() -> Vec<String> {
    let map = REVIEWING.lock().unwrap_or_else(|e| e.into_inner());
    let mut ids: Vec<String> = map.values().flatten().cloned().collect();
    ids.sort();
    ids.dedup();
    ids
}

/// 서버에 지금 합집합을 보낸다(실패는 삼킨다 — 다음 변화·재연결이 다시 보낸다).
pub(crate) async fn push_reviewing() {
    let _ = call(Grade::Write, "ops_reviewing", json!({ "ids": reviewing_union() })).await;
}

/// **이 창에서 사람이 검토 중인 작업안**(확인 패널을 연 카드) — 서버의 사전 정책 자동 승인이 그 작업안을 건드리지 않게 한다.
/// 창이 사라지면 그 창 몫을 걷는다([`forget_reviewing_window`]). 승인 등급이 아니다(쓰기 — 자동 승인을 **막는** 쪽이다).
#[tauri::command]
pub async fn set_reviewing_operations(window: tauri::WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    {
        let mut map = REVIEWING.lock().unwrap_or_else(|e| e.into_inner());
        if ids.is_empty() {
            map.remove(window.label());
        } else {
            map.insert(window.label().to_string(), ids);
        }
    }
    push_reviewing().await;
    Ok(())
}

/// 창이 파괴됐다 — 그 창의 검토 중 몫을 걷는다(`lib.rs` 의 `Destroyed`).
pub(crate) fn forget_reviewing_window(label: &str) {
    let had = REVIEWING.lock().unwrap_or_else(|e| e.into_inner()).remove(label).is_some();
    if had {
        tauri::async_runtime::spawn(push_reviewing());
    }
}

/// **GUI 가 없던 동안 끝난 실행**(서버의 미전달 큐) — 주 창 부팅이 꺼내 "그동안 끝난 실행 N건" 한 줄로 알린다. 꺼내면 비워진다.
#[tauri::command]
pub async fn take_unseen_operation_results() -> Result<Value, String> {
    Ok(call(Grade::Write, "ops_unseen_take", json!({}))
        .await
        .unwrap_or_else(|_| Value::Array(Vec::new())))
}

/// **아직 사람의 승인을 기다리는 작업안 하나**(승인 요약 — 승인 대기 메신저 알림이 보내기 직전에 다시 본다). 서버 목록의 `pending`
/// 에서 찾고, 상태가 검토 대기가 아니거나 이미 승인 방식이 찍혔으면(자동 승인 · 거절 · 만료로 떠났다) `None`.
pub(crate) async fn pending_operation(id: &str) -> Option<crate::operations::Operation> {
    let list = call(Grade::Read, "ops_list", json!({})).await.ok()?;
    let v = list
        .get("pending")
        .and_then(Value::as_array)?
        .iter()
        .find(|v| v.get("operationId").and_then(Value::as_str) == Some(id))?;
    let op: crate::operations::Operation = serde_json::from_value(v.clone()).ok()?;
    crate::operations::notify::still_pending(&op).then_some(op)
}

// ---------------------------------------------------------------------------
// agent-mcp 실행 설정 파일 — 세션별 주장(③-3c · 설계 4.4 "생존 인스턴스·파일 사용 여부")
// ---------------------------------------------------------------------------

/// 이 스트림(AI 타일)이 이 실행 설정 파일을 쓴다고 서버에 알린다 — **블로킹**(`agent_mcp::apply_configured` 가 블로킹 풀에서,
/// 파일을 쓰기 **전에** 부른다: 다른 타일의 회수가 막 쓴 파일을 지우지 않게). 성공하면 `true`.
pub(crate) fn claim_agent_mcp_blocking(stream: &str, file: &str) -> bool {
    tauri::async_runtime::block_on(call(
        Grade::Write,
        "agent_mcp_claim",
        json!({ "stream": stream, "file": file }),
    ))
    .is_ok()
}

/// 서버의 살아 있는 세션이 쥔 실행 설정 파일 이름들 — 서버에 닿지 못하면 `None`(그때 시작 정리는 아무것도 지우지 않는다).
pub(crate) async fn claimed_agent_mcp() -> Option<Vec<String>> {
    let v = call(Grade::Read, "agent_mcp_claims", json!({})).await.ok()?;
    serde_json::from_value(v).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upd(key: &str, line: &str) -> MirrorOp {
        MirrorOp::Update {
            key: key.into(),
            status: None,
            last: None,
            scrollback_tail: vec![line.into()],
        }
    }

    fn tail(op: &MirrorOp) -> String {
        match op {
            MirrorOp::Update { scrollback_tail, .. } => scrollback_tail.join(","),
            other => format!("{other:?}"),
        }
    }

    /// 합치기 — 같은 키의 아직 안 나간 갱신만 새 값으로 갈아 끼운다. 사이에 같은 키의 다른 줄(블록·지우기)이 있거나 창 거둠
    /// 벽을 넘으면 합치지 않는다. 다른 키는 순서를 건드리지 않는다.
    #[test]
    fn updates_coalesce_only_when_nothing_of_that_key_follows() {
        let mut q: VecDeque<Queued> = VecDeque::new();
        assert!(!push(&mut q, upd("a", "1"), 1, None));
        assert!(!push(&mut q, upd("b", "1"), 2, None));
        assert!(push(&mut q, upd("a", "2"), 3, None), "같은 키 — 합침");
        assert_eq!(q.len(), 2);
        assert_eq!((tail(&q[0].0), q[0].1), ("2".to_string(), 3), "제자리에서 갈아 끼운다(순서 유지 · 시각은 새 것)");
        assert!(!push(&mut q, MirrorOp::Drop { key: "a".into() }, 4, None));
        assert!(!push(&mut q, upd("a", "3"), 5, None), "지우기 뒤의 갱신은 합치지 않는다");
        assert!(!push(
            &mut q,
            MirrorOp::Reclaim { window: "main".into(), before: 0, keep: vec![] },
            6,
            None
        ));
        assert!(!push(&mut q, upd("b", "2"), 7, None), "창 거둠 벽 너머로는 합치지 않는다");
        assert_eq!(q.len(), 6);
    }
}
