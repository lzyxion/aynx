//! 세션 서버 안의 **신호 평면 op**(③-3a) — 토큰 표(`crate::agent_signal`)·에이전트 상태 표(`crate::agent_state`)의 주인이
//! 서버라서, GUI 는 이 op 들로만 닿는다. 받는 쪽(HTTP)은 `server::signal_http`.
//!
//! | op | 등급 | 몸 → 답 | 쓰는 곳 |
//! | --- | --- | --- | --- |
//! | `agent_states_snapshot` | 읽기 | — → `[[stream, state], …]` | 창의 부팅·이관 재부착 |
//! | `agent_state_forget` | 쓰기 | `{stream, cause?}` → — | 창이 본 새 CLI·셸 복귀(`cause` — `crate::agent_state::ForgetCause`) |
//! | `agent_state_interrupt` | 쓰기 | `{stream}` → `{interrupted}` | 대화 면 [중지] — 실행 · 권한 대기면 `interrupt` 를 적고 `agent-signal` 로 방송(`crate::agent_state::interrupt`) |
//! | `agent_state_seen` | 쓰기 | `{stream, seq}` → `{sent}` | 어느 창에서 사람이 그 타일의 턴 끝을 봤다 — 표는 그대로 · 낡지 않았으면 `agent-seen{stream, seq}` 방송(`crate::agent_state::seen`) |
//! | `agent_conversation_launched` | 쓰기 | `{stream, agent, id}` → `{linked}` | 창이 그 타일에 대화를 여는 명령을 쓴다(재개 autorun) — 띄우며 적은 연결(id 뿐) |
//! | `agent_conversation_links` | 읽기 | — → `[{agent, id, streams, releasedAt}, …]` | 지난 대화의 열림 판정(`crate::agent_state::convo` — id 뿐) |
//!
//! **신호 토큰은 파이프를 타지 않는다**(③-3b2). 로컬 타일의 토큰은 서버의 `open` 이, 원격(SSH) 타일의 토큰은 서버의 SSH
//! 열기(`ssh::open::arm_agent_signal`)가 같은 프로세스의 토큰 표에서 뽑아 자식 환경·원격 서버의 신호 파일로 넣고, 세션 자원이
//! 거둬질 때 서버가 거둔다. ③-3a 의 `signal_issue`·`signal_revoke`·`signal_written`·`signal_live` op(원격 토큰이 GUI 를 거치던
//! 길)는 지웠다. 원격 토큰도 이제 GUI 연결과 함께 죽지 않는 SSH 세션의 것이라 주인 연결이 없다 — 고아 정리(`orphan_conn`·
//! `prune_orphans`)는 옛 판의 남은 표를 위해 그대로 둔다.

use serde::Deserialize;
use serde_json::Value;

use super::ipc::frame::code;
use super::ipc::WireError;
use super::sessions::ConnCtx;

/// 이 파일이 받는 op 인가(`serve::dispatch` 가 가른다 — 맵 조작뿐이라 고리 안에서 순서대로 처리한다).
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
    /// 없으면 예전 뜻(까닭 모름 — `ForgetCause::Session`)
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

/// `agent_conversation_launched` 의 몸 — 스트림 모양(`crate::tile_env::stream_ok`) · 에이전트(`crate::agent_signal::CLI_IDS` 의 이름) ·
/// 대화 id(UUID 모양 — `crate::agent_sessions::uuid_shape`)만 받는다. 값은 id 뿐이라 장부 밖으로 나갈 글자가 없다.
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

/// op 하나 — `ctx.signal_port` 가 없으면(신호 평면을 못 띄운 서버) 발급은 실패, 나머지는 표만 본다.
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
            // 표가 매긴 seq 와 전이 결과를 실어 신호 평면과 같은 이름으로 방송 — 창 · 탭 점이 같은 길로 풀린다
            let payload = crate::agent_state::interrupt(&a.stream);
            let interrupted = payload.is_some();
            if let Some(p) = payload {
                super::hub::emit(crate::agent_signal::EVENT, p);
            }
            super::tile_permission::interrupted(&a.stream);
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
