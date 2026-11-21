//! **대화 ↔ 스트림 장부** — 지난 대화가 지금 Aynx 의 어느 타일(스트림)에 열려 있나, 언제 마지막으로 놓였나
//! (docs/log/2026-10-24-convo-rename.md "열림 판정 — 세션 서버 장부").
//!
//! 세션 서버의 에이전트 상태 표([`super::AgentStates`])가 한 잠금 안에서 함께 쥔다 — 대화 id 가 서고 · 바뀌고 · 지워지는 곳이 모두
//! 그 표라서 따로 듣지 않는다. `cli` 를 모르는 옛 신호(스크립트 7판 이하)의 스트림은 적지 않는다.
//!
//! **판정 규칙**([`busy`])은 프런트 `$lib/agent-sessions` 의 `openElsewhere` 와 같은 뜻이다. 장부를 못 읽으면 기록 없음과 같다.
//!
//! 값은 id 뿐이다(제목 · 프롬프트 없음). MCP 에는 나가지 않는다 — 서버 op `agent_conversation_links`(읽기) → GUI 프록시 하나.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 프런트 `OPEN_ELSEWHERE_WINDOW_MS` 와 같은 값(이름 바꾸기 · 지우기의 문 `agent_sessions::edit::locate_idle` 도 이 값).
pub(crate) const OPEN_ELSEWHERE_WINDOW_MS: i64 = 2 * 60_000;

/// 놓인 뒤 이만큼 안의 쓰기는 놓기의 꼬리로 본다 — 닫힌 셸 · CLI 의 마지막 줄이 닫기보다 늦게 디스크에 닿는다(ConPTY 가 자식
/// 트리를 거두는 데 1~2초). 프런트 `RELEASE_GRACE_MS` 와 같다.
pub(crate) const RELEASE_GRACE_MS: i64 = 5_000;

/// 창 + 유예보다 길어야 한다 — 그 뒤의 놓인 항목은 판정에 쓰이지 않는다.
pub(crate) const KEEP_MS: u64 = 5 * 60_000;

pub(crate) const CAP: usize = 512;

/// 서버 op 의 답 모양 — GUI 가 다시 읽는다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConvoLinkRow {
    /// 지난 대화 목록의 `agent` 와 같은 이름
    pub agent: String,
    /// 소문자
    pub id: String,
    pub streams: Vec<String>,
    /// epoch ms
    pub released_at: Option<u64>,
}

#[derive(Clone, Debug, Default)]
struct Entry {
    streams: Vec<String>,
    released_at: Option<u64>,
}

#[derive(Default)]
pub(crate) struct ConvoLinks {
    map: HashMap<(&'static str, String), Entry>,
}

impl ConvoLinks {
    pub(crate) fn link(&mut self, agent: &'static str, id: &str, stream: &str) {
        let e = self.map.entry((agent, id.to_ascii_lowercase())).or_default();
        if !e.streams.iter().any(|s| s == stream) {
            e.streams.push(stream.to_owned());
        }
    }

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

    /// 스트림이 아닌 쥔 이(사이드 채팅 프로세스)가 놓았다 — 그래야 채팅을 지운 직후의 대화 지우기가 "방금 쓰임" 에 막히지 않는다.
    pub(crate) fn mark_released(&mut self, agent: &'static str, id: &str, at_ms: u64) {
        let e = self.map.entry((agent, id.to_ascii_lowercase())).or_default();
        if e.streams.is_empty() {
            e.released_at = Some(at_ms);
        }
        self.prune(at_ms);
    }

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Busy {
    Linked,
    RecentWrite,
}

pub(crate) fn busy(row: Option<&ConvoLinkRow>, mtime_ms: i64, now_ms: i64) -> Option<Busy> {
    if row.is_some_and(|r| !r.streams.is_empty()) {
        return Some(Busy::Linked);
    }
    if now_ms - mtime_ms >= OPEN_ELSEWHERE_WINDOW_MS {
        return None;
    }
    let released = row.and_then(|r| r.released_at).map(|r| i64::try_from(r).unwrap_or(i64::MAX));
    if released.is_some_and(|r| mtime_ms <= r.saturating_add(RELEASE_GRACE_MS)) {
        return None;
    }
    Some(Busy::RecentWrite)
}

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
        assert_eq!(busy(Some(&row(&[], None)), now - 30_000, now), Some(Busy::RecentWrite));
    }

    #[test]
    fn released_then_no_write_is_free() {
        let now = 1_000_000_000;
        let released = (now - 20_000) as u64;
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
        l.release("claude", ID, "zz", 110);
        assert_eq!(l.rows()[0].streams, vec!["s2".to_string()]);
        l.release("claude", ID, "s2", 120);
        assert_eq!(l.rows()[0].released_at, Some(120));
        assert!(l.rows()[0].streams.is_empty());
        l.link("claude", ID, "s3");
        assert_eq!(l.rows()[0].streams, vec!["s3".to_string()]);
        l.release("codex", ID, "s3", 130);
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn mark_released_without_a_stream() {
        let mut l = ConvoLinks::default();
        l.mark_released("claude", &ID.to_ascii_uppercase(), 100);
        assert_eq!(l.rows()[0].released_at, Some(100));
        assert!(l.rows()[0].streams.is_empty());
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
        l.link("codex", ID, "s2");
        l.prune(1_000 + KEEP_MS - 1);
        assert_eq!(l.len(), 2);
        l.prune(1_000 + KEEP_MS);
        assert_eq!(l.len(), 1);
        assert_eq!(l.rows()[0].agent, "codex");
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
