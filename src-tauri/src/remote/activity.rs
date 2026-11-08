//! **원격 접속 기록 · 지금 붙은 원격 창 수**(R1a-5 — 설계 13절 "원격 접속(기기·시각·끊김) 기록 + 상태바 '원격 접속 중' 상시").
//!
//! - 기록은 **메모리 고리 하나**(최근 [`MAX_LOG`] 줄) — 파일에 남기지 않는다(앱을 다시 켜면 비어 있다). 줄에는 시각 · 기기 id ·
//!   기기 이름 · 종류뿐이다 — **비밀은 없다**(토큰·암호·코드·IP 없음). 집 PC 상태바 칩의 카드와 설정 › 원격 접속이 그린다.
//! - 기기마다 **지금 살아 있는 원격 창(ws) 수**도 여기서 센다 — 상태바 칩은 "열림(세션) **그리고** 붙음(창 ≥ 1)" 인 기기만 센다
//!   (`ws.rs` 의 연결 자리 셈은 업그레이드 전에 잡혀 창 생성 실패까지 세므로 쓰지 않는다).
//! - 바뀔 때마다 부르는 쪽이 `gate::activity_changed` 로 주 창에 `remote-sessions` 를 보낸다(몸은 수뿐 — 프런트가 목록을 다시 읽는다).

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};

/// 기록 고리의 길이.
pub(crate) const MAX_LOG: usize = 50;

/// 기록 한 줄의 종류 — 프런트가 문구로 바꾼다(`kind` 글자 그대로).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// 집 PC 사람이 페어링을 허용했다(기기 생성).
    Paired,
    /// 원격 가림막을 걷었다(세션 열림 — 볼트도 열린다).
    Unlocked,
    /// 마스터 암호가 틀렸다 — 원격 가림막·재확인(같은 실패 셈 `gate::unlock_fail`) · 횟수만(암호는 없다).
    UnlockFailed,
    /// 원격에서 [잠그기].
    Locked,
    /// 원격 창(ws)이 붙었다.
    Connected,
    /// 원격 창(ws)이 끊겼다.
    Disconnected,
    /// 기기 폐기.
    Revoked,
    /// 집 PC(또는 원격)의 [모두 끊기] · 원격 접속 끄기 — 열린 세션을 모두 닫았다.
    DisconnectedAll,
    /// 마스터 재확인(마스터가 없으면 확인만)을 거쳐 재확인 명령을 보냈다(R4 — `bridge::admit` · `what` = 그 일의 사람 말
    /// 이름). 서버에서 통과했는지는 아니다(만료·정책 판정은 그 뒤).
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

/// 기록 한 줄 — 프런트가 받는다(`remote_log`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// RFC 3339(로컬).
    pub at: String,
    pub kind: &'static str,
    /// 기기 id(전체 끊기는 빈 글자).
    pub device_id: String,
    /// 그 순간의 기기 이름(뒤에 이름을 바꿔도 줄은 그대로).
    pub device_name: String,
    /// 무엇을 했나(R4 — 재확인 줄의 사람 말 이름 · 다른 줄은 비어 있어 싣지 않는다). 값·인자는 없다.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub what: String,
}

#[derive(Default)]
struct State {
    log: VecDeque<Entry>,
    /// 기기 id → 지금 살아 있는 원격 창 수.
    live: HashMap<String, usize>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Mutex::default);

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 한 줄을 남긴다(가장 오래된 줄부터 밀려난다).
pub(crate) fn record(kind: Kind, device_id: &str, device_name: &str) {
    record_with(kind, device_id, device_name, "");
}

/// 한 줄 + 무엇을 했나(R4 — 재확인 줄).
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

/// 최근 기록 — **새것이 앞**.
pub(crate) fn snapshot() -> Vec<Entry> {
    state().log.iter().rev().cloned().collect()
}

/// 원격 창이 붙었다.
pub(crate) fn conn_opened(device_id: &str) {
    *state().live.entry(device_id.to_string()).or_insert(0) += 1;
}

/// 원격 창이 끊겼다.
pub(crate) fn conn_closed(device_id: &str) {
    let mut st = state();
    if let Some(n) = st.live.get_mut(device_id) {
        *n = n.saturating_sub(1);
        if *n == 0 {
            st.live.remove(device_id);
        }
    }
}

/// 기기마다 지금 붙은 원격 창 수.
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
