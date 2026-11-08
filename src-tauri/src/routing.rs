//! 실행 라우팅 표 — `streamId → 살아 있는 SSH 세션 u32` (로드맵 **단계 9** · 실행 브로커).
//!
//! ## 이 표의 존재 이유 (실행 브로커의 안전 못)
//!
//! 작업안([`crate::operations`])의 `targets` 는 **거울 키(streamId)** 다 — 이관·리로드를 넘는
//! 안정 신원이라 참조에는 좋지만, **그 자체로는 무엇에도 붙어 있지 않다.** 실제로 명령을 돌리려면
//! streamId 를 지금 살아 있는 SSH 전송로([`crate::ssh::SshSessions`] 의 `u32`)로 풀어야 한다.
//! 그 다리가 이 표다.
//!
//! executor 는 대상을 **오직 이 표로만** 푼다(보안 불변 #5). 표에 없으면(세션이 닫혔거나 공유되지
//! 않으면) 그 대상은 실행되지 않고 결과가 `Failed`(오류분류 = 대상 없음)로 남는다. AI 문자열이나
//! 작업안의 어떤 필드도 여기 끼어들 수 없다 — 표는 **프런트가 살아 있는 세션에 대해서만** 채운다.
//!
//! ## 누가 채우는가
//!
//! 프런트의 거울 보고(`report_session` — ③-3c 부터 세션 서버의 거울 묶음 `ctx_batch`, `crate::server::ai`)가 채운다. 터미널이
//! 세션을 보고할 때 SSH 이고 지금 물고 있는 백엔드 세션 id 가 있으면 그 값을 실어 보내고([`set`]), 로컬이거나 id 가 없으면
//! 지운다([`clear`]). 세션이 사라지면(`drop_session`) 역시 지운다. 헤드리스 위임 접속은 서버가 직접 잇는다. 표는 **세션 서버
//! 프로세스**에 산다 — 실행기와 같은 곳이다.
//!
//! **로컬은 여기 들어오지 않는다** — 단계 9 의 실행은 SSH 전용이다(확정 스코프). 로컬 exec 은 후속.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// 저장소 본체 — 키는 거울 키(streamId), 값은 살아 있는 SSH 세션 u32.
pub type RoutingTable = Arc<Mutex<HashMap<String, u32>>>;

// ---------------------------------------------------------------------------
// 순수 저장소 연산 (테스트 대상) — 명령 핸들러는 잠금만 잡고 이쪽을 부른다.
// ---------------------------------------------------------------------------

/// streamId 를 살아 있는 SSH u32 로 잇는다(upsert). 재연결로 u32 가 바뀌면 그 자리에서 갱신된다.
pub(crate) fn set(map: &mut HashMap<String, u32>, stream_id: String, ssh_id: u32) {
    map.insert(stream_id, ssh_id);
}

/// streamId 의 라우팅을 지운다(로컬로 바뀜·세션 닫힘·id 미상). 없으면 아무 일도 없다.
pub(crate) fn clear(map: &mut HashMap<String, u32>, stream_id: &str) {
    map.remove(stream_id);
}

/// streamId 를 살아 있는 SSH u32 로 푼다. 표에 없으면 `None`(그 대상은 실행하지 않는다).
pub(crate) fn resolve(map: &HashMap<String, u32>, stream_id: &str) -> Option<u32> {
    map.get(stream_id).copied()
}

/// 위임 헤드리스 세션의 **결정적** streamId — `delegated:<alias>`.
///
/// A1 은 crypto 난수 hex 를 썼지만(프런트 키와 충돌 회피), A2b 에서 실행 브로커가 아직 접속 안 된
/// 위임 대상을 **자동 접속**하려면 별칭만으로 같은 키를 재구성할 수 있어야 한다. `delegated:` 접두는
/// 프런트 난수 키(16바이트 hex)와 절대 부딪히지 않는 불투명 네임스페이스다. 별칭은 ssh_config/
/// delegation.toml 에서 온 셸식 호스트 이름이라 별도 이스케이프는 하지 않는다(옵트인 키로만 쓴다).
pub(crate) fn delegated_stream_id(alias: &str) -> String {
    format!("delegated:{alias}")
}

/// streamId 가 `delegated:` 네임스페이스면 그 별칭을 돌려준다(아니면 `None`) — [`delegated_stream_id`] 의 역.
///
/// 실행 브로커([`crate::operations`])가 대상 id 하나만 보고 "이건 위임 대상인가·별칭은 무엇인가"
/// 를 거울 조회 없이 판정하는 데 쓴다(propose 재검사·자동 접속의 유일한 분기점).
pub(crate) fn delegated_alias_of(stream_id: &str) -> Option<&str> {
    stream_id.strip_prefix("delegated:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_resolve_and_clear_round_trip() {
        let mut m = HashMap::new();
        assert_eq!(
            resolve(&m, "stream-1"),
            None,
            "빈 표는 아무것도 풀지 못한다"
        );
        set(&mut m, "stream-1".into(), 7);
        assert_eq!(resolve(&m, "stream-1"), Some(7));
        // 재연결 — 같은 streamId 가 새 u32 로 갱신된다.
        set(&mut m, "stream-1".into(), 9);
        assert_eq!(resolve(&m, "stream-1"), Some(9));
        // 지우면 다시 풀리지 않는다 = 그 대상은 실행 불가(Failed·대상 없음).
        clear(&mut m, "stream-1");
        assert_eq!(resolve(&m, "stream-1"), None);
        // 없는 것을 지워도 무해하다.
        clear(&mut m, "ghost");
    }
}
