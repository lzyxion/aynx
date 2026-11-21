//! 창(웹뷰)이 다시 뜨거나 사라질 때 그 창이 남긴 세션을 거둔다 — 페이지 리로드에서는 프런트의 정리가 돌지 않는다
//! (docs/log/2026-09-05-session-leak-on-reload.md).
//!
//! 1. 이관 중인 세션은 건드리지 않는다([`Held`]).
//! 2. 새 페이지가 방금 연 세션은 건드리지 않는다([`doomed`] 의 `cutoff` — 사건 순간의 다음 id 가 기준선).
//! 3. 사건 전에 시작해 사건 뒤에 등록되는 열기도 새지 않는다([`Generations`]) — generation 은 사건 순간에 올리고, 비교와 표 삽입은
//!    같은 잠금 안이다. 헤드리스 위임 세션은 창이 없어 이 검사를 지나지 않는다.
//! 4. 리로드 · 웹뷰 크래시는 세션을 닫지 않고 그 창의 임대만 푼다([`Event`]) — 창 파괴만 닫는다. 앱 전체 종료 · 트레이로 가기는 닫지 않고
//!    쿼리 타일의 DB 연결은 떨어진 세션으로 남긴다.
//! 5. 창 op 는 서버의 같은 연결 위에서 차례로 처리돼 새 페이지의 붙기보다 먼저 닿는다. generation 가드는 GUI 에 남는다.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Manager};

use crate::i18n::tr;

// ── 순수 부분 ──

/// 지금 사서함에 실려 다른 창으로 넘어가는 중인 세션 id. 로컬과 SSH 를 나눠 담는다 — 두 표의 id 카운터는 따로 돈다.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Held {
    pub(crate) local: HashSet<u32>,
    pub(crate) ssh: HashSet<u32>,
    /// 이관 중인 타일의 거울 키(streamId) — 받는 창이 이어받아야 해 거울 되거둠에서 뺀다.
    pub(crate) streams: HashSet<String>,
    /// 이관 중인 쿼리 타일의 DB 연결 열쇠(`query:<tileKey>`) — 보낸 창의 리로드 · 파괴에서 떼어 두거나 닫지 않게.
    pub(crate) db_streams: HashSet<String>,
}

/// 쿼리 타일의 DB 연결 열쇠 머리 — 프런트 `app/query.svelte.ts` 의 `queryStreamOf` 와 같은 글자.
pub(crate) const QUERY_STREAM_PREFIX: &str = "query:";

/// 이관 페이로드(`tear.ts` 의 `TearPayload`)에서 세션 id 를 긁는다. 모양이 아니면 조용히 넘어간다 — 결과가 "죽이지 않을 것" 의 목록이라
/// 하나 더 살리는 쪽이 잘못 죽이는 쪽보다 낫다.
pub(crate) fn collect_held(payload: &str, held: &mut Held) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return;
    };
    let Some(panes) = value.get("panes").and_then(|p| p.as_array()) else {
        return;
    };
    for entry in panes {
        let pane_kind = entry.get("pane").and_then(|p| p.get("kind")).and_then(|k| k.as_str());
        if pane_kind == Some("query") {
            if let Some(key) = entry
                .get("pane")
                .and_then(|p| p.get("tileKey"))
                .and_then(|k| k.as_str())
                .filter(|k| !k.is_empty())
            {
                held.db_streams.insert(format!("{QUERY_STREAM_PREFIX}{key}"));
            }
            continue;
        }
        let Some(id) = entry.get("sessionId").and_then(|n| n.as_u64()) else {
            continue;
        };
        if id > u32::MAX as u64 {
            continue;
        }
        let pane = entry.get("pane");
        let kind = pane
            .and_then(|p| p.get("kind"))
            .and_then(|k| k.as_str())
            .unwrap_or("");
        match kind {
            "local" => held.local.insert(id as u32),
            "ssh" => held.ssh.insert(id as u32),
            _ => false,
        };
        // 종류를 안 나눈다 — streamId 는 crypto 난수라 로컬 · SSH 가 부딪히지 않는다.
        if let Some(sid) = pane
            .and_then(|p| p.get("historyStreamId"))
            .and_then(|s| s.as_str())
        {
            held.streams.insert(sid.to_string());
        }
    }
}

/// 정리 대상 — 소유 창 라벨이 같고 · `cutoff` 보다 작고(사건 순간 이미 있었다) · 이관 중이 아닌 세션 id(오름차순).
pub(crate) fn doomed(
    owners: &[(u32, String)],
    label: &str,
    cutoff: u32,
    keep: &HashSet<u32>,
) -> Vec<u32> {
    let mut ids: Vec<u32> = owners
        .iter()
        .filter(|(id, owner)| owner == label && *id < cutoff && !keep.contains(id))
        .map(|(id, _)| *id)
        .collect();
    ids.sort_unstable();
    ids
}

/// 창 라벨 → 그 라벨에 거둠 사건이 난 횟수. 지우지 않는다 — 지우면 같은 라벨의 새 창이 0 부터 다시 세어 옛 값과 겹칠 수 있다.
#[derive(Debug, Default)]
pub(crate) struct Generations(HashMap<String, u64>);

impl Generations {
    pub(crate) fn current(&self, label: &str) -> u64 {
        self.0.get(label).copied().unwrap_or(0)
    }

    pub(crate) fn bump(&mut self, label: &str) {
        *self.0.entry(label.to_string()).or_insert(0) += 1;
    }

    /// `seen` 이 지금 값일 때만 `insert` 를 부른다(아니면 `value` 를 돌려줘 부른 쪽이 닫는다). `insert` 는 이 잠금 안에서 돈다 — 표 삽입 한 문장만 넣는다.
    pub(crate) fn admit<T>(
        &self,
        label: &str,
        seen: u64,
        value: T,
        insert: impl FnOnce(T),
    ) -> Result<(), T> {
        if self.current(label) != seen {
            return Err(value);
        }
        insert(value);
        Ok(())
    }
}

static GENERATIONS: LazyLock<Mutex<Generations>> = LazyLock::new(Default::default);

fn generations() -> std::sync::MutexGuard<'static, Generations> {
    GENERATIONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 열기가 시작할 때 읽어 두는 자기 창의 generation.
pub(crate) fn generation(label: &str) -> u64 {
    generations().current(label)
}

/// `Err(value)` 면 그 사이 창이 다시 떴거나 사라졌다 — 부른 쪽이 방금 만든 것을 닫고 [`window_gone_message`] 를 돌려준다.
pub(crate) fn admit<T>(label: &str, seen: u64, value: T, insert: impl FnOnce(T)) -> Result<(), T> {
    generations().admit(label, seen, value, insert)
}

/// 이유 코드 `[cancelled]` 라 접속 이력에도 적히지 않는다(`host_history::outcome_of`).
pub(crate) fn window_gone_message() -> String {
    crate::errors::with_reason(
        crate::errors::CANCELLED,
        tr!(
            ko: "여는 사이 창이 다시 떴거나 닫혀 세션을 거뒀습니다",
            en: "The window reloaded or closed while opening — the session was discarded"
        ),
    )
}

// ── 실제 정리 ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Event {
    /// 페이지 리로드 · 웹뷰 크래시 — 떨어뜨린다(닫지 않는다).
    Reload,
    /// 앱 전체 종료 · 트레이로 가는 중의 창 파괴 — 리로드처럼 떨어뜨리되 쿼리 타일의 DB 연결은 떨어진 세션으로 남긴다(TTL 없음).
    Leaving,
    Destroyed,
}

/// 창 파괴의 계기 — 사건 순간에 읽은 `QUITTING` 으로 가른다.
pub(crate) fn destroyed_event(quitting: bool) -> Event {
    if quitting {
        Event::Leaving
    } else {
        Event::Destroyed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowOp {
    /// `detach_window`: 로컬 · SSH 임대를 풀고 DB 연결은 리로드로 떼어 둔다(TTL).
    Detach,
    /// `detach_window` 의 `dbOnly`: 그 창의 DB 연결을 떨어진 세션으로 남긴다(앞의 떼어 둠을 올린다).
    KeepDbs,
    /// `close_window`: 이관 중인 것은 빼고 닫는다.
    Close,
}

/// 계기마다 보내는 창 op 와 그 차례 — 시험이 이 차례를 서버에 재생한다.
pub(crate) fn window_ops(event: Event) -> &'static [WindowOp] {
    match event {
        Event::Reload => &[WindowOp::Detach],
        Event::Leaving => &[WindowOp::Detach, WindowOp::KeepDbs],
        Event::Destroyed => &[WindowOp::Close],
    }
}

/// `reaped_before` 는 부르는 쪽이 사건 순간에 읽어 넘긴다 — 여기서 읽으면 그 사이 새 페이지가 연 것을 문다.
pub(crate) async fn reap(app: AppHandle, label: String, reaped_before: u64, event: Event) {
    let held = app
        .state::<crate::handoff::Mailbox>()
        .held_sessions(std::time::Instant::now());

    // 원격 새 워크트리의 첫 커밋 질문을 기다리던 접속도 서버가 같은 op 안에서 멈춘다.
    let (local_ids, ssh_ids) = if window_ops(event).contains(&WindowOp::Close) {
        crate::server::proxy::close_window(
            &label,
            held.local.iter().copied().collect(),
            held.ssh.iter().copied().collect(),
            held.db_streams.iter().cloned().collect(),
        )
        .await
    } else {
        (Vec::new(), Vec::new())
    };

    if !local_ids.is_empty() || !ssh_ids.is_empty() {
        eprintln!(
            "세션 정리: `{label}` 창이 남긴 세션을 닫았습니다 — 로컬 {local_ids:?} · SSH {ssh_ids:?}"
        );
    }

    // 이관 중인 타일 · 사건 기준선 뒤 다시 보고된 거울은 빼고 되거둔다. 리로드면 이 창의 살아 있는 세션 거울도 뺀다 — 새 타일이 다시 붙어 쓴다.
    let mut keep_streams = held.streams;
    if event != Event::Destroyed {
        keep_streams.extend(crate::server::proxy::live_streams(&label).await);
    }
    // 거울 큐를 지나 그 창의 마지막 거울 쓰기 뒤에 선다.
    let reclaimed = crate::server::ai_proxy::reclaim_window(
        &label,
        reaped_before,
        keep_streams.into_iter().collect(),
    )
    .await;
    if !reclaimed.is_empty() {
        eprintln!("세션 정리: `{label}` 창의 공유 거울을 되거뒀습니다 — {reclaimed:?}");
    }
}

/// 기준선을 이 순간 붙잡아 [`reap`] 을 백그라운드로 던진다 — 이벤트 훅은 동기라 기다릴 수 없다. 리로드의 떨어뜨리기가 이 태스크의 첫 일이라
/// 새 페이지의 붙기보다 먼저 같은 연결에 실린다.
pub(crate) fn spawn_reap(app: &AppHandle, label: &str, event: Event) {
    // generation 도 이 순간 올린다 — `reap` 본문(비동기)에서 올리면 그 사이 등록되는 옛 열기를 놓친다.
    generations().bump(label);
    let ops = window_ops(event);
    let skip = ops.contains(&WindowOp::Detach).then(|| held_now(app));
    let reaped_before = now_ms();
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        if let Some(held) = skip {
            let held_db: Vec<String> = held.db_streams.iter().cloned().collect();
            crate::server::proxy::detach_window(&label, held).await;
            if ops.contains(&WindowOp::KeepDbs) {
                crate::server::proxy::keep_window_dbs(&label, held_db).await;
            }
        }
        reap(app, label, reaped_before, event).await
    });
}

fn held_now(app: &AppHandle) -> Held {
    app.state::<crate::handoff::Mailbox>()
        .held_sessions(std::time::Instant::now())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 새로 뜬 페이지가 부팅 첫 줄에 부르는 정리 — 프런트가 `await` 한 뒤에야 타일이 붙으므로 `on_page_load` 그물과 달리 순서가 보장된다.
/// 둘 다 멱등이다.
#[tauri::command]
pub async fn reap_window_sessions(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    let label = webview.window().label().to_string();
    generations().bump(&label);
    let held = held_now(&app);
    crate::server::proxy::detach_window(&label, held).await;
    reap(app, label, now_ms(), Event::Reload).await;
    Ok(())
}

// ── 테스트 ──

#[cfg(test)]
mod tests {
    use super::*;

    fn owners(pairs: &[(u32, &str)]) -> Vec<(u32, String)> {
        pairs.iter().map(|(id, w)| (*id, w.to_string())).collect()
    }

    fn keep(ids: &[u32]) -> HashSet<u32> {
        ids.iter().copied().collect()
    }

    #[test]
    fn generation_bump_rejects_an_open_that_started_before_it() {
        let mut g = Generations::default();
        let seen = g.current("main");
        g.bump("main");
        let mut table: Vec<u32> = Vec::new();
        assert_eq!(g.admit("main", seen, 7, |v| table.push(v)), Err(7));
        assert!(table.is_empty());
    }

    #[test]
    fn generation_unchanged_admits_and_other_windows_do_not_interfere() {
        let mut g = Generations::default();
        let seen = g.current("main");
        g.bump("tear-3");
        let mut table: Vec<u32> = Vec::new();
        assert_eq!(g.admit("main", seen, 7, |v| table.push(v)), Ok(()));
        g.bump("main");
        let fresh = g.current("main");
        assert_eq!(g.admit("main", fresh, 8, |v| table.push(v)), Ok(()));
        assert_eq!(table, vec![7, 8]);
    }

    #[test]
    fn picks_only_sessions_of_that_window() {
        let o = owners(&[(1, "main"), (2, "tear-7"), (3, "main")]);
        assert_eq!(doomed(&o, "main", 99, &keep(&[])), vec![1, 3]);
        assert_eq!(doomed(&o, "tear-7", 99, &keep(&[])), vec![2]);
    }

    #[test]
    fn unknown_label_reaps_nothing() {
        let o = owners(&[(1, "main")]);
        assert!(doomed(&o, "tear-1", 99, &keep(&[])).is_empty());
    }

    #[test]
    fn sessions_opened_after_the_event_survive() {
        let o = owners(&[(1, "main"), (2, "main"), (4, "main"), (5, "main")]);
        assert_eq!(doomed(&o, "main", 3, &keep(&[])), vec![1, 2]);
    }

    #[test]
    fn handed_off_sessions_survive() {
        let o = owners(&[(1, "main"), (2, "main"), (3, "main")]);
        assert_eq!(doomed(&o, "main", 99, &keep(&[2])), vec![1, 3]);
    }

    #[test]
    fn result_is_sorted_and_deduped_by_map_keys() {
        let o = owners(&[(9, "main"), (2, "main"), (5, "main")]);
        assert_eq!(doomed(&o, "main", 99, &keep(&[])), vec![2, 5, 9]);
    }

    #[test]
    fn held_reads_both_kinds_from_a_payload() {
        let mut held = Held::default();
        collect_held(
            r#"{"tab":{"id":"tab-1"},"panes":[
                 {"pane":{"id":"pane-1","kind":"local"},"sessionId":3,"buffer":""},
                 {"pane":{"id":"pane-2","kind":"ssh"},"sessionId":7,"buffer":""}
               ]}"#,
            &mut held,
        );
        assert_eq!(held.local, keep(&[3]));
        assert_eq!(held.ssh, keep(&[7]));
    }

    #[test]
    fn held_captures_stream_ids_for_mirror_reclaim_exclusion() {
        let mut held = Held::default();
        collect_held(
            r#"{"panes":[
                 {"pane":{"kind":"ssh","historyStreamId":"stream-xyz"},"sessionId":7},
                 {"pane":{"kind":"local","historyStreamId":"stream-abc"},"sessionId":3}
               ]}"#,
            &mut held,
        );
        assert!(held.streams.contains("stream-xyz"));
        assert!(held.streams.contains("stream-abc"));
        assert_eq!(held.ssh, keep(&[7]));
        assert_eq!(held.local, keep(&[3]));
    }

    #[test]
    fn held_keeps_the_two_kinds_apart() {
        let mut held = Held::default();
        collect_held(
            r#"{"panes":[{"pane":{"kind":"ssh"},"sessionId":3}]}"#,
            &mut held,
        );
        assert!(held.local.is_empty());
        assert_eq!(held.ssh, keep(&[3]));

        let o = owners(&[(3, "main")]);
        assert_eq!(doomed(&o, "main", 99, &held.local), vec![3]);
        assert!(doomed(&o, "main", 99, &held.ssh).is_empty());
    }

    #[test]
    fn held_ignores_panes_without_a_session() {
        let mut held = Held::default();
        collect_held(
            r#"{"panes":[
                 {"pane":{"kind":"settings"},"sessionId":null},
                 {"pane":{"kind":"sftp"},"sessionId":null}
               ]}"#,
            &mut held,
        );
        assert_eq!(held, Held::default());
    }

    #[test]
    fn held_reads_query_tiles_as_db_stream_keys() {
        let mut held = Held::default();
        collect_held(
            r#"{"panes":[
                 {"pane":{"kind":"query","tileKey":"tk-1","query":{"host":null,"connId":"x"}},"sessionId":null},
                 {"pane":{"kind":"query"},"sessionId":null},
                 {"pane":{"kind":"local","tileKey":"tk-2"},"sessionId":4}
               ]}"#,
            &mut held,
        );
        assert_eq!(held.db_streams, ["query:tk-1".to_string()].into_iter().collect());
        assert_eq!(held.local, keep(&[4]));
        assert!(held.ssh.is_empty());
    }

    #[test]
    fn held_survives_garbage_payloads() {
        let mut held = Held::default();
        collect_held("이건 JSON 이 아니다", &mut held);
        collect_held(r#"{"panes":"배열이 아니다"}"#, &mut held);
        collect_held("{}", &mut held);
        assert_eq!(held, Held::default());
    }

    #[test]
    fn held_accumulates_over_several_payloads() {
        let mut held = Held::default();
        collect_held(
            r#"{"panes":[{"pane":{"kind":"local"},"sessionId":1}]}"#,
            &mut held,
        );
        collect_held(
            r#"{"panes":[{"pane":{"kind":"local"},"sessionId":2}]}"#,
            &mut held,
        );
        assert_eq!(held.local, keep(&[1, 2]));
    }
}
