//! 창(웹뷰)이 **다시 뜨거나 사라질 때** 그 창이 남긴 세션을 거둔다
//! (docs/log/2026-09-05-session-leak-on-reload.md).
//!
//! ## 왜 백엔드에 이런 그물이 필요한가
//!
//! 세션은 [`crate::pty::Sessions`]·[`crate::ssh::SshSessions`] 라는 **앱 전역** 표에 산다 —
//! 창과 함께 죽지 않는다 (그래야 탭을 다른 창으로 넘길 수 있다, `handoff.rs`). 정리는
//! 지금까지 전부 프런트의 몫이었다: 타일을 닫으면 `Terminal` 의 언마운트가 `close_*` 를
//! 부르고, 분리 창이 닫히면 `closeWindowSessions()` 가 한 벌을 닫는다.
//!
//! 그런데 **페이지가 통째로 다시 로드되면** 그 두 경로가 **하나도 돌지 않는다**. 웹뷰
//! 문서가 파괴될 때 Svelte 는 언마운트를 돌리지 않고, `pagehide` 에서 던진 `invoke` 는
//! 비동기 IPC 라 문서와 함께 취소될 수 있다. 그 결과 새로 뜬 페이지는 터미널을 전부 다시
//! 마운트해 `open_local_session`/`open_ssh_session` 을 **새로** 부르고, **이전 세션은 아무도
//! 닫지 않는다**. 실측: 앱 프로세스 하나 아래 pwsh 자식이 4개씩 여섯 묶음 = 24개가 쌓였다
//! (개발 서버 HMR 전체 리로드 · F5/Ctrl+R — WebView2 기본 단축키라 프로덕션에서도 난다).
//!
//! 그래서 세션마다 **소유 창 라벨**을 적어 두고, 같은 라벨의 웹뷰가 다시 뜨거나 그 창이
//! 파괴되면 그 라벨의 세션을 거둔다. 프런트 정리와 이중이어도 무해하다 — `close_*` 는
//! 표에 없는 id 를 조용히 넘긴다 (멱등).
//!
//! ## 이 파일이 지키는 두 가지 안전장치
//!
//! 1. **이관 중인 세션은 건드리지 않는다** ([`Held`]). 탭을 다른 창으로 끌면 세션은 살아 있는
//!    채 사서함([`crate::handoff::Mailbox`])에 실려 주인을 기다린다. 그 사이 소스 창이
//!    새로고침되면 넘겨 준 세션을 여기서 죽이게 된다 — 사서함에 아직 남아 있는 짐이 데리고
//!    있는 세션 id 는 정리 대상에서 뺀다.
//! 2. **새 페이지가 방금 연 세션은 건드리지 않는다** ([`doomed`] 의 `cutoff`). 정리는 비동기라
//!    새 페이지가 그 사이 세션을 열 수 있고, 그것은 **같은 라벨**이라 라벨만으로는 갈리지
//!    않는다. 세션 id 는 단조 증가하므로 "사건이 난 순간의 다음 id" 를 기준선으로 삼으면
//!    그 뒤에 태어난 세션은 자동으로 빠진다.
//!
//! 3. **사건 전에 시작해 사건 뒤에 등록되는 세션도 새지 않는다** ([`Generations`]). 느린 열기
//!    (접속 지연·셸 생성) 도중 창이 F5 되거나 닫히면, 그 열기는 거둠이 표를 본 **뒤에** 등록돼
//!    기준선으로는 잡히지 않는다(로컬 id 는 생성이 끝난 뒤 뽑히고, SSH 는 id 를 일찍 뽑아도 표에는
//!    bootstrap 뒤에 오른다). 그래서 창 라벨마다 generation 을 두고 **사건 순간**(기준선을 읽는 그
//!    자리 — [`spawn_reap`]·[`reap_window_sessions`])에 올린다. 열기는 시작할 때 자기 창의 값을 읽어
//!    두고, 표에 올릴 때 [`admit`] 으로 다시 비교한다 — 달라졌으면 올리지 않고 방금 만든 것을 그 자리에서
//!    닫는다. **비교와 표 삽입이 이 표의 잠금 하나 안**에서 일어나고 generation 을 올리는 것도 같은
//!    잠금이라, 그 사이에 사건이 끼지 못한다. 창 간 이관(`handoff.rs` `take_handoff` 의 소유 이전)은
//!    등록 **뒤**의 일이라 generation 과 무관하다. 헤드리스 위임 세션(`crate::headless`)은 창이 없어
//!    이 검사를 지나지 않는다.
//!
//! 4. **리로드는 세션을 닫지 않는다** (2026-10-08 세션 코어 ②-1 로컬 · ②-2 SSH — [`Event`]). 페이지 리로드·웹뷰
//!    크래시(`on_page_load(Started)` · 부팅 첫 줄 [`reap_window_sessions`])는 그 창에 붙어 있던 세션(로컬·SSH 대화형
//!    타일)의 임대만 푼다(`crate::session_core::commands::detach_window` — 사건 순간에 동기로). 새 페이지의 타일이 같은
//!    스트림에 다시 붙고, 아무도 데려가지 않은 것은 복원 뒤 `restore_done_sessions` 가 **닫지 않고** 떨어진 세션 목록에 남긴다(③-4). **창 파괴**
//!    (`Destroyed`)는 지금처럼 닫는다(떨어진 것까지). 책임 창 라벨은 세션 코어의 `home` 이다(옛 `owner`).
//!
//! 5. **로컬·SSH 세션은 세션 서버에 산다**(③-2 로컬 · ③-3b2 SSH). 리로드의 떨어뜨리기·창 파괴의 닫기·살아 있는 스트림
//!    목록·원격 새 워크트리 준비 멈춤은 서버 op(`detach_window`·`close_window`·`live_streams` — `crate::server::proxy`)로 보낸다. 서버의 같은 연결 위에서 차례로
//!    처리되므로 새 페이지의 붙기보다 먼저 닿는다(페이지 로드 훅은 새 페이지 스크립트보다 앞선다). generation 가드(3)는
//!    GUI 에 남는다 — 창이 사라진 열기를 거두는 것은 창을 아는 쪽의 일이다. **앱 전체 종료·트레이로 가기**(메인 창 X — `quitAll`)는
//!    세션을 닫지 않는다(`proxy::QUITTING` — 창 파괴를 리로드처럼 떼어 두기로 거두고, 서버의 세션은 산다 · ③-4).
//!
//! 맡지 않는 것: 창 사이로 세션을 **옮기는** 일은 `crate::handoff`. 이 파일은 거두기만 한다.
//! 현재 서로 부름: `crate::handoff` 와 순환하고, 거둘 때 `context`·`routing`·`operations`·`remote_worktree`
//! 를 직접 정리한다(조립 층의 일).

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Manager};

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 순수 부분 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 지금 사서함에 실려 **다른 창으로 넘어가는 중**인 세션 id.
///
/// 로컬과 SSH 를 나눠 담는 것이 요점이다 — 두 표의 id 카운터는 **따로 돈다**. 한 덩어리로
/// 두면 이관 중인 SSH 3번이 애먼 로컬 3번을 살려 준다.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Held {
    pub(crate) local: HashSet<u32>,
    pub(crate) ssh: HashSet<u32>,
    /// 이관 중인 타일의 **거울 키(streamId = `pane.historyStreamId`)** — 그 거울은 받는 창이
    /// 이어받아야 하므로 [`crate::context::reclaim_window`] 에서 제외한다(u32 카운터와 달리
    /// streamId 는 로컬·SSH 공용 안정 키라 종류를 안 나눠도 된다).
    pub(crate) streams: HashSet<String>,
    /// 이관 중인 **쿼리 타일의 DB 연결 열쇠**(`query:<tileKey>` — 프런트 `queryStreamOf`) — 세션 서버의 DB 연결 표(`db::table`,
    /// 세션 코어 밖)가 보낸 창의 리로드·파괴에서 그 연결을 떼어 두거나 닫지 않게, 받는 창이 짐을 꺼낼 때 쥔 창을 옮기게.
    pub(crate) db_streams: HashSet<String>,
}

/// 쿼리 타일의 DB 연결 열쇠 머리 — 프런트 `app/query.svelte.ts` 의 `queryStreamOf` 와 같은 글자.
pub(crate) const QUERY_STREAM_PREFIX: &str = "query:";

/// 이관 페이로드 한 장에서 세션 id 를 긁어 [`Held`] 에 담는다.
///
/// 모양은 `tear.ts` 의 `TearPayload` 다: `{ panes: [{ pane: { kind }, sessionId }] }`.
/// **모양이 아니면 조용히 넘어간다** — 이 함수의 결과는 "죽이지 않을 것" 의 목록이므로,
/// 못 읽은 짐 때문에 세션을 하나 더 살려 두는 쪽이 잘못 죽이는 쪽보다 언제나 낫다.
pub(crate) fn collect_held(payload: &str, held: &mut Held) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return;
    };
    let Some(panes) = value.get("panes").and_then(|p| p.as_array()) else {
        return;
    };
    for entry in panes {
        // 쿼리 타일 — 세션 id 가 없고(`sessionId: null`) DB 연결 열쇠는 영속 키(`tileKey`)에서 나온다.
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
        // `sessionId` 가 null 이면 붙일 세션이 없는 패널이다 (설정·호스트 타일 등).
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
        // 거울 키(streamId)도 담는다 — reap 이 거울을 되거둘 때 이관 중인 타일을 빼는 데 쓴다.
        // 종류를 안 나눈다: streamId 는 crypto 난수라 로컬·SSH 가 부딪히지 않는다.
        if let Some(sid) = pane
            .and_then(|p| p.get("historyStreamId"))
            .and_then(|s| s.as_str())
        {
            held.streams.insert(sid.to_string());
        }
    }
}

/// **정리 대상 선별** — 이 라벨의 창이 남긴 세션 id (오름차순).
///
/// 셋을 모두 만족해야 죽는다.
/// - 소유 창 라벨이 같다 (`owner == label`).
/// - `cutoff` 보다 **작다** = 사건이 난 순간 이미 존재했다 (새 페이지가 방금 연 것이 아니다).
/// - 이관 중이 아니다 (`keep` 에 없다).
///
/// 순수 함수라 창도 시계도 필요 없다 — 이 모듈에서 유일하게 조건이 얽히는 자리이고,
/// 그래서 테스트가 붙는 자리이기도 하다.
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

/// 창 라벨 → generation — 그 라벨에 거둠 사건(페이지 리로드·창 파괴)이 난 횟수.
///
/// 열기는 시작할 때 [`Generations::current`] 를 읽고, 표에 올릴 때 [`Generations::admit`] 으로
/// 다시 본다(모듈 머리말 3). 라벨 하나에 `u64` 하나라 창이 몇 번 떴다 사라져도 크기는 무시할 만하다 —
/// 지우지 않는다(지우면 같은 라벨의 새 창이 0 부터 다시 세어 옛 값과 겹칠 수 있다).
#[derive(Debug, Default)]
pub(crate) struct Generations(HashMap<String, u64>);

impl Generations {
    pub(crate) fn current(&self, label: &str) -> u64 {
        self.0.get(label).copied().unwrap_or(0)
    }

    pub(crate) fn bump(&mut self, label: &str) {
        *self.0.entry(label.to_string()).or_insert(0) += 1;
    }

    /// `seen` 이 아직 지금 값이면 `insert(value)` 를 부르고 `Ok`, 아니면 부르지 않고 `value` 를
    /// 돌려준다(부른 쪽이 닫는다). `insert` 는 **이 잠금 안**에서 돈다 — 표 삽입 한 문장만 넣는다.
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

/// 열기가 **시작할 때** 읽어 두는 자기 창의 generation.
pub(crate) fn generation(label: &str) -> u64 {
    generations().current(label)
}

/// 표에 올리는 자리 — [`Generations::admit`] 를 전역 표의 잠금 안에서. `Err(value)` 면 그 사이 창이
/// 다시 떴거나 사라졌다: 부른 쪽이 방금 만든 것을 닫고 [`window_gone_message`] 를 돌려준다.
pub(crate) fn admit<T>(label: &str, seen: u64, value: T, insert: impl FnOnce(T)) -> Result<(), T> {
    generations().admit(label, seen, value, insert)
}

/// 열던 중 창이 사라져 등록하지 않았을 때의 오류 — 받을 화면이 없으니 아무도 읽지 않는다.
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

// ---------------------------------------------------------------------------
// 실제 정리 (전역 상태를 만지는 부분)
// ---------------------------------------------------------------------------

/// 거둠의 계기 — 세션의 운명이 갈린다(모듈 머리말 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Event {
    /// 페이지 리로드·웹뷰 크래시(같은 창이 다시 뜬다) — 로컬·SSH 를 떨어뜨린다(닫지 않는다).
    Reload,
    /// 창 파괴 — 닫는다(떨어진 것까지).
    Destroyed,
}

/// 이 라벨이 남긴 세션을 전부 닫는다.
///
/// `cutoff` 두 개는 **부르는 쪽이 사건 순간에 읽어** 넘긴다 ([`doomed`] 의 설명 참고) —
/// 이 함수 안에서 읽으면 이미 늦다 (그 사이 새 페이지가 세션을 열 수 있다).
///
/// `event` 가 [`Event::Reload`] 면 세션은 이미 사건 순간에 떨어뜨렸다([`spawn_reap`]) — 여기서는 닫지 않고,
/// 그 창이 책임지는 살아 있는 스트림(로컬·SSH)의 거울도 남긴다(다시 붙은 타일이 그대로 쓴다).
pub(crate) async fn reap(app: AppHandle, label: String, reaped_before: u64, event: Event) {
    let held = app
        .state::<crate::handoff::Mailbox>()
        .held_sessions(std::time::Instant::now());

    // 로컬·SSH 모두 세션 서버가 닫는다(이관 중인 것은 빼고 · 앱 전체 종료면 닫지 않는다 — `proxy::close_window`). 원격 새
    // 워크트리의 첫 커밋 질문을 기다리던 접속도 서버가 같은 op 안에서 멈춘다(`crate::remote_worktree::cancel_for_window`).
    let (local_ids, ssh_ids) = match event {
        Event::Reload => (Vec::new(), Vec::new()),
        Event::Destroyed => {
            crate::server::proxy::close_window(
                &label,
                held.local.iter().copied().collect(),
                held.ssh.iter().copied().collect(),
                held.db_streams.iter().cloned().collect(),
            )
            .await
        }
    };

    if !local_ids.is_empty() || !ssh_ids.is_empty() {
        eprintln!(
            "세션 정리: `{label}` 창이 남긴 세션을 닫았습니다 — 로컬 {local_ids:?} · SSH {ssh_ids:?}"
        );
    }

    // 거울·라우팅·열린 작업안 되거둠 (프라이버시 · 백로그 #5) — reap 이 실제로 거두는 창의
    // 죽은 세션 거울만 지운다. **이관 중인 타일(held.streams)은 제외**하고, 사건 기준선 이후 다시
    // 보고된 거울도 제외한다([`crate::context::reclaim_streams`] — 서버가 같은 규칙으로 돈다).
    // 리로드면 이 창의 살아 있는 세션(떼어 둔 로컬·SSH) 거울도 빼 둔다 — 새 페이지의 타일이 다시 붙어 그대로 쓴다.
    let mut keep_streams = held.streams;
    if event == Event::Reload {
        keep_streams.extend(crate::server::proxy::live_streams(&label).await);
    }
    // 거울·라우팅·작업안은 세션 서버에 산다(③-3c) — 거울 큐를 지나(그 창의 마지막 거울 쓰기 뒤에 서게) 서버가 거둔다.
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

/// 지금 이 순간의 기준선을 붙잡아 [`reap`] 을 백그라운드로 던진다.
///
/// 이벤트 훅(`on_page_load`·`on_window_event`)은 **동기**라 여기서 기다릴 수 없다.
/// 기준선만 그 자리에서 읽어 두면 정리가 늦게 돌아도 새 세션을 물지 않는다.
///
/// 리로드면 세션 떨어뜨리기(로컬·SSH — 서버 op `detach_window`)가 이 태스크의 첫 일이다 — 새 페이지의 붙기보다 먼저 같은
/// 연결에 실린다(서버는 한 연결의 맵 op 를 온 순서대로 처리한다).
pub(crate) fn spawn_reap(app: &AppHandle, label: &str, event: Event) {
    // generation 도 이 순간 올린다 — `reap` 본문(비동기)에서 올리면 그 사이 등록되는 옛 열기를 놓친다.
    generations().bump(label);
    let skip = (event == Event::Reload).then(|| held_now(app));
    // 거울 되거둠의 기준선도 지금 찍는다 — 이 시각 이후 다시 보고된 거울은 살아난 것이라 뺀다.
    let reaped_before = now_ms();
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        if let Some(held) = skip {
            crate::server::proxy::detach_window(&label, held).await;
        }
        reap(app, label, reaped_before, event).await
    });
}

/// 지금 이관 중인 것(로컬·SSH id · DB 연결 열쇠) — 리로드의 떨어뜨리기가 뺄 목록.
fn held_now(app: &AppHandle) -> Held {
    app.state::<crate::handoff::Mailbox>()
        .held_sessions(std::time::Instant::now())
}

/// 지금 epoch ms — 거울 되거둠의 기준선([`crate::context::reclaim_streams`])이 쓴다.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// **새로 뜬 페이지가 직접 부르는 정리** — 부팅의 가장 첫 줄이다 (`app/boot.svelte.ts`).
///
/// `on_page_load` 그물과 하는 일이 같은데도 따로 두는 이유는 **순서를 보장할 수 있어서**다:
/// 이 명령은 프런트가 `await` 하므로, 돌아온 뒤에야 터미널이 마운트되고 새 세션이 열린다.
/// 이벤트 훅은 언제 도는지 프런트가 알 수 없어 그 보장이 없다 (그래서 `cutoff` 가 필요했다).
/// 둘 다 멱등이라 겹쳐 돌아도 무해하다.
///
/// 새로 뜬 페이지는 곧 리로드다 — 로컬·SSH 모두 떨어뜨리기만 한다(새 타일이 붙는다).
#[tauri::command]
pub async fn reap_window_sessions(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    let label = webview.window().label().to_string();
    generations().bump(&label);
    let held = held_now(&app);
    // 떨어뜨린다 — 프런트가 이 명령을 기다린 뒤에야 타일이 붙는다(순서 보장).
    crate::server::proxy::detach_window(&label, held).await;
    reap(app, label, now_ms(), Event::Reload).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

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
        // 열기가 시작할 때 읽고 → 그 사이 창이 리로드돼 올라가고 → 등록은 거부된다(값을 돌려받는다).
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
        // 다른 창의 사건은 이 창의 열기와 무관하다.
        g.bump("tear-3");
        let mut table: Vec<u32> = Vec::new();
        assert_eq!(g.admit("main", seen, 7, |v| table.push(v)), Ok(()));
        // 사건 **뒤에** 시작한 열기(새 페이지)는 새 값을 읽으므로 들어간다.
        g.bump("main");
        let fresh = g.current("main");
        assert_eq!(g.admit("main", fresh, 8, |v| table.push(v)), Ok(()));
        assert_eq!(table, vec![7, 8]);
    }

    #[test]
    fn picks_only_sessions_of_that_window() {
        // 다른 창의 세션은 절대 건드리지 않는다 — 이 그물의 첫째 계약이다.
        let o = owners(&[(1, "main"), (2, "tear-7"), (3, "main")]);
        assert_eq!(doomed(&o, "main", 99, &keep(&[])), vec![1, 3]);
        assert_eq!(doomed(&o, "tear-7", 99, &keep(&[])), vec![2]);
    }

    #[test]
    fn unknown_label_reaps_nothing() {
        // 창이 처음 뜰 때(첫 page load)가 이 경우다 — 그 라벨의 세션이 아직 없다.
        let o = owners(&[(1, "main")]);
        assert!(doomed(&o, "tear-1", 99, &keep(&[])).is_empty());
    }

    #[test]
    fn sessions_opened_after_the_event_survive() {
        // 새로고침 직후 새 페이지가 연 세션(4·5)은 **같은 라벨**이다. 기준선이 유일한 방패다.
        let o = owners(&[(1, "main"), (2, "main"), (4, "main"), (5, "main")]);
        assert_eq!(doomed(&o, "main", 3, &keep(&[])), vec![1, 2]);
    }

    #[test]
    fn handed_off_sessions_survive() {
        // 이관 중인 세션을 여기서 죽이면 받는 창에 빈 껍데기 탭이 뜬다.
        let o = owners(&[(1, "main"), (2, "main"), (3, "main")]);
        assert_eq!(doomed(&o, "main", 99, &keep(&[2])), vec![1, 3]);
    }

    #[test]
    fn result_is_sorted_and_deduped_by_map_keys() {
        // 표는 HashMap 이라 순서가 없다 — 로그와 테스트가 흔들리지 않게 정렬해 돌려준다.
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
        // 이관 중인 타일의 거울 키(streamId)를 담아, reap 이 거울을 되거둘 때 제외한다.
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
        // 두 표의 id 카운터는 따로 돈다 — 이관 중인 SSH 3번이 로컬 3번을 살리면 안 된다.
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
        // 설정·호스트·SFTP 타일은 `sessionId: null` 로 실려 온다.
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
        // 쿼리 타일은 세션 id 가 없다 — DB 연결 열쇠(`query:<tileKey>`)만 담고 세션 칸은 비운다. 영속 키가 없으면 담지 않는다.
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
        // 못 읽은 짐 때문에 세션을 하나 더 살려 두는 것이, 잘못 죽이는 것보다 낫다.
        let mut held = Held::default();
        collect_held("이건 JSON 이 아니다", &mut held);
        collect_held(r#"{"panes":"배열이 아니다"}"#, &mut held);
        collect_held("{}", &mut held);
        assert_eq!(held, Held::default());
    }

    #[test]
    fn held_accumulates_over_several_payloads() {
        // 사서함에는 짐이 여러 개 있을 수 있다 (드래그를 여러 번 취소한 경우).
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
