//! **원격 창은 진짜 창이 아니다** — 원격 브라우저(ws 연결) 하나마다 숨은 `WebviewWindow` 가 서지만 Tauri IPC 에 넣을 라벨일 뿐이다.
//!
//! - **창을 세거나 도는 곳은 모두 [`home_windows`](또는 [`is_remote_label`])를 거친다** — 빠뜨리면 숨은 창 때문에 "창 0개 볼트 잠금" 이
//!   안 걸리거나(보안), 트레이로 갈 때 원격 창이 부서진다. 예외 하나: `server::proxy::detached_visible` 은 **모든** 창 라벨을 본다
//!   (원격 창이 연 세션의 책임 창은 그 원격 창이다 — 일부러).
//! - **볼트 "창 0개" 셈에 살아 있는 원격 창을 더한다** — 메인 PC 창 0개 **그리고** 원격 없음일 때만 잠근다. 유예 둘(가림막을 걷은 직후 ·
//!   연결이 끊긴 직후)이 붙고, 세션이 끝나서(잠그기·폐기·무입력·관문 끄기) 닫힌 연결에는 유예가 없다.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

pub(crate) const REMOTE_PREFIX: &str = "remote-";
/// 페이지가 ws 로 붙기 전에 볼트가 잠기지 않게.
pub(crate) const UNLOCK_GRACE: Duration = Duration::from_secs(60);
/// 새로 고침·잠깐 끊김이 볼트를 잠그지 않게.
pub(crate) const DISCONNECT_GRACE: Duration = Duration::from_secs(15);

pub(crate) fn is_remote_label(label: &str) -> bool {
    label.starts_with(REMOTE_PREFIX)
}

pub(crate) fn home_windows<R: Runtime, M: Manager<R>>(app: &M) -> HashMap<String, WebviewWindow<R>> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| !is_remote_label(label))
        .collect()
}

/// 창 파괴 훅에서 — 파괴 중인 창이 아직 목록에 있을 수 있다.
pub(crate) fn has_home_window_except<R: Runtime, M: Manager<R>>(app: &M, label: &str) -> bool {
    app.webview_windows().keys().any(|l| l != label && !is_remote_label(l))
}

pub(crate) fn vault_lock_due(home_windows: usize, remote_present: bool) -> bool {
    home_windows == 0 && !remote_present
}

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

    /// 마지막 창이었으면 다시 판정할 때까지의 유예(세션이 끝난 닫힘이면 0).
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

    pub(crate) fn unlocked(&mut self, now: Instant) -> Duration {
        self.extend(now + UNLOCK_GRACE);
        UNLOCK_GRACE
    }

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

pub(crate) fn sessions_changed(app: &AppHandle, unlocked_devices: usize) {
    if unlocked_devices == 0 {
        presence().sessions_gone();
        schedule(app, Duration::ZERO);
    }
}

/// 잠긴 볼트에 다시 보내도 무해하다.
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
