//! 웹뷰 렌더러가 죽으면 페이지를 다시 읽는다 — WebView2 는 스스로 다시 읽지 않아 창이 빈 채 입력을 받지 않는다.
//!
//! - 다시 읽기는 F5 와 같은 길이다 — 거둠이 임대를 풀고 새 페이지의 타일이 다시 붙는다(`reap.rs` 머리말 4).
//! - 렌더러 종료(`RENDER_PROCESS_EXITED`)만 다시 읽는다 — 응답 없음은 스스로 돌아올 수 있고, 브라우저 프로세스 종료는 다시 읽을 수 없다.
//! - 같은 웹뷰가 [`LOOP_WINDOW`](60초) 안에 [`LOOP_LIMIT`](3)번 죽었으면 크래시 고리로 보고 멈춘다(빈 창 + 로그 한 줄).
//! - 창마다 한 번만 건다 — `on_page_load(Started)` 는 다시 읽을 때마다 온다. OS 분기는 이 파일 하나(Windows 밖은 스텁).

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
#[cfg(windows)]
use std::time::{Duration, Instant};

static WATCHED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

#[cfg(windows)]
const LOOP_WINDOW: Duration = Duration::from_secs(60);
#[cfg(windows)]
const LOOP_LIMIT: usize = 3;

#[cfg(any(windows, test))]
fn may_reload(
    recent: &mut Vec<std::time::Instant>,
    now: std::time::Instant,
    window: std::time::Duration,
    limit: usize,
) -> bool {
    recent.retain(|t| now.duration_since(*t) < window);
    if recent.len() >= limit {
        return false;
    }
    recent.push(now);
    true
}

pub(crate) fn watch(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    {
        let mut set = WATCHED.lock().unwrap_or_else(|e| e.into_inner());
        if !set.insert(label.clone()) {
            return;
        }
    }
    install(webview, label);
}

/// 창이 파괴되면 부른다 — 같은 라벨의 새 창이 다시 걸 수 있게.
pub(crate) fn forget(label: &str) {
    WATCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(label);
}

#[cfg(windows)]
fn install(webview: &tauri::Webview, label: String) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    };
    use webview2_com::ProcessFailedEventHandler;

    let result = webview.with_webview(move |pw| {
        let recent: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
        let label2 = label.clone();
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let (Some(sender), Some(args)) = (sender, args) else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            // SAFETY: WebView2 가 넘긴 살아 있는 인자 객체 — 콜백 안에서만 쓴다.
            unsafe { args.ProcessFailedKind(&mut kind)? };
            if kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                eprintln!("[aynx] 웹뷰 {label2}: 프로세스 실패(종류 {}) — 다시 읽지 않음", kind.0);
                return Ok(());
            }
            let mut recent = recent.lock().unwrap_or_else(|e| e.into_inner());
            if !may_reload(&mut recent, Instant::now(), LOOP_WINDOW, LOOP_LIMIT) {
                eprintln!("[aynx] 웹뷰 {label2}: 렌더러가 {}초 안에 {LOOP_LIMIT}번 죽음 — 더 다시 읽지 않음(크래시 고리)", LOOP_WINDOW.as_secs());
                return Ok(());
            }
            eprintln!("[aynx] 웹뷰 {label2}: 렌더러가 죽음 — 페이지를 다시 읽는다(세션은 다시 붙는다)");
            // SAFETY: 보낸 쪽 웹뷰 — 이 콜백은 그 웹뷰의 UI 스레드에서 온다.
            unsafe { sender.Reload() }
        }));
        let mut token = 0i64;
        // SAFETY: with_webview 콜백은 UI 스레드에서 돈다 — 컨트롤러·코어는 그 스레드의 것이다.
        let added = unsafe {
            pw.controller()
                .CoreWebView2()
                .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        };
        if let Err(e) = added {
            eprintln!("[aynx] 웹뷰 {label}: 렌더러 감시를 걸지 못함 — {e}");
            forget(&label);
        }
    });
    if let Err(e) = result {
        eprintln!("[aynx] 웹뷰 렌더러 감시를 걸지 못함 — {e}");
    }
}

/// 아직 구현하지 않은 OS — 렌더러 종료 감시 없음(그 OS 의 웹뷰가 스스로 다시 읽지 않으면 창이 빈 채 남는다).
#[cfg(not(windows))]
fn install(_webview: &tauri::Webview, _label: String) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forget_lets_the_same_label_watch_again() {
        WATCHED.lock().unwrap().insert("t-crash".into());
        assert!(!WATCHED.lock().unwrap().insert("t-crash".into()));
        forget("t-crash");
        assert!(WATCHED.lock().unwrap().insert("t-crash".into()));
        forget("t-crash");
    }

    #[test]
    fn reload_stops_after_a_crash_loop_and_resumes_when_it_ages_out() {
        use std::time::{Duration, Instant};
        let w = Duration::from_secs(60);
        let t = Instant::now();
        let mut recent = Vec::new();
        assert!(may_reload(&mut recent, t, w, 3));
        assert!(may_reload(&mut recent, t + Duration::from_secs(1), w, 3));
        assert!(may_reload(&mut recent, t + Duration::from_secs(2), w, 3));
        assert!(!may_reload(&mut recent, t + Duration::from_secs(3), w, 3));
        assert!(may_reload(&mut recent, t + Duration::from_secs(61), w, 3));
    }
}
