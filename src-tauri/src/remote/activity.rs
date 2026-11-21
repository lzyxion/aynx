//! 원격 접속 기록 · 지금 붙은 원격 창 수.
//!
//! - 기록은 메모리 고리 하나 — 파일에 남기지 않는다. 줄에 비밀은 없다(토큰 · 암호 · 코드 · IP 없음).
//! - 붙은 창 수는 여기서 센다 — `ws.rs` 의 연결 자리 셈은 업그레이드 전에 잡혀 창 생성 실패까지 세므로 쓰지 않는다.

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};

pub(crate) const MAX_LOG: usize = 50;

/// 프런트가 `kind` 글자 그대로 문구로 바꾼다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// 기기 생성.
    Paired,
    /// 볼트도 열린다.
    Unlocked,
    /// 원격 가림막 · 재확인의 마스터 암호 틀림 — 횟수만(암호는 없다).
    UnlockFailed,
    Locked,
    Connected,
    Disconnected,
    Revoked,
    DisconnectedAll,
    /// 재확인을 거쳐 재확인 명령을 보냈다(`what` = 그 일의 사람 말 이름). 서버에서 통과했는지는 아니다.
    Reauthorized,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Paired => "paired",
            Kind::Unlocked => "unlocked",
            Kind::UnlockFailed => "unlockFailed",
            Kind::Locked => "locked",
            Kind::Connected => "connected",
            Kind::Disconnected => "disconnected",
            Kind::Revoked => "revoked",
            Kind::DisconnectedAll => "disconnectedAll",
            Kind::Reauthorized => "reauthorized",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub at: String,
    pub kind: &'static str,
    /// 전체 끊기는 빈 글자.
    pub device_id: String,
    /// 그 순간의 기기 이름(뒤에 이름을 바꿔도 줄은 그대로).
    pub device_name: String,
    /// 재확인 줄의 사람 말 이름(다른 줄은 비어 있어 싣지 않는다). 값 · 인자는 없다.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub what: String,
}

#[derive(Default)]
struct State {
    log: VecDeque<Entry>,
    live: HashMap<String, usize>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Mutex::default);

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn record(kind: Kind, device_id: &str, device_name: &str) {
    record_with(kind, device_id, device_name, "");
}

pub(crate) fn record_with(kind: Kind, device_id: &str, device_name: &str, what: &str) {
    let mut st = state();
    push(&mut st.log, Entry {
        at: super::auth::stamp(),
        kind: kind.as_str(),
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        what: what.to_string(),
    });
}

fn push(log: &mut VecDeque<Entry>, entry: Entry) {
    if log.len() >= MAX_LOG {
        log.pop_front();
    }
    log.push_back(entry);
}

pub(crate) fn snapshot() -> Vec<Entry> {
    state().log.iter().rev().cloned().collect()
}

pub(crate) fn conn_opened(device_id: &str) {
    *state().live.entry(device_id.to_string()).or_insert(0) += 1;
}

pub(crate) fn conn_closed(device_id: &str) {
    let mut st = state();
    if let Some(n) = st.live.get_mut(device_id) {
        *n = n.saturating_sub(1);
        if *n == 0 {
            st.live.remove(device_id);
        }
    }
}

pub(crate) fn live() -> HashMap<String, usize> {
    state().live.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_is_a_bounded_ring() {
        let mut log = VecDeque::new();
        for i in 0..(MAX_LOG + 5) {
            push(&mut log, Entry {
                at: String::new(),
                kind: "connected",
                device_id: i.to_string(),
                device_name: String::new(),
                what: String::new(),
            });
        }
        assert_eq!(log.len(), MAX_LOG);
        assert_eq!(log.front().unwrap().device_id, "5", "가장 오래된 줄부터 밀려난다");
    }

    #[test]
    fn kinds_are_stable_strings() {
        // 프런트(`app/remote-access.svelte.ts` 의 문구 표)가 이 글자를 본다.
        let all = [
            Kind::Paired,
            Kind::Unlocked,
            Kind::UnlockFailed,
            Kind::Locked,
            Kind::Connected,
            Kind::Disconnected,
            Kind::Revoked,
            Kind::DisconnectedAll,
            Kind::Reauthorized,
        ];
        let names: Vec<&str> = all.iter().map(|k| k.as_str()).collect();
        assert_eq!(
            names,
            [
                "paired", "unlocked", "unlockFailed", "locked", "connected", "disconnected", "revoked", "disconnectedAll",
                "reauthorized"
            ]
        );
    }

    #[test]
    fn what_is_only_on_the_wire_when_set() {
        let mut e = Entry {
            at: String::new(),
            kind: "connected",
            device_id: "d".into(),
            device_name: "n".into(),
            what: String::new(),
        };
        assert!(serde_json::to_value(&e).unwrap().get("what").is_none());
        e.what = "작업안 승인".into();
        assert_eq!(serde_json::to_value(&e).unwrap()["what"], "작업안 승인");
    }
}
