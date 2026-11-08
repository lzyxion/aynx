//! **대화 ↔ 스트림 장부** — 지난 대화가 지금 AYNX 의 어느 타일(스트림)에 열려 있나, 언제 마지막으로 놓였나
//! (docs/log/2026-10-24-convo-rename.md "열림 판정 — 세션 서버 장부").
//!
//! 예전 판정은 파일 mtime 하나였다 — "이 창의 타일에 연결되지 않았고 2분 안에 쓰였다" 면 "밖에서 열림". 그래서 AYNX 타일을 막
//! 닫은 대화도, 다른 AYNX 창(보조 창 · 원격 웹)에 열린 대화도 2분 동안 "밖에서 열림" 으로 보였고 이름 바꾸기 · 지우기가 막혔다.
//! 이 장부는 **세션 서버**의 에이전트 상태 표([`super::AgentStates`])가 함께 쥔다 — 스트림의 대화 id(`agent_run_id`)가 서고 · 바뀌고 ·
//! 지워지는 곳이 모두 그 표라서(신호 `session` · `start` · `stop` 의 대화 id, `session-end`, [`super::forget`] = 새 세션 · 세션 닫기 ·
//! 고아 정리 · 창이 본 새 CLI/셸 복귀) 따로 듣지 않는다. 창 · GUI 와 무관하게 산다(F5 · GUI 재시작을 건너 이어진다). 신호가 없는
//! 연결(AYNX 가 재개 명령을 쓴 타일 — Codex 는 첫 질문 전에 신호가 없다)은 창이 서버 op `agent_conversation_launched` 로 알리고 같은 표가
//! 쥔다(`super::AgentStates::note_launch` — 그 수명은 `super::ForgetCause`).
//!
//! - **열쇠** = (에이전트 `cli`, 대화 id 소문자). `cli` 를 모르는 옛 신호(스크립트 7판 이하)의 스트림은 적지 않는다.
//! - **연결** = 그 대화를 지금 쥔 스트림들(창 무관). 비면 **놓인 시각** `released_at` 을 적는다.
//! - **크기** — 놓인 지 [`KEEP_MS`] 가 지난 항목은 버리고(그 뒤로는 판정에 쓰이지 않는다 — 아래 규칙), 그래도 [`CAP`] 를 넘으면 오래 놓인
//!   것부터 버린다. 연결된 항목은 산 스트림 수만큼이라 따로 세지 않는다.
//!
//! **판정 규칙**([`busy`] — 프런트 `$lib/agent-sessions` 의 `openElsewhere` 와 같은 뜻): 산 스트림에 연결돼 있으면 **AYNX 에 열림**.
//! 아니면 파일이 [`OPEN_ELSEWHERE_WINDOW_MS`] 안에 쓰였고 **놓인 뒤 [`RELEASE_GRACE_MS`] 보다 늦게** 쓰였을 때만 **밖에서 열림**
//! (놓인 기록이 없으면 예전 규칙 그대로). 장부를 못 읽으면(서버에 닿지 못함 · 옛 서버) 기록 없음과 같다 — 예전 규칙으로 물러선다.
//!
//! 값은 id 뿐이다(제목 · 프롬프트 없음). MCP 에는 나가지 않는다 — 서버 op `agent_conversation_links`(읽기) → GUI 프록시 하나.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// "방금 쓰인 대화" 의 창 — 프런트 `OPEN_ELSEWHERE_WINDOW_MS` 와 같은 2분(이름 바꾸기 · 지우기의 문 `agent_sessions::edit::locate_idle` 도 이 값).
pub(crate) const OPEN_ELSEWHERE_WINDOW_MS: i64 = 2 * 60_000;

/// 놓인 뒤 이만큼 안의 쓰기는 **놓기의 꼬리**로 본다 — 타일을 닫으면 셸 · CLI 가 끝나며 마지막 줄(턴 끝 · `SessionEnd` 훅이
/// 부른 정리)을 덧붙일 수 있고, 그 쓰기는 닫기보다 조금 늦게 디스크에 닿는다(ConPTY 가 자식 트리를 거두는 데 1~2초). 5초면 그
/// 꼬리를 덮고, 밖의 터미널이 놓인 대화를 곧바로 다시 여는 드문 경우는 그다음 쓰기(턴마다 한 줄)가 곧 "밖에서 열림" 으로 드러낸다.
/// 프런트 `RELEASE_GRACE_MS` 와 같다.
pub(crate) const RELEASE_GRACE_MS: i64 = 5_000;

/// 놓인 항목을 들고 있는 시간 — 놓인 지 창 + 유예가 지나면 판정에 쓰이지 않는다(그 뒤의 쓰기는 어차피 유예 밖이다). 여유를 둬 5분.
pub(crate) const KEEP_MS: u64 = 5 * 60_000;

/// 놓인 항목 상한 — 넘으면 오래 놓인 것부터 버린다.
pub(crate) const CAP: usize = 512;

/// 장부 한 줄 — 서버 op 의 답 모양(camelCase). GUI 가 다시 읽는다(`Deserialize`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConvoLinkRow {
    /// 에이전트(`claude` · `codex` — 지난 대화 목록의 `agent` 와 같은 이름)
    pub agent: String,
    /// 대화 id(소문자)
    pub id: String,
    /// 지금 그 대화를 쥔 스트림(창 무관) — 비면 놓였다
    pub streams: Vec<String>,
    /// 마지막으로 놓인 시각(epoch ms) — 한 번도 놓이지 않았으면 `None`
    pub released_at: Option<u64>,
}

#[derive(Clone, Debug, Default)]
struct Entry {
    streams: Vec<String>,
    released_at: Option<u64>,
}

/// 장부 — 에이전트 상태 표가 한 잠금 안에서 함께 고친다.
#[derive(Default)]
pub(crate) struct ConvoLinks {
    map: HashMap<(&'static str, String), Entry>,
}

impl ConvoLinks {
    /// 그 스트림이 그 대화를 쥐었다(이미 쥐었으면 그대로).
    pub(crate) fn link(&mut self, agent: &'static str, id: &str, stream: &str) {
        let e = self.map.entry((agent, id.to_ascii_lowercase())).or_default();
        if !e.streams.iter().any(|s| s == stream) {
            e.streams.push(stream.to_owned());
        }
    }

    /// 그 스트림이 그 대화를 놓았다 — 쥔 스트림이 없어지면 놓인 시각을 적는다. 모르는 대화 · 쥐지 않던 스트림이면 아무 일도 없다.
    pub(crate) fn release(&mut self, agent: &'static str, id: &str, stream: &str, at_ms: u64) {
        if let Some(e) = self.map.get_mut(&(agent, id.to_ascii_lowercase())) {
            let before = e.streams.len();
            e.streams.retain(|s| s != stream);
            if e.streams.is_empty() && before > 0 {
                e.released_at = Some(at_ms);
            }
        }
        self.prune(at_ms);
    }

    /// 스트림이 아닌 쥔 이(**사이드 채팅 프로세스** — `crate::server::side_chat` 의 프로세스 끝)가 그 대화를 놓았다. 쥔 스트림이 없을
    /// 때만 놓인 시각을 적는다(타일이 같은 대화를 쥐고 있으면 그대로) — 그래야 채팅을 지운 직후의 대화 지우기가 "방금 쓰임" 에 막히지 않는다.
    pub(crate) fn mark_released(&mut self, agent: &'static str, id: &str, at_ms: u64) {
        let e = self.map.entry((agent, id.to_ascii_lowercase())).or_default();
        if e.streams.is_empty() {
            e.released_at = Some(at_ms);
        }
        self.prune(at_ms);
    }

    /// 오래 놓인 항목을 버린다(모듈 머리말 "크기").
    pub(crate) fn prune(&mut self, now_ms: u64) {
        self.map.retain(|_, e| {
            !e.streams.is_empty() || e.released_at.is_some_and(|r| now_ms.saturating_sub(r) < KEEP_MS)
        });
        if self.map.len() <= CAP {
            return;
        }
        let mut released: Vec<_> = self
            .map
            .iter()
            .filter(|(_, e)| e.streams.is_empty())
            .map(|(k, e)| (e.released_at.unwrap_or(0), k.clone()))
            .collect();
        released.sort();
        let over = self.map.len() - CAP;
        for (_, k) in released.into_iter().take(over) {
            self.map.remove(&k);
        }
    }

    /// 지금 장부 전체(순서는 정하지 않는다).
    pub(crate) fn rows(&self) -> Vec<ConvoLinkRow> {
        self.map
            .iter()
            .map(|((agent, id), e)| ConvoLinkRow {
                agent: (*agent).to_owned(),
                id: id.clone(),
                streams: e.streams.clone(),
                released_at: e.released_at,
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.map.len()
    }
}

/// 고치기(이름 바꾸기 · 지우기)를 막는 까닭 — [`busy`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Busy {
    /// AYNX 의 산 스트림에 연결돼 있다(어느 창이든)
    Linked,
    /// 연결되지 않았는데 방금(놓인 뒤 유예보다 늦게) 쓰였다 — 밖에서 열려 있을 수 있다
    RecentWrite,
}

/// **판정 규칙**(모듈 머리말) — 그 대화의 장부 줄(없으면 `None` — 기록 없음 · 장부를 못 읽음), 파일 mtime, 지금.
pub(crate) fn busy(row: Option<&ConvoLinkRow>, mtime_ms: i64, now_ms: i64) -> Option<Busy> {
    if row.is_some_and(|r| !r.streams.is_empty()) {
        return Some(Busy::Linked);
    }
    if now_ms - mtime_ms >= OPEN_ELSEWHERE_WINDOW_MS {
        return None;
    }
    let released = row.and_then(|r| r.released_at).map(|r| i64::try_from(r).unwrap_or(i64::MAX));
    if released.is_some_and(|r| mtime_ms <= r.saturating_add(RELEASE_GRACE_MS)) {
        return None; // 놓기 전 · 놓기의 꼬리에 쓰인 것 — 지금 쓰는 이가 없다
    }
    Some(Busy::RecentWrite)
}

/// 장부에서 그 대화의 줄 — 에이전트 · id(대소문자 무관).
pub(crate) fn row_of<'a>(rows: &'a [ConvoLinkRow], agent: &str, id: &str) -> Option<&'a ConvoLinkRow> {
    rows.iter().find(|r| r.agent == agent && r.id.eq_ignore_ascii_case(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123abcd-0000-4000-8000-000000000001";

    fn row(streams: &[&str], released_at: Option<u64>) -> ConvoLinkRow {
        ConvoLinkRow {
            agent: "claude".into(),
            id: ID.into(),
            streams: streams.iter().map(|s| (*s).to_owned()).collect(),
            released_at,
        }
    }

    #[test]
    fn linked_is_busy_whatever_the_mtime() {
        let now = 1_000_000_000;
        assert_eq!(busy(Some(&row(&["s1"], None)), now - 10 * 60_000, now), Some(Busy::Linked));
        assert_eq!(busy(Some(&row(&["s1"], Some(5))), now, now), Some(Busy::Linked));
    }

    #[test]
    fn no_record_keeps_the_old_mtime_rule() {
        let now = 1_000_000_000;
        assert_eq!(busy(None, now - 30_000, now), Some(Busy::RecentWrite));
        assert_eq!(busy(None, now - OPEN_ELSEWHERE_WINDOW_MS, now), None);
        // 놓인 적 없는 줄(연결도 없음)도 기록 없음과 같다
        assert_eq!(busy(Some(&row(&[], None)), now - 30_000, now), Some(Busy::RecentWrite));
    }

    #[test]
    fn released_then_no_write_is_free() {
        let now = 1_000_000_000;
        let released = (now - 20_000) as u64;
        // 닫기 전에 쓰였다(mtime < 놓인 시각) — 2분 안이라도 열림이 아니다
        assert_eq!(busy(Some(&row(&[], Some(released))), now - 25_000, now), None);
    }

    #[test]
    fn released_then_a_later_write_is_elsewhere() {
        let now = 1_000_000_000;
        let released = (now - 60_000) as u64;
        assert_eq!(busy(Some(&row(&[], Some(released))), now - 10_000, now), Some(Busy::RecentWrite));
    }

    #[test]
    fn grace_edge() {
        let now = 1_000_000_000;
        let r = now - 60_000;
        let rec = row(&[], Some(r as u64));
        assert_eq!(busy(Some(&rec), r + RELEASE_GRACE_MS, now), None, "유예 끝까지는 놓기의 꼬리");
        assert_eq!(busy(Some(&rec), r + RELEASE_GRACE_MS + 1, now), Some(Busy::RecentWrite));
    }

    #[test]
    fn link_release_relink() {
        let mut l = ConvoLinks::default();
        l.link("claude", &ID.to_ascii_uppercase(), "s1");
        l.link("claude", ID, "s1");
        l.link("claude", ID, "s2");
        let r = l.rows();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].id, ID);
        assert_eq!(r[0].streams, vec!["s1".to_string(), "s2".to_string()]);
        l.release("claude", ID, "s1", 100);
        assert_eq!(l.rows()[0].released_at, None, "다른 스트림이 아직 쥐었다");
        l.release("claude", ID, "zz", 110); // 쥐지 않던 스트림 — 그대로
        assert_eq!(l.rows()[0].streams, vec!["s2".to_string()]);
        l.release("claude", ID, "s2", 120);
        assert_eq!(l.rows()[0].released_at, Some(120));
        assert!(l.rows()[0].streams.is_empty());
        l.link("claude", ID, "s3");
        assert_eq!(l.rows()[0].streams, vec!["s3".to_string()]);
        // 모르는 대화 놓기는 항목을 만들지 않는다
        l.release("codex", ID, "s3", 130);
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn mark_released_without_a_stream() {
        let mut l = ConvoLinks::default();
        // 모르는 대화도 놓인 시각을 적는다(사이드 채팅은 스트림으로 쥐지 않는다)
        l.mark_released("claude", &ID.to_ascii_uppercase(), 100);
        assert_eq!(l.rows()[0].released_at, Some(100));
        assert!(l.rows()[0].streams.is_empty());
        // 타일이 쥐고 있으면 그대로 — 열림이 이긴다
        l.link("claude", ID, "s1");
        l.mark_released("claude", ID, 200);
        assert_eq!(l.rows()[0].released_at, Some(100));
        assert_eq!(l.rows()[0].streams, vec!["s1".to_string()]);
    }

    #[test]
    fn prune_drops_old_releases_and_caps() {
        let mut l = ConvoLinks::default();
        l.link("claude", ID, "s1");
        l.release("claude", ID, "s1", 1_000);
        l.link("codex", ID, "s2"); // 연결된 항목은 버리지 않는다
        l.prune(1_000 + KEEP_MS - 1);
        assert_eq!(l.len(), 2);
        l.prune(1_000 + KEEP_MS);
        assert_eq!(l.len(), 1);
        assert_eq!(l.rows()[0].agent, "codex");
        // 상한 — 오래 놓인 것부터
        let mut l = ConvoLinks::default();
        for i in 0..(CAP + 3) {
            let id = format!("{i:08x}-0000-4000-8000-000000000000");
            l.link("claude", &id, "s");
            l.release("claude", &id, "s", 10_000 + i as u64);
        }
        assert_eq!(l.len(), CAP);
        let rows = l.rows();
        assert!(!rows.iter().any(|r| r.released_at == Some(10_000)), "가장 오래 놓인 것이 먼저 빠진다");
        assert!(rows.iter().any(|r| r.released_at == Some(10_000 + (CAP + 2) as u64)));
    }

    #[test]
    fn row_of_ignores_case() {
        let rows = vec![row(&["s1"], None)];
        assert!(row_of(&rows, "claude", &ID.to_ascii_uppercase()).is_some());
        assert!(row_of(&rows, "codex", ID).is_none());
    }
}
