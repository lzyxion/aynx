//! 세션 서버 안의 신호 평면 op — 토큰 표(`crate::agent_signal`)·에이전트 상태 표(`crate::agent_state`)의 주인이 서버라 GUI 는 이 op 들로만 닿는다.
//!
//! 신호 토큰은 파이프를 타지 않는다 — 서버가 같은 프로세스의 토큰 표에서 뽑아 자식 환경 · 원격 신호 파일로 넣는다(→ docs/invariants.md 전문 11).
//! 고아 정리(`orphan_conn`·`prune_orphans`)는 옛 판의 남은 표를 위해 둔다.

use serde::Deserialize;
use serde_json::Value;

use super::ipc::frame::code;
use super::ipc::WireError;
use super::sessions::ConnCtx;

pub(crate) fn is_signal_op(op: &str) -> bool {
    matches!(
        op,
        "agent_states_snapshot"
            | "agent_state_forget"
            | "agent_state_interrupt"
            | "agent_state_seen"
            | "agent_conversation_links"
            | "agent_conversation_launched"
    )
}

#[derive(Deserialize)]
struct ForgetArg {
    stream: String,
    /// 없으면 옛 뜻(`ForgetCause::Session`)
    #[serde(default)]
    cause: Option<String>,
}

#[derive(Deserialize)]
struct StreamArg {
    stream: String,
}

#[derive(Deserialize)]
struct SeenArg {
    stream: String,
    seq: u64,
}

#[derive(Deserialize)]
struct LaunchArg {
    stream: String,
    agent: String,
    id: String,
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|e| WireError::new(code::BAD_BODY, e.to_string()))
}

/// 스트림 · 에이전트 이름 · UUID 모양의 대화 id 만 받는다 — 장부 밖으로 나갈 글자가 없게.
fn launch_args(a: &LaunchArg) -> Result<(&'static str, &str), WireError> {
    let bad = |m: &str| WireError::new(code::BAD_BODY, m.to_owned());
    if !crate::tile_env::stream_ok(&a.stream) {
        return Err(bad("bad stream"));
    }
    let agent = crate::agent_signal::CLI_IDS
        .iter()
        .copied()
        .find(|c| *c == a.agent)
        .ok_or_else(|| bad("bad agent"))?;
    if !crate::agent_sessions::uuid_shape(&a.id) {
        return Err(bad("bad id"));
    }
    Ok((agent, &a.id))
}

pub(crate) fn handle(op: &str, b: Value, _ctx: &ConnCtx) -> Result<Value, WireError> {
    match op {
        "agent_states_snapshot" => Ok(serde_json::to_value(crate::agent_state::snapshot()).unwrap_or(Value::Null)),
        "agent_conversation_links" => {
            Ok(serde_json::to_value(crate::agent_state::conversation_links()).unwrap_or(Value::Null))
        }
        "agent_state_forget" => {
            let a: ForgetArg = body(b)?;
            crate::agent_state::forget_by(&a.stream, crate::agent_state::ForgetCause::parse(a.cause.as_deref()));
            Ok(Value::Null)
        }
        "agent_state_interrupt" => {
            let a: StreamArg = body(b)?;
            if !crate::tile_env::stream_ok(&a.stream) {
                return Err(WireError::new(code::BAD_BODY, "bad stream".to_owned()));
            }
            // 신호 평면과 같은 이벤트 이름으로 방송해야 창 · 탭 점이 같은 길로 풀린다
            let payload = crate::agent_state::interrupt(&a.stream);
            let interrupted = payload.is_some();
            if let Some(p) = payload {
                super::hub::emit(crate::agent_signal::EVENT, p);
            }
            super::tile_permission::interrupted(&a.stream);
            super::messenger_bridge::untend(&a.stream);
            Ok(serde_json::json!({ "interrupted": interrupted }))
        }
        "agent_state_seen" => {
            let a: SeenArg = body(b)?;
            if !crate::tile_env::stream_ok(&a.stream) {
                return Err(WireError::new(code::BAD_BODY, "bad stream".to_owned()));
            }
            let payload = crate::agent_state::seen(&a.stream, a.seq);
            let sent = payload.is_some();
            if let Some(p) = payload {
                super::hub::emit(crate::agent_state::SEEN_EVENT, p);
            }
            Ok(serde_json::json!({ "sent": sent }))
        }
        "agent_conversation_launched" => {
            let a: LaunchArg = body(b)?;
            let (agent, id) = launch_args(&a)?;
            Ok(serde_json::json!({ "linked": crate::agent_state::note_launch(&a.stream, agent, id) }))
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}
