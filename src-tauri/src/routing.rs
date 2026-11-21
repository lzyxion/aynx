//! 실행 라우팅 표 — `streamId → 살아 있는 SSH 세션 u32`. 세션 서버 프로세스(실행기와 같은 곳)에 산다.
//!
//! - 실행기는 작업안 대상을 **오직 이 표로만** 푼다 — 표에 없으면(세션이 닫혔거나 공유되지 않으면) 그 대상은 실행되지 않고 `Failed`(대상 없음).
//!   AI 문자열이나 작업안의 어떤 필드도 여기 끼어들 수 없다 — 표는 살아 있는 세션에 대해서만 채운다.
//! - **로컬은 여기 들어오지 않는다** — 실행은 SSH 전용이다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub type RoutingTable = Arc<Mutex<HashMap<String, u32>>>;

pub(crate) fn set(map: &mut HashMap<String, u32>, stream_id: String, ssh_id: u32) {
    map.insert(stream_id, ssh_id);
}

pub(crate) fn clear(map: &mut HashMap<String, u32>, stream_id: &str) {
    map.remove(stream_id);
}

pub(crate) fn resolve(map: &HashMap<String, u32>, stream_id: &str) -> Option<u32> {
    map.get(stream_id).copied()
}

/// 실행 브로커가 아직 접속 안 된 위임 대상을 자동 접속하려면 별칭만으로 같은 키를 재구성할 수 있어야 한다 — 그래서 결정적이다.
/// `delegated:` 접두는 프런트 난수 키(16바이트 hex)와 부딪히지 않는 네임스페이스다.
pub(crate) fn delegated_stream_id(alias: &str) -> String {
    format!("delegated:{alias}")
}

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
        set(&mut m, "stream-1".into(), 9);
        assert_eq!(resolve(&m, "stream-1"), Some(9));
        clear(&mut m, "stream-1");
        assert_eq!(resolve(&m, "stream-1"), None);
        clear(&mut m, "ghost");
    }
}
