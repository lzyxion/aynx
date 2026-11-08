//! **원격 창은 진짜 창이 아니다**(R1a-3 — 설계 3.1 · 14.4-5). 원격 브라우저 하나(ws 연결 하나)마다 숨은 `WebviewWindow`
//! (`remote-<기기>-<세대>`)가 GUI 안에 서지만(`bridge.rs`), 그것은 Tauri IPC 에 넣을 라벨·손잡이일 뿐 사람이 보는 창이 아니다.
//!
//! - **창을 세거나 도는 곳은 모두 [`home_windows`](또는 [`is_remote_label`])를 거친다** — `lib.rs` 의 창 파괴(볼트 창 0개 잠금)·
//!   `on_page_load` · `tray`(트레이로 갈 때 부수는 창 · 창 없음 판정 둘) · `server::client` 의 작업안 알림 · `workspace_windows` ·
//!   `app_icon`. 빠뜨리면 숨은 창 때문에 "창 0개 볼트 잠금" 이 안 걸리거나(보안), 트레이로 갈 때 원격 창이 부서진다.
//!   예외 하나: `server::proxy::detached_visible` 은 **모든** 창 라벨을 본다 — 원격 창이 연 세션의 책임 창은 그 원격 창이다(일부러).
//! - **볼트 "창 0개" 셈에 원격 창을 더한다**(3.1 — 밖에서 쓰는 중이면 잠그지 않는다). 셈의 단위는 **살아 있는 원격 창(ws 연결)** 이고,
//!   유예 둘이 붙는다: 원격 가림막을 걷은 직후(페이지가 붙기 전 — [`UNLOCK_GRACE`])와 연결이 끊긴 직후(새로 고침·잠깐 끊김 —
//!   [`DISCONNECT_GRACE`], 9-④). 세션이 끝나서(잠그기·폐기·무입력·관문 끄기) 닫힌 연결에는 유예가 없다.
//!   판정은 순수 함수 [`vault_lock_due`] 하나 — 집 PC 창 0개 **그리고** 원격 없음일 때만 잠근다(이유 `windows_zero` 그대로).
//! - 세션 서버 쪽 셈(파이프 클라이언트 수)은 그대로다 — GUI 가 살아 있는 한 영향 없음.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// 원격 창 라벨의 머리.
pub(crate) const REMOTE_PREFIX: &str = "remote-";
/// 원격 가림막을 걷은 뒤 페이지가 ws 로 붙기까지 원격을 "있음" 으로 보는 시간.
pub(crate) const UNLOCK_GRACE: Duration = Duration::from_secs(60);
/// 마지막 원격 창이 끊긴 뒤(세션은 살아 있음) 원격을 "있음" 으로 보는 시간 — 새로 고침·잠깐 끊김이 볼트를 잠그지 않게(설계 9-④).
pub(crate) const DISCONNECT_GRACE: Duration = Duration::from_secs(15);

/// 원격 창(숨은 웹뷰) 라벨인가 — 창을 세는 모든 곳의 **한 판정**.
pub(crate) fn is_remote_label(label: &str) -> bool {
    label.starts_with(REMOTE_PREFIX)
}

/// 집 PC 의 창(주·보조·떼어 낸 창)만 — 원격 창을 뺀 `webview_windows()`.
pub(crate) fn home_windows<R: Runtime, M: Manager<R>>(app: &M) -> HashMap<String, WebviewWindow<R>> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| !is_remote_label(label))
        .collect()
}

/// `label` 말고 남은 집 PC 창이 있는가(창 파괴 훅 — 파괴 중인 창이 아직 목록에 있을 수 있다).
pub(crate) fn has_home_window_except<R: Runtime, M: Manager<R>>(app: &M, label: &str) -> bool {
    app.webview_windows().keys().any(|l| l != label && !is_remote_label(l))
}

/// **볼트 창 0개 잠금을 걸 때인가** — 순수. 집 PC 창이 하나도 없고 원격도 없을 때만.
pub(crate) fn vault_lock_due(home_windows: usize, remote_present: bool) -> bool {
    home_windows == 0 && !remote_present
}

/// 원격이 "있다" 의 셈 — 살아 있는 원격 창 수 + 유예 끝 시각. **순수 상태 기계**(시각은 부르는 쪽이 넣는다).
#[derive(Debug, Default)]
pub(crate) struct Presence {
    live: usize,
    grace_until: Option<Instant>,
}

impl Presence {
    pub(crate) fn present(&self, now: Instant) -> bool {
        self.live > 0 || self.grace_until.is_some_and(|g| g > now)
    }

    pub(crate) fn opened(&mut self) {
        self.live += 1;
    }

    /// 원격 창 하나가 닫혔다 — 마지막이었으면 다시 판정할 때(`Some(유예)` — 세션이 끝난 닫힘이면 0).
    pub(crate) fn closed(&mut self, now: Instant, session_ended: bool) -> Option<Duration> {
        self.live = self.live.saturating_sub(1);
        if self.live > 0 {
            return None;
        }
        if session_ended {
            return Some(Duration::ZERO);
        }
        self.extend(now + DISCONNECT_GRACE);
        Some(DISCONNECT_GRACE)
    }

    /// 원격 가림막이 걷혔다 — 페이지가 붙을 때까지 유예.
    pub(crate) fn unlocked(&mut self, now: Instant) -> Duration {
        self.extend(now + UNLOCK_GRACE);
        UNLOCK_GRACE
    }

    /// 열린 원격 세션이 하나도 없다 — 유예를 걷는다(곧바로 판정).
    pub(crate) fn sessions_gone(&mut self) {
        self.grace_until = None;
    }

    fn extend(&mut self, until: Instant) {
        self.grace_until = Some(self.grace_until.map_or(until, |g| g.max(until)));
    }
}

static PRESENCE: Mutex<Presence> = Mutex::new(Presence {
    live: 0,
    grace_until: None,
});

fn presence() -> std::sync::MutexGuard<'static, Presence> {
    PRESENCE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 지금 원격이 볼트를 열어 두는가(창 파괴 훅이 묻는다).
pub(crate) fn remote_present() -> bool {
    presence().present(Instant::now())
}

pub(crate) fn conn_opened() {
    presence().opened();
}

pub(crate) fn conn_closed(app: &AppHandle, session_ended: bool) {
    let after = presence().closed(Instant::now(), session_ended);
    if let Some(after) = after {
        schedule(app, after);
    }
}

pub(crate) fn unlocked(app: &AppHandle) {
    let after = presence().unlocked(Instant::now());
    schedule(app, after);
}

/// 열린 원격 세션 수가 바뀌었다(`gate::sessions_changed`) — 0 이면 유예를 걷고 곧바로 판정한다.
pub(crate) fn sessions_changed(app: &AppHandle, unlocked_devices: usize) {
    if unlocked_devices == 0 {
        presence().sessions_gone();
        schedule(app, Duration::ZERO);
    }
}

/// `after` 뒤에 한 번 판정 — 집 PC 창 0개 · 원격 없음이면 창 0개 잠금(`windows_zero`). 잠긴 볼트에 다시 보내도 무해하다.
fn schedule(app: &AppHandle, after: Duration) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !after.is_zero() {
            tokio::time::sleep(after + Duration::from_millis(50)).await;
        }
        if vault_lock_due(home_windows(&app).len(), remote_present()) {
            crate::server::vault_proxy::lock_windows_zero().await;
        }
    });
}
